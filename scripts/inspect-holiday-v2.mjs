// Read-only inspection for Phase G Revision (Holiday Management V2).
// Touches ONLY application tables + READS of Savior masters. Never writes.
import 'dotenv/config';
import { getPool } from '../server/db.js';

const pool = await getPool();

async function show(label, query) {
  try {
    const r = await pool.request().query(query);
    console.log(`\n=== ${label} ===`);
    console.log(JSON.stringify(r.recordset, null, 2));
  } catch (e) {
    console.log(`\n=== ${label} === ERROR: ${e.message}`);
  }
}

// 1. Real Savior category master (code -> name)
await show('dbo.tblcategory (all)', 'SELECT * FROM dbo.tblcategory');

// 2. Real employee category codes in use + counts + company spread
await show('tblemployee cat usage', `
  SELECT LTRIM(RTRIM(cat)) AS cat, COUNT(*) AS cnt
  FROM dbo.tblemployee GROUP BY LTRIM(RTRIM(cat)) ORDER BY LTRIM(RTRIM(cat))`);

// 3. Real companies
await show('dbo.tblcompany', 'SELECT * FROM dbo.tblcompany');

// 4. Existing application holiday tables
await show('HR_Holidays (all rows)', `
  SELECT id, holidaydate, holidayname, category, categoryIds, description,
         companycode, companyCodes, duration, halfDaySession, active, createdby
  FROM dbo.HR_Holidays ORDER BY holidaydate, id`);

await show('HR_HolidayCategories', 'SELECT * FROM dbo.HR_HolidayCategories');
await show('HR_HolidayCategoryMap', 'SELECT * FROM dbo.HR_HolidayCategoryMap');

// 5. Constraints on HR_Holidays (application table - safe to change)
await show('HR_Holidays constraints', `
  SELECT kc.name AS constraint_name, COL_NAME(ic.object_id, ic.column_id) AS column_name,
         ic.key_ordinal, i.is_unique
  FROM sys.index_columns ic
  JOIN sys.indexes i ON i.object_id = ic.object_id AND i.index_id = ic.index_id
  LEFT JOIN sys.key_constraints kc ON kc.parent_object_id = ic.object_id AND kc.unique_index_id = ic.index_id
  WHERE ic.object_id = OBJECT_ID('dbo.HR_Holidays') AND i.is_primary_key = 0
  ORDER BY i.name, ic.key_ordinal`);

await show('HR_Holidays columns', `
  SELECT c.name, t.name AS type, c.max_length, c.is_nullable, dc.definition AS default_def
  FROM sys.columns c
  JOIN sys.types t ON t.user_type_id = c.user_type_id
  LEFT JOIN sys.default_constraints dc ON dc.object_id = c.default_object_id
  WHERE c.object_id = OBJECT_ID('dbo.HR_Holidays')
  ORDER BY c.column_id`);

// 6. Sample employees per real category (names/companies for manual testing)
await show('sample employees per cat', `
  SELECT TOP 40 LTRIM(RTRIM(e.paycode)) AS paycode, e.empname,
         LTRIM(RTRIM(e.cat)) AS cat, LTRIM(RTRIM(e.companycode)) AS companycode, e.active
  FROM dbo.tblemployee e
  ORDER BY LTRIM(RTRIM(e.cat)), LTRIM(RTRIM(e.companycode)), e.paycode`);

await pool.close();
