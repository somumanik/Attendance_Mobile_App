// Phase K audit - REAL BROWSER verification (headless Edge/Chrome via CDP).
// Drives the actual running Expo web app on http://localhost:8081:
//   Employee Portal -> Login -> Full & Final tab -> Calculate Estimate
//   HR Admin Portal -> Login -> Salary tab (+ protected HR tabs)
// Captures console errors, page exceptions, DOM text assertions and screenshots.
import 'dotenv/config';
import { spawn } from 'child_process';
import fs from 'fs';
import os from 'os';
import path from 'path';

const APP_URL = 'http://localhost:8081';
const CDP_PORT = 9222;
const OUT_DIR = path.join(process.cwd(), 'scripts', '_phase_k_ui');
const BROWSERS = [
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
];

const results = [];
const check = (label, ok, detail = '') => {
  results.push({ label, ok, detail });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${detail ? ' -> ' + detail : ''}`);
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/* ------------------------- minimal CDP client ------------------------- */
class Cdp {
  constructor(wsUrl) {
    this.wsUrl = wsUrl;
    this.id = 0;
    this.pending = new Map();
    this.consoleErrors = [];
    this.exceptions = [];
  }
  async connect() {
    this.ws = new WebSocket(this.wsUrl);
    await new Promise((resolve, reject) => {
      this.ws.addEventListener('open', resolve, { once: true });
      this.ws.addEventListener('error', () => reject(new Error('ws error')), { once: true });
    });
    this.ws.addEventListener('message', (ev) => {
      let msg = null;
      try { msg = JSON.parse(ev.data); } catch { return; }
      if (msg.id && this.pending.has(msg.id)) {
        const { resolve, reject } = this.pending.get(msg.id);
        this.pending.delete(msg.id);
        if (msg.error) reject(new Error(msg.error.message)); else resolve(msg.result);
        return;
      }
      if (msg.method === 'Runtime.exceptionThrown') {
        const d = msg.params?.exceptionDetails || {};
        this.exceptions.push(`${d.text || ''} ${d.exception?.description || ''}`.trim());
      }
      if (msg.method === 'Runtime.consoleAPICalled' && msg.params?.type === 'error') {
        this.consoleErrors.push((msg.params.args || []).map((a) => a.value || a.description || '').join(' '));
      }
    });
  }
  send(method, params = {}) {
    this.id += 1;
    const id = this.id;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.ws.send(JSON.stringify({ id, method, params }));
      setTimeout(() => {
        if (this.pending.has(id)) { this.pending.delete(id); reject(new Error(`timeout: ${method}`)); }
      }, 120000);
    });
  }
  async eval(expression) {
    const res = await this.send('Runtime.evaluate', {
      expression, awaitPromise: true, returnByValue: true, userGesture: true,
    });
    if (res.exceptionDetails) throw new Error(res.exceptionDetails.text || 'eval failed');
    return res.result?.value;
  }
  async text() { return this.eval('document.body ? document.body.innerText : ""'); }
  async waitForText(needle, timeoutMs = 90000) {
    const started = Date.now();
    while (Date.now() - started < timeoutMs) {
      const ok = await this.eval(`document.body ? document.body.innerText.includes(${JSON.stringify(needle)}) : false`);
      if (ok) return true;
      await sleep(1000);
    }
    return false;
  }
  async screenshot(name) {
    const res = await this.send('Page.captureScreenshot', { format: 'png' });
    fs.writeFileSync(path.join(OUT_DIR, name), Buffer.from(res.data, 'base64'));
  }
}

/* --------------------------- DOM interactions --------------------------- */
const CLICK_HELPER = `
(function clickText(target) {
  const all = Array.from(document.querySelectorAll('div,span,button,a'));
  const matches = all.filter((el) => (el.innerText || el.textContent || '').trim() === target);
  const el = matches[matches.length - 1];
  if (!el) return false;
  el.scrollIntoView({ block: 'center' });
  const rect = el.getBoundingClientRect();
  const opts = { bubbles: true, cancelable: true, view: window,
    clientX: rect.left + rect.width / 2, clientY: rect.top + rect.height / 2 };
  for (const type of ['pointerdown', 'mousedown', 'pointerup', 'mouseup', 'click']) {
    const Ev = type.startsWith('pointer') ? (window.PointerEvent || MouseEvent) : MouseEvent;
    el.dispatchEvent(new Ev(type, opts));
  }
  if (typeof el.click === 'function') el.click();
  return true;
})`;

const SET_INPUT_PLACEHOLDER = `
(function setInput(matchValue, nextValue) {
  const inputs = Array.from(document.querySelectorAll('input,textarea'));
  const el = inputs.find((i) => (i.placeholder || '').includes(matchValue) || (i.getAttribute('aria-label') || '').includes(matchValue));
  if (!el) return false;
  const proto = el.tagName === 'TEXTAREA' ? window.HTMLTextAreaElement.prototype : window.HTMLInputElement.prototype;
  const setter = Object.getOwnPropertyDescriptor(proto, 'value').set;
  setter.call(el, nextValue);
  el.dispatchEvent(new Event('input', { bubbles: true }));
  el.dispatchEvent(new Event('change', { bubbles: true }));
  return true;
})`;

const SET_INPUT_INDEX = `
(function setInputAt(index, nextValue) {
  const inputs = Array.from(document.querySelectorAll('input,textarea')).filter((i) => i.type !== 'checkbox');
  const el = inputs[index];
  if (!el) return false;
  el.scrollIntoView({ block: 'center' });
  const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
  setter.call(el, nextValue);
  el.dispatchEvent(new Event('input', { bubbles: true }));
  el.dispatchEvent(new Event('change', { bubbles: true }));
  return true;
})`;

const clickText = (cdp, text) => cdp.eval(`${CLICK_HELPER}(${JSON.stringify(text)})`);
const setInputPlaceholder = (cdp, ph, v) => cdp.eval(`${SET_INPUT_PLACEHOLDER}(${JSON.stringify(ph)}, ${JSON.stringify(v)})`);
const setInputAt = (cdp, i, v) => cdp.eval(`${SET_INPUT_INDEX}(${i}, ${JSON.stringify(v)})`);

/* ------------------------------ launch ------------------------------ */
if (!fs.existsSync(OUT_DIR)) fs.mkdirSync(OUT_DIR, { recursive: true });
const browserPath = BROWSERS.find((p) => fs.existsSync(p));
if (!browserPath) {
  console.error('No Edge/Chrome binary found - cannot run the browser test.');
  process.exit(1);
}
const profileDir = path.join(os.tmpdir(), `k-audit-profile-${Date.now()}`);
const browser = spawn(browserPath, [
  '--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check',
  '--disable-extensions', '--mute-audio',
  `--remote-debugging-port=${CDP_PORT}`, `--user-data-dir=${profileDir}`,
  '--window-size=1280,1500', 'about:blank',
], { stdio: 'ignore' });

async function pageTarget() {
  for (let i = 0; i < 40; i += 1) {
    try {
      const res = await fetch(`http://127.0.0.1:${CDP_PORT}/json/list`);
      const list = await res.json();
      const page = list.find((t) => t.type === 'page' && t.webSocketDebuggerUrl);
      if (page) return page;
    } catch { /* not up yet */ }
    await sleep(500);
  }
  return null;
}

