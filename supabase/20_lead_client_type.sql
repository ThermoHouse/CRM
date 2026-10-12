alter table public.leads
  add column if not exists tipo_aplicacion text;

create index if not exists leads_tipo_aplicacion_idx
  on public.leads (tipo_aplicacion)
  where tipo_aplicacion is not null;