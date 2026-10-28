// scripts/verify-p1-perms.mjs — live check of HR Admin permission persistence +
// enforcement + the legacy "no stored row" navigation-section behaviour.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
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
} catch {}

const BASE = process.env.VERIFY_BASE || 'http://localhost:4000';
let passed = 0, failed = 0;
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
  const json = ct.includes('application/json') ? await res.json().catch(() => null) : null;
  return { status: res.status, json };
}
const loginHr = async (u, p) => (await req('POST', '/api/auth/hr/login', { body: { username: u, password: p } })).json?.token || null;
const loginSa = async (u, p) => (await req('POST', '/api/auth/superadmin/login', { body: { username: u, password: p } })).json?.token || null;


async function main() {
  console.log(`\n=== Phase P1 permission verification against ${BASE} ===\n`);
  const pool = await getPool();
  await ensureAdminAccessTables(pool);
  const codes = await listCompanyCodes(pool);
  const compA = codes[0] || '001';
  const compB = codes.find((c) => c !== compA) || null;

  const SA_USER = 'p1sa_' + Date.now().toString().slice(-6);
  const HR_USER = 'p1hr_' + Date.now().toString().slice(-6);
  const TEST_PW = 'PhaseP1x123';

  const sa = await createSuperAdmin(pool, { username: SA_USER, password: TEST_PW, displayname: 'P1 Verify' }, 'verify-p1');
  check('Setup: temp SuperAdmin created', sa.ok === true, sa.message || '');
  const saToken = await loginSa(SA_USER, TEST_PW);
  check('Setup: SuperAdmin login works', Boolean(saToken));

  const created = await req('POST', '/api/superadmin/hr-admins', { token: saToken, body: { username: HR_USER, password: TEST_PW, displayname: 'P1 HR', companies: [compA] } });
  check('Create HR Admin with company A', created.status === 201, `HTTP ${created.status}`);
  const hrToken = await loginHr(HR_USER, TEST_PW);
  check('HR Admin login works', Boolean(hrToken));

  // ---- (1) view-only does NOT allow a write action (holidays create) ----
  let d = await req('GET', '/api/hr/holidays', { token: hrToken });
  check('Holidays GET allowed (default view)', d.status === 200, `HTTP ${d.status}`);
  d = await req('POST', '/api/hr/holidays', { token: hrToken, body: {} });
  check('Holidays POST denied for view-only account (403 PERMISSION_DENIED)', d.status === 403 && d.json?.code === 'PERMISSION_DENIED', `HTTP ${d.status} ${d.json?.code || ''}`);

  // ---- (2) persistence: grant holidays create, reload, verify ----
  const list = await req('GET', '/api/superadmin/hr-admins', { token: saToken });
  const admin = (list.json?.admins || []).find((a) => a.username === HR_USER);
  const perms = JSON.parse(JSON.stringify(admin?.permissions || {}));
  perms.holidays = { ...(perms.holidays || {}), create: true };
  const saved = await req('PUT', `/api/superadmin/hr-admins/${HR_USER}`, { token: saToken, body: { permissions: perms } });
  check('Save holidays.create=true confirmed', saved.status === 200 && saved.json?.permissions?.holidays?.create === true, `HTTP ${saved.status}`);
  const reloaded = await req('GET', '/api/superadmin/hr-admins', { token: saToken });
  const reloadedAdmin = (reloaded.json?.admins || []).find((a) => a.username === HR_USER);
  check('Persisted holidays.create survives reload', reloadedAdmin?.permissions?.holidays?.create === true);
  d = await req('POST', '/api/hr/holidays', { token: hrToken, body: {} });
  check('Holidays POST no longer PERMISSION_DENIED after grant', d.json?.code !== 'PERMISSION_DENIED', `HTTP ${d.status} ${d.json?.code || ''}`);

  // ---- (3) legacy navigation-section: remove the 'dashboard' row -> should remain allowed ----
  const stripped = JSON.parse(JSON.stringify(perms));
  delete stripped.dashboard;
  const saved2 = await req('PUT', `/api/superadmin/hr-admins/${HR_USER}`, { token: saToken, body: { permissions: stripped } });
  check('Save permissions without dashboard row', saved2.status === 200, `HTTP ${saved2.status}`);
  d = await req('GET', '/api/hr/dashboard', { token: hrToken });
  check('Legacy: /api/hr/dashboard ALLOWED when no stored dashboard row', d.status === 200, `HTTP ${d.status} ${d.json?.code || ''}`);

  // ---- (4) company scope: grant company B only, verify company A rejected ----
  if (compB) {
    const scope = await req('PUT', `/api/superadmin/hr-admins/${HR_USER}/companies`, { token: saToken, body: { companies: [compB] } });
    check('Company scope saved (company B)', scope.status === 200 && (scope.json?.companies || []).includes(compB), `HTTP ${scope.status}`);
    d = await req('GET', `/api/hr/holidays?companycode=${encodeURIComponent(compA)}`, { token: hrToken });
    check('Company A data rejected after scope -> B', d.status === 403 && d.json?.code === 'COMPANY_FORBIDDEN', `HTTP ${d.status} ${d.json?.code || ''}`);
  }

  // ---- (5) revoke takes effect on next request ----
  const revoked = JSON.parse(JSON.stringify(stripped));
  revoked.holidays = { ...(revoked.holidays || {}), view: false, create: false };
  await req('PUT', `/api/superadmin/hr-admins/${HR_USER}`, { token: saToken, body: { permissions: revoked } });
  d = await req('GET', '/api/hr/holidays', { token: hrToken });
  check('Revoke holidays.view -> next GET denied (403)', d.status === 403, `HTTP ${d.status}`);

  await req('DELETE', `/api/superadmin/hr-admins/${HR_USER}`, { token: saToken }).catch(() => {});
  try { await deleteHrAdmin(pool, HR_USER); } catch {}
  try { await setSuperAdminActive(pool, SA_USER, false, 'verify-p1'); } catch {}
  try { await deleteSuperAdmin(pool, SA_USER); } catch {}

  console.log(`\n=== RESULT: ${passed} passed, ${failed} failed ===`);
  process.exit(failed ? 1 : 0);
}
main().catch((e) => { console.error('VERIFY_RUN_ERROR', e?.message || e); process.exit(1); });