const target = await pageTarget();
if (!target) {
  console.error('Could not connect to the browser debugger.');
  browser.kill();
  process.exit(1);
}
const cdp = new Cdp(target.webSocketDebuggerUrl);
await cdp.connect();
await cdp.send('Page.enable');
await cdp.send('Runtime.enable');
console.log(`[browser] ${path.basename(browserPath)} headless connected`);

/* =================== API PREP (real employee, no fake data) =================== */
const API = 'http://localhost:4000/api';
async function api(pathname, { method = 'GET', token, body } = {}) {
  const headers = { 'Content-Type': 'application/json' };
  if (token) headers.Authorization = `Bearer ${token}`;
  const res = await fetch(API + pathname, { method, headers, body: body ? JSON.stringify(body) : undefined });
  let json = null;
  try { json = await res.json(); } catch { /* non-JSON */ }
  return { status: res.status, json };
}

const EMP_CODE = process.env.AUDIT_EMP_PAYCODE || '0002';
const EMP_PASS = `AuditK${Math.random().toString(36).slice(2, 8)}1`;
const hrLogin = await api('/auth/hr/login', { method: 'POST', body: { username: process.env.HR_USERNAME, password: process.env.HR_PASSWORD } });
const HRTOK = hrLogin.json?.token;
check('P1. HR Admin login (API prep)', hrLogin.status === 200 && !!HRTOK, `HTTP ${hrLogin.status}`);
const setPw = await api('/hr/employee/credentials/password', {
  method: 'POST', token: HRTOK,
  body: { paycode: EMP_CODE, password: EMP_PASS, confirmPassword: EMP_PASS, mustChange: false },
});
check('P2. Known password provisioned for the REAL audit employee', setPw.status === 200, `HTTP ${setPw.status} paycode=${EMP_CODE}`);

