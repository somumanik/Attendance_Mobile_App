// PHASE 6.2B — MOBILE APP real-browser verification (headless CDP) against the
// running Expo web app on :8081. Flow: Role Selection -> HR Admin login ->
// All Employees tab -> search -> View modal -> REAL shift code/timings assert.
// READ-ONLY: sirf UI drive + assertions; koi DB write nahi.
import 'dotenv/config';
import { spawn } from 'child_process';
import fs from 'fs';
import path from 'path';

const APP_URL = process.env.PHASE62B_APP || 'http://localhost:8081';
const CDP_PORT = 9224;
const OUT_DIR = path.join(process.cwd(), 'scripts', '_phase62b_ui');
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
      try {
        const ok = await this.eval(`document.body ? document.body.innerText.includes(${JSON.stringify(needle)}) : false`);
        if (ok) return true;
      } catch { /* navigation ke beech eval fail — retry */ }
      await sleep(800);
    }
    return false;
  }
  async screenshot(name) {
    try {
      const res = await this.send('Page.captureScreenshot', { format: 'png' });
      fs.writeFileSync(path.join(OUT_DIR, name), Buffer.from(res.data, 'base64'));
    } catch {}
  }
}

// RN-web TouchableOpacity/Text click: exact innerText match (last one), pointer events.
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

// RN-web TextInput fill by placeholder (native setter + input event).
const SET_INPUT_PH = `
(function setInputPh(ph, v) {
  const inputs = Array.from(document.querySelectorAll('input,textarea'));
  const el = inputs.find((i) => (i.placeholder || '').includes(ph));
  if (!el) return false;
  const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
  setter.call(el, v);
  el.dispatchEvent(new Event('input', { bubbles: true }));
  el.dispatchEvent(new Event('change', { bubbles: true }));
  return true;
})`;

if (!fs.existsSync(OUT_DIR)) fs.mkdirSync(OUT_DIR, { recursive: true });
const browserPath = BROWSERS.find((p) => fs.existsSync(p));
if (!browserPath) {
  console.error('No Edge/Chrome binary found - cannot run the browser test.');
  process.exit(1);
}

