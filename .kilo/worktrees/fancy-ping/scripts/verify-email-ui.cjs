/**
 * Fresh, minimal verifier for the Email Configuration APIs used by the HR Admin UI.
 * Uses node's built-in http module (no fetch) and exits explicitly so it never hangs.
 *
 *   node scripts/verify-email-ui.cjs
 */
const http = require('http');

const HOST = process.env.VERIFY_HOST || '127.0.0.1';
const PORT = Number(process.env.VERIFY_PORT || 4000);
const HR_USER = process.env.HR_USERNAME || 'HR001';
const HR_PASS = process.env.HR_PASSWORD || 'Admin@123';

let TOKEN = '';

function req(path, method = 'GET', body = null) {
  return new Promise((resolve) => {
    const payload = body ? JSON.stringify(body) : null;
    const options = {
      host: HOST,
      port: PORT,
      path,
      method,
      headers: {
        Accept: 'application/json',
        Connection: 'close',
        Authorization: TOKEN ? 'Bearer ' + TOKEN : '',
      },
    };
    if (payload) {
      options.headers['Content-Type'] = 'application/json';
      options.headers['Content-Length'] = Buffer.byteLength(payload);
    }
    const r = http.request(options, (res) => {
      let data = '';
      res.on('data', (c) => (data += c));
      res.on('end', () => {
        let parsed = null;
        try {
          parsed = JSON.parse(data);
        } catch (_) {
          parsed = { __unparsed: data.slice(0, 200) };
        }
        resolve({ status: res.statusCode, body: parsed });
      });
    });
    r.on('error', (e) => resolve({ status: 0, body: { error: e.message } }));
    r.setTimeout(20000, () => {
      r.destroy();
      resolve({ status: 0, body: { error: 'timeout' } });
    });
    if (payload) r.write(payload);
    r.end();
  });
}

function show(label, res, keys) {
  const out = { http: res.status };
  for (const k of keys) {
    const v = res.body ? res.body[k] : undefined;
    if (v !== undefined) out[k] = Array.isArray(v) ? '[' + v.length + ']' : v;
  }
  if (res.body && res.body.success === false) out.error = res.body.message;
  console.log(label.padEnd(34), JSON.stringify(out));
}

