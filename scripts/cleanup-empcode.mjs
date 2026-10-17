// One-off test cleanup: remove Employee Code mapping rows created by the
// Employee Code verification (codes use the distinctive "ECA-" test prefix).
// This only touches the application-owned HR_EmployeeCodeMapping table.
import 'dotenv/config';
import { getPool, sql } from '../server/db.js';

const pool = await getPool();
const r = await pool.request()
  .input('prefix', sql.NVarChar(50), 'ECA-%')
  .query(`DELETE FROM dbo.HR_EmployeeCodeMapping WHERE LTRIM(RTRIM(employeecode)) LIKE @prefix`);
console.log('deleted test EmployeeCode mapping rows:', r.rowsAffected?.[0] ?? 0);
process.exit(0);