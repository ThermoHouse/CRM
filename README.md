# Nexus Admin (CRM ThermoHouse)

Consulta [SISTEMA.md](./SISTEMA.md) para conocer los módulos, roles, datos, automatizaciones e integraciones del sistema.

1. Supabase: ejecuta `supabase/schema.sql` desde SQL Editor. Mantén deshabilitado el registro público y crea manualmente en Authentication → Users la cuenta que será root. El esquema base deja las tablas sin políticas de acceso hasta aplicar la migración de roles.
2. Si usas el blueprint, ejecuta `supabase/04_blueprint.sql`; después ejecuta siempre `supabase/05_access_requests.sql` para crear perfiles y habilitar solicitudes.
3. Ejecuta `supabase/06_roles_and_audit.sql` después de `05`. La migración configura permisos por rol, pero no asigna automáticamente el rol `root`.
4. Para habilitar al administrador inicial, reemplaza el correo objetivo de `supabase/07_promote_root.sql` por el correo exacto de la cuenta que creaste y ejecútalo después de `06`. El script verifica que exista exactamente una cuenta con ese correo; no crea usuarios ni modifica contraseñas. También puedes asignar otros roles desde **Usuarios** una vez que el primer root entre al panel.
5. Ejecuta `supabase/08_plazas.sql` después de `06`. Crea la plaza Morelos, agrega la columna de plaza a leads y sincroniza las opciones del inventario.
6. Ejecuta `supabase/09_lead_followups.sql` después de `08` para habilitar los nuevos estados del semáforo y las fechas de llamada.
7. Ejecuta `supabase/10_sales_directory.sql` para que filtros e informes muestren nombres de vendedores sin exponer sus correos.
8. Ejecuta `supabase/11_fix_lead_audit_trigger.sql` para que los cambios de estado de leads escriban su bitácora de forma segura.
9. Ejecuta `supabase/12_calendar_appointments.sql` para guardar citas de Google Calendar en los leads.
10. Ejecuta `supabase/13_dashboard_corrections.sql` para dejar activa únicamente la plaza Morelos (sin borrar las demás), agregar vendedor y revisitas, y habilitar precio máximo.
11. Ejecuta `supabase/14_user_profiles_and_gmail.sql` para habilitar perfiles editables, fotos privadas y conexiones Gmail.
12. Si ya hay varias cuentas y quieres asignar otro root manualmente, reemplaza el correo en SQL Editor. Ejecuta esta consulta con una cuenta administrativa de confianza:

```sql
update public.profiles
set role = 'root'
where email = 'root@empresa.com';
```

13. Reinicia la sesión de la app. Root podrá asignar `sales`, `operations` o `administrative` desde la pestaña **Usuarios**.
14. Mantén el registro público deshabilitado hasta completar la migración `23_security_hardening.sql` y asignar el root inicial. Después, en Authentication → Providers → Email, puedes habilitar el registro para que el equipo solicite acceso y quede pendiente de aprobación.
15. Ejecuta `supabase/15_whatsapp_phase1.sql` para crear el esquema de conversaciones de WhatsApp y sus políticas de lectura por rol.
16. Ejecuta `supabase/16_whatsapp_bot_api.sql` para activar las operaciones transaccionales y el límite de solicitudes de la API de n8n.
17. Ejecuta `supabase/17_lead_contact_attempts.sql` para guardar llamadas, WhatsApp, correos y otros intentos de contacto con su fecha/hora.
18. Ejecuta `supabase/18_sales_directory_with_ids.sql` para agrupar el historial de llamadas por vendedor en el dashboard.
19. Ejecuta `supabase/19_lead_followup_assignment.sql` para permitir asignar el seguimiento a otro vendedor sin mover la comisión del dueño original.
20. Ejecuta `supabase/20_lead_client_type.sql` para asegurar la columna de clasificación residencial/empresarial.
21. Ejecuta `supabase/21_lead_price_adjustments.sql` para guardar precio base, ajuste por m², precio final y diferencia por cotización.
22. Ejecuta `supabase/22_quote_document_fields.sql` para guardar los datos editables del formato de cotización PDF.
23. Ejecuta `supabase/23_security_hardening.sql` después de aplicar las migraciones anteriores y antes de habilitar el registro público. En instalaciones existentes, aplícala cuanto antes después de `06`; elimina políticas permisivas heredadas sin borrar las políticas específicas por rol. Si la migración `06` aún no se había aplicado, aplícala primero para restablecer los permisos normales.
24. En Supabase → Edge Functions → Secrets agrega `N8N_WEBHOOK_URL` y `N8N_WEBHOOK_SECRET` para que los vendedores puedan enviar WhatsApp desde el CRM.
25. Local: configura `VITE_SUPABASE_URL` y `VITE_SUPABASE_ANON_KEY`, luego ejecuta `npm install` y `npm run dev`. En Vercel configura las mismas variables para los entornos que publiques.

