import { createClient } from 'npm:@supabase/supabase-js@2.49.1';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, apikey, x-client-info, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), {
  status,
  headers: { ...corsHeaders, 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
});

async function removeProfileAvatars(admin: ReturnType<typeof createClient>, userId: string) {
  const bucket = admin.storage.from('profile-avatars');
  const paths: string[] = [];

  for (let offset = 0; ; offset += 100) {
    const { data, error } = await bucket.list(userId, { limit: 100, offset });
    if (error) throw new Error('No se pudieron consultar las fotos del perfil.');
    const items = data || [];
    paths.push(...items.filter(item => item.id).map(item => `${userId}/${item.name}`));
    if (items.length < 100) break;
  }

  for (let offset = 0; offset < paths.length; offset += 100) {
    const { error } = await bucket.remove(paths.slice(offset, offset + 100));
    if (error) throw new Error('No se pudieron eliminar las fotos del perfil.');
  }
}

Deno.serve(async request => {
  if (request.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (request.method !== 'POST') return json({ error: 'Método no permitido.' }, 405);

  const authorization = request.headers.get('Authorization');
  if (!authorization?.startsWith('Bearer ')) return json({ error: 'Inicia sesión para continuar.' }, 401);

  const supabaseUrl = Deno.env.get('SUPABASE_URL');
  const anonKey = Deno.env.get('SUPABASE_ANON_KEY');
  const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  if (!supabaseUrl || !anonKey || !serviceRoleKey) {
    return json({ error: 'La función no está configurada.' }, 503);
  }

  const userClient = createClient(supabaseUrl, anonKey, {
    global: { headers: { Authorization: authorization } },
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { data: authData, error: authError } = await userClient.auth.getUser();
  if (authError || !authData.user) return json({ error: 'La sesión no es válida.' }, 401);

  const admin = createClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { data: actor, error: actorError } = await admin.from('profiles')
    .select('role,deactivated_at')
    .eq('id', authData.user.id)
    .maybeSingle();
  if (actorError) return json({ error: 'No se pudo validar el permiso de administración.' }, 500);
  if (actor?.role !== 'root' || actor.deactivated_at) return json({ error: 'Solo root puede eliminar usuarios.' }, 403);

  const body = await request.json().catch(() => null);
  const targetUserId = body && typeof body === 'object' && !Array.isArray(body)
    ? (body as Record<string, unknown>).targetUserId
    : null;
  if (typeof targetUserId !== 'string' || !UUID.test(targetUserId)) {
    return json({ error: 'El identificador del usuario no es válido.' }, 400);
  }
  if (targetUserId === authData.user.id) return json({ error: 'No puedes eliminar tu propia cuenta.' }, 400);

  const { data: target, error: targetError } = await admin.from('profiles')
    .select('id,deactivated_at')
    .eq('id', targetUserId)
    .maybeSingle();
  if (targetError) return json({ error: 'No se pudo consultar la papelera.' }, 500);
  if (!target || !target.deactivated_at) {
    return json({ error: 'Solo se pueden eliminar usuarios que ya estén dados de baja.' }, 409);
  }

  const { error: purgeError } = await admin.rpc('purge_deactivated_user_identity', {
    p_actor_user_id: authData.user.id,
    p_target_user_id: targetUserId,
  });
  if (purgeError) {
    console.error('User identity anonymization failed.', purgeError);
    return json({ error: 'No se pudo anonimizar la información del usuario.' }, 500);
  }

  try {
    await removeProfileAvatars(admin, targetUserId);
  } catch (error) {
    console.error('Profile avatar cleanup failed.', error);
    return json({
      error: error instanceof Error ? error.message : 'No se pudieron limpiar las fotos del perfil.',
      retryable: true,
    }, 500);
  }

  const { error: deleteError } = await admin.auth.admin.deleteUser(targetUserId);
  if (deleteError) {
    console.error('Auth account deletion failed.', deleteError);
    return json({
      error: 'La identidad y atribuciones ya se anonimizaron, pero Supabase Auth no pudo terminar de borrar la cuenta. Puedes reintentar desde la papelera.',
      retryable: true,
    }, 500);
  }

  return json({ deleted: true });
});
