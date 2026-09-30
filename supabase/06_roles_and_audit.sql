alter table public.profiles add column if not exists email text;

update public.profiles p
set email = u.email
from auth.users u
where u.id = p.id and p.email is distinct from u.email;

update public.profiles
set role = null
where role is not null
  and role not in ('root','sales','operations','administrative');

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.profiles (id, email, full_name, area)
  values (
    new.id,
    new.email,
    nullif(new.raw_user_meta_data->>'full_name', ''),
    nullif(new.raw_user_meta_data->>'area', '')
  )
  on conflict (id) do update set email = excluded.email;
  return new;
end;
$$;

alter table public.profiles drop constraint if exists profiles_role_check;
alter table public.profiles
  add constraint profiles_role_check
  check (role is null or role in ('root','sales','operations','administrative'));

do $$
begin
  if (select count(*) from auth.users) = 1 then
    update public.profiles p
    set role = 'root'
    from auth.users u
    where p.id = u.id and p.role is null;
  end if;
end;
$$;

create table if not exists public.security_events (
  id bigint generated always as identity primary key,
  actor_id uuid,
  actor_email text,
  action text not null,
  entity_table text not null,
  entity_id text,
  details jsonb not null default '{}'::jsonb,
  occurred_at timestamptz not null default now()
);

alter table public.security_events enable row level security;

create or replace function public.current_user_role()
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select p.role
  from public.profiles p
  where p.id = (select auth.uid())
  limit 1;
$$;

create or replace function public.is_root()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(public.current_user_role() = 'root', false);
$$;

create or replace function public.is_approved_user()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(public.current_user_role() in ('root','sales','operations','administrative'), false);
$$;

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
  if user_role = 'root' or user_role = 'administrative' then
    return true;
  end if;

  case table_name
    when 'leads' then return user_role = 'sales';
    when 'bot_inbox' then return user_role = 'sales';
    when 'tarifas' then return user_role in ('sales','operations');
    when 'productos' then return user_role in ('sales','operations');
    when 'visitas' then return user_role in ('sales','operations');
    when 'obras' then return user_role in ('sales','operations');
    when 'garantias' then return user_role in ('sales','operations');
    when 'barriles' then return user_role = 'operations';
    when 'inventory_movements' then return user_role = 'operations';
    when 'lead_audit' then return false;
    else return false;
  end case;
end;
$$;

create or replace function public.can_write_table(table_name text)
returns boolean
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  user_role text := public.current_user_role();
begin
  if user_role = 'root' then
    return true;
  end if;

  case table_name
    when 'leads' then return user_role = 'sales';
    when 'bot_inbox' then return user_role = 'sales';
    when 'visitas' then return user_role = 'operations';
    when 'obras' then return user_role = 'operations';
    when 'garantias' then return user_role = 'operations';
    when 'barriles' then return user_role in ('operations','administrative');
    when 'inventory_movements' then return user_role in ('operations','administrative');
    when 'productos' then return user_role = 'administrative';
    when 'tarifas' then return user_role = 'administrative';
    when 'lead_audit' then return false;
    else return false;
  end case;
end;
$$;

grant execute on function public.current_user_role() to authenticated;
grant execute on function public.is_root() to authenticated;
grant execute on function public.is_approved_user() to authenticated;
grant execute on function public.can_read_table(text) to authenticated;
grant execute on function public.can_write_table(text) to authenticated;