(async () => {
  console.log('--- Email API verification against http://' + HOST + ':' + PORT + ' ---\n');

  const health = await req('/api/health');
  show('GET  /api/health', health, ['status', 'database']);

  const login = await req('/api/auth/hr/login', 'POST', { username: HR_USER, password: HR_PASS });
  show('POST /api/auth/hr/login', login, ['success', 'role', 'paycode', 'username', 'token', 'message']);
  if (!login.body || !login.body.token) {
    console.log('\nFATAL: HR login failed - cannot continue.');
    process.exit(1);
  }
  TOKEN = login.body.token;
  console.log('     token length =', TOKEN.length, '\n');

  const filters = await req('/api/hr/filters');
  show('GET  /api/hr/filters', filters, ['success', 'companies', 'departments', 'categories', 'genders']);
  const firstCompany = filters.body && filters.body.companies && filters.body.companies[0];
  const firstDept = filters.body && filters.body.departments && filters.body.departments[0];
  console.log('     sample company =', firstCompany ? firstCompany.code + '/' + firstCompany.name : 'none');
  console.log('     sample dept    =', firstDept ? firstDept.code + '/' + firstDept.name : 'none', '\n');

  const cfg = await req('/api/email/config');
  show('GET  /api/email/config', cfg, [
    'success',
    'sqlEmailField',
    'sourcePriority',
    'masterEmailCount',
    'mappingCount',
    'noEmailCount',
    'recipientCount',
  ]);
  const c = (cfg.body && cfg.body.config) || {};
  const p = (cfg.body && cfg.body.provider) || {};
  console.log('     provider.brevo  =', p.brevo, '| provider.db =', p.db);
  console.log('     sendername      =', JSON.stringify(c.sendername), '| senderemail =', JSON.stringify(c.senderemail));
  console.log('     enabled flags   = birthday:' + c.birthdayenabled + ' marriage:' + c.marriageenabled + ' workanniversary:' + c.workanniversaryenabled);
  console.log('     subjects        = birthday:' + JSON.stringify(c.birthdaysubject) + ' marriage:' + JSON.stringify(c.marriagesubject) + ' workanniversary:' + JSON.stringify(c.workanniversarysubject) + ' custom:' + JSON.stringify(c.customsubject), '\n');

  const emps = await req('/api/hr/employees?pageSize=5');
  const rows = (emps.body && (emps.body.rows || emps.body.employees)) || [];
  show('GET  /api/hr/employees', emps, ['success', 'total', 'page', 'pageSize']);
  console.log('     rows returned   =', Array.isArray(rows) ? rows.length : 'n/a');
  const withEmail = Array.isArray(rows) ? rows.find((r) => r.e_mail1 || r.email) : null;
  const anyEmp = Array.isArray(rows) ? rows[0] : null;
  if (anyEmp) {
    console.log('     sample employee =', JSON.stringify({ paycode: anyEmp.paycode, empname: anyEmp.empname, e_mail1: anyEmp.e_mail1 || anyEmp.email || null }));
  }
  console.log('');

  const resolveTarget = withEmail || anyEmp;
  if (resolveTarget) {
    const res = await req('/api/email/resolve?paycode=' + encodeURIComponent(resolveTarget.paycode));
    show('GET  /api/email/resolve', res, ['success', 'email', 'emailSource', 'hasEmail', 'message']);
    console.log('     for paycode     =', resolveTarget.paycode, '\n');
  }

  const today = new Date().toISOString().slice(0, 10);
  const pv = await req('/api/email/preview?eventType=Birthday&date=' + today + '&companycode=ALL');
  show('GET  /api/email/preview', pv, ['success', 'eventType', 'date', 'total', 'validEmails', 'missingEmails', 'willSend', 'providerReady', 'enabled', 'message']);
  const pvRows = pv.body && (pv.body.rows || pv.body.employees || pv.body.list);
  console.log('     matched rows    =', Array.isArray(pvRows) ? pvRows.length : 'n/a', '\n');

  if (firstCompany) {
    const q =
      '/api/email/preview?eventType=Birthday&date=' +
      today +
      '&companycode=' +
      encodeURIComponent(firstCompany.code) +
      (firstDept ? '&departmentcode=' + encodeURIComponent(firstDept.code) : '');
    const pv2 = await req(q);
    show('GET  /api/email/preview (scoped)', pv2, ['success', 'total', 'validEmails', 'willSend', 'message']);
    console.log('');
  }

  const te = await req('/api/email/test', 'POST', { to: 'verify' + (Date.now() % 100000) + '@example.com' });
  show('POST /api/email/test', te, ['success', 'message', 'error', 'provider']);

  const sd = await req('/api/email/send', 'POST', { eventType: 'Birthday', date: today, companycode: '', departmentcode: '' });
  show('POST /api/email/send', sd, ['success', 'sent', 'failed', 'skipped', 'message', 'error']);

  if (resolveTarget) {
    const ss = await req('/api/email/send-single', 'POST', { paycode: resolveTarget.paycode, eventType: 'Custom', subject: 'Verification', body: 'Verification' });
    show('POST /api/email/send-single', ss, ['success', 'message', 'error']);
  }

  const log = await req('/api/email/log?limit=5');
  const logRows = (log.body && (log.body.rows || log.body.log)) || [];
  show('GET  /api/email/log', log, ['success', 'total']);
  console.log('     log rows        =', Array.isArray(logRows) ? logRows.length : 'n/a', '\n');

  console.log('--- verification complete ---');
  process.exit(0);
})().catch((e) => {
  console.error('verifier crashed:', e);
  process.exit(1);
});