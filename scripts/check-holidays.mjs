import 'dotenv/config';
import { getPool, sql } from '../server/db.js';

const pool = await getPool();
const r = await pool.request().query(`
  SELECT h.id, h.holidaydate, h.holidayname, h.category, h.companyCodes, h.categoryIds, h.duration, h.halfDaySession, h.active
  FROM dbo.HR_Holidays h
  WHERE h.active = 1
`);
console.log('All active holidays:', JSON.stringify(r.recordset, null, 2));
pool.close();