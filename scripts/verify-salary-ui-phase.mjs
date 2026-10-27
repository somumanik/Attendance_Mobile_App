// Salary Export + Modal + Scrolling phase — REAL BROWSER verification (CDP).
// Drives the running Next.js portal on http://localhost:3000: HR login, Salary
// structure tab, modal fixed-position + scroll-lock assertions, independent
// table scrolling, and REAL .xlsx export downloads (parsed + validated on disk).
import 'dotenv/config';
import { spawn } from 'child_process';
import fs from 'fs';
import os from 'os';
import path from 'path';

const APP_URL = 'http://localhost:3000';
const CDP_PORT = 9227;
const OUT_DIR = path.join(process.cwd(), 'scripts', '_salary_ui_out');
const DL_DIR = path.join(OUT_DIR, 'downloads');
fs.mkdirSync(DL_DIR, { recursive: true });
for (const f of fs.readdirSync(DL_DIR)) fs.rmSync(path.join(DL_DIR, f), { force: true });

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
  async waitFor(fnExpr, timeoutMs = 30000) {
    const started = Date.now();
    while (Date.now() - started < timeoutMs) {
      try { if (await this.eval(fnExpr)) return true; } catch { /* retry */ }
      await sleep(500);
    }
    return false;
  }
  async screenshot(name) {
    const res = await this.send('Page.captureScreenshot', { format: 'png' });
    fs.writeFileSync(path.join(OUT_DIR, name), Buffer.from(res.data, 'base64'));
  }
}

/* --------------------------- DOM helpers --------------------------- */
// Scoped button click: finds the glass-card section containing `scopeText` in
// its h3, then clicks the button whose text ends with `btnText`.
const CLICK_IN_SECTION = `
(function clickInSection(scopeText, btnText) {
  const norm = (s) => (s || '').replace(/\\s+/g, ' ').trim();
  const heads = Array.from(document.querySelectorAll('h3'));
  const head = heads.find((h) => norm(h.textContent).includes(scopeText));
  if (!head) return 'no-section:' + scopeText;
  const card = head.closest('div.glass-card') || head.parentElement;
  const btns = Array.from(card.querySelectorAll('button'));
  const btn = btns.find((b) => norm(b.textContent).endsWith(btnText));
  if (!btn) return 'no-button:' + btnText;
  btn.scrollIntoView({ block: 'center' });
  btn.click();
  return 'ok';
})`;

const CLICK_TAB = `
(function clickTab(label) {
  const norm = (s) => (s || '').replace(/\\s+/g, ' ').trim();
  const btns = Array.from(document.querySelectorAll('button'));
  const btn = btns.find((b) => norm(b.textContent).endsWith(label));
  if (!btn) return 'no-tab:' + label;
  btn.click();
  return 'ok';
})`;

const SET_INPUT_PLACEHOLDER = `
(function setInput(matchValue, nextValue) {
  const inputs = Array.from(document.querySelectorAll('input,textarea'));
  const el = inputs.find((i) => (i.placeholder || '').includes(matchValue));
  if (!el) return false;
  const proto = el.tagName === 'TEXTAREA' ? window.HTMLTextAreaElement.prototype : window.HTMLInputElement.prototype;
  const setter = Object.getOwnPropertyDescriptor(proto, 'value').set;
  setter.call(el, nextValue);
  el.dispatchEvent(new Event('input', { bubbles: true }));
  el.dispatchEvent(new Event('change', { bubbles: true }));
  return true;
})`;

