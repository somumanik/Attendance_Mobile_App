// READ-ONLY: reconcile client-side monthly summary + Late Marks vs real API data
import 'dotenv/config';

const BASE = 'http://localhost:3000';
const J = (x) => JSON.stringify(x);

async function raw(path, cookie) {
  const res = await fetch(BASE + path, { headers: { Cookie: cookie } });
  return { status: res.status, text: await res.text() };
}

// Replica of the client summary logic in AuditSection.jsx (for reconciliation)
function clientSummary(audit) {
  const holidaySet = new Set((audit.holidays || []).filter((h) => h && h.active !== false).map((h) => String(h.holidaydate || '').slice(0, 10)));
  const byDate = new Map();
  for (const r of audit.attendance || []) {
    const k = String(r?.date || r?.dateoffice || '').slice(0, 10);
    if (k && !byDate.has(k)) byDate.set(k, r);
  }
  let present = 0; let absent = 0; let miss = 0; let holidaySkipped = 0;
  for (const [k, r] of byDate) {
    const label = String(r?.computedStatus || r?.statusLabel || '');
    if (label === 'Week Off') continue;
    const punched = Boolean(r?.inTime || r?.outTime || r?.in1 || r?.in2 || r?.out1 || r?.out2);
    if (holidaySet.has(k) && !punched) { holidaySkipped += 1; continue; }
    if (label === 'Absent') absent += 1;
    else if (label === 'Miss Punch') miss += 1;
    else present += 1;
  }
  const late = (audit.lateDetails || []).filter((d) => d && d.isFinalLate).length;
  return { present, absent, miss, late, holidaySkipped };
}

(async () => {
  const login = await fetch(`${BASE}/api/auth/hr`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: process.env.HR_USERNAME, password: process.env.HR_PASSWORD }),
  });
  const cookie = (login.headers.get('set-cookie') || '').split(';')[0];
  const results = [];
  const check = (name, cond, detail = '') => {
    results.push({ name, pass: !!cond });
    console.log(`${cond ? 'PASS' : 'FAIL'} :: ${name} :: ${detail}`);
  };

  // A. Reconciliation across real employees/months
  const list = JSON.parse((await raw('/api/employees?page=1&pageSize=100&active=Y', cookie)).text);
  let holidayCase = false;
  let graceCase = false;
  let monthsDiffer = false;
  let checked = 0;
  for (const e of list.rows || []) {
    if (checked >= 8) break;
    const pc = String(e.paycode).trim();
    const months = {};
    for (const m of ['2026-10', '2026-09']) {
      const a = JSON.parse((await raw(`/api/hr/audit/${encodeURIComponent(pc)}?month=${m}`, cookie)).text);
      const cs = clientSummary(a);
      months[m] = cs;
      const st = a.stats || {};
      const okRel = cs.present === Number(st.present || 0)
        && cs.miss === Number(st.miss || 0)
        && cs.absent === Number(st.absent || 0) - cs.holidaySkipped
        && cs.late === Number(st.late || 0);
      check(`Reconcile ${pc} ${m}: cards == server stats except holiday-absent`, okRel,
        `client=${J(cs)} server=${J(st)}`);
      if (cs.holidaySkipped > 0) holidayCase = true;
      const ld = a.lateDetails || [];
      if (ld.length > 0 && ld.some((d) => d.graceUsed)) graceCase = true;
      checked += 1;
    }
    if (months['2026-10'] && months['2026-09'] && J(months['2026-10']) !== J(months['2026-09'])) monthsDiffer = true;
  }
  check('Holiday-no-punch skipped as non-Absent in real data', holidayCase);
  check('Grace-covered late arrivals exist and are excluded from Late Marks', graceCase);
  check('Month-to-month summary values differ (cards must change)', monthsDiffer);

  // B. Late Marks authoritative rule on a dedicated grace case (0341 2026-09)
  const g = JSON.parse((await raw('/api/hr/audit/0341?month=2026-09', cookie)).text);
  const gld = g.lateDetails || [];
  const finals = gld.filter((d) => d.isFinalLate).length;
  check('Late Marks == isFinalLate count == stats.late (grace case)', finals === Number(g.stats?.late || 0) && gld.length > finals,
    `lateDetails=${gld.length} final=${finals} stats.late=${g.stats?.late} graceUsed=${J(gld.map((d) => d.graceUsed))}`);

  // C. Bundle wiring
  const page = await raw('/hr/audit', cookie);
  const chunkHrefs = [...page.text.matchAll(/\/_next\/static\/chunks\/[^"]+\.js/g)].map((m) => m[0]);
  let chunk = '';
  for (const h of [...new Set(chunkHrefs)]) {
    const t = await raw(h, cookie);
    if (t.text.includes('Late Marks')) chunk = t.text;
  }
  check('Bundle: month-keyed audit fetch (month=)', chunk.includes('month='));
  check('Bundle: Late Marks derives from isFinalLate', chunk.includes('isFinalLate'));
  check('Bundle: loading indicators wired', chunk.includes('fa-spinner') && chunk.includes('fa-spin'));
  check('Bundle: no leftover dual-fetch (calAudit)', !chunk.includes('calAudit'));

  // D. Regressions: tabs + logins + protected styles
  for (const path of ['/hr', '/hr/employees', '/hr/audit', '/hr/analytics', '/hr/celebrations', '/hr/leave', '/hr/salary', '/hr/holidays']) {
    check(`Tab ${path} (200)`, (await raw(path, cookie)).status === 200);
  }
  for (const path of ['/login', '/login/hr', '/login/employee', '/login/superadmin']) {
    check(`Login ${path} (200)`, (await raw(path)).status === 200);
  }
  const css = (await raw((page.text.match(/\/_next\/static\/css\/[^"]+\.css/) || [])[0], cookie)).text;
  check('CSS: calendar + exec styles intact', css.includes('.cal-grid') && css.includes('.exec-view .punch-in'));
  const empLogin = await fetch(`${BASE}/api/auth/employee`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ paycode: process.env.DEV_EMPLOYEE_PAYCODE, password: process.env.DEV_EMPLOYEE_PASSWORD }),
  });
  check('Employee login unchanged', empLogin.status === 200);

  const pass = results.filter((x) => x.pass).length;
  console.log(`\n${pass}/${results.length} checks passed`);
  process.exit(pass === results.length ? 0 : 1);
})().catch((e) => {
  console.error('FATAL', e);
  process.exit(1);
});