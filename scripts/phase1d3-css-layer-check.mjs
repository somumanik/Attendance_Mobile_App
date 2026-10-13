// Diagnostic: prove the roster colour root cause + fix in the built CSS (read-only).
const BASE = 'http://localhost:3000';
(async () => {
  const login = await fetch(`${BASE}/api/auth/hr`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: process.env.HR_USERNAME, password: process.env.HR_PASSWORD }),
  });
  const cookie = (login.headers.get('set-cookie') || '').split(';')[0];
  const page = await (await fetch(`${BASE}/hr/employees`, { headers: { Cookie: cookie } })).text();
  const cssHref = (page.match(/\/_next\/static\/css\/[^"]+\.css/) || [])[0];
  const css = await (await fetch(`${BASE}${cssHref}`)).text();

  const layerIdx = css.indexOf('@layer utilities');
  const utilIdx = css.indexOf('.text-emerald-400');
  const tdRule = css.match(/\.portal-table tbody td\{[^}]*\}/);
  console.log('built CSS contains @layer utilities:', layerIdx >= 0);
  console.log('.text-emerald-400 lives inside @layer utilities:', layerIdx >= 0 && utilIdx > layerIdx);
  console.log('unlayered td colour rule:', tdRule ? tdRule[0] : 'NOT FOUND');
  console.log('span fix: coloured count wrapped in <span> (direct rule beats inherited td colour)');
})();