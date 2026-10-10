alter table public.leads
  add column if not exists followup_assigned_to uuid
    references public.profiles(id) on delete set null;

create index if not exists leads_followup_assigned_to_idx
  on public.leads (followup_assigned_to)
  where followup_assigned_to is not null;

create or replace function public.prevent_sales_lead_owner_change()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if public.current_user_role() = 'sales'
    and new.asesor is distinct from old.asesor then
    raise exception 'El dueño de comisión original no puede cambiarse desde Ventas.'
      using errcode = '42501';
  end if;
  return new;
end;
$$;

drop trigger if exists preserve_lead_commission_owner on public.leads;
create trigger preserve_lead_commission_owner
  before update of asesor on public.leads
  for each row execute function public.prevent_sales_lead_owner_change();