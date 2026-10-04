'use client';

import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { ApiClientError, apiClient } from '@/lib/apiClient';
import { LocalTime } from '@/components/LocalTime';
import { Button, Input, Notice } from '@/components/ui';

type AuditLog = {
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

type AuditListResponse = {
  items: AuditLog[];
  nextCursor: string | null;
};

/**
 * Epic 5.5 — Audit trail explorer.
 *
 * Immutable, append-only security log for all admin actions (R10, §9).
 * Filters by Actor ID, Target ID, or Target Table.
 */
export default function AdminAuditLogsPage() {
  const [actorId, setActorId] = useState('');
  const [targetId, setTargetId] = useState('');
  const [targetTable, setTargetTable] = useState('');
  const [cursor, setCursor] = useState<string | undefined>(undefined);
  const [prevCursors, setPrevCursors] = useState<string[]>([]);

  const [expandedLogId, setExpandedLogId] = useState<string | null>(null);

  const { data, isPending, isError, error } = useQuery({
    queryKey: ['admin-audit', actorId, targetId, targetTable, cursor],
    queryFn: async () => {
      const res = await apiClient.get<AuditLog[]>('/admin/audit-logs', {
        query: {
          actorUserId: actorId || undefined,
          targetId: targetId || undefined,
          targetTable: targetTable || undefined,
          cursor,
          limit: 20,
        },
      });
      return {
        items: res.data,
        nextCursor: res.meta?.cursor ?? null,
      };
    },
  });

  function nextPage() {
    if (!data?.nextCursor) return;
    setPrevCursors((p) => [...p, cursor ?? '']);
    setCursor(data.nextCursor);
  }

  function prevPage() {
    const prev = prevCursors[prevCursors.length - 1];
    setPrevCursors((p) => p.slice(0, -1));
    setCursor(prev || undefined);
  }

  return (
    <div className="mx-auto max-w-6xl px-5 py-10 md:py-14">
      <header className="mb-6">
        <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-muted">Admin</p>
        <h1 className="mt-2 text-4xl">Audit trail</h1>
      </header>

      {/* Filters */}
      <div className="mb-4 flex flex-wrap gap-3">
        <Input
          placeholder="Actor User ID (UUID)..."
          value={actorId}
          onChange={(e) => {
            setActorId(e.target.value);
            setCursor(undefined);
            setPrevCursors([]);
          }}
          className="w-64 font-mono text-xs"
        />
        <Input
          placeholder="Target ID (UUID)..."
          value={targetId}
          onChange={(e) => {
            setTargetId(e.target.value);
            setCursor(undefined);
            setPrevCursors([]);
          }}
          className="w-64 font-mono text-xs"
        />
        <Input
          placeholder="Target Table..."
          value={targetTable}
          onChange={(e) => {
            setTargetTable(e.target.value);
            setCursor(undefined);
            setPrevCursors([]);
          }}
          className="w-48 text-xs"
        />
      </div>

      {isPending ? (
        <div className="space-y-2">
          {[0, 1, 2, 3].map((i) => (
            <div key={i} className="h-14 animate-pulse rounded-xl bg-sunk" />
          ))}
        </div>
      ) : isError ? (
        <Notice
          title={error instanceof ApiClientError ? error.title : 'Could not load audit logs'}
          detail={error instanceof ApiClientError ? error.detail : undefined}
        />
      ) : data.items.length === 0 ? (
        <div className="stub px-6 py-16 text-center">
          <p className="text-muted">No audit logs match these filters.</p>
        </div>
      ) : (
        <>
          <div className="stub overflow-hidden">
            <table className="w-full text-sm">
              <thead className="border-b border-line">
                <tr className="text-left text-[11px] font-semibold uppercase tracking-[0.1em] text-muted">
                  <th className="px-4 py-3">Timestamp</th>
                  <th className="px-4 py-3">Action</th>
                  <th className="px-4 py-3">Actor</th>
                  <th className="px-4 py-3">Target</th>
                  <th className="px-4 py-3 text-right">Details</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {data.items.map((log) => {
                  const isExpanded = expandedLogId === log.id;
                  return (
                    <tr key={log.id} className="hover:bg-sunk/50 transition-colors">
                      <td className="px-4 py-3 tabular text-xs text-muted align-top">
                        <LocalTime iso={log.createdAt} showZone />
                      </td>
                      <td className="px-4 py-3 font-medium align-top">
                        <span className="rounded bg-surface px-1.5 py-0.5 font-mono text-[11px]">
                          {log.actionType}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-xs align-top font-mono text-muted">
                        {log.actorUserId ? log.actorUserId.slice(0, 8) + '...' : 'System'}
                      </td>
                      <td className="px-4 py-3 text-xs align-top">
                        <div className="flex flex-col gap-0.5">
                          <span className="font-semibold text-muted">{log.targetTable}</span>
                          <span className="font-mono text-muted">
                            {log.targetId.slice(0, 8)}...
                          </span>
                        </div>
                      </td>
                      <td className="px-4 py-3 align-top text-right">
                        <Button
                          variant="quiet"
                          className="h-7 px-3 text-xs"
                          onClick={() => setExpandedLogId(isExpanded ? null : log.id)}
                        >
                          {isExpanded ? 'Hide' : 'Inspect'}
                        </Button>

                        {isExpanded && (
                          <div className="mt-3 text-left overflow-hidden rounded border border-line bg-surface p-3 text-xs font-mono text-muted">
                            <div className="grid gap-4 sm:grid-cols-2">
                              <div>
                                <p className="mb-1 font-semibold uppercase tracking-wider text-fg/50">Old value</p>
                                <pre className="overflow-x-auto whitespace-pre-wrap">
                                  {log.oldValue ? JSON.stringify(log.oldValue, null, 2) : 'null'}
                                </pre>
                              </div>
                              <div>
                                <p className="mb-1 font-semibold uppercase tracking-wider text-fg/50">New value</p>
                                <pre className="overflow-x-auto whitespace-pre-wrap text-accent">
                                  {log.newValue ? JSON.stringify(log.newValue, null, 2) : 'null'}
                                </pre>
                              </div>
                            </div>
                            {(log.ipAddress || log.requestId) && (
                              <div className="mt-4 flex gap-4 border-t border-line/50 pt-3">
                                {log.ipAddress && (
                                  <div>
                                    <span className="text-fg/50">IP:</span> {log.ipAddress}
                                  </div>
                                )}
                                {log.requestId && (
                                  <div>
                                    <span className="text-fg/50">Req ID:</span> {log.requestId}
                                  </div>
                                )}
                              </div>
                            )}
                          </div>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          {/* Pagination */}
          <div className="mt-4 flex justify-between">
            <Button variant="ghost" disabled={prevCursors.length === 0} onClick={prevPage}>
              ← Previous
            </Button>
            <Button variant="ghost" disabled={!data.nextCursor} onClick={nextPage}>
              Next →
            </Button>
          </div>
        </>
      )}
    </div>
  );
}
