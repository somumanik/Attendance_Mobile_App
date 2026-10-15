// Read-only validation of the email endpoints (no sends, no imports).
// Logs in as HR using server .env credentials and prints ONLY non-secret fields.
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
  let data = null;
  try { data = await res.json(); } catch {}
  return { status: res.status, data };
}

(async () => {
  const login = await req('POST', '/api/auth/hr/login', { username: env.HR_USERNAME, password: env.HR_PASSWORD });
  console.log('LOGIN status:', login.status, 'role:', login.data && login.data.role);
  const token = login.data && login.data.token;
  if (!token) { console.log('NO TOKEN — login data keys:', login.data ? Object.keys(login.data) : null); process.exit(1); }

  for (const p of ['/api/email/config', '/api/email/health', '/api/email/provider', '/api/email/log?limit=5', '/api/email/missing']) {
    const r = await req('GET', p, null, token);
    if (p === '/api/email/config') {
      console.log('CONFIG', r.status, 'success:', r.data?.success,
        'config keys:', r.data?.config ? Object.keys(r.data.config).join(',') : null,
        'counts:', { master: r.data?.masterEmailCount, mapping: r.data?.mappingCount, noEmail: r.data?.noEmailCount, recipient: r.data?.recipientCount });
    } else if (p === '/api/email/health') {
      console.log('HEALTH', r.status, 'ready:', r.data?.ready, 'checks:', (r.data?.checks || []).map((c) => c.key + '=' + c.ok).join(','));
    } else if (p === '/api/email/provider') {
      console.log('PROVIDER', r.status, 'provider:', r.data?.provider?.provider, 'configured:', r.data?.provider?.configured, 'source:', r.data?.provider?.source, 'hasBrevoKey:', r.data?.provider?.hasBrevoKey);
    } else if (p === '/api/email/log?limit=5') {
      console.log('LOG', r.status, 'success:', r.data?.success, 'rows:', Array.isArray(r.data?.rows) ? r.data.rows.length : (r.data?.logs?.length ?? 'n/a'));
    } else {
      console.log('MISSING', r.status, 'success:', r.data?.success, 'count:', r.data?.count, 'rows:', Array.isArray(r.data?.rows) ? r.data.rows.length : 'n/a');
    }
  }
})();
