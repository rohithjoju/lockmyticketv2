'use client';

import { useQuery } from '@tanstack/react-query';
import Link from 'next/link';
import type { Metadata } from 'next';
import { ApiClientError, apiClient } from '@/lib/apiClient';
import { formatPrice } from '@/lib/datetime';
import { Notice } from '@/components/ui';

type AdminDashboard = {
  users: {
    total: number;
    active: number;
    disabled: number;
    byRole: { attendee: number; organizer: number; admin: number };
  };
  organizers: { pending: number; approved: number; rejected: number };
  events: {
    total: number;
    upcoming: number;
    ongoing: number;
    past: number;
    cancelled: number;
    flagged: number;
  };
  tickets: { confirmed: number; reserved: number; checkedIn: number };
  revenue: { captured: number; refunded: number; net: number };
  payments: { captured: number; failed: number; pending: number; successRate: number };
};

function KpiCard({
  label,
  value,
  sub,
  href,
}: {
  label: string;
  value: string | number;
  sub?: string;
  href?: string;
}) {
  const inner = (
    <div className="stub p-5 transition hover:brightness-105">
      <p className="text-xs font-semibold uppercase tracking-[0.12em] text-muted">{label}</p>
      <p className="tabular mt-2 text-3xl font-extrabold">{value}</p>
      {sub && <p className="mt-0.5 text-xs text-muted">{sub}</p>}
    </div>
  );
  return href ? <Link href={href}>{inner}</Link> : inner;
}

/**
 * Epic 5.1 — Admin dashboard overview.
 * Calls GET /admin/dashboard and renders platform KPI summary cards.
 */
export default function AdminPage() {
  const { data, isPending, isError, error } = useQuery({
    queryKey: ['admin-dashboard'],
    queryFn: async () => {
      const { data } = await apiClient.get<AdminDashboard>('/admin/dashboard');
      return data;
    },
    refetchInterval: 60_000,
  });

  if (isPending) {
    return (
      <div className="mx-auto max-w-6xl px-5 py-10">
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {[0, 1, 2, 3, 4, 5, 6, 7].map((i) => (
            <div key={i} className="h-28 animate-pulse rounded-xl bg-sunk" />
          ))}
        </div>
      </div>
    );
  }

  if (isError) {
    return (
      <div className="mx-auto max-w-6xl px-5 py-10">
        <Notice
          title={error instanceof ApiClientError ? error.title : 'Could not load dashboard'}
          detail={error instanceof ApiClientError ? error.detail : undefined}
        />
      </div>
    );
  }

  const successRatePct = data ? Math.round(data.payments.successRate * 100) : 0;

  return (
    <div className="mx-auto max-w-6xl px-5 py-10 md:py-14">
      <header className="mb-8">
        <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-muted">
          Administration
        </p>
        <h1 className="mt-2 text-4xl">Platform overview</h1>
      </header>

      {/* Users */}
      <section className="mb-8">
        <h2 className="mb-3 text-sm font-semibold uppercase tracking-[0.1em] text-muted">
          Users
        </h2>
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <KpiCard
            label="Total users"
            value={data.users.total}
            sub={`${data.users.active} active · ${data.users.disabled} disabled`}
            href="/admin/users"
          />
          <KpiCard label="Attendees" value={data.users.byRole.attendee} />
          <KpiCard
            label="Organizers"
            value={data.users.byRole.organizer}
            sub={`${data.organizers.pending} pending approval`}
            href="/admin/organizers"
          />
          <KpiCard label="Admins" value={data.users.byRole.admin} />
        </div>
      </section>

      {/* Events */}
      <section className="mb-8">
        <h2 className="mb-3 text-sm font-semibold uppercase tracking-[0.1em] text-muted">
          Events
        </h2>
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <KpiCard label="Total events" value={data.events.total} href="/admin/events" />
          <KpiCard
            label="Upcoming"
            value={data.events.upcoming}
            sub={`${data.events.ongoing} ongoing`}
          />
          <KpiCard
            label="Flagged"
            value={data.events.flagged}
            href="/admin/events"
          />
          <KpiCard label="Cancelled" value={data.events.cancelled} />
        </div>
      </section>

      {/* Revenue & Payments */}
      <section className="mb-8">
        <h2 className="mb-3 text-sm font-semibold uppercase tracking-[0.1em] text-muted">
          Payments
        </h2>
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <KpiCard
            label="Net revenue"
            value={formatPrice(data.revenue.net)}
            sub={`${formatPrice(data.revenue.refunded)} refunded`}
          />
          <KpiCard label="Payments captured" value={data.payments.captured} />
          <KpiCard label="Payment failures" value={data.payments.failed} />
          <KpiCard
            label="Success rate"
            value={`${successRatePct}%`}
            sub={successRatePct < 95 ? '⚠ Below 95% threshold' : 'Healthy'}
          />
        </div>
      </section>

      {/* Tickets */}
      <section>
        <h2 className="mb-3 text-sm font-semibold uppercase tracking-[0.1em] text-muted">
          Tickets
        </h2>
        <div className="grid gap-4 sm:grid-cols-3">
          <KpiCard label="Confirmed tickets" value={data.tickets.confirmed} />
          <KpiCard label="On hold (reserved)" value={data.tickets.reserved} />
          <KpiCard label="Checked in" value={data.tickets.checkedIn} />
        </div>
      </section>
    </div>
  );
}
