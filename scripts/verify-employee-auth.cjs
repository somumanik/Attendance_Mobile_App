// Phase N2 read-only validation — NO credential changes, NO sends.
// Reads server .env, prints ONLY status codes + safe fields (never passwords/keys).
const fs = require('fs');
const path = require('path');
const root = 'E:/Attendance_Web_App/Attendence_Mobile_App - Copy/Attendenc_New_Perfect_Mobile';
const env = {};
fs.readFileSync(path.join(root, '.env'), 'utf8').split(/\r?\n/).forEach((line) => {
  const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
  if (m && !m[1].startsWith('#')) env[m[1]] = m[2].replace(/^["']|["']$/g, '');
});
const base = 'http://localhost:' + (env.API_PORT || '4000');

async function req(method, p, body, token, host) {
  const headers = { Accept: 'application/json' };
  if (token) headers.Authorization = 'Bearer ' + token;
  if (body) headers['Content-Type'] = 'application/json';
  const res = await fetch((host || base) + p, { method, headers, body: body ? JSON.stringify(body) : undefined });
  let data = null; try { data = await res.json(); } catch {}
  return { status: res.status, data, setCookie: res.headers.get('set-cookie') };
}

(async () => {
  // --- HR login (for HR credential-management access test) ---
  const hrLogin = await req('POST', '/api/auth/hr/login', { username: env.HR_USERNAME, password: env.HR_PASSWORD });
  console.log('HR LOGIN', hrLogin.status, 'role:', hrLogin.data?.role);
  const hrToken = hrLogin.data?.token;

  // Sample employee for HR credential status (read-only)
  let samplePaycode = null;
  if (hrToken) {
    const emps = await req('GET', '/api/hr/employees?page=1&pageSize=1', null, hrToken);
    samplePaycode = (emps.data?.rows || [])[0]?.paycode || null;
    console.log('HR EMPLOYEES', emps.status, 'sample paycode:', samplePaycode);
    if (samplePaycode) {
      const cred = await req('GET', '/api/hr/employee/credentials?paycode=' + encodeURIComponent(samplePaycode), null, hrToken);
      console.log('HR CREDENTIALS', cred.status, cred.data?.ok === true ? 'ok' : cred.data?.message,
        'passwordSet:', cred.data?.passwordSet, 'pinSet:', cred.data?.pinSet, 'loginEnabled:', cred.data?.loginEnabled, 'mustChangePassword:', cred.data?.mustChangePassword, 'pinSetupRequired:', cred.data?.pinSetupRequired);
    }
  }

  // --- Employee login (password) via BACKEND + data isolation ---
  const devEnabled = String(env.DEV_EMPLOYEE_AUTH_ENABLED || '').toLowerCase() === 'true';
  console.log('DEV_EMPLOYEE_AUTH_ENABLED:', devEnabled);

  if (devEnabled) {
    const devPaycode = env.DEV_EMPLOYEE_PAYCODE;
    const devPw = env.DEV_EMPLOYEE_PASSWORD;
    const okLogin = await req('POST', '/api/auth/employee/login', { paycode: devPaycode, password: devPw });
    console.log('EMP PASSWORD LOGIN', okLogin.status, 'role:', okLogin.data?.role, 'mustChangePassword:', okLogin.data?.mustChangePassword, 'pinSetupRequired:', okLogin.data?.pinSetupRequired);
    const empToken = okLogin.data?.token;
    if (empToken) {
      const me = await req('GET', '/api/me', null, empToken);
      console.log('EMP /api/me', me.status, 'role:', me.data?.role, 'paycode:', me.data?.employee?.paycode);

      // Data isolation: employee profile comes ONLY from the verified JWT.
      const profile = await req('GET', '/api/employee/profile', null, empToken);
      console.log('EMP PROFILE (self)', profile.status, 'paycode:', profile.data?.profile?.paycode);

      // Attempt to "spoof" another paycode via query — employee routes ignore it.
      const spoof = await req('GET', '/api/employee/profile?paycode=999999', null, empToken);
      console.log('EMP PROFILE (spoofed paycode in query)', spoof.status, 'paycode still:', spoof.data?.profile?.paycode);

      // Wrong password rejected
      const wrongPw = await req('POST', '/api/auth/employee/login', { paycode: devPaycode, password: 'definitely-wrong-123' });
      console.log('EMP WRONG PASSWORD', wrongPw.status, 'message:', wrongPw.data?.message);

      // Wrong PIN rejected (dev employee has no credential row -> expect reject)
      const wrongPin = await req('POST', '/api/auth/employee/login', { paycode: devPaycode, pin: '0000', credential: 'pin' });
      console.log('EMP WRONG PIN', wrongPin.status, 'message:', wrongPin.data?.message);
    }
  } else {
    // Dev employee disabled — still verify endpoints reject without a valid token.
    const noAuth = await req('GET', '/api/employee/profile');
    console.log('EMP PROFILE (no token)', noAuth.status, noAuth.data?.message);
    const badLogin = await req('POST', '/api/auth/employee/login', { paycode: 'NOPE', password: 'x'.repeat(10) });
    console.log('EMP BAD LOGIN (nonexistent)', badLogin.status, 'code:', badLogin.data?.code, 'firstTimeSetupRequired:', badLogin.data?.firstTimeSetupRequired);
  }

  // --- Next proxy: employee login route handler (port 3000) ---
  const next = 'http://localhost:3000';
  const nextLogin = await req('POST', '/api/auth/employee', { paycode: 'ANY', password: 'x'.repeat(10) }, null, next);
  console.log('NEXT /api/auth/employee (invalid creds)', nextLogin.status, 'message:', nextLogin.data?.message);
})();
