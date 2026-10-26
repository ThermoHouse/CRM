-- 33: registra salidas de químicos midiendo los centímetros consumidos del barril.
-- Ejecutar después de 32_applications_calendar_and_maintenance.sql.

create table if not exists public.barril_consumos (
  id uuid primary key default gen_random_uuid(),
  barril_id uuid references public.barriles(id) on delete set null,
  tipo text not null check (tipo in ('isocianato','poliol')),
  plaza text,
  lote text,
  consumo_cm numeric not null check (consumo_cm > 0),
  consumo_litros numeric not null check (consumo_litros >= 0),
  nivel_cm_resultante numeric not null check (nivel_cm_resultante >= 0),
  nivel_litros_resultante numeric not null check (nivel_litros_resultante >= 0),
  nota text,
  registrado_por uuid references public.profiles(id) on delete set null default auth.uid(),
  created_at timestamptz not null default now()
);

create index if not exists barril_consumos_created_at_idx
  on public.barril_consumos(created_at desc);
create index if not exists barril_consumos_tipo_created_at_idx
  on public.barril_consumos(tipo, created_at desc);

alter table public.barril_consumos enable row level security;
revoke all on public.barril_consumos from public, anon, authenticated;
grant select on public.barril_consumos to authenticated;

drop policy if exists barril_consumos_read on public.barril_consumos;
create policy barril_consumos_read on public.barril_consumos
  for select to authenticated
  using (public.can_read_table('barriles'));

create or replace function public.consume_barrel_by_height(
  p_barril_id uuid,
  p_consumo_cm numeric,
  p_nota text default null
)
returns table (
  consumo_id uuid,
  consumo_litros numeric,
  nivel_cm_resultante numeric,
  nivel_litros_resultante numeric
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  barrel public.barriles;
  total_cm numeric;
  capacity numeric;
  remaining_cm numeric;
  remaining_liters numeric;
  used_liters numeric;
  log_id uuid;
begin
  if not public.can_write_table('barriles') then
    raise exception 'No tienes permiso para registrar consumos de químicos.'
      using errcode = '42501';
  end if;
  if p_consumo_cm is null or p_consumo_cm <= 0 then
    raise exception 'Los centímetros consumidos deben ser mayores que cero.';
  end if;

  select * into barrel
  from public.barriles
  where id = p_barril_id
  for update;
  if not found then
    raise exception 'No se encontró el barril seleccionado.'
      using errcode = 'P0002';
  end if;
  if barrel.estado = 'cerrado' then
    raise exception 'Abre el barril y registra su altura actual antes de descontar consumo.';
  end if;
  if barrel.nivel_cm is null then
    raise exception 'Registra primero la altura actual del barril.';
  end if;
  if p_consumo_cm > barrel.nivel_cm then
    raise exception 'El consumo (% cm) supera el nivel disponible (% cm).',
      p_consumo_cm, barrel.nivel_cm;
  end if;

  total_cm := coalesce(barrel.altura_total_cm, 100);
  capacity := coalesce(barrel.capacidad_litros, 200);
  remaining_cm := round(barrel.nivel_cm - p_consumo_cm, 2);
  used_liters := round(p_consumo_cm / total_cm * capacity, 1);
  remaining_liters := round(remaining_cm / total_cm * capacity, 1);

  insert into public.barril_consumos
    (barril_id, tipo, plaza, lote, consumo_cm, consumo_litros,
     nivel_cm_resultante, nivel_litros_resultante, nota)
  values
    (barrel.id, barrel.tipo, barrel.plaza, barrel.lote, p_consumo_cm,
     used_liters, remaining_cm, remaining_liters,
     nullif(trim(coalesce(p_nota, '')), ''))
  returning id into log_id;

  insert into public.barril_mediciones (barril_id, altura_cm, nota)
  values (
    barrel.id,
    remaining_cm,
    concat_ws(' · ', 'Consumo registrado', nullif(trim(coalesce(p_nota, '')), ''))
  );

  return query select log_id, used_liters, remaining_cm, remaining_liters;
end;
$$;

revoke all on function public.consume_barrel_by_height(uuid, numeric, text) from public, anon;
grant execute on function public.consume_barrel_by_height(uuid, numeric, text) to authenticated;

do $$
begin
  execute 'drop trigger if exists audit_activity on public.barril_consumos';
  execute 'create trigger audit_activity after insert on public.barril_consumos for each row execute function public.log_table_activity()';
end;
$$;
