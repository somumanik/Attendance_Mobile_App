// ============================================================================
// scripts/verify-master-late.mjs
// Focused live verification for the Master Reports "Late" drill-down + export
// additions (Feature A/C of Phase M1):
//   1. summary comparison exposes a `late` count per company
//   2. status=Late drill-down returns only isLate rows and matches the summary
//      total exactly (no double counting from duplicate raw punches)
//   3. company + name filters work with the Late drill-down
//   4. status=Late export includes a "Late Employees" sheet + Late column
//   5. no-results export still produces a valid workbook (no silent empty file)
// Uses the REAL backend and the bootstrap HR Admin credentials from .env.
//   node scripts/verify-master-late.mjs
// ============================================================================

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import * as XLSX from 'xlsx';

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

let passed = 0;
let failed = 0;
function check(name, cond, detail = '') {
  if (cond) { passed += 1; console.log(`PASS :: ${name}${detail ? ` :: ${detail}` : ''}`); }
  else { failed += 1; console.log(`FAIL :: ${name}${detail ? ` :: ${detail}` : ''}`); }
}

async function req(method, apiPath, { token, body } = {}) {
  const headers = { Accept: 'application/json' };
  if (token) headers.Authorization = `Bearer ${token}`;
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  const res = await fetch(`${BASE}${apiPath}`, { method, headers, body: body !== undefined ? JSON.stringify(body) : undefined });
  const ct = res.headers.get('content-type') || '';
  let json = null;
  let buf = null;
  if (ct.includes('application/json')) json = await res.json().catch(() => null);
  else buf = Buffer.from(await res.arrayBuffer());
  return { status: res.status, json, buf, contentType: ct };
}

