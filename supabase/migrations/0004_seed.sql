-- ============================================================
-- Dev seed data. Comprehensive dataset for automated & manual testing.
-- All seeded accounts share the password: Password123!
-- Argon2id hash: $argon2id$v=19$m=65536,t=2,p=1$FRUjgppDgG+spDHxFRR4zhJgh+6qJx1j424Gdomt67g$ZEF13snmsHUXdDExUT8ds4w4yCozTQd2g57WsVtPccA
-- Deterministic UUIDs allow automated Playwright tests to reference stable records.
-- ============================================================

-- Clean up existing data to guarantee idempotent re-runs
truncate table audit_logs cascade;
truncate table refunds cascade;
truncate table tickets cascade;
truncate table payments cascade;
truncate table ticket_descriptions cascade;
truncate table events cascade;
truncate table organizers cascade;
truncate table users cascade;

-- ============================================================
-- 1. USERS
-- ============================================================
insert into users (id, name, email, password_hash, role, status, failed_login_attempts, locked_until) values
  -- Admins
  ('11111111-1111-1111-1111-111111111111', 'Platform Admin', 'admin@example.com',
   '$argon2id$v=19$m=65536,t=2,p=1$FRUjgppDgG+spDHxFRR4zhJgh+6qJx1j424Gdomt67g$ZEF13snmsHUXdDExUT8ds4w4yCozTQd2g57WsVtPccA', 'admin', 'active', 0, null),
  ('11111111-1111-1111-1111-111111111112', 'Operations Admin', 'ops.admin@example.com',
   '$argon2id$v=19$m=65536,t=2,p=1$FRUjgppDgG+spDHxFRR4zhJgh+6qJx1j424Gdomt67g$ZEF13snmsHUXdDExUT8ds4w4yCozTQd2g57WsVtPccA', 'admin', 'active', 0, null),
  ('11111111-1111-1111-1111-111111111113', 'Security Admin', 'security.admin@example.com',
   '$argon2id$v=19$m=65536,t=2,p=1$FRUjgppDgG+spDHxFRR4zhJgh+6qJx1j424Gdomt67g$ZEF13snmsHUXdDExUT8ds4w4yCozTQd2g57WsVtPccA', 'admin', 'active', 0, null),

  -- Approved Organizers (User side)
  ('22222222-2222-2222-2222-000000000001', 'Asha Menon', 'org1@example.com',
   '$argon2id$v=19$m=65536,t=2,p=1$FRUjgppDgG+spDHxFRR4zhJgh+6qJx1j424Gdomt67g$ZEF13snmsHUXdDExUT8ds4w4yCozTQd2g57WsVtPccA', 'organizer', 'active', 0, null),
  ('22222222-2222-2222-2222-000000000002', 'Rohan Gupta', 'org2@example.com',
   '$argon2id$v=19$m=65536,t=2,p=1$FRUjgppDgG+spDHxFRR4zhJgh+6qJx1j424Gdomt67g$ZEF13snmsHUXdDExUT8ds4w4yCozTQd2g57WsVtPccA', 'organizer', 'active', 0, null),
  ('22222222-2222-2222-2222-000000000004', 'Vikram Sethi', 'org4@example.com',
   '$argon2id$v=19$m=65536,t=2,p=1$FRUjgppDgG+spDHxFRR4zhJgh+6qJx1j424Gdomt67g$ZEF13snmsHUXdDExUT8ds4w4yCozTQd2g57WsVtPccA', 'organizer', 'active', 0, null),
  ('22222222-2222-2222-2222-000000000005', 'Ananya Rao', 'org5@example.com',
   '$argon2id$v=19$m=65536,t=2,p=1$FRUjgppDgG+spDHxFRR4zhJgh+6qJx1j424Gdomt67g$ZEF13snmsHUXdDExUT8ds4w4yCozTQd2g57WsVtPccA', 'organizer', 'active', 0, null),
  ('22222222-2222-2222-2222-000000000006', 'Karan Patel', 'org6@example.com',
   '$argon2id$v=19$m=65536,t=2,p=1$FRUjgppDgG+spDHxFRR4zhJgh+6qJx1j424Gdomt67g$ZEF13snmsHUXdDExUT8ds4w4yCozTQd2g57WsVtPccA', 'organizer', 'active', 0, null),
  ('22222222-2222-2222-2222-000000000007', 'Siddharth Sen', 'org7@example.com',
   '$argon2id$v=19$m=65536,t=2,p=1$FRUjgppDgG+spDHxFRR4zhJgh+6qJx1j424Gdomt67g$ZEF13snmsHUXdDExUT8ds4w4yCozTQd2g57WsVtPccA', 'organizer', 'active', 0, null),

  -- Pending Organizers (User side)
  ('22222222-2222-2222-2222-000000000003', 'Priya Nair', 'org3@example.com',
   '$argon2id$v=19$m=65536,t=2,p=1$FRUjgppDgG+spDHxFRR4zhJgh+6qJx1j424Gdomt67g$ZEF13snmsHUXdDExUT8ds4w4yCozTQd2g57WsVtPccA', 'organizer', 'active', 0, null),
  ('22222222-2222-2222-2222-000000000008', 'Kavitha Raman', 'pending.chennai@example.com',
   '$argon2id$v=19$m=65536,t=2,p=1$FRUjgppDgG+spDHxFRR4zhJgh+6qJx1j424Gdomt67g$ZEF13snmsHUXdDExUT8ds4w4yCozTQd2g57WsVtPccA', 'attendee', 'active', 0, null),
  ('22222222-2222-2222-2222-000000000009', 'Aditya Joshi', 'pending.pune@example.com',
   '$argon2id$v=19$m=65536,t=2,p=1$FRUjgppDgG+spDHxFRR4zhJgh+6qJx1j424Gdomt67g$ZEF13snmsHUXdDExUT8ds4w4yCozTQd2g57WsVtPccA', 'attendee', 'active', 0, null),
  ('22222222-2222-2222-2222-000000000010', 'Meera Rathore', 'pending.jaipur@example.com',
   '$argon2id$v=19$m=65536,t=2,p=1$FRUjgppDgG+spDHxFRR4zhJgh+6qJx1j424Gdomt67g$ZEF13snmsHUXdDExUT8ds4w4yCozTQd2g57WsVtPccA', 'attendee', 'active', 0, null),

  -- Rejected Organizers
  ('22222222-2222-2222-2222-000000000011', 'Rajesh Kumar', 'rejected1@example.com',
   '$argon2id$v=19$m=65536,t=2,p=1$FRUjgppDgG+spDHxFRR4zhJgh+6qJx1j424Gdomt67g$ZEF13snmsHUXdDExUT8ds4w4yCozTQd2g57WsVtPccA', 'attendee', 'active', 0, null),
  ('22222222-2222-2222-2222-000000000012', 'Neha Sharma', 'rejected2@example.com',
   '$argon2id$v=19$m=65536,t=2,p=1$FRUjgppDgG+spDHxFRR4zhJgh+6qJx1j424Gdomt67g$ZEF13snmsHUXdDExUT8ds4w4yCozTQd2g57WsVtPccA', 'attendee', 'active', 0, null),

  -- Disabled Accounts (For testing security edge cases)
  ('22222222-2222-2222-2222-000000000013', 'Dev Sharma (Suspended)', 'disabled.org@example.com',
   '$argon2id$v=19$m=65536,t=2,p=1$FRUjgppDgG+spDHxFRR4zhJgh+6qJx1j424Gdomt67g$ZEF13snmsHUXdDExUT8ds4w4yCozTQd2g57WsVtPccA', 'organizer', 'disabled', 0, null),
  ('33333333-3333-3333-3333-000000000099', 'Blocked Attendee', 'disabled.user@example.com',
   '$argon2id$v=19$m=65536,t=2,p=1$FRUjgppDgG+spDHxFRR4zhJgh+6qJx1j424Gdomt67g$ZEF13snmsHUXdDExUT8ds4w4yCozTQd2g57WsVtPccA', 'attendee', 'disabled', 0, null),

  -- Locked Out Account (Brute-force lockout testing)
  ('33333333-3333-3333-3333-000000000098', 'Locked Out User', 'locked.user@example.com',
   '$argon2id$v=19$m=65536,t=2,p=1$FRUjgppDgG+spDHxFRR4zhJgh+6qJx1j424Gdomt67g$ZEF13snmsHUXdDExUT8ds4w4yCozTQd2g57WsVtPccA', 'attendee', 'active', 5, now() + interval '15 minutes'),

  -- Standard Attendees (20 users)
  ('33333333-3333-3333-3333-000000000001', 'Attendee One',    'user1@example.com',
   '$argon2id$v=19$m=65536,t=2,p=1$FRUjgppDgG+spDHxFRR4zhJgh+6qJx1j424Gdomt67g$ZEF13snmsHUXdDExUT8ds4w4yCozTQd2g57WsVtPccA', 'attendee', 'active', 0, null),
  ('33333333-3333-3333-3333-000000000002', 'Attendee Two',    'user2@example.com',
   '$argon2id$v=19$m=65536,t=2,p=1$FRUjgppDgG+spDHxFRR4zhJgh+6qJx1j424Gdomt67g$ZEF13snmsHUXdDExUT8ds4w4yCozTQd2g57WsVtPccA', 'attendee', 'active', 0, null),
  ('33333333-3333-3333-3333-000000000003', 'Attendee Three',  'user3@example.com',
   '$argon2id$v=19$m=65536,t=2,p=1$FRUjgppDgG+spDHxFRR4zhJgh+6qJx1j424Gdomt67g$ZEF13snmsHUXdDExUT8ds4w4yCozTQd2g57WsVtPccA', 'attendee', 'active', 0, null),
  ('33333333-3333-3333-3333-000000000004', 'Attendee Four',   'user4@example.com',
   '$argon2id$v=19$m=65536,t=2,p=1$FRUjgppDgG+spDHxFRR4zhJgh+6qJx1j424Gdomt67g$ZEF13snmsHUXdDExUT8ds4w4yCozTQd2g57WsVtPccA', 'attendee', 'active', 0, null),
  ('33333333-3333-3333-3333-000000000005', 'Attendee Five',   'user5@example.com',
   '$argon2id$v=19$m=65536,t=2,p=1$FRUjgppDgG+spDHxFRR4zhJgh+6qJx1j424Gdomt67g$ZEF13snmsHUXdDExUT8ds4w4yCozTQd2g57WsVtPccA', 'attendee', 'active', 0, null),
  ('33333333-3333-3333-3333-000000000006', 'Aarav Sharma',    'user6@example.com',
   '$argon2id$v=19$m=65536,t=2,p=1$FRUjgppDgG+spDHxFRR4zhJgh+6qJx1j424Gdomt67g$ZEF13snmsHUXdDExUT8ds4w4yCozTQd2g57WsVtPccA', 'attendee', 'active', 0, null),
  ('33333333-3333-3333-3333-000000000007', 'Diya Iyer',       'user7@example.com',
   '$argon2id$v=19$m=65536,t=2,p=1$FRUjgppDgG+spDHxFRR4zhJgh+6qJx1j424Gdomt67g$ZEF13snmsHUXdDExUT8ds4w4yCozTQd2g57WsVtPccA', 'attendee', 'active', 0, null),
  ('33333333-3333-3333-3333-000000000008', 'Kabir Das',       'user8@example.com',
   '$argon2id$v=19$m=65536,t=2,p=1$FRUjgppDgG+spDHxFRR4zhJgh+6qJx1j424Gdomt67g$ZEF13snmsHUXdDExUT8ds4w4yCozTQd2g57WsVtPccA', 'attendee', 'active', 0, null),
  ('33333333-3333-3333-3333-000000000009', 'Ishaan Verma',    'user9@example.com',
   '$argon2id$v=19$m=65536,t=2,p=1$FRUjgppDgG+spDHxFRR4zhJgh+6qJx1j424Gdomt67g$ZEF13snmsHUXdDExUT8ds4w4yCozTQd2g57WsVtPccA', 'attendee', 'active', 0, null),
  ('33333333-3333-3333-3333-000000000010', 'Ananya Deshmukh', 'user10@example.com',
   '$argon2id$v=19$m=65536,t=2,p=1$FRUjgppDgG+spDHxFRR4zhJgh+6qJx1j424Gdomt67g$ZEF13snmsHUXdDExUT8ds4w4yCozTQd2g57WsVtPccA', 'attendee', 'active', 0, null),
  ('33333333-3333-3333-3333-000000000011', 'Tanvi Kulkarni',  'user11@example.com',
   '$argon2id$v=19$m=65536,t=2,p=1$FRUjgppDgG+spDHxFRR4zhJgh+6qJx1j424Gdomt67g$ZEF13snmsHUXdDExUT8ds4w4yCozTQd2g57WsVtPccA', 'attendee', 'active', 0, null),
  ('33333333-3333-3333-3333-000000000012', 'Arjun Reddy',     'user12@example.com',
   '$argon2id$v=19$m=65536,t=2,p=1$FRUjgppDgG+spDHxFRR4zhJgh+6qJx1j424Gdomt67g$ZEF13snmsHUXdDExUT8ds4w4yCozTQd2g57WsVtPccA', 'attendee', 'active', 0, null),
  ('33333333-3333-3333-3333-000000000013', 'Zoya Akhtar',     'user13@example.com',
   '$argon2id$v=19$m=65536,t=2,p=1$FRUjgppDgG+spDHxFRR4zhJgh+6qJx1j424Gdomt67g$ZEF13snmsHUXdDExUT8ds4w4yCozTQd2g57WsVtPccA', 'attendee', 'active', 0, null),
  ('33333333-3333-3333-3333-000000000014', 'Rhea Chakraborty','user14@example.com',
   '$argon2id$v=19$m=65536,t=2,p=1$FRUjgppDgG+spDHxFRR4zhJgh+6qJx1j424Gdomt67g$ZEF13snmsHUXdDExUT8ds4w4yCozTQd2g57WsVtPccA', 'attendee', 'active', 0, null),
  ('33333333-3333-3333-3333-000000000015', 'Nikhil Mehra',    'user15@example.com',
   '$argon2id$v=19$m=65536,t=2,p=1$FRUjgppDgG+spDHxFRR4zhJgh+6qJx1j424Gdomt67g$ZEF13snmsHUXdDExUT8ds4w4yCozTQd2g57WsVtPccA', 'attendee', 'active', 0, null),
  ('33333333-3333-3333-3333-000000000016', 'Pooja Hegde',     'user16@example.com',
   '$argon2id$v=19$m=65536,t=2,p=1$FRUjgppDgG+spDHxFRR4zhJgh+6qJx1j424Gdomt67g$ZEF13snmsHUXdDExUT8ds4w4yCozTQd2g57WsVtPccA', 'attendee', 'active', 0, null),
  ('33333333-3333-3333-3333-000000000017', 'Kunal Kapoor',    'user17@example.com',
   '$argon2id$v=19$m=65536,t=2,p=1$FRUjgppDgG+spDHxFRR4zhJgh+6qJx1j424Gdomt67g$ZEF13snmsHUXdDExUT8ds4w4yCozTQd2g57WsVtPccA', 'attendee', 'active', 0, null),
  ('33333333-3333-3333-3333-000000000018', 'Shruti Haasan',   'user18@example.com',
   '$argon2id$v=19$m=65536,t=2,p=1$FRUjgppDgG+spDHxFRR4zhJgh+6qJx1j424Gdomt67g$ZEF13snmsHUXdDExUT8ds4w4yCozTQd2g57WsVtPccA', 'attendee', 'active', 0, null),
  ('33333333-3333-3333-3333-000000000019', 'Gaurav Pandey',   'user19@example.com',
   '$argon2id$v=19$m=65536,t=2,p=1$FRUjgppDgG+spDHxFRR4zhJgh+6qJx1j424Gdomt67g$ZEF13snmsHUXdDExUT8ds4w4yCozTQd2g57WsVtPccA', 'attendee', 'active', 0, null),
  ('33333333-3333-3333-3333-000000000020', 'Simran Kaur',     'user20@example.com',
   '$argon2id$v=19$m=65536,t=2,p=1$FRUjgppDgG+spDHxFRR4zhJgh+6qJx1j424Gdomt67g$ZEF13snmsHUXdDExUT8ds4w4yCozTQd2g57WsVtPccA', 'attendee', 'active', 0, null);

