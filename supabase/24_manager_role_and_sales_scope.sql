-- 24: rol "manager" (gerente: solo ver y reportes) y alcance propio para Ventas.
-- Ejecutar después de 23_security_hardening.sql.

alter table public.profiles drop constraint if exists profiles_role_check;
alter table public.profiles
  add constraint profiles_role_check
  check (role is null or role in ('root','sales','operations','administrative','manager'));

create or replace function public.is_approved_user()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(public.current_user_role() in ('root','sales','operations','administrative','manager'), false);
$$;

-- Lectura por tabla. Manager lee todo (solo lectura). Ventas deja de leer garantías.
create or replace function public.can_read_table(table_name text)
returns boolean
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  user_role text := public.current_user_role();
begin
  if user_role in ('root','administrative','manager') then
    return true;
  end if;

  case table_name
    when 'leads' then return user_role = 'sales';
    when 'bot_inbox' then return user_role = 'sales';
    when 'tarifas' then return user_role in ('sales','operations');
    when 'productos' then return user_role in ('sales','operations');
    when 'visitas' then return user_role in ('sales','operations');
    when 'obras' then return user_role in ('sales','operations');
    when 'garantias' then return user_role = 'operations';
    when 'barriles' then return user_role = 'operations';
    when 'inventory_movements' then return user_role = 'operations';
    else return false;
  end case;
end;
$$;

-- ¿El vendedor actual es dueño del lead (asesor) o tiene el seguimiento asignado?
create or replace function public.sales_owns_lead(lead_asesor text, lead_followup uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(
    (nullif(trim(lead_asesor), '') is not null
      and lower(trim(lead_asesor)) = lower(trim(coalesce(auth.jwt()->>'email', ''))))
    or lead_followup = (select auth.uid()),
    false
  );
$$;

create or replace function public.can_access_lead(lead_asesor text, lead_followup uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select case public.current_user_role()
    when 'root' then true
    when 'administrative' then true
    when 'manager' then true
    when 'sales' then public.sales_owns_lead(lead_asesor, lead_followup)
    else false
  end;
$$;

grant execute on function public.sales_owns_lead(text, uuid) to authenticated;
grant execute on function public.can_access_lead(text, uuid) to authenticated;

-- Leads: Ventas solo ve y edita los suyos; root/administrativo/manager ven todos.
drop policy if exists leads_read on public.leads;
create policy leads_read on public.leads
  for select to authenticated
  using (public.can_access_lead(asesor, followup_assigned_to));

drop policy if exists leads_insert on public.leads;
create policy leads_insert on public.leads
  for insert to authenticated
  with check (
    public.can_write_table('leads')
    and (public.is_root() or public.sales_owns_lead(asesor, followup_assigned_to))
  );

drop policy if exists leads_update on public.leads;
create policy leads_update on public.leads
  for update to authenticated
  using (public.can_write_table('leads') and (public.is_root() or public.sales_owns_lead(asesor, followup_assigned_to)))
  with check (public.can_write_table('leads'));

drop policy if exists leads_delete on public.leads;
create policy leads_delete on public.leads
  for delete to authenticated
  using (public.can_write_table('leads') and (public.is_root() or public.sales_owns_lead(asesor, followup_assigned_to)));

-- Historial de contacto: solo de los leads que el usuario puede ver.
drop policy if exists lead_contact_attempts_read on public.lead_contact_attempts;
create policy lead_contact_attempts_read on public.lead_contact_attempts
  for select to authenticated
  using (
    public.can_read_table('leads')
    and exists (select 1 from public.leads as lead where lead.id = lead_contact_attempts.lead_id)
  );

-- Visitas y obras: Ventas solo ve las de sus leads.
drop policy if exists visitas_read on public.visitas;
create policy visitas_read on public.visitas
  for select to authenticated
  using (
    public.can_read_table('visitas')
    and (
      public.current_user_role() <> 'sales'
      or exists (select 1 from public.leads as lead where lead.id = visitas.lead_id)
    )
  );

drop policy if exists obras_read on public.obras;
create policy obras_read on public.obras
  for select to authenticated
  using (
    public.can_read_table('obras')
    and (
      public.current_user_role() <> 'sales'
      or exists (select 1 from public.leads as lead where lead.id = obras.lead_id)
    )
  );
