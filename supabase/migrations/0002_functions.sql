-- ============================================================
-- reserve_tickets: R1 — the ONLY legal way to decrement inventory.
-- Locks the ticket type row, verifies availability and per-user cap,
-- decrements, and creates N reserved ticket rows atomically.
-- ============================================================
create or replace function reserve_tickets(
  p_user_id               uuid,
  p_ticket_description_id uuid,
  p_quantity              integer,
  p_ttl_minutes           integer default 10,
  p_max_per_user          integer default 10
)
returns table (ticket_id uuid, expires_at timestamptz)
language plpgsql
as $$
declare
  v_available   integer;
  v_event_id    uuid;
  v_already     integer;
  v_expires     timestamptz;
  i             integer;
  v_new_id      uuid;
begin
  if p_quantity < 1 then
    raise exception 'INVALID_QUANTITY';
  end if;

  -- Lock the inventory row. Concurrent callers serialize here.
  select available_tickets, event_id
    into v_available, v_event_id
  from ticket_descriptions
  where id = p_ticket_description_id
  for update;

  if not found then
    raise exception 'TICKET_TYPE_NOT_FOUND';
  end if;

  if v_available < p_quantity then
    raise exception 'TICKET_SOLD_OUT';
  end if;

  -- Per-user cap across reserved + confirmed tickets for this event
  select count(*) into v_already
  from tickets
  where user_id = p_user_id
    and event_id = v_event_id
    and reservation_status in ('reserved','confirmed');

  if v_already + p_quantity > p_max_per_user then
    raise exception 'TICKET_LIMIT_EXCEEDED';
  end if;

  update ticket_descriptions
     set available_tickets = available_tickets - p_quantity
   where id = p_ticket_description_id;

  v_expires := now() + make_interval(mins => p_ttl_minutes);

  for i in 1..p_quantity loop
    insert into tickets (
      user_id, event_id, ticket_description_id,
      reservation_status, reserved_at, reservation_expires_at
    ) values (
      p_user_id, v_event_id, p_ticket_description_id,
      'reserved', now(), v_expires
    ) returning id into v_new_id;

    ticket_id := v_new_id;
    expires_at := v_expires;
    return next;
  end loop;
end $$;

-- ============================================================
-- expire_reservations: restores inventory for lapsed reservations.
-- Run every 60s (Phase 4 job). Safe to run concurrently.
-- ============================================================
create or replace function expire_reservations()
returns integer
language plpgsql
as $$
declare
  v_count integer := 0;
begin
  with lapsed as (
    select id, ticket_description_id
    from tickets
    where reservation_status = 'reserved'
      and reservation_expires_at < now()
    for update skip locked          -- concurrent-safe
  ),
  released as (
    update tickets t
       set reservation_status = 'expired'
      from lapsed l
     where t.id = l.id
    returning t.ticket_description_id
  ),
  restored as (
    select ticket_description_id, count(*) as n
    from released
    group by ticket_description_id
  )
  update ticket_descriptions td
     set available_tickets = least(td.available_tickets + r.n, td.total_tickets)
    from restored r
   where td.id = r.ticket_description_id;

  get diagnostics v_count = row_count;
  return v_count;
end $$;

-- ============================================================
-- verify_ticket_atomic: R — one-way, single-use QR redemption.
-- Returns 0 rows if the ticket was already scanned. The caller
-- MUST treat 0 rows as TICKET_ALREADY_USED, never retry-and-succeed.
-- ============================================================
create or replace function verify_ticket_atomic(
  p_ticket_id  uuid,
  p_event_id   uuid,
  p_scanner_id uuid
)
returns table (ticket_id uuid, attendee_name text, verified_at timestamptz)
language plpgsql
as $$
begin
  return query
  update tickets t
     set status = 'invalid',
         verified_at = now(),
         verified_by = p_scanner_id
   where t.id = p_ticket_id
     and t.event_id = p_event_id
     and t.status = 'valid'
     and t.reservation_status = 'confirmed'
  returning t.id,
            (select u.name from users u where u.id = t.user_id)::text,
            t.verified_at;
end $$;
