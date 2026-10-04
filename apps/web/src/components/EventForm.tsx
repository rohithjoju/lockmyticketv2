'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import type { EventDetailDto } from '@event-ticketing/types';
import { ApiClientError, apiClient } from '@/lib/apiClient';
import { TicketTypeForm } from '@/components/TicketTypeForm';
import { Button, Field, Input, Notice, Select } from '@/components/ui';

const EVENT_TYPES = ['music', 'tech', 'arts', 'food', 'sports', 'culture', 'business', 'other'];

const CITIES = [
  'Mumbai', 'Delhi', 'Bangalore', 'Hyderabad', 'Chennai', 'Kolkata', 'Pune', 'Ahmedabad',
  'Jaipur', 'Surat', 'Lucknow', 'Kanpur', 'Nagpur', 'Indore', 'Bhopal', 'Visakhapatnam',
  'Patna', 'Vadodara', 'Ludhiana', 'Agra', 'Kochi', 'Mysuru', 'Goa', 'Chandigarh',
];

type EventFormData = {
  title: string;
  eventType: string;
  description: string;
  locationName: string;
  address: string;
  city: string;
  startTime: string;
  endTime: string;
  fullRefundHours: number;
  partialRefundPercent: number;
  termsAndConditions: string;
};

type Props = {
  /** If provided, we are editing an existing event. */
  existing?: EventDetailDto;
  eventId?: string;
};

const EMPTY: EventFormData = {
  title: '',
  eventType: 'music',
  description: '',
  locationName: '',
  address: '',
  city: 'Mumbai',
  startTime: '',
  endTime: '',
  fullRefundHours: 48,
  partialRefundPercent: 50,
  termsAndConditions: '',
};

function fromExisting(e: EventDetailDto): EventFormData {
  const toLocal = (iso: string) => {
    const d = new Date(iso);
    const pad = (n: number) => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
  };
  return {
    title: e.title,
    eventType: e.eventType ?? 'other',
    description: e.description ?? '',
    locationName: e.locationName ?? '',
    address: e.address ?? '',
    city: e.city,
    startTime: toLocal(e.startTime),
    endTime: toLocal(e.endTime),
    fullRefundHours: e.refundPolicy.full_refund_hours,
    partialRefundPercent: e.refundPolicy.partial_refund_percent,
    termsAndConditions: e.termsAndConditions ?? '',
  };
}

/**
 * Epic 4.2 — Event create & edit form.
 *
 * Used by both the create page and the [id]/edit page.
 * POST /events for new events, PATCH /events/:id for updates.
 * Includes poster image upload and cancel event (with confirmation modal).
 */
