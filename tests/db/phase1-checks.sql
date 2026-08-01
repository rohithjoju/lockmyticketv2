\set ON_ERROR_STOP on
\pset pager off

-- Seed fixtures (deterministic UUIDs from 0004_seed.sql):
--   attendee1 33333333-3333-3333-3333-000000000001
--   attendee2 33333333-3333-3333-3333-000000000002
--   attendee3 33333333-3333-3333-3333-000000000003
--   scanner   22222222-2222-2222-2222-000000000001
--   general   cccccccc-cccc-cccc-cccc-000000000001 (200)
--   vip       cccccccc-cccc-cccc-cccc-000000000002 (50)
--   earlybird cccccccc-cccc-cccc-cccc-000000000003 (100)
--   event1    bbbbbbbb-bbbb-bbbb-bbbb-000000000001 (+10d, upcoming)
--   event3    bbbbbbbb-bbbb-bbbb-bbbb-000000000003 (-20d, past)

-- ============================================================
-- AC2: reserve_tickets returns 2 rows and decrements by exactly 2
-- ============================================================
do $$
declare
  before_avail int;
  after_avail  int;
  n_rows       int;
begin
  select available_tickets into before_avail
    from ticket_descriptions where id = 'cccccccc-cccc-cccc-cccc-000000000001';

  select count(*) into n_rows
    from reserve_tickets('33333333-3333-3333-3333-000000000001',
                         'cccccccc-cccc-cccc-cccc-000000000001', 2);

  select available_tickets into after_avail
    from ticket_descriptions where id = 'cccccccc-cccc-cccc-cccc-000000000001';

  if n_rows <> 2 then
    raise exception 'AC2 FAIL: reserve_tickets returned % rows, expected 2', n_rows;
  end if;
  if before_avail - after_avail <> 2 then
    raise exception 'AC2 FAIL: available dropped by %, expected 2', before_avail - after_avail;
  end if;
  raise notice 'AC2 PASS: reserve_tickets(2) -> 2 rows, available % -> %', before_avail, after_avail;
end $$;

-- ============================================================
-- AC3: reserving more than available raises TICKET_SOLD_OUT
-- ============================================================
do $$
begin
  begin
    perform reserve_tickets('33333333-3333-3333-3333-000000000001',
                            'cccccccc-cccc-cccc-cccc-000000000002', 51);  -- only 50 exist
    raise exception 'AC3 FAIL: expected TICKET_SOLD_OUT, none raised';
  exception
    when sqlstate 'P0001' then
      if sqlerrm <> 'TICKET_SOLD_OUT' then
        raise exception 'AC3 FAIL: wrong error "%"', sqlerrm;
      end if;
      raise notice 'AC3 PASS: over-reserving raised TICKET_SOLD_OUT';
  end;
end $$;

-- ============================================================
-- AC4: expire_reservations restores inventory exactly
-- ============================================================
do $$
declare
  before_avail int;
  after_avail  int;
  expired_n    int;
begin
  select available_tickets into before_avail
    from ticket_descriptions where id = 'cccccccc-cccc-cccc-cccc-000000000003';

  perform reserve_tickets('33333333-3333-3333-3333-000000000002',
                          'cccccccc-cccc-cccc-cccc-000000000003', 3);
  update tickets set reservation_expires_at = now() - interval '1 minute'
    where ticket_description_id = 'cccccccc-cccc-cccc-cccc-000000000003'
      and reservation_status = 'reserved';

  perform expire_reservations();

  select available_tickets into after_avail
    from ticket_descriptions where id = 'cccccccc-cccc-cccc-cccc-000000000003';
  select count(*) into expired_n
    from tickets
    where ticket_description_id = 'cccccccc-cccc-cccc-cccc-000000000003'
      and reservation_status = 'expired';

  if after_avail <> before_avail then
    raise exception 'AC4 FAIL: available % != restored %', before_avail, after_avail;
  end if;
  if expired_n <> 3 then
    raise exception 'AC4 FAIL: % tickets expired, expected 3', expired_n;
  end if;
  raise notice 'AC4 PASS: expire_reservations restored inventory to % (3 tickets -> expired)', after_avail;
end $$;

-- ============================================================
-- AC5: verify_ticket_atomic on an already-invalid ticket returns 0 rows
-- ============================================================
do $$
declare
  v_ticket uuid;
  first_n  int;
  second_n int;
begin
  insert into tickets (user_id, event_id, ticket_description_id,
                       status, reservation_status, reservation_expires_at)
  values ('33333333-3333-3333-3333-000000000003',
          'bbbbbbbb-bbbb-bbbb-bbbb-000000000001',
          'cccccccc-cccc-cccc-cccc-000000000001',
          'valid', 'confirmed', now() + interval '1 day')
  returning id into v_ticket;

  select count(*) into first_n
    from verify_ticket_atomic(v_ticket, 'bbbbbbbb-bbbb-bbbb-bbbb-000000000001',
                              '22222222-2222-2222-2222-000000000001');
  select count(*) into second_n
    from verify_ticket_atomic(v_ticket, 'bbbbbbbb-bbbb-bbbb-bbbb-000000000001',
                              '22222222-2222-2222-2222-000000000001');

  if first_n <> 1 then
    raise exception 'AC5 FAIL: first scan returned % rows, expected 1', first_n;
  end if;
  if second_n <> 0 then
    raise exception 'AC5 FAIL: second scan returned % rows, expected 0', second_n;
  end if;
  raise notice 'AC5 PASS: first scan 1 row, second scan 0 rows (one-way redemption)';
end $$;

-- ============================================================
-- AC6: events_with_status computes correct status
-- ============================================================
do $$
declare
  s1 text;
  s3 text;
begin
  select status into s1 from events_with_status
    where id = 'bbbbbbbb-bbbb-bbbb-bbbb-000000000001';  -- +10d
  select status into s3 from events_with_status
    where id = 'bbbbbbbb-bbbb-bbbb-bbbb-000000000003';  -- -20d

  if s1 <> 'upcoming' then
    raise exception 'AC6 FAIL: event1 status % expected upcoming', s1;
  end if;
  if s3 <> 'past' then
    raise exception 'AC6 FAIL: event3 status % expected past', s3;
  end if;
  raise notice 'AC6 PASS: computed statuses event1=% event3=%', s1, s3;
end $$;

-- ============================================================
-- AC7: insert with end_time < start_time is rejected
-- ============================================================
do $$
begin
  begin
    insert into events (organizer_id, title, city, start_time, end_time)
    values ('aaaaaaaa-aaaa-aaaa-aaaa-000000000001', 'Bad Times', 'Nowhere',
            now() + interval '2 days', now() + interval '1 day');
    raise exception 'AC7 FAIL: end<start was accepted';
  exception
    when check_violation then
      raise notice 'AC7 PASS: end<start rejected by chk_event_times';
  end;
end $$;

\echo '>>> ALL PHASE 1 ACCEPTANCE CHECKS PASSED'
