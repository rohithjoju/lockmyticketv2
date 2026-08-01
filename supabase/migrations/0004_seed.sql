-- ============================================================
-- Dev seed data. Idempotent-ish (fresh DB expected).
-- All seeded accounts share the password: Password123!
-- (argon2id hash below). Deterministic UUIDs so tests can reference them.
-- ============================================================

-- Shared argon2id hash of 'Password123!'
-- $argon2id$v=19$m=65536,t=2,p=1$...

-- ---------- users
insert into users (id, name, email, password_hash, role) values
  ('11111111-1111-1111-1111-111111111111', 'Platform Admin', 'admin@example.com',
   '$argon2id$v=19$m=65536,t=2,p=1$FRUjgppDgG+spDHxFRR4zhJgh+6qJx1j424Gdomt67g$ZEF13snmsHUXdDExUT8ds4w4yCozTQd2g57WsVtPccA', 'admin'),

  -- approved organizers (user side)
  ('22222222-2222-2222-2222-000000000001', 'Asha Menon', 'org1@example.com',
   '$argon2id$v=19$m=65536,t=2,p=1$FRUjgppDgG+spDHxFRR4zhJgh+6qJx1j424Gdomt67g$ZEF13snmsHUXdDExUT8ds4w4yCozTQd2g57WsVtPccA', 'organizer'),
  ('22222222-2222-2222-2222-000000000002', 'Rohan Gupta', 'org2@example.com',
   '$argon2id$v=19$m=65536,t=2,p=1$FRUjgppDgG+spDHxFRR4zhJgh+6qJx1j424Gdomt67g$ZEF13snmsHUXdDExUT8ds4w4yCozTQd2g57WsVtPccA', 'organizer'),

  -- pending organizer (user side)
  ('22222222-2222-2222-2222-000000000003', 'Priya Nair', 'org3@example.com',
   '$argon2id$v=19$m=65536,t=2,p=1$FRUjgppDgG+spDHxFRR4zhJgh+6qJx1j424Gdomt67g$ZEF13snmsHUXdDExUT8ds4w4yCozTQd2g57WsVtPccA', 'organizer'),

  -- attendees
  ('33333333-3333-3333-3333-000000000001', 'Attendee One',   'user1@example.com',
   '$argon2id$v=19$m=65536,t=2,p=1$FRUjgppDgG+spDHxFRR4zhJgh+6qJx1j424Gdomt67g$ZEF13snmsHUXdDExUT8ds4w4yCozTQd2g57WsVtPccA', 'attendee'),
  ('33333333-3333-3333-3333-000000000002', 'Attendee Two',   'user2@example.com',
   '$argon2id$v=19$m=65536,t=2,p=1$FRUjgppDgG+spDHxFRR4zhJgh+6qJx1j424Gdomt67g$ZEF13snmsHUXdDExUT8ds4w4yCozTQd2g57WsVtPccA', 'attendee'),
  ('33333333-3333-3333-3333-000000000003', 'Attendee Three', 'user3@example.com',
   '$argon2id$v=19$m=65536,t=2,p=1$FRUjgppDgG+spDHxFRR4zhJgh+6qJx1j424Gdomt67g$ZEF13snmsHUXdDExUT8ds4w4yCozTQd2g57WsVtPccA', 'attendee'),
  ('33333333-3333-3333-3333-000000000004', 'Attendee Four',  'user4@example.com',
   '$argon2id$v=19$m=65536,t=2,p=1$FRUjgppDgG+spDHxFRR4zhJgh+6qJx1j424Gdomt67g$ZEF13snmsHUXdDExUT8ds4w4yCozTQd2g57WsVtPccA', 'attendee'),
  ('33333333-3333-3333-3333-000000000005', 'Attendee Five',  'user5@example.com',
   '$argon2id$v=19$m=65536,t=2,p=1$FRUjgppDgG+spDHxFRR4zhJgh+6qJx1j424Gdomt67g$ZEF13snmsHUXdDExUT8ds4w4yCozTQd2g57WsVtPccA', 'attendee');

