// Diagnostic: verify real IN/OUT values flow for an employee with punches (read-only)
import 'dotenv/config';
const BASE = 'http://localhost:3000';
(async () => {
  const login = await fetch(`${BASE}/api/auth/hr`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: process.env.HR_USERNAME, password: process.env.HR_PASSWORD }),
  });
  const cookie = (login.headers.get('set-cookie') || '').split(';')[0];
  const month = new Date().toISOString().slice(0, 7);
  for (const pc of ['0341', 'W00399']) {
    const audit = await (await fetch(`${BASE}/api/hr/audit/${pc}?month=${month}`, { headers: { Cookie: cookie } })).json();
    const rows = (audit.attendance || []).filter((r) => r.inTime || r.outTime);
    const sample = rows.slice(0, 3).map((r) => ({ date: r.date, inTime: r.inTime, outTime: r.outTime, st: r.computedStatus }));
    console.log(`${pc}: rows with punches=${rows.length}/${(audit.attendance || []).length} sample=${JSON.stringify(sample)}`);
  }
})();