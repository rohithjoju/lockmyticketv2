import type { EventDto } from '@event-ticketing/types';
import { EventCard } from '@/components/EventCard';
import { ButtonLink } from '@/components/ui';
import { LiveHoldSimulator } from '@/components/LiveHoldSimulator';
import { serverApi } from '@/lib/serverApi';

export default async function HomePage() {
  let events: EventDto[] = [];
  try {
    const res = await serverApi<EventDto[]>('/events', {
      query: { city: 'Kochi', limit: 6 },
    });
    events = res.data ?? [];
  } catch {
    events = [];
  }

  return (
    <div className="mx-auto max-w-5xl px-5">
      {/* 1. Hero: Clear statement + tangible demo */}
      <section className="grid items-center gap-10 py-12 md:grid-cols-[1.2fr_1fr] md:py-20">
        <div>
          <h1 className="text-3xl font-extrabold tracking-tight text-fg/90 sm:text-4xl lg:text-5xl">
            Nobody sells your seat <span className="text-highlight">while you pay.</span>
          </h1>

          <p className="mt-3 max-w-md text-sm text-muted sm:text-base leading-relaxed">
            Held exclusively for you from the second you pick it. No cart drops, no checkout rush.
          </p>

          <div className="mt-8 flex items-center">
            <ButtonLink
              href="/events?city=Kochi"
              className="group relative overflow-hidden px-8 py-3.5 text-base font-semibold shadow-md transition-all duration-300 ease-out hover:-translate-y-0.5 hover:shadow-xl hover:shadow-accent/20 active:translate-y-0 active:scale-[0.98]"
            >
              {/* Subtle metallic sheen sweep */}
              <span
                className="pointer-events-none absolute inset-0 -top-1/2 -bottom-1/2 w-1/2 bg-gradient-to-r from-transparent via-white/20 to-transparent animate-sheen"
                aria-hidden="true"
              />

              <span className="relative z-10 flex items-center gap-2">
                <span>Find events in Kochi</span>
                <span
                  className="transition-transform duration-200 ease-out group-hover:translate-x-1"
                  aria-hidden="true"
                >
                  →
                </span>
              </span>
            </ButtonLink>
          </div>
        </div>

        <div className="flex justify-center md:justify-end">
          <LiveHoldSimulator />
        </div>
      </section>

      {/* 2. Events: Immediate value without clutter */}
      <section className="border-t border-line py-12">
        <div className="mb-6 flex items-center justify-between">
          <h2 className="text-2xl font-bold">Upcoming in Kochi</h2>
          <ButtonLink href="/events?city=Kochi" variant="quiet" className="text-xs">
            See all
          </ButtonLink>
        </div>

        {events.length > 0 ? (
          <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
            {events.map((event) => (
              <EventCard key={event.id} event={event} />
            ))}
          </div>
        ) : (
          <div className="stub px-6 py-12 text-center">
            <p className="text-base font-medium">New events in Kochi are dropping soon</p>
            <p className="mt-1 text-sm text-muted">
              Organizers are finalizing upcoming gigs. Check back shortly.
            </p>
          </div>
        )}
      </section>

      {/* 3. Simple 3-step explanation: Plain language, zero jargon */}
      <section className="border-t border-line py-12">
        <h2 className="text-xl font-bold">How it works</h2>

        <div className="mt-6 grid gap-6 sm:grid-cols-3">
          <div>
            <span className="font-display text-lg font-bold text-highlight">1. Pick your seat</span>
            <p className="mt-1 text-sm text-muted">
              Select your tickets. They are immediately locked and taken off the market.
            </p>
          </div>

          <div>
            <span className="font-display text-lg font-bold text-highlight">2. Time to pay</span>
            <p className="mt-1 text-sm text-muted">
              A 10-minute hold window gives you peace of mind to pay with UPI or card without rush.
            </p>
          </div>

          <div>
            <span className="font-display text-lg font-bold text-highlight">3. Scan at the door</span>
            <p className="mt-1 text-sm text-muted">
              Get an instant QR code on your phone that works even if you're offline.
            </p>
          </div>
        </div>
      </section>
    </div>
  );
}
