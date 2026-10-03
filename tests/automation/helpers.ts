import { APIRequestContext, Page, expect } from '@playwright/test';

export const API_BASE = process.env.API_URL ?? 'http://localhost:3001';
export const API_URL = `${API_BASE}/api/v1`;

// Seeded users from supabase/migrations/0004_seed.sql
export const SEEDED_USERS = {
  admin: {
    id: '11111111-1111-1111-1111-111111111111',
    email: 'admin@example.com',
    password: 'Password123!',
    name: 'Platform Admin',
    role: 'admin' as const,
  },
  opsAdmin: {
    id: '11111111-1111-1111-1111-111111111112',
    email: 'ops.admin@example.com',
    password: 'Password123!',
    name: 'Operations Admin',
    role: 'admin' as const,
  },
  securityAdmin: {
    id: '11111111-1111-1111-1111-111111111113',
    email: 'security.admin@example.com',
    password: 'Password123!',
    name: 'Security Admin',
    role: 'admin' as const,
  },

  // Approved Organizers
  organizer1: {
    id: '22222222-2222-2222-2222-000000000001',
    email: 'org1@example.com',
    password: 'Password123!',
    name: 'Asha Menon',
    role: 'organizer' as const,
  },
  organizer2: {
    id: '22222222-2222-2222-2222-000000000002',
    email: 'org2@example.com',
    password: 'Password123!',
    name: 'Rohan Gupta',
    role: 'organizer' as const,
  },
  organizer4: {
    id: '22222222-2222-2222-2222-000000000004',
    email: 'org4@example.com',
    password: 'Password123!',
    name: 'Vikram Sethi',
    role: 'organizer' as const,
  },
  organizer5: {
    id: '22222222-2222-2222-2222-000000000005',
    email: 'org5@example.com',
    password: 'Password123!',
    name: 'Ananya Rao',
    role: 'organizer' as const,
  },
  organizer6: {
    id: '22222222-2222-2222-2222-000000000006',
    email: 'Karan Patel',
    password: 'Password123!',
    name: 'Karan Patel',
    role: 'organizer' as const,
  },

  // Pending Organizers (Approval queue testing)
  organizerPending: {
    id: '22222222-2222-2222-2222-000000000003',
    email: 'org3@example.com',
    password: 'Password123!',
    name: 'Priya Nair',
    role: 'organizer' as const,
  },
  pendingChennai: {
    id: '22222222-2222-2222-2222-000000000008',
    email: 'pending.chennai@example.com',
    password: 'Password123!',
    name: 'Kavitha Raman',
    role: 'attendee' as const,
  },
  pendingPune: {
    id: '22222222-2222-2222-2222-000000000009',
    email: 'pending.pune@example.com',
    password: 'Password123!',
    name: 'Aditya Joshi',
    role: 'attendee' as const,
  },

  // Rejected Organizers
  rejected1: {
    id: '22222222-2222-2222-2222-000000000011',
    email: 'rejected1@example.com',
    password: 'Password123!',
    name: 'Rajesh Kumar',
    role: 'attendee' as const,
  },

  // Disabled Accounts (Security revocation testing)
  disabledOrg: {
    id: '22222222-2222-2222-2222-000000000013',
    email: 'disabled.org@example.com',
    password: 'Password123!',
    name: 'Dev Sharma (Suspended)',
    role: 'organizer' as const,
  },
  disabledUser: {
    id: '33333333-3333-3333-3333-000000000099',
    email: 'disabled.user@example.com',
    password: 'Password123!',
    name: 'Blocked Attendee',
    role: 'attendee' as const,
  },

  // Locked Out Account (Brute-force testing)
  lockedUser: {
    id: '33333333-3333-3333-3333-000000000098',
    email: 'locked.user@example.com',
    password: 'Password123!',
    name: 'Locked Out User',
    role: 'attendee' as const,
  },

  // Standard Attendees
  attendee1: {
    id: '33333333-3333-3333-3333-000000000001',
    email: 'user1@example.com',
    password: 'Password123!',
    name: 'Attendee One',
    role: 'attendee' as const,
  },
  attendee2: {
    id: '33333333-3333-3333-3333-000000000002',
    email: 'user2@example.com',
    password: 'Password123!',
    name: 'Attendee Two',
    role: 'attendee' as const,
  },
  attendee3: {
    id: '33333333-3333-3333-3333-000000000003',
    email: 'user3@example.com',
    password: 'Password123!',
    name: 'Attendee Three',
    role: 'attendee' as const,
  },
  attendee4: {
    id: '33333333-3333-3333-3333-000000000004',
    email: 'user4@example.com',
    password: 'Password123!',
    name: 'Attendee Four',
    role: 'attendee' as const,
  },
  attendee5: {
    id: '33333333-3333-3333-3333-000000000005',
    email: 'user5@example.com',
    password: 'Password123!',
    name: 'Attendee Five',
    role: 'attendee' as const,
  },
};

