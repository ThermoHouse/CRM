-- 26: corrige que "visita" y "cerrado" no llegaban a Visitas/Instalaciones.
--  - Lead en "visita"  -> se crea una visita pendiente (sin duplicar).
--  - Lead en "cerrado" -> se crea un cierre pendiente para Administrativo.
--  - Administrativo confirma el cierre (agenda + anticipo) y ENTONCES se crea la obra.
-- Ejecutar después de 25.

alter table public.visitas add column if not exists tecnico text;

create table if not exists public.cierres (
  id uuid primary key default gen_random_uuid(),
  lead_id uuid not null references public.leads(id) on delete cascade,
  status text not null default 'pendiente' check (status in ('pendiente','confirmado','cancelado')),
  anticipo_status text not null default 'pendiente' check (anticipo_status in ('pendiente','recibido','perdonado')),
  anticipo_monto numeric(12,2) check (anticipo_monto is null or anticipo_monto >= 0),
  anticipo_motivo text,
  metodo_pago text,
  fecha_instalacion date,
  direccion text,
  notas text,
  obra_id uuid references public.obras(id) on delete set null,
  confirmado_por uuid references public.profiles(id) on delete set null,
  confirmado_at timestamptz,
  created_at timestamptz not null default now(),
  constraint cierres_anticipo_recibido_check check (anticipo_status <> 'recibido' or coalesce(anticipo_monto, 0) > 0),
  constraint cierres_anticipo_perdonado_check check (anticipo_status <> 'perdonado' or nullif(trim(coalesce(anticipo_motivo, '')), '') is not null)
);
create unique index if not exists cierres_lead_activo_uq on public.cierres (lead_id) where status <> 'cancelado';
create index if not exists cierres_status_idx on public.cierres (status, created_at desc);

alter table public.cierres enable row level security;
revoke all on public.cierres from public, anon, authenticated;
grant select on public.cierres to authenticated;

-- Solo lectura directa; todo cambio pasa por las funciones de abajo.
drop policy if exists cierres_read on public.cierres;
create policy cierres_read on public.cierres
  for select to authenticated using (public.can_read_finance());

-- Cambia el estado del lead -> crea visita o cierre.
create or replace function public.sync_lead_workflow()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  place text;
begin
  if tg_op = 'UPDATE' then
    if new.status is not distinct from old.status then
      return new;
    end if;
  end if;

  place := nullif(concat_ws(', ', nullif(trim(new.direccion), ''), nullif(trim(new.ciudad), '')), '');

  if new.status = 'visita' then
    if not exists (select 1 from public.visitas v where v.lead_id = new.id and v.status = 'por_visitar') then
      insert into public.visitas (lead_id, cliente, ubicacion, programacion, status, tecnico)
      values (
        new.id, new.nombre, place, new.appointment_at, 'por_visitar',
        coalesce(
          (select nullif(trim(p.full_name), '') from public.profiles p where lower(p.email) = lower(new.asesor) limit 1),
          nullif(trim(new.asesor), '')
        )
      );
    end if;
  elsif new.status = 'cerrado' then
    if not exists (select 1 from public.cierres c where c.lead_id = new.id and c.status <> 'cancelado') then
      insert into public.cierres (lead_id, direccion) values (new.id, place);
    end if;
  end if;

  return new;
end;
$$;

drop trigger if exists t_sync_lead_workflow on public.leads;
create trigger t_sync_lead_workflow
  after insert or update of status on public.leads
  for each row execute function public.sync_lead_workflow();