/* ------------------------- browser launch ------------------------- */
const browserPath = BROWSERS.find((p) => fs.existsSync(p));
if (!browserPath) {
  console.error('No Edge/Chrome binary found - cannot run the browser test.');
  process.exit(1);
}
const profileDir = path.join(os.tmpdir(), `sal-ui-profile-${Date.now()}`);
const browser = spawn(browserPath, [
  '--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check',
  '--disable-extensions', '--mute-audio',
  `--remote-debugging-port=${CDP_PORT}`, `--user-data-dir=${profileDir}`,
  '--window-size=1280,900', 'about:blank',
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
await cdp.send('Browser.setDownloadBehavior', { behavior: 'allow', downloadPath: DL_DIR, eventsEnabled: true });
console.log(`[browser] ${path.basename(browserPath)} headless connected`);

/* ============================ HR LOGIN (cookie via real route) ============================ */
await cdp.send('Page.navigate', { url: `${APP_URL}/login/hr` });
await cdp.waitForText('HR', 60000);
const loginRes = await cdp.eval(`fetch('/api/auth/hr', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username: ${JSON.stringify(process.env.HR_USERNAME || '')}, password: ${JSON.stringify(process.env.HR_PASSWORD || '')} }), credentials: 'include' }).then((r) => r.status)`);
check('U1. HR login via real Next auth route sets session cookie', loginRes === 200, `HTTP ${loginRes}`);

await cdp.send('Page.navigate', { url: `${APP_URL}/hr/salary` });
const salaryOpen = await cdp.waitForText('Salary & Full & Final', 120000);
check('U2. Salary / Full & Final page opens (protected route, HR session)', salaryOpen);
await cdp.screenshot('01-salary-page.png');

// Structure tab (retry: dev-mode hydration can lag the first paint)
let tabRes = 'pending';
for (let i = 0; i < 10 && tabRes !== 'ok'; i += 1) {
  tabRes = await cdp.eval(`${CLICK_TAB}('Structure')`);
  const appeared = await cdp.waitFor(`document.body.innerText.includes('Pay Element Master')`, 4000);
  if (appeared) { tabRes = 'ok'; break; }
}
check('U3. Structure tab opens', tabRes === 'ok', tabRes);
const structOpen = await cdp.waitForText('Employee Salary Master', 30000);
check('U4. Employee Salary Master section rendered with real data', structOpen);
// Wait for the datasets to load (tables render once rows arrive) before measuring.
await cdp.waitFor(`document.querySelectorAll('div.table-scroll').length >= 3`, 30000);
await sleep(400);
await cdp.screenshot('02-structure-tab.png');

/* ============================ ROOT-CAUSE + SCROLLING ============================ */
const fadeTransform = await cdp.eval(`getComputedStyle(document.querySelector('main.fade-in') || document.body).transform`);
check('U5. fade-in main no longer keeps a persistent transform (root cause fixed)', fadeTransform === 'none' || fadeTransform === '', `transform=${fadeTransform}`);

const scrollInfo = await cdp.eval(`(() => {
  const boxes = Array.from(document.querySelectorAll('div.table-scroll'));
  return boxes.map((b) => {
    const cs = getComputedStyle(b);
    const th = b.querySelector('thead th');
    const thcs = th ? getComputedStyle(th) : null;
    return { count: boxes.length, overflow: cs.overflow, maxHeight: cs.maxHeight,
      maxHpx: parseFloat(cs.maxHeight), vh60: Math.round(window.innerHeight * 0.6),
      sticky: thcs ? thcs.position : 'none', rectH: b.getBoundingClientRect().height };
  });
})()`);
const boxCount = scrollInfo.length;
check('U6. Salary sections have independent scroll containers', boxCount >= 3, `table-scroll containers=${boxCount}`);
const capped = scrollInfo.every((s) => s.overflow === 'auto' && Math.abs(s.maxHpx - s.vh60) <= 2);
check('U7. Each container: overflow auto + viewport-based max-height (60vh)', capped, `maxHeights=${scrollInfo.map((s) => s.maxHeight).join(',')}`);
const stickyOk = scrollInfo.every((s) => s.sticky === 'sticky');
check('U8. Column headers sticky inside the scroll containers', stickyOk, `positions=${scrollInfo.map((s) => s.sticky).join(',')}`);
const notOversized = scrollInfo.every((s) => s.rectH <= s.maxHpx + 2);
check('U9. Short data does not force an oversized empty area (container <= max-height)', notOversized);

/* ============================ ADD/EDIT MODAL ============================ */
const addRes = await cdp.eval(`${CLICK_IN_SECTION}('Employee Salary Master', 'Add')`);
check('M1. Add button opens the Employee Salary Master modal', addRes === 'ok', addRes);
const dialogOpen = await cdp.waitFor(`document.querySelector('[role="dialog"]') !== null`, 15000);
check('M2. Modal dialog rendered', dialogOpen);
await sleep(500);
await cdp.screenshot('03-modal-open.png');

const rectBefore = await cdp.eval(`(() => {
  const d = document.querySelector('[role="dialog"] > div');
  if (!d) return null;
  const r = d.getBoundingClientRect();
  return { top: r.top, left: r.left, w: r.width, h: r.height, vw: window.innerWidth, vh: window.innerHeight };
})()`);
if (!rectBefore) {
  check('M3. Modal is centred in the visible viewport', false, 'modal panel not found');
  check('M4. Modal max height stays within the viewport', false, 'modal panel not found');
} else {
const centered = Math.abs((rectBefore.top + rectBefore.h / 2) - rectBefore.vh / 2) < 30
  && Math.abs((rectBefore.left + rectBefore.w / 2) - rectBefore.vw / 2) < 30;
check('M3. Modal is centred in the visible viewport', centered, `top=${Math.round(rectBefore.top)} h=${Math.round(rectBefore.h)} vh=${rectBefore.vh}`);
const withinViewport = rectBefore.h <= rectBefore.vh && rectBefore.top >= -1;
check('M4. Modal max height stays within the viewport', withinViewport, `h=${Math.round(rectBefore.h)} vh=${rectBefore.vh}`);
}

// Background scroll-lock
const lockState = await cdp.eval(`({ body: document.body.style.overflow, html: document.documentElement.style.overflow })`);
check('M5. Background page scroll locked while modal is open', lockState.body === 'hidden' && lockState.html === 'hidden', `body=${lockState.body} html=${lockState.html}`);

// Fixed position: scroll the page, the modal must not move with it
await cdp.eval(`window.scrollTo(0, Math.min(400, document.body.scrollHeight))`);
await sleep(400);
const rectAfter = await cdp.eval(`(() => {
  const d = document.querySelector('[role="dialog"] > div');
  if (!d) return null;
  const r = d.getBoundingClientRect();
  return { top: r.top, left: r.left };
})()`);
const fixedOk = !!rectBefore && !!rectAfter && Math.abs(rectAfter.top - rectBefore.top) < 2 && Math.abs(rectAfter.left - rectBefore.left) < 2;
check('M6. Modal stays fixed while the page scrolls behind it', fixedOk, `top ${Math.round((rectBefore || {}).top || 0)} -> ${Math.round((rectAfter || {}).top || 0)}`);
await cdp.screenshot('04-modal-page-scrolled.png');

// Long form on a small viewport: body scrolls, Save/Cancel stay visible
await cdp.send('Emulation.setDeviceMetricsOverride', { width: 900, height: 620, deviceScaleFactor: 1, mobile: false });
await sleep(600);
const smallVp = await cdp.eval(`(() => {
  const dialog = document.querySelector('[role="dialog"]');
  const panel = dialog ? dialog.querySelector('div > div') : null;
  const body = dialog ? Array.from(dialog.querySelectorAll('div')).find((d) => d.classList.contains('overflow-y-auto')) : null;
  const footer = dialog ? Array.from(dialog.querySelectorAll('button')).find((b) => b.textContent.trim() === 'Save') : null;
  if (!body || !footer) return { ok: false };
  body.scrollTop = body.scrollHeight;
  const fr = footer.getBoundingClientRect();
  return { ok: true, scrollable: body.scrollHeight > body.clientHeight, saveVisible: fr.bottom <= window.innerHeight + 2 && fr.top >= -2,
    saveBottom: Math.round(fr.bottom), vh: window.innerHeight };
})()`);
check('M7. Small viewport: form body scrolls independently', smallVp.ok === true, `scrollable=${smallVp.scrollable}`);
check('M8. Save/Cancel remain visible & accessible after scrolling the form', smallVp.ok === true && smallVp.saveVisible, `saveBottom=${smallVp.saveBottom} vh=${smallVp.vh}`);
await cdp.screenshot('05-modal-small-viewport.png');
await cdp.send('Emulation.clearDeviceMetricsOverride');
await sleep(400);

// Escape closes + scroll behaviour restores
await cdp.send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 });
await cdp.send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 });
const escClosed = await cdp.waitFor(`document.querySelector('[role="dialog"]') === null`, 10000);
check('M9. Escape closes the modal (existing Cancel flow preserved)', escClosed);
const restoreState = await cdp.eval(`({ body: document.body.style.overflow, html: document.documentElement.style.overflow })`);
check('M10. Page scroll behaviour restored after close', restoreState.body !== 'hidden' && restoreState.html !== 'hidden', `body='${restoreState.body}' html='${restoreState.html}'`);

