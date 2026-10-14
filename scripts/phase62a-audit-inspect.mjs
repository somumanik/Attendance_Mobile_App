// PHASE 6.2A — Single Employee Audit diagnostic (READ-ONLY, Savior me koi write nahi).
// Focus: eligible STAFF employees (example 1053) ka grace/late data + shift info.
import 'dotenv/config';
import { getPool } from '../server/db.js';

const PAYCODE = (process.argv[2] || '1053').trim();
const log = (s = '') => console.log(String(s));

const pool = await getPool();

// 1) Employee master row
const e = await pool.request().input('p', PAYCODE).query(`
  SELECT TOP 1 LTRIM(RTRIM(paycode)) AS paycode, LTRIM(RTRIM(empname)) AS empname,
         LTRIM(RTRIM(companycode)) AS companycode, LTRIM(RTRIM(cat)) AS cat,
         LTRIM(RTRIM(designation)) AS designation, LTRIM(RTRIM(active)) AS active
  FROM dbo.tblemployee WHERE paycode = @p`);
log('## employee ' + PAYCODE + ' => ' + JSON.stringify(e.recordset[0] || null));
const catCode = String(e.recordset?.[0]?.cat || '').trim();

// 2) Category code -> name (tblcategory)
const cats = await pool.request().input('c', catCode).query(`
  SELECT LTRIM(RTRIM(cat)) AS cat, LTRIM(RTRIM(categoryname)) AS categoryname
  FROM dbo.tblcategory`);
log('## tblcategory rows => ' + JSON.stringify(cats.recordset));
log('## employee cat ' + JSON.stringify(catCode) + ' resolves to => ' + JSON.stringify(
  cats.recordset.filter(r => r.cat === catCode)));

// 3) All category names that look staff-ish (eligibility audit)
log('## all distinct categoryname values => ' + JSON.stringify([...new Set(cats.recordset.map(r => r.categoryname))]));

// 4) Current month processed rows with latearrival (stale register value)
const month = new Date().toISOString().slice(0, 7);
const late = await pool.request().input('p', PAYCODE).input('from', month + '-01').query(`
  SELECT LTRIM(RTRIM(dateoffice)) AS d, in1, in2, out1, out2,
         COALESCE(latearrival,0) AS latearrival, LTRIM(RTRIM(status)) AS status,
         LTRIM(RTRIM(shift)) AS shift
  FROM dbo.tbltimeregister
  WHERE paycode = @p AND dateoffice >= @from AND COALESCE(latearrival,0) > 0
  ORDER BY dateoffice`);
log('## register rows with latearrival > 0 (current month) => ' + JSON.stringify(late.recordset.map(r => ({ d: String(r.d).slice(0, 10), in1: r.in1, latearrival: r.latearrival, status: r.status, shift: r.shift }))));

// 5) Live API response (what web-next Single Employee Audit consumes)
const B = process.env.PHASE62A_BASE || 'http://127.0.0.1:4000/api';
const l = await fetch(B + '/auth/hr/login', {
  method: 'POST', headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ username: process.env.HR_USERNAME, password: process.env.HR_PASSWORD }),
});
const tok = (await l.json())?.token;
if (!tok) { log('!! HR login failed'); process.exit(1); }
const audit = await (await fetch(`${B}/hr/audit/${encodeURIComponent(PAYCODE)}?month=${month}`, { headers: { Authorization: 'Bearer ' + tok } })).json();
log('## API /hr/audit/' + PAYCODE + ' =>');
log('   employee.cat = ' + JSON.stringify(audit?.employee?.cat) + ' company = ' + JSON.stringify(audit?.employee?.companycode));
log('   shift = ' + JSON.stringify(audit?.shift));
log('   stats = ' + JSON.stringify(audit?.stats));
log('   lateDetails = ' + JSON.stringify(audit?.lateDetails));
log('   graceRemaining = ' + JSON.stringify(audit?.graceRemaining));
const lates = (audit?.attendance || []).filter(r => Number(r.latearrival) > 0 || r.isLate);
log('   attendance rows with late (recomputed) = ' + JSON.stringify(lates.map(r => ({ date: String(r.date).slice(0, 10), latearrival: r.latearrival, isLate: r.isLate, currentShift: r.currentShift, inTime: r.inTime }))));

pool.close();