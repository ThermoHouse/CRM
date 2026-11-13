-- Corrections to financial movements are submitted by Administrative and
-- resolved transactionally by Manager or Root.

alter table public.movimientos_financieros
  add column if not exists voided_at timestamptz,
  add column if not exists voided_by uuid references public.profiles(id) on delete set null;

alter table public.caja_chica_movimientos
  add column if not exists voided_at timestamptz,
  add column if not exists voided_by uuid references public.profiles(id) on delete set null;

create table if not exists public.finance_change_requests (
  id uuid primary key default gen_random_uuid(),
  source_table text not null check (source_table in ('movimientos_financieros','caja_chica_movimientos')),
  source_id uuid not null,
  action text not null check (action in ('update','delete')),
  reason text not null check (length(trim(reason)) between 1 and 500),
  before_data jsonb not null,
  proposed_data jsonb,
  status text not null default 'pending' check (status in ('pending','approved','rejected')),
  requested_by uuid not null default auth.uid() references public.profiles(id) on delete restrict,
  created_at timestamptz not null default now(),
  reviewed_by uuid references public.profiles(id) on delete set null,
  reviewed_at timestamptz,
  resolution_note text,
  constraint finance_change_request_proposal_check check (
    (action = 'update' and proposed_data is not null)
    or (action = 'delete' and proposed_data is null)
  )
);

create unique index if not exists finance_change_requests_one_pending_per_record
  on public.finance_change_requests (source_table, source_id)
  where status = 'pending';
create index if not exists finance_change_requests_status_created_idx
  on public.finance_change_requests (status, created_at desc);

alter table public.finance_change_requests enable row level security;
revoke all on public.finance_change_requests from public, anon, authenticated;

create or replace function public.finance_change_is_pending(p_source_table text, p_source_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.finance_change_requests r
    where r.source_table = p_source_table
      and r.source_id = p_source_id
      and r.status = 'pending'
  );
$$;
revoke all on function public.finance_change_is_pending(text, uuid) from public, anon;
grant execute on function public.finance_change_is_pending(text, uuid) to authenticated;

create or replace view public.movimientos_financieros_vigentes
with (security_invoker = true) as
select m.*
from public.movimientos_financieros m
where m.voided_at is null
  and not public.finance_change_is_pending('movimientos_financieros', m.id)
  and (
    m.origen <> 'caja_chica'
    or not public.finance_change_is_pending('caja_chica_movimientos', m.origen_id)
  );
grant select on public.movimientos_financieros_vigentes to authenticated;

create or replace view public.caja_chica_movimientos_vigentes
with (security_invoker = true) as
select c.*
from public.caja_chica_movimientos c
where c.voided_at is null
  and not public.finance_change_is_pending('caja_chica_movimientos', c.id);
grant select on public.caja_chica_movimientos_vigentes to authenticated;

create or replace view public.caja_chica_saldo
with (security_invoker = true) as
select plaza,
       sum(case when tipo in ('reposicion','devolucion') then monto else -monto end) as saldo,
       sum(case when tipo = 'reposicion' then monto else 0 end) as repuesto,
       sum(case when tipo = 'viatico' then monto else 0 end) as viaticos,
       sum(case when tipo = 'gasto' then monto else 0 end) as gastos
from public.caja_chica_movimientos c
where c.voided_at is null
  and not public.finance_change_is_pending('caja_chica_movimientos', c.id)
group by plaza;
grant select on public.caja_chica_saldo to authenticated;

create or replace view public.finanzas_resumen_mensual
with (security_invoker = true) as
select date_trunc('month', m.fecha)::date as mes,
       m.plaza,
       m.tipo,
       c.nombre as categoria,
       c.naturaleza,
       sum(m.monto) as total,
       count(*) as movimientos
from public.movimientos_financieros_vigentes m
join public.finanzas_categorias c on c.id = m.categoria_id
group by 1, 2, 3, 4, 5;
grant select on public.finanzas_resumen_mensual to authenticated;

