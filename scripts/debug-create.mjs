import 'dotenv/config';

const BASE = `http://localhost:${process.env.API_PORT || 4000}/api`;

async function call(path, { method = 'POST', token, body } = {}) {
  const url = new URL(BASE + path);
  const res = await fetch(url, {
    method,
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: JSON.stringify(body),
  });
  const text = await res.text();
  console.log('Status:', res.status);
  console.log('Response:', text);
  let json = null; try { json = JSON.parse(text); } catch { /* ignore */ }
  return { status: res.status, json };
}

const HR = (await call('/auth/hr/login', { method: 'POST', body: { username: process.env.HR_USERNAME, password: process.env.HR_PASSWORD } })).json?.token;
console.log('HR token:', HR ? 'ok' : 'none');

const created = await call('/hr/holidays', { method: 'POST', token: HR, body: { holidaydate: '2027-09-15', holidayname: 'Test Holiday', category: 'Factory Staff', categoryIds: [1, 2], description: 'Test with multi-select', companyCodes: ['B36', 'TEA-II'], duration: 'HALF_DAY', halfDaySession: 'SECOND_HALF' } });
console.log('CREATE STATUS:', created.status);
console.log('CREATE RESPONSE:', JSON.stringify(created.json, null, 2));