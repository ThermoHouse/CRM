create table if not exists public.warranty_reports (
  id uuid primary key default gen_random_uuid(),
  guarantee_id uuid not null references public.garantias(id) on delete cascade,
  folio text not null unique,
  cliente text not null,
  domicilio text,
  sistema_instalado text,
  fecha_instalacion date,
  fecha_visita date not null default current_date,
  tipo_visita text not null default 'Revisión por garantía',
  tecnico_responsable text,
  motivo_visita text,
  hallazgos text,
  analisis_tecnico text,
  dictamen text,
  recomendaciones text,
  foto_paths text[] not null default '{}'::text[],
  pdf_path text,
  created_by uuid references public.profiles(id) on delete set null,
  updated_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint warranty_reports_photo_paths_limit check (cardinality(foto_paths) <= 4)
);

create index if not exists warranty_reports_guarantee_date_idx
  on public.warranty_reports (guarantee_id, fecha_visita desc);

alter table public.warranty_reports enable row level security;
revoke all on public.warranty_reports from public, anon, authenticated;
grant select, insert, update on public.warranty_reports to authenticated;

drop policy if exists warranty_reports_read on public.warranty_reports;
create policy warranty_reports_read on public.warranty_reports
  for select to authenticated
  using (public.current_user_role() in ('root','administrative','manager','sales'));

drop policy if exists warranty_reports_insert on public.warranty_reports;
create policy warranty_reports_insert on public.warranty_reports
  for insert to authenticated
  with check (
    public.current_user_role() in ('root','administrative')
    and created_by = (select auth.uid())
  );

drop policy if exists warranty_reports_update on public.warranty_reports;
create policy warranty_reports_update on public.warranty_reports
  for update to authenticated
  using (public.current_user_role() in ('root','administrative'))
  with check (public.current_user_role() in ('root','administrative'));

create or replace function public.can_read_table(table_name text)
returns boolean
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  user_role text := public.current_user_role();
begin
  if user_role in ('root','administrative','manager') then
    return true;
  end if;

  case table_name
    when 'leads' then return user_role = 'sales';
    when 'bot_inbox' then return user_role = 'sales';
    when 'tarifas' then return user_role in ('sales','operations');
    when 'productos' then return user_role in ('sales','operations');
    when 'visitas' then return user_role in ('sales','operations');
    when 'obras' then return user_role in ('sales','operations');
    when 'garantias' then return user_role = 'sales';
    when 'barriles' then return user_role = 'operations';
    when 'inventory_movements' then return user_role = 'operations';
    when 'lead_audit' then return false;
    else return false;
  end case;
end;
$$;

create or replace function public.can_write_table(table_name text)
returns boolean
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  user_role text := public.current_user_role();
begin
  if user_role = 'root' then
    return true;
  end if;

  case table_name
    when 'leads' then return user_role = 'sales';
    when 'bot_inbox' then return user_role = 'sales';
    when 'visitas' then return user_role in ('operations','administrative');
    when 'obras' then return user_role in ('operations','administrative');
    when 'garantias' then return user_role = 'administrative';
    when 'barriles' then return user_role in ('operations','administrative');
    when 'inventory_movements' then return user_role in ('operations','administrative');
    when 'productos' then return user_role = 'administrative';
    when 'tarifas' then return user_role = 'administrative';
    else return false;
  end case;
end;
$$;

grant execute on function public.can_read_table(text) to authenticated;
grant execute on function public.can_write_table(text) to authenticated;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'warranty-reports',
  'warranty-reports',
  false,
  15728640,
  array['application/pdf','image/jpeg','image/png','image/webp']
)
on conflict (id) do update
set public = false,
    file_size_limit = excluded.file_size_limit,
    allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists warranty_reports_storage_read on storage.objects;
create policy warranty_reports_storage_read on storage.objects
  for select to authenticated
  using (
    bucket_id = 'warranty-reports'
    and public.current_user_role() in ('root','administrative','manager','sales')
    and exists (
      select 1
      from public.warranty_reports as report
      where report.id::text = (storage.foldername(name))[1]
    )
  );

drop policy if exists warranty_reports_storage_insert on storage.objects;
create policy warranty_reports_storage_insert on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'warranty-reports'
    and public.current_user_role() in ('root','administrative')
    and exists (
      select 1
      from public.warranty_reports as report
      where report.id::text = (storage.foldername(name))[1]
    )
  );

drop policy if exists warranty_reports_storage_update on storage.objects;
create policy warranty_reports_storage_update on storage.objects
  for update to authenticated
  using (
    bucket_id = 'warranty-reports'
    and public.current_user_role() in ('root','administrative')
  )
  with check (
    bucket_id = 'warranty-reports'
    and public.current_user_role() in ('root','administrative')
  );

drop policy if exists warranty_reports_storage_delete on storage.objects;
create policy warranty_reports_storage_delete on storage.objects
  for delete to authenticated
  using (
    bucket_id = 'warranty-reports'
    and public.current_user_role() in ('root','administrative')
  );

create or replace function public.set_warranty_report_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at := now();
  new.updated_by := auth.uid();
  return new;
end;
$$;

drop trigger if exists set_warranty_report_updated_at on public.warranty_reports;
create trigger set_warranty_report_updated_at
  before update on public.warranty_reports
  for each row execute function public.set_warranty_report_updated_at();

drop trigger if exists audit_activity on public.warranty_reports;
create trigger audit_activity
  after insert or update or delete on public.warranty_reports
  for each row execute function public.log_table_activity();

notify pgrst, 'reload schema';
