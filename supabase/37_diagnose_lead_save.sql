-- Diagnóstico de solo lectura para errores al crear o editar leads.
-- Ejecutar en Supabase SQL Editor del mismo proyecto que usa la aplicación.
-- No devuelve datos personales de leads ni modifica objetos o registros.

-- 1) Identifica el proyecto/base de datos donde se está ejecutando el diagnóstico.
select
  current_database() as database_name,
  current_user as sql_editor_role,
  current_schema() as current_schema,
  to_regclass('public.leads') as leads_table;

-- 2) Compara todas las columnas enviadas por el formulario con public.leads.
-- Una fila con exists_in_database = false indica una migración pendiente.
with expected_columns(column_name) as (
  values
    ('nombre'),
    ('whatsapp'),
    ('email'),
    ('origen'),
    ('tipo_aplicacion'),
    ('ciudad'),
    ('cp'),
    ('direccion'),
    ('area_m2'),
    ('destechado_m2'),
    ('tipo_precio'),
    ('sistema'),
    ('presentacion'),
    ('presentaciones'),
    ('precio_base_m2'),
    ('ajuste_precio_m2'),
    ('precio_final_m2'),
    ('margen_vendedor'),
    ('status'),
    ('next_call_at'),
    ('costo_logistico'),
    ('notas'),
    ('descuento'),
    ('destechado_monto'),
    ('medio_contacto'),
    ('aplicaciones'),
    ('tono_acrilico'),
    ('condiciones_techo'),
    ('suministros'),
    ('objetos_techo'),
    ('especificaciones'),
    ('fecha_presupuesto'),
    ('razon_social'),
    ('rfc'),
    ('direccion_facturacion'),
    ('correo_facturacion'),
    ('forma_pago'),
    ('subtotal'),
    ('iva'),
    ('voltaje'),
    ('canal_venta'),
    ('fecha_contacto'),
    ('fecha_kam'),
    ('fecha_nacimiento'),
    ('total'),
    ('plaza'),
    ('asesor'),
    ('folio')
)
select
  expected.column_name,
  actual.data_type,
  actual.udt_name,
  actual.is_nullable,
  actual.column_default,
  actual.column_name is not null as exists_in_database
from expected_columns as expected
left join information_schema.columns as actual
  on actual.table_schema = 'public'
  and actual.table_name = 'leads'
  and actual.column_name = expected.column_name
order by expected.column_name;

-- 3) Verifica puntualmente presentaciones y los datos almacenados en esa columna.
-- Si presentaciones no existe, el total de valores JSON no-array será cero;
-- confírmalo también en la sección 2.
select
  count(*) as total_leads,
  count(*) filter (
    where jsonb_typeof(to_jsonb(lead_row)->'presentaciones') = 'array'
  ) as leads_with_presentaciones_array,
  count(*) filter (
    where to_jsonb(lead_row) ? 'presentaciones'
      and jsonb_typeof(to_jsonb(lead_row)->'presentaciones') is distinct from 'array'
  ) as leads_with_invalid_presentaciones
from public.leads as lead_row;

-- 4) Restricciones de public.leads; convalidated = false puede indicar
-- una restricción que aún no se verificó contra todos los datos existentes.
select
  constraint_row.conname as constraint_name,
  constraint_row.contype as constraint_type,
  constraint_row.convalidated as is_validated,
  pg_get_constraintdef(constraint_row.oid, true) as definition
from pg_constraint as constraint_row
where constraint_row.conrelid = to_regclass('public.leads')
order by constraint_row.contype, constraint_row.conname;

-- 5) RLS, permisos SQL del rol authenticated y políticas aplicables.
select
  relation.relrowsecurity as rls_enabled,
  relation.relforcerowsecurity as rls_forced,
  has_table_privilege('authenticated', 'public.leads', 'SELECT') as authenticated_can_select,
  has_table_privilege('authenticated', 'public.leads', 'INSERT') as authenticated_can_insert,
  has_table_privilege('authenticated', 'public.leads', 'UPDATE') as authenticated_can_update
from pg_class as relation
where relation.oid = to_regclass('public.leads');

select
  policy.policyname,
  policy.cmd as command,
  policy.roles,
  policy.permissive,
  policy.qual as using_expression,
  policy.with_check as check_expression
from pg_policies as policy
where policy.schemaname = 'public'
  and policy.tablename = 'leads'
order by policy.cmd, policy.policyname;

-- 6) Triggers activos sobre leads: estos también pueden rechazar INSERT/UPDATE.
select
  trigger_row.tgname as trigger_name,
  pg_get_triggerdef(trigger_row.oid, true) as definition,
  function_row.oid::regprocedure as trigger_function
from pg_trigger as trigger_row
join pg_proc as function_row
  on function_row.oid = trigger_row.tgfoid
where trigger_row.tgrelid = to_regclass('public.leads')
  and not trigger_row.tgisinternal
order by trigger_row.tgname;

-- Nota: el SQL Editor normalmente ejecuta como un rol privilegiado.
-- Sus resultados muestran la configuración de RLS/policies, pero no pueden
-- simular el JWT ni confirmar los headers de la petición del navegador.
