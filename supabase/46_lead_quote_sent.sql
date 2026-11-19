alter table public.leads
  add column if not exists cotizacion_enviada boolean not null default false;
