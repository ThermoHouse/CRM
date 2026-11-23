-- 47: Control de entradas y salidas de impermeabilizante (cubetas). Ejecutar después de 46.

create table if not exists public.impermeabilizante_movimientos (
  id uuid primary key default gen_random_uuid(),
  numero integer not null check (numero > 0),
  fecha date not null default current_date,
  inventario_inicial numeric(12,2) not null default 0 check (inventario_inicial >= 0),
  entrada_cubetas numeric(12,2) not null default 0 check (entrada_cubetas >= 0),
  salida_cubetas numeric(12,2) not null default 0 check (salida_cubetas >= 0),
  inventario_final numeric(12,2) not null default 0,
  comentario text,
  created_by uuid default auth.uid() references public.profiles(id) on delete set null,
  created_at timestamptz not null default now()
);

create index if not exists impermeabilizante_movimientos_fecha_idx
  on public.impermeabilizante_movimientos (fecha desc, numero desc, created_at desc);

alter table public.impermeabilizante_movimientos enable row level security;
revoke all on public.impermeabilizante_movimientos from public, anon, authenticated;
grant select, insert, update, delete on public.impermeabilizante_movimientos to authenticated;

drop policy if exists impermeabilizante_movimientos_read on public.impermeabilizante_movimientos;
create policy impermeabilizante_movimientos_read on public.impermeabilizante_movimientos
  for select to authenticated
  using (public.current_user_role() in ('root','administrative','manager','operations'));

drop policy if exists impermeabilizante_movimientos_insert on public.impermeabilizante_movimientos;
create policy impermeabilizante_movimientos_insert on public.impermeabilizante_movimientos
  for insert to authenticated
  with check (public.current_user_role() in ('root','administrative','operations'));

drop policy if exists impermeabilizante_movimientos_update on public.impermeabilizante_movimientos;
create policy impermeabilizante_movimientos_update on public.impermeabilizante_movimientos
  for update to authenticated
  using (public.current_user_role() in ('root','administrative','operations'))
  with check (public.current_user_role() in ('root','administrative','operations'));

drop policy if exists impermeabilizante_movimientos_delete on public.impermeabilizante_movimientos;
create policy impermeabilizante_movimientos_delete on public.impermeabilizante_movimientos
  for delete to authenticated using (public.is_root() or public.current_user_role() = 'administrative');

do $$
begin
  execute 'drop trigger if exists audit_activity on public.impermeabilizante_movimientos';
  execute 'create trigger audit_activity after insert or update or delete on public.impermeabilizante_movimientos for each row execute function public.log_table_activity()';
exception when undefined_function then
  null;
end;
$$;