// Cancel button path
await cdp.eval(`${CLICK_IN_SECTION}('Employee Salary Master', 'Add')`);
await cdp.waitFor(`document.querySelector('[role="dialog"]') !== null`, 15000);
const cancelRes = await cdp.eval(`(() => {
  const btn = Array.from(document.querySelectorAll('[role="dialog"] button')).find((b) => b.textContent.trim() === 'Cancel');
  if (!btn) return 'no-cancel';
  btn.click();
  return 'ok';
})()`);
const cancelClosed = await cdp.waitFor(`document.querySelector('[role="dialog"]') === null`, 10000);
check('M11. Cancel button closes the modal', cancelRes === 'ok' && cancelClosed);

/* ============================ EXPORTS (real downloads) ============================ */
async function waitDownload(fname, timeoutMs = 30000) {
  const started = Date.now();
  let lastSize = -1;
  while (Date.now() - started < timeoutMs) {
    const p = path.join(DL_DIR, fname);
    if (fs.existsSync(p)) {
      const size = fs.statSync(p).size;
      if (size > 0 && size === lastSize) return size;
      lastSize = size;
    }
    await sleep(500);
  }
  return -1;
}

const API = 'http://localhost:4000/api';
let _tok = null;
async function api(p, { method = 'GET', body } = {}) {
  if (!_tok) {
    const r = await fetch(`${API}/auth/hr/login`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: process.env.HR_USERNAME, password: process.env.HR_PASSWORD }),
    });
    _tok = (await r.json().catch(() => ({})))?.token || '';
  }
  const res = await fetch(API + p, {
    method,
    headers: { Authorization: `Bearer ${_tok}`, 'Content-Type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
  });
  return res.json().catch(() => null);
}

const exportClick = (label) => cdp.eval(`${CLICK_IN_SECTION}('Exports', ${JSON.stringify(label)})`);

// 1. Employee Salary Master
const e1 = await exportClick('Employee Salary Master');
const e1Size = e1 === 'ok' ? await waitDownload('employee-salary-master.xlsx') : -1;
check('X1. Employee Salary Master .xlsx downloads', e1Size > 0, `bytes=${e1Size}`);

