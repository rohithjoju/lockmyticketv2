import type { VerificationStatus } from '@event-ticketing/types';
import { sql } from '../db/transaction.ts';
import { AppError } from '../lib/errors.ts';
import { MAX_KYC_BYTES, readAndValidate, uploadBuffer } from '../lib/cloudinary.ts';
import { sanitizePlainText, sanitizeRichText } from '../lib/sanitize.ts';
import type { Actor } from './event.service.ts';

/**
 * Organizer onboarding (§6.3 /organizers/*).
 *
 * An application never grants a capability by itself: `verification_status`
 * starts at 'pending', and only an admin approval (admin.service.ts) moves it
 * to 'approved'. Event creation checks that status on every call, so a
 * self-service path to organizer powers does not exist.
 */

export type OrganizerDto = {
  id: string;
  userId: string;
  organizationName: string;
  contactNumber: string;
  address: string | null;
  description: string | null;
  kycDocumentUrl: string | null;
  verificationStatus: VerificationStatus;
  rejectionReason: string | null;
  /** Required by the admin approve/reject calls — optimistic lock (F9). */
  version: number;
  createdAt: string;
  updatedAt: string;
};

export type OrganizerRow = {
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
  created_at: string | Date;
  updated_at: string | Date;
};

const ORGANIZER_COLUMN_NAMES = [
  'id',
  'user_id',
  'organization_name',
  'contact_number',
  'address',
  'description',
  'kyc_document_url',
  'verification_status',
  'rejection_reason',
  'version',
  'created_at',
  'updated_at',
] as const;

export const ORGANIZER_COLUMNS = ORGANIZER_COLUMN_NAMES.join(', ');

/** The same column list qualified by a table alias, for joined queries. */
export const ORGANIZER_COLUMNS_ALIASED = (alias: string): string =>
  ORGANIZER_COLUMN_NAMES.map((column) => `${alias}.${column}`).join(', ');

const iso = (value: string | Date): string =>
  value instanceof Date ? value.toISOString() : new Date(value).toISOString();

export function toOrganizerDto(row: OrganizerRow): OrganizerDto {
  return {
    id: row.id,
    userId: row.user_id,
    organizationName: row.organization_name,
    contactNumber: row.contact_number,
    address: row.address,
    description: row.description,
    kycDocumentUrl: row.kyc_document_url,
    verificationStatus: row.verification_status,
    rejectionReason: row.rejection_reason,
    version: row.version,
    createdAt: iso(row.created_at),
    updatedAt: iso(row.updated_at),
  };
}

async function findByUser(userId: string): Promise<OrganizerRow | null> {
  const rows = (await sql.unsafe(
    `select ${ORGANIZER_COLUMNS} from organizers where user_id = $1`,
    [userId],
  )) as OrganizerRow[];
  return rows[0] ?? null;
}

// ------------------------------------------------------------- application

export type UpgradeInput = {
  organizationName: string;
  contactNumber: string;
  address?: string | undefined;
  description?: string | undefined;
};

/** The schema's `contact_number ~ '^[0-9]{10}$'`, checked before the insert. */
function normalizeContactNumber(raw: string): string {
  const digits = raw.replace(/[\s-]/g, '');
  if (!/^[0-9]{10}$/.test(digits)) {
    throw new AppError('VALIDATION_FAILED', {
      message: 'Contact number must be exactly 10 digits.',
      field: 'contactNumber',
    });
  }
  return digits;
}

/**
 * POST /organizers/upgrade — submit organization details plus a KYC PDF.
 *
 * Re-application is allowed only after a rejection: the applicant fixes what
 * the admin objected to and the row returns to 'pending' with a fresh
 * `version`, so an admin acting on the old submission loses the race (F9).
 */