// Seeded Events & Tickets
export const SEEDED_EVENTS = {
  // Upcoming Events
  kochiJazz: {
    id: 'bbbbbbbb-bbbb-bbbb-bbbb-000000000001',
    title: 'Kochi Jazz Night',
    city: 'Kochi',
    generalTicketId: 'cccccccc-cccc-cccc-cccc-000000000001',
    vipTicketId: 'cccccccc-cccc-cccc-cccc-000000000002',
    soldOutTierId: 'cccccccc-cccc-cccc-cccc-000000000020', // Available: 0
  },
  mumbaiTech: {
    id: 'bbbbbbbb-bbbb-bbbb-bbbb-000000000002',
    title: 'Mumbai Tech Summit',
    city: 'Mumbai',
    earlyBirdTicketId: 'cccccccc-cccc-cccc-cccc-000000000003',
    standardTicketId: 'cccccccc-cccc-cccc-cccc-000000000004',
    lowStockTierId: 'cccccccc-cccc-cccc-cccc-000000000021', // Available: 2
  },
  delhiSufi: {
    id: 'bbbbbbbb-bbbb-bbbb-bbbb-000000000004',
    title: 'Delhi Sufi & Rock Fusion Live',
    city: 'Delhi',
    balconyTicketId: 'cccccccc-cccc-cccc-cccc-000000000007',
    goldTicketId: 'cccccccc-cccc-cccc-cccc-000000000008',
  },
  bengaluruComedy: {
    id: 'bbbbbbbb-bbbb-bbbb-bbbb-000000000005',
    title: 'Bengaluru Standup Comedy Special: Unfiltered',
    city: 'Bengaluru',
    standardTicketId: 'cccccccc-cccc-cccc-cccc-000000000009',
    couchTicketId: 'cccccccc-cccc-cccc-cccc-000000000010',
  },
  goaElectronic: {
    id: 'bbbbbbbb-bbbb-bbbb-bbbb-000000000006',
    title: 'Goa Sun & Waves Electronic Fest',
    city: 'Goa',
    dayPassTicketId: 'cccccccc-cccc-cccc-cccc-000000000011',
    cabanaTicketId: 'cccccccc-cccc-cccc-cccc-000000000012',
  },
  hyderabadAi: {
    id: 'bbbbbbbb-bbbb-bbbb-bbbb-000000000007',
    title: 'Hyderabad AI & DeepTech Conclave',
    city: 'Hyderabad',
    delegateTicketId: 'cccccccc-cccc-cccc-cccc-000000000013',
  },
  chennaiCarnatic: {
    id: 'bbbbbbbb-bbbb-bbbb-bbbb-000000000008',
    title: 'Chennai Margazhi Symphony: Ragas in Harmony',
    city: 'Chennai',
    seasonTicketId: 'cccccccc-cccc-cccc-cccc-000000000014',
  },
  kolkataTheatre: {
    id: 'bbbbbbbb-bbbb-bbbb-bbbb-000000000009',
    title: 'Kolkata Heritage Theatre Festival',
    city: 'Kolkata',
    hallTicketId: 'cccccccc-cccc-cccc-cccc-000000000015',
  },
  puneFood: {
    id: 'bbbbbbbb-bbbb-bbbb-bbbb-000000000010',
    title: 'Pune Craft Brews & Gourmet Street Feast',
    city: 'Pune',
    tastingTicketId: 'cccccccc-cccc-cccc-cccc-000000000016',
  },

  // Ongoing Events (Computed status = 'ongoing')
  mumbaiHackathonOngoing: {
    id: 'bbbbbbbb-bbbb-bbbb-bbbb-000000000012',
    title: 'Mumbai 24-Hour AI Hackathon',
    city: 'Mumbai',
    freeHackerTicketId: 'cccccccc-cccc-cccc-cccc-000000000017',
  },
  bengaluruFleaOngoing: {
    id: 'bbbbbbbb-bbbb-bbbb-bbbb-000000000013',
    title: 'Bengaluru Weekend Pop-up Artisan Flea',
    city: 'Bengaluru',
    fleaTicketId: 'cccccccc-cccc-cccc-cccc-000000000018',
  },

  // Past Events (Computed status = 'past')
  bengaluruFoodPast: {
    id: 'bbbbbbbb-bbbb-bbbb-bbbb-000000000003',
    title: 'Bengaluru Food Fest',
    city: 'Bengaluru',
    entryTicketId: 'cccccccc-cccc-cccc-cccc-000000000005',
    premiumTicketId: 'cccccccc-cccc-cccc-cccc-000000000006',
  },
  kochiMarathonPast: {
    id: 'bbbbbbbb-bbbb-bbbb-bbbb-000000000014',
    title: 'Kochi Backwaters Half-Marathon',
    city: 'Kochi',
  },

  // Cancelled & Flagged Events
  delhiCancelled: {
    id: 'bbbbbbbb-bbbb-bbbb-bbbb-000000000015',
    title: 'Delhi Monsoon Acoustic Fest',
    city: 'Delhi',
  },
  kochiFlagged: {
    id: 'bbbbbbbb-bbbb-bbbb-bbbb-000000000016',
    title: 'Underground Bass Experience: Volume IV',
    city: 'Kochi',
  },
};

