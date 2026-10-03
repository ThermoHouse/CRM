import { createClient } from 'npm:@supabase/supabase-js@2.49.1';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
};
const encoder = new TextEncoder();
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), {
  status,
  headers: { ...corsHeaders, 'Content-Type': 'application/json' },
});
const base64Url = (bytes: Uint8Array) => btoa(String.fromCharCode(...bytes))
  .replaceAll('+', '-').replaceAll('/', '_').replaceAll('=', '');
const fromBase64Url = (value: string) => Uint8Array.from(
  atob(value.replaceAll('-', '+').replaceAll('_', '/') + '='.repeat((4 - value.length % 4) % 4)),
  char => char.charCodeAt(0),
);

function environment() {
  const values = {
    supabaseUrl: Deno.env.get('SUPABASE_URL'),
    anonKey: Deno.env.get('SUPABASE_ANON_KEY'),
    serviceRoleKey: Deno.env.get('SUPABASE_SERVICE_ROLE_KEY'),
    googleClientId: Deno.env.get('GMAIL_OAUTH_CLIENT_ID'),
    googleClientSecret: Deno.env.get('GMAIL_OAUTH_CLIENT_SECRET'),
    stateSecret: Deno.env.get('GMAIL_OAUTH_STATE_SECRET'),
    encryptionKey: Deno.env.get('GMAIL_TOKEN_ENCRYPTION_KEY'),
    appUrl: Deno.env.get('APP_URL'),
  };
  const missing = Object.entries(values).filter(([, value]) => !value).map(([name]) => name);
  if (missing.length) throw new Error(`Faltan secretos de servidor: ${missing.join(', ')}.`);
  return values as Record<keyof typeof values, string>;
}

function callbackUrl(supabaseUrl: string) {
  return `${supabaseUrl.replace(/\/$/, '')}/functions/v1/gmail-connect`;
}

function resultUrl(appUrl: string, status: string) {
  const url = new URL('/', appUrl);
  url.searchParams.set('gmail', status);
  return url.toString();
}

async function signedState(userId: string, secret: string) {
  const payload = base64Url(encoder.encode(JSON.stringify({
    sub: userId,
    exp: Date.now() + 10 * 60_000,
    nonce: crypto.randomUUID(),
  })));
  const key = await crypto.subtle.importKey('raw', encoder.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const signature = await crypto.subtle.sign('HMAC', key, encoder.encode(payload));
  return `${payload}.${base64Url(new Uint8Array(signature))}`;
}

async function verifyState(state: string, secret: string) {
  const [payload, signature, extra] = state.split('.');
  if (!payload || !signature || extra) throw new Error('La solicitud de conexión no es válida.');
  const key = await crypto.subtle.importKey('raw', encoder.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['verify']);
  if (!await crypto.subtle.verify('HMAC', key, fromBase64Url(signature), encoder.encode(payload))) {
    throw new Error('La solicitud de conexión no es válida.');
  }
  const value = JSON.parse(new TextDecoder().decode(fromBase64Url(payload)));
  if (typeof value.sub !== 'string' || value.exp < Date.now()) throw new Error('La solicitud de conexión expiró.');
  return value.sub as string;
}

async function encryptToken(token: string, encodedKey: string) {
  const rawKey = Uint8Array.from(atob(encodedKey), char => char.charCodeAt(0));
  if (rawKey.length !== 32) throw new Error('GMAIL_TOKEN_ENCRYPTION_KEY debe contener 32 bytes en Base64.');
  const key = await crypto.subtle.importKey('raw', rawKey, 'AES-GCM', false, ['encrypt']);
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ciphertext = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, encoder.encode(token));
  return { ciphertext: base64Url(new Uint8Array(ciphertext)), iv: base64Url(iv) };
}

async function decryptToken(ciphertext: string, iv: string, encodedKey: string) {
  const rawKey = Uint8Array.from(atob(encodedKey), char => char.charCodeAt(0));
  if (rawKey.length !== 32) throw new Error('GMAIL_TOKEN_ENCRYPTION_KEY debe contener 32 bytes en Base64.');
  const key = await crypto.subtle.importKey('raw', rawKey, 'AES-GCM', false, ['decrypt']);
  const plaintext = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: fromBase64Url(iv) }, key, fromBase64Url(ciphertext));
  return new TextDecoder().decode(plaintext);
}

