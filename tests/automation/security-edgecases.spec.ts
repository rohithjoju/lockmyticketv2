import { test, expect } from '@playwright/test';
import {
  API_URL,
  SEEDED_USERS,
  createRandomUser,
  getAuthToken,
} from './helpers.ts';

test.describe('Platform Security Boundaries & Edge Cases', () => {
  test.describe('Brute-Force & Account Lockout Protection', () => {
    test('Security: 5 consecutive failed login attempts locks the account with ACCOUNT_LOCKED (429)', async ({ request }) => {
      // Create a fresh user to test lockout without affecting seeded accounts
      const user = await createRandomUser(request);

      // Attempt 5 bad logins
      for (let i = 0; i < 5; i++) {
        const failRes = await request.post(`${API_URL}/auth/login`, {
          data: {
            email: user.email,
            password: 'WrongPassword!',
          },
        });
        expect(failRes.status()).toBe(401);
        const failBody = await failRes.json();
        expect(failBody.error.code).toBe('INVALID_CREDENTIALS');
      }

      // The 6th attempt must be locked out with HTTP 429 ACCOUNT_LOCKED
      const lockedRes = await request.post(`${API_URL}/auth/login`, {
        data: {
          email: user.email,
          password: 'WrongPassword!',
        },
      });

      expect(lockedRes.status()).toBe(429);
      const lockedBody = await lockedRes.json();
      expect(lockedBody.error.code).toBe('ACCOUNT_LOCKED');
      expect(lockedRes.headers()['retry-after']).toBeDefined();
    });
  });

  test.describe('Immediate Session Revocation on Disabled Account (§8)', () => {
    test('Security: Disabled user live token stops working immediately on the next request', async ({ request }) => {
      const admin = await getAuthToken(request, SEEDED_USERS.admin);
      const user = await createRandomUser(request);

      // 1. Verify user's token works currently
      const meResBefore = await request.get(`${API_URL}/auth/me`, {
        headers: { Authorization: `Bearer ${user.accessToken}` },
      });
      expect(meResBefore.ok()).toBeTruthy();

      // 2. Admin disables user
      const disableRes = await request.patch(`${API_URL}/admin/users/${user.id}/status`, {
        headers: { Authorization: `Bearer ${admin.accessToken}` },
        data: { status: 'disabled' },
      });
      expect(disableRes.ok()).toBeTruthy();

      // 3. User makes an API call with their existing token
      // Middleware re-reads status from DB; token must be rejected immediately
      const meResAfter = await request.get(`${API_URL}/auth/me`, {
        headers: { Authorization: `Bearer ${user.accessToken}` },
      });

      expect(meResAfter.status()).toBe(403);
      const body = await meResAfter.json();
      expect(body.error.code).toBe('ACCOUNT_DISABLED');
    });
  });

  test.describe('Registration Privilege Escalation Guard (F15)', () => {
    test('Security: Malicious role injection in registration is ignored and assigns attendee role', async ({ request }) => {
      const email = `hacker_${Date.now()}@example.com`;

      const regRes = await request.post(`${API_URL}/auth/register`, {
        data: {
          name: 'Hacker User',
          email,
          password: 'Password123!',
          role: 'admin', // Malicious attempt to escalate role
        },
      });

      expect(regRes.status()).toBe(201);
      const body = await regRes.json();
      expect(body.data.user.role).toBe('attendee'); // Enforced as attendee
      expect(body.data.user.role).not.toBe('admin');
    });
  });

  test.describe('API Response Envelope Standards (R9)', () => {
    test('Contract: Every API error response adheres strictly to the ApiResponse envelope', async ({ request }) => {
      // Test 401 Unauthenticated
      const res401 = await request.get(`${API_URL}/auth/me`);
      expect(res401.status()).toBe(401);
      const body401 = await res401.json();
      expect(body401.success).toBe(false);
      expect(body401.data).toBeNull();
      expect(body401.meta).toHaveProperty('requestId');
      expect(body401.error).toHaveProperty('code');
      expect(body401.error).toHaveProperty('message');

      // Test 404 Not Found
      const res404 = await request.get(`${API_URL}/events/00000000-0000-0000-0000-000000000000`);
      expect(res404.status()).toBe(404);
      const body404 = await res404.json();
      expect(body404.success).toBe(false);
      expect(body404.data).toBeNull();
      expect(body404.meta).toHaveProperty('requestId');
      expect(body404.error.code).toBe('NOT_FOUND');
    });
  });
});
