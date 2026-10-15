// Runtime UI-verification: confirms the Next.js pages actually RENDER the new
// authentication surfaces (not just that files exist). Uses real HTTP + cookies.
const fs = require('fs');
const path = require('path');
const root = 'E:/Attendance_Web_App/Attendence_Mobile_App - Copy/Attendenc_New_Perfect_Mobile';
const env = {};
fs.readFileSync(path.join(root, '.env'), 'utf8').split(/\r?\n/).forEach((line) => {
  const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
  if (m && !m[1].startsWith('#')) env[m[1]] = m[2].replace(/^["']|["']$/g, '');
});
const WEBSITE = 'http://localhost:3000';

function cookieValue(setCookie) {
  if (!setCookie) return null;
  const m = String(setCookie).match(/auth_token=([^;]+)/);
  return m ? m[1] : null;
}

async function get(path, cookie) {
  const headers = { Accept: 'text/html' };
  if (cookie) headers.Cookie = 'auth_token=' + cookie;
  const res = await fetch(WEBSITE + path, { headers, redirect: 'manual' });
  const text = await res.text();
  return { status: res.status, text };
}

(async () => {
  // 1) Login as HR via Next route handler -> get auth cookie.
  const login = await fetch(WEBSITE + '/api/auth/hr', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: env.HR_USERNAME, password: env.HR_PASSWORD }),
  });
  const hrCookie = cookieValue(login.headers.get('set-cookie'));
  console.log('HR login (Next) status:', login.status, 'cookie set:', !!hrCookie);

  // 2) /hr renders nav with "Credentials" entry.
  const hrPage = await get('/hr', hrCookie);
  console.log('/hr status:', hrPage.status, '| nav has Credentials link:', hrPage.text.includes('href="/hr/credentials"'));

  // 3) /hr/credentials renders the credential-management UI.
  const credPage = await get('/hr/credentials', hrCookie);
  const markers = ['Employee Credential Management', 'Find Employee', 'Paycode / Employee Name', 'Employee select karein'];
  console.log('/hr/credentials status:', credPage.status);
  markers.forEach((m) => console.log('  contains "' + m + '":', credPage.text.includes(m)));

  // 4) /login/employee renders PIN toggle + forgot link.
  const loginPage = await get('/login/employee');
  console.log('/login/employee status:', loginPage.status);
  console.log('  PIN toggle present:', loginPage.text.includes('Login with 4-digit PIN'));
  console.log('  Forgot password link present:', loginPage.text.includes('/login/employee/forgot'));

  // 5) forgot / reset / setup pages render.
  for (const p of ['/login/employee/forgot', '/login/employee/reset', '/login/employee/setup']) {
    const r = await get(p);
    console.log(p, 'status:', r.status);
  }

  // 6) Employee login (dev) then check /employee/password & /employee/pin render (forced gates off -> voluntary).
  if (String(env.DEV_EMPLOYEE_AUTH_ENABLED || '').toLowerCase() === 'true') {
    const empLogin = await fetch(WEBSITE + '/api/auth/employee', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ paycode: env.DEV_EMPLOYEE_PAYCODE, password: env.DEV_EMPLOYEE_PASSWORD }),
    });
    const empCookie = cookieValue(empLogin.headers.get('set-cookie'));
    console.log('Employee login (Next) status:', empLogin.status, 'cookie set:', !!empCookie);
    const pwPage = await get('/employee/password', empCookie);
    console.log('/employee/password status:', pwPage.status, '| has "Change Password":', pwPage.text.includes('Change Password'));
    const pinPage = await get('/employee/pin', empCookie);
    console.log('/employee/pin status:', pinPage.status, '| has PIN UI:', pinPage.text.includes('4-Digit PIN'));
  }
})();
