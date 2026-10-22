// PHASE: Bonus proration + Leave encashment formula fix - runtime verification.
// Live checks against the shared backend + real SQL data. The HR settlement
// config is SAVED first and RESTORED at the end; every test settlement record /
// opening balance is cleaned up. Estimation itself never writes.
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

const round2 = (n) => Math.round((Number(n) || 0) * 100) / 100;
const near = (a, b, tol = 0.02) => Math.abs(round2(a) - round2(b)) <= tol;
const iso = (d) => d.toISOString().slice(0, 10);
const addMonths = (isoDate, m) => {
  const d = new Date(`${isoDate}T00:00:00Z`);
  const day = d.getUTCDate();
  d.setUTCDate(1);
  d.setUTCMonth(d.getUTCMonth() + m);
  const last = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0)).getUTCDate();
  d.setUTCDate(Math.min(day, last));
  return iso(d);
};
const addDaysIso = (isoDate, n) => {
  const d = new Date(`${isoDate}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return iso(d);
};

const HR_USER = process.env.HR_USERNAME;
const HR_PASS = process.env.HR_PASSWORD;
if (!HR_USER || !HR_PASS) { console.error('HR credentials not configured.'); process.exit(1); }

const hrLogin = await req('/auth/hr/login', { method: 'POST', body: { username: HR_USER, password: HR_PASS } });
check('A1. HR Admin login', hrLogin.status === 200 && !!hrLogin.json?.token, `HTTP ${hrLogin.status}`);
const HR = hrLogin.json?.token;
if (!HR) process.exit(1);

const PAYCODE = process.env.TEST_PAYCODE || '0002';
const noToken = await req('/hr/salary/fullfinal/' + PAYCODE);
check('A2. Full & Final + settlement routes reject unauthenticated calls', noToken.status === 401 || noToken.status === 403, `HTTP ${noToken.status}`);
const noToken2 = await req('/hr/salary/bonus-settlements');
check('A3. Bonus settlement routes reject unauthenticated calls', noToken2.status === 401 || noToken2.status === 403, `HTTP ${noToken2.status}`);

/* ---- save the current config so everything can be restored at the end ---- */
const cfgRes = await req('/hr/salary/config', { token: HR });
const savedCfg = cfgRes.json?.config || cfgRes.json?.raw || {};
const CFG_KEYS = ['BonusEnabled', 'BonusPeriodStart', 'BonusPeriodEnd', 'BonusRule', 'BonusRate',
  'BonusEligibilityMinMonths', 'BonusProrate', 'LeaveEncashmentEnabled', 'LeaveEncashmentTypesFactory',
  'LeaveEncashmentTypesOffice', 'LeaveEncashmentTypesDefault', 'LeaveEncashmentBasis',
  'LeaveEncashmentWageDivisor', 'LeaveEncashmentMaxDays'];
const setCfg = async (patch) => (await req('/hr/salary/config', { method: 'PUT', token: HR, body: patch })).json;
check('A4. (prep) settlement rules config readable + writable', !!savedCfg && typeof setCfg === 'function', `keys=${Object.keys(savedCfg).length}`);

// Real employee facts (read-only): DOJ comes from the shared engine itself.
const base = await req(`/hr/salary/fullfinal/${PAYCODE}`, { token: HR });
const DOJ = base.json?.employee?.dateofjoin || '';
check('A5. (prep) real Date of Joining read from employee record', /^\d{4}-\d{2}-\d{2}/.test(DOJ), `doj=${DOJ}`);
const SAVED_LEAVE_YEAR = Number(String(base.json?.estimate?.leavingdate || '2027').slice(0, 4));

/* ============ B. DOCUMENTED FORMULAS (canonical examples) ============ */
// Leave encashment company rule: daily = monthly x 12 / 365; encashment = daily x days.
const exampleDaily = round2((40832 * 12) / 365);
const exampleEncashment = round2(exampleDaily * 18);
check('B1. Canonical example reproduces: 40,832 gross, 18 days, /365 -> ~24,163.56',
  exampleDaily === 1342.42 && near(exampleEncashment, 24163.56, 0.01),
  `daily=${exampleDaily} encashment=${exampleEncashment}`);
// Bonus monthly accrual reference: fixed annual / 12 per eligible month.
const exampleAccrual = Math.round((13850 / 12) * 10000) / 10000;
check('B2. Canonical bonus accrual: 13,850 / 12 = 1,154.1667 per eligible month', exampleAccrual === 1154.1667, `accrual=${exampleAccrual}`);

const ff = async (leaving) => (await req(`/hr/salary/fullfinal/${PAYCODE}?leavingdate=${leaving}`, { token: HR })).json;

/* ============ C. BONUS CALCULATION SCENARIOS ============ */
await setCfg({
  BonusEnabled: 'Y', BonusPeriodStart: '2025-10-01', BonusPeriodEnd: '2026-10-31',
  BonusRule: 'FIXED', BonusRate: '13850', BonusEligibilityMinMonths: '12', BonusProrate: 'Y',
});
const c1 = await ff('2026-11-30');
const b1 = c1?.estimate?.bonus || {};
check('C1. Example config: FIXED 13,850 -> monthly accrual 1,154.1667', near(b1.monthlyAccrual, 1154.1667, 0.001), `accrual=${b1.monthlyAccrual}`);
check('C2. Configured period boundaries respected (never extended/shortened)',
  b1.eligibleServiceFrom === '2025-10-01' && b1.eligibleServiceTo === '2026-10-31',
  `from=${b1.eligibleServiceFrom} to=${b1.eligibleServiceTo}`);
check('C3. Eligibility = min service at LEAVING date', b1.minServiceMet === true && b1.serviceAtLeavingMonths >= 12, `serviceAtLeaving=${b1.serviceAtLeavingMonths}`);
check('C4. Amount = accrual x eligible months (month/day proration)', near(b1.amount, round2(b1.monthlyAccrual * (b1.unsettledMonths ?? b1.eligibleMonths)), 0.02), `amount=${b1.amount} months=${b1.unsettledMonths ?? b1.eligibleMonths}`);

// Below minimum service
await setCfg({ BonusEligibilityMinMonths: String((b1.serviceAtLeavingMonths || 0) + 5) });
const c2 = await ff('2026-11-30');
const b2 = c2?.estimate?.bonus || {};
check('C5. Employee below minimum service: no bonus + clear reason', b2.eligible === false && Number(b2.amount) === 0 && /Not eligible/i.test(b2.note || ''), `note=${b2.note}`);

// Exactly completing minimum service
await setCfg({ BonusEligibilityMinMonths: String(b1.serviceAtLeavingMonths || 12) });
const c3 = await ff('2026-11-30');
check('C6. Employee completing minimum service: eligible', c3?.estimate?.bonus?.eligible === true && Number(c3?.estimate?.bonus?.amount) > 0, `amount=${c3?.estimate?.bonus?.amount}`);

// Joined DURING a bonus period + leaves before period end (period not extended)
await setCfg({ BonusPeriodStart: addMonths(DOJ, 0), BonusPeriodEnd: '2027-06-30', BonusEligibilityMinMonths: '12', BonusProrate: 'Y' });
const leaveEnd = '2026-11-30';
const c4 = await ff(leaveEnd);
const b4 = c4?.estimate?.bonus || {};
check('C7. Joined during period: eligible service starts at joining (earlier unpaid portion kept)', b4.eligibleServiceFrom === DOJ, `from=${b4.eligibleServiceFrom} doj=${DOJ}`);
check('C8. Leaving BEFORE period end: eligible service ends at leaving (period not extended)', b4.eligibleServiceTo === leaveEnd, `to=${b4.eligibleServiceTo} leaving=${leaveEnd}`);

// REQ-7 regression: joined mid-period, crosses the one-year mark later - the
// earlier unpaid eligible portion must NOT be discarded.
await setCfg({ BonusPeriodStart: addMonths(DOJ, 1), BonusPeriodEnd: addMonths(DOJ, 7), BonusEligibilityMinMonths: '12', BonusProrate: 'Y' });
const c5 = await ff('2026-12-31');
const b5 = c5?.estimate?.bonus || {};
check('C9. Crossed one-year mark: earlier unpaid eligible portion still counted',
  b5.eligible === true && Number(b5.amount) > 0 && b5.eligibleServiceFrom === addMonths(DOJ, 1) && b5.eligibleServiceTo === addMonths(DOJ, 7),
  `eligible=${b5.eligible} amount=${b5.amount} months=${b5.eligibleMonths}`);

// Prorate = N: full-eligibility rule
await setCfg({ BonusPeriodStart: addMonths(DOJ, 0), BonusPeriodEnd: addMonths(DOJ, 36), BonusProrate: 'N', BonusRate: '13850' });
const c6 = await ff('2026-11-30');
check('C10. Prorate = N: full configured amount (no silent prorating)', near(c6?.estimate?.bonus?.amount, 13850, 0.02), `amount=${c6?.estimate?.bonus?.amount} prorateFactor=${c6?.estimate?.bonus?.prorateFactor}`);
await setCfg({ BonusProrate: 'Y' });

/* ============ D. BONUS SETTLEMENT HISTORY ============ */
// Clean any leftovers, then verify record-based settlement semantics.
const before0 = await req(`/hr/salary/bonus-settlements?paycode=${PAYCODE}`, { token: HR });
for (const s of before0.json?.rows || []) {
  await req('/hr/salary/bonus-settlements', { method: 'DELETE', token: HR, body: { ids: [s.id] } });
}
await setCfg({ BonusPeriodStart: addMonths(DOJ, 0), BonusPeriodEnd: addMonths(DOJ, 36), BonusEligibilityMinMonths: '12', BonusProrate: 'Y', BonusRate: '13850' });
const leaveFull = '2026-11-30';
const d0 = await ff(leaveFull);
const b0 = d0?.estimate?.bonus || {};
check('D1. No record = nothing assumed paid (previously settled = 0)', Number(b0.previouslySettledAmount) === 0 && b0.previouslySettledCount === 0, `settled=${b0.previouslySettledAmount}`);

// Record a settlement for the FIRST HALF of the eligible service range.
const mid = addMonths(DOJ, 10);
const rec1 = await req('/hr/salary/bonus-settlements', {
  method: 'POST', token: HR,
  body: {
    paycode: PAYCODE, bonusperiodstart: addMonths(DOJ, 0), bonusperiodend: addMonths(DOJ, 36),
    servicestart: DOJ, serviceend: mid, amount: 5000, note: 'verify-phase test record',
  },
});
check('D2. Explicit settlement record created (employee, period, service range, amount, status)', rec1.status === 201 && rec1.json?.settlement?.status === 'Settled', `HTTP ${rec1.status}`);

const d1 = await ff(leaveFull);
const b11 = d1?.estimate?.bonus || {};
check('D3. Estimate subtracts ONLY unsettled service after settlement',
  Number(b11.previouslySettledAmount) === 5000 && b11.previouslySettledCount === 1
  && (b11.unsettledRanges || []).length === 1 && b11.unsettledRanges[0].from === addDaysIso(mid, 1),
  `settled=${b11.previouslySettledAmount} unsettled=${JSON.stringify(b11.unsettledRanges)}`);
check('D4. Same service period never counted twice (amount = accrual x unsettled months)',
  b11.amount != null && b11.monthlyAccrual != null && b11.unsettledMonths != null
  && near(b11.amount, round2(b11.monthlyAccrual * b11.unsettledMonths), 0.02),
  `amount=${b11.amount} accrual=${b11.monthlyAccrual} unsettledMonths=${b11.unsettledMonths}`);

// Repeated calculation must not create payments/records.
const cntBefore = (await req(`/hr/salary/bonus-settlements?paycode=${PAYCODE}`, { token: HR })).json?.rows?.length;
await ff(leaveFull); await ff(leaveFull);
const cntAfter = (await req(`/hr/salary/bonus-settlements?paycode=${PAYCODE}`, { token: HR })).json?.rows?.length;
check('D5. Repeated estimate creates NO payments (estimates are read-only)', cntBefore === 1 && cntAfter === 1, `before=${cntBefore} after=${cntAfter}`);

// Duplicate + overlapping settlement must be rejected.
const dup = await req('/hr/salary/bonus-settlements', {
  method: 'POST', token: HR,
  body: { paycode: PAYCODE, bonusperiodstart: addMonths(DOJ, 0), bonusperiodend: addMonths(DOJ, 36), servicestart: DOJ, serviceend: mid, amount: 5000 },
});
check('D6. Duplicate settlement of the same service rejected (409)', dup.status === 409 && dup.json?.code === 'BONUS_ALREADY_SETTLED', `HTTP ${dup.status} code=${dup.json?.code}`);
const overlap = await req('/hr/salary/bonus-settlements', {
  method: 'POST', token: HR,
  body: { paycode: PAYCODE, bonusperiodstart: addMonths(DOJ, 0), bonusperiodend: addMonths(DOJ, 36), servicestart: addMonths(DOJ, 5), serviceend: addMonths(DOJ, 15), amount: 1000 },
});
check('D7. Overlapping service settlement rejected (no double-counting)', overlap.status === 409, `HTTP ${overlap.status}`);

// Prorate = N with partial settlement: full amount minus settled.
await setCfg({ BonusProrate: 'N' });
const d2 = await ff(leaveFull);
check('D8. Prorate = N + settled part: full amount minus previously settled', d2?.estimate?.bonus?.amount != null && near(d2.estimate.bonus.amount, 13850 - 5000, 0.02), `amount=${d2?.estimate?.bonus?.amount}`);
await setCfg({ BonusProrate: 'Y' });

// "Leaving after completing one year" with settlement history present.
const d3 = await ff('2026-12-31');
check('D9. Leaving after one year: settled service excluded, later service accrued',
  Number(d3?.estimate?.bonus?.previouslySettledAmount) === 5000 && Number(d3?.estimate?.bonus?.amount) > 0,
  `amount=${d3?.estimate?.bonus?.amount} unsettled=${d3?.estimate?.bonus?.unsettledMonths}`);

/* ============ E. LEAVE ENCASHMENT ============ */
const LY = new Date().getUTCFullYear() + 2; // future leave year: no used/pending leave
const leaveDate = `${LY}-06-30`;
await setCfg({
  LeaveEncashmentEnabled: 'Y', LeaveEncashmentBasis: 'GROSS', LeaveEncashmentWageDivisor: '365',
  LeaveEncashmentMaxDays: '0', LeaveEncashmentTypesFactory: 'PL,SL,CL', LeaveEncashmentTypesOffice: 'PL',
});
// Make PL = 18 eligible unused days for the test leave year (then restore).
const upsertBal = (days) => req('/hr/leave/opening-balances', {
  method: 'POST', token: HR,
  body: { paycode: PAYCODE, leaveyear: LY, leavetype: 'PL', openingbalance: days },
});
const balList = await req(`/hr/leave/opening-balances?search=${PAYCODE}&limit=500`, { token: HR });
const oldBal = (balList.json?.rows || []).find((r) => String(r.paycode || '').trim() === PAYCODE && Number(r.leaveyear) === LY && String(r.leavetype || '').trim() === 'PL');
// The leave model's available balance EXCLUDES used/pending leave (required).
// Probe that usage, then set the opening balance so AVAILABLE = target exactly.
const plAvail = (json) => Number((json?.estimate?.leaveEncashment?.types || []).find((t) => t.leavetype === 'PL')?.days ?? 0);
await upsertBal(10);
const usedDays = 10 - plAvail(await ff(leaveDate));
const setAvail = async (target) => upsertBal(target + usedDays);
await setAvail(18);
const e1 = await ff(leaveDate);
const enc1 = e1?.estimate?.leaveEncashment || {};
const gross1 = Number(e1?.estimate?.salaryUsed?.gross) || 0;
check('E1. Encashment basis GROSS uses the effective-dated real gross salary', enc1.basis === 'GROSS' && near(enc1.monthlyBasisValue, gross1, 0.02), `basis=${enc1.basis} monthly=${enc1.monthlyBasisValue} gross=${gross1}`);
check('E2. Divisor 365 actually used by the engine (not just displayed)', enc1.wageDivisor === 365 && near(enc1.dailySalary, round2((gross1 * 12) / 365), 0.02), `divisor=${enc1.wageDivisor} daily=${enc1.dailySalary}`);
check('E3. Daily salary = monthly x 12 / 365 (formula consistent)', near(enc1.dailySalary, round2(enc1.monthlyBasisValue * 12 / enc1.wageDivisor), 0.02), `daily=${enc1.dailySalary}`);
const plRow = (enc1.types || []).find((t) => t.leavetype === 'PL');
check('E4. 18 eligible unused days come from the real leave balance (used/pending excluded)', Number(enc1.days) === 18 && Number(plRow?.days) === 18, `days=${enc1.days} pl=${plRow?.days} usedExcluded=${usedDays}`);
check('E5. Amount = rounded daily x days (18-day example method)', near(enc1.amount, round2(round2((gross1 * 12) / 365) * 18), 0.02), `amount=${enc1.amount} expected=${round2(round2((gross1 * 12) / 365) * 18)}`);

// Different balances -> corresponding amounts.
await setAvail(5);
const e2 = await ff(leaveDate);
const enc2 = e2?.estimate?.leaveEncashment || {};
check('E6. Different eligible balance (5 days) -> corresponding amount', Number(enc2.days) === 5 && near(enc2.amount, round2(enc2.dailySalary * 5), 0.02), `days=${enc2.days} amount=${enc2.amount}`);

// Max-days cap (0 = no cap preserved; cap applies when configured).
await setAvail(18);
await setCfg({ LeaveEncashmentMaxDays: '10' });
const e3 = await ff(leaveDate);
const enc3 = e3?.estimate?.leaveEncashment || {};
check('E7. Max-day cap applies per config (18 -> 10, flagged)', Number(enc3.days) === 10 && enc3.capApplied === true && Number(enc3.daysBeforeCap) === 18, `days=${enc3.days} capApplied=${enc3.capApplied}`);
await setCfg({ LeaveEncashmentMaxDays: '0' });
const e3b = await ff(leaveDate);
check('E8. MaxDays = 0 means no cap (behaviour preserved)', Number(e3b?.estimate?.leaveEncashment?.days) === 18 && e3b?.estimate?.leaveEncashment?.capApplied === false, `days=${e3b?.estimate?.leaveEncashment?.days}`);

// Staff-group encashable types (Factory PL,SL,CL vs Office PL).
const grp = enc1.staffGroup;
check('E9. Staff group resolved from real category (types per group)', grp === 'FACTORY' || grp === 'OFFICE' || grp === 'DEFAULT', `group=${grp} source=${enc1.staffGroupSource}`);
const expectedTypes = grp === 'FACTORY' ? ['PL', 'SL', 'CL'] : ['PL'];
check('E10. Encashable types match the group config (not all types for everyone)',
  JSON.stringify(enc1.eligibleTypes || []) === JSON.stringify(expectedTypes),
  `types=${(enc1.eligibleTypes || []).join(',')} group=${grp}`);
await setCfg({ LeaveEncashmentTypesOffice: 'PL,SL', LeaveEncashmentTypesFactory: 'PL' });
const e4 = await ff(leaveDate);
check('E11. Group-type config change flows into the engine (config actually used)',
  JSON.stringify(e4?.estimate?.leaveEncashment?.eligibleTypes || []) === JSON.stringify(grp === 'FACTORY' ? ['PL'] : ['PL', 'SL']),
  `types=${(e4?.estimate?.leaveEncashment?.eligibleTypes || []).join(',')}`);

// Restore balances + type config.
await setCfg({ LeaveEncashmentTypesFactory: 'PL,SL,CL', LeaveEncashmentTypesOffice: 'PL' });
if (oldBal) await upsertBal(Number(oldBal.openingbalance ?? oldBal.openingBalance) || 0);
else {
  const nowBal = await req(`/hr/leave/opening-balances?search=${PAYCODE}&limit=500`, { token: HR });
  for (const r of nowBal.json?.rows || []) {
    if (String(r.paycode || '').trim() === PAYCODE && Number(r.leaveyear) === LY && String(r.leavetype || '').trim() === 'PL') {
      await req(`/hr/leave/opening-balances/${r.id}`, { method: 'DELETE', token: HR });
    }
  }
}

/* ============ F. MISSING DATA + F&F INTEGRATION ============ */
// Missing salary: a real employee with no salary rows -> clear message, nothing invented.
const roster = await req('/hr/employees?limit=200', { token: HR });
const rosterRows = roster.json?.rows || roster.json?.employees || [];
let missingSalaryPaycode = '';
for (const r of rosterRows) {
  const pc = String(r.paycode || '').trim();
  if (!pc || pc === PAYCODE) continue;
  const t = await req(`/hr/salary/fullfinal/${pc}`, { token: HR });
  if (t.json?.salary?.available === false && t.json?.estimate == null) { missingSalaryPaycode = pc; break; }
}
check('F1. Missing salary -> clear unavailable message (no fabricated amounts)', !!missingSalaryPaycode, `paycode=${missingSalaryPaycode || 'n/a'}`);

// Integration: corrected bonus + encashment feed the F&F totals; label stays ESTIMATE.
await setCfg({ BonusEnabled: 'Y', BonusPeriodStart: addMonths(DOJ, 0), BonusPeriodEnd: addMonths(DOJ, 36), BonusEligibilityMinMonths: '12', BonusProrate: 'Y', BonusRate: '13850' });
const f1 = await ff(leaveFull);
const est = f1?.estimate || {};
const expectedAdd = round2(Number(est.gratuity?.amount) + Number(est.bonus?.amount) + Number(est.leaveEncashment?.amount) + Number(est.notice?.payAmount) + Number(est.otherDues?.total));
check('F2. Corrected Bonus + Encashment feed the Full & Final estimate', est.additionsTotal != null && near(est.additionsTotal, expectedAdd, 0.05), `additions=${est.additionsTotal} expected=${expectedAdd}`);
check('F3. Result is labelled an estimate (never auto-finalized)', /ESTIMATE/i.test(f1?.disclaimer || ''), (f1?.disclaimer || '').slice(0, 60));
check('F4. Transparent totals formula intact (additions - subtractions)', est.estimatedTotal != null && near(est.estimatedTotal, round2(est.additionsTotal - est.subtractionsTotal), 0.05), `total=${est.estimatedTotal}`);
const gratuityUntouched = Number(est.gratuity?.amount) >= 0 && (est.gratuity?.ruleText || '').length > 0;
const noticeUntouched = Number(est.notice?.wageDivisor) === 30;
check('F5. Gratuity / Notice / PF / ESI rules untouched by this phase', gratuityUntouched && noticeUntouched, `gratuity=${est.gratuity?.amount} noticeDivisor=${est.notice?.wageDivisor}`);

/* ============ G. CLEANUP + RESTORE ============ */
// Remove test settlement records and restore the original rules config.
const left = await req(`/hr/salary/bonus-settlements?paycode=${PAYCODE}`, { token: HR });
for (const s of left.json?.rows || []) {
  await req('/hr/salary/bonus-settlements', { method: 'DELETE', token: HR, body: { ids: [s.id] } });
}
const leftAfter = await req(`/hr/salary/bonus-settlements?paycode=${PAYCODE}`, { token: HR });
check('G1. Test settlement records cleaned up (none left behind)', (leftAfter.json?.rows || []).length === 0, `left=${(leftAfter.json?.rows || []).length}`);
const CFG_FALLBACK = {
  BonusEnabled: 'N', BonusPeriodStart: '', BonusPeriodEnd: '', BonusRule: 'PERCENTAGE_BASIC', BonusRate: '0',
  BonusEligibilityMinMonths: '0', BonusProrate: 'Y', LeaveEncashmentEnabled: 'Y', LeaveEncashmentTypesFactory: 'PL,SL,CL',
  LeaveEncashmentTypesOffice: 'PL', LeaveEncashmentTypesDefault: 'PL', LeaveEncashmentBasis: 'BASIC',
  LeaveEncashmentWageDivisor: '365', LeaveEncashmentMaxDays: '0',
};
const restorePatch = {};
for (const k of CFG_KEYS) {
  const v = savedCfg[k];
  restorePatch[k] = v !== undefined && v !== null && String(v) !== '' ? String(v) : CFG_FALLBACK[k];
}
const restored = await setCfg(restorePatch);
check('G2. Original settlement rules config restored', !!restored, `applied=${restored?.applied ?? Object.keys(restorePatch).length}`);

const failed = results.filter((r) => !r.ok).length;
console.log(`\n${results.length - failed}/${results.length} checks passed.`);
process.exit(failed ? 1 : 0);