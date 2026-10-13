// Phase K runtime regression - Salary import + Full & Final estimation.
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

const round2 = (n) => Math.round((Number(n) || 0) * 100) / 100;
const near = (a, b) => Math.abs(round2(a) - round2(b)) < 0.02;

const HR_USER = process.env.HR_USERNAME;
const HR_PASS = process.env.HR_PASSWORD;
if (!HR_USER || !HR_PASS) {
  console.error('HR credentials not configured in .env - cannot run scenario.');
  process.exit(1);
}

/* ================= A. AUTH + ROLE GUARDS ================= */
const hrLogin = await req('/auth/hr/login', { method: 'POST', body: { username: HR_USER, password: HR_PASS } });
check('A1. HR Admin login', hrLogin.status === 200 && !!hrLogin.json?.token, `HTTP ${hrLogin.status}`);
const HR = hrLogin.json?.token;
if (!HR) process.exit(1);

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
const EMP_PASS = 'PhaseK' + Math.random().toString(36).slice(2, 8) + '1';
const setPw = await req('/hr/employee/credentials/password', {
  method: 'POST', token: HR,
  body: { paycode: EMP_CODE, password: EMP_PASS, confirmPassword: EMP_PASS, mustChange: false },
});
check('A2. HR provisions run password for real roster employee', setPw.status === 200 && setPw.json?.success === true, `HTTP ${setPw.status} paycode=${EMP_CODE}`);

const empLogin = await req('/auth/employee/login', { method: 'POST', body: { paycode: EMP_CODE, password: EMP_PASS } });
check('A3. Employee login (real roster employee)', empLogin.status === 200 && !!empLogin.json?.token, `HTTP ${empLogin.status}`);
const EMP = empLogin.json?.token;
if (!EMP) process.exit(1);

const empToHr = await req('/hr/salary/master', { token: EMP });
check('A4. Employee token blocked from HR salary routes', empToHr.status === 403 || empToHr.status === 401, `HTTP ${empToHr.status}`);
const hrToEmp = await req('/employee/fullfinal', { token: HR });
check('A5. HR token blocked from employee fullfinal route', hrToEmp.status === 403 || hrToEmp.status === 401, `HTTP ${hrToEmp.status}`);

/* ================= B. DATASET A IMPORT ================= */
const masterRows = [
  { EmployeeCode: EMP_CODE, EffectiveFrom: '2026-01-01', BasicSalary: 25000, PFApplicable: 'Y', ESIApplicable: 'Y', PFWage: 15000, ESIWage: 20000 },
  { EmployeeCode: EMP_CODE, EffectiveFrom: '2026-07-01', BasicSalary: 26000, PFApplicable: 'Y', ESIApplicable: 'Y', PFWage: 15500, ESIWage: 20500 },
];
const impA = await req('/hr/salary/master/import', { method: 'POST', token: HR, body: { rows: masterRows } });
const sumA = impA.json?.summary || {};
check('B1. Dataset A import succeeds for real roster employee',
  impA.status === 200 && (sumA.imported || 0) + (sumA.updated || 0) + (sumA.skipped || 0) === 2 && (sumA.failed || 0) === 0,
  `HTTP ${impA.status} imported=${sumA.imported} updated=${sumA.updated} skipped=${sumA.skipped} failed=${sumA.failed}`);

const impABad = await req('/hr/salary/master/import', { method: 'POST', token: HR, body: {
  rows: [
    { EmployeeCode: EMP_CODE, EffectiveFrom: 'not-a-date', BasicSalary: 100, PFApplicable: 'N', ESIApplicable: 'N' },
    { EmployeeCode: EMP_CODE, EffectiveFrom: '2026-01-01', BasicSalary: 'ten', PFApplicable: 'N', ESIApplicable: 'N' },
    { EmployeeCode: EMP_CODE, EffectiveFrom: '2026-01-01', BasicSalary: 100, PFApplicable: 'Y', ESIApplicable: 'N' },
    { EmployeeCode: 'NO-SUCH-EMP-999', EffectiveFrom: '2026-01-01', BasicSalary: 100, PFApplicable: 'N', ESIApplicable: 'N' },
  ],
} });
const sumABad = impABad.json?.summary || {};
check('B2. Invalid Dataset A rows reported Failed with error details (never silently dropped)',
  impABad.status === 200 && sumABad.failed === 4 && (sumABad.imported || 0) === 0 && (sumABad.errors || []).length === 4,
  `failed=${sumABad.failed} errors=${(sumABad.errors || []).length}`);

