'use client';

import { use } from 'react';
import { useQuery } from '@tanstack/react-query';
import type { EventDetailDto } from '@event-ticketing/types';
import { ApiClientError, apiClient } from '@/lib/apiClient';
import { EventForm } from '@/components/EventForm';
import { Notice } from '@/components/ui';

type Props = { params: Promise<{ id: string }> };

/**
 * Epic 4.2 — Edit event page.
 * Fetches the existing event then renders EventForm in edit mode.
 */
export default function EditEventPage({ params }: Props) {
  const { id } = use(params);

  const { data: event, isPending, isError, error } = useQuery({
    queryKey: ['event', id],
    queryFn: async () => {
      const { data } = await apiClient.get<EventDetailDto>(`/events/${id}`);
      return data;
    },
  });

  if (isPending) {
    return (
      <div className="mx-auto max-w-2xl px-5 py-10">
        <div className="space-y-4">
          {[0, 1, 2, 3].map((i) => (
            <div key={i} className="h-12 animate-pulse rounded-xl bg-sunk" />
          ))}
        </div>
      </div>
    );
  }

  if (isError || !event) {
    return (
      <div className="mx-auto max-w-2xl px-5 py-10">
        <Notice
          title={error instanceof ApiClientError ? error.title : 'Event not found'}
          detail={error instanceof ApiClientError ? error.detail : undefined}
        />
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-2xl px-5 py-10 md:py-14">
      <header className="mb-8">
        <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-muted">
          Hosting
        </p>
        <h1 className="mt-2 line-clamp-1 text-4xl">{event.title}</h1>
      </header>
      <EventForm existing={event} eventId={id} />
    </div>
  );
}
