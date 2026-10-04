import { test, expect } from '@playwright/test';
import { API_URL, SEEDED_EVENTS, SEEDED_USERS, loginViaUi } from './helpers.ts';

test.describe('Events & Discovery Flows', () => {
  test.describe('Public Event Browsing & Search', () => {
    test.beforeEach(async ({ page }) => {
      await page.goto('/events');
    });

    test('Functionality: Displays page header, search bar, and active events', async ({ page }) => {
      await expect(page.locator('h1')).toContainText('Browse events');
      await expect(page.locator('form[role="search"]')).toBeVisible();
      await expect(page.locator('input[name="q"]')).toBeVisible();
      await expect(page.locator('input[name="city"]')).toBeVisible();

      // Seeded events should be listed
      const eventCards = page.locator('article');
      await expect(eventCards.first()).toBeVisible();
      await expect(page.locator(`text=${SEEDED_EVENTS.kochiJazz.title}`)).toBeVisible();
      await expect(page.locator(`text=${SEEDED_EVENTS.delhiSufi.title}`)).toBeVisible();
    });

    test('Functionality: Filter events by full-text search keyword', async ({ page }) => {
      await page.locator('input[name="q"]').fill('jazz');
      await page.locator('button[type="submit"]:has-text("Search")').click();

      await page.waitForURL((url) => url.searchParams.get('q') === 'jazz');
      await expect(page.locator(`text=${SEEDED_EVENTS.kochiJazz.title}`)).toBeVisible();
      // Tech summit should not appear under "jazz"
      await expect(page.locator(`text=${SEEDED_EVENTS.mumbaiTech.title}`)).not.toBeVisible();
    });

    test('Functionality: Filter events by city', async ({ page }) => {
      await page.locator('input[name="city"]').fill('Mumbai');
      await page.locator('button[type="submit"]:has-text("Search")').click();

      await page.waitForURL((url) => url.searchParams.get('city') === 'Mumbai');
      await expect(page.locator(`text=${SEEDED_EVENTS.mumbaiTech.title}`)).toBeVisible();
      await expect(page.locator(`text=${SEEDED_EVENTS.kochiJazz.title}`)).not.toBeVisible();
    });

    test('Error Handling & Edge Case: Empty search results show clear message', async ({ page }) => {
      await page.locator('input[name="q"]').fill('xyzNonExistentEventTitle999');
      await page.locator('button[type="submit"]:has-text("Search")').click();

      await expect(page.locator('text=Nothing matches that yet')).toBeVisible();
      await expect(page.locator('text=Try a broader search, or drop the city filter')).toBeVisible();
    });

    test('Security & SEO: Form uses GET method and exposes query in the URL', async ({ page }) => {
      const form = page.locator('form[role="search"]');
      // Search form does not leak sensitive information and allows shareable URL parameters
      await expect(form).not.toHaveAttribute('method', /post/i);
    });
  });

  test.describe('Event Detail & Ticket Availability', () => {
    test('Functionality: Loads event details, venue, dates, and live ticket tiers', async ({ page }) => {
      await page.goto(`/events/${SEEDED_EVENTS.kochiJazz.id}`);

      await expect(page.locator('h1')).toContainText(SEEDED_EVENTS.kochiJazz.title);
      await expect(page.locator('text=Kochi').first()).toBeVisible();
      await expect(page.locator('text=Marine Drive Amphitheatre')).toBeVisible();

      // Check ticket types rendering
      await expect(page.locator('text=General')).toBeVisible();
      await expect(page.locator('text=VIP')).toBeVisible();
      await expect(page.locator('text=available').first()).toBeVisible();
    });

    test('Functionality & Edge Case: Completely sold out ticket tier renders "Sold out" status', async ({ page }) => {
      await page.goto(`/events/${SEEDED_EVENTS.kochiJazz.id}`);

      // Seeded Early Bird tier has available_tickets: 0
      await expect(page.locator('text=Early Bird Special')).toBeVisible();
      await expect(page.getByText('Sold out', { exact: true })).toBeVisible();
    });

    test('Functionality & Edge Case: Low-stock ticket tier displays urgency count', async ({ page }) => {
      await page.goto(`/events/${SEEDED_EVENTS.mumbaiTech.id}`);

      // Seeded VIP Founder tier has available_tickets: 2
      await expect(page.locator('text=VIP Founder & Speaker Pass')).toBeVisible();
      await expect(page.locator('text=2 left')).toBeVisible();
    });

    test('Functionality & Edge Case: Cancelled event renders cancellation banner notice', async ({ page }) => {
      await page.goto(`/events/${SEEDED_EVENTS.delhiCancelled.id}`);

      await expect(page.locator('text=This event was cancelled')).toBeVisible();
      await expect(page.locator('text=Ticket holders are refunded in full, automatically')).toBeVisible();
    });

    test('Error Handling & Edge Case: Invalid or non-existent event UUID renders 404', async ({ page }) => {
      const nonExistentId = '00000000-0000-0000-0000-000000000000';
      const response = await page.goto(`/events/${nonExistentId}`);
      expect(response?.status()).toBe(404);
      await expect(page.locator('text=404').or(page.locator('text=not found', { hasNotText: 'script' }))).toBeVisible();
    });

    test('Functionality & UX: Unauthenticated user sees "Sign in to book" with returnTo parameter', async ({ page }) => {
      await page.goto(`/events/${SEEDED_EVENTS.kochiJazz.id}`);

      const bookingButton = page.locator('a:has-text("Sign in to book")');
      await expect(bookingButton).toBeVisible();
      await expect(bookingButton).toHaveAttribute(
        'href',
        new RegExp(`/auth/login\\?next=.*${SEEDED_EVENTS.kochiJazz.id}`),
      );
    });

    test('Functionality & UX: Authenticated attendee sees booking CTA', async ({ page }) => {
      await loginViaUi(page, SEEDED_USERS.attendee1);
      await page.goto(`/events/${SEEDED_EVENTS.kochiJazz.id}`);

      // Authenticated booking button is visible
      const reserveBtn = page.locator('button:has-text("Reserve tickets")');
      await expect(reserveBtn).toBeVisible();
    });
  });

  test.describe('Events API Contract & Boundary Validations', () => {
    test('API Functionality: GET /api/v1/events supports cursor pagination', async ({ request }) => {
      const res = await request.get(`${API_URL}/events?limit=2`);
      expect(res.ok()).toBeTruthy();

      const body = await res.json();
      expect(body.success).toBe(true);
      expect(Array.isArray(body.data)).toBe(true);
      expect(body.data.length).toBeLessThanOrEqual(2);
      expect(body.meta).toBeDefined();
      expect(body.meta.requestId).toBeDefined();
    });

    test('API Error Handling: Malformed date format in filter is rejected with VALIDATION_FAILED', async ({ request }) => {
      const res = await request.get(`${API_URL}/events?from=invalid-date-string`);
      expect(res.status()).toBe(400);

      const body = await res.json();
      expect(body.success).toBe(false);
      expect(body.error.code).toBe('VALIDATION_FAILED');
      expect(body.meta.requestId).toBeDefined();
    });

    test('API Error Handling: Non-UUID event ID in detail route is rejected', async ({ request }) => {
      const res = await request.get(`${API_URL}/events/not-a-uuid`);
      expect(res.status()).toBe(400);

      const body = await res.json();
      expect(body.success).toBe(false);
      expect(body.error.code).toBe('VALIDATION_FAILED');
    });
  });
});
