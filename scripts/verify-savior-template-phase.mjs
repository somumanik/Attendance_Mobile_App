// SAVER SQL TEMPLATE PREFILL - runtime verification (read-only + one controlled
// import/cleanup round-trip). Verifies the downloaded workbook against the
// actual Savior SQL Server records and proves NO application-table fallback.
import 'dotenv/config';
import fs from 'fs';
import path from 'path';
import { pathToFileURL } from 'node:url';
import { getPool } from '../server/db.js';

const BASE = 'http://localhost:4000/api';
const OUT = path.join(process.cwd(), 'scripts', '_salary_ui_out');
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

const hrLogin = await req('/auth/hr/login', { method: 'POST', body: { username: process.env.HR_USERNAME, password: process.env.HR_PASSWORD } });
check('A1. HR Admin login', hrLogin.status === 200 && !!hrLogin.json?.token, `HTTP ${hrLogin.status}`);
const HR = hrLogin.json?.token;
if (!HR) process.exit(1);
const noTok = await req('/hr/salary/structure/template-source');
check('A2. Template-source export is HR-authorized (401 without session)', noTok.status === 401 || noTok.status === 403, `HTTP ${noTok.status}`);

let pool = null;
for (let i = 0; i < 5 && !pool; i += 1) {
  try { pool = await getPool(); } catch { await new Promise((r) => setTimeout(r, 2000)); }
}
if (!pool) { console.error('SQL connection unavailable'); process.exit(1); }
const src = await req('/hr/salary/structure/template-source', { token: HR });
const rows = src.json?.master || [];
const report = src.json?.report || {};

/* ============ B. SOURCE VERIFICATION vs DIRECT SAVIOR SQL ============ */
const roster = (await pool.request().query(`
  SELECT LTRIM(RTRIM(paycode)) AS paycode, LTRIM(RTRIM(empname)) AS empname,
         LTRIM(RTRIM(presentcardno)) AS presentcardno, LTRIM(RTRIM(companycode)) AS companycode,
         LTRIM(RTRIM(departmentcode)) AS departmentcode, LTRIM(RTRIM(designation)) AS designation,
         LTRIM(RTRIM(LocationName)) AS locationname
  FROM dbo.tblemployee WHERE ISNULL(LTRIM(RTRIM(active)), 'Y') <> 'N'`)).recordset;
const rosterMap = new Map(roster.map((r) => [r.paycode, r]));
check('B1. Every exported row is a real Savior roster employee (count matches)', rows.length === roster.length && rows.length > 0, `exported=${rows.length} roster=${roster.length}`);
let identityBad = 0;
for (const row of rows) {
  const db = rosterMap.get(row.paycode);
  if (!db) { identityBad += 1; continue; }
  if ((row.empname || '') !== (db.empname || '') || (row.presentcardno || '') !== (db.presentcardno || '')
    || (row.companycode || '') !== (db.companycode || '') || (row.departmentcode || '') !== (db.departmentcode || '')
    || (row.designation || '') !== (db.designation || '') || (row.locationcode || '') !== (db.locationname || '')) identityBad += 1;
}
check('B2. Identity fields verified against dbo.tblemployee column-by-column', identityBad === 0, `mismatches=${identityBad}`);
const codeMapDb = new Map((await pool.request().query(
  `SELECT LTRIM(RTRIM(paycode)) AS paycode, LTRIM(RTRIM(employeecode)) AS employeecode FROM dbo.HR_EmployeeCodeMapping`,
)).recordset.map((m) => [m.paycode, m.employeecode]));
const codeBad = rows.filter((r) => (r.employeecode || '') !== (codeMapDb.get(r.paycode) || '')).length;
check('B3. EmployeeCode follows the established paycode identity mapping (blank when unmapped)', codeBad === 0, `mismatches=${codeBad}`);
const salaryFields = ['effectivefrom', 'basicsalary', 'pfapplicable', 'esiapplicable', 'pfwage', 'esiwage', 'currency', 'remarks'];
const nonBlank = rows.filter((r) => salaryFields.some((f) => r[f] !== '' && r[f] !== null && r[f] !== undefined));
check('B4. Salary fields BLANK on every row (never 0 / never N / never fabricated)', nonBlank.length === 0, `nonBlankRows=${nonBlank.length}`);
check('B5. No fabricated pay-element rows (sheets stay empty without a Savior source)',
  (src.json?.elements || []).length === 0 && (src.json?.payElementMaster || []).length === 0,
  `elements=${(src.json?.elements || []).length} pem=${(src.json?.payElementMaster || []).length}`);