create or replace function public.submit_finance_change_request(
  p_source_table text,
  p_source_id uuid,
  p_action text,
  p_reason text,
  p_proposed_data jsonb default null
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_before jsonb;
  v_request_id uuid;
begin
  if public.current_user_role() <> 'administrative' then
    raise exception 'Solo Administrativo puede enviar solicitudes de corrección.';
  end if;
  if p_action is null or p_action not in ('update','delete') or length(trim(coalesce(p_reason,''))) = 0 then
    raise exception 'Indica una acción y el motivo de la solicitud.';
  end if;

  if p_source_table = 'movimientos_financieros' then
    select jsonb_build_object(
      'fecha', m.fecha, 'tipo', m.tipo, 'categoria_id', m.categoria_id,
      'monto', m.monto, 'concepto', m.concepto, 'plaza', m.plaza,
      'metodo_pago', m.metodo_pago
    )
    into v_before
    from public.movimientos_financieros m
    where m.id = p_source_id and m.origen = 'manual' and m.voided_at is null
    for update;
  elsif p_source_table = 'caja_chica_movimientos' then
    select jsonb_build_object(
      'fecha', c.fecha, 'tipo', c.tipo, 'monto', c.monto, 'tecnico', c.tecnico,
      'obra_id', c.obra_id, 'categoria_id', c.categoria_id,
      'concepto', c.concepto, 'plaza', c.plaza
    )
    into v_before
    from public.caja_chica_movimientos c
    where c.id = p_source_id and c.voided_at is null
    for update;
  else
    raise exception 'Tipo de movimiento no válido.';
  end if;

  if v_before is null then
    raise exception 'El movimiento ya no existe o no puede solicitarse.';
  end if;
  if p_action = 'update' and jsonb_typeof(p_proposed_data) <> 'object' then
    raise exception 'La propuesta de corrección no es válida.';
  end if;
  if p_action = 'delete' and p_proposed_data is not null then
    raise exception 'Una solicitud de eliminación no debe incluir cambios.';
  end if;

  if p_action = 'update' and p_source_table = 'movimientos_financieros'
     and (p_proposed_data - array['fecha','tipo','categoria_id','monto','concepto','plaza','metodo_pago']::text[]) <> '{}'::jsonb then
    raise exception 'La propuesta contiene campos no permitidos.';
  end if;
  if p_action = 'update' and p_source_table = 'caja_chica_movimientos'
     and (p_proposed_data - array['fecha','tipo','monto','tecnico','obra_id','categoria_id','concepto','plaza']::text[]) <> '{}'::jsonb then
    raise exception 'La propuesta contiene campos no permitidos.';
  end if;
  if p_action = 'update' and p_source_table = 'movimientos_financieros'
     and (p_proposed_data->>'fecha' is null or p_proposed_data->>'tipo' not in ('ingreso','egreso')
       or p_proposed_data->>'categoria_id' is null
       or coalesce((p_proposed_data->>'monto')::numeric,0) <= 0
       or p_proposed_data->>'plaza' is null) then
    raise exception 'Completa fecha, tipo, categoría, monto y plaza válidos.';
  end if;
  if p_action = 'update' and p_source_table = 'caja_chica_movimientos'
     and (p_proposed_data->>'fecha' is null
       or p_proposed_data->>'tipo' not in ('reposicion','viatico','gasto','devolucion')
       or coalesce((p_proposed_data->>'monto')::numeric,0) <= 0
       or p_proposed_data->>'plaza' is null
       or (p_proposed_data->>'tipo' = 'viatico' and length(trim(coalesce(p_proposed_data->>'tecnico',''))) = 0)) then
    raise exception 'Completa fecha, tipo, monto, plaza y técnico válidos.';
  end if;

  insert into public.finance_change_requests
    (source_table, source_id, action, reason, before_data, proposed_data)
  values
    (p_source_table, p_source_id, p_action, trim(p_reason), v_before,
     case when p_action = 'update' then p_proposed_data else null end)
  returning id into v_request_id;
  return v_request_id;
end;
$$;
revoke all on function public.submit_finance_change_request(text, uuid, text, text, jsonb) from public, anon;
grant execute on function public.submit_finance_change_request(text, uuid, text, text, jsonb) to authenticated;

create or replace function public.list_finance_change_requests(p_status text default null)
returns table (
  id uuid,
  source_table text,
  source_id uuid,
  action text,
  reason text,
  before_data jsonb,
  proposed_data jsonb,
  status text,
  requested_by uuid,
  requester_name text,
  created_at timestamptz,
  reviewed_by uuid,
  reviewer_name text,
  reviewed_at timestamptz,
  resolution_note text
)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_role text := public.current_user_role();
begin
  if v_role not in ('administrative','manager','root') then
    raise exception 'No tienes permiso para consultar solicitudes financieras.';
  end if;
  return query
  select r.id, r.source_table, r.source_id, r.action, r.reason,
         r.before_data, r.proposed_data, r.status, r.requested_by,
         coalesce(requester.full_name, requester.email, 'Usuario'),
         r.created_at, r.reviewed_by,
         coalesce(reviewer.full_name, reviewer.email, ''),
         r.reviewed_at, r.resolution_note
  from public.finance_change_requests r
  left join public.profiles requester on requester.id = r.requested_by
  left join public.profiles reviewer on reviewer.id = r.reviewed_by
  where (v_role <> 'administrative' or r.requested_by = auth.uid())
    and (p_status is null or r.status = p_status)
  order by (r.status = 'pending') desc, r.created_at desc;
end;
$$;
revoke all on function public.list_finance_change_requests(text) from public, anon;
grant execute on function public.list_finance_change_requests(text) to authenticated;

create or replace function public.resolve_finance_change_requests(
  p_request_ids uuid[],
  p_decision text,
  p_overrides jsonb default '{}'::jsonb
)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_request public.finance_change_requests%rowtype;
  v_live jsonb;
  v_data jsonb;
  v_processed integer := 0;
  v_count integer;
begin
  if public.current_user_role() not in ('manager','root') then
    raise exception 'Solo Gerente o Root puede resolver solicitudes.';
  end if;
  if p_decision is null or p_decision not in ('approve','reject') or coalesce(cardinality(p_request_ids),0) = 0 then
    raise exception 'Selecciona solicitudes y una decisión válida.';
  end if;
  if exists (
    select 1 from unnest(p_request_ids) as ids(id)
    group by ids.id having count(*) > 1
  ) then
    raise exception 'La selección contiene solicitudes duplicadas.';
  end if;
  select count(*) into v_count
  from public.finance_change_requests r
  where r.id = any(p_request_ids) and r.status = 'pending';
  if v_count <> cardinality(p_request_ids) then
    raise exception 'Una o más solicitudes ya fueron resueltas o no existen; no se aplicó ningún cambio.';
  end if;

  for v_request in
    select r.* from public.finance_change_requests r
    where r.id = any(p_request_ids) and r.status = 'pending'
    order by r.created_at
    for update
  loop
    if p_decision = 'approve' then
      if v_request.source_table = 'movimientos_financieros' then
        select jsonb_build_object(
          'fecha', m.fecha, 'tipo', m.tipo, 'categoria_id', m.categoria_id,
          'monto', m.monto, 'concepto', m.concepto, 'plaza', m.plaza,
          'metodo_pago', m.metodo_pago
        )
        into v_live
        from public.movimientos_financieros m
        where m.id = v_request.source_id and m.origen = 'manual' and m.voided_at is null
        for update;
      else
        select jsonb_build_object(
          'fecha', c.fecha, 'tipo', c.tipo, 'monto', c.monto, 'tecnico', c.tecnico,
          'obra_id', c.obra_id, 'categoria_id', c.categoria_id,
          'concepto', c.concepto, 'plaza', c.plaza
        )
        into v_live
        from public.caja_chica_movimientos c
        where c.id = v_request.source_id and c.voided_at is null
        for update;
      end if;
      if v_live is distinct from v_request.before_data then
        raise exception 'El movimiento % cambió después de la solicitud. No se aplicó ningún cambio.', v_request.source_id;
      end if;

      if v_request.action = 'delete' then
        if v_request.source_table = 'movimientos_financieros' then
          update public.movimientos_financieros
          set voided_at = now(), voided_by = auth.uid()
          where id = v_request.source_id;
        else
          update public.caja_chica_movimientos
          set voided_at = now(), voided_by = auth.uid()
          where id = v_request.source_id;
        end if;
      elsif v_request.source_table = 'movimientos_financieros' then
        v_data := coalesce(p_overrides -> (v_request.id::text), v_request.proposed_data);
        if jsonb_typeof(v_data) <> 'object'
          or (v_data - array['fecha','tipo','categoria_id','monto','concepto','plaza','metodo_pago']::text[]) <> '{}'::jsonb
          or v_data->>'fecha' is null
          or v_data->>'tipo' not in ('ingreso','egreso')
          or v_data->>'categoria_id' is null
          or coalesce((v_data->>'monto')::numeric,0) <= 0
          or v_data->>'plaza' is null then
          raise exception 'La propuesta final para el movimiento % no es válida.', v_request.source_id;
        end if;
        update public.movimientos_financieros
        set fecha = (v_data->>'fecha')::date,
            tipo = v_data->>'tipo',
            categoria_id = (v_data->>'categoria_id')::uuid,
            monto = (v_data->>'monto')::numeric,
            concepto = v_data->>'concepto',
            plaza = v_data->>'plaza',
            metodo_pago = nullif(v_data->>'metodo_pago','')
        where id = v_request.source_id;
      else
        v_data := coalesce(p_overrides -> (v_request.id::text), v_request.proposed_data);
        if jsonb_typeof(v_data) <> 'object'
          or (v_data - array['fecha','tipo','monto','tecnico','obra_id','categoria_id','concepto','plaza']::text[]) <> '{}'::jsonb
          or v_data->>'fecha' is null
          or v_data->>'tipo' not in ('reposicion','viatico','gasto','devolucion')
          or coalesce((v_data->>'monto')::numeric,0) <= 0
          or v_data->>'plaza' is null
          or (v_data->>'tipo' = 'viatico' and length(trim(coalesce(v_data->>'tecnico',''))) = 0) then
          raise exception 'La propuesta final para el movimiento % no es válida.', v_request.source_id;
        end if;
        update public.caja_chica_movimientos
        set fecha = (v_data->>'fecha')::date,
            tipo = v_data->>'tipo',
            monto = (v_data->>'monto')::numeric,
            tecnico = v_data->>'tecnico',
            obra_id = nullif(v_data->>'obra_id','')::uuid,
            categoria_id = nullif(v_data->>'categoria_id','')::uuid,
            concepto = v_data->>'concepto',
            plaza = v_data->>'plaza'
        where id = v_request.source_id;
      end if;
    end if;

    update public.finance_change_requests
    set status = case when p_decision = 'approve' then 'approved' else 'rejected' end,
        reviewed_by = auth.uid(),
        reviewed_at = now()
    where id = v_request.id;
    v_processed := v_processed + 1;
  end loop;
  if v_processed <> cardinality(p_request_ids) then
    raise exception 'Una o más solicitudes cambiaron mientras se revisaban; no se aplicó ningún cambio.';
  end if;
  return v_processed;
end;
$$;
revoke all on function public.resolve_finance_change_requests(uuid[], text, jsonb) from public, anon;
grant execute on function public.resolve_finance_change_requests(uuid[], text, jsonb) to authenticated;

-- Administrative can only propose ledger changes; approved changes run through
-- the definer RPC above. Root keeps the existing direct management capability.
drop policy if exists movimientos_financieros_update on public.movimientos_financieros;
create policy movimientos_financieros_update on public.movimientos_financieros
  for update to authenticated
  using (public.is_root() and origen = 'manual')
  with check (public.is_root() and origen = 'manual');

drop policy if exists movimientos_financieros_delete on public.movimientos_financieros;
create policy movimientos_financieros_delete on public.movimientos_financieros
  for delete to authenticated using (public.is_root() and origen = 'manual');

drop policy if exists comprobantes_delete on storage.objects;
create policy comprobantes_delete on storage.objects
  for delete to authenticated
  using (bucket_id = 'comprobantes' and public.is_root());

-- Keep the cash-box-derived ledger row synchronized when an approved correction
-- changes its amount, classification, or source movement type.
create or replace function public.caja_chica_to_ledger()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  cat uuid;
  affected integer;
begin
  if tg_op = 'DELETE' then
    update public.movimientos_financieros
    set voided_at = coalesce(voided_at, now()), voided_by = auth.uid()
    where origen = 'caja_chica' and origen_id = old.id;
    return old;
  end if;

  if new.tipo in ('viatico','gasto') then
    cat := new.categoria_id;
    if cat is null then
      select id into cat from public.finanzas_categorias
      where lower(nombre) = case when new.tipo = 'viatico' then 'viáticos' else 'otros egresos' end
      limit 1;
    end if;
    update public.movimientos_financieros
    set fecha = new.fecha,
        tipo = 'egreso',
        categoria_id = cat,
        monto = new.monto,
        concepto = concat_ws(' · ', case when new.tipo = 'viatico' then 'Viático' else 'Gasto de caja chica' end,
                    nullif(trim(coalesce(new.tecnico, '')), ''), nullif(trim(coalesce(new.concepto, '')), '')),
        plaza = new.plaza,
        obra_id = new.obra_id,
        voided_at = new.voided_at,
        voided_by = new.voided_by
    where origen = 'caja_chica' and origen_id = new.id;
    get diagnostics affected = row_count;
    if affected = 0 and tg_op = 'INSERT' then
      insert into public.movimientos_financieros
        (fecha, tipo, categoria_id, monto, concepto, plaza, metodo_pago, obra_id, origen, origen_id, created_by)
      values (new.fecha, 'egreso', cat, new.monto,
              concat_ws(' · ', case when new.tipo = 'viatico' then 'Viático' else 'Gasto de caja chica' end,
                        nullif(trim(coalesce(new.tecnico, '')), ''), nullif(trim(coalesce(new.concepto, '')), '')),
              new.plaza, 'caja_chica', new.obra_id, 'caja_chica', new.id, new.created_by);
    elsif affected = 0 then
      insert into public.movimientos_financieros
        (fecha, tipo, categoria_id, monto, concepto, plaza, metodo_pago, obra_id, origen, origen_id, created_by, voided_at, voided_by)
      values (new.fecha, 'egreso', cat, new.monto,
              concat_ws(' · ', case when new.tipo = 'viatico' then 'Viático' else 'Gasto de caja chica' end,
                        nullif(trim(coalesce(new.tecnico, '')), ''), nullif(trim(coalesce(new.concepto, '')), '')),
              new.plaza, 'caja_chica', new.obra_id, 'caja_chica', new.id, new.created_by, new.voided_at, new.voided_by);
    end if;
  else
    update public.movimientos_financieros
    set voided_at = coalesce(new.voided_at, now()),
        voided_by = coalesce(new.voided_by, auth.uid())
    where origen = 'caja_chica' and origen_id = new.id;
  end if;
  return new;
end;
$$;

drop trigger if exists t_caja_chica_ledger_ins on public.caja_chica_movimientos;
drop trigger if exists t_caja_chica_ledger_del on public.caja_chica_movimientos;
drop trigger if exists t_caja_chica_ledger_upd on public.caja_chica_movimientos;
create trigger t_caja_chica_ledger_ins
  after insert on public.caja_chica_movimientos
  for each row execute function public.caja_chica_to_ledger();
create trigger t_caja_chica_ledger_del
  after delete on public.caja_chica_movimientos
  for each row execute function public.caja_chica_to_ledger();
create trigger t_caja_chica_ledger_upd
  after update of fecha, tipo, monto, tecnico, obra_id, categoria_id, concepto, plaza, voided_at, voided_by
  on public.caja_chica_movimientos
  for each row execute function public.caja_chica_to_ledger();
