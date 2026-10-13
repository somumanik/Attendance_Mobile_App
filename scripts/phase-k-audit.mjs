// Phase K audit - extended API verification (Steps 2-12 of the audit brief).
// Uses only REAL roster employees. No dummy employees are created.
import 'dotenv/config';

const BASE = 'http://localhost:4000/api';
const results = [];
const check = (label, ok, detail = '') => {
  results.push({ label, ok, detail });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${detail ? ' -> ' + detail : ''}`);
};
const round2 = (n) => Math.round((Number(n) || 0) * 100) / 100;
const near = (a, b) => Math.abs(round2(a) - round2(b)) < 0.02;

async function req(path, { method = 'GET', token, body } = {}) {
  const headers = { 'Content-Type': 'application/json' };
  if (token) headers.Authorization = `Bearer ${token}`;
  const res = await fetch(BASE + path, { method, headers, body: body ? JSON.stringify(body) : undefined });
  let json = null;
  try { json = await res.json(); } catch { /* non-JSON */ }
  return { status: res.status, json };
}

/* ============================== A. HR LOGIN + CONFIG ============================== */
const hrLogin = await req('/auth/hr/login', { method: 'POST', body: { username: process.env.HR_USERNAME, password: process.env.HR_PASSWORD } });
const HR = hrLogin.json?.token;
check('A1. HR Admin login + protected route', hrLogin.status === 200 && !!HR, `HTTP ${hrLogin.status}`);

const cfgRes = await req('/hr/salary/config', { token: HR });
const cfg = cfgRes.json?.config || {};
const csv = (v) => String(v || '').split(',').map((s) => s.trim().toUpperCase()).filter(Boolean);
const factory = csv(cfg.LeaveEncashmentTypesFactory);
const office = csv(cfg.LeaveEncashmentTypesOffice);
const deflt = csv(cfg.LeaveEncashmentTypesDefault);
check('A2. Leave-encashment defaults are CONFIGURED (Factory / Office / Default lists)',
  factory.length > 0 && office.length > 0 && deflt.length > 0,
  `factory=[${factory}] office=[${office}] default=[${deflt}]`);
check('A3. OLA / OLB are NOT encashable by default (configurable, not hardcoded)',
  !factory.includes('OLA') && !factory.includes('OLB') && !office.includes('OLA') && !office.includes('OLB') && !deflt.includes('OLA') && !deflt.includes('OLB'),
  `factory=[${factory}] office=[${office}]`);
check('A4. Configurable rules exposed (gratuity / bonus / notice / PF / ESI wage basis)',
  ['GratuityDaysPerYear', 'GratuityWageDivisor', 'GratuityQualifyingYears', 'GratuityWageBasis',
    'BonusRule', 'BonusRate', 'BonusEligibilityMinMonths', 'BonusProrate',
    'LeaveEncashmentBasis', 'LeaveEncashmentWageDivisor', 'NoticePeriodDays', 'NoticeSalaryBasis',
    'PFRateEmployee', 'PFWageBasis', 'ESIRateEmployee', 'ESIWageBasis', 'ESIWageCeiling'].every((k) => k in cfg),
  `keys=${Object.keys(cfg).length}`);

/* ====================== B. IMPORT VALIDATION DETAIL (Step 2) ====================== */
const EMP = process.env.AUDIT_EMP_PAYCODE || '0002';
let me = null;
let other = null;
for (const page of [1, 2, 3]) {
  const roster = await req(`/hr/employees?page=${page}&pageSize=100`, { token: HR });
  const list = roster.json?.rows || [];
  if (!me) me = list.find((r) => String(r.paycode).trim() === EMP);
  if (!other) other = list.find((r) => String(r.paycode).trim() !== EMP && r.active === 'Y');
  if ((me && other) || list.length < 100) break;
}
check('B1. Real roster data available for the audit (no fake employees created)', !!me && !!other,
  `audit=${me?.paycode} (${me?.empname}) cross=${other?.paycode} (${other?.empname})`);

const bioMismatch = await req('/hr/salary/master/import', {
  method: 'POST', token: HR,
  body: { rows: [{ EmployeeCode: EMP, BiometricCode: 'WRONG-CARD-99', EffectiveFrom: '2026-01-01', BasicSalary: 100, PFApplicable: 'N', ESIApplicable: 'N' }] },
});
const nameMismatch = await req('/hr/salary/master/import', {
  method: 'POST', token: HR,
  body: { rows: [{ EmployeeCode: EMP, EmployeeName: 'Not The Real Name', EffectiveFrom: '2026-01-01', BasicSalary: 100, PFApplicable: 'N', ESIApplicable: 'N' }] },
});
const unknownEmp = await req('/hr/salary/master/import', {
  method: 'POST', token: HR,
  body: { rows: [{ EmployeeCode: 'NO-SUCH-EMP-999', EffectiveFrom: '2026-01-01', BasicSalary: 100, PFApplicable: 'N', ESIApplicable: 'N' }] },
});
check('B2. BiometricCode mismatch -> Failed (never silently accepted)',
  bioMismatch.json?.summary?.failed === 1 && /BiometricCode/i.test(JSON.stringify(bioMismatch.json?.summary?.errors || [])),
  (bioMismatch.json?.summary?.errors?.[0]?.message || '').slice(0, 70));
check('B3. EmployeeName mismatch -> Failed',
  nameMismatch.json?.summary?.failed === 1 && /EmployeeName/i.test(JSON.stringify(nameMismatch.json?.summary?.errors || [])),
  (nameMismatch.json?.summary?.errors?.[0]?.message || '').slice(0, 70));
check('B4. Unknown EmployeeCode -> Failed with an explicit reason',
  unknownEmp.json?.summary?.failed === 1 && /not found among active employees/i.test(JSON.stringify(unknownEmp.json?.summary?.errors || [])),
  (unknownEmp.json?.summary?.errors?.[0]?.message || '').slice(0, 70));
check('B5. Import summary always returns Imported/Updated/Skipped/Failed + error details',
  ['imported', 'updated', 'skipped', 'failed'].every((k) => k in (unknownEmp.json?.summary || {})) && Array.isArray(unknownEmp.json?.summary?.errors),
  JSON.stringify({ i: unknownEmp.json?.summary?.imported, u: unknownEmp.json?.summary?.updated, s: unknownEmp.json?.summary?.skipped, f: unknownEmp.json?.summary?.failed }));

/* ============ C. EFFECTIVE-DATED SALARY + ELEMENT BASES (Steps 3/5/7) ============ */
// A FUTURE effective date (2027-01-01) is used so the existing 2026 salary picture
// (used by the employee UI test) is not disturbed.
const FUT = '2027-01-01';
const imp = await req('/hr/salary/master/import', {
  method: 'POST', token: HR,
  body: { rows: [{ EmployeeCode: EMP, EffectiveFrom: FUT, BasicSalary: 20000, PFApplicable: 'N', ESIApplicable: 'N', PFWage: 0, ESIWage: 0 }] },
});
check('C1. Future-dated salary row imported (EffectiveFrom support)',
  imp.json?.summary && (imp.json.summary.imported + imp.json.summary.updated + imp.json.summary.skipped) === 1 && imp.json.summary.failed === 0,
  JSON.stringify(imp.json?.summary || {}).slice(0, 90));

const elemImp = await req('/hr/salary/elements/import', {
  method: 'POST', token: HR,
  body: {
    rows: [
      { EmployeeCode: EMP, PayElementCode: 'B1', PayElementName: 'Fixed Earning', PayElementType: 'EARNING', CalculationType: 'FIXED', Amount: 1000, EffectiveFrom: FUT },
      { EmployeeCode: EMP, PayElementCode: 'B2', PayElementName: 'PF-wage based earning', PayElementType: 'EARNING', CalculationType: 'PERCENTAGE', Percentage: 5, PercentageBase: 'PF_WAGE', EffectiveFrom: FUT },
      { EmployeeCode: EMP, PayElementCode: 'B3', PayElementName: 'Gross based earning', PayElementType: 'EARNING', CalculationType: 'PERCENTAGE', Percentage: 20, PercentageBase: 'GROSS', EffectiveFrom: FUT },
      { EmployeeCode: EMP, PayElementCode: 'B4', PayElementName: 'Basic based deduction', PayElementType: 'DEDUCTION', CalculationType: 'PERCENTAGE', Percentage: 10, PercentageBase: 'BASIC', EffectiveFrom: FUT },
      { EmployeeCode: EMP, PayElementCode: 'B5', PayElementName: 'Employer contribution (fixed)', PayElementType: 'EMPLOYER_CONTRIBUTION', CalculationType: 'FIXED', Amount: 250, EffectiveFrom: FUT },
    ],
  },
});
check('C2. Pay elements imported: FIXED + PERCENTAGE(BASIC/PF_WAGE/GROSS) + DEDUCTION + EMPLOYER_CONTRIBUTION',
  (elemImp.json?.summary?.imported || 0) + (elemImp.json?.summary?.updated || 0) + (elemImp.json?.summary?.skipped || 0) === 5 && elemImp.json?.summary?.failed === 0,
  JSON.stringify(elemImp.json?.summary || {}).slice(0, 120));

const est2027 = await req(`/employee/fullfinal?leavingdate=2027-06-30`, { token: (await (async () => {
  const pw = `AuditA${Math.random().toString(36).slice(2, 8)}1`;
  await req('/hr/employee/credentials/password', { method: 'POST', token: HR, body: { paycode: EMP, password: pw, confirmPassword: pw, mustChange: false } });
  const lg = await req('/auth/employee/login', { method: 'POST', body: { paycode: EMP, password: pw } });
  return lg.json?.token;
})()) });
const e27 = est2027.json;
const s27 = e27?.salary || {};
check('C3. EffectiveFrom selection: future leaving date resolves the 2027 salary row',
  s27.available === true && near(s27.basic, 20000) && s27.effectivefrom === FUT,
  `basic=${s27.basic} from=${s27.effectivefrom}`);

// Invariant-based verification: every earnings line must equal its own stated
// formula, and gross must equal basic + earnings (deductions never included).
// This is element-set independent (any imported element can be present).
const earnLines = (s27.breakdown?.earnings || []);
const nonGrossSum = round2(earnLines
  .filter((l) => !(l.calculationtype === 'PERCENTAGE' && l.percentagebase === 'GROSS'))
  .reduce((s, l) => s + Number(l.value || 0), 0));
const grossBaseExpected = round2(20000 + nonGrossSum);
const baseOf = (l) => (l.percentagebase === 'GROSS' ? grossBaseExpected
  : l.percentagebase === 'PF_WAGE' ? Number(s27.pfwage || 0)
  : l.percentagebase === 'ESI_WAGE' ? Number(s27.esiwage || 0)
  : 20000);
const linesOk = earnLines.every((l) => (l.calculationtype === 'FIXED'
  ? near(l.value, l.amount)
  : near(l.value, round2((Number(l.percentage) || 0) / 100 * baseOf(l)))));
const grossOk = near(s27.gross, round2(20000 + earnLines.reduce((s, l) => s + Number(l.value || 0), 0)));
check('C4. Basic + Applicable Earnings = Gross (each PERCENTAGE/FIXED line matches its own stated formula)',
  earnLines.length > 0 && linesOk && grossOk && near(s27.breakdown?.earningsTotal, round2(s27.gross - 20000)),
  `gross=${s27.gross} basic=20000 earnings=${s27.breakdown?.earningsTotal} lines=${earnLines.map((l) => `${l.payelementcode}:${l.value}`).join(',')}`);

const ded27 = e27?.estimate?.employeeDeductions || {};
const er27 = e27?.estimate?.employerContributions || {};
const b4 = (ded27.items || []).find((i) => i.code === 'B4');
check('C5. Employee deductions stay SEPARATE from gross (percentage-of-basic deduction)',
  !!b4 && near(b4.amount, round2(0.10 * 20000)) && !near(s27.gross, round2(s27.gross - (b4?.amount || 0)))
  && (s27.breakdown?.deductions || []).every((d) => (s27.breakdown?.earnings || []).every((e) => e.payelementcode !== d.payelementcode)),
  `B4=${b4?.amount} deductionsTotal=${ded27.total}`);
const b5 = (er27.items || []).find((i) => i.code === 'B5');
check('C6. Employer contributions stay SEPARATE (informational, not in the payable total)',
  !!b5 && near(b5.amount, 250) && !(ded27.items || []).some((i) => i.code === 'B5'),
  `B5=${b5?.amount} employerTotal=${er27.total}`);
check('C7. PF / ESI applicability respected (PFApplicable=N, ESIApplicable=N -> no statutory lines)',
  !(ded27.items || []).some((i) => i.code === 'PF' || i.code === 'ESI')
  && !(er27.items || []).some((i) => i.code === 'ER_PF' || i.code === 'ER_ESI'),
  `deductionItems=${(ded27.items || []).map((i) => i.code).join(',')}`);
check('C8. Applicability notes are surfaced (nothing hidden)',
  (ded27.notes || []).some((n) => /PF not applicable/i.test(n)) && (ded27.notes || []).some((n) => /ESI not applicable/i.test(n)),
  (ded27.notes || []).join(' | ').slice(0, 120));

const EMPTOK = await (async () => {
  const pw = `AuditB${Math.random().toString(36).slice(2, 8)}1`;
  await req('/hr/employee/credentials/password', { method: 'POST', token: HR, body: { paycode: EMP, password: pw, confirmPassword: pw, mustChange: false } });
  return (await req('/auth/employee/login', { method: 'POST', body: { paycode: EMP, password: pw } })).json?.token;
})();

/* ================= D. BONUS: configurable period + DOJ (Step 5) ================= */
const setPeriod = (start, end) => req('/hr/salary/config', {
  method: 'PUT', token: HR,
  body: { BonusEnabled: 'Y', BonusPeriodStart: start, BonusPeriodEnd: end, BonusRule: 'PERCENTAGE_BASIC', BonusRate: '8.33', BonusEligibilityMinMonths: '0', BonusProrate: 'Y' },
});
await setPeriod('2026-01-01', '2026-12-31');
const estBonus = await req('/employee/fullfinal?leavingdate=2026-12-31', { token: EMPTOK });
const bo = estBonus.json?.estimate?.bonus || {};
check('D1. Bonus follows the HR-configured period (2026-01-01..2026-12-31)',
  bo.enabled === true && bo.periodStart === '2026-01-01' && bo.periodEnd === '2026-12-31' && bo.eligible === true && bo.amount > 0,
  `period=${bo.periodStart}..${bo.periodEnd} amount=${bo.amount} prorate=${bo.prorateFactor}`);

await setPeriod('1990-01-01', '1990-12-31');
const estBonusOld = await req('/employee/fullfinal?leavingdate=2026-12-31', { token: EMPTOK });
const bo2 = estBonusOld.json?.estimate?.bonus || {};
check('D2. Bonus considers the Date of Joining (period before DOJ -> not eligible, amount 0)',
  bo2.eligible === false && bo2.amount === 0 && /Not employed during the bonus period/i.test(bo2.note || ''),
  `eligible=${bo2.eligible} amount=${bo2.amount} note="${bo2.note}"`);

await setPeriod('2026-01-01', '2026-12-31');
const estBonusBack = await req('/employee/fullfinal?leavingdate=2026-12-31', { token: EMPTOK });
check('D3. Bonus period is fully configurable (restoring the period restores the bonus - nothing hardcoded)',
  near(estBonusBack.json?.estimate?.bonus?.amount, bo.amount) && estBonusBack.json?.estimate?.bonus?.amount > 0,
  `amount=${estBonusBack.json?.estimate?.bonus?.amount}`);

/* =================== E. NOTICE PAY / RECOVERY EDGES (Step 8) =================== */
const nBlank = await req('/employee/fullfinal?leavingdate=2026-12-31', { token: EMPTOK });
const nb = nBlank.json?.estimate?.notice || {};
check('E1. Notice not calculated unless inputs are supplied (blank -> skip, no invented amount)',
  nb.provided === false && nb.payAmount === 0 && nb.recoveryAmount === 0, `provided=${nb.provided}`);
const nOver = await req('/employee/fullfinal?leavingdate=2026-12-31&noticeServedDays=45', { token: EMPTOK });
const no = nOver.json?.estimate?.notice || {};
check('E2. Notice served beyond the period -> nothing payable or recoverable',
  no.unservedDays === 0 && no.payAmount === 0 && no.recoveryAmount === 0, `served=${no.noticeServedDays}/${no.noticePeriodDays}`);
const nZero = await req('/employee/fullfinal?leavingdate=2026-12-31&noticeServedDays=0', { token: EMPTOK });
const nz = nZero.json?.estimate?.notice || {};
check('E3. Fully unserved notice -> recovery at the configured salary basis',
  nz.unservedDays === nz.noticePeriodDays && near(nz.recoveryAmount, round2(nz.unservedDays * nz.dailyRate)) && nz.payAmount === 0,
  `unserved=${nz.unservedDays} daily=${nz.dailyRate} recovery=${nz.recoveryAmount}`);
const nWaived = await req('/employee/fullfinal?leavingdate=2026-12-31&noticeServedDays=0&noticeWaived=true', { token: EMPTOK });
const nw = nWaived.json?.estimate?.notice || {};
check('E4. Waived notice -> payable instead of recovery (same basis)',
  near(nw.payAmount, nz.recoveryAmount) && nw.recoveryAmount === 0, `pay=${nw.payAmount} recovery=${nw.recoveryAmount}`);

/* ============ F. OTHER DUES / RECOVERIES SEPARATION (Steps 9/10) ============ */
const pendingDue = await req('/hr/salary/dues', {
  method: 'POST', token: HR,
  body: { paycode: EMP, category: 'DUE', kind: 'pending-probe', description: 'must NOT count until approved', amount: 999 },
});
const estDues = await req('/employee/fullfinal?leavingdate=2026-12-31', { token: EMPTOK });
const est = estDues.json?.estimate || {};
const od = est.otherDues || {};
const orr = est.otherRecoveries || {};
check('F1. Other Dues and Other Recoveries are separately identifiable (own items, kind + amount)',
  Array.isArray(od.items) && Array.isArray(orr.items) && od.items.length > 0 && orr.items.length > 0
  && od.items.every((i) => i.id && i.kind && typeof i.amount === 'number')
  && orr.items.every((i) => i.id && i.kind && typeof i.amount === 'number'),
  `dues=${od.items?.length} recoveries=${orr.items?.length}`);
check('F2. Dues / recovery totals equal the sum of their own items (transparent)',
  near(od.total, (od.items || []).reduce((s, i) => s + i.amount, 0))
  && near(orr.total, (orr.items || []).reduce((s, i) => s + i.amount, 0)),
  `duesTotal=${od.total} recoveriesTotal=${orr.total}`);
check('F3. PENDING dues are excluded until HR approves them',
  !(od.items || []).some((i) => i.id === pendingDue.json?.due?.id) && !(orr.items || []).some((i) => i.id === pendingDue.json?.due?.id),
  `pendingId=${pendingDue.json?.due?.id} duesTotal=${od.total}`);
check('F4. Full & Final payload exposes every component separately + the formula + total',
  ['gratuity', 'bonus', 'leaveEncashment', 'notice', 'otherDues', 'otherRecoveries', 'employeeDeductions', 'employerContributions']
    .every((k) => k in est) && typeof est.estimatedTotal === 'number' && !!est.formula,
  `total=${est.estimatedTotal}`);

/* ============ G. EMPLOYEE SECURITY / CROSS-EMPLOYEE (Step 11) ============ */
const pw2 = `AuditX${Math.random().toString(36).slice(2, 8)}1`;
await req('/hr/employee/credentials/password', { method: 'POST', token: HR, body: { paycode: other.paycode, password: pw2, confirmPassword: pw2, mustChange: false } });
const tk2 = (await req('/auth/employee/login', { method: 'POST', body: { paycode: other.paycode, password: pw2 } })).json?.token;
check('G1. Second REAL roster employee can log in (cross-employee probe)', !!tk2, `paycode=${other.paycode}`);

const spoof = await req(`/employee/fullfinal?paycode=${EMP}&leavingdate=2026-12-31`, { token: tk2 });
check('G2. Employee cannot read another employee\'s F&F via query paycode (identity from JWT only)',
  spoof.status === 200 && String(spoof.json?.employee?.paycode).trim() === String(other.paycode).trim()
  && !JSON.stringify(spoof.json || {}).includes('"basic":27000'),
  `identity=${spoof.json?.employee?.paycode} basic=${spoof.json?.salary?.basic}`);
check('G3. Employee without imported salary gets the truthful not-available state (no invented figures)',
  spoof.json?.salary?.available === false && spoof.json?.estimate === null && !!spoof.json?.salary?.reason,
  `reason="${String(spoof.json?.salary?.reason || '').slice(0, 60)}"`);

const hrRoutes = ['/hr/salary/master', '/hr/salary/elements', '/hr/salary/config', '/hr/salary/dues', `/hr/salary/fullfinal/${EMP}`];
let blocked = 0;
const notBlocked = [];
for (const r of hrRoutes) {
  const x = await req(r, { token: tk2 });
  if (x.status === 403 || x.status === 401) blocked += 1; else notBlocked.push(`${r}=${x.status}`);
}
check('G4. Employee token blocked from EVERY HR salary route (403)',
  blocked === hrRoutes.length, `${blocked}/${hrRoutes.length}${notBlocked.length ? ' not blocked: ' + notBlocked.join(', ') : ''}`);

/* ==================== H. HR ADMIN ACCESS MATRIX (Step 12) ==================== */
const hrGets = ['/hr/salary/master', '/hr/salary/elements', '/hr/salary/config', '/hr/salary/dues', `/hr/salary/fullfinal/${EMP}?leavingdate=2026-12-31`];
let hrOk = 0;
const hrFail = [];
for (const r of hrGets) {
  const x = await req(r, { token: HR });
  if (x.status === 200) hrOk += 1; else hrFail.push(`${r}=${x.status}`);
}
check('H1. HR Admin can access all Phase K management endpoints',
  hrOk === hrGets.length, `${hrOk}/${hrGets.length}${hrFail.length ? ' failed: ' + hrFail.join(', ') : ''}`);

/* =============== I. PROTECTED-MODULE REGRESSION (Step 15 of the brief) =============== */
const reg = [
  ['HR /me', '/me', HR],
  ['Employee /me', '/me', EMPTOK],
  ['Employee dashboard', '/employee/dashboard', EMPTOK],
  ['Attendance daily', '/employee/daily', EMPTOK],
  ['Attendance weekly', '/employee/weekly', EMPTOK],
  ['Attendance monthly (reports)', '/employee/monthly?month=2026-10', EMPTOK],
  ['HR daily master (reports)', '/hr/daily-master?date=2026-10-08', HR],
  ['Celebrations (employee)', '/employee/celebrations', EMPTOK],
  ['Profile', '/employee/profile', EMPTOK],
  ['Phase G HR holidays', '/hr/holidays?month=2026-10', HR],
  ['Phase G employee holidays', '/employee/holidays?month=2026-10', EMPTOK],
  ['Phase I HR credentials', `/hr/employee/credentials?paycode=${EMP}`, HR],
  ['Phase J leave types', '/employee/leave/types', EMPTOK],
  ['Phase J leave balance', '/employee/leave/balance', EMPTOK],
  ['Phase J leave requests', '/employee/leave/requests', EMPTOK],
  ['Phase J leave calendar', '/employee/leave/calendar?from=2026-10-01&to=2026-10-31', EMPTOK],
  ['Full & Final (self)', '/employee/fullfinal', EMPTOK],
  ['HR employees list', '/hr/employees?pageSize=3', HR],
  ['HR marriage anniversaries', '/marriage-anniversary', HR],
];
let regOk = 0;
const regFail = [];
for (const [label, path, token] of reg) {
  const x = await req(path, { token });
  if (x.status === 200) regOk += 1; else regFail.push(`${label}=${x.status}`);
}
check(`I1. Protected modules regression: all ${reg.length} endpoints healthy`,
  regOk === reg.length, `ok=${regOk}/${reg.length}${regFail.length ? ' failed: ' + regFail.join(', ') : ''}`);

/* ================================ SUMMARY ================================ */
const failed = results.filter((r) => !r.ok);
console.log(`\n=== PHASE K API AUDIT: ${results.length - failed.length}/${results.length} checks passed ===`);
if (failed.length) {
  console.log('FAILED:');
  failed.forEach((f) => console.log(` - ${f.label} (${f.detail})`));
}
process.exit(failed.length ? 1 : 0);




