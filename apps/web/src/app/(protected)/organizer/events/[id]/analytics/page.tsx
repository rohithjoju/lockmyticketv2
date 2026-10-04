'use client';

import { use } from 'react';
import { useQuery } from '@tanstack/react-query';
import { ApiClientError, apiClient } from '@/lib/apiClient';
import { formatPrice } from '@/lib/datetime';
import { Notice } from '@/components/ui';

type AnalyticsDto = {
  totalSold: number;
  totalCapacity: number;
  grossRevenue: number;
  checkInRate: number;
  byTicketType: Array<{
    ticketTypeId: string;
    ticketTypeName: string;
    sold: number;
    revenue: number;
  }>;
  byDate: Array<{ date: string; sold: number; revenue: number }>;
};

type Props = { params: Promise<{ id: string }> };

function Bar({ value, max, label }: { value: number; max: number; label: string }) {
  const pct = max > 0 ? Math.round((value / max) * 100) : 0;
  return (
    <div className="flex items-center gap-3 text-sm">
      <span className="w-28 shrink-0 truncate text-muted">{label}</span>
      <div className="relative flex-1 overflow-hidden rounded-full bg-sunk">
        <div
          className="h-2 rounded-full bg-accent transition-all"
          style={{ width: `${pct}%` }}
        />
      </div>
      <span className="tabular w-8 text-right font-semibold">{value}</span>
    </div>
  );
}

/**
 * Epic 4.4 — Event analytics dashboard.
 *
 * Calls GET /events/:id/analytics and displays:
 *  - KPI summary cards (sold vs capacity, revenue, check-in rate)
 *  - Sales breakdown by ticket type (bar chart)
 *  - Cumulative sales timeline (simple ASCII-style bars)
 */
export default function EventAnalyticsPage({ params }: Props) {
  const { id } = use(params);

  const { data, isPending, isError, error } = useQuery({
    queryKey: ['event-analytics', id],
    queryFn: async () => {
      const { data } = await apiClient.get<AnalyticsDto>(`/events/${id}/analytics`);
      return data;
    },
    refetchInterval: 30_000,
  });

  if (isPending) {
    return (
      <div className="mx-auto max-w-4xl px-5 py-10">
        <div className="grid gap-4 sm:grid-cols-3">
          {[0, 1, 2].map((i) => (
            <div key={i} className="h-24 animate-pulse rounded-xl bg-sunk" />
          ))}
        </div>
      </div>
    );
  }

  if (isError) {
    return (
      <div className="mx-auto max-w-4xl px-5 py-10">
        <Notice
          title={error instanceof ApiClientError ? error.title : 'Could not load analytics'}
          detail={error instanceof ApiClientError ? error.detail : undefined}
        />
      </div>
    );
  }

  const sellPct =
    data.totalCapacity > 0
      ? Math.round((data.totalSold / data.totalCapacity) * 100)
      : 0;

  const maxSalesByDate = Math.max(1, ...data.byDate.map((d) => d.sold));
  const maxByType = Math.max(1, ...data.byTicketType.map((t) => t.sold));

  return (
    <div className="mx-auto max-w-4xl px-5 py-10 md:py-14">
      <header className="mb-8">
        <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-muted">
          Analytics
        </p>
        <h1 className="mt-2 text-4xl">Event insights</h1>
      </header>

      {/* KPI Cards */}
      <div className="grid gap-4 sm:grid-cols-3">
        <div className="stub p-5">
          <p className="text-xs font-semibold uppercase tracking-[0.12em] text-muted">
            Tickets sold
          </p>
          <p className="tabular mt-2 text-3xl font-extrabold">
            {data.totalSold}
            <span className="ml-1 text-base font-normal text-muted">
              / {data.totalCapacity}
            </span>
          </p>
          <div className="mt-3 h-2 overflow-hidden rounded-full bg-sunk">
            <div
              className="h-full rounded-full bg-highlight transition-all"
              style={{ width: `${sellPct}%` }}
            />
          </div>
          <p className="tabular mt-1 text-xs text-muted">{sellPct}% capacity</p>
        </div>

        <div className="stub p-5">
          <p className="text-xs font-semibold uppercase tracking-[0.12em] text-muted">
            Gross revenue
          </p>
          <p className="tabular mt-2 text-3xl font-extrabold">
            {formatPrice(data.grossRevenue)}
          </p>
        </div>

        <div className="stub p-5">
          <p className="text-xs font-semibold uppercase tracking-[0.12em] text-muted">
            Check-in rate
          </p>
          <p className="tabular mt-2 text-3xl font-extrabold">
            {Math.round(data.checkInRate * 100)}%
          </p>
          <p className="mt-1 text-xs text-muted">of confirmed attendees admitted</p>
        </div>
      </div>

      {/* By ticket type */}
      {data.byTicketType.length > 0 && (
        <section className="mt-8">
          <h2 className="mb-4 text-base font-semibold">Sales by tier</h2>
          <div className="stub p-5">
            <div className="space-y-3">
              {data.byTicketType.map((t) => (
                <Bar key={t.ticketTypeId} value={t.sold} max={maxByType} label={t.ticketTypeName} />
              ))}
            </div>
            <div className="mt-4 border-t border-line pt-4">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left text-xs font-semibold uppercase tracking-[0.1em] text-muted">
                    <th className="pb-2">Tier</th>
                    <th className="pb-2 text-right">Sold</th>
                    <th className="pb-2 text-right">Revenue</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-line">
                  {data.byTicketType.map((t) => (
                    <tr key={t.ticketTypeId}>
                      <td className="py-2">{t.ticketTypeName}</td>
                      <td className="tabular py-2 text-right">{t.sold}</td>
                      <td className="tabular py-2 text-right font-medium">
                        {formatPrice(t.revenue)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </section>
      )}

      {/* Sales timeline */}
      {data.byDate.length > 0 && (
        <section className="mt-8">
          <h2 className="mb-4 text-base font-semibold">Sales over time</h2>
          <div className="stub p-5">
            <div className="space-y-2">
              {data.byDate.slice(-14).map((d) => (
                <Bar
                  key={d.date}
                  value={d.sold}
                  max={maxSalesByDate}
                  label={new Date(d.date).toLocaleDateString('en-IN', {
                    day: 'numeric',
                    month: 'short',
                  })}
                />
              ))}
            </div>
          </div>
        </section>
      )}
    </div>
  );
}
