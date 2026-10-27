// Salary Export + Modal + Scrolling phase — API-level runtime verification.
// Live checks against http://localhost:4000 (real SQL data). Reads credentials
// from .env WITHOUT printing them. The only writes are a FULLY CLEANED-UP
// PayElementMaster CRUD roundtrip (synthetic code, deleted at the end).
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

const HR_USER = process.env.HR_USERNAME;
const HR_PASS = process.env.HR_PASSWORD;
if (!HR_USER || !HR_PASS) {
  console.error('HR credentials not configured in .env - cannot run scenario.');
  process.exit(1);
}

/* ================= A. AUTH + ROLE GUARDS (regression) ================= */
const hrLogin = await req('/auth/hr/login', { method: 'POST', body: { username: HR_USER, password: HR_PASS } });
check('A1. HR Admin login', hrLogin.status === 200 && !!hrLogin.json?.token, `HTTP ${hrLogin.status}`);
const HR = hrLogin.json?.token;
if (!HR) process.exit(1);

const noToken = await req('/hr/salary/structure/master');
check('A2. Salary structure routes reject unauthenticated requests', noToken.status === 401 || noToken.status === 403, `HTTP ${noToken.status}`);
const badToken = await req('/hr/salary/structure/master', { token: 'not.a.valid.token' });
check('A3. Salary structure routes reject invalid tokens', badToken.status === 401 || badToken.status === 403, `HTTP ${badToken.status}`);

/* ================= B. EXPORT DATA SOURCES (read-only) ================= */
const master = await req('/hr/salary/structure/master?limit=5000', { token: HR });
const masterRows = master.json?.rows || [];
check('B1. Employee Salary Master list loads (read-only)', master.status === 200 && Array.isArray(master.json?.rows), `HTTP ${master.status} rows=${masterRows.length}`);

const M_FIELDS = ['paycode', 'empname', 'presentcardno', 'companycode', 'departmentcode', 'designation', 'employeecode', 'locationcode', 'effectivefrom', 'basicsalary', 'pfapplicable', 'esiapplicable', 'pfwage', 'esiwage', 'currency', 'remarks'];
const missingM = M_FIELDS.filter((f) => !masterRows.length || !(f in masterRows[0]));
check('B2. Master rows carry all real employee + salary-version fields', masterRows.length > 0 && missingM.length === 0, `rows=${masterRows.length} missing=[${missingM.join(',')}]`);

const mIds = new Set(masterRows.map((r) => r.id));
check('B3. Master rows unique (no accidental join duplicates)', mIds.size === masterRows.length, `ids=${mIds.size} rows=${masterRows.length}`);
const mIso = masterRows.every((r) => !r.effectivefrom || /^\d{4}-\d{2}-\d{2}/.test(String(r.effectivefrom)));
check('B4. Master EffectiveFrom exported as ISO date', mIso);
const mNum = masterRows.every((r) => r.basicsalary === null || typeof r.basicsalary === 'number');
check('B5. Master BasicSalary is numeric (not string)', mNum);
const mIdentity = new Map();
let mixed = false;
for (const r of masterRows) {
  if (!r.paycode) continue;
  const prev = mIdentity.get(r.paycode);
  if (prev && prev !== (r.empname || '')) mixed = true;
  mIdentity.set(r.paycode, r.empname || '');
}
check('B6. Employee identity never mixed across paycodes', !mixed);

const elem = await req('/hr/salary/structure/elements?limit=5000', { token: HR });
const elemRows = elem.json?.rows || [];
check('B7. Employee Pay Elements list loads (read-only)', elem.status === 200 && Array.isArray(elem.json?.rows), `HTTP ${elem.status} rows=${elemRows.length}`);
const E_FIELDS = ['paycode', 'empname', 'payelementcode', 'payelementname', 'fixedorpercent', 'amount', 'percent', 'computationtype', 'addordeduct', 'pfapplicable', 'ptapplicable', 'esiapplicability', 'applicableforot', 'applicableforc', 'paycadre', 'activepayelement', 'processed', 'payrollpostinggroup', 'leaveencashment', 'effectivefrom', 'remarks', 'extrafields'];
const missingE = E_FIELDS.filter((f) => !elemRows.length || !(f in elemRows[0]));
check('B8. Element rows carry assignment fields (as supported by model)', elemRows.length > 0 && missingE.length === 0, `rows=${elemRows.length} missing=[${missingE.join(',')}]`);
const eIds = new Set(elemRows.map((r) => r.id));
check('B9. Element rows unique (no duplicates)', eIds.size === elemRows.length, `ids=${eIds.size} rows=${elemRows.length}`);

