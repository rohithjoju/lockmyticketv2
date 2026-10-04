'use client';

import { useQuery } from '@tanstack/react-query';
import Link from 'next/link';
import { ApiClientError, apiClient } from '@/lib/apiClient';
import { Badge, ButtonLink, Notice } from '@/components/ui';

type OrganizerStatusDto = {
  id: string;
  organizationName: string;
  contactNumber: string;
  address: string | null;
  description: string | null;
  verificationStatus: 'pending' | 'approved' | 'rejected';
  rejectionReason: string | null;
  createdAt: string;
};

function statusTone(status: string) {
  if (status === 'approved') return 'live' as const;
  if (status === 'rejected') return 'off' as const;
  return 'neutral' as const;
}

/**
 * Epic 3.2 — Organizer application status page.
 *
 * Shows submitted details and current review status.
 * If rejected: displays rejection reason and a Re-apply button.
 */
export default function OrganizerStatusPage() {
  const { data: organizer, isPending, isError, error } = useQuery({
    queryKey: ['organizer-me'],
    queryFn: async () => {
      const { data } = await apiClient.get<OrganizerStatusDto>('/organizers/me');
      return data;
    },
  });

  if (isPending) {
    return (
      <div className="mx-auto max-w-xl px-5 py-10">
        <div className="space-y-4">
          {[0, 1, 2].map((i) => (
            <div key={i} className="h-16 animate-pulse rounded-xl bg-sunk" />
          ))}
        </div>
      </div>
    );
  }

  if (isError) {
    return (
      <div className="mx-auto max-w-xl px-5 py-10">
        <Notice
          title={error instanceof ApiClientError ? error.title : 'Could not load your application'}
          detail={error instanceof ApiClientError ? error.detail : undefined}
        />
      </div>
    );
  }

  if (!organizer) {
    return (
      <div className="mx-auto max-w-xl px-5 py-10 text-center">
        <h1 className="text-2xl">No application found</h1>
        <p className="mt-2 text-muted">You have not submitted an organizer application yet.</p>
        <div className="mt-6">
          <ButtonLink href="/organizer/upgrade">Apply now</ButtonLink>
        </div>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-xl px-5 py-10 md:py-14">
      <header className="mb-8">
        <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-muted">Hosting</p>
        <div className="mt-2 flex items-center gap-3">
          <h1 className="text-4xl">Application status</h1>
          <Badge tone={statusTone(organizer.verificationStatus)}>
            {organizer.verificationStatus}
          </Badge>
        </div>
      </header>

      <div className="stub divide-y divide-line">
        <dl className="grid gap-4 p-5 sm:grid-cols-2">
          <div>
            <dt className="text-xs font-semibold uppercase tracking-[0.12em] text-muted">
              Organization
            </dt>
            <dd className="mt-1 font-medium">{organizer.organizationName}</dd>
          </div>
          <div>
            <dt className="text-xs font-semibold uppercase tracking-[0.12em] text-muted">
              Contact
            </dt>
            <dd className="mt-1">{organizer.contactNumber}</dd>
          </div>
          {organizer.address && (
            <div className="sm:col-span-2">
              <dt className="text-xs font-semibold uppercase tracking-[0.12em] text-muted">
                Address
              </dt>
              <dd className="mt-1 text-sm text-muted">{organizer.address}</dd>
            </div>
          )}
          {organizer.description && (
            <div className="sm:col-span-2">
              <dt className="text-xs font-semibold uppercase tracking-[0.12em] text-muted">
                Description
              </dt>
              <dd className="mt-1 text-sm text-muted">{organizer.description}</dd>
            </div>
          )}
        </dl>

        {organizer.verificationStatus === 'pending' && (
          <div className="p-5">
            <Notice
              tone="info"
              title="Under review"
              detail="An admin will look at your application within 48 hours. You can buy tickets in the meantime."
            />
          </div>
        )}

        {organizer.verificationStatus === 'approved' && (
          <div className="p-5">
            <Notice
              tone="info"
              title="Application approved"
              detail="You can now create events, manage ticket types, and scan attendees at the door."
            />
            <div className="mt-4">
              <ButtonLink href="/organizer/events" variant="primary">
                Go to your events
              </ButtonLink>
            </div>
          </div>
        )}

        {organizer.verificationStatus === 'rejected' && (
          <div className="space-y-4 p-5">
            <Notice
              title="Application rejected"
              detail={organizer.rejectionReason ?? 'No reason was provided.'}
            />
            <Link
              href="/organizer/upgrade"
              className="inline-flex items-center gap-1.5 text-sm font-medium text-accent underline-offset-2 hover:underline"
            >
              Re-apply with updated details →
            </Link>
          </div>
        )}
      </div>
    </div>
  );
}
