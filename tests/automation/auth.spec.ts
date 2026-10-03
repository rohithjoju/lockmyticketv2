import { test, expect } from '@playwright/test';

test.describe('Authentication Flows', () => {
  test.describe('Login Flow', () => {
    test.beforeEach(async ({ page }) => {
      page.on('pageerror', err => console.log('PAGE ERROR:', err.message));
      page.on('console', msg => console.log('BROWSER CONSOLE:', msg.text()));
      await page.goto('/auth/login');
    });

    test('Security: Form does not use GET method to avoid credential leakage', async ({ page }) => {
      const form = page.locator('form');
      await expect(form).toHaveAttribute('method', /post/i);
    });

    test('Security: Password field is securely masked', async ({ page }) => {
      const passwordInput = page.locator('input#password');
      await expect(passwordInput).toHaveAttribute('type', 'password');
    });

    test('Error Handling: Client-side validations for empty fields', async ({ page }) => {
      await page.locator('button[type="submit"]').click();
      
      const emailInput = page.locator('input#email');
      const passwordInput = page.locator('input#password');
      
      await expect(emailInput).toHaveAttribute('aria-invalid', 'true');
      await expect(passwordInput).toHaveAttribute('aria-invalid', 'true');
    });

    test('Error Handling: Invalid credentials show generic error', async ({ page }) => {
      await page.locator('input#email').fill('nonexistent_user@example.com');
      await page.locator('input#password').fill('WrongPassword123!');
      await page.locator('button[type="submit"]').click();

      // Expect a Notice component to show up
      const errorNotice = page.locator('text=Invalid email or password');
      await expect(errorNotice).toBeVisible();
    });

    test('Functionality & Security: Successful login redirects and sets secure cookies', async ({ page, context }) => {
      // Use the seeded admin user
      await page.locator('input#email').fill('admin@example.com');
      await page.locator('input#password').fill('Password123!');
      await page.locator('button[type="submit"]').click();

      // Wait for navigation away from login
      await page.waitForURL((url) => !url.pathname.includes('/auth/login'));

      // Check cookies
      const cookies = await context.cookies();
      const refreshCookie = cookies.find(c => c.name === 'refresh_token');
      
      expect(refreshCookie).toBeDefined();
      expect(refreshCookie?.httpOnly).toBe(true);
      expect(refreshCookie?.sameSite).toBe('Lax');
    });

    test('Functionality: Already authenticated users are redirected away from login', async ({ page }) => {
      // First login
      await page.locator('input#email').fill('user1@example.com');
      await page.locator('input#password').fill('Password123!');
      await page.locator('button[type="submit"]').click();
      await page.waitForURL((url) => !url.pathname.includes('/auth/login'));

      // Try going back to login
      await page.goto('/auth/login');
      await page.waitForURL((url) => !url.pathname.includes('/auth/login'));
    });
  });

  test.describe('Registration Flow', () => {
    test.beforeEach(async ({ page }) => {
      await page.goto('/auth/register');
    });

    test('Security: Form does not use GET method', async ({ page }) => {
      const form = page.locator('form');
      await expect(form).toHaveAttribute('method', /post/i);
    });

    test('Error Handling: Client-side validations', async ({ page }) => {
      await page.locator('button[type="submit"]').click();
      
      await expect(page.locator('input#name')).toHaveAttribute('aria-invalid', 'true');
      await expect(page.locator('input#email')).toHaveAttribute('aria-invalid', 'true');
      await expect(page.locator('input#password')).toHaveAttribute('aria-invalid', 'true');
    });

    test('Error Handling: Existing email gets gracefully rejected', async ({ page }) => {
      // Try to register with the seeded admin email
      await page.locator('input#name').fill('Test Hacker');
      await page.locator('input#email').fill('admin@example.com');
      await page.locator('input#password').fill('Password123!');
      await page.locator('button[type="submit"]').click();

      // Check for conflict error notice (assuming the API returns an appropriate message)
      const errorNotice = page.locator('text=That email is already registered');
      await expect(errorNotice).toBeVisible();
    });

    test('Functionality: Successful registration redirects to settings', async ({ page, context }) => {
      const randomEmail = `newuser_${Date.now()}@example.com`;
      await page.locator('input#name').fill('New User');
      await page.locator('input#email').fill(randomEmail);
      await page.locator('input#password').fill('Password123!');
      await page.locator('button[type="submit"]').click();

      // Wait for navigation to /dashboard
      await page.waitForURL('**/dashboard**');

      // Check cookies are set
      const cookies = await context.cookies();
      const refreshCookie = cookies.find(c => c.name === 'refresh_token');
      expect(refreshCookie).toBeDefined();
    });
  });

  test.describe('Forgot Password Flow', () => {
    test.beforeEach(async ({ page }) => {
      await page.goto('/auth/forgot-password');
    });

    test('Security: Form does not use GET method', async ({ page }) => {
      const form = page.locator('form');
      await expect(form).toHaveAttribute('method', /post/i);
    });

    test('Security: Prevents account enumeration by always showing success', async ({ page }) => {
      // Provide a random non-existent email
      const randomEmail = `random_${Date.now()}@example.com`;
      await page.locator('input#email').fill(randomEmail);
      await page.locator('button[type="submit"]').click();

      // The UI should show the success check your inbox state regardless of if the email exists
      const successHeading = page.locator('text=Check your inbox');
      await expect(successHeading).toBeVisible();
      
      const successText = page.locator('text=If that email has an account, a reset link is on its way');
      await expect(successText).toBeVisible();
    });
  });
});