-- ============================================================
-- 2. ORGANIZERS
-- ============================================================
insert into organizers (id, user_id, organization_name, contact_number, address, description, verification_status, rejection_reason, version) values
  -- Approved Organizers
  ('aaaaaaaa-aaaa-aaaa-aaaa-000000000001', '22222222-2222-2222-2222-000000000001',
   'Backwater Events', '9876543201', 'Marine Drive, Kochi, Kerala', 'South Indian music, culture & jazz promoter with over 10 years in live events.', 'approved', null, 2),
  ('aaaaaaaa-aaaa-aaaa-aaaa-000000000002', '22222222-2222-2222-2222-000000000002',
   'Summit Productions', '9876543202', 'Bandra Kurla Complex, Mumbai', 'Premier tech summits, distributed systems conferences, and developer summits.', 'approved', null, 2),
  ('aaaaaaaa-aaaa-aaaa-aaaa-000000000004', '22222222-2222-2222-2222-000000000004',
   'Delhi Soundstage & Arts', '9876543204', 'Connaught Place, New Delhi', 'Classical fusion, rock bands, and contemporary theatre across NCR.', 'approved', null, 2),
  ('aaaaaaaa-aaaa-aaaa-aaaa-000000000005', '22222222-2222-2222-2222-000000000005',
   'Deccan Comedy Club', '9876543205', 'Indiranagar, Bengaluru & Jubilee Hills, Hyderabad', 'Standup specials, open mics, and improv comedy collective.', 'approved', null, 1),
  ('aaaaaaaa-aaaa-aaaa-aaaa-000000000006', '22222222-2222-2222-2222-000000000006',
   'Sunburn Coastal Vibe', '9876543206', 'Anjuna Beach, Goa', 'Electronic dance music festivals, beach sunsets, and sunset acoustic sessions.', 'approved', null, 3),
  ('aaaaaaaa-aaaa-aaaa-aaaa-000000000007', '22222222-2222-2222-2222-000000000007',
   'Bengal Theatre Collective', '9876543207', 'Park Street, Kolkata', 'Experimental theatre, Bengali literary adaptations, and drama workshops.', 'approved', null, 1),

  -- Pending Organizers (Admin review queue)
  ('aaaaaaaa-aaaa-aaaa-aaaa-000000000003', '22222222-2222-2222-2222-000000000003',
   'FreshStart Collective', '9876543203', 'Koramangala, Bengaluru', 'Community street art and indie acoustic sessions.', 'pending', null, 1),
  ('aaaaaaaa-aaaa-aaaa-aaaa-000000000008', '22222222-2222-2222-2222-000000000008',
   'Madras Classical Heritage', '9876543208', 'Mylapore, Chennai', 'Margazhi season carnatic recitals, bharatanatyam ensembles, and veena concerts.', 'pending', null, 1),
  ('aaaaaaaa-aaaa-aaaa-aaaa-000000000009', '22222222-2222-2222-2222-000000000009',
   'Pune Indie Hackers', '9876543209', 'Kothrud, Pune', 'Startup demo days, weekend hackathons, and design sprint workshops.', 'pending', null, 1),
  ('aaaaaaaa-aaaa-aaaa-aaaa-000000000010', '22222222-2222-2222-2222-000000000010',
   'Rajasthan Folk Horizons', '9876543210', 'C-Scheme, Jaipur', 'Manganiyar folk singing, desert festival tours, and artisan craft fairs.', 'pending', null, 1),

  -- Rejected Organizers
  ('aaaaaaaa-aaaa-aaaa-aaaa-000000000011', '22222222-2222-2222-2222-000000000011',
   'Shadow Nightclub', '9876543211', 'Lower Parel, Mumbai', 'Underground techno night parties.', 'rejected', 'Incomplete KYC documentation and illegible corporate registration certificate.', 1),
  ('aaaaaaaa-aaaa-aaaa-aaaa-000000000012', '22222222-2222-2222-2222-000000000012',
   'Unofficial Rave Events', '9876543212', 'South Ext, New Delhi', 'Spontaneous pop-up warehouse parties.', 'rejected', 'Failed mandatory venue safety compliance and lack of municipal permits.', 1),

  -- Organizer belonging to a disabled user
  ('aaaaaaaa-aaaa-aaaa-aaaa-000000000013', '22222222-2222-2222-2222-000000000013',
   'Disreputable Promoters', '9876543213', 'Fort Kochi, Kochi', 'Suspended organizer account.', 'approved', null, 1);

