-- Requests create a profile without a role. A role assignment activates access.
create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  full_name text,
  area text,
  role text,
  created_at timestamptz not null default now()
);

alter table public.profiles enable row level security;

-- Preserve access for existing users without elevating them to administrators.
insert into public.profiles (id, full_name, area, role)
select id,
       nullif(raw_user_meta_data->>'full_name', ''),
       nullif(raw_user_meta_data->>'area', ''),
       'member'
from auth.users
on conflict (id) do nothing;

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.profiles (id, full_name, area)
  values (
    new.id,
    nullif(new.raw_user_meta_data->>'full_name', ''),
    nullif(new.raw_user_meta_data->>'area', '')
  )
  on conflict (id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute procedure public.handle_new_user();

drop policy if exists profile_self_read on public.profiles;
create policy profile_self_read on public.profiles
  for select to authenticated
  using (id = (select auth.uid()));

create or replace function public.is_approved_user()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.profiles
    where id = (select auth.uid()) and role is not null
  );
$$;

grant execute on function public.is_approved_user() to authenticated;

do $$
declare
  table_name text;
begin
  foreach table_name in array array['leads','bot_inbox','productos','tarifas','visitas','obras','garantias','barriles'] loop
    if to_regclass(format('public.%I', table_name)) is not null then
      execute format('alter table public.%I enable row level security', table_name);
      execute format('drop policy if exists auth_all on public.%I', table_name);
      execute format(
        'create policy auth_all on public.%I for all to authenticated using (public.is_approved_user()) with check (public.is_approved_user())',
        table_name
      );
    end if;
  end loop;

  if to_regclass('public.lead_audit') is not null then
    execute 'drop policy if exists audit_read on public.lead_audit';
    execute 'drop policy if exists audit_ins on public.lead_audit';
    execute 'create policy audit_read on public.lead_audit for select to authenticated using (public.is_approved_user())';
    execute 'create policy audit_ins on public.lead_audit for insert to authenticated with check (public.is_approved_user())';
  end if;

  if to_regclass('public.inventory_movements') is not null then
    execute 'drop policy if exists mov_read on public.inventory_movements';
    execute 'drop policy if exists mov_ins on public.inventory_movements';
    execute 'create policy mov_read on public.inventory_movements for select to authenticated using (public.is_approved_user())';
    execute 'create policy mov_ins on public.inventory_movements for insert to authenticated with check (public.is_approved_user())';
  end if;
end;
$$;