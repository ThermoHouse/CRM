import { createClient } from 'npm:@supabase/supabase-js@2.49.1';

const TIME_ZONE = 'America/Mexico_City';
const PAGE_SIZE = 1000;
const TERMINAL_STATUSES = new Set(['cerrado', 'no']);
const DAY_MS = 24 * 60 * 60 * 1000;

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      'Cache-Control': 'no-store',
      'Content-Type': 'application/json',
    },
  });
}

function dateKey(value: string | number | Date) {
  const parts = new Intl.DateTimeFormat('en', {
    timeZone: TIME_ZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(new Date(value));
  const part = (type: string) => parts.find(item => item.type === type)?.value;
  const year = part('year');
  const month = part('month');
  const day = part('day');
  if (!year || !month || !day) throw new Error('No se pudo determinar la fecha local.');
  return `${year}-${month}-${day}`;
}

function dateLabel(date: Date) {
  return new Intl.DateTimeFormat('es-MX', {
    timeZone: TIME_ZONE,
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  }).format(date);
}

async function matchesSecret(provided: string, expected: string) {
  const encoder = new TextEncoder();
  const [left, right] = await Promise.all([
    crypto.subtle.digest('SHA-256', encoder.encode(provided)),
    crypto.subtle.digest('SHA-256', encoder.encode(expected)),
  ]);
  const actual = new Uint8Array(left);
  const wanted = new Uint8Array(right);
  let difference = 0;
  for (let index = 0; index < actual.length; index += 1) difference |= actual[index] ^ wanted[index];
  return difference === 0;
}

async function loadLeads(admin: ReturnType<typeof createClient>) {
  const rows: Array<{
    id: string;
    status: string | null;
    created_at: string | null;
    next_call_at: string | null;
  }> = [];

  for (let offset = 0; ; offset += PAGE_SIZE) {
    const { data, error } = await admin
      .from('leads')
      .select('id,status,created_at,next_call_at')
      .order('id')
      .range(offset, offset + PAGE_SIZE - 1);

    if (error) throw new Error(`No se pudieron consultar los leads: ${error.message}`);
    rows.push(...(data || []));
    if (!data || data.length < PAGE_SIZE) return rows;
  }
}

Deno.serve(async request => {
  if (request.method !== 'POST') return json({ error: 'Método no permitido.' }, 405);

  const expectedSecret = Deno.env.get('DAILY_SUMMARY_CRON_SECRET');
  if (!expectedSecret) return json({ error: 'Falta configurar el secreto del resumen.' }, 503);
  if (!await matchesSecret(request.headers.get('x-cron-secret') || '', expectedSecret)) {
    return json({ error: 'No autorizado.' }, 401);
  }

  const supabaseUrl = Deno.env.get('SUPABASE_URL');
  const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  if (!supabaseUrl || !serviceRoleKey) {
    return json({ error: 'La función no está configurada.' }, 503);
  }

  try {
    const admin = createClient(supabaseUrl, serviceRoleKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const now = new Date();
    const today = dateKey(now);
    const leads = await loadLeads(admin);
    const statusCounts = new Map<string, number>();
    let newToday = 0;
    let callsToday = 0;
    let overdueCalls = 0;

    for (const lead of leads) {
      const status = lead.status || 'nuevo';
      statusCounts.set(status, (statusCounts.get(status) || 0) + 1);
      if (lead.created_at && dateKey(lead.created_at) === today) newToday += 1;

      if (!TERMINAL_STATUSES.has(status) && lead.next_call_at) {
        const scheduled = new Date(lead.next_call_at);
        if (dateKey(scheduled) === today) callsToday += 1;
        if (status !== 'contactado' && now.getTime() - scheduled.getTime() >= DAY_MS) {
          overdueCalls += 1;
        }
      }
    }

    const statusLines = [...statusCounts.entries()]
      .sort(([left], [right]) => left.localeCompare(right, 'es-MX'))
      .map(([status, count]) => `• ${status}: ${count}`);
    const message = [
      `📊 Resumen diario CRM · ${dateLabel(now)}`,
      `Leads nuevos hoy: ${newToday}`,
      `Llamadas programadas hoy: ${callsToday}`,
      `Llamadas vencidas (+24 h): ${overdueCalls}`,
      '',
      'Leads por estado:',
      ...(statusLines.length ? statusLines : ['• Sin leads']),
    ].join('\n');

    return json({
      date: today,
      time_zone: TIME_ZONE,
      metrics: { new_today: newToday, calls_today: callsToday, overdue_calls: overdueCalls },
      status_counts: Object.fromEntries(statusCounts),
      message,
    });
  } catch (error) {
    console.error('daily-dashboard-summary failed:', error);
    return json({ error: 'No se pudo generar el resumen diario.' }, 500);
  }
});
