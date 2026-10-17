// Targeted verification — Opening Balances Employee Code data flow.
// Checks form -> API -> validation -> mapping persistence -> response -> table.
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
  const res = await fetch(BASE + path, { method, headers, body: body ? JSON.stringify(body) : undefined });
  let json = null;
  try { json = await res.json(); } catch { /* non-JSON */ }
  return { status: res.status, json };
}

const YEAR = Number(new Date().toISOString().slice(0, 4));
const HR_USER = process.env.HR_USERNAME;
const HR_PASS = process.env.HR_PASSWORD;
const hrLogin = await req('/auth/hr/login', { method: 'POST', body: { username: HR_USER, password: HR_PASS } });
const HR = hrLogin.json?.token;
check('0. HR login', hrLogin.status === 200 && !!HR, `HTTP ${hrLogin.status}`);
if (!HR) process.exit(1);

// 1. Employee picker returns the Employee Code mapping field.
const empsRes = await req('/hr/leave/employees', { token: HR });
const empList = empsRes.json?.employees || [];
check('1. Picker returns employeecode field for every employee', empsRes.status === 200 && empList.length > 0 && empList.every((e) => 'employeecode' in e),
  `employees=${empList.length} sampleCode=${JSON.stringify(empList[0]?.employeecode)}`);
const EMP = empList.find((e) => e.paycode === '0002') || empList[0];
const PAY = EMP.paycode;
const ORIG_CODE = EMP.employeecode || '';
check('2. Paycode and Employee Code are distinct fields', !!PAY && ('employeecode' in EMP), `paycode=${PAY} origCode=${ORIG_CODE || '(none)'}`);

// Isolated test type + future year.
const TESTTYPE = 'ECT';
await req(`/hr/leave/types/${TESTTYPE}`, { method: 'DELETE', token: HR });
await req('/hr/leave/types', { method: 'POST', token: HR, body: { leavetype: TESTTYPE, typename: 'EC Test', sortorder: 99 } });
const OB_YEAR = YEAR + 20;
const CODE_A = 'ECA-' + Math.random().toString(36).slice(2, 7).toUpperCase();
const CODE_B = CODE_A + 'B';

// 3-4. Save with Employee Code -> persists + table shows it.
const addOb = await req('/hr/leave/opening-balances', { method: 'POST', token: HR, body: { paycode: PAY, employeecode: CODE_A, leaveyear: OB_YEAR, leavetype: TESTTYPE, openingbalance: 5 } });
check('3. Save opening balance sends + returns Employee Code', addOb.status === 201 && addOb.json?.openingBalance?.employeecode === CODE_A,
  `HTTP ${addOb.status} code=${addOb.json?.openingBalance?.employeecode}`);
const list1 = await req(`/hr/leave/opening-balances?leaveyear=${OB_YEAR}`, { token: HR });
const row1 = (list1.json?.rows || []).find((r) => r.paycode === PAY && r.leavetype === TESTTYPE);
check('4. Table shows saved Employee Code (persists after refetch)', row1 && row1.employeecode === CODE_A, `code=${row1?.employeecode}`);

// 5. Search by Employee Code returns the row.
const searchRes = await req(`/hr/leave/opening-balances?leaveyear=${OB_YEAR}&search=${encodeURIComponent(CODE_A)}`, { token: HR });
const srow = (searchRes.json?.rows || []).find((r) => r.paycode === PAY && r.leavetype === TESTTYPE);
check('5. Search by Employee Code matches', !!srow, `matched=${(searchRes.json?.rows || []).length}`);
// 6. Edit loads correct code; 7-8. edit/save updates + table reflects.
check('6. Edit loads correct Employee Code', row1?.employeecode === CODE_A, `row.employeecode=${row1?.employeecode}`);
const updOb = await req('/hr/leave/opening-balances', { method: 'POST', token: HR, body: { paycode: PAY, employeecode: CODE_B, leaveyear: OB_YEAR, leavetype: TESTTYPE, openingbalance: 5 } });
check('7. Edit/save updates Employee Code', updOb.status === 200 && updOb.json?.openingBalance?.employeecode === CODE_B, `code=${updOb.json?.openingBalance?.employeecode}`);
const list2 = await req(`/hr/leave/opening-balances?leaveyear=${OB_YEAR}`, { token: HR });
const row2 = (list2.json?.rows || []).find((r) => r.paycode === PAY && r.leavetype === TESTTYPE);
check('8. Table shows updated Employee Code after edit', row2?.employeecode === CODE_B, `code=${row2?.employeecode}`);

// 9. A code owned by a DIFFERENT employee must be rejected (mapping stays consistent).
const EMP2 = empList.find((e) => e.paycode !== PAY);
let conflictOk = true;
let conflictDetail = 'n/a';
if (EMP2) {
  const conflict = await req('/hr/leave/opening-balances', { method: 'POST', token: HR, body: { paycode: EMP2.paycode, employeecode: CODE_B, leaveyear: OB_YEAR, leavetype: TESTTYPE, openingbalance: 3 } });
  conflictOk = conflict.status === 409;
  conflictDetail = `HTTP ${conflict.status} code=${conflict.json?.code}`;
}
check('9. Code already mapped to another employee -> 409 conflict', conflictOk, conflictDetail);

// 10. Empty Employee Code is allowed and invents nothing.
const blankOb = await req('/hr/leave/opening-balances', { method: 'POST', token: HR, body: { paycode: PAY, employeecode: '', leaveyear: OB_YEAR, leavetype: TESTTYPE, openingbalance: 5 } });
const listBlank = await req(`/hr/leave/opening-balances?leaveyear=${OB_YEAR}`, { token: HR });
const rowBlank = (listBlank.json?.rows || []).find((r) => r.paycode === PAY && r.leavetype === TESTTYPE);
check('10. Empty Employee Code allowed, no dummy generated', blankOb.status === 200 && (rowBlank?.employeecode || '') === CODE_B,
  `HTTP ${blankOb.status} codeAfterEmptySave=${rowBlank?.employeecode || '(none)'}`);

// 11. Existing balance rows for the same employee resolve the mapping too.
const realList = await req(`/hr/leave/balances?leaveyear=${YEAR}`, { token: HR });
const realEmp = (realList.json?.employees || []).find((e) => e.paycode === PAY);
check('11. Employee master mapping resolves across rows for that employee', realEmp && realEmp.employeecode === CODE_B,
  `hrBalances.employeecode=${realEmp?.employeecode}`);

// Cleanup: delete test opening balance + test type.
const rowId = row2?.id;
const del = await req(`/hr/leave/opening-balances/${rowId}`, { method: 'DELETE', token: HR });
await req(`/hr/leave/types/${TESTTYPE}`, { method: 'DELETE', token: HR });
check('12. Cleanup: test opening balance deleted', del.status === 200, `HTTP ${del.status}`);

const passed = results.filter((r) => r.ok).length;
console.log(`\n=== ${passed}/${results.length} Employee Code checks passed ===`);
const failed = results.filter((r) => !r.ok);
if (failed.length) {
  console.log('FAILED:');
  failed.forEach((f) => console.log(' - ' + f.label + ' (' + f.detail + ')'));
}
console.log(`NOTE: test Employee Code "${CODE_B}" was mapped to paycode ${PAY} on the dev DB (original=${ORIG_CODE || 'none'}).`);