create extension if not exists "uuid-ossp";
create extension if not exists pg_trgm;

-- ============================================================
create table users (
  id             uuid primary key default uuid_generate_v4(),
  name           varchar(120) not null,
  email          varchar(255) not null unique,
  password_hash  text not null,
  role           varchar(20) not null default 'attendee'
                 check (role in ('attendee','organizer','admin')),
  status         varchar(20) not null default 'active'
                 check (status in ('active','disabled')),
  failed_login_attempts int not null default 0,
  locked_until   timestamptz,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);
create index idx_users_email on users(lower(email));
create index idx_users_role  on users(role) where status = 'active';

-- ============================================================
create table organizers (
  id                  uuid primary key default uuid_generate_v4(),
  user_id             uuid not null unique references users(id) on delete cascade,
  organization_name   varchar(200) not null,
  contact_number      varchar(10) not null check (contact_number ~ '^[0-9]{10}$'),
  address             text,
  description         text,
  kyc_document_url    text,
  verification_status varchar(20) not null default 'pending'
                      check (verification_status in ('pending','approved','rejected')),
  rejection_reason    text,
  version             integer not null default 1,   -- optimistic lock (R: admin race)
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now()
);
create index idx_organizers_pending on organizers(created_at)
  where verification_status = 'pending';

-- ============================================================
create table events (
  id                        uuid primary key default uuid_generate_v4(),
  organizer_id              uuid not null references organizers(id) on delete restrict,
  title                     varchar(200) not null,
  description               text,
  event_type                varchar(50),
  location_name             varchar(200),
  address                   text,
  city                      varchar(100) not null,
  latitude                  double precision,
  longitude                 double precision,
  start_time                timestamptz not null,
  end_time                  timestamptz not null,
  poster_url                text,
  video_url                 text,
  images_urls               text[] not null default '{}',
  terms_and_conditions      text,
  refund_policy             jsonb not null default
                            '{"full_refund_hours":48,"partial_refund_percent":50}'::jsonb,
  organizer_status_snapshot varchar(20),      -- organizer verification at creation time
  admin_flagged             boolean not null default false,
  cancelled_at              timestamptz,
  search_vector             tsvector generated always as (
                              to_tsvector('english',
                                coalesce(title,'') || ' ' || coalesce(description,''))
                            ) stored,
  created_at                timestamptz not null default now(),
  updated_at                timestamptz not null default now(),
  constraint chk_event_times check (end_time > start_time),
  constraint chk_images_max  check (array_length(images_urls,1) is null
                                    or array_length(images_urls,1) <= 3)
);
create index idx_events_city_start on events(city, start_time);
create index idx_events_organizer  on events(organizer_id);
create index idx_events_search     on events using gin(search_vector);
create index idx_events_upcoming   on events(start_time) where cancelled_at is null;

-- R7: status is computed, never stored
create view events_with_status as
select e.*,
  case
    when e.cancelled_at is not null      then 'cancelled'
    when now() < e.start_time            then 'upcoming'
    when now() between e.start_time and e.end_time then 'ongoing'
    else 'past'
  end as status
from events e;

-- ============================================================
create table ticket_descriptions (
  id                uuid primary key default uuid_generate_v4(),
  event_id          uuid not null references events(id) on delete cascade,
  ticket_type_name  varchar(100) not null,
  ticket_description text,
  price             numeric(10,2) not null check (price >= 0),
  total_tickets     integer not null check (total_tickets > 0),
  available_tickets integer not null check (available_tickets >= 0),
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  constraint chk_available_lte_total check (available_tickets <= total_tickets)
);
create index idx_td_event on ticket_descriptions(event_id);

-- ============================================================
create table tickets (
  id                     uuid primary key default uuid_generate_v4(),
  user_id                uuid not null references users(id) on delete restrict,
  event_id               uuid not null references events(id) on delete restrict,
  ticket_description_id  uuid not null references ticket_descriptions(id) on delete restrict,
  payment_id             uuid,                          -- FK added after payments table
  status                 varchar(20) not null default 'valid'
                         check (status in ('valid','invalid')),
  reservation_status     varchar(20) not null default 'reserved'
                         check (reservation_status in
                           ('reserved','confirmed','expired','cancelled')),
  reserved_at            timestamptz not null default now(),
  reservation_expires_at timestamptz not null,
  qr_jwt_token           text,
  qr_nonce               uuid not null default uuid_generate_v4(),
  verified_at            timestamptz,
  verified_by            uuid references users(id),
  created_at             timestamptz not null default now()
);
create index idx_tickets_user  on tickets(user_id, created_at desc);
create index idx_tickets_event on tickets(event_id)
  where reservation_status = 'confirmed';
create index idx_tickets_expiry on tickets(reservation_expires_at)
  where reservation_status = 'reserved';
create index idx_tickets_qr_nonce on tickets(qr_nonce);

-- ============================================================
create table payments (
  id                  uuid primary key default uuid_generate_v4(),
  user_id             uuid not null references users(id) on delete restrict,
  event_id            uuid not null references events(id) on delete restrict,
  razorpay_order_id   varchar(100) not null unique,
  razorpay_payment_id varchar(100) unique,     -- R3: idempotency anchor
  razorpay_signature  varchar(255),
  amount              numeric(10,2) not null check (amount > 0),
  currency            char(3) not null default 'INR',
  status              varchar(20) not null default 'pending'
                      check (status in ('pending','captured','failed','refunded')),
  payment_method      varchar(50),
  failure_reason      text,
  webhook_processed   boolean not null default false,
  webhook_received_at timestamptz,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now()
);
create index idx_payments_user   on payments(user_id, created_at desc);
create index idx_payments_status on payments(status)
  where status in ('pending','captured');

alter table tickets
  add constraint fk_tickets_payment
  foreign key (payment_id) references payments(id) on delete set null;

-- ============================================================
create table refunds (
  id                 uuid primary key default uuid_generate_v4(),
  payment_id         uuid not null references payments(id) on delete restrict,
  ticket_id          uuid not null references tickets(id) on delete restrict,
  initiated_by       uuid not null references users(id),
  reason             varchar(30) not null
                     check (reason in ('user_requested','event_cancelled','organizer_action')),
  status             varchar(20) not null default 'pending'
                     check (status in ('pending','processed','failed')),
  razorpay_refund_id varchar(100) unique,
  amount             numeric(10,2) not null check (amount > 0),
  failure_reason     text,
  created_at         timestamptz not null default now(),
  processed_at       timestamptz,
  constraint uq_refund_per_ticket unique (ticket_id)   -- one refund per ticket
);

-- ============================================================
create table audit_logs (
  id            uuid primary key default uuid_generate_v4(),
  actor_user_id uuid references users(id),
  action_type   varchar(60) not null,
  target_table  varchar(50) not null,
  target_id     uuid not null,
  old_value     jsonb,
  new_value     jsonb,
  ip_address    inet,
  request_id    varchar(64),
  created_at    timestamptz not null default now()
);
create index idx_audit_target on audit_logs(target_table, target_id, created_at desc);
create index idx_audit_actor  on audit_logs(actor_user_id, created_at desc);

-- ============================================================
-- updated_at triggers
create or replace function set_updated_at() returns trigger as $$
begin new.updated_at := now(); return new; end;
$$ language plpgsql;

do $$
declare t text;
begin
  foreach t in array array['users','organizers','events','ticket_descriptions','payments']
  loop
    execute format(
      'create trigger trg_%1$s_updated before update on %1$s
       for each row execute function set_updated_at()', t);
  end loop;
end $$;
