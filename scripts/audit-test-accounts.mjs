// scripts/audit-test-accounts.mjs — report any HR Admin / SuperAdmin accounts
// that look like verification-script artifacts (RPT* / MRP* / SAREP*). Read-only.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
try {
  const envText = fs.readFileSync(path.join(ROOT, '.env'), 'utf8');
  for (const line of envText.split(/\r?\n/)) {
    const m = /^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/.exec(line);
    if (m && process.env[m[1]] === undefined) process.env[m[1]] = m[2].trim();
  }
} catch { /* rely on process env */ }

import { getPool } from '../server/db.js';
import { ensureAdminAccessTables } from '../server/admin-access.js';

const pool = await getPool();
await ensureAdminAccessTables(pool);
const hr = await pool.request().query("SELECT username, displayname, isactive, isbootstrap, createdat FROM dbo.HR_AdminUser WHERE username LIKE 'RPT%' OR username LIKE 'MRP%' ORDER BY username");
const sa = await pool.request().query("SELECT username, displayname, isactive, createdat FROM dbo.HR_SuperAdminUser WHERE username LIKE 'SAREP%' ORDER BY username");
console.log('HR_AdminUser (test-looking):', JSON.stringify(hr.recordset, null, 2));
console.log('HR_SuperAdminUser (test-looking):', JSON.stringify(sa.recordset, null, 2));
process.exit(0);
