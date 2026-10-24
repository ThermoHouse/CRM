-- 29: EPP, herramientas y consumibles con cantidad y mínimo. Ejecutar después de 28.

create table if not exists public.articulos_inventario (
  id uuid primary key default gen_random_uuid(),
  nombre text not null check (length(trim(nombre)) > 0),
  tipo text not null default 'epp' check (tipo in ('epp','herramienta','consumible','otro')),
  unidad text default 'pieza',
  cantidad numeric not null default 0 check (cantidad >= 0),
  minimo numeric not null default 0 check (minimo >= 0),
  plaza text not null default 'Morelos',
  notas text,
  created_at timestamptz not null default now()
);

alter table public.articulos_inventario enable row level security;
revoke all on public.articulos_inventario from public, anon, authenticated;
grant select, insert, update, delete on public.articulos_inventario to authenticated;

drop policy if exists articulos_inventario_read on public.articulos_inventario;
create policy articulos_inventario_read on public.articulos_inventario
  for select to authenticated
  using (public.current_user_role() in ('root','administrative','manager','operations'));
drop policy if exists articulos_inventario_insert on public.articulos_inventario;
create policy articulos_inventario_insert on public.articulos_inventario
  for insert to authenticated with check (public.current_user_role() in ('root','administrative'));
drop policy if exists articulos_inventario_update on public.articulos_inventario;
create policy articulos_inventario_update on public.articulos_inventario
  for update to authenticated
  using (public.current_user_role() in ('root','administrative'))
  with check (public.current_user_role() in ('root','administrative'));
drop policy if exists articulos_inventario_delete on public.articulos_inventario;
create policy articulos_inventario_delete on public.articulos_inventario
  for delete to authenticated using (public.is_root());

do $$
begin
  execute 'drop trigger if exists audit_activity on public.articulos_inventario';
  execute 'create trigger audit_activity after insert or update or delete on public.articulos_inventario for each row execute function public.log_table_activity()';
end;
$$;
