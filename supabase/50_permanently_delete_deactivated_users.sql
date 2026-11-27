-- 50: Purga permanente de cuentas previamente dadas de baja.
-- Conserva los registros comerciales/contables, pero elimina o anonimiza su atribución personal.

alter table public.profiles
  add column if not exists permanent_delete_pending_at timestamptz;

create or replace function public.block_permanent_delete_pending_profile_changes()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if old.permanent_delete_pending_at is not null
    and (new.role is distinct from old.role or new.deactivated_at is distinct from old.deactivated_at) then
    raise exception 'La eliminación definitiva de este usuario ya está en proceso.'
      using errcode = '22023';
  end if;
  return new;
end;
$$;

drop trigger if exists block_permanent_delete_pending_profile_changes on public.profiles;
create trigger block_permanent_delete_pending_profile_changes
  before update of role, deactivated_at on public.profiles
  for each row execute function public.block_permanent_delete_pending_profile_changes();

create or replace function public.crm_people_directory()
returns table (
  user_id uuid,
  lookup_key text,
  display_name text,
  role text,
  is_active boolean
)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not public.is_approved_user() then
    raise exception 'Authentication required' using errcode = '42501';
  end if;

  return query
  select profile.id,
         lower(trim(auth_user.email)),
         coalesce(
           nullif(trim(profile.full_name), ''),
           nullif(trim(auth_user.raw_user_meta_data->>'full_name'), ''),
           nullif(trim(auth_user.email), ''),
           'Miembro sin nombre'
         ),
         profile.role,
         profile.role is not null and profile.deactivated_at is null
  from public.profiles as profile
  join auth.users as auth_user on auth_user.id = profile.id
  where auth_user.email is not null
    and profile.permanent_delete_pending_at is null
    and (
      profile.role is not null
      or profile.deactivated_at is not null
      or profile.deactivated_role is not null
    )
  order by 3;
end;
$$;

revoke all on function public.crm_people_directory() from public, anon;
grant execute on function public.crm_people_directory() to authenticated;

