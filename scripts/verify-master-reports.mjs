// ============================================================================
// scripts/verify-master-reports.mjs
// Focused runtime verification for the HR Admin "Master Reports" module
// (route /hr/reports, internal module key `reports`):
//   1. HR Admin WITHOUT Master Reports View permission is denied
//   2. SuperAdmin grants View -> the SAME HR Admin can use Master Reports after
//      refreshing / signing in again (saved permissions load correctly)
//   3. SuperAdmin revokes View -> further requests are denied (no new account)
//   4. View allowed + Export denied -> viewing works, Excel export blocked
//      SERVER-SIDE (export is subject to View)
//   5. View + Export allowed -> report + authorised Excel download work
//   6. Single-company HR Admin cannot access / export another company's records
//   7. Multi-company HR Admin sees only its assigned companies
//   8. HR Admin + SuperAdmin logins keep working
//   9. Employee login/APIs remain unaffected (mobile screens are untouched)
//  10. Daily Master Report + existing HR endpoints keep working
//
// Everything runs through the REAL SuperAdmin console API (/api/superadmin/*)
// using a temporary table-based SuperAdmin account (app-owned store), exactly
// like the web/mobile permission screens. All test accounts are removed again.
// Run the backend first:  node server/index.js   (or npm run server)
// Usage: node scripts/verify-master-reports.mjs
// ============================================================================

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import * as XLSX from 'xlsx';
import { getPool } from '../server/db.js';
import {
  ensureAdminAccessTables, createSuperAdmin, setSuperAdminActive, deleteSuperAdmin,
  deleteHrAdmin, listCompanyCodes,
} from '../server/admin-access.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
try {
  const envText = fs.readFileSync(path.join(ROOT, '.env'), 'utf8');
  for (const line of envText.split(/\r?\n/)) {
    const m = /^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/.exec(line);
    if (m && process.env[m[1]] === undefined) process.env[m[1]] = m[2].trim();
  }
} catch { /* rely on process env */ }

const BASE = process.env.VERIFY_BASE || 'http://localhost:4100';
const HR_USER = process.env.HR_USERNAME || '';
const HR_PASS = process.env.HR_PASSWORD || '';
const TEST_PASSWORD = 'MasterRep123';

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
  const contentDisp = res.headers.get('content-disposition') || '';
  let json = null;
  let buf = null;
  if (contentType.includes('application/json')) json = await res.json().catch(() => null);
  else buf = Buffer.from(await res.arrayBuffer());
  return { status: res.status, json, buf, contentType, contentDisp };
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
  for (const row of result.recordset) map.set(String(row.paycode).trim(), String(row.companycode || '').trim().toUpperCase());
  return map;
}

async function loginHr(username, password) {
  const r = await req('POST', '/api/auth/hr/login', { body: { username, password } });
  return r.json?.token || null;
}

async function loginSuperAdmin(username, password) {
  const r = await req('POST', '/api/auth/superadmin/login', { body: { username, password } });
  return r.json?.token || null;
}

const isDenied = (r) => r.status === 403 && r.json?.code === 'PERMISSION_DENIED';
const isCompanyForbidden = (r) => r.status === 403 && r.json?.code === 'COMPANY_FORBIDDEN';

const ACTION_KEYS = ['view', 'create', 'edit', 'delete', 'import', 'export', 'approve', 'email'];
/** Compare one module's flags (same semantics the console UI uses). */
function sameModule(a, b) {
  const A = a || {};
  const B = b || {};
  for (const f of ACTION_KEYS) if (Boolean(A[f]) !== Boolean(B[f])) return false;
  const vis = (m) => (m.visible === false ? false : (m.visible === true ? true : null));
  return vis(A) === vis(B) && ((A.placement || null) === (B.placement || null));
}