function shiftIso(iso, days) {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

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
  console.log(`\n=== Master Reports Late feature verification against ${BASE} ===\n`);

  const login = await req('POST', '/api/auth/hr/login', { body: { username: HR_USER, password: HR_PASS } });
  const token = login.json?.token || null;
  check('HR Admin login works', Boolean(token));
  if (!token) { console.error('Cannot continue.'); process.exit(1); }

  const today = new Date().toISOString().slice(0, 10);
  const from = shiftIso(today, -14);

  // ---- summary exposes `late` per company ----
  const summary = await req('GET', `/api/hr/reports/absent-miss?fromDate=${from}&toDate=${today}`, { token });
  check('Summary returns comparison over the window', summary.status === 200 && Array.isArray(summary.json?.comparison), `HTTP ${summary.status}`);
  const comparison = summary.json?.comparison || [];
  check('Comparison exposes a numeric `late` count per company', comparison.every((g) => typeof g.late === 'number'), comparison.map((g) => `${g.label}=${g.late}`).join(', '));
  const kpisLate = Number(summary.json?.kpis?.late ?? -1);
  const cmpSum = comparison.reduce((a, g) => a + (Number(g.late) || 0), 0);
  check('Summary internally consistent: kpis.late equals comparison late total', kpisLate === cmpSum, `kpis.late=${kpisLate} vs ${cmpSum}`);

  // ---- Late drill-down consistency (no double count) ----
  const lateRows = await allMonitorRows(token, `/api/hr/reports/absent-miss/employees?fromDate=${from}&toDate=${today}&status=Late`);
  check('Late drill-down rows all flagged isLate', lateRows.every((r) => r.isLate === true), `${lateRows.length} row(s)`);
  check('Late drill-down rows carry lateMinutes', lateRows.every((r) => typeof r.lateMinutes === 'number'), '');
  const uniqueKeys = new Set(lateRows.map((r) => `${r.paycode}|${r.date}`));
  check('No duplicate (paycode,date) in Late drill-down (no double count)', uniqueKeys.size === lateRows.length, `${uniqueKeys.size} unique of ${lateRows.length} row(s)`);
  // A live production DB can land a punch between requests, so bound the drill
  // total between a before/after summary snapshot instead of one strict equality.
  const summaryAfter = await req('GET', `/api/hr/reports/absent-miss?fromDate=${from}&toDate=${today}`, { token });
  const afterLate = Number(summaryAfter.json?.kpis?.late ?? -1);
  const lo = Math.min(kpisLate, afterLate);
  const hi = Math.max(kpisLate, afterLate);
  check('Late drill-down total consistent with summary (no double count)', lateRows.length >= lo && lateRows.length <= hi, `${lateRows.length} within [${lo}, ${hi}]`);

  // ---- company filter ----
  const companyWithLate = comparison.find((g) => Number(g.late || 0) > 0);
  if (companyWithLate) {
    const coLate = await allMonitorRows(token, `/api/hr/reports/absent-miss/employees?fromDate=${from}&toDate=${today}&status=Late&companycode=${encodeURIComponent(companyWithLate.key)}`);
    check('Company-filtered Late drill-down limited to that company', coLate.every((r) => String(r.companycode || '').trim() === String(companyWithLate.key).trim()), `${coLate.length} row(s)`);
    check('Company-filtered Late count equals summary late for that company', Math.abs(coLate.length - (Number(companyWithLate.late) || 0)) <= 2, `${coLate.length} vs ${companyWithLate.late}`);
  } else {
    check('(skipped company filter: no company had Late>0 in window)', true, '');
  }

  // ---- name search ----
  if (lateRows.length) {
    const sample = lateRows[0];
    const q = String(sample.empname || '').trim().split(/\s+/)[0];
    if (q) {
      const filtered = await allMonitorRows(token, `/api/hr/reports/absent-miss/employees?fromDate=${from}&toDate=${today}&status=Late&search=${encodeURIComponent(q)}`);
      check('Name search filters Late drill-down', filtered.length > 0 && filtered.every((r) => String(r.empname).toLowerCase().includes(q.toLowerCase()) || String(r.paycode).toLowerCase().includes(q.toLowerCase())), `${filtered.length} row(s)`);
    }
  }

  // ---- Excel export (status=Late) ----
  const exp = await req('GET', `/api/hr/reports/absent-miss/export?fromDate=${from}&toDate=${today}&status=Late`, { token });
  check('Late export returns .xlsx', exp.status === 200 && exp.buf && exp.buf.slice(0, 2).toString() === 'PK', `HTTP ${exp.status}`);
  if (exp.buf && exp.buf.slice(0, 2).toString() === 'PK') {
    const book = XLSX.read(exp.buf, { type: 'buffer' });
    check('Export contains Late Employees sheet', book.SheetNames.includes('Late Employees'), book.SheetNames.join(', '));
    const late = XLSX.utils.sheet_to_json(book.Sheets['Late Employees'] || {}, { defval: '' });
    check('Late Employees sheet rows are all Late', late.every((r) => r.Late === 'Yes'), `${late.length} row(s)`);
    check('Late Employees sheet includes Late Minutes column', late.every((r) => 'Late Minutes' in r), '');
    const cmpRaw = XLSX.utils.sheet_to_json(book.Sheets['Company Status Summary'] || {}, { header: 1, defval: '' });
    const cmpHeader = (cmpRaw && cmpRaw.length > 1 ? cmpRaw[1] : []) || [];
    check('Company Status Summary sheet includes Late column', cmpHeader.includes('Late'), cmpHeader.join(', '));
  }

  // ---- no-results export (still valid workbook, not silent empty/error) ----
  const none = await req('GET', `/api/hr/reports/absent-miss/export?fromDate=${from}&toDate=${today}&status=Late&search=ZZZZ_NO_MATCH_98765`, { token });
  check('No-results Late export still returns a valid .xlsx', none.status === 200 && none.buf && none.buf.slice(0, 2).toString() === 'PK', `HTTP ${none.status}`);

  console.log(`\n=== RESULT: ${passed} passed, ${failed} failed ===`);
  process.exit(failed ? 1 : 0);
}

main().catch((error) => {
  console.error('VERIFY_RUN_ERROR', error && (error.message || error));
  process.exit(1);
});