create or replace function public.complete_visit(visit_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if public.current_user_role() not in ('root','operations') then
    raise exception 'Insufficient role to complete a visit' using errcode = '42501';
  end if;

  update public.visitas set status = 'realizada' where id = visit_id;
  if not found then
    raise exception 'Visit not found' using errcode = 'P0002';
  end if;
end;
$$;

revoke all on function public.complete_visit(uuid) from public, anon;
grant execute on function public.complete_visit(uuid) to authenticated;

revoke all on public.profiles from anon, authenticated;
grant select on public.profiles to authenticated;
grant update (role) on public.profiles to authenticated;
revoke all on public.security_events from anon, authenticated;
grant select on public.security_events to authenticated;

create or replace function public.sync_visit_completion()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.status = 'realizada' and old.status is distinct from 'realizada' and new.lead_id is not null then
    update public.leads set status = 'visitado' where id = new.lead_id;
  end if;
  return new;
end;
$$;

drop trigger if exists sync_visit_completion on public.visitas;
create trigger sync_visit_completion
  after update of status on public.visitas
  for each row execute function public.sync_visit_completion();

drop policy if exists profile_self_read on public.profiles;
drop policy if exists profiles_read_self_or_root on public.profiles;
create policy profiles_read_self_or_root on public.profiles
  for select to authenticated
  using (id = (select auth.uid()) or public.is_root());

drop policy if exists profiles_root_update on public.profiles;
create policy profiles_root_update on public.profiles
  for update to authenticated
  using (public.is_root())
  with check (public.is_root());

drop policy if exists security_events_root_read on public.security_events;
create policy security_events_root_read on public.security_events
  for select to authenticated
  using (public.is_root());

do $$
declare
  table_name text;
  table_names text[] := array[
    'leads','bot_inbox','productos','tarifas','visitas','obras','garantias',
    'barriles','lead_audit','inventory_movements'
  ];
begin
  foreach table_name in array table_names loop
    if to_regclass(format('public.%I', table_name)) is not null then
      execute format('alter table public.%I enable row level security', table_name);
      execute format('drop policy if exists auth_all on public.%I', table_name);
      execute format('drop policy if exists audit_read on public.%I', table_name);
      execute format('drop policy if exists audit_ins on public.%I', table_name);
      execute format('drop policy if exists mov_read on public.%I', table_name);
      execute format('drop policy if exists mov_ins on public.%I', table_name);
      execute format('drop policy if exists %I on public.%I', table_name || '_read', table_name);
      execute format('drop policy if exists %I on public.%I', table_name || '_insert', table_name);
      execute format('drop policy if exists %I on public.%I', table_name || '_update', table_name);
      execute format('drop policy if exists %I on public.%I', table_name || '_delete', table_name);
      execute format(
        'create policy %I on public.%I for select to authenticated using (public.can_read_table(%L))',
        table_name || '_read', table_name, table_name
      );
      execute format(
        'create policy %I on public.%I for insert to authenticated with check (public.can_write_table(%L))',
        table_name || '_insert', table_name, table_name
      );
      execute format(
        'create policy %I on public.%I for update to authenticated using (public.can_write_table(%L)) with check (public.can_write_table(%L))',
        table_name || '_update', table_name, table_name, table_name
      );
      execute format(
        'create policy %I on public.%I for delete to authenticated using (public.can_write_table(%L))',
        table_name || '_delete', table_name, table_name
      );
    end if;
  end loop;
end;
$$;

create or replace function public.log_table_activity()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  row_data jsonb;
  record_id text;
  event_action text := lower(tg_op);
  event_details jsonb := '{}'::jsonb;
begin
  if tg_op = 'DELETE' then
    row_data := to_jsonb(old);
  else
    row_data := to_jsonb(new);
  end if;
  record_id := row_data->>'id';

  if tg_table_name = 'profiles' and tg_op = 'UPDATE' then
    if old.role is distinct from new.role then
      event_action := 'role_change';
      event_details := jsonb_build_object('old_role', old.role, 'new_role', new.role);
    end if;
  end if;

  insert into public.security_events(actor_id, actor_email, action, entity_table, entity_id, details)
  values ((select auth.uid()), auth.jwt()->>'email', event_action, tg_table_name, record_id, event_details);

  if tg_op = 'DELETE' then
    return old;
  end if;
  return new;
end;
$$;

do $$
declare
  table_name text;
  table_names text[] := array[
    'profiles','leads','bot_inbox','productos','tarifas','visitas','obras',
    'garantias','barriles','lead_audit','inventory_movements'
  ];
begin
  foreach table_name in array table_names loop
    if to_regclass(format('public.%I', table_name)) is not null then
      execute format('drop trigger if exists audit_activity on public.%I', table_name);
      execute format(
        'create trigger audit_activity after insert or update or delete on public.%I for each row execute function public.log_table_activity()',
        table_name
      );
    end if;
  end loop;
end;
$$;