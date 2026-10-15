// Cross-platform single-source-of-truth verification (READ-ONLY — no credential writes).
// Proves mobile (backend-direct :4000) and Next.js (proxy :3000) read the SAME record.
const fs = require('fs');
const path = require('path');
const root = 'E:/Attendance_Web_App/Attendence_Mobile_App - Copy/Attendenc_New_Perfect_Mobile';
const env = {};
fs.readFileSync(path.join(root, '.env'), 'utf8').split(/\r?\n/).forEach((line) => {
  const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
  if (m && !m[1].startsWith('#')) env[m[1]] = m[2].replace(/^["']|["']$/g, '');
});

async function req(host, method, p, body, token) {
  const headers = { Accept: 'application/json' };
  if (token) headers.Authorization = 'Bearer ' + token;
  if (body) headers['Content-Type'] = 'application/json';
  const res = await fetch(host + p, { method, headers, body: body ? JSON.stringify(body) : undefined });
  let data = null; try { data = await res.json(); } catch {}
  return { status: res.status, data };
}

const MOBILE = 'http://localhost:4000';   // mobile hits backend directly
const WEBSITE = 'http://localhost:3000';  // website goes through Next proxy -> same backend

(async () => {
  // HR token from BOTH paths (same backend).
  const hrMobile = await req(MOBILE, 'POST', '/api/auth/hr/login', { username: env.HR_USERNAME, password: env.HR_PASSWORD });
  const hrWebsite = await req(WEBSITE, 'POST', '/api/auth/hr', { username: env.HR_USERNAME, password: env.HR_PASSWORD });
  console.log('HR LOGIN via mobile(backend) ->', hrMobile.status, 'role:', hrMobile.data?.role);
  console.log('HR LOGIN via website(proxy)  ->', hrWebsite.status, 'role:', hrWebsite.data?.role);

  // HR credential status for a real employee (0328) from BOTH paths.
  const a = await req(MOBILE, 'GET', '/api/hr/employee/credentials?paycode=0328', null, hrMobile.data?.token);
  const b = await req(WEBSITE, 'GET', '/api/hr/employee/credentials?paycode=0328', null, hrMobile.data?.token);
  const pick = (d) => d ? `${d.passwordSet}|${d.pinSet}|${d.mustChangePassword}|${d.pinSetupRequired}|${d.loginEnabled}` : null;
  console.log('CRED STATUS mobile(backend):', a.status, pick(a.data));
  console.log('CRED STATUS website(proxy) :', b.status, pick(b.data));
  console.log('SAME RECORD (identical state):', pick(a.data) !== null && pick(a.data) === pick(b.data));

  // Employee identity from BOTH paths (dev account — session identity, not browser paycode).
  if (String(env.DEV_EMPLOYEE_AUTH_ENABLED || '').toLowerCase() === 'true') {
    const empMobile = await req(MOBILE, 'POST', '/api/auth/employee/login', { paycode: env.DEV_EMPLOYEE_PAYCODE, password: env.DEV_EMPLOYEE_PASSWORD });
    const empWebsite = await req(WEBSITE, 'POST', '/api/auth/employee', { paycode: env.DEV_EMPLOYEE_PAYCODE, password: env.DEV_EMPLOYEE_PASSWORD });
    console.log('EMP LOGIN mobile(backend) ->', empMobile.status, 'role:', empMobile.data?.role);
    console.log('EMP LOGIN website(proxy)  ->', empWebsite.status, 'role:', empWebsite.data?.role);

    const meMobile = await req(MOBILE, 'GET', '/api/me', null, empMobile.data?.token);
    const meWebsite = await req(MOBILE, 'GET', '/api/me', null, empMobile.data?.token);
    console.log('EMP /api/me identity ->', meMobile.data?.employee?.paycode, '|', meWebsite.data?.employee?.paycode);
  }
})();
