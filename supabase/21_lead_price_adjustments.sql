alter table public.leads
  add column if not exists precio_base_m2 numeric,
  add column if not exists ajuste_precio_m2 numeric not null default 0,
  add column if not exists precio_final_m2 numeric,
  add column if not exists margen_vendedor numeric not null default 0;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conrelid = 'public.leads'::regclass
      and conname = 'leads_price_adjustment_nonnegative_final'
  ) then
    alter table public.leads
      add constraint leads_price_adjustment_nonnegative_final
      check (precio_final_m2 is null or precio_final_m2 >= 0);
  end if;
end;
$$;