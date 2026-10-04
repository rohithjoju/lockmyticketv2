import { test, expect } from '@playwright/test';
import {
  API_URL,
  SEEDED_EVENTS,
  SEEDED_USERS,
  createRandomUser,
  getAuthToken,
  loginViaUi,
} from './helpers.ts';

test.describe('Admin Governance & Operations', () => {
  test.describe('Admin Navigation & Access Control', () => {
    test('Functionality: Admin user sees "Admin" in navigation bar and visits admin panel', async ({ page }) => {
      await loginViaUi(page, SEEDED_USERS.admin);
      await expect(page.locator('a:has-text("Admin")').first()).toBeVisible();

      await page.goto('/admin');
      await expect(page.locator('h1')).toContainText('Admin panels arrive next');
    });

    test('Security: Non-admin users cannot see "Admin" in navigation', async ({ page }) => {
      await loginViaUi(page, SEEDED_USERS.attendee1);
      await expect(page.locator('a:has-text("Admin")')).not.toBeVisible();
    });

    test('Security: Non-admin calling /api/v1/admin/* is rejected with FORBIDDEN', async ({ request }) => {
      const attendee = await getAuthToken(request, SEEDED_USERS.attendee1);

      const res = await request.get(`${API_URL}/admin/users`, {
        headers: { Authorization: `Bearer ${attendee.accessToken}` },
      });

      expect(res.status()).toBe(403);
      const body = await res.json();
      expect(body.error.code).toBe('FORBIDDEN');
    });
  });

  test.describe('User Management & Account Suspension', () => {
    test('Functionality: Admin can list, search, and filter platform users', async ({ request }) => {
      const admin = await getAuthToken(request, SEEDED_USERS.admin);

      const res = await request.get(`${API_URL}/admin/users?role=organizer&limit=10`, {
        headers: { Authorization: `Bearer ${admin.accessToken}` },
      });

      expect(res.ok()).toBeTruthy();
      const body = await res.json();
      expect(body.success).toBe(true);
      expect(Array.isArray(body.data)).toBe(true);

      for (const user of body.data) {
        expect(user.role).toBe('organizer');
      }
    });

    test('Functionality: Admin can disable and re-enable a user account', async ({ request }) => {
      const admin = await getAuthToken(request, SEEDED_USERS.admin);
      const user = await createRandomUser(request);

      // Disable user
      const disableRes = await request.patch(`${API_URL}/admin/users/${user.id}/status`, {
        headers: { Authorization: `Bearer ${admin.accessToken}` },
        data: { status: 'disabled' },
      });
      expect(disableRes.ok()).toBeTruthy();
      const disableBody = await disableRes.json();
      expect(disableBody.data.status).toBe('disabled');

      // Re-enable user
      const enableRes = await request.patch(`${API_URL}/admin/users/${user.id}/status`, {
        headers: { Authorization: `Bearer ${admin.accessToken}` },
        data: { status: 'active' },
      });
      expect(enableRes.ok()).toBeTruthy();
      const enableBody = await enableRes.json();
      expect(enableBody.data.status).toBe('active');
    });

    test('Security & Edge Case: Admin cannot disable their own account', async ({ request }) => {
      const admin = await getAuthToken(request, SEEDED_USERS.admin);

      const selfDisableRes = await request.patch(`${API_URL}/admin/users/${SEEDED_USERS.admin.id}/status`, {
        headers: { Authorization: `Bearer ${admin.accessToken}` },
        data: { status: 'disabled' },
      });

      expect(selfDisableRes.status()).toBe(403);
      const body = await selfDisableRes.json();
      expect(body.error.code).toBe('FORBIDDEN');
      expect(body.error.message).toContain('You cannot change your own account status');
    });
  });

  test.describe('Organizer Verification Queue & Optimistic Locking', () => {
    test('Functionality: Admin lists pending organizer applications', async ({ request }) => {
      const admin = await getAuthToken(request, SEEDED_USERS.admin);

      const res = await request.get(`${API_URL}/admin/organizers/pending`, {
        headers: { Authorization: `Bearer ${admin.accessToken}` },
      });

      expect(res.ok()).toBeTruthy();
      const body = await res.json();
      expect(body.success).toBe(true);
      expect(Array.isArray(body.data)).toBe(true);
    });

    test('Error Handling: Rejecting organizer without a reason is rejected with VALIDATION_FAILED', async ({ request }) => {
      const admin = await getAuthToken(request, SEEDED_USERS.admin);

      const res = await request.post(`${API_URL}/admin/organizers/aaaaaaaa-aaaa-aaaa-aaaa-000000000003/reject`, {
        headers: { Authorization: `Bearer ${admin.accessToken}` },
        data: {
          version: 1,
          reason: '   ', // empty reason
        },
      });

      expect(res.status()).toBe(400);
      const body = await res.json();
      expect(body.error.code).toBe('VALIDATION_FAILED');
      expect(body.error.field).toBe('reason');
    });

    test('Security & Concurrency (F9): Approving organizer with outdated version triggers VERSION_CONFLICT', async ({ request }) => {
      const admin = await getAuthToken(request, SEEDED_USERS.admin);

      // Pass an intentionally stale version (e.g. 99999)
      const res = await request.post(`${API_URL}/admin/organizers/aaaaaaaa-aaaa-aaaa-aaaa-000000000003/approve`, {
        headers: { Authorization: `Bearer ${admin.accessToken}` },
        data: {
          version: 99999,
        },
      });

      expect(res.status()).toBe(409);
      const body = await res.json();
      expect(body.error.code).toBe('VERSION_CONFLICT');
    });
  });

  test.describe('Platform Audit Logs & Global Dashboard', () => {
    test('Functionality: Admin views platform analytics dashboard with health and revenue metrics', async ({ request }) => {
      const admin = await getAuthToken(request, SEEDED_USERS.admin);

      const res = await request.get(`${API_URL}/admin/dashboard`, {
        headers: { Authorization: `Bearer ${admin.accessToken}` },
      });

      expect(res.ok()).toBeTruthy();
      const body = await res.json();
      expect(body.success).toBe(true);

      // Verify dashboard shape (§6.3, §9)
      expect(body.data.users).toBeDefined();
      expect(body.data.organizers).toBeDefined();
      expect(body.data.events).toBeDefined();
      expect(body.data.tickets).toBeDefined();
      expect(body.data.revenue).toBeDefined();
      expect(body.data.payments).toBeDefined();
      expect(typeof body.data.payments.successRate).toBe('number');
    });

    test('Functionality (R10): Admin mutations write to audit_logs', async ({ request }) => {
      const admin = await getAuthToken(request, SEEDED_USERS.admin);
      const user = await createRandomUser(request);

      // Perform a mutation (disable user)
      await request.patch(`${API_URL}/admin/users/${user.id}/status`, {
        headers: { Authorization: `Bearer ${admin.accessToken}` },
        data: { status: 'disabled' },
      });

      // Verify audit logs record the event
      const auditRes = await request.get(`${API_URL}/admin/audit-logs?targetId=${user.id}`, {
        headers: { Authorization: `Bearer ${admin.accessToken}` },
      });

      expect(auditRes.ok()).toBeTruthy();
      const auditBody = await auditRes.json();
      expect(auditBody.success).toBe(true);
      expect(auditBody.data.length).toBeGreaterThan(0);

      const record = auditBody.data[0];
      expect(record.actionType).toBe('user.disabled');
      expect(record.targetTable).toBe('users');
      expect(record.targetId).toBe(user.id);
      expect(record.actorUserId).toBe(SEEDED_USERS.admin.id);
      expect(record.newValue.status).toBe('disabled');
    });

    test('Security: Non-admin users cannot access audit logs', async ({ request }) => {
      const attendee = await getAuthToken(request, SEEDED_USERS.attendee1);

      const res = await request.get(`${API_URL}/admin/audit-logs`, {
        headers: { Authorization: `Bearer ${attendee.accessToken}` },
      });

      expect(res.status()).toBe(403);
    });
  });
});