-- ============================================================
-- 3. EVENTS
-- Spans multiple cities, categories, and computed lifecycle statuses.
-- ============================================================
insert into events (
  id, organizer_id, title, description, event_type, location_name, address,
  city, latitude, longitude, start_time, end_time, poster_url, video_url,
  images_urls, terms_and_conditions, refund_policy, organizer_status_snapshot,
  admin_flagged, cancelled_at
) values
  -- Upcoming 1: Kochi Jazz Night (Standard Seed)
  ('bbbbbbbb-bbbb-bbbb-bbbb-000000000001', 'aaaaaaaa-aaaa-aaaa-aaaa-000000000001',
   'Kochi Jazz Night',
   'An enchanting evening of smooth jazz, saxophone solos, and funk improvisations overlooking the scenic backwaters of Marine Drive.',
   'music', 'Marine Drive Amphitheatre', 'Marine Drive Promenade, Kochi',
   'Kochi', 9.9816, 76.2999,
   now() + interval '10 days', now() + interval '10 days' + interval '4 hours',
   'https://res.cloudinary.com/demo/image/upload/v1/concert_jazz.jpg', null,
   '{}', 'Gates open 1 hour before showtime. No outside food or beverages allowed.',
   '{"full_refund_hours": 48, "partial_refund_percent": 50}'::jsonb, 'approved', false, null),

  -- Upcoming 2: Mumbai Tech Summit 2026 (Standard Seed)
  ('bbbbbbbb-bbbb-bbbb-bbbb-000000000002', 'aaaaaaaa-aaaa-aaaa-aaaa-000000000002',
   'Mumbai Tech Summit',
   'Western India largest developer conference featuring keynotes on distributed systems, generative AI architectures, and cloud scale.',
   'conference', 'BKC Convention Centre', 'G Block, Bandra Kurla Complex, Mumbai',
   'Mumbai', 19.0662, 72.8691,
   now() + interval '30 days', now() + interval '30 days' + interval '9 hours',
   'https://res.cloudinary.com/demo/image/upload/v1/tech_summit.jpg', null,
   '{}', 'Laptops allowed. High speed WiFi and boxed lunches included with conference badges.',
   '{"full_refund_hours": 72, "partial_refund_percent": 60}'::jsonb, 'approved', false, null),

  -- Upcoming 3: Delhi Sufi & Rock Fusion
  ('bbbbbbbb-bbbb-bbbb-bbbb-000000000004', 'aaaaaaaa-aaaa-aaaa-aaaa-000000000004',
   'Delhi Sufi & Rock Fusion Live',
   'Experience heart-stirring qawwalis intertwined with electric guitars, heavy bass rhythms, and poetic poetry at the iconic amphitheatre.',
   'music', 'Siri Fort Auditorium', 'August Kranti Marg, New Delhi',
   'Delhi', 28.5492, 77.2185,
   now() + interval '5 days', now() + interval '5 days' + interval '3 hours 30 minutes',
   'https://res.cloudinary.com/demo/image/upload/v1/sufi_rock.jpg', null,
   '{}', 'Parking available at venue basement. Age 12+ recommended.',
   '{"full_refund_hours": 24, "partial_refund_percent": 40}'::jsonb, 'approved', false, null),

  -- Upcoming 4: Bengaluru Standup Comedy Special
  ('bbbbbbbb-bbbb-bbbb-bbbb-000000000005', 'aaaaaaaa-aaaa-aaaa-aaaa-000000000005',
   'Bengaluru Standup Comedy Special: Unfiltered',
   'A 90-minute riot of observational standup comedy dissecting Bengaluru tech life, peak traffic, startup culture, and modern relationships.',
   'comedy', 'The Black Rabbit Arena', '100ft Road, Indiranagar, Bengaluru',
   'Bengaluru', 12.9716, 77.6412,
   now() + interval '3 days', now() + interval '3 days' + interval '2 hours',
   'https://res.cloudinary.com/demo/image/upload/v1/comedy_special.jpg', null,
   '{}', 'Strictly 18+. Audience interaction and mild language included.',
   '{"full_refund_hours": 24, "partial_refund_percent": 50}'::jsonb, 'approved', false, null),

  -- Upcoming 5: Goa Sun & Waves Electronic Fest
  ('bbbbbbbb-bbbb-bbbb-bbbb-000000000006', 'aaaaaaaa-aaaa-aaaa-aaaa-000000000006',
   'Goa Sun & Waves Electronic Fest',
   '3 stages of world-class deep house, melodic techno, and sunset downtempo beats directly on the golden sands of North Goa.',
   'music', 'Curleys Beach Club', 'South Anjuna Beach, Anjuna, Goa',
   'Goa', 15.5802, 73.7423,
   now() + interval '45 days', now() + interval '45 days' + interval '12 hours',
   'https://res.cloudinary.com/demo/image/upload/v1/goa_sun.jpg', null,
   '{}', 'Wristband collection at entrance. Re-entry permitted with active wristband.',
   '{"full_refund_hours": 96, "partial_refund_percent": 50}'::jsonb, 'approved', false, null),

  -- Upcoming 6: Hyderabad AI & Web3 Conclave
  ('bbbbbbbb-bbbb-bbbb-bbbb-000000000007', 'aaaaaaaa-aaaa-aaaa-aaaa-000000000007',
   'Hyderabad AI & DeepTech Conclave',
   'Bringing together India elite ML researchers, foundation model founders, and institutional venture capitalists for lightning talks and networking.',
   'conference', 'HICC Novotel Arena', 'Hitec City, Madhapur, Hyderabad',
   'Hyderabad', 17.4716, 78.3736,
   now() + interval '14 days', now() + interval '14 days' + interval '8 hours',
   'https://res.cloudinary.com/demo/image/upload/v1/ai_deeptech.jpg', null,
   '{}', 'Business formal attire required. Networking lounge open to all badge holders.',
   '{"full_refund_hours": 48, "partial_refund_percent": 50}'::jsonb, 'approved', false, null),

  -- Upcoming 7: Chennai Carnatic Symphony
  ('bbbbbbbb-bbbb-bbbb-bbbb-000000000008', 'aaaaaaaa-aaaa-aaaa-aaaa-000000000008',
   'Chennai Margazhi Symphony: Ragas in Harmony',
   'An orchestral celebration of classical Carnatic ragas performed by a 40-piece instrumental ensemble featuring violin, mridangam, and ghatam.',
   'music', 'The Music Academy', 'TTK Road, Royapettah, Chennai',
   'Chennai', 13.0427, 78.0267,
   now() + interval '21 days', now() + interval '21 days' + interval '3 hours',
   'https://res.cloudinary.com/demo/image/upload/v1/carnatic.jpg', null,
   '{}', 'Silence phones during performances. Recording strictly prohibited.',
   '{"full_refund_hours": 48, "partial_refund_percent": 50}'::jsonb, 'approved', false, null),

  -- Upcoming 8: Kolkata Literary & Theatre Gala
  ('bbbbbbbb-bbbb-bbbb-bbbb-000000000009', 'aaaaaaaa-aaaa-aaaa-aaaa-000000000007',
   'Kolkata Heritage Theatre Festival',
   'Award-winning theatrical productions staging Rabindranath Tagore timeless drama followed by contemporary Bengali chamber plays.',
   'theatre', 'Rabindra Sadan', 'Cathedral Road, Kolkata',
   'Kolkata', 22.5448, 88.3426,
   now() + interval '18 days', now() + interval '18 days' + interval '4 hours',
   'https://res.cloudinary.com/demo/image/upload/v1/theatre.jpg', null,
   '{}', 'Subtitles projected in English above the stage for non-Bengali speakers.',
   '{"full_refund_hours": 48, "partial_refund_percent": 50}'::jsonb, 'approved', false, null),

  -- Upcoming 9: Pune Craft Beer & Food Carnival
  ('bbbbbbbb-bbbb-bbbb-bbbb-000000000010', 'aaaaaaaa-aaaa-aaaa-aaaa-000000000005',
   'Pune Craft Brews & Gourmet Street Feast',
   'Over 30 artisan microbreweries showcasing bespoke ciders, IPAs, and stouts paired with live grill stations and indie folk music.',
   'food', 'Mahalaxmi Lawns', 'Karve Nagar, Pune',
   'Pune', 18.4907, 73.8166,
   now() + interval '7 days', now() + interval '7 days' + interval '8 hours',
   'https://res.cloudinary.com/demo/image/upload/v1/craft_brew.jpg', null,
   '{}', 'Government photo ID mandatory for age verification at brewery counters.',
   '{"full_refund_hours": 48, "partial_refund_percent": 50}'::jsonb, 'approved', false, null),

  -- Ongoing 1: Mumbai Hackathon 2026 (status: 'ongoing')
  ('bbbbbbbb-bbbb-bbbb-bbbb-000000000012', 'aaaaaaaa-aaaa-aaaa-aaaa-000000000002',
   'Mumbai 24-Hour AI Hackathon',
   'Currently active 24-hour sprint to build production-grade agentic applications and real-time autonomous systems.',
   'conference', 'IIT Bombay Research Park', 'Powai, Mumbai',
   'Mumbai', 19.1334, 72.9133,
   now() - interval '2 hours', now() + interval '22 hours',
   'https://res.cloudinary.com/demo/image/upload/v1/hackathon.jpg', null,
   '{}', 'Hacking in progress. On-site mentors and cloud compute vouchers provided.',
   '{"full_refund_hours": 0, "partial_refund_percent": 0}'::jsonb, 'approved', false, null),

  -- Ongoing 2: Bengaluru Weekend Pop-up Flea (status: 'ongoing')
  ('bbbbbbbb-bbbb-bbbb-bbbb-000000000013', 'aaaaaaaa-aaaa-aaaa-aaaa-000000000005',
   'Bengaluru Weekend Pop-up Artisan Flea',
   'Handcrafted sustainable fashion, live vinyl listening bar, artisanal sourdough, and pet-friendly lawns.',
   'food', 'Jayabheri Meadows', 'Whitefield, Bengaluru',
   'Bengaluru', 12.9698, 77.7499,
   now() - interval '1 hour', now() + interval '6 hours',
   'https://res.cloudinary.com/demo/image/upload/v1/flea_market.jpg', null,
   '{}', 'Pets welcome on leashes. Re-entry allowed all day.',
   '{"full_refund_hours": 0, "partial_refund_percent": 0}'::jsonb, 'approved', false, null),

  -- Past 1: Bengaluru Food Fest (Standard Seed - status: 'past')
  ('bbbbbbbb-bbbb-bbbb-bbbb-000000000003', 'aaaaaaaa-aaaa-aaaa-aaaa-000000000001',
   'Bengaluru Food Fest',
   'A celebration of heritage culinary traditions and street food recipes from across Karnataka, Kerala, and Tamil Nadu.',
   'food', 'Palace Grounds', 'Jayachamarajendra Road, Bengaluru',
   'Bengaluru', 12.9985, 77.5921,
   now() - interval '20 days', now() - interval '20 days' + interval '8 hours',
   'https://res.cloudinary.com/demo/image/upload/v1/food_fest.jpg', null,
   '{}', 'Event has concluded.',
   '{"full_refund_hours": 48, "partial_refund_percent": 50}'::jsonb, 'approved', false, null),

  -- Past 2: Kochi Marathon 2026 (status: 'past')
  ('bbbbbbbb-bbbb-bbbb-bbbb-000000000014', 'aaaaaaaa-aaaa-aaaa-aaaa-000000000001',
   'Kochi Backwaters Half-Marathon',
   'Annual scenic coastal marathon running through Willingdon Island, Mattancherry, and Fort Kochi.',
   'sports', 'Jawaharlal Nehru Stadium', 'Kaloor, Kochi',
   'Kochi', 9.9988, 76.3001,
   now() - interval '40 days', now() - interval '40 days' + interval '6 hours',
   'https://res.cloudinary.com/demo/image/upload/v1/marathon.jpg', null,
   '{}', 'Event has concluded.',
   '{"full_refund_hours": 48, "partial_refund_percent": 50}'::jsonb, 'approved', false, null),

  -- Cancelled Event: Delhi Monsoon Acoustic Fest (status: 'cancelled')
  ('bbbbbbbb-bbbb-bbbb-bbbb-000000000015', 'aaaaaaaa-aaaa-aaaa-aaaa-000000000004',
   'Delhi Monsoon Acoustic Fest',
   'Acoustic song-writer showcase cancelled due to unseasonal cloudburst forecast.',
   'music', 'Garden of Five Senses', 'Said-ul-Ajaib, New Delhi',
   'Delhi', 28.5135, 77.1997,
   now() + interval '4 days', now() + interval '4 days' + interval '5 hours',
   'https://res.cloudinary.com/demo/image/upload/v1/acoustic.jpg', null,
   '{}', 'Event cancelled. All ticket holders automatically issued 100% refunds.',
   '{"full_refund_hours": 48, "partial_refund_percent": 50}'::jsonb, 'approved', false, now() - interval '1 day'),

  -- Admin Flagged Event: Moderation Failure (admin_flagged: true)
  ('bbbbbbbb-bbbb-bbbb-bbbb-000000000016', 'aaaaaaaa-aaaa-aaaa-aaaa-000000000001',
   'Underground Bass Experience: Volume IV',
   'Flagged for admin moderation inspection due to sensitive flyer imagery.',
   'music', 'Warehouse 14', 'Willingdon Island, Kochi',
   'Kochi', 9.9542, 76.2691,
   now() + interval '12 days', now() + interval '12 days' + interval '6 hours',
   'https://res.cloudinary.com/demo/image/upload/v1/underground.jpg', null,
   '{}', 'Under review by platform trust and safety.',
   '{"full_refund_hours": 48, "partial_refund_percent": 50}'::jsonb, 'approved', true, null);

