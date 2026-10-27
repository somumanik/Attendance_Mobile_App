// ============================================================================
// scripts/verify-hr-reports-web.mjs
// Website-level runtime smoke for the HR Admin "Master Reports" (/hr/reports)
// tab on the ACTUAL running Next.js app:
//   - /hr/reports redirects anonymous visitors to /login
//   - an authenticated HR session renders the Reports & Analytics tab + dashboard
//   - the Next /api proxy forwards the new report endpoints with the Bearer token
//   - an unauthorised company id is rejected THROUGH the website proxy (403)
//   - the Excel export download works through the website proxy (.xlsx bytes)
//
// The auth cookie is httpOnly+Secure, so it is forwarded manually (the same
// header the middleware builds) instead of via a cookie jar. Run first:
//   node server/index.js                (backend)
//   web-next: npx next start -p 3100    (API_PROXY_TARGET -> backend)
// Usage: node scripts/verify-hr-reports-web.mjs
// ============================================================================

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { getPool } from '../server/db.js';
import {
  ensureAdminAccessTables, createHrAdmin, deleteHrAdmin,
  getEffectivePermissions, savePermissions, listCompanyCodes,
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

const WEB = process.env.VERIFY_WEB || 'http://localhost:3100';

let passed = 0;
let failed = 0;
function check(name, cond, detail = '') {
  if (cond) { passed += 1; console.log(`PASS :: ${name}${detail ? ` :: ${detail}` : ''}`); }
  else { failed += 1; console.log(`FAIL :: ${name}${detail ? ` :: ${detail}` : ''}`); }
}

async function main() {
  console.log(`\n=== HR Admin Reports website verification against ${WEB} ===\n`);

  // 1) Anonymous visitor must NOT see the reports page.
  const anon = await fetch(`${WEB}/hr/reports`, { redirect: 'manual' });
  const anonLocation = String(anon.headers.get('location') || '');
  check('Anonymous /hr/reports redirects to the login page', [302, 303, 307, 308].includes(anon.status) && anonLocation.includes('/login'), `HTTP ${anon.status} -> ${anonLocation}`);

  // 2) HR login through the website (sets the httpOnly auth_token cookie).
  const loginRes = await fetch(`${WEB}/api/auth/hr`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: process.env.HR_USERNAME, password: process.env.HR_PASSWORD }),
  });
  const setCookie = loginRes.headers.get('set-cookie') || '';
  const tokenMatch = /auth_token=([^;]+)/.exec(setCookie);
  check('Website HR login returns an auth cookie', loginRes.status === 200 && Boolean(tokenMatch), `HTTP ${loginRes.status}`);
  if (!tokenMatch) { console.log(`\n=== RESULT: ${passed} passed, ${failed} failed ===`); process.exit(1); }
  const cookieHeader = `auth_token=${tokenMatch[1]}`;

  // 3) The Reports & Analytics page renders for the authenticated HR session.
  //    The permission gate renders its loading shell server-side and the
  //    dashboard hydrates client-side (same as every other HR tab), so the UI
  //    wiring is verified against the BUILT client chunk below.
  const page = await fetch(`${WEB}/hr/reports`, { headers: { Cookie: cookieHeader }, redirect: 'manual' });
  const html = await page.text();
  check('Authenticated /hr/reports renders (HTTP 200)', page.status === 200, `HTTP ${page.status}`);
  check('Server render includes the HR portal shell', html.includes('emp-shell'), 'emp-shell present');

  // 3b) Built client chunk for the reports dashboard (bundle-level UI check).
  const distDir = process.env.NEXT_DIST_DIR || '.next-verify';
  const chunkDir = path.join(ROOT, 'web-next', distDir, 'static', 'chunks');
  const collectJs = (dir) => {
    const out = [];
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const p = path.join(dir, entry.name);
      if (entry.isDirectory()) out.push(...collectJs(p));
      else if (entry.name.endsWith('.js')) out.push(fs.readFileSync(p, 'utf8'));
    }
    return out;
  };
  const chunkText = collectJs(chunkDir).join('\n');
  check('Bundle: Master Reports tab entry + dashboard markup', ['Master Reports', 'Detailed Attendance Register', 'Export Excel'].every((s) => chunkText.includes(s)));
  check('Bundle: report types, filters, KPI and chart wiring', ['Company-wise', 'Category-wise', 'Department-wise', 'Shift-wise', 'Single Employee', 'Daily Attendance Trend', 'Company Comparison', 'Attendance %'].every((s) => chunkText.includes(s)));
  check('Bundle: report API endpoints wired', ['/hr/reports/summary', '/hr/reports/register', '/hr/reports/export', '/hr/reports/filters', '/hr/reports/employees'].every((s) => chunkText.includes(s)));
  check('Bundle: SuperAdmin permission UI offers View / Export Master Reports', ['View Master Reports', 'Export Master Reports', 'HR Admin Accounts & Permissions'].every((s) => chunkText.includes(s)));
  check('Bundle: access-denied guard names the module', ['Access not permitted'].every((s) => chunkText.includes(s)));

  // 4) The report APIs work THROUGH the website proxy (middleware Bearer injection).
  const filters = await fetch(`${WEB}/api/hr/reports/filters`, { headers: { Cookie: cookieHeader } });
  const filtersJson = await filters.json().catch(() => null);
  check('Website proxy: /api/hr/reports/filters works', filters.status === 200 && Array.isArray(filtersJson?.companies), `HTTP ${filters.status}`);
  const summary = await fetch(`${WEB}/api/hr/reports/summary?days=7&dimension=company`, { headers: { Cookie: cookieHeader } });
  check('Website proxy: /api/hr/reports/summary works', summary.status === 200, `HTTP ${summary.status}`);
  const register = await fetch(`${WEB}/api/hr/reports/register?days=7`, { headers: { Cookie: cookieHeader } });
  const registerJson = await register.json().catch(() => null);
  check('Website proxy: /api/hr/reports/register works (detailed records)', register.status === 200 && Array.isArray(registerJson?.rows), `HTTP ${register.status}, ${registerJson?.rows?.length ?? 0} row(s)`);

  // 5) Company security through the website proxy.
  //    The bootstrap HR account is deliberately UNRESTRICTED (recovery path), so an
  //    unknown company id matches zero rows instead of 403 — assert no data leaks.
  const bootFiltered = await fetch(`${WEB}/api/hr/reports/register?days=7&companycode=ZZUNAUTH`, { headers: { Cookie: cookieHeader } });
  const bootFilteredJson = await bootFiltered.json().catch(() => null);
  check('Website proxy: unknown company id returns ZERO rows for the unrestricted account',
    bootFiltered.status === 200 && (bootFilteredJson?.rows || []).length === 0, `HTTP ${bootFiltered.status}, ${(bootFilteredJson?.rows || []).length} row(s)`);

  //    A COMPANY-SCOPED HR Admin must get 403 through the same website proxy.
  const pool = await getPool();
  await ensureAdminAccessTables(pool);
  const companies = await listCompanyCodes(pool);
  const scopedUser = `RPTWEB${Date.now().toString(36).toUpperCase()}`;
  let scopedCreated = false;
  try {
    const outcome = await createHrAdmin(pool, { username: scopedUser, password: 'RptVerify123', displayname: 'Web Verify', companies: companies.slice(0, 1) }, 'verify-hr-reports-web');
    scopedCreated = outcome.ok === true;
    check('Create scoped test HR Admin for the web proxy attack', scopedCreated, outcome.message || '');
    if (scopedCreated) {
      const perms = await getEffectivePermissions(pool, scopedUser);
      perms.reports = { ...(perms.reports || {}), view: true, export: true };
      await savePermissions(pool, scopedUser, perms, 'verify-hr-reports-web');
      const scopedLogin = await fetch(`${WEB}/api/auth/hr`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username: scopedUser, password: 'RptVerify123' }),
      });
      const scopedTokenMatch = /auth_token=([^;]+)/.exec(scopedLogin.headers.get('set-cookie') || '');
      check('Scoped HR Admin login through the website', scopedLogin.status === 200 && Boolean(scopedTokenMatch), `HTTP ${scopedLogin.status}`);
      if (scopedTokenMatch) {
        const scopedCookie = `auth_token=${scopedTokenMatch[1]}`;
        const atk = await fetch(`${WEB}/api/hr/reports/summary?days=7&companycode=ZZUNAUTH`, { headers: { Cookie: scopedCookie } });
        check('Website proxy: unauthorised company id rejected for scoped admin (403)', atk.status === 403, `HTTP ${atk.status}`);
        const atkExport = await fetch(`${WEB}/api/hr/reports/export?days=7&companycode=ZZUNAUTH`, { headers: { Cookie: scopedCookie } });
        check('Website proxy: Excel export with unauthorised company id rejected for scoped admin (403)', atkExport.status === 403, `HTTP ${atkExport.status}`);
      }
    }
  } finally {
    if (scopedCreated) { try { await deleteHrAdmin(pool, scopedUser); } catch { /* best effort */ } }
  }

  // 6) Excel export download through the website proxy.
  const exportRes = await fetch(`${WEB}/api/hr/reports/export?days=7`, { headers: { Cookie: cookieHeader } });
  const exportBuf = Buffer.from(await exportRes.arrayBuffer());
  check('Website proxy: Excel export downloads .xlsx bytes', exportRes.status === 200 && exportBuf.slice(0, 2).toString() === 'PK', `HTTP ${exportRes.status}, ${exportBuf.length} bytes`);

  console.log(`\n=== RESULT: ${passed} passed, ${failed} failed ===`);
  process.exit(failed ? 1 : 0);
}

main().catch((error) => {
  console.error('VERIFY_WEB_ERROR', error && (error.message || error));
  process.exit(1);
});