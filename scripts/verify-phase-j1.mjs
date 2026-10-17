// Phase J.1 runtime verification - HR Leave UI data layer (Opening Balances CRUD,
// Leave Type lifecycle, compact employee-wise balances).
// Live checks against http://localhost:4000. Reads credentials from .env WITHOUT
// printing them. All test data is created and cleaned up within the run.
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

const todayIso = () => new Date().toISOString().slice(0, 10);
const YEAR = Number(todayIso().slice(0, 4));
const HR_USER = process.env.HR_USERNAME;
const HR_PASS = process.env.HR_PASSWORD;
if (!HR_USER || !HR_PASS) { console.error('HR credentials missing in .env'); process.exit(1); }

const hrLogin = await req('/auth/hr/login', { method: 'POST', body: { username: HR_USER, password: HR_PASS } });
const HR = hrLogin.json?.token;
check('0. HR Admin login', hrLogin.status === 200 && !!HR, `HTTP ${hrLogin.status}`);
if (!HR) process.exit(1);

// ---- Employee picker (real active roster, no hardcoded data) ----
const empsRes = await req('/hr/leave/employees', { token: HR });
const empList = empsRes.json?.employees || [];
check('1. Employee picker loads real active employees', empsRes.status === 200 && empList.length > 0, `employees=${empList.length}`);
const EMP = empList.find((e) => e.paycode === '0002') || empList[0];
const PAY = EMP?.paycode;
if (!PAY) { console.error('No employee to test with.'); process.exit(1); }

// ---- Test leave type (created + cleaned up) ----
const TESTTYPE = 'J1T';
await req(`/hr/leave/types/${TESTTYPE}`, { method: 'DELETE', token: HR }); // clear leftover
const addType = await req('/hr/leave/types', { method: 'POST', token: HR, body: { leavetype: TESTTYPE, typename: 'J1 Test Type', sortorder: 99 } });
check('2. Add leave type', addType.status === 200 || addType.status === 201, `HTTP ${addType.status}`);

// ---- Opening Balances CRUD (future year -> isolated from real data) ----
const OB_YEAR = YEAR + 20;
const addOb = await req('/hr/leave/opening-balances', { method: 'POST', token: HR, body: { paycode: PAY, leaveyear: OB_YEAR, leavetype: TESTTYPE, openingbalance: 7 } });
check('3. Add opening balance', addOb.status === 201 && addOb.json?.openingBalance?.created === true, `HTTP ${addOb.status} created=${addOb.json?.openingBalance?.created}`);

const list1 = await req(`/hr/leave/opening-balances?leaveyear=${OB_YEAR}`, { token: HR });
const rows1 = (list1.json?.rows || []).filter((r) => r.paycode === PAY && r.leavetype === TESTTYPE);
check('4. Entry persists after refetch (add)', rows1.length === 1 && Number(rows1[0].openingBalance) === 7, `rows=${rows1.length} amount=${rows1[0]?.openingBalance}`);

const updOb = await req('/hr/leave/opening-balances', { method: 'POST', token: HR, body: { paycode: PAY, leaveyear: OB_YEAR, leavetype: TESTTYPE, openingbalance: 12 } });
check('5. Duplicate (emp+year+type) -> update, not double', updOb.status === 200 && updOb.json?.openingBalance?.created === false, `HTTP ${updOb.status} created=${updOb.json?.openingBalance?.created}`);

const list2 = await req(`/hr/leave/opening-balances?leaveyear=${OB_YEAR}`, { token: HR });
const rows2 = (list2.json?.rows || []).filter((r) => r.paycode === PAY && r.leavetype === TESTTYPE);
check('6. Still one row + value updated after edit', rows2.length === 1 && Number(rows2[0].openingBalance) === 12, `rows=${rows2.length} amount=${rows2[0]?.openingBalance}`);
// ---- Validation ----
const negOb = await req('/hr/leave/opening-balances', { method: 'POST', token: HR, body: { paycode: PAY, leaveyear: OB_YEAR, leavetype: TESTTYPE, openingbalance: -5 } });
check('7. Negative opening balance rejected (400)', negOb.status === 400, `HTTP ${negOb.status} code=${negOb.json?.code}`);
const badTypeOb = await req('/hr/leave/opening-balances', { method: 'POST', token: HR, body: { paycode: PAY, leaveyear: OB_YEAR, leavetype: 'ZZZZ', openingbalance: 5 } });
check('8. Unknown leave type rejected (400)', badTypeOb.status === 400, `HTTP ${badTypeOb.status} code=${badTypeOb.json?.code}`);
const badEmpOb = await req('/hr/leave/opening-balances', { method: 'POST', token: HR, body: { paycode: 'NOSUCHEMP99', leaveyear: OB_YEAR, leavetype: TESTTYPE, openingbalance: 5 } });
check('9. Unknown employee rejected (404)', badEmpOb.status === 404, `HTTP ${badEmpOb.status} code=${badEmpOb.json?.code}`);

