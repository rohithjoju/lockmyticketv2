import type { EventDto } from '@event-ticketing/types';
import { EventCard } from '@/components/EventCard';
import { ButtonLink } from '@/components/ui';
import { serverApi } from '@/lib/serverApi';

/** The hold window is the product. Everything else is a way to reach it. */
function HoldStub() {
  return (
    <div className="stub w-full max-w-xs shadow-[0_24px_60px_-24px_rgb(0_0_0/0.45)] sm:max-w-sm">
      <div className="flex items-start justify-between p-5">
        <div>
          <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-muted">
            Seat held
          </p>
          <p className="mt-1 font-display text-xl font-extrabold tracking-[-0.04em]">
            Row C · 2 tickets
          </p>
        </div>
        <span className="rounded-full bg-highlight px-2.5 py-0.5 text-[11px] font-semibold uppercase tracking-[0.08em] text-highlight-fg">
          Yours
        </span>
      </div>

      <div className="stub-tear flex items-baseline justify-between px-5 py-5">
        <span className="text-[11px] font-semibold uppercase tracking-[0.14em] text-muted">
          Pay within
        </span>
        <span className="tabular text-4xl font-semibold text-fg">10:00</span>
      </div>
    </div>
  );
}

export default async function HomePage() {
  const { data: events } = await serverApi<EventDto[]>('/events', { query: { limit: 6 } });

  return (
    <div className="mx-auto max-w-6xl px-5">
      <section className="grid items-center gap-12 py-14 md:grid-cols-[1.15fr_1fr] md:py-24">
        <div>
          <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-muted">
            Live events across India
          </p>
          <h1 className="mt-4 text-[clamp(2.6rem,7vw,4.6rem)] leading-[0.94]">
            Nobody sells
            <br />
            your seat
            <br />
            <span className="text-highlight">while you pay.</span>
          </h1>
          <p className="mt-6 max-w-md text-lg text-muted">
            Pick your tickets and they come off the shelf immediately. You get ten minutes to
            finish paying — and for those ten minutes, they are not for sale to anyone else.
          </p>
          <div className="mt-8 flex flex-wrap gap-3">
            <ButtonLink href="/events">Browse events</ButtonLink>
            <ButtonLink href="/auth/register" variant="ghost">
              Create an account
            </ButtonLink>
          </div>
        </div>

        <div className="flex justify-center md:justify-end">
          <HoldStub />
        </div>
      </section>

      {events.length > 0 ? (
        <section className="border-t border-line py-14">
          <div className="mb-8 flex items-end justify-between gap-4">
            <h2 className="text-3xl">Happening soon</h2>
            <ButtonLink href="/events" variant="quiet" className="shrink-0">
              See all
            </ButtonLink>
          </div>

          <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
            {events.map((event) => (
              <EventCard key={event.id} event={event} />
            ))}
          </div>
        </section>
      ) : null}
    </div>
  );
}