const impASkip = await req('/hr/salary/master/import', { method: 'POST', token: HR, body: { rows: masterRows } });
const sumASkip = impASkip.json?.summary || {};
check('B3. Re-import of unchanged rows -> Skipped (idempotent)',
  impASkip.status === 200 && sumASkip.skipped === 2 && (sumASkip.failed || 0) === 0,
  `skipped=${sumASkip.skipped}`);

const impAUpdate = await req('/hr/salary/master/import', { method: 'POST', token: HR, body: {
  rows: [{ ...masterRows[1], BasicSalary: 27000, PFWage: 16000, ESIWage: 21000 }],
} });
const sumAUpdate = impAUpdate.json?.summary || {};
check('B4. Changed row -> Updated', impAUpdate.status === 200 && sumAUpdate.updated === 1, `updated=${sumAUpdate.updated}`);
const MASTER_EFFECTIVE = masterRows[1].EffectiveFrom;
const BASIC_NOW = 27000;
const PFWAGE_NOW = 16000;
const ESIWAGE_NOW = 21000;

/* ================= C. DATASET B IMPORT ================= */
const elementRows = [
  { EmployeeCode: EMP_CODE, PayElementCode: 'HRA', PayElementName: 'House Rent Allowance', PayElementType: 'EARNING', CalculationType: 'FIXED', Amount: 3000, EffectiveFrom: MASTER_EFFECTIVE },
  { EmployeeCode: EMP_CODE, PayElementCode: 'SPL', PayElementName: 'Special Allowance', PayElementType: 'EARNING', CalculationType: 'PERCENTAGE', Percentage: 10, PercentageBase: 'BASIC', EffectiveFrom: MASTER_EFFECTIVE },
  { EmployeeCode: EMP_CODE, PayElementCode: 'LIC', PayElementName: 'LIC Premium', PayElementType: 'DEDUCTION', CalculationType: 'FIXED', Amount: 500, EffectiveFrom: MASTER_EFFECTIVE },
  { EmployeeCode: EMP_CODE, PayElementCode: 'MED', PayElementName: 'Medical Allowance (Employer)', PayElementType: 'EMPLOYER_CONTRIBUTION', CalculationType: 'FIXED', Amount: 300, EffectiveFrom: MASTER_EFFECTIVE },
];
const impB = await req('/hr/salary/elements/import', { method: 'POST', token: HR, body: { rows: elementRows } });
const sumB = impB.json?.summary || {};
check('C1. Dataset B import succeeds (EARNING / DEDUCTION / EMPLOYER_CONTRIBUTION)',
  impB.status === 200 && (sumB.imported || 0) + (sumB.updated || 0) + (sumB.skipped || 0) === 4 && (sumB.failed || 0) === 0,
  `HTTP ${impB.status} imported=${sumB.imported} updated=${sumB.updated} skipped=${sumB.skipped} failed=${sumB.failed}`);

const impBBad = await req('/hr/salary/elements/import', { method: 'POST', token: HR, body: {
  rows: [
    { EmployeeCode: EMP_CODE, PayElementCode: 'X1', PayElementName: 'Bad Type', PayElementType: 'WRONG', CalculationType: 'FIXED', Amount: 1, EffectiveFrom: '2026-01-01' },
    { EmployeeCode: EMP_CODE, PayElementCode: 'X2', PayElementName: 'Bad Calc', PayElementType: 'EARNING', CalculationType: 'MAGIC', Amount: 1, EffectiveFrom: '2026-01-01' },
    { EmployeeCode: EMP_CODE, PayElementCode: 'X3', PayElementName: 'Pct No Base', PayElementType: 'EARNING', CalculationType: 'PERCENTAGE', Percentage: 5, EffectiveFrom: '2026-01-01' },
    { EmployeeCode: EMP_CODE, PayElementCode: 'X4', PayElementName: 'Fixed No Amount', PayElementType: 'DEDUCTION', CalculationType: 'FIXED', EffectiveFrom: '2026-01-01' },
    { EmployeeCode: 'NO-SUCH-EMP-999', PayElementCode: 'X5', PayElementName: 'Ghost', PayElementType: 'EARNING', CalculationType: 'FIXED', Amount: 1, EffectiveFrom: '2026-01-01' },
  ],
} });
const sumBBad = impBBad.json?.summary || {};
check('C2. Invalid Dataset B rows reported Failed with error details',
  impBBad.status === 200 && sumBBad.failed === 5 && (sumBBad.errors || []).length === 5,
  `failed=${sumBBad.failed} errors=${(sumBBad.errors || []).length}`);