create or replace function public.purge_deactivated_user_identity(
  p_actor_user_id uuid,
  p_target_user_id uuid
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  target_email text;
  target_name text;
  payroll_ids uuid[];
begin
  if p_actor_user_id is null or p_target_user_id is null or p_actor_user_id = p_target_user_id then
    raise exception 'La solicitud de eliminación no es válida.' using errcode = '22023';
  end if;

  if not exists (
    select 1
    from public.profiles as actor
    where actor.id = p_actor_user_id
      and actor.role = 'root'
      and actor.deactivated_at is null
  ) then
    raise exception 'Solo un usuario root activo puede eliminar cuentas.' using errcode = '42501';
  end if;

  select coalesce(nullif(trim(profile.email), ''), nullif(trim(auth_user.email), '')),
         coalesce(
           nullif(trim(profile.full_name), ''),
           nullif(trim(auth_user.raw_user_meta_data->>'full_name'), '')
         )
  into target_email, target_name
  from public.profiles as profile
  join auth.users as auth_user on auth_user.id = profile.id
  where profile.id = p_target_user_id
    and profile.deactivated_at is not null
  for update of profile;

  if not found then
    raise exception 'Solo se pueden eliminar usuarios previamente dados de baja.' using errcode = '22023';
  end if;

  if to_regclass('public.finance_change_requests') is not null then
    delete from public.finance_change_requests where requested_by = p_target_user_id;
    update public.finance_change_requests
    set reviewed_by = null
    where reviewed_by = p_target_user_id;
  end if;

  update public.leads
  set asesor = null
  where target_email is not null
    and lower(trim(coalesce(asesor, ''))) = lower(target_email);

  update public.leads
  set followup_assigned_to = null
  where followup_assigned_to = p_target_user_id;

  if to_regclass('public.lead_contact_attempts') is not null then
    update public.lead_contact_attempts
    set attempted_by = null,
        note = null
    where attempted_by = p_target_user_id;
  end if;

  if to_regclass('public.lead_audit') is not null then
    execute $query$
      update public.lead_audit
      set quien = null
      where lower(trim(coalesce(quien, ''))) = lower($1)
         or ($2 is not null and trim(coalesce(quien, '')) = $2)
    $query$ using target_email, target_name;
  end if;

  if to_regclass('public.insumos') is not null then
    execute $query$
      update public.insumos
      set quien = null
      where ($1 is not null and lower(trim(coalesce(quien, ''))) = lower($1))
         or ($2 is not null and trim(coalesce(quien, '')) = $2)
    $query$ using target_email, target_name;
  end if;

  if to_regclass('public.inventory_movements') is not null then
    execute $query$
      update public.inventory_movements
      set quien = null
      where ($1 is not null and lower(trim(coalesce(quien, ''))) = lower($1))
         or ($2 is not null and trim(coalesce(quien, '')) = $2)
    $query$ using target_email, target_name;
  end if;

  update public.visitas
  set tecnico = null
  where (target_email is not null and lower(trim(coalesce(tecnico, ''))) = lower(target_email))
     or (target_name is not null and trim(coalesce(tecnico, '')) = target_name);

  update public.obras
  set vendedor = null
  where (target_email is not null and lower(trim(coalesce(vendedor, ''))) = lower(target_email))
     or (target_name is not null and trim(coalesce(vendedor, '')) = target_name);

  if to_regclass('public.caja_chica_movimientos') is not null then
    update public.caja_chica_movimientos
    set tecnico = case when tipo = 'viatico' then 'Personal eliminado' else null end
    where (target_email is not null and lower(trim(coalesce(tecnico, ''))) = lower(target_email))
       or (target_name is not null and trim(coalesce(tecnico, '')) = target_name);
  end if;

  if to_regclass('public.warranty_reports') is not null then
    update public.warranty_reports
    set tecnico_responsable = null
    where (target_email is not null and lower(trim(coalesce(tecnico_responsable, ''))) = lower(target_email))
       or (target_name is not null and trim(coalesce(tecnico_responsable, '')) = target_name);

    update public.warranty_reports
    set created_by = null,
        updated_by = null
    where created_by = p_target_user_id or updated_by = p_target_user_id;
  end if;

  if to_regclass('public.service_breakdowns') is not null then
    update public.service_breakdowns
    set created_by = null,
        created_by_email = null
    where created_by = p_target_user_id;

    update public.service_breakdowns
    set created_by_email = null
    where target_email is not null
      and lower(trim(coalesce(created_by_email, ''))) = lower(target_email);
  end if;

  if to_regclass('public.movimientos_financieros') is not null then
    update public.movimientos_financieros
    set created_by = null,
        voided_by = null
    where created_by = p_target_user_id or voided_by = p_target_user_id;
  end if;

  if to_regclass('public.caja_chica_movimientos') is not null then
    update public.caja_chica_movimientos
    set created_by = null,
        voided_by = null
    where created_by = p_target_user_id or voided_by = p_target_user_id;
  end if;

  if to_regclass('public.cierres') is not null then
    update public.cierres
    set confirmado_por = null
    where confirmado_por = p_target_user_id;
  end if;

  if to_regclass('public.barril_mediciones') is not null then
    update public.barril_mediciones
    set medido_por = null
    where medido_por = p_target_user_id;
  end if;

  if to_regclass('public.barril_consumos') is not null then
    update public.barril_consumos
    set registrado_por = null
    where registrado_por = p_target_user_id;
  end if;

  if to_regclass('public.impermeabilizante_movimientos') is not null then
    update public.impermeabilizante_movimientos
    set created_by = null
    where created_by = p_target_user_id;
  end if;

  if to_regclass('public.nomina_registros') is not null then
    select array_agg(id) into payroll_ids
    from public.nomina_registros
    where profile_id = p_target_user_id;

    update public.nomina_registros
    set profile_id = null,
        created_by = null,
        nombre = 'Usuario eliminado',
        cargo = null
    where profile_id = p_target_user_id;

    if payroll_ids is not null and to_regclass('public.movimientos_financieros') is not null then
      update public.movimientos_financieros
      set concepto = 'Nómina - Usuario eliminado'
      where origen = 'nomina'
        and origen_id = any(payroll_ids);
    end if;
  end if;

  if to_regclass('public.conversations') is not null then
    update public.conversations
    set assigned_to = null
    where assigned_to = p_target_user_id;
  end if;

  if to_regclass('public.events') is not null then
    update public.events
    set payload = payload - 'actualizado_por'
    where payload->>'actualizado_por' = p_target_user_id::text;

    update public.events
    set payload = jsonb_set(payload, '{vendedor}', '"Usuario eliminado"'::jsonb, true)
    where payload->>'vendedor' = p_target_user_id::text;
  end if;

  if to_regclass('public.gmail_connections') is not null then
    delete from public.gmail_connections where user_id = p_target_user_id;
  end if;

  if to_regclass('public.lead_reminder_push_subscriptions') is not null then
    delete from public.lead_reminder_push_subscriptions where user_id = p_target_user_id;
  end if;

  update public.profiles
  set full_name = null,
      email = null,
      area = null,
      avatar_path = null,
      deactivated_by = null,
      permanent_delete_pending_at = now()
  where id = p_target_user_id;

  update public.profiles
  set deactivated_by = null
  where deactivated_by = p_target_user_id;

  if to_regclass('public.security_events') is not null then
    delete from public.security_events
    where actor_id = p_target_user_id
       or entity_table = 'profiles' and entity_id = p_target_user_id::text
       or (target_email is not null and (
         lower(coalesce(actor_email, '')) = lower(target_email)
       ))
       or (target_email is not null and lower(coalesce(details->>'email', '')) = lower(target_email))
       or (target_name is not null and details->>'full_name' = target_name);
  end if;
end;
$$;

revoke all on function public.purge_deactivated_user_identity(uuid, uuid) from public, anon, authenticated;
grant execute on function public.purge_deactivated_user_identity(uuid, uuid) to service_role;
