-- Promote an existing Supabase Auth user to root.
-- Run after 05_access_requests.sql and 06_roles_and_audit.sql.
-- This intentionally does not create users or set/change passwords.
do $$
declare
  target_email text := lower(trim('thermocuerna2025@gmail.com'));
  auth_user_count integer;
  profile_count integer;
begin
  select count(*) into auth_user_count
  from auth.users
  where lower(email) = target_email;

  if auth_user_count <> 1 then
    raise exception 'Expected exactly one Auth user for %, found %', target_email, auth_user_count;
  end if;

  update public.profiles p
  set role = 'root', email = u.email
  from auth.users u
  where p.id = u.id
    and lower(u.email) = target_email;

  get diagnostics profile_count = row_count;
  if profile_count <> 1 then
    raise exception 'Profile not found for %. Run 05_access_requests.sql first.', target_email;
  end if;
end;
$$;
