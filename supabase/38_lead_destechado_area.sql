alter table public.leads
  add column if not exists destechado_m2 numeric not null default 0;

notify pgrst, 'reload schema';