/* ================= D. SETTLEMENT RULES (all configurable) ================= */
const cfgGet = await req('/hr/salary/config', { token: HR });
const cfg = cfgGet.json?.config || {};
check('D1. Salary config GET returns settlement rules', cfgGet.status === 200 && !!cfg.GratuityDaysPerYear, `HTTP ${cfgGet.status} keys=${Object.keys(cfg).length}`);

const cfgPut = await req('/hr/salary/config', { method: 'PUT', token: HR, body: {
  BonusEnabled: 'Y',
  BonusPeriodStart: '2026-01-01',
  BonusPeriodEnd: '2026-12-31',
  BonusRule: 'PERCENTAGE_BASIC',
  BonusRate: '8.33',
  BonusEligibilityMinMonths: '0',
  BonusProrate: 'Y',
  NoticePeriodDays: '30',
} });
check('D2. HR configures bonus period + notice rules (nothing hardcoded)',
  cfgPut.status === 200 && cfgPut.json?.success === true && cfgPut.json?.config?.BonusPeriodStart === '2026-01-01',
  `HTTP ${cfgPut.status} applied=${(cfgPut.json?.applied || []).length}`);

const cfgBad = await req('/hr/salary/config', { method: 'PUT', token: HR, body: { GratuityWageDivisor: 'zero' } });
check('D3. Invalid config value rejected (400)', cfgBad.status === 400 && cfgBad.json?.code === 'INVALID_CONFIG', `HTTP ${cfgBad.status} code=${cfgBad.json?.code}`);

/* ================= E. OTHER DUES / RECOVERIES ================= */
const due1 = await req('/hr/salary/dues', { method: 'POST', token: HR, body: { paycode: EMP_CODE, category: 'DUE', kind: 'arrears', description: 'Phase K test arrears', amount: 2000 } });
check('E1. HR creates Other Due (arrears)', due1.status === 201 && due1.json?.due?.status === 'Pending', `HTTP ${due1.status} id=${due1.json?.due?.id}`);
const due2 = await req('/hr/salary/dues', { method: 'POST', token: HR, body: { paycode: EMP_CODE, category: 'RECOVERY', kind: 'loan', description: 'Salary advance recovery', amount: 1500 } });
check('E2. HR creates Other Recovery (loan)', due2.status === 201 && due2.json?.due?.status === 'Pending', `HTTP ${due2.status} id=${due2.json?.due?.id}`);
const dueId1 = due1.json?.due?.id;
const dueId2 = due2.json?.due?.id;

const dueBad = await req('/hr/salary/dues', { method: 'POST', token: HR, body: { paycode: EMP_CODE, category: 'MYSTERY', kind: 'x', amount: 1 } });
check('E3. Invalid dues category rejected', dueBad.status === 400, `HTTP ${dueBad.status}`);

const dec1 = await req(`/hr/salary/dues/${dueId1}/decision`, { method: 'POST', token: HR, body: { decision: 'Approved', note: 'ok' } });
const dec2 = await req(`/hr/salary/dues/${dueId2}/decision`, { method: 'POST', token: HR, body: { decision: 'Approved', note: 'ok' } });
check('E4. HR approves both entries', dec1.status === 200 && dec2.status === 200
  && dec1.json?.due?.status === 'Approved' && dec2.json?.due?.status === 'Approved',
  `HTTP ${dec1.status}/${dec2.status}`);

const decAgain = await req(`/hr/salary/dues/${dueId1}/decision`, { method: 'POST', token: HR, body: { decision: 'Rejected' } });
check('E5. Double decision rejected (409 ALREADY_DECIDED)', decAgain.status === 409 && decAgain.json?.code === 'ALREADY_DECIDED', `HTTP ${decAgain.status} code=${decAgain.json?.code}`);

const dueBadAmt = await req('/hr/salary/dues', { method: 'POST', token: HR, body: { paycode: EMP_CODE, category: 'DUE', kind: 'x', amount: -5 } });
check('E6. Negative amount rejected', dueBadAmt.status === 400, `HTTP ${dueBadAmt.status}`);

/* ================= F. FULL & FINAL CALCULATION (self) ================= */
const ff0 = await req('/employee/fullfinal', { token: EMP });
check('F1. Fullfinal without leaving date: identity + rules, estimate null',
  ff0.status === 200 && ff0.json?.estimate === null && ff0.json?.employee?.paycode === EMP_CODE && !!ff0.json?.rules?.gratuity,
  `HTTP ${ff0.status} salaryAvailable=${ff0.json?.salary?.available}`);

