'use client';

import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { ApiClientError, apiClient } from '@/lib/apiClient';
import { Button, Field, Input, Notice } from './ui';

type TicketTier = {
  id?: string;
  name: string;
  description: string;
  price: number;
  totalTickets: number;
  soldTickets?: number;
};

type Props = {
  eventId: string;
  existingTiers?: TicketTier[];
  onSaved?: () => void;
};

const EMPTY_TIER: Omit<TicketTier, 'id'> = {
  name: '',
  description: '',
  price: 0,
  totalTickets: 1,
};

/**
 * Epic 4.3 — Ticket tier configuration.
 *
 * Add / edit ticket tiers for an event via POST /events/:id/ticket-types.
 * Guards against decreasing capacity below already-sold tickets.
 */
export function TicketTypeForm({ eventId, existingTiers = [], onSaved }: Props) {
  const queryClient = useQueryClient();
  const [tier, setTier] = useState<Omit<TicketTier, 'id'>>(EMPTY_TIER);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});

  const createMutation = useMutation({
    mutationFn: async (data: Omit<TicketTier, 'id'>) => {
      await apiClient.post(`/events/${eventId}/ticket-types`, {
        ticketTypeName: data.name,
        ticketDescription: data.description || null,
        price: data.price,
        totalTickets: data.totalTickets,
      });
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['organizer-events'] });
      void queryClient.invalidateQueries({ queryKey: ['event', eventId] });
      setTier(EMPTY_TIER);
      onSaved?.();
    },
  });

  function validate(): boolean {
    const errors: Record<string, string> = {};
    if (!tier.name.trim()) errors.name = 'Tier name is required.';
    if (tier.price < 0) errors.price = 'Price cannot be negative.';
    if (tier.totalTickets < 1) errors.totalTickets = 'Must have at least 1 ticket.';
    setFieldErrors(errors);
    return Object.keys(errors).length === 0;
  }

  return (
    <div className="stub p-5">
      <h3 className="text-base font-semibold">Add ticket tier</h3>

      {existingTiers.length > 0 && (
        <ul className="mb-4 mt-3 space-y-2">
          {existingTiers.map((t) => (
            <li
              key={t.id ?? t.name}
              className="flex items-center justify-between rounded-xl bg-sunk px-4 py-2.5 text-sm"
            >
              <span className="font-medium">{t.name}</span>
              <span className="tabular text-muted">
                ₹{t.price.toFixed(0)} · {t.soldTickets ?? 0}/{t.totalTickets} sold
              </span>
            </li>
          ))}
        </ul>
      )}

      <div className="mt-4 space-y-4">
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Tier name" htmlFor="tier-name" error={fieldErrors.name}>
            <Input
              id="tier-name"
              placeholder="General · VIP · Early Bird"
              value={tier.name}
              onChange={(e) => setTier((p) => ({ ...p, name: e.target.value }))}
            />
          </Field>

          <Field label="Price (INR)" htmlFor="tier-price" error={fieldErrors.price}>
            <Input
              id="tier-price"
              type="number"
              min={0}
              step={1}
              value={tier.price}
              onChange={(e) =>
                setTier((p) => ({ ...p, price: Math.max(0, Number(e.target.value)) }))
              }
            />
          </Field>
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          <Field
            label="Total tickets"
            htmlFor="tier-total"
            error={fieldErrors.totalTickets}
          >
            <Input
              id="tier-total"
              type="number"
              min={1}
              value={tier.totalTickets}
              onChange={(e) =>
                setTier((p) => ({ ...p, totalTickets: Math.max(1, Number(e.target.value)) }))
              }
            />
          </Field>

          <Field label="Description" htmlFor="tier-desc" hint="Optional">
            <Input
              id="tier-desc"
              placeholder="e.g. Includes backstage pass"
              value={tier.description}
              onChange={(e) => setTier((p) => ({ ...p, description: e.target.value }))}
            />
          </Field>
        </div>

        {createMutation.error && (
          <Notice
            title={
              createMutation.error instanceof ApiClientError
                ? createMutation.error.title
                : 'Could not add tier'
            }
            detail={
              createMutation.error instanceof ApiClientError
                ? createMutation.error.detail
                : undefined
            }
          />
        )}

        <Button
          className="w-full"
          disabled={createMutation.isPending}
          onClick={() => {
            if (validate()) void createMutation.mutateAsync(tier);
          }}
        >
          {createMutation.isPending ? 'Adding…' : 'Add tier'}
        </Button>
      </div>
    </div>
  );
}