export function EventForm({ existing, eventId }: Props) {
  const router = useRouter();
  const queryClient = useQueryClient();
  const isEdit = !!existing && !!eventId;

  const [form, setForm] = useState<EventFormData>(existing ? fromExisting(existing) : EMPTY);
  const [posterFile, setPosterFile] = useState<File | null>(null);
  const [posterPreview, setPosterPreview] = useState<string | null>(existing?.posterUrl ?? null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [cancelConfirm, setCancelConfirm] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [showTicketForm, setShowTicketForm] = useState(false);

  const set = <K extends keyof EventFormData>(key: K, value: EventFormData[K]) =>
    setForm((p) => ({ ...p, [key]: value }));

  const saveMutation = useMutation({
    mutationFn: async () => {
      const body = {
        title: form.title.trim(),
        eventType: form.eventType,
        description: form.description.trim() || null,
        locationName: form.locationName.trim() || null,
        address: form.address.trim() || null,
        city: form.city,
        startTime: new Date(form.startTime).toISOString(),
        endTime: new Date(form.endTime).toISOString(),
        refundPolicy: {
          full_refund_hours: form.fullRefundHours,
          partial_refund_percent: form.partialRefundPercent,
        },
        termsAndConditions: form.termsAndConditions.trim() || null,
      };

      let savedId: string;
      if (isEdit) {
        const { data } = await apiClient.patch<{ id: string }>(`/events/${eventId}`, body);
        savedId = data.id;
      } else {
        const { data } = await apiClient.post<{ id: string }>('/events', body);
        savedId = data.id;
      }

      // Upload poster if a new file was selected
      if (posterFile) {
        const fd = new FormData();
        fd.append('file', posterFile);
        fd.append('type', 'poster');
        await apiClient.post(`/events/${savedId}/media`, fd);
      }

      return savedId;
    },
    onSuccess: (savedId) => {
      void queryClient.invalidateQueries({ queryKey: ['organizer-events'] });
      void queryClient.invalidateQueries({ queryKey: ['event', savedId] });
      if (!isEdit) {
        router.push(`/organizer/events/${savedId}/edit`);
      }
    },
  });

  const cancelMutation = useMutation({
    mutationFn: async () => {
      if (!eventId) return;
      await apiClient.delete(`/events/${eventId}`);
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['organizer-events'] });
      router.push('/organizer/events');
    },
  });

  function validate(): boolean {
    const errors: Record<string, string> = {};
    if (!form.title.trim()) errors.title = 'Title is required.';
    if (!form.startTime) errors.startTime = 'Start time is required.';
    if (!form.endTime) errors.endTime = 'End time is required.';
    if (form.startTime && form.endTime && new Date(form.endTime) <= new Date(form.startTime)) {
      errors.endTime = 'End time must be after start time.';
    }
    setFieldErrors(errors);
    return Object.keys(errors).length === 0;
  }

  function handlePosterChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    if (file.size > 5 * 1024 * 1024) {
      setFieldErrors((p) => ({ ...p, poster: 'Image must be under 5 MB.' }));
      return;
    }
    setPosterFile(file);
    setPosterPreview(URL.createObjectURL(file));
  }

  return (
    <div className="space-y-8">
      <form
        onSubmit={(e) => {
          e.preventDefault();
          if (validate()) void saveMutation.mutateAsync();
        }}
        className="space-y-5"
        noValidate
      >
        <div className="grid gap-5 sm:grid-cols-2">
          <div className="sm:col-span-2">
            <Field label="Event title" htmlFor="ev-title" error={fieldErrors.title}>
              <Input
                id="ev-title"
                required
                value={form.title}
                onChange={(e) => set('title', e.target.value)}
                placeholder="e.g. Sunday Jazz at Carter Road"
              />
            </Field>
          </div>

          <Field label="Event type" htmlFor="ev-type">
            <Select
              id="ev-type"
              value={form.eventType}
              onChange={(e) => set('eventType', e.target.value)}
            >
              {EVENT_TYPES.map((t) => (
                <option key={t} value={t}>
                  {t.charAt(0).toUpperCase() + t.slice(1)}
                </option>
              ))}
            </Select>
          </Field>

          <Field label="City" htmlFor="ev-city">
            <Select
              id="ev-city"
              value={form.city}
              onChange={(e) => set('city', e.target.value)}
            >
              {CITIES.map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </Select>
          </Field>

          <Field label="Venue name" htmlFor="ev-venue" hint="Optional">
            <Input
              id="ev-venue"
              value={form.locationName}
              onChange={(e) => set('locationName', e.target.value)}
              placeholder="e.g. Carter Road Promenade"
            />
          </Field>

          <Field label="Street address" htmlFor="ev-address" hint="Optional">
            <Input
              id="ev-address"
              value={form.address}
              onChange={(e) => set('address', e.target.value)}
              placeholder="e.g. 27, Carter Road, Bandra West"
            />
          </Field>

          <Field label="Starts at" htmlFor="ev-start" error={fieldErrors.startTime}>
            <Input
              id="ev-start"
              type="datetime-local"
              required
              value={form.startTime}
              onChange={(e) => set('startTime', e.target.value)}
            />
          </Field>

          <Field label="Ends at" htmlFor="ev-end" error={fieldErrors.endTime}>
            <Input
              id="ev-end"
              type="datetime-local"
              required
              value={form.endTime}
              onChange={(e) => set('endTime', e.target.value)}
            />
          </Field>
        </div>

        <Field label="Description" htmlFor="ev-desc" hint="Markdown supported">
          <textarea
            id="ev-desc"
            rows={5}
            value={form.description}
            onChange={(e) => set('description', e.target.value)}
            placeholder="Tell attendees what to expect…"
            className="form-input w-full rounded-xl border border-line bg-surface px-3.5 py-2.5 text-fg placeholder:text-muted/70 transition focus:border-accent focus:ring-0 resize-none"
          />
        </Field>

        {/* Poster */}
        <Field label="Poster image" htmlFor="ev-poster" hint="JPG / PNG / WebP · max 5 MB" error={fieldErrors.poster}>
          <div className="flex items-start gap-4">
            {posterPreview && (
              <div className="aspect-video h-20 flex-shrink-0 overflow-hidden rounded-xl bg-sunk">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={posterPreview} alt="Poster preview" className="h-full w-full object-cover" />
              </div>
            )}
            <input
              id="ev-poster"
              type="file"
              accept="image/*"
              onChange={handlePosterChange}
              className="block text-sm text-muted file:mr-3 file:rounded-full file:border-0 file:bg-sunk file:px-4 file:py-2 file:text-sm file:font-medium file:text-fg hover:file:bg-surface"
            />
          </div>
        </Field>

        {/* Refund policy */}
        <div className="rounded-xl border border-line p-4">
          <h3 className="text-sm font-semibold">Refund policy</h3>
          <div className="mt-3 grid gap-4 sm:grid-cols-2">
            <Field
              label="Full refund window (hours)"
              htmlFor="ev-refund-full"
              hint="Hours before event start to give 100% refund"
            >
              <Input
                id="ev-refund-full"
                type="number"
                min={0}
                value={form.fullRefundHours}
                onChange={(e) => set('fullRefundHours', Math.max(0, Number(e.target.value)))}
              />
            </Field>
            <Field
              label="Partial refund (%)"
              htmlFor="ev-refund-partial"
              hint="% refunded inside the full refund window"
            >
              <Input
                id="ev-refund-partial"
                type="number"
                min={0}
                max={100}
                value={form.partialRefundPercent}
                onChange={(e) =>
                  set('partialRefundPercent', Math.min(100, Math.max(0, Number(e.target.value))))
                }
              />
            </Field>
          </div>
        </div>

        <Field label="Terms and conditions" htmlFor="ev-terms" hint="Optional">
          <textarea
            id="ev-terms"
            rows={3}
            value={form.termsAndConditions}
            onChange={(e) => set('termsAndConditions', e.target.value)}
            className="form-input w-full rounded-xl border border-line bg-surface px-3.5 py-2.5 text-fg placeholder:text-muted/70 transition focus:border-accent focus:ring-0 resize-none"
            placeholder="No cameras, no outside food…"
          />
        </Field>

        {(submitError ?? saveMutation.error) && (
          <Notice
            title={
              saveMutation.error instanceof ApiClientError
                ? saveMutation.error.title
                : (submitError ?? 'Could not save event')
            }
            detail={
              saveMutation.error instanceof ApiClientError
                ? saveMutation.error.detail
                : undefined
            }
          />
        )}

        <div className="flex gap-3">
          <Button type="submit" className="flex-1" disabled={saveMutation.isPending}>
            {saveMutation.isPending ? 'Saving…' : isEdit ? 'Save changes' : 'Create event'}
          </Button>
          <Button
            type="button"
            variant="ghost"
            onClick={() => router.back()}
          >
            Cancel
          </Button>
        </div>
      </form>

      {/* Ticket types (only shown after the event is created / in edit mode) */}
      {isEdit && (
        <div>
          <button
            type="button"
            className="text-sm font-medium text-accent hover:underline"
            onClick={() => setShowTicketForm((v) => !v)}
          >
            {showTicketForm ? 'Hide ticket form' : '+ Add ticket tier'}
          </button>
          {showTicketForm && (
            <div className="mt-3">
              <TicketTypeForm
                eventId={eventId}
                existingTiers={existing?.ticketTypes.map((t) => ({
                  id: t.id,
                  name: t.name,
                  description: t.description ?? '',
                  price: t.price,
                  totalTickets: t.totalTickets,
                  soldTickets: t.totalTickets - t.availableTickets,
                }))}
                onSaved={() => setShowTicketForm(false)}
              />
            </div>
          )}
        </div>
      )}

      {/* Cancel event (only in edit mode) */}
      {isEdit && existing?.status !== 'cancelled' && (
        <div className="border-t border-line pt-6">
          {!cancelConfirm ? (
            <button
              type="button"
              className="text-sm text-danger hover:underline"
              onClick={() => setCancelConfirm(true)}
            >
              Cancel this event
            </button>
          ) : (
            <div className="rounded-xl border border-danger/30 bg-danger/8 p-4">
              <p className="text-sm font-semibold text-danger">
                Are you sure? All active tickets will be refunded in bulk.
              </p>
              <div className="mt-3 flex gap-3">
                <Button
                  variant="danger"
                  disabled={cancelMutation.isPending}
                  onClick={() => void cancelMutation.mutateAsync()}
                >
                  {cancelMutation.isPending ? 'Cancelling…' : 'Yes, cancel event'}
                </Button>
                <Button variant="ghost" onClick={() => setCancelConfirm(false)}>
                  Keep event
                </Button>
              </div>
              {cancelMutation.error && (
                <p className="mt-2 text-sm text-danger">
                  {cancelMutation.error instanceof ApiClientError
                    ? cancelMutation.error.detail
                    : 'Could not cancel event.'}
                </p>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
