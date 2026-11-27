-- 49: Directorio de nombres históricos independiente del rol actual.
-- Ejecutar después de las migraciones previas, incluida 36_user_deactivation.sql.
-- Los perfiles inactivos conservan su identidad para mostrar la atribución histórica.

create or replace function public.crm_people_directory()
returns table (
  user_id uuid,
  lookup_key text,
  display_name text,
  role text,
  is_active boolean
)
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
         coalesce(
           nullif(trim(profile.full_name), ''),
           nullif(trim(auth_user.raw_user_meta_data->>'full_name'), ''),
           nullif(trim(auth_user.email), ''),
           'Miembro sin nombre'
         ) as display_name,
         profile.role,
         profile.role is not null and profile.deactivated_at is null as is_active
  from public.profiles as profile
  join auth.users as auth_user on auth_user.id = profile.id
  where auth_user.email is not null
    and (
      profile.role is not null
      or profile.deactivated_at is not null
      or profile.deactivated_role is not null
    )
  order by display_name;
end;
$$;

revoke all on function public.crm_people_directory() from public, anon;
grant execute on function public.crm_people_directory() to authenticated;
