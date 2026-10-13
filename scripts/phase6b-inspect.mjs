// PHASE 6.1 — live DB recheck (READ-ONLY). Focus: duplicates/ambiguity + S00069.
import 'dotenv/config';
import { getPool } from '../server/db.js';
import fs from 'node:fs';

const out = [];
const log = (s = '') => out.push(String(s));
const pool = await getPool();

log('## tblemployeeshiftmaster indexes (PK/unique)');
const idx = await pool.request().query(`
  SELECT i.name AS indexName, i.is_primary_key AS pk, i.is_unique AS uniq,
         c.name AS col
  FROM sys.indexes i
  JOIN sys.index_columns ic ON ic.object_id = i.object_id AND ic.index_id = i.index_id
  JOIN sys.columns c ON c.object_id = ic.object_id AND c.column_id = ic.column_id
  WHERE i.object_id = OBJECT_ID('dbo.tblemployeeshiftmaster') AND i.name IS NOT NULL
  ORDER BY i.index_id, ic.key_ordinal`);
idx.recordset.forEach(r => log(`  ${r.indexName} pk=${r.pk} uniq=${r.uniq} col=${r.col}`));

log('\n## duplicate paycode rows in tblemployeeshiftmaster (paycode with >1 row)');
const dup = await pool.request().query(`
  SELECT LTRIM(RTRIM(paycode)) AS paycode, COUNT(*) AS n
  FROM dbo.tblemployeeshiftmaster GROUP BY LTRIM(RTRIM(paycode)) HAVING COUNT(*) > 1`);
log('  dup paycodes: ' + (dup.recordset.length ? JSON.stringify(dup.recordset) : 'NONE'));

log('\n## S00069 mapping rows');
const s = await pool.request().input('p', 'S00069').query(`
  SELECT LTRIM(RTRIM(paycode)) AS paycode, LTRIM(RTRIM(cardno)) AS cardno,
         LTRIM(RTRIM(shift)) AS shift, LTRIM(RTRIM(shifttype)) AS shifttype, shiftremaindays
  FROM dbo.tblemployeeshiftmaster WHERE LTRIM(RTRIM(paycode)) = @p`);
s.recordset.forEach(r => log('  ' + JSON.stringify(r)));

log('\n## S00069 employee row');
const e = await pool.request().input('p', 'S00069').query(`
  SELECT LTRIM(RTRIM(paycode)) AS paycode, LTRIM(RTRIM(empname)) AS empname,
         LTRIM(RTRIM(companycode)) AS companycode, LTRIM(RTRIM(cat)) AS cat, LTRIM(RTRIM(active)) AS active
  FROM dbo.tblemployee WHERE LTRIM(RTRIM(paycode)) = @p`);
e.recordset.forEach(r => log('  ' + JSON.stringify(r)));

log('\n## tblshiftmaster rows for shift GEM');
const g = await pool.request().query(`
  SELECT LTRIM(RTRIM(shift)) AS shift, LTRIM(RTRIM(companycode)) AS companycode, starttime, endtime
  FROM dbo.tblshiftmaster WHERE LTRIM(RTRIM(shift)) = 'GEM'`);
g.recordset.forEach(r => log('  ' + JSON.stringify(r)));

log('\n## shift master row counts per shift code (to see multi-company shifts)');
const sm = await pool.request().query(`
  SELECT LTRIM(RTRIM(shift)) AS shift, COUNT(*) AS n FROM dbo.tblshiftmaster GROUP BY LTRIM(RTRIM(shift)) ORDER BY n DESC`);
sm.recordset.forEach(r => log('  ' + JSON.stringify(r)));

log('\n## distinct company codes in tblshiftmaster');
const cc = await pool.request().query(`
  SELECT DISTINCT LTRIM(RTRIM(companycode)) AS companycode FROM dbo.tblshiftmaster`);
log('  ' + JSON.stringify(cc.recordset.map(r => r.companycode)));

log('\n## sample employees with different shifts (non-GEN)');
const diff = await pool.request().query(`
  SELECT TOP 15 LTRIM(RTRIM(e.paycode)) AS paycode, LTRIM(RTRIM(e.companycode)) AS companycode,
         LTRIM(RTRIM(s.shift)) AS shift
  FROM dbo.tblemployee e
  JOIN dbo.tblemployeeshiftmaster s ON LTRIM(RTRIM(s.paycode)) = LTRIM(RTRIM(e.paycode))
  WHERE LTRIM(RTRIM(s.shift)) <> 'GEN' AND LTRIM(RTRIM(e.active)) = 'Y'
  ORDER BY s.shift, e.paycode`);
diff.recordset.forEach(r => log('  ' + JSON.stringify(r)));

await pool.close();
fs.writeFileSync('scripts/phase6b-out.txt', out.join('\n'), 'utf8');
console.log(out.join('\n'));
