// PHASE 2 — middleware check: httpOnly cookie se /api/* (proxy) par Bearer header inject hota hai.
import 'dotenv/config';
const BASE = 'http://localhost:3000';
const out = [];
const log = (s) => out.push(s);
const check = (n, c, d = '') => log(`${c ? 'PASS' : 'FAIL'} :: ${n} :: ${d}`);

const login = await fetch(BASE + '/api/auth/hr', {
  method: 'POST', headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ username: process.env.HR_USERNAME, password: process.env.HR_PASSWORD }),
});
const cookie = (login.headers.getSetCookie() || []).find((c) => c.startsWith('auth_token='));

const me = await fetch(BASE + '/api/me', { headers: cookie ? { Cookie: cookie } : {} });
const meData = await me.json().catch(() => null);
check('/api/me with cookie (middleware Bearer) → 200 HR', me.status === 200 && meData?.role === 'HR', `status=${me.status} role=${meData?.role}`);

const me2 = await fetch(BASE + '/api/me');
check('/api/me without cookie → 401', me2.status === 401, `status=${me2.status}`);

console.log(out.join('\n'));
