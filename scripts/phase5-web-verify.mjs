// PHASE 5 — HR Admin portal verification (READ-ONLY, real backend via Next.js on :3000).
// HR login real bootstrap account se; employee token (S00069) se role-separation test.
import 'dotenv/config';
import jwt from 'jsonwebtoken';

const BASE = 'http://localhost:3000';
const out = [];
const results = [];
const log = (s = '') => out.push(String(s));
const check = (n, c, d = '') => { const pass = !!c; results.push({ n, pass, d: String(d ?? '') }); log(`${pass ? 'PASS' : 'FAIL'} :: ${n} :: ${d ?? ''}`); };
const cookieOf = (sc, name = 'auth_token') => { for (const c of sc) if (c.startsWith(name + '=')) return c.split(';')[0]; return null; };

async function req(path, { method = 'GET', body, cookie } = {}) {
  const headers = { 'Content-Type': 'application/json' };
  if (cookie) headers.Cookie = cookie;
  const res = await fetch(BASE + path, { method, headers, body: body != null ? JSON.stringify(body) : undefined, redirect: 'manual' });
  let data = null; try { data = await res.json(); } catch { data = null; }
  return { status: res.status, data, location: res.headers.get('location'), setCookies: res.headers.getSetCookie ? res.headers.getSetCookie() : [] };
}

try {
  log('=== PHASE 5 HR ADMIN PORTAL VERIFICATION ===');

  // HR login (real bootstrap account)
  const login = await req('/api/auth/hr', { method: 'POST', body: { username: process.env.HR_USERNAME, password: process.env.HR_PASSWORD } });
  const hrCookie = cookieOf(login.setCookies);
  check('HR login VALID -> cookie', login.status === 200 && !!hrCookie, `status=${login.status}`);
  check('HR login INVALID -> 401', (await req('/api/auth/hr', { method: 'POST', body: { username: process.env.HR_USERNAME, password: 'wrong' } })).status === 401);

  // HR pages render
  const overviewHtml = await (await fetch(BASE + '/hr', { headers: { Cookie: hrCookie }, redirect: 'manual' })).text();
  check('GET /hr renders (HR overview)', overviewHtml.includes('Total Staff') || overviewHtml.includes('HR Admin'), '');

  // Real HR endpoints
  const dash = await req('/api/hr/dashboard', { cookie: hrCookie });
  check('/api/hr/dashboard real summary', dash.status === 200 && typeof dash.data?.totalstaff === 'number', `totalstaff=${dash.data?.totalstaff} punched=${dash.data?.punchedtoday}`);

  const roster = await req('/api/employees?page=1&pageSize=5&active=Y', { cookie: hrCookie });
  check('/api/employees real roster', roster.status === 200 && Array.isArray(roster.data?.rows), `rows=${roster.data?.rows?.length} total=${roster.data?.total}`);

  const month = new Date().toISOString().slice(0, 7);
  const audit = await req(`/api/hr/audit/S00069?month=${month}`, { cookie: hrCookie });
  check('/api/hr/audit/S00069 real data', audit.status === 200 && typeof audit.data?.stats?.present === 'number', `present=${audit.data?.stats?.present}`);

  const an = await req('/api/hr/category-analytics?mode=daily', { cookie: hrCookie });
  check('/api/hr/category-analytics real data', an.status === 200 && Array.isArray(an.data?.companies), `punched=${an.data?.punched}`);

  const cele = await req('/api/hr/celebrations', { cookie: hrCookie });
  check('/api/hr/celebrations returns groups', cele.status === 200 && cele.data?.employees && cele.data?.marriages, `status=${cele.status}`);

  const mar = await req('/api/marriage-anniversary', { cookie: hrCookie });
  check('/api/marriage-anniversary returns list', mar.status === 200 && Array.isArray(mar.data), `status=${mar.status}`);

  const hol = await req('/api/hr/holidays', { cookie: hrCookie });
  check('/api/hr/holidays returns list', hol.status === 200 && Array.isArray(hol.data?.holidays), `count=${hol.data?.holidays?.length}`);

  const lbal = await req('/api/hr/leave/balances', { cookie: hrCookie });
  check('/api/hr/leave/balances responds', lbal.status === 200, `status=${lbal.status}`);

  const sal = await req('/api/hr/salary/master', { cookie: hrCookie });
  check('/api/hr/salary/master responds (real or empty)', sal.status === 200 && Array.isArray(sal.data?.rows), `rows=${sal.data?.rows?.length}`);

  const email = await req('/api/email/config', { cookie: hrCookie });
  check('/api/email/config responds (no secret in UI)', email.status === 200 && email.data?.config, `status=${email.status}`);

  // Employee cannot access HR
  const empToken = jwt.sign({ sub: 'S00069', role: 'EMPLOYEE', paycode: 'S00069' }, process.env.JWT_SECRET, { expiresIn: '8h' });
  const empHr = await req('/hr', { cookie: `auth_token=${empToken}` });
  check('EMPLOYEE cannot access /hr (redirect)', [302, 303, 307, 308].includes(empHr.status) && (empHr.location || '').includes('/employee'), `status=${empHr.status} loc=${empHr.location}`);

  const empRoster = await req('/api/employees?page=1', { cookie: `auth_token=${empToken}` });
  check('EMPLOYEE cannot access HR /api/employees (403)', empRoster.status === 403, `status=${empRoster.status}`);

  // No auth -> redirect
  check('GET /hr (no auth) -> /login', [302, 303, 307, 308].includes((await req('/hr')).status));
} catch (e) {
  log('ERROR: ' + (e && e.message));
}

const pass = results.filter((r) => r.pass).length;
log('');
log(`=== SUMMARY: ${pass} PASS / ${results.length - pass} FAIL (of ${results.length}) ===`);
for (const r of results) log(`${r.pass ? 'PASS' : 'FAIL'} | ${r.n} | ${r.d}`);
console.log(out.join('\n'));
