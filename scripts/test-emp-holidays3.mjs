import 'dotenv/config';

const BASE = `http://localhost:${process.env.API_PORT || 4000}/api`;

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
console.log('HR token:', HR ? 'ok' : 'failed');

// Test with employee 0002 in a month that has holidays
const EMP = (await call('/auth/employee/login', { method: 'POST', body: { paycode: '0002', password: 'Test1234' } })).json?.token;
console.log('Employee login:', EMP ? 'ok' : 'failed');

if (EMP) {
  // Test with September 2026 which has holidays
  const holidays = await call('/employee/holidays', { token: EMP, params: { month: '2026-09' } });
  console.log('Employee holidays (Sep 2026):', JSON.stringify(holidays.json, null, 2));
  
  // Also test with month parameter that matches the holiday
  const holidays2 = await call('/employee/holidays', { token: EMP, params: { month: '2026-10' } });
  console.log('Employee holidays (Oct 2026):', JSON.stringify(holidays2.json, null, 2));
  
  // Also test with fromDate/toDate
  const holidays3 = await call('/employee/holidays', { token: EMP, params: { fromDate: '2026-09-01', toDate: '2026-09-30' } });
  console.log('Employee holidays (Sep 2026 range):', JSON.stringify(holidays3.json, null, 2));
}