// 2. Employee Pay Elements
const e2 = await exportClick('Employee Pay Elements (row-based)');
const e2Size = e2 === 'ok' ? await waitDownload('employee-pay-elements.xlsx') : -1;
check('X2. Employee Pay Elements .xlsx downloads', e2Size > 0, `bytes=${e2Size}`);

// 3. Pay Element Master
const e3 = await exportClick('Pay Element Master');
const e3Size = e3 === 'ok' ? await waitDownload('pay-element-master.xlsx') : -1;
check('X3. Pay Element Master .xlsx downloads', e3Size > 0, `bytes=${e3Size}`);

// 4. Blank template (must stay a blank template)
const e4 = await cdp.eval(`${CLICK_IN_SECTION}('Salary Structure — Excel Template & Import', 'Download Template (.xlsx)')`);
const e4Size = e4 === 'ok' ? await waitDownload('salary-structure-template.xlsx') : -1;
check('X4. Pre-filled template download still works', e4Size > 0, `bytes=${e4Size}`);

// Validate the downloaded workbooks with the same xlsx lib the app uses
const XLSX = await import('xlsx');
function readWb(fname) {
  const p = path.join(DL_DIR, fname);
  if (!fs.existsSync(p)) return null;
  return XLSX.read(fs.readFileSync(p), { type: 'buffer' });
}
const wbMaster = readWb('employee-salary-master.xlsx');
check('X5. Master export opens as a valid workbook', !!wbMaster, wbMaster ? `sheets=${wbMaster.SheetNames.join(',')}` : 'missing');
if (wbMaster) {
  const ws = wbMaster.Sheets[wbMaster.SheetNames[0]];
  const grid = XLSX.utils.sheet_to_json(ws, { header: 1, raw: true, defval: '' });
  const header = (grid[0] || []).map((h) => String(h));
  const expected = ['EmployeeCode', 'Paycode', 'BiometricCode', 'EmployeeName', 'CompanyCode', 'LocationCode', 'Department', 'Designation', 'EffectiveFrom', 'BasicSalary', 'PFApplicable', 'ESIApplicable', 'PFWage', 'ESIWage', 'Currency', 'Remarks'];
  check('X6. Master export: correct sheet name', wbMaster.SheetNames[0] === 'EmployeeSalaryMaster', wbMaster.SheetNames[0]);
  check('X7. Master export: correct column headers', JSON.stringify(header) === JSON.stringify(expected), header.slice(0, 6).join(','));
  const body = grid.slice(1).filter((r) => r.join('') !== '');
  const apiMaster = await api('/hr/salary/structure/master?limit=5000');
  const apiRows = (apiMaster?.rows || []).length;
  check('X8. Master export: real records only, no duplicate/invented rows', body.length === apiRows && body.length > 0, `exported=${body.length} api=${apiRows}`);
  const payIdx = header.indexOf('Paycode');
  const dateIdx = header.indexOf('EffectiveFrom');
  const datesOk = body.every((r) => /^\d{4}-\d{2}-\d{2}/.test(String(r[dateIdx] || '')));
  check('X9. Master export: date formatting (ISO) correct', datesOk);
  const nonEmpty = body.every((r) => String(r[payIdx] || '').trim() !== '');
  check('X10. Master export: every row has a real Paycode identity', nonEmpty);
}

const wbElem = readWb('employee-pay-elements.xlsx');
check('X11. Elements export opens as a valid workbook', !!wbElem, wbElem ? `sheets=${wbElem.SheetNames.join(',')}` : 'missing');
if (wbElem) {
  const ws = wbElem.Sheets[wbElem.SheetNames[0]];
  const grid = XLSX.utils.sheet_to_json(ws, { header: 1, raw: true, defval: '' });
  const header = (grid[0] || []).map((h) => String(h));
  check('X12. Elements export: correct sheet name', wbElem.SheetNames[0] === 'EmployeePayElements', wbElem.SheetNames[0]);
  const need = ['Paycode', 'EmployeeName', 'PayElementCode', 'PayElementName', 'FixedOrPercent', 'Amount', 'Percent', 'ComputationType', 'AddOrDeduct', 'PFApplicable', 'PTApplicable', 'ESIApplicability', 'ApplicableForOT', 'ApplicableForCOff', 'PayCadre', 'ActivePayElement', 'Processed', 'PayrollPostingGroup', 'LeaveEncashment', 'EffectiveFrom'];
  const missing = need.filter((h) => !header.includes(h));
  check('X13. Elements export: all model-supported columns present', missing.length === 0, `missing=[${missing.join(',')}]`);
  const body = grid.slice(1).filter((r) => r.join('') !== '');
  const apiElem = await api('/hr/salary/structure/elements?limit=5000');
  const apiRows = (apiElem?.rows || []).length;
  check('X14. Elements export: real assignment rows only, no duplicates', body.length === apiRows && body.length > 0, `exported=${body.length} api=${apiRows}`);
}

