alter table public.profiles
  add column if not exists visible_tabs text[];

alter table public.profiles
  drop constraint if exists profiles_visible_tabs_check;

alter table public.profiles
  add constraint profiles_visible_tabs_check
  check (
    visible_tabs is null
    or visible_tabs <@ array[
      'Dashboard','Leads','Inbox Bot','Visitas','Instalaciones',
      'Mantenimiento','Precios','Inventario'
    ]::text[]
  );

grant update (visible_tabs) on public.profiles to authenticated;

create or replace function public.create_visit_for_lead()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.status = 'visita' and old.status is distinct from 'visita' then
    insert into public.visitas (lead_id, cliente, ubicacion, status)
    select new.id,
           new.nombre,
           nullif(concat_ws(', ', nullif(trim(new.direccion), ''), nullif(trim(new.ciudad), '')), ''),
           'por_visitar'
    where not exists (
      select 1
      from public.visitas as visit
      where visit.lead_id = new.id
        and visit.status = 'por_visitar'
    );
  end if;

  return new;
end;
$$;

drop trigger if exists create_visit_for_lead on public.leads;
create trigger create_visit_for_lead
  after update of status on public.leads
  for each row
  execute function public.create_visit_for_lead();
