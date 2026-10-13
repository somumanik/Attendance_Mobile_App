// Diagnostic: inspect shared badge rules in served CSS (read-only)
const BASE = 'http://localhost:3000';
(async () => {
  const login = await fetch(`${BASE}/api/auth/hr`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: process.env.HR_USERNAME, password: process.env.HR_PASSWORD }),
  });
  const cookie = (login.headers.get('set-cookie') || '').split(';')[0];
  const page = await (await fetch(`${BASE}/hr/audit`, { headers: { Cookie: cookie } })).text();
  const cssHref = (page.match(/\/_next\/static\/css\/[^"]+\.css/) || [])[0];
  const css = await (await fetch(`${BASE}${cssHref}`)).text();
  for (const cls of ['badge--late', 'badge--weekoff', 'badge--present']) {
    const i = css.indexOf(`.${cls}`);
    console.log(`${cls}: ${i >= 0 ? JSON.stringify(css.slice(i, i + 120)) : 'NOT FOUND'}`);
  }
})();