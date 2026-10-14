// PHASE 6.2C — Executive Overview -> Live Biometric Status -> Audit modal (web-next)
// real-browser verification (headless CDP). Verifies Fix A/C: the SECOND audit entry
// point now shows Late Arrival + Monthly Staff Grace Used with STAFF eligibility.
import 'dotenv/config';
import { spawn } from 'child_process';
import fs from 'fs';
import path from 'path';

const SITE_URL = process.env.PHASE62C_SITE || 'http://127.0.0.1:3000';
const CDP_PORT = 9225;
const OUT_DIR = path.join(process.cwd(), 'scripts', '_phase62c_ui');
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
    this.exceptions = [];
    this.consoleErrors = [];
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
    const res = await this.send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true, userGesture: true });
    if (res.exceptionDetails) throw new Error(res.exceptionDetails.text || 'eval failed');
    return res.result?.value;
  }
  async text() { return this.eval('document.body ? document.body.innerText : ""'); }
  async waitForText(needle, timeoutMs = 60000) {
    const started = Date.now();
    while (Date.now() - started < timeoutMs) {
      try {
        const ok = await this.eval(`document.body ? document.body.innerText.includes(${JSON.stringify(needle)}) : false`);
        if (ok) return true;
      } catch {}
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

const SET_INPUT = `
(function setInput(sel, v) {
  const el = document.querySelector(sel);
  if (!el) return false;
  const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
  setter.call(el, v);
  el.dispatchEvent(new Event('input', { bubbles: true }));
  el.dispatchEvent(new Event('change', { bubbles: true }));
  return true;
})`;

// Live Biometric Status table: paycode cell match karke usi row ka "Audit" button click.
const CLICK_AUDIT_FOR = `
(function clickAuditFor(paycode) {
  const rows = Array.from(document.querySelectorAll('tr'));
  const tr = rows.find((r) => Array.from(r.querySelectorAll('td')).some((td) => (td.innerText || '').trim() === paycode));
  if (!tr) return false;
  const btn = Array.from(tr.querySelectorAll('button')).find((b) => (b.innerText || '').indexOf('Audit') >= 0);
  if (!btn) return false;
  btn.click();
  return true;
})`;

if (!fs.existsSync(OUT_DIR)) fs.mkdirSync(OUT_DIR, { recursive: true });
const browserPath = BROWSERS.find((p) => fs.existsSync(p));
if (!browserPath) { console.error('No Edge/Chrome binary'); process.exit(1); }

let browser = null;
try {
  const up = await fetch(SITE_URL + '/login/hr').then((r) => r.ok).catch(() => false);
  check('Next.js site up', up);
  if (!up) throw new Error('site down');

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
  if (!wsUrl) throw new Error('CDP target not found');
  const cdp = new Cdp(wsUrl);
  await cdp.connect();
  await cdp.send('Page.enable');
  await cdp.send('Runtime.enable');
  await cdp.send('Page.navigate', { url: SITE_URL + '/login/hr' });
  await sleep(1500);

  // HR login
  await cdp.waitForText('HR Admin Login', 30000);
  for (let i = 0; i < 10; i++) {
    await cdp.eval(SET_INPUT + "('#hr-username', " + JSON.stringify(process.env.HR_USERNAME || 'HR001') + ')');
    await cdp.eval(SET_INPUT + "('#hr-password', " + JSON.stringify(process.env.HR_PASSWORD || 'Admin@123') + ')');
    const ok = await cdp.eval("(document.querySelector('#hr-username')||{}).value === 'HR001'");
    if (ok) break;
    await sleep(700);
  }
  await cdp.eval("document.querySelector('form.auth button[type=\"submit\"]').click()");
  check('HR Admin login works', await cdp.waitForText('Executive Overview', 30000));

  // Live Biometric Status table loads
  await cdp.waitForText('Live Biometric Status', 30000);

  // STAFF employee (AS00093, cat 001, GNN) — has 2-hr grace this month
  const openedStaff = await cdp.eval(CLICK_AUDIT_FOR + "('AS00093')");
  check('Overview: Audit button clickable for STAFF AS00093', openedStaff === true);
  const modalStaff = await cdp.waitForText('Employee Attendance Audit');
  check('Overview audit modal opens', modalStaff);
  const staffGraceShown = await cdp.waitForText('Monthly Staff Grace Used', 45000);
  const sBody = await cdp.text();
  if (!staffGraceShown) console.log('DUMP STAFF MODAL: ' + sBody.slice(0, 1200));
  check('Overview modal: STAFF AS00093 grace section shown (Monthly Staff Grace Used)', staffGraceShown);
  check('Overview modal: STAFF AS00093 grace consumption row (2-hr grace)', sBody.includes('Covered by 2-hr grace'));
  check('Overview modal: STAFF has used/limit counts (2/2)', sBody.includes('2/2'));
  check('Overview modal: non-STAFF "Not applicable" NOT shown for STAFF', !sBody.includes('Not applicable'));
  await cdp.screenshot('01-overview-audit-staff.png');

  // close modal (fa-times button)
  await cdp.eval("(function(){ var b=Array.from(document.querySelectorAll('button')).find(x=>x.getAttribute('aria-label')==='Close'); if(b){b.click();return true;} return false; })()");
  await sleep(1000);

  // Non-STAFF (AW00035, cat 002, WK) — late rows all final, grace NOT applicable
  const openedNon = await cdp.eval(CLICK_AUDIT_FOR + "('AW00035')");
  check('Overview: Audit button clickable for non-STAFF AW00035', openedNon === true);
  await cdp.waitForText('Employee Attendance Audit');
  const nonGraceShown = await cdp.waitForText('Not applicable', 45000);
  const nBody = await cdp.text();
  if (!nonGraceShown) console.log('DUMP NONSTAFF MODAL: ' + nBody.slice(0, 1200));
  check('Overview modal: non-STAFF marked NOT APPLICABLE (no fake staff grace)', nonGraceShown);
  check('Overview modal: non-STAFF late rows render FINAL LATE', nBody.includes('FINAL LATE'));
  check('Overview modal: non-STAFF has no misleading "30-min grace (2 per month)" table', !nBody.includes('30-min grace (2 per month)'));
  await cdp.screenshot('02-overview-audit-nonstaff.png');

  const realErrors = cdp.exceptions.concat(cdp.consoleErrors).filter((e) => !String(e).includes('favicon'));
  check('No JS exceptions during overview audit flows', realErrors.length === 0, realErrors.slice(0, 3).join(' | '));
} catch (err) {
  check('browser run completed without exception', false, String(err && err.message ? err.message : err));
} finally {
  if (browser) { try { browser.kill(); } catch {} }
}

const passed = results.filter((r) => r.ok).length;
const failed = results.length - passed;
console.log('');
console.log('=== SUMMARY: ' + passed + ' PASS / ' + failed + ' FAIL (of ' + results.length + ') ===');
fs.writeFileSync('scripts/phase62c-ui-out.txt', results.map((r) => (r.ok ? 'PASS' : 'FAIL') + ' | ' + r.label + ' | ' + r.detail).join('\n') + '\n\n=== SUMMARY: ' + passed + ' PASS / ' + failed + ' FAIL (of ' + results.length + ') ===\n', 'utf8');
