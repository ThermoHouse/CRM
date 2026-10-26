-- 32: applications can come from closed leads or be registered as a new client.
-- Each dated application schedules recurring maintenance every 2, 3, or 4 years.
-- Execute after 31_manager_admin_lead_creation.sql.

alter table public.obras
  add column if not exists whatsapp text,
  add column if not exists email text,
  add column if not exists sistema text,
  add column if not exists intervalo_mtto_anios integer not null default 2;

alter table public.obras
  drop constraint if exists obras_intervalo_mtto_anios_check;
alter table public.obras
  add constraint obras_intervalo_mtto_anios_check
  check (intervalo_mtto_anios in (2, 3, 4));

alter table public.garantias
  add column if not exists obra_id uuid references public.obras(id) on delete cascade,
  add column if not exists intervalo_anios integer not null default 2,
  add column if not exists ultimo_mtto date;

alter table public.garantias
  drop constraint if exists garantias_intervalo_anios_check;
alter table public.garantias
  add constraint garantias_intervalo_anios_check
  check (intervalo_anios in (2, 3, 4));

-- Associate legacy maintenance records by folio without linking one record twice.
with matches as (
  select guarantee.id as guarantee_id,
         work.id as work_id,
         work.programacion,
         work.intervalo_mtto_anios,
         row_number() over (partition by guarantee.id order by work.id) as guarantee_rank,
         row_number() over (partition by work.id order by guarantee.id) as work_rank
  from public.garantias as guarantee
  join public.obras as work
    on guarantee.folio = work.folio
  where guarantee.obra_id is null
    and nullif(trim(coalesce(work.folio, '')), '') is not null
)
update public.garantias as guarantee
set obra_id = matches.work_id,
    instalacion = coalesce(matches.programacion, guarantee.instalacion),
    intervalo_anios = matches.intervalo_mtto_anios,
    proximo_mtto = coalesce(matches.programacion, guarantee.instalacion)
      + make_interval(years => matches.intervalo_mtto_anios)
from matches
where matches.guarantee_id = guarantee.id
  and matches.guarantee_rank = 1
  and matches.work_rank = 1;

-- Create a maintenance schedule for legacy applications that do not have one.
insert into public.garantias
  (obra_id, cliente, folio, sistema, instalacion, proximo_mtto, intervalo_anios, status)
select work.id, work.cliente, work.folio, work.sistema, work.programacion,
       work.programacion + make_interval(years => work.intervalo_mtto_anios),
       work.intervalo_mtto_anios, 'activa'
from public.obras as work
where work.programacion is not null
  and not exists (
    select 1 from public.garantias as guarantee where guarantee.obra_id = work.id
  );

create or replace function public.sync_application_maintenance()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  guarantee_id uuid;
begin
  if new.programacion is null then
    return new;
  end if;

  select id into guarantee_id
  from public.garantias
  where obra_id = new.id
  order by id
  limit 1
  for update;

  if guarantee_id is null then
    insert into public.garantias
      (obra_id, cliente, folio, sistema, instalacion, proximo_mtto, intervalo_anios, status)
    values
      (new.id, new.cliente, new.folio, new.sistema, new.programacion,
       new.programacion + make_interval(years => new.intervalo_mtto_anios),
       new.intervalo_mtto_anios, 'activa');
  else
    update public.garantias
    set cliente = new.cliente,
        folio = new.folio,
        sistema = new.sistema,
        instalacion = new.programacion,
        proximo_mtto = new.programacion + make_interval(years => new.intervalo_mtto_anios),
        intervalo_anios = new.intervalo_mtto_anios,
        status = 'activa'
    where id = guarantee_id;
  end if;

  return new;
end;
$$;

drop trigger if exists t_obra on public.obras;
drop trigger if exists t_sync_application_maintenance on public.obras;
create trigger t_sync_application_maintenance
  after insert or update of programacion, intervalo_mtto_anios on public.obras
  for each row
  execute function public.sync_application_maintenance();

create or replace function public.advance_application_maintenance()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.status = 'mantenimiento_hecho'
     and old.status is distinct from 'mantenimiento_hecho' then
    new.ultimo_mtto := current_date;
    new.proximo_mtto := greatest(coalesce(old.proximo_mtto, current_date), current_date)
      + make_interval(years => old.intervalo_anios);
    new.status := 'activa';
    new.revisitas := coalesce(old.revisitas, 0) + 1;
  end if;
  return new;
end;
$$;

drop trigger if exists t_advance_application_maintenance on public.garantias;
create trigger t_advance_application_maintenance
  before update of status on public.garantias
  for each row
  execute function public.advance_application_maintenance();

create or replace function public.available_closed_leads_for_application()
returns table (
  id uuid,
  folio text,
  nombre text,
  whatsapp text,
  email text,
  sistema text,
  ciudad text,
  direccion text,
  area_m2 numeric,
  asesor text,
  plaza text
)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if public.current_user_role() not in ('root', 'administrative', 'operations') then
    raise exception 'No tienes permiso para consultar leads disponibles para aplicaciones.'
      using errcode = '42501';
  end if;

  return query
  select lead.id, lead.folio, lead.nombre, lead.whatsapp, lead.email,
         coalesce(lead.sistema, lead.presentacion), lead.ciudad, lead.direccion,
         lead.area_m2, lead.asesor, lead.plaza
  from public.leads as lead
  where lead.status = 'cerrado'
    and not exists (select 1 from public.obras as work where work.lead_id = lead.id)
  order by lead.created_at desc;
