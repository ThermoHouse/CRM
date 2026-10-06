import { createClient, type User } from 'npm:@supabase/supabase-js@2.49.1';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, apikey, x-client-info, content-type',
  'Access-Control-Allow-Methods': 'GET, PATCH, POST, OPTIONS',
};
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), {
  status,
  headers: { ...corsHeaders, 'Content-Type': 'application/json' },
});
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const STATUSES = new Set(['bot','humano','cerrada']);
const LEAD_STAGES = new Set(['nuevo','calificado','cotizado','ganado','perdido']);

function config() {
  const supabaseUrl = Deno.env.get('SUPABASE_URL');
  const anonKey = Deno.env.get('SUPABASE_ANON_KEY');
  const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  if (!supabaseUrl || !anonKey || !serviceRoleKey) throw new Error('La API de conversaciones no está configurada.');
  return { supabaseUrl, anonKey, serviceRoleKey };
}

async function getActor(request: Request) {
  const { supabaseUrl, anonKey, serviceRoleKey } = config();
  const authorization = request.headers.get('Authorization');
  if (!authorization?.startsWith('Bearer ')) return { response: json({ error: 'Inicia sesión para continuar.' }, 401) };

  const userClient = createClient(supabaseUrl, anonKey, {
    global: { headers: { Authorization: authorization } },
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { data: authData, error: authError } = await userClient.auth.getUser();
  if (authError || !authData.user) return { response: json({ error: 'La sesión no es válida.' }, 401) };

  const admin = createClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { data: profile, error: profileError } = await admin.from('profiles')
    .select('id,role,full_name,email').eq('id', authData.user.id).single();
  if (profileError || !profile || !['root','administrative','sales'].includes(profile.role)) {
    return { response: json({ error: 'Tu rol no tiene acceso a conversaciones.' }, 403) };
  }
  return { admin, user: authData.user, profile };
}

function conversationAccessQuery(admin: ReturnType<typeof createClient>, user: User, role: string, id: string) {
  let query = admin.from('conversations').select('id,contact_id,status,assigned_to,is_test,last_message_at,last_customer_message_at,created_at,contacts!inner(id,phone,name),lead_data(conversation_id,crm_lead_id,nombre,telefono,ubicacion_maps_link,m2,presentacion,tipo_techo,estado,motivo_perdida)')
    .eq('id', id);
  if (role === 'sales') query = query.eq('assigned_to', user.id);
  return query.maybeSingle();
}

async function handleList(request: Request, admin: ReturnType<typeof createClient>, user: User, role: string) {
  const params = new URL(request.url).searchParams;
  let query = admin.from('conversations')
    .select('id,contact_id,status,assigned_to,is_test,last_message_at,last_customer_message_at,created_at,contacts!inner(id,phone,name),profiles!conversations_assigned_to_fkey(id,full_name,email),lead_data(conversation_id,estado)')
    .order('last_message_at', { ascending: false, nullsFirst: false })
    .limit(100);

  if (role === 'sales') query = query.eq('assigned_to', user.id);
  const status = params.get('status');
  if (status && STATUSES.has(status)) query = query.eq('status', status);
  const assignedTo = params.get('assigned_to');
  if (assignedTo && UUID.test(assignedTo) && role !== 'sales') query = query.eq('assigned_to', assignedTo);
  const from = params.get('desde');
  const until = params.get('hasta');
  if (from && !Number.isNaN(Date.parse(from))) query = query.gte('last_message_at', from);
  if (until && !Number.isNaN(Date.parse(until))) query = query.lte('last_message_at', until);
  if (params.get('test') !== 'true') query = query.eq('is_test', false);

  const search = params.get('q')?.trim().slice(0, 100);
  if (search) {
    const escaped = search.replace(/[%_,()]/g, '');
    query = query.or(`phone.ilike.%${escaped}%,name.ilike.%${escaped}%`, { referencedTable: 'contacts' });
  }

  const { data, error } = await query;
  if (error) return json({ error: 'No se pudieron consultar las conversaciones.' }, 500);
  const conversations = data || [];
  const ids = conversations.map(conversation => conversation.id);
  const { data: messages, error: messagesError } = ids.length
    ? await admin.from('messages').select('conversation_id,body,direction,sender,type,created_at')
      .in('conversation_id', ids).order('created_at', { ascending: false })
    : { data: [], error: null };
  if (messagesError) return json({ error: 'No se pudieron consultar los últimos mensajes.' }, 500);
  const latest = new Map<string, typeof messages extends (infer Item)[] | null ? Item : never>();
  for (const message of messages || []) if (!latest.has(message.conversation_id)) latest.set(message.conversation_id, message);
  return json(conversations.map(conversation => ({
    ...conversation,
    last_message: latest.get(conversation.id) || null,
    requires_attention: conversation.status === 'humano'
      && latest.get(conversation.id)?.direction === 'in',
  })));
}

async function handleDetail(id: string, admin: ReturnType<typeof createClient>, user: User, role: string) {
  if (!UUID.test(id)) return json({ error: 'El id de conversación no es válido.' }, 400);
  const { data: conversation, error } = await conversationAccessQuery(admin, user, role, id);
  if (error || !conversation) return json({ error: 'No encontré la conversación o no tienes acceso.' }, 404);
  const [messages, events] = await Promise.all([
    admin.from('messages').select('id,wa_message_id,direction,sender,type,body,media_url,tokens_in,tokens_out,created_at')
      .eq('conversation_id', id).order('created_at', { ascending: true }).limit(1000),
    admin.from('events').select('id,type,payload,created_at')
      .eq('conversation_id', id).order('created_at', { ascending: true }).limit(500),
  ]);
  if (messages.error || events.error) return json({ error: 'No se pudo cargar el detalle de la conversación.' }, 500);
  return json({ ...conversation, messages: messages.data || [], events: events.data || [] });
}

async function handleUpdateLead(request: Request, id: string, admin: ReturnType<typeof createClient>, user: User, role: string) {
  if (!UUID.test(id)) return json({ error: 'El id de conversación no es válido.' }, 400);
  const { data: conversation } = await conversationAccessQuery(admin, user, role, id);
  if (!conversation) return json({ error: 'No encontré la conversación o no tienes acceso.' }, 404);
  const body = await request.json().catch(() => null);
  if (!body || typeof body !== 'object' || Array.isArray(body)) return json({ error: 'El cuerpo debe ser JSON válido.' }, 400);

  const lead = body.lead && typeof body.lead === 'object' ? body.lead : body;
  const stage = lead.estado;
  if (stage != null && !LEAD_STAGES.has(stage)) return json({ error: 'El estado del lead no es válido.' }, 400);
  const area = lead.m2 == null || lead.m2 === '' ? null : Number(lead.m2);
  if (area != null && (!Number.isFinite(area) || area < 0)) return json({ error: 'm2 debe ser un número igual o mayor que cero.' }, 400);

  if (body.assigned_to !== undefined) {
    if (role === 'sales' && body.assigned_to !== user.id) return json({ error: 'Solo un administrador puede reasignar conversaciones.' }, 403);
    if (body.assigned_to !== null && !UUID.test(body.assigned_to)) return json({ error: 'assigned_to debe ser un UUID o null.' }, 400);
    if (body.assigned_to) {
      const { data: assignee } = await admin.from('profiles').select('id,role').eq('id', body.assigned_to).single();
      if (!assignee || assignee.role !== 'sales') return json({ error: 'La conversación solo puede asignarse a un usuario de Ventas.' }, 400);
    }
  }

  const leadData = {
    conversation_id: id,
    nombre: typeof lead.nombre === 'string' ? lead.nombre.trim().slice(0, 200) || null : undefined,
    telefono: typeof lead.telefono === 'string' ? lead.telefono.trim().slice(0, 30) || null : undefined,
    ubicacion_maps_link: typeof lead.ubicacion_maps_link === 'string' ? lead.ubicacion_maps_link.trim().slice(0, 2000) || null : undefined,
    m2: area,
    presentacion: typeof lead.presentacion === 'string' ? lead.presentacion.trim().slice(0, 120) || null : undefined,
    tipo_techo: typeof lead.tipo_techo === 'string' ? lead.tipo_techo.trim().slice(0, 120) || null : undefined,
    estado: stage || undefined,
    motivo_perdida: typeof lead.motivo_perdida === 'string' ? lead.motivo_perdida.trim().slice(0, 1000) || null : undefined,
  };
  for (const key of Object.keys(leadData)) if (leadData[key] === undefined) delete leadData[key];
  const { error: leadError } = await admin.from('lead_data').upsert(leadData, { onConflict: 'conversation_id' });
  if (leadError) return json({ error: 'No se pudieron guardar los datos del lead.' }, 500);

  if (body.assigned_to !== undefined) {
    const { error: assignmentError } = await admin.from('conversations').update({ assigned_to: body.assigned_to }).eq('id', id);
    if (assignmentError) return json({ error: 'El lead se guardó, pero no se pudo asignar el vendedor.' }, 500);
    const { error: eventError } = await admin.from('events').insert({
      conversation_id: id,
      type: 'asignado',
      payload: { vendedor: body.assigned_to, actualizado_por: user.id },
    });
    if (eventError) return json({ error: 'La asignación se guardó, pero no se registró el evento.' }, 500);
  }
  return json({ ok: true });
}

async function handleStatus(request: Request, id: string, admin: ReturnType<typeof createClient>, user: User, role: string) {
  if (!UUID.test(id)) return json({ error: 'El id de conversación no es válido.' }, 400);
  const body = await request.json().catch(() => null);
  if (!body || !STATUSES.has(body.status)) return json({ error: 'status debe ser bot, humano o cerrada.' }, 400);
  const { data: conversation } = await conversationAccessQuery(admin, user, role, id);
  if (!conversation) return json({ error: 'No encontré la conversación o no tienes acceso.' }, 404);
  if (role === 'sales' && conversation.assigned_to !== user.id) return json({ error: 'La conversación no está asignada a ti.' }, 403);
  const { error } = await admin.from('conversations').update({ status: body.status }).eq('id', id);
  if (error) return json({ error: 'No se pudo cambiar el estado de la conversación.' }, 500);
  const eventType = body.status === 'bot' ? 'reanuda_bot' : 'pausa_bot';
  const { error: eventError } = await admin.from('events').insert({
    conversation_id: id,
    type: eventType,
    payload: { estado_anterior: conversation.status, estado_nuevo: body.status, actualizado_por: user.id },
  });
  if (eventError) return json({ error: 'El estado cambió, pero no se pudo registrar el evento.' }, 500);
  return json({ id, status: body.status, assigned_to: conversation.assigned_to });
}

async function handleSend(request: Request, id: string, admin: ReturnType<typeof createClient>, user: User, role: string) {
  if (!UUID.test(id)) return json({ error: 'El id de conversación no es válido.' }, 400);
  const body = await request.json().catch(() => null);
  const text = typeof body?.text === 'string' ? body.text.trim() : '';
  if (!text || text.length > 4000) return json({ error: 'text es obligatorio y debe tener hasta 4,000 caracteres.' }, 400);
  const { data: conversation } = await conversationAccessQuery(admin, user, role, id);
  if (!conversation) return json({ error: 'No encontré la conversación o no tienes acceso.' }, 404);
  if (role === 'sales' && conversation.assigned_to !== user.id) return json({ error: 'La conversación no está asignada a ti.' }, 403);
  if (!conversation.last_customer_message_at
    || Date.now() - new Date(conversation.last_customer_message_at).getTime() > 24 * 60 * 60 * 1000) {
    return json({ error: 'Fuera de la ventana de 24h: requiere plantilla aprobada' }, 409);
  }

  const webhookUrl = Deno.env.get('N8N_WEBHOOK_URL');
  const webhookSecret = Deno.env.get('N8N_WEBHOOK_SECRET');
  if (!webhookUrl || !webhookSecret) return json({ error: 'Faltan N8N_WEBHOOK_URL o N8N_WEBHOOK_SECRET en los secretos de servidor.' }, 503);
  let target: URL;
  try { target = new URL(webhookUrl); } catch { return json({ error: 'N8N_WEBHOOK_URL no es una URL válida.' }, 503); }
  if (target.protocol !== 'https:' && target.hostname !== 'localhost') return json({ error: 'N8N_WEBHOOK_URL debe usar HTTPS.' }, 503);

  const previousStatus = conversation.status;
  const changesStatus = previousStatus !== 'humano';
  if (changesStatus) {
    const { error: pauseError } = await admin.from('conversations').update({ status: 'humano' }).eq('id', id);
    if (pauseError) return json({ error: 'No se pudo pausar el bot antes de enviar el mensaje.' }, 500);
    const { error: eventError } = await admin.from('events').insert({
      conversation_id: id,
      type: 'pausa_bot',
      payload: { motivo: 'mensaje_de_vendedor', actualizado_por: user.id },
    });
    if (eventError) return json({ error: 'El bot se pausó, pero no se pudo registrar el evento.' }, 500);
  }

  const { data: contact } = await admin.from('contacts').select('phone').eq('id', conversation.contact_id).single();
  if (!contact) return json({ error: 'No se encontró el teléfono del contacto.' }, 404);
  let webhookResponse: Response;
  try {
    webhookResponse = await fetch(target, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-secret': webhookSecret },
      body: JSON.stringify({ phone: contact.phone, text }),
      signal: AbortSignal.timeout(15000),
    });
  } catch {
    return json({ error: 'No se pudo conectar con el webhook de n8n. El bot permanece pausado para evitar respuestas simultáneas.' }, 502);
  }
  if (!webhookResponse.ok) return json({ error: `n8n rechazó el mensaje (HTTP ${webhookResponse.status}). El bot permanece pausado.` }, 502);
  const webhookResult = await webhookResponse.json().catch(() => ({}));
  const messageId = typeof webhookResult.wa_message_id === 'string' && webhookResult.wa_message_id.trim()
    ? webhookResult.wa_message_id.trim()
    : `crm-${crypto.randomUUID()}`;
  const sentAt = new Date().toISOString();
  const { data: message, error: messageError } = await admin.from('messages').insert({
    conversation_id: id,
    wa_message_id: messageId,
    direction: 'out',
    sender: 'vendedor',
    type: 'text',
    body: text,
    created_at: sentAt,
  }).select('id,wa_message_id,direction,sender,type,body,created_at').single();
  if (messageError) return json({ error: 'n8n recibió el mensaje, pero no se pudo guardar en el historial. Revisa que devuelva wa_message_id.' }, 502);

  const update = { last_message_at: sentAt, ...(conversation.assigned_to ? {} : { assigned_to: user.id }) };
  const { error: updateError } = await admin.from('conversations').update(update).eq('id', id);
  if (updateError) return json({ error: 'El mensaje se envió, pero no se pudo actualizar la conversación.' }, 502);
  return json({ message, status: 'humano' }, 201);
}

Deno.serve(async request => {
  if (request.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  try {
    const actor = await getActor(request);
    if (actor.response) return actor.response;
    const { admin, user, profile } = actor;
    const url = new URL(request.url);
    const segments = url.pathname.split('/').filter(Boolean);
    const index = segments.indexOf('crm-conversations');
    const route = index >= 0 ? segments.slice(index + 1) : segments;
    if (route.length === 1 && route[0] === 'conversations' && request.method === 'GET') {
      return await handleList(request, admin, user, profile.role);
    }
    if (route[0] === 'conversations' && route.length === 2 && request.method === 'GET') {
      return await handleDetail(route[1], admin, user, profile.role);
    }
    if (route[0] === 'conversations' && route.length === 3 && route[2] === 'lead' && request.method === 'PATCH') {
      return await handleUpdateLead(request, route[1], admin, user, profile.role);
    }
    if (route[0] === 'conversations' && route.length === 3 && route[2] === 'status' && request.method === 'POST') {
      return await handleStatus(request, route[1], admin, user, profile.role);
    }
    if (route[0] === 'conversations' && route.length === 3 && route[2] === 'send' && request.method === 'POST') {
      return await handleSend(request, route[1], admin, user, profile.role);
    }
    return json({ error: 'Endpoint no encontrado.' }, 404);
  } catch {
    return json({ error: 'Ocurrió un error al procesar la solicitud.' }, 500);
  }
});