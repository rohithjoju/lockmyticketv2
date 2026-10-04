'use client';

import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import Link from 'next/link';
import { ApiClientError, apiClient } from '@/lib/apiClient';
import { LocalTime } from '@/components/LocalTime';
import { Badge, Button, Select, Notice } from '@/components/ui';

type AdminEventDto = {
  id: string;
  title: string;
  city: string;
  startTime: string;
  endTime: string;
  status: string;
  adminFlagged: boolean;
  cancelledAt: string | null;
  organizerId: string;
  organizationName: string;
  ticketsSold: number;
  createdAt: string;
};

type EventListResponse = {
  items: AdminEventDto[];
  nextCursor: string | null;
};

function statusTone(status: string) {
  if (status === 'ongoing') return 'live' as const;
  if (status === 'past' || status === 'cancelled') return 'past' as const;
  return 'neutral' as const;
}

/**
 * Epic 5.4 — Events moderation panel.
 *
 * Read-only list of all events across the platform.
 * Filters: status, adminFlagged.
 * Clicking an event links to its public page. No mutation here yet.
 */
export default function AdminEventsPage() {
  const [statusFilter, setStatusFilter] = useState('');
  const [flaggedFilter, setFlaggedFilter] = useState('');
  const [cursor, setCursor] = useState<string | undefined>(undefined);
  const [prevCursors, setPrevCursors] = useState<string[]>([]);

  const { data, isPending, isError, error } = useQuery({
    queryKey: ['admin-events', statusFilter, flaggedFilter, cursor],
    queryFn: async () => {
      const res = await apiClient.get<AdminEventDto[]>('/admin/events', {
        query: {
          status: statusFilter || undefined,
          flagged: flaggedFilter === 'true' ? true : flaggedFilter === 'false' ? false : undefined,
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
        <h1 className="mt-2 text-4xl">Platform events</h1>
      </header>

      {/* Filters */}
      <div className="mb-4 flex flex-wrap gap-3">
        <Select
          value={statusFilter}
          onChange={(e) => {
            setStatusFilter(e.target.value);
            setCursor(undefined);
            setPrevCursors([]);
          }}
          className="w-40"
        >
          <option value="">All statuses</option>
          <option value="upcoming">Upcoming</option>
          <option value="ongoing">Ongoing</option>
          <option value="past">Past</option>
          <option value="cancelled">Cancelled</option>
        </Select>
        <Select
          value={flaggedFilter}
          onChange={(e) => {
            setFlaggedFilter(e.target.value);
            setCursor(undefined);
            setPrevCursors([]);
          }}
          className="w-40"
        >
          <option value="">Any flag status</option>
          <option value="true">Flagged only</option>
          <option value="false">Not flagged</option>
        </Select>
      </div>

      {isPending ? (
        <div className="space-y-2">
          {[0, 1, 2, 3].map((i) => (
            <div key={i} className="h-14 animate-pulse rounded-xl bg-sunk" />
          ))}
        </div>
      ) : isError ? (
        <Notice
          title={error instanceof ApiClientError ? error.title : 'Could not load events'}
          detail={error instanceof ApiClientError ? error.detail : undefined}
        />
      ) : data.items.length === 0 ? (
        <div className="stub px-6 py-16 text-center">
          <p className="text-muted">No events match these filters.</p>
        </div>
      ) : (
        <>
          <div className="stub overflow-hidden">
            <table className="w-full text-sm">
              <thead className="border-b border-line">
                <tr className="text-left text-[11px] font-semibold uppercase tracking-[0.1em] text-muted">
                  <th className="px-4 py-3">Event</th>
                  <th className="px-4 py-3">Organizer</th>
                  <th className="px-4 py-3">Status</th>
                  <th className="px-4 py-3">Starts</th>
                  <th className="px-4 py-3 text-right">Sold</th>
                  <th className="px-4 py-3 text-right">Created</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {data.items.map((event) => (
                  <tr key={event.id} className="hover:bg-sunk/50">
                    <td className="px-4 py-3 font-medium">
                      <Link
                        href={`/events/${event.id}`}
                        className="hover:underline hover:text-accent flex items-center gap-2"
                      >
                        <span className="truncate max-w-[200px]" title={event.title}>{event.title}</span>
                        {event.adminFlagged && <Badge tone="off">Flagged</Badge>}
                      </Link>
                    </td>
                    <td className="px-4 py-3 text-muted truncate max-w-[150px]" title={event.organizationName}>
                      {event.organizationName}
                    </td>
                    <td className="px-4 py-3">
                      <Badge tone={statusTone(event.status)}>{event.status}</Badge>
                    </td>
                    <td className="tabular px-4 py-3 text-muted">
                      <LocalTime iso={event.startTime} />
                    </td>
                    <td className="tabular px-4 py-3 text-right">{event.ticketsSold}</td>
                    <td className="tabular px-4 py-3 text-right text-muted text-xs">
                      <LocalTime iso={event.createdAt} />
                    </td>
                  </tr>
                ))}
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
