-- Blueprint paso 2: estados unificados, auditoría, inventario inmutable, garantía automática, "por rescatar".
alter table leads drop constraint if exists leads_status_check;
alter table leads add constraint leads_status_check check (status in ('nuevo','contactado','visita','visitado','cerrado','rescatar','no'));
alter table leads add column if not exists last_contact_at timestamptz default now(), add column if not exists metodo_pago text default 'contado';

create table if not exists lead_audit(id uuid primary key default gen_random_uuid(), lead_id uuid, de text, a text, quien text default auth.jwt()->>'email', cuando timestamptz default now());
alter table lead_audit enable row level security;
create policy "audit_read" on lead_audit for select to authenticated using(true);
create policy "audit_ins" on lead_audit for insert to authenticated with check(true);
create or replace function public.log_status()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.status is distinct from old.status then
    insert into public.lead_audit(lead_id,de,a) values(new.id,old.status,new.status);
    new.last_contact_at:=now();
  end if;
  return new;
end;
$$;
drop trigger if exists t_log_status on leads;
create trigger t_log_status before update on leads for each row execute function log_status();

-- Registro inmutable: solo insertar y leer.
create table if not exists inventory_movements(id uuid primary key default gen_random_uuid(), plaza text, tipo text check (tipo in ('entrada','consumo')),
  insumo text, cantidad numeric, referencia text, quien text default auth.jwt()->>'email', cuando timestamptz default now());
alter table inventory_movements enable row level security;
create policy "mov_read" on inventory_movements for select to authenticated using(true);
create policy "mov_ins" on inventory_movements for insert to authenticated with check(true);

-- Obra entregada -> garantía con primer mantenimiento (12 meses: AJUSTA al calendario real de tu garantía).
create or replace function obra_entregada() returns trigger language plpgsql as $$
begin if new.status='entregada' and old.status is distinct from 'entregada' then
  insert into garantias(cliente,folio,instalacion,proximo_mtto) values(new.cliente,new.folio,current_date,current_date+interval '12 months'); end if; return new; end $$;
drop trigger if exists t_obra on obras;
create trigger t_obra after update on obras for each row execute function obra_entregada();

-- Regla "Por rescatar": leads nuevos/contactados sin movimiento en 15 días. Prográmala con pg_cron o Edge Function diaria.
create or replace function marcar_rescatar(dias int default 15) returns void language sql as $$
  update leads set status='rescatar' where status in ('nuevo','contactado') and last_contact_at < now()-make_interval(days=>dias) $$;
