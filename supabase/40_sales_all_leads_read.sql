-- Ventas puede consultar todos los leads, pero mantiene edición/eliminación
-- limitada al dueño de comisión o al vendedor asignado al seguimiento.
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
    when 'sales' then true
    else false
  end;
$$;

grant execute on function public.can_access_lead(text, uuid) to authenticated;

-- Al ampliar lectura de leads, conservar el límite de escritura del historial
-- de contacto para que Ventas solo agregue intentos a leads propios/asignados.
drop policy if exists lead_contact_attempts_insert on public.lead_contact_attempts;
create policy lead_contact_attempts_insert on public.lead_contact_attempts
  for insert to authenticated
  with check (
    public.can_write_table('leads')
    and exists (
      select 1
      from public.leads as lead
      where lead.id = lead_contact_attempts.lead_id
        and (
          public.current_user_role() <> 'sales'
          or public.sales_owns_lead(lead.asesor, lead.followup_assigned_to)
        )
    )
  );

-- Mantener las visitas y obras comerciales limitadas a leads propios/asignados.
drop policy if exists visitas_read on public.visitas;
create policy visitas_read on public.visitas
  for select to authenticated
  using (
    public.can_read_table('visitas')
    and (
      public.current_user_role() <> 'sales'
      or exists (
        select 1
        from public.leads as lead
        where lead.id = visitas.lead_id
          and public.sales_owns_lead(lead.asesor, lead.followup_assigned_to)
      )
    )
  );

drop policy if exists obras_read on public.obras;
create policy obras_read on public.obras
  for select to authenticated
  using (
    public.can_read_table('obras')
    and (
      public.current_user_role() <> 'sales'
      or exists (
        select 1
        from public.leads as lead
        where lead.id = obras.lead_id
          and public.sales_owns_lead(lead.asesor, lead.followup_assigned_to)
      )
    )
  );