En Leads, **Dueño de comisión** conserva el asesor original (`leads.asesor`); **Seguimiento a cargo de** es la persona que dará seguimiento (`leads.followup_assigned_to`). El banner del Dashboard y Leads avisa al dueño original cuando otro vendedor atiende su cliente. La agenda de hoy se agrupa por quien tiene asignado el seguimiento.

En Leads, **Tipo de cliente** usa `leads.tipo_aplicacion`: `Residencial` o `Empresarial`. Los datos importados conservan su valor; los registros sin clasificación se pueden actualizar desde la fila y filtrar como **Sin clasificar**.

En las cotizaciones, **Sistema / presentación** usa una sola selección. El ajuste por m² se guarda en cada lead junto con el precio base, precio final y diferencia total calculada después del mínimo; el reporte muestra al cliente solo el precio final. Las especificaciones y observaciones del servicio se pueden editar, se guardan en el cliente y aparecen en el PDF.

## Permisos
- `root`: todos los módulos, aprobación de usuarios y auditoría.
- `sales`: dashboard comercial, leads e Inbox; puede consultar precios.
- `operations`: visitas, instalaciones, mantenimiento e inventario operativo.
- `administrative`: lectura de todos los módulos; puede crear leads y editar tarifas, productos, inventario, visitas, instalaciones, cierres, finanzas y caja chica. No edita ni elimina leads existentes.
- `manager` (gerente): consulta y reportes; puede crear leads, pero no editar ni eliminar registros existentes.
- `sales` solo ve y edita los leads donde es dueño de la comisión o tiene asignado el seguimiento (migración 24).

Los cambios de filas se registran en `public.security_events`, visible solo para root. Los intentos de inicio de sesión fallidos se consultan en Supabase Auth Logs. Los rechazos de políticas RLS y eventos de infraestructura requieren un Log Drain para centralizarlos; no se pueden registrar de forma confiable desde el navegador. La bitácora de la app guarda metadatos, no el contenido completo de los registros.

## Perfil y conexión Gmail
1. En Google Cloud configura un OAuth Client ID tipo Web y agrega como URI de redirección autorizada `https://<project-ref>.supabase.co/functions/v1/gmail-connect`.
2. Habilita la pantalla de consentimiento OAuth y agrega como usuarios de prueba a quienes conectarán su correo. La integración solicita `gmail.readonly` y `gmail.send`; Google puede requerir verificación para publicar estos permisos.
3. En Supabase → Edge Functions → Secrets configura `GMAIL_OAUTH_CLIENT_ID`, `GMAIL_OAUTH_CLIENT_SECRET`, `GMAIL_OAUTH_STATE_SECRET`, `GMAIL_TOKEN_ENCRYPTION_KEY` y `APP_URL`. `APP_URL` debe ser el origen exacto del CRM. La clave de cifrado debe ser 32 bytes codificados en Base64; genera y conserva los secretos fuera del cliente.
4. Despliega con `supabase functions deploy gmail-connect --no-verify-jwt`. El callback OAuth llega sin JWT; la función verifica por sí misma la sesión para acciones de usuario y firma/valida el estado del callback.

