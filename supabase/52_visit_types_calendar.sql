-- 52: las visitas ahora tienen tipo (técnica o de garantía) para mostrarse
-- junto con las instalaciones y los mantenimientos en un solo calendario.
-- Ejecutar después de 51. Es seguro repetirlo.

alter table public.visitas
  add column if not exists tipo text not null default 'tecnica',
  add column if not exists notas text;

alter table public.visitas drop constraint if exists visitas_tipo_check;
alter table public.visitas
  add constraint visitas_tipo_check check (tipo in ('tecnica','garantia'));

create index if not exists visitas_programacion_idx on public.visitas (programacion);
