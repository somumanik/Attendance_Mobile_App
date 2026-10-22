// PHASE: Template auto-fill + Gross double-counting fix - runtime verification.
// Live checks against the shared backend + real records. The controlled
// edit/re-import test restores the original value immediately afterwards.
import 'dotenv/config';
import fs from 'fs';
import path from 'path';
import { pathToFileURL } from 'node:url';

const BASE = 'http://localhost:4000/api';
const OUT = path.join(process.cwd(), 'scripts', '_salary_ui_out');
fs.mkdirSync(OUT, { recursive: true });
const results = [];
const check = (label, ok, detail = '') => {
  results.push({ label, ok, detail });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${detail ? ' -> ' + detail : ''}`);
};
async function req(p, { method = 'GET', token, body } = {}) {
  const headers = { 'Content-Type': 'application/json' };
  if (token) headers.Authorization = `Bearer ${token}`;
  const res = await fetch(BASE + p, { method, headers, body: body ? JSON.stringify(body) : undefined });
  let json = null;
  try { json = await res.json(); } catch { /* */ }
  return { status: res.status, json };
}
const round2 = (n) => Math.round((Number(n) || 0) * 100) / 100;
const near = (a, b, tol = 0.02) => Math.abs(round2(a) - round2(b)) <= tol;

const hrLogin = await req('/auth/hr/login', { method: 'POST', body: { username: process.env.HR_USERNAME, password: process.env.HR_PASSWORD } });
check('A1. HR Admin login', hrLogin.status === 200 && !!hrLogin.json?.token, `HTTP ${hrLogin.status}`);
const HR = hrLogin.json?.token;
if (!HR) process.exit(1);
const ff = async (pc, leaving) => (await req(`/hr/salary/fullfinal/${pc}?leavingdate=${leaving}`, { token: HR })).json;

/* ============ B. GROSS SALARY DOUBLE-COUNTING FIX ============ */
const f1 = await ff('1053', '2026-12-31');
const s1 = f1?.salary || {};
const bd1 = s1.breakdown || {};
check('B1. Employee 1053 Gross = 40,832 (was 61,248 - basic counted once)', near(s1.gross, 40832, 0.01) && !near(s1.gross, 61248), `gross=${s1.gross}`);
check('B2. Basic NOT added twice (gross == sum of earning pay elements)', bd1.basicElementIncluded === true && near(s1.gross, bd1.earningsTotal, 0.01), `basic=${s1.basic} earningsTotal=${bd1.earningsTotal} basicElementIncluded=${bd1.basicElementIncluded}`);
const e1053 = Object.fromEntries((bd1.earnings || []).map((l) => [l.payelementcode, l.value]));
check('B3. Supplied example elements sum exactly: BASIC+HRA+SDA+SPL ALL',
  near(e1053.BASIC, 20416, 0.01) && near(e1053.HRA, 10208, 0.01) && near(e1053.SDA, 10208, 0.01) && near(e1053['SPL ALL'], 0, 0.01)
  && near(round2((e1053.BASIC || 0) + (e1053.HRA || 0) + (e1053.SDA || 0) + (e1053['SPL ALL'] || 0)), 40832, 0.01),
  JSON.stringify(e1053));
check('B4. Zero-value element adds no salary', Number(e1053['SPL ALL']) === 0 && near(s1.gross, 40832, 0.01), `SPL ALL=${e1053['SPL ALL']}`);
const f2 = await ff('0002', '2026-12-31');
const s2 = f2?.salary || {};
const bd2 = s2.breakdown || {};
check('B5. Regression (no BASIC element): gross = basic + earnings unchanged', bd2.basicElementIncluded === false && near(s2.gross, round2(s2.basic + bd2.earningsTotal), 0.01), `basic=${s2.basic} earnings=${bd2.earningsTotal} gross=${s2.gross}`);
check('B6. Deduction elements excluded from Gross', near(s2.gross, round2(s2.basic + bd2.earningsTotal), 0.01) && Number(bd2.deductionsTotal) >= 0 && !near(s2.gross, round2(s2.basic + bd2.earningsTotal + (bd2.deductionsTotal || 0))), `deductions=${bd2.deductionsTotal}`);
check('B7. Employer contributions kept out of employee Gross', Number(bd2.employerTotal || 0) >= 0 && near(s2.gross, round2(s2.basic + bd2.earningsTotal), 0.01), `employer=${bd2.employerTotal}`);
// Fixed / percentage computation rules hold on every earnings line (both employees)
const lineOk = (s) => {
  const bd = s.breakdown || {};
  return (bd.earnings || []).every((l) => {
    if (l.calculationtype === 'FIXED') return near(l.value, Number(l.amount) || 0, 0.02);
    const pct = Number(l.percentage) || 0;
    const base = l.percentagebase === 'GROSS' ? Number((/\(([^)]+)\)/.exec(l.formula || '') || [])[1]) || bd.earningsTotal
      : l.percentagebase === 'PF_WAGE' ? Number(s.pfwage) || 0
      : l.percentagebase === 'ESI_WAGE' ? Number(s.esiwage) || 0
      : Number(s.basic) || 0;
    return near(l.value, round2(pct / 100 * base), 0.05);
  });
};
check('B8. FIXED/PERCENTAGE elements follow their stored computation rules', lineOk(s1) && lineOk(s2), 'per-line formula check');

// Effective-date semantics: before the first applicable version there is no salary (nothing invented)
const fEarly = await ff('1053', '2026-01-15');
check('B9. Out-of-effective-date: clear unavailable message (no invented amounts)', fEarly?.salary?.available === false && fEarly?.estimate == null, `reason=${(fEarly?.salary?.reason || '').slice(0, 50)}`);
const fOnDate = await ff('1053', '2026-03-31');
check('B10. Effective version applies from its EffectiveFrom date', near(fOnDate?.salary?.gross, 40832, 0.01), `gross=${fOnDate?.salary?.gross}`);

// Inactive elements excluded (then restored) - controlled flip + restore.
const structElems = await req('/hr/salary/structure/elements?paycode=1053', { token: HR });
const hraRow = (structElems.json?.rows || []).find((r) => r.payelementcode === 'HRA');
const ynB = (v) => (v === null || v === undefined ? '' : v ? 'Y' : 'N');
// The Edit modal sends the FULL validated payload - mirror it exactly.
const elemPutBody = (r, active) => ({
  paycode: r.paycode, payelementcode: r.payelementcode, payelementname: r.payelementname || '',
  effectivefrom: String(r.effectivefrom).slice(0, 10),
  fixedorpercent: r.fixedorpercent, addordeduct: r.addordeduct,
  amount: r.amount ?? '', percent: r.percent ?? '', computationtype: r.computationtype || '',
  pfapplicable: ynB(r.pfapplicable), ptapplicable: ynB(r.ptapplicable), esiapplicability: ynB(r.esiapplicability),
  applicableforot: ynB(r.applicableforot), applicableforc: ynB(r.applicableforc),
  activepayelement: active, processed: ynB(r.processed), leaveencashment: ynB(r.leaveencashment),
  paycadre: r.paycadre || '', payrollpostinggroup: r.payrollpostinggroup || '', remarks: r.remarks || '',
});
const flip = await req(`/hr/salary/structure/elements/${hraRow.id}`, { method: 'PUT', token: HR, body: elemPutBody(hraRow, 'N') });
const fInactive = await ff('1053', '2026-12-31');
check('B11. Inactive element (latest version) excluded from Gross', flip.status === 200 && near(fInactive?.salary?.gross, 30624, 0.01), `gross=${fInactive?.salary?.gross} (expected 30624)`);
check('B12. Excluded inactive element is reported, not silently dropped', (fInactive?.salary?.warnings || []).some((w) => /Inactive pay element/.test(w) && /HRA/.test(w)), JSON.stringify(fInactive?.salary?.warnings || []));
await req(`/hr/salary/structure/elements/${hraRow.id}`, { method: 'PUT', token: HR, body: elemPutBody(hraRow, 'Y') });
const fRestored = await ff('1053', '2026-12-31');
check('B13. Restored active element back in Gross (40,832)', near(fRestored?.salary?.gross, 40832, 0.01), `gross=${fRestored?.salary?.gross}`);

// Settlement components use their configured bases from the shared breakdown.
const est1 = fRestored?.estimate || {};
check('B14. Gratuity keeps its configured basis (master Basic)', est1.gratuity?.basicUsed === 20416 && Number(est1.gratuity?.wageValue) === 20416, `wageValue=${est1.gratuity?.wageValue} basis=${est1.gratuity?.wageBasis}`);
check('B15. Notice Pay uses its configured basis (GROSS = corrected 40,832)', est1.notice?.salaryBasis === 'GROSS' ? near(est1.notice?.basisValue, 40832, 0.01) : near(est1.notice?.basisValue, 20416, 0.01), `basis=${est1.notice?.salaryBasis} value=${est1.notice?.basisValue}`);
check('B16. Leave Encashment uses its configured basis from the shared breakdown',
  est1.leaveEncashment?.basis === 'GROSS' ? near(est1.leaveEncashment?.basisValue, 40832, 0.01) : near(est1.leaveEncashment?.basisValue, 20416, 0.01),
  `basis=${est1.leaveEncashment?.basis} value=${est1.leaveEncashment?.basisValue}`);
const pfItems = (est1.employeeDeductions?.items || []).filter((i) => i.code === 'PF');
check('B17. PF/ESI keep their existing applicability + wage bases', pfItems.every((i) => near(i.amount, round2((Number(fRestored?.rules?.pf?.rateEmployee) || 0) / 100 * (Number(fRestored?.salary?.pfwage) || 20416)), 0.05)), `pfItems=${pfItems.length} pfWage=${fRestored?.salary?.pfwage}`);

/* ============ C. TEMPLATE AUTO-FILL (real data + safe re-import) ============ */
const lib = await import(pathToFileURL(path.join(process.cwd(), 'web-next', 'lib', 'salaryStructure.js')).href);
const XLSX = await import('xlsx');
const [tM, tE, tP] = await Promise.all([
  req('/hr/salary/structure/master?limit=5000', { token: HR }),
  req('/hr/salary/structure/elements?limit=5000', { token: HR }),
  req('/hr/salary/payelement-master?limit=5000', { token: HR }),
]);
const tplData = { master: tM.json?.rows || [], elements: tE.json?.rows || [], payElementMaster: tP.json?.rows || [] };
const wb = await lib.buildStructureWorkbook(tplData);
const buf = XLSX.write(wb, { type: 'array', bookType: 'xlsx' });
const tplPath = path.join(OUT, 'template-filled.xlsx');
fs.writeFileSync(tplPath, Buffer.from(buf));
check('C1. Template workbook downloads with real data', fs.statSync(tplPath).size > 0, `bytes=${fs.statSync(tplPath).size}`);

const rb = XLSX.read(fs.readFileSync(tplPath), { type: 'buffer' });
check('C2. Sheet names unchanged (import-compatible)', JSON.stringify(rb.SheetNames) === JSON.stringify(['EmployeeSalaryMaster', 'EmployeePayElements', 'PayElementMaster', 'ReadMe']), rb.SheetNames.join(','));
const gridOf = (name) => XLSX.utils.sheet_to_json(rb.Sheets[name] || {}, { header: 1, raw: true, defval: '' });
const gM = gridOf('EmployeeSalaryMaster');
const gE = gridOf('EmployeePayElements');
const gP = gridOf('PayElementMaster');
check('C3. Required column headers preserved', String(gM[0]?.[0]) === 'EmployeeCode' && String(gM[0]?.[1]) === 'Paycode' && String(gE[0]?.[0]) === 'Paycode' && String(gP[0]?.[0]) === 'PayElementCode', `M0=${gM[0]?.[0]} P0=${gP[0]?.[0]}`);
const bodyM = gM.slice(1).filter((r) => r.join('') !== '');
const bodyE = gE.slice(1).filter((r) => r.join('') !== '');
const bodyP = gP.slice(1).filter((r) => r.join('') !== '');
check('C4. EmployeeSalaryMaster sheet contains ALL real salary versions', bodyM.length === tplData.master.length && bodyM.length > 0, `sheet=${bodyM.length} api=${tplData.master.length}`);
check('C5. EmployeePayElements sheet contains ALL real pay-element rows', bodyE.length === tplData.elements.length && bodyE.length > 0, `sheet=${bodyE.length} api=${tplData.elements.length}`);
check('C6. PayElementMaster sheet contains ALL real master codes', bodyP.length === tplData.payElementMaster.length && bodyP.length > 0, `sheet=${bodyP.length} api=${tplData.payElementMaster.length}`);
const mHdr = gM[0].map(String);
const row1053 = bodyM.find((r) => String(r[mHdr.indexOf('Paycode')]) === '1053');
const api1053 = tplData.master.find((r) => String(r.paycode) === '1053') || {};
check('C7. Real employee/salary data mapped to correct columns (1053 example)',
  !!row1053 && near(Number(row1053[mHdr.indexOf('BasicSalary')]), 20416, 0.01)
  && String(row1053[mHdr.indexOf('EmployeeName')]) === 'Manik K Chaudhari'
  && String(row1053[mHdr.indexOf('EffectiveFrom')]).slice(0, 10) === '2026-03-31',
  `name=${row1053?.[mHdr.indexOf('EmployeeName')]} basic=${row1053?.[mHdr.indexOf('BasicSalary')]}`);
check('C8. Unavailable fields left blank (no fabricated values)', String(row1053?.[mHdr.indexOf('Remarks')] ?? '') === String(api1053.remarks ?? ''), `remarks='${row1053?.[mHdr.indexOf('Remarks')] ?? ''}'`);

/* ============ D. SAFE RE-IMPORT (edit + round-trip, cleanup included) ============ */
const rowsFrom = (grid) => {
  const hdr = (grid[0] || []).map((h) => String(h).trim()).filter(Boolean);
  return grid.slice(1).map((r, i) => {
    const o = { __row: i + 2 };
    hdr.forEach((h, idx) => { o[h] = r[idx]; });
    return o;
  }).filter((o) => Object.keys(o).some((k) => k !== '__row' && o[k] !== '' && o[k] !== undefined && o[k] !== null));
};
const importWb = (master, elements, payElementMaster) =>
  req('/hr/salary/structure/import', { method: 'POST', token: HR, body: { master, elements, payElementMaster } });
const countAll = async () => {
  const [m, e, p] = await Promise.all([
    req('/hr/salary/structure/master?limit=5000', { token: HR }),
    req('/hr/salary/structure/elements?limit=5000', { token: HR }),
    req('/hr/salary/payelement-master?limit=5000', { token: HR }),
  ]);
  return [(m.json?.rows || []).length, (e.json?.rows || []).length, (p.json?.rows || []).length];
};

const countsBefore = await countAll();
const d1 = await importWb(rowsFrom(gM), rowsFrom(gE), rowsFrom(gP));
const sm = d1.json?.summaries || {};
check('D1. Unchanged exported workbook re-imports as all Skipped (idempotent)',
  d1.status === 200 && (sm.master?.imported ?? -1) === 0 && (sm.master?.updated ?? -1) === 0 && (sm.master?.failed ?? -1) === 0
  && sm.master?.skipped === bodyM.length && (sm.elements?.failed ?? -1) === 0 && (sm.elements?.updated ?? -1) === 0
  && (sm.payElementMaster?.failed ?? -1) === 0 && (sm.payElementMaster?.updated ?? -1) === 0,
  `master i/u/s/f=${sm.master?.imported}/${sm.master?.updated}/${sm.master?.skipped}/${sm.master?.failed}`);
const countsAfter = await countAll();
check('D2. No duplicate rows created by the re-import', countsBefore[0] === countsAfter[0] && countsBefore[1] === countsAfter[1] && countsBefore[2] === countsAfter[2], `before=${countsBefore.join('/')} after=${countsAfter.join('/')}`);

const originalRemarks = String(api1053.remarks ?? '');
const editedRows = rowsFrom(gM).map((r) => ({ ...r }));
const targetRow = editedRows.find((r) => String(r.Paycode) === '1053' && String(r.EffectiveFrom).slice(0, 10) === '2026-03-31');
targetRow.Remarks = 'VERIFY-MARKER-RESTORE';
const d3 = await importWb([targetRow], [], []);
check('D3. Deliberately edited row -> server reports Updated for the matching version', d3.status === 200 && d3.json?.summaries?.master?.updated === 1, `updated=${d3.json?.summaries?.master?.updated} skipped=${d3.json?.summaries?.master?.skipped}`);
const afterEdit = await req('/hr/salary/structure/master?paycode=1053&limit=100', { token: HR });
const editRows = (afterEdit.json?.rows || []).filter((r) => String(r.paycode) === '1053' && String(r.effectivefrom).slice(0, 10) === '2026-03-31');
check('D4. Edit updated the existing version (no new duplicate row)', editRows.length === 1 && String(editRows[0].remarks) === 'VERIFY-MARKER-RESTORE', `rows=${editRows.length} remarks=${editRows[0]?.remarks}`);

const restoreRow = { ...targetRow, Remarks: originalRemarks };
const d5 = await importWb([restoreRow], [], []);
const afterRestore = await req('/hr/salary/structure/master?paycode=1053&limit=100', { token: HR });
const restoreRows = (afterRestore.json?.rows || []).filter((r) => String(r.paycode) === '1053' && String(r.effectivefrom).slice(0, 10) === '2026-03-31');
check('D5. Original value restored after the test (cleanup)', d5.json?.summaries?.master?.updated === 1 && String(restoreRows[0]?.remarks) === originalRemarks, `remarks='${restoreRows[0]?.remarks}'`);

// Conflicting duplicate rows in one file: unchanged row skips, conflicting row FAILS with a clear message.
const dupA = { ...restoreRow };
const dupB = { ...restoreRow, Remarks: 'CONFLICT-VALUE' };
const d6 = await importWb([dupA, dupB], [], []);
const conflictErr = ((d6.json?.summaries?.master?.errors || []).map((e) => e.message).join(' | '));
check('D6. Conflicting duplicate rows clearly reported (never silently merged)',
  (d6.json?.summaries?.master?.failed ?? 0) === 1 && /Duplicate of row \d+ in file|Conflicts with row/i.test(conflictErr),
  `failed=${d6.json?.summaries?.master?.failed} msg=${conflictErr.slice(0, 80)}`);

/* ============ E. SHARED-BACKEND PARITY (website + mobile one engine) ============ */
// Both clients call the same computeFullFinal: GET /api/employee/fullfinal
// (mobile self-service) and GET /api/hr/salary/fullfinal/:paycode (HR clients).
const EMP = process.env.TEST_PAYCODE || '0002';
const empPass = `Tpl${Math.random().toString(36).slice(2, 8)}1`;
await req('/hr/employee/credentials/password', { method: 'POST', token: HR, body: { paycode: EMP, password: empPass, confirmPassword: empPass, mustChange: false } });
const empLogin = await req('/auth/employee/login', { method: 'POST', body: { paycode: EMP, password: empPass } });
const selfRes = await req('/employee/fullfinal?leavingdate=2026-12-31', { token: empLogin.json?.token });
const hrRes = await req(`/hr/salary/fullfinal/${EMP}?leavingdate=2026-12-31`, { token: HR });
const sa = selfRes.json || {};
const sb = hrRes.json || {};
check('E1. Mobile self-service and HR route: identical Basic + Gross',
  sa?.salary?.gross != null && near(sa?.salary?.basic, sb?.salary?.basic) && near(sa?.salary?.gross, sb?.salary?.gross),
  `self=${sa?.salary?.basic}/${sa?.salary?.gross} hr=${sb?.salary?.basic}/${sb?.salary?.gross}`);
check('E2. Identical deductions + employer contributions across clients',
  near(sa?.salary?.breakdown?.deductionsTotal, sb?.salary?.breakdown?.deductionsTotal)
  && near(sa?.salary?.breakdown?.employerTotal, sb?.salary?.breakdown?.employerTotal),
  `self=${sa?.salary?.breakdown?.deductionsTotal}/${sa?.salary?.breakdown?.employerTotal} hr=${sb?.salary?.breakdown?.deductionsTotal}/${sb?.salary?.breakdown?.employerTotal}`);
check('E3. Identical Full & Final component totals across clients',
  near(sa?.estimate?.additionsTotal, sb?.estimate?.additionsTotal) && near(sa?.estimate?.estimatedTotal, sb?.estimate?.estimatedTotal),
  `self=${sa?.estimate?.estimatedTotal} hr=${sb?.estimate?.estimatedTotal}`);

const failed = results.filter((r) => !r.ok).length;
console.log(`\n${results.length - failed}/${results.length} checks passed.`);
process.exit(failed ? 1 : 0);