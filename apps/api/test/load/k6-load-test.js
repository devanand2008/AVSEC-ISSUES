/* global __ENV, __VU */
import http from 'k6/http';
import { check, sleep } from 'k6';
import { Rate, Trend } from 'k6/metrics';

export const errorRate = new Rate('errors');
export const loginDuration = new Trend('login_duration');
export const apiRequestDuration = new Trend('api_request_duration');

export const options = {
  stages: [
    { duration: '30s', target: 20 },  // Ramp up to 20 concurrent users
    { duration: '1m', target: 50 },   // Peak concurrent usage at 50 users
    { duration: '30s', target: 0 },   // Ramp down to 0
  ],
  thresholds: {
    errors: ['rate<0.05'],            // Error rate must be under 5%
    http_req_duration: ['p(95)<500'], // 95% of requests must complete under 500ms
  },
};

const BASE_URL = __ENV.API_URL || 'http://localhost:4000';

export default function () {
  const loginPayload = JSON.stringify({
    collegeIdentityId: `TEST_USER_${__VU}`,
    password: 'SecurePassword123!',
  });

  const params = {
    headers: {
      'Content-Type': 'application/json',
    },
  };

  // 1. Authenticate user
  const startTime = new Date().getTime();
  const loginRes = http.post(`${BASE_URL}/auth/login`, loginPayload, params);
  loginDuration.add(new Date().getTime() - startTime);

  const loginSuccess = check(loginRes, {
    'login status is 200 or 401': (r) => r.status === 200 || r.status === 401,
  });

  if (!loginSuccess || loginRes.status !== 200) {
    errorRate.add(1);
    sleep(1);
    return;
  }

  const authHeaders = {
    headers: {
      'Content-Type': 'application/json',
      Cookie: loginRes.headers['Set-Cookie'] || '',
    },
  };

  // 2. Fetch user profile / active sessions
  const reqStart = new Date().getTime();
  const meRes = http.get(`${BASE_URL}/auth/me`, authHeaders);
  apiRequestDuration.add(new Date().getTime() - reqStart);
  check(meRes, { 'me status is 200': (r) => r.status === 200 });

  // 3. Fetch conversations
  const convRes = http.get(`${BASE_URL}/conversations`, authHeaders);
  check(convRes, { 'conversations status is 200': (r) => r.status === 200 });

  // 4. Fetch broadcasts
  const broadcastRes = http.get(`${BASE_URL}/broadcasts?page=1&pageSize=10`, authHeaders);
  check(broadcastRes, { 'broadcasts status is 200 or 403': (r) => r.status === 200 || r.status === 403 });

  sleep(Math.random() * 2 + 1);
}
