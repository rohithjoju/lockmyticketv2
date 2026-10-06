'use client';

import { useEffect, useRef, useState, useTransition } from 'react';
import type { EventDto } from '@event-ticketing/types';
import { apiClient, ApiClientError } from '@/lib/apiClient';
import { EventCard } from './EventCard';
import { Button, Notice } from './ui';

export type EventDiscoveryProps = {
  initialEvents: EventDto[];
  initialCursor: string | null;
  initialQuery: {
    q?: string;
    city?: string;
  };
};

const CITY_OPTIONS = [
  { label: 'Kochi (Primary)', value: 'Kochi' },
  { label: 'All Cities', value: '' },
];

export function EventDiscovery({
  initialEvents,
  initialCursor,
  initialQuery,
}: EventDiscoveryProps) {
  // Query state (defaults to initialQuery, city defaults to Kochi if omitted)
  const [city, setCity] = useState<string>(initialQuery.city ?? 'Kochi');
  const [searchVal, setSearchVal] = useState<string>(initialQuery.q ?? '');
  
  // Results & pagination
  const [events, setEvents] = useState<EventDto[]>(initialEvents);
  const [cursor, setCursor] = useState<string | null>(initialCursor);
  const [loading, setLoading] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<ApiClientError | null>(null);

  const [, startTransition] = useTransition();
  const abortControllerRef = useRef<AbortController | null>(null);
  const isFirstMount = useRef(true);

  // Sync state with URL without full page reload
  const syncUrl = (nextCity: string, nextQ: string) => {
    const params = new URLSearchParams();
    if (nextCity) params.set('city', nextCity);
    if (nextQ.trim()) params.set('q', nextQ.trim());
    const newUrl = params.toString() ? `/events?${params.toString()}` : '/events';
    window.history.replaceState(null, '', newUrl);
  };

  // Perform client fetch on debounced search or city change
  const fetchEvents = async (selectedCity: string, queryStr: string) => {
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
    }
    const controller = new AbortController();
    abortControllerRef.current = controller;

    setLoading(true);
    setError(null);

    try {
      const { data, meta } = await apiClient.get<EventDto[]>('/events', {
        query: {
          city: selectedCity || undefined,
          q: queryStr.trim() || undefined,
          limit: 12,
        },
        signal: controller.signal,
      });

      startTransition(() => {
        setEvents(data);
        setCursor(meta?.cursor ?? null);
      });
    } catch (err) {
      if (err instanceof DOMException && err.name === 'AbortError') return;
      if (err instanceof ApiClientError) {
        setError(err);
      }
    } finally {
      setLoading(false);
    }
  };

  // Effect: Debounce live search typing (300ms)
  useEffect(() => {
    if (isFirstMount.current) {
      isFirstMount.current = false;
      return;
    }

    const timer = setTimeout(() => {
      syncUrl(city, searchVal);
      void fetchEvents(city, searchVal);
    }, 280);

    return () => clearTimeout(timer);
  }, [searchVal, city]);

  const handleCitySelect = (selectedCity: string) => {
    if (selectedCity === city) return;
    setCity(selectedCity);
    syncUrl(selectedCity, searchVal);
    void fetchEvents(selectedCity, searchVal);
  };

  const handleClearSearch = () => {
    setSearchVal('');
  };

  const handleResetFilters = () => {
    setCity('Kochi');
    setSearchVal('');
    syncUrl('Kochi', '');
    void fetchEvents('Kochi', '');
  };

  const showMore = async () => {
    if (!cursor || loadingMore) return;
    setLoadingMore(true);

    try {
      const { data, meta } = await apiClient.get<EventDto[]>('/events', {
        query: {
          city: city || undefined,
          q: searchVal.trim() || undefined,
          cursor,
          limit: 12,
        },
      });

      setEvents((prev) => [...prev, ...data.filter((e) => !prev.some((p) => p.id === e.id))]);
      setCursor(meta?.cursor ?? null);
    } catch (err) {
      if (err instanceof ApiClientError) setError(err);
    } finally {
      setLoadingMore(false);
    }
  };

  return (
    <div>
      {/* 1. Live Search & City Selector Bar */}
      <div className="mb-8 space-y-4">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
          {/* Live Search Input with Instant Clear */}
          <div className="relative flex-1">
            <span
              className="pointer-events-none absolute left-4 top-1/2 -translate-y-1/2 text-muted"
              aria-hidden
            >
              <svg
                className="size-4"
                fill="none"
                viewBox="0 0 24 24"
                strokeWidth={2}
                stroke="currentColor"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  d="m21 21-5.197-5.197m0 0A7.5 7.5 0 1 0 5.196 5.196a7.5 7.5 0 0 0 10.607 10.607Z"
                />
              </svg>
            </span>

            <input
              type="text"
              value={searchVal}
              onChange={(e) => setSearchVal(e.target.value)}
              placeholder="Search artists, venues, music, comedy, vibe..."
              aria-label="Search events"
              className="w-full rounded-full border border-line bg-surface py-2.5 pl-11 pr-10 text-sm text-fg placeholder:text-muted focus:border-accent focus:outline-none"
            />

            {searchVal && (
              <button
                type="button"
                onClick={handleClearSearch}
                aria-label="Clear search query"
                className="absolute right-3.5 top-1/2 -translate-y-1/2 rounded-full p-1 text-muted transition hover:bg-sunk hover:text-fg"
              >
                <svg
                  className="size-3.5"
                  fill="none"
                  viewBox="0 0 24 24"
                  strokeWidth={2.5}
                  stroke="currentColor"
                >
                  <path strokeLinecap="round" strokeLinejoin="round" d="M6 18 18 6M6 6l12 12" />
                </svg>
              </button>
            )}
          </div>

          {/* City Selection: Kochi First Segmented Pill Control */}
          <div
            role="group"
            aria-label="Select location"
            className="flex shrink-0 items-center gap-1 rounded-full border border-line bg-surface p-1"
          >
            {CITY_OPTIONS.map((opt) => {
              const active = city === opt.value;
              return (
                <button
                  key={opt.label}
                  type="button"
                  onClick={() => handleCitySelect(opt.value)}
                  className={`rounded-full px-4 py-1.5 text-xs font-semibold transition ${
                    active
                      ? 'bg-accent text-accent-fg shadow-sm'
                      : 'text-muted hover:bg-sunk hover:text-fg'
                  }`}
                >
                  {opt.label}
                </button>
              );
            })}
          </div>
        </div>

        {/* Live Filter Summary & Loading Indicator */}
        <div className="flex items-center justify-between text-xs text-muted">
          <div className="flex items-center gap-2">
            <span>
              {city ? `Filtering by ${city}` : 'Showing all locations'}
              {searchVal ? ` · matching “${searchVal}”` : ''}
            </span>
            {loading && (
              <span className="inline-flex items-center gap-1.5 font-medium text-accent">
                <span className="size-1.5 animate-ping rounded-full bg-accent" aria-hidden />
                Updating…
              </span>
            )}
          </div>

          {(city !== 'Kochi' || searchVal) && (
            <button
              type="button"
              onClick={handleResetFilters}
              className="text-xs font-medium text-muted underline decoration-line transition hover:text-fg"
            >
              Reset to Kochi
            </button>
          )}
        </div>
      </div>

      {/* 2. Error Display */}
      {error && (
        <div className="mb-6">
          <Notice title={error.title} detail={error.detail} requestId={error.requestId} />
        </div>
      )}

      {/* 3. Event Cards Grid or Empty State */}
      {events.length === 0 && !loading ? (
        <div className="stub px-6 py-16 text-center">
          <h2 className="text-xl font-bold">No events found</h2>
          <p className="mx-auto mt-2 max-w-sm text-sm text-muted">
            {city === 'Kochi'
              ? 'There are no active drops matching your search in Kochi right now.'
              : 'Try clearing your search query or switching back to Kochi.'}
          </p>
          <div className="mt-6 flex justify-center">
            <Button variant="ghost" onClick={handleResetFilters} className="text-xs">
              View all Kochi events
            </Button>
          </div>
        </div>
      ) : (
        <div className={`grid gap-5 transition-opacity sm:grid-cols-2 lg:grid-cols-3 ${loading ? 'opacity-60' : 'opacity-100'}`}>
          {events.map((event) => (
            <EventCard key={event.id} event={event} />
          ))}
        </div>
      )}

      {/* 4. Pagination / Load More */}
      {cursor && (
        <div className="mt-10 flex justify-center">
          <Button variant="ghost" onClick={() => void showMore()} disabled={loadingMore}>
            {loadingMore ? 'Loading…' : 'Show more events'}
          </Button>
        </div>
      )}
    </div>
  );
}
