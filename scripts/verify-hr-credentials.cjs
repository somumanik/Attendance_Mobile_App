// Phase AUTH-WEB-1 validation — READ-ONLY (no credential mutations on real employees).
// Verifies HR credential endpoints exist, enforce HR role, and reject non-HR/no-token.
const fs = require('fs');
const path = require('path');
const root = 'E:/Attendance_Web_App/Attendence_Mobile_App - Copy/Attendenc_New_Perfect_Mobile';
const env = {};
fs.readFileSync(path.join(root, '.env'), 'utf8').split(/\r?\n/).forEach((line) => {
  const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
  if (m && !m[1].startsWith('#')) env[m[1]] = m[2].replace(/^["']|["']$/g, '');
});
const base = 'http://localhost:' + (env.API_PORT || '4000');

async function req(method, p, body, token) {
  const headers = { Accept: 'application/json' };
  if (token) headers.Authorization = 'Bearer ' + token;
  if (body) headers['Content-Type'] = 'application/json';
  const res = await fetch(base + p, { method, headers, body: body ? JSON.stringify(body) : undefined });
  let data = null; try { data = await res.json(); } catch {}
  return { status: res.status, data };
}

(async () => {
  const hrLogin = await req('POST', '/api/auth/hr/login', { username: env.HR_USERNAME, password: env.HR_PASSWORD });
  const hrToken = hrLogin.data?.token;
  console.log('HR LOGIN', hrLogin.status, 'role:', hrLogin.data?.role);

  // HR credential status (read-only) for a real employee.
  const status = await req('GET', '/api/hr/employee/credentials?paycode=0328', null, hrToken);
  console.log('HR CRED STATUS (0328)', status.status, 'success:', status.data?.success, 'passwordSet:', status.data?.passwordSet, 'pinSet:', status.data?.pinSet, 'mustChangePassword:', status.data?.mustChangePassword, 'pinSetupRequired:', status.data?.pinSetupRequired);

  // WRITE endpoints must reject WITHOUT a token (401) and must NOT run.
  for (const [p, body] of [
    ['/api/hr/employee/credentials/password', { paycode: '0328', password: 'x', confirmPassword: 'x', mustChange: false }],
    ['/api/hr/employee/credentials/pin', { paycode: '0328', pin: '1234', confirmPin: '1234' }],
    ['/api/hr/employee/credentials/force-password-change', { paycode: '0328' }],
    ['/api/hr/employee/credentials/require-pin-setup', { paycode: '0328' }],
  ]) {
    const r = await req('POST', p, body, null);
    console.log('NO-TOKEN', p, '->', r.status, r.data?.message);
  }

  // WRITE endpoints must reject an EMPLOYEE token (403 — requireRole('HR')).
  let empToken = null;
  if (String(env.DEV_EMPLOYEE_AUTH_ENABLED || '').toLowerCase() === 'true') {
    const empLogin = await req('POST', '/api/auth/employee/login', { paycode: env.DEV_EMPLOYEE_PAYCODE, password: env.DEV_EMPLOYEE_PASSWORD });
    empToken = empLogin.data?.token;
  }
  if (empToken) {
    const r = await req('POST', '/api/hr/employee/credentials/force-password-change', { paycode: '0328' }, empToken);
    console.log('EMPLOYEE-TOKEN force-password-change ->', r.status, r.data?.message);
  }

  // Search endpoint (used by the UI) works.
  const search = await req('GET', '/api/employees?search=0328&pageSize=5', null, hrToken);
  console.log('SEARCH 0328', search.status, 'rows:', (search.data?.rows || []).length, 'first:', (search.data?.rows || [])[0]?.empname);
})();
