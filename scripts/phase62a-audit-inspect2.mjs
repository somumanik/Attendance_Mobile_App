// PHASE 6.2A — extended diagnostic (READ-ONLY): late/grace behaviour across months + categories.
import 'dotenv/config';
import { getPool } from '../server/db.js';

const log = (s = '') => console.log(String(s));
const B = process.env.PHASE62A_BASE || 'http://127.0.0.1:4000/api';
const pool = await getPool();

const l = await fetch(B + '/auth/hr/login', {
  method: 'POST', headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ username: process.env.HR_USERNAME, password: process.env.HR_PASSWORD }),
});
const tok = (await l.json())?.token;
if (!tok) { log('!! HR login failed'); process.exit(1); }

async function auditOf(paycode, month) {
  return await (await fetch(`${B}/hr/audit/${encodeURIComponent(paycode)}?month=${month}`, { headers: { Authorization: 'Bearer ' + tok } })).json();
}
const brief = (a) => ({
  cat: a?.employee?.cat, late: a?.stats?.late,
  lateDetails: (a?.lateDetails || []).map(d => ({ date: String(d.date).slice(0, 10), lateMinutes: d.lateMinutes, graceUsed: d.graceUsed, isFinalLate: d.isFinalLate })),
  graceRemaining: a?.graceRemaining, shift: a?.shift && { code: a.shift.shiftCode, start: a.shift.startTime, end: a.shift.endTime, resolved: a.shift.resolved },
});

// 1) 1053 across recent months (kis month me late entries the)
for (const m of ['2026-10', '2026-09', '2026-08', '2026-07']) {
  const a = await auditOf('1053', m);
  log(`## 1053 ${m} => ` + JSON.stringify(brief(a)));
}

// 2) STAFF employees with actual register latearrival > 0 (any recent month) — test cases
const lateRows = await pool.request().query(`
  SELECT TOP 8 LTRIM(RTRIM(tr.paycode)) AS paycode, LTRIM(RTRIM(e.cat)) AS cat,
         LTRIM(RTRIM(e.companycode)) AS companycode, CONVERT(varchar(7), tr.dateoffice, 126) AS m,
         COUNT(*) AS n
  FROM dbo.tbltimeregister tr
  JOIN dbo.tblemployee e ON LTRIM(RTRIM(e.paycode)) = LTRIM(RTRIM(tr.paycode))
  WHERE COALESCE(tr.latearrival, 0) > 0 AND tr.dateoffice >= '2026-07-01'
    AND LTRIM(RTRIM(e.active)) = 'Y'
  GROUP BY LTRIM(RTRIM(tr.paycode)), LTRIM(RTRIM(e.cat)), LTRIM(RTRIM(e.companycode)), CONVERT(varchar(7), tr.dateoffice, 126)
  ORDER BY m DESC, n DESC`);
log('## paycodes with register latearrival (since 2026-07) => ' + JSON.stringify(lateRows.recordset));

// 3) Pick a STAFF (cat 001) and a NON-STAFF (cat 002+) sample from that list and audit them
const staffSample = lateRows.recordset.find(r => r.cat === '001');
const workerSample = lateRows.recordset.find(r => r.cat !== '001');
if (staffSample) {
  const a = await auditOf(staffSample.paycode, staffSample.m);
  log(`## STAFF sample ${staffSample.paycode} (${staffSample.m}) => ` + JSON.stringify(brief(a)));
}
if (workerSample) {
  const a = await auditOf(workerSample.paycode, workerSample.m);
  log(`## NON-STAFF sample ${workerSample.paycode} (${workerSample.m}) => ` + JSON.stringify(brief(a)));
}

// 4) One active WORKER (cat 002) with NO lates — current month (check misleading grace block)
const w = await pool.request().query(`
  SELECT TOP 1 LTRIM(RTRIM(e.paycode)) AS paycode FROM dbo.tblemployee e
  WHERE LTRIM(RTRIM(e.cat)) = '002' AND LTRIM(RTRIM(e.active)) = 'Y'`);
if (w.recordset[0]) {
  const a = await auditOf(w.recordset[0].paycode, '2026-10');
  log(`## WORKER no-late sample ${w.recordset[0].paycode} (2026-10) => ` + JSON.stringify(brief(a)));
}

pool.close();