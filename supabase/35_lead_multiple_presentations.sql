alter table public.leads
  add column if not exists presentaciones jsonb not null default '[]'::jsonb;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conrelid = 'public.leads'::regclass
      and conname = 'leads_presentaciones_array'
  ) then
    alter table public.leads
      add constraint leads_presentaciones_array
      check (jsonb_typeof(presentaciones) = 'array');
  end if;
end;
$$;
