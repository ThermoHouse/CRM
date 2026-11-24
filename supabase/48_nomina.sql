-- 48: Nomina (perfiles y registros) para Finanzas. Ejecutar despues de 47.
-- Mantiene Nómina como modulo aparte y refleja cada registro como egreso en Libro (origen = 'nomina').

create table if not exists public.nomina_registros (
  id uuid primary key default gen_random_uuid(),
  profile_id uuid references public.profiles(id) on delete set null,
  nombre text not null check (length(trim(nombre)) > 0),
  cargo text,
  fecha_pago date not null default current_date,
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

alter table public.nomina_registros
  add column if not exists fecha_pago date not null default current_date;

create index if not exists nomina_registros_nombre_idx on public.nomina_registros (nombre);
create index if not exists nomina_registros_profile_id_idx on public.nomina_registros (profile_id);
create index if not exists nomina_registros_fecha_pago_idx on public.nomina_registros (fecha_pago desc);

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

-- Permitir reflejar nomina como egreso automatico en Libro (origen = 'nomina').
do $$
declare c record;
begin
  for c in
    select conname
    from pg_constraint
    where conrelid = 'public.movimientos_financieros'::regclass
      and contype = 'c'
      and pg_get_constraintdef(oid) ilike '%origen%'
  loop
    execute format('alter table public.movimientos_financieros drop constraint %I', c.conname);
  end loop;
end;
$$;

alter table public.movimientos_financieros
  add constraint movimientos_financieros_origen_check
  check (origen in ('manual', 'anticipo', 'caja_chica', 'nomina'));

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

-- Guarda/actualiza un registro de nomina y sincroniza su egreso reflejado en Libro.
create or replace function public.save_nomina_registro(
  p_id uuid default null,
  p_profile_id uuid default null,
  p_nombre text default null,
  p_cargo text default null,
  p_fecha_pago date default current_date,
  p_salario_base_diario numeric default 0,
  p_bono_puntualidad numeric default 0,
  p_bono_desempeno numeric default 0,
  p_comisiones numeric default 0,
  p_multa_penalizaciones numeric default 0
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_id uuid;
  v_nombre text := trim(coalesce(p_nombre, ''));
  v_cargo text := nullif(trim(coalesce(p_cargo, '')), '');
  v_fecha date := coalesce(p_fecha_pago, current_date);
  v_total numeric(12,2);
  v_cat uuid;
  v_concepto text;
begin
  if not public.can_write_finance() then
    raise exception 'No autorizado' using errcode = '42501';
  end if;
  if v_nombre = '' then
    raise exception 'Escribe el nombre.' using errcode = '22023';
  end if;
  if p_salario_base_diario < 0 or p_bono_puntualidad < 0 or p_bono_desempeno < 0 or p_comisiones < 0 or p_multa_penalizaciones < 0 then
    raise exception 'Los montos de nómina no pueden ser negativos.' using errcode = '22023';
  end if;

  if p_id is not null then
    update public.nomina_registros
    set profile_id = p_profile_id,
        nombre = v_nombre,
        cargo = v_cargo,
        fecha_pago = v_fecha,
        salario_base_diario = coalesce(p_salario_base_diario, 0),
        bono_puntualidad = coalesce(p_bono_puntualidad, 0),
        bono_desempeno = coalesce(p_bono_desempeno, 0),
        comisiones = coalesce(p_comisiones, 0),
        multa_penalizaciones = coalesce(p_multa_penalizaciones, 0)
    where id = p_id
    returning id into v_id;
    if v_id is null then
      raise exception 'Registro de nómina no encontrado.' using errcode = 'P0002';
    end if;
  else
    insert into public.nomina_registros (
      profile_id, nombre, cargo, fecha_pago,
      salario_base_diario, bono_puntualidad, bono_desempeno, comisiones, multa_penalizaciones, created_by
    ) values (
      p_profile_id, v_nombre, v_cargo, v_fecha,
      coalesce(p_salario_base_diario, 0), coalesce(p_bono_puntualidad, 0), coalesce(p_bono_desempeno, 0),
      coalesce(p_comisiones, 0), coalesce(p_multa_penalizaciones, 0), auth.uid()
    )
    returning id into v_id;
  end if;

  select total into v_total from public.nomina_registros where id = v_id;
  if coalesce(v_total, 0) <= 0 then
    raise exception 'El total de nómina debe ser mayor a 0 para reflejarse como gasto en Finanzas.' using errcode = '22023';
  end if;

  select id into v_cat
  from public.finanzas_categorias
  where tipo = 'egreso' and lower(trim(nombre)) = 'nómina'
  limit 1;
  if v_cat is null then
    raise exception 'No se encontró la categoría de egreso "Nómina" en Finanzas.' using errcode = 'P0002';
  end if;

  v_concepto := 'Nómina - ' || v_nombre || case when v_cargo is not null then ' (' || v_cargo || ')' else '' end;

  insert into public.movimientos_financieros (
    fecha, tipo, categoria_id, monto, concepto, plaza, metodo_pago, origen, origen_id, created_by
  ) values (
    v_fecha, 'egreso', v_cat, v_total, v_concepto, 'Morelos', null, 'nomina', v_id, auth.uid()
  )
  on conflict (origen, origen_id) where origen_id is not null do update set
    fecha = excluded.fecha,
    tipo = excluded.tipo,
    categoria_id = excluded.categoria_id,
    monto = excluded.monto,
    concepto = excluded.concepto,
    plaza = excluded.plaza,
    metodo_pago = excluded.metodo_pago;

  return v_id;
end;
$$;

revoke all on function public.save_nomina_registro(uuid, uuid, text, text, date, numeric, numeric, numeric, numeric, numeric) from public, anon;
grant execute on function public.save_nomina_registro(uuid, uuid, text, text, date, numeric, numeric, numeric, numeric, numeric) to authenticated;

-- Elimina un registro de nomina y su egreso reflejado en Libro (permiso de eliminacion: root).
create or replace function public.delete_nomina_registro(p_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not public.is_root() then
    raise exception 'No autorizado' using errcode = '42501';
  end if;

  delete from public.movimientos_financieros
  where origen = 'nomina' and origen_id = p_id;

  delete from public.nomina_registros
  where id = p_id;
end;
$$;

revoke all on function public.delete_nomina_registro(uuid) from public, anon;
grant execute on function public.delete_nomina_registro(uuid) to authenticated;

do $$
begin
  if to_regprocedure('public.log_table_activity()') is not null then
    execute 'drop trigger if exists audit_activity on public.nomina_registros';
    execute 'create trigger audit_activity after insert or update or delete on public.nomina_registros for each row execute function public.log_table_activity()';
  end if;
end;
$$;
