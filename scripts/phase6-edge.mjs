// PHASE 6 — edge-case probe (READ-ONLY): kya koi aisa employee hai jiska shift
// mapping ho lekin tblshiftmaster me timing na ho, aur kitne employee bina mapping hain.
import 'dotenv/config';
import { getPool } from '../server/db.js';

const pool = await getPool();
const noMaster = await pool.request().query(`
  SELECT TOP 5 LTRIM(RTRIM(e.paycode)) AS paycode, LTRIM(RTRIM(s.shift)) AS shift
  FROM dbo.tblemployee e
  JOIN dbo.tblemployeeshiftmaster s ON LTRIM(RTRIM(s.paycode)) = LTRIM(RTRIM(e.paycode))
  WHERE NOT EXISTS (SELECT 1 FROM dbo.tblshiftmaster m WHERE LTRIM(RTRIM(m.shift)) = LTRIM(RTRIM(s.shift)))`);
const noMapping = await pool.request().query(`
  SELECT COUNT(*) AS n FROM dbo.tblemployee e
  WHERE NOT EXISTS (SELECT 1 FROM dbo.tblemployeeshiftmaster s WHERE LTRIM(RTRIM(s.paycode)) = LTRIM(RTRIM(e.paycode)))`);
console.log('shift_in_mapping_but_not_in_master = ' + JSON.stringify(noMaster.recordset));
console.log('employees_without_mapping = ' + JSON.stringify(noMapping.recordset));
await pool.close();
