create or replace function public.sales_directory_with_ids()
returns table (user_id uuid, lookup_key text, display_name text)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not public.is_approved_user() then
    raise exception 'Authentication required' using errcode = '42501';
  end if;

  return query
  select profile.id as user_id,
         lower(trim(auth_user.email)) as lookup_key,
         coalesce(nullif(trim(profile.full_name), ''), 'Miembro sin nombre') as display_name
  from auth.users as auth_user
  join public.profiles as profile on profile.id = auth_user.id
  where profile.role = 'sales'
    and auth_user.email is not null
  order by display_name;
end;
$$;

revoke all on function public.sales_directory_with_ids() from public, anon;
grant execute on function public.sales_directory_with_ids() to authenticated;