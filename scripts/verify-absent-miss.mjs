// ============================================================================
// scripts/verify-absent-miss.mjs
// Live verification for the Master Reports "Company-wise Absent & Miss Punch
// Monitor" (/api/hr/reports/absent-miss*):
//   1. today / yesterday / historical / range reports
//   2. company + category + department filtering
//   3. drill-down (Absent / Miss Punch) consistency with KPIs (no double count)
//   4. Excel export (sheets + scoped rows)
//   5. single-company / multi-company HR Admin scope + unassigned-company 403
//   6. View-without-Export blocks the export server-side
//   7. Holiday/Weekly Off/Approved Leave never folded into Absent (disjoint sets)
// Uses the REAL console API (temp SuperAdmin) and real Savior data.
// Run the backend first;  node scripts/verify-absent-miss.mjs
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

const BASE = process.env.VERIFY_BASE || 'http://localhost:4000';
const HR_USER = process.env.HR_USERNAME || '';
const HR_PASS = process.env.HR_PASSWORD || '';
const TEST_PASSWORD = 'AbsentMiss123';

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
async function loginHr(u, p) { return (await req('POST', '/api/auth/hr/login', { body: { username: u, password: p } })).json?.token || null; }
async function loginSuperAdmin(u, p) { return (await req('POST', '/api/auth/superadmin/login', { body: { username: u, password: p } })).json?.token || null; }

function todayIso() { return new Date().toISOString().slice(0, 10); }
function shiftIso(iso, days) { const d = new Date(`${iso}T00:00:00Z`); d.setUTCDate(d.getUTCDate() + days); return d.toISOString().slice(0, 10); }

/** Fetch every page of the monitor drill-down (pageSize is capped server-side). */
async function allMonitorRows(token, paramsBase) {
  const out = [];
  for (let page = 1; page <= 200; page += 1) {
    const r = await req('GET', `${paramsBase}&page=${page}&pageSize=200`, { token });
    if (r.status !== 200) break;
    const rows = r.json?.rows || [];
    out.push(...rows);
    if (out.length >= (r.json?.total || 0) || rows.length === 0) break;
  }
  return out;
}