let browser = null;
try {
  let up = false;
  try { const r = await fetch(APP_URL); up = r.ok; } catch {}
  check('Expo web mobile app up on :8081', up);
  if (!up) throw new Error('Expo web app not running');

  browser = spawn(browserPath, [
    '--remote-debugging-port=' + CDP_PORT, '--headless=new', '--no-first-run',
    '--no-default-browser-check', '--user-data-dir=' + path.join(OUT_DIR, 'profile'),
    'about:blank',
  ], { stdio: 'ignore' });
  await sleep(2500);

  let wsUrl = null;
  for (let i = 0; i < 40; i++) {
    try {
      const list = await (await fetch('http://127.0.0.1:' + CDP_PORT + '/json')).json();
      const page = list.find((t) => t.type === 'page');
      if (page) { wsUrl = page.webSocketDebuggerUrl; break; }
    } catch {}
    await sleep(1000);
  }
  if (!wsUrl) throw new Error('CDP page target not found');
  const cdp = new Cdp(wsUrl);
  await cdp.connect();
  await cdp.send('Page.enable');
  await cdp.send('Runtime.enable');
  await cdp.send('Page.navigate', { url: APP_URL });
  await sleep(3000);

  // 1) Role Selection -> HR Admin
  const roleOk = await cdp.waitForText('HR Admin');
  check('Mobile app loads (Role Selection visible)', roleOk);
  await cdp.eval(CLICK_HELPER + "('HR Admin')");
  const loginOk = await cdp.waitForText('Sign In');
  check('HR Admin login screen reachable', loginOk);

  // 2) HR login (existing flow untouched)
  for (let i = 0; i < 10; i++) {
    await cdp.eval(SET_INPUT_PH + "('HR001', " + JSON.stringify(process.env.HR_USERNAME || 'HR001') + ')');
    await cdp.eval(SET_INPUT_PH + "('\u2022\u2022\u2022\u2022\u2022\u2022\u2022\u2022', " + JSON.stringify(process.env.HR_PASSWORD || 'Admin@123') + ')');
    const both = await cdp.eval(`Array.from(document.querySelectorAll('input')).some(i => i.value === ${JSON.stringify('HR001')}) && Array.from(document.querySelectorAll('input')).some(i => i.value.length > 0 && i.type === 'password')`);
    if (both) break;
    await sleep(800);
  }
  await cdp.eval(CLICK_HELPER + "('Sign In')");
  const dashOk = await cdp.waitForText('Employees', 60000);
  check('HR login works (HR tab bar with Employees visible)', dashOk);
  await cdp.screenshot('01-hr-dashboard.png');

  // 3) All Employees tab -> search S00069 -> View
  await cdp.eval(CLICK_HELPER + "('Employees')");
  // Hinglish: RN-web TextInput ka placeholder DOM attribute hota hai, innerText nahi —
  // isliye input element ki presence DOM se check karte hain.
  let searchOk = false;
  for (let i = 0; i < 30; i++) {
    try { searchOk = await cdp.eval("!!document.querySelector('input[placeholder*=\"Search\"]')"); } catch {}
    if (searchOk) break;
    await sleep(800);
  }
  check('All Employees tab opens (search box present)', searchOk);
  await cdp.eval(SET_INPUT_PH + "('Search Name or ID', 'S00069')");
  const found = await cdp.waitForText('Mohit Kumar');
  check('Search S00069 finds real employee (Mohit Kumar)', found);
  await cdp.eval(CLICK_HELPER + "('View')");
  const modalOk = await cdp.waitForText('Employee Details');
  check('View modal opens', modalOk);
  await sleep(1500);
  const bodyS = await cdp.text();
  check('MOBILE VIEW shows REAL shift for S00069: Shift Code: GEM', bodyS.includes('Shift Code: GEM'), 'from live Savior tblemployeeshiftmaster');
  check('S00069 shift timings rendered (10:00 AM / 07:00 PM)', bodyS.includes('Shift Start: 10:00 AM') && bodyS.includes('Shift End: 07:00 PM'));
  check('S00069 popup: Shift Name REMOVED', !bodyS.includes('Shift Name:'));
  check('S00069 popup: Shift Company REMOVED', !bodyS.includes('Shift Company'));
  check('NO stale "Not available (UNRESOLVED)" for S00069', !bodyS.includes('Not available (UNRESOLVED)'));
  await cdp.screenshot('02-s00069-view.png');

  // 4) Close modal -> search 1053 -> View (second employee, different shift)
  await cdp.eval(CLICK_HELPER + "('\u2715')");
  await sleep(800);
  await cdp.eval(SET_INPUT_PH + "('Search Name or ID', '1053')");
  const found2 = await cdp.waitForText('Manik K Chaudhari');
  check('Search 1053 finds real employee (Manik K Chaudhari)', found2);
  await cdp.eval(CLICK_HELPER + "('View')");
  await cdp.waitForText('Employee Details');
  await sleep(1500);
  const body2 = await cdp.text();
  check('MOBILE VIEW shows REAL shift for 1053: Shift Code: GEN', body2.includes('Shift Code: GEN'));
  check('1053 shift timings rendered (10:00 AM / 07:00 PM)', body2.includes('Shift Start: 10:00 AM') && body2.includes('Shift End: 07:00 PM'));
  check('1053 popup: Shift Name / Shift Company REMOVED', !body2.includes('Shift Name:') && !body2.includes('Shift Company'));
  check('NO stale "Not available (UNRESOLVED)" for 1053', !body2.includes('Not available (UNRESOLVED)'));
  await cdp.screenshot('03-1053-view.png');

  const realErrors = cdp.exceptions.concat(cdp.consoleErrors).filter((e) => !String(e).includes('favicon') && !String(e).includes('Download the React DevTools'));
  check('No JS exceptions during mobile flows', realErrors.length === 0, realErrors.slice(0, 3).join(' | '));
} catch (err) {
  check('mobile browser run completed without exception', false, String(err && err.message ? err.message : err));
} finally {
  if (browser) { try { browser.kill(); } catch {} }
}

const passed = results.filter((r) => r.ok).length;
const failed = results.length - passed;
console.log('');
console.log('=== SUMMARY: ' + passed + ' PASS / ' + failed + ' FAIL (of ' + results.length + ') ===');
fs.writeFileSync('scripts/phase62b-ui-out.txt', results.map((r) => (r.ok ? 'PASS' : 'FAIL') + ' | ' + r.label + ' | ' + r.detail).join('\n') + '\n\n=== SUMMARY: ' + passed + ' PASS / ' + failed + ' FAIL (of ' + results.length + ') ===\n', 'utf8');
