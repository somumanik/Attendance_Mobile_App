import 'dotenv/config';
import { getPool } from '../server/db.js';

const pool = await getPool();
const rows = await pool.request().query('SELECT TOP 5 * FROM dbo.HR_Holidays ORDER BY id DESC');
console.log(JSON.stringify(rows.recordset, null, 2));
pool.close();