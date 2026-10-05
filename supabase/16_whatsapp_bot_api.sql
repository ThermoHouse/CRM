create table if not exists public.bot_api_rate_limits (
  rate_key text primary key,
  window_started_at timestamptz not null,
  request_count integer not null check (request_count > 0)
);

alter table public.bot_api_rate_limits enable row level security;
revoke all on public.bot_api_rate_limits from public, anon, authenticated;
grant all on public.bot_api_rate_limits to service_role;

create or replace function public.consume_bot_api_rate_limit(
  p_rate_key text,
  p_limit integer default 120,
  p_window_seconds integer default 60
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  current_window timestamptz;
  current_count integer;
begin
  if p_limit < 1 or p_window_seconds < 1 or length(p_rate_key) <> 64 then
    return false;
  end if;

  current_window := to_timestamp(
    floor(extract(epoch from clock_timestamp()) / p_window_seconds) * p_window_seconds
  );

  insert into public.bot_api_rate_limits as rate_limit (rate_key, window_started_at, request_count)
  values (p_rate_key, current_window, 1)
  on conflict (rate_key) do update
  set window_started_at = excluded.window_started_at,
      request_count = case
        when rate_limit.window_started_at = excluded.window_started_at then rate_limit.request_count + 1
        else 1
      end
  returning request_count into current_count;

  if current_count = 1 then
    delete from public.bot_api_rate_limits
    where window_started_at < clock_timestamp() - interval '1 hour';
  end if;

  return current_count <= p_limit;
end;
$$;

revoke all on function public.consume_bot_api_rate_limit(text, integer, integer) from public, anon, authenticated;
grant execute on function public.consume_bot_api_rate_limit(text, integer, integer) to service_role;

create or replace function public.ingest_bot_message(
  p_phone text,
  p_name text,
  p_wa_message_id text,
  p_direction text,
  p_sender text,
  p_type text,
  p_body text,
  p_media_url text,
  p_tokens_in integer,
  p_tokens_out integer,
  p_is_test boolean
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_contact_id uuid;
  v_conversation_id uuid;
  v_conversation_status text;
  v_message_created_at timestamptz;
begin
  select message.conversation_id, conversation.status
    into v_conversation_id, v_conversation_status
  from public.messages as message
  join public.conversations as conversation on conversation.id = message.conversation_id
  where message.wa_message_id = p_wa_message_id;

  if found then
    return jsonb_build_object(
      'conversation_id', v_conversation_id,
      'status', v_conversation_status,
      'duplicate', true
    );
  end if;

  insert into public.contacts (phone, name)
  values (p_phone, nullif(trim(p_name), ''))
  on conflict (phone) do update
    set name = coalesce(excluded.name, contacts.name)
  returning id into v_contact_id;

  select conversation.id, conversation.status
    into v_conversation_id, v_conversation_status
  from public.conversations as conversation
  where conversation.contact_id = v_contact_id
    and conversation.status in ('bot','humano')
  order by conversation.created_at desc
  limit 1
  for update;

  if not found then
    begin
      insert into public.conversations (contact_id, status, is_test)
      values (v_contact_id, 'bot', p_is_test)
      returning id, status into v_conversation_id, v_conversation_status;
    exception when unique_violation then
      select conversation.id, conversation.status
        into v_conversation_id, v_conversation_status
      from public.conversations as conversation
      where conversation.contact_id = v_contact_id
        and conversation.status in ('bot','humano')
      order by conversation.created_at desc
      limit 1
      for update;
      if not found then raise; end if;
    end;
  end if;

  begin
    insert into public.messages (
      conversation_id, wa_message_id, direction, sender, type, body,
      media_url, tokens_in, tokens_out
    ) values (
      v_conversation_id, p_wa_message_id, p_direction, p_sender, p_type, p_body,
      p_media_url, p_tokens_in, p_tokens_out
    ) returning created_at into v_message_created_at;
  exception when unique_violation then
    select message.conversation_id, conversation.status
      into v_conversation_id, v_conversation_status
    from public.messages as message
    join public.conversations as conversation on conversation.id = message.conversation_id
    where message.wa_message_id = p_wa_message_id;
    return jsonb_build_object(
      'conversation_id', v_conversation_id,
      'status', v_conversation_status,
      'duplicate', true
    );
  end;

  update public.conversations as conversation
  set is_test = conversation.is_test or p_is_test,
      last_message_at = greatest(coalesce(conversation.last_message_at, v_message_created_at), v_message_created_at),
      last_customer_message_at = case
        when p_direction = 'in' then greatest(
          coalesce(conversation.last_customer_message_at, v_message_created_at), v_message_created_at
        )
        else conversation.last_customer_message_at
      end
  where conversation.id = v_conversation_id
  returning status into v_conversation_status;

  return jsonb_build_object(
    'conversation_id', v_conversation_id,
    'status', v_conversation_status,
    'duplicate', false
  );
end;
$$;

revoke all on function public.ingest_bot_message(text, text, text, text, text, text, text, text, integer, integer, boolean) from public, anon, authenticated;
grant execute on function public.ingest_bot_message(text, text, text, text, text, text, text, text, integer, integer, boolean) to service_role;

create or replace function public.ingest_bot_event(
  p_phone text,
  p_type text,
  p_payload jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_contact_id uuid;
  v_conversation_id uuid;
  v_conversation_status text;
  v_assignee_id uuid;
  v_assignee_value text;
begin
  insert into public.contacts (phone)
  values (p_phone)
  on conflict (phone) do update set phone = excluded.phone
  returning id into v_contact_id;

  select conversation.id, conversation.status
    into v_conversation_id, v_conversation_status
  from public.conversations as conversation
  where conversation.contact_id = v_contact_id
    and conversation.status in ('bot','humano')
  order by conversation.created_at desc
  limit 1
  for update;

  if not found then
    begin
      insert into public.conversations (contact_id, status)
      values (v_contact_id, 'bot')
      returning id, status into v_conversation_id, v_conversation_status;
    exception when unique_violation then
      select conversation.id, conversation.status
        into v_conversation_id, v_conversation_status
      from public.conversations as conversation
      where conversation.contact_id = v_contact_id
        and conversation.status in ('bot','humano')
      order by conversation.created_at desc
      limit 1
      for update;
      if not found then raise; end if;
    end;
  end if;

  if p_type = 'lead_calificado' then
    insert into public.lead_data (
      conversation_id, nombre, telefono, ubicacion_maps_link, m2,
      presentacion, tipo_techo, estado
    ) values (
      v_conversation_id,
      nullif(p_payload->>'nombre', ''),
      coalesce(nullif(p_payload->>'telefono', ''), p_phone),
      nullif(p_payload->>'ubicacion_maps_link', ''),
      nullif(p_payload->>'m2', '')::numeric,
      nullif(p_payload->>'presentacion', ''),
      nullif(p_payload->>'tipo_techo', ''),
      'calificado'
    ) on conflict (conversation_id) do update set
      nombre = coalesce(excluded.nombre, public.lead_data.nombre),
      telefono = coalesce(excluded.telefono, public.lead_data.telefono),
      ubicacion_maps_link = coalesce(excluded.ubicacion_maps_link, public.lead_data.ubicacion_maps_link),
      m2 = coalesce(excluded.m2, public.lead_data.m2),
      presentacion = coalesce(excluded.presentacion, public.lead_data.presentacion),
      tipo_techo = coalesce(excluded.tipo_techo, public.lead_data.tipo_techo),
      estado = 'calificado';
  elsif p_type = 'asignado' then
    v_assignee_value := nullif(trim(p_payload->>'vendedor'), '');
    if v_assignee_value is not null then
      if v_assignee_value ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
        select profile.id into v_assignee_id
        from public.profiles as profile
        where profile.id = v_assignee_value::uuid;
      else
        select profile.id into v_assignee_id
        from public.profiles as profile
        where lower(profile.email) = lower(v_assignee_value)
        limit 1;
      end if;
      if v_assignee_id is null then raise exception 'El vendedor asignado no existe.'; end if;
      update public.conversations
      set assigned_to = v_assignee_id
      where id = v_conversation_id;
    end if;
  elsif p_type = 'handoff' then
    update public.conversations
    set status = 'humano'
    where id = v_conversation_id
    returning status into v_conversation_status;
  end if;

  insert into public.events (conversation_id, type, payload)
  values (v_conversation_id, p_type, coalesce(p_payload, '{}'::jsonb));

  select conversation.status into v_conversation_status
  from public.conversations as conversation
  where conversation.id = v_conversation_id;

  return jsonb_build_object(
    'conversation_id', v_conversation_id,
    'status', v_conversation_status
  );
end;
$$;

revoke all on function public.ingest_bot_event(text, text, jsonb) from public, anon, authenticated;
grant execute on function public.ingest_bot_event(text, text, jsonb) to service_role;