-- ---------- organizers
insert into organizers (id, user_id, organization_name, contact_number, address, description, verification_status) values
  ('aaaaaaaa-aaaa-aaaa-aaaa-000000000001', '22222222-2222-2222-2222-000000000001',
   'Backwater Events', '9876543201', 'MG Road, Kochi', 'Music & culture promoters', 'approved'),
  ('aaaaaaaa-aaaa-aaaa-aaaa-000000000002', '22222222-2222-2222-2222-000000000002',
   'Summit Productions', '9876543202', 'Bandra, Mumbai', 'Tech conference organizers', 'approved'),
  ('aaaaaaaa-aaaa-aaaa-aaaa-000000000003', '22222222-2222-2222-2222-000000000003',
   'FreshStart Collective', '9876543203', 'Indiranagar, Bengaluru', 'New applicant', 'pending');

-- ---------- events (times relative to now for stable status)
insert into events (id, organizer_id, title, description, event_type, location_name, address,
                    city, latitude, longitude, start_time, end_time,
                    organizer_status_snapshot)
values
  ('bbbbbbbb-bbbb-bbbb-bbbb-000000000001', 'aaaaaaaa-aaaa-aaaa-aaaa-000000000001',
   'Kochi Jazz Night', 'An evening of smooth jazz by the backwaters.', 'music',
   'Marine Drive Amphitheatre', 'Marine Drive, Kochi', 'Kochi', 9.9816, 76.2999,
   now() + interval '10 days', now() + interval '10 days' + interval '4 hours', 'approved'),

  ('bbbbbbbb-bbbb-bbbb-bbbb-000000000002', 'aaaaaaaa-aaaa-aaaa-aaaa-000000000002',
   'Mumbai Tech Summit', 'A full day of talks on distributed systems and AI.', 'conference',
   'BKC Convention Centre', 'Bandra Kurla Complex, Mumbai', 'Mumbai', 19.0662, 72.8691,
   now() + interval '30 days', now() + interval '30 days' + interval '9 hours', 'approved'),

  ('bbbbbbbb-bbbb-bbbb-bbbb-000000000003', 'aaaaaaaa-aaaa-aaaa-aaaa-000000000001',
   'Bengaluru Food Fest', 'Street food from across South India.', 'food',
   'Palace Grounds', 'Palace Grounds, Bengaluru', 'Bengaluru', 12.9985, 77.5921,
   now() - interval '20 days', now() - interval '20 days' + interval '8 hours', 'approved');

-- ---------- ticket_descriptions (~6)
insert into ticket_descriptions (id, event_id, ticket_type_name, ticket_description, price, total_tickets, available_tickets) values
  ('cccccccc-cccc-cccc-cccc-000000000001', 'bbbbbbbb-bbbb-bbbb-bbbb-000000000001',
   'General', 'Standard seating', 800.00, 200, 200),
  ('cccccccc-cccc-cccc-cccc-000000000002', 'bbbbbbbb-bbbb-bbbb-bbbb-000000000001',
   'VIP', 'Front row + lounge access', 2500.00, 50, 50),
  ('cccccccc-cccc-cccc-cccc-000000000003', 'bbbbbbbb-bbbb-bbbb-bbbb-000000000002',
   'Early Bird', 'Discounted early access', 1500.00, 100, 100),
  ('cccccccc-cccc-cccc-cccc-000000000004', 'bbbbbbbb-bbbb-bbbb-bbbb-000000000002',
   'Standard', 'Regular admission', 2500.00, 400, 400),
  ('cccccccc-cccc-cccc-cccc-000000000005', 'bbbbbbbb-bbbb-bbbb-bbbb-000000000003',
   'Entry', 'General entry', 300.00, 1000, 1000),
  ('cccccccc-cccc-cccc-cccc-000000000006', 'bbbbbbbb-bbbb-bbbb-bbbb-000000000003',
   'Premium', 'Tasting passport', 900.00, 150, 150);
