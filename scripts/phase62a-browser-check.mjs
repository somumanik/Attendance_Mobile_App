// PHASE 6.2A — web-next Single Employee Audit REAL BROWSER verification (headless via CDP).
// Drives the actual running Next.js site: /login/hr -> HR login -> /hr/audit?paycode=...
// Fix A: Late Arrival Details + Monthly Staff Grace Used (STAFF eligibility aware)
// Fix B: employee header shift code + real timings
// Captures console errors + DOM text assertions. READ-ONLY (koi DB write nahi).
import 'dotenv/config';
import { spawn } from 'child_process';
import fs from 'fs';
import path from 'path';

const SITE_URL = process.env.PHASE62A_SITE || 'http://127.0.0.1:3100';
const CDP_PORT = 9223;
const OUT_DIR = path.join(process.cwd(), 'scripts', '_phase62a_ui');
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
  async waitForText(needle, timeoutMs = 60000) {
    const started = Date.now();
    while (Date.now() - started < timeoutMs) {
      try {
        const ok = await this.eval(`document.body ? document.body.innerText.includes(${JSON.stringify(needle)}) : false`);
        if (ok) return true;
      } catch { /* navigation ke beech eval fail ho sakta hai — retry */ }
      await sleep(700);
    }
    return false;
  }
  async goto(url) {
    await this.send('Page.navigate', { url });
    await sleep(1500);
  }
  async screenshot(name) {
    try {
      const res = await this.send('Page.captureScreenshot', { format: 'png' });
      fs.writeFileSync(path.join(OUT_DIR, name), Buffer.from(res.data, 'base64'));
    } catch { /* optional */ }
  }
}

// HR login form fill (React controlled inputs need native setter + input event).
const SET_INPUT = [
  '(function setInput(sel, v) {',
  "  const el = document.querySelector(sel);",
  '  if (!el) return false;',
  "  const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;",
  '  setter.call(el, v);',
  "  el.dispatchEvent(new Event('input', { bubbles: true }));",
  "  el.dispatchEvent(new Event('change', { bubbles: true }));",
  '  return true;',
  '})',
].join('\n');

// Monthly Staff Grace Used block scope (grace summary ka parent text).
const GRAVE_BOX = [
  '(function () {',
  "  const h = Array.from(document.querySelectorAll('p')).find((p) => (p.innerText || '').trim() === 'Monthly Staff Grace Used');",
  '  return h && h.parentElement ? h.parentElement.innerText : null;',
  '})',
].join('\n');
if (!fs.existsSync(OUT_DIR)) fs.mkdirSync(OUT_DIR, { recursive: true });
const browserPath = BROWSERS.find((p) => fs.existsSync(p));
if (!browserPath) {
  console.error('No Edge/Chrome binary found - cannot run the browser test.');
  process.exit(1);
}

