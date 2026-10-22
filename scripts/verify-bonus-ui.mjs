// Bonus/Encashment UI check (CDP): Estimate tab transparency + settlement card.
import 'dotenv/config';
import { spawn } from 'child_process';
import fs from 'fs';
import os from 'os';
import path from 'path';

const APP_URL = 'http://localhost:3000';
const API = 'http://localhost:4000/api';
const CDP_PORT = 9229;
const OUT = path.join(process.cwd(), 'scripts', '_salary_ui_out');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const results = [];
const check = (l, ok, d = '') => { results.push({ l, ok }); console.log(`${ok ? 'PASS' : 'FAIL'}  ${l}${d ? ' -> ' + d : ''}`); };

class Cdp {
  constructor(ws) { this.wsUrl = ws; this.id = 0; this.pending = new Map(); this.errors = []; }
  async connect() {
    this.ws = new WebSocket(this.wsUrl);
    await new Promise((res, rej) => { this.ws.addEventListener('open', res, { once: true }); this.ws.addEventListener('error', () => rej(new Error('ws')), { once: true }); });
    this.ws.addEventListener('message', (ev) => {
      let m = null; try { m = JSON.parse(ev.data); } catch { return; }
      if (m.id && this.pending.has(m.id)) { const { resolve, reject } = this.pending.get(m.id); this.pending.delete(m.id); m.error ? reject(new Error(m.error.message)) : resolve(m.result); return; }
      if (m.method === 'Runtime.consoleAPICalled' && m.params?.type === 'error') this.errors.push((m.params.args || []).map((a) => a.value || a.description || '').join(' '));
      if (m.method === 'Runtime.exceptionThrown') this.errors.push(`${m.params?.exceptionDetails?.text || 'exception'} ${m.params?.exceptionDetails?.exception?.description || ''}`);
    });
  }
  send(method, params = {}) {
    this.id += 1; const id = this.id;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.ws.send(JSON.stringify({ id, method, params }));
      setTimeout(() => { if (this.pending.has(id)) { this.pending.delete(id); reject(new Error(`timeout ${method}`)); } }, 60000);
    });
  }
  async eval(expr) {
    const r = await this.send('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true, userGesture: true });
    if (r.exceptionDetails) throw new Error(r.exceptionDetails.text || 'eval');
    return r.result?.value;
  }
  async waitFor(expr, t = 30000) {
    const s = Date.now();
    while (Date.now() - s < t) { try { if (await this.eval(expr)) return true; } catch { /* */ } await sleep(500); }
    return false;
  }
}

