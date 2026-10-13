// PHASE 1D.3 — Sidebar icons + roster count colours verification (READ-ONLY).
// Next server on :3000 + existing Express backend on :4000. No data changes.
import 'dotenv/config';

const BASE = process.env.PHASE1D3_BASE || 'http://localhost:3000';
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

// Original React sidebar mapping (index.html) — icon + colour per item.
const HR_EXPECT = [
  ['fa-th-large', 'text-indigo-400'], ['fa-users', 'text-emerald-400'], ['fa-user-check', 'text-purple-400'],
  ['fa-layer-group', 'text-amber-400'], ['fa-calendar-day', 'text-rose-400'], ['fa-cake-candles', 'text-pink-400'],
  ['fa-file-excel', 'text-teal-400'], ['fa-envelope', 'text-violet-400'], ['fa-clipboard-check', 'text-sky-400'],
];
const EMP_EXPECT = [
  ['fa-gauge-high', 'text-indigo-400'], ['fa-calendar-check', 'text-emerald-400'], ['fa-plane-departure', 'text-amber-400'],
  ['fa-chart-column', 'text-purple-400'], ['fa-user-circle', 'text-pink-400'],
];

(async () => {
  // 1. HR login + left-sidebar icons (PortalShell)
  const hrLogin = await raw('/api/auth/hr', { method: 'POST', body: { username: process.env.HR_USERNAME, password: process.env.HR_PASSWORD } });
  const hrCookie = (hrLogin.setCookie || '').split(';')[0];
  check('HR login unchanged', hrLogin.status === 200 && hrLogin.text.includes('"success":true'), `status=${hrLogin.status}`);

  const hr = await raw('/hr', { cookie: hrCookie });
  check('HR portal renders (200)', hr.status === 200, `status=${hr.status}`);
  for (const [icon, color] of HR_EXPECT) {
    check(`HR sidebar icon colourful: ${icon} + ${color}`, hr.text.includes(`${icon} w-4 ${color}`));
  }
  check('HR sidebar extra icons colourful (Salary/Holidays)', hr.text.includes('fa-money-bill-wave w-4 text-emerald-400') && hr.text.includes('fa-calendar-days w-4 text-rose-400'));
  check('Sidebar icons no longer single accent colour', !hr.text.includes('w-4 text-[var(--accent-soft)]'));
  check('Active-tab highlight preserved (sidebar-item active)', hr.text.includes('sidebar-item') && hr.text.includes('active'));
  check('Nav labels/routes preserved', ['Executive Overview', 'All Employees Roster', 'Single Employee Audit', 'Category-wise Analytics', 'Daily Master Report', 'Marriage Anniversary', 'Email Configuration', 'Leave Management', 'Holiday Management'].every((l) => hr.text.includes(l)));

  // 2. Employee sidebar icons
  const empLogin = await raw('/api/auth/employee', { method: 'POST', body: { paycode: process.env.DEV_EMPLOYEE_PAYCODE, password: process.env.DEV_EMPLOYEE_PASSWORD } });
  const empCookie = (empLogin.setCookie || '').split(';')[0];
  check('Employee login unchanged', empLogin.status === 200 && empLogin.text.includes('"success":true'), `status=${empLogin.status}`);
  const emp = await raw('/employee', { cookie: empCookie });
  check('Employee portal renders (200)', emp.status === 200, `status=${emp.status}`);
  for (const [icon, color] of EMP_EXPECT) {
    check(`Employee sidebar icon colourful: ${icon} + ${color}`, emp.text.includes(`${icon} w-4 ${color}`));
  }

  // 3. Roster page + served CSS carries the original colour utilities
  const roster = await raw('/hr/employees', { cookie: hrCookie });
  check('All Employees Roster renders (200)', roster.status === 200, `status=${roster.status}`);
  const cssHref = (roster.text.match(/\/_next\/static\/css\/[^"]+\.css/) || [])[0];
  if (cssHref) {
    const css = await raw(cssHref);
    check('CSS has original roster colours (emerald/rose/amber 400)', ['#34d399', '#fb7185', '#fbbf24'].every((h) => css.text.includes(h)));
    check('CSS has sidebar icon colour utilities', ['text-indigo-400', 'text-emerald-400', 'text-purple-400', 'text-amber-400', 'text-rose-400', 'text-pink-400', 'text-teal-400', 'text-violet-400', 'text-sky-400'].every((cn) => css.text.includes(`.${cn}`)));
  } else {
    check('CSS asset linked', false, 'no css href');
  }

  // 4. Roster client chunk carries the coloured count spans (root-cause fix)
  const chunkHrefs = [...roster.text.matchAll(/\/_next\/static\/chunks\/[^"]+\.js/g)].map((m) => m[0]);
  let rosterChunk = '';
  for (const h of [...new Set(chunkHrefs)]) {
    const t = await raw(h);
    if (t.text.includes('attendanceStats') && t.text.includes('Roster')) rosterChunk = t.text;
  }
  check('Roster chunk renders coloured Present/Absent/Miss spans', rosterChunk.includes('text-emerald-400 font-bold') && rosterChunk.includes('text-rose-400 font-bold') && rosterChunk.includes('text-amber-400 font-bold'));

  // 5. REAL data — counts straight from the API (no mock)
  const rosterApi = await raw('/api/employees?page=1&pageSize=50&active=Y', { cookie: hrCookie });
  let r = {};
  try { r = JSON.parse(rosterApi.text); } catch { /* ignore */ }
  const rows = r.rows || r.employees || [];
  check('Roster API real rows', rosterApi.status === 200 && rows.length > 0, `rows=${rows.length} total=${r.total ?? '?'}`);
  const sample = rows.slice(0, 5).map((e) => ({ paycode: String(e.paycode).trim(), p: e.attendanceStats?.present, a: e.attendanceStats?.absent, m: e.attendanceStats?.miss }));
  console.log(`INFO :: real roster counts sample :: ${JSON.stringify(sample)}`);

  // 6. Navigation — every sidebar route still reachable
  for (const path of ['/hr', '/hr/employees', '/hr/audit', '/hr/analytics', '/hr/daily', '/hr/celebrations', '/hr/marriage', '/hr/email', '/hr/leave', '/hr/salary', '/hr/holidays']) {
    const t = await raw(path, { cookie: hrCookie });
    check(`Nav route ${path} (200)`, t.status === 200, `status=${t.status}`);
  }

  // 7. Executive Overview + protected surfaces unchanged
  check('Executive Overview: title + exec-view intact', hr.text.includes('Executive Overview') && hr.text.includes('exec-view'));
  check('Login page unchanged', (await raw('/login')).status === 200);
  for (const path of ['/login/hr', '/login/employee', '/login/superadmin']) {
    check(`Login screen ${path} (200)`, (await raw(path)).status === 200);
  }
  const empToHr = await raw('/hr', { cookie: empCookie });
  check('Employee still blocked from /hr (redirect)', empToHr.status >= 300 && empToHr.status < 400, `status=${empToHr.status}`);
  const anon = await raw('/hr');
  check('Anonymous /hr still redirects', anon.status >= 300 && anon.status < 400, `status=${anon.status}`);

  const pass = results.filter((x) => x.pass).length;
  console.log(`\n${pass}/${results.length} checks passed`);
  process.exit(pass === results.length ? 0 : 1);
})().catch((e) => {
  console.error('FATAL', e);
  process.exit(1);
});