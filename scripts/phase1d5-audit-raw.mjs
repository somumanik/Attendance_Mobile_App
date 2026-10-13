// Diagnostic: raw audit response + error log inspection aid (read-only)
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
  for (const pc of ['0341', '0328']) {
    const res = await fetch(`${BASE}/api/hr/audit/${pc}?month=${month}`, { headers: { Cookie: cookie } });
    const text = await res.text();
    console.log(`${pc}: status=${res.status} bodyHead=${text.slice(0, 220)}`);
  }
})();