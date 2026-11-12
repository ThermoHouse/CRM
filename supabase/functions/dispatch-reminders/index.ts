import { createClient } from 'npm:@supabase/supabase-js@2.49.1';
import webpush from 'npm:web-push@3.6.7';

const MINUTE = 60_000;
const GRACE_MINUTES = 360;
const LEAD_SELECT = 'id,nombre,status,asesor,followup_assigned_to,next_call_at,appointment_at,appointment_location';
const normalizeEmail = (value: unknown) => String(value || '').trim().toLowerCase();

type ReminderSubscription = {
  id: string;
  user_id: string;
  endpoint: string;
  p256dh: string;
  auth: string;
  before_minutes: number;
};

type LeadReminder = {
  id: string;
  nombre: string | null;
  status: string | null;
  asesor: string | null;
  followup_assigned_to: string | null;
  next_call_at: string | null;
  appointment_at: string | null;
  appointment_location: string | null;
};

function getAdmin() {
  const supabaseUrl = Deno.env.get('SUPABASE_URL');
  const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  if (!supabaseUrl || !serviceRoleKey) throw new Error('La función de recordatorios no está configurada.');
  return createClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

async function matchesSecret(provided: string, expected: string) {
  const encoder = new TextEncoder();
  const [left, right] = await Promise.all([
    crypto.subtle.digest('SHA-256', encoder.encode(provided)),
    crypto.subtle.digest('SHA-256', encoder.encode(expected)),
  ]);
  const leftBytes = new Uint8Array(left);
  const rightBytes = new Uint8Array(right);
  let difference = 0;
  for (let index = 0; index < leftBytes.length; index += 1) difference |= leftBytes[index] ^ rightBytes[index];
  return difference === 0;
}

async function loadAllSubscriptions(admin: ReturnType<typeof getAdmin>): Promise<ReminderSubscription[]> {
  const rows: ReminderSubscription[] = [];
  const pageSize = 1000;
  for (let offset = 0; ; offset += pageSize) {
    const { data, error } = await admin.from('lead_reminder_push_subscriptions')
      .select('id,user_id,endpoint,p256dh,auth,before_minutes')
      .eq('enabled', true).range(offset, offset + pageSize - 1);
    if (error) throw new Error('No se pudieron consultar las suscripciones push.');
    rows.push(...(data || []));
    if (!data || data.length < pageSize) return rows;
  }
}

async function loadAllProfiles(admin: ReturnType<typeof getAdmin>): Promise<Array<{ id: string; email: string }>> {
  const rows: Array<{ id: string; email: string }> = [];
  const pageSize = 1000;
  for (let offset = 0; ; offset += pageSize) {
    const { data, error } = await admin.from('profiles')
      .select('id,email').not('email', 'is', null).range(offset, offset + pageSize - 1);
    if (error) throw new Error('No se pudieron consultar los responsables de leads.');
    rows.push(...(data || []));
    if (!data || data.length < pageSize) return rows;
  }
}

async function loadDueLeads(
  admin: ReturnType<typeof getAdmin>,
  from: string,
  to: string,
): Promise<LeadReminder[]> {
  const rows: LeadReminder[] = [];
  const pageSize = 1000;
  const windowFor = (column: string) => `and(${column}.gte.${from},${column}.lte.${to})`;
  for (let offset = 0; ; offset += pageSize) {
    const { data, error } = await admin.from('leads')
      .select(LEAD_SELECT)
      .or(`${windowFor('next_call_at')},${windowFor('appointment_at')}`)
      .range(offset, offset + pageSize - 1);
    if (error) throw new Error('No se pudieron consultar las llamadas y citas programadas.');
    rows.push(...(data || []));
    if (!data || data.length < pageSize) return rows;
  }
}

Deno.serve(async request => {
  if (request.method !== 'POST') return Response.json({ error: 'Método no permitido.' }, { status: 405 });
  const expectedSecret = Deno.env.get('REMINDER_CRON_SECRET');
  const publicKey = Deno.env.get('VAPID_PUBLIC_KEY');
  const privateKey = Deno.env.get('VAPID_PRIVATE_KEY');
  const subject = Deno.env.get('VAPID_SUBJECT');
  if (!expectedSecret || !publicKey || !privateKey || !subject) {
    return Response.json({ error: 'Faltan secretos para enviar recordatorios push.' }, { status: 503 });
  }
  if (!await matchesSecret(request.headers.get('x-cron-secret') || '', expectedSecret)) {
    return Response.json({ error: 'No autorizado.' }, { status: 401 });
  }

  try {
    webpush.setVapidDetails(subject, publicKey, privateKey);
    const admin = getAdmin();
    const now = Date.now();
    const from = new Date(now - GRACE_MINUTES * MINUTE).toISOString();
    const to = new Date(now + 60 * MINUTE).toISOString();
    const [leads, subscriptions, profiles] = await Promise.all([
      loadDueLeads(admin, from, to),
      loadAllSubscriptions(admin),
      loadAllProfiles(admin),
    ]);
    const profileByEmail = new Map<string, string>();
    for (const profile of profiles) {
      const email = normalizeEmail(profile.email);
      if (email) profileByEmail.set(email, profile.id);
    }
    const subscriptionsByUser = new Map<string, ReminderSubscription[]>();
    for (const subscription of subscriptions) {
      const list = subscriptionsByUser.get(subscription.user_id) || [];
      list.push(subscription);
      subscriptionsByUser.set(subscription.user_id, list);
    }

    const candidates = [];
    for (const lead of leads) {
      if (['cerrado', 'no'].includes(lead.status)) continue;
      const ownerId = profileByEmail.get(normalizeEmail(lead.asesor));
      const assignedId = lead.followup_assigned_to || null;
      if (lead.next_call_at) {
        const recipients = new Set<string>();
        const recipient = assignedId || ownerId;
        if (recipient) recipients.add(recipient);
        candidates.push(...makeCandidates(lead, 'call', lead.next_call_at, recipients, subscriptionsByUser, now));
      }
      if (lead.appointment_at) {
        const recipients = new Set<string>();
        if (ownerId) recipients.add(ownerId);
        if (assignedId) recipients.add(assignedId);
        candidates.push(...makeCandidates(lead, 'appointment', lead.appointment_at, recipients, subscriptionsByUser, now));
      }
    }

    const retentionCutoff = new Date(now - 30 * 86400000).toISOString();
    const { error: cleanupError } = await admin.from('lead_reminder_push_deliveries')
      .delete().lt('created_at', retentionCutoff);
    if (cleanupError) throw new Error('No se pudo limpiar el historial de entregas push.');

    let sent = 0;
    let expired = 0;
    let failed = 0;
    for (const candidate of candidates) {
      const { subscription, eventKey, lead, kind, scheduledAt } = candidate;
      const { error: claimError } = await admin.from('lead_reminder_push_deliveries')
        .insert({ subscription_id: subscription.id, event_key: eventKey });
      if (claimError?.code === '23505') continue;
      if (claimError) throw new Error('No se pudo reservar la entrega del recordatorio.');

      const label = kind === 'call' ? 'Llamada de seguimiento' : 'Cita';
      const payload = JSON.stringify({
        title: kind === 'call' ? 'Recordatorio de llamada' : 'Recordatorio de cita',
        body: `${label} · ${lead.nombre || 'Cliente sin nombre'}`,
        scheduled_at: scheduledAt,
        tag: eventKey,
        url: '/',
      });

      try {
        await webpush.sendNotification({
          endpoint: subscription.endpoint,
          keys: { p256dh: subscription.p256dh, auth: subscription.auth },
        }, payload, { TTL: 3600 });
        sent += 1;
      } catch (error) {
        const statusCode = typeof error === 'object' && error !== null && 'statusCode' in error
          ? Number(error.statusCode)
          : 0;
        if (statusCode === 404 || statusCode === 410) {
          const { error: removeError } = await admin.from('lead_reminder_push_subscriptions')
            .delete().eq('id', subscription.id);
          if (removeError) throw new Error('Una suscripción vencida no pudo eliminarse.');
          expired += 1;
          continue;
        }
        const { error: releaseError } = await admin.from('lead_reminder_push_deliveries')
          .delete().eq('subscription_id', subscription.id).eq('event_key', eventKey);
        if (releaseError) throw new Error('No se pudo liberar un recordatorio fallido para reintento.');
        console.error('Push delivery failed:', statusCode || 'unknown');
        failed += 1;
      }
    }

    return Response.json({ sent, expired, failed, checked: candidates.length });
  } catch (error) {
    console.error('dispatch-reminders failed:', error);
    return Response.json({
      error: error instanceof Error ? error.message : 'Ocurrió un error al enviar recordatorios.',
    }, { status: 500 });
  }
});

function makeCandidates(
  lead: LeadReminder,
  kind: 'call' | 'appointment',
  scheduledValue: unknown,
  recipients: Set<string>,
  subscriptionsByUser: Map<string, ReminderSubscription[]>,
  now: number,
) {
  const scheduledAt = String(scheduledValue);
  const timestamp = new Date(scheduledAt).getTime();
  if (!Number.isFinite(timestamp) || now > timestamp + GRACE_MINUTES * MINUTE) return [];
  const eventKey = `${lead.id}|${kind}|${timestamp}`;
  const candidates: Array<{
    subscription: ReminderSubscription;
    eventKey: string;
    lead: LeadReminder;
    kind: 'call' | 'appointment';
    scheduledAt: string;
  }> = [];
  for (const userId of recipients) {
    for (const subscription of subscriptionsByUser.get(userId) || []) {
      const notifyAt = timestamp - Number(subscription.before_minutes) * MINUTE;
      if (now < notifyAt) continue;
      candidates.push({ subscription, eventKey, lead, kind, scheduledAt });
    }
  }
  return candidates;
}
