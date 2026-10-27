// Savior SQL Server salary-source DISCOVERY (read-only, existing server connection).
// Enumerates actual tables/columns to decide which genuine Savior sources can
// pre-fill the salary template. NEVER writes. Credentials never printed.
import 'dotenv/config';
import { getPool } from '../server/db.js';

const pool = await getPool();
const db = (await pool.request().query('SELECT DB_NAME() AS db')).recordset[0]?.db;
console.log(`DATABASE: ${db}`);

const tables = (await pool.request().query(`
  SELECT t.name AS tableName
  FROM sys.tables t JOIN sys.schemas s ON s.schema_id = t.schema_id
  WHERE s.name = 'dbo'
  ORDER BY t.name`)).recordset.map((r) => r.tableName);
console.log(`TABLES (${tables.length}): ${tables.join(', ')}`);

const interesting = tables.filter((t) => /salary|pay|wage|element|allow|deduc|pf|esi|payroll/i.test(t));
console.log(`\nPAYROLL-CANDIDATE TABLES: ${interesting.join(', ') || '(none)'}`);

async function colsOf(table) {
  const r = await pool.request().input('t', table).query(`
    SELECT c.name AS col, ty.name AS type, c.max_length AS len
    FROM sys.tables t JOIN sys.schemas s ON s.schema_id = t.schema_id
    JOIN sys.columns c ON c.object_id = t.object_id
    JOIN sys.types ty ON ty.user_type_id = c.user_type_id
    WHERE s.name = 'dbo' AND t.name = @t ORDER BY c.column_id`);
  return r.recordset;
}

for (const t of ['tblemployee', 'tblcategory', ...interesting]) {
  if (!tables.includes(t)) { console.log(`\n${t}: NOT PRESENT`); continue; }
  const cols = await colsOf(t);
  const count = (await pool.request().query(`SELECT COUNT(1) AS n FROM dbo.${t}`)).recordset[0]?.n;
  console.log(`\n${t} (rows=${count}):`);
  console.log('  ' + cols.map((c) => `${c.col}:${c.type}`).join(', '));
}

// Sample rows from any genuine payroll candidate (first 2 rows, key columns only)
for (const t of interesting) {
  const cols = (await colsOf(t)).map((c) => c.col);
  const safe = cols.filter((c) => !/password|token|secret|email|phone|mobile|address|aadhar|pan|bank|account/i.test(c)).slice(0, 14);
  if (!safe.length) continue;
  const r = await pool.request().query(`SELECT TOP 2 ${safe.map((c) => `[${c}]`).join(', ')} FROM dbo.${t}`);
  console.log(`\nSAMPLE ${t}: ${JSON.stringify(r.recordset)}`);
}