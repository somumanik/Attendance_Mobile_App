import 'dotenv/config';
import { getPool, sql } from '../server/db.js';

const pool = await getPool();

try {
  // Drop the old unique constraint
  await pool.request().query(`
    IF EXISTS (SELECT 1 FROM sys.key_constraints WHERE name = 'UQ_HRHoliday_DateCategory' AND parent_object_id = OBJECT_ID('dbo.HR_Holidays'))
    ALTER TABLE dbo.HR_Holidays DROP CONSTRAINT UQ_HRHoliday_DateCategory
  `);
  console.log('Dropped old unique constraint');
} catch (e) {
  console.log('Could not drop old constraint:', e.message);
}

try {
  // Add new unique constraint including companyCodes and categoryIds
  await pool.request().query(`
    ALTER TABLE dbo.HR_Holidays
    ADD CONSTRAINT UQ_HRHoliday_DateCategory_Companies_Categories UNIQUE (holidaydate, category, companyCodes, categoryIds)
  `);
  console.log('Added new unique constraint');
} catch (e) {
  console.error('Could not add new constraint:', e.message);
}

// Verify
const constraints = await pool.request().query(`
  SELECT name FROM sys.key_constraints WHERE parent_object_id = OBJECT_ID('dbo.HR_Holidays')
`);
console.log('Current constraints:', constraints.recordset.map(r => r.name).join(', '));

await pool.close();