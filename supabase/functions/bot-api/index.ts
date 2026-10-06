import { createClient } from 'npm:@supabase/supabase-js@2.49.1';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'x-api-key, content-type',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
};
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), {
  status,
  headers: { ...corsHeaders, 'Content-Type': 'application/json' },
});
const E164 = /^\+[1-9][0-9]{1,14}$/;
const EVENT_TYPES = new Set(['handoff','lead_calificado','asignado','cotizacion_enviada','pausa_bot','reanuda_bot']);
const MESSAGE_TYPES = new Set(['text','image','audio','other']);
const DIRECTIONS = new Set(['in','out']);
const SENDERS = new Set(['cliente','bot','vendedor']);

async function sha256(value: string) {
  return new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value)));
}

async function secureEqual(left: string, right: string) {
  const [leftHash, rightHash] = await Promise.all([sha256(left), sha256(right)]);
  let difference = 0;
  for (let index = 0; index < leftHash.length; index += 1) difference |= leftHash[index] ^ rightHash[index];
  return difference === 0;
}

function getAdminClient() {
  const url = Deno.env.get('SUPABASE_URL');
  const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  if (!url || !serviceRoleKey) throw new Error('La API del bot no está configurada.');
  return createClient(url, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

function routeSegments(url: URL) {
  const segments = url.pathname.split('/').filter(Boolean);
  const functionIndex = segments.indexOf('bot-api');
  return functionIndex >= 0 ? segments.slice(functionIndex + 1) : segments;
}

function validOptionalCount(value: unknown, field: string) {
  if (value === undefined || value === null) return null;
  if (!Number.isInteger(value) || Number(value) < 0) throw new Error(`${field} debe ser un entero igual o mayor que cero.`);
  return Number(value);
}

function validatePhone(value: unknown) {
  if (typeof value !== 'string' || !E164.test(value)) throw new Error('phone debe usar formato E.164, por ejemplo +5215551234567.');
  return value;
}

async function parseJson(request: Request) {
  const contentLength = Number(request.headers.get('content-length') || 0);
  if (contentLength > 32_768) throw new Error('El cuerpo de la solicitud excede 32 KB.');
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    throw new Error('El cuerpo debe ser JSON válido.');
  }
  if (!body || typeof body !== 'object' || Array.isArray(body)) throw new Error('El cuerpo debe ser un objeto JSON.');
  if (new TextEncoder().encode(JSON.stringify(body)).length > 32_768) throw new Error('El cuerpo de la solicitud excede 32 KB.');
  return body as Record<string, unknown>;
}

async function checkRateLimit(request: Request, admin: ReturnType<typeof getAdminClient>) {
  const source = request.headers.get('cf-connecting-ip') || request.headers.get('x-real-ip') || 'unknown';
  const rateKey = [...await sha256(source)].map(byte => byte.toString(16).padStart(2, '0')).join('');
  const { data, error } = await admin.rpc('consume_bot_api_rate_limit', {
    p_rate_key: rateKey,
    p_limit: 120,
    p_window_seconds: 60,
  });
  if (error) throw new Error('No se pudo validar el límite de solicitudes.');
  return data === true;
}

async function authorize(request: Request) {
  const expected = Deno.env.get('CRM_API_KEY');
  if (!expected) return json({ error: 'La API del bot no está configurada.' }, 503);
  const provided = request.headers.get('x-api-key') || '';
  if (!await secureEqual(provided, expected)) return json({ error: 'No autorizado.' }, 401);
  return null;
}

async function handleMessage(request: Request, admin: ReturnType<typeof getAdminClient>) {
  if (request.method !== 'POST') return json({ error: 'Método no permitido.' }, 405);
  const body = await parseJson(request);
  const phone = validatePhone(body.phone);
  const name = body.name == null ? null : String(body.name).trim();
  if (name && name.length > 120) throw new Error('name no puede exceder 120 caracteres.');
  if (typeof body.wa_message_id !== 'string' || !body.wa_message_id.trim() || body.wa_message_id.length > 255) {
    throw new Error('wa_message_id es obligatorio y debe tener hasta 255 caracteres.');
  }
  if (typeof body.direction !== 'string' || !DIRECTIONS.has(body.direction)) throw new Error('direction debe ser in o out.');
  if (typeof body.sender !== 'string' || !SENDERS.has(body.sender)) throw new Error('sender debe ser cliente, bot o vendedor.');
  if (typeof body.type !== 'string' || !MESSAGE_TYPES.has(body.type)) throw new Error('type debe ser text, image, audio u other.');
  if (body.body != null && typeof body.body !== 'string') throw new Error('body debe ser texto o null.');
  if (typeof body.body === 'string' && body.body.length > 20_000) throw new Error('body no puede exceder 20,000 caracteres.');
  let mediaUrl: string | null = null;
  if (body.media_url != null && body.media_url !== '') {
    if (typeof body.media_url !== 'string') throw new Error('media_url debe ser una URL HTTPS.');
    let url: URL;
    try { url = new URL(body.media_url); } catch { throw new Error('media_url debe ser una URL HTTPS.'); }
    if (url.protocol !== 'https:') throw new Error('media_url debe usar HTTPS.');
    mediaUrl = url.toString();
  }
  if (body.is_test !== undefined && typeof body.is_test !== 'boolean') throw new Error('is_test debe ser booleano.');

  const { data, error } = await admin.rpc('ingest_bot_message', {
    p_phone: phone,
    p_name: name || null,
    p_wa_message_id: body.wa_message_id.trim(),
    p_direction: body.direction,
    p_sender: body.sender,
    p_type: body.type,
    p_body: typeof body.body === 'string' ? body.body : null,
    p_media_url: mediaUrl,
    p_tokens_in: validOptionalCount(body.tokens_in, 'tokens_in'),
    p_tokens_out: validOptionalCount(body.tokens_out, 'tokens_out'),
    p_is_test: body.is_test === true,
  });
  if (error) throw new Error('No se pudo guardar el mensaje. Verifica las migraciones de WhatsApp.');
  return json(data);
}

async function handleEvent(request: Request, admin: ReturnType<typeof getAdminClient>) {
  if (request.method !== 'POST') return json({ error: 'Método no permitido.' }, 405);
  const body = await parseJson(request);
  const phone = validatePhone(body.phone);
  if (typeof body.type !== 'string' || !EVENT_TYPES.has(body.type)) throw new Error('type no es un evento permitido.');
  const payload = body.payload == null ? {} : body.payload;
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) throw new Error('payload debe ser un objeto JSON.');
  if (new TextEncoder().encode(JSON.stringify(payload)).length > 16_384) throw new Error('payload no puede exceder 16 KB.');
  if (body.type === 'lead_calificado' && payload.m2 != null && payload.m2 !== '') {
    const area = Number(payload.m2);
    if (!Number.isFinite(area) || area < 0) throw new Error('payload.m2 debe ser un número igual o mayor que cero.');
  }
  if (body.type === 'lead_calificado' && payload.telefono != null && payload.telefono !== '' && !E164.test(String(payload.telefono))) {
    throw new Error('payload.telefono debe usar formato E.164.');
  }
  if (body.type === 'asignado' && payload.vendedor != null && typeof payload.vendedor !== 'string') {
    throw new Error('payload.vendedor debe ser un UUID o correo de usuario.');
  }

  const { data, error } = await admin.rpc('ingest_bot_event', {
    p_phone: phone,
    p_type: body.type,
    p_payload: payload,
  });
  if (error) throw new Error('No se pudo guardar el evento. Verifica las migraciones de WhatsApp y el usuario asignado.');
  return json(data);
}

