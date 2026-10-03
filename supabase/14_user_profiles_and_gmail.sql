alter table public.profiles
  add column if not exists avatar_path text;

create or replace function public.update_own_profile(
  p_full_name text,
  p_area text,
  p_avatar_path text
)
returns public.profiles
language plpgsql
security definer
set search_path = ''
as $$
declare
  updated_profile public.profiles;
begin
  if auth.uid() is null then
    raise exception 'Inicia sesión para actualizar tu perfil.';
  end if;

  update public.profiles as profile
  set full_name = nullif(trim(p_full_name), ''),
      area = nullif(trim(p_area), ''),
      avatar_path = nullif(trim(p_avatar_path), '')
  where profile.id = auth.uid()
  returning profile.* into updated_profile;

  if not found then
    raise exception 'No se encontró el perfil del usuario.';
  end if;

  return updated_profile;
end;
$$;

revoke all on function public.update_own_profile(text, text, text) from public;
grant execute on function public.update_own_profile(text, text, text) to authenticated;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('profile-avatars', 'profile-avatars', false, 5242880, array['image/jpeg', 'image/png', 'image/webp'])
on conflict (id) do update
set public = false,
    file_size_limit = excluded.file_size_limit,
    allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists profile_avatars_read on storage.objects;
create policy profile_avatars_read on storage.objects
  for select to authenticated
  using (
    bucket_id = 'profile-avatars'
    and ((storage.foldername(name))[1] = (select auth.uid())::text or public.is_root())
  );

drop policy if exists profile_avatars_insert on storage.objects;
create policy profile_avatars_insert on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'profile-avatars'
    and (storage.foldername(name))[1] = (select auth.uid())::text
  );

drop policy if exists profile_avatars_update on storage.objects;
create policy profile_avatars_update on storage.objects
  for update to authenticated
  using (
    bucket_id = 'profile-avatars'
    and (storage.foldername(name))[1] = (select auth.uid())::text
  )
  with check (
    bucket_id = 'profile-avatars'
    and (storage.foldername(name))[1] = (select auth.uid())::text
  );

drop policy if exists profile_avatars_delete on storage.objects;
create policy profile_avatars_delete on storage.objects
  for delete to authenticated
  using (
    bucket_id = 'profile-avatars'
    and (storage.foldername(name))[1] = (select auth.uid())::text
  );

create table if not exists public.gmail_connections (
  user_id uuid primary key references auth.users(id) on delete cascade,
  gmail_email text not null,
  refresh_token_ciphertext text not null,
  refresh_token_iv text not null,
  scopes text[] not null default '{}',
  connected_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.gmail_connections enable row level security;
revoke all on public.gmail_connections from anon, authenticated;
grant all on public.gmail_connections to service_role;