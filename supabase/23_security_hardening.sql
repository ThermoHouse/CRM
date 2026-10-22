-- Remove legacy broad policies. Role-specific policies from migration 06 are kept.
do $$
declare
  table_name text;
  table_names text[] := array[
    'leads','bot_inbox','productos','tarifas','visitas','obras','garantias',
    'barriles','lead_audit','inventory_movements'
  ];
begin
  foreach table_name in array table_names loop
    if to_regclass(format('public.%I', table_name)) is not null then
      execute format('alter table public.%I enable row level security', table_name);
      execute format('drop policy if exists auth_all on public.%I', table_name);
      execute format('drop policy if exists audit_read on public.%I', table_name);
      execute format('drop policy if exists audit_ins on public.%I', table_name);
      execute format('drop policy if exists mov_read on public.%I', table_name);
      execute format('drop policy if exists mov_ins on public.%I', table_name);
    end if;
  end loop;
end;
$$;