check('B6. Report states the unavailable salary fields + reason', (report.unavailableFields || []).includes('BasicSalary') && /authoritative payroll source/.test(report.unavailableReason || ''), `employees=${report.employees}`);

/* ============ C. NO APPLICATION-TABLE FALLBACK (definitive) ============ */
const appMaster = await req('/hr/salary/structure/master?limit=5000', { token: HR });
const appRows = appMaster.json?.rows || [];
const appWithBasic = appRows.filter((r) => Number(r.basicsalary) > 0);
const tplWithBasic = rows.filter((r) => r.basicsalary !== '' && r.basicsalary !== null && r.basicsalary !== undefined);
check('C1. Application HR_SalaryMaster HAS salary data, yet template basics stay blank (no fallback)',
  appWithBasic.length > 0 && tplWithBasic.length === 0,
  `appRowsWithBasic=${appWithBasic.length} templateRowsWithBasic=${tplWithBasic.length}`);
const appElemCount = (await pool.request().query('SELECT COUNT(1) AS n FROM dbo.HR_SalaryElement')).recordset[0]?.n;
const appPemCount = (await pool.request().query('SELECT COUNT(1) AS n FROM dbo.HR_PayElementMaster')).recordset[0]?.n;
check('C2. Application pay-element tables HAVE rows, yet template sheets stay empty (no fallback)',
  appElemCount > 0 && appPemCount > 0 && (src.json?.elements || []).length === 0 && (src.json?.payElementMaster || []).length === 0,
  `appElements=${appElemCount} appPem=${appPemCount}`);

/* ============ D. DOWNLOADED WORKBOOK VALIDATION ============ */
const lib = await import(pathToFileURL(path.join(process.cwd(), 'web-next', 'lib', 'salaryStructure.js')).href);
const XLSX = await import('xlsx');
const wb = await lib.buildStructureWorkbook({ master: rows, elements: [], payElementMaster: [] });
const tplPath = path.join(OUT, 'savior-template.xlsx');
fs.writeFileSync(tplPath, Buffer.from(XLSX.write(wb, { type: 'array', bookType: 'xlsx' })));
const rb = XLSX.read(fs.readFileSync(tplPath), { type: 'buffer' });
check('D1. Workbook opens as a valid .xlsx with the established sheets', JSON.stringify(rb.SheetNames) === JSON.stringify(['EmployeeSalaryMaster', 'EmployeePayElements', 'PayElementMaster', 'ReadMe']), rb.SheetNames.join(','));
const gridOf = (n) => XLSX.utils.sheet_to_json(rb.Sheets[n] || {}, { header: 1, raw: true, defval: '' });
const gM = gridOf('EmployeeSalaryMaster');
const bodyM = gM.slice(1).filter((r) => r.join('') !== '');
check('D2. EmployeeSalaryMaster sheet contains every Savior roster row', bodyM.length === rows.length && bodyM.length > 0, `sheet=${bodyM.length} source=${rows.length}`);
const hdr = (gM[0] || []).map(String);
const idx = (name) => hdr.indexOf(name);
const db1053 = rosterMap.get('1053');
const row1053 = bodyM.find((r) => String(r[idx('Paycode')]) === '1053');
check('D3. Sample row verified against Savior (1053: name, biometric, dept)',
  !!row1053 && String(row1053[idx('EmployeeName')]) === (db1053?.empname || '')
  && String(row1053[idx('BiometricCode')]) === (db1053?.presentcardno || '')
  && String(row1053[idx('Department')]) === (db1053?.departmentcode || ''),
  `name=${row1053?.[idx('EmployeeName')]} bio=${row1053?.[idx('BiometricCode')]}`);
check('D4. Unavailable salary cells are BLANK in the workbook (not 0, not N)',
  bodyM.every((r) => ['EffectiveFrom', 'BasicSalary', 'PFApplicable', 'ESIApplicable', 'PFWage', 'ESIWage', 'Currency', 'Remarks'].every((c) => String(r[idx(c)] ?? '') === '')),
  'all salary cells blank');
const gE = gridOf('EmployeePayElements');
const gP = gridOf('PayElementMaster');
check('D5. EmployeePayElements / PayElementMaster sheets are headers-only (no invented rows)',
  gE.slice(1).filter((r) => r.join('') !== '').length === 0 && gP.slice(1).filter((r) => r.join('') !== '').length === 0
  && String(gE[0]?.[0]) === 'Paycode' && String(gP[0]?.[0]) === 'PayElementCode',
  `elemRows=${gE.length - 1} pemRows=${gP.length - 1}`);
