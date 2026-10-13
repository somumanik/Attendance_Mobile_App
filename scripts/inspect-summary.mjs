// READ-ONLY inspection: monthly summary + Late Marks vs real records (no writes)
import 'dotenv/config';

const BASE = 'http://localhost:3000';
const J = (x) => JSON.stringify(x);

async function raw(path, cookie) {
  const res = await fetch(BASE + path, { headers: { Cookie: cookie } });
  return { status: res.status, text: await res.text() };
}

(async () => {
  const login = await fetch(`${BASE}/api/auth/hr`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: process.env.HR_USERNAME, password: process.env.HR_PASSWORD }),
  });
  const cookie = (login.headers.get('set-cookie') || '').split(';')[0];

  // 1) 0328 October 2026 — holiday (Gandhi Jayanti 10-02) + Sundays handling
  const oct = JSON.parse((await raw('/api/hr/audit/0328?month=2026-10', cookie)).text);
  console.log('0328 OCT stats:', J(oct.stats), 'holidays:', J((oct.holidays || []).map((h) => h.holidaydate)));
  for (const r of oct.attendance || []) {
    const d = String(r.date || r.dateoffice).slice(0, 10);
    if (['2026-10-02', '2026-10-04', '2026-10-11', '2026-10-18', '2026-10-25'].includes(d)) {
      console.log(`  ${d} -> status=${r.status} computed=${r.computedStatus} label=${r.statusLabel}`);
    }
  }
  const octBucket = { P: 0, A: 0, M: 0, skip: 0 };
  for (const r of oct.attendance || []) {
    const c = String(r.computedStatus || '');
    if (c === 'Week Off') octBucket.skip += 1;
    else if (c === 'Absent') octBucket.A += 1;
    else if (c === 'Miss Punch') octBucket.M += 1;
    else octBucket.P += 1;
  }
  console.log('  recomputed buckets from rows:', J(octBucket), '(compare with stats)');

  // 2) Find an employee/month with late arrivals + grace for Late Marks validation
  const list = JSON.parse((await raw('/api/employees?page=1&pageSize=100&active=Y', cookie)).text);
  let checked = 0;
  for (const e of list.rows || []) {
    if (checked >= 6) break;
    const pc = String(e.paycode).trim();
    for (const m of ['2026-10', '2026-09', '2026-08']) {
      const a = JSON.parse((await raw(`/api/hr/audit/${encodeURIComponent(pc)}?month=${m}`, cookie)).text);
      const ld = a.lateDetails || [];
      if (ld.length >= 3) {
        checked += 1;
        const finalOnes = ld.filter((d) => d.isFinalLate).length;
        const grace30 = ld.filter((d) => d.graceUsed === '30min').length;
        const grace1 = ld.filter((d) => d.graceUsed === '1hr').length;
        const grace2 = ld.filter((d) => d.graceUsed === '2hr').length;
        console.log(`LATE ${pc} ${m}: stats.late=${a.stats?.late} lateDetails=${ld.length} isFinalLate=${finalOnes} grace(30/1/2)=${grace30}/${grace1}/${grace2} graceRemaining=${J(a.graceRemaining)}`);
        for (const d of ld) {
          console.log(`   ${String(d.date).slice(0, 10)} late=${d.lateMinutes}m graceUsed=${d.graceUsed} final=${d.isFinalLate}`);
        }
        break;
      }
    }
  }

  // 3) Month-to-month stats differ for one employee (scoping sanity)
  const sep = JSON.parse((await raw('/api/hr/audit/0328?month=2026-09', cookie)).text);
  console.log('0328 SEP stats:', J(sep.stats), 'vs OCT stats:', J(oct.stats));
})();