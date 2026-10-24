-- 27: caja chica y viáticos. Ejecutar después de 26.
-- Reposición/devolución mueven dinero a la caja (no son gasto). Viático/gasto salen de la caja
-- y generan automáticamente un egreso en el libro. Solo inserción: se corrige borrando (root) y recapturando.

create table if not exists public.caja_chica_movimientos (
  id uuid primary key default gen_random_uuid(),
  fecha date not null default current_date,
  tipo text not null check (tipo in ('reposicion','viatico','gasto','devolucion')),
  monto numeric(12,2) not null check (monto > 0),
  tecnico text,
  obra_id uuid references public.obras(id) on delete set null,
  categoria_id uuid references public.finanzas_categorias(id),
  concepto text,
  plaza text not null default 'Morelos',
  created_by uuid default auth.uid() references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  constraint caja_chica_viatico_tecnico_check check (tipo <> 'viatico' or nullif(trim(coalesce(tecnico, '')), '') is not null)
);
create index if not exists caja_chica_fecha_idx on public.caja_chica_movimientos (fecha desc, created_at desc);

alter table public.caja_chica_movimientos enable row level security;
revoke all on public.caja_chica_movimientos from public, anon, authenticated;
grant select, insert, delete on public.caja_chica_movimientos to authenticated;

drop policy if exists caja_chica_read on public.caja_chica_movimientos;
create policy caja_chica_read on public.caja_chica_movimientos
  for select to authenticated using (public.can_read_finance());
drop policy if exists caja_chica_insert on public.caja_chica_movimientos;
create policy caja_chica_insert on public.caja_chica_movimientos
  for insert to authenticated with check (public.can_write_finance());
drop policy if exists caja_chica_delete on public.caja_chica_movimientos;
create policy caja_chica_delete on public.caja_chica_movimientos
  for delete to authenticated using (public.is_root());

create or replace function public.caja_chica_to_ledger()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  cat uuid;
begin
  if tg_op = 'INSERT' then
    if new.tipo in ('viatico','gasto') then
      cat := new.categoria_id;
      if cat is null then
        select id into cat from public.finanzas_categorias
        where lower(nombre) = case when new.tipo = 'viatico' then 'viáticos' else 'otros egresos' end
        limit 1;
      end if;
      insert into public.movimientos_financieros
        (fecha, tipo, categoria_id, monto, concepto, plaza, metodo_pago, obra_id, origen, origen_id, created_by)
      values (new.fecha, 'egreso', cat, new.monto,
              concat_ws(' · ', case when new.tipo = 'viatico' then 'Viático' else 'Gasto de caja chica' end,
                        nullif(trim(coalesce(new.tecnico, '')), ''), nullif(trim(coalesce(new.concepto, '')), '')),
              new.plaza, 'caja_chica', new.obra_id, 'caja_chica', new.id, new.created_by);
    end if;
    return new;
  end if;

  delete from public.movimientos_financieros where origen = 'caja_chica' and origen_id = old.id;
  return old;
end;
$$;

drop trigger if exists t_caja_chica_ledger_ins on public.caja_chica_movimientos;
create trigger t_caja_chica_ledger_ins
  after insert on public.caja_chica_movimientos
  for each row execute function public.caja_chica_to_ledger();
drop trigger if exists t_caja_chica_ledger_del on public.caja_chica_movimientos;
create trigger t_caja_chica_ledger_del
  after delete on public.caja_chica_movimientos
  for each row execute function public.caja_chica_to_ledger();

create or replace view public.caja_chica_saldo
with (security_invoker = true) as
select plaza,
       sum(case when tipo in ('reposicion','devolucion') then monto else -monto end) as saldo,
       sum(case when tipo = 'reposicion' then monto else 0 end) as repuesto,
       sum(case when tipo = 'viatico' then monto else 0 end) as viaticos,
       sum(case when tipo = 'gasto' then monto else 0 end) as gastos
from public.caja_chica_movimientos
group by plaza;
grant select on public.caja_chica_saldo to authenticated;

do $$
begin
  execute 'drop trigger if exists audit_activity on public.caja_chica_movimientos';
  execute 'create trigger audit_activity after insert or update or delete on public.caja_chica_movimientos for each row execute function public.log_table_activity()';
end;
$$;
