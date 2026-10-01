create table if not exists public.plazas (
  id uuid primary key default gen_random_uuid(),
  nombre text not null,
  activa boolean not null default true,
  created_at timestamptz not null default now()
);

create unique index if not exists plazas_nombre_lower_uq
  on public.plazas (lower(trim(nombre)));

insert into public.plazas (nombre)
values ('Morelos')
on conflict do nothing;

alter table public.leads
  add column if not exists plaza text not null default 'Morelos';

alter table public.barriles
  alter column plaza set default 'Morelos';

update public.barriles
set plaza = 'Morelos'
where plaza is null or plaza = 'Cuernavaca';

alter table public.plazas enable row level security;

revoke all on public.plazas from anon, authenticated;
grant select, insert, update, delete on public.plazas to authenticated;

drop policy if exists plazas_read_approved on public.plazas;
create policy plazas_read_approved on public.plazas
  for select to authenticated
  using (public.is_approved_user());

drop policy if exists plazas_root_insert on public.plazas;
create policy plazas_root_insert on public.plazas
  for insert to authenticated
  with check (public.is_root());

drop policy if exists plazas_root_update on public.plazas;
create policy plazas_root_update on public.plazas
  for update to authenticated
  using (public.is_root())
  with check (public.is_root());

drop policy if exists plazas_root_delete on public.plazas;
create policy plazas_root_delete on public.plazas
  for delete to authenticated
  using (public.is_root());

drop trigger if exists audit_activity on public.plazas;
create trigger audit_activity
  after insert or update or delete on public.plazas
  for each row execute function public.log_table_activity();
