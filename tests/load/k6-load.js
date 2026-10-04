import http from 'k6/http';
import { check, sleep } from 'k6';

export const options = {
  stages: [
    { duration: '30s', target: 50 }, // Ramp up to 50 concurrent users
    { duration: '1m', target: 50 },  // Hold at 50 for 1 minute
    { duration: '30s', target: 0 },  // Ramp down to 0
  ],
  thresholds: {
    http_req_failed: ['rate<0.01'], // less than 1% errors
    http_req_duration: ['p(95)<500'], // 95% of requests under 500ms
  },
};

// Assuming an environment variable TARGET_EVENT_ID and TARGET_TICKET_TYPE_ID is passed
const BASE_URL = __ENV.BASE_URL || 'http://localhost:3000/api/v1';
const EVENT_ID = __ENV.EVENT_ID || '11111111-1111-1111-1111-111111111111';
const TICKET_TYPE_ID = __ENV.TICKET_TYPE_ID || '22222222-2222-2222-2222-222222222222';
const TOKEN = __ENV.AUTH_TOKEN || 'test-token'; // Setup a test token

export default function () {
  const url = `${BASE_URL}/events/${EVENT_ID}/reserve`;
  const payload = JSON.stringify({
    tickets: [{ ticketTypeId: TICKET_TYPE_ID, quantity: 2 }]
  });

  const params = {
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${TOKEN}`,
    },
  };

  const res = http.post(url, payload, params);
  
  check(res, {
    'is status 201': (r) => r.status === 201,
    'inventory locked correctly': (r) => r.status === 201 && JSON.parse(r.body).data.ticketIds.length === 2,
    'failed gracefully on sold out': (r) => r.status === 409 || r.status === 400 // SOLD_OUT ErrorCode
  });

  sleep(1);
}