async function handleState(request: Request, phoneValue: string, admin: ReturnType<typeof getAdminClient>) {
  if (request.method !== 'GET') return json({ error: 'Método no permitido.' }, 405);
  const phone = validatePhone(decodeURIComponent(phoneValue));
  const { data: contact, error: contactError } = await admin.from('contacts')
    .select('id').eq('phone', phone).maybeSingle();
  if (contactError) throw new Error('No se pudo consultar el estado de la conversación.');
  if (!contact) return json({ status: 'bot', assigned_to: null });
  const { data, error } = await admin.from('conversations')
    .select('status,assigned_to')
    .eq('contact_id', contact.id)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throw new Error('No se pudo consultar el estado de la conversación.');
  return json(data ? { status: data.status, assigned_to: data.assigned_to } : { status: 'bot', assigned_to: null });
}

Deno.serve(async request => {
  if (request.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

  try {
    const authError = await authorize(request);
    if (authError) return authError;
    const admin = getAdminClient();
    if (!await checkRateLimit(request, admin)) return json({ error: 'Límite de solicitudes excedido. Intenta de nuevo en un minuto.' }, 429);

    const route = routeSegments(new URL(request.url));
    if (route.length === 1 && route[0] === 'messages') return await handleMessage(request, admin);
    if (route.length === 1 && route[0] === 'events') return await handleEvent(request, admin);
    if (route.length === 3 && route[0] === 'conversations' && route[2] === 'state') {
      return await handleState(request, route[1], admin);
    }
    return json({ error: 'Endpoint no encontrado.' }, 404);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Solicitud inválida.';
    const clientError = /^(phone |name |wa_message_id|direction |sender |type |body |media_url|is_test |tokens_in|tokens_out|payload|El cuerpo)/i.test(message);
    return json({ error: message }, clientError ? 400 : 503);
  }
});