-- ============================================================
-- reserve_tickets() and expire_reservations() (0002) cover two of the four
-- inventory transitions in the §5.1 state machine. The other two also give a
-- seat back:
--
--   reserved  --> cancelled   user abandons before paying
--   confirmed --> cancelled   refund issued
--
-- Both are money paths, so they get the same treatment as reserve: the read of
-- available_tickets and the write that follows live inside one function, under
-- a row lock, where no later refactor can pull them apart (R1).
-- ============================================================

create or replace function cancel_ticket(
  p_ticket_id uuid,
  p_expect    varchar
)
returns integer
language plpgsql
as $$
declare
  v_td     uuid;
  v_status varchar(20);
begin
  -- Lock the ticket, then its inventory row. reserve_tickets() takes the
  -- inventory lock first but only ever INSERTs tickets, so it never waits on a
  -- lock this function holds — the two orders cannot form a cycle.
  select ticket_description_id, reservation_status
    into v_td, v_status
    from tickets
   where id = p_ticket_id
     for update;

  if not found then
    raise exception 'TICKET_NOT_FOUND';
  end if;

  -- Someone else already moved this ticket (a racing expiry, a second refund).
  -- Returning 0 lets the caller reject the duplicate instead of handing back a
  -- seat that was already restored.
  if v_status <> p_expect then
    return 0;
  end if;

  update tickets
     set reservation_status = 'cancelled'
   where id = p_ticket_id;

  -- least(): inventory can never exceed capacity, however many restores race.
  update ticket_descriptions
     set available_tickets = least(available_tickets + 1, total_tickets)
   where id = v_td;

  return 1;
end $$;