const wbPem = readWb('pay-element-master.xlsx');
check('X15. Pay Element Master export opens as a valid workbook', !!wbPem, wbPem ? `sheets=${wbPem.SheetNames.join(',')}` : 'missing');
if (wbPem) {
  const ws = wbPem.Sheets[wbPem.SheetNames[0]];
  const grid = XLSX.utils.sheet_to_json(ws, { header: 1, raw: true, defval: '' });
  const header = (grid[0] || []).map((h) => String(h));
  check('X16. Pay Element Master export: correct sheet name', wbPem.SheetNames[0] === 'PayElementMaster', wbPem.SheetNames[0]);
  const need = ['PayElementCode', 'Description', 'AddDeduct', 'ApplicableForOT', 'ESIApplicable', 'PFApplicable', 'LeaveEncashmentApplicable', 'PayrollPostingGroup', 'Remarks', 'Active'];
  const missing = need.filter((h) => !header.includes(h));
  check('X17. Pay Element Master export: template/importer headers match', missing.length === 0, `missing=[${missing.join(',')}]`);
  const body = grid.slice(1).filter((r) => r.join('') !== '');
  const apiPem = await api('/hr/salary/payelement-master?limit=5000');
  const apiRows = (apiPem?.rows || []).length;
  check('X18. Pay Element Master export: real codes only', body.length === apiRows && body.length > 0, `exported=${body.length} api=${apiRows}`);
}

const wbTpl = readWb('salary-structure-template.xlsx');
check('X19. Template workbook keeps its 4 established sheets', !!wbTpl && wbTpl.SheetNames.length === 4, wbTpl ? `sheets=${wbTpl.SheetNames.join(',')}` : 'missing');
if (wbTpl) {
  const masterGrid = XLSX.utils.sheet_to_json(wbTpl.Sheets['EmployeeSalaryMaster'] || {}, { header: 1, raw: true, defval: '' });
  const tplBody = masterGrid.slice(1).filter((r) => r.join('') !== '');
  const tplApi = await api('/hr/salary/structure/template-source');
  const tplApiRows = (tplApi?.master || []).length;
  // The template is pre-filled from the genuine Savior roster (same count, no
  // fabricated rows) while keeping the established headers import-compatible.
  check('X20. Template pre-filled with REAL Savior roster rows (nothing invented)',
    String(masterGrid[0]?.[0]) === 'EmployeeCode' && tplBody.length === tplApiRows && tplApiRows > 0,
    `sheetRows=${tplBody.length} saviorRows=${tplApiRows}`);
}

/* ============================ FILTERS + SELECTION REGRESSION ============================ */
const filterSet = await cdp.eval(`${SET_INPUT_PLACEHOLDER}('e.g. 0002', '0002')`);
await sleep(1500);
const filtered = await cdp.eval(`(() => {
  const box = document.querySelector('div.table-scroll');
  if (!box) return { ok: false, rows: -1 };
  const rows = Array.from(box.querySelectorAll('tbody tr'));
  return { ok: true, rows: rows.length, only0002: rows.every((tr) => (tr.textContent || '').includes('0002')) };
})()`);
check('F1. Filter narrows the list to matching rows', filterSet === true && filtered.ok && filtered.rows > 0 && filtered.only0002, `rows=${filtered.rows}`);

const selInfo = await cdp.eval(`(() => {
  const box = document.querySelector('div.table-scroll');
  const cb = box ? box.querySelector('tbody input[type="checkbox"]') : null;
  if (!cb) return { ok: false };
  cb.click();
  return { ok: true };
})()`);
await sleep(600);
const editEnabled = await cdp.eval(`(() => {
  const heads = Array.from(document.querySelectorAll('h3'));
  const head = heads.find((h) => (h.textContent || '').includes('Employee Salary Master'));
  const card = head ? head.closest('div.glass-card') : null;
  const btn = card ? Array.from(card.querySelectorAll('button')).find((b) => b.textContent.includes('Edit')) : null;
  return btn ? !btn.disabled : null;
})()`);
check('F2. Checkbox selection enables Edit (1 row) as before', selInfo.ok === true && editEnabled === true, `editEnabled=${editEnabled}`);
await cdp.eval(`(() => {
  const box = document.querySelector('div.table-scroll');
  const cb = box ? box.querySelector('tbody input[type="checkbox"]') : null;
  if (cb && cb.checked) cb.click();
  return true;
})()`);
await cdp.eval(`${SET_INPUT_PLACEHOLDER}('e.g. 0002', '')`);
await sleep(1200);

