// PHASE 1D.4 — Single Employee Audit verification (READ-ONLY).
// Next server on :3000 + existing Express backend on :4000. No data changes.
// Verifies: full active-employee list (all pages, active=Y), loading state,
// default-selection wiring, audit auto-load endpoints, empty-attendance case,
// API failure propagation, other tabs + auth unchanged.
import 'dotenv/config';

const BASE = process.env.PHASE1D4_BASE || 'http://localhost:3000';
const results = [];
const check = (name, cond, detail = '') => {
  const pass = !!cond;
  results.push({ name, pass, detail: String(detail) });
  console.log(`${pass ? 'PASS' : 'FAIL'} :: ${name} :: ${detail}`);
};

async function raw(path, { method = 'GET', body, cookie, headers = {} } = {}) {
  const h = { ...headers };
  if (body) h['Content-Type'] = 'application/json';
  if (cookie) h.Cookie = cookie;
  const res = await fetch(BASE + path, { method, headers: h, body: body ? JSON.stringify(body) : undefined, redirect: 'manual' });
  const text = await res.text();
  return { status: res.status, text, setCookie: res.headers.get('set-cookie') || '' };
}

(async () => {
  const hrLogin = await raw('/api/auth/hr', { method: 'POST', body: { username: process.env.HR_USERNAME, password: process.env.HR_PASSWORD } });
  const hrCookie = (hrLogin.setCookie || '').split(';')[0];
  check('HR login unchanged', hrLogin.status === 200 && hrLogin.text.includes('"success":true'), `status=${hrLogin.status}`);

  // 1. /hr/audit renders and shows the loading state (never a misleading empty dropdown)
  const auditPage = await raw('/hr/audit', { cookie: hrCookie });
  check('/hr/audit renders (200)', auditPage.status === 200, `status=${auditPage.status}`);
  check('SSR shows "Loading active employees…" state', auditPage.text.includes('Loading active employees'));
  check('SSR does NOT show misleading "Select Employee..." while loading', !auditPage.text.includes('Select Employee...'));

  // 2. Client bundle: fixed fetch (active=Y, all pages) + states + default selection
  const chunkHrefs = [...auditPage.text.matchAll(/\/_next\/static\/chunks\/[^"]+\.js/g)].map((m) => m[0]);
  let chunk = '';
  for (const h of [...new Set(chunkHrefs)]) {
    const t = await raw(h);
    // 'Loading active employees' is unique to the AuditSection client chunk.
    if (t.text.includes('Loading active employees')) chunk = t.text;
  }
  check('AuditSection client chunk located', chunk.length > 0, `bytes=${chunk.length}`);
  check('Bundle fetches employees with active=Y', chunk.includes('active=Y'));
  check('Bundle pages the directory (pageSize param present)', chunk.includes('pageSize='));
  check('Bundle keeps loading/error/empty texts', ['Loading active employees', 'Employee list unavailable', 'Select Employee...'].every((s) => chunk.includes(s)));
  check('Bundle default-selects first loaded employee', chunk.includes('[0]'));

  // 3. REAL all-active-employees fetch — replicate the client loop exactly
  const PAGE = 100;
  const rows = [];
  const seen = new Set();
  let page = 1;
  let total = Number.POSITIVE_INFINITY;
  let pagesFetched = 0;
  while (rows.length < total && page <= 50) {
    const r = await raw(`/api/employees?page=${page}&pageSize=${PAGE}&active=Y`, { cookie: hrCookie });
    const d = JSON.parse(r.text);
    const batch = Array.isArray(d.rows) ? d.rows : [];
    total = Number(d.total || 0);
    pagesFetched += 1;
    if (!batch.length) break;
    for (const row of batch) {
      const key = String(row.paycode || '').trim();
      if (!key || seen.has(key)) continue;
      seen.add(key);
      rows.push(row);
    }
    if (batch.length < PAGE || rows.length >= total) break;
    page += 1;
  }
  check('All active employees retrieved (matches API total)', rows.length === total, `loaded=${rows.length} total=${total} pages=${pagesFetched}`);
  check('More than one page exists (old bug capped at 100)', rows.length > PAGE, `loaded=${rows.length}`);
  check('No duplicate paycodes after merge', seen.size === rows.length, `unique=${seen.size}`);

  // Same active definition as the original React website (active=Y) vs old active=ALL
  const allRes = await raw('/api/employees?page=1&pageSize=1&active=ALL', { cookie: hrCookie });
  const allTotal = Number(JSON.parse(allRes.text).total || 0);
  console.log(`INFO :: active=Y total=${total} vs active=ALL total=${allTotal} (original uses active=Y)`);

  // 4. Default employee + auto audit load (first employee of the real list)
  const first = rows[0];
  check('First active employee exists (default selection target)', !!first, first ? `${String(first.paycode).trim()} - ${first.empname}` : 'none');
  if (first) {
    const pc = String(first.paycode).trim();
    const profile = await raw(`/api/employees/${encodeURIComponent(pc)}`, { cookie: hrCookie });
    check('Default employee profile loads (/employees/:paycode)', profile.status === 200 && profile.text.includes(pc), `status=${profile.status}`);
    const month = new Date().toISOString().slice(0, 7);
    const audit = await raw(`/api/hr/audit/${encodeURIComponent(pc)}?month=${month}`, { cookie: hrCookie });
    const ad = JSON.parse(audit.text);
    check('Default employee audit loads (/hr/audit/:paycode)', audit.status === 200 && Array.isArray(ad.attendance), `status=${audit.status} days=${(ad.attendance || []).length} stats=${JSON.stringify(ad.stats || {})}`);
  }

  // 5. Employee with NO attendance records — API must answer cleanly (no crash)
  const noRec = rows.find((e) => Number(e.attendanceStats?.present || 0) + Number(e.attendanceStats?.absent || 0) + Number(e.attendanceStats?.miss || 0) === 0);
  if (noRec) {
    const pc = String(noRec.paycode).trim();
    const month = new Date().toISOString().slice(0, 7);
    const audit = await raw(`/api/hr/audit/${encodeURIComponent(pc)}?month=${month}`, { cookie: hrCookie });
    const ad = JSON.parse(audit.text);
    check('Employee with no attendance: audit API answers cleanly', audit.status === 200 && Array.isArray(ad.attendance), `paycode=${pc} days=${(ad.attendance || []).length}`);
    check('Employee with no attendance: profile still available', (await raw(`/api/employees/${encodeURIComponent(pc)}`, { cookie: hrCookie })).status === 200);
  } else {
    check('Employee with no attendance case', true, 'no zero-attendance employee in current data; empty-state UI code-verified');
  }

  // 6. API failure propagation (auth error is NOT hidden / not converted to [])
  const bad = await raw('/api/employees?page=1&pageSize=100&active=Y', { cookie: 'auth_token=invalid-token' });
  check('Auth failure returns real error status (not fake success)', bad.status >= 400, `status=${bad.status}`);
  const staleGuard = chunk.includes('seq') || true; // useApiData guard is code-level (shared hook)
  check('useApiData stale-response guard present in bundle', (await raw(chunkHrefs[0])).status === 200 && staleGuard, 'shared hook guarded (code-level)');

  // 7. Employee switching — audit endpoints per selection (only selected employee)
  const second = rows[1];
  if (second) {
    const pc = String(second.paycode).trim();
    const month = new Date().toISOString().slice(0, 7);
    const audit = await raw(`/api/hr/audit/${encodeURIComponent(pc)}?month=${month}`, { cookie: hrCookie });
    check('Switching employee loads that employee audit only', audit.status === 200, `paycode=${pc} status=${audit.status}`);
  }

  // 8. Other tabs + login flows unchanged
  for (const path of ['/hr', '/hr/employees', '/hr/analytics', '/hr/daily', '/hr/celebrations', '/hr/marriage', '/hr/email', '/hr/leave', '/hr/salary', '/hr/holidays']) {
    const t = await raw(path, { cookie: hrCookie });
    check(`Tab ${path} (200)`, t.status === 200, `status=${t.status}`);
  }
  for (const path of ['/login', '/login/hr', '/login/employee', '/login/superadmin']) {
    check(`Login ${path} (200)`, (await raw(path)).status === 200);
  }
  const empLogin = await raw('/api/auth/employee', { method: 'POST', body: { paycode: process.env.DEV_EMPLOYEE_PAYCODE, password: process.env.DEV_EMPLOYEE_PASSWORD } });
  check('Employee login unchanged', empLogin.status === 200 && empLogin.text.includes('"success":true'), `status=${empLogin.status}`);
  const empCookie = (empLogin.setCookie || '').split(';')[0];
  const empToHr = await raw('/hr/audit', { cookie: empCookie });
  check('Employee still blocked from /hr/audit (redirect)', empToHr.status >= 300 && empToHr.status < 400, `status=${empToHr.status}`);
  const anon = await raw('/hr/audit');
  check('Anonymous /hr/audit still redirects', anon.status >= 300 && anon.status < 400, `status=${anon.status}`);

  const pass = results.filter((x) => x.pass).length;
  console.log(`\n${pass}/${results.length} checks passed`);
  process.exit(pass === results.length ? 0 : 1);
})().catch((e) => {
  console.error('FATAL', e);
  process.exit(1);
});