-- Guarda el costo de planta de luz de 220V por separado de los viáticos.
alter table public.leads
  add column if not exists costo_planta_luz numeric not null default 0;
