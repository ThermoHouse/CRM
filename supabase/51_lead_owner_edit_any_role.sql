-- 51: Permite que el dueño de un lead lo consulte y edite aunque cambie de rol.
-- Ejecutar después de 40_sales_all_leads_read.sql.

create or replace function public.can_access_lead(lead_asesor text, lead_followup uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select public.is_approved_user()
    and (
      public.current_user_role() in ('root','administrative','manager','sales')
      or public.sales_owns_lead(lead_asesor, lead_followup)
    );
$$;

revoke all on function public.can_access_lead(text, uuid) from public, anon;
grant execute on function public.can_access_lead(text, uuid) to authenticated;

create or replace function public.prevent_sales_lead_owner_change()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if coalesce(auth.role(), '') <> 'service_role'
    and public.current_user_role() <> 'root'
    and new.asesor is distinct from old.asesor then
    raise exception 'Solo Root puede cambiar al dueño original del lead.'
      using errcode = '42501';
  end if;
  return new;
end;
$$;

drop trigger if exists preserve_lead_commission_owner on public.leads;
create trigger preserve_lead_commission_owner
  before update of asesor on public.leads
  for each row execute function public.prevent_sales_lead_owner_change();

create or replace function public.prevent_sales_lead_owner_change()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if public.current_user_role() <> 'root'
    and new.asesor is distinct from old.asesor then
    raise exception 'Solo Root puede cambiar al dueño original del lead.'
      using errcode = '42501';
  end if;
  return new;
end;
$$;

drop policy if exists leads_update on public.leads;
create policy leads_update on public.leads
  for update to authenticated
  using (
    public.is_approved_user()
    and (public.is_root() or public.sales_owns_lead(asesor, followup_assigned_to))
  )
  with check (
    public.is_approved_user()
    and (public.is_root() or public.sales_owns_lead(asesor, followup_assigned_to))
  );
