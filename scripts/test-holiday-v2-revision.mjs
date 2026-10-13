// Phase G Revision - full holiday validation against the RUNNING API.
// Covers: schema normalization, real-category seeding, explicit-scope rules,
// duplicate rule (date AND company AND category), half-day duration, activate/
// deactivate, mobile-style payload compatibility, and the mandatory employee
// applicability matrix (WORKER@002 sees 17-09-2026 holiday; STAFF@002 does not;
// WORKER of another company does not).
// Run: node scripts/test-holiday-v2-revision.mjs   (server must be up on API_PORT)
import 'dotenv/config';
import jwt from 'jsonwebtoken';
import { getPool } from '../server/db.js';

const BASE = `http://localhost:${process.env.API_PORT || 4000}/api`;
const out = [];
let failures = 0;
const log = (ok, label, extra = '') => {
  if (ok === 'SKIP') { out.push(`SKIP  ${label}${extra ? ' :: ' + extra : ''}`); return; }
  out.push(`${ok ? 'PASS' : 'FAIL'}  ${label}${extra ? ' :: ' + extra : ''}`);
  if (!ok) failures += 1;
};

async function call(path, { method = 'GET', token, body, params } = {}) {
  const url = new URL(BASE + path);
  if (params) for (const [k, v] of Object.entries(params)) if (v !== undefined && v !== null) url.searchParams.set(k, v);
  const res = await fetch(url, {
    method,
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  let json = null;
  try { json = await res.json(); } catch { /* ignore */ }
  return { status: res.status, json };
}

// ---- HR session ------------------------------------------------------------
const HR = (await call('/auth/hr/login', { method: 'POST', body: { username: process.env.HR_USERNAME, password: process.env.HR_PASSWORD } })).json?.token;
log(!!HR, 'HR login');

// ---- Real category seeding -------------------------------------------------
const cats = await call('/hr/holidays/categories', { token: HR });
const catList = cats.json?.categories || [];
const catNames = catList.map(c => c.name);
log(['STAFF', 'WORKER', 'GUARD', 'PEON'].every(n => catNames.includes(n)),
  'Real dbo.tblcategory names seeded into HR_HolidayCategories',
  catNames.join(', '));
const workerId = catList.find(c => c.name === 'WORKER')?.id;

// ---- Legacy rows normalized (no data loss) ---------------------------------
const listed = await call('/hr/holidays', { token: HR });
const rows = listed.json?.holidays || [];
log(listed.status === 200 && rows.length >= 4
    && rows.every(h => typeof h.allCompanies === 'boolean' && typeof h.allCategories === 'boolean'
      && Array.isArray(h.companyCodes) && Array.isArray(h.categoryIds) && Array.isArray(h.categoryNames)),
  'GET /hr/holidays returns normalized V2 scope fields', `count=${rows.length}`);
const vish = rows.filter(h => String(h.holidaydate).startsWith('2026-09-17'));
log(vish.length === 2
    && vish.every(h => JSON.stringify(h.companyCodes) === JSON.stringify(['002', '003', '004']))
    && vish.some(h => h.categoryNames.includes('Factory Staff'))
    && vish.some(h => h.categoryNames.includes('Factory Worker')),
  'Legacy Vishwakarma rows preserved + normalized (companies 002,003,004)',
  JSON.stringify(vish.map(h => ({ id: h.id, companyCodes: h.companyCodes, categoryNames: h.categoryNames }))));
const universal = rows.filter(h => ['2026-08-15', '2026-10-02'].includes(String(h.holidaydate).slice(0, 10)));
log(universal.length === 2 && universal.every(h => h.allCompanies && h.allCategories),
  'Legacy All Employees rows -> All Companies + All Categories',
  JSON.stringify(universal.map(h => ({ id: h.id, allCompanies: h.allCompanies, allCategories: h.allCategories }))));
// ---- Explicit scope rules (no silent blank) --------------------------------
const blank = await call('/hr/holidays', { method: 'POST', token: HR, body: { holidaydate: '2026-11-01', holidayname: 'Blank Scope Probe' } });
log(blank.status === 400 && blank.json?.code === 'SCOPE_REQUIRED',
  'Blank scope rejected (blank never becomes unrestricted)', `status=${blank.status} code=${blank.json?.code}`);
const blankCompanies = await call('/hr/holidays', { method: 'POST', token: HR, body: { holidaydate: '2026-11-01', holidayname: 'Blank Companies Probe', allCompanies: false, companyCodes: [], allCategories: true } });
log(blankCompanies.status === 400 && blankCompanies.json?.code === 'COMPANY_SCOPE_REQUIRED',
  'allCompanies:false + empty list rejected', `code=${blankCompanies.json?.code}`);
const badHalf = await call('/hr/holidays', { method: 'POST', token: HR, body: { holidaydate: '2026-11-01', holidayname: 'Bad Half Probe', allCompanies: true, allCategories: true, duration: 'HALF_DAY' } });
log(badHalf.status === 400 && badHalf.json?.code === 'INVALID_HALF_DAY_SESSION',
  'HALF_DAY without session rejected', `code=${badHalf.json?.code}`);

// ---- Create the spec test holiday: 17-09-2026, company 002, category WORKER
const created = [];
const test1 = await call('/hr/holidays', {
  method: 'POST', token: HR,
  body: {
    holidaydate: '2026-09-17', holidayname: 'Revision Test Vishwakarma (WORKER 002)',
    description: 'Phase G Revision validation row',
    allCompanies: false, companyCodes: ['002'],
    allCategories: false, categoryNames: ['WORKER'],
    duration: 'FULL_DAY',
  },
});
log(test1.status === 201, 'POST restricted WORKER@002 holiday (17-09-2026)',
  `status=${test1.status} id=${test1.json?.holiday?.id} code=${test1.json?.code || ''} ${test1.json?.message || ''}`);
if (test1.json?.holiday?.id) created.push(test1.json.holiday.id);
const test1Id = test1.json?.holiday?.id;

if (test1Id) {
  log(test1.json.holiday.allCompanies === false
      && JSON.stringify(test1.json.holiday.companyCodes) === JSON.stringify(['002'])
      && JSON.stringify(test1.json.holiday.categoryNames) === JSON.stringify(['WORKER'])
      && test1.json.holiday.categoryIds?.length === 1
      && test1.json.holiday.category === 'WORKER'
      && test1.json.holiday.companycode === '002',
    'Created holiday stores explicit scope + legacy mirrors',
    JSON.stringify({ allCompanies: test1.json.holiday.allCompanies, companyCodes: test1.json.holiday.companyCodes, categoryNames: test1.json.holiday.categoryNames, categoryIds: test1.json.holiday.categoryIds, category: test1.json.holiday.category, companycode: test1.json.holiday.companycode }));

  const dup = await call('/hr/holidays', {
    method: 'POST', token: HR,
    body: { holidaydate: '2026-09-17', holidayname: 'Duplicate Probe', allCompanies: false, companyCodes: ['002'], allCategories: false, categoryNames: ['WORKER'] },
  });
  log(dup.status === 409 && dup.json?.code === 'DUPLICATE_HOLIDAY',
    'Duplicate (same date+company+category) -> 409', `status=${dup.status}`);
}

const otherScope = await call('/hr/holidays', {
  method: 'POST', token: HR,
  body: { holidaydate: '2026-09-17', holidayname: 'Revision Test GUARD@003', allCompanies: false, companyCodes: ['003'], allCategories: false, categoryNames: ['GUARD'] },
});
log(otherScope.status === 201, 'Same date + DIFFERENT scope allowed', `status=${otherScope.status} id=${otherScope.json?.holiday?.id}`);
if (otherScope.json?.holiday?.id) created.push(otherScope.json.holiday.id);

const halfDay = await call('/hr/holidays', {
  method: 'POST', token: HR,
  body: { holidaydate: '2026-09-18', holidayname: 'Revision Test Half Day STAFF@002', allCompanies: false, companyCodes: ['002'], allCategories: false, categoryNames: ['STAFF'], duration: 'HALF_DAY', halfDaySession: 'FIRST_HALF' },
});
log(halfDay.status === 201 && halfDay.json?.holiday?.duration === 'HALF_DAY' && halfDay.json?.holiday?.halfDaySession === 'FIRST_HALF',
  'HALF_DAY + FIRST_HALF stored', `status=${halfDay.status}`);
if (halfDay.json?.holiday?.id) created.push(halfDay.json.holiday.id);

// ---- Mobile-style payload compatibility ------------------------------------
if (workerId) {
  const mobile = await call('/hr/holidays', {
    method: 'POST', token: HR,
    body: {
      holidaydate: '2026-11-02', holidayname: 'Mobile Contract Probe',
      category: 'WORKER', categoryIds: JSON.stringify([workerId]),
      companycode: '', companyCodes: JSON.stringify(['002']),
      duration: 'FULL_DAY',
    },
  });
  log(mobile.status === 201 && JSON.stringify(mobile.json?.holiday?.categoryNames) === JSON.stringify(['WORKER']),
    'Mobile-style payload (categoryIds+companyCodes strings) accepted', `status=${mobile.status}`);
  if (mobile.json?.holiday?.id) created.push(mobile.json.holiday.id);
} else {
  log('SKIP', 'Mobile-style payload test (WORKER category id not found)');
}
// ---- Employee applicability matrix -----------------------------------------
const pool = await getPool();
const catRows = (await pool.request().query('SELECT * FROM dbo.tblcategory')).recordset;
const codeToName = new Map();
for (const r of catRows) {
  const keys = Object.keys(r);
  const codeKey = keys.find(k => /code/i.test(k)) || keys[0];
  const nameKey = keys.find(k => /name/i.test(k) && !/code/i.test(k));
  const code = String(r[codeKey] || '').trim();
  if (code) codeToName.set(code.toUpperCase(), String(r[nameKey] || code).trim().toUpperCase());
}
const empRows = (await pool.request().query(
  `SELECT LTRIM(RTRIM(paycode)) AS paycode, LTRIM(RTRIM(cat)) AS cat, LTRIM(RTRIM(companycode)) AS companycode
   FROM dbo.tblemployee WHERE LTRIM(RTRIM(active)) = 'Y'`)).recordset;
const nameOf = (code) => codeToName.get(String(code || '').trim().toUpperCase()) || '';
const empToken = (paycode) => jwt.sign(
  { sub: paycode, role: 'EMPLOYEE', paycode, devEmployee: true },
  process.env.JWT_SECRET, { expiresIn: '1h' });

const worker002 = empRows.find(e => nameOf(e.cat) === 'WORKER' && e.companycode === '002');
const staff002 = empRows.find(e => nameOf(e.cat) === 'STAFF' && e.companycode === '002');
const workerOther = empRows.find(e => nameOf(e.cat) === 'WORKER' && e.companycode !== '002');
const guard002 = empRows.find(e => nameOf(e.cat) === 'GUARD' && e.companycode === '002');
const staff002Half = halfDay.json?.holiday?.id;

const sees = async (emp, params, id) => {
  const r = await call('/employee/holidays', { token: empToken(emp.paycode), params });
  return { ok: r.status === 200 && (r.json?.holidays || []).some(h => Number(h.id) === Number(id)), status: r.status };
};

if (test1Id) {
  if (worker002) {
    const r = await sees(worker002, { date: '2026-09-17' }, test1Id);
    log(r.ok, `WORKER@${worker002.companycode} (${worker002.paycode}) SEES the WORKER holiday`, `status=${r.status}`);
    const rm = await sees(worker002, { month: '2026-09' }, test1Id);
    log(rm.ok, 'Same via ?month=2026-09 filter');
  } else log('SKIP', 'No active WORKER employee in company 002 found');
  if (staff002) {
    const r = await sees(staff002, { date: '2026-09-17' }, test1Id);
    log(!r.ok, `STAFF@002 (${staff002.paycode}) does NOT see WORKER holiday`, `status=${r.status}`);
  } else log('SKIP', 'No active STAFF employee in company 002 found');
  if (workerOther) {
    const r = await sees(workerOther, { date: '2026-09-17' }, test1Id);
    log(!r.ok, `WORKER@${workerOther.companycode} (${workerOther.paycode}) does NOT see other company's holiday`, `status=${r.status}`);
  } else log('SKIP', 'No active WORKER outside company 002 found');
  if (guard002) {
    const r = await sees(guard002, { date: '2026-09-17' }, test1Id);
    log(!r.ok, `GUARD@002 (${guard002.paycode}) does NOT see WORKER holiday`, `status=${r.status}`);
  } else log('SKIP', 'No active GUARD in company 002 found');
}
if (staff002 && staff002Half) {
  const r = await sees(staff002, { date: '2026-09-18' }, staff002Half);
  log(r.ok, 'STAFF@002 sees the HALF_DAY holiday for its scope', `status=${r.status}`);
}
if (worker002) {
  const r = await call('/employee/holidays', { token: empToken(worker002.paycode), params: { month: '2026-09' } });
  const keysOk = r.status === 200 && r.json && r.json.success === true && 'categoryCode' in r.json && 'categories' in r.json && Array.isArray(r.json.holidays);
  log(keysOk, 'Employee response keeps legacy keys (success/categoryCode/categories/holidays)');
}
// ---- PUT rules --------------------------------------------------------------
if (test1Id) {
  const halfOnFull = await call('/hr/holidays/' + test1Id, { method: 'PUT', token: HR, body: { halfDaySession: 'SECOND_HALF' } });
  log(halfOnFull.status === 400 && halfOnFull.json?.code === 'INVALID_HALF_DAY_SESSION',
    'PUT half-day session on FULL_DAY row rejected', `code=${halfOnFull.json?.code}`);

  const off = await call('/hr/holidays/' + test1Id, { method: 'PUT', token: HR, body: { active: false } });
  log(off.status === 200 && off.json?.holiday?.active === false, 'PUT deactivate (active-only payload) works');
  if (worker002) {
    const r = await sees(worker002, { date: '2026-09-17' }, test1Id);
    log(!r.ok, 'Deactivated holiday no longer visible to employee');
  }
  if (otherScope.json?.holiday?.id) {
    const clash = await call('/hr/holidays/' + otherScope.json.holiday.id, {
      method: 'PUT', token: HR,
      body: { allCompanies: false, companyCodes: ['002'], allCategories: false, categoryNames: ['WORKER'] },
    });
    log(clash.status === 409 && clash.json?.code === 'DUPLICATE_HOLIDAY',
      'PUT scope change colliding with ACTIVE duplicate -> 409', `status=${clash.status}`);
  }
  const back = await call('/hr/holidays/' + test1Id, { method: 'PUT', token: HR, body: { active: true } });
  log(back.status === 200 && back.json?.holiday?.active === true, 'PUT re-activate works');
  if (worker002 && back.status === 200) {
    const r = await sees(worker002, { date: '2026-09-17' }, test1Id);
    log(r.ok, 'Re-activated holiday visible again');
  }
}

// ---- cleanup: remove every test row created by THIS script ------------------
for (const id of created) {
  const d = await call('/hr/holidays/' + id, { method: 'DELETE', token: HR });
  log(d.status === 200, `Cleanup DELETE holiday id=${id}`, `status=${d.status}`);
}
await pool.close();

console.log(out.join('\n'));
console.log(`\n${failures === 0 ? 'ALL CHECKS PASSED' : failures + ' CHECK(S) FAILED'}`);
process.exit(failures === 0 ? 0 : 1);