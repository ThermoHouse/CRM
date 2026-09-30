create extension if not exists pgcrypto;
create table leads(
 id uuid primary key default gen_random_uuid(), folio text, nombre text not null, whatsapp text, email text,
 fecha_nacimiento date, origen text, ciudad text default 'Cuernavaca', estado text, cp text, direccion text,
 area_m2 numeric default 0, tipo_precio text default 'efectivo', sistema text, costo_logistico numeric default 0,
 total numeric default 0, status text default 'nuevo' check (status in ('nuevo','contactado','visita','cerrado','rescatar','no')),
 asesor text, notas text, created_at timestamptz default now());
create table bot_inbox(id uuid primary key default gen_random_uuid(), nombre text, telefono text, ciudad text,
 sistema text, monto numeric, tipo text, notas text, status text default 'pendiente', created_at timestamptz default now());
create table productos(id text primary key, nombre text, categoria text, espesor text, orden int);
create table tarifas(id uuid primary key default gen_random_uuid(), ciudad text, producto_id text references productos(id),
 precio_contado numeric, precio_msi numeric, minimo numeric default 6900, activo boolean default true);
create table visitas(id uuid primary key default gen_random_uuid(), lead_id uuid references leads(id), cliente text,
 ubicacion text, programacion timestamptz, status text default 'por_visitar');
create table obras(id uuid primary key default gen_random_uuid(), lead_id uuid references leads(id), folio text, cliente text,
 programacion date, direccion text, m2 numeric, status text default 'por_iniciar');
create table garantias(id uuid primary key default gen_random_uuid(), cliente text, folio text, sistema text,
 instalacion date, proximo_mtto date, status text default 'activa');
create table barriles(id uuid primary key default gen_random_uuid(), plaza text default 'Cuernavaca',
 tipo text check (tipo in ('isocianato','poliol')), lote text, estado text default 'cerrado', entrada date default current_date);
do $$ declare t text; begin
 foreach t in array array['leads','bot_inbox','productos','tarifas','visitas','obras','garantias','barriles'] loop
  execute format('alter table %I enable row level security',t);
  execute format('create policy "auth_all" on %I for all to authenticated using(true) with check(true)',t);
 end loop; end $$;
insert into productos values('TH FIX','TH FIX','concreto','1000 micras',1),('TH LIGHT','TH LIGHT','concreto','1/2 cm (5 mm)',2),
('TH FORTE','TH FORTE','concreto','1 cm (10 mm)',3),('TH 3/4','TH 3/4','inerte','1.9 cm (19 mm)',4),('TH INGLES','TH Inglés','inerte','2.5 cm (25 mm)',5);
insert into tarifas(ciudad,producto_id,precio_contado,precio_msi) values('Cuernavaca','TH FIX',79,97),('Cuernavaca','TH LIGHT',139,170),
('Cuernavaca','TH FORTE',169,208),('Cuernavaca','TH 3/4',199,245),('Cuernavaca','TH INGLES',219,269);
