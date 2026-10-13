// PHASE 4 — employee portal verification (READ-ONLY, real backend via Next.js on :3000).
// - Real employee (S00069) ka session JWT app ke apne JWT_SECRET se sign karke portal test
//   karte hain (S00069 ka password scrypt-hash hai, available nahi — koi record change nahi hota).
// - Employee LOGIN flow (password) existing DEV account se test hota hai.
import 'dotenv/config';
import jwt from 'jsonwebtoken';

const BASE = 'http://localhost:3000';
const out = [];
const results = [];
const log = (s = '') => out.push(String(s));
const check = (n, c, d = '') => { const pass = !!c; results.push({ n, pass, d: String(d ?? '') }); log(`${pass ? 'PASS' : 'FAIL'} :: ${n} :: ${d ?? ''}`); };

function cookieOf(setCookies, name = 'auth_token') { for (const c of setCookies) if (c.startsWith(name + '=')) return c.split(';')[0]; return null; }

async function req(path, { method = 'GET', body, cookie } = {}) {
  const headers = { 'Content-Type': 'application/json' };
  if (cookie) headers.Cookie = cookie;
  const res = await fetch(BASE + path, { method, headers, body: body != null ? JSON.stringify(body) : undefined, redirect: 'manual' });
  let data = null; try { data = await res.json(); } catch { data = null; }
  return { status: res.status, data, location: res.headers.get('location'), setCookies: res.headers.getSetCookie ? res.headers.getSetCookie() : [] };
}

const PAYCODE = 'S00069';

try {
  log('=== PHASE 4 EMPLOYEE PORTAL VERIFICATION ===');

  // 1. Real employee JWT (same shape as backend signUser)
  const token = jwt.sign({ sub: PAYCODE, role: 'EMPLOYEE', paycode: PAYCODE }, process.env.JWT_SECRET, { expiresIn: '8h' });
  const cookie = `auth_token=${token}`;

  // 2. /employee renders with real identity (shell + dashboard)
  const page = await req('/employee', { cookie });
  const html = page.data && page.data.raw ? String(page.data.raw) : '';
  check('GET /employee (S00069) renders', page.status === 200, `status=${page.status}`);
  // fetch text for content check
  const pageText = await (await fetch(BASE + '/employee', { headers: { Cookie: cookie }, redirect: 'manual' })).text();
  check('/employee shows real name (Mohit Kumar)', pageText.includes('Mohit Kumar'), '');
  check('/employee shows nav (Dashboard/Profile)', pageText.includes('Dashboard') && pageText.includes('Profile'), '');

  // 3. Real data endpoints for S00069
  const dash = await req('/api/employee/dashboard', { cookie });
  check('/api/employee/dashboard returns real summary', dash.status === 200 && typeof dash.data?.present === 'number', `present=${dash.data?.present} absent=${dash.data?.absent}`);

  const profile = await req('/api/employee/profile', { cookie });
  check('/api/employee/profile returns OWN profile (S00069)', profile.status === 200 && profile.data?.profile?.paycode === PAYCODE, `paycode=${profile.data?.profile?.paycode} name=${profile.data?.profile?.empname}`);

  const cele = await req('/api/employee/celebrations', { cookie });
  check('/api/employee/celebrations returns real groups', cele.status === 200 && cele.data?.birthdays && cele.data?.workAnniversaries, `status=${cele.status}`);

  const bal = await req('/api/employee/leave/balance', { cookie });
  check('/api/employee/leave/balance returns real data', bal.status === 200 && Array.isArray(bal.data?.types), `status=${bal.status}`);

  // 4. Cross-employee isolation: employee token cannot hit HR roster route
  const roster = await req('/api/employees?page=1&pageSize=5', { cookie });
  check('EMPLOYEE cannot access HR /api/employees (403)', roster.status === 403, `status=${roster.status}`);

  // 5. No paycode override: /api/employee/profile ignores any query paycode (identity = token)
  const prof2 = await req('/api/employee/profile?paycode=1116', { cookie });
  check('profile ignores browser-supplied paycode', prof2.status === 200 && prof2.data?.profile?.paycode === PAYCODE, `paycode=${prof2.data?.profile?.paycode}`);

  // 6. Unauthenticated /employee redirects
  const noAuth = await req('/employee');
  check('GET /employee (no auth) -> /login', [302, 303, 307, 308].includes(noAuth.status), `status=${noAuth.status}`);

  // 7. Employee login (password) via DEV account
  const devPay = process.env.DEV_EMPLOYEE_PAYCODE, devPass = process.env.DEV_EMPLOYEE_PASSWORD;
  if (String(process.env.DEV_EMPLOYEE_AUTH_ENABLED).toLowerCase() === 'true' && devPay) {
    const login = await req('/api/auth/employee', { method: 'POST', body: { paycode: devPay, password: devPass } });
    const devCookie = cookieOf(login.setCookies);
    check('Employee login VALID (dev account) -> cookie', login.status === 200 && !!devCookie, `status=${login.status}`);
    if (devCookie) {
      const devPage = await (await fetch(BASE + '/employee', { headers: { Cookie: devCookie }, redirect: 'manual' })).text();
      check('/employee renders after real login', devPage.includes('Development Employee'), '');
    }
  } else {
    check('Employee login (dev account)', false, 'DEV_EMPLOYEE_AUTH_ENABLED not true');
  }
} catch (e) {
  log('ERROR: ' + (e && e.message));
}

const pass = results.filter((r) => r.pass).length;
log('');
log(`=== SUMMARY: ${pass} PASS / ${results.length - pass} FAIL (of ${results.length}) ===`);
for (const r of results) log(`${r.pass ? 'PASS' : 'FAIL'} | ${r.n} | ${r.d}`);
console.log(out.join('\n'));
