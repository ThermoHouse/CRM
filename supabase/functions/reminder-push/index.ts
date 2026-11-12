import { createClient } from 'npm:@supabase/supabase-js@2.49.1';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, apikey, x-client-info, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), {
  status,
  headers: { ...corsHeaders, 'Content-Type': 'application/json' },
});
const ALLOWED_ROLES = new Set(['root', 'sales', 'administrative', 'manager']);
const BEFORE_MINUTES = new Set([0, 5, 10, 15, 30, 60]);

function config() {
  const supabaseUrl = Deno.env.get('SUPABASE_URL');
  const anonKey = Deno.env.get('SUPABASE_ANON_KEY');
  const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  if (!supabaseUrl || !anonKey || !serviceRoleKey) {
    throw new Error('La función de suscripciones push no está configurada.');
  }
  return { supabaseUrl, anonKey, serviceRoleKey };
}

Deno.serve(async request => {
  if (request.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (request.method !== 'POST') return json({ error: 'Método no permitido.' }, 405);

  try {
    const { supabaseUrl, anonKey, serviceRoleKey } = config();
    const authorization = request.headers.get('Authorization');
    if (!authorization?.startsWith('Bearer ')) return json({ error: 'Inicia sesión para continuar.' }, 401);

    const userClient = createClient(supabaseUrl, anonKey, {
      global: { headers: { Authorization: authorization } },
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const { data: authData, error: authError } = await userClient.auth.getUser();
    if (authError || !authData.user) return json({ error: 'La sesión no es válida.' }, 401);

    const admin = createClient(supabaseUrl, serviceRoleKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const { data: profile, error: profileError } = await admin.from('profiles')
      .select('id,role').eq('id', authData.user.id).single();
    if (profileError || !profile || !ALLOWED_ROLES.has(profile.role)) {
      return json({ error: 'Tu rol no tiene acceso a las alarmas push.' }, 403);
    }

    let body: Record<string, unknown>;
    try {
      const parsed = await request.json();
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
        return json({ error: 'El cuerpo debe ser un objeto JSON.' }, 400);
      }
      body = parsed as Record<string, unknown>;
    } catch {
      return json({ error: 'El cuerpo debe ser JSON válido.' }, 400);
    }

    if (body.action === 'subscribe') {
      const subscription = body.subscription;
      if (!subscription || typeof subscription !== 'object' || Array.isArray(subscription)) {
        return json({ error: 'Falta la suscripción del navegador.' }, 400);
      }
      const value = subscription as Record<string, unknown>;
      const keys = value.keys && typeof value.keys === 'object'
        ? value.keys as Record<string, unknown>
        : {};
      if (typeof value.endpoint !== 'string' || value.endpoint.length > 2048) {
        return json({ error: 'El endpoint de la suscripción no es válido.' }, 400);
      }
      let endpoint: URL;
      try {
        endpoint = new URL(value.endpoint);
      } catch {
        return json({ error: 'El endpoint de la suscripción no es válido.' }, 400);
      }
      if (endpoint.protocol !== 'https:'
        || typeof keys.p256dh !== 'string' || keys.p256dh.length > 256
        || typeof keys.auth !== 'string' || keys.auth.length > 128) {
        return json({ error: 'Las claves de la suscripción no son válidas.' }, 400);
      }
      const beforeMinutes = body.before_minutes;
      if (!Number.isInteger(beforeMinutes) || !BEFORE_MINUTES.has(Number(beforeMinutes))) {
        return json({ error: 'El tiempo de anticipación no es válido.' }, 400);
      }
      if (typeof body.enabled !== 'boolean') return json({ error: 'enabled debe ser booleano.' }, 400);

      const { data: existing, error: existingError } = await admin
        .from('lead_reminder_push_subscriptions').select('user_id')
        .eq('endpoint', endpoint.href).maybeSingle();
      if (existingError) return json({ error: 'No se pudo verificar la suscripción existente.' }, 500);
      if (existing && existing.user_id !== profile.id) {
        return json({ error: 'Esta suscripción del navegador está vinculada a otra cuenta.' }, 409);
      }

      const { error } = await admin.from('lead_reminder_push_subscriptions').upsert({
        user_id: profile.id,
        endpoint: endpoint.href,
        p256dh: keys.p256dh,
        auth: keys.auth,
        enabled: body.enabled,
        before_minutes: Number(beforeMinutes),
        updated_at: new Date().toISOString(),
      }, { onConflict: 'endpoint' });
      if (error) return json({ error: 'No se pudo guardar la suscripción push.' }, 500);
      return json({ subscribed: true });
    }

    if (body.action === 'settings') {
      if (typeof body.endpoint !== 'string' || body.endpoint.length > 2048
        || typeof body.enabled !== 'boolean' || !Number.isInteger(body.before_minutes)
        || !BEFORE_MINUTES.has(Number(body.before_minutes))) {
        return json({ error: 'La configuración de alarmas no es válida.' }, 400);
      }
      const { error } = await admin.from('lead_reminder_push_subscriptions')
        .update({
          enabled: body.enabled,
          before_minutes: Number(body.before_minutes),
          updated_at: new Date().toISOString(),
        })
        .eq('user_id', profile.id).eq('endpoint', body.endpoint);
      if (error) return json({ error: 'No se pudo actualizar la configuración push.' }, 500);
      return json({ updated: true });
    }

    if (body.action === 'unsubscribe') {
      if (typeof body.endpoint !== 'string' || body.endpoint.length > 2048) {
        return json({ error: 'El endpoint de la suscripción no es válido.' }, 400);
      }
      const { error } = await admin.from('lead_reminder_push_subscriptions')
        .delete().eq('user_id', profile.id).eq('endpoint', body.endpoint);
      if (error) return json({ error: 'No se pudo eliminar la suscripción push.' }, 500);
      return json({ subscribed: false });
    }

    return json({ error: 'La acción solicitada no es válida.' }, 400);
  } catch (error) {
    console.error('reminder-push failed:', error);
    return json({ error: error instanceof Error ? error.message : 'Ocurrió un error al procesar la solicitud.' }, 500);
  }
});