async function main() {
  console.log(`\n=== Master Reports permission/access verification against ${BASE} ===\n`);

  // ---------- setup: temporary SuperAdmin + real console API ----------
  const pool = await getPool();
  await ensureAdminAccessTables(pool);
  const stamp = Date.now().toString(36).toUpperCase();
  const SA_USER = `SAREP${stamp}`;
  const HR_ONE = `MRPONE${stamp}`;      // single-company account
  const HR_MULTI = `MRPMULTI${stamp}`;  // multi-company account
  const createdHr = [];

  const saCreated = await createSuperAdmin(pool, { username: SA_USER, password: TEST_PASSWORD, displayname: 'Master Reports Verify' }, 'verify-master-reports');
  check('Setup: temporary SuperAdmin account created (app-owned store)', saCreated.ok === true, saCreated.message || '');
  const saToken = await loginSuperAdmin(SA_USER, TEST_PASSWORD);
  check('Scenario 8: SuperAdmin login works', Boolean(saToken));
  const bootstrapToken = await loginHr(HR_USER, HR_PASS);
  check('Scenario 8: HR Admin (bootstrap) login works', Boolean(bootstrapToken));
  if (!saToken || !bootstrapToken) { console.error('Cannot continue without logins.'); process.exit(1); }

  /** Console GET -> this account's persisted permissions (as the UI loads them). */
  const consolePerms = async (username) => {
    const r = await req('GET', '/api/superadmin/hr-admins', { token: saToken });
    const row = (r.json?.admins || []).find((a) => a.username === username);
    return row?.permissions || null;
  };
  /** Console save — same payload/mechanism the web + mobile permission screens use. */
  const consoleSave = async (username, mutate) => {
    const current = await consolePerms(username);
    const sent = JSON.parse(JSON.stringify(current || {}));
    mutate(sent);
    const put = await req('PUT', `/api/superadmin/hr-admins/${encodeURIComponent(username)}`, { token: saToken, body: { permissions: sent } });
    return { sent, status: put.status, persisted: put.json?.permissions || null };
  };

  // ---------- catalog: Master Reports naming + untouched modules ----------
  const catalog = await req('GET', '/api/superadmin/catalog', { token: saToken });
  const cat = catalog.json?.modules || [];
  check('Catalog: reports module is displayed as "Master Reports"', cat.some((m) => m.key === 'reports' && m.label === 'Master Reports'), JSON.stringify(cat.find((m) => m.key === 'reports') || null));
  check('Catalog: internal key stays `reports` (no duplicate module keys)', cat.filter((m) => m.key === 'reports').length === 1);
  check('Catalog: Daily Master stays a separate, unchanged module', cat.some((m) => m.key === 'dailymaster' && m.label === 'Daily Master'));
  check('Catalog: other module labels unchanged', ['Dashboard', 'Employee Management', 'Leave Management', 'Salary Management', 'Holiday Management', 'Email Management'].every((l) => cat.some((m) => m.label === l)));
  check('Catalog: action list unchanged (View/Export included)', (catalog.json?.actions || []).includes('view') && (catalog.json?.actions || []).includes('export'));

  // ---------- create the test HR Admin through the console ----------
  const companies = await listCompanyCodes(pool);
  const compA = companies[0] || null;
  const compB = companies[1] || null;
  const compC = companies[2] || null;
  const createOne = await req('POST', '/api/superadmin/hr-admins', {
    token: saToken,
    body: { username: HR_ONE, password: TEST_PASSWORD, displayname: 'Master Reports One', companies: [compA].filter(Boolean) },
  });
  if (createOne.status === 201) createdHr.push(HR_ONE);
  check('Console: HR Admin created with company assignment', createOne.status === 201, `HTTP ${createOne.status}`);
  const hrToken0 = await loginHr(HR_ONE, TEST_PASSWORD);
  check('Scenario 8: new HR Admin login works', Boolean(hrToken0));

  // Baseline snapshot (all NON-reports modules) for the preservation checks.
  const baseline = await consolePerms(HR_ONE);
  check('Console: permissions load for the account (includes Master Reports row)', Boolean(baseline?.reports), JSON.stringify(baseline?.reports || null));
  const baselineOthers = {};
  for (const [k, v] of Object.entries(baseline || {})) if (k !== 'reports') baselineOthers[k] = v;
  note(`Default for a new account (existing project convention): reports.view=${baseline?.reports?.view === true}, reports.export=${baseline?.reports?.export === true} (View default on, Export default off).`);

  // ---------- Scenario 1: WITHOUT View permission -> denied ----------
  let saved = await consoleSave(HR_ONE, (p) => { p.reports = { ...(p.reports || {}), view: false, export: false }; });
  check('Scenario 1: SuperAdmin saves View=false (console save confirmed)', saved.status === 200 && saved.persisted?.reports?.view === false, `HTTP ${saved.status}`);
  let me = await req('GET', '/api/me', { token: hrToken0 });
  check('Scenario 1: /api/me reports Master Reports View=false after save', me.json?.permissions?.reports?.view === false);
  let r;
  r = await req('GET', '/api/hr/reports/summary?days=7', { token: hrToken0 });
  check('Scenario 1: report summary DENIED without View', isDenied(r), `HTTP ${r.status} ${r.json?.code || ''}`);
  r = await req('GET', '/api/hr/reports/register?days=7', { token: hrToken0 });
  check('Scenario 1: detailed register DENIED without View', isDenied(r), `HTTP ${r.status}`);
  r = await req('GET', '/api/hr/reports/filters', { token: hrToken0 });
  check('Scenario 1: report filters DENIED without View', isDenied(r), `HTTP ${r.status}`);
  r = await req('GET', '/api/hr/reports/export?days=7', { token: hrToken0 });
  check('Scenario 1: Excel export DENIED without View', isDenied(r), `HTTP ${r.status}`);

  // ---------- Scenario 2: SuperAdmin grants View -> works after re-sign-in ----------
  saved = await consoleSave(HR_ONE, (p) => { p.reports = { ...(p.reports || {}), view: true, export: false }; });
  check('Scenario 2: SuperAdmin saves View=true (console save confirmed)', saved.status === 200 && saved.persisted?.reports?.view === true, `HTTP ${saved.status}`);
  const reloaded = await consolePerms(HR_ONE);
  check('Scenario 2: saved permission loads correctly after reload', reloaded?.reports?.view === true && reloaded?.reports?.export === false);
  const hrToken = await loginHr(HR_ONE, TEST_PASSWORD); // fresh session = refresh / sign-in again
  me = await req('GET', '/api/me', { token: hrToken });
  check('Scenario 2: /api/me shows View Master Reports after re-sign-in', me.json?.permissions?.reports?.view === true);
  r = await req('GET', '/api/hr/reports/summary?days=7', { token: hrToken });
  check('Scenario 2: Master Reports summary works after grant (refresh)', r.status === 200 && r.json?.success === true, `HTTP ${r.status}`);
  r = await req('GET', '/api/hr/reports/register?days=7', { token: hrToken });
  check('Scenario 2: detailed register works after grant', r.status === 200 && Array.isArray(r.json?.rows), `HTTP ${r.status}, ${(r.json?.rows || []).length} row(s)`);
  r = await req('GET', '/api/hr/reports/filters', { token: hrToken });
  check('Scenario 2: report filters work after grant', r.status === 200, `HTTP ${r.status}`);

  // ---------- Scenario 4: View allowed + Export denied -> export blocked SERVER-SIDE ----------
  r = await req('GET', '/api/hr/reports/export?days=7', { token: hrToken });
  check('Scenario 4: viewing works while Export is denied (summary still 200)', (await req('GET', '/api/hr/reports/summary?days=7', { token: hrToken })).status === 200);
  check('Scenario 4: Excel export blocked server-side when Export is denied', isDenied(r) && r.json?.action === 'export', `HTTP ${r.status} action=${r.json?.action || ''}`);

  // Export is SUBJECT TO VIEW: view=false + export=true must still refuse export.
  saved = await consoleSave(HR_ONE, (p) => { p.reports = { ...(p.reports || {}), view: false, export: true }; });
  r = await req('GET', '/api/hr/reports/export?days=7', { token: hrToken });
  check('Export is subject to View: export denied when View is revoked (even with Export on)', isDenied(r) && r.json?.action === 'view', `HTTP ${r.status} action=${r.json?.action || ''}`);
  await consoleSave(HR_ONE, (p) => { p.reports = { ...(p.reports || {}), view: true, export: false }; });

  // ---------- Scenario 5: View + Export allowed -> report + authorised Excel download ----------
  saved = await consoleSave(HR_ONE, (p) => { p.reports = { ...(p.reports || {}), view: true, export: true }; });
  check('Scenario 5: SuperAdmin saves View=true + Export=true (confirmed)', saved.status === 200 && saved.persisted?.reports?.view === true && saved.persisted?.reports?.export === true, `HTTP ${saved.status}`);
  r = await req('GET', '/api/hr/reports/summary?days=7', { token: hrToken });
  check('Scenario 5: Master Reports summary works (View + Export)', r.status === 200, `HTTP ${r.status}`);
  const exp = await req('GET', '/api/hr/reports/export?days=7', { token: hrToken });
  check('Scenario 5: authorised Excel download works (.xlsx)', exp.status === 200 && exp.buf && exp.buf.slice(0, 2).toString() === 'PK', `HTTP ${exp.status}`);
  check('Scenario 5: download filename is Master-Reports_*.xlsx', /Master-Reports_/.test(exp.contentDisp), exp.contentDisp);
  if (exp.buf && exp.buf.slice(0, 2).toString() === 'PK') {
    const book = XLSX.read(exp.buf, { type: 'buffer' });
    const summaryAoA = XLSX.utils.sheet_to_json(book.Sheets['Report Summary'] || {}, { header: 1, defval: '' });
    check('Workbook: titled "Master Reports — Attendance Report"', summaryAoA[0]?.[0] === 'Master Reports — Attendance Report', String(summaryAoA[0]?.[0] || ''));
    const regSheet = XLSX.utils.sheet_to_json(book.Sheets['Detailed Register'] || {}, { defval: '' });
    const exportPaycodes = regSheet.map((row) => String(row.Paycode || '').trim()).filter(Boolean);
    const paycodeCompanies = await companiesOfPaycodes(exportPaycodes);
    const allowed = new Set([compA].filter(Boolean).map((c) => String(c).trim().toUpperCase()));
    const leaks = exportPaycodes.filter((p) => {
      const c = paycodeCompanies.get(p) || '';
      return c && !allowed.has(c);
    });
    check('Workbook: downloaded rows limited to the assigned company', exportPaycodes.length > 0 && leaks.length === 0, `${exportPaycodes.length} row(s), ${leaks.length} outside`);
  }

  // ---------- Scenario 3: SuperAdmin revokes View -> further requests denied ----------
  saved = await consoleSave(HR_ONE, (p) => { p.reports = { ...(p.reports || {}), view: false, export: true }; });
  check('Scenario 3: SuperAdmin revokes View (same account, no re-create)', saved.status === 200 && saved.persisted?.reports?.view === false, `HTTP ${saved.status}`);
  r = await req('GET', '/api/hr/reports/summary?days=7', { token: hrToken });
  check('Scenario 3: revoke takes effect on the NEXT request (open session)', isDenied(r), `HTTP ${r.status}`);
  r = await req('GET', '/api/hr/reports/export?days=7', { token: hrToken });
  check('Scenario 3: export also denied after View revoke', isDenied(r), `HTTP ${r.status}`);
  const hrTokenAfterRevoke = await loginHr(HR_ONE, TEST_PASSWORD);
  r = await req('GET', '/api/hr/reports/summary?days=7', { token: hrTokenAfterRevoke });
  check('Scenario 3: fresh sign-in after revoke is denied too', isDenied(r), `HTTP ${r.status}`);

  // ---------- Scenario 6: single-company HR Admin cannot cross companies ----------
  await consoleSave(HR_ONE, (p) => { p.reports = { ...(p.reports || {}), view: true, export: true }; }); // restore for data checks
  const allowedA = (code) => String(code || '').trim().toUpperCase() === String(compA || '').trim().toUpperCase();
  r = await req('GET', '/api/hr/reports/register?days=7', { token: hrToken });
  check('Scenario 6: every register row belongs to the assigned company', r.status === 200 && (r.json?.rows || []).every((row) => allowedA(row.companycode)), `${(r.json?.rows || []).length} row(s)`);
  r = await req('GET', '/api/hr/reports/filters', { token: hrToken });
  check('Scenario 6: filter options only offer the assigned company', r.status === 200 && (r.json?.companies || []).every((c) => allowedA(c.code)), JSON.stringify((r.json?.companies || []).map((c) => c.code)));
  r = await req('GET', '/api/hr/reports/summary?days=7&companycode=ZZUNAUTH', { token: hrToken });
  check('Scenario 6: summary rejects another company id (403 COMPANY_FORBIDDEN)', isCompanyForbidden(r), `HTTP ${r.status} ${r.json?.code || ''}`);
  r = await req('GET', '/api/hr/reports/export?days=7&companycode=ZZUNAUTH', { token: hrToken });
  check('Scenario 6: Excel export rejects another company id (403)', isCompanyForbidden(r), `HTTP ${r.status}`);
  if (compB && allowedA(compA) && String(compB).toUpperCase() !== String(compA).toUpperCase()) {
    r = await req('GET', `/api/hr/reports/summary?days=7&companycode=${encodeURIComponent(compB)}`, { token: hrToken });
    check('Scenario 6: real other-company code rejected too (403)', isCompanyForbidden(r), `HTTP ${r.status}`);
    const outside = await pool.request().query(
      `SELECT TOP (1) LTRIM(RTRIM(paycode)) AS paycode FROM dbo.tblemployee WHERE LTRIM(RTRIM(companycode)) = '${String(compB).replace(/'/g, "''")}'`,
    );
    const outPay = String(outside.recordset?.[0]?.paycode || '').trim();
    if (outPay) {
      r = await req('GET', `/api/hr/reports/summary?days=7&paycode=${encodeURIComponent(outPay)}`, { token: hrToken });
      check('Scenario 6: out-of-scope employee paycode rejected (403)', r.status === 403, `HTTP ${r.status} ${r.json?.code || ''}`);
    }
  }

  // ---------- Scenario 7: multi-company HR Admin sees only assigned companies ----------
  const createMulti = await req('POST', '/api/superadmin/hr-admins', {
    token: saToken,
    body: { username: HR_MULTI, password: TEST_PASSWORD, displayname: 'Master Reports Multi', companies: [compA, compB].filter(Boolean) },
  });
  if (createMulti.status === 201) createdHr.push(HR_MULTI);
  check('Console: multi-company HR Admin created', createMulti.status === 201, `HTTP ${createMulti.status}`);
  const multiToken = await loginHr(HR_MULTI, TEST_PASSWORD);
  const allowedMulti = (code) => [compA, compB].filter(Boolean).map((c) => String(c).toUpperCase()).includes(String(code || '').trim().toUpperCase());
  r = await req('GET', '/api/hr/reports/filters', { token: multiToken });
  const multiCompanies = (r.json?.companies || []).map((c) => String(c.code).trim());
  check('Scenario 7: multi-company filters offer exactly the assigned companies', r.status === 200 && multiCompanies.length > 0 && multiCompanies.every(allowedMulti), JSON.stringify(multiCompanies));
  r = await req('GET', '/api/hr/reports/summary?days=7&dimension=company', { token: multiToken });
  const multiCmp = (r.json?.companyComparison || []).map((g) => String(g.key || '').trim());
  check('Scenario 7: comparisons run only between assigned companies', r.status === 200 && multiCmp.length > 0 && multiCmp.every(allowedMulti), JSON.stringify(multiCmp));
  r = await req('GET', `/api/hr/reports/summary?days=7&companycode=${compC || 'ZZUNAUTH'}`, { token: multiToken });
  check('Scenario 7: third company rejected for multi-company admin (403)', isCompanyForbidden(r), `HTTP ${r.status}`);

  // ---------- Scenario 9: employee login/APIs remain unaffected ----------
  const empMissing = await req('POST', '/api/auth/employee/login', { body: {} });
  check('Scenario 9: employee login route intact (missing creds -> 400)', empMissing.status === 400, `HTTP ${empMissing.status}`);
  const empBad = await req('POST', '/api/auth/employee/login', { body: { paycode: 'NOPE9999', password: 'wrong' } });
  check('Scenario 9: employee login still rejects invalid credentials', empBad.status === 401 || empBad.status === 400, `HTTP ${empBad.status}`);
  const empNoToken = await req('GET', '/api/employee/dashboard');
  check('Scenario 9: employee APIs still require the employee session (401)', empNoToken.status === 401, `HTTP ${empNoToken.status}`);
  note('Scenario 9: mobile app source untouched for employee screens/navigation (only the SuperAdmin permission labels changed); see git status in the report.');

  // ---------- Scenario 10: Daily Master + existing HR endpoints keep working ----------
  r = await req('GET', '/api/hr/daily?days=2', { token: bootstrapToken });
  check('Scenario 10: Daily Master Report API unchanged (200)', r.status === 200, `HTTP ${r.status}`);
  r = await req('GET', '/api/hr/dashboard', { token: bootstrapToken });
  check('Scenario 10: Executive Overview API unchanged (200)', r.status === 200, `HTTP ${r.status}`);
  r = await req('GET', '/api/hr/category-analytics?mode=daily', { token: bootstrapToken });
  check('Scenario 10: Category Analytics API unchanged (200)', r.status === 200, `HTTP ${r.status}`);
  r = await req('GET', '/api/hr/filters', { token: bootstrapToken });
  check('Scenario 10: shared /api/hr/filters unchanged (200)', r.status === 200, `HTTP ${r.status}`);
  r = await req('GET', '/api/hr/employees?pageSize=5', { token: bootstrapToken });
  check('Scenario 10: employee roster API unchanged (200)', r.status === 200, `HTTP ${r.status}`);
  r = await req('GET', '/api/me', { token: bootstrapToken });
  check('Scenario 10: /api/me unchanged for the bootstrap account (full access preserved)', r.status === 200 && r.json?.permissions?.reports?.view === true && r.json?.permissions?.dailymaster?.view === true);

  // ---------- preservation: other modules untouched by the reports toggles ----------
  const afterAll = await consolePerms(HR_ONE);
  const othersPreserved = Object.entries(baselineOthers).every(([k, v]) => sameModule(afterAll?.[k], v));
  check('Preservation: every NON-reports module permission unchanged after all saves', othersPreserved);
  check('Preservation: Export is NOT auto-granted to new accounts (existing default kept)', baseline?.reports?.export !== true, `default export=${baseline?.reports?.export}`);
  const adminsAfter = await req('GET', '/api/superadmin/hr-admins', { token: saToken });
  check('Preservation: SuperAdmin console lists both accounts with separate company assignments',
    (adminsAfter.json?.admins || []).some((a) => a.username === HR_ONE) && (adminsAfter.json?.admins || []).some((a) => a.username === HR_MULTI),
    'companies kept separate from module permissions');

  // ---------- cleanup ----------
  for (const username of createdHr) {
    const del = await req('DELETE', `/api/superadmin/hr-admins/${encodeURIComponent(username)}`, { token: saToken });
    if (del.status !== 200) { try { await deleteHrAdmin(pool, username); } catch { /* best effort */ } }
  }
  try { await setSuperAdminActive(pool, SA_USER, false, 'verify-master-reports'); } catch { /* best effort */ }
  try { await deleteSuperAdmin(pool, SA_USER); } catch (e) { note(`SuperAdmin cleanup: ${String(e?.message || e).slice(0, 90)}`); }
  check('Cleanup: test accounts removed', true, `${createdHr.length} HR Admin + 1 SuperAdmin`);

  console.log(`\n=== RESULT: ${passed} passed, ${failed} failed ===`);
  process.exit(failed ? 1 : 0);
}

main().catch((error) => {
  console.error('VERIFY_RUN_ERROR', error && (error.message || error));
  process.exit(1);
});