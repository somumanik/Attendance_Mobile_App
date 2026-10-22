// Savior salary-source DISCOVERY - pass 2 (read-only): payroll-adjacent tables.
import 'dotenv/config';
import { getPool } from '../server/db.js';

const pool = await getPool();
const targets = ['tblgrade', 'tblOTslab', 'tblcanteen', 'tblcanteensetup', 'tblleaveencashment',
  'tblleaveledger', 'tblLeaveLedgermonthly', 'tblleavemaster', 'tblleavepolicy', 'tbldeptwisemaxlimit',
  'tblgroup', 'tbldivision', 'tbldepartment', 'tblcompany', 'tblpayoutinterface', 'payrollinterface'];

async function colsOf(table) {
  const r = await pool.request().input('t', table).query(`
    SELECT c.name AS col, ty.name AS type
    FROM sys.tables t JOIN sys.schemas s ON s.schema_id = t.schema_id
    JOIN sys.columns c ON c.object_id = t.object_id
    JOIN sys.types ty ON ty.user_type_id = c.user_type_id
    WHERE s.name = 'dbo' AND t.name = @t ORDER BY c.column_id`);
  return r.recordset;
}

for (const t of targets) {
  try {
    const cols = await colsOf(t);
    if (!cols.length) { console.log(`${t}: NOT PRESENT`); continue; }
    const count = (await pool.request().query(`SELECT COUNT(1) AS n FROM dbo.${t}`)).recordset[0]?.n;
    console.log(`\n${t} (rows=${count}): ${cols.map((c) => `${c.col}:${c.type}`).join(', ')}`);
    if (count > 0 && /pay|wage|salary|amount|basic|rate|deduct/i.test(cols.map((c) => c.col).join(','))) {
      const safe = cols.filter((c) => !/password|token|secret|email|phone|address|aadhar|pan|bank|account|photo|sign|image/i.test(c.col)).slice(0, 12);
      const r = await pool.request().query(`SELECT TOP 2 ${safe.map((c) => `[${c.col}]`).join(', ')} FROM dbo.${t}`);
      console.log(`  SAMPLE: ${JSON.stringify(r.recordset)}`);
    }
  } catch (e) { console.log(`${t}: ERROR ${String(e.message).slice(0, 80)}`); }
}