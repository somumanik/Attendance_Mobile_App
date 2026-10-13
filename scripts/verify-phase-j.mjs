// Phase J runtime regression - Employee Leave Management.
// Live end-to-end checks against http://localhost:4000. Reads credentials from
// .env WITHOUT printing them. Never logs secrets.
import 'dotenv/config';

const BASE = 'http://localhost:4000/api';
const results = [];
const check = (label, ok, detail = '') => {
  results.push({ label, ok, detail });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${detail ? ' -> ' + detail : ''}`);
};

async function req(path, { method = 'GET', token, body } = {}) {
  const headers = { 'Content-Type': 'application/json' };
  if (token) headers.Authorization = `Bearer ${token}`;
  const res = await fetch(BASE + path, {
    method, headers,
    body: body ? JSON.stringify(body) : undefined,
  });
  let json = null;
  try { json = await res.json(); } catch { /* non-JSON */ }
  return { status: res.status, json };
}

const addDays = (iso, days) => {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
};
const todayIso = () => new Date().toISOString().slice(0, 10);

const HR_USER = process.env.HR_USERNAME;
const HR_PASS = process.env.HR_PASSWORD;
if (!HR_USER || !HR_PASS) {
  console.error('HR credentials not configured in .env - cannot run scenario.');
  process.exit(1);
}
const YEAR = Number(todayIso().slice(0, 4));

/* ================= A. AUTH + ROLE GUARDS ================= */
const hrLogin = await req('/auth/hr/login', { method: 'POST', body: { username: HR_USER, password: HR_PASS } });
check('A1. HR Admin login', hrLogin.status === 200 && !!hrLogin.json?.token, `HTTP ${hrLogin.status}`);
const HR = hrLogin.json?.token;
if (!HR) process.exit(1);

/*
 * Pick a REAL active roster employee. The dev paycode (DEV_EMPLOYEE_PAYCODE)
 * is a UI-only identity and is NOT in dbo.tblemployee, so leave operations
 * correctly reject it with EMPLOYEE_NOT_FOUND. Prefer the established test
 * employee (TEST_PAYCODE / 0002 - already harness-owned), else the first
 * active roster entry, and give it a run-scoped password via HR.
 */
let EMP_CODE = null;
for (const page of [1, 2, 3]) {
  const roster = await req(`/hr/employees?page=${page}&pageSize=100`, { token: HR });
  const rows = roster.json?.rows || [];
  const wanted = process.env.TEST_PAYCODE || '0002';
  const hit = rows.find((r) => r.paycode === wanted) || (page === 3 ? rows.find((r) => r.active === 'Y') : null);
  if (hit) { EMP_CODE = hit.paycode; break; }
  if (rows.length < 100) break;
}
if (!EMP_CODE) {
  console.error('No active roster employee found - cannot run scenario.');
  process.exit(1);
}
const EMP_PASS = 'PhaseJ' + Math.random().toString(36).slice(2, 8) + '1';
const setPw = await req('/hr/employee/credentials/password', {
  method: 'POST', token: HR,
  body: { paycode: EMP_CODE, password: EMP_PASS, confirmPassword: EMP_PASS, mustChange: false },
});
check('A2. HR provisions run password for real roster employee', setPw.status === 200 && setPw.json?.success === true,
  `HTTP ${setPw.status} paycode=${EMP_CODE}`);

const empLogin = await req('/auth/employee/login', { method: 'POST', body: { paycode: EMP_CODE, password: EMP_PASS } });
check('A3. Employee login (real roster employee)', empLogin.status === 200 && !!empLogin.json?.token, `HTTP ${empLogin.status}`);
const EMP = empLogin.json?.token;
if (!EMP) process.exit(1);

const empMe = await req('/me', { token: EMP });
check('A4. Employee /me', empMe.status === 200 && empMe.json?.role === 'EMPLOYEE', `HTTP ${empMe.status}`);
const hrMe = await req('/me', { token: HR });
check('A5. HR /me', hrMe.status === 200 && hrMe.json?.role === 'HR', `HTTP ${hrMe.status}`);

const empToHr = await req('/hr/leave/requests', { token: EMP });
check('A6. Employee token blocked from HR leave routes', empToHr.status === 403 || empToHr.status === 401, `HTTP ${empToHr.status}`);
const hrToEmp = await req('/employee/leave/balance', { token: HR });
check('A7. HR token blocked from employee leave routes', hrToEmp.status === 403 || hrToEmp.status === 401, `HTTP ${hrToEmp.status}`);

/* ================= B. LEAVE TYPES + CONFIG ================= */
const empTypes = await req('/employee/leave/types', { token: EMP });
const typeCodes = (empTypes.json?.types || []).map((t) => String(t.leavetype).toUpperCase());
check('B1. Employee leave types load with 5 seeds',
  empTypes.status === 200 && ['PL', 'SL', 'CL', 'OLA', 'OLB'].every((c) => typeCodes.includes(c)),
  `HTTP ${empTypes.status} types=[${typeCodes.join(',')}]`);

const hrTypes = await req('/hr/leave/types?includeInactive=true', { token: HR });
check('B2. HR leave types (includeInactive)', hrTypes.status === 200 && Array.isArray(hrTypes.json?.types), `HTTP ${hrTypes.status}`);

const cfgGet = await req('/hr/leave/config', { token: HR });
check('B3. HR leave config GET', cfgGet.status === 200 && !!cfgGet.json?.config, `HTTP ${cfgGet.status}`);
const cfg = cfgGet.json?.config || {};
const curNeg = cfg.allowNegativeBalance === true || cfg.allowNegativeBalance === 'Y' || cfg.allowNegativeBalance === 1;
const cfgPut = await req('/hr/leave/config', { method: 'PUT', token: HR, body: { allowNegativeBalance: curNeg } });
check('B4. HR leave config PUT round-trip (no net change)', cfgPut.status === 200 && cfgPut.json?.success === true,
  `HTTP ${cfgPut.status} allowNegativeBalance kept=${curNeg}`);

/* ================= C. EXCEL IMPORT (validated server-side) ================= */
// Import 10 years so reruns (each may shift a request one year forward to dodge
// previously created Pending/Approved ranges) always find an imported balance.
const importYears = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9].map((d) => YEAR + d);
const importRows = importYears.flatMap((y) => ['PL', 'SL', 'CL'].map((t) => ({
  EmployeeCode: EMP_CODE, LeaveYear: y, LeaveType: t, OpeningBalance: 10,
})));
const imp = await req('/hr/leave/balances/import', { method: 'POST', token: HR, body: { rows: importRows } });
const impSum = imp.json?.summary || {};
check('C1. HR opening-balance import succeeds for real roster employee',
  imp.status === 200 && (impSum.imported || 0) + (impSum.updated || 0) + (impSum.skipped || 0) === 30 && (impSum.failed || 0) === 0,
  `HTTP ${imp.status} imported=${impSum.imported} updated=${impSum.updated} skipped=${impSum.skipped} failed=${impSum.failed}`);

const impBad = await req('/hr/leave/balances/import', { method: 'POST', token: HR, body: {
  rows: [
    { EmployeeCode: 'NO-SUCH-EMP-999', LeaveYear: YEAR, LeaveType: 'PL', OpeningBalance: 5 },
    { EmployeeCode: EMP_CODE, LeaveYear: YEAR, LeaveType: 'ZZZ', OpeningBalance: 5 },
    { EmployeeCode: EMP_CODE, LeaveYear: 'not-a-year', LeaveType: 'PL', OpeningBalance: 5 },
  ],
} });
const badSum = impBad.json?.summary || {};
check('C2. Unmatched employee / bad type / bad year reported Failed (never silently dropped)',
  impBad.status === 200 && badSum.failed === 3 && (badSum.imported || 0) === 0 && (badSum.updated || 0) === 0,
  `failed=${badSum.failed} errors=${(badSum.errors || []).length}`);


/* ================= D. EMPLOYEE BALANCE ================= */
const bal0 = await req('/employee/leave/balance', { token: EMP });
const balTypes = bal0.json?.types || [];
const pl = balTypes.find((t) => String(t.leavetype).toUpperCase() === 'PL') || {};
check('D1. Employee balance shape (Opening / Approved / Pending / Available)',
  bal0.status === 200 && bal0.json?.leaveyear === YEAR &&
  ['openingBalance', 'approvedUsed', 'pending', 'availableBalance'].every((k) => k in pl),
  `HTTP ${bal0.status} leaveyear=${bal0.json?.leaveyear} PL.opening=${pl.openingBalance} approved=${pl.approvedUsed} pending=${pl.pending} available=${pl.availableBalance}`);

/* ================= E. APPLY (server owns identity + day count) ================= */
/** Pick a date range with no live (Pending/Approved) overlap for this type. */
async function pickRange(type, fromIso, spanDays) {
  let from = fromIso;
  for (let i = 0; i < 20; i += 1) {
    const own = await req('/employee/leave/requests', { token: EMP });
    const clash = (own.json?.requests || []).some((r) =>
      String(r.leavetype).toUpperCase() === type &&
      ['Pending', 'Approved'].includes(r.status) &&
      !(r.todate < from || r.fromdate > addDays(from, spanDays)));
    if (!clash) break;
    from = addDays(from, 365);
  }
  return { from, to: addDays(from, spanDays) };
}

const full = await pickRange('PL', addDays(todayIso(), 45), 2);
const applyFull = await req('/employee/leave/requests', {
  method: 'POST', token: EMP,
  body: {
    leavetype: 'PL', fromdate: full.from, todate: full.to, isHalfDay: false,
    reason: 'Phase J regression: full-day leave', contactdetails: 'test-run',
    // Identity spoof attempt - server must ignore this and use the JWT.
    paycode: 'HACKER-CODE',
  },
});
const fullReq = applyFull.json?.request || {};
check('E1. Full-day apply succeeds, identity taken from JWT (paycode spoof ignored)',
  (applyFull.status === 201 || applyFull.status === 200) && applyFull.json?.success === true &&
  fullReq.paycode === EMP_CODE && fullReq.status === 'Pending' && Number(fullReq.days) > 0,
  `HTTP ${applyFull.status} paycode=${fullReq.paycode} days=${fullReq.days} status=${fullReq.status}`);
const fullId = fullReq.id;

const overlap = await req('/employee/leave/requests', {
  method: 'POST', token: EMP,
  body: { leavetype: 'PL', fromdate: full.from, todate: full.to, reason: 'overlap probe' },
});
check('E2. Overlapping request rejected (409 OVERLAPPING_REQUEST)',
  overlap.status === 409 && overlap.json?.code === 'OVERLAPPING_REQUEST',
  `HTTP ${overlap.status} code=${overlap.json?.code}`);

if (!curNeg) {
  const huge = await pickRange('PL', addDays(todayIso(), 300), 60);
  const insufficient = await req('/employee/leave/requests', {
    method: 'POST', token: EMP,
    body: {
      leavetype: 'PL', fromdate: huge.from, todate: huge.to, reason: 'over-balance probe',
      // Config requires an attachment above N days - supply it so the probe
      // reaches the balance rule instead of stopping at ATTACHMENT_REQUIRED.
      attachmentName: 'probe-medical-note.pdf',
    },
  });
  check('E3. Request beyond available balance rejected (INSUFFICIENT_BALANCE)',
    insufficient.status >= 400 && insufficient.status < 500 && insufficient.json?.code === 'INSUFFICIENT_BALANCE',
    `HTTP ${insufficient.status} code=${insufficient.json?.code}`);
} else {
  check('E3. Insufficient-balance probe skipped (AllowNegativeBalance is ON)', true, 'company config explicitly allows negative balance');
}

const half = await pickRange('SL', addDays(todayIso(), 55), 0);
// A shifted date may land on the employee's real week-off or on a half-day left
// by an earlier run; retry day-by-day until the server accepts the request.
let applyHalf = null;
let halfReq = {};
for (let attempt = 0; attempt < 8; attempt += 1) {
  const from = addDays(half.from, attempt);
  applyHalf = await req('/employee/leave/requests', {
    method: 'POST', token: EMP,
    body: { leavetype: 'SL', fromdate: from, todate: from, isHalfDay: true, halfdaypart: 'FN', reason: 'Phase J regression: half day' },
  });
  halfReq = applyHalf.json?.request || {};
  const code = applyHalf.json?.code;
  const retryable = (applyHalf.status === 400 && code === 'NO_WORKING_DAY')
    || (applyHalf.status === 409 && code === 'OVERLAPPING_REQUEST');
  if (!retryable) break;
}
check('E4. Half-day apply -> exactly 0.5 day',
  (applyHalf.status === 201 || applyHalf.status === 200) && Number(halfReq.days) === 0.5,
  `HTTP ${applyHalf.status} days=${halfReq.days}`);
const halfId = halfReq.id;

const rej = await pickRange('CL', addDays(todayIso(), 65), 1);
const applyRej = await req('/employee/leave/requests', {
  method: 'POST', token: EMP,
  body: { leavetype: 'CL', fromdate: rej.from, todate: rej.to, reason: 'Phase J regression: to be rejected' },
});
const rejReq = applyRej.json?.request || {};
check('E5. Second request (CL) created for reject flow', !!rejReq.id, `HTTP ${applyRej.status} id=${rejReq.id}`);
const rejId = rejReq.id;

// Stay inside the current leave year so the balance check is meaningful.
const can = await pickRange('CL', addDays(todayIso(), 75), 1);
const applyCan = await req('/employee/leave/requests', {
  method: 'POST', token: EMP,
  body: { leavetype: 'CL', fromdate: can.from, todate: can.to, reason: 'Phase J regression: to be cancelled' },
});
const canReq = applyCan.json?.request || {};
const canId = canReq.id;
check('E6. Third request (CL) created for cancel flow', !!canId, `HTTP ${applyCan.status} id=${canId}`);

/* ================= F. OWN-SCOPE / QUERY INJECTION ================= */
const listOwn = await req('/employee/leave/requests', { token: EMP });
const ownList = listOwn.json?.requests || [];
check('F1. Employee request list returns only own paycode',
  listOwn.status === 200 && ownList.length > 0 && ownList.every((r) => r.paycode === EMP_CODE),
  `count=${ownList.length} paycodes=${[...new Set(ownList.map((r) => r.paycode))].join(',')}`);

const crossList = await req('/employee/leave/requests?paycode=OTHER-EMPLOYEE&status=Approved', { token: EMP });
const crossArr = crossList.json?.requests || [];
check('F2. Query-string paycode is ignored (identity always from JWT)',
  crossList.status === 200 && crossArr.every((r) => r.paycode === EMP_CODE),
  `returned=${crossArr.length} paycodes=${[...new Set(crossArr.map((r) => r.paycode))].join(',')}`);

const crossBal = await req('/employee/leave/balance?paycode=OTHER-EMPLOYEE', { token: EMP });
check('F3. Balance query paycode ignored (200, own data only)',
  crossBal.status === 200 && !JSON.stringify(crossBal.json || {}).includes('OTHER-EMPLOYEE'),
  `HTTP ${crossBal.status}`);

/* ================= G. HR QUEUE + DECISIONS ================= */
const hrPending = await req('/hr/leave/requests?status=Pending', { token: HR });
const pend = hrPending.json?.requests || [];
const findReq = (id) => pend.find((r) => r.id === id);
check('G1. HR pending queue contains our requests',
  hrPending.status === 200 && !!findReq(fullId) && !!findReq(halfId) && !!findReq(rejId),
  `pending=${pend.length} counts=${JSON.stringify(hrPending.json?.counts || {})}`);

const approve = await req(`/hr/leave/requests/${fullId}/decision`, { method: 'POST', token: HR, body: { decision: 'Approved', note: 'Phase J regression approve' } });
check('G2. HR approves full-day request',
  approve.status === 200 && approve.json?.request?.status === 'Approved' && !!approve.json?.request?.decidedby,
  `HTTP ${approve.status} status=${approve.json?.request?.status}`);

const decideAgain = await req(`/hr/leave/requests/${fullId}/decision`, { method: 'POST', token: HR, body: { decision: 'Rejected' } });
check('G3. Deciding a non-pending request rejected', decideAgain.status >= 400 && decideAgain.status < 500, `HTTP ${decideAgain.status} code=${decideAgain.json?.code}`);

const reject = await req(`/hr/leave/requests/${rejId}/decision`, { method: 'POST', token: HR, body: { decision: 'Rejected', note: 'Phase J regression reject' } });
check('G4. HR rejects second request',
  reject.status === 200 && reject.json?.request?.status === 'Rejected',
  `HTTP ${reject.status} status=${reject.json?.request?.status}`);

const badDecision = await req(`/hr/leave/requests/${halfId}/decision`, { method: 'POST', token: HR, body: { decision: 'Whatever' } });
check('G5. Invalid decision value rejected', badDecision.status >= 400 && badDecision.status < 500, `HTTP ${badDecision.status}`);

/* ================= H. CANCEL (employee, own-pending only) ================= */
const cancel = await req(`/employee/leave/requests/${canId}/cancel`, { method: 'POST', token: EMP });
check('H1. Employee cancels own pending request', cancel.status === 200 && cancel.json?.success === true, `HTTP ${cancel.status}`);

const cancelTwice = await req(`/employee/leave/requests/${canId}/cancel`, { method: 'POST', token: EMP });
check('H2. Re-cancel rejected (only pending cancellable)', cancelTwice.status >= 400 && cancelTwice.status < 500, `HTTP ${cancelTwice.status}`);

const cancelApproved = await req(`/employee/leave/requests/${fullId}/cancel`, { method: 'POST', token: EMP });
check('H3. Employee cannot cancel an APPROVED request', cancelApproved.status === 404, `HTTP ${cancelApproved.status}`);

const cancelOther = await req('/employee/leave/requests/99999999/cancel', { method: 'POST', token: EMP });
check('H4. Cannot cancel a request that is not theirs / does not exist', cancelOther.status === 404, `HTTP ${cancelOther.status}`);


/* ================= I. BALANCE MATH + CALENDAR OVERLAY ================= */
// Evaluate balance math in the leave year the approved request belongs to.
const balYear = Number(full.from.slice(0, 4));
const bal1 = await req(`/employee/leave/balance?leaveyear=${balYear}`, { token: EMP });
const pl1 = (bal1.json?.types || []).find((t) => String(t.leavetype).toUpperCase() === 'PL') || {};
const cl1 = (bal1.json?.types || []).find((t) => String(t.leavetype).toUpperCase() === 'CL') || {};
check('I1. Approved leave now counted in approvedUsed',
  bal1.status === 200 && Number(pl1.approvedUsed) >= Number(fullReq.days || 0),
  `PL approvedUsed=${pl1.approvedUsed} (approved days=${fullReq.days}) available=${pl1.availableBalance}`);
check('I2. Cancelled + rejected requests do not consume balance',
  bal1.status === 200 && Number(cl1.pending) === 0,
  `CL pending=${cl1.pending} approvedUsed=${cl1.approvedUsed}`);

const cal = await req(`/employee/leave/calendar?from=${full.from}&to=${full.to}`, { token: EMP });
const calDates = Array.isArray(cal.json?.dates) ? cal.json?.dates : [];
const coversApproved = calDates.some((d) => (d.leaves || []).some((l) => l.id === fullId && String(l.leavetype).toUpperCase() === 'PL'));
check('I3. Attendance calendar overlay shows the APPROVED leave',
  cal.status === 200 && calDates.length > 0 && coversApproved &&
  calDates.every((d) => d.date >= full.from && d.date <= full.to),
  `HTTP ${cal.status} dates=${calDates.length} coversApproved=${coversApproved}`);

const listAfter = await req('/employee/leave/requests', { token: EMP });
const statuses = Object.fromEntries((listAfter.json?.requests || [])
  .filter((r) => [fullId, halfId, rejId, canId].includes(r.id)).map((r) => [r.id, r.status]));
check('I4. Final states: Approved / Pending / Rejected / Cancelled',
  statuses[fullId] === 'Approved' && statuses[halfId] === 'Pending' && statuses[rejId] === 'Rejected' && statuses[canId] === 'Cancelled',
  JSON.stringify(statuses));

/* ================= J. HR BALANCES VIEW ================= */
const hrBal = await req(`/hr/leave/balances?leaveyear=${YEAR}`, { token: HR });
const hrEmp = (hrBal.json?.employees || []).find((e) => e.paycode === EMP_CODE);
check('J1. HR balances view shows the imported employee',
  hrBal.status === 200 && !!hrEmp && Array.isArray(hrEmp.types) && hrEmp.types.length >= 3,
  `employees=${(hrBal.json?.employees || []).length} types=${hrEmp ? hrEmp.types.length : 0}`);

const hrSearch = await req(`/hr/leave/requests?leaveyear=${YEAR}&search=${EMP_CODE}`, { token: HR });
check('J2. HR request search by paycode works',
  hrSearch.status === 200 && (hrSearch.json?.requests || []).length > 0,
  `matches=${(hrSearch.json?.requests || []).length}`);

/* ================= K. PROTECTED-MODULE REGRESSION ================= */
const hrEmps = await req('/hr/employees?pageSize=3', { token: HR });
check('K1. HR employees list (protected module)', hrEmps.status === 200, `HTTP ${hrEmps.status}`);
const hrHol = await req('/hr/holidays?month=2026-10', { token: HR });
check('K2. HR Holiday Management (protected module)', hrHol.status === 200, `HTTP ${hrHol.status}`);
const empHol = await req('/employee/holidays?month=2026-10', { token: EMP });
check('K3. Employee holidays (protected module)', empHol.status === 200, `HTTP ${empHol.status}`);
const empDash = await req('/employee/dashboard', { token: EMP });
const dashOk = empDash.status === 200 || ['PIN_SETUP_REQUIRED', 'PASSWORD_CHANGE_REQUIRED'].includes(empDash.json?.code);
check('K4. Employee dashboard reachable (200 or active auth gate)', dashOk, `HTTP ${empDash.status} code=${empDash.json?.code}`);
const empCred = await req(`/hr/employee/credentials?paycode=${EMP_CODE}`, { token: HR });
check('K5. HR credentials module (protected module)', empCred.status === 200, `HTTP ${empCred.status}`);

/* ================= SUMMARY ================= */
const failed = results.filter((r) => !r.ok);
console.log(`\n=== ${results.length - failed.length}/${results.length} checks passed ===`);
if (failed.length) {
  console.log('FAILED:');
  failed.forEach((f) => console.log(` - ${f.label} (${f.detail})`));
}
process.exit(failed.length ? 1 : 0);


