// PHASE 6 — READ-ONLY shift source inspection (focused).
import 'dotenv/config';
import { getPool } from '../server/db.js';
import fs from 'node:fs';

const PAYCODE = (process.argv[2] || 'S00069').trim();
const out = [];
const log = (s) => out.push(s);

try {
  const pool = await getPool();

  log('## tblemployeeshiftmaster columns');
  const c1 = await pool.request().query(`
    SELECT c.name AS columnName, ty.name AS dataType, c.max_length AS maxLength, c.is_nullable AS isNullable, c.column_id
    FROM sys.tables t JOIN sys.columns c ON c.object_id=t.object_id JOIN sys.types ty ON ty.user_type_id=c.user_type_id
    WHERE t.name='tblemployeeshiftmaster' ORDER BY c.column_id`);
  c1.recordset.forEach(r => log(`  ${r.columnName} | ${r.dataType} | max=${r.maxLength} | null=${r.isNullable}`));

  log('\n## tblshiftmaster columns');
  const c2 = await pool.request().query(`
    SELECT c.name AS columnName, ty.name AS dataType, c.max_length AS maxLength
    FROM sys.tables t JOIN sys.columns c ON c.object_id=t.object_id JOIN sys.types ty ON ty.user_type_id=c.user_type_id
    WHERE t.name='tblshiftmaster' ORDER BY c.column_id`);
  c2.recordset.forEach(r => log(`  ${r.columnName} | ${r.dataType} | max=${r.maxLength}`));

  log('\n## tblemployee for ' + PAYCODE);
  const emp = await pool.request().input('paycode', PAYCODE)
    .query(`SELECT LTRIM(RTRIM(paycode)) AS paycode, LTRIM(RTRIM(companycode)) AS companycode, LTRIM(RTRIM(cat)) AS cat, LTRIM(RTRIM(active)) AS active
            FROM dbo.tblemployee WHERE LTRIM(RTRIM(paycode))=@paycode`);
  emp.recordset.forEach(r => log('  ' + JSON.stringify(r)));

  log('\n## tblemployeeshiftmaster for ' + PAYCODE);
  const esm = await pool.request().input('paycode', PAYCODE)
    .query(`SELECT * FROM dbo.tblemployeeshiftmaster WHERE LTRIM(RTRIM(paycode))=@paycode`);
  log('  rows: ' + esm.recordset.length);
  esm.recordset.forEach(r => log('  ' + JSON.stringify(r)));

  log('\n## tblemployeeshiftmaster total rows');
  const cnt = await pool.request().query(`SELECT COUNT(*) AS n FROM dbo.tblemployeeshiftmaster`);
  log('  ' + JSON.stringify(cnt.recordset));

  log('\n## tblshiftmaster rows where shift matches register codes (GEN/OFF/GEM/WK)');
  const sm = await pool.request().query(`
    SELECT LTRIM(RTRIM(shift)) AS shift, LTRIM(RTRIM(companycode)) AS companycode, starttime, endtime
    FROM dbo.tblshiftmaster
    WHERE LTRIM(RTRIM(shift)) IN ('GEN','OFF','GEM','WK','WK_')
    ORDER BY shift, companycode`);
  sm.recordset.forEach(r => log('  ' + JSON.stringify(r)));

  log('\n## tblemployeeshiftmaster distinct shift values + count');
  const ds = await pool.request().query(`
    SELECT LTRIM(RTRIM(shift)) AS shift, COUNT(*) AS cnt FROM dbo.tblemployeeshiftmaster
    GROUP BY LTRIM(RTRIM(shift)) ORDER BY cnt DESC`);
  ds.recordset.forEach(r => log('  ' + JSON.stringify(r)));

  pool.close();
} catch (error) {
  log('DB error: ' + error.message);
  process.exitCode = 1;
}

fs.writeFileSync('scripts/phase6-shift-out.txt', out.join('\n'), 'utf8');
console.log('written scripts/phase6-shift-out.txt');
