// PHASE 2 — website login verification (READ-ONLY against running backend via Next.js).
// Next.js server (localhost:3000) ke against HTTP calls. HR/dev credentials sirf env se.
import 'dotenv/config';
import fs from 'node:fs';

const BASE = 'http://localhost:3000';
const out = [];
const results = [];
const log = (s = '') => out.push(String(s));
const check = (name, cond, detail = '') => {
  const pass = cond === null ? null : !!cond;
  results.push({ name, pass, detail: String(detail ?? '') });
  log(`${pass === true ? 'PASS' : pass === false ? 'FAIL' : 'SKIP'} :: ${name} :: ${detail ?? ''}`);
};

const cookieValue = (setCookies, name = 'auth_token') => {
  for (const c of setCookies) if (c.startsWith(name + '=')) return c.split(';')[0];
  return null;
};

async function req(path, { method = 'GET', body, cookie } = {}) {
  const headers = { 'Content-Type': 'application/json' };
  if (cookie) headers.Cookie = cookie;
  const res = await fetch(BASE + path, { method, headers, body: body != null ? JSON.stringify(body) : undefined, redirect: 'manual' });
  let data = null; try { data = await res.json(); } catch { data = null; }
  return { status: res.status, data, location: res.headers.get('location'), setCookies: res.headers.getSetCookie ? res.headers.getSetCookie() : [] };
}
const isRedirect = (s) => [301, 302, 303, 307, 308].includes(s);

try {
  log('=== PHASE 2 WEBSITE LOGIN VERIFICATION ===');
  log('base=' + BASE);

  const root = await req('/');
  check('GET / redirects to /login', isRedirect(root.status) && (root.location || '').includes('/login'), `status=${root.status} loc=${root.location}`);
  check('GET /login 200', (await req('/login')).status === 200);
  check('GET /login/hr 200', (await req('/login/hr')).status === 200);
  check('GET /login/employee 200', (await req('/login/employee')).status === 200);
  check('GET /health 200', (await req('/health')).status === 200);

  const empNoAuth = await req('/employee');
  check('GET /employee (no auth) → /login', isRedirect(empNoAuth.status) && (empNoAuth.location || '').includes('/login'), `status=${empNoAuth.status}`);
  const hrNoAuth = await req('/hr');
  check('GET /hr (no auth) → /login', isRedirect(hrNoAuth.status) && (hrNoAuth.location || '').includes('/login'), `status=${hrNoAuth.status}`);

  // --- HR login ---
  const hrUser = process.env.HR_USERNAME;
  const hrPass = process.env.HR_PASSWORD;
  const hrLogin = await req('/api/auth/hr', { method: 'POST', body: { username: hrUser, password: hrPass } });
  const hrCookie = cookieValue(hrLogin.setCookies);
  const hrNoToken = !(hrLogin.data && typeof hrLogin.data.token === 'string');
  check('HR login VALID → 200 + cookie + NO token in body', hrLogin.status === 200 && hrLogin.data?.success === true && !!hrCookie && hrNoToken, `status=${hrLogin.status} role=${hrLogin.data?.role} cookie=${!!hrCookie}`);

  const hrBad = await req('/api/auth/hr', { method: 'POST', body: { username: hrUser, password: 'wrong-password-123' } });
  check('HR login INVALID → 401', hrBad.status === 401 && hrBad.data?.success === false, `status=${hrBad.status}`);

  if (hrCookie) {
    check('GET /hr (HR session) 200', (await req('/hr', { cookie: hrCookie })).status === 200);
    const empWithHr = await req('/employee', { cookie: hrCookie });
    check('HR cannot access /employee → /hr', isRedirect(empWithHr.status) && (empWithHr.location || '').includes('/hr'), `status=${empWithHr.status} loc=${empWithHr.location}`);
  } else {
    check('HR session tests', false, 'no HR cookie');
  }


  // --- Employee login (dev account) ---
  const devPaycode = process.env.DEV_EMPLOYEE_PAYCODE;
  const devPass = process.env.DEV_EMPLOYEE_PASSWORD;
  if (String(process.env.DEV_EMPLOYEE_AUTH_ENABLED).toLowerCase() === 'true' && devPaycode) {
    const empLogin = await req('/api/auth/employee', { method: 'POST', body: { paycode: devPaycode, password: devPass } });
    const empCookie = cookieValue(empLogin.setCookies);
    const empNoToken = !(empLogin.data && typeof empLogin.data.token === 'string');
    check('Employee login VALID → 200 + cookie + NO token in body', empLogin.status === 200 && empLogin.data?.success === true && !!empCookie && empNoToken, `status=${empLogin.status} role=${empLogin.data?.role} cookie=${!!empCookie}`);

    const empBad = await req('/api/auth/employee', { method: 'POST', body: { paycode: devPaycode, password: 'wrong-password' } });
    check('Employee login INVALID → 401', empBad.status === 401 && empBad.data?.success === false, `status=${empBad.status}`);

    if (empCookie) {
      check('GET /employee (employee session) 200', (await req('/employee', { cookie: empCookie })).status === 200);
      const hrWithEmp = await req('/hr', { cookie: empCookie });
      check('Employee cannot access /hr → /employee', isRedirect(hrWithEmp.status) && (hrWithEmp.location || '').includes('/employee'), `status=${hrWithEmp.status} loc=${hrWithEmp.location}`);
      const logout = await req('/api/auth/logout', { method: 'POST', cookie: empCookie });
      const cleared = cookieValue(logout.setCookies) || '';
      check('Logout clears auth_token cookie', logout.status === 200 && /auth_token=;?/.test(cleared), `status=${logout.status}`);
    } else {
      check('Employee session tests', false, 'no employee cookie');
    }
  } else {
    check('Employee login flow', null, 'skipped (DEV_EMPLOYEE_AUTH_ENABLED not true)');
  }
} catch (e) {
  log('ERROR: ' + (e && e.message));
}

const pass = results.filter((r) => r.pass === true).length;
const fail = results.filter((r) => r.pass === false).length;
const skip = results.filter((r) => r.pass === null).length;
log('');
log(`=== SUMMARY: ${pass} PASS / ${fail} FAIL / ${skip} SKIP (of ${results.length}) ===`);
for (const r of results) log(`${r.pass === true ? 'PASS' : r.pass === false ? 'FAIL' : 'SKIP'} | ${r.name} | ${r.detail}`);

fs.writeFileSync('scripts/phase2-web-verify-out.txt', out.join('\n'), 'utf8');
console.log(out.join('\n'));
