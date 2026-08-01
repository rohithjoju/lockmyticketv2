/**
 * Database row types (SPEC §5.2). ISO-8601 strings for timestamptz columns;
 * convert to local time only at render (R6).
 */

export type UserRole = 'attendee' | 'organizer' | 'admin';
export type UserStatus = 'active' | 'disabled';

export type User = {
  id: string;
  name: string;
  email: string;
  password_hash: string;
  role: UserRole;
  status: UserStatus;
  failed_login_attempts: number;
  locked_until: string | null;
  created_at: string;
  updated_at: string;
};

export type VerificationStatus = 'pending' | 'approved' | 'rejected';

export type Organizer = {
  id: string;
  user_id: string;
  organization_name: string;
  contact_number: string;
  address: string | null;
  description: string | null;
  kyc_document_url: string | null;
  verification_status: VerificationStatus;
  rejection_reason: string | null;
  version: number;
  created_at: string;
  updated_at: string;
};

export type RefundPolicy = {
  full_refund_hours: number;
  partial_refund_percent: number;
};

export type Event = {
  id: string;
  organizer_id: string;
  title: string;
  description: string | null;
  event_type: string | null;
  location_name: string | null;
  address: string | null;
  city: string;
  latitude: number | null;
  longitude: number | null;
  start_time: string;
  end_time: string;
  poster_url: string | null;
  video_url: string | null;
  images_urls: string[];
  terms_and_conditions: string | null;
  refund_policy: RefundPolicy;
  organizer_status_snapshot: string | null;
  admin_flagged: boolean;
  cancelled_at: string | null;
  created_at: string;
  updated_at: string;
};

export type EventStatus = 'upcoming' | 'ongoing' | 'past' | 'cancelled';

/** Row from the events_with_status view (R7). */
export type EventWithStatus = Event & { status: EventStatus };

export type TicketDescription = {
  id: string;
  event_id: string;
  ticket_type_name: string;
  ticket_description: string | null;
  price: number;
  total_tickets: number;
  available_tickets: number;
  created_at: string;
  updated_at: string;
};

export type TicketStatus = 'valid' | 'invalid';
export type ReservationStatus = 'reserved' | 'confirmed' | 'expired' | 'cancelled';

export type Ticket = {
  id: string;
  user_id: string;
  event_id: string;
  ticket_description_id: string;
  payment_id: string | null;
  status: TicketStatus;
  reservation_status: ReservationStatus;
  reserved_at: string;
  reservation_expires_at: string;
  qr_jwt_token: string | null;
  qr_nonce: string;
  verified_at: string | null;
  verified_by: string | null;
  created_at: string;
};

export type PaymentStatus = 'pending' | 'captured' | 'failed' | 'refunded';

export type Payment = {
  id: string;
  user_id: string;
  event_id: string;
  razorpay_order_id: string;
  razorpay_payment_id: string | null;
  razorpay_signature: string | null;
  amount: number;
  currency: string;
  status: PaymentStatus;
  payment_method: string | null;
  failure_reason: string | null;
  webhook_processed: boolean;
  webhook_received_at: string | null;
  created_at: string;
  updated_at: string;
};

export type RefundReason = 'user_requested' | 'event_cancelled' | 'organizer_action';
export type RefundStatus = 'pending' | 'processed' | 'failed';

export type Refund = {
  id: string;
  payment_id: string;
  ticket_id: string;
  initiated_by: string;
  reason: RefundReason;
  status: RefundStatus;
  razorpay_refund_id: string | null;
  amount: number;
  failure_reason: string | null;
  created_at: string;
  processed_at: string | null;
};

export type AuditLog = {
  id: string;
  actor_user_id: string | null;
  action_type: string;
  target_table: string;
  target_id: string;
  old_value: Record<string, unknown> | null;
  new_value: Record<string, unknown> | null;
  ip_address: string | null;
  request_id: string | null;
  created_at: string;
};
