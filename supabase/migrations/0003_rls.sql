alter table users               enable row level security;
alter table organizers          enable row level security;
alter table events              enable row level security;
alter table ticket_descriptions enable row level security;
alter table tickets             enable row level security;
alter table payments            enable row level security;
alter table refunds             enable row level security;
alter table audit_logs          enable row level security;

-- helper: current user's organizer id
create or replace function current_organizer_id() returns uuid
language sql stable as $$
  select id from organizers where user_id = auth.uid()
$$;

create or replace function is_admin() returns boolean
language sql stable as $$
  select exists (select 1 from users where id = auth.uid() and role = 'admin')
$$;

-- ---------- users
create policy users_self_read on users
  for select using (id = auth.uid() or is_admin());
create policy users_self_update on users
  for update using (id = auth.uid());

-- ---------- organizers
create policy organizers_self_read on organizers
  for select using (user_id = auth.uid() or is_admin());
create policy organizers_self_write on organizers
  for update using (user_id = auth.uid() or is_admin());

-- ---------- events (public read; owner or admin write)
create policy events_public_read on events
  for select using (true);
create policy events_owner_write on events
  for all using (organizer_id = current_organizer_id() or is_admin());

-- ---------- ticket_descriptions
create policy td_public_read on ticket_descriptions
  for select using (true);
create policy td_owner_write on ticket_descriptions
  for all using (
    event_id in (select id from events where organizer_id = current_organizer_id())
    or is_admin()
  );

-- ---------- tickets: owner, event-organizer, or admin
create policy tickets_owner_read on tickets
  for select using (
    user_id = auth.uid()
    or event_id in (select id from events where organizer_id = current_organizer_id())
    or is_admin()
  );

-- ---------- payments: strictly owner or admin (organizers must NOT see payment PII)
create policy payments_owner_read on payments
  for select using (user_id = auth.uid() or is_admin());

-- ---------- refunds
create policy refunds_owner_read on refunds
  for select using (
    payment_id in (select id from payments where user_id = auth.uid())
    or is_admin()
  );

-- ---------- audit_logs: admin only
create policy audit_admin_only on audit_logs
  for select using (is_admin());

-- ============================================================
-- PII-safe attendee list for organizers: name only, never email/phone
create view event_attendee_summary as
select t.id            as ticket_id,
       t.event_id,
       u.name          as attendee_name,
       t.status,
       t.verified_at,
       td.ticket_type_name
from tickets t
join users u  on u.id = t.user_id
join ticket_descriptions td on td.id = t.ticket_description_id
where t.reservation_status = 'confirmed';
