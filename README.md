# Nexus Admin (CRM ThermoHouse)
1. Supabase: ejecuta `supabase/schema.sql` desde SQL Editor. En Authentication → Users crea la cuenta inicial que después será root.
2. Si usas el blueprint, ejecuta `supabase/04_blueprint.sql`; después ejecuta siempre `supabase/05_access_requests.sql` para crear perfiles y habilitar solicitudes.
3. Ejecuta `supabase/06_roles_and_audit.sql` al final. Si esa migración encuentra exactamente una cuenta, la promueve automáticamente a `root`.
4. Si necesitas promover un correo específico, ejecuta `supabase/07_promote_root.sql` después de `06`. El script verifica que exista exactamente una cuenta con ese correo; no crea usuarios ni modifica contraseñas. También puedes asignar otro root desde **Usuarios** una vez que el primero entre al panel.
5. Ejecuta `supabase/08_plazas.sql` después de `06`. Crea la plaza Morelos, agrega la columna de plaza a leads y sincroniza las opciones del inventario.
6. Ejecuta `supabase/09_lead_followups.sql` después de `08` para habilitar los nuevos estados del semáforo y las fechas de llamada.
7. Ejecuta `supabase/10_sales_directory.sql` para que filtros e informes muestren nombres de vendedores sin exponer sus correos.
8. Ejecuta `supabase/11_fix_lead_audit_trigger.sql` para que los cambios de estado de leads escriban su bitácora de forma segura.
9. Ejecuta `supabase/12_calendar_appointments.sql` para guardar citas de Google Calendar en los leads.
10. Ejecuta `supabase/13_dashboard_corrections.sql` para dejar activa únicamente la plaza Morelos (sin borrar las demás), agregar vendedor y revisitas, y habilitar precio máximo.
11. Solo si ya hay varias cuentas y quieres elegir otra manualmente, asigna root en SQL Editor, reemplazando el correo:

```sql
update public.profiles
set role = 'root'
where email = 'root@empresa.com';
```

12. Reinicia la sesión de la app. Root podrá asignar `sales`, `operations` o `administrative` desde la pestaña **Usuarios**.
13. En Authentication → Providers → Email, habilita el registro para que el equipo solicite acceso.
14. Local: configura `VITE_SUPABASE_URL` y `VITE_SUPABASE_ANON_KEY`, luego ejecuta `npm install` y `npm run dev`. En Vercel configura las mismas variables para los entornos que publiques.

## Permisos
- `root`: todos los módulos, aprobación de usuarios y auditoría.
- `sales`: dashboard comercial, leads e Inbox; puede consultar precios.
- `operations`: visitas, instalaciones, mantenimiento e inventario operativo.
- `administrative`: lectura de todos los módulos actuales; edición de tarifas, productos e inventario.

Los cambios de filas se registran en `public.security_events`, visible solo para root. Los intentos de inicio de sesión fallidos se consultan en Supabase Auth Logs. Los rechazos de políticas RLS y eventos de infraestructura requieren un Log Drain para centralizarlos; no se pueden registrar de forma confiable desde el navegador. La bitácora de la app guarda metadatos, no el contenido completo de los registros.

## Google Calendar y avisos
1. Habilita **Google Calendar API** en el proyecto de Google Cloud. Si `gcloud services enable` responde `429 RESOURCE_EXHAUSTED`, revisa primero si Calendar API ya aparece habilitada y vuelve a intentar una sola vez cuando se libere el límite de solicitudes.
2. Configura la pantalla OAuth como **Externa**, agrega el correo del jefe como usuario de prueba y crea un OAuth Client ID tipo Web. Agrega `https://developers.google.com/oauthplayground` como URI de redirección autorizada.
3. En OAuth Playground → ⚙, activa **Use your own OAuth credentials** y pega el Client ID/Secret. Autoriza `https://www.googleapis.com/auth/calendar.events` usando la cuenta del jefe y canjea el código por tokens. Conserva el **Refresh Token** en secreto. En modo Testing, los refresh tokens con permisos de Calendar expiran a los 7 días; para uso continuo configura la publicación/verificación OAuth de Google.
4. Obtén el Calendar ID del calendario del jefe (puede ser `primary`) y verifica un remitente en Resend.
5. En Supabase → Edge Functions → Secrets configura `GOOGLE_OAUTH_CLIENT_ID`, `GOOGLE_OAUTH_CLIENT_SECRET`, `GOOGLE_OAUTH_REFRESH_TOKEN`, `GOOGLE_CALENDAR_ID`, `BOSS_EMAIL`, `RESEND_API_KEY` y `NOTIFICATION_FROM_EMAIL`. Nunca guardes estos valores en React ni los compartas por chat.
6. Despliega desde la raíz del proyecto: `supabase functions deploy schedule-confirmed-lead`. Supabase proporciona `SUPABASE_URL`, `SUPABASE_ANON_KEY` y `SUPABASE_SERVICE_ROLE_KEY` a la función.

Al cambiar un lead a **Confirmado**, el CRM pide fecha, duración y lugar. Luego crea o actualiza el evento de Google Calendar y notifica al jefe y al vendedor asignado. Los errores del correo dejan la cita guardada y permiten reintentar sin duplicar el evento.
