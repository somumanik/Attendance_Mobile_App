// Salary horizontal-overflow DIAGNOSTIC (CDP, headless browser).
// For each Salary tab and viewport width: measures document-level horizontal
// overflow and lists the DOM elements that stick out / propagate min-content.
import 'dotenv/config';
import { spawn } from 'child_process';
import fs from 'fs';
import os from 'os';
import path from 'path';

const APP_URL = 'http://localhost:3000';
const CDP_PORT = 9228;
const BROWSERS = [
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
];
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

class Cdp {
  constructor(wsUrl) { this.wsUrl = wsUrl; this.id = 0; this.pending = new Map(); }
  async connect() {
    this.ws = new WebSocket(this.wsUrl);
    await new Promise((res, rej) => {
      this.ws.addEventListener('open', res, { once: true });
      this.ws.addEventListener('error', () => rej(new Error('ws error')), { once: true });
    });
    this.ws.addEventListener('message', (ev) => {
      let msg = null; try { msg = JSON.parse(ev.data); } catch { return; }
      if (msg.id && this.pending.has(msg.id)) {
        const { resolve, reject } = this.pending.get(msg.id);
        this.pending.delete(msg.id);
        if (msg.error) reject(new Error(msg.error.message)); else resolve(msg.result);
      }
    });
  }
  send(method, params = {}) {
    this.id += 1; const id = this.id;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.ws.send(JSON.stringify({ id, method, params }));
      setTimeout(() => { if (this.pending.has(id)) { this.pending.delete(id); reject(new Error(`timeout: ${method}`)); } }, 60000);
    });
  }
  async eval(expression) {
    const res = await this.send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true, userGesture: true });
    if (res.exceptionDetails) throw new Error(res.exceptionDetails.text || 'eval failed');
    return res.result?.value;
  }
  async waitFor(expr, timeoutMs = 30000) {
    const started = Date.now();
    while (Date.now() - started < timeoutMs) {
      try { if (await this.eval(expr)) return true; } catch { /* retry */ }
      await sleep(500);
    }
    return false;
  }
}

const browserPath = BROWSERS.find((p) => fs.existsSync(p));
if (!browserPath) { console.error('No browser found.'); process.exit(1); }
const profileDir = path.join(os.tmpdir(), `sal-diag-${Date.now()}`);
const browser = spawn(browserPath, [
  '--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check',
  '--disable-extensions', `--remote-debugging-port=${CDP_PORT}`, `--user-data-dir=${profileDir}`,
  '--window-size=1280,900', 'about:blank',
], { stdio: 'ignore' });

async function pageTarget() {
  for (let i = 0; i < 40; i += 1) {
    try {
      const res = await fetch(`http://127.0.0.1:${CDP_PORT}/json/list`);
      const list = await res.json();
      const page = list.find((t) => t.type === 'page' && t.webSocketDebuggerUrl);
      if (page) return page;
    } catch { /* not up */ }
    await sleep(500);
  }
  return null;
}

const target = await pageTarget();
if (!target) { console.error('No CDP target.'); browser.kill(); process.exit(1); }
const cdp = new Cdp(target.webSocketDebuggerUrl);
await cdp.connect();
await cdp.send('Page.enable');
await cdp.send('Runtime.enable');

// HR session via the real Next auth route (retry while backend warms up)
await cdp.send('Page.navigate', { url: `${APP_URL}/login/hr` });
await cdp.waitFor(`document.body.innerText.length > 50`, 60000);
let loginRes = 0;
for (let i = 0; i < 12 && loginRes !== 200; i += 1) {
  loginRes = await cdp.eval(`fetch('/api/auth/hr', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username: ${JSON.stringify(process.env.HR_USERNAME || '')}, password: ${JSON.stringify(process.env.HR_PASSWORD || '')} }), credentials: 'include' }).then((r) => r.status)`);
  if (loginRes !== 200) await sleep(2500);
}
console.log(`login -> HTTP ${loginRes}`);
if (loginRes !== 200) { console.error('HR login failed - cannot measure.'); browser.kill(); process.exit(1); }
await cdp.send('Page.navigate', { url: `${APP_URL}/hr/salary` });
const loaded = await cdp.waitFor(`document.body.innerText.includes('Salary & Full & Final')`, 120000);
console.log(`salary page loaded -> ${loaded}`);
if (!loaded) { console.error('Salary UI never rendered.'); browser.kill(); process.exit(1); }
await cdp.waitFor(`document.querySelectorAll('div.table-scroll').length > 0 || document.body.innerText.includes('Excel Import')`, 60000);

