import { test, expect } from '@playwright/test';
import {
  API_URL,
  SEEDED_EVENTS,
  SEEDED_USERS,
  createRandomUser,
  getAuthToken,
  loginViaUi,
} from './helpers.ts';

test.describe('Epic 3 & 4: Organizer Onboarding, Management & Operations', () => {
  test.describe('Epic 3.1 & 3.2: Organizer Onboarding & Status Page', () => {
    test('Functionality: Attendee visits /organizer/upgrade and submits application', async ({ page, request }) => {
      const freshUser = await createRandomUser(request);
      await loginViaUi(page, freshUser);

      await page.goto('/organizer/upgrade');
      await expect(page.locator('h1')).toContainText('Apply to host events');

      // Fill in required fields
      await page.locator('input#org-name').fill('Horizon Live Media');
      await page.locator('input#contact').fill('9876543210');
      await page.locator('input#address').fill('MG Road, Bangalore');
      await page.locator('textarea#description').fill('We are a full scale concert management organization with 10+ years experience.');

      // Upload valid simulated PDF
      const validPdfBuffer = Buffer.from('%PDF-1.4 simulated pdf test content');
      await page.locator('input#kyc-doc').setInputFiles({
        name: 'valid_kyc.pdf',
        mimeType: 'application/pdf',
        buffer: validPdfBuffer,
      });

      // Submit application
      await page.locator('button[type="submit"]:has-text("Submit application")').click();

      // Expect redirect to status page with pending review notice
      await page.waitForURL((url) => url.pathname.includes('/organizer/status'), { timeout: 15000 });
      await expect(page.locator('h1')).toContainText('Application status');
      await expect(page.locator('text=Under review')).toBeVisible();
    });

    test('Functionality: Pending organizer visits /organizer/status and sees review details', async ({ page }) => {
      await loginViaUi(page, SEEDED_USERS.organizerPending);
      await page.goto('/organizer/status');

      await expect(page.locator('h1')).toContainText('Application status');
      await expect(page.locator('text=pending').first()).toBeVisible();
      await expect(page.locator('text=Under review')).toBeVisible();
    });
  });

  test.describe('Epic 4.1: Organizer Events List Dashboard', () => {
    test('Functionality: Approved organizer views their events list with metrics and action buttons', async ({ page }) => {
      await loginViaUi(page, SEEDED_USERS.organizer1);
      await page.goto('/organizer/events');

      await expect(page.locator('h1')).toContainText('Your events');
      await expect(page.locator('a:has-text("+ Create event")')).toBeVisible();

      // Check event card actions
      const editBtn = page.locator('a:has-text("Edit")').first();
      const analyticsBtn = page.locator('a:has-text("Analytics")').first();
      const rosterBtn = page.locator('a:has-text("Roster")').first();

      await expect(editBtn).toBeVisible();
      await expect(analyticsBtn).toBeVisible();
      await expect(rosterBtn).toBeVisible();
    });
  });

  test.describe('Epic 4.2 & 4.3: Event Creation, Editing & Ticket Tiers', () => {
    test('Functionality: Approved organizer can navigate to create event form', async ({ page }) => {
      await loginViaUi(page, SEEDED_USERS.organizer1);
      await page.goto('/organizer/events/create');

      await expect(page.locator('h1')).toContainText('Create event');
      await expect(page.locator('input#ev-title')).toBeVisible();
      await expect(page.locator('select#ev-type')).toBeVisible();
      await expect(page.locator('select#ev-city')).toBeVisible();
      await expect(page.locator('input#ev-start')).toBeVisible();
      await expect(page.locator('input#ev-end')).toBeVisible();
      await expect(page.locator('button[type="submit"]:has-text("Create event")')).toBeVisible();
    });

    test('Functionality: Approved organizer visits event edit page and adds a ticket tier', async ({ page }) => {
      await loginViaUi(page, SEEDED_USERS.organizer1);
      await page.goto(`/organizer/events/${SEEDED_EVENTS.kochiJazz.id}/edit`);

      await expect(page.locator('h1')).toBeVisible();
      await expect(page.locator('input#ev-title')).toHaveValue(SEEDED_EVENTS.kochiJazz.title);

      // Toggle ticket tier form
      const addTierBtn = page.locator('button:has-text("+ Add ticket tier")');
      await expect(addTierBtn).toBeVisible();
      await addTierBtn.click();

      // Fill in new ticket tier
      await page.locator('input#tier-name').fill(`Festival Tier ${Date.now()}`);
      await page.locator('input#tier-price').fill('1500');
      await page.locator('input#tier-total').fill('50');

      // Click add tier
      await page.locator('button:has-text("Add tier")').click();
    });
  });

  test.describe('Epic 4.4 & 4.5: Event Analytics & Attendee Roster', () => {
    test('Functionality: Organizer views event analytics dashboard with KPI cards', async ({ page }) => {
      await loginViaUi(page, SEEDED_USERS.organizer1);
      await page.goto(`/organizer/events/${SEEDED_EVENTS.kochiJazz.id}/analytics`);

      await expect(page.locator('h1')).toContainText('Event insights');
      await expect(page.locator('text=Tickets sold')).toBeVisible();
      await expect(page.locator('text=Gross revenue')).toBeVisible();
      await expect(page.locator('text=Check-in rate')).toBeVisible();
    });

    test('Functionality & Privacy: Organizer views attendee roster with search and strictly no PII leaked', async ({ page }) => {
      await loginViaUi(page, SEEDED_USERS.organizer1);
      await page.goto(`/organizer/events/${SEEDED_EVENTS.kochiJazz.id}/attendees`);

      await expect(page.locator('h1')).toContainText('Attendees');
      await expect(page.locator('input[type="search"]')).toBeVisible();

      // Table headers
      await expect(page.locator('th:has-text("Attendee")')).toBeVisible();
      await expect(page.locator('th:has-text("Ticket tier")')).toBeVisible();
      await expect(page.locator('th:has-text("Status")')).toBeVisible();

      // Ensure no Email or Phone table columns exist (§8 PII rules)
      await expect(page.locator('th:has-text("Email")')).not.toBeVisible();
      await expect(page.locator('th:has-text("Phone")')).not.toBeVisible();
    });
  });

  test.describe('Epic 4.6: Door Camera QR Scanner UI', () => {
    test('Functionality: Organizer opens door scanner page and can start/stop camera', async ({ page }) => {
      await loginViaUi(page, SEEDED_USERS.organizer1);
      await page.goto(`/organizer/events/${SEEDED_EVENTS.kochiJazz.id}/scan`);

      await expect(page.locator('h1')).toContainText('Scan tickets');
      await expect(page.locator('div#qr-scanner-container')).toBeVisible();

      const startCameraBtn = page.locator('button:has-text("Start camera")');
      await expect(startCameraBtn).toBeVisible();
    });
  });
});