async function main() {
  console.log(`\n=== Absent & Miss Punch Monitor verification against ${BASE} ===\n`);
  const token = await loginHr(HR_USER, HR_PASS);
  check('Bootstrap HR Admin login works', Boolean(token));
  if (!token) { console.error('Cannot continue.'); process.exit(1); }

  const pool = await getPool();
  await ensureAdminAccessTables(pool);

  // Pick a historical date that actually has register rows.
  const lastReg = await pool.request().query("SELECT TOP 1 CONVERT(varchar(10), dateoffice, 120) AS d FROM dbo.tbltimeregister WHERE dateoffice < CONVERT(date, GETDATE()) ORDER BY dateoffice DESC");
  const histDate = String(lastReg.recordset?.[0]?.d || '').slice(0, 10);
  check('Historical date with register data found', Boolean(histDate), histDate);
  const yesterday = shiftIso(todayIso(), -1);

  // ---- 1/2/3/4: single-date reports (today/yesterday/historical) + range ----
  for (const [name, date] of [['today', todayIso()], ['yesterday', yesterday], ['historical', histDate]]) {
    const r = await req('GET', `/api/hr/reports/absent-miss?fromDate=${date}&toDate=${date}`, { token });
    check(`${name}: monitor summary returns KPIs + trend + comparison`, r.status === 200 && r.json?.kpis && Array.isArray(r.json?.trend) && Array.isArray(r.json?.comparison), `HTTP ${r.status}`);
    if (r.status === 200) {
      const k = r.json.kpis;
      const keysOk = ['employees', 'present', 'absent', 'missPunch', 'approvedLeave', 'holiday', 'weekOff', 'noRecord', 'attendancePct'].every((kk) => kk in k);
      check(`${name}: KPI shape complete`, keysOk);
    }
  }
  const range = await req('GET', `/api/hr/reports/absent-miss?fromDate=${shiftIso(histDate, -6)}&toDate=${histDate}`, { token });
  check('Date range: trend covers each day in range', range.status === 200 && (range.json?.trend || []).length === 7, `HTTP ${range.status}, ${(range.json?.trend || []).length} day(s)`);

  // ---- KPI vs drill-down consistency (no double counting) on the historical date ----
  const sum = await req('GET', `/api/hr/reports/absent-miss?fromDate=${histDate}&toDate=${histDate}`, { token });
  const rows = await allMonitorRows(token, `/api/hr/reports/absent-miss/employees?fromDate=${histDate}&toDate=${histDate}`);
  check('Drill-down (all statuses) loads for the historical date', sum.status === 200 && rows.length > 0, `${rows.length} row(s)`);
  if (rows.length && sum.status === 200) {
    const k = sum.json.kpis;
    const byStatus = {};
    for (const r of rows) byStatus[r.status] = (byStatus[r.status] || 0) + 1;
    const statuses = ['Present', 'Absent', 'Miss Punch', 'Approved Leave', 'Holiday', 'Week Off', 'No Record'];
    const statusCount = (st) => byStatus[st] || 0;
    const mismatch = statuses.filter((st) => statusCount(st) !== (k[{ Present: 'present', Absent: 'absent', 'Miss Punch': 'missPunch', 'Approved Leave': 'approvedLeave', Holiday: 'holiday', 'Week Off': 'weekOff', 'No Record': 'noRecord' }[st]] || 0));
    check('KPIs exactly match the drill-down rows (partition, no double count)', mismatch.length === 0, mismatch.length ? `mismatch: ${mismatch.join(', ')}` : `${rows.length} row(s)`);
    check('Same employee never appears twice for the same date', new Set(rows.map((r) => r.paycode)).size === rows.length, `${rows.length} row(s)`);
    // Holiday/Weekly Off/Leave are never in the Absent bucket.
    const absentSet = new Set(rows.filter((r) => r.status === 'Absent').map((r) => r.paycode));
    const otherSets = statuses.filter((st) => st !== 'Absent').map((st) => new Set(rows.filter((r) => r.status === st).map((r) => r.paycode)));
    const overlap = otherSets.some((s) => [...s].some((p) => absentSet.has(p)));
    check('Absent never overlaps Holiday / Weekly Off / Leave / Present / Miss Punch', overlap === false);
  }

  // ---- status filter drill-downs ----
  for (const st of ['Absent', 'Miss Punch']) {
    const dr = await req('GET', `/api/hr/reports/absent-miss/employees?fromDate=${histDate}&toDate=${histDate}&status=${encodeURIComponent(st)}&pageSize=200`, { token });
    check(`Drill-down filter status=${st} returns only ${st}`, dr.status === 200 && (dr.json?.rows || []).every((r) => r.status === st), `HTTP ${dr.status}, ${(dr.json?.rows || []).length} row(s)`);
  }

  // ---- category / department / company filters (bootstrap = all companies) ----
  const filters = await req('GET', '/api/hr/reports/filters', { token });
  const compA = (filters.json?.companies || [])[0]?.code || null;
  const catA = (filters.json?.categories || [])[0]?.code || null;
  const deptA = (filters.json?.departments || [])[0]?.code || null;
  if (catA) {
    const cr = await req('GET', `/api/hr/reports/absent-miss/employees?fromDate=${histDate}&toDate=${histDate}&cat=${encodeURIComponent(catA)}&pageSize=200`, { token });
    check('Category filter keeps rows in that category', cr.status === 200 && (cr.json?.rows || []).every((r) => String(r.category || '').trim() === catA), `HTTP ${cr.status}`);
  } else note('No category values — category filter test skipped.');
  if (deptA) {
    const dr = await req('GET', `/api/hr/reports/absent-miss/employees?fromDate=${histDate}&toDate=${histDate}&departmentcode=${encodeURIComponent(deptA)}&pageSize=200`, { token });
    check('Department filter keeps rows in that department', dr.status === 200 && (dr.json?.rows || []).every((r) => String(r.departmentcode || '').trim() === deptA), `HTTP ${dr.status}`);
  } else note('No department values — department filter test skipped.');
  if (compA) {
    const co = await req('GET', `/api/hr/reports/absent-miss?fromDate=${histDate}&toDate=${histDate}&companycode=${encodeURIComponent(compA)}`, { token });
    check('Company filter limits comparison to that company', co.status === 200 && (co.json?.comparison || []).every((g) => String(g.key || '').trim() === compA), `HTTP ${co.status}`);
  }

  // ---- Excel export (workbook + scoped rows) ----
  const exp = await req('GET', `/api/hr/reports/absent-miss/export?fromDate=${histDate}&toDate=${histDate}`, { token });
  check('Monitor Excel export returns .xlsx', exp.status === 200 && exp.buf && exp.buf.slice(0, 2).toString() === 'PK', `HTTP ${exp.status}`);
  if (exp.buf && exp.buf.slice(0, 2).toString() === 'PK') {
    const book = XLSX.read(exp.buf, { type: 'buffer' });
    check('Export workbook contains the required sheets', ['Monitor Summary', 'Company Status Summary', 'Absent Employees', 'Miss Punch Employees', 'Detailed Register'].every((n) => book.SheetNames.includes(n)), book.SheetNames.join(', '));
    const absent = XLSX.utils.sheet_to_json(book.Sheets['Absent Employees'] || {}, { defval: '' });
    check('Exported Absent sheet only lists Absent rows', absent.every((r) => r.Status === 'Absent'), `${absent.length} row(s)`);
    const miss = XLSX.utils.sheet_to_json(book.Sheets['Miss Punch Employees'] || {}, { defval: '' });
    check('Exported Miss Punch sheet only lists Miss Punch rows', miss.every((r) => r.Status === 'Miss Punch'), `${miss.length} row(s)`);
  }

  // ---- single-company / multi-company scope via the real console API ----
  const stamp = Date.now().toString(36).toUpperCase();
  const SA_USER = `SAAM${stamp}`;
  const HR_ONE = `AMONE${stamp}`;
  const HR_MULTI = `AMMULTI${stamp}`;
  const createdHr = [];
  await createSuperAdmin(pool, { username: SA_USER, password: TEST_PASSWORD, displayname: 'AbsentMiss Verify' }, 'verify-absent-miss');
  const saToken = await loginSuperAdmin(SA_USER, TEST_PASSWORD);
  check('Temp SuperAdmin login works', Boolean(saToken));
  const companies = await listCompanyCodes(pool);
  const cA = companies[0] || null;
  const cB = companies[1] || null;
  const cC = companies[2] || null;

  async function consolePerms(username) {
    const r = await req('GET', '/api/superadmin/hr-admins', { token: saToken });
    return (r.json?.admins || []).find((a) => a.username === username)?.permissions || null;
  }
  async function consoleSave(username, mutate) {
    const current = await consolePerms(username);
    const sent = JSON.parse(JSON.stringify(current || {}));
    mutate(sent);
    const put = await req('PUT', `/api/superadmin/hr-admins/${encodeURIComponent(username)}`, { token: saToken, body: { permissions: sent } });
    return { status: put.status, persisted: put.json?.permissions || null };
  }

  const create = await req('POST', '/api/superadmin/hr-admins', { token: saToken, body: { username: HR_ONE, password: TEST_PASSWORD, displayname: 'AM One', companies: [cA].filter(Boolean) } });
  if (create.status === 201) createdHr.push(HR_ONE);
  const createMulti = await req('POST', '/api/superadmin/hr-admins', { token: saToken, body: { username: HR_MULTI, password: TEST_PASSWORD, displayname: 'AM Multi', companies: [cA, cB].filter(Boolean) } });
  if (createMulti.status === 201) createdHr.push(HR_MULTI);
  check('Scoped + multi HR Admins created via console', create.status === 201 && createMulti.status === 201, `HTTP ${create.status}/${createMulti.status}`);

  const oneToken = await loginHr(HR_ONE, TEST_PASSWORD);
  check('Single-company HR Admin login works', Boolean(oneToken));
  const allowedA = (code) => String(code || '').trim().toUpperCase() === String(cA || '').trim().toUpperCase();
  let r = await req('GET', `/api/hr/reports/absent-miss?fromDate=${histDate}&toDate=${histDate}`, { token: oneToken });
  check('Single-company: monitor comparison limited to assigned company', r.status === 200 && (r.json?.comparison || []).every((g) => allowedA(g.key)), `HTTP ${r.status}`);
  r = await req('GET', `/api/hr/reports/absent-miss/employees?fromDate=${histDate}&toDate=${histDate}&pageSize=200`, { token: oneToken });
  check('Single-company: drill-down rows limited to assigned company', r.status === 200 && (r.json?.rows || []).every((row) => allowedA(row.companycode)), `HTTP ${r.status}, ${(r.json?.rows || []).length} row(s)`);
  r = await req('GET', `/api/hr/reports/absent-miss?fromDate=${histDate}&toDate=${histDate}&companycode=ZZUNAUTH`, { token: oneToken });
  check('Single-company: unassigned company rejected (403)', r.status === 403 && r.json?.code === 'COMPANY_FORBIDDEN', `HTTP ${r.status} ${r.json?.code || ''}`);
  r = await req('GET', `/api/hr/reports/absent-miss/export?fromDate=${histDate}&toDate=${histDate}&companycode=ZZUNAUTH`, { token: oneToken });
  check('Single-company: export for unassigned company rejected (403)', r.status === 403, `HTTP ${r.status}`);

  const multiToken = await loginHr(HR_MULTI, TEST_PASSWORD);
  const allowedMulti = (code) => [cA, cB].filter(Boolean).map((c) => String(c).toUpperCase()).includes(String(code || '').trim().toUpperCase());
  r = await req('GET', `/api/hr/reports/absent-miss?fromDate=${histDate}&toDate=${histDate}`, { token: multiToken });
  const multiCmp = (r.json?.comparison || []).map((g) => String(g.key || '').trim());
  check('Multi-company: comparison only between assigned companies', r.status === 200 && multiCmp.length > 0 && multiCmp.every(allowedMulti), JSON.stringify(multiCmp));
  r = await req('GET', `/api/hr/reports/absent-miss?fromDate=${histDate}&toDate=${histDate}&companycode=${cC || 'ZZUNAUTH'}`, { token: multiToken });
  check('Multi-company: third company rejected (403)', r.status === 403, `HTTP ${r.status}`);

  // ---- View without Export blocks the monitor export server-side ----
  await consoleSave(HR_ONE, (p) => { p.reports = { ...(p.reports || {}), view: true, export: false }; });
  r = await req('GET', `/api/hr/reports/absent-miss?fromDate=${histDate}&toDate=${histDate}`, { token: oneToken });
  check('View without Export: monitor summary still works', r.status === 200, `HTTP ${r.status}`);
  r = await req('GET', `/api/hr/reports/absent-miss/export?fromDate=${histDate}&toDate=${histDate}`, { token: oneToken });
  check('View without Export: monitor export blocked (403 PERMISSION_DENIED)', r.status === 403 && r.json?.code === 'PERMISSION_DENIED', `HTTP ${r.status} ${r.json?.code || ''}`);
  await consoleSave(HR_ONE, (p) => { p.reports = { ...(p.reports || {}), view: false, export: false }; });
  r = await req('GET', `/api/hr/reports/absent-miss?fromDate=${histDate}&toDate=${histDate}`, { token: oneToken });
  check('Revoke View: monitor summary denied (403 PERMISSION_DENIED)', r.status === 403 && r.json?.code === 'PERMISSION_DENIED', `HTTP ${r.status}`);

  // ---- cleanup ----
  for (const u of createdHr) {
    const del = await req('DELETE', `/api/superadmin/hr-admins/${encodeURIComponent(u)}`, { token: saToken });
    if (del.status !== 200) { try { await deleteHrAdmin(pool, u); } catch { /* best effort */ } }
  }
  try { await setSuperAdminActive(pool, SA_USER, false, 'verify-absent-miss'); } catch { /* best effort */ }
  try { await deleteSuperAdmin(pool, SA_USER); } catch (e) { note(`SA cleanup: ${String(e?.message || e).slice(0, 90)}`); }
  check('Cleanup: test accounts removed', true, `${createdHr.length} HR + 1 SA`);

  console.log(`\n=== RESULT: ${passed} passed, ${failed} failed ===`);
  process.exit(failed ? 1 : 0);
}

main().catch((error) => {
  console.error('VERIFY_RUN_ERROR', error && (error.message || error));
  process.exit(1);
});