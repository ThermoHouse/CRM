# Descripción del sistema Nexus Admin / ThermoHouse CRM

## Propósito y alcance

Este repositorio contiene un CRM web para ThermoHouse. Permite gestionar clientes potenciales, cotizaciones, seguimiento comercial y operación de instalaciones, además de administrar usuarios, precios, inventario e integraciones.

Esta descripción corresponde al código y a los scripts presentes en el repositorio. Que una función esté documentada o tenga una migración no significa necesariamente que esté habilitada en producción: algunas funciones requieren aplicar SQL, desplegar una Supabase Edge Function, configurar secretos externos o programar una tarea.

## Arquitectura

- **Frontend:** aplicación de una sola página construida con React 18 y Vite. La entrada es `src/main.jsx`; la aplicación, pantallas y lógica de interfaz están principalmente en `src/App.jsx`.
- **Backend y datos:** Supabase proporciona autenticación, PostgreSQL, políticas de seguridad por fila (RLS), RPC y Edge Functions.
- **Conexión desde el navegador:** `src/supabase.js` inicializa el cliente con `VITE_SUPABASE_URL` y `VITE_SUPABASE_ANON_KEY`. Las credenciales privilegiadas y secretos de integraciones deben permanecer en el servidor, nunca en el frontend.
- **Base de datos:** `supabase/schema.sql` define el esquema inicial. Los archivos numerados en `supabase/` amplían ese esquema de forma incremental.
- **Edge Functions:** `supabase/functions/` contiene servicios para WhatsApp, Gmail y la agenda de visitas confirmadas.

## Acceso, autenticación y permisos

El usuario inicia sesión con correo y contraseña mediante Supabase Auth. También puede solicitar acceso creando una cuenta; hasta que un administrador le asigne un rol, la cuenta queda pendiente y no puede entrar a los módulos.

Los roles del CRM son:

| Rol | Acceso funcional |
|---|---|
| `root` | Todos los módulos; administración de usuarios, plazas y auditoría. |
| `sales` | Dashboard comercial, Leads, Desglose, Inbox Bot y Perfil. Solo ve y edita sus propios leads (dueño de comisión o seguimiento asignado). |
| `operations` | Visitas, Instalaciones, Mantenimiento, Inventario y Perfil. |
| `administrative` | Consulta de todos los módulos; puede crear leads y administra precios, productos, inventario, visitas, instalaciones, cierres, finanzas y caja chica. No edita ni elimina leads existentes. Inbox Bot es de solo lectura. |
| `manager` | Gerente: consulta y reportes; puede crear leads, pero no editar ni eliminar registros existentes. |

La interfaz oculta los módulos no autorizados y pone en modo de solo lectura las pantallas correspondientes. La seguridad de los datos no depende solo de la interfaz: las migraciones configuran RLS y funciones/políticas en PostgreSQL. El esquema base y la migración de solicitudes de acceso dejan las tablas sin acceso hasta que la migración de roles instale políticas específicas; la migración 23 elimina políticas permisivas heredadas. La asignación de roles se realiza desde **Usuarios** para root. El primer root debe asignarse explícitamente siguiendo las instrucciones del README; el sistema no lo elige automáticamente por ser la única cuenta.

## Módulos y funciones

### Dashboard

- Resume información comercial y permite analizar leads por filtros de plaza, zona, asesor y periodo.
- Incluye datos de actividad y seguimiento, como llamadas y agenda del día, según las migraciones aplicadas.
- Muestra avisos de seguimiento compartido: el asesor original conserva la comisión y el vendedor asignado atiende al cliente.
- Root puede administrar plazas desde la pantalla de filtros.

### Leads y cotizaciones

Es el módulo principal de trabajo comercial. Permite consultar, crear y actualizar clientes potenciales; registrar datos de contacto y ubicación; asignar plaza y asesor; clasificar al cliente como residencial o empresarial; y gestionar estado, fecha de contacto, próxima llamada y notas.

La ficha/cotización contempla, entre otros datos:

- Área, sistema o presentación, ciudad, tipo de precio y costos adicionales.
- Ajuste de precio por metro cuadrado, descuento, subtotal, IVA opcional y total.
- Medio de contacto, aplicaciones, condiciones del techo, suministros y objetos en techo.
- Especificaciones del servicio, observaciones y datos fiscales.
- Vista de reporte/cotización preparada para impresión o generación de PDF desde el navegador.

