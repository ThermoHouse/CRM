create table if not exists public.lead_contact_attempts (
  id uuid primary key default gen_random_uuid(),
  lead_id uuid not null references public.leads(id) on delete cascade,
  method text not null check (method in ('llamada','whatsapp','correo','sms','otro')),
  note text,
  attempted_by uuid references public.profiles(id) on delete set null default auth.uid(),
  attempted_at timestamptz not null default now()
);

create index if not exists lead_contact_attempts_lead_time_idx
  on public.lead_contact_attempts (lead_id, attempted_at desc);
create index if not exists lead_contact_attempts_time_idx
  on public.lead_contact_attempts (attempted_at desc);

alter table public.lead_contact_attempts enable row level security;
revoke all on public.lead_contact_attempts from public, anon, authenticated;
grant select, insert on public.lead_contact_attempts to authenticated;

drop policy if exists lead_contact_attempts_read on public.lead_contact_attempts;
create policy lead_contact_attempts_read on public.lead_contact_attempts
  for select to authenticated
  using (public.can_read_table('leads'));

drop policy if exists lead_contact_attempts_insert on public.lead_contact_attempts;
create policy lead_contact_attempts_insert on public.lead_contact_attempts
  for insert to authenticated
  with check (
    public.can_write_table('leads')
    and exists (select 1 from public.leads as lead where lead.id = lead_id)
  );