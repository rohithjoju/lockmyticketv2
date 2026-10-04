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

test.describe('Epic 1 & 2: Interactive Booking, Reservation & Digital Ticket Wallet', () => {
  test.describe('Epic 1.4: Booking CTA & Interactive Reservation UI', () => {
    test('Functionality: Unauthenticated user sees "Sign in to book" with proper next query param', async ({ page }) => {
      await page.goto(`/events/${SEEDED_EVENTS.kochiJazz.id}`);

      const signinBtn = page.locator('a:has-text("Sign in to book")');
      await expect(signinBtn).toBeVisible();
      await expect(signinBtn).toHaveAttribute(
        'href',
        new RegExp(`/auth/login\\?next=.*${SEEDED_EVENTS.kochiJazz.id}`),
      );
    });

    test('Functionality: Authenticated user sees ticket type selector, quantity picker, and live price calculation', async ({ page }) => {
      await loginViaUi(page, SEEDED_USERS.attendee1);
      await page.goto(`/events/${SEEDED_EVENTS.kochiJazz.id}`);

      // Verify ticket type selector exists
      const typeSelect = page.locator('select#ticket-type-select');
      await expect(typeSelect).toBeVisible();

      // Quantity controls
      const decBtn = page.locator('button[aria-label="Decrease quantity"]');
      const incBtn = page.locator('button[aria-label="Increase quantity"]');
      await expect(decBtn).toBeDisabled(); // starts at 1
      await expect(incBtn).toBeEnabled();

      // Price calculation starts at 1x
      await expect(page.locator('text=Total')).toBeVisible();

      // Increase quantity to 2
      await incBtn.click();
      await expect(decBtn).toBeEnabled();

      // "Reserve tickets" button is enabled
      const reserveBtn = page.locator('button:has-text("Reserve tickets")');
      await expect(reserveBtn).toBeEnabled();
    });

    test('Functionality: Reserving tickets triggers reservation timer and transitions to payment state', async ({ page }) => {
      await loginViaUi(page, SEEDED_USERS.attendee1);
      await page.goto(`/events/${SEEDED_EVENTS.mumbaiTech.id}`);

      const reserveBtn = page.locator('button:has-text("Reserve tickets")');
      await expect(reserveBtn).toBeVisible();
      await reserveBtn.click();

      // Should transition to reserved state displaying timer
      const timerBanner = page.locator('text=Hold expires in');
      await expect(timerBanner).toBeVisible({ timeout: 10000 });

      // Displays Pay CTA button with price
      await expect(page.locator('button:has-text("Pay")')).toBeVisible();
    });
  });

  test.describe('Epic 2.1: Digital Ticket Wallet & QR Modal', () => {
    test('Functionality: Clicking "Show QR" opens QR modal with live pulse clock and admission badge', async ({ page }) => {
      await loginViaUi(page, SEEDED_USERS.attendee1);
      await page.goto('/dashboard');

      const showQrBtn = page.locator('button:has-text("Show QR")').first();
      await expect(showQrBtn).toBeVisible();
      await showQrBtn.click();

      // Dialog opens
      const dialog = page.locator('div[role="dialog"][aria-label="Your ticket QR code"]');
      await expect(dialog).toBeVisible();

      // Ready badge displayed
      await expect(dialog.locator('text=Ready').first()).toBeVisible();

      // SVG QR code is rendered
      await expect(dialog.locator('svg')).toBeVisible();

      // Anti-screenshot live UTC clock is visible
      await expect(dialog.locator('text=UTC').or(dialog.locator('p[aria-hidden="true"]'))).toBeVisible();

      // Closing modal
      await dialog.locator('button:has-text("Close")').click();
      await expect(dialog).not.toBeVisible();
    });
  });

  test.describe('Epic 2.2: Ticket Refund Request UI & Boundaries', () => {
    test('Functionality: Request refund button opens modal with calculated refund policy estimate', async ({ page }) => {
      await loginViaUi(page, SEEDED_USERS.attendee1);
      await page.goto('/dashboard');

      const refundBtn = page.locator('button:has-text("Request refund")').first();
      await expect(refundBtn).toBeVisible();
      await refundBtn.click();

      const modal = page.locator('div[role="dialog"][aria-label="Request a refund"]');
      await expect(modal).toBeVisible();

      // Shows Expected refund block
      await expect(modal.locator('text=Expected refund')).toBeVisible();

      // Two-step confirmation flow: First button says "Request refund", clicking turns to "Confirm refund"
      const actionBtn = modal.locator('button:has-text("Request refund")');
      await expect(actionBtn).toBeVisible();
      await actionBtn.click();

      await expect(modal.locator('button:has-text("Confirm refund")')).toBeVisible();

      // Cancel button closes dialog
      await modal.locator('button:has-text("Cancel")').click();
      await expect(modal).not.toBeVisible();
    });
  });
});
