-- 30: resumen mensual para el gerente y el contador. Ejecutar después de 29.
-- La vista respeta los permisos de quien consulta (security_invoker): solo root, administrativo y gerente.

create or replace view public.finanzas_resumen_mensual
with (security_invoker = true) as
select date_trunc('month', m.fecha)::date as mes,
       m.plaza,
       m.tipo,
       c.nombre as categoria,
       c.naturaleza,
       sum(m.monto) as total,
       count(*) as movimientos
from public.movimientos_financieros m
join public.finanzas_categorias c on c.id = m.categoria_id
group by 1, 2, 3, 4, 5;

grant select on public.finanzas_resumen_mensual to authenticated;
