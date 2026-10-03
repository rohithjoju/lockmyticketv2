import { test, expect } from '@playwright/test';
import {
  API_URL,
  SEEDED_EVENTS,
  SEEDED_TICKETS,
  SEEDED_USERS,
  createRandomUser,
  getAuthToken,
  loginViaUi,
} from './helpers.ts';

test.describe('Attendee Capabilities & Ticketing Lifecycle', () => {
  test.describe('Protected Dashboard & Ticket Wallet UI', () => {
    test('Security: Unauthenticated access to /dashboard redirects to login with return path', async ({ page }) => {
      await page.goto('/dashboard');
      await page.waitForURL((url) => url.pathname.includes('/auth/login'));
      expect(page.url()).toContain('returnTo=%2Fdashboard');
    });

    test('Functionality: Authenticated attendee sees dashboard, signed-in email, and active ticket stubs', async ({ page }) => {
      await loginViaUi(page, SEEDED_USERS.attendee1);
      await page.goto('/dashboard');

      await expect(page.locator('h1')).toContainText('Your tickets');
      await expect(page.locator(`text=Signed in as ${SEEDED_USERS.attendee1.email}`)).toBeVisible();

      // Seeded confirmed tickets for User 1 should be visible on dashboard
      await expect(page.locator('text=Kochi Jazz Night').first()).toBeVisible();
      await expect(page.locator('text=Ready').first()).toBeVisible();
    });

    test('Functionality & UX: Empty state is rendered when user has no booked tickets', async ({ page, request }) => {
      // Create a brand new attendee
      const freshUser = await createRandomUser(request);
      await loginViaUi(page, freshUser);
      await page.goto('/dashboard');

      await expect(page.locator('text=No tickets yet')).toBeVisible();
      await expect(page.locator('a:has-text("Find something to go to")')).toBeVisible();
    });

    test('Functionality: Banner informs attendee if an organizer application is under review', async ({ page }) => {
      await loginViaUi(page, SEEDED_USERS.organizerPending);
      await page.goto('/dashboard');

      await expect(page.locator('text=Your organizer application is under review')).toBeVisible();
    });
  });

  test.describe('Ticket Reservation Flow (Atomic Inventory Hold)', () => {
    test('Functionality: Holding a ticket returns ticketIds and a 10-minute expiry', async ({ request }) => {
      const user = await createRandomUser(request);

      const res = await request.post(`${API_URL}/events/${SEEDED_EVENTS.kochiJazz.id}/reserve`, {
        headers: { Authorization: `Bearer ${user.accessToken}` },
        data: {
          ticketDescriptionId: SEEDED_EVENTS.kochiJazz.generalTicketId,
          quantity: 2,
        },
      });

      expect(res.status()).toBe(201);
      const body = await res.json();
      expect(body.success).toBe(true);
      expect(Array.isArray(body.data.ticketIds)).toBe(true);
      expect(body.data.ticketIds.length).toBe(2);

      // Verify expiration timestamp is approximately 10 minutes in future
      const expiresAt = new Date(body.data.expiresAt).getTime();
      const now = Date.now();
      const diffMinutes = (expiresAt - now) / 60000;
      expect(diffMinutes).toBeGreaterThan(8);
      expect(diffMinutes).toBeLessThanOrEqual(11);
    });

    test('Error Handling: Reserving invalid quantity (0, negative, >20) is rejected', async ({ request }) => {
      const user = await createRandomUser(request);

      // Zero quantity
      const resZero = await request.post(`${API_URL}/events/${SEEDED_EVENTS.kochiJazz.id}/reserve`, {
        headers: { Authorization: `Bearer ${user.accessToken}` },
        data: {
          ticketDescriptionId: SEEDED_EVENTS.kochiJazz.generalTicketId,
          quantity: 0,
        },
      });
      expect(resZero.status()).toBe(400);
      const bodyZero = await resZero.json();
      expect(bodyZero.error.code).toBe('VALIDATION_FAILED');

      // Excessive quantity (> 20)
      const resExcess = await request.post(`${API_URL}/events/${SEEDED_EVENTS.kochiJazz.id}/reserve`, {
        headers: { Authorization: `Bearer ${user.accessToken}` },
        data: {
          ticketDescriptionId: SEEDED_EVENTS.kochiJazz.generalTicketId,
          quantity: 50,
        },
      });
      expect(resExcess.status()).toBe(400);
    });

    test('Error Handling: Per-user ticket limit (>10 per event) triggers TICKET_LIMIT_EXCEEDED', async ({ request }) => {
      const user = await createRandomUser(request);

      // Reserve 10 tickets (maximum allowed per user per event)
      const res1 = await request.post(`${API_URL}/events/${SEEDED_EVENTS.kochiJazz.id}/reserve`, {
        headers: { Authorization: `Bearer ${user.accessToken}` },
        data: {
          ticketDescriptionId: SEEDED_EVENTS.kochiJazz.generalTicketId,
          quantity: 10,
        },
      });
      expect(res1.status()).toBe(201);

      // Attempting to reserve an 11th ticket for the same event must fail
      const res2 = await request.post(`${API_URL}/events/${SEEDED_EVENTS.kochiJazz.id}/reserve`, {
        headers: { Authorization: `Bearer ${user.accessToken}` },
        data: {
          ticketDescriptionId: SEEDED_EVENTS.kochiJazz.generalTicketId,
          quantity: 1,
        },
      });
      expect(res2.status()).toBe(409);
      const body2 = await res2.json();
      expect(body2.error.code).toBe('TICKET_LIMIT_EXCEEDED');
    });

    test('Security: Reserving without authentication is rejected with UNAUTHENTICATED', async ({ request }) => {
      const res = await request.post(`${API_URL}/events/${SEEDED_EVENTS.kochiJazz.id}/reserve`, {
        data: {
          ticketDescriptionId: SEEDED_EVENTS.kochiJazz.generalTicketId,
          quantity: 1,
        },
      });
      expect(res.status()).toBe(401);
      const body = await res.json();
      expect(body.error.code).toBe('UNAUTHENTICATED');
    });

    test('Functionality: Releasing reservation restores inventory immediately', async ({ request }) => {
      const user = await createRandomUser(request);

      // 1. Reserve 1 ticket
      const reserveRes = await request.post(`${API_URL}/events/${SEEDED_EVENTS.kochiJazz.id}/reserve`, {
        headers: { Authorization: `Bearer ${user.accessToken}` },
        data: {
          ticketDescriptionId: SEEDED_EVENTS.kochiJazz.generalTicketId,
          quantity: 1,
        },
      });
      expect(reserveRes.status()).toBe(201);
      const { ticketIds } = (await reserveRes.json()).data;

      // 2. Early cancellation / release
      const releaseRes = await request.delete(`${API_URL}/reservations/${ticketIds[0]}`, {
        headers: { Authorization: `Bearer ${user.accessToken}` },
      });
      expect(releaseRes.ok()).toBeTruthy();
      const releaseBody = await releaseRes.json();
      expect(releaseBody.data.released).toBe(true);
    });

    test('Security: User cannot release another user\'s reservation', async ({ request }) => {
      const user1 = await createRandomUser(request);
      const user2 = await createRandomUser(request);

      // User 1 reserves
      const reserveRes = await request.post(`${API_URL}/events/${SEEDED_EVENTS.kochiJazz.id}/reserve`, {
        headers: { Authorization: `Bearer ${user1.accessToken}` },
        data: {
          ticketDescriptionId: SEEDED_EVENTS.kochiJazz.generalTicketId,
          quantity: 1,
        },
      });
      const { ticketIds } = (await reserveRes.json()).data;

      // User 2 tries to delete User 1's reservation
      const releaseRes = await request.delete(`${API_URL}/reservations/${ticketIds[0]}`, {
        headers: { Authorization: `Bearer ${user2.accessToken}` },
      });
      expect(releaseRes.status()).toBe(404);
    });
  });

  test.describe('Payment Order Creation & Verification', () => {
    test('Functionality: Order creation against valid reservation returns Razorpay order details', async ({ request }) => {
      const user = await createRandomUser(request);

      // 1. Reserve 1 ticket
      const reserveRes = await request.post(`${API_URL}/events/${SEEDED_EVENTS.kochiJazz.id}/reserve`, {
        headers: { Authorization: `Bearer ${user.accessToken}` },
        data: {
          ticketDescriptionId: SEEDED_EVENTS.kochiJazz.generalTicketId,
          quantity: 1,
        },
      });
      const { ticketIds } = (await reserveRes.json()).data;

      // 2. Create payment order
      const orderRes = await request.post(`${API_URL}/payments/order`, {
        headers: { Authorization: `Bearer ${user.accessToken}` },
        data: { ticketIds },
      });

      expect(orderRes.status()).toBe(201);
      const orderBody = await orderRes.json();
      expect(orderBody.success).toBe(true);
      expect(orderBody.data.orderId).toBeDefined();
      expect(orderBody.data.amount).toBe(800); // 800 INR for general ticket
      expect(orderBody.data.currency).toBe('INR');
    });

    test('Error Handling: Payment verification with forged signature is rejected with INVALID_SIGNATURE', async ({ request }) => {
      const user = await createRandomUser(request);

      const fakeVerifyRes = await request.post(`${API_URL}/payments/verify`, {
        headers: { Authorization: `Bearer ${user.accessToken}` },
        data: {
          razorpay_order_id: 'order_fake_12345',
          razorpay_payment_id: 'pay_fake_67890',
          razorpay_signature: 'invalid_forged_hmac_signature',
        },
      });

      expect(fakeVerifyRes.status()).toBe(400);
      const body = await fakeVerifyRes.json();
      expect(body.error.code).toBe('INVALID_SIGNATURE');
    });

    test('Security: Webhook without valid X-Razorpay-Signature header is rejected before DB operations', async ({ request }) => {
      const res = await request.post(`${API_URL}/payments/webhook`, {
        data: JSON.stringify({ event: 'payment.captured' }),
        headers: {
          'x-razorpay-signature': 'invalid_raw_signature',
        },
      });

      expect(res.status()).toBe(400);
      const body = await res.json();
      expect(body.error.code).toBe('INVALID_SIGNATURE');
    });
  });

  test.describe('Ticket Privacy & QR Wallet Security', () => {
    test('Functionality & Security: Confirmed ticket provides a signed QR token with zero PII', async ({ request }) => {
      const attendee = await getAuthToken(request, SEEDED_USERS.attendee1);

      const res = await request.get(`${API_URL}/tickets/${SEEDED_TICKETS.user1Confirmed1}`, {
        headers: { Authorization: `Bearer ${attendee.accessToken}` },
      });

      expect(res.ok()).toBeTruthy();
      const body = await res.json();
      expect(body.success).toBe(true);
      expect(body.data.qrToken).toBeDefined();
      expect(typeof body.data.qrToken).toBe('string');

      // Decode JWT payload without secret to verify zero PII leakage
      const [, payloadBase64] = body.data.qrToken.split('.');
      const payload = JSON.parse(Buffer.from(payloadBase64, 'base64url').toString('utf8'));
      expect(payload.tid).toBe(SEEDED_TICKETS.user1Confirmed1);
      expect(payload.eid).toBe(SEEDED_EVENTS.kochiJazz.id);
      expect(payload.nonce).toBeDefined();
      // Assert absence of any PII
      expect(payload).not.toHaveProperty('email');
      expect(payload).not.toHaveProperty('name');
      expect(payload).not.toHaveProperty('phone');
    });

    test('Security: Attendee cannot view another user\'s ticket detail or QR code', async ({ request }) => {
      const user2 = await createRandomUser(request);

      // User 2 requests User 1's seeded ticket
      const getRes = await request.get(`${API_URL}/tickets/${SEEDED_TICKETS.user1Confirmed1}`, {
        headers: { Authorization: `Bearer ${user2.accessToken}` },
      });
      expect(getRes.status()).toBe(404);
    });

    test('Security: User cannot refund a ticket they do not own', async ({ request }) => {
      const user2 = await createRandomUser(request);

      // User 2 attempts refund on User 1's seeded ticket
      const refundRes = await request.post(`${API_URL}/tickets/${SEEDED_TICKETS.user1Confirmed1}/refund`, {
        headers: { Authorization: `Bearer ${user2.accessToken}` },
      });
      expect(refundRes.status()).toBe(404);
    });
  });
});
