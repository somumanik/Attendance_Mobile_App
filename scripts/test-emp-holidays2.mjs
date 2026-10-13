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

// Set password for employee 0002
const setPass = await call('/hr/employee/credentials/password', { method: 'POST', token: HR, body: { paycode: '0002', password: 'Test1234', confirmPassword: 'Test1234', mustChange: false } });
console.log('Set password:', setPass.status, setPass.json);

const EMP = (await call('/auth/employee/login', { method: 'POST', body: { paycode: '0002', password: 'Test1234' } })).json?.token;
console.log('Employee login:', EMP ? 'ok' : 'failed');

if (EMP) {
  const holidays = await call('/employee/holidays', { token: EMP, params: { month: '2027-01' } });
  console.log('Employee holidays:', JSON.stringify(holidays.json, null, 2));
  
  const me = await call('/me', { token: EMP });
  console.log('Employee me:', JSON.stringify(me.json, null, 2));
}