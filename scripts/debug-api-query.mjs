import 'dotenv/config';
import { getPool, sql } from '../server/db.js';

const pool = await getPool();

// Test the exact query with parameters
const companyCode = '001';
const groups = ['Factory Staff', 'All Employees'];
const categoryConditions = groups.map((_, i) => `@g${i}`).join(', ');

const request = pool.request()
  .input('g0', sql.NVarChar(50), 'Factory Staff')
  .input('g1', sql.NVarChar(50), 'All Employees')
  .input('companyCode', sql.VarChar(50), '001')
  .input('monthStart', sql.Date, '2026-10-01')
  .input('monthEnd', sql.Date, '2026-10-31');

const result = await request.query(`
  SELECT h.id, h.holidayname, h.category, h.companycode, h.companyCodes, h.categoryIds
  FROM dbo.HR_Holidays h
  WHERE h.active = 1
    AND h.holidaydate >= @monthStart AND h.holidaydate <= @monthEnd
    AND (
      (ISNULL(h.categoryIds, '[]') = '[]' AND LTRIM(RTRIM(h.category)) IN ('Factory Staff', 'All Employees'))
      OR h.category IN (SELECT value FROM OPENJSON(ISNULL(h.categoryIds, '[]')))
    )
    AND (
      (ISNULL(h.companyCodes, '[]') = '[]' 
        AND (h.companycode IS NULL OR @companyCode IN (SELECT value FROM OPENJSON('["' + REPLACE(LTRIM(RTRIM(ISNULL(h.companycode, ''))), ',', '","') + '"]'))))
      OR @companyCode IN (SELECT value FROM OPENJSON(ISNULL(h.companyCodes, '[]')))
    )
    AND h.active = 1
`);
console.log('Result:', JSON.stringify(r.recordset, null, 2));
pool.close();