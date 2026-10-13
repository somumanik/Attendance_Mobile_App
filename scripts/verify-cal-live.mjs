// PHASE 1+2 live verification — /hr/audit details + attendance calendar (READ-ONLY)
import 'dotenv/config';

const BASE = process.env.CAL_BASE || 'http://localhost:3000';
const results = [];
const check = (name, cond, detail = '') => {
  const pass = !!cond;
  results.push({ name, pass });
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
  const css = (await raw((page.text.match(/\/_next\/static\/css\/[^"]+\.css/) || [])[0])).text;

  // CSS: calendar palette + previous styling intact
  check('CSS: calendar classes present', ['cal-grid', 'cal-cell', 'cal-status', 'cal-late', 'cal-legend', 'cal-btn'].every((c) => css.includes(`.${c}`)));
  check('CSS: status colours green/red/amber/yellow/purple', ['#34d399', '#fb7185', '#fbbf24', '#facc15', '#c084fc'].every((h) => css.includes(h)));
  check('CSS: prior styling intact (white values + helpers + punch + dropdown)', ['#fff', '#ff79c6', '#00d6a0', '#ff667d'].every((h) => css.includes(h)) && css.includes('.audit-select'));

  // Bundle: calendar + details + Phase 1 labels wired
  const chunkHrefs = [...page.text.matchAll(/\/_next\/static\/chunks\/[^"]+\.js/g)].map((m) => m[0]);
  let chunk = '';
  for (const h of [...new Set(chunkHrefs)]) {
    const t = await raw(h);
    if (t.text.includes('Loading active employees')) chunk = t.text;
  }
  check('Bundle: calendar component wired', ['cal-grid', 'cal-status', 'Attendance Details'].every((s) => chunk.includes(s)));
  check('Bundle: Phase 1 Company label + mapping fields', chunk.includes('Company:') && chunk.includes('departmentname') && chunk.includes('companyname'));
  check('Bundle: punch log table removed', !chunk.includes('Daily Punch Log'));

  // Live data: month audit includes attendance + holidays (calendar sources)
  const ld = JSON.parse((await raw('/api/employees?page=1&pageSize=100&active=Y', { cookie: hrCookie })).text);
  const first = (ld.rows || [])[0] || {};
  const pc = String(first.paycode || '').trim();
  check('Active list + real names for Phase 1', Number(ld.total) === 296 && !!first.departmentname && !!first.companyname, `total=${ld.total} dept=${first.departmentname} company=${first.companyname}`);
  console.log(`INFO :: default employee display labels :: paycode=${pc} designation=${first.designation} dept=${first.departmentname} (${first.departmentcode}) company=${first.companyname} (${first.companycode})`);

  const month = new Date().toISOString().slice(0, 7);
  const audit = JSON.parse((await raw(`/api/hr/audit/${encodeURIComponent(pc)}?month=${month}`, { cookie: hrCookie })).text);
  check('Audit month response: attendance + holidays arrays', Array.isArray(audit.attendance) && Array.isArray(audit.holidays), `days=${(audit.attendance || []).length} holidays=${(audit.holidays || []).length}`);
  const row = (audit.attendance || []).find((r) => r.inTime || r.outTime) || (audit.attendance || [])[0];
  check('Attendance rows carry detail fields', !!row && 'inTime' in row && 'outTime' in row && 'hoursworked' in row && 'computedStatus' in row, JSON.stringify(row && { inTime: row.inTime, outTime: row.outTime, hrs: row.hoursworked, st: row.computedStatus, isLate: row.isLate }));
  check('Holiday rows carry ISO date + name + active', (audit.holidays || []).every((h) => /^\d{4}-\d{2}-\d{2}/.test(String(h.holidaydate)) && 'holidayname' in h && 'active' in h), JSON.stringify((audit.holidays || []).slice(0, 2)));

  // Calendar month navigation fetches (past month + year boundary)
  const sep = JSON.parse((await raw(`/api/hr/audit/${encodeURIComponent(pc)}?month=2026-09`, { cookie: hrCookie })).text);
  check('Past month fetch works (2026-09)', Array.isArray(sep.attendance), `days=${(sep.attendance || []).length} holidays=${(sep.holidays || []).length}`);
  const jan = JSON.parse((await raw(`/api/hr/audit/${encodeURIComponent(pc)}?month=2027-01`, { cookie: hrCookie })).text);
  check('Future year-boundary month fetch works (2027-01)', Array.isArray(jan.attendance), `days=${(jan.attendance || []).length}`);

  // Regression: other tabs + login + protected styles
  for (const path of ['/hr', '/hr/employees', '/hr/analytics', '/hr/celebrations', '/hr/leave', '/hr/salary', '/hr/holidays']) {
    check(`Tab ${path} (200)`, (await raw(path, { cookie: hrCookie })).status === 200);
  }
  for (const path of ['/login', '/login/hr', '/login/employee', '/login/superadmin']) {
    check(`Login ${path} (200)`, (await raw(path)).status === 200);
  }
  const empLogin = await raw('/api/auth/employee', { method: 'POST', body: { paycode: process.env.DEV_EMPLOYEE_PAYCODE, password: process.env.DEV_EMPLOYEE_PASSWORD } });
  check('Employee login unchanged', empLogin.status === 200 && empLogin.text.includes('"success":true'), `status=${empLogin.status}`);
  check('Executive Overview styles intact', css.includes('.exec-view .punch-in') && css.includes('.exec-view .badge--late'));

  const pass = results.filter((x) => x.pass).length;
  console.log(`\n${pass}/${results.length} checks passed`);
  process.exit(pass === results.length ? 0 : 1);
})().catch((e) => {
  console.error('FATAL', e);
  process.exit(1);
});