-- ============================================================
-- 4. TICKET DESCRIPTIONS (TIERS & CAPACITIES)
-- Includes sold out tiers, low-stock tiers, and abundant tiers.
-- ============================================================
insert into ticket_descriptions (id, event_id, ticket_type_name, ticket_description, price, total_tickets, available_tickets) values
  -- Event 1: Kochi Jazz Night
  ('cccccccc-cccc-cccc-cccc-000000000001', 'bbbbbbbb-bbbb-bbbb-bbbb-000000000001',
   'General', 'Standard amphitheatre open seating with clear lake view', 800.00, 200, 185),
  ('cccccccc-cccc-cccc-cccc-000000000002', 'bbbbbbbb-bbbb-bbbb-bbbb-000000000001',
   'VIP', 'Front two rows reserved seating with complimentary beverage and lounge access', 2500.00, 50, 42),
  ('cccccccc-cccc-cccc-cccc-000000000020', 'bbbbbbbb-bbbb-bbbb-bbbb-000000000001',
   'Early Bird Special', 'Discounted early pass (Sold Out for testing)', 500.00, 30, 0), -- Completely Sold Out Tier!

  -- Event 2: Mumbai Tech Summit
  ('cccccccc-cccc-cccc-cccc-000000000003', 'bbbbbbbb-bbbb-bbbb-bbbb-000000000002',
   'Early Bird', 'Discounted developer registration badge', 1500.00, 100, 88),
  ('cccccccc-cccc-cccc-cccc-000000000004', 'bbbbbbbb-bbbb-bbbb-bbbb-000000000002',
   'Standard', 'Regular conference admission with keynote and expo access', 2500.00, 400, 380),
  ('cccccccc-cccc-cccc-cccc-000000000021', 'bbbbbbbb-bbbb-bbbb-bbbb-000000000002',
   'VIP Founder & Speaker Pass', 'All-access pass with private VIP dinner and speaker lounge', 7500.00, 20, 2), -- Low Stock Tier!

  -- Event 4: Delhi Sufi & Rock Fusion
  ('cccccccc-cccc-cccc-cccc-000000000007', 'bbbbbbbb-bbbb-bbbb-bbbb-000000000004',
   'Balcony', 'Auditorium upper tier seating', 600.00, 300, 290),
  ('cccccccc-cccc-cccc-cccc-000000000008', 'bbbbbbbb-bbbb-bbbb-bbbb-000000000004',
   'Gold Stalls', 'Middle tier seating with prime acoustics', 1400.00, 150, 130),

  -- Event 5: Bengaluru Comedy Special
  ('cccccccc-cccc-cccc-cccc-000000000009', 'bbbbbbbb-bbbb-bbbb-bbbb-000000000005',
   'Standard Entry', 'First-come first-served club seating', 499.00, 120, 110),
  ('cccccccc-cccc-cccc-cccc-000000000010', 'bbbbbbbb-bbbb-bbbb-bbbb-000000000005',
   'Front Row Couch', 'Table seating directly near stage', 999.00, 15, 10),

  -- Event 6: Goa Electronic Fest
  ('cccccccc-cccc-cccc-cccc-000000000011', 'bbbbbbbb-bbbb-bbbb-bbbb-000000000006',
   'Day Pass', 'Access to beach stages and afterparty', 1800.00, 500, 480),
  ('cccccccc-cccc-cccc-cccc-000000000012', 'bbbbbbbb-bbbb-bbbb-bbbb-000000000006',
   'VIP Cabana Access', 'Exclusive beach cabana pass with bar credit', 5000.00, 40, 35),

  -- Event 7: Hyderabad AI Conclave
  ('cccccccc-cccc-cccc-cccc-000000000013', 'bbbbbbbb-bbbb-bbbb-bbbb-000000000007',
   'Delegate Badge', 'Conference entry and exhibition hall', 3000.00, 250, 240),

  -- Event 8: Chennai Carnatic
  ('cccccccc-cccc-cccc-cccc-000000000014', 'bbbbbbbb-bbbb-bbbb-bbbb-000000000008',
   'Season Seat', 'Single concert pass', 450.00, 350, 340),

  -- Event 9: Kolkata Theatre
  ('cccccccc-cccc-cccc-cccc-000000000015', 'bbbbbbbb-bbbb-bbbb-bbbb-000000000009',
   'Hall Pass', 'Reserved hall seat', 350.00, 400, 390),

  -- Event 10: Pune Food Carnival
  ('cccccccc-cccc-cccc-cccc-000000000016', 'bbbbbbbb-bbbb-bbbb-bbbb-000000000010',
   'Tasting Entry', 'Includes 3 craft beer tasting tokens', 799.00, 300, 280),

  -- Event 12: Ongoing Mumbai Hackathon
  ('cccccccc-cccc-cccc-cccc-000000000017', 'bbbbbbbb-bbbb-bbbb-bbbb-000000000012',
   'Hacker Pass', 'Free participant badge with meals and red bull', 0.00, 150, 150),

  -- Event 13: Ongoing Bengaluru Flea
  ('cccccccc-cccc-cccc-cccc-000000000018', 'bbbbbbbb-bbbb-bbbb-bbbb-000000000013',
   'Flea Entry', 'Day admission badge', 150.00, 600, 570),

  -- Event 3: Past Bengaluru Food Fest
  ('cccccccc-cccc-cccc-cccc-000000000005', 'bbbbbbbb-bbbb-bbbb-bbbb-000000000003',
   'Entry', 'General entry', 300.00, 1000, 0),
  ('cccccccc-cccc-cccc-cccc-000000000006', 'bbbbbbbb-bbbb-bbbb-bbbb-000000000003',
   'Premium', 'Tasting passport', 900.00, 150, 0);

