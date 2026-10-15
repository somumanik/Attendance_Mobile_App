// Read-only validation of single/bulk email read paths + filters (no sends).
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
  const login = await req('POST', '/api/auth/hr/login', { username: env.HR_USERNAME, password: env.HR_PASSWORD });
  const token = login.data && login.data.token;

  const filters = await req('GET', '/api/hr/filters', null, token);
  console.log('FILTERS', filters.status, 'companies:', (filters.data?.companies || []).length, 'departments:', (filters.data?.departments || []).length);

  const emp = await req('GET', '/api/employees?search=&pageSize=3', null, token);
  const firstEmp = (emp.data?.rows || [])[0];
  console.log('EMPLOYEES', emp.status, 'rows:', (emp.data?.rows || []).length, 'first paycode:', firstEmp ? firstEmp.paycode : null);

  if (firstEmp) {
    const resolve = await req('GET', '/api/email/resolve?paycode=' + encodeURIComponent(firstEmp.paycode), null, token);
    console.log('RESOLVE', resolve.status, 'hasEmail:', resolve.data?.hasEmail, 'emailSource:', resolve.data?.emailSource, 'emailLen:', (resolve.data?.email || '').length);
  }

  const preview = await req('GET', '/api/email/preview?eventType=Birthday&date=2026-10-15&subject=x&body=y', null, token);
  console.log('PREVIEW', preview.status, 'total:', preview.data?.total, 'validEmails:', preview.data?.validEmails, 'missing:', preview.data?.missingEmails, 'alreadySent:', preview.data?.alreadySent, 'willSend:', preview.data?.willSend, 'providerReady:', preview.data?.providerReady);

  const missing = await req('GET', '/api/email/missing', null, token);
  console.log('MISSING sample row:', (missing.data?.rows || [])[0]);
})();
