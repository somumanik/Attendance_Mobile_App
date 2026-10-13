// PHASE 7 — UI parity verification (READ-ONLY, Next server on :3000 + backend on :4000).
// Checks: login unchanged, HR/employee portal shell render, role separation, redirects.
import 'dotenv/config';

const BASE = process.env.PHASE7_BASE || 'http://localhost:3000';
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
  // 1. Login page unchanged
  const login = await raw('/login');
  check('Login page renders (200)', login.status === 200, `status=${login.status}`);
  check('Login page keeps "Attendance Portal" brand', login.text.includes('Attendance Portal'));
  check('Login page keeps role cards (Employee/HR/SuperAdmin)', login.text.includes('Employee') && login.text.includes('SuperAdmin'));
  check('Login page keeps theme picker', login.text.includes('theme-picker') || login.text.includes('Theme'));

  // 2. HR login + portal
  const hrLogin = await raw('/api/auth/hr', { method: 'POST', body: { username: process.env.HR_USERNAME, password: process.env.HR_PASSWORD } });
  const hrCookie = (hrLogin.setCookie || '').split(';')[0];
  check('HR login OK', hrLogin.status === 200 && hrLogin.text.includes('"success":true'), `status=${hrLogin.status}`);
  check('HR httpOnly auth_token cookie set', /auth_token=/.test(hrCookie));

  const hr = await raw('/hr', { cookie: hrCookie });
  check('HR portal renders (200)', hr.status === 200, `status=${hr.status}`);
  check('HR sidebar: "HR Admin Control"', hr.text.includes('HR Admin Control'));
  check('HR header title: "Executive Overview"', hr.text.includes('Executive Overview'));
  check('HR sidebar nav items present', hr.text.includes('All Employees Roster') && hr.text.includes('Leave Management'));
  check('HR sync panel present', hr.text.includes('Master DB Sync'));

  // 3. Employee login + portal
  const empLogin = await raw('/api/auth/employee', { method: 'POST', body: { paycode: process.env.DEV_EMPLOYEE_PAYCODE, password: process.env.DEV_EMPLOYEE_PASSWORD } });
  const empCookie = (empLogin.setCookie || '').split(';')[0];
  check('Employee login OK', empLogin.status === 200 && empLogin.text.includes('"success":true'), `status=${empLogin.status} body=${empLogin.text.slice(0, 140)}`);

  const emp = await raw('/employee', { cookie: empCookie });
  check('Employee portal renders (200)', emp.status === 200, `status=${emp.status}`);
  check('Employee sidebar: "Employee Portal"', emp.text.includes('Employee Portal'));
  check('Employee header title: "Dashboard Overview"', emp.text.includes('Dashboard Overview'));
  check('Employee sync panel present', emp.text.includes('Live SQL Sync'));

  // 4. Role separation + redirects
  const empToHr = await raw('/hr', { cookie: empCookie });
  check('Employee blocked from /hr (redirect)', empToHr.status >= 300 && empToHr.status < 400, `status=${empToHr.status}`);
  const anon = await raw('/employee');
  check('Anonymous /employee redirects', anon.status >= 300 && anon.status < 400, `status=${anon.status}`);
  const anonHr = await raw('/hr');
  check('Anonymous /hr redirects', anonHr.status >= 300 && anonHr.status < 400, `status=${anonHr.status}`);

  const pass = results.filter((r) => r.pass).length;
  console.log(`\n${pass}/${results.length} checks passed`);
  process.exit(pass === results.length ? 0 : 1);
})().catch((e) => {
  console.error('FATAL', e);
  process.exit(1);
});
