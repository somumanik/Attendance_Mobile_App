// PHASE 1D.2 — Executive Overview theme/colour verification (READ-ONLY).
// Next server on :3000 + existing Express backend on :4000. No data changes.
// Checks: HR login, Executive Overview render + scoped styles in served CSS,
// real chart/live/audit/late data shapes, simulated punch/badge mapping over
// REAL rows, other tabs + auth flows unchanged.
import 'dotenv/config';

const BASE = process.env.PHASE1D2_BASE || 'http://localhost:3000';
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

// Mirror of ExecPunch.jsx decision (simulation only).
function punchCell(value) {
  const v = value == null ? '' : String(value).trim();
  const missing = v === '' || v === '—' || v === '--';
  return missing ? { text: '—', cls: 'punch-missing' } : { text: v, cls: '' };
}
// Mirror of execStatusBadge.js decision (simulation only).
function badgeClass(status) {
  const c = String(status || '').toLowerCase();
  if (c.includes('holiday')) return 'badge--holiday';
  if (c.includes('present') || c.includes('complete')) return 'badge--present';
  if (c.includes('absent')) return 'badge--absent';
  if (c.includes('miss')) return 'badge--miss';
  if (c.includes('late')) return 'badge--late';
  if (c.includes('week') || c.includes('off')) return 'badge--weekoff';
  if (c.includes('leave')) return 'badge--leave';
  return 'badge--neutral';
}

