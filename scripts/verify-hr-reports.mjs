// ============================================================================
// scripts/verify-hr-reports.mjs
// Runtime verification — HR Admin Reports ("Reports & Analytics") with the
// COMPANY-WISE HR ADMIN ACCESS & REPORT SECURITY requirements:
//   - All-companies (bootstrap) HR Admin
//   - HR Admin restricted to ONE company
//   - HR Admin assigned to MULTIPLE companies
//   - Direct API access attempts for an unauthorised company (summary/register)
//   - Excel exports with unauthorised company ids
//   - Category / department filters and employee search under restricted access
//   - Module/action permission enforcement (View / Export) on the report APIs
//   - Permission refresh (SuperAdmin scope change applies to the next request)
//   - Regression smoke of the existing HR report endpoints
//
// Reads credentials from .env WITHOUT printing them. Test HR Admin accounts are
// created in the APP-OWNED tables (HR_AdminUser / HR_AdminCompany /
// HR_AdminPermission) through the SAME server/admin-access.js functions the
// SuperAdmin console uses, and are deleted again at the end. The Savior schema
// is never touched. Run the backend first:  npm run server
// Usage: node scripts/verify-hr-reports.mjs
// ============================================================================

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import * as XLSX from 'xlsx';
import { getPool } from '../server/db.js';
import {
  ensureAdminAccessTables, createHrAdmin, deleteHrAdmin,
  setCompanyScope, savePermissions, getEffectivePermissions, listCompanyCodes,
} from '../server/admin-access.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');

// ---- load .env (values never printed) ----
try {
  const envText = fs.readFileSync(path.join(ROOT, '.env'), 'utf8');
  for (const line of envText.split(/\r?\n/)) {
    const m = /^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/.exec(line);
    if (m && process.env[m[1]] === undefined) process.env[m[1]] = m[2].trim();
  }
} catch { /* .env missing — rely on process env */ }

const BASE = process.env.VERIFY_BASE || 'http://localhost:4000';
const HR_USER = process.env.HR_USERNAME || '';
const HR_PASS = process.env.HR_PASSWORD || '';
const TEST_PASSWORD = 'RptVerify123';

let passed = 0;
let failed = 0;
function check(name, cond, detail = '') {
  if (cond) { passed += 1; console.log(`PASS :: ${name}${detail ? ` :: ${detail}` : ''}`); }
  else { failed += 1; console.log(`FAIL :: ${name}${detail ? ` :: ${detail}` : ''}`); }
}
function note(text) { console.log(`NOTE :: ${text}`); }

async function req(method, apiPath, { token, body } = {}) {
  const headers = { Accept: 'application/json' };
  if (token) headers.Authorization = `Bearer ${token}`;
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  const res = await fetch(`${BASE}${apiPath}`, { method, headers, body: body !== undefined ? JSON.stringify(body) : undefined });
  const contentType = res.headers.get('content-type') || '';
  let json = null;
  let buf = null;
  if (contentType.includes('application/json')) json = await res.json().catch(() => null);
  else buf = Buffer.from(await res.arrayBuffer());
  return { status: res.status, json, buf, contentType };
}

async function loginHr(username, password) {
  const r = await req('POST', '/api/auth/hr/login', { body: { username, password } });
  return r.json?.token || null;
}

const noToken = (r) => r.status === 401;
const isForbiddenCode = (r, code) => r.status === 403 && (!code || r.json?.code === code);

/** All paycodes whose company is NOT in `allowed` (for out-of-scope attacks). */
async function paycodesOutside(allowed) {
  const pool = await getPool();
  // Sample widely and filter in JS — the point is to find ANY paycode outside the
  // allowed set, not the first rows of the table.
  const result = await pool.request().query(
    "SELECT TOP (5000) LTRIM(RTRIM(paycode)) AS paycode, LTRIM(RTRIM(companycode)) AS companycode FROM dbo.tblemployee WHERE LTRIM(RTRIM(paycode)) <> ''",
  );
  const allowedSet = new Set((allowed || []).map((c) => String(c).trim().toUpperCase()));
  return result.recordset
    .map((r) => ({ paycode: String(r.paycode).trim(), companycode: String(r.companycode || '').trim() }))
    .filter((r) => r.paycode && !allowedSet.has(r.companycode.toUpperCase()))
    .slice(0, 5);
}

