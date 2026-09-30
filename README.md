# Nexus Admin (CRM ThermoHouse)
1. Supabase: ejecuta `supabase/schema.sql` desde SQL Editor. En Authentication → Users crea la cuenta inicial de root.
2. Si usas el blueprint, ejecuta `supabase/04_blueprint.sql`; después ejecuta siempre `supabase/05_access_requests.sql` para crear perfiles y habilitar solicitudes.
3. Ejecuta `supabase/06_roles_and_audit.sql` al final. Esta migración deja sin rol a las cuentas antiguas `member`; asigna root inmediatamente con el paso siguiente.
4. En SQL Editor, reemplaza el correo por el de la cuenta que será root y ejecuta:

```sql
update public.profiles
set role = 'root'
where email = 'root@empresa.com';
```

5. Reinicia la sesión de la app. Root podrá asignar `sales`, `operations` o `administrative` desde la pestaña **Usuarios**.
6. En Authentication → Providers → Email, habilita el registro para que el equipo solicite acceso.
7. Local: configura `VITE_SUPABASE_URL` y `VITE_SUPABASE_ANON_KEY`, luego ejecuta `npm install` y `npm run dev`. En Vercel configura las mismas variables para los entornos que publiques.

## Permisos
- `root`: todos los módulos, aprobación de usuarios y auditoría.
- `sales`: dashboard comercial, leads e Inbox; puede consultar precios.
- `operations`: visitas, instalaciones, mantenimiento e inventario operativo.
- `administrative`: lectura de todos los módulos actuales; edición de tarifas, productos e inventario.

Los cambios de filas se registran en `public.security_events`, visible solo para root. Los intentos de inicio de sesión fallidos se consultan en Supabase Auth Logs. Los rechazos de políticas RLS y eventos de infraestructura requieren un Log Drain para centralizarlos; no se pueden registrar de forma confiable desde el navegador. La bitácora de la app guarda metadatos, no el contenido completo de los registros.
