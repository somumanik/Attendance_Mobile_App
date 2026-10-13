// QUICK UI FIX — /hr/audit royal-white values + coloured helper text (READ-ONLY)
import 'dotenv/config';

const BASE = process.env.QUICK_UI_BASE || 'http://localhost:3000';
const results = [];
const check = (name, cond, detail = '') => {
  const pass = !!cond;
  results.push({ name, pass, detail: String(detail) });
  console.log(`${pass ? 'PASS' : 'FAIL'} :: ${name} :: ${detail}`);
};

async function raw(path, { method = 'GET', body, cookie } = {}) {
  const headers = {};
  if (body) headers['Content-Type'] = 'application/json';
  if (cookie) headers.Cookie = cookie;
  const res = await fetch(BASE + path, { method, headers, body: body ? JSON.stringify(body) : undefined, redirect: 'manual' });
  const text = await res.text();
  return { status: res.status, text, setCookie: res.headers.get('set-cookie') || '' };
}

(async () => {
  const hrLogin = await raw('/api/auth/hr', { method: 'POST', body: { username: process.env.HR_USERNAME, password: process.env.HR_PASSWORD } });
  const hrCookie = (hrLogin.setCookie || '').split(';')[0];
  check('HR login unchanged', hrLogin.status === 200 && hrLogin.text.includes('"success":true'), `status=${hrLogin.status}`);

  const page = await raw('/hr/audit', { cookie: hrCookie });
  check('/hr/audit renders (200)', page.status === 200, `status=${page.status}`);
  const cssHref = (page.text.match(/\/_next\/static\/css\/[^"]+\.css/) || [])[0];
  const css = (await raw(cssHref)).text;

  // 1. Primary values royal white + helper colours
  check('CSS: primary values royal white #ffffff', /\.audit-tab \.audit-val\s*\{[^}]*color:\s*#fff(fff)?\b/.test(css));
  check('CSS: helper pink #ff79c6 (age/birthday)', /\.audit-help--pink\s*\{[^}]*#ff79c6/.test(css));
  check('CSS: helper amber #ffd166 (service duration)', /\.audit-help--amber\s*\{[^}]*#ffd166/.test(css));
  check('CSS: helper cyan #45d6e8 (marital helper)', /\.audit-help--cyan\s*\{[^}]*#45d6e8/.test(css));
  check('CSS: helper violet #b69cff (anniversary helper)', /\.audit-help--violet\s*\{[^}]*#b69cff/.test(css));
  check('CSS: no leftover coloured value classes', !css.includes('audit-val--'));

  // 2. Regression guards — previous phase styling untouched
  check('CSS: IN #00d6a0 / OUT #ff667d intact', css.includes('.audit-tab .audit-in') && css.includes('#00d6a0') && css.includes('.audit-tab .audit-out') && css.includes('#ff667d'));
  check('CSS: dropdown styling intact', css.includes('.audit-select') && /color-scheme:\s*dark/.test(css) && /audit-select option:checked/.test(css));
  check('CSS: shared badges + exec overview intact', /\.badge--late\s*\{[^}]*#a5b4fc/.test(css) && /\.badge--weekoff\s*\{[^}]*#d8b4fe/.test(css) && css.includes('.exec-view .punch-in'));

  // 3. Bundle wiring
  const chunkHrefs = [...page.text.matchAll(/\/_next\/static\/chunks\/[^"]+\.js/g)].map((m) => m[0]);
  let chunk = '';
  for (const h of [...new Set(chunkHrefs)]) {
    const t = await raw(h);
    if (t.text.includes('Loading active employees')) chunk = t.text;
  }
  check('Bundle: audit-val + 4 helper classes wired', ['audit-val', 'audit-help--pink', 'audit-help--amber', 'audit-help--cyan', 'audit-help--violet'].every((c) => chunk.includes(c)));
  check('Bundle: labels still muted class-free styling', chunk.includes('audit-kpi-label') && chunk.includes('audit-name'));
  check('Bundle: no leftover valueClass props', !chunk.includes('audit-val--'));

  // 4. Data + selection unchanged
  const ld = JSON.parse((await raw('/api/employees?page=1&pageSize=100&active=Y', { cookie: hrCookie })).text);
  check('Active employee list unchanged', Number(ld.total) === 296, `total=${ld.total}`);
  const pc = String((ld.rows || [])[0]?.paycode || '').trim();
  const month = new Date().toISOString().slice(0, 7);
  const audit = JSON.parse((await raw(`/api/hr/audit/${encodeURIComponent(pc)}?month=${month}`, { cookie: hrCookie })).text);
  check('Audit data unchanged (stats + rows)', Number(audit.stats?.absent) === 27 && (audit.attendance || []).length === 31, JSON.stringify(audit.stats));
  const prof = JSON.parse((await raw(`/api/employees/${encodeURIComponent(pc)}`, { cookie: hrCookie })).text);
  console.log(`INFO :: profile keys :: ${Object.keys(prof).join(',')}`);
  console.log(`INFO :: real detail values :: DOB=${prof.dateofbirth} DOJ=${prof.dateofjoin} married=${prof.ismarried} qual=${prof.qualification} exp=${prof.experience} contact=${prof.telephone1} email=${prof.e_mail1}`);

  // 5. Other tabs + login unchanged
  for (const path of ['/hr', '/hr/employees', '/hr/analytics', '/hr/celebrations', '/hr/leave', '/hr/salary', '/hr/holidays']) {
    const t = await raw(path, { cookie: hrCookie });
    check(`Tab ${path} (200)`, t.status === 200, `status=${t.status}`);
  }
  for (const path of ['/login', '/login/hr', '/login/employee', '/login/superadmin']) {
    check(`Login ${path} (200)`, (await raw(path)).status === 200);
  }
  const empLogin = await raw('/api/auth/employee', { method: 'POST', body: { paycode: process.env.DEV_EMPLOYEE_PAYCODE, password: process.env.DEV_EMPLOYEE_PASSWORD } });
  check('Employee login unchanged', empLogin.status === 200 && empLogin.text.includes('"success":true'), `status=${empLogin.status}`);

  const pass = results.filter((x) => x.pass).length;
  console.log(`\n${pass}/${results.length} checks passed`);
  process.exit(pass === results.length ? 0 : 1);
})().catch((e) => {
  console.error('FATAL', e);
  process.exit(1);
});