Las fotos se guardan en un bucket privado, y cada usuario solo puede cambiar sus propios datos. Los refresh tokens Gmail se cifran en servidor y nunca se devuelven al navegador.

## WhatsApp con n8n · Fase 2
La API vive en Supabase Edge Functions: `https://<project-ref>.supabase.co/functions/v1/bot-api`. Configura `CRM_API_KEY` en Supabase → Edge Functions → Secrets. Supabase proporciona `SUPABASE_URL` y `SUPABASE_SERVICE_ROLE_KEY` al runtime de la función; no las agregues al frontend ni al repositorio. `N8N_WEBHOOK_URL` y `N8N_WEBHOOK_SECRET` se usarán en la Fase 3 para mensajes iniciados por vendedores.

Despliega después de aplicar `supabase/15_whatsapp_phase1.sql` y `supabase/16_whatsapp_bot_api.sql`:

```sh
supabase functions deploy bot-api
```

La API limita a 120 solicitudes por minuto y por IP. Ejemplos para Bash o Git Bash:

```sh
export SUPABASE_URL="https://<project-ref>.supabase.co"
export CRM_API_KEY="<CRM_API_KEY>"

# Ingresar un mensaje. Repite exactamente esta petición para probar que el wa_message_id no duplica.
curl -X POST "$SUPABASE_URL/functions/v1/bot-api/messages" \
	-H "x-api-key: $CRM_API_KEY" -H "Content-Type: application/json" \
	-d '{"phone":"+5215551234567","name":"Cliente de prueba","wa_message_id":"wamid.test-001","direction":"in","sender":"cliente","type":"text","body":"Hola","is_test":true}'

# Registrar handoff.
curl -X POST "$SUPABASE_URL/functions/v1/bot-api/events" \
	-H "x-api-key: $CRM_API_KEY" -H "Content-Type: application/json" \
	-d '{"phone":"+5215551234567","type":"handoff","payload":{"origen":"n8n"}}'

# Consultar si n8n debe responder. El signo + debe ir codificado como %2B.
curl --path-as-is "$SUPABASE_URL/functions/v1/bot-api/conversations/%2B5215551234567/state" \
	-H "x-api-key: $CRM_API_KEY"

# API key incorrecta: debe responder 401.
curl -i "$SUPABASE_URL/functions/v1/bot-api/conversations/%2B5215551234567/state" \
	-H "x-api-key: incorrecta"
```

## Conversaciones para vendedores · Fase 3
Despliega la API autenticada con `supabase functions deploy crm-conversations`. Todas las rutas requieren la sesión de Supabase del usuario. La URL base es `https://<project-ref>.supabase.co/functions/v1/crm-conversations`:

- `GET /conversations`: filtros `status`, `assigned_to`, `desde`, `hasta` y `q`; Ventas solo recibe sus conversaciones asignadas. Los chats de prueba se excluyen por defecto; usa `?test=true` solo para consultarlos.
- `GET /conversations/{id}`: mensajes, eventos y datos del lead.
- `PATCH /conversations/{id}/lead`: edita `lead` y opcionalmente `assigned_to`.
- `POST /conversations/{id}/status`: acepta `bot`, `humano` o `cerrada` y registra pausa/reanudación.
- `POST /conversations/{id}/send`: acepta `{ "text": "..." }`, reenvía por `N8N_WEBHOOK_URL` con `x-secret` y devuelve `409` si ya pasó la ventana de 24 horas. n8n debe devolver `wa_message_id` en su JSON de respuesta para conservar el mismo ID en el historial.

