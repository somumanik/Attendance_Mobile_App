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

// Get employee 0002 info
const emp = (await call('/hr/employee/0002', { token: HR })).json;
console.log('Employee 0002:', JSON.stringify(emp, null, 2));

// Get credentials for 0002
const creds = await call('/hr/employee/credentials', { token: HR, params: { paycode: '0002' } });
console.log('Creds:', JSON.stringify(creds.json, null, 2));

// Try login with employee 0002
const EMP = (await call('/auth/employee/login', { method: 'POST', body: { paycode: '0002', password: '123456' } })).json?.token;
console.log('Employee login:', EMP ? 'ok' : 'failed', EMP ? '' : JSON.stringify((await call('/auth/employee/login', { method: 'POST', body: { paycode: '0002', password: '123456' } })).json));

if (EMP) {
  const holidays = await call('/employee/holidays', { token: EMP, params: { month: '2027-01' } });
  console.log('Employee holidays:', JSON.stringify(holidays.json, null, 2));
  
  const me = await call('/me', { token: EMP });
  console.log('Employee me:', JSON.stringify(me.json, null, 2));
}