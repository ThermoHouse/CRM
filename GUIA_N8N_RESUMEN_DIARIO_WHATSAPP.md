# Resumen diario del CRM por WhatsApp: CRM + Supabase + n8n + OpenWha

Esta integración entrega un resumen diario agregado del CRM a un número autorizado por WhatsApp. El flujo será:

```text
n8n (Schedule Trigger)
  → Supabase Edge Function daily-dashboard-summary
  → OpenWha (envía el mensaje al destinatario configurado)
```

La función devuelve conteos, no nombres, teléfonos ni detalles personales de los leads. No se debe poner `SUPABASE_SERVICE_ROLE_KEY` en n8n, Vercel o el frontend.

## Piezas ya preparadas en el repositorio

- Edge Function: [`supabase/functions/daily-dashboard-summary/index.ts`](./supabase/functions/daily-dashboard-summary/index.ts)
- Configuración de Supabase: [`supabase/config.toml`](./supabase/config.toml) ya declara `verify_jwt = false` para esta función. La llamada se protege con el secreto `x-cron-secret`, que la propia función valida.

El resumen utiliza la zona `America/Mexico_City` e incluye:

- leads creados hoy;
- llamadas de seguimiento programadas para hoy;
- llamadas vencidas por 24 horas o más (excluye `contactado`, `cerrado` y `no`);
- conteo actual de leads por estado.

No se calcula “cierres de hoy”: el CRM no conserva un historial uniforme de todos los cambios a estado cerrado que permita afirmarlo correctamente.

## A. Supabase: desplegar la función

### 1. Preparar Supabase CLI y vincular el proyecto

Desde PowerShell, en la carpeta raíz del repo:

```powershell
supabase login
supabase link --project-ref <PROJECT_REF>
```

`PROJECT_REF` es la referencia de tu proyecto Supabase (la encuentras en el dashboard del proyecto o en su URL).

### 2. Crear el secreto compartido

Genera un secreto aleatorio largo (al menos 32 bytes). Puedes generar uno localmente con Node:

```powershell
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

Guárdalo en un gestor de contraseñas y configúralo en Supabase:

```powershell
supabase secrets set DAILY_SUMMARY_CRON_SECRET="<PEGA_AQUI_EL_SECRETO>"
```

Este mismo valor se configurará como credencial/variable protegida en n8n. No lo guardes en el repositorio, archivos del frontend ni Vercel.

Supabase proporciona automáticamente `SUPABASE_URL` y `SUPABASE_SERVICE_ROLE_KEY` al runtime Edge. No copies la `service_role` a n8n ni al navegador.

### 3. Desplegar

```powershell
supabase functions deploy daily-dashboard-summary
```

La URL queda así:

```text
https://<PROJECT_REF>.supabase.co/functions/v1/daily-dashboard-summary
```

La configuración `verify_jwt = false` está en `supabase/config.toml`; esto permite la llamada de n8n sin sesión interactiva. La función **no es pública sin protección**: exige el header `x-cron-secret`.

### 4. Probar desde PowerShell

Usa una ventana local y no pegues el secreto en capturas o chats:

```powershell
$headers = @{
  "Content-Type" = "application/json"
  "x-cron-secret" = "<EL_MISMO_SECRETO_CONFIGURADO_EN_SUPABASE>"
  "apikey" = "<SUPABASE_ANON_O_PUBLISHABLE_KEY>"
}
Invoke-RestMethod `
  -Method Post `
  -Uri "https://<PROJECT_REF>.supabase.co/functions/v1/daily-dashboard-summary" `
  -Headers $headers `
  -Body "{}"
```

Respuesta esperada (valores de ejemplo):

```json
{
  "date": "2026-11-25",
  "time_zone": "America/Mexico_City",
  "metrics": {
    "new_today": 4,
    "calls_today": 7,
    "overdue_calls": 2
  },
  "status_counts": {
    "nuevo": 10,
    "cerrado": 8
  },
  "message": "📊 Resumen diario CRM · miércoles, 25 de noviembre de 2026\n..."
}
```

Los números son ilustrativos, no son datos reales. Si recibes `401`, comprueba el secreto. `503` indica configuración ausente. Para `500`, revisa los logs de la Edge Function en Supabase.

## B. n8n: configurar la automatización

Crea un workflow con estos nodos, conectados en este orden:

```text
Schedule Trigger → HTTP Request “Resumen diario CRM” → OpenWha “Enviar WhatsApp”
```

### Nodo 1: Schedule Trigger

1. Añade **Schedule Trigger**.
2. Selecciona ejecución diaria y define la hora.
3. Configura la zona horaria del workflow como `America/Mexico_City`.
4. No actives el workflow hasta terminar las pruebas manuales.

### Nodo 2: HTTP Request “Resumen diario CRM”

Configura:

- **Method:** `POST`
- **URL:** `https://<PROJECT_REF>.supabase.co/functions/v1/daily-dashboard-summary`
- **Send Body:** sí; JSON `{}`.
- **Headers:**
  - `Content-Type` → `application/json`
  - `x-cron-secret` → el secreto `DAILY_SUMMARY_CRON_SECRET`
  - `apikey` → la clave anon/publishable del proyecto Supabase si el gateway la pide; nunca `service_role`.