end;
$$;

create or replace function public.create_application_from_closed_lead(
  p_lead_id uuid,
  p_programacion date,
  p_direccion text,
  p_intervalo_mtto_anios integer
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  lead public.leads;
  seller text;
  new_work_id uuid;
begin
  if public.current_user_role() not in ('root', 'administrative', 'operations') then
    raise exception 'No tienes permiso para crear aplicaciones.'
      using errcode = '42501';
  end if;
  if p_programacion is null then
    raise exception 'Indica la fecha de aplicación.';
  end if;
  if p_intervalo_mtto_anios is null or p_intervalo_mtto_anios not in (2, 3, 4) then
    raise exception 'El mantenimiento debe programarse cada 2, 3 o 4 años.';
  end if;

  select * into lead from public.leads where id = p_lead_id for update;
  if not found or lead.status <> 'cerrado' then
    raise exception 'Solo se pueden usar leads con venta cerrada.';
  end if;
  if exists (select 1 from public.obras where lead_id = lead.id) then
    raise exception 'Este lead ya está registrado como aplicación.';
  end if;

  seller := coalesce(
    (select nullif(trim(profile.full_name), '')
     from public.profiles as profile
     where lower(profile.email) = lower(lead.asesor)
     limit 1),
    nullif(trim(lead.asesor), '')
  );

  insert into public.obras
    (lead_id, folio, cliente, vendedor, programacion, direccion, m2, status,
     whatsapp, email, sistema, intervalo_mtto_anios)
  values
    (lead.id, lead.folio, lead.nombre, seller, p_programacion,
     coalesce(nullif(trim(p_direccion), ''), lead.direccion),
     lead.area_m2, 'por_iniciar', lead.whatsapp, lead.email,
     coalesce(lead.sistema, lead.presentacion), p_intervalo_mtto_anios)
  returning id into new_work_id;

  update public.cierres
  set status = 'cancelado',
      notas = concat_ws(E'\n', nullif(trim(notas), ''),
        'Aplicación registrada desde Instalaciones.')
  where lead_id = lead.id and status = 'pendiente';

  return new_work_id;
end;
$$;

create or replace function public.create_manual_application(
  p_cliente text,
  p_whatsapp text,
  p_email text,
  p_sistema text,
  p_vendedor text,
  p_programacion date,
  p_direccion text,
  p_m2 numeric,
  p_intervalo_mtto_anios integer
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  new_work_id uuid;
begin
  if public.current_user_role() not in ('root', 'administrative', 'operations') then
    raise exception 'No tienes permiso para crear aplicaciones.'
      using errcode = '42501';
  end if;
  if nullif(trim(coalesce(p_cliente, '')), '') is null then
    raise exception 'El nombre del cliente es obligatorio.';
  end if;
  if p_programacion is null then
    raise exception 'Indica la fecha de aplicación.';
  end if;
  if coalesce(p_m2, 0) < 0 then
    raise exception 'Los metros cuadrados no pueden ser negativos.';
  end if;
  if p_intervalo_mtto_anios is null or p_intervalo_mtto_anios not in (2, 3, 4) then
    raise exception 'El mantenimiento debe programarse cada 2, 3 o 4 años.';
  end if;

  insert into public.obras
    (folio, cliente, whatsapp, email, sistema, vendedor, programacion,
     direccion, m2, status, intervalo_mtto_anios)
  values
    ('APP-' || upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 8)),
     trim(p_cliente), nullif(trim(coalesce(p_whatsapp, '')), ''),
     nullif(trim(coalesce(p_email, '')), ''),
     nullif(trim(coalesce(p_sistema, '')), ''),
     nullif(trim(coalesce(p_vendedor, '')), ''),
     p_programacion, nullif(trim(coalesce(p_direccion, '')), ''),
     coalesce(p_m2, 0), 'por_iniciar', p_intervalo_mtto_anios)
  returning id into new_work_id;

  return new_work_id;
end;
$$;

create or replace function public.schedule_application_maintenance(
  p_garantia_id uuid,
  p_fecha date
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if public.current_user_role() not in ('root', 'administrative', 'operations') then
    raise exception 'No tienes permiso para agendar mantenimientos.'
      using errcode = '42501';
  end if;
  if p_fecha is null then
    raise exception 'Indica la fecha del mantenimiento.';
  end if;

  update public.garantias
  set proximo_mtto = p_fecha, status = 'activa'
  where id = p_garantia_id
    and (instalacion is null or p_fecha >= instalacion);
  if not found then
    if exists (select 1 from public.garantias where id = p_garantia_id) then
      raise exception 'La fecha de mantenimiento no puede ser anterior a la instalación.';
    end if;
    raise exception 'No se encontró el mantenimiento de esta aplicación.' using errcode = 'P0002';
  end if;
end;
$$;

revoke all on function public.available_closed_leads_for_application() from public, anon;
revoke all on function public.create_application_from_closed_lead(uuid, date, text, integer) from public, anon;
revoke all on function public.create_manual_application(text, text, text, text, text, date, text, numeric, integer) from public, anon;
revoke all on function public.schedule_application_maintenance(uuid, date) from public, anon;

grant execute on function public.available_closed_leads_for_application() to authenticated;
grant execute on function public.create_application_from_closed_lead(uuid, date, text, integer) to authenticated;
grant execute on function public.create_manual_application(text, text, text, text, text, date, text, numeric, integer) to authenticated;
grant execute on function public.schedule_application_maintenance(uuid, date) to authenticated;
