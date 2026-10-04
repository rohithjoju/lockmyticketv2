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

test.describe('Organizer Flows & Event Management', () => {
  test.describe('Organizer Onboarding & Verification Gate', () => {
    test('Functionality: Attendee can view "Host an event" in navigation and visit upgrade page', async ({ page }) => {
      await loginViaUi(page, SEEDED_USERS.attendee1);
      await expect(page.locator('a:has-text("Host an event")').first()).toBeVisible();

      await page.goto('/organizer/upgrade');
      await expect(page.locator('h1')).toContainText('Organizer applications open next');
    });

    test('Error Handling: Invalid phone number (<10 digits or non-digits) is rejected', async ({ request }) => {
      const user = await createRandomUser(request);

      const fakePdfBuffer = Buffer.from('%PDF-1.4 simulated pdf document');

      const res = await request.post(`${API_URL}/organizers/upgrade`, {
        headers: { Authorization: `Bearer ${user.accessToken}` },
        multipart: {
          organizationName: 'Test Productions',
          contactNumber: '12345', // Invalid: only 5 digits
          description: 'Music event organizers',
          kycDocument: {
            name: 'kyc.pdf',
            mimeType: 'application/pdf',
            buffer: fakePdfBuffer,
          },
        },
      });

      expect(res.status()).toBe(400);
      const body = await res.json();
      expect(body.error.code).toBe('VALIDATION_FAILED');
      expect(body.error.field).toBe('contactNumber');
    });

    test('Security & Verification: Non-PDF files (magic bytes check) are rejected', async ({ request }) => {
      const user = await createRandomUser(request);

      // Binary payload disguised as PDF without %PDF- header
      const fakeExecutable = Buffer.from('MZ\x90\x00\x03\x00\x00\x00fake_binary_content');

      const res = await request.post(`${API_URL}/organizers/upgrade`, {
        headers: { Authorization: `Bearer ${user.accessToken}` },
        multipart: {
          organizationName: 'Malicious Corp',
          contactNumber: '9876543210',
          kycDocument: {
            name: 'fake.pdf',
            mimeType: 'application/pdf',
            buffer: fakeExecutable,
          },
        },
      });

      expect(res.status()).toBe(400);
      const body = await res.json();
      expect(body.error.code).toBe('VALIDATION_FAILED');
    });

    test('Security Gate: Pending organizer cannot create events (returns ORGANIZER_NOT_APPROVED)', async ({ request }) => {
      const pendingOrganizer = await getAuthToken(request, SEEDED_USERS.organizerPending);

      const futureStart = new Date(Date.now() + 86400000 * 5).toISOString();
      const futureEnd = new Date(Date.now() + 86400000 * 5 + 3600000 * 4).toISOString();

      const res = await request.post(`${API_URL}/events`, {
        headers: { Authorization: `Bearer ${pendingOrganizer.accessToken}` },
        data: {
          title: 'Unauthorized Event',
          city: 'Chennai',
          startTime: futureStart,
          endTime: futureEnd,
        },
      });

      expect(res.status()).toBe(403);
      const body = await res.json();
      expect(body.error.code).toBe('ORGANIZER_NOT_APPROVED');
    });

    test('Security Gate: Regular attendee without organizer application is FORBIDDEN from creating events', async ({ request }) => {
      const attendee = await getAuthToken(request, SEEDED_USERS.attendee1);

      const futureStart = new Date(Date.now() + 86400000 * 5).toISOString();
      const futureEnd = new Date(Date.now() + 86400000 * 5 + 3600000 * 4).toISOString();

      const res = await request.post(`${API_URL}/events`, {
        headers: { Authorization: `Bearer ${attendee.accessToken}` },
        data: {
          title: 'Attendee Event',
          city: 'Pune',
          startTime: futureStart,
          endTime: futureEnd,
        },
      });

      expect(res.status()).toBe(403);
      const body = await res.json();
      expect(body.error.code).toBe('FORBIDDEN');
    });
  });

  test.describe('Event Lifecycle & Management (Approved Organizer)', () => {
    test('Functionality: Approved organizer navigation bar reflects "Hosting"', async ({ page }) => {
      await loginViaUi(page, SEEDED_USERS.organizer1);
      await expect(page.locator('a:has-text("Hosting")').first()).toBeVisible();
    });

    test('Functionality: Approved organizer creates an event with custom refund policy', async ({ request }) => {
      const org = await getAuthToken(request, SEEDED_USERS.organizer1);

      const startTime = new Date(Date.now() + 86400000 * 14).toISOString();
      const endTime = new Date(Date.now() + 86400000 * 14 + 3600000 * 5).toISOString();

      const res = await request.post(`${API_URL}/events`, {
        headers: { Authorization: `Bearer ${org.accessToken}` },
        data: {
          title: `Indie Rock Night ${Date.now()}`,
          description: 'A night of vibrant indie rock music.',
          eventType: 'music',
          locationName: 'Jawaharlal Nehru Stadium',
          city: 'Kochi',
          startTime,
          endTime,
          refundPolicy: {
            full_refund_hours: 72,
            partial_refund_percent: 40,
          },
        },
      });

      expect(res.status()).toBe(201);
      const body = await res.json();
      expect(body.success).toBe(true);
      expect(body.data.id).toBeDefined();
      expect(body.data.organizerStatusSnapshot).toBe('approved');
      expect(body.data.refundPolicy.full_refund_hours).toBe(72);
    });

    test('Error Handling: Event with end_time <= start_time is rejected with VALIDATION_FAILED', async ({ request }) => {
      const org = await getAuthToken(request, SEEDED_USERS.organizer1);

      const startTime = new Date(Date.now() + 86400000 * 10).toISOString();
      const invalidEndTime = new Date(Date.now() + 86400000 * 9).toISOString(); // 1 day before start

      const res = await request.post(`${API_URL}/events`, {
        headers: { Authorization: `Bearer ${org.accessToken}` },
        data: {
          title: 'Time Paradox Concert',
          city: 'Kochi',
          startTime,
          endTime: invalidEndTime,
        },
      });

      expect(res.status()).toBe(400);
      const body = await res.json();
      expect(body.error.code).toBe('VALIDATION_FAILED');
      expect(body.error.field).toBe('endTime');
    });

    test('Security: Organizer A cannot update Organizer B\'s event', async ({ request }) => {
      const org2 = await getAuthToken(request, SEEDED_USERS.organizer2);

      // Org 2 tries to update Org 1's seeded event (Kochi Jazz Night)
      const res = await request.patch(`${API_URL}/events/${SEEDED_EVENTS.kochiJazz.id}`, {
        headers: { Authorization: `Bearer ${org2.accessToken}` },
        data: {
          title: 'Hacked by Org 2',
        },
      });

      expect(res.status()).toBe(403);
      const body = await res.json();
      expect(body.error.code).toBe('FORBIDDEN');
    });
  });

  test.describe('Ticket Types & Capacity Adjustments', () => {
    test('Functionality: Adding a ticket tier to an owned event', async ({ request }) => {
      const org = await getAuthToken(request, SEEDED_USERS.organizer1);

      const res = await request.post(`${API_URL}/events/${SEEDED_EVENTS.kochiJazz.id}/ticket-types`, {
        headers: { Authorization: `Bearer ${org.accessToken}` },
        data: {
          name: `Backstage Pass ${Date.now()}`,
          description: 'Access to backstage and green room',
          price: 5000,
          totalTickets: 25,
        },
      });

      expect(res.status()).toBe(201);
      const body = await res.json();
      expect(body.data.name).toContain('Backstage Pass');
      expect(body.data.availableTickets).toBe(25);
    });

    test('Security: Cannot add ticket type to another organizer\'s event', async ({ request }) => {
      const org2 = await getAuthToken(request, SEEDED_USERS.organizer2);

      const res = await request.post(`${API_URL}/events/${SEEDED_EVENTS.kochiJazz.id}/ticket-types`, {
        headers: { Authorization: `Bearer ${org2.accessToken}` },
        data: {
          name: 'Unauthorized Tier',
          price: 1000,
          totalTickets: 50,
        },
      });

      expect(res.status()).toBe(403);
    });
  });

  test.describe('Door Scanning, PII Protection & Analytics', () => {
    test('Security: Door check-in rejects invalid QR tokens or tampered claims', async ({ request }) => {
      const org = await getAuthToken(request, SEEDED_USERS.organizer1);

      const res = await request.post(`${API_URL}/tickets/verify`, {
        headers: { Authorization: `Bearer ${org.accessToken}` },
        data: {
          qrToken: 'invalid.jwt.token.string',
        },
      });

      expect(res.status()).toBe(401);
    });

    test('Error Handling & Concurrency (F7): Scanning an already-used ticket returns TICKET_ALREADY_USED', async ({ request }) => {
      const org = await getAuthToken(request, SEEDED_USERS.organizer1);
      const attendee = await getAuthToken(request, SEEDED_USERS.attendee2);

      // Fetch the ticket to obtain its signed QR token
      const ticketRes = await request.get(`${API_URL}/tickets/${SEEDED_TICKETS.user2AlreadyScanned}`, {
        headers: { Authorization: `Bearer ${attendee.accessToken}` },
      });
      expect(ticketRes.ok()).toBeTruthy();
      const { qrToken } = (await ticketRes.json()).data;
      expect(qrToken).toBeDefined();

      // Scanning the already-invalid ticket must be rejected with TICKET_ALREADY_USED (409)
      const scanRes = await request.post(`${API_URL}/tickets/verify`, {
        headers: { Authorization: `Bearer ${org.accessToken}` },
        data: { qrToken },
      });

      expect(scanRes.status()).toBe(409);
      const body = await scanRes.json();
      expect(body.error.code).toBe('TICKET_ALREADY_USED');
    });

    test('Security & PII Protection: Attendee list exposes names only; no email or phone leaked', async ({ request }) => {
      const org = await getAuthToken(request, SEEDED_USERS.organizer1);

      const res = await request.get(`${API_URL}/events/${SEEDED_EVENTS.kochiJazz.id}/attendees`, {
        headers: { Authorization: `Bearer ${org.accessToken}` },
      });

      expect(res.ok()).toBeTruthy();
      const body = await res.json();
      expect(body.success).toBe(true);
      expect(Array.isArray(body.data)).toBe(true);

      // Verify strict PII privacy rules (§8 PII)
      for (const attendee of body.data) {
        expect(attendee.attendeeName).toBeDefined();
        expect(attendee.ticketType).toBeDefined();
        expect(attendee).not.toHaveProperty('email');
        expect(attendee).not.toHaveProperty('phone');
        expect(attendee).not.toHaveProperty('contactNumber');
        expect(attendee).not.toHaveProperty('payment');
      }
    });

    test('Functionality: Event analytics provides sales breakdown and check-in rates', async ({ request }) => {
      const org = await getAuthToken(request, SEEDED_USERS.organizer1);

      const res = await request.get(`${API_URL}/events/${SEEDED_EVENTS.kochiJazz.id}/analytics`, {
        headers: { Authorization: `Bearer ${org.accessToken}` },
      });

      expect(res.ok()).toBeTruthy();
      const body = await res.json();
      expect(body.success).toBe(true);
      expect(body.data.eventId).toBe(SEEDED_EVENTS.kochiJazz.id);
      expect(typeof body.data.ticketsSold).toBe('number');
      expect(typeof body.data.revenue).toBe('number');
      expect(typeof body.data.checkInRate).toBe('number');
      expect(Array.isArray(body.data.byTicketType)).toBe(true);
      expect(Array.isArray(body.data.byDate)).toBe(true);
    });

    test('Security: Organizer A cannot view Organizer B\'s event analytics', async ({ request }) => {
      const org2 = await getAuthToken(request, SEEDED_USERS.organizer2);

      const res = await request.get(`${API_URL}/events/${SEEDED_EVENTS.kochiJazz.id}/analytics`, {
        headers: { Authorization: `Bearer ${org2.accessToken}` },
      });

      expect(res.status()).toBe(403);
    });
  });
});