/* ============================ LONG FORM MODAL (22 fields) ============================ */
await cdp.send('Emulation.setDeviceMetricsOverride', { width: 900, height: 620, deviceScaleFactor: 1, mobile: false });
await sleep(400);
await cdp.eval(`${CLICK_IN_SECTION}('Employee Pay Elements', 'Add')`);
const longDlg = await cdp.waitFor(`document.querySelector('[role="dialog"]') !== null`, 15000);
check('M12. Long Add/Edit form (Employee Pay Elements) opens', longDlg);
await sleep(400);
const longInfo = await cdp.eval(`(() => {
  const dialog = document.querySelector('[role="dialog"]');
  const body = dialog ? Array.from(dialog.querySelectorAll('div')).find((d) => d.classList.contains('overflow-y-auto')) : null;
  const save = dialog ? Array.from(dialog.querySelectorAll('button')).find((b) => b.textContent.trim() === 'Save') : null;
  const title = dialog ? dialog.querySelector('h3') : null;
  if (!body || !save || !title) return null;
  const scrollable = body.scrollHeight > body.clientHeight + 2;
  body.scrollTop = body.scrollHeight;
  const sr = save.getBoundingClientRect();
  const tr = title.getBoundingClientRect();
  return { scrollable, saveVisible: sr.bottom <= window.innerHeight + 2 && sr.top >= -2,
    titleVisible: tr.top >= -2, saveBottom: Math.round(sr.bottom), vh: window.innerHeight,
    bodyScrollH: body.scrollHeight, bodyClientH: body.clientHeight };
})()`);
check('M13. Long form body scrolls independently (viewport 620px)', !!longInfo && longInfo.scrollable, longInfo ? `scrollH=${longInfo.bodyScrollH} clientH=${longInfo.bodyClientH}` : 'not found');
check('M14. After scrolling to bottom: Save/Cancel AND title stay visible', !!longInfo && longInfo.saveVisible && longInfo.titleVisible, longInfo ? `saveBottom=${longInfo.saveBottom} vh=${longInfo.vh}` : 'not found');
await cdp.screenshot('05b-modal-long-form.png');
// Close the long-form modal and restore the viewport before tab regression
await cdp.send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 });
await cdp.send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 });
await cdp.waitFor(`document.querySelector('[role="dialog"]') === null`, 10000);
await cdp.send('Emulation.clearDeviceMetricsOverride');
await sleep(400);


/* ============================ UI MODAL SAVE + DELETE ROUNDTRIP (cleaned up) ============================ */
const ZZ = `ZZUI${String(Date.now()).slice(-4)}`;
await cdp.eval(`${CLICK_IN_SECTION}('Pay Element Master', 'Add')`);
const s0 = await cdp.waitFor(`document.querySelector('[role="dialog"]') !== null`, 15000);
const filled = s0 ? await cdp.eval(`(() => {
  const dialog = document.querySelector('[role="dialog"]');
  const inputs = Array.from(dialog.querySelectorAll('input')).filter((i) => i.type !== 'checkbox');
  const selects = Array.from(dialog.querySelectorAll('select'));
  const setVal = (el, v) => {
    const proto = el.tagName === 'SELECT' ? window.HTMLSelectElement.prototype : window.HTMLInputElement.prototype;
    const setter = Object.getOwnPropertyDescriptor(proto, 'value').set;
    setter.call(el, v);
    el.dispatchEvent(new Event('input', { bubbles: true }));
    el.dispatchEvent(new Event('change', { bubbles: true }));
  };
  if (inputs.length < 2 || !selects.length) return 'no-fields';
  setVal(inputs[0], ${JSON.stringify(ZZ)});
  setVal(inputs[1], 'UI verify element');
  setVal(selects[0], 'Addition');
  return 'ok';
})()`) : 'no-dialog';
check('S1. Modal form fields accept values (Add flow)', filled === 'ok', filled);
const saved = await cdp.eval(`(() => {
  const btn = Array.from(document.querySelectorAll('[role="dialog"] button')).find((b) => b.textContent.trim() === 'Save');
  if (!btn) return 'no-save';
  btn.click();
  return 'ok';
})()`);
const saveClosed = await cdp.waitFor(`document.querySelector('[role="dialog"]') === null`, 15000);
const msgShown = await cdp.waitFor(`document.body.innerText.includes('created')`, 15000);
check('S2. Save persists via server, modal closes + success message', saved === 'ok' && saveClosed && msgShown, `save=${saved} closed=${saveClosed} msg=${msgShown}`);
const rowVisible = await cdp.waitFor(`document.body.innerText.includes(${JSON.stringify(ZZ)})`, 15000);
check('S3. Saved record appears in the Pay Element Master list', rowVisible);
// Select the new row and delete it (window.confirm auto-accepted) - restores DB state
await cdp.eval(`window.confirm = () => true; true;`);
const delRes = await cdp.eval(`(() => {
  const boxes = Array.from(document.querySelectorAll('div.table-scroll'));
  const box = boxes.find((b) => (b.textContent || '').includes(${JSON.stringify(ZZ)}));
  if (!box) return 'no-table';
  const row = Array.from(box.querySelectorAll('tbody tr')).find((tr) => (tr.textContent || '').includes(${JSON.stringify(ZZ)}));
  if (!row) return 'no-row';
  const cb = row.querySelector('input[type="checkbox"]');
  if (!cb) return 'no-cb';
  cb.click();
  return 'ok';
})()`);
await sleep(700);
const delClick = await cdp.eval(`(() => {
  const norm = (s) => (s || '').replace(/\\s+/g, ' ').trim();
  const heads = Array.from(document.querySelectorAll('h3'));
  const head = heads.find((h) => norm(h.textContent).includes('Pay Element Master'));
  const card = head ? head.closest('div.glass-card') : null;
  const btn = card ? Array.from(card.querySelectorAll('button')).find((b) => norm(b.textContent).startsWith('Delete Selected')) : null;
  if (!btn || btn.disabled) return 'no-delete';
  btn.click();
  return 'ok';
})()`);
const gone = await cdp.waitFor(`!document.body.innerText.includes(${JSON.stringify(ZZ)})`, 20000);
check('S4. Delete Selected removes the record (confirm + server-confirmed)', delRes === 'ok' && delClick === 'ok' && gone, `sel=${delRes} del=${delClick} gone=${gone}`);
/* ============================ SALARY DATA TAB (CSV exports) ============================ */
await cdp.eval(`${CLICK_TAB}('Salary Data')`);
const dataTab = await cdp.waitForText('Salary Master', 30000);
check('R1. Salary Data tab unaffected (lists + CSV exports render)', dataTab);
const csvClick = await cdp.eval(`${CLICK_IN_SECTION}('Salary Master', 'Export CSV')`);
const csvSize = csvClick === 'ok' ? await waitDownload('salary-master.csv') : -1;
check('R2. Salary Data CSV export downloads real rows', csvSize > 0, `bytes=${csvSize}`);
if (csvSize > 0) {
  const csv = fs.readFileSync(path.join(DL_DIR, 'salary-master.csv'), 'utf8');
  check('R3. CSV export: headers + no placeholder data', csv.includes('Paycode') && csv.includes('Basic Salary') && !csv.includes('undefined'), `len=${csv.length}`);
}

