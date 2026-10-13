import 'dotenv/config';
import { getPool, sql } from '../server/db.js';

const pool = await getPool();

// Check current constraints
const constraints = await pool.request().query(`
  SELECT name FROM sys.key_constraints WHERE parent_object_id = OBJECT_ID('dbo.HR_Holidays')
`);
console.log('Current constraints:', constraints.recordset.map(r => r.name).join(', '));

// Check if there's data that would violate the new constraint
const check = await pool.request().query(`
  SELECT holidaydate, category, ISNULL(companyCodes, '[]') as cc, ISNULL(categoryIds, '[]') as cid, COUNT(*) as cnt
  FROM dbo.HR_Holidays
  GROUP BY holidaydate, category, companyCodes, categoryIds
  HAVING COUNT(*) > 1
`);
console.log('Conflicts:', JSON.stringify(check.recordset, null, 2));

await pool.close();