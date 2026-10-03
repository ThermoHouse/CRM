alter table public.leads
  add column if not exists appointment_at timestamptz,
  add column if not exists appointment_duration_minutes integer,
  add column if not exists appointment_location text,
  add column if not exists google_calendar_event_id text,
  add column if not exists google_calendar_event_link text,
  add column if not exists appointment_notification_status text not null default 'not_sent',
  add column if not exists appointment_notifications_sent_at timestamptz;

alter table public.leads
  drop constraint if exists leads_appointment_duration_check,
  add constraint leads_appointment_duration_check
    check (appointment_duration_minutes is null or appointment_duration_minutes between 15 and 480),
  drop constraint if exists leads_appointment_notification_status_check,
  add constraint leads_appointment_notification_status_check
    check (appointment_notification_status in ('not_sent','sent','failed'));

create unique index if not exists leads_google_calendar_event_id_uq
  on public.leads (google_calendar_event_id)
  where google_calendar_event_id is not null;

create index if not exists leads_appointment_at_idx
  on public.leads (appointment_at)
  where appointment_at is not null;
