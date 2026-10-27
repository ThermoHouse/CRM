-- 34: Desglose de servicios profesionales (documento para el cliente).
-- Ejecutar después de 24_manager_role_and_sales_scope.sql.
-- Disponible para: root, sales (ventas), administrative y manager (gerente).
-- Opcional: el formulario y la descarga del PDF funcionan sin esta tabla;
-- la tabla solo habilita "Guardar" y la lista de desgloses guardados.

create table if not exists public.service_breakdowns (
  id uuid primary key default gen_random_uuid(),
  lead_id uuid references public.leads(id) on delete set null,
  folio text,
  cliente text,
  data jsonb not null default '{}'::jsonb,
  created_by uuid default auth.uid() references auth.users(id) on delete set null,
  created_by_email text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists service_breakdowns_lead_idx on public.service_breakdowns (lead_id);
create index if not exists service_breakdowns_created_by_idx on public.service_breakdowns (created_by);

create or replace function public.touch_service_breakdown()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists touch_service_breakdown on public.service_breakdowns;
create trigger touch_service_breakdown
  before update on public.service_breakdowns
  for each row execute function public.touch_service_breakdown();

alter table public.service_breakdowns enable row level security;

-- Lectura: root, administrativo y gerente ven todo; ventas solo lo que creó.
drop policy if exists service_breakdowns_read on public.service_breakdowns;
create policy service_breakdowns_read on public.service_breakdowns
  for select to authenticated
  using (
    public.current_user_role() in ('root','administrative','manager')
    or (public.current_user_role() = 'sales' and created_by = (select auth.uid()))
  );

-- Alta: los cuatro roles, siempre a nombre propio.
drop policy if exists service_breakdowns_insert on public.service_breakdowns;
create policy service_breakdowns_insert on public.service_breakdowns
  for insert to authenticated
  with check (
    public.current_user_role() in ('root','sales','administrative','manager')
    and created_by = (select auth.uid())
  );

-- Edición y baja: root cualquiera; los demás solo los suyos.
drop policy if exists service_breakdowns_update on public.service_breakdowns;
create policy service_breakdowns_update on public.service_breakdowns
  for update to authenticated
  using (
    public.is_root()
    or (public.current_user_role() in ('sales','administrative','manager') and created_by = (select auth.uid()))
  )
  with check (
    public.is_root()
    or (public.current_user_role() in ('sales','administrative','manager') and created_by = (select auth.uid()))
  );

drop policy if exists service_breakdowns_delete on public.service_breakdowns;
create policy service_breakdowns_delete on public.service_breakdowns
  for delete to authenticated
  using (
    public.is_root()
    or (public.current_user_role() in ('sales','administrative','manager') and created_by = (select auth.uid()))
  );

grant select, insert, update, delete on public.service_breakdowns to authenticated;
