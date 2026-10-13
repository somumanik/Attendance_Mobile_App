// PHASE 6.1 — probe the RUNNING backend on port 4000 (read-only) to see what the
// live app actually receives for /employees/S00069.
import 'dotenv/config';

const BASE = 'http://127.0.0.1:4000/api';
const login = await fetch(BASE + '/auth/hr/login', {
  method: 'POST', headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ username: process.env.HR_USERNAME, password: process.env.HR_PASSWORD }),
});
const tok = (await login.json())?.token;
console.log('hr login status', login.status, 'token?', !!tok);
if (!tok) process.exit(1);

for (const path of ['/employees/S00069', '/hr/employee/S00069']) {
  const r = await fetch(BASE + path, { headers: { Authorization: 'Bearer ' + tok } });
  const j = await r.json().catch(() => null);
  const shiftKeys = j ? Object.keys(j).filter((k) => /shift/i.test(k)) : [];
  console.log(`GET ${path} -> ${r.status}`);
  console.log('  shiftKeys:', JSON.stringify(shiftKeys));
  console.log('  shiftResolved:', j?.shiftResolved, '| shiftCode:', j?.shiftCode, '| shiftStart:', j?.shiftStart, '| shiftEnd:', j?.shiftEnd, '| reason:', j?.shiftUnavailableReason);
}
