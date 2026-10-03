alter table public.obras
  add column if not exists vendedor text;

alter table public.garantias
  add column if not exists revisitas integer not null default 0
    check (revisitas >= 0);

alter table public.tarifas
  add column if not exists maximo numeric
    check (maximo is null or maximo >= 0);

update public.obras as obra
set vendedor = coalesce(nullif(trim(perfil.full_name), ''), nullif(trim(lead.asesor), ''))
from public.leads as lead
left join public.profiles as perfil on lower(perfil.email) = lower(lead.asesor)
where obra.lead_id = lead.id
  and nullif(trim(obra.vendedor), '') is null
  and (perfil.full_name is not null or nullif(trim(lead.asesor), '') is not null);

update public.plazas
set activa = lower(trim(nombre)) = 'morelos'
where activa is distinct from (lower(trim(nombre)) = 'morelos');