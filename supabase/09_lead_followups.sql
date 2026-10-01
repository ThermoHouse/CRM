alter table public.leads
  add column if not exists next_call_at timestamptz;

alter table public.leads drop constraint if exists leads_status_check;
alter table public.leads
  add constraint leads_status_check
  check (status in (
    'nuevo','contactado','visita','visitado','cerrado','rescatar','no',
    'sin_respuesta','interesado','en_proceso','confirmado','llamar_despues'
  ));

create index if not exists leads_next_call_at_idx
  on public.leads (next_call_at)
  where next_call_at is not null;
