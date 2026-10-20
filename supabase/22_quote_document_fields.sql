alter table public.leads
  add column if not exists fecha_presupuesto date,
  add column if not exists medio_contacto text[] not null default '{}'::text[],
  add column if not exists descuento text,
  add column if not exists destechado_monto numeric not null default 0,
  add column if not exists aplicaciones text[] not null default '{}'::text[],
  add column if not exists tono_acrilico text,
  add column if not exists condiciones_techo text[] not null default '{}'::text[],
  add column if not exists suministros text[] not null default '{}'::text[],
  add column if not exists objetos_techo text[] not null default '{}'::text[],
  add column if not exists especificaciones text,
  add column if not exists razon_social text,
  add column if not exists rfc text,
  add column if not exists direccion_facturacion text,
  add column if not exists correo_facturacion text,
  add column if not exists forma_pago text,
  add column if not exists subtotal numeric,
  add column if not exists iva numeric,
  add column if not exists iva_aplica boolean;

alter table public.leads
  alter column iva_aplica drop default,
  alter column iva_aplica drop not null;

create or replace function public.sync_quote_iva_flag()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.iva_aplica is null then
    new.iva_aplica := coalesce(new.iva, 0) > 0;
  end if;
  return new;
end;
$$;

drop trigger if exists sync_quote_iva_flag on public.leads;
create trigger sync_quote_iva_flag
  before insert or update of subtotal, iva, total on public.leads
  for each row execute function public.sync_quote_iva_flag();