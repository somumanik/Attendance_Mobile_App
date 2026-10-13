// PHASE 6 — end-to-end verification (READ-ONLY against Savior).
// Server temp port par chalta hai (scripts/phase6-run.ps1) aur ye script usi par API
// calls karta hai. Savior DB me koi write nahi hota.
import 'dotenv/config';
import jwt from 'jsonwebtoken';
import fs from 'node:fs';
import { getPool } from '../server/db.js';

const BASE = process.env.PHASE6_BASE || 'http://localhost:4123/api';
const PAYCODE = (process.argv[2] || 'S00069').trim();
const out = [];
const results = [];
const log = (s = '') => out.push(String(s));
const check = (name, cond, detail) => {
  const pass = !!cond;
  results.push({ name, pass, detail: detail == null ? '' : String(detail) });
  log(`${pass ? 'PASS' : 'FAIL'} :: ${name} :: ${detail == null ? '' : detail}`);
};

async function api(path, { method = 'GET', body, token } = {}) {
  const headers = { 'Content-Type': 'application/json' };
  if (token) headers.Authorization = `Bearer ${token}`;
  const res = await fetch(BASE + path, { method, headers, body: body ? JSON.stringify(body) : undefined });
  let data = null;
  try { data = await res.json(); } catch { data = null; }
  return { status: res.status, data };
}

