import type { ErrorCode } from './errors.ts';
import type {
  EventStatus,
  RefundPolicy,
  ReservationStatus,
  TicketStatus,
  UserRole,
  UserStatus,
  VerificationStatus,
} from './models.ts';

/**
 * The response envelope (SPEC §6.1, R9).
 * Every response — success or failure — uses this shape. No bare objects,
 * no bare arrays, no inconsistent error shapes.
 */
export type ApiResponse<T> = {
  success: boolean;
  data: T | null;
  meta: ApiMeta | null;
  error: ApiError | null;
};

export type ApiMeta = {
  requestId: string;
  cursor?: string | null;
  total?: number;
};

export type ApiError = {
  code: ErrorCode;
  message: string;
  field?: string;
};

/** Cursor-based pagination payload (base64-encoded {id, sortValue}). */
export type Cursor = {
  id: string;
  sortValue: string;
};

// ------------------------------------------------------------------- DTOs
// The wire shapes. Declared once here so the API and the web app cannot drift
// apart: the service layer returns these and the client renders these.

export type TicketTypeDto = {
  id: string;
  eventId: string;
  name: string;
  description: string | null;
  price: number;
  totalTickets: number;
  /** Read live on every request — never cached. */
  availableTickets: number;
};

export type EventDto = {
  id: string;
  organizerId: string;
  title: string;
  description: string | null;
  eventType: string | null;
  locationName: string | null;
  address: string | null;
  city: string;
  latitude: number | null;
  longitude: number | null;
  startTime: string;
  endTime: string;
  posterUrl: string | null;
  videoUrl: string | null;
  imagesUrls: string[];
  termsAndConditions: string | null;
  refundPolicy: RefundPolicy;
  organizerStatusSnapshot: string | null;
  adminFlagged: boolean;
  cancelledAt: string | null;
  /** Computed by the events_with_status view, never stored (R7). */
  status: EventStatus;
  createdAt: string;
  updatedAt: string;
};

export type EventDetailDto = EventDto & { ticketTypes: TicketTypeDto[] };

export type TicketDto = {
  id: string;
  eventId: string;
  eventTitle: string;
  eventStartTime: string;
  ticketType: string;
  price: number;
  status: TicketStatus;
  reservationStatus: ReservationStatus;
  reservationExpiresAt: string;
  verifiedAt: string | null;
  createdAt: string;
};

export type PublicUserDto = {
  id: string;
  name: string;
  email: string;
  role: UserRole;
  status: UserStatus;
  createdAt: string;
};

/** GET /auth/me — the user plus whatever organizer record they hold. */
export type SessionUserDto = PublicUserDto & {
  organizer: { id: string; verificationStatus: VerificationStatus } | null;
};
