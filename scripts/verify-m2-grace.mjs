// ============================================================================
// scripts/verify-m2-grace.mjs
// Live verification for Phase M2 grace fixes:
//   1. /api/employee/dashboard now returns `graceEligibility` (isStaff + limits).
//   2. The authoritative grace math is internally consistent:
//        remaining(graceRemaining) + grace-covered(lateDetails) == limits  (staff)
//        non-staff => limits 0 and remaining 0.
//   3. late (final) count equals the number of isFinalLate lateDetails.
//   4. Cross-check the shared computeMonthlyLateForEmployee via HR audit.
// ============================================================================
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { getPool } from '../server/db.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
try {
  const envText = fs.readFileSync(path.join(ROOT, '.env'), 'utf8');
  for (const line of envText.split(/\r?\n/)) {
    const m = /^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/.exec(line);
    if (m && process.env[m[1]] === undefined) process.env[m[1]] = m[2].trim();
  }
} catch { /* rely on process env */ }

const BASE = process.env.VERIFY_BASE || 'http://localhost:4000';
let passed = 0;
let failed = 0;
function check(name, cond, detail = '') {
  if (cond) { passed += 1; console.log(`PASS :: ${name}${detail ? ` :: ${detail}` : ''}`); }
  else { failed += 1; console.log(`FAIL :: ${name}${detail ? ` :: ${detail}` : ''}`); }
}

async function req(method, apiPath, { token, body } = {}) {
  const headers = { Accept: 'application/json' };
  if (token) headers.Authorization = `Bearer ${token}`;
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  const res = await fetch(`${BASE}${apiPath}`, { method, headers, body: body !== undefined ? JSON.stringify(body) : undefined });
  const ct = res.headers.get('content-type') || '';
  const json = ct.includes('application/json') ? await res.json().catch(() => null) : null;
  return { status: res.status, json };
}

const sumG = (o) => Number(o?.grace30min || 0) + Number(o?.grace1hr || 0) + Number(o?.grace2hr || 0);

async function loginEmployee(u, p) {
  return (await req('POST', '/api/auth/employee/login', { body: { paycode: u, password: p } })).json?.token || null;
}
async function loginHr(u, p) {
  return (await req('POST', '/api/auth/hr/login', { body: { username: u, password: p } })).json?.token || null;
}


