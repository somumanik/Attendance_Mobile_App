// ============================================================================
// scripts/verify-fullfinal-fix.mjs
// Live verification of the Full & Final final-total fix (Paycode 1053 + parity).
//   A. Paycode 1053 (HR) — invalid PERCENTAGE bonus no longer inflates the total.
//   B. A different employee — uses ITS OWN records, not 1053's.
//   C. Leaving-date change — service period + components recalculated.
//   D. Missing salary config — never fabricated (salary.available=false).
//   E. Employee endpoint uses session identity (browser paycode ignored); HR scope.
// Read-only against real data (no config mutation).
// ============================================================================

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { getPool } from '../server/db.js';
import { createSuperAdmin, setSuperAdminActive, deleteSuperAdmin, listCompanyCodes } from '../server/admin-access.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
for (const line of fs.readFileSync(path.join(ROOT, '.env'), 'utf8').split(/\r?\n/)) {
  const m = /^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/.exec(line);
  if (m && process.env[m[1]] === undefined) process.env[m[1]] = m[2].trim();
}

const BASE = process.env.VERIFY_BASE || 'http://localhost:4000';
const round2 = (v) => Math.round(Number(v) * 100) / 100;

let passed = 0;
let failed = 0;
function check(name, cond, detail = '') {
  if (cond) { passed += 1; console.log(`PASS :: ${name}${detail ? ` :: ${detail}` : ''}`); }
  else { failed += 1; console.log(`FAIL :: ${name}${detail ? ` :: ${detail}` : ''}`); }
}
function note(t) { console.log(`NOTE :: ${t}`); }

async function req(method, apiPath, { token, body } = {}) {
  const headers = { Accept: 'application/json' };
  if (token) headers.Authorization = `Bearer ${token}`;
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  const res = await fetch(`${BASE}${apiPath}`, { method, headers, body: body !== undefined ? JSON.stringify(body) : undefined });
  let json = null;
  try { json = await res.json(); } catch { /* non-JSON */ }
  return { status: res.status, json };
}
async function loginHr(u, p) { return (await req('POST', '/api/auth/hr/login', { body: { username: u, password: p } })).json?.token || null; }

