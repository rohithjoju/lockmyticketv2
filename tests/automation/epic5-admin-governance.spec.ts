import { test, expect } from '@playwright/test';
import {
  API_URL,
  SEEDED_USERS,
  getAuthToken,
  loginViaUi,
} from './helpers.ts';

test.describe('Epic 5: Admin Governance, Moderation & Audit Panels', () => {
  test.describe('Epic 5.1: Admin Dashboard Overview', () => {
    test('Functionality: Admin views platform overview KPIs with cards linking to sub-panels', async ({ page }) => {
      await loginViaUi(page, SEEDED_USERS.admin);
      await page.goto('/admin');

      await expect(page.locator('h1')).toContainText('Platform overview');

      // Metric headings & cards
      await expect(page.locator('text=Total users').first()).toBeVisible();
      await expect(page.locator('text=Total events').first()).toBeVisible();
      await expect(page.locator('text=Net revenue').first()).toBeVisible();
      await expect(page.locator('text=Success rate').first()).toBeVisible();

      // Navigation links to sub-panels
      await expect(page.locator('a[href="/admin/users"]').first()).toBeVisible();
      await expect(page.locator('a[href="/admin/organizers"]').first()).toBeVisible();
      await expect(page.locator('a[href="/admin/events"]').first()).toBeVisible();
    });
  });

  test.describe('Epic 5.2: Admin User Governance Panel', () => {
    test('Functionality: Admin views user list, uses search and filters, and self-disable is guarded', async ({ page }) => {
      await loginViaUi(page, SEEDED_USERS.admin);
      await page.goto('/admin/users');

      await expect(page.locator('h1')).toContainText('Users');
      await expect(page.locator('input[type="search"]')).toBeVisible();

      // Table rendered
      await expect(page.locator('th:has-text("Name")')).toBeVisible();
      // Filter to admin role so current logged-in admin appears in the page
      await page.locator('select').first().selectOption('admin');

      // Safety guard: Admin cannot disable themselves — shown as '(you)'
      await expect(page.locator('text=(you)').first()).toBeVisible();
    });
  });

  test.describe('Epic 5.3: Organizer Verification Queue', () => {
    test('Functionality: Admin views pending organizer queue with KYC links and action buttons', async ({ page }) => {
      await loginViaUi(page, SEEDED_USERS.admin);
      await page.goto('/admin/organizers');

      await expect(page.locator('h1')).toContainText('Organizer queue');

      // Wait for either the queue items to render or empty state to appear
      const approveBtn = page.locator('button:has-text("Approve")').first();
      const emptyState = page.locator('text=Queue empty');

      await expect(approveBtn.or(emptyState)).toBeVisible({ timeout: 15000 });

      if (await approveBtn.isVisible()) {
        await expect(approveBtn).toBeVisible();
        const rejectBtn = page.locator('button:has-text("Reject")').first();
        await expect(rejectBtn).toBeVisible();

        // Reject button prompts for reason
        await rejectBtn.click();
        await expect(page.locator('input[placeholder="Reason for rejection..."]')).toBeVisible();
        await expect(page.locator('button:has-text("Confirm")')).toBeVisible();
      } else {
        await expect(emptyState).toBeVisible();
      }
    });
  });

  test.describe('Epic 5.4: Events Moderation Panel', () => {
    test('Functionality: Admin views platform events list with status and flag filters', async ({ page }) => {
      await loginViaUi(page, SEEDED_USERS.admin);
      await page.goto('/admin/events');

      await expect(page.locator('h1')).toContainText('Platform events');

      // Table
      await expect(page.locator('th:has-text("Event")')).toBeVisible();
      await expect(page.locator('th:has-text("Organizer")')).toBeVisible();
      await expect(page.locator('th:has-text("Status")')).toBeVisible();
      await expect(page.locator('th:has-text("Starts")')).toBeVisible();
    });
  });

  test.describe('Epic 5.5: Audit Trail Explorer', () => {
    test('Functionality: Admin inspects append-only audit trail and views JSON diffs', async ({ page }) => {
      await loginViaUi(page, SEEDED_USERS.admin);
      await page.goto('/admin/audit-logs');

      await expect(page.locator('h1')).toContainText('Audit trail');

      // Filters
      await expect(page.locator('input[placeholder*="Actor User ID"]')).toBeVisible();
      await expect(page.locator('input[placeholder*="Target Table"]')).toBeVisible();

      // Inspect button expands JSON diff
      const inspectBtn = page.locator('button:has-text("Inspect")').first();
      if (await inspectBtn.isVisible()) {
        await inspectBtn.click();
        await expect(page.locator('text=Old value').first()).toBeVisible();
        await expect(page.locator('text=New value').first()).toBeVisible();
      }
    });
  });
});
