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
  const text = await res.text();
  console.log('Status:', res.status);
  console.log('URL:', url.toString());
  console.log('Response:', text);
  let json = null;
  try { json = JSON.parse(text); } catch { /* ignore */ }
  return { status: res.status, json };
}

const loginRes = await call('/auth/employee/login', { method: 'POST', body: { paycode: '0002', password: 'Test1234' } });
console.log('Login status:', loginRes.status);
console.log('Login response:', loginRes.json);
const EMP = loginRes.json?.token;
console.log('Employee login:', EMP ? 'ok' : 'failed');

if (EMP) {
  const holidays = await call('/employee/holidays', { token: EMP, params: { month: '2026-10' } });
  console.log('Holidays status:', holidays.status);
  console.log('Holidays response:', JSON.stringify(holidays.json, null, 2));
}