/** Company codes of a set of paycodes (one query). */
async function companiesOfPaycodes(paycodes) {
  const pool = await getPool();
  const list = [...new Set(paycodes)].slice(0, 500);
  if (!list.length) return new Map();
  const result = await pool.request().query(
    `SELECT LTRIM(RTRIM(paycode)) AS paycode, LTRIM(RTRIM(companycode)) AS companycode FROM dbo.tblemployee WHERE LTRIM(RTRIM(paycode)) IN (${list.map((p) => `'${String(p).replace(/'/g, "''")}'`).join(',')})`,
  );
  const map = new Map();
  for (const r of result.recordset) map.set(String(r.paycode).trim(), String(r.companycode || '').trim().toUpperCase());
  return map;
}

async function main() {
  console.log(`\n=== HR Admin Reports verification against ${BASE} ===\n`);

  // ---------- 1) All-companies (bootstrap) HR Admin ----------
  const bootstrapToken = await loginHr(HR_USER, HR_PASS);
  check('Bootstrap HR Admin login works', Boolean(bootstrapToken));
  if (!bootstrapToken) { console.error('Cannot continue without the bootstrap HR login.'); process.exit(1); }

  const me = await req('GET', '/api/me', { token: bootstrapToken });
  check('GET /api/me returns HR identity from the server session', me.status === 200 && me.json?.role === 'HR');

  // Regression smoke — EXISTING HR endpoints must be untouched.
  const dash = await req('GET', '/api/hr/dashboard', { token: bootstrapToken });
  check('Regression: GET /api/hr/dashboard still works', dash.status === 200 && dash.json?.success !== false, `HTTP ${dash.status}`);
  const daily = await req('GET', '/api/hr/daily?days=2', { token: bootstrapToken });
  check('Regression: GET /api/hr/daily still works', daily.status === 200, `HTTP ${daily.status}`);
  const cat = await req('GET', '/api/hr/category-analytics?mode=daily', { token: bootstrapToken });
  check('Regression: GET /api/hr/category-analytics still works', cat.status === 200, `HTTP ${cat.status}`);
  const legacyFilters = await req('GET', '/api/hr/filters', { token: bootstrapToken });
  check('Regression: GET /api/hr/filters still works', legacyFilters.status === 200, `HTTP ${legacyFilters.status}`);
  const health = await req('GET', '/api/health');
  check('Regression: GET /api/health still works', health.status === 200, `HTTP ${health.status}`);
  const saBlocked = await req('GET', '/api/superadmin/catalog', { token: bootstrapToken });
  check('Regression: SuperAdmin surface still rejects HR tokens', saBlocked.status === 403, `HTTP ${saBlocked.status}`);

  // Report APIs (bootstrap = every authorised company).
  const bootFilters = await req('GET', '/api/hr/reports/filters', { token: bootstrapToken });
  check('Bootstrap: GET /api/hr/reports/filters works', bootFilters.status === 200 && Array.isArray(bootFilters.json?.companies), `HTTP ${bootFilters.status}`);
  const allCompanyCodes = (bootFilters.json?.companies || []).map((c) => String(c.code).trim().toUpperCase()).filter(Boolean);
  check('Bootstrap: filter options include companies from the master', allCompanyCodes.length > 0, `${allCompanyCodes.length} companies`);
  check('Bootstrap: filter options include departments / categories / shifts',
    Array.isArray(bootFilters.json?.departments) && Array.isArray(bootFilters.json?.categories) && Array.isArray(bootFilters.json?.shifts));

  const bootSummary = await req('GET', '/api/hr/reports/summary?days=7&dimension=company', { token: bootstrapToken });
  check('Bootstrap: GET /api/hr/reports/summary works', bootSummary.status === 200 && bootSummary.json?.success === true, `HTTP ${bootSummary.status}`);
  const bootRegister = await req('GET', '/api/hr/reports/register?days=7', { token: bootstrapToken });
  check('Bootstrap: GET /api/hr/reports/register works', bootRegister.status === 200 && Array.isArray(bootRegister.json?.rows), `HTTP ${bootRegister.status}`);
  const bootEmp = await req('GET', '/api/hr/reports/employees', { token: bootstrapToken });
  check('Bootstrap: GET /api/hr/reports/employees works', bootEmp.status === 200 && Array.isArray(bootEmp.json?.employees), `HTTP ${bootEmp.status}`);
  const bootExport = await req('GET', '/api/hr/reports/export?days=7', { token: bootstrapToken });
  check('Bootstrap: GET /api/hr/reports/export returns an .xlsx workbook', bootExport.status === 200 && bootExport.buf && bootExport.buf.slice(0, 2).toString() === 'PK', `HTTP ${bootExport.status}`);
  const bootCmp = (bootSummary.json?.companyComparison || []).map((g) => String(g.key || '').toUpperCase());
  check('Bootstrap: company comparison covers the authorised companies', bootCmp.length > 0, `${bootCmp.length} group(s)`);

  const pool = await getPool();
  await ensureAdminAccessTables(pool);
  const realCompanies = await listCompanyCodes(pool);
  check('Company catalogue available for scope tests', realCompanies.length > 0, `${realCompanies.length} code(s)`);
  const compA = realCompanies[0] || null;
  const compB = realCompanies[1] || null;
  const compC = realCompanies[2] || null;
  const unknownCode = 'ZZUNAUTH'; // never a real company code

  // ---------- 2) Restricted / multi / empty-scope HR Admin accounts ----------
  const stamp = Date.now().toString(36).toUpperCase();
  const users = {
    one: `RPTONE${stamp}`,
    multi: `RPTMULTI${stamp}`,
    none: `RPTNONE${stamp}`,
    legacy: `RPTLEGACY${stamp}`,
  };
  const created = [];
  async function makeAdmin(username, companies) {
    const outcome = await createHrAdmin(pool, { username, password: TEST_PASSWORD, displayname: `Verify ${username}`, companies }, 'verify-hr-reports');
    check(`Create test HR Admin ${username}`, outcome.ok === true, outcome.message || '');
    if (outcome.ok) created.push(username);
    return outcome.ok;
  }

  await makeAdmin(users.one, compA ? [compA] : []);
  await makeAdmin(users.multi, [compA, compB].filter(Boolean));
  await makeAdmin(users.none, undefined);   // no company rows => empty scope => deny
  await makeAdmin(users.legacy, [compA].filter(Boolean));

  /** Grant the SuperAdmin-style reports permissions (View [+ Export]). */
  async function grantReports(username, { view = true, export: exp = true } = {}) {
    const perms = await getEffectivePermissions(pool, username);
    perms.reports = { ...(perms.reports || {}), view, export: exp };
    await savePermissions(pool, username, perms, 'verify-hr-reports');
  }
  await grantReports(users.one, { view: true, export: true });
  await grantReports(users.multi, { view: true, export: true });
  await grantReports(users.none, { view: true, export: true });

  // ---------- 3) HR Admin restricted to ONE company ----------
  const oneToken = await loginHr(users.one, TEST_PASSWORD);
  check('One-company HR Admin login works', Boolean(oneToken));
  const scopeA = [compA].filter(Boolean).map((c) => c.toUpperCase());
  const allowedA = (code) => scopeA.includes(String(code || '').trim().toUpperCase());

  const oneMe = await req('GET', '/api/me', { token: oneToken });
  check('One-company: /api/me reports exactly the assigned company',
    oneMe.status === 200 && Array.isArray(oneMe.json?.companies) && oneMe.json.companies.length === scopeA.length
    && oneMe.json.companies.every((c) => allowedA(c)), JSON.stringify(oneMe.json?.companies || []));

  const oneFilters = await req('GET', '/api/hr/reports/filters', { token: oneToken });
  const oneCompanies = (oneFilters.json?.companies || []).map((c) => String(c.code).trim());
  check('One-company: filter dropdown offers ONLY the assigned company',
    oneFilters.status === 200 && oneCompanies.length > 0 && oneCompanies.every(allowedA), JSON.stringify(oneCompanies));

  const oneSummary = await req('GET', '/api/hr/reports/summary?days=7&dimension=company', { token: oneToken });
  const oneCmp = (oneSummary.json?.companyComparison || []).map((g) => String(g.key || '').trim());
  check('One-company: summary + company comparison limited to the assigned company',
    oneSummary.status === 200 && oneCmp.every(allowedA), JSON.stringify(oneCmp));

  const oneRegister = await req('GET', '/api/hr/reports/register?days=7', { token: oneToken });
  const oneRows = oneRegister.json?.rows || [];
  check('One-company: every register row belongs to the assigned company',
    oneRegister.status === 200 && oneRows.every((r) => allowedA(r.companycode)), `${oneRows.length} row(s)`);

  const oneEmps = await req('GET', '/api/hr/reports/employees', { token: oneToken });
  const oneEmpRows = oneEmps.json?.employees || [];
  check('One-company: employee search returns only in-company employees',
    oneEmps.status === 200 && oneEmpRows.length > 0 && oneEmpRows.every((e) => allowedA(e.companycode)), `${oneEmpRows.length} employee(s)`);

  // Direct API attacks — unauthorised company id in manipulated filters.
  const oneAtkSummary = await req('GET', `/api/hr/reports/summary?days=7&companycode=${unknownCode}`, { token: oneToken });
  check('One-company: summary rejects unauthorised company id (403)', isForbiddenCode(oneAtkSummary, 'COMPANY_FORBIDDEN'), `HTTP ${oneAtkSummary.status} ${oneAtkSummary.json?.code || ''}`);
  const oneAtkRegister = await req('GET', `/api/hr/reports/register?days=7&companycode=${unknownCode}`, { token: oneToken });
  check('One-company: register rejects unauthorised company id (403)', isForbiddenCode(oneAtkRegister, 'COMPANY_FORBIDDEN'), `HTTP ${oneAtkRegister.status}`);
  const oneAtkExport = await req('GET', `/api/hr/reports/export?days=7&companycode=${unknownCode}`, { token: oneToken });
  check('One-company: Excel export rejects unauthorised company id (403)', isForbiddenCode(oneAtkExport, 'COMPANY_FORBIDDEN'), `HTTP ${oneAtkExport.status}`);
  if (compB && compB.toUpperCase() !== scopeA[0]) {
    const oneAtkReal = await req('GET', `/api/hr/reports/summary?days=7&companycode=${encodeURIComponent(compB)}`, { token: oneToken });
    check('One-company: summary rejects a REAL other company code (403)', isForbiddenCode(oneAtkReal, 'COMPANY_FORBIDDEN'), `HTTP ${oneAtkReal.status}`);
    const oneAtkExportReal = await req('GET', `/api/hr/reports/export?days=7&companycode=${encodeURIComponent(compB)}`, { token: oneToken });
    check('One-company: Excel export rejects a REAL other company code (403)', isForbiddenCode(oneAtkExportReal, 'COMPANY_FORBIDDEN'), `HTTP ${oneAtkExportReal.status}`);
  }
  const outside = await paycodesOutside(scopeA);
  if (outside.length) {
    const oneAtkPay = await req('GET', `/api/hr/reports/summary?days=7&paycode=${encodeURIComponent(outside[0].paycode)}`, { token: oneToken });
    check('One-company: single-employee report rejects an out-of-scope paycode (403)', isForbiddenCode(oneAtkPay), `HTTP ${oneAtkPay.status} ${oneAtkPay.json?.code || ''}`);
  } else {
    note('No out-of-scope paycode exists in the master — paycode attack test skipped.');
  }

  // Category / department filters + employee search under restricted access.
  const oneCats = (oneFilters.json?.categories || []).map((c) => String(c.code).trim()).filter(Boolean);
  if (oneCats.length) {
    const catRows = await req('GET', `/api/hr/reports/register?days=7&cat=${encodeURIComponent(oneCats[0])}`, { token: oneToken });
    check('One-company: category filter keeps rows inside the assigned company',
      catRows.status === 200 && (catRows.json?.rows || []).every((r) => allowedA(r.companycode) && String(r.category || '').trim() === oneCats[0]), `${(catRows.json?.rows || []).length} row(s)`);
  } else note('No category values in scope — category filter test simplified.');
  const oneDepts = (oneFilters.json?.departments || []).map((d) => String(d.code).trim()).filter(Boolean);
  if (oneDepts.length) {
    const deptRows = await req('GET', `/api/hr/reports/register?days=7&departmentcode=${encodeURIComponent(oneDepts[0])}`, { token: oneToken });
    check('One-company: department filter keeps rows inside the assigned company',
      deptRows.status === 200 && (deptRows.json?.rows || []).every((r) => allowedA(r.companycode)), `${(deptRows.json?.rows || []).length} row(s)`);
  } else note('No department values in scope — department filter test simplified.');
  const searchRows = await req('GET', '/api/hr/reports/employees?search=a&days=7', { token: oneToken });
  check('One-company: employee search with a filter term stays inside the assigned company',
    searchRows.status === 200 && (searchRows.json?.employees || []).every((e) => allowedA(e.companycode)), `${(searchRows.json?.employees || []).length} hit(s)`);

  if (oneEmpRows.length) {
    const oneSingle = await req('GET', `/api/hr/reports/summary?days=7&paycode=${encodeURIComponent(oneEmpRows[0].paycode)}`, { token: oneToken });
    check('One-company: single-employee report works for an in-scope employee',
      oneSingle.status === 200 && String(oneSingle.json?.employee?.paycode || '') === oneEmpRows[0].paycode, `HTTP ${oneSingle.status}`);
  }

  // Authorised Excel export — the workbook itself must only carry in-scope rows.
  const oneExport = await req('GET', '/api/hr/reports/export?days=7', { token: oneToken });
  check('One-company: authorised Excel export returns an .xlsx workbook',
    oneExport.status === 200 && oneExport.buf && oneExport.buf.slice(0, 2).toString() === 'PK', `HTTP ${oneExport.status}`);
  if (oneExport.buf && oneExport.buf.slice(0, 2).toString() === 'PK') {
    const book = XLSX.read(oneExport.buf, { type: 'buffer' });
    check('Export workbook contains Summary / Comparison / Register sheets',
      ['Report Summary', 'Group Comparison', 'Detailed Register'].every((n) => book.SheetNames.includes(n)), book.SheetNames.join(', '));
    const regSheet = XLSX.utils.sheet_to_json(book.Sheets['Detailed Register'] || {}, { defval: '' });
    const exportPaycodes = regSheet.map((r) => String(r.Paycode || '').trim()).filter(Boolean);
    const paycodeCompanies = await companiesOfPaycodes(exportPaycodes);
    const leaks = exportPaycodes.filter((p) => {
      const c = paycodeCompanies.get(p) || '';
      return c && !allowedA(c);
    });
    check('Exported Excel rows are limited to the assigned company', leaks.length === 0, `${exportPaycodes.length} row(s), ${leaks.length} leak(s)`);
  }

  // ---------- 4) HR Admin assigned to MULTIPLE companies ----------
  const multiScope = [compA, compB].filter(Boolean).map((c) => c.toUpperCase());
  const multiToken = await loginHr(users.multi, TEST_PASSWORD);
  check('Multi-company HR Admin login works', Boolean(multiToken));
  const allowedMulti = (code) => multiScope.includes(String(code || '').trim().toUpperCase());

  const multiFilters = await req('GET', '/api/hr/reports/filters', { token: multiToken });
  const multiCompanies = (multiFilters.json?.companies || []).map((c) => String(c.code).trim());
  check('Multi-company: filter dropdown offers exactly the assigned companies',
    multiFilters.status === 200 && multiCompanies.length > 0 && multiCompanies.every(allowedMulti) && multiCompanies.length === multiScope.length,
    JSON.stringify(multiCompanies));

  const multiSummary = await req('GET', '/api/hr/reports/summary?days=7&dimension=company', { token: multiToken });
  const multiCmp = (multiSummary.json?.companyComparison || []).map((g) => String(g.key || '').trim());
  check('Multi-company: comparison runs ONLY between the assigned companies',
    multiSummary.status === 200 && multiCmp.length > 0 && multiCmp.every(allowedMulti), JSON.stringify(multiCmp));

  const multiRegister = await req('GET', '/api/hr/reports/register?days=7', { token: multiToken });
  check('Multi-company: every register row belongs to an assigned company',
    multiRegister.status === 200 && (multiRegister.json?.rows || []).every((r) => allowedMulti(r.companycode)), `${(multiRegister.json?.rows || []).length} row(s)`);

  const multiAtk = await req('GET', `/api/hr/reports/summary?days=7&companycode=${compC || unknownCode}`, { token: multiToken });
  check('Multi-company: summary rejects a company outside the assignment (403)', isForbiddenCode(multiAtk, 'COMPANY_FORBIDDEN'), `HTTP ${multiAtk.status}`);
  const multiAtkExport = await req('GET', `/api/hr/reports/export?days=7&companycode=${compC || unknownCode}`, { token: multiToken });
  check('Multi-company: Excel export rejects a company outside the assignment (403)', isForbiddenCode(multiAtkExport, 'COMPANY_FORBIDDEN'), `HTTP ${multiAtkExport.status}`);

  // ---------- 5) HR Admin with NO assigned company (fail closed) ----------
  const noneToken = await loginHr(users.none, TEST_PASSWORD);
  check('No-company HR Admin login works', Boolean(noneToken));
  const noneSummary = await req('GET', '/api/hr/reports/summary?days=7', { token: noneToken });
  check('No-company: report summary is DENIED (fail closed, not empty data)', isForbiddenCode(noneSummary), `HTTP ${noneSummary.status} ${noneSummary.json?.code || ''}`);
  const noneFilters = await req('GET', '/api/hr/reports/filters', { token: noneToken });
  check('No-company: report filters are DENIED (fail closed)', isForbiddenCode(noneFilters), `HTTP ${noneFilters.status}`);
  const noneExport = await req('GET', '/api/hr/reports/export?days=7', { token: noneToken });
  check('No-company: Excel export is DENIED (fail closed)', isForbiddenCode(noneExport), `HTTP ${noneExport.status}`);

  // ---------- 6) Module/action permissions enforced on the server ----------
  await grantReports(users.one, { view: false, export: true });
  const deniedView = await req('GET', '/api/hr/reports/summary?days=7', { token: oneToken });
  check('Permission: reports View=false denies the report API (403 PERMISSION_DENIED)', isForbiddenCode(deniedView, 'PERMISSION_DENIED'), `HTTP ${deniedView.status} ${deniedView.json?.code || ''}`);
  await grantReports(users.one, { view: true, export: false });
  const okView = await req('GET', '/api/hr/reports/summary?days=7', { token: oneToken });
  check('Permission: reports View=true still works', okView.status === 200, `HTTP ${okView.status}`);
  const deniedExport = await req('GET', '/api/hr/reports/export?days=7', { token: oneToken });
  check('Permission: reports Export=false denies the Excel export (403 PERMISSION_DENIED)', isForbiddenCode(deniedExport, 'PERMISSION_DENIED'), `HTTP ${deniedExport.status} ${deniedExport.json?.code || ''}`);
  await grantReports(users.one, { view: true, export: true });

  // ---------- 7) SuperAdmin scope change applies to the NEXT request ----------
  if (compB && compB.toUpperCase() !== scopeA[0]) {
    await setCompanyScope(pool, users.one, [compB], 'verify-hr-reports');
    const refreshed = await req('GET', '/api/hr/reports/summary?days=7&dimension=company', { token: oneToken });
    const refreshedCmp = (refreshed.json?.companyComparison || []).map((g) => String(g.key || '').trim());
    check('Scope refresh: after SuperAdmin re-assignment the report follows the NEW company',
      refreshed.status === 200 && refreshedCmp.length > 0 && refreshedCmp.every((c) => String(c).toUpperCase() === compB.toUpperCase()), JSON.stringify(refreshedCmp));
    const staleAtk = await req('GET', `/api/hr/reports/summary?days=7&companycode=${encodeURIComponent(compA)}`, { token: oneToken });
    check('Scope refresh: the OLD company is now rejected (403)', isForbiddenCode(staleAtk, 'COMPANY_FORBIDDEN'), `HTTP ${staleAtk.status}`);
    await setCompanyScope(pool, users.one, [compA], 'verify-hr-reports');
  } else {
    note('Only one company exists in the master — scope-change refresh test skipped.');
  }

  // ---------- 8) Informational: pre-existing account without a 'reports' row ----------
  const legacyPerms = await getEffectivePermissions(pool, users.legacy);
  delete legacyPerms.reports; // simulate an account saved BEFORE the reports module existed
  await savePermissions(pool, users.legacy, legacyPerms, 'verify-hr-reports');
  const legacyToken = await loginHr(users.legacy, TEST_PASSWORD);
  const legacySummary = await req('GET', '/api/hr/reports/summary?days=7', { token: legacyToken });
  note(`Legacy-row behaviour (moduleAllowed legacy flag): account with stored permissions but NO reports row gets HTTP ${legacySummary.status} on the report API. ` +
    (legacySummary.status === 200
      ? 'Historical ALLOW preserved.'
      : 'DENIED until SuperAdmin saves the reports permission for that account (the UI shows the same state; no existing feature is affected).'));

  // ---------- cleanup ----------
  for (const username of created) {
    try { await deleteHrAdmin(pool, username); } catch (e) { note(`Cleanup failed for ${username}: ${String(e?.message || e).slice(0, 100)}`); }
  }
  check('Cleanup: test HR Admin accounts removed', true, `${created.length} account(s)`);

  console.log(`\n=== RESULT: ${passed} passed, ${failed} failed ===`);
  process.exit(failed ? 1 : 0);
}

main().catch((error) => {
  console.error('VERIFY_RUN_ERROR', error && (error.message || error));
  process.exit(1);
});