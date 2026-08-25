import type { Metadata } from 'next';
import type { EventDto } from '@event-ticketing/types';
import { EventCard } from '@/components/EventCard';
import { EventFeed } from '@/components/EventFeed';
import { Button, Input } from '@/components/ui';
import { serverApi } from '@/lib/serverApi';

export const metadata: Metadata = { title: 'Browse events' };

const PAGE_SIZE = 12;

type SearchParams = Record<string, string | string[] | undefined>;

function one(value: string | string[] | undefined): string | undefined {
  const first = Array.isArray(value) ? value[0] : value;
  return first?.trim() ? first.trim() : undefined;
}

/**
 * A plain GET form. It works before hydration and it puts the search in the
 * URL, which is what people paste to each other.
 */
function SearchBar({ q, city }: { q?: string; city?: string }) {
  return (
    <form className="flex flex-col gap-3 sm:flex-row" role="search">
      <Input
        name="q"
        defaultValue={q ?? ''}
        placeholder="Search by name — jazz, standup, hackathon"
        aria-label="Search events"
        className="sm:flex-[2]"
      />
      <Input
        name="city"
        defaultValue={city ?? ''}
        placeholder="City"
        aria-label="City"
        className="sm:flex-1"
      />
      <Button type="submit" className="sm:w-auto">
        Search
      </Button>
    </form>
  );
}

export default async function EventsPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  const params = await searchParams;
  const query = {
    q: one(params.q),
    city: one(params.city),
    from: one(params.from),
    to: one(params.to),
  };

  const { data: events, meta } = await serverApi<EventDto[]>('/events', {
    query: { ...query, limit: PAGE_SIZE },
  });

  const filtered = Boolean(query.q || query.city);

  return (
    <div className="mx-auto max-w-6xl px-5 py-10 md:py-14">
      <header className="mb-8">
        <h1 className="text-4xl">Browse events</h1>
        <p className="mt-2 text-muted">
          {filtered
            ? `Results${query.city ? ` in ${query.city}` : ''}${query.q ? ` for “${query.q}”` : ''}`
            : 'Everything on sale right now, soonest first.'}
        </p>
      </header>

      <div className="mb-10">
        <SearchBar {...(query.q ? { q: query.q } : {})} {...(query.city ? { city: query.city } : {})} />
      </div>

      {events.length === 0 ? (
        <div className="stub px-6 py-16 text-center">
          <h2 className="text-2xl">Nothing matches that yet</h2>
          <p className="mx-auto mt-2 max-w-sm text-muted">
            Try a broader search, or drop the city filter — organizers add events daily.
          </p>
        </div>
      ) : (
        <EventFeed
          initialCursor={meta?.cursor ?? null}
          initialIds={events.map((event) => event.id)}
          query={{ ...query, limit: PAGE_SIZE }}
        >
          {events.map((event) => (
            <EventCard key={event.id} event={event} />
          ))}
        </EventFeed>
      )}
    </div>
  );
}