try {
  log('=== PHASE 6 SHIFT SYNC VERIFICATION ===');
  log('base=' + BASE + ' paycode=' + PAYCODE);

  // ---- 1. HR login (existing bootstrap account; credentials never printed) ----
  const login = await api('/auth/hr/login', { method: 'POST', body: { username: process.env.HR_USERNAME, password: process.env.HR_PASSWORD } });
  const token = login.data?.token;
  check('HR Admin login still works', login.status === 200 && !!token, `status=${login.status}`);
  if (!token) throw new Error('HR login failed — cannot continue.');

  // ---- 2. HR employee detail (All Employees -> View) ----
  const emp = await api('/employees/' + encodeURIComponent(PAYCODE), { token });
  log('GET /employees/' + PAYCODE + ' => ' + JSON.stringify({
    paycode: emp.data?.paycode, shiftCode: emp.data?.shiftCode, shiftName: emp.data?.shiftName,
    shiftStart: emp.data?.shiftStart, shiftEnd: emp.data?.shiftEnd,
    shiftResolved: emp.data?.shiftResolved, reason: emp.data?.shiftUnavailableReason,
  }));
  check('HR employee detail exposes resolved shift', emp.data?.shiftResolved === true && /^[0-9]{2}:[0-9]{2}/.test(String(emp.data?.shiftStart)),
    `code=${emp.data?.shiftCode} start=${emp.data?.shiftStart} end=${emp.data?.shiftEnd}`);

  // ---- 3. HR roster (batch shift lookup, no N+1) ----
  const roster = await api('/employees?page=1&pageSize=25&active=ALL&search=' + encodeURIComponent(PAYCODE), { token });
  const rrow = (roster.data?.rows || []).find((x) => String(x.paycode).trim() === PAYCODE);
  log('GET /employees?search=' + PAYCODE + ' status=' + roster.status + ' rows=' + (roster.data?.rows || []).length + ' => ' + JSON.stringify(rrow && {
    paycode: rrow.paycode, shiftCode: rrow.shiftCode, shiftStart: rrow.shiftStart, shiftEnd: rrow.shiftEnd, shiftResolved: rrow.shiftResolved,
  }));
  check('Roster batch shift matches detail', !!rrow && rrow.shiftCode === emp.data?.shiftCode && rrow.shiftStart === emp.data?.shiftStart,
    `roster=${rrow?.shiftCode}/${rrow?.shiftStart} detail=${emp.data?.shiftCode}/${emp.data?.shiftStart}`);

  // ---- 4. HR audit (single employee report) ----
  const month = new Date().toISOString().slice(0, 7);
  const audit = await api(`/hr/audit/${encodeURIComponent(PAYCODE)}?month=${month}`, { token });
  const arows = Array.isArray(audit.data?.attendance) ? audit.data.attendance : [];
  log('GET /hr/audit shift => ' + JSON.stringify(audit.data?.shift));
  const sample = arows.find((r) => r.in1 || r.inTime) || arows[0];
  log('audit attendance sample => ' + JSON.stringify(sample && {
    date: String(sample.date || '').slice(0, 10), shift: sample.shift, registerShift: sample.registerShift,
    currentShift: sample.currentShift, shiftStart: sample.shiftStart, shiftEnd: sample.shiftEnd,
    inTime: sample.inTime, latearrival: sample.latearrival, isLate: sample.isLate,
  }));
  check('Audit row uses CURRENT resolved shift (not stale register shift)',
    sample && sample.currentShift === emp.data?.shiftCode,
    `row.currentShift=${sample?.currentShift} registerShift=${sample?.registerShift} expected=${emp.data?.shiftCode}`);
  check('Displayed `shift` field also reflects the resolved shift (web + mobile clients)',
    sample && sample.shift === emp.data?.shiftCode,
    `shift=${sample?.shift} registerShift=${sample?.registerShift}`);
  const allRowsUseCurrent = arows.length > 0 && arows.every((r) => !r.shiftResolved || r.currentShift === emp.data?.shiftCode);
  check('Whole selected month uses the latest assigned shift (month-wide rule)', allRowsUseCurrent, `rows=${arows.length}`);


  // ---- 5. Employee-side (own JWT, same identity the mobile app uses) ----
  const empToken = jwt.sign({ sub: PAYCODE, role: 'EMPLOYEE', paycode: PAYCODE }, process.env.JWT_SECRET, { expiresIn: '30m' });
  const eshift = await api('/employee/shift', { token: empToken });
  log('GET /employee/shift => ' + JSON.stringify({ status: eshift.status, ...eshift.data }));
  check('Employee shift endpoint returns same resolved shift', eshift.data?.resolved === true && eshift.data?.shiftCode === emp.data?.shiftCode,
    `status=${eshift.status} code=${eshift.data?.shiftCode}`);
  const emonth = await api(`/employee/monthly?fromDate=${month}-01&toDate=${month}-28`, { token: empToken });
  const mrows = Array.isArray(emonth.data) ? emonth.data : [];
  const msample = mrows.find((r) => r.in1 || r.inTime) || mrows[0];
  log('GET /employee/monthly sample => ' + JSON.stringify(msample && {
    date: String(msample.date || '').slice(0, 10), currentShift: msample.currentShift, shiftStart: msample.shiftStart,
    registerShift: msample.registerShift, inTime: msample.inTime, latearrival: msample.latearrival, isLate: msample.isLate,
  }));
  check('Employee attendance rows carry the resolved shift + timings', mrows.length > 0 && mrows.every((r) => r.shiftResolved === true && r.currentShift === emp.data?.shiftCode),
    `rows=${mrows.length} status=${emonth.status}`);

  // Identity isolation: an EMPLOYEE token must never read another paycode.
  const cross = await api(`/attendance?paycode=00001&fromDate=${month}-01&toDate=${month}-10`, { token: empToken });
  check('Employee identity isolation intact (cross-paycode request denied)', cross.status === 403, `status=${cross.status}`);

  // Late Coming PROOF: find a day whose punch falls between the OLD shift's grace end
  // (GEN/002 = 09:00 + 5min) and the CURRENT shift's grace end (GEM/002 = 10:00 + 5min).
  // Under the stale shift it would have been Late; with the resolved shift it must be 0.
  const oldThreshold = 9 * 60 + 5;
  const newThreshold = 10 * 60 + 5;
  const proof = mrows.find((r) => {
    if (!r.in1) return false;
    const d = new Date(r.in1);
    const mins = d.getUTCHours() * 60 + d.getUTCMinutes();
    return mins > oldThreshold && mins <= newThreshold;
  });
  check('Late Coming now recalculates from the RESOLVED shift start (would be late under stale shift)',
    !!proof && Number(proof.latearrival) === 0,
    proof ? `date=${String(proof.date).slice(0, 10)} in=${proof.inTime} lateMinutes=${proof.latearrival} (old 09:05 vs new 10:05)` : 'no punch found in the 09:05-10:05 window this month');

  // ---- 6. Missing-mapping safety (HR detail) ----
  const pool = await getPool();
  const miss = await pool.request().query(`
    SELECT TOP 1 LTRIM(RTRIM(e.paycode)) AS paycode
    FROM dbo.tblemployee e
    WHERE NOT EXISTS (SELECT 1 FROM dbo.tblemployeeshiftmaster s WHERE LTRIM(RTRIM(s.paycode)) = LTRIM(RTRIM(e.paycode)))`);
  const mp = miss.recordset?.[0]?.paycode;
  if (mp) {
    const me = await api('/employees/' + encodeURIComponent(mp), { token });
    log(`no-mapping employee ${mp} => ` + JSON.stringify({ shiftResolved: me.data?.shiftResolved, shift: me.data?.shift, reason: me.data?.shiftUnavailableReason }));
    check('Missing shift mapping returns safe unavailable state', me.data?.shiftResolved === false && me.data?.shift === null && me.data?.shiftUnavailableReason === 'NO_SHIFT_MAPPING',
      `reason=${me.data?.shiftUnavailableReason}`);
  } else {
    log('(no active employee without a shift mapping found - skipping missing-mapping test)');
  }

  // ---- 7. DB cross-check (Savior truth vs API) ----
  const db = await pool.request().input('paycode', PAYCODE).query(`
    SELECT LTRIM(RTRIM(s.shift)) AS shift FROM dbo.tblemployeeshiftmaster s WHERE LTRIM(RTRIM(s.paycode)) = @paycode`);
  const dbShift = db.recordset?.[0]?.shift || null;
  const dbSm = await pool.request().input('shift', dbShift || '').input('companycode', emp.data?.companycode || null).query(`
    SELECT TOP 1 LTRIM(RTRIM(shift)) AS shift, LTRIM(RTRIM(companycode)) AS companycode, starttime, endtime
    FROM dbo.tblshiftmaster WHERE LTRIM(RTRIM(shift)) = @shift
    ORDER BY CASE WHEN LTRIM(RTRIM(companycode)) = @companycode THEN 0 ELSE 1 END`);
  log('Savior truth => ' + JSON.stringify({ tblemployeeshiftmaster: dbShift, tblshiftmaster: dbSm.recordset?.[0] }));
  check('API shift matches Savior tblemployeeshiftmaster', dbShift && dbShift === emp.data?.shiftCode, `db=${dbShift} api=${emp.data?.shiftCode}`);

  // ---- 8. Register (stale) vs current shift - proves the root cause ----
  const tr = await pool.request().input('paycode', PAYCODE).query(`
    SELECT LTRIM(RTRIM(shift)) AS shift, COUNT(*) AS cnt
    FROM dbo.tbltimeregister
    WHERE LTRIM(RTRIM(paycode)) = @paycode AND dateoffice >= DATEADD(DAY, -45, CAST(GETDATE() AS date))
    GROUP BY LTRIM(RTRIM(shift))`);
  log('tbltimeregister (recent) shift values => ' + JSON.stringify(tr.recordset));
  const stale = (tr.recordset || []).some((x) => x.shift && x.shift !== dbShift);
  check('Root cause demonstrated: register carries a DIFFERENT (older) shift than the employee is assigned now', stale,
    `register=${JSON.stringify((tr.recordset || []).map((x) => x.shift))} current=${dbShift}`);

  // ---- E. Other employees (different shifts) + cross-company timing ----
  const othersQ = await pool.request().query(`
    SELECT TOP 8 LTRIM(RTRIM(e.paycode)) AS paycode, LTRIM(RTRIM(e.companycode)) AS companycode,
           LTRIM(RTRIM(s.shift)) AS shift
    FROM dbo.tblemployee e
    JOIN dbo.tblemployeeshiftmaster s ON LTRIM(RTRIM(s.paycode)) = LTRIM(RTRIM(e.paycode))
    WHERE LTRIM(RTRIM(s.shift)) IN ('GEE','GAU','GNN','GEF','GEM')
      AND LTRIM(RTRIM(e.active)) = 'Y'
    ORDER BY s.shift, e.paycode`);
  let otherChecked = 0;
  for (const o of (othersQ.recordset || [])) {
    const oe = await api('/employees/' + encodeURIComponent(o.paycode), { token });
    const okShift = oe.data?.shiftResolved === true && oe.data?.shiftCode === o.shift;
    const okCompany = String(oe.data?.shift?.companycode || '') === o.companycode;
    check(`Other employee ${o.paycode} resolves shift ${o.shift}`, okShift, `code=${oe.data?.shiftCode} start=${oe.data?.shiftStart} end=${oe.data?.shiftEnd}`);
    check(`No cross-company shift for ${o.paycode}`, okCompany, `shiftCompany=${oe.data?.shift?.companycode} empCompany=${o.companycode}`);
    otherChecked++;
  }
  log('other employees verified: ' + otherChecked);

  // GEN shift exists in MULTIPLE companies with different timings (001 -> 10:00, 002 -> 09:00).
  const g001 = await pool.request().query(`
    SELECT TOP 1 LTRIM(RTRIM(e.paycode)) AS paycode FROM dbo.tblemployee e
    JOIN dbo.tblemployeeshiftmaster s ON LTRIM(RTRIM(s.paycode)) = LTRIM(RTRIM(e.paycode))
    WHERE LTRIM(RTRIM(s.shift)) = 'GEN' AND LTRIM(RTRIM(e.companycode)) = '001' AND LTRIM(RTRIM(e.active)) = 'Y'`);
  const g002 = await pool.request().query(`
    SELECT TOP 1 LTRIM(RTRIM(e.paycode)) AS paycode FROM dbo.tblemployee e
    JOIN dbo.tblemployeeshiftmaster s ON LTRIM(RTRIM(s.paycode)) = LTRIM(RTRIM(e.paycode))
    WHERE LTRIM(RTRIM(s.shift)) = 'GEN' AND LTRIM(RTRIM(e.companycode)) = '002' AND LTRIM(RTRIM(e.active)) = 'Y'`);
  if (g001.recordset?.[0] && g002.recordset?.[0]) {
    const a1 = await api('/employees/' + encodeURIComponent(g001.recordset[0].paycode), { token });
    const a2 = await api('/employees/' + encodeURIComponent(g002.recordset[0].paycode), { token });
    check('Company 001 GEN timing = 10:00 AM', a1.data?.shiftStart === '10:00 AM', `start=${a1.data?.shiftStart}`);
    check('Company 002 GEN timing = 09:00 AM', a2.data?.shiftStart === '09:00 AM', `start=${a2.data?.shiftStart}`);
    check('Cross-company timing differs (001 vs 002)', a1.data?.shiftStart !== a2.data?.shiftStart, `001=${a1.data?.shiftStart} 002=${a2.data?.shiftStart}`);
  } else {
    log('(no GEN employees in both 001 and 002 to test cross-company timing)');
  }


  const summary = await api('/hr/summary?active=Y', { token });
  check('HR dashboard summary still works', summary.status === 200 && summary.data && typeof summary.data.totalstaff === 'number',
    `status=${summary.status} totalstaff=${summary.data?.totalstaff} late=${summary.data?.latetoday}`);
  check('Grace state still reported and intact (not reset by shift refresh)',
    !!audit.data?.graceRemaining && typeof audit.data.graceRemaining === 'object' && Array.isArray(audit.data?.lateDetails),
    `graceRemaining=${JSON.stringify(audit.data?.graceRemaining)} lateDetails=${(audit.data?.lateDetails || []).length}`);
  const hol = await api(`/employee/holidays?month=${month}`, { token: empToken });
  check('Employee holidays endpoint unaffected', hol.status === 200, `status=${hol.status}`);
  const gen = await api(`/attendance?fromDate=${month}-01&toDate=${month}-28`, { token: empToken });
  check('Legacy /attendance endpoint unaffected (200)', gen.status === 200 && Array.isArray(gen.data),
    `status=${gen.status} rows=${Array.isArray(gen.data) ? gen.data.length : 'n/a'}`);
  if (String(process.env.DEV_EMPLOYEE_AUTH_ENABLED).toLowerCase() === 'true' && process.env.DEV_EMPLOYEE_PAYCODE) {
    const dl = await api('/auth/employee/login', { method: 'POST', body: { paycode: process.env.DEV_EMPLOYEE_PAYCODE, password: process.env.DEV_EMPLOYEE_PASSWORD } });
    check('Employee login flow unaffected (dev fallback account)', dl.status === 200 && !!dl.data?.token, `status=${dl.status}`);
  } else {
    log('(DEV_EMPLOYEE_AUTH_ENABLED not true - employee login not exercised here; verified separately by HR/employee JWT paths)');
  }
  const saBad = await api('/auth/superadmin/login', { method: 'POST', body: { username: process.env.SUPERADMIN_USERNAME || 'x', password: 'wrong-password' } });
  check('SuperAdmin login endpoint alive and fails closed on a wrong password', saBad.status === 401, `status=${saBad.status}`);

  pool.close();
} catch (error) {
  log('ERROR: ' + (error && error.message ? error.message : error));
  check('verification completed without exception', false, String(error && error.message));
}

const passed = results.filter((r) => r.pass).length;
const failed = results.length - passed;
log('');
log(`=== SUMMARY: ${passed} PASS / ${failed} FAIL (of ${results.length}) ===`);
for (const r of results) log(`${r.pass ? 'PASS' : 'FAIL'} | ${r.name} | ${r.detail}`);

fs.writeFileSync('scripts/phase6-verify-out.txt', out.join('\n'), 'utf8');
console.log(out.join('\n'));