Guarda el secreto usando **Credentials** o el almacén seguro de variables de tu instancia n8n. No exportes un workflow con credenciales en texto.

Ejecuta este nodo manualmente y verifica que el JSON de salida incluya `message`, `date` y `metrics`. Continúa solo si devuelve HTTP 200.

### Nodo 3: OpenWha “Enviar WhatsApp”

1. Agrega el nodo OpenWha instalado en tu instancia y selecciona su operación de envío de texto.
2. Configura las credenciales/instancia de OpenWha en n8n.
3. En el destinatario, usa el número autorizado con lada internacional (por ejemplo, `+52...`); si OpenWha pide solo dígitos, respeta su formato.
4. En el campo mensaje/texto usa la expresión:

```text
{{$node["Resumen diario CRM"].json["message"]}}
```

Si el nodo recibe directamente la salida del HTTP Request, también puedes usar `{{$json.message}}`.

Los nombres exactos de los campos dependen de la versión del nodo OpenWha instalada. No inventes una URL de API: si el nodo no ofrece envío de texto, usa un nodo HTTP Request con el endpoint y formato indicados por la documentación de **tu instancia** OpenWha.

Prueba primero con tu propio número autorizado. Cuando el mensaje sea correcto, activa el workflow y revisa **Executions** después de la primera ejecución programada.

### Evitar mensajes duplicados

Si el workflow reintenta una ejecución, puede enviar el mismo resumen otra vez. Para evitarlo, guarda `date` en un Data Store de n8n: antes de enviar, verifica que esa fecha no esté registrada; regístrala solo cuando OpenWha confirme el envío.

## C. Vercel: qué configurar y qué no

La Edge Function se ejecuta en **Supabase**, no en Vercel, y n8n llama directamente a Supabase. Por eso:

- **No agregues** `DAILY_SUMMARY_CRON_SECRET`, credenciales de OpenWha ni `SUPABASE_SERVICE_ROLE_KEY` a las variables de Vercel.
- No necesitas cambiar el frontend para que n8n lea el resumen.
- Mantén en Vercel las variables actuales del frontend:
  - `VITE_SUPABASE_URL`
  - `VITE_SUPABASE_ANON_KEY`

Pasos recomendados:

1. En Vercel, abre el proyecto del CRM → **Settings → Environment Variables**.
2. Comprueba que las dos variables `VITE_...` estén definidas para los entornos que usas (Production, Preview y/o Development). La clave debe ser anon/publishable; nunca `service_role`.
3. Si no cambiaste frontend ni esas variables, **no necesitas redeploy de Vercel** para activar este flujo.
4. Si actualizaste variables o desplegaste cambios del frontend, guarda y haz un nuevo deploy (Deployments → **Redeploy**) para los entornos correspondientes.
5. Si tu dominio de Vercel también se usa para iniciar sesión, revisa Supabase → **Authentication → URL Configuration** y agrega el dominio de producción a **Site URL/Redirect URLs**. Esto es para el login del CRM; no cambia el endpoint que usa n8n.

La configuración de la función (`DAILY_SUMMARY_CRON_SECRET`) y el despliegue ocurren únicamente en Supabase. La programación y las credenciales de OpenWha ocurren únicamente en n8n.

## D. Seguridad y diagnóstico

- Restringe el número receptor a personal autorizado; aplica las reglas de plantillas de WhatsApp/OpenWha para mensajes iniciados por la empresa cuando correspondan.
- Rota el secreto si se expone y actualízalo tanto en Supabase como en n8n.
- La función solo selecciona campos necesarios para conteos y no devuelve datos de clientes. No añadas nombres/teléfonos al texto si el grupo de destino no está autorizado.
- Los avisos de `contentscript.js`, `ObjectMultiplex` y `MaxListenersExceededWarning` del navegador suelen ser de extensiones; no intervienen en esta integración.

| Problema | Qué revisar |
|---|---|
| `401 No autorizado` | `x-cron-secret` debe coincidir exactamente con el secreto de Supabase. |
| `503` | Falta `DAILY_SUMMARY_CRON_SECRET` o configuración runtime de Supabase. |
| `500` | Revisa logs de la Edge Function y disponibilidad/API de Supabase. |
| HTTP Request funciona, OpenWha falla | Credenciales, sesión de la instancia y formato del destinatario en OpenWha. |
| No se ejecuta a la hora indicada | Zona horaria, workflow activo y zona horaria del servidor n8n. |
| Llegan duplicados | Añade verificación de `date` antes del nodo de envío y revisa reintentos. |