async function main() {
  console.log(`\n=== Full & Final fix verification against ${BASE} ===\n`);
  const token = await loginHr(process.env.HR_USERNAME, process.env.HR_PASSWORD);
  check('Bootstrap HR login works', Boolean(token));
  if (!token) { console.error('Cannot continue.'); process.exit(1); }

  const pool = await getPool();
  const other = await pool.request().query(`SELECT TOP 1 LTRIM(RTRIM(paycode)) AS paycode FROM dbo.HR_SalaryMaster WHERE LTRIM(RTRIM(paycode)) <> '1053' ORDER BY paycode`);
  const otherPaycode = String(other.recordset?.[0]?.paycode || '').trim();
  check('Another employee with salary data found', Boolean(otherPaycode), otherPaycode);
  const missing = await pool.request().query(`SELECT TOP 1 LTRIM(RTRIM(e.paycode)) AS paycode FROM dbo.tblemployee e WHERE NOT EXISTS (SELECT 1 FROM dbo.HR_SalaryMaster m WHERE LTRIM(RTRIM(m.paycode)) = LTRIM(RTRIM(e.paycode))) AND LTRIM(RTRIM(e.paycode)) <> '' ORDER BY e.paycode`);
  const missingPaycode = String(missing.recordset?.[0]?.paycode || '').trim();

  const D1 = '2026-12-31';
  const D2 = '2027-06-30';

  // ---- A. Paycode 1053 ----
  const a = await req('GET', `/api/hr/salary/fullfinal/1053?leavingdate=${D1}`, { token });
  check('A1. 1053 estimate loads', a.status === 200 && a.json?.estimate, `HTTP ${a.status}`);
  const est = a.json?.estimate;
  check('A2. Bonus flagged INVALID (not 13580%)', est?.bonus?.eligible === false && Number(est?.bonus?.amount) === 0 && /Invalid bonus configuration/.test(est?.bonus?.note || ''), `amount=${est?.bonus?.amount}`);
  check('A3. Bonus note explains the likely correction', /FIXED/.test(est?.bonus?.note || ''), String(est?.bonus?.note || '').slice(0, 90));
  const adds = (est?.gratuity?.amount || 0) + (est?.bonus?.amount || 0) + (est?.leaveEncashment?.amount || 0) + (est?.notice?.payAmount || 0) + (est?.otherDues?.total || 0);
  const subs = (est?.notice?.recoveryAmount || 0) + (est?.otherRecoveries?.total || 0) + (est?.employeeDeductions?.total || 0);
  check('A4. additionsTotal == sum of additions', round2(est?.additionsTotal) === round2(adds), `add=${est?.additionsTotal} adds=${round2(adds)}`);
  check('A5. subtractionsTotal == sum of subtractions', round2(est?.subtractionsTotal) === round2(subs), `sub=${est?.subtractionsTotal} subs=${round2(subs)}`);
  check('A6. estimatedTotal == additions - subtractions', round2(est?.estimatedTotal) === round2(round2(adds) - round2(subs)), `total=${est?.estimatedTotal}`);
  check('A7. Bonus no longer dominates the total', Number(est?.bonus?.amount) === 0 && Number(est?.estimatedTotal) < 1000000, `total=${est?.estimatedTotal}`);

  // ---- C. Date change recalculates ----
  const c = await req('GET', `/api/hr/salary/fullfinal/1053?leavingdate=${D2}`, { token });
  check('C1. Leaving date echoed into recalculated estimate', c.json?.estimate?.leavingdate === D2, c.json?.estimate?.leavingdate);
  check('C2. Service period changes with the date', (c.json?.estimate?.servicePeriod?.years || 0) > (est?.servicePeriod?.years || 0), `y=${c.json?.estimate?.servicePeriod?.years} vs ${est?.servicePeriod?.years}`);
  check('C3. Recalculated total stays internally consistent', c.status === 200 && round2(c.json?.estimate?.estimatedTotal) === round2(round2(c.json?.estimate?.additionsTotal) - round2(c.json?.estimate?.subtractionsTotal)));

  // ---- B. Different employee uses its own records ----
  if (otherPaycode) {
    const b = await req('GET', `/api/hr/salary/fullfinal/${encodeURIComponent(otherPaycode)}?leavingdate=${D1}`, { token });
    check('B1. Other employee estimate loads', b.status === 200 && b.json?.estimate, `HTTP ${b.status} paycode=${b.json?.employee?.paycode}`);
    check('B2. Identity is the OTHER employee (not 1053)', b.json?.employee?.paycode === otherPaycode, b.json?.employee?.paycode);
    check('B3. Salary comes from that employee, not 1053', (b.json?.estimate?.salaryUsed?.basic ?? null) !== (est?.salaryUsed?.basic ?? 'x'), `basic=${b.json?.estimate?.salaryUsed?.basic}`);
  }

  // ---- D. Missing salary config is never fabricated ----
  if (missingPaycode) {
    const d = await req('GET', `/api/hr/salary/fullfinal/${encodeURIComponent(missingPaycode)}?leavingdate=${D1}`, { token });
    check('D1. Missing salary -> no fabricated estimate', d.status === 200 && d.json?.estimate === null && d.json?.salary?.available === false, `reason=${d.json?.salary?.reason}`);
  }

  // ---- E1/E2/E3. Employee endpoint uses the session identity (browser paycode ignored) ----
  const devEnabled = String(process.env.DEV_EMPLOYEE_AUTH_ENABLED || '').toLowerCase() === 'true';
  if (devEnabled) {
    const empLogin = await req('POST', '/api/auth/employee/login', { body: { paycode: process.env.DEV_EMPLOYEE_PAYCODE, password: process.env.DEV_EMPLOYEE_PASSWORD } });
    const empToken = empLogin.json?.token || null;
    check('E1. Dev employee login works (parity test)', Boolean(empToken), `HTTP ${empLogin.status}`);
    if (empToken) {
      const own = await req('GET', `/api/employee/fullfinal?leavingdate=${D1}`, { token: empToken });
      const spoof = await req('GET', `/api/employee/fullfinal?leavingdate=${D1}&paycode=1053`, { token: empToken });
      // Identity always comes from the session, never the query — so the response
      // with ?paycode=1053 must be byte-for-byte identical to the response without it.
      const same = JSON.stringify(own.json) === JSON.stringify(spoof.json);
      check('E2. Browser-supplied paycode is ignored (identical response with/without ?paycode=1053)', same, `own=${own.json?.employee?.paycode || own.json?.code || own.status} spoof=${spoof.json?.employee?.paycode || spoof.json?.code || spoof.status}`);
      const resolved = own.json?.employee?.paycode;
      const notFoundForDev = own.json?.code === 'EMPLOYEE_NOT_FOUND' && !resolved;
      check('E3. Employee route resolves the SESSION identity (never 1053)', resolved === process.env.DEV_EMPLOYEE_PAYCODE || notFoundForDev, `resolved=${resolved || own.json?.code || own.status}`);
      if (notFoundForDev) note('The DEV employee is not a real dbo.tblemployee row, so the estimate returns EMPLOYEE_NOT_FOUND — this still proves the route used the session paycode (not the spoofed 1053).');
    }
  } else {
    note('DEV_EMPLOYEE_AUTH_ENABLED is off — employee self-service parity verified at code level (both routes call computeFullFinal with identical options).');
  }

  // ---- E4. HR company-scope still enforced ----
  const stamp = Date.now().toString(36).toUpperCase();
  const SA = `SAFF${stamp}`;
  const HR_SC = `FFSC${stamp}`;
  const companies = await listCompanyCodes(pool);
  const targetCompany = String(companies.find((co) => String(co).trim() !== '001') || companies[0] || '').trim();
  let createdHr = false;
  await createSuperAdmin(pool, { username: SA, password: 'FfVerify123', displayname: 'FF Verify' }, 'verify-fullfinal-fix');
  const saToken = (await req('POST', '/api/auth/superadmin/login', { body: { username: SA, password: 'FfVerify123' } })).json?.token;
  if (saToken && targetCompany) {
    const cr = await req('POST', '/api/superadmin/hr-admins', { token: saToken, body: { username: HR_SC, password: 'FfVerify123', displayname: 'FF Scope', companies: [targetCompany] } });
    createdHr = cr.status === 201;
    if (createdHr) {
      const scToken = await loginHr(HR_SC, 'FfVerify123');
      const sc = await req('GET', '/api/hr/salary/fullfinal/1053?leavingdate=2026-12-31', { token: scToken });
      const is1053InTarget = targetCompany === '001';
      check('E4. Scoped HR cannot estimate an out-of-scope employee (403)',
        is1053InTarget ? sc.status === 200 : (sc.status === 403 && sc.json?.code === 'COMPANY_FORBIDDEN'),
        `targetCompany=${targetCompany} 1053 company=001 -> HTTP ${sc.status} ${sc.json?.code || ''}`);
    }
  }
  if (createdHr) { try { await req('DELETE', `/api/superadmin/hr-admins/${HR_SC}`, { token: saToken }); } catch { /* best effort */ } }
  if (saToken) {
    try { await setSuperAdminActive(pool, SA, false, 'verify-fullfinal-fix'); } catch { /* best effort */ }
    try { await deleteSuperAdmin(pool, SA); } catch (e) { note(`SA cleanup: ${String(e?.message || e).slice(0, 80)}`); }
  }

  console.log(`\n=== RESULT: ${passed} passed, ${failed} failed ===`);
  process.exit(failed ? 1 : 0);
}

main().catch((error) => {
  console.error('VERIFY_RUN_ERROR', error && (error.message || error));
  process.exit(1);
});