El semáforo de seguimiento usa estados como nuevo, no contestó, interesado, en proceso, confirmado, llamar después, contactado, visita, visitado, cerrado, por rescatar y no interesado. Los estados permitidos dependen de las migraciones que estén instaladas.

Otras acciones relacionadas incluyen:

- Registrar intentos de contacto (llamada, WhatsApp, correo u otro medio) con fecha y hora.
- Programar y actualizar llamadas de seguimiento.
- Asignar el seguimiento a otro vendedor sin cambiar al dueño original de la comisión.
- Filtrar por tipo de cliente, asesor, plaza, zona y periodo.
- Seleccionar y eliminar varios leads donde el rol lo permita.
- Abrir WhatsApp para contactar al cliente.

### Desglose de servicios profesionales

Pestaña **Desglose** (roles `root`, `sales`, `administrative` y `manager`; también se abre desde el botón **Desglose** de cada fila en Leads). Formulario interactivo que genera el documento "Descripción detallada del servicio" para el cliente, como complemento de la cotización o de forma independiente.

- Se puede **vincular un cliente existente** o **capturar todo manualmente**. Al vincular se cargan, con la etiqueta "del cliente": nombre, teléfono, correo, domicilio (dirección + C.P. + ciudad + estado), folio, fecha del presupuesto, presentación (se empata con la tabla `productos`, que también aporta el espesor), m², tipo de superficie, tono, condiciones del techo, objetos, 220V (voltaje/suministros), descuento, montos separados de aplicación, destechado y viáticos/distancia (todos editables), IVA y la fecha de instalación de su obra o cierre. Los datos que no existen en el lead se llenan en el formulario; los pendientes se resaltan y se cuentan.
- La vista previa es el mismo documento que se descarga en **PDF** (A4, logo de ThermoHouse y número de página en cada hoja). Los datos sin llenar salen como línea en blanco.
- Calcula subtotal, IVA, total, anticipo del 50 %, total de horas y días en sitio. No modifica el lead.
- **Guardar** usa la tabla `service_breakdowns` (migración 34, opcional). El borrador se conserva en la sesión del navegador al cambiar de pestaña.
- Archivos: `src/ServiceBreakdown.jsx`, `src/breakdownPdf.js`, `supabase/34_service_breakdowns.sql`.

### Inbox Bot

En la interfaz actual, **Inbox Bot** es una lista operativa de entradas recibidas por el bot. Se pueden revisar o actualizar y convertir una entrada en lead; al convertirla se crea/actualiza el lead y se marca la entrada como convertida.

Este módulo no es lo mismo que la API completa de conversaciones de WhatsApp: el repositorio también contiene tablas y Edge Functions para almacenar mensajes/eventos y una API autenticada para que vendedores consulten conversaciones y envíen mensajes.

### Visitas

Administra cliente, ubicación, fecha y estado de la visita. Los usuarios de operaciones y root pueden gestionar registros y marcar una visita como realizada mediante la función de base de datos `complete_visit`.

### Instalaciones

Muestra las aplicaciones en un calendario con sus fechas de instalación y mantenimiento. Se puede crear una aplicación desde un lead con venta cerrada aún no asociado a una obra, o registrar directamente un nuevo cliente. Cada aplicación con fecha programa su mantenimiento cada 2, 3 o 4 años; la fecha se puede reagendar desde el calendario.

### Mantenimiento

Gestiona garantías y mantenimientos: cliente, folio, sistema, fecha de instalación, próximo mantenimiento, revisitas y estado. Al marcar un mantenimiento como realizado, el sistema registra la fecha y programa el ciclo siguiente con el intervalo de 2, 3 o 4 años configurado en la aplicación.

### Precios

Administra productos, presentaciones y tarifas por ciudad, incluyendo precio de contado, precio en promoción/MSI, mínimo y estado activo. Ventas puede consultar precios; root y administrativo pueden gestionarlos.

### Inventario

La pantalla operativa administra barriles por plaza, material (isocianato o resina/poliol), lote, estado, capacidad y altura. El formulario registra consumo en centímetros y calcula los litros consumidos y restantes; cada operación queda en el historial y actualiza la gráfica de existencias por químico. El mínimo configurado muestra una alerta cuando conviene comprar. Requiere la migración 33.

`inventory_movements` es un registro independiente y no se concilia automáticamente con los barriles. Los consumos registrados desde el formulario de barriles se guardan en `barril_consumos` y aplican el descuento al nivel del barril.

