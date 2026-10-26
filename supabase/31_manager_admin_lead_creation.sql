-- 31: permite a Administrativo y Gerente crear leads sin editar ni eliminar existentes.
-- Ejecutar después de 30_finance_reports.sql.

drop policy if exists leads_insert on public.leads;
create policy leads_insert on public.leads
  for insert to authenticated
  with check (
    public.current_user_role() = 'root'
    or (
      public.current_user_role() in ('administrative','manager')
      and lower(trim(coalesce(asesor, ''))) = lower(trim(coalesce(auth.jwt()->>'email', '')))
    )
    or (
      public.can_write_table('leads')
      and public.sales_owns_lead(asesor, followup_assigned_to)
    )
  );
