-- Ventas puede registrar un mantenimiento como realizado (pestaña Mantenimiento).
-- Se usa una función en lugar de abrir la escritura completa de `garantias`,
-- para que Ventas solo pueda ejecutar esta acción y no editar otros campos.
create or replace function public.complete_application_maintenance(p_garantia_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if public.current_user_role() not in ('root','administrative','sales') then
    raise exception 'No tienes permiso para registrar mantenimientos.'
      using errcode = '42501';
  end if;

  -- El trigger advance_application_maintenance calcula el siguiente ciclo.
  update public.garantias
  set status = 'mantenimiento_hecho'
  where id = p_garantia_id;

  if not found then
    raise exception 'No se encontró el mantenimiento de esta aplicación.'
      using errcode = 'P0002';
  end if;
end;
$$;

revoke all on function public.complete_application_maintenance(uuid) from public, anon;
grant execute on function public.complete_application_maintenance(uuid) to authenticated;

notify pgrst, 'reload schema';
