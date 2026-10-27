// scripts/dump-salary-config.mjs — print the saved HR_SalaryConfig rows (read-only).
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
for (const line of fs.readFileSync(path.join(ROOT, '.env'), 'utf8').split(/\r?\n/)) {
  const m = /^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/.exec(line);
  if (m && process.env[m[1]] === undefined) process.env[m[1]] = m[2].trim();
}

const { getPool } = await import('../server/db.js');
const pool = await getPool();
const r = await pool.request().query('SELECT LTRIM(RTRIM(configkey)) AS configkey, configvalue FROM dbo.HR_SalaryConfig ORDER BY configkey');
for (const row of r.recordset || []) {
  console.log(`${row.configkey} = ${JSON.stringify(row.configvalue)}`);
}
process.exit(0);