// API prep: save config, enable the example bonus rules, restore at the end.
let tok = null;
async function api(p, { method = 'GET', body } = {}) {
  if (!tok) { const r = await fetch(`${API}/auth/hr/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username: process.env.HR_USERNAME, password: process.env.HR_PASSWORD }) }); tok = (await r.json()).token; }
  const r = await fetch(API + p, { method, headers: { Authorization: `Bearer ${tok}`, 'Content-Type': 'application/json' }, body: body ? JSON.stringify(body) : undefined });
  return r.json().catch(() => null);
}
const saved = (await api('/hr/salary/config'))?.config || {};
const patch = { BonusEnabled: 'Y', BonusPeriodStart: '2025-10-01', BonusPeriodEnd: '2026-10-31', BonusRule: 'FIXED', BonusRate: '13850', BonusEligibilityMinMonths: '12', BonusProrate: 'Y' };
await api('/hr/salary/config', { method: 'PUT', body: patch });

// Browser + HR session
const browserPath = ['C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe', 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe'].find((p) => fs.existsSync(p));
const browser = spawn(browserPath, ['--headless=new', '--disable-gpu', '--no-first-run', '--disable-extensions', `--remote-debugging-port=${CDP_PORT}`, `--user-data-dir=${path.join(os.tmpdir(), `bonus-ui-${Date.now()}`)}`, '--window-size=1280,900', 'about:blank'], { stdio: 'ignore' });
let target = null;
for (let i = 0; i < 40 && !target; i += 1) {
  try { const l = await (await fetch(`http://127.0.0.1:${CDP_PORT}/json/list`)).json(); target = l.find((t) => t.type === 'page' && t.webSocketDebuggerUrl); } catch { /* */ }
  if (!target) await sleep(500);
}
const cdp = new Cdp(target.webSocketDebuggerUrl);
await cdp.connect();
await cdp.send('Page.enable');
await cdp.send('Runtime.enable');

await cdp.send('Page.navigate', { url: `${APP_URL}/login/hr` });
await cdp.waitFor('document.body.innerText.length > 50', 60000);
const login = await cdp.eval(`fetch('/api/auth/hr', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username: ${JSON.stringify(process.env.HR_USERNAME || '')}, password: ${JSON.stringify(process.env.HR_PASSWORD || '')} }), credentials: 'include' }).then((r) => r.status)`);
check('U1. HR session established', login === 200, `HTTP ${login}`);
await cdp.send('Page.navigate', { url: `${APP_URL}/hr/salary` });
await cdp.waitFor(`document.body.innerText.includes('Salary & Full & Final')`, 120000);
for (let i = 0; i < 8; i += 1) {
  const ok = await cdp.eval(`(() => { const b = Array.from(document.querySelectorAll('button')).find((x) => x.textContent.replace(/\\s+/g,' ').trim().endsWith('Estimate')); if (b) { b.click(); return true; } return false; })()`);
  if (ok && await cdp.waitFor(`document.body.innerText.includes('Full & Final Estimate')`, 4000)) break;
  await sleep(700);
}
check('U2. Estimate tab opens', await cdp.eval(`document.body.innerText.includes('Full & Final Estimate')`));

// Run an estimate for the real employee.
await cdp.eval(`(() => {
  const set = (el, v) => { const s = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set; s.call(el, v); el.dispatchEvent(new Event('input', { bubbles: true })); };
  const inputs = Array.from(document.querySelectorAll('input'));
  set(inputs.find((i) => i.id === 'est-paycode'), '0002');
  set(inputs.find((i) => i.id === 'est-leaving'), '2026-12-31');
  return true;
})()`);
await cdp.eval(`(() => { const b = Array.from(document.querySelectorAll('button')).find((x) => x.textContent.includes('Run Estimate')); b.click(); return true; })()`);
const ran = await cdp.waitFor(`document.body.innerText.includes('Bonus Settlement History')`, 30000);
check('U3. Estimate runs; Bonus Settlement History card renders', ran);
const details = await cdp.eval(`(() => {
  const t = document.body.innerText;
  return {
    period: t.includes('Configured bonus period'),
    eligible: t.includes('Eligible service period'),
    settled: t.includes('Previously settled'),
    proration: t.includes('Proration basis'),
    daily: t.includes('Daily salary formula'),
    types: t.includes('Eligible leave types'),
  };
})()`);
check('U4. Bonus transparency lines rendered (period, eligible service, settled, proration)',
  details.period && details.eligible && details.settled && details.proration, JSON.stringify(details));
check('U5. Encashment breakdown rendered (daily formula + eligible types)', details.daily && details.types, JSON.stringify(details));

// Record a settlement through the UI, then remove it (roundtrip, no leftovers).
await cdp.eval(`window.confirm = () => true; true;`);
await cdp.eval(`(() => { const b = Array.from(document.querySelectorAll('button')).find((x) => x.textContent.includes('Record Bonus Settlement')); if (b && !b.disabled) { b.click(); return 'clicked'; } return 'disabled'; })()`);
const recorded = await cdp.waitFor(`document.body.innerText.includes('Bonus settlement recorded')`, 20000);
check('U6. Record Bonus Settlement works (explicit action only)', recorded);
const rowShown = await cdp.waitFor(`document.body.innerText.includes('Settled') && document.body.innerText.includes('2025-10-01')`, 15000);
check('U7. Settlement record listed in the history table', rowShown);
const removed = await cdp.eval(`(() => {
  const b = Array.from(document.querySelectorAll('button')).find((x) => x.textContent.trim() === 'Remove');
  if (!b) return 'no-remove';
  b.click();
  return 'clicked';
})()`);
const gone = await cdp.waitFor(`!document.body.innerText.includes('2025-10-01 .. 2026-10-31')`, 20000);
check('U8. Settlement record removable (cleanup path)', removed === 'clicked' && gone, `remove=${removed}`);
await cdp.send('Page.captureScreenshot', { format: 'png' }).then((r) => fs.writeFileSync(path.join(OUT, '07-bonus-estimate.png'), Buffer.from(r.data, 'base64'))).catch(() => {});
const appErrors = cdp.errors.filter((e) => !/favicon/i.test(String(e)));
check('U9. No page exceptions / console errors', appErrors.length === 0, `errors=${appErrors.length}${appErrors[0] ? ' | ' + String(appErrors[0]).slice(0, 120) : ''} (raw=${cdp.errors.length})`);

browser.kill();
// Restore config + remove any leftover settlement from this run.
for (const s of (await api('/hr/salary/bonus-settlements?paycode=0002'))?.rows || []) {
  await api('/hr/salary/bonus-settlements', { method: 'DELETE', body: { ids: [s.id] } });
}
const restore = {};
for (const k of Object.keys(patch)) restore[k] = saved[k] ?? '';
await api('/hr/salary/config', { method: 'PUT', body: restore });
console.log('config restored + settlements cleaned');
const failed = results.filter((r) => !r.ok).length;
console.log(`\n${results.length - failed}/${results.length} UI checks passed.`);
process.exit(failed ? 1 : 0);