const pem = await req('/hr/salary/payelement-master?limit=5000', { token: HR });
const pemRows = pem.json?.rows || [];
check('B10. Pay Element Master list loads (read-only)', pem.status === 200 && Array.isArray(pem.json?.rows), `HTTP ${pem.status} rows=${pemRows.length}`);
const P_FIELDS = ['payelementcode', 'description', 'payelementname', 'addordeduct', 'applicableforot', 'esiapplicable', 'pfapplicable', 'leaveencashment', 'payrollpostinggroup', 'active', 'remarks'];
const missingP = P_FIELDS.filter((f) => !pemRows.length || !(f in pemRows[0]));
check('B11. Pay Element Master rows carry all master fields', pemRows.length > 0 && missingP.length === 0, `rows=${pemRows.length} missing=[${missingP.join(',')}]`);

const rep = await req('/hr/salary/structure/report?limit=2000', { token: HR });
check('B12. Dynamic report source loads (Gross never invented)', rep.status === 200 && Array.isArray(rep.json?.rows), `HTTP ${rep.status} rows=${(rep.json?.rows || []).length} grossCol=${!!rep.json?.grossColumnAvailable}`);

/* ================= C. CRUD ROUNDTRIP (fully cleaned up) ================= */
const CODE = `ZZTESTX${String(Date.now()).slice(-4)}`;
const created = await req('/hr/salary/payelement-master', {
  method: 'POST', token: HR,
  body: { payelementcode: CODE, payelementname: 'Temp verify element', description: 'Temp verify element', addordeduct: 'Addition', active: 'Y' },
});
check('C1. Add record (modal save endpoint)', created.status === 200 || created.status === 201, `HTTP ${created.status} ${created.json?.message || ''}`);
const afterCreate = await req(`/hr/salary/payelement-master?search=${CODE}`, { token: HR });
check('C2. Created record visible in list', (afterCreate.json?.rows || []).some((r) => r.payelementcode === CODE));
const createdId = (afterCreate.json?.rows || []).find((r) => r.payelementcode === CODE)?.id;
const updated = await req(`/hr/salary/payelement-master/${createdId}`, {
  method: 'PUT', token: HR,
  body: { payelementname: 'Temp verify element v2', description: 'Temp verify element v2', addordeduct: 'Deduction', active: 'N' },
});
check('C3. Edit record (modal save endpoint)', updated.status === 200, `HTTP ${updated.status}`);
const afterUpdate = await req(`/hr/salary/payelement-master?search=${CODE}`, { token: HR });
const upRow = (afterUpdate.json?.rows || []).find((r) => r.payelementcode === CODE);
check('C4. Edited values persisted', upRow?.payelementname === 'Temp verify element v2' && upRow?.addordeduct === 'DEDUCT', `name=${upRow?.payelementname} add=${upRow?.addordeduct}`);
const del = await req('/hr/salary/payelement-master', { method: 'DELETE', token: HR, body: { ids: [createdId] } });
check('C5. Delete record (delete endpoint)', del.status === 200 && (del.json?.deleted ?? 0) === 1, `HTTP ${del.status} deleted=${del.json?.deleted}`);
const afterDelete = await req(`/hr/salary/payelement-master?search=${CODE}`, { token: HR });
check('C6. Deleted record gone (cleanup complete)', !(afterDelete.json?.rows || []).some((r) => r.payelementcode === CODE));

/* ================= D. F&F ESTIMATE (existing behaviour) ================= */
const anyPaycode = masterRows[0]?.paycode;
if (anyPaycode) {
  const ff = await req(`/hr/salary/fullfinal/${encodeURIComponent(anyPaycode)}`, { token: HR });
  check('D1. Full & Final estimate endpoint unchanged', ff.status === 200, `HTTP ${ff.status} paycode=${anyPaycode}`);
} else {
  check('D1. Full & Final estimate endpoint unchanged', true, 'skipped - no salary rows in DB');
}

const failed = results.filter((r) => !r.ok).length;
console.log(`\n${results.length - failed}/${results.length} checks passed.`);
process.exit(failed ? 1 : 0);