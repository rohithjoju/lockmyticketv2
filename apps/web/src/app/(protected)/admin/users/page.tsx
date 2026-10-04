'use client';

import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ApiClientError, apiClient } from '@/lib/apiClient';
import { LocalTime } from '@/components/LocalTime';
import { useAuth } from '@/hooks/useAuth';
import { Badge, Button, Input, Notice, Select } from '@/components/ui';

type AdminUserDto = {
  id: string;
  name: string;
  email: string;
  role: string;
  status: 'active' | 'disabled';
  lockedUntil: string | null;
  organizerId: string | null;
  organizerStatus: string | null;
  createdAt: string;
};

type UserListResponse = {
  items: AdminUserDto[];
  nextCursor: string | null;
};

function roleTone(role: string) {
  if (role === 'admin') return 'live' as const;
  if (role === 'organizer') return 'neutral' as const;
  return 'past' as const;
}

/**
 * Epic 5.2 — Admin user governance panel.
 *
 * - Paginated user list via GET /admin/users
 * - Search by name/email
 * - Filter by role and status
 * - Enable/disable users — self-disable guard
 */
export default function AdminUsersPage() {
  const { user: me } = useAuth();
  const queryClient = useQueryClient();

  const [q, setQ] = useState('');
  const [roleFilter, setRoleFilter] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [cursor, setCursor] = useState<string | undefined>(undefined);
  const [prevCursors, setPrevCursors] = useState<string[]>([]);

  const { data, isPending, isError, error } = useQuery({
    queryKey: ['admin-users', q, roleFilter, statusFilter, cursor],
    queryFn: async () => {
      const res = await apiClient.get<AdminUserDto[]>('/admin/users', {
        query: {
          q: q || undefined,
          role: roleFilter || undefined,
          status: statusFilter || undefined,
          cursor,
          limit: 20,
        },
      });
      return {
        items: res.data,
        nextCursor: res.meta?.cursor ?? null,
      };
    },
  });

  const toggleStatusMutation = useMutation({
    mutationFn: async ({ userId, status }: { userId: string; status: 'active' | 'disabled' }) => {
      await apiClient.patch(`/admin/users/${userId}/status`, { status });
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['admin-users'] });
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
    <div className="mx-auto max-w-6xl px-5 py-10 md:py-14">
      <header className="mb-6">
        <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-muted">Admin</p>
        <h1 className="mt-2 text-4xl">Users</h1>
      </header>

      {/* Filters */}
      <div className="mb-4 flex flex-wrap gap-3">
        <Input
          type="search"
          placeholder="Search name or email…"
          value={q}
          onChange={(e) => { setQ(e.target.value); setCursor(undefined); setPrevCursors([]); }}
          className="max-w-xs"
        />
        <Select
          value={roleFilter}
          onChange={(e) => { setRoleFilter(e.target.value); setCursor(undefined); setPrevCursors([]); }}
          className="w-36"
        >
          <option value="">All roles</option>
          <option value="attendee">Attendee</option>
          <option value="organizer">Organizer</option>
          <option value="admin">Admin</option>
        </Select>
        <Select
          value={statusFilter}
          onChange={(e) => { setStatusFilter(e.target.value); setCursor(undefined); setPrevCursors([]); }}
          className="w-36"
        >
          <option value="">All statuses</option>
          <option value="active">Active</option>
          <option value="disabled">Disabled</option>
        </Select>
      </div>

      {isPending ? (
        <div className="space-y-2">
          {[0, 1, 2, 3].map((i) => (
            <div key={i} className="h-14 animate-pulse rounded-xl bg-sunk" />
          ))}
        </div>
      ) : isError ? (
        <Notice
          title={error instanceof ApiClientError ? error.title : 'Could not load users'}
          detail={error instanceof ApiClientError ? error.detail : undefined}
        />
      ) : (
        <>
          {toggleStatusMutation.error && (
            <div className="mb-4">
              <Notice
                title={
                  toggleStatusMutation.error instanceof ApiClientError
                    ? toggleStatusMutation.error.title
                    : 'Action failed'
                }
                detail={
                  toggleStatusMutation.error instanceof ApiClientError
                    ? toggleStatusMutation.error.detail
                    : undefined
                }
              />
            </div>
          )}

          <div className="stub overflow-hidden">
            <table className="w-full text-sm">
              <thead className="border-b border-line">
                <tr className="text-left text-[11px] font-semibold uppercase tracking-[0.1em] text-muted">
                  <th className="px-4 py-3">Name</th>
                  <th className="px-4 py-3">Email</th>
                  <th className="px-4 py-3">Role</th>
                  <th className="px-4 py-3">Status</th>
                  <th className="px-4 py-3">Joined</th>
                  <th className="px-4 py-3 text-right">Action</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {data.items.map((user) => {
                  const isSelf = user.id === me?.id;
                  return (
                    <tr key={user.id} className="hover:bg-sunk/50">
                      <td className="px-4 py-3 font-medium">{user.name}</td>
                      <td className="px-4 py-3 text-muted">{user.email}</td>
                      <td className="px-4 py-3">
                        <Badge tone={roleTone(user.role)}>{user.role}</Badge>
                      </td>
                      <td className="px-4 py-3">
                        <Badge tone={user.status === 'active' ? 'live' : 'off'}>
                          {user.status}
                        </Badge>
                      </td>
                      <td className="tabular px-4 py-3 text-muted">
                        <LocalTime iso={user.createdAt} />
                      </td>
                      <td className="px-4 py-3 text-right">
                        {isSelf ? (
                          <span className="text-xs text-muted">(you)</span>
                        ) : (
                          <Button
                            variant={user.status === 'active' ? 'danger' : 'ghost'}
                            className="h-8 px-3 text-xs"
                            disabled={toggleStatusMutation.isPending}
                            onClick={() =>
                              void toggleStatusMutation.mutateAsync({
                                userId: user.id,
                                status: user.status === 'active' ? 'disabled' : 'active',
                              })
                            }
                          >
                            {user.status === 'active' ? 'Disable' : 'Enable'}
                          </Button>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          {/* Pagination */}
          <div className="mt-4 flex justify-between">
            <Button
              variant="ghost"
              disabled={prevCursors.length === 0}
              onClick={prevPage}
            >
              ← Previous
            </Button>
            <Button
              variant="ghost"
              disabled={!data.nextCursor}
              onClick={nextPage}
            >
              Next →
            </Button>
          </div>
        </>
      )}
    </div>
  );
}
