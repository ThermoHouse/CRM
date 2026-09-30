# Nexus Admin (CRM ThermoHouse)
1. Supabase: crea un proyecto y ejecuta `supabase/schema.sql` desde SQL Editor. En Authentication → Users crea tu usuario administrador inicial.
2. Si usas las funciones del blueprint, ejecuta `supabase/04_blueprint.sql`.
3. Ejecuta `supabase/05_access_requests.sql` después de las demás migraciones. Los usuarios existentes conservan acceso como miembros; las nuevas solicitudes quedan pendientes sin rol.
4. En Supabase Authentication → Providers → Email, habilita el registro de usuarios para que el equipo pueda solicitar acceso.
5. Local: configura `VITE_SUPABASE_URL` y `VITE_SUPABASE_ANON_KEY`, luego ejecuta `npm install` y `npm run dev`.
6. Vercel: importa el repo (framework Vite) y agrega `VITE_SUPABASE_URL` y `VITE_SUPABASE_ANON_KEY`.

## Aprobar solicitudes
Revisa al miembro y asigna el rol apropiado desde SQL Editor. Asignar un rol habilita su acceso al panel y a los datos.

```sql
update public.profiles
set role = 'member'
where id = (select id from auth.users where email = 'persona@empresa.com')
	and role is null;
```

El campo `full_name` y el área declarada quedan guardados en `public.profiles` para revisión.
