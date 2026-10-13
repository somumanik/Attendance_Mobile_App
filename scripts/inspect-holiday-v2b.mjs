// Read-only inspection for Phase G Revision (Holiday Management V2) - compact output.
import 'dotenv/config';
import { getPool } from '../server/db.js';

const pool = await getPool();

async function show(label, query) {
  try {
    const r = await pool.request().query(query);
    console.log(`\n=== ${label} ===`);
    console.log(JSON.stringify(r.recordset));
  } catch (e) {
    console.log(`\n=== ${label} === ERROR: ${e.message}`);
  }
}

await show('tblcategory', 'SELECT * FROM dbo.tblcategory');
await show('cat usage', `SELECT LTRIM(RTRIM(cat)) AS cat, COUNT(*) AS cnt FROM dbo.tblemployee GROUP BY LTRIM(RTRIM(cat)) ORDER BY 1`);
await show('tblcompany', 'SELECT * FROM dbo.tblcompany');
await show('HR_Holidays', `
  SELECT id, CONVERT(varchar(10), holidaydate, 120) AS holidaydate, holidayname, category, categoryIds,
         companycode, companyCodes, duration, halfDaySession, active
  FROM dbo.HR_Holidays ORDER BY holidaydate, id`);
await show('emp cat x company', `
  SELECT LTRIM(RTRIM(cat)) AS cat, LTRIM(RTRIM(companycode)) AS companycode, COUNT(*) AS cnt
  FROM dbo.tblemployee GROUP BY LTRIM(RTRIM(cat)), LTRIM(RTRIM(companycode)) ORDER BY 1, 2`);

await pool.close();