const LEAVING = '2026-12-31';
const ff = await req(`/employee/fullfinal?leavingdate=${LEAVING}&noticeServedDays=30`, { token: EMP });
const est = ff.json?.estimate;
check('F2. Estimate computed for leaving date', ff.status === 200 && !!est && est.leavingdate === LEAVING,
  `HTTP ${ff.status} total=${est?.estimatedTotal}`);

const sal = ff.json?.salary || {};
check('F3. Effective-dated salary resolution (last applicable row)',
  sal.available === true && near(sal.basic, BASIC_NOW) && sal.effectivefrom === MASTER_EFFECTIVE,
  `basic=${sal.basic} (expect ${BASIC_NOW}) effectivefrom=${sal.effectivefrom}`);

const brk = sal.breakdown || {};
check('F4. Basic + Applicable Earnings = Gross (deductions & employer separate)',
  near(sal.gross, BASIC_NOW + 3000 + round2(0.10 * BASIC_NOW))
  && near(brk.earningsTotal, 3000 + round2(0.10 * BASIC_NOW))
  && near(brk.deductionsTotal, 500)
  && near(brk.employerTotal, 300),
  `gross=${sal.gross} earnings=${brk.earningsTotal} deductions=${brk.deductionsTotal} employer=${brk.employerTotal}`);

// Gratuity: verify the RETURNED basis math exactly (statutory-style, configurable).
const g = est?.gratuity || {};
const expGrat = g.eligible ? round2((g.wageValue / g.wageDivisor) * g.daysPerYear * g.completedYears) : 0;
check('F5. Gratuity: service + last basic + configured basis',
  g.basicUsed === BASIC_NOW && near(g.amount, expGrat)
  && (g.eligible ? g.completedYears >= g.qualifyingYears : g.completedYears < g.qualifyingYears),
  `eligible=${g.eligible} years=${g.completedYears} basis=${g.basisText} amount=${g.amount}`);

// Bonus: HR-configured period (2026-01-01..2026-12-31), DOJ-aware + prorated.
const b = est?.bonus || {};
const expBonusBase = b.rule === 'FIXED' ? b.rate : round2(b.rate / 100 * (b.rule === 'PERCENTAGE_GROSS' ? sal.gross : BASIC_NOW));
const expBonus = b.eligible ? round2(expBonusBase * b.prorateFactor) : 0;
check('F6. Bonus: configured period + eligibility + proration',
  b.enabled === true && b.periodStart === '2026-01-01' && b.periodEnd === '2026-12-31'
  && near(b.amount, expBonus) && (b.eligibleDays > 0),
  `rule=${b.rule} rate=${b.rate} eligibleDays=${b.eligibleDays}/${b.prorateFactor} amount=${b.amount}`);

// Leave encashment: real available balances x configured basis (integration with leave module).
const enc = est?.leaveEncashment || {};
const encTypesTotal = round2((enc.types || []).reduce((s, t) => s + Number(t.days || 0), 0));
check('F7. Leave encashment: configurable types per staff group, real leave balances',
  enc.enabled === true && enc.days <= encTypesTotal
  && near(enc.amount, round2(enc.days * (enc.basisValue / enc.wageDivisor)))
  && ['FACTORY', 'OFFICE', 'DEFAULT'].includes(enc.staffGroup),
  `group=${enc.staffGroup} days=${enc.days} (${(enc.types || []).map((t) => `${t.leavetype}=${t.days}`).join(', ')}) basis=${enc.basis}/${enc.wageDivisor} amount=${enc.amount}`);

// Notice: fully served (30/30) -> nothing payable or recoverable.
const n = est?.notice || {};
check('F8. Notice: fully served -> zero pay / zero recovery',
  n.provided === true && n.unservedDays === 0 && n.payAmount === 0 && n.recoveryAmount === 0,
  `served=${n.noticeServedDays}/${n.noticePeriodDays} daily=${n.dailyRate}`);

// Dues: approved DUE added, approved RECOVERY subtracted.
// Invariant-based: the total must equal the sum of the returned approved items
// (entries accumulate every time the harness runs, so absolute values would drift).
check('F9. Approved Other Dues / Recoveries included separately',
  near(est?.otherDues?.total, (est?.otherDues?.items || []).reduce((s, i) => s + i.amount, 0))
  && near(est?.otherRecoveries?.total, (est?.otherRecoveries?.items || []).reduce((s, i) => s + i.amount, 0))
  && (est?.otherDues?.items || []).length > 0 && (est?.otherRecoveries?.items || []).length > 0,
  `dues=${est?.otherDues?.total} (${(est?.otherDues?.items || []).length} items) recoveries=${est?.otherRecoveries?.total} (${(est?.otherRecoveries?.items || []).length} items)`);