// ---- Delete + persistence ----
const rowId = rows2[0]?.id;
const delOb = await req(`/hr/leave/opening-balances/${rowId}`, { method: 'DELETE', token: HR });
check('10. Delete opening balance', delOb.status === 200 && delOb.json?.success === true, `HTTP ${delOb.status}`);
const list3 = await req(`/hr/leave/opening-balances?leaveyear=${OB_YEAR}`, { token: HR });
const rows3 = (list3.json?.rows || []).filter((r) => r.paycode === PAY && r.leavetype === TESTTYPE);
check('11. Entry removed after refetch (delete persists)', rows3.length === 0, `rows=${rows3.length}`);
const delMissing = await req(`/hr/leave/opening-balances/${rowId}`, { method: 'DELETE', token: HR });
check('12. Re-delete of removed entry -> 404 (no false success)', delMissing.status === 404, `HTTP ${delMissing.status}`);

// ---- Leave type lifecycle ----
const deact = await req(`/hr/leave/types/${TESTTYPE}/status`, { method: 'POST', token: HR, body: { active: false } });
check('13. Deactivate leave type', deact.status === 200 && deact.json?.leavetype?.active === false, `HTTP ${deact.status} active=${deact.json?.leavetype?.active}`);
const act = await req(`/hr/leave/types/${TESTTYPE}/status`, { method: 'POST', token: HR, body: { active: true } });
check('14. Activate leave type', act.status === 200 && act.json?.leavetype?.active === true, `HTTP ${act.status} active=${act.json?.leavetype?.active}`);
const delType = await req(`/hr/leave/types/${TESTTYPE}`, { method: 'DELETE', token: HR });
check('15. Delete UNUSED leave type succeeds', delType.status === 200 && delType.json?.success === true, `HTTP ${delType.status}`);
const delUsed = await req('/hr/leave/types/PL', { method: 'DELETE', token: HR });
check('16. Delete USED leave type blocked (409 TYPE_IN_USE)', delUsed.status === 409 && delUsed.json?.code === 'TYPE_IN_USE', `HTTP ${delUsed.status} code=${delUsed.json?.code}`);
const deactMissing = await req(`/hr/leave/types/${TESTTYPE}/status`, { method: 'POST', token: HR, body: { active: false } });
check('17. Status change of deleted type -> 404', deactMissing.status === 404, `HTTP ${deactMissing.status}`);

// ---- Compact employee-wise balances (Leave Balances tab data) ----
const bal = await req(`/hr/leave/balances?leaveyear=${YEAR}`, { token: HR });
const empsBal = bal.json?.employees || [];
check('18. Compact balances: employees list (one entry per employee)', bal.status === 200 && empsBal.length > 0, `employees=${empsBal.length}`);
const sample = empsBal.find((e) => e.paycode === PAY) || empsBal[0];
const hasTop = sample && ('employeecode' in sample) && ('totalAvailable' in sample) && ('paycode' in sample) && ('empname' in sample);
const hasType = sample && (sample.types || []).every((t) => ['leavetype', 'openingBalance', 'approvedUsed', 'pending', 'availableBalance'].every((k) => k in t));
check('19. Balance rows have employeecode/totalAvailable + per-type Opening/Used/Pending/Available', !!hasTop && !!hasType,
  `employeecode=${sample?.employeecode} totalAvailable=${sample?.totalAvailable} types=${sample?.types?.length}`);
const mathOk = sample && (sample.types || []).every((t) => Math.abs(Number(t.availableBalance) - (Number(t.openingBalance) - Number(t.approvedUsed) - Number(t.pending))) < 0.001);
check('20. Available = Opening - Approved - Pending (per type)', !!mathOk,
  sample ? sample.types.map((t) => `${t.leavetype}:${t.openingBalance}-${t.approvedUsed}-${t.pending}=${t.availableBalance}`).join(' ') : '');

const passed = results.filter((r) => r.ok).length;
console.log(`\n=== ${passed}/${results.length} J.1 checks passed ===`);
const failed = results.filter((r) => !r.ok);
if (failed.length) {
  console.log('FAILED:');
  failed.forEach((f) => console.log(' - ' + f.label + ' (' + f.detail + ')'));
}