-- ============================================================
-- 5. PAYMENTS (Captured, Pending, Failed, Refunded)
-- ============================================================
insert into payments (
  id, user_id, event_id, razorpay_order_id, razorpay_payment_id,
  razorpay_signature, amount, currency, status, payment_method, webhook_processed
) values
  -- User 1: Paid for 2 Kochi Jazz tickets (Captured)
  ('dddddddd-dddd-dddd-dddd-000000000001', '33333333-3333-3333-3333-000000000001',
   'bbbbbbbb-bbbb-bbbb-bbbb-000000000001', 'order_seed_kochi_001', 'pay_seed_kochi_001',
   'simulated_valid_signature_001', 1600.00, 'INR', 'captured', 'upi', true),

  -- User 2: Paid for 1 VIP Kochi Jazz ticket (Captured)
  ('dddddddd-dddd-dddd-dddd-000000000002', '33333333-3333-3333-3333-000000000002',
   'bbbbbbbb-bbbb-bbbb-bbbb-000000000001', 'order_seed_kochi_002', 'pay_seed_kochi_002',
   'simulated_valid_signature_002', 2500.00, 'INR', 'captured', 'card', true),

  -- User 3: Paid for 1 Mumbai Tech Summit ticket (Captured)
  ('dddddddd-dddd-dddd-dddd-000000000003', '33333333-3333-3333-3333-000000000003',
   'bbbbbbbb-bbbb-bbbb-bbbb-000000000002', 'order_seed_mumbai_003', 'pay_seed_mumbai_003',
   'simulated_valid_signature_003', 1500.00, 'INR', 'captured', 'netbanking', true),

  -- User 4: Refunded payment on Kochi Jazz
  ('dddddddd-dddd-dddd-dddd-000000000004', '33333333-3333-3333-3333-000000000004',
   'bbbbbbbb-bbbb-bbbb-bbbb-000000000001', 'order_seed_kochi_004', 'pay_seed_kochi_004',
   'simulated_valid_signature_004', 800.00, 'INR', 'refunded', 'upi', true),

  -- User 5: Payment failed during checkout
  ('dddddddd-dddd-dddd-dddd-000000000005', '33333333-3333-3333-3333-000000000005',
   'bbbbbbbb-bbbb-bbbb-bbbb-000000000001', 'order_seed_kochi_005', null,
   null, 800.00, 'INR', 'failed', 'upi', false),

  -- User 6: Payment pending checkout
  ('dddddddd-dddd-dddd-dddd-000000000006', '33333333-3333-3333-3333-000000000006',
   'bbbbbbbb-bbbb-bbbb-bbbb-000000000004', 'order_seed_delhi_006', null,
   null, 1400.00, 'INR', 'pending', 'card', false);