// Statutory PF / ESI: employee + employer, configurable rates + wage basis.
const ded = est?.employeeDeductions || {};
const er = est?.employerContributions || {};
const pfLine = (ded.items || []).find((i) => i.code === 'PF');
const esiLine = (ded.items || []).find((i) => i.code === 'ESI');
const erPfLine = (er.items || []).find((i) => i.code === 'ER_PF');
const erEsiLine = (er.items || []).find((i) => i.code === 'ER_ESI');
check('F10. Employee PF + ESI calculated (configurable rates/wages)',
  !!pfLine && near(pfLine.amount, round2(Number(ff.json?.rules?.pf?.rateEmployee) / 100 * PFWAGE_NOW))
  && !!esiLine && near(esiLine.amount, round2(Number(ff.json?.rules?.esi?.rateEmployee) / 100 * ESIWAGE_NOW)),
  `PF=${pfLine?.amount} ESI=${esiLine?.amount}`);

check('F11. Employer PF + ESI calculated separately (not in payable total)',
  !!erPfLine && near(erPfLine.amount, round2(Number(ff.json?.rules?.pf?.rateEmployer) / 100 * PFWAGE_NOW))
  && !!erEsiLine && near(erEsiLine.amount, round2(Number(ff.json?.rules?.esi?.rateEmployer) / 100 * ESIWAGE_NOW)),
  `ER_PF=${erPfLine?.amount} ER_ESI=${erEsiLine?.amount} employerTotal=${er.total}`);

// Transparent totals: every component feeds the exact documented formula.
const additions = round2((g.amount || 0) + (b.amount || 0) + (enc.amount || 0) + (n.payAmount || 0) + (est?.otherDues?.total || 0));
const subtractions = round2((n.recoveryAmount || 0) + (est?.otherRecoveries?.total || 0) + (ded.total || 0));
check('F12. Transparent formula: additions - subtractions = Estimated Full & Final',
  near(est?.additionsTotal, additions) && near(est?.subtractionsTotal, subtractions)
  && near(est?.estimatedTotal, round2(additions - subtractions)),
  `add=${est?.additionsTotal} sub=${est?.subtractionsTotal} total=${est?.estimatedTotal}`);

check('F13. Employer contributions NOT part of the payable estimate',
  er.total > 0 && near(est?.estimatedTotal, round2(est?.additionsTotal - est?.subtractionsTotal)),
  `employerTotal=${er.total} (informational only)`);

const disclaimer = ff.json?.estimate?.disclaimer || '';
check('F14. Estimate is clearly labelled - not a final settlement',
  /estimate/i.test(disclaimer) && /not a final/i.test(disclaimer), disclaimer.slice(0, 80));

/* ============ G. NOTICE UNSERVED + WAIVED (payable vs recovery) ============ */
const ffUnserved = await req(`/employee/fullfinal?leavingdate=${LEAVING}&noticeServedDays=10`, { token: EMP });
const nu = ffUnserved.json?.estimate?.notice || {};
const expRecovery = round2(nu.unservedDays * nu.dailyRate);
check('G1. Unserved notice -> recovery (30-10=20 days x daily rate)',
  nu.unservedDays === 20 && near(nu.recoveryAmount, expRecovery) && nu.payAmount === 0,
  `unserved=${nu.unservedDays} daily=${nu.dailyRate} recovery=${nu.recoveryAmount}`);

const ffWaived = await req(`/employee/fullfinal?leavingdate=${LEAVING}&noticeServedDays=10&noticeWaived=true`, { token: EMP });
const nw = ffWaived.json?.estimate?.notice || {};
check('G2. Employer-waived notice -> payable instead of recovery',
  nw.unservedDays === 20 && near(nw.payAmount, expRecovery) && nw.recoveryAmount === 0,
  `pay=${nw.payAmount} recovery=${nw.recoveryAmount}`);

const ffLeavingBeforeJoin = await req('/employee/fullfinal?leavingdate=1900-01-01', { token: EMP });
check('G3. Leaving date before joining date rejected (400)',
  ffLeavingBeforeJoin.status === 400 && ffLeavingBeforeJoin.json?.code === 'LEAVING_BEFORE_JOIN',
  `HTTP ${ffLeavingBeforeJoin.status} code=${ffLeavingBeforeJoin.json?.code}`);

