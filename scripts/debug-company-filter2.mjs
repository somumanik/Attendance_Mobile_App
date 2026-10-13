import 'dotenv/config';
import { getPool, sql } from '../server/db.js';

const pool = await getPool();

const r = await pool.request().query(`
  SELECT h.id, h.holidayname, h.category, h.companycode, h.companyCodes
  FROM dbo.HR_Holidays h
  WHERE h.active = 1
    AND (
      (ISNULL(h.companyCodes, '[]') = '[]' 
        AND (h.companycode IS NULL OR '001' IN (SELECT value FROM OPENJSON('["' + REPLACE(LTRIM(RTRIM(ISNULL(h.companycode, ''))), ',', '","') + '"]'))))
      OR '001' IN (SELECT value FROM OPENJSON(ISNULL(h.companyCodes, '[]')))
    )
`);
console.log('Holidays matching company 001:', JSON.stringify(r.recordset, null, 2));

const r2 = await pool.request().query(`
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
console.log('Holidays matching category and company:', JSON.stringify(r2.recordset, null, 2));

pool.close();