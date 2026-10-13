// Quick test of holiday CRUD with new fields
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
log(!!HR, 'HR login');

const created = await call('/hr/holidays', { method: 'POST', token: HR, body: { holidaydate: '2027-09-15', holidayname: 'Test Holiday', category: 'Factory Staff', categoryIds: [1, 2], description: 'Test with multi-select', companyCodes: ['B36', 'TEA-II'], duration: 'HALF_DAY', halfDaySession: 'SECOND_HALF' } });
log(created.status === 201, 'POST /hr/holidays with new fields', `status=${created.status} id=${created.json?.holiday?.id} duration=${created.json?.holiday?.duration} halfDay=${created.json?.holiday?.halfDaySession} companies=${created.json?.holiday?.companyCodes} cats=${created.json?.holiday?.categoryIds}`);

const listed = await call('/hr/holidays', { token: HR });
log(listed.status === 200 && Array.isArray(listed.json?.holidays), 'GET /hr/holidays', `count=${listed.json?.holidays?.length}`);

const found = listed.json?.holidays?.find(h => h.id === created.json?.holiday?.id);
if (found) {
  log(found.duration === 'HALF_DAY', 'Duration saved correctly', `duration=${found.duration}`);
  log(found.halfDaySession === 'SECOND_HALF', 'Half day session saved', `halfDaySession=${found.halfDaySession}`);
  const companies = Array.isArray(found.companyCodes) ? found.companyCodes : (typeof found.companyCodes === 'string' ? JSON.parse(found.companyCodes) : []);
  const cats = Array.isArray(found.categoryIds) ? found.categoryIds : (typeof found.categoryIds === 'string' ? JSON.parse(found.categoryIds) : []);
  log(JSON.stringify(companies.sort()) === JSON.stringify(['B36', 'TEA-II'].sort()), 'Company codes saved', `companies=${JSON.stringify(companies)}`);
  log(cats.includes(1) && cats.includes(2), 'Category IDs saved', `cats=${JSON.stringify(cats)}`);
  
  const updated = await call(`/hr/holidays/${found.id}`, { method: 'PUT', token: HR, body: { duration: 'FULL_DAY', active: false } });
  log(updated.status === 200 && updated.json?.holiday?.duration === 'FULL_DAY' && updated.json?.holiday?.active === false, 'PUT update works', `duration=${updated.json?.holiday?.duration} active=${updated.json?.holiday?.active}`);
  
  const deleted = await call(`/hr/holidays/${found.id}`, { method: 'DELETE', token: HR });
  log(deleted.status === 200, 'DELETE works', `status=${deleted.status}`);
}

console.log(out.join('\n'));