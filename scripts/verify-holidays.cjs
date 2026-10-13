// FILE: scripts/verify-holidays.cjs
// Phase G FINAL runtime verification for Holiday Management (LIVE backend).
// Creates TEMPORARY test holidays and DELETES them in the finally block.
// Usage: node scripts/verify-holidays.cjs
const fs = require('fs');
const path = require('path');
const jwt = require('jsonwebtoken');

const ROOT = path.resolve(__dirname, '..');
const BASE = process.env.API_BASE || 'http://localhost:4000';

function loadEnv() {
  const file = path.join(ROOT, '.env');
  const out = {};
  if (!fs.existsSync(file)) return out;
  for (const line of fs.readFileSync(file, 'utf8').split(/\r?\n/)) {
    const m = /^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/.exec(line);
    if (m) out[m[1]] = m[2];
  }
  return out;
}
const env = loadEnv();

async function call(method, url, { token, body } = {}) {
  const headers = { 'Content-Type': 'application/json' };
  if (token) headers.Authorization = `Bearer ${token}`;
  try {
    const res = await fetch(BASE + url, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
    const text = await res.text();
    let data;
    try { data = JSON.parse(text); } catch { data = text; }
    return { status: res.status, data };
  } catch (e) {
    return { status: 0, data: String(e) };
  }
}

let passCount = 0;
let failCount = 0;
const failures = [];
function check(name, cond, detail = '') {
  if (cond) { passCount += 1; console.log(`  PASS  ${name}`); }
  else { failCount += 1; failures.push(name); console.log(`  FAIL  ${name}${detail ? ` -> ${detail}` : ''}`); }
}
function section(title) { console.log(`\n=== ${title}`); }

// Test-only employee identity: same signing scheme + secret the server uses,
// aimed at a REAL dbo.tblemployee paycode. No credential row is created.
const mintEmployeeToken = (paycode) => jwt.sign(
  { sub: paycode, role: 'EMPLOYEE', paycode, devEmployee: false },
  env.JWT_SECRET,
  { expiresIn: '1h' },
);

// Same date map the mobile HR calendar builds (holidayByDate).
function buildHolidayByDate(holidays) {
  const map = new Map();
  for (const h of holidays) {
    const key = String(h.holidaydate || '').slice(0, 10);
    if (!key) continue;
    const list = map.get(key) || [];
    list.push(h);
    map.set(key, list);
  }
  return map;
}

(async () => {
  const createdIds = [];
  try {
    section('A/B - Logins (HR Admin + Employee)');
    const hrBad = await call('POST', '/api/auth/hr/login', { body: { username: env.HR_USERNAME, password: 'WRONG-PASSWORD-XYZ' } });
    check('HR login rejects bad password', hrBad.status === 401 || hrBad.status === 403 || hrBad.status === 400, `status ${hrBad.status}`);
    const hr = await call('POST', '/api/auth/hr/login', { body: { username: env.HR_USERNAME, password: env.HR_PASSWORD } });
    const hrToken = hr.data && hr.data.token;
    check('HR Admin login works (real HR001)', hr.status === 200 && Boolean(hrToken), `status ${hr.status}`);
    if (!hrToken) throw new Error('HR login failed - cannot continue');
    const empBad = await call('POST', '/api/auth/employee/login', { body: { paycode: env.DEV_EMPLOYEE_PAYCODE, password: 'WRONG' } });
    check('Employee login rejects bad password', empBad.status >= 400 && empBad.status < 500, `status ${empBad.status}`);
    const emp = await call('POST', '/api/auth/employee/login', { body: { paycode: env.DEV_EMPLOYEE_PAYCODE, password: env.DEV_EMPLOYEE_PASSWORD } });
    const devToken = emp.data && emp.data.token;
    check(`Employee login works (real ${env.DEV_EMPLOYEE_PAYCODE})`, emp.status === 200 && Boolean(devToken), `status ${emp.status}`);
    section('C - REAL company + category master');
    const filters = await call('GET', '/api/hr/filters', { token: hrToken });
    const companies = (filters.data && filters.data.companies) || [];
    const catMaster = (filters.data && filters.data.categories) || [];
    const catName = new Map(catMaster.map((c) => [c.code, c.name]));
    check('GET /api/hr/filters returns companies', companies.length >= 4, `got ${companies.length}`);
    check('GET /api/hr/filters returns category master', catMaster.length >= 1, `got ${catMaster.length}`);
    const byWord = (w) => companies.find((c) => String(c.name).toUpperCase().includes(w));
    const office = (byWord('OFFICE') || {}).code;
    const b36 = (byWord('B-36') || {}).code;
    const a11 = (byWord('A-11') || {}).code;
    const bara = (byWord('BARA') || {}).code;
    console.log(`  companies: ${companies.map((c) => `${c.code}=${c.name}`).join(' | ')}`);
    console.log(`  category master: ${catMaster.map((c) => `${c.code}=${c.name}`).join(' | ')}`);
    check('Found the 4 real MOHANI TEA companies dynamically', Boolean(office && b36 && a11 && bara),
      `office=${office} b36=${b36} a11=${a11} bara=${bara}`);

    section('D/F - Dynamic category multi-select after company selection');
    const hcOffice = await call('GET', `/api/hr/holiday-categories?companies=${office}`, { token: hrToken });
    const hcUnion = await call('GET', `/api/hr/holiday-categories?companies=${[b36, a11, bara].join(',')}`, { token: hrToken });
    check('Category endpoint returns 200 (root-cause fix: was 503)', hcOffice.status === 200, `status ${hcOffice.status}`);
    const officeCats = (hcOffice.data.categories || []).map((c) => c.code);
    const unionCats = (hcUnion.data.categories || []).map((c) => c.code);
    const unionPairs = hcUnion.data.pairs || [];
    check('TC1: OFFICE has >=1 real category', officeCats.length >= 1, JSON.stringify(hcOffice.data.categories));
    check('Union categories have NO duplicates', new Set(unionCats).size === unionCats.length);
    check('Every returned pair belongs to a requested company',
      unionPairs.every((p) => [b36, a11, bara].includes(p.companycode)), JSON.stringify(unionPairs));
    check('Union pairs cover every returned category',
      unionCats.every((code) => unionPairs.some((p) => p.categorycode === code)));
    console.log(`  OFFICE categories : ${officeCats.map((c) => catName.get(c) || c).join(', ')}`);
    console.log(`  B-36+A-11+BARA    : ${unionCats.map((c) => catName.get(c) || c).join(', ')}`);
    check('TC3: union == distinct categories of the real pair set',
      unionCats.length >= 1 && JSON.stringify([...unionCats].sort()) === JSON.stringify([...new Set(unionPairs.map((p) => p.categorycode))].sort()));

    const staffCat = unionCats.find((c) => (catName.get(c) || '').toUpperCase() === 'STAFF') || officeCats[0];
    const workerCat = unionCats.find((c) => (catName.get(c) || '').toUpperCase() === 'WORKER') || unionCats.find((c) => c !== staffCat);
    check('Real STAFF + WORKER categories discovered from data (no hardcoding)',
      Boolean(staffCat && workerCat && catName.get(workerCat)), `staff=${staffCat} worker=${workerCat}`);

    section('K/12 - Existing holiday records (baseline snapshot)');
    const before = await call('GET', '/api/hr/holidays', { token: hrToken });
    check('GET /api/hr/holidays returns 200 (root-cause fix: schema ensured)', before.status === 200, `status ${before.status}`);
    const baseline = (before.data.holidays || []);
    check('Baseline has the existing records', baseline.length >= 4, `got ${baseline.length}`);
    check('Holiday dates serialise as plain YYYY-MM-DD (no timezone shift)',
      baseline.every((h) => /^\d{4}-\d{2}-\d{2}$/.test(String(h.holidaydate))),
      JSON.stringify(baseline.map((h) => h.holidaydate)));
    console.log('  baseline: ' + baseline.map((h) => `${h.id}|${h.holidayname}|${h.holidaydate}`).join(' ; '));
    check('Independence Day preserved', baseline.some((h) => /independ/i.test(h.holidayname)));
    check('VishKarma Puja records preserved', baseline.filter((h) => /vishkarma/i.test(h.holidayname)).length >= 1);
    section('TC4/28 - Invalid company/category combination rejected');
    const notInOffice = unionCats.find((c) => !officeCats.includes(c));
    if (notInOffice) {
      const bad = await call('POST', '/api/hr/holidays', {
        token: hrToken,
        body: {
          holidaydate: '2026-09-30', holidayname: 'PHASE-G NEGATIVE TEST',
          companies: [office], categories: [notInOffice], isHalfDay: false,
        },
      });
      check(`OFFICE + ${catName.get(notInOffice) || notInOffice} (impossible) rejected with 400`,
        bad.status === 400 && ['NO_VALID_PAIRS', 'CATEGORY_REQUIRED'].includes(bad.data.code), `status ${bad.status} ${JSON.stringify(bad.data)}`);
    } else {
      console.log('  NOTE: every category exists in OFFICE in this dataset - skipping impossible-pair negative case');
    }

    // TC4: OFFICE+B-36 selected with STAFF+WORKER must SAVE, but WITHOUT an
    // (OFFICE, WORKER) pair when no OFFICE employee is a WORKER.
    const pairRes = await call('POST', '/api/hr/holidays', {
      token: hrToken,
      body: {
        holidaydate: '2026-09-29', holidayname: 'PHASE-G PAIR TEST',
        companies: [office, b36].filter(Boolean),
        categories: [staffCat, workerCat].filter(Boolean),
        description: 'temporary - deleted by verify script',
        isHalfDay: false, active: true,
      },
    });
    check('TC4: OFFICE+B-36 x STAFF+WORKER selection accepted', pairRes.status === 201, JSON.stringify(pairRes.data));
    const pairHolidayId = pairRes.data && pairRes.data.holiday && pairRes.data.holiday.id;
    if (pairHolidayId) {
      createdIds.push(pairHolidayId);
      const realPairsAll = [...(hcOffice.data.pairs || []), ...unionPairs];
      const savedPairs = (pairRes.data.holiday.companyCategoryPairs || []);
      const key = (p) => `${p.companycode}|${p.categorycode}`;
      check('Saved pairs are REAL employee pairs (subset of real data)',
        savedPairs.every((p) => realPairsAll.some((r) => key(r) === key(p))), JSON.stringify(savedPairs));
      if (office && workerCat && !officeCats.includes(workerCat)) {
        check('INVALID (OFFICE, WORKER) pair NOT saved even though both were selected',
          !savedPairs.some((p) => p.companycode === office && p.categorycode === workerCat), JSON.stringify(savedPairs));
      }
      check('VALID (B-36, WORKER) pair IS saved',
        !workerCat || !b36 || savedPairs.some((p) => p.companycode === b36 && p.categorycode === workerCat), JSON.stringify(savedPairs));
      check('Every selected company has >=1 saved pair',
        [office, b36].filter(Boolean).every((c) => savedPairs.some((p) => p.companycode === c)));
    }

    section('TC5 - Create 17-Sep-2026 VishKarma Puja (B-36+A-11+BARA x STAFF+WORKER)');
    const mainRes = await call('POST', '/api/hr/holidays', {
      token: hrToken,
      body: {
        holidaydate: '2026-09-17', holidayname: 'VishKarma Puja',
        companies: [b36, a11, bara].filter(Boolean),
        categories: [staffCat, workerCat].filter(Boolean),
        description: 'Phase G final test holiday - removed by verify script',
        isHalfDay: false, active: true,
      },
    });
    check('Save returns 201', mainRes.status === 201, JSON.stringify(mainRes.data));
    const mainHoliday = mainRes.data && mainRes.data.holiday;
    if (mainHoliday && mainHoliday.id) createdIds.push(mainHoliday.id);
    if (mainHoliday) {
      const wanted = [b36, a11, bara].filter(Boolean);
      const wantedCats = [staffCat, workerCat].filter(Boolean);
      const expected = unionPairs.filter((p) => wanted.includes(p.companycode) && wantedCats.includes(p.categorycode));
      const key = (p) => `${p.companycode}|${p.categorycode}`;
      check('Saved pairs == REAL pairs INTERSECT (companies x categories)',
        JSON.stringify((mainHoliday.companyCategoryPairs || []).map(key).sort()) === JSON.stringify(expected.map(key).sort()),
        `saved=${JSON.stringify(mainHoliday.companyCategoryPairs)} expected=${JSON.stringify(expected)}`);
      check('Derived category label non-empty and <= 50 chars',
        Boolean(mainHoliday.category) && String(mainHoliday.category).length <= 50, String(mainHoliday.category));
      check('Full Day saved as Full Day', mainHoliday.isHalfDay === false, JSON.stringify(mainHoliday.isHalfDay));
      console.log(`  created holiday #${mainHoliday.id} category="${mainHoliday.category}" pairs=${(mainHoliday.companyCategoryPairs || []).length}`);
    }
    section('P/12/13 - HR Admin calendar data (all saved holidays, unfiltered)');
    const afterSave = await call('GET', '/api/hr/holidays', { token: hrToken });
    const list = afterSave.data.holidays || [];
    check('Holiday list loads after save', afterSave.status === 200 && list.length >= baseline.length + 1);
    const byDate = buildHolidayByDate(list);
    check('17-Sep-2026 resolves on the HR calendar date map (purple marker key)',
      (byDate.get('2026-09-17') || []).some((h) => h.id === (mainHoliday && mainHoliday.id)), JSON.stringify([...byDate.keys()]));
    check('15-Aug-2026 Independence Day still marked', (byDate.get('2026-08-15') || []).length >= 1);
    check('HR calendar is NOT company-filtered (admin sees every saved record)',
      list.some((h) => h.id === (mainHoliday && mainHoliday.id)) && list.some((h) => /independ/i.test(h.holidayname)));
    for (const [month, day] of [['2026-08', '2026-08-15'], ['2026-09', '2026-09-17'], ['2026-10', '2026-10-02']]) {
      const r = await call('GET', `/api/hr/holidays?month=${month}`, { token: hrToken });
      check(`HR month navigation ${month}: only that month returned`,
        r.status === 200 && (r.data.holidays || []).every((h) => String(h.holidaydate).startsWith(month)),
        JSON.stringify((r.data.holidays || []).map((h) => h.holidaydate)));
      check(`HR month ${month} contains ${day}`, (r.data.holidays || []).some((h) => h.holidaydate === day));
    }

    section('TC6/TC7/Q/R - Employee visibility by REAL company + category');
    const findEmp = async (companycode, cat) => {
      const r = await call('GET', `/api/hr/employees?companycode=${encodeURIComponent(companycode)}&cat=${encodeURIComponent(cat)}&pageSize=1&active=ALL`, { token: hrToken });
      return (r.data && r.data.rows && r.data.rows[0]) || null;
    };
    const empB36Worker = b36 && workerCat ? await findEmp(b36, workerCat) : null;
    const empB36Staff = b36 && staffCat ? await findEmp(b36, staffCat) : null;
    const empOfficeStaff = office && officeCats[0] ? await findEmp(office, officeCats[0]) : null;
    console.log(`  real employees: B-36/${workerCat}=${empB36Worker && empB36Worker.paycode} B-36/${staffCat}=${empB36Staff && empB36Staff.paycode} OFFICE/${officeCats[0]}=${empOfficeStaff && empOfficeStaff.paycode}`);
    const viewHolidays = (paycode, month) => call('GET', `/api/employee/holidays?month=${month}`, { token: mintEmployeeToken(paycode) });

    if (empB36Worker) {
      const r = await viewHolidays(empB36Worker.paycode, '2026-09');
      const ids = ((r.data && r.data.holidays) || []).map((h) => h.id);
      check(`TC6: B-36 + ${catName.get(workerCat) || workerCat} employee (${empB36Worker.paycode}) SEES 17-Sep holiday`,
        r.status === 200 && ids.includes(mainHoliday && mainHoliday.id), `status ${r.status} ids=${JSON.stringify(ids)}`);
    } else console.log('  NOTE: no real B-36 WORKER employee in data - TC6 skipped');

    if (empB36Staff) {
      const r = await viewHolidays(empB36Staff.paycode, '2026-09');
      const ids = ((r.data && r.data.holidays) || []).map((h) => h.id);
      check(`B-36 + ${catName.get(staffCat) || staffCat} employee (${empB36Staff.paycode}) SEES 17-Sep holiday`,
        r.status === 200 && ids.includes(mainHoliday && mainHoliday.id), `status ${r.status} ids=${JSON.stringify(ids)}`);
    } else console.log('  NOTE: no real B-36 STAFF employee in data - check skipped');

    if (empOfficeStaff) {
      const r = await viewHolidays(empOfficeStaff.paycode, '2026-09');
      const ids = ((r.data && r.data.holidays) || []).map((h) => h.id);
      check(`TC7: OFFICE employee (${empOfficeStaff.paycode}) does NOT see the B-36/A-11/BARA holiday`,
        r.status === 200 && !ids.includes(mainHoliday && mainHoliday.id), `status ${r.status} ids=${JSON.stringify(ids)}`);
    } else console.log('  NOTE: no real OFFICE employee in data - TC7 skipped');

    if (devToken) {
      const r = await call('GET', '/api/employee/holidays?month=2026-09', { token: devToken });
      check('Employee holiday endpoint 200 for dev employee (root-cause fix: was 503)', r.status === 200, `status ${r.status}`);
    }
    const anyEmpPaycode = (empB36Worker || empOfficeStaff || { paycode: env.DEV_EMPLOYEE_PAYCODE }).paycode;
    const anyEmpToken = mintEmployeeToken(anyEmpPaycode);
    for (const month of ['2026-08', '2026-09', '2026-10']) {
      const r = await call('GET', `/api/employee/holidays?month=${month}`, { token: anyEmpToken });
      const rows = (r.data && r.data.holidays) || [];
      check(`Employee month ${month}: 200 + exact dates + only that month`,
        r.status === 200 && rows.every((h) => /^\d{4}-\d{2}-\d{2}$/.test(String(h.holidaydate)) && String(h.holidaydate).startsWith(month)),
        `status ${r.status} ${JSON.stringify(rows.map((h) => h.holidaydate))}`);
    }
    section('TC9/TC10 - Half Day + Full Day persistence');
    const halfRes = await call('POST', '/api/hr/holidays', {
      token: hrToken,
      body: {
        holidaydate: '2026-09-18', holidayname: 'PHASE-G HALFDAY TEST',
        companies: [b36].filter(Boolean), categories: [staffCat].filter(Boolean),
        isHalfDay: true, halfdaypart: 'AN', active: true,
        description: 'temporary - deleted by verify script',
      },
    });
    check('Half Day holiday saved (201)', halfRes.status === 201, JSON.stringify(halfRes.data));
    const halfId = halfRes.data && halfRes.data.holiday && halfRes.data.holiday.id;
    if (halfId) {
      createdIds.push(halfId);
      let r = await call('GET', '/api/hr/holidays', { token: hrToken });
      let row = (r.data.holidays || []).find((h) => h.id === halfId);
      check('TC9: Half Day remains Half Day after reload', row && row.isHalfDay === true && row.halfdaypart === 'AN', JSON.stringify(row));
      const upd = await call('PUT', `/api/hr/holidays/${halfId}`, { token: hrToken, body: { isHalfDay: false, halfdaypart: '' } });
      check('Edit -> Full Day returns 200', upd.status === 200, JSON.stringify(upd.data));
      r = await call('GET', '/api/hr/holidays', { token: hrToken });
      row = (r.data.holidays || []).find((h) => h.id === halfId);
      check('TC10: Full Day remains Full Day after reload', row && row.isHalfDay === false, JSON.stringify(row));
      const upd2 = await call('PUT', `/api/hr/holidays/${halfId}`, { token: hrToken, body: { isHalfDay: true, halfdaypart: 'FN' } });
      check('Edit -> Half Day (First Half) returns 200', upd2.status === 200, JSON.stringify(upd2.data));
      r = await call('GET', '/api/hr/holidays', { token: hrToken });
      row = (r.data.holidays || []).find((h) => h.id === halfId);
      check('Half Day + First Half persists after reload', row && row.isHalfDay === true && row.halfdaypart === 'FN', JSON.stringify(row));
    }

    if (pairHolidayId) {
      const t1 = await call('PUT', `/api/hr/holidays/${pairHolidayId}`, { token: hrToken, body: { active: false } });
      check('Deactivate toggle works', t1.status === 200 && t1.data.holiday.active === false, JSON.stringify(t1.data));
      const r1 = await call('GET', '/api/hr/holidays?active=N', { token: hrToken });
      check('Inactive holiday listed under filter N', (r1.data.holidays || []).some((h) => h.id === pairHolidayId));
      const t2 = await call('PUT', `/api/hr/holidays/${pairHolidayId}`, { token: hrToken, body: { active: true } });
      check('Activate toggle works', t2.status === 200 && t2.data.holiday.active === true, JSON.stringify(t2.data));
    }

    section('N/TC8/19 - Delete works and PERSISTS after reload');
    // Same request the mobile Delete button sends (web uses window.confirm).
    if (halfId) {
      const d = await call('DELETE', `/api/hr/holidays/${halfId}`, { token: hrToken });
      check('DELETE returns 200 {success:true} (root-cause fix: was 503)', d.status === 200 && d.data.success === true, `status ${d.status} ${JSON.stringify(d.data)}`);
      const r = await call('GET', '/api/hr/holidays', { token: hrToken });
      check('Deleted holiday gone after RELOAD (persistent)', !(r.data.holidays || []).some((h) => h.id === halfId));
      check('Other holidays untouched by delete',
        (r.data.holidays || []).some((h) => h.id === (mainHoliday && mainHoliday.id))
        && (r.data.holidays || []).filter((h) => /independ|vishkarma|gandhi/i.test(h.holidayname)).length >= 4);
      const empR = await call('GET', '/api/employee/holidays?month=2026-09', { token: anyEmpToken });
      check('Deleted holiday no longer active in employee view', !(empR.data.holidays || []).some((h) => h.id === halfId));
    }
    const d404 = await call('DELETE', '/api/hr/holidays/999999', { token: hrToken });
    check('DELETE of unknown id -> 404 (route + handler alive)', d404.status === 404, `status ${d404.status}`);

    section('10/11 - Manual Categories / Group Mapping management removed');
    const c1 = await call('GET', '/api/hr/holidays/categories', { token: hrToken });
    const c2 = await call('POST', '/api/hr/holidays/categories', { token: hrToken, body: { categoryname: 'X' } });
    const c3 = await call('GET', '/api/hr/holidays/category-map', { token: hrToken });
    const c4 = await call('PUT', '/api/hr/holidays/category-map', { token: hrToken, body: { categorycode: '001', holidaycategory: 'X' } });
    check('GET manual categories endpoint removed (404)', c1.status === 404, `status ${c1.status}`);
    check('POST manual categories endpoint removed (404)', c2.status === 404, `status ${c2.status}`);
    check('GET group-map endpoint removed (404)', c3.status === 404, `status ${c3.status}`);
    // The old PUT category-map handler is gone: the request now falls through to
    // PUT /api/hr/holidays/:id with :id='category-map' (NaN) -> 400 INVALID_ID.
    check('PUT group-map management handler removed (falls through to :id -> 400 INVALID_ID)',
      c4.status === 400 && c4.data && c4.data.code === 'INVALID_ID', `status ${c4.status} ${JSON.stringify(c4.data)}`);

    section('Security - employee tokens cannot write holidays');
    if (devToken) {
      const w = await call('POST', '/api/hr/holidays', { token: devToken, body: { holidaydate: '2026-09-20', holidayname: 'X', companies: [office], categories: [officeCats[0]], isHalfDay: false } });
      check('Employee token gets 403 on HR write', w.status === 403, `status ${w.status}`);
      const badHr = await call('GET', '/api/hr/holidays', { token: devToken });
      check('Employee token gets 403 on HR list', badHr.status === 403, `status ${badHr.status}`);
    }
  } catch (e) {
    failCount += 1;
    failures.push(`UNEXPECTED: ${e.message}`);
    console.error('\nUNEXPECTED ERROR:', e);
  } finally {
    section('CLEANUP - removing temporary test holidays');
    const hrLogin = await call('POST', '/api/auth/hr/login', { body: { username: env.HR_USERNAME, password: env.HR_PASSWORD } });
    const cleanupToken = hrLogin.data && hrLogin.data.token;
    for (const id of createdIds) {
      const d = await call('DELETE', `/api/hr/holidays/${id}`, { token: cleanupToken });
      console.log(`  deleted test holiday #${id} -> ${d.status}`);
    }
    const r = await call('GET', '/api/hr/holidays', { token: cleanupToken });
    const finalList = (r.data && r.data.holidays) || [];
    const leftovers = finalList.filter((h) => /PHASE-G/i.test(h.holidayname));
    check('No PHASE-G test holidays left behind', leftovers.length === 0, JSON.stringify(leftovers.map((h) => h.holidayname)));
    check('All original holidays still present after cleanup',
      finalList.some((h) => /independ/i.test(h.holidayname))
      && finalList.some((h) => /vishkarma/i.test(h.holidayname))
      && finalList.some((h) => /gandhi/i.test(h.holidayname)),
      JSON.stringify(finalList.map((h) => `${h.id}|${h.holidayname}|${h.holidaydate}`)));
    console.log('  final list: ' + finalList.map((h) => `${h.id}|${h.holidayname}|${h.holidaydate}|active=${h.active}|half=${h.isHalfDay}`).join(' ; '));
  }

  console.log(`\n================ RESULT: ${passCount} passed, ${failCount} failed ================`);
  if (failures.length) console.log('Failures:\n - ' + failures.join('\n - '));
  process.exit(failCount ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
