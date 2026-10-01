-- Let the database trigger write its audit row without allowing browser inserts.
create or replace function public.log_status()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.status is distinct from old.status then
    insert into public.lead_audit (lead_id, de, a)
    values (new.id, old.status, new.status);
    new.last_contact_at := now();
  end if;
  return new;
end;
$$;