## Google Calendar y avisos
1. Habilita **Google Calendar API** en el proyecto de Google Cloud. Si `gcloud services enable` responde `429 RESOURCE_EXHAUSTED`, revisa primero si Calendar API ya aparece habilitada y vuelve a intentar una sola vez cuando se libere el límite de solicitudes.
2. Configura la pantalla OAuth como **Externa**, agrega el correo del jefe como usuario de prueba y crea un OAuth Client ID tipo Web. Agrega `https://developers.google.com/oauthplayground` como URI de redirección autorizada.
3. En OAuth Playground → ⚙, activa **Use your own OAuth credentials** y pega el Client ID/Secret. Autoriza `https://www.googleapis.com/auth/calendar.events` usando la cuenta del jefe y canjea el código por tokens. Conserva el **Refresh Token** en secreto. En modo Testing, los refresh tokens con permisos de Calendar expiran a los 7 días; para uso continuo configura la publicación/verificación OAuth de Google.
4. Obtén el Calendar ID del calendario del jefe (puede ser `primary`) y verifica un remitente en Resend.
5. En Supabase → Edge Functions → Secrets configura `GOOGLE_OAUTH_CLIENT_ID`, `GOOGLE_OAUTH_CLIENT_SECRET`, `GOOGLE_OAUTH_REFRESH_TOKEN`, `GOOGLE_CALENDAR_ID`, `BOSS_EMAIL`, `RESEND_API_KEY` y `NOTIFICATION_FROM_EMAIL`. Nunca guardes estos valores en React ni los compartas por chat.
6. Despliega desde la raíz del proyecto: `supabase functions deploy schedule-confirmed-lead`. Supabase proporciona `SUPABASE_URL`, `SUPABASE_ANON_KEY` y `SUPABASE_SERVICE_ROLE_KEY` a la función.

Al cambiar un lead a **Confirmado**, el CRM pide fecha, duración y lugar. Luego crea o actualiza el evento de Google Calendar y notifica al jefe y al vendedor asignado. Los errores del correo dejan la cita guardada y permiten reintentar sin duplicar el evento.


## Cierres, finanzas, caja chica y stock por medición (migraciones 24–31)
Ejecuta en orden, después de `23_security_hardening.sql` y revisando antes cuáles ya están aplicadas:

24. `24_manager_role_and_sales_scope.sql`: rol `manager` y Ventas limitado a sus propios leads, visitas, obras e historial de contacto. Ventas deja de leer garantías.
25. `25_finance_ledger.sql`: categorías libres (fijo/variable), libro de ingresos y egresos y bucket privado `comprobantes` (comprobante opcional).
26. `26_visits_closings_and_installations.sql`: al pasar un lead a **Visita** se crea la visita; al pasar a **Venta cerrada** se crea un cierre pendiente. Administrativo confirma agenda y anticipo (recibido, perdonado con motivo o pendiente) y **hasta entonces** se crea la obra en Instalaciones. Un anticipo recibido se registra solo como ingreso. Incluye recuperación de leads que ya estaban en esos estados. Administrativo también puede editar Visitas e Instalaciones.
27. `27_petty_cash.sql`: caja chica y viáticos. Los viáticos y gastos generan solos un egreso en el libro; reposición y devolución no cuentan como gasto.
28. `28_barrel_level_measurements.sql`: el técnico captura la altura medida con regla (cm) y el sistema calcula litros con la capacidad y altura de cada barril (por defecto 200 L y 100 cm; editables por barril). Mínimos de isocianato y poliol en `stock_minimos` (0 = sin aviso).
29. `29_supplies_inventory.sql`: EPP, herramientas y consumibles con cantidad y mínimo.
30. `30_finance_reports.sql`: vista mensual para Reportes y exportación a CSV para el contador.
31. `31_manager_admin_lead_creation.sql`: permite a Gerente y Administrativo crear leads; no habilita la edición ni eliminación de leads existentes.

Para dar el rol de gerente, root lo asigna desde **Usuarios** (Gerente · consulta y reportes). No requiere cambios en las Edge Functions ni nuevos secretos.
