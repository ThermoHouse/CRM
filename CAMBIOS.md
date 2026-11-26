# Dashboard ejecutivo (propuesta A) · Nexus Admin

Sin migraciones SQL nuevas y sin dependencias nuevas. Copia los 3 archivos de `src/` sobre los de tu repo (mismas rutas) y ejecuta `npm run dev`.

## Archivos
- `src/ExecutiveDashboard.jsx` (NUEVO): el dashboard completo.
- `src/App.jsx` (MODIFICADO, 3 cambios): importa el componente, agrega `ExecutiveHome` y cambia la pestaña Dashboard.
- `src/styles.css` (MODIFICADO): se agregó un bloque `.xd-*` al final; no se tocó nada existente.

## Quién lo ve
- Root, Gerente y Administrativo: nuevo Resumen ejecutivo. Arriba hay un botón "Leads y llamadas" que abre el dashboard anterior (con llamadas del día y alta de plazas para root), así no se pierde nada.
- Ventas: sigue con su dashboard de siempre, sin cambios.
- Gerente y Administrativo solo consultan; el dashboard no escribe en la base de datos.

## Periodos
Semana, Mes, Trimestre, Semestre y Año (los últimos 7, 30, 90, 180 y 365 días). Cada tarjeta se compara con el periodo anterior de la misma duración. La elección se recuerda en la sesión. Se actualiza solo cada 5 minutos y con el botón Actualizar.

Dependen del periodo: ingresos, egresos, utilidad, gráfica, egresos por categoría, ventas, conversión, embudo, vendedores, visitas realizadas e instalaciones.
Son del estado de hoy: caja chica, alertas, stock e instalaciones próximas (7 días).

## De dónde salen los datos
leads · lead_audit (opcional) · movimientos_financieros_vigentes · caja_chica_saldo · stock_resumen · impermeabilizante_movimientos · visitas · obras · garantias · cierres · list_finance_change_requests (RPC).
Si una fuente falla (por ejemplo, una migración sin aplicar), el resto sigue funcionando y se muestra un aviso con el nombre de la sección.

## Definiciones
- Venta cerrada: lead que hoy está en estado "cerrado". Cuenta en el periodo en que se cerró, tomando la fecha del historial de estados (`lead_audit`), si no existe la del cierre (`cierres`) y si no el último movimiento del lead. Así una venta de un lead viejo cuenta cuando se cerró, no cuando entró.
- Vendedores: leads nuevos del periodo y ventas cerradas en el periodo, por vendedor. Si un vendedor no está en el directorio de Ventas (por ejemplo, root, administrativo o gerente que capturó el lead), se muestra su correo en lugar de "Nombre no disponible".
- Conversión: ventas cerradas del periodo entre leads nuevos del periodo.
- Embudo: leads nuevos del periodo y hasta dónde llegaron según su estado actual (Leads, Contactados, Interesados, Con visita, Cerrados).
- Las alertas llevan a la pestaña correspondiente al hacer clic.

## Nota
El dashboard anterior contaba "Seguimientos vencidos" con `x.flag`, pero `buildAlerts` devuelve `flags` (arreglo), así que ese número siempre salía 0. El nuevo ya usa `flags` y calcula bien los vencidos.
