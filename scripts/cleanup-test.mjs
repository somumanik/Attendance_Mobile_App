import 'dotenv/config';
import { getPool, sql } from '../server/db.js';

const pool = await getPool();
await pool.request().query("DELETE FROM dbo.HR_Holidays WHERE holidayname = 'Test Holiday'");
await pool.request().query("DELETE FROM dbo.HR_Holidays WHERE holidayname = 'Test'");
await pool.request().query("DELETE FROM dbo.HR_Holidays WHERE holidayname = 'Test2'");
console.log('Cleaned up test holidays');
pool.close();