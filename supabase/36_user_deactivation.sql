alter table public.profiles
  add column if not exists deactivated_at timestamptz,
  add column if not exists deactivated_by uuid,
  add column if not exists deactivated_role text;

create or replace function public.prevent_inactive_profile_role_change()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if old.deactivated_at is not null
    and new.deactivated_at is not null
    and new.role is distinct from old.role then
    raise exception 'Reactiva primero el perfil para cambiar su departamento.'
      using errcode = '22023';
  end if;

  return new;
end;
$$;

drop trigger if exists prevent_inactive_profile_role_change on public.profiles;
create trigger prevent_inactive_profile_role_change
  before update of role on public.profiles
  for each row execute function public.prevent_inactive_profile_role_change();

create or replace function public.deactivate_profile(p_user_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  target_email text;
  target_role text;
  target_deactivated_at timestamptz;
  active_root_count bigint;
  actor_email text;
begin
  if auth.uid() is null or not public.is_root() then
    raise exception 'Solo root puede dar de baja usuarios.'
      using errcode = '42501';
  end if;

  if p_user_id is null or p_user_id = auth.uid() then
    raise exception 'No puedes dar de baja tu propia cuenta.'
      using errcode = '22023';
  end if;

  perform profile.id
  from public.profiles as profile
  where profile.role = 'root'
    and profile.deactivated_at is null
  order by profile.id
  for update;

  select profile.email, profile.role, profile.deactivated_at
  into target_email, target_role, target_deactivated_at
  from public.profiles as profile
  where profile.id = p_user_id
  for update;

  if not found then
    raise exception 'No se encontró el perfil del usuario.'
      using errcode = 'P0002';
  end if;

  if target_deactivated_at is not null then
    raise exception 'El usuario ya está dado de baja.'
      using errcode = '22023';
  end if;

  if target_role = 'root' then
    select count(*)
    into active_root_count
    from public.profiles as profile
    where profile.role = 'root'
      and profile.deactivated_at is null;

    if active_root_count <= 1 then
      raise exception 'No puedes dar de baja al último usuario root activo.'
        using errcode = '22023';
    end if;
  end if;

  update public.profiles
  set deactivated_at = now(),
      deactivated_by = auth.uid(),
      deactivated_role = role,
      role = null
  where id = p_user_id;

  select profile.email into actor_email
  from public.profiles as profile
  where profile.id = auth.uid();

  insert into public.security_events (
    actor_id, actor_email, action, entity_table, entity_id, details
  )
  values (
    auth.uid(),
    actor_email,
    'Baja de usuario',
    'profiles',
    p_user_id::text,
    jsonb_build_object('email', target_email, 'role', target_role)
  );
end;
$$;

create or replace function public.reactivate_profile(p_user_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  target_email text;
  restored_role text;
  actor_email text;
begin
  if auth.uid() is null or not public.is_root() then
    raise exception 'Solo root puede reactivar usuarios.'
      using errcode = '42501';
  end if;

  if p_user_id is null or p_user_id = auth.uid() then
    raise exception 'No puedes reactivar tu propia cuenta.'
      using errcode = '22023';
  end if;

  select profile.email, profile.deactivated_role
  into target_email, restored_role
  from public.profiles as profile
  where profile.id = p_user_id
    and profile.deactivated_at is not null
  for update;

  if not found then
    raise exception 'No se encontró un usuario dado de baja.'
      using errcode = 'P0002';
  end if;

  update public.profiles
  set deactivated_at = null,
      deactivated_by = null,
      deactivated_role = null,
      role = restored_role
  where id = p_user_id;

  select profile.email into actor_email
  from public.profiles as profile
  where profile.id = auth.uid();

  insert into public.security_events (
    actor_id, actor_email, action, entity_table, entity_id, details
  )
  values (
    auth.uid(),
    actor_email,
    'Reactivación de usuario',
    'profiles',
    p_user_id::text,
    jsonb_build_object('email', target_email, 'role', restored_role)
  );
end;
$$;

revoke all on function public.deactivate_profile(uuid) from public, anon;
revoke all on function public.reactivate_profile(uuid) from public, anon;
grant execute on function public.deactivate_profile(uuid) to authenticated;
grant execute on function public.reactivate_profile(uuid) to authenticated;