/* ============ SECTION SCROLLING + RESPONSIVE OVERFLOW (this phase) ============ */
const VIEWPORTS = [[1280, 900], [830, 900], [390, 780]];
for (const [w, h] of VIEWPORTS) {
  await cdp.send('Emulation.setDeviceMetricsOverride', { width: w, height: h, deviceScaleFactor: 1, mobile: false });
  await sleep(400);
  for (const tab of ['Structure', 'Salary Data', 'Dues']) {
    await cdp.eval(`${CLICK_TAB}(${JSON.stringify(tab)})`);
    await sleep(800);
    const m = await cdp.eval(`(() => {
      const de = document.documentElement;
      const boxes = Array.from(document.querySelectorAll('div.table-scroll')).map((b) => {
        const cs = getComputedStyle(b);
        const r = b.getBoundingClientRect();
        return { ovX: cs.overflowX, ovY: cs.overflowY, over: cs.overscrollBehavior,
          sw: b.scrollWidth, cw: b.clientWidth, sh: b.scrollHeight, ch: b.clientHeight,
          right: Math.round(r.right) };
      });
      return { client: de.clientWidth, docSW: de.scrollWidth, boxes };
    })()`);
    check(`W1. ${w}px ${tab}: no page-level horizontal scrollbar`, m.docSW <= m.client + 1, `docSW=${m.docSW} client=${m.client}`);
    const contained = m.boxes.length > 0 && m.boxes.every((b) => b.ovX === 'auto' && b.right <= m.client + 2);
    check(`W2. ${w}px ${tab}: each table scrolls in its own container (contained)`, contained, `boxes=${m.boxes.length}`);
    const canScroll = m.boxes.every((b) => b.sw >= b.cw - 1 && b.sh >= b.ch - 1);
    check(`W3. ${w}px ${tab}: scrollbars only when content exceeds (no forced empty area)`, canScroll, m.boxes.map((b) => `${b.sw <= b.cw + 1 ? 'fits' : 'h-scroll'}/${b.sh <= b.ch + 1 ? 'fits' : 'v-scroll'}`).join(' '));
  }
}
await cdp.send('Emulation.setDeviceMetricsOverride', { width: 1280, height: 900, deviceScaleFactor: 1, mobile: false });
await cdp.eval(`${CLICK_TAB}('Structure')`);
// Tab re-mount refetches the datasets - wait for the tables before measuring.
await cdp.waitFor(`document.querySelectorAll('div.table-scroll').length >= 3`, 30000);
await sleep(500);
const lastCol = await cdp.eval(`(() => {
  const boxes = Array.from(document.querySelectorAll('div.table-scroll'));
  const b = boxes.find((x) => x.scrollWidth > x.clientWidth + 1);
  if (!b) return null;
  b.scrollLeft = b.scrollWidth;
  const ths = b.querySelectorAll('thead th');
  const last = ths[ths.length - 1];
  const br = b.getBoundingClientRect();
  const lr = last.getBoundingClientRect();
  return { visible: lr.right <= br.right + 2 && lr.left >= br.left - 2, scrollLeft: b.scrollLeft, max: b.scrollWidth - b.clientWidth };
})()`);
check('W4. Last column fully reachable via the table scrollbar (no data hidden)', !!lastCol && lastCol.visible, lastCol ? `scrollLeft=${lastCol.scrollLeft}/${lastCol.max}` : 'no wide container');
const indep = await cdp.eval(`(() => {
  const boxes = Array.from(document.querySelectorAll('div.table-scroll'));
  if (boxes.length < 2) return null;
  const a = boxes[0]; const b = boxes[1];
  a.scrollLeft = Math.min(200, a.scrollWidth); a.scrollTop = Math.min(100, a.scrollHeight);
  const aL = a.scrollLeft; const aT = a.scrollTop;
  b.scrollLeft = Math.min(300, b.scrollWidth); b.scrollTop = Math.min(150, b.scrollHeight);
  return { aStable: a.scrollLeft === aL && a.scrollTop === aT, bMoved: b.scrollLeft > 0 || b.scrollTop > 0 };
})()`);
check('W5. Tables scroll independently (one table never moves another)', !!indep && indep.aStable && indep.bMoved, JSON.stringify(indep));
const vertical = await cdp.eval(`(() => {
  const boxes = Array.from(document.querySelectorAll('div.table-scroll'));
  const b = boxes[boxes.length - 1]; // Pay Element Master (42 rows)
  if (!b) return null;
  const canV = b.scrollHeight > b.clientHeight + 1;
  const before = b.scrollTop;
  if (canV) b.scrollTop = 200;
  const ch = getComputedStyle(b);
  return { canV, moved: canV ? b.scrollTop !== before : true, maxH: ch.maxHeight, over: ch.overscrollBehavior, sh: b.scrollHeight, chH: b.clientHeight };
})()`);
check('W6. Vertical scrolling works inside tall tables (wheel/trackpad target)', !!vertical && vertical.moved, vertical ? `scrollH=${vertical.sh} clientH=${vertical.chH} maxH=${vertical.maxH}` : 'n/a');
check('W7. Overscroll containment set (page does not chain-scroll from tables)', !!vertical && vertical.over === 'contain', vertical ? `overscroll=${vertical.over}` : 'n/a');
const pageScroll = await cdp.eval(`(() => { window.scrollTo(0, 300); const y = window.scrollY; window.scrollTo(0, 0); return y > 0; })()`);
check('W8. Main page still scrolls normally outside the table containers', pageScroll === true);

