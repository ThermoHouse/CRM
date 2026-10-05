create table if not exists public.contacts (
  id uuid primary key default gen_random_uuid(),
  phone text not null unique check (phone ~ '^\+[1-9][0-9]{1,14}$'),
  name text,
  created_at timestamptz not null default now()
);

create table if not exists public.conversations (
  id uuid primary key default gen_random_uuid(),
  contact_id uuid not null references public.contacts(id) on delete cascade,
  status text not null default 'bot' check (status in ('bot','humano','cerrada')),
  assigned_to uuid references public.profiles(id) on delete set null,
  is_test boolean not null default false,
  last_message_at timestamptz,
  last_customer_message_at timestamptz,
  created_at timestamptz not null default now()
);

create unique index if not exists conversations_one_open_per_contact_uq
  on public.conversations (contact_id)
  where status in ('bot','humano');
create index if not exists conversations_status_last_message_idx
  on public.conversations (status, last_message_at desc);
create index if not exists conversations_assigned_last_message_idx
  on public.conversations (assigned_to, last_message_at desc);
create index if not exists conversations_test_last_message_idx
  on public.conversations (is_test, last_message_at desc);

create table if not exists public.messages (
  id uuid primary key default gen_random_uuid(),
  conversation_id uuid not null references public.conversations(id) on delete cascade,
  wa_message_id text not null unique,
  direction text not null check (direction in ('in','out')),
  sender text not null check (sender in ('cliente','bot','vendedor')),
  type text not null default 'text' check (type in ('text','image','audio','other')),
  body text,
  media_url text,
  tokens_in integer check (tokens_in is null or tokens_in >= 0),
  tokens_out integer check (tokens_out is null or tokens_out >= 0),
  created_at timestamptz not null default now()
);

create index if not exists messages_conversation_created_idx
  on public.messages (conversation_id, created_at);
create index if not exists messages_created_at_idx
  on public.messages (created_at desc);

create table if not exists public.lead_data (
  conversation_id uuid primary key references public.conversations(id) on delete cascade,
  crm_lead_id uuid unique references public.leads(id) on delete set null,
  nombre text,
  telefono text check (telefono is null or telefono ~ '^\+[1-9][0-9]{1,14}$'),
  ubicacion_maps_link text,
  m2 numeric check (m2 is null or m2 >= 0),
  presentacion text,
  tipo_techo text,
  estado text not null default 'nuevo' check (estado in ('nuevo','calificado','cotizado','ganado','perdido')),
  motivo_perdida text
);

create table if not exists public.events (
  id uuid primary key default gen_random_uuid(),
  conversation_id uuid not null references public.conversations(id) on delete cascade,
  type text not null check (type in ('handoff','lead_calificado','asignado','cotizacion_enviada','pausa_bot','reanuda_bot')),
  payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists events_conversation_created_idx
  on public.events (conversation_id, created_at);
create index if not exists events_type_created_idx
  on public.events (type, created_at desc);

create or replace function public.can_access_whatsapp_conversation(target_conversation_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.conversations as conversation
    where conversation.id = target_conversation_id
      and (
        public.current_user_role() in ('root','administrative')
        or (public.current_user_role() = 'sales' and conversation.assigned_to = (select auth.uid()))
      )
  );
$$;

revoke all on function public.can_access_whatsapp_conversation(uuid) from public, anon;
grant execute on function public.can_access_whatsapp_conversation(uuid) to authenticated;

alter table public.contacts enable row level security;
alter table public.conversations enable row level security;
alter table public.messages enable row level security;
alter table public.lead_data enable row level security;
alter table public.events enable row level security;

revoke all on public.contacts, public.conversations, public.messages, public.lead_data, public.events from anon, authenticated;
grant select on public.contacts, public.conversations, public.messages, public.lead_data, public.events to authenticated;

drop policy if exists whatsapp_conversations_read on public.conversations;
create policy whatsapp_conversations_read on public.conversations
  for select to authenticated
  using (public.can_access_whatsapp_conversation(id));

drop policy if exists whatsapp_contacts_read on public.contacts;
create policy whatsapp_contacts_read on public.contacts
  for select to authenticated
  using (
    exists (
      select 1 from public.conversations as conversation
      where conversation.contact_id = contacts.id
        and public.can_access_whatsapp_conversation(conversation.id)
    )
  );

drop policy if exists whatsapp_messages_read on public.messages;
create policy whatsapp_messages_read on public.messages
  for select to authenticated
  using (public.can_access_whatsapp_conversation(conversation_id));

drop policy if exists whatsapp_lead_data_read on public.lead_data;
create policy whatsapp_lead_data_read on public.lead_data
  for select to authenticated
  using (public.can_access_whatsapp_conversation(conversation_id));

drop policy if exists whatsapp_events_read on public.events;
create policy whatsapp_events_read on public.events
  for select to authenticated
  using (public.can_access_whatsapp_conversation(conversation_id));