async function main() {
  console.log(`\n=== Phase M2 grace verification against ${BASE} ===\n`);

  // ---- Employee dashboard: new graceEligibility field + consistency ----
  const empToken = await loginEmployee(process.env.DEV_EMPLOYEE_PAYCODE, process.env.DEV_EMPLOYEE_PASSWORD);
  check('Bootstrap employee login works', Boolean(empToken));
  if (empToken) {
    const today = new Date().toISOString().slice(0, 10);
    const month = today.slice(0, 7);
    const d = await req('GET', `/api/employee/dashboard?month=${month}`, { token: empToken });
    check('Employee dashboard returns 200', d.status === 200, `HTTP ${d.status}`);
    const j = d.json || {};
    const elig = j.graceEligibility;
    check('Dashboard exposes graceEligibility (new field)', Boolean(elig), JSON.stringify(elig));
    const limits = elig?.isStaff && elig?.limits ? elig.limits : { grace30min: 0, grace1hr: 0, grace2hr: 0 };
    const remaining = j.graceRemaining || { grace30min: 0, grace1hr: 0, grace2hr: 0 };
    const total = sumG(limits);
    const left = sumG(remaining);
    const used = total - left;
    check('Remaining allowance within [0, total]', left >= 0 && left <= total, `left=${left} total=${total}`);
    const details = Array.isArray(j.lateDetails) ? j.lateDetails : [];
    const coveredCount = details.filter((d) => d.graceUsed && d.isFinalLate === false).length;
    const finalCount = details.filter((d) => d.isFinalLate !== false).length;
    check('Grace-covered events equals consumed allowance (no double count)', coveredCount === used, `covered=${coveredCount} used=${used}`);
    check('late (final) equals isFinalLate detail count', Number(j.late || 0) === finalCount, `late=${j.late} final=${finalCount}`);
    console.log(`NOTE :: employee ${process.env.DEV_EMPLOYEE_PAYCODE}: isStaff=${elig?.isStaff} limits=${JSON.stringify(limits)} remaining=${JSON.stringify(remaining)} -> Grace left: ${left} of ${total}`);
  }

  // ---- Cross-check shared calc via HR audit for a real STAFF employee ----
  const pool = await getPool();
  const empRows = (await pool.request().query(`SELECT TOP 80 LTRIM(RTRIM(e.paycode)) AS paycode, UPPER(LTRIM(RTRIM(c.categoryname))) AS catname FROM dbo.tblemployee e JOIN dbo.tblcategory c ON LTRIM(RTRIM(c.cat)) = LTRIM(RTRIM(e.cat)) WHERE e.paycode IS NOT NULL AND LTRIM(RTRIM(e.paycode)) <> '' ORDER BY e.paycode`)).recordset;
  const staffPc = empRows.filter((e) => ['STAFF', 'STF'].includes(String(e.catname || '').trim())).map((e) => e.paycode);
  check('STAFF employees found in DB', staffPc.length > 0, `count=${staffPc.length}`);
  const hrToken = await loginHr(process.env.HR_USERNAME, process.env.HR_PASSWORD);
  check('HR login works', Boolean(hrToken));
  if (staffPc.length && hrToken) {
    const months = [];
    const dNow = new Date();
    for (let i = 0; i < 3; i += 1) {
      const dt = new Date(dNow.getFullYear(), dNow.getMonth() - i, 1);
      months.push(`${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, '0')}`);
    }
    let audited = null;
    for (const pc of staffPc.slice(0, 6)) {
      for (const m of months) {
        const a = await req('GET', `/api/hr/audit/${encodeURIComponent(pc)}?month=${m}`, { token: hrToken });
        if (a.status === 200 && a.json && Array.isArray(a.json.lateDetails) && a.json.lateDetails.length > 0) {
          audited = { pc, m, a: a.json };
          break;
        }
      }
      if (audited) break;
    }
    if (audited) {
      const { pc, m, a } = audited;
      const elig = a.graceEligibility;
      const limits = elig?.isStaff && elig?.limits ? elig.limits : { grace30min: 0, grace1hr: 0, grace2hr: 0 };
      const remaining = a.graceRemaining || { grace30min: 0, grace1hr: 0, grace2hr: 0 };
      const total = sumG(limits);
      const left = sumG(remaining);
      const details = Array.isArray(a.lateDetails) ? a.lateDetails : [];
      const coveredCount = details.filter((d) => d.graceUsed && d.isFinalLate === false).length;
      const finalCount = details.filter((d) => d.isFinalLate !== false).length;
      check('HR audit: staff grace-covered equals consumed allowance', coveredCount === (total - left), `${pc} ${m} covered=${coveredCount} used=${total - left}`);
      check('HR audit: late (final) equals isFinalLate count', Number(a.stats?.late || 0) === finalCount, `late=${a.stats?.late} final=${finalCount}`);
      console.log(`NOTE :: STAFF ${pc} ${m}: limits=${JSON.stringify(limits)} remaining=${JSON.stringify(remaining)} -> Grace left: ${left} of ${total}; finalLate=${a.stats?.late}`);
    } else {
      console.log('NOTE :: no STAFF employee with late records found in the last 3 months (cross-check skipped)');
    }
  }

  console.log(`\n=== RESULT: ${passed} passed, ${failed} failed ===`);
  process.exit(failed ? 1 : 0);
}

main().catch((e) => { console.error('VERIFY_RUN_ERROR', e?.message || e); process.exit(1); });
