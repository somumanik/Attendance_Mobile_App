/* Regression verifier: frozen provider API + live endpoints (Brevo key never leaks). */
const http = require('http');
const HOST = process.env.VERIFY_HOST || '127.0.0.1';
const PORT = Number(process.env.VERIFY_PORT || process.env.API_PORT || 4000);
const HR_USER = process.env.HR_USERNAME || 'HR001';
const HR_PASS = process.env.HR_PASSWORD || 'Admin@123';
let TOKEN = '', failures = 0;
function req(path, method, body) {
  return new Promise((resolve) => {
    const payload = body ? JSON.stringify(body) : null;
    const opt = { host: HOST, port: PORT, path, method: method || 'GET',
      headers: { Accept: 'application/json', Connection: 'close' } };
    if (TOKEN) opt.headers.Authorization = 'Bearer ' + TOKEN;
    if (payload) { opt.headers['Content-Type'] = 'application/json'; opt.headers['Content-Length'] = Buffer.byteLength(payload); }
    const r = http.request(opt, (res) => {
      let d = ''; res.on('data', (c) => (d += c));
      res.on('end', () => { let p = null; try { p = JSON.parse(d); } catch (_) { p = { raw: d.slice(0, 200) }; } resolve({ status: res.statusCode, body: p, raw: d }); });
    });
    r.on('error', (e) => resolve({ status: 0, body: { error: e.message }, raw: '' }));
    r.setTimeout(25000, () => { try { r.destroy(); } catch (_) {} resolve({ status: 0, body: { error: 'timeout' }, raw: '' }); });
    if (payload) r.write(payload); r.end();
  });
}
function check(label, ok, detail) { if (!ok) failures++; console.log((ok ? 'PASS  ' : 'FAIL  ') + label + (detail ? ' -> ' + detail : '')); }
(async () => {
  // 1. Frozen module API (no server needed)
  const mod = await import('../server/email-provider.js');
  const need = ['PROVIDER_TYPES', 'ensureProviderColumns', 'getProviderSettings', 'publicProviderStatus', 'saveProviderSettings', 'sendEmail', 'encryptSecret', 'decryptSecret', 'maskSecret'];
  check('frozen provider API exports', need.every((k) => typeof mod[k] !== 'undefined'), need.join(','));
  check('PROVIDER_TYPES = brevo+smtp', Array.isArray(mod.PROVIDER_TYPES) && mod.PROVIDER_TYPES.includes('brevo') && mod.PROVIDER_TYPES.includes('smtp'), JSON.stringify(mod.PROVIDER_TYPES));
  const enc = mod.encryptSecret('xkeysib-secret-abc123');
  check('encryptSecret != plaintext + decrypt round-trips', typeof enc === 'string' && !enc.includes('xkeysib') && mod.decryptSecret(enc) === 'xkeysib-secret-abc123', String(enc).slice(0, 20) + '...');
  check('maskSecret hides middle', mod.maskSecret('xkeysib-secret-abc123') === 'xkey••••••••c123', mod.maskSecret('xkeysib-secret-abc123'));
  const pub = mod.publicProviderStatus({ provider: 'brevo', source: 'database', configured: true, hint: '', brevoApiKey: 'xkeysib-secret-abc123', smtp: {} });
  check('publicProviderStatus strips secret', !JSON.stringify(pub).includes('xkeysib'), 'hasBrevoKey=' + pub.hasBrevoKey + ' hint=' + pub.brevoKeyHint);
  // 2. Live endpoints
  const health = await req('/api/health');
  check('server reachable', health.status === 200, 'http ' + health.status);
  const login = await req('/api/auth/hr/login', 'POST', { username: HR_USER, password: HR_PASS });
  TOKEN = (login.body && (login.body.token || (login.body.data && login.body.data.token))) || '';
  check('HR login', login.status === 200 && !!TOKEN, 'http ' + login.status);
  if (!TOKEN) { console.log('STOP: no token'); process.exit(1); }
  const prov = await req('/api/email/provider');
  const pv = (prov.body && (prov.body.provider || prov.body.emailProvider)) || {};
  check('GET /api/email/provider', prov.status === 200 && (prov.body || {}).success === true, 'http ' + prov.status + ' provider=' + pv.provider + ' source=' + pv.source);
  check('no raw Brevo secret in response', !String(prov.raw || '').includes('xkeysib-'), 'hint=' + (pv.brevoKeyHint || ''));
  check('GET /api/email/health', (await req('/api/email/health')).status === 200, '');
  check('GET /api/email/missing', (await req('/api/email/missing')).status === 200, '');
  const cfg = await req('/api/email/config');
  check('GET /api/email/config carries emailProvider', cfg.status === 200 && !!(cfg.body || {}).emailProvider, 'http ' + cfg.status);
  // 3. Red->green self-test: dummy key save -> shows configured, never echoes secret -> clear it back
  const dbHadKey = !!pv.hasBrevoKey;
  if (!dbHadKey) {
    const save = await req('/api/email/provider', 'POST', { provider: 'brevo', brevoApiKey: 'xkeysib-dummy-verify-0000' });
    check('POST dummy key saves', save.status === 200 && ((save.body || {}).provider || {}).hasBrevoKey === true, 'http ' + save.status);
    check('saved key never echoed', !String(save.raw || '').includes('xkeysib-dummy'), '');
    const again = await req('/api/email/provider');
    check('provider reads back configured', ((again.body || {}).provider || {}).configured === true, '');
    const clear = await req('/api/email/provider', 'POST', { brevoApiKeyClear: true });
    check('dummy key cleared (db restored)', clear.status === 200 && ((clear.body || {}).provider || {}).hasBrevoKey === false, 'http ' + clear.status);
  } else { console.log('SKIP dummy-key cycle: database already has a real Brevo key (untouched).'); }
  console.log(failures ? ('\nRESULT: ' + failures + ' FAILURE(S)') : '\nRESULT: ALL CHECKS PASSED');
  process.exit(failures ? 1 : 0);
})().catch((e) => { console.error('VERIFY ERROR:', e && e.message); process.exit(1); });
