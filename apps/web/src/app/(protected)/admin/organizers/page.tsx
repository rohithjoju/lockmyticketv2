'use client';

import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ApiClientError, apiClient } from '@/lib/apiClient';
import { LocalTime } from '@/components/LocalTime';
import { Button, Input, Notice } from '@/components/ui';

type OrganizerDto = {
  id: string;
  userId: string;
  organizationName: string;
  contactNumber: string;
  address: string | null;
  description: string | null;
  kycDocumentUrl: string | null;
  verificationStatus: 'pending' | 'approved' | 'rejected';
  rejectionReason: string | null;
  version: number;
  createdAt: string;
  applicant: { id: string; name: string; email: string };
};

type QueueResponse = {
  items: OrganizerDto[];
  nextCursor: string | null;
};

/**
 * Epic 5.3 — Organizer verification queue.
 *
 * Shows pending applications. Approving / rejecting requires sending the version
 * for optimistic locking (F9). Rejection prompts for a reason.
 */
export default function AdminOrganizersPage() {
  const queryClient = useQueryClient();

  const [cursor, setCursor] = useState<string | undefined>(undefined);
  const [prevCursors, setPrevCursors] = useState<string[]>([]);
  const [rejectingId, setRejectingId] = useState<string | null>(null);
  const [rejectReason, setRejectReason] = useState('');

  const { data, isPending, isError, error } = useQuery({
    queryKey: ['admin-organizers-queue', cursor],
    queryFn: async () => {
      const res = await apiClient.get<OrganizerDto[]>('/admin/organizers/pending', {
        query: { cursor, limit: 10 },
      });
      return {
        items: res.data,
        nextCursor: res.meta?.cursor ?? null,
      };
    },
  });

  const approveMutation = useMutation({
    mutationFn: async ({ id, version }: { id: string; version: number }) => {
      await apiClient.post(`/admin/organizers/${id}/approve`, { version });
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['admin-organizers-queue'] });
    },
  });

  const rejectMutation = useMutation({
    mutationFn: async ({ id, version, reason }: { id: string; version: number; reason: string }) => {
      await apiClient.post(`/admin/organizers/${id}/reject`, { version, reason });
    },
    onSuccess: () => {
      setRejectingId(null);
      setRejectReason('');
      void queryClient.invalidateQueries({ queryKey: ['admin-organizers-queue'] });
    },
  });

  function nextPage() {
    if (!data?.nextCursor) return;
    setPrevCursors((p) => [...p, cursor ?? '']);
    setCursor(data.nextCursor);
  }

  function prevPage() {
    const prev = prevCursors[prevCursors.length - 1];
    setPrevCursors((p) => p.slice(0, -1));
    setCursor(prev || undefined);
  }

  return (
    <div className="mx-auto max-w-4xl px-5 py-10 md:py-14">
      <header className="mb-8">
        <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-muted">Admin</p>
        <h1 className="mt-2 text-4xl">Organizer queue</h1>
      </header>

      {(approveMutation.error || rejectMutation.error) && (
        <div className="mb-4">
          <Notice
            title="Action failed"
            detail={
              approveMutation.error instanceof ApiClientError
                ? approveMutation.error.detail
                : rejectMutation.error instanceof ApiClientError
                  ? rejectMutation.error.detail
                  : 'An error occurred. Reload the page and try again.'
            }
          />
        </div>
      )}

      {isPending ? (
        <div className="space-y-4">
          {[0, 1, 2].map((i) => (
            <div key={i} className="h-32 animate-pulse rounded-xl bg-sunk" />
          ))}
        </div>
      ) : isError ? (
        <Notice
          title={error instanceof ApiClientError ? error.title : 'Could not load queue'}
          detail={error instanceof ApiClientError ? error.detail : undefined}
        />
      ) : data.items.length === 0 ? (
        <div className="stub px-6 py-16 text-center">
          <h2 className="text-2xl">Queue empty</h2>
          <p className="mt-2 text-muted">There are no pending organizer applications to review.</p>
        </div>
      ) : (
        <div className="space-y-4">
          {data.items.map((app) => (
            <div key={app.id} className="stub p-5">
              <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
                <div>
                  <h3 className="text-lg font-semibold">{app.organizationName}</h3>
                  <p className="mt-0.5 text-sm text-muted">
                    Applied by {app.applicant.name} ({app.applicant.email}) · <LocalTime iso={app.createdAt} />
                  </p>
                  
                  <dl className="mt-4 grid gap-3 sm:grid-cols-2 text-sm">
                    <div>
                      <dt className="text-xs font-semibold uppercase tracking-[0.1em] text-muted">Contact</dt>
                      <dd className="mt-0.5">{app.contactNumber}</dd>
                    </div>
                    {app.address && (
                      <div>
                        <dt className="text-xs font-semibold uppercase tracking-[0.1em] text-muted">Address</dt>
                        <dd className="mt-0.5">{app.address}</dd>
                      </div>
                    )}
                    {app.description && (
                      <div className="sm:col-span-2">
                        <dt className="text-xs font-semibold uppercase tracking-[0.1em] text-muted">Description</dt>
                        <dd className="mt-0.5 text-muted">{app.description}</dd>
                      </div>
                    )}
                  </dl>

                  {app.kycDocumentUrl && (
                    <div className="mt-4">
                      <a
                        href={app.kycDocumentUrl}
                        target="_blank"
                        rel="noreferrer"
                        className="inline-flex items-center gap-1.5 text-sm font-medium text-accent hover:underline"
                      >
                        View KYC Document ↗
                      </a>
                    </div>
                  )}
                </div>

                <div className="sm:shrink-0 sm:w-48">
                  {rejectingId === app.id ? (
                    <div className="space-y-3">
                      <Input
                        placeholder="Reason for rejection..."
                        value={rejectReason}
                        onChange={(e) => setRejectReason(e.target.value)}
                        className="w-full text-sm"
                      />
                      <div className="flex gap-2">
                        <Button
                          variant="danger"
                          className="flex-1 text-xs"
                          disabled={rejectMutation.isPending || !rejectReason.trim()}
                          onClick={() =>
                            void rejectMutation.mutateAsync({
                              id: app.id,
                              version: app.version,
                              reason: rejectReason,
                            })
                          }
                        >
                          Confirm
                        </Button>
                        <Button
                          variant="ghost"
                          className="flex-1 text-xs"
                          onClick={() => {
                            setRejectingId(null);
                            setRejectReason('');
                          }}
                        >
                          Cancel
                        </Button>
                      </div>
                    </div>
                  ) : (
                    <div className="flex flex-col gap-2">
                      <Button
                        variant="primary"
                        disabled={approveMutation.isPending}
                        onClick={() =>
                          void approveMutation.mutateAsync({ id: app.id, version: app.version })
                        }
                      >
                        Approve
                      </Button>
                      <Button
                        variant="ghost"
                        className="text-danger hover:bg-danger/10 hover:text-danger"
                        disabled={approveMutation.isPending}
                        onClick={() => setRejectingId(app.id)}
                      >
                        Reject
                      </Button>
                    </div>
                  )}
                </div>
              </div>
            </div>
          ))}

          {/* Pagination */}
          <div className="mt-6 flex justify-between">
            <Button variant="ghost" disabled={prevCursors.length === 0} onClick={prevPage}>
              ← Previous
            </Button>
            <Button variant="ghost" disabled={!data.nextCursor} onClick={nextPage}>
              Next →
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
