-- =============================================================================
-- NOVA Phase 1.1 Local Reference Migration (NOT APPLIED TO PRODUCTION)
-- Purpose: Atomic distributed rate limiting & persistent Mode B room storage
--          for future multi-instance deployment if Supabase Postgres is approved.
-- Privacy: Rate-limit buckets store HMAC-SHA256 hashed identifiers only (never raw IPs).
-- =============================================================================

create table if not exists public.nova_rate_limits (
  bucket_key text primary key,
  request_count integer not null default 1 check (request_count >= 0),
  window_reset_at timestamptz not null,
  updated_at timestamptz not null default now()
);

create index if not exists idx_nova_rate_limits_reset
  on public.nova_rate_limits (window_reset_at);

-- Atomic single-statement sliding/fixed bucket increment to prevent check-then-act races.
create or replace function public.nova_consume_rate_limit(
  p_bucket_key text,
  p_max_requests integer,
  p_window_seconds integer
)
returns table (
  allowed boolean,
  remaining integer,
  retry_after_seconds integer
)
language plpgsql
security definer
as $$
declare
  v_now timestamptz := now();
  v_next_reset timestamptz := v_now + make_interval(secs => greatest(1, p_window_seconds));
  v_count integer;
  v_reset timestamptz;
begin
  insert into public.nova_rate_limits (bucket_key, request_count, window_reset_at, updated_at)
  values (p_bucket_key, 1, v_next_reset, v_now)
  on conflict (bucket_key) do update
    set request_count = case
        when nova_rate_limits.window_reset_at <= v_now then 1
        when nova_rate_limits.request_count < p_max_requests then nova_rate_limits.request_count + 1
        else nova_rate_limits.request_count
      end,
      window_reset_at = case
        when nova_rate_limits.window_reset_at <= v_now then v_next_reset
        else nova_rate_limits.window_reset_at
      end,
      updated_at = v_now
  returning request_count, window_reset_at
  into v_count, v_reset;

  -- Note: when already at cap within the active window, detect denied vs exact threshold cleanly.
  if v_count > p_max_requests then
    return query select false, 0, greatest(1, ceil(extract(epoch from (v_reset - v_now)))::integer);
    return;
  end if;

  return query select
    true,
    greatest(0, p_max_requests - v_count),
    0;
end;
$$;

create table if not exists public.nova_rooms (
  id text primary key,
  host_lang_code text not null,
  guest_lang_code text not null,
  host_cred_id text not null,
  guest_cred_id text,
  invite_token_hash text not null,
  invite_consumed boolean not null default false,
  passcode_hash text not null,
  failed_join_count integer not null default 0,
  failed_join_reset_at timestamptz,
  ended boolean not null default false,
  ended_at timestamptz,
  host_last_seen_at timestamptz not null default now(),
  guest_last_seen_at timestamptz,
  last_activity_at timestamptz not null default now(),
  expires_at timestamptz not null default (now() + interval '2 hours'),
  created_at timestamptz not null default now()
);

create index if not exists idx_nova_rooms_expires
  on public.nova_rooms (expires_at);

create table if not exists public.nova_room_messages (
  id text not null,
  room_id text not null references public.nova_rooms(id) on delete cascade,
  sender text not null check (sender in ('host', 'guest')),
  source_text text not null,
  translated_text text not null,
  source_lang text not null,
  target_lang text not null,
  is_final boolean not null default false,
  created_at_ms bigint not null,
  primary key (room_id, id)
);

-- Atomic guest seat claim: avoids concurrent guest hijack race across app replicas.
create or replace function public.nova_claim_guest_seat(
  p_room_id text,
  p_new_guest_cred_id text,
  p_mark_invite_consumed boolean,
  p_active_threshold_secs integer default 25
)
returns table (
  claimed boolean,
  conflict_active boolean
)
language plpgsql
security definer
as $$
declare
  v_room public.nova_rooms%rowtype;
begin
  select * into v_room
  from public.nova_rooms
  where id = p_room_id
  for update;

  if not found or v_room.ended or v_room.expires_at <= now() then
    return query select false, false;
    return;
  end if;

  if v_room.guest_cred_id is not null
     and v_room.guest_last_seen_at is not null
     and v_room.guest_last_seen_at > now() - make_interval(secs => p_active_threshold_secs) then
    return query select false, true;
    return;
  end if;

  update public.nova_rooms
  set guest_cred_id = p_new_guest_cred_id,
      invite_consumed = invite_consumed or p_mark_invite_consumed,
      guest_last_seen_at = now(),
      last_activity_at = now(),
      failed_join_count = 0
  where id = p_room_id;

  return query select true, false;
end;
$$;

-- Retention cleanup procedure (run via cron / pg_cron / scheduled worker).
create or replace function public.nova_cleanup_expired_state()
returns integer
language plpgsql
security definer
as $$
declare
  v_deleted integer := 0;
  v_delta integer := 0;
begin
  delete from public.nova_rate_limits
  where window_reset_at < now() - interval '1 hour';
  get diagnostics v_delta = row_count;
  v_deleted := v_deleted + v_delta;

  delete from public.nova_rooms
  where expires_at < now()
     or (ended = true and ended_at < now() - interval '5 minutes');
  get diagnostics v_delta = row_count;
  v_deleted := v_deleted + v_delta;

  return v_deleted;
end;
$$;