-- ============================================================
-- 6. TICKETS (Confirmed, Checked-in, Reserved, Cancelled)
-- ============================================================
insert into tickets (
  id, user_id, event_id, ticket_description_id, payment_id,
  status, reservation_status, reserved_at, reservation_expires_at,
  qr_nonce, verified_at, verified_by
) values
  -- User 1: Ticket 1 (Confirmed, Valid, Ready for door scan)
  ('eeeeeeee-eeee-eeee-eeee-000000000001', '33333333-3333-3333-3333-000000000001',
   'bbbbbbbb-bbbb-bbbb-bbbb-000000000001', 'cccccccc-cccc-cccc-cccc-000000000001',
   'dddddddd-dddd-dddd-dddd-000000000001', 'valid', 'confirmed',
   now() - interval '2 days', now() - interval '2 days' + interval '10 minutes',
   'f0000000-0000-0000-0000-000000000001', null, null),

  -- User 1: Ticket 2 (Confirmed, Valid)
  ('eeeeeeee-eeee-eeee-eeee-000000000002', '33333333-3333-3333-3333-000000000001',
   'bbbbbbbb-bbbb-bbbb-bbbb-000000000001', 'cccccccc-cccc-cccc-cccc-000000000001',
   'dddddddd-dddd-dddd-dddd-000000000001', 'valid', 'confirmed',
   now() - interval '2 days', now() - interval '2 days' + interval '10 minutes',
   'f0000000-0000-0000-0000-000000000002', null, null),

  -- User 2: VIP Ticket (Confirmed & ALREADY CHECKED-IN / SCANNED at door!)
  -- Status is 'invalid' and verified_at is set — tests for TICKET_ALREADY_USED!
  ('eeeeeeee-eeee-eeee-eeee-000000000003', '33333333-3333-3333-3333-000000000002',
   'bbbbbbbb-bbbb-bbbb-bbbb-000000000001', 'cccccccc-cccc-cccc-cccc-000000000002',
   'dddddddd-dddd-dddd-dddd-000000000002', 'invalid', 'confirmed',
   now() - interval '1 day', now() - interval '1 day' + interval '10 minutes',
   'f0000000-0000-0000-0000-000000000003', now() - interval '1 hour',
   '22222222-2222-2222-2222-000000000001'),

  -- User 3: Mumbai Tech Ticket (Confirmed, Valid)
  ('eeeeeeee-eeee-eeee-eeee-000000000004', '33333333-3333-3333-3333-000000000003',
   'bbbbbbbb-bbbb-bbbb-bbbb-000000000002', 'cccccccc-cccc-cccc-cccc-000000000003',
   'dddddddd-dddd-dddd-dddd-000000000003', 'valid', 'confirmed',
   now() - interval '3 days', now() - interval '3 days' + interval '10 minutes',
   'f0000000-0000-0000-0000-000000000004', null, null),

  -- User 4: Cancelled / Refunded Ticket
  ('eeeeeeee-eeee-eeee-eeee-000000000005', '33333333-3333-3333-3333-000000000004',
   'bbbbbbbb-bbbb-bbbb-bbbb-000000000001', 'cccccccc-cccc-cccc-cccc-000000000001',
   'dddddddd-dddd-dddd-dddd-000000000004', 'invalid', 'cancelled',
   now() - interval '4 days', now() - interval '4 days' + interval '10 minutes',
   'f0000000-0000-0000-0000-000000000005', null, null),

  -- User 5: Currently Active Reservation (On Hold, expires in 8 minutes)
  ('eeeeeeee-eeee-eeee-eeee-000000000006', '33333333-3333-3333-3333-000000000005',
   'bbbbbbbb-bbbb-bbbb-bbbb-000000000001', 'cccccccc-cccc-cccc-cccc-000000000001',
   null, 'valid', 'reserved',
   now() - interval '2 minutes', now() + interval '8 minutes',
   'f0000000-0000-0000-0000-000000000006', null, null),

  -- User 6: Expired Reservation (Lapsed without payment)
  ('eeeeeeee-eeee-eeee-eeee-000000000007', '33333333-3333-3333-3333-000000000006',
   'bbbbbbbb-bbbb-bbbb-bbbb-000000000001', 'cccccccc-cccc-cccc-cccc-000000000001',
   null, 'valid', 'expired',
   now() - interval '2 hours', now() - interval '1 hour 50 minutes',
   'f0000000-0000-0000-0000-000000000007', null, null);

