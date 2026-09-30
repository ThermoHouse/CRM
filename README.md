# Nexus Admin (CRM ThermoHouse)
1. Supabase: ejecuta `supabase/schema.sql` desde SQL Editor. En Authentication → Users crea la cuenta inicial que después será root.
2. Si usas el blueprint, ejecuta `supabase/04_blueprint.sql`; después ejecuta siempre `supabase/05_access_requests.sql` para crear perfiles y habilitar solicitudes.
3. Ejecuta `supabase/06_roles_and_audit.sql` al final. Si esa migración encuentra exactamente una cuenta, la promueve automáticamente a `root`.
4. Si necesitas promover un correo específico, ejecuta `supabase/07_promote_root.sql` después de `06`. El script verifica que exista exactamente una cuenta con ese correo; no crea usuarios ni modifica contraseñas. También puedes asignar otro root desde **Usuarios** una vez que el primero entre al panel.
5. Solo si ya hay varias cuentas y quieres elegir otra manualmente, asigna root en SQL Editor, reemplazando el correo:

```sql
update public.profiles
set role = 'root'
where email = 'root@empresa.com';
```

6. Reinicia la sesión de la app. Root podrá asignar `sales`, `operations` o `administrative` desde la pestaña **Usuarios**.
7. En Authentication → Providers → Email, habilita el registro para que el equipo solicite acceso.
8. Local: configura `VITE_SUPABASE_URL` y `VITE_SUPABASE_ANON_KEY`, luego ejecuta `npm install` y `npm run dev`. En Vercel configura las mismas variables para los entornos que publiques.

## Permisos
- `root`: todos los módulos, aprobación de usuarios y auditoría.
- `sales`: dashboard comercial, leads e Inbox; puede consultar precios.
- `operations`: visitas, instalaciones, mantenimiento e inventario operativo.
- `administrative`: lectura de todos los módulos actuales; edición de tarifas, productos e inventario.

Los cambios de filas se registran en `public.security_events`, visible solo para root. Los intentos de inicio de sesión fallidos se consultan en Supabase Auth Logs. Los rechazos de políticas RLS y eventos de infraestructura requieren un Log Drain para centralizarlos; no se pueden registrar de forma confiable desde el navegador. La bitácora de la app guarda metadatos, no el contenido completo de los registros.