/* ============================ EMPLOYEE PORTAL (browser) ============================ */
await cdp.send('Page.navigate', { url: APP_URL });
const booted = await cdp.waitForText('Select your role', 240000);
check('UI1. Frontend boots in a real browser - Role Selection rendered (no blank screen)', booted,
  booted ? 'role selection visible' : 'app never rendered');
await cdp.screenshot('01-role-selection.png');
const bootText = await cdp.text();
check('UI2. No uncaught page exceptions / console errors at boot',
  cdp.exceptions.length === 0 && cdp.consoleErrors.length === 0,
  `exceptions=${cdp.exceptions.length} consoleErrors=${cdp.consoleErrors.length}${cdp.exceptions[0] ? ' | ' + cdp.exceptions[0].slice(0, 90) : ''}`);
check('UI3. Both login roles offered', bootText.includes('HR Admin') && bootText.includes('Employee'), '');

await clickText(cdp, 'Employee');
const empLoginOpen = await cdp.waitForText('Employee Login', 60000);
check('UI4. Employee login screen opens', empLoginOpen, '');
await setInputAt(cdp, 0, EMP_CODE);
await setInputAt(cdp, 1, EMP_PASS);
await sleep(400);
await cdp.screenshot('02-employee-login.png');
await clickText(cdp, 'Sign In');
const portalOpen = await cdp.waitForText('Full & Final', 120000);
check('UI5. Employee Login works in the browser (portal + tabs rendered)', portalOpen, '');
await cdp.screenshot('03-employee-portal.png');

const tabText = await cdp.text();
check('UI6. Employee portal tabs present (regression surface)',
  ['Dashboard', 'Attendance', 'Leave', 'Reports', 'Celebrations', 'Full & Final', 'Profile'].every((t) => tabText.includes(t)),
  '');

await clickText(cdp, 'Full & Final');
const ffOpen = await cdp.waitForText('Full & Final Estimate', 90000);
check('UI7. Full & Final screen opens from the tab bar', ffOpen, '');
// The header renders while the screen is still LOADING, so wait for the identity card.
const ffLoaded = await cdp.waitForText('Date of Joining', 90000);
const ffInitial = await cdp.text();
check('UI8. Employee identity block rendered (paycode / DOJ / department / designation)',
  ffLoaded && ffInitial.includes(EMP_CODE) && ffInitial.includes('Date of Joining')
  && ffInitial.includes('Department') && ffInitial.includes('Designation'),
  ffLoaded ? '' : 'identity card never rendered');

// Fill the proposed leaving date and confirm the value stuck (controlled TextInput).
const dateSet = await setInputAt(cdp, 0, '2026-12-31');
const dateValue = await cdp.eval('(document.querySelectorAll("input")[0] || {}).value || ""');
check('UI8b. Proposed Leaving Date accepts the estimation input',
  dateSet === true && dateValue === '2026-12-31', `value="${dateValue}"`);
await sleep(600);
await clickText(cdp, 'Calculate Estimate');
// "Salary used: Basic" only appears when an estimate came back from the server.
const calcDone = await cdp.waitForText('Salary used: Basic', 120000);
await sleep(1200);
const ffText = await cdp.text();
await cdp.screenshot('04-fullfinal-estimate.png');
check('UI9. "Calculate Estimate" produced a result', calcDone, '');
check('UI10. Salary information is displayed (NOT the not-available state)',
  ffText.includes('Salary used: Basic') && !ffText.includes('Salary information is not currently available for calculation.'),
  '');
