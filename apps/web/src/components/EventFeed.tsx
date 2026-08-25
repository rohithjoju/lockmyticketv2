'use client';

import { useState } from 'react';
import type { EventDto } from '@event-ticketing/types';
import { ApiClientError, apiClient } from '@/lib/apiClient';
import { mergeById } from '@/lib/paginate';
import { EventCard } from './EventCard';
import { Button, Notice } from './ui';

export type FeedQuery = {
  q?: string | undefined;
  city?: string | undefined;
  from?: string | undefined;
  to?: string | undefined;
  limit?: number;
};

/**
 * Page one is `children`: real server-rendered markup, already in the HTML
 * before any JavaScript runs. This component only ever appends what comes
 * after it, so the first screen does not depend on hydration and the reader
 * with a slow connection still sees events.
 */
export function EventFeed({
  children,
  initialCursor,
  initialIds,
  query,
}: {
  children: React.ReactNode;
  initialCursor: string | null;
  initialIds: string[];
  query: FeedQuery;
}) {
  const [extra, setExtra] = useState<EventDto[]>([]);
  const [cursor, setCursor] = useState<string | null>(initialCursor);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<ApiClientError | null>(null);

  async function showMore() {
    if (!cursor || loading) return;
    setLoading(true);
    setError(null);

    try {
      const { data, meta } = await apiClient.get<EventDto[]>('/events', {
        query: { ...query, cursor, limit: query.limit ?? 12 },
      });

      // Seeded with the server-rendered ids so an appended page can never
      // repeat one that is already on screen.
      setExtra((current) =>
        mergeById(
          [...current],
          data.filter((event) => !initialIds.includes(event.id)),
        ),
      );
      setCursor(meta?.cursor ?? null);
    } catch (cause) {
      setError(cause instanceof ApiClientError ? cause : null);
    } finally {
      setLoading(false);
    }
  }

  return (
    <>
      <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
        {children}
        {extra.map((event) => (
          <EventCard key={event.id} event={event} />
        ))}
      </div>

      {error ? (
        <div className="mt-6">
          <Notice title={error.title} detail={error.detail} requestId={error.requestId} />
        </div>
      ) : null}

      {cursor ? (
        <div className="mt-10 flex justify-center">
          <Button variant="ghost" onClick={() => void showMore()} disabled={loading}>
            {loading ? 'Loading…' : 'Show more events'}
          </Button>
        </div>
      ) : null}
    </>
  );
}