-- ============================================================
-- 7. REFUNDS
-- ============================================================
insert into refunds (
  id, payment_id, ticket_id, initiated_by, reason, status,
  razorpay_refund_id, amount, processed_at
) values
  ('ffffffff-ffff-ffff-ffff-000000000001',
   'dddddddd-dddd-dddd-dddd-000000000004',
   'eeeeeeee-eeee-eeee-eeee-000000000005',
   '33333333-3333-3333-3333-000000000004',
   'user_requested', 'processed', 'rfnd_seed_kochi_001',
   800.00, now() - interval '3 days');

-- ============================================================
-- 8. AUDIT LOGS (R10)
-- Realistic historical platform audit trail for admin inspection.
-- ============================================================
insert into audit_logs (
  id, actor_user_id, action_type, target_table, target_id,
  old_value, new_value, ip_address, request_id, created_at
) values
  -- Admin approved Organizer 1
  ('99999999-9999-9999-9999-000000000001',
   '11111111-1111-1111-1111-111111111111',
   'organizer.approved', 'organizers', 'aaaaaaaa-aaaa-aaaa-aaaa-000000000001',
   '{"verificationStatus": "pending", "version": 1}'::jsonb,
   '{"verificationStatus": "approved", "version": 2}'::jsonb,
   '127.0.0.1', 'req_seed_audit_001', now() - interval '30 days'),

  -- Admin rejected Malicious Organizer
  ('99999999-9999-9999-9999-000000000002',
   '11111111-1111-1111-1111-111111111111',
   'organizer.rejected', 'organizers', 'aaaaaaaa-aaaa-aaaa-aaaa-000000000011',
   '{"verificationStatus": "pending", "version": 1}'::jsonb,
   '{"verificationStatus": "rejected", "version": 1, "reason": "Incomplete KYC documentation."}'::jsonb,
   '127.0.0.1', 'req_seed_audit_002', now() - interval '15 days'),

  -- Admin disabled suspicious user
  ('99999999-9999-9999-9999-000000000003',
   '11111111-1111-1111-1111-111111111111',
   'user.disabled', 'users', '33333333-3333-3333-3333-000000000099',
   '{"status": "active"}'::jsonb,
   '{"status": "disabled", "eventsFlagged": 0}'::jsonb,
   '127.0.0.1', 'req_seed_audit_003', now() - interval '5 days'),

  -- Organizer updated event after tickets sold
  ('99999999-9999-9999-9999-000000000004',
   '22222222-2222-2222-2222-000000000001',
   'event.updated_after_sale', 'events', 'bbbbbbbb-bbbb-bbbb-bbbb-000000000001',
   '{"locationName": "Marine Drive Grounds"}'::jsonb,
   '{"locationName": "Marine Drive Amphitheatre", "changeReason": "Upgraded venue to covered amphitheatre due to weather."}'::jsonb,
   '127.0.0.1', 'req_seed_audit_004', now() - interval '2 days');
