import type { Metadata } from 'next';
import type { EventDto } from '@event-ticketing/types';
import { EventDiscovery } from '@/components/EventDiscovery';
import { serverApi } from '@/lib/serverApi';

export const metadata: Metadata = { title: 'Browse events · Kochi & beyond' };

const PAGE_SIZE = 12;

type SearchParams = Record<string, string | string[] | undefined>;

function one(value: string | string[] | undefined): string | undefined {
  const first = Array.isArray(value) ? value[0] : value;
  return first?.trim() ? first.trim() : undefined;
}

export default async function EventsPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  const params = await searchParams;
  
  // Default to Kochi if not explicitly requested otherwise
  const cityParam = params.city !== undefined ? one(params.city) : 'Kochi';
  const query = {
    q: one(params.q),
    city: cityParam,
    from: one(params.from),
    to: one(params.to),
  };

  let events: EventDto[] = [];
  let cursor: string | null = null;

  try {
    const res = await serverApi<EventDto[]>('/events', {
      query: { ...query, limit: PAGE_SIZE },
    });
    events = res.data ?? [];
    cursor = res.meta?.cursor ?? null;
  } catch {
    events = [];
    cursor = null;
  }

  return (
    <div className="mx-auto max-w-6xl px-5 py-10 md:py-14">
      <header className="mb-8">
        <h1 className="text-3xl font-bold tracking-tight sm:text-4xl">Events</h1>
        <p className="mt-1 text-sm text-muted">
          Upcoming gigs and ticket drops.
        </p>
      </header>

      {/* Live Search, Kochi Priority Pills & Dynamic Feed */}
      <EventDiscovery
        initialEvents={events}
        initialCursor={cursor}
        initialQuery={{
          q: query.q,
          city: query.city,
        }}
      />
    </div>
  );
}
