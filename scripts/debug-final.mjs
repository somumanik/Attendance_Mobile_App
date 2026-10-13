import 'dotenv/config';
import { getPool, sql } from '../server/db.js';

const pool = await getPool();

// Test the exact query being used by the API
const companyCode = '001';
const groups = ['Factory Staff', 'All Employees'];
const categoryConditions = ['Factory Staff', 'All Employees'].map((_, i) => `@g${i}`).join(', ');
const g0 = 'Factory Staff';
const g1 = 'All Employees';

const r = await pool.request()
  .input('g0', sql.NVarChar(50), g0)
  .input('g1', sql.NVarChar(50), g1)
  .input('companyCode', sql.VarChar(50), '001')
  .query(`
    SELECT h.id, h.holidayname, h.category, h.companycode, h.companyCodes, h.categoryIds
    FROM dbo.HR_Holidays h
    WHERE h.active = 1
      AND (
        (ISNULL(h.categoryIds, '[]') = '[]' AND LTRIM(RTRIM(h.category)) IN ('Factory Staff', 'All Employees'))
        OR h.category IN (SELECT value FROM OPENJSON(ISNULL(h.categoryIds, '[]')))
      )
      AND (
        (ISNULL(h.companyCodes, '[]') = '[]' 
          AND (h.companycode IS NULL OR '001' IN (SELECT value FROM OPENJSON('["' + REPLACE(LTRIM(RTRIM(ISNULL(h.companycode, ''))), ',', '","') + '"]'))))
        OR '001' IN (SELECT value FROM OPENJSON(ISNULL(h.companyCodes, '[]')))
      )
      AND h.active = 1
  `);
console.log('Result:', JSON.stringify(r.recordset, null, 2));