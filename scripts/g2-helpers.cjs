// PHASE G.2 live verification part 1/2: helpers + auth + master + holidays.
const fs = require('fs');
const path = require('path');
const ROOT = path.resolve(__dirname, '..');
const BASE = process.env.API_BASE || 'http://127.0.0.1:4000';
function loadEnv() {
  const file = path.join(ROOT, '.env'); const out = {};
  if (!fs.existsSync(file)) return out;
  for (const line of fs.readFileSync(file, 'utf8').split(/\r?\n/)) {
    const m = /^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/.exec(line);
    if (m) out[m[1]] = m[2];
  }
  return out;
}
const env = loadEnv();
async function call(method, url, { token, body } = {}) {
  const headers = { 'Content-Type': 'application/json' };
  if (token) headers.Authorization = `Bearer ${token}`;
  try {
    const res = await fetch(BASE + url, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
    const text = await res.text(); let data; try { data = JSON.parse(text); } catch { data = text; }
    return { status: res.status, data };
  } catch (e) { return { status: 0, data: String(e) }; }
}
let passCount = 0; let failCount = 0; const failures = [];
function check(name, cond, detail = '') {
  if (cond) { passCount += 1; console.log(`  PASS  ${name}`); }
  else { failCount += 1; failures.push(name); console.log(`  FAIL  ${name}${detail ? ` -> ${detail}` : ''}`); }
}
function section(t) { console.log(`\n=== ${t}`); }
module.exports = { ROOT, BASE, env, call, check, section,
  summary() { console.log(`\nRESULT: ${passCount} passed, ${failCount} failed${failures.length ? ` [${failures.join(' | ')}]` : ''}`); return failCount; },
  get passCount() { return passCount; }, get failCount() { return failCount; } };