// ---- next start (fresh build) on scratch port 3100; API proxy -> updated backend :4000 ----
// Hinglish: agar site pehle se up hai (manually start ki gayi) to dobara spawn mat karo —
// EADDRINUSE aur stale-build jhol se bachne ke liye.
let next = null;
const probe = await fetch(SITE_URL + '/login/hr').then((r) => r.ok).catch(() => false);
if (!probe) {
  next = spawn(process.execPath, ['node_modules/next/dist/bin/next', 'start', '-p', '3100'], {
    cwd: path.join(process.cwd(), 'web-next'),
    env: { ...process.env, API_PROXY_TARGET: 'http://127.0.0.1:4000' },
    stdio: 'ignore', detached: false, shell: false,
  });
}
let browser = null;
try {
  let up = false;
  for (let i = 0; i < 30; i++) {
    await sleep(1000);
    try { const r = await fetch(SITE_URL + '/login/hr'); if (r.ok) { up = true; break; } } catch {}
  }
  check('Next.js site up on :3100', up);

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
  if (!wsUrl) throw new Error('CDP page target not found on port ' + CDP_PORT);
  const cdp = new Cdp(wsUrl);
  await cdp.connect();
  await cdp.send('Page.enable');
  await cdp.send('Runtime.enable');

  // ---- HR login (existing flow, untouched) ----
  await cdp.goto(SITE_URL + '/login/hr');
  // Hinglish: React hydration ka wait — uske bina input events state me jaate hi nahi.
  await cdp.waitForText('HR Admin Login', 30000);
  const fillVerified = async (sel, val) => {
    for (let i = 0; i < 10; i++) {
      await cdp.eval(SET_INPUT + '(' + JSON.stringify(sel) + ', ' + JSON.stringify(val) + ')');
      const ok = await cdp.eval('(document.querySelector(' + JSON.stringify(sel) + ') || {}).value === ' + JSON.stringify(val));
      if (ok) return true;
      await sleep(700);
    }
    return false;
  };
  const filledUser = await fillVerified('#hr-username', process.env.HR_USERNAME || 'HR001');
  const filledPass = await fillVerified('#hr-password', process.env.HR_PASSWORD || 'Admin@123');
  check('HR login form filled (hydrated)', filledUser && filledPass);
  await cdp.eval("document.querySelector('form.auth button[type=\"submit\"]').click()");
  // Strict check: sirf 'HR' se match mat karo (landing page par bhi 'HR Admin' hota hai).
  const loggedIn = await cdp.waitForText('Executive Overview', 30000);
  check('HR Admin login (web-next) works', loggedIn);
  await cdp.screenshot('01-hr-login.png');

  // ---- 1053 (STAFF, current month: 0 lates) — Fix A + Fix B ----
  await cdp.goto(SITE_URL + '/hr/audit?paycode=1053');
  const nameOk = await cdp.waitForText('Manik K Chaudhari');
  check('Audit loads 1053 profile', nameOk);
  if (!nameOk) console.log('PAGE TEXT DUMP: ' + String(await cdp.text()).slice(0, 800));
  const shiftOk = await cdp.waitForText('Shift: GEN | 10:00 AM \u2013 07:00 PM');
  check('FIX B - header shows real shift code + timings (GEN | 10:00 AM - 07:00 PM)', shiftOk);
  const sectionOk = await cdp.waitForText('LATE ARRIVAL DETAILS (MONTHLY GRACE CONSUMPTION)');
  check('FIX A - grace section VISIBLE for STAFF with zero usage (was hidden before)', sectionOk);
  const noLateOk = await cdp.waitForText('No late occurrences this month');
  check('FIX A - empty late list shows honest empty-state (not silently hidden)', noLateOk);
  const graceBox = await cdp.eval(GRAVE_BOX + '()');
  const octGrace = Boolean(graceBox && graceBox.includes('0/2') && graceBox.includes('0/1'));
  check('FIX A - Monthly Staff Grace Used shows actual used/limit 0/2, 0/1, 0/1', octGrace, JSON.stringify(graceBox || '').slice(0, 160));
  await cdp.screenshot('02-1053-october.png');

  // ---- Month change: Sep 2026 (1053 has real grace consumption) ----
  await cdp.eval("document.querySelector('button[aria-label=\"Previous month\"]').click()");
  const sepRows = await cdp.waitForText('Covered by 30-min grace');
  check('Month change refetches - Sep late rows appear with grace coverage', sepRows);
  const sep1hr = await cdp.waitForText('Covered by 1-hr grace');
  check('Sep row covered by 1-hr grace shown (chronological consumption)', sep1hr);
  const graceBoxSep = await cdp.eval(GRAVE_BOX + '()');
  const sepGrace = Boolean(graceBoxSep && graceBoxSep.includes('2/2') && graceBoxSep.includes('1/1') && graceBoxSep.includes('0/1'));
  check('Sep Monthly Staff Grace Used = 2/2, 1/1, 0/1 (actual used/limit)', sepGrace, JSON.stringify(graceBoxSep || '').slice(0, 160));
  await cdp.screenshot('03-1053-september.png');

  // ---- Non-STAFF (WORKER AW00020): late rows yes, staff-grace block NO ----
  await cdp.goto(SITE_URL + '/hr/audit?paycode=AW00020');
  const finalLateOk = await cdp.waitForText('FINAL LATE');
  check('Non-STAFF late rows render as FINAL LATE', finalLateOk);
  const notApp = await cdp.waitForText('Not applicable');
  check('FIX A - non-STAFF: Monthly Staff Grace Used marked NOT APPLICABLE', notApp);
  const bodyTxt = await cdp.text();
  const noFakeGrace = !bodyTxt.includes('30-min grace (2 per month)');
  check('FIX A - non-STAFF: no misleading staff-grace used table', noFakeGrace);
  await cdp.screenshot('04-non-staff.png');

  // ---- Second STAFF, different company/shift (AS00093, company 003, GNN) ----
  await cdp.goto(SITE_URL + '/hr/audit?paycode=AS00093');
  const asShift = await cdp.waitForText('Shift: GNN | 09:30 AM \u2013 06:30 PM');
  check('Shift resolves per employee/company (AS00093 => GNN 09:30-18:30)', asShift);
  const asGrace = await cdp.waitForText('Covered by 2-hr grace');
  check('AS00093 (STAFF, company 003) grace consumption rows shown', asGrace);
  await cdp.screenshot('05-staff-as00093.png');

  // ---- Regression: protected HR tab still renders ----
  await cdp.goto(SITE_URL + '/hr');
  const overviewOk = await cdp.waitForText('Executive Overview', 20000);
  check('HR Overview tab still works (regression)', overviewOk);

  const realErrors = cdp.exceptions.concat(cdp.consoleErrors).filter((e) => !String(e).includes('favicon'));
  check('No browser console/JS exceptions during the audit flows', realErrors.length === 0, realErrors.slice(0, 3).join(' | '));
} catch (err) {
  check('browser run completed without exception', false, String(err && err.message ? err.message : err));
} finally {
  if (browser) { try { browser.kill(); } catch {} }
  if (next) { try { next.kill(); } catch {} }
}

const passed = results.filter((r) => r.ok).length;
const failed = results.length - passed;
console.log('');
console.log('=== SUMMARY: ' + passed + ' PASS / ' + failed + ' FAIL (of ' + results.length + ') ===');
fs.writeFileSync('scripts/phase62a-ui-out.txt', results.map((r) => (r.ok ? 'PASS' : 'FAIL') + ' | ' + r.label + ' | ' + r.detail).join('\n') + '\n\n=== SUMMARY: ' + passed + ' PASS / ' + failed + ' FAIL (of ' + results.length + ') ===\n', 'utf8');
