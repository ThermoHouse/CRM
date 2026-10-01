create or replace function public.sales_directory()
returns table (lookup_key text, display_name text)
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
  select lower(trim(u.email)) as lookup_key,
         coalesce(nullif(trim(p.full_name), ''), 'Miembro sin nombre') as display_name
  from auth.users u
  join public.profiles p on p.id = u.id
  where p.role = 'sales'
    and u.email is not null
  order by display_name;
end;
$$;

revoke all on function public.sales_directory() from public, anon;
grant execute on function public.sales_directory() to authenticated;
