-- 28: stock por medición. El técnico mete la regla al barril y captura la altura (cm);
-- el sistema la convierte a litros con la capacidad y altura de ese barril. Ejecutar después de 27.

alter table public.barriles
  add column if not exists capacidad_litros numeric default 200 check (capacidad_litros is null or capacidad_litros > 0),
  add column if not exists altura_total_cm numeric default 100 check (altura_total_cm is null or altura_total_cm > 0),
  add column if not exists nivel_cm numeric,
  add column if not exists nivel_litros numeric,
  add column if not exists medido_at timestamptz;

create table if not exists public.barril_mediciones (
  id uuid primary key default gen_random_uuid(),
  barril_id uuid not null references public.barriles(id) on delete cascade,
  altura_cm numeric not null check (altura_cm >= 0),
  litros numeric,
  nota text,
  medido_por uuid default auth.uid() references public.profiles(id) on delete set null,
  medido_at timestamptz not null default now()
);
create index if not exists barril_mediciones_barril_idx on public.barril_mediciones (barril_id, medido_at desc);

alter table public.barril_mediciones enable row level security;
revoke all on public.barril_mediciones from public, anon, authenticated;
grant select, insert on public.barril_mediciones to authenticated;

drop policy if exists barril_mediciones_read on public.barril_mediciones;
create policy barril_mediciones_read on public.barril_mediciones
  for select to authenticated using (public.can_read_table('barriles'));
drop policy if exists barril_mediciones_insert on public.barril_mediciones;
create policy barril_mediciones_insert on public.barril_mediciones
  for insert to authenticated with check (public.can_write_table('barriles'));

create or replace function public.apply_barrel_measurement()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  total_cm numeric;
  capacity numeric;
begin
  select coalesce(altura_total_cm, 100), coalesce(capacidad_litros, 200)
  into total_cm, capacity
  from public.barriles where id = new.barril_id;

  if not found then
    raise exception 'Barril no encontrado.' using errcode = 'P0002';
  end if;
  if new.altura_cm > total_cm then
    raise exception 'La altura medida (% cm) supera la altura del barril (% cm).', new.altura_cm, total_cm
      using errcode = '23514';
  end if;

  new.litros := round(new.altura_cm / total_cm * capacity, 1);
  return new;
end;
$$;

create or replace function public.update_barrel_level()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.barriles
  set nivel_cm = new.altura_cm,
      nivel_litros = new.litros,
      medido_at = new.medido_at,
      estado = case when new.altura_cm = 0 then 'vacío'
                    when estado = 'cerrado' then 'abierto'
                    else estado end
  where id = new.barril_id;
  return new;
end;
$$;

drop trigger if exists t_apply_barrel_measurement on public.barril_mediciones;
create trigger t_apply_barrel_measurement
  before insert on public.barril_mediciones
  for each row execute function public.apply_barrel_measurement();
drop trigger if exists t_update_barrel_level on public.barril_mediciones;
create trigger t_update_barrel_level
  after insert on public.barril_mediciones
  for each row execute function public.update_barrel_level();

-- Mínimo de litros por material para avisar cuándo comprar (0 = sin aviso; configúralo).
create table if not exists public.stock_minimos (
  tipo text primary key check (tipo in ('isocianato','poliol')),
  minimo_litros numeric not null default 0 check (minimo_litros >= 0)
);
insert into public.stock_minimos (tipo, minimo_litros) values ('isocianato', 0), ('poliol', 0)
on conflict do nothing;

alter table public.stock_minimos enable row level security;
revoke all on public.stock_minimos from public, anon, authenticated;
grant select, update on public.stock_minimos to authenticated;
drop policy if exists stock_minimos_read on public.stock_minimos;
create policy stock_minimos_read on public.stock_minimos
  for select to authenticated using (public.can_read_table('barriles'));
drop policy if exists stock_minimos_update on public.stock_minimos;
create policy stock_minimos_update on public.stock_minimos
  for update to authenticated
  using (public.current_user_role() in ('root','administrative'))
  with check (public.current_user_role() in ('root','administrative'));

-- Cerrado = capacidad completa; abierto = último nivel medido; abierto sin medir = 0 y se cuenta aparte.
create or replace view public.stock_resumen
with (security_invoker = true) as
select b.plaza,
       b.tipo,
       count(*) filter (where b.estado <> 'vacío') as barriles_activos,
       count(*) filter (where b.estado = 'abierto' and b.nivel_litros is null) as sin_medir,
       coalesce(sum(case
         when b.estado = 'cerrado' then coalesce(b.capacidad_litros, 200)
         when b.estado = 'abierto' then coalesce(b.nivel_litros, 0)
         else 0 end), 0) as litros_estimados,
       coalesce(max(m.minimo_litros), 0) as minimo_litros
from public.barriles b
left join public.stock_minimos m on m.tipo = b.tipo
group by b.plaza, b.tipo;
grant select on public.stock_resumen to authenticated;

do $$
declare t text;
begin
  foreach t in array array['barril_mediciones','stock_minimos'] loop
    execute format('drop trigger if exists audit_activity on public.%I', t);
    execute format('create trigger audit_activity after insert or update or delete on public.%I for each row execute function public.log_table_activity()', t);
  end loop;
end;
$$;
