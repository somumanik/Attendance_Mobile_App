// PHASE 1D.5 — Single Employee Audit visual-parity verification (READ-ONLY).
// Next server on :3000 + Express backend on :4000. No data changes.
import 'dotenv/config';

const BASE = process.env.PHASE1D5_BASE || 'http://localhost:3000';
const results = [];
const check = (name, cond, detail = '') => {
  const pass = !!cond;
  results.push({ name, pass, detail: String(detail) });
  console.log(`${pass ? 'PASS' : 'FAIL'} :: ${name} :: ${detail}`);
};

async function raw(path, { method = 'GET', body, cookie } = {}) {
  const headers = {};
  if (body) headers['Content-Type'] = 'application/json';
  if (cookie) headers.Cookie = cookie;
  const res = await fetch(BASE + path, { method, headers, body: body ? JSON.stringify(body) : undefined, redirect: 'manual' });
  const text = await res.text();
  return { status: res.status, text, setCookie: res.headers.get('set-cookie') || '' };
}

(async () => {
  const hrLogin = await raw('/api/auth/hr', { method: 'POST', body: { username: process.env.HR_USERNAME, password: process.env.HR_PASSWORD } });
  const hrCookie = (hrLogin.setCookie || '').split(';')[0];
  check('HR login unchanged', hrLogin.status === 200 && hrLogin.text.includes('"success":true'), `status=${hrLogin.status}`);

  const page = await raw('/hr/audit', { cookie: hrCookie });
  check('/hr/audit renders (200)', page.status === 200, `status=${page.status}`);

  // 1. Served CSS — scoped palette + dropdown styles
  const cssHref = (page.text.match(/\/_next\/static\/css\/[^"]+\.css/) || [])[0];
  const css = (await raw(cssHref)).text;
  check('CSS: IN bright emerald #00d6a0 + OUT coral #ff667d', css.includes('.audit-tab .audit-in') && css.includes('#00d6a0') && css.includes('.audit-tab .audit-out') && css.includes('#ff667d'));
  check('CSS: dash stays muted (no fake times)', css.includes('.audit-tab .audit-dash'));
  check('CSS: summary name/accent/meta', ['audit-name', 'audit-accent', 'audit-meta'].every((c) => css.includes(`.audit-tab .${c}`)) && css.includes('#818cf8'));
  check('CSS: detail value tones (green/teal/pink/violet)', ['green', 'teal', 'pink', 'violet'].every((c) => css.includes(`.audit-val--${c}`)) && css.includes('#2dd4bf') && css.includes('#f472b6') && css.includes('#a78bfa'));
  check('CSS: dropdown dark navy + violet border/focus', css.includes('.audit-select') && css.includes('rgba(15, 23, 42, 0.9)') && css.includes('color-scheme: dark'));
  check('CSS: dropdown dark options + highlighted checked', css.includes('.audit-select option') && css.includes('#111827') && css.includes('.audit-select option:checked') && css.includes('#3730a3'));
  check('CSS: shared badges untouched (other tabs)', /\.badge--late\s*\{[^}]*#a5b4fc/.test(css) && /\.badge--weekoff\s*\{[^}]*#d8b4fe/.test(css));
  check('CSS: executive overview styles untouched', css.includes('.exec-view .punch-in') && css.includes('.exec-view .badge--late'));

  // 2. Client bundle — scoped classes wired into the tab
  const chunkHrefs = [...page.text.matchAll(/\/_next\/static\/chunks\/[^"]+\.js/g)].map((m) => m[0]);
  let chunk = '';
  for (const h of [...new Set(chunkHrefs)]) {
    const t = await raw(h);
    if (t.text.includes('Loading active employees')) chunk = t.text;
  }
  check('Bundle: audit-tab scope + select class present', chunk.includes('audit-tab') && chunk.includes('audit-select'));
  check('Bundle: punch values use scoped classes', ['audit-in', 'audit-out', 'audit-dash'].every((c) => chunk.includes(c)));
  check('Bundle: summary + details classes present', ['audit-name', 'audit-accent', 'audit-meta', 'audit-pct', 'audit-val--pink', 'audit-val--green', 'audit-val--teal', 'audit-val--violet'].every((c) => chunk.includes(c)));
  check('Bundle: KPI labels + badge mapping intact', chunk.includes('audit-kpi-label') && chunk.includes('badge--'));
  check('Bundle: selection + fetch logic unchanged (active=Y, /hr/audit/)', chunk.includes('active=Y') && chunk.includes('/hr/audit/'));

  // 3. Real SQL data + selection unchanged
  const list = await raw('/api/employees?page=1&pageSize=100&active=Y', { cookie: hrCookie });
  const ld = JSON.parse(list.text);
  check('Active employee list unchanged (total from SQL)', Number(ld.total) === 296, `total=${ld.total}`);
  const first = (ld.rows || [])[0];
  const pc = String(first?.paycode || '').trim();
  check('Default selection target still first real employee', !!pc, `${pc} - ${first?.empname}`);
  const month = new Date().toISOString().slice(0, 7);
  const audit = JSON.parse((await raw(`/api/hr/audit/${encodeURIComponent(pc)}?month=${month}`, { cookie: hrCookie })).text);
  check('Audit stats unchanged (real values)', audit.stats && Number(audit.stats.absent) === 27 && Number(audit.stats.present) === 0, JSON.stringify(audit.stats));
  check('Punch log rows unchanged (31 days)', Array.isArray(audit.attendance) && audit.attendance.length === 31, `days=${(audit.attendance || []).length}`);
  const withIn = (audit.attendance || []).filter((r) => r.inTime).length;
  console.log(`INFO :: real punch rows :: inTime present on ${withIn}/${(audit.attendance || []).length} (rest render muted dash)`);

  // 4. Other tabs + login flows unchanged
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