const MEASURE = `(() => {
  const de = document.documentElement;
  const out = {
    innerWidth: window.innerWidth,
    clientWidth: de.clientWidth,
    docScrollWidth: de.scrollWidth,
    bodyScrollWidth: document.body.scrollWidth,
    pageOverflowX: de.scrollWidth > de.clientWidth + 1,
  };
  out.outside = [];
  for (const el of document.querySelectorAll('main *, header *')) {
    const r = el.getBoundingClientRect();
    if (r.width === 0 || r.height === 0) continue;
    const cs = getComputedStyle(el);
    if (cs.position === 'fixed') continue;
    if (r.right > de.clientWidth + 2) {
      out.outside.push({ tag: el.tagName, cls: String(el.className || '').slice(0, 70), right: Math.round(r.right), w: Math.round(r.width) });
    }
    if (out.outside.length > 12) break;
  }
  out.containers = [];
  for (const el of document.querySelectorAll('div.table-scroll, div.overflow-x-auto, div.overflow-auto')) {
    const cs = getComputedStyle(el);
    out.containers.push({ cls: String(el.className || '').slice(0, 45), overflowX: cs.overflowX, sw: el.scrollWidth, cw: el.clientWidth, scrolls: el.scrollWidth > el.clientWidth + 1, minW: cs.minWidth });
  }
  const flexItem = document.querySelector('div.flex > div.flex-1');
  out.flexItem = flexItem ? { minWidth: getComputedStyle(flexItem).minWidth, w: Math.round(flexItem.getBoundingClientRect().width), sw: flexItem.scrollWidth } : null;
  return out;
})()`;

async function clickTab(label) {
  return cdp.eval(`(() => {
    const norm = (s) => (s || '').replace(/\\s+/g, ' ').trim();
    const btn = Array.from(document.querySelectorAll('button')).find((b) => norm(b.textContent).endsWith(${JSON.stringify(label)}));
    if (!btn) return 'no-tab';
    btn.click();
    return 'ok';
  })()`);
}

for (const [w, h] of [[1280, 900], [830, 900], [390, 780]]) {
  await cdp.send('Emulation.setDeviceMetricsOverride', { width: w, height: h, deviceScaleFactor: 1, mobile: false });
  await sleep(600);
  for (const tab of ['Structure', 'Salary Data', 'Dues', 'Rules', 'Estimate', 'Import']) {
    await clickTab(tab);
    await sleep(900);
    const m = await cdp.eval(MEASURE);
    const flag = m.pageOverflowX ? 'OVERFLOW' : 'ok';
    console.log(`\n=== ${w}x${h} tab=${tab} -> ${flag} | inner=${m.innerWidth} client=${m.clientWidth} docSW=${m.docScrollWidth} bodySW=${m.bodyScrollWidth}`);
    if (m.flexItem) console.log(`  flexItem: minW=${m.flexItem.minWidth} w=${m.flexItem.w} sw=${m.flexItem.sw}`);
    for (const o of m.outside) console.log(`  OUTSIDE: <${o.tag} class="${o.cls}"> right=${o.right} w=${o.w}`);
    for (const c of m.containers) console.log(`  container[${c.cls}]: ovX=${c.overflowX} minW=${c.minW} sw=${c.sw} cw=${c.cw} scrolls=${c.scrolls}`);
  }
}

browser.kill();
process.exit(0);