(async () => {
  // 1. HR login (unchanged flow)
  const hrLogin = await raw('/api/auth/hr', { method: 'POST', body: { username: process.env.HR_USERNAME, password: process.env.HR_PASSWORD } });
  const hrCookie = (hrLogin.setCookie || '').split(';')[0];
  check('HR login flow unchanged (200 + success)', hrLogin.status === 200 && hrLogin.text.includes('"success":true'), `status=${hrLogin.status}`);

  // 2. Executive Overview render
  const hr = await raw('/hr', { cookie: hrCookie });
  check('HR Executive Overview renders (200)', hr.status === 200, `status=${hr.status}`);
  check('Executive Overview title present', hr.text.includes('Executive Overview'));
  check('Executive Overview subtitle present', hr.text.includes('master SQL database'));
  check('Scoped .exec-view wrapper present', hr.text.includes('exec-view'));
  check('exec-title / exec-subtitle classes present', hr.text.includes('exec-title') && hr.text.includes('exec-subtitle'));

  // 3. Served CSS contains scoped styles (shared badges untouched)
  const cssHref = (hr.text.match(/\/_next\/static\/css\/[^"]+\.css/) || [])[0];
  check('CSS asset linked', !!cssHref, cssHref || 'none');
  if (cssHref) {
    const css = await raw(cssHref);
    const flat = css.text.replace(/\s+/g, ' ');
    check('CSS: punch-in emerald + punch-out rose', css.text.includes('.exec-view .punch-in') && css.text.includes('#6ee7b7') && css.text.includes('.exec-view .punch-out') && css.text.includes('#fda4af'));
    check('CSS: punch-missing muted', css.text.includes('.exec-view .punch-missing'));
    check('CSS: status badges (present/absent/miss/late/weekoff/holiday)', ['--present', '--absent', '--miss', '--late', '--weekoff', '--holiday'].every((b) => css.text.includes(`.exec-view .badge${b}`)));
    check('CSS: shared .badge--late still indigo (other tabs)', /\.badge--late\{[^}]*#a5b4fc/.test(flat));
    check('CSS: shared .badge--weekoff still purple (other tabs)', /\.badge--weekoff\{[^}]*#d8b4fe/.test(flat));
    check('CSS: Plus Jakarta Sans base font', css.text.includes('Plus Jakarta Sans'));
  }

  // 4. Real data through the same endpoints the Executive Overview uses
  const today = new Date();
  const iso = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;
  const month = iso.slice(0, 7);

  const dash = await raw('/api/hr/dashboard', { cookie: hrCookie });
  check('/api/hr/dashboard real summary', dash.status === 200 && dash.text.includes('totalstaff'), `status=${dash.status}`);

  const charts = await raw('/api/hr/dashboard-charts', { cookie: hrCookie });
  let c = {};
  try { c = JSON.parse(charts.text); } catch { /* ignore */ }
  check('Chart 5 Department-wise present', !!(c.chart5 && Array.isArray(c.chart5.labels)), `labels=${(c.chart5?.labels || []).length}`);
  check('Chart 1 Attendance Activity present', !!(c.chart1 && Array.isArray(c.chart1.data) && Array.isArray(c.chart1.colors)), `slices=${(c.chart1?.data || []).length}`);
  check('Chart 2 Last 10 Days present', !!(c.chart2 && Array.isArray(c.chart2.datasets)), `datasets=${(c.chart2?.datasets || []).length}`);
  check('Chart 3 Currently Present present', !!(c.chart3 && Array.isArray(c.chart3.data)), `bars=${(c.chart3?.data || []).length}`);
  check('Chart 4 Yesterday present', !!(c.chart4 && Array.isArray(c.chart4.data)), `bars=${(c.chart4?.data || []).length}`);

  const daily = await raw(`/api/hr/daily?fromDate=${iso}&toDate=${iso}`, { cookie: hrCookie });
  let rows = [];
  try { rows = JSON.parse(daily.text) || []; } catch { /* ignore */ }
  rows = Array.isArray(rows) ? rows : (rows.rows || rows.data || []);
  check('/api/hr/daily live rows fetched', daily.status === 200, `rows=${rows.length} status=${daily.status}`);

  const badges = {};
  let missIn = 0, missOut = 0, realIn = 0, realOut = 0;
  for (const r of rows) {
    const b = badgeClass(r.computedStatus || r.statusLabel);
    badges[b] = (badges[b] || 0) + 1;
    const i = punchCell(r.inTime); const o = punchCell(r.outTime);
    if (i.cls === 'punch-missing') missIn++; else realIn++;
    if (o.cls === 'punch-missing') missOut++; else realOut++;
  }
  console.log(`INFO :: live-row badge simulation :: ${JSON.stringify(badges)}`);
  console.log(`INFO :: live-row punch simulation :: realIn=${realIn} missingIn=${missIn} realOut=${realOut} missingOut=${missOut}`);
  if (rows.length) {
    const s = rows.find((r) => r.inTime || r.in1) || rows[0];
    console.log(`INFO :: sample raw row :: ${JSON.stringify({ paycode: s.paycode, in1: s.in1, in2: s.in2, out1: s.out1, out2: s.out2, inTime: s.inTime, outTime: s.outTime, computedStatus: s.computedStatus, statusLabel: s.statusLabel })}`);
  }
  const badgeSet = Object.keys(badges);
  check('Status badges map to scoped badge-- classes', rows.length > 0 ? badgeSet.every((k) => k.startsWith('badge--')) : true, badgeSet.join(', ') || 'no rows today');

  // Audit modal data
  let paycode = rows[0]?.paycode || null;
  if (!paycode) {
    const roster = await raw('/api/employees?active=Y&page=1&pageSize=5', { cookie: hrCookie });
    try { paycode = (JSON.parse(roster.text)?.employees || [])[0]?.paycode; } catch { /* ignore */ }
  }
  if (paycode) {
    const audit = await raw(`/api/hr/audit/${encodeURIComponent(paycode)}?month=${month}`, { cookie: hrCookie });
    let a = {};
    try { a = JSON.parse(audit.text); } catch { /* ignore */ }
    check('Audit modal data (/api/hr/audit) real rows', audit.status === 200 && Array.isArray(a.attendance), `paycode=${paycode} days=${(a.attendance || []).length}`);
    const auditBadges = {};
    for (const r of a.attendance || []) auditBadges[badgeClass(r.computedStatus || r.statusLabel)] = (auditBadges[badgeClass(r.computedStatus || r.statusLabel)] || 0) + 1;
    console.log(`INFO :: audit-row badge simulation :: ${JSON.stringify(auditBadges)}`);
  } else {
    check('Audit modal data source', false, 'no paycode available from live rows or roster');
  }

  const late = await raw(`/api/hr/late-employees?fromDate=${iso}&toDate=${iso}`, { cookie: hrCookie });
  let l = {};
  try { l = JSON.parse(late.text); } catch { /* ignore */ }
  check('Late Employees modal data (/api/hr/late-employees)', late.status === 200 && Array.isArray(l.employees), `late=${l.late} rows=${(l.employees || []).length}`);

  // 5. Other tabs + auth flows unchanged
  for (const path of ['/hr/employees', '/hr/audit', '/hr/analytics', '/hr/leave', '/hr/holidays', '/hr/daily', '/hr/celebrations', '/hr/marriage', '/hr/email', '/hr/salary']) {
    const t = await raw(path, { cookie: hrCookie });
    check(`Tab ${path} renders (200)`, t.status === 200, `status=${t.status}`);
  }
  const loginPage = await raw('/login');
  check('Login page unchanged (200)', loginPage.status === 200, `status=${loginPage.status}`);
  const empLogin = await raw('/api/auth/employee', { method: 'POST', body: { paycode: process.env.DEV_EMPLOYEE_PAYCODE, password: process.env.DEV_EMPLOYEE_PASSWORD } });
  check('Employee login flow unchanged', empLogin.status === 200 && empLogin.text.includes('"success":true'), `status=${empLogin.status}`);
  const empCookie = (empLogin.setCookie || '').split(';')[0];
  const empToHr = await raw('/hr', { cookie: empCookie });
  check('Employee still blocked from /hr (redirect)', empToHr.status >= 300 && empToHr.status < 400, `status=${empToHr.status}`);
  const anon = await raw('/hr');
  check('Anonymous /hr still redirects', anon.status >= 300 && anon.status < 400, `status=${anon.status}`);

  const pass = results.filter((r) => r.pass).length;
  console.log(`\n${pass}/${results.length} checks passed`);
  process.exit(pass === results.length ? 0 : 1);
})().catch((e) => {
  console.error('FATAL', e);
  process.exit(1);
});