export async function applyForOrganizer(
  actor: Actor,
  input: UpgradeInput,
  kycDocument: File,
): Promise<OrganizerDto> {
  const existing = await findByUser(actor.id);

  if (existing?.verification_status === 'approved') {
    throw new AppError('VALIDATION_FAILED', {
      message: 'You are already an approved organizer.',
    });
  }
  if (existing?.verification_status === 'pending') {
    throw new AppError('VALIDATION_FAILED', {
      message: 'Your application is already under review.',
    });
  }

  const contactNumber = normalizeContactNumber(input.contactNumber);

  // §8 — magic bytes, not the extension or the declared content type. A .exe
  // renamed to .pdf never reaches Cloudinary.
  const { bytes } = await readAndValidate(kycDocument, ['pdf'], MAX_KYC_BYTES, 'kycDocument');

  // Uploaded as `raw`: a KYC document is a private record, not a transformable
  // image. Any Cloudinary failure surfaces as UPSTREAM_UNAVAILABLE and the
  // application is simply not recorded — nothing half-written to repair.
  const upload = await uploadBuffer({
    bytes,
    folder: `kyc/${actor.id}`,
    resourceType: 'raw',
  });

  const organizationName = sanitizePlainText(input.organizationName);
  const address = input.address ? sanitizePlainText(input.address) : null;
  const description = input.description ? sanitizeRichText(input.description) : null;

  const rows = (await sql.unsafe(
    `
    insert into organizers (
      user_id, organization_name, contact_number, address, description,
      kyc_document_url, verification_status
    ) values ($1, $2, $3, $4, $5, $6, 'pending')
    on conflict (user_id) do update set
      organization_name   = excluded.organization_name,
      contact_number      = excluded.contact_number,
      address             = excluded.address,
      description         = excluded.description,
      kyc_document_url    = excluded.kyc_document_url,
      verification_status = 'pending',
      rejection_reason    = null,
      version             = organizers.version + 1
    returning ${ORGANIZER_COLUMNS}
  `,
    [actor.id, organizationName, contactNumber, address, description, upload.url],
  )) as OrganizerRow[];

  return toOrganizerDto(rows[0]!);
}

/** GET /organizers/me. Absent application is NOT_FOUND, not an empty object. */
export async function getMyOrganizer(actor: Actor): Promise<OrganizerDto> {
  const row = await findByUser(actor.id);
  if (!row) {
    throw new AppError('NOT_FOUND', { message: 'You have not applied to become an organizer.' });
  }
  return toOrganizerDto(row);
}

export type OrganizerProfilePatch = {
  organizationName?: string | undefined;
  contactNumber?: string | undefined;
  address?: string | undefined;
  description?: string | undefined;
};

/**
 * PATCH /organizers/me — approved organizers only (§6.3 marks this `O`).
 *
 * The verification fields are deliberately not patchable here: an organizer
 * editing their own `verification_status` would make the approval flow
 * meaningless.
 */
export async function updateMyOrganizer(
  actor: Actor,
  patch: OrganizerProfilePatch,
): Promise<OrganizerDto> {
  const existing = await findByUser(actor.id);
  if (!existing) {
    throw new AppError('NOT_FOUND', { message: 'You have not applied to become an organizer.' });
  }
  if (existing.verification_status !== 'approved') {
    throw new AppError('ORGANIZER_NOT_APPROVED');
  }

  const rows = (await sql.unsafe(
    `
    update organizers set
      organization_name = $2,
      contact_number    = $3,
      address           = $4,
      description       = $5
    where id = $1
    returning ${ORGANIZER_COLUMNS}
  `,
    [
      existing.id,
      patch.organizationName !== undefined
        ? sanitizePlainText(patch.organizationName)
        : existing.organization_name,
      patch.contactNumber !== undefined
        ? normalizeContactNumber(patch.contactNumber)
        : existing.contact_number,
      patch.address !== undefined
        ? patch.address
          ? sanitizePlainText(patch.address)
          : null
        : existing.address,
      patch.description !== undefined
        ? patch.description
          ? sanitizeRichText(patch.description)
          : null
        : existing.description,
    ],
  )) as OrganizerRow[];

  return toOrganizerDto(rows[0]!);
}
