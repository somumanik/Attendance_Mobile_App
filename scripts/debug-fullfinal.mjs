// scripts/debug-fullfinal.mjs — dump the Full & Final estimate for a paycode.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
for (const line of fs.readFileSync(path.join(ROOT, '.env'), 'utf8').split(/\r?\n/)) {
  const m = /^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/.exec(line);
  if (m && process.env[m[1]] === undefined) process.env[m[1]] = m[2].trim();
}

const BASE = process.env.VERIFY_BASE || 'http://localhost:4000';
const paycode = process.argv[2] || '1053';
const leavingdate = process.argv[3] || '2026-12-31';

const login = await fetch(`${BASE}/api/auth/hr/login`, {
  method: 'POST', headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ username: process.env.HR_USERNAME, password: process.env.HR_PASSWORD }),
});
const token = (await login.json()).token;

const url = `${BASE}/api/hr/salary/fullfinal/${paycode}?leavingdate=${leavingdate}`;
const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
const json = await res.json();

console.log('HTTP', res.status);
console.log('EMPLOYEE', JSON.stringify(json.employee, null, 2));
console.log('SALARY', JSON.stringify(json.salary, null, 2));
if (json.estimate) {
  console.log('ESTIMATE', JSON.stringify(json.estimate, null, 2));
  // Arithmetic check
  const e = json.estimate;
  const adds = (e.gratuity?.amount || 0) + (e.bonus?.amount || 0) + (e.leaveEncashment?.amount || 0) + (e.notice?.payAmount || 0) + (e.otherDues?.total || 0);
  const subs = (e.notice?.recoveryAmount || 0) + (e.otherRecoveries?.total || 0) + (e.employeeDeductions?.total || 0);
  console.log('ARITH', { adds: adds.toFixed(2), subs: subs.toFixed(2), expectedTotal: (adds - subs).toFixed(2), reportedAdditionsTotal: e.additionsTotal, reportedSubtractionsTotal: e.subtractionsTotal, reportedEstimatedTotal: e.estimatedTotal });
} else {
  console.log('NO ESTIMATE — salary reason:', json.salary?.reason, 'estimate:', json.estimate);
}
process.exit(0);
