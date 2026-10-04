'use client';

import { use, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { ApiClientError, apiClient } from '@/lib/apiClient';
import { LocalTime } from '@/components/LocalTime';
import { Badge, Input, Notice } from '@/components/ui';

/** PII-safe attendee summary — name only, never email/phone (SPEC §8). */
type AttendeeRow = {
  ticketId: string;
  eventId: string;
  attendeeName: string;
  status: 'valid' | 'invalid';
  verifiedAt: string | null;
  ticketTypeName: string;
};

type Props = { params: Promise<{ id: string }> };

/**
 * Epic 4.5 — Attendee roster.
 *
 * Reads from event_attendee_summary view via GET /events/:id/attendees.
 * Shows name, ticket tier, and check-in status.
 * Strictly NO email or phone (SPEC §8 PII enforcement).
 */
export default function AttendeesPage({ params }: Props) {
  const { id } = use(params);
  const [search, setSearch] = useState('');

  const { data, isPending, isError, error } = useQuery({
    queryKey: ['event-attendees', id],
    queryFn: async () => {
      const { data } = await apiClient.get<AttendeeRow[]>(`/events/${id}/attendees`);
      return data;
    },
  });

  const filtered = (data ?? []).filter((a) =>
    a.attendeeName.toLowerCase().includes(search.toLowerCase()) ||
    a.ticketTypeName.toLowerCase().includes(search.toLowerCase()),
  );

  const checkedIn = (data ?? []).filter((a) => a.status === 'invalid').length;

  return (
    <div className="mx-auto max-w-4xl px-5 py-10 md:py-14">
      <header className="mb-6">
        <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-muted">
          Hosting
        </p>
        <div className="mt-2 flex items-baseline justify-between gap-4">
          <h1 className="text-4xl">Attendees</h1>
          {data && (
            <p className="tabular text-sm text-muted">
              {checkedIn} / {data.length} checked in
            </p>
          )}
        </div>
      </header>

      <div className="mb-4">
        <Input
          type="search"
          placeholder="Search by name or tier…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
      </div>

      {isPending ? (
        <div className="space-y-2">
          {[0, 1, 2, 3, 4].map((i) => (
            <div key={i} className="h-14 animate-pulse rounded-xl bg-sunk" />
          ))}
        </div>
      ) : isError ? (
        <Notice
          title={error instanceof ApiClientError ? error.title : 'Could not load attendees'}
          detail={error instanceof ApiClientError ? error.detail : undefined}
        />
      ) : filtered.length === 0 ? (
        <div className="stub px-6 py-12 text-center">
          <p className="text-muted">
            {search ? 'No attendees match your search.' : 'No confirmed attendees yet.'}
          </p>
        </div>
      ) : (
        <div className="stub overflow-hidden">
          <table className="w-full text-sm">
            <thead className="border-b border-line">
              <tr className="text-left text-[11px] font-semibold uppercase tracking-[0.1em] text-muted">
                <th className="px-4 py-3">Attendee</th>
                <th className="px-4 py-3">Ticket tier</th>
                <th className="px-4 py-3">Status</th>
                <th className="px-4 py-3">Checked in</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {filtered.map((a) => (
                <tr key={a.ticketId} className="hover:bg-sunk/50">
                  <td className="px-4 py-3 font-medium">{a.attendeeName}</td>
                  <td className="px-4 py-3 text-muted">{a.ticketTypeName}</td>
                  <td className="px-4 py-3">
                    <Badge tone={a.status === 'invalid' ? 'past' : 'live'}>
                      {a.status === 'invalid' ? 'Checked in' : 'Not yet'}
                    </Badge>
                  </td>
                  <td className="tabular px-4 py-3 text-muted">
                    {a.verifiedAt ? <LocalTime iso={a.verifiedAt} /> : '—'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
