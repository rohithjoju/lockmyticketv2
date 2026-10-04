'use client';

import { useMutation, useQueryClient } from '@tanstack/react-query';
import { apiClient } from '@/lib/apiClient';

export type ReservationResult = {
  ticketIds: string[];
  expiresAt: string;
};

/**
 * Epic 1.1 — Reservation hook.
 *
 * Wraps POST /events/:id/reserve and DELETE /reservations/:id.
 * The countdown and payment are downstream of `reserveTickets` succeeding;
 * `releaseReservation` is called when the timer expires or the user gives up.
 */
export function useReservation(eventId: string) {
  const queryClient = useQueryClient();

  const reserveTicketsMutation = useMutation({
    mutationFn: async ({
      ticketDescriptionId,
      quantity,
    }: {
      ticketDescriptionId: string;
      quantity: number;
    }): Promise<ReservationResult> => {
      const { data } = await apiClient.post<ReservationResult>(
        `/events/${eventId}/reserve`,
        { ticketDescriptionId, quantity },
      );
      return data;
    },
  });

  const releaseReservationMutation = useMutation({
    mutationFn: async (ticketId: string): Promise<void> => {
      await apiClient.delete(`/reservations/${ticketId}`);
    },
    onSuccess: () => {
      // Refresh ticket list so the dashboard reflects the released seat
      void queryClient.invalidateQueries({ queryKey: ['tickets'] });
    },
  });

  return {
    reserveTickets: reserveTicketsMutation.mutateAsync,
    releaseReservation: releaseReservationMutation.mutateAsync,
    isReserving: reserveTicketsMutation.isPending,
    isReleasing: releaseReservationMutation.isPending,
    reserveError: reserveTicketsMutation.error,
  };
}