### Usuarios, auditoría y perfil

- **Usuarios:** root asigna roles a perfiles y habilita el acceso del equipo.
- **Auditoría:** root consulta eventos de actividad registrados por la base de datos. La bitácora guarda metadatos; no almacena una copia completa de los registros.
- **Perfil:** el usuario puede editar los datos de su perfil. La integración opcional permite conectar Gmail; las fotos se almacenan en un bucket privado y los tokens de Gmail se cifran en servidor.
- El frontend permite alternar tema claro/oscuro.

## Datos principales

El esquema inicial incluye estas entidades:

| Tabla | Uso |
|---|---|
| `leads` | Clientes potenciales, datos de contacto, presupuesto, responsable y seguimiento. |
| `bot_inbox` | Entradas recibidas desde el bot, antes o durante su conversión a lead. |
| `productos` | Catálogo de sistemas/presentaciones. |
| `tarifas` | Precios por ciudad y producto. |
| `visitas` | Visitas programadas y su estado. |
| `obras` | Instalaciones/aplicaciones y su estado. |
| `garantias` | Garantías y fechas de mantenimiento. |
| `barriles` | Inventario operativo de barriles. |

Las migraciones agregan entidades auxiliares, entre ellas `profiles` (roles y perfiles), `security_events` (auditoría), `plazas`, `lead_audit` (cambios de estado), `lead_contact_attempts`, `inventory_movements`, `gmail_connections`, y las tablas de WhatsApp `contacts`, `conversations`, `messages`, `lead_data` y `events`.

Los campos detallados de leads y las restricciones evolucionan con las migraciones. Por ejemplo, los datos de cotización se amplían en `supabase/21_lead_price_adjustments.sql` y `supabase/22_quote_document_fields.sql`.

## Automatizaciones y reglas relevantes

- **Registro de cambios de estado:** `log_status()` guarda el estado anterior y el nuevo en `lead_audit`. La migración 11 ajusta la función para que el trigger escriba la bitácora de forma segura.
- **Leads por rescatar:** `marcar_rescatar(dias)` cambia leads nuevos o contactados cuya marca `last_contact_at` supera el umbral al estado `rescatar`; el valor predeterminado es 15 días. La función SQL no programa su propia ejecución diaria: hace falta configurarla con pg_cron u otro proceso (por ejemplo, una Edge Function).
- **Mantenimiento de aplicaciones:** `32_applications_calendar_and_maintenance.sql` crea o actualiza una agenda de mantenimiento al registrar una aplicación fechada. Al marcarla como realizada, registra la fecha y programa el ciclo siguiente según el intervalo configurado.
- **Cita para lead confirmado:** la aplicación solicita los datos de agenda y la Edge Function `schedule-confirmed-lead` puede crear/actualizar un evento de Google Calendar y enviar avisos. Requiere configuración OAuth, secretos y despliegue.
- **Sincronización de visitas:** la función `complete_visit` y los triggers definidos por las migraciones mantienen el estado de finalización en la base de datos.

## Integraciones externas

### WhatsApp y n8n

- `bot-api` expone una API para registrar mensajes/eventos y consultar el estado de conversaciones desde un bot, como n8n. Usa una clave de API y límite de solicitudes; se configura y despliega por separado.
- `crm-conversations` ofrece rutas autenticadas para listar conversaciones, consultar mensajes/eventos y datos de lead, editar lead/asignación, cambiar el modo de atención (`bot`, `humano`, `cerrada`) y enviar mensajes mediante un webhook n8n.
- El envío por webhook utiliza secretos del servidor. El envío puede estar sujeto a la ventana de 24 horas de WhatsApp.
- `N8N_WEBHOOK_URL`, `N8N_WEBHOOK_SECRET` y `CRM_API_KEY` son secretos de Supabase; no deben incluirse en el frontend.

### Gmail

`gmail-connect` gestiona el flujo OAuth y la conexión del correo desde Perfil. La integración solicita permisos para leer y enviar correo. Requiere configurar credenciales OAuth, URL de la aplicación y secretos de cifrado en Supabase, además de desplegar la función.

### Google Calendar y notificaciones

`schedule-confirmed-lead` agenda leads confirmados y envía avisos al jefe y al vendedor asignado. Requiere Calendar API, OAuth, configuración del calendario y credenciales de notificación en los secretos de Supabase.

## Migraciones y puesta en marcha