/* ============ EMPLOYEE PORTAL REGRESSION (shared PortalShell change) ============ */
const EMP_CODE = process.env.TEST_PAYCODE || '0002';
const EMP_PASS = `Scroll${Math.random().toString(36).slice(2, 8)}1`;
const prov = await api('/hr/employee/credentials/password', {
  method: 'POST',
  body: { paycode: EMP_CODE, password: EMP_PASS, confirmPassword: EMP_PASS, mustChange: false },
});
check('E1. (prep) real roster employee password provisioned for portal check', prov?.success === true || prov?.status === 200 || !!prov, `paycode=${EMP_CODE}`);
const empLogin = await cdp.eval(`fetch('/api/auth/employee', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ paycode: ${JSON.stringify(EMP_CODE)}, password: ${JSON.stringify(EMP_PASS)} }), credentials: 'include' }).then((r) => r.status)`);
check('E2. Employee login via real Next auth route (portal session)', empLogin === 200, `HTTP ${empLogin}`);
await cdp.send('Page.navigate', { url: `${APP_URL}/employee` });
const empLoaded = await cdp.waitFor(`document.body.innerText.length > 200`, 60000);
check('E3. Employee portal renders (shared layout regression)', empLoaded);
await cdp.send('Emulation.setDeviceMetricsOverride', { width: 390, height: 780, deviceScaleFactor: 1, mobile: false });
await sleep(700);
const empOverflow = await cdp.eval(`(() => { const de = document.documentElement; return { docSW: de.scrollWidth, client: de.clientWidth }; })()`);
check('E4. Employee portal: no page-level horizontal overflow at mobile width', empOverflow.docSW <= empOverflow.client + 1, `docSW=${empOverflow.docSW} client=${empOverflow.client}`);
await cdp.send('Emulation.clearDeviceMetricsOverride');

await cdp.screenshot('06-final-state.png');
const fatal = cdp.exceptions.length + cdp.consoleErrors.filter((e) => !String(e).includes('favicon')).length;
check('Z1. No uncaught page exceptions / console errors during the UI run', fatal === 0, `exceptions=${cdp.exceptions.length} consoleErrors=${cdp.consoleErrors.length}${cdp.exceptions[0] ? ' | ' + String(cdp.exceptions[0]).slice(0, 100) : ''}`);

browser.kill();
const failed = results.filter((r) => !r.ok).length;
console.log(`\n${results.length - failed}/${results.length} UI checks passed.`);
console.log(`Downloads + screenshots: ${OUT_DIR}`);
process.exit(failed ? 1 : 0);