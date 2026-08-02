import { sql, type Tx } from '../db/transaction.ts';
import { decodeCursor, encodeCursor } from '../lib/cursor.ts';

/**
 * The audit trail (R10: every admin mutation writes here, no exceptions).
 *
 * Writes are append-only. Nothing in the API updates or deletes an audit row,
 * and `0003_rls.sql` exposes the table for reading to admins alone.
 */

export type AuditContext = {
  requestId?: string | undefined;
  /** Caller IP, when the mutation came from an HTTP request. */
  ipAddress?: string | undefined;
};

export type AuditEntry = {
  actorUserId: string | null;
  actionType: string;
  targetTable: string;
  targetId: string;
  oldValue: Record<string, unknown> | null;
  newValue: Record<string, unknown> | null;
};

/** `inet` rejects anything that is not an address, and 'unknown' is not one. */
function toInet(value: string | undefined): string | null {
  if (!value) return null;
  const trimmed = value.trim();
  if (!trimmed || trimmed === 'unknown') return null;
  // Cheap shape check: reject rather than let a malformed header abort the
  // transaction the caller is auditing.
  const looksLikeAddress = /^[0-9a-fA-F:.]+$/.test(trimmed) && trimmed.length <= 45;
  return looksLikeAddress ? trimmed : null;
}

/**
 * Records one audited action.
 *
 * Pass `tx` to write the entry inside the caller's transaction — an admin
 * mutation and its audit row must commit or roll back together, otherwise the
 * trail can claim something that never happened.
 */
export async function recordAudit(
  entry: AuditEntry,
  ctx: AuditContext = {},
  tx?: Tx,
): Promise<void> {
  const db = tx ?? sql;

  // jsonb values are passed as objects, not JSON strings: stringifying first
  // makes Bun bind a string, which lands in the column double-encoded.
  await db`
    insert into audit_logs (
      actor_user_id, action_type, target_table, target_id,
      old_value, new_value, ip_address, request_id
    ) values (
      ${entry.actorUserId}, ${entry.actionType}, ${entry.targetTable}, ${entry.targetId},
      ${entry.oldValue}, ${entry.newValue},
      ${toInet(ctx.ipAddress)}, ${ctx.requestId ?? null}
    )
  `;
}

// ------------------------------------------------------------------ reads

export type AuditLogDto = {
  id: string;
  actorUserId: string | null;
  actionType: string;
  targetTable: string;
  targetId: string;
  oldValue: Record<string, unknown> | null;
  newValue: Record<string, unknown> | null;
  ipAddress: string | null;
  requestId: string | null;
  createdAt: string;
};

type AuditRow = {
  id: string;
  actor_user_id: string | null;
  action_type: string;
  target_table: string;
  target_id: string;
  old_value: Record<string, unknown> | null;
  new_value: Record<string, unknown> | null;
  ip_address: string | null;
  request_id: string | null;
  created_at: string | Date;
};

const iso = (value: string | Date): string =>
  value instanceof Date ? value.toISOString() : new Date(value).toISOString();

/**
 * Newest first, keyset-paginated on (created_at, id) — the same total order
 * `idx_audit_target` and `idx_audit_actor` are built around (§6.1).
 */
export async function listAuditLogs(filters: {
  actorUserId?: string | undefined;
  targetTable?: string | undefined;
  targetId?: string | undefined;
  cursor?: string | undefined;
  limit: number;
}): Promise<{ items: AuditLogDto[]; nextCursor: string | null }> {
  const after = filters.cursor ? decodeCursor(filters.cursor) : null;

  const rows = (await sql`
    select id, actor_user_id, action_type, target_table, target_id,
           old_value, new_value, host(ip_address) as ip_address, request_id, created_at
      from audit_logs
     where (${filters.actorUserId ?? null}::uuid is null
            or actor_user_id = ${filters.actorUserId ?? null}::uuid)
       and (${filters.targetTable ?? null}::text is null
            or target_table = ${filters.targetTable ?? null}::text)
       and (${filters.targetId ?? null}::uuid is null
            or target_id = ${filters.targetId ?? null}::uuid)
       and (${after?.sortValue ?? null}::timestamptz is null
            or (created_at, id) < (${after?.sortValue ?? null}::timestamptz,
                                   ${after?.id ?? null}::uuid))
     order by created_at desc, id desc
     limit ${filters.limit + 1}
  `) as AuditRow[];

  const hasMore = rows.length > filters.limit;
  const page = hasMore ? rows.slice(0, filters.limit) : rows;
  const last = page[page.length - 1];

  return {
    items: page.map((row) => ({
      id: row.id,
      actorUserId: row.actor_user_id,
      actionType: row.action_type,
      targetTable: row.target_table,
      targetId: row.target_id,
      oldValue: row.old_value,
      newValue: row.new_value,
      ipAddress: row.ip_address,
      requestId: row.request_id,
      createdAt: iso(row.created_at),
    })),
    nextCursor:
      hasMore && last ? encodeCursor({ id: last.id, sortValue: iso(last.created_at) }) : null,
  };
}