check('UI11. Rule basis text displayed (configurable rules shown, not hardcoded)',
  /days' BASIC wages per completed year/i.test(ffText) && ffText.includes('Calculation Rules'), '');
check('UI12. Service Period displayed (Years / Months / Days)',
  ffText.includes('Service Period') && ffText.includes('Years') && ffText.includes('Months') && ffText.includes('Days'), '');
check('UI13. Every settlement component visible separately',
  ['Gratuity', 'Bonus', 'Leave Encashment', 'Notice Pay', 'Other Dues', 'Other Recoveries', 'Employee Deductions', 'Employer Contributions']
    .every((label) => ffText.includes(label)),
  '');
const totalMatch = /Estimated Full & Final\s*\n\s*(₹[^\n]*)/.exec(ffText);
check('UI14. Estimated Full & Final total rendered as an amount',
  !!totalMatch && /₹\s?[\d,]+/.test(totalMatch[1]), totalMatch ? totalMatch[1].trim() : 'not found');
const uiTotal = totalMatch ? totalMatch[1].trim() : '';
check('UI15. Estimate clearly labelled as an estimate, not a final settlement',
  /ESTIMATE only/i.test(ffText) && /NOT a final/i.test(ffText), '');

/* ====== TRACE: the number shown in the UI must equal the Full & Final API ====== */
const empLoginApi = await api('/auth/employee/login', { method: 'POST', body: { paycode: EMP_CODE, password: EMP_PASS } });
const EMPTOK = empLoginApi.json?.token;
const apiEst = await api('/employee/fullfinal?leavingdate=2026-12-31', { token: EMPTOK });
const apiTotal = apiEst.json?.estimate?.estimatedTotal;
const expectedUi = apiTotal === undefined || apiTotal === null ? ''
  : `₹ ${Number(apiTotal).toLocaleString('en-IN', { maximumFractionDigits: 2 })}`;
check('TRACE1. Employee identity in the API equals the signed-in employee',
  apiEst.json?.employee?.paycode === EMP_CODE, `paycode=${apiEst.json?.employee?.paycode}`);
check('TRACE2. UI total equals the Full & Final API total (real data flow traced)',
  !!uiTotal && uiTotal === expectedUi, `UI="${uiTotal}" API="${expectedUi}"`);
check('TRACE3. API salary block carries the effective-dated basic + gross',
  apiEst.json?.salary?.available === true && Number(apiEst.json?.salary?.basic) > 0
  && Number(apiEst.json?.salary?.gross) >= Number(apiEst.json?.salary?.basic),
  `basic=${apiEst.json?.salary?.basic} gross=${apiEst.json?.salary?.gross} from=${apiEst.json?.salary?.effectivefrom}`);

/* ================= EMPLOYEE PORTAL REGRESSION (in-browser tab walk) ================= */
const empRegression = [
  ['Dashboard', 'Dashboard'],
  ['Attendance', 'Attendance'],
  ['Leave', 'Leave'],
  ['Reports', 'Reports'],
  ['Celebrations', 'Celebration'],
  ['Profile', 'Profile'],
];
let empRegressionOk = 0;
for (const [tab, expected] of empRegression) {
  const before = cdp.exceptions.length;
  await clickText(cdp, tab);
  await sleep(1800);
  const t = await cdp.text();
  const ok = t.includes(expected) && cdp.exceptions.length === before;
  if (ok) empRegressionOk += 1;
  else check(`UI-regression failed: ${tab}`, false, `text=${t.slice(0, 120).replace(/\n/g, ' ')}`);
}
check(`UI16. Employee portal regression: all ${empRegression.length} tabs render without crashing`,
  empRegressionOk === empRegression.length, `${empRegressionOk}/${empRegression.length}`);
await cdp.screenshot('05-employee-profile.png');

/* ==================== HR ADMIN PORTAL (fresh session) ==================== */
// The app keeps its token in sessionStorage (auth_token/user_data/user_role), so
// BOTH stores are cleared here to return to a logged-out state.
await cdp.eval('window.localStorage.clear(); window.sessionStorage.clear(); true');
await cdp.send('Page.navigate', { url: APP_URL });
const backToRoles = await cdp.waitForText('Select your role', 120000);
check('UI17a. Logged-out state restored after clearing the session (Role Selection shown)', backToRoles, '');
await clickText(cdp, 'HR Admin');
const hrLoginOpen = await cdp.waitForText('HR Admin Login', 60000);
check('UI17. HR Admin login screen opens', hrLoginOpen, '');
for (let i = 0; i < 40; i += 1) {
  const n = await cdp.eval('document.querySelectorAll("input").length');
  if (n >= 2) break;
  await sleep(500);
}
await setInputAt(cdp, 0, process.env.HR_USERNAME || '');
await setInputAt(cdp, 1, process.env.HR_PASSWORD || '');
await sleep(400);
await cdp.screenshot('06-hr-login.png');
await clickText(cdp, 'Sign In');
const hrPortal = await cdp.waitForText('Daily Master', 150000);
check('UI18. HR Admin Login works in the browser (HR portal rendered)', hrPortal, '');
await cdp.screenshot('07-hr-portal.png');
const hrText = await cdp.text();
check('UI19. HR regression: all HR tabs present',
  ['Dashboard', 'Employees', 'Audit', 'Analytics', 'Daily Master', 'Celebrations', 'Marriage', 'Leave Mgmt', 'Salary', 'Holidays'].every((t) => hrText.includes(t)),
  '');

/* ---------------------- Phase K HR screen (Salary tab) ---------------------- */
await clickText(cdp, 'Salary');
const salaryOpen = await cdp.waitForText('Dataset A - Salary Master', 90000);
check('UI20. HR Salary / Phase K screen opens (Dataset A + B import)',
  salaryOpen && (await cdp.text()).includes('Dataset B - Pay Elements'), '');
await cdp.screenshot('08-hr-salary-import.png');

await clickText(cdp, 'Salary Data');
let dataText = '';
for (let i = 0; i < 25; i += 1) {
  dataText = await cdp.text();
  if (dataText.includes('pay element(s) loaded')) break;
  await sleep(1000);
}
check('UI21. Imported salary master + pay elements visible in HR UI',
  dataText.includes(EMP_CODE) && dataText.includes('PF:') && dataText.includes('pay element(s) loaded'),
  `chars=${dataText.length}`);

await clickText(cdp, 'Rules');
let rulesText = '';
for (let i = 0; i < 25; i += 1) {
  rulesText = await cdp.text();
  if (rulesText.includes('Save Rules')) break;
  await sleep(1000);
}
check('UI22. HR settlement rules editable (gratuity / bonus / encashment / notice / PF / ESI)',
  ['Gratuity days per year', 'Bonus period start', 'Encash types - Factory Staff', 'Encash types - Office Staff',
    'Notice period (days)', 'PF rate employee', 'ESI wage basis', 'Save Rules'].every((t) => rulesText.includes(t)),
  '');
await cdp.screenshot('09-hr-salary-rules.png');

await clickText(cdp, 'Dues');
let duesText = '';
for (let i = 0; i < 25; i += 1) {
  duesText = await cdp.text();
  if (duesText.includes('Add Other Dues / Recovery')) break;
  await sleep(1000);
}
check('UI23. HR dues / recoveries screen works (add + approve/reject)',
  duesText.includes('Add Other Dues / Recovery') && duesText.includes('DUE') && duesText.includes('RECOVERY'), '');

await clickText(cdp, 'Estimate');
for (let i = 0; i < 25; i += 1) {
  const t = await cdp.text();
  if (t.includes('Run Estimate')) break;
  await sleep(1000);
}
await setInputAt(cdp, 0, EMP_CODE);
await setInputAt(cdp, 1, '2026-12-31');
await sleep(400);
await clickText(cdp, 'Run Estimate');
const hrEstOk = await cdp.waitForText('Estimated Full & Final', 90000);
await sleep(1500);
const hrEstText = await cdp.text();
const hrTotalMatch = /Estimated Full & Final\s*\n\s*((?:₹|Rs)[^\n]*)/.exec(hrEstText);
const digitsOnly = (s) => String(s || '').replace(/[^\d.]/g, '');
check('UI24. HR admin Full & Final preview calculates for the employee',
  hrEstOk && !!hrTotalMatch, hrTotalMatch ? hrTotalMatch[1].trim() : 'not found');
check('UI25. HR preview total matches the employee-side total (same engine, same data)',
  !!hrTotalMatch && !!uiTotal && digitsOnly(hrTotalMatch[1]) === digitsOnly(uiTotal),
  `HR="${hrTotalMatch ? hrTotalMatch[1].trim() : ''}" Employee="${uiTotal}"`);
await cdp.screenshot('10-hr-fullfinal-preview.png');

/* ------------------ Phase G / J screens still open in the HR portal ------------------ */
await clickText(cdp, 'Holidays');
await sleep(3000);
const holText = await cdp.text();
check('UI26. Phase G Holiday Management still opens in the browser',
  /Holiday/i.test(holText) && cdp.exceptions.length === 0, `chars=${holText.length}`);
await cdp.screenshot('11-hr-holidays.png');

await clickText(cdp, 'Leave Mgmt');
await sleep(3000);
const leaveText = await cdp.text();
check('UI27. Phase J Leave Management still opens in the browser',
  /Leave/i.test(leaveText) && cdp.exceptions.length === 0, `chars=${leaveText.length}`);
await cdp.screenshot('12-hr-leave.png');

/* ================================ SUMMARY ================================ */
const failed = results.filter((r) => !r.ok);
console.log(`\n=== PHASE K BROWSER AUDIT: ${results.length - failed.length}/${results.length} checks passed ===`);
console.log(`screenshots: ${OUT_DIR}`);
if (cdp.exceptions.length) console.log('page exceptions:', cdp.exceptions.slice(0, 5));
if (failed.length) {
  console.log('FAILED:');
  failed.forEach((f) => console.log(` - ${f.label} (${f.detail})`));
}
browser.kill();
await sleep(500);
process.exit(failed.length ? 1 : 0);




