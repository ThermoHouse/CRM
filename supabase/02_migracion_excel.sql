alter table leads add column if not exists voltaje text, add column if not exists canal_venta text, add column if not exists presentacion text,
 add column if not exists tipo_aplicacion text, add column if not exists fecha_contacto date, add column if not exists fecha_kam date, add column if not exists estatus_original text;
create unique index if not exists leads_folio_uq on leads(folio);
