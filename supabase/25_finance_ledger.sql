-- 25: libro de ingresos y egresos con categorías libres. Ejecutar después de 24.

create or replace function public.can_read_finance()
returns boolean language sql stable security definer set search_path = ''
as $$ select coalesce(public.current_user_role() in ('root','administrative','manager'), false); $$;

create or replace function public.can_write_finance()
returns boolean language sql stable security definer set search_path = ''
as $$ select coalesce(public.current_user_role() in ('root','administrative'), false); $$;

grant execute on function public.can_read_finance() to authenticated;
grant execute on function public.can_write_finance() to authenticated;

create table if not exists public.finanzas_categorias (
  id uuid primary key default gen_random_uuid(),
  nombre text not null check (length(trim(nombre)) > 0),
  tipo text not null check (tipo in ('ingreso','egreso')),
  naturaleza text not null default 'variable' check (naturaleza in ('fijo','variable')),
  activa boolean not null default true,
  created_at timestamptz not null default now()
);
create unique index if not exists finanzas_categorias_nombre_uq
  on public.finanzas_categorias (lower(trim(nombre)));

insert into public.finanzas_categorias (nombre, tipo, naturaleza) values
  ('Anticipo de cliente','ingreso','variable'),
  ('Pago de obra','ingreso','variable'),
  ('Otros ingresos','ingreso','variable'),
  ('Material (isocianato / poliol)','egreso','variable'),
  ('Viáticos','egreso','variable'),
  ('EPP','egreso','variable'),
  ('Herramientas','egreso','variable'),
  ('Combustible','egreso','variable'),
  ('Renta','egreso','fijo'),
  ('Nómina','egreso','fijo'),
  ('Servicios (luz, agua, internet)','egreso','fijo'),
  ('Otros egresos','egreso','variable')
on conflict do nothing;

create table if not exists public.movimientos_financieros (
  id uuid primary key default gen_random_uuid(),
  fecha date not null default current_date,
  tipo text not null check (tipo in ('ingreso','egreso')),
  categoria_id uuid not null references public.finanzas_categorias(id),
  monto numeric(12,2) not null check (monto > 0),
  concepto text,
  plaza text not null default 'Morelos',
  metodo_pago text check (metodo_pago is null or metodo_pago in ('efectivo','transferencia','tarjeta','cheque','caja_chica','otro')),
  lead_id uuid references public.leads(id) on delete set null,
  obra_id uuid references public.obras(id) on delete set null,
  comprobante_path text,
  origen text not null default 'manual' check (origen in ('manual','anticipo','caja_chica')),
  origen_id uuid,
  created_by uuid default auth.uid() references public.profiles(id) on delete set null,
  created_at timestamptz not null default now()
);
create unique index if not exists movimientos_financieros_origen_uq
  on public.movimientos_financieros (origen, origen_id) where origen_id is not null;
create index if not exists movimientos_financieros_fecha_idx on public.movimientos_financieros (fecha desc);

-- La categoría debe coincidir con el tipo del movimiento.
create or replace function public.check_movimiento_categoria()
returns trigger language plpgsql security definer set search_path = ''
as $$
declare cat_tipo text;
begin
  select tipo into cat_tipo from public.finanzas_categorias where id = new.categoria_id;
  if cat_tipo is distinct from new.tipo then
    raise exception 'La categoría elegida no es de tipo %.', new.tipo using errcode = '23514';
  end if;
  return new;
end;
$$;
drop trigger if exists t_check_movimiento_categoria on public.movimientos_financieros;
create trigger t_check_movimiento_categoria
  before insert or update of tipo, categoria_id on public.movimientos_financieros
  for each row execute function public.check_movimiento_categoria();

alter table public.finanzas_categorias enable row level security;
alter table public.movimientos_financieros enable row level security;
revoke all on public.finanzas_categorias, public.movimientos_financieros from public, anon, authenticated;
grant select, insert, update, delete on public.finanzas_categorias, public.movimientos_financieros to authenticated;

drop policy if exists finanzas_categorias_read on public.finanzas_categorias;
create policy finanzas_categorias_read on public.finanzas_categorias
  for select to authenticated using (public.can_read_finance());
drop policy if exists finanzas_categorias_insert on public.finanzas_categorias;
create policy finanzas_categorias_insert on public.finanzas_categorias
  for insert to authenticated with check (public.can_write_finance());
drop policy if exists finanzas_categorias_update on public.finanzas_categorias;
create policy finanzas_categorias_update on public.finanzas_categorias
  for update to authenticated using (public.can_write_finance()) with check (public.can_write_finance());
drop policy if exists finanzas_categorias_delete on public.finanzas_categorias;
create policy finanzas_categorias_delete on public.finanzas_categorias
  for delete to authenticated using (public.is_root());

drop policy if exists movimientos_financieros_read on public.movimientos_financieros;
create policy movimientos_financieros_read on public.movimientos_financieros
  for select to authenticated using (public.can_read_finance());
drop policy if exists movimientos_financieros_insert on public.movimientos_financieros;
create policy movimientos_financieros_insert on public.movimientos_financieros
  for insert to authenticated with check (public.can_write_finance() and origen = 'manual');
-- Los movimientos automáticos (anticipo, caja chica) solo los edita root.
drop policy if exists movimientos_financieros_update on public.movimientos_financieros;
create policy movimientos_financieros_update on public.movimientos_financieros
  for update to authenticated
  using (public.can_write_finance() and (origen = 'manual' or public.is_root()))
  with check (public.can_write_finance());
drop policy if exists movimientos_financieros_delete on public.movimientos_financieros;
create policy movimientos_financieros_delete on public.movimientos_financieros
  for delete to authenticated using (public.is_root());

-- Comprobantes (opcionales): bucket privado.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('comprobantes', 'comprobantes', false, 8388608, array['image/jpeg','image/png','image/webp','application/pdf'])
on conflict (id) do update
set public = false,
    file_size_limit = excluded.file_size_limit,
    allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists comprobantes_read on storage.objects;
create policy comprobantes_read on storage.objects
  for select to authenticated
  using (bucket_id = 'comprobantes' and public.can_read_finance());
drop policy if exists comprobantes_insert on storage.objects;
create policy comprobantes_insert on storage.objects
  for insert to authenticated
  with check (bucket_id = 'comprobantes' and public.can_write_finance());
drop policy if exists comprobantes_delete on storage.objects;
create policy comprobantes_delete on storage.objects
  for delete to authenticated
  using (bucket_id = 'comprobantes' and public.is_root());

do $$
declare t text;
begin
  foreach t in array array['finanzas_categorias','movimientos_financieros'] loop
    execute format('drop trigger if exists audit_activity on public.%I', t);
    execute format('create trigger audit_activity after insert or update or delete on public.%I for each row execute function public.log_table_activity()', t);
  end loop;
end;
$$;
