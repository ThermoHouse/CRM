create table if not exists public.lead_reminder_push_subscriptions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  endpoint text not null unique,
  p256dh text not null,
  auth text not null,
  enabled boolean not null default true,
  before_minutes integer not null default 10
    check (before_minutes in (0, 5, 10, 15, 30, 60)),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists lead_reminder_push_subscriptions_user_idx
  on public.lead_reminder_push_subscriptions (user_id)
  where enabled;

create table if not exists public.lead_reminder_push_deliveries (
  id uuid primary key default gen_random_uuid(),
  subscription_id uuid not null
    references public.lead_reminder_push_subscriptions(id) on delete cascade,
  event_key text not null,
  created_at timestamptz not null default now(),
  unique (subscription_id, event_key)
);

create index if not exists lead_reminder_push_deliveries_created_idx
  on public.lead_reminder_push_deliveries (created_at);

alter table public.lead_reminder_push_subscriptions enable row level security;
alter table public.lead_reminder_push_deliveries enable row level security;

revoke all on public.lead_reminder_push_subscriptions,
  public.lead_reminder_push_deliveries from public, anon, authenticated;
grant all on public.lead_reminder_push_subscriptions,
  public.lead_reminder_push_deliveries to service_role;

create index if not exists leads_next_call_reminder_idx
  on public.leads (next_call_at)
  where next_call_at is not null;