-- Administrativo confirma agenda + anticipo y se crea la obra.
create or replace function public.confirm_closing(
  p_cierre_id uuid,
  p_anticipo_status text,
  p_anticipo_monto numeric,
  p_anticipo_motivo text,
  p_metodo_pago text,
  p_fecha_instalacion date,
  p_direccion text,
  p_notas text
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  c public.cierres;
  l public.leads;
  new_obra uuid;
  seller text;
  cat uuid;
begin
  if public.current_user_role() not in ('root','administrative') then
    raise exception 'Solo Administrativo puede confirmar cierres.' using errcode = '42501';
  end if;

  select * into c from public.cierres where id = p_cierre_id for update;
  if not found then
    raise exception 'Cierre no encontrado.' using errcode = 'P0002';
  end if;
  if c.status <> 'pendiente' then
    raise exception 'Este cierre ya está %.', c.status;
  end if;
  if p_anticipo_status not in ('pendiente','recibido','perdonado') then
    raise exception 'Estado de anticipo no válido.';
  end if;
  if p_anticipo_status = 'recibido' and coalesce(p_anticipo_monto, 0) <= 0 then
    raise exception 'Captura el monto del anticipo recibido.';
  end if;
  if p_anticipo_status = 'perdonado' and nullif(trim(coalesce(p_anticipo_motivo, '')), '') is null then
    raise exception 'Indica el motivo por el que se perdona el anticipo.';
  end if;
  if p_fecha_instalacion is null then
    raise exception 'Confirma la fecha de la agenda.';
  end if;

  select * into l from public.leads where id = c.lead_id;
  seller := coalesce(
    (select nullif(trim(p.full_name), '') from public.profiles p where lower(p.email) = lower(l.asesor) limit 1),
    nullif(trim(l.asesor), '')
  );

  insert into public.obras (lead_id, folio, cliente, programacion, direccion, m2, status, vendedor)
  values (l.id, l.folio, l.nombre, p_fecha_instalacion,
          coalesce(nullif(trim(p_direccion), ''), c.direccion), l.area_m2, 'por_iniciar', seller)
  returning id into new_obra;

  update public.cierres
  set status = 'confirmado',
      anticipo_status = p_anticipo_status,
      anticipo_monto = case when p_anticipo_status = 'recibido' then p_anticipo_monto else null end,
      anticipo_motivo = case when p_anticipo_status = 'perdonado' then trim(p_anticipo_motivo) else null end,
      metodo_pago = nullif(trim(coalesce(p_metodo_pago, '')), ''),
      fecha_instalacion = p_fecha_instalacion,
      direccion = coalesce(nullif(trim(p_direccion), ''), c.direccion),
      notas = nullif(trim(coalesce(p_notas, '')), ''),
      obra_id = new_obra,
      confirmado_por = auth.uid(),
      confirmado_at = now()
  where id = c.id;

  if p_anticipo_status = 'recibido' then
    select id into cat from public.finanzas_categorias where lower(nombre) = 'anticipo de cliente' limit 1;
    insert into public.movimientos_financieros
      (fecha, tipo, categoria_id, monto, concepto, plaza, metodo_pago, lead_id, obra_id, origen, origen_id)
    values (current_date, 'ingreso', cat, p_anticipo_monto, 'Anticipo · ' || coalesce(l.nombre, 'cliente'),
            coalesce(l.plaza, 'Morelos'),
            case when p_metodo_pago in ('efectivo','transferencia','tarjeta','cheque','otro') then p_metodo_pago else null end,
            l.id, new_obra, 'anticipo', c.id);
  end if;

  return new_obra;
end;
$$;

create or replace function public.cancel_closing(p_cierre_id uuid, p_motivo text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if public.current_user_role() not in ('root','administrative') then
    raise exception 'Solo Administrativo puede cancelar cierres.' using errcode = '42501';
  end if;
  update public.cierres
  set status = 'cancelado', notas = nullif(trim(coalesce(p_motivo, '')), ''),
      confirmado_por = auth.uid(), confirmado_at = now()
  where id = p_cierre_id and status = 'pendiente';
  if not found then
    raise exception 'No hay un cierre pendiente con ese identificador.' using errcode = 'P0002';
  end if;
end;
$$;

revoke all on function public.confirm_closing(uuid, text, numeric, text, text, date, text, text) from public, anon;
revoke all on function public.cancel_closing(uuid, text) from public, anon;
grant execute on function public.confirm_closing(uuid, text, numeric, text, text, date, text, text) to authenticated;
grant execute on function public.cancel_closing(uuid, text) to authenticated;

-- Administrativo coordina la agenda con instalaciones: puede editar visitas y obras.
create or replace function public.can_write_table(table_name text)
returns boolean
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  user_role text := public.current_user_role();
begin
  if user_role = 'root' then
    return true;
  end if;

  case table_name
    when 'leads' then return user_role = 'sales';
    when 'bot_inbox' then return user_role = 'sales';
    when 'visitas' then return user_role in ('operations','administrative');
    when 'obras' then return user_role in ('operations','administrative');
    when 'garantias' then return user_role = 'operations';
    when 'barriles' then return user_role in ('operations','administrative');
    when 'inventory_movements' then return user_role in ('operations','administrative');
    when 'productos' then return user_role = 'administrative';
    when 'tarifas' then return user_role = 'administrative';
    else return false;
  end case;
end;
$$;

create or replace function public.complete_visit(visit_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if public.current_user_role() not in ('root','operations','administrative') then
    raise exception 'Insufficient role to complete a visit' using errcode = '42501';
  end if;
  update public.visitas set status = 'realizada' where id = visit_id;
  if not found then
    raise exception 'Visit not found' using errcode = 'P0002';
  end if;
end;
$$;

do $$
begin
  execute 'drop trigger if exists audit_activity on public.cierres';
  execute 'create trigger audit_activity after insert or update or delete on public.cierres for each row execute function public.log_table_activity()';
end;
$$;

-- Recupera lo que ya estaba en esos estados (corre una sola vez; es seguro repetirlo).
insert into public.visitas (lead_id, cliente, ubicacion, programacion, status, tecnico)
select l.id, l.nombre,
       nullif(concat_ws(', ', nullif(trim(l.direccion), ''), nullif(trim(l.ciudad), '')), ''),
       l.appointment_at, 'por_visitar',
       coalesce((select nullif(trim(p.full_name), '') from public.profiles p where lower(p.email) = lower(l.asesor) limit 1),
                nullif(trim(l.asesor), ''))
from public.leads l
where l.status = 'visita'
  and not exists (select 1 from public.visitas v where v.lead_id = l.id);

insert into public.cierres (lead_id, direccion)
select l.id, nullif(concat_ws(', ', nullif(trim(l.direccion), ''), nullif(trim(l.ciudad), '')), '')
from public.leads l
where l.status = 'cerrado'
  and not exists (select 1 from public.obras o where o.lead_id = l.id)
  and not exists (select 1 from public.cierres c where c.lead_id = l.id);
