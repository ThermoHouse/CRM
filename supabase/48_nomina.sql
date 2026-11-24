-- 48: Nomina (perfiles y registros) para Finanzas. Ejecutar despues de 47.

create table if not exists public.nomina_registros (
  id uuid primary key default gen_random_uuid(),
  profile_id uuid references public.profiles(id) on delete set null,
  nombre text not null check (length(trim(nombre)) > 0),
  cargo text,
  salario_base_diario numeric(12,2) not null default 0 check (salario_base_diario >= 0),
  bono_puntualidad numeric(12,2) not null default 0 check (bono_puntualidad >= 0),
  bono_desempeno numeric(12,2) not null default 0 check (bono_desempeno >= 0),
  comisiones numeric(12,2) not null default 0 check (comisiones >= 0),
  multa_penalizaciones numeric(12,2) not null default 0 check (multa_penalizaciones >= 0),
  total numeric(12,2) generated always as (
    salario_base_diario + bono_puntualidad + bono_desempeno + comisiones - multa_penalizaciones
  ) stored,
  created_by uuid default auth.uid() references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists nomina_registros_nombre_idx on public.nomina_registros (nombre);
create index if not exists nomina_registros_profile_id_idx on public.nomina_registros (profile_id);

create or replace function public.nomina_set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists nomina_registros_set_updated_at on public.nomina_registros;
create trigger nomina_registros_set_updated_at
  before update on public.nomina_registros
  for each row execute function public.nomina_set_updated_at();

alter table public.nomina_registros enable row level security;
revoke all on public.nomina_registros from public, anon, authenticated;
grant select, insert, update, delete on public.nomina_registros to authenticated;

drop policy if exists nomina_registros_read on public.nomina_registros;
create policy nomina_registros_read on public.nomina_registros
  for select to authenticated using (public.can_read_finance());
drop policy if exists nomina_registros_insert on public.nomina_registros;
create policy nomina_registros_insert on public.nomina_registros
  for insert to authenticated with check (public.can_write_finance());
drop policy if exists nomina_registros_update on public.nomina_registros;
create policy nomina_registros_update on public.nomina_registros
  for update to authenticated using (public.can_write_finance()) with check (public.can_write_finance());
drop policy if exists nomina_registros_delete on public.nomina_registros;
create policy nomina_registros_delete on public.nomina_registros
  for delete to authenticated using (public.is_root());

-- Directorio de perfiles activos del CRM para precargar Nomina (solo lectura de datos basicos).
create or replace function public.nomina_profiles_directory()
returns table (
  id uuid,
  display_name text,
  email text,
  cargo text,
  role text
)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not public.can_read_finance() then
    raise exception 'No autorizado' using errcode = '42501';
  end if;

  return query
  select p.id,
         coalesce(nullif(trim(p.full_name), ''), nullif(trim(p.email), ''), 'Usuario sin nombre') as display_name,
         p.email,
         coalesce(nullif(trim(p.area), ''), nullif(trim(p.role), '')) as cargo,
         p.role
  from public.profiles p
  where p.deactivated_at is null
  order by display_name;
end;
$$;

revoke all on function public.nomina_profiles_directory() from public, anon;
grant execute on function public.nomina_profiles_directory() to authenticated;

do $$
begin
  if to_regprocedure('public.log_table_activity()') is not null then
    execute 'drop trigger if exists audit_activity on public.nomina_registros';
    execute 'create trigger audit_activity after insert or update or delete on public.nomina_registros for each row execute function public.log_table_activity()';
  end if;
end;
$$;
