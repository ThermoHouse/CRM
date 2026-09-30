# Nexus Admin (CRM ThermoHouse)
1. Supabase: crea un proyecto → SQL Editor → pega y ejecuta `supabase/schema.sql`. En Authentication → Users crea tu usuario.
2. Local: `cp .env.example .env` (URL y anon key en Settings → API), luego `npm i && npm run dev`.
3. GitHub: `git init && git add . && git commit -m "init" && git branch -M main && git remote add origin <repo> && git push -u origin main`.
4. Vercel: Import del repo (framework Vite) → agrega VITE_SUPABASE_URL y VITE_SUPABASE_ANON_KEY → Deploy.

## Avance 2 (blueprint)
5. Supabase → SQL Editor: ejecuta `supabase/04_blueprint.sql` (estado "visitado", auditoría, inventario inmutable, garantía automática al entregar obra, función `marcar_rescatar`).
6. Novedades: tema claro/oscuro, Dashboard completo con filtros de plaza y periodo, WhatsApp directo, Convertir del Inbox a lead, Visitas → "Visitado", PDF sin campos vacíos.
Pendiente: RLS por plaza, vista Barriles/Registro inmutable/ADN, roles, recordatorios de mantenimiento, webhook del bot.