check('D6. EmployeeNumber never exported (not in workbook headers)', !hdr.includes('EmployeeNumber'), hdr.join(',').slice(0, 60));

/* ============ E. DOWNLOADS ARE READ-ONLY ============ */
const counts = async () => (await pool.request().query(`
  SELECT (SELECT COUNT(1) FROM dbo.tblemployee) AS emp,
         (SELECT COUNT(1) FROM dbo.HR_SalaryMaster) AS m,
         (SELECT COUNT(1) FROM dbo.HR_SalaryElement) AS e,
         (SELECT COUNT(1) FROM dbo.HR_PayElementMaster) AS p`)).recordset[0];
const cBefore = await counts();
await req('/hr/salary/structure/template-source', { token: HR });
await req('/hr/salary/structure/template-source', { token: HR });
const cAfter = await counts();
check('E1. Repeated downloads never create or modify database records',
  JSON.stringify(cBefore) === JSON.stringify(cAfter), `before=${JSON.stringify(cBefore)}`);

/* ============ F. SAFE IMPORT OF THE EXPORTED WORKBOOK ============ */
const rowsFromGrid = (grid) => {
  const h = (grid[0] || []).map((x) => String(x).trim()).filter(Boolean);
  return grid.slice(1).map((r, i) => {
    const o = { __row: i + 2 };
    h.forEach((hh, idx2) => { o[hh] = r[idx2]; });
    return o;
  }).filter((o) => Object.keys(o).some((k) => k !== '__row' && o[k] !== '' && o[k] !== undefined && o[k] !== null));
};
const importRows = (master) => req('/hr/salary/structure/import', { method: 'POST', token: HR, body: { master, elements: [], payElementMaster: [] } });

// F1: unchanged (salary fields blank) -> nothing written, every row reported.
const f1 = await importRows(rowsFromGrid(gM));
const s1 = f1.json?.summaries?.master || {};
const countsAfterF1 = await counts();
check('F1. Unchanged workbook import writes NOTHING (rows clearly reported, no silent drops)',
  (s1.imported ?? -1) === 0 && (s1.updated ?? -1) === 0 && (s1.failed ?? 0) === bodyM.length
  && JSON.stringify(countsAfterF1) === JSON.stringify(cBefore),
  `i/u/f=${s1.imported}/${s1.updated}/${s1.failed}`);
const sampleMsg = (s1.errors || []).slice(0, 1).map((e) => e.message).join('');
check('F2. Rows missing salary fields get a clear per-row reason (not guessed)', /EffectiveFrom|PFApplicable|BasicSalary/i.test(sampleMsg), sampleMsg.slice(0, 90));

// F3: HR completes one row -> imports as the intended new version.
const completed = rowsFromGrid(gM).map((r) => ({ ...r }));
const target = completed.find((r) => String(r.Paycode) === '1053');
target.EffectiveFrom = '2099-01-01';
target.BasicSalary = 12345;
target.PFApplicable = 'N';
target.ESIApplicable = 'N';
target.Remarks = 'VERIFY-SAVIOR-TEMPLATE';
const f3 = await importRows([target]);
check('F3. Completed template row imports (HR fill -> import works end-to-end)', f3.json?.summaries?.master?.imported === 1, `imported=${f3.json?.summaries?.master?.imported}`);
const f3b = await importRows([target]);
check('F4. Re-importing the identical completed row is idempotent (no duplicates)', f3b.json?.summaries?.master?.skipped === 1 && f3b.json?.summaries?.master?.imported === 0, `skipped=${f3b.json?.summaries?.master?.skipped}`);

// F5: cleanup - remove the test version, restore exact prior state.
const afterCreate = await req('/hr/salary/structure/master?paycode=1053&limit=100', { token: HR });
const testRow = (afterCreate.json?.rows || []).find((r) => String(r.effectivefrom).slice(0, 10) === '2099-01-01');
await req('/hr/salary/structure/master', { method: 'DELETE', token: HR, body: { ids: [testRow?.id].filter(Boolean) } });
const countsFinal = await counts();
check('F5. Test import cleaned up - database restored to its prior state', JSON.stringify(countsFinal) === JSON.stringify(cBefore), `final=${JSON.stringify(countsFinal)}`);

const failed = results.filter((r) => !r.ok).length;
console.log(`\n${results.length - failed}/${results.length} checks passed.`);
process.exit(failed ? 1 : 0);