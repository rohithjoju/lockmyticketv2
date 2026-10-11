'use client';

import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useRouter } from 'next/navigation';
import { apiClient } from '@/lib/apiClient';

export type PaymentOrder = {
  paymentId?: string;
  orderId?: string;
  razorpayOrderId?: string;
  keyId?: string;
  amount: number; // in Rupees from API or paise
  currency: string;
  ticketIds?: string[];
  expiresAt?: string;
};

export type RazorpayPaymentResponse = {
  razorpay_order_id: string;
  razorpay_payment_id: string;
  razorpay_signature: string;
};

export type ConfirmedPurchase = {
  paymentId: string;
  razorpayOrderId: string;
  razorpayPaymentId: string | null;
  status: string;
  amount: number;
  alreadyProcessed: boolean;
  tickets: Array<{
    id: string;
    eventId: string;
    ticketType: string;
    qrToken: string | null;
  }>;
};

declare global {
  interface Window {
    Razorpay: new (options: Record<string, unknown>) => {
      open(): void;
      on(event: string, handler: (...args: unknown[]) => void): void;
    };
  }
}

function loadRazorpayScript(): Promise<void> {
  return new Promise((resolve, reject) => {
    if (document.getElementById('razorpay-checkout-js')) {
      resolve();
      return;
    }
    const script = document.createElement('script');
    script.id = 'razorpay-checkout-js';
    script.src = 'https://checkout.razorpay.com/v1/checkout.js';
    script.onload = () => resolve();
    script.onerror = () => reject(new Error('Failed to load Razorpay checkout script'));
    document.head.appendChild(script);
  });
}

/**
 * Epic 1.3 — Razorpay payment hook.
 *
 * Two responsibilities:
 *   1. `createPaymentOrder`: calls POST /payments/order → returns Razorpay order details.
 *   2. `openCheckout`: loads the Razorpay modal, handles success (calls verifyPayment)
 *      and dismiss (does nothing — the timer keeps running so the user can retry).
 *
 * On successful verification the user is navigated to /dashboard?booked=true.
 * On modal dismiss we do NOT claim success; we just close and leave the timer
 * running so the attendee can re-open payment before the hold expires.
 */
export function usePayment(user: { name: string; email: string } | null) {
  const router = useRouter();
  const queryClient = useQueryClient();

  const createOrderMutation = useMutation({
    mutationFn: async (ticketIds: string[]): Promise<PaymentOrder> => {
      const { data } = await apiClient.post<PaymentOrder>('/payments/order', { ticketIds });
      return data;
    },
  });

  const verifyMutation = useMutation({
    mutationFn: async (response: RazorpayPaymentResponse): Promise<ConfirmedPurchase> => {
      const { data } = await apiClient.post<ConfirmedPurchase>('/payments/verify', {
        razorpay_order_id: response.razorpay_order_id,
        razorpay_payment_id: response.razorpay_payment_id,
        razorpay_signature: response.razorpay_signature,
      });
      return data;
    },
    onSuccess: () => {
      // Invalidate ticket list so the dashboard shows the newly confirmed tickets
      void queryClient.invalidateQueries({ queryKey: ['tickets'] });
      router.push('/dashboard?booked=true');
    },
  });

  const openCheckout = async (order: PaymentOrder, onDismiss?: () => void) => {
    await loadRazorpayScript();

    const orderId = order.orderId ?? order.razorpayOrderId;
    if (!orderId) {
      throw new Error('Order ID is missing from payment order response.');
    }

    const key = order.keyId || process.env.NEXT_PUBLIC_RAZORPAY_KEY_ID;
    if (!key) {
      throw new Error('Razorpay Key ID is not configured.');
    }

    // Backend provides amount in Rupees (e.g. 500). Razorpay checkout expects paise.
    // If amount is already in paise (> 100 with decimals or integer), ensure Math.round.
    const amountInPaise = Math.round(order.amount * 100);

    return new Promise<void>((resolve, reject) => {
      const rzp = new window.Razorpay({
        key,
        order_id: orderId,
        amount: amountInPaise,
        currency: order.currency ?? 'INR',
        name: 'LockMyTicket',
        description: 'Ticket purchase',
        prefill: {
          name: user?.name ?? '',
          email: user?.email ?? '',
        },
        handler: async (response: RazorpayPaymentResponse) => {
          try {
            await verifyMutation.mutateAsync(response);
            resolve();
          } catch (err) {
            reject(err);
          }
        },
        modal: {
          ondismiss: () => {
            // Per SPEC §7.1: do not claim success. Timer keeps running.
            onDismiss?.();
            resolve();
          },
        },
        theme: { color: '#6366f1' },
      });

      rzp.on('payment.failed', (data: unknown) => {
        const response = data as { error?: { description?: string; reason?: string } } | undefined;
        const errorMsg =
          response?.error?.description ??
          response?.error?.reason ??
          'Payment failed at the gateway.';
        reject(new Error(errorMsg));
      });

      rzp.open();
    });
  };

  return {
    createPaymentOrder: createOrderMutation.mutateAsync,
    openCheckout,
    isCreatingOrder: createOrderMutation.isPending,
    isVerifying: verifyMutation.isPending,
    createOrderError: createOrderMutation.error,
    verifyError: verifyMutation.error,
  };
}
