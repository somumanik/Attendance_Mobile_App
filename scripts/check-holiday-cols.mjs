import 'dotenv/config';
import { getPool } from '../server/db.js';

const pool = await getPool();
const cols = await pool.request().query(`
  SELECT c.name FROM sys.columns c WHERE c.object_id = OBJECT_ID('dbo.HR_Holidays','U') ORDER BY c.column_id
`);
console.log('HR_Holidays columns:', cols.recordset.map(c => c.name).join(', '));
await pool.close();