async function userFromRequest(request: Request, supabaseUrl: string, anonKey: string) {
  const authorization = request.headers.get('Authorization');
  if (!authorization) throw new Error('Inicia sesión para conectar Gmail.');
  const client = createClient(supabaseUrl, anonKey, {
    global: { headers: { Authorization: authorization } },
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { data, error } = await client.auth.getUser();
  if (error || !data.user) throw new Error('La sesión no es válida.');
  return data.user;
}

Deno.serve(async request => {
  if (request.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

  let config: ReturnType<typeof environment>;
  try {
    config = environment();
  } catch (error) {
    if (request.method === 'GET') return Response.redirect(resultUrl(Deno.env.get('APP_URL') || 'http://localhost:5173', 'error'), 303);
    return json({ error: error.message }, 503);
  }

  const admin = createClient(config.supabaseUrl, config.serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  if (request.method === 'GET') {
    const url = new URL(request.url);
    const status = url.searchParams.get('error') ? 'cancelled' : 'error';
    try {
      if (url.searchParams.has('error')) return Response.redirect(resultUrl(config.appUrl, status), 303);
      const userId = await verifyState(url.searchParams.get('state') || '', config.stateSecret);
      const code = url.searchParams.get('code');
      if (!code) throw new Error('Google no devolvió un código de autorización.');
      const tokensResponse = await fetch('https://oauth2.googleapis.com/token', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          code,
          client_id: config.googleClientId,
          client_secret: config.googleClientSecret,
          redirect_uri: callbackUrl(config.supabaseUrl),
          grant_type: 'authorization_code',
        }),
      });
      const tokens = await tokensResponse.json();
      if (!tokensResponse.ok || !tokens.access_token || !tokens.refresh_token) {
        throw new Error('Google no entregó autorización permanente. Intenta conectar de nuevo.');
      }
      const userResponse = await fetch('https://www.googleapis.com/oauth2/v2/userinfo', {
        headers: { Authorization: `Bearer ${tokens.access_token}` },
      });
      const googleUser = await userResponse.json();
      if (!userResponse.ok || !googleUser.email) throw new Error('No pude verificar el correo de Google.');
      const encrypted = await encryptToken(tokens.refresh_token, config.encryptionKey);
      const { error } = await admin.from('gmail_connections').upsert({
        user_id: userId,
        gmail_email: googleUser.email,
        refresh_token_ciphertext: encrypted.ciphertext,
        refresh_token_iv: encrypted.iv,
        scopes: String(tokens.scope || '').split(' ').filter(Boolean),
        connected_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      }, { onConflict: 'user_id' });
      if (error) throw error;
      return Response.redirect(resultUrl(config.appUrl, 'connected'), 303);
    } catch (error) {
      console.error('Gmail OAuth callback failed:', error.message);
      return Response.redirect(resultUrl(config.appUrl, 'error'), 303);
    }
  }

  if (request.method !== 'POST') return json({ error: 'Método no permitido.' }, 405);

  try {
    const user = await userFromRequest(request, config.supabaseUrl, config.anonKey);
    const body = await request.json().catch(() => ({}));
    if (body.action === 'start') {
      const state = await signedState(user.id, config.stateSecret);
      const authorizeUrl = new URL('https://accounts.google.com/o/oauth2/v2/auth');
      authorizeUrl.search = new URLSearchParams({
        client_id: config.googleClientId,
        redirect_uri: callbackUrl(config.supabaseUrl),
        response_type: 'code',
        access_type: 'offline',
        prompt: 'consent',
        include_granted_scopes: 'true',
        scope: 'openid email https://www.googleapis.com/auth/gmail.readonly https://www.googleapis.com/auth/gmail.send',
        state,
      }).toString();
      return json({ url: authorizeUrl.toString() });
    }
    if (body.action === 'status') {
      const { data, error } = await admin.from('gmail_connections')
        .select('gmail_email,connected_at,scopes').eq('user_id', user.id).maybeSingle();
      if (error) throw error;
      return json({ connected: Boolean(data), connection: data });
    }
    if (body.action === 'disconnect') {
      const { data: connection, error: readError } = await admin.from('gmail_connections')
        .select('refresh_token_ciphertext,refresh_token_iv').eq('user_id', user.id).maybeSingle();
      if (readError) throw readError;
      if (connection) {
        try {
          const token = await decryptToken(connection.refresh_token_ciphertext, connection.refresh_token_iv, config.encryptionKey);
          await fetch('https://oauth2.googleapis.com/revoke', {
            method: 'POST',
            headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
            body: new URLSearchParams({ token }),
          });
        } catch (error) {
          console.error('Could not revoke Gmail token:', error.message);
        }
        const { error } = await admin.from('gmail_connections').delete().eq('user_id', user.id);
        if (error) throw error;
      }
      return json({ connected: false });
    }
    return json({ error: 'Acción no válida.' }, 400);
  } catch (error) {
    const status = /Inicia sesión|sesión no es válida/i.test(error.message) ? 401 : 500;
    return json({ error: error.message || 'No se pudo procesar la conexión Gmail.' }, status);
  }
});