/* ================= H. SECURITY + HR PREVIEW ================= */
const spoof = await req(`/employee/fullfinal?paycode=OTHER-EMPLOYEE&leavingdate=${LEAVING}`, { token: EMP });
check('H1. Query paycode spoof ignored - only own salary visible',
  spoof.status === 200 && spoof.json?.employee?.paycode === EMP_CODE
  && !JSON.stringify(spoof.json || {}).includes('OTHER-EMPLOYEE'),
  `identity=${spoof.json?.employee?.paycode}`);

const ffEarly = await req(`/employee/fullfinal?leavingdate=2026-03-15`, { token: EMP });
check('H2. EffectiveFrom: earlier leaving date resolves the EARLIER salary row',
  ffEarly.status === 200 && near(ffEarly.json?.salary?.basic, 25000) && ffEarly.json?.salary?.effectivefrom === '2026-01-01',
  `basic=${ffEarly.json?.salary?.basic} effectivefrom=${ffEarly.json?.salary?.effectivefrom}`);

const hrPreview = await req(`/hr/salary/fullfinal/${EMP_CODE}?leavingdate=${LEAVING}`, { token: HR });
check('H3. HR admin estimate preview works (HR role only)',
  hrPreview.status === 200 && hrPreview.json?.employee?.paycode === EMP_CODE && !!hrPreview.json?.estimate,
  `HTTP ${hrPreview.status} total=${hrPreview.json?.estimate?.estimatedTotal}`);

const hrPreviewMissing = await req('/hr/salary/fullfinal/NO-SUCH-EMP-999', { token: HR });
check('H4. HR preview for unknown employee -> 404 (never invents an employee)',
  hrPreviewMissing.status === 404, `HTTP ${hrPreviewMissing.status}`);

/* ================= I. PROTECTED-MODULE REGRESSION ================= */
const me = await req('/me', { token: EMP });
check('I1. Employee /me (protected)', me.status === 200 && me.json?.role === 'EMPLOYEE', `HTTP ${me.status}`);
const hrEmps = await req('/hr/employees?pageSize=3', { token: HR });
check('I2. HR employees list (protected)', hrEmps.status === 200, `HTTP ${hrEmps.status}`);
const hrHol = await req('/hr/holidays?month=2026-10', { token: HR });
check('I3. HR Holiday Management (protected)', hrHol.status === 200, `HTTP ${hrHol.status}`);
const empHol = await req('/employee/holidays?month=2026-10', { token: EMP });
check('I4. Employee holidays (protected)', empHol.status === 200, `HTTP ${empHol.status}`);
const leaveTypes = await req('/employee/leave/types', { token: EMP });
check('I5. Leave Management types (protected)', leaveTypes.status === 200 && (leaveTypes.json?.types || []).length >= 5, `HTTP ${leaveTypes.status}`);
const leaveBal = await req('/employee/leave/balance', { token: EMP });
check('I6. Leave Management balance (protected)', leaveBal.status === 200, `HTTP ${leaveBal.status}`);
const empDash = await req('/employee/dashboard', { token: EMP });
const dashOk = empDash.status === 200 || ['PIN_SETUP_REQUIRED', 'PASSWORD_CHANGE_REQUIRED'].includes(empDash.json?.code);
check('I7. Employee dashboard (protected)', dashOk, `HTTP ${empDash.status} code=${empDash.json?.code}`);
const empProfile = await req('/employee/profile', { token: EMP });
check('I8. Employee profile (protected)', empProfile.status === 200, `HTTP ${empProfile.status}`);
const empReports = await req('/employee/monthly?month=2026-10', { token: EMP });
check('I9. Employee reports/attendance data (protected)', empReports.status === 200, `HTTP ${empReports.status}`);
const empCeleb = await req('/employee/celebrations', { token: EMP });
check('I10. Employee celebrations (protected)', empCeleb.status === 200, `HTTP ${empCeleb.status}`);

/* ================= SUMMARY ================= */
const failed = results.filter((r) => !r.ok);
console.log(`\n=== ${results.length - failed.length}/${results.length} checks passed ===`);
if (failed.length) {
  console.log('FAILED:');
  failed.forEach((f) => console.log(` - ${f.label} (${f.detail})`));
}
process.exit(failed.length ? 1 : 0);