El esquema inicial se crea desde `supabase/schema.sql`. Después se aplican las migraciones numeradas, siguiendo las dependencias e instrucciones de `README.md`. En términos generales:

1. `02` amplía el esquema para datos importados; `03` contiene la importación de leads de Excel.
2. `04` agrega las reglas de blueprint (bitácora, movimientos de inventario, creación de garantía y función para rescatar leads); confirmar si corresponde aplicarlo a la instancia.
3. `05`–`07` habilitan solicitudes de acceso, perfiles, roles y promoción de root.
4. `08`–`14` agregan plazas, seguimiento, directorio de ventas, agenda, correcciones de dashboard, perfiles y Gmail.
5. `15`–`19` agregan WhatsApp, API del bot, intentos de contacto y asignación de seguimiento.
6. `20`–`22` agregan tipo de cliente, ajustes de precio y datos del documento de cotización.

Las integraciones de Edge Functions requieren también despliegue y configuración de secretos. Para variables locales y configuración de publicación, revisar la guía detallada en `README.md`. No ejecutar scripts de migración en una base ya existente sin comprobar antes el estado y las instrucciones de ese entorno.

## Mapa del repositorio

- `src/App.jsx`: autenticación, roles, pantallas y flujos principales de la interfaz.
- `src/supabase.js`: cliente Supabase del navegador.
- `src/styles.css`: estilos y temas.
- `supabase/schema.sql`: esquema base.
- `supabase/*.sql`: migraciones y datos de importación.
- `supabase/functions/bot-api/`: API para el bot de WhatsApp.
- `supabase/functions/crm-conversations/`: API autenticada para conversaciones de vendedores.
- `supabase/functions/gmail-connect/`: integración OAuth de Gmail.
- `supabase/functions/schedule-confirmed-lead/`: agenda de leads confirmados y avisos.
- `README.md`: instrucciones de instalación, configuración, migraciones y despliegue.

## Consideraciones para atender una nueva petición

Antes de estimar o implementar un cambio, conviene precisar:

1. Qué rol o roles deben usar la nueva función y qué acciones pueden realizar.
2. Qué datos intervienen, dónde se capturan y qué fuente es la autoridad.
3. Si cambia el ciclo de vida de un lead, una visita, una obra, una garantía o una conversación.
4. Qué automatizaciones, auditoría, notificaciones o integraciones externas se requieren.
5. Si el cambio requiere una migración, una Edge Function, nuevos secretos o cambios solo en la interfaz.
6. Qué reglas de acceso RLS y pruebas se necesitan para validar el comportamiento.

De esta manera se puede localizar el módulo afectado y distinguir con claridad cambios de interfaz, base de datos e infraestructura.


## Cierres, finanzas, stock y reportes (migraciones 24–33)

- **Cierres:** al marcar un lead como "Venta cerrada" se crea un cierre pendiente (`cierres`). Administrativo confirma la agenda y el anticipo con `confirm_closing`; entonces se crea la obra en Instalaciones. El anticipo puede quedar recibido, perdonado (con motivo) o pendiente. Marcar "Visita" crea la visita (`visitas`) con el técnico (por defecto, el vendedor).
- **Aplicaciones y mantenimiento:** la migración 32 habilita registrar una aplicación desde un lead cerrado disponible o como nuevo cliente. La fecha aparece en el calendario y genera una agenda de mantenimiento recurrente cada 2, 3 o 4 años. Si se registra desde Instalaciones un lead que tenía un cierre pendiente, ese cierre se marca como cancelado para evitar generar una aplicación duplicada.
- **Finanzas:** `movimientos_financieros` es el libro único de ingresos y egresos, con categorías libres (`finanzas_categorias`, fijo o variable) y comprobante opcional en el bucket privado `comprobantes`. Los anticipos recibidos y los viáticos/gastos de caja chica se registran solos (`origen`).
- **Caja chica:** `caja_chica_movimientos` (reposición, viático, gasto, devolución). El saldo sale de la vista `caja_chica_saldo`. Solo se inserta; root puede borrar y el egreso del libro se retira solo.
- **Stock por medición:** `barril_mediciones` guarda la altura medida con regla y los litros calculados; `barriles` conserva el último nivel. `stock_resumen` suma litros por material y `stock_minimos` define cuándo avisar.
- **EPP y herramientas:** `articulos_inventario` con cantidad y mínimo.
- **Reportes:** vista `finanzas_resumen_mensual` y exportación CSV mensual para el contador. Gerente, administrativo y root pueden consultarlos.
