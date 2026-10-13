import 'dotenv/config';

const BASE = `http://localhost:${process.env.API_PORT || 4000}/api`;
const out = [];
const log = (ok, label, extra = '') => out.push(`${ok ? 'PASS' : 'FAIL'}  ${label}${extra ? ` :: ${extra}` : ''}`);

async function call(path, { method = 'GET', token, body, params } = {}) {
  const url = new URL(BASE + path);
  if (params) for (const [k, v] of Object.entries(params)) if (v !== undefined && v !== null) url.searchParams.set(k, v);
  const res = await fetch(url, {
    method,
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  let json = null;
  try { json = await res.json(); } catch { /* ignore */ }
  return { status: res.status, json };
}

const HR = (await call('/auth/hr/login', { method: 'POST', body: { username: process.env.HR_USERNAME, password: process.env.HR_PASSWORD } })).json?.token;
console.log('HR token:', HR ? 'ok' : 'none');

// Test with string
const test1 = await call('/hr/holidays', { method: 'POST', token: HR, body: { holidaydate: '2027-09-15', holidayname: 'Test1', category: 'Factory Staff', categoryIds: '[1, 2]', description: 'Test string', companyCodes: '["B36", "TEA-II"]', duration: 'HALF_DAY', halfDaySession: 'SECOND_HALF' } });
console.log('Test 1 (string):', test1.status, test1.json?.message || test1.json?.holiday?.id);

// Test with array
const test2 = await call('/hr/holidays', { method: 'POST', token: HR, body: { holidaydate: '2027-09-16', holidayname: 'Test2', category: 'Factory Staff', categoryIds: [1, 2], description: 'Test array', companyCodes: ['B36', 'TEA-II'], duration: 'HALF_DAY', halfDaySession: 'SECOND_HALF' } });
console.log('Test 2 (array):', test2.status, test2.json?.message || test2.json?.holiday?.id);