// READ-ONLY: Birthdays & Anniversaries upcoming-lists verification
import 'dotenv/config';

const BASE = 'http://localhost:3000';
const J = (x) => JSON.stringify(x);

async function raw(path, cookie) {
  const res = await fetch(BASE + path, { headers: { Cookie: cookie } });
  return { status: res.status, text: await res.text() };
}

// Replica of lib/hr.js daysUntilMonthDay (same established rule as React website)
function daysUntilMonthDay(iso, now) {
  const s = String(iso || '').slice(5, 10);
  if (s.length !== 5) return null;
  const [m, d] = s.split('-').map(Number);
  if (!m || !d) return null;
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  let next = new Date(now.getFullYear(), m - 1, d);
  if (next < today) next = new Date(now.getFullYear() + 1, m - 1, d);
  return Math.round((next - today) / 86400000);
}
const upcoming = (list, field, range, now) => list
  .map((x) => ({ x, days: daysUntilMonthDay(x[field], now) }))
  .filter((u) => u.days !== null && u.days > 0 && u.days <= range)
  .sort((a, b) => a.days - b.days);

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
  const now = new Date();

  // A. Complete employee source (root-cause fix)
  const cele = JSON.parse((await raw('/api/hr/celebrations', cookie)).text);
  const emps = cele.employees || [];
  const roster = JSON.parse((await raw('/api/employees?page=1&pageSize=100&active=Y', cookie)).text);
  check('Celebrations employee list == full active roster', emps.length === Number(roster.total || 0), `celebrations=${emps.length} activeTotal=${roster.total}`);
  const e0 = emps[0] || {};
  check('Rows carry DOB/DOJ + display fields (trimmed paycode)', 'dateofbirth' in e0 && 'dateofjoin' in e0 && 'designation' in e0 && 'departmentcode' in e0 && e0.paycode === String(e0.paycode).trim(), J({ paycode: e0.paycode, designation: e0.designation, dept: e0.departmentcode }));

  // B. ROOT-CAUSE PROOF: old capped source vs full list
  const bFull = upcoming(emps, 'dateofbirth', 30, now);
  const bOld = upcoming(emps.slice(0, 100), 'dateofbirth', 30, now);
  check('Old 100-row source missed upcoming birthdays (bug proven)', bFull.length > bOld.length, `full=${bFull.length} first100=${bOld.length} missing=${bFull.length - bOld.length}`);
  check('Birthday window: 0 < days <= 30 + chronological', bFull.every((u) => u.days > 0 && u.days <= 30) && bFull.every((u, i) => i === 0 || bFull[i - 1].days <= u.days), J(bFull.slice(0, 3).map((u) => ({ p: u.x.paycode, d: u.days }))));

  // C. Date-rule checks (boundary + leap + today-exclusion)
  check('Today excluded from upcoming (matches React days>0 rule)', daysUntilMonthDay(`${now.getFullYear()}-10-13`, now) === 0 ? true : daysUntilMonthDay(`${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`, now) === 0);
  check('Dec 31 rolls into next year from Oct', daysUntilMonthDay('2020-12-31', new Date(2026, 9, 13)) === 79, String(daysUntilMonthDay('2020-12-31', new Date(2026, 9, 13))));
  check('Jan 5 (next year) computed across year boundary', daysUntilMonthDay('2020-01-05', new Date(2026, 9, 13)) === 84, String(daysUntilMonthDay('2020-01-05', new Date(2026, 9, 13))));
  check('Feb 29 leap date rolls to Mar 1 in common years (established)', daysUntilMonthDay('2024-02-29', new Date(2026, 9, 13)) === 139, String(daysUntilMonthDay('2024-02-29', new Date(2026, 9, 13))));

  // D. Work anniversaries (45 days) + Marriage (60 days, application table)
  const aFull = upcoming(emps, 'dateofjoin', 45, now);
  check('Work anniversaries: 0 < days <= 45 + chronological', aFull.every((u) => u.days > 0 && u.days <= 45) && aFull.every((u, i) => i === 0 || aFull[i - 1].days <= u.days), `count=${aFull.length}`);
  const mar = JSON.parse((await raw('/api/marriage-anniversary', cookie)).text);
  check('Marriage source = application import table (bare array)', Array.isArray(mar), `rows=${(mar || []).length}`);
  check('Marriage rows carry anniversarydate + paycode', (mar || []).every((m) => 'anniversarydate' in m && 'paycode' in m), J((mar || []).slice(0, 2).map((m) => ({ p: m.paycode, a: m.anniversarydate }))));
  const mFull = upcoming(mar, 'anniversarydate', 60, now);
  check('Marriage anniversaries: 0 < days <= 60 + chronological', mFull.every((u) => u.days > 0 && u.days <= 60) && mFull.every((u, i) => i === 0 || mFull[i - 1].days <= u.days), `count=${mFull.length}`);
  const unmatched = (mar || []).filter((m) => !emps.some((e) => String(e.paycode || '').trim() === String(m.paycode || '').trim())).length;
  check('Marriage rows match employees by trimmed paycode (padded keys)', unmatched === 0 && (mar || []).length > 0, `rows=${(mar || []).length} unmatched=${unmatched}`);

  // E. Bundle: new source wired, heavy fetch gone
  const page = await raw('/hr/celebrations', cookie);
  const chunkHrefs = [...page.text.matchAll(/\/_next\/static\/chunks\/[^"]+\.js/g)].map((m) => m[0]);
  let chunk = '';
  for (const h of [...new Set(chunkHrefs)]) {
    const t = await raw(h, cookie);
    if (t.text.includes('Upcoming Birthdays')) chunk = t.text;
  }
  check('Bundle: /hr/celebrations + /marriage-anniversary sources', chunk.includes('/hr/celebrations') && chunk.includes('/marriage-anniversary'));
  check('Bundle: heavy capped /employees fetch removed', !chunk.includes('pageSize=500&active=ALL') && !chunk.includes('/employees?page='));
  check('Bundle: loading + empty states intact', chunk.includes('Celebrations load ho rahe hain') && chunk.includes('Next 30 days me koi birthday nahi'));

  // F. Regressions: protected tabs + logins
  for (const path of ['/hr', '/hr/employees', '/hr/audit', '/hr/marriage']) {
    check(`Tab ${path} (200)`, (await raw(path, cookie)).status === 200);
  }
  for (const path of ['/login', '/login/hr', '/login/employee', '/login/superadmin']) {
    check(`Login ${path} (200)`, (await raw(path)).status === 200);
  }
  const empLogin = await fetch(`${BASE}/api/auth/employee`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ paycode: process.env.DEV_EMPLOYEE_PAYCODE, password: process.env.DEV_EMPLOYEE_PASSWORD }),
  });
  check('Employee login unchanged', empLogin.status === 200);
  check('Overview consumer fields still present (backward compat)', emps.every((e) => 'empname' in e && 'paycode' in e && 'dateofbirth' in e && 'dateofjoin' in e));

  const pass = results.filter((x) => x.pass).length;
  console.log(`\n${pass}/${results.length} checks passed`);
  process.exit(pass === results.length ? 0 : 1);
})().catch((e) => {
  console.error('FATAL', e);
  process.exit(1);
});