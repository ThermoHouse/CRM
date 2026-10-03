import { createClient } from 'npm:@supabase/supabase-js@2.49.1';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), {
  status,
  headers: { ...corsHeaders, 'Content-Type': 'application/json' },
});
async function googleAccessToken(clientId: string, clientSecret: string, refreshToken: string) {
  const response = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: clientId,
      client_secret: clientSecret,
      refresh_token: refreshToken,
      grant_type: 'refresh_token',
    }),
  });
  const result = await response.json();
  if (!response.ok || !result.access_token) {
    throw new Error('Google Calendar no pudo renovar la autorización. Revisa el OAuth client y refresh token.');
  }
  return result.access_token as string;
}

async function stableEventId(leadId: string) {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(leadId));
  return [...new Uint8Array(digest)].map(value => value.toString(16).padStart(2, '0')).join('');
}

Deno.serve(async request => {
  if (request.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (request.method !== 'POST') return json({ error: 'Método no permitido.' }, 405);

  try {
    const authorization = request.headers.get('Authorization');
    if (!authorization) return json({ error: 'Inicia sesión para agendar.' }, 401);

    const supabaseUrl = Deno.env.get('SUPABASE_URL');
    const anonKey = Deno.env.get('SUPABASE_ANON_KEY');
    const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
    const googleClientId = Deno.env.get('GOOGLE_OAUTH_CLIENT_ID');
    const googleClientSecret = Deno.env.get('GOOGLE_OAUTH_CLIENT_SECRET');
    const googleRefreshToken = Deno.env.get('GOOGLE_OAUTH_REFRESH_TOKEN');
    const calendarId = Deno.env.get('GOOGLE_CALENDAR_ID');
    const bossEmail = Deno.env.get('BOSS_EMAIL');
    const resendApiKey = Deno.env.get('RESEND_API_KEY');
    const emailFrom = Deno.env.get('NOTIFICATION_FROM_EMAIL');
    const missing = [
      ['SUPABASE_URL', supabaseUrl], ['SUPABASE_ANON_KEY', anonKey],
      ['SUPABASE_SERVICE_ROLE_KEY', serviceRoleKey], ['GOOGLE_OAUTH_CLIENT_ID', googleClientId],
      ['GOOGLE_OAUTH_CLIENT_SECRET', googleClientSecret], ['GOOGLE_OAUTH_REFRESH_TOKEN', googleRefreshToken],
      ['GOOGLE_CALENDAR_ID', calendarId],
      ['BOSS_EMAIL', bossEmail], ['RESEND_API_KEY', resendApiKey], ['NOTIFICATION_FROM_EMAIL', emailFrom],
    ].filter(([, value]) => !value).map(([name]) => name);
    if (missing.length) return json({ error: `Faltan secretos de servidor: ${missing.join(', ')}.` }, 503);

    const userClient = createClient(supabaseUrl!, anonKey!, {
      global: { headers: { Authorization: authorization } },
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const { data: authData, error: authError } = await userClient.auth.getUser();
    if (authError || !authData.user) return json({ error: 'La sesión no es válida.' }, 401);

    const admin = createClient(supabaseUrl!, serviceRoleKey!, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const { data: profile, error: profileError } = await admin
      .from('profiles').select('role,full_name,email').eq('id', authData.user.id).single();
    if (profileError || !profile || !['root', 'sales'].includes(profile.role)) {
      return json({ error: 'Solo Root o Ventas pueden agendar clientes.' }, 403);
    }

    const body = await request.json();
    const leadId = String(body.leadId || '');
    const scheduledAt = new Date(body.scheduledAt);
    const durationMinutes = Number(body.durationMinutes || 60);
    const location = String(body.location || '').trim().slice(0, 500);
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(leadId)) {
      return json({ error: 'El cliente seleccionado no es válido.' }, 400);
    }
    if (Number.isNaN(scheduledAt.getTime()) || scheduledAt.getTime() <= Date.now()) {
      return json({ error: 'Selecciona una fecha y hora futura.' }, 400);
    }
    if (!Number.isInteger(durationMinutes) || durationMinutes < 15 || durationMinutes > 480) {
      return json({ error: 'La duración debe ser de 15 minutos a 8 horas.' }, 400);
    }

    const { data: lead, error: leadError } = await admin
      .from('leads')
      .select('id,nombre,email,whatsapp,ciudad,direccion,plaza,area_m2,sistema,asesor,status,google_calendar_event_id')
      .eq('id', leadId).single();
    if (leadError || !lead) return json({ error: 'No encontré el cliente seleccionado.' }, 404);

    const salespersonEmail = lead.asesor || profile.email || authData.user.email || '';
    const { data: salesperson } = salespersonEmail
      ? await admin.from('profiles').select('full_name').ilike('email', salespersonEmail).maybeSingle()
      : { data: null };
    const salespersonName = salesperson?.full_name || profile.full_name || 'Equipo de Ventas';
    const eventId = lead.google_calendar_event_id || await stableEventId(lead.id);
    const start = scheduledAt.toISOString();
    const end = new Date(scheduledAt.getTime() + durationMinutes * 60_000).toISOString();
    const summary = `Servicio Thermo House · ${lead.nombre || 'Cliente'}`;
    const details = [
      `Cliente: ${lead.nombre || 'Sin nombre'}`,
      lead.whatsapp ? `Teléfono: ${lead.whatsapp}` : '',
      lead.email ? `Correo del cliente: ${lead.email}` : '',
      lead.sistema ? `Sistema: ${lead.sistema}` : 'Sistema pendiente',
      lead.area_m2 ? `Área: ${lead.area_m2} m²` : '',
      lead.plaza ? `Plaza: ${lead.plaza}` : '',
      lead.ciudad ? `Zona: ${lead.ciudad}` : '',
      `Atiende: ${salespersonName}`,
    ].filter(Boolean).join('\n');
    const event = {
      id: eventId,
      summary,
      description: details,
      location: location || lead.direccion || lead.ciudad || undefined,
      start: { dateTime: start, timeZone: 'America/Mexico_City' },
      end: { dateTime: end, timeZone: 'America/Mexico_City' },
      attendees: salespersonEmail ? [{ email: salespersonEmail }] : [],
      reminders: { useDefault: false, overrides: [{ method: 'popup', minutes: 30 }, { method: 'email', minutes: 60 }] },
      extendedProperties: { private: { crmLeadId: lead.id } },
    };
    const googleToken = await googleAccessToken(googleClientId!, googleClientSecret!, googleRefreshToken!);
    const calendarBase = `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(calendarId!)}/events`;
    const headers = { Authorization: `Bearer ${googleToken}`, 'Content-Type': 'application/json' };
    let calendarResponse = await fetch(
      `${calendarBase}${lead.google_calendar_event_id ? `/${eventId}` : ''}?sendUpdates=all`,
      { method: lead.google_calendar_event_id ? 'PATCH' : 'POST', headers, body: JSON.stringify(event) },
    );
    if (calendarResponse.status === 409) {
      calendarResponse = await fetch(`${calendarBase}/${eventId}?sendUpdates=all`, {
        method: 'PATCH', headers, body: JSON.stringify(event),
      });
    }
    const calendarEvent = await calendarResponse.json();
    if (!calendarResponse.ok) {
      return json({ error: 'Google Calendar rechazó la cita. Revisa la autorización OAuth y el ID del calendario.' }, 502);
    }

    const { error: saveError } = await userClient.from('leads').update({
      status: 'confirmado',
      appointment_at: start,
      appointment_duration_minutes: durationMinutes,
      appointment_location: location || lead.direccion || lead.ciudad || null,
      google_calendar_event_id: calendarEvent.id || eventId,
      google_calendar_event_link: calendarEvent.htmlLink || null,
      appointment_notification_status: 'not_sent',
      appointment_notifications_sent_at: null,
    }).eq('id', lead.id);
    if (saveError) return json({ error: 'La cita se creó, pero no pude actualizar el lead. Reintenta para sincronizarla.' }, 502);

    const recipients = [...new Set([bossEmail!.trim(), salespersonEmail.trim()].filter(Boolean))];
    const emailResponse = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { Authorization: `Bearer ${resendApiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        from: emailFrom,
        to: recipients,
        subject: `Cita confirmada · ${lead.nombre || 'Cliente Thermo House'}`,
        text: [
          `Se confirmó una cita con ${lead.nombre || 'el cliente'}.`,
          `Fecha: ${scheduledAt.toLocaleString('es-MX', { timeZone: 'America/Mexico_City' })}`,
          `Duración: ${durationMinutes} minutos.`,
          `Lugar: ${location || lead.direccion || lead.ciudad || 'Por definir'}.`,
          `Vendedor: ${salespersonName}.`,
          `Calendario: ${calendarEvent.htmlLink || ''}`,
        ].join('\n'),
      }),
    });
    if (!emailResponse.ok) {
      const { error: notificationError } = await userClient.from('leads').update({
        appointment_notification_status: 'failed',
      }).eq('id', lead.id);
      if (notificationError) console.error('Could not record email status');
      return json({ error: 'La cita quedó en Google Calendar, pero falló el correo. Corrige Resend y vuelve a agendar para reenviar el aviso.' }, 502);
    }

    const { error: sentStatusError } = await userClient.from('leads').update({
      appointment_notification_status: 'sent',
      appointment_notifications_sent_at: new Date().toISOString(),
    }).eq('id', lead.id);
    if (sentStatusError) console.error('Could not record notification status');

    return json({
      ok: true,
      calendarEventId: calendarEvent.id || eventId,
      calendarEventLink: calendarEvent.htmlLink || null,
      notificationStatus: 'sent',
    });
  } catch (error) {
    console.error('schedule-confirmed-lead failed:', error instanceof Error ? error.message : 'Unknown error');
    return json({ error: 'No se pudo agendar la cita. Revisa la configuración del calendario y vuelve a intentar.' }, 500);
  }
});
