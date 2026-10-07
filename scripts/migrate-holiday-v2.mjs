import 'dotenv/config';
import { getPool, sql } from '../server/db.js';

const pool = await getPool();

const statements = [
  "IF NOT EXISTS (SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID('dbo.HR_Holidays','U') AND name = 'categoryIds') ALTER TABLE dbo.HR_Holidays ADD categoryIds NVARCHAR(MAX) NULL",
  "IF NOT EXISTS (SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID('dbo.HR_Holidays','U') AND name = 'companyCodes') ALTER TABLE dbo.HR_Holidays ADD companyCodes NVARCHAR(MAX) NULL",
  "IF NOT EXISTS (SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID('dbo.HR_Holidays','U') AND name = 'duration') ALTER TABLE dbo.HR_Holidays ADD duration NVARCHAR(20) NOT NULL CONSTRAINT DF_HRHoliday_Duration DEFAULT('FULL_DAY')",
  "IF NOT EXISTS (SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID('dbo.HR_Holidays','U') AND name = 'halfDaySession') ALTER TABLE dbo.HR_Holidays ADD halfDaySession NVARCHAR(20) NULL",
  // Phase G Revision: explicit applicability scope. NULL = legacy row; the
  // server's ensureHolidayTable() normalizes those automatically on first boot
  // (normalizeHolidayScopes), so no holiday record is ever lost or rewritten
  // after that point.
  "IF NOT EXISTS (SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID('dbo.HR_Holidays','U') AND name = 'allCompanies') ALTER TABLE dbo.HR_Holidays ADD allCompanies BIT NULL",
  "IF NOT EXISTS (SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID('dbo.HR_Holidays','U') AND name = 'allCategories') ALTER TABLE dbo.HR_Holidays ADD allCategories BIT NULL",
  "IF NOT EXISTS (SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID('dbo.HR_Holidays','U') AND name = 'categoryNames') ALTER TABLE dbo.HR_Holidays ADD categoryNames NVARCHAR(MAX) NULL",
];

for (const stmt of statements) {
  try {
    await pool.request().query(stmt);
    console.log('Executed:', stmt.substring(0, 80) + '...');
  } catch (e) {
    console.error('Error:', e.message);
  }
}

const cols = await pool.request().query(`
  SELECT c.name FROM sys.columns c WHERE c.object_id = OBJECT_ID('dbo.HR_Holidays','U') ORDER BY c.column_id
`);
console.log('HR_Holidays columns:', cols.recordset.map(c => c.name).join(', '));

await pool.close();