// Seeded Tickets for Immediate Status Tests
export const SEEDED_TICKETS = {
  user1Confirmed1: 'eeeeeeee-eeee-eeee-eeee-000000000001', // Valid, Confirmed
  user1Confirmed2: 'eeeeeeee-eeee-eeee-eeee-000000000002', // Valid, Confirmed
  user2AlreadyScanned: 'eeeeeeee-eeee-eeee-eeee-000000000003', // Status: invalid, verified_at set (tests TICKET_ALREADY_USED)
  user3ConfirmedMumbai: 'eeeeeeee-eeee-eeee-eeee-000000000004', // Valid, Confirmed
  user4Refunded: 'eeeeeeee-eeee-eeee-eeee-000000000005', // Status: invalid, reservation_status: cancelled
  user5ActiveHold: 'eeeeeeee-eeee-eeee-eeee-000000000006', // reservation_status: reserved, expires in 8 min
  user6ExpiredHold: 'eeeeeeee-eeee-eeee-eeee-000000000007', // reservation_status: expired
};

/** Log in a user via the UI form and wait for redirect. */
export async function loginViaUi(page: Page, user: { email: string; password: string }) {
  await page.goto('/auth/login');
  await page.locator('input#email').fill(user.email);
  await page.locator('input#password').fill(user.password);
  await page.locator('button[type="submit"]').click();
  await page.waitForURL((url) => !url.pathname.includes('/auth/login'));
}

/** Obtain an access token directly via API for API-level assertions and setup. */
export async function getAuthToken(
  request: APIRequestContext,
  user: { email: string; password: string },
): Promise<{ accessToken: string; userId: string; role: string }> {
  const res = await request.post(`${API_URL}/auth/login`, {
    data: {
      email: user.email,
      password: user.password,
    },
  });
  expect(res.ok()).toBeTruthy();
  const body = await res.json();
  return {
    accessToken: body.data.accessToken,
    userId: body.data.user.id,
    role: body.data.user.role,
  };
}

/** Register a fresh random attendee user and return credentials and token. */
export async function createRandomUser(request: APIRequestContext) {
  const timestamp = Date.now();
  const email = `testuser_${timestamp}_${Math.random().toString(36).substring(2, 7)}@example.com`;
  const password = 'Password123!';
  const name = `Test User ${timestamp}`;

  const regRes = await request.post(`${API_URL}/auth/register`, {
    data: { email, password, name },
  });
  expect(regRes.ok()).toBeTruthy();
  const regBody = await regRes.json();

  const tokenInfo = await getAuthToken(request, { email, password });
  return {
    id: regBody.data.user.id,
    email,
    password,
    name,
    accessToken: tokenInfo.accessToken,
  };
}
