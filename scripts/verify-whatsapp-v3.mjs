// scripts/verify-whatsapp-v3.mjs — WhatsApp Module V3 focused tests (offline).
// Covers: editable Phone Number ID, Business Account ID validation + secret
// masking, phone normalisation + recipient-number persistence (restart-safe),
// number updates never granting consent, category filtering from real data,
// eligibility reasons/counts (Paycode 1053 data-driven), message formatting +
// URL encoding, multi-select manual queue, and Cloud API safety gates.
//
// Offline by construction: global fetch is replaced with a throwing stub before
// the production modules load, so NO Meta/WhatsApp network call can happen here.
// Production code exercised directly:
//   server/whatsapp-provider.js    (provider save/load, encryption, masking)
//   server/whatsapp-message.mjs    (template render, number normalisation)
//   server/whatsapp-recipients.mjs (number-only writes, consent upsert)
//   web-next/lib/whatsapp.js       (wa.me links, manual queue helpers)
// A faithful file-backed mssql test double stands in for SQL Server. Where the
// production logic lives inside server/index.js (not importable — it starts the
// Express server on import), the gate is REPLICATED here and guarded with
// source-text assertions against server/index.js / the UI component, so drift
// is caught. Live SQL Server integration is NOT exercised (see final report).
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

// ---- offline guard: any network call fails the run ----
let fetchCalls = 0;
globalThis.fetch = (...args) => {
  fetchCalls += 1;
  throw new Error(`NETWORK CALL ATTEMPTED during offline tests: ${String(args[0])}`);
};

const __filename = fileURLToPath(import.meta.url);
const ROOT = path.resolve(path.dirname(__filename), '..');
const readSrc = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');

const {
  saveWhatsAppProviderSettings, getWhatsAppProviderSettings, publicWhatsAppProviderStatus,
  maskSecret, encryptSecret, decryptSecret,
} = await import('../server/whatsapp-provider.js');
const {
  WHATSAPP_DEFAULT_TEMPLATE, WHATSAPP_LEGACY_DEFAULT_TEMPLATE,
  renderWhatsAppTemplate, normalizeWhatsAppNumber,
} = await import('../server/whatsapp-message.mjs');
const {
  getWhatsAppRecipientRow, setWhatsAppRecipientNumber, upsertWhatsAppConsent,
} = await import('../server/whatsapp-recipients.mjs');
const {
  manualChatUrl, buildManualQueue, queueNeighborIndex, queueProgressLabel,
} = await import('../web-next/lib/whatsapp.js');

let passed = 0;
let failed = 0;
function check(name, cond, detail = '') {
  if (cond) { passed += 1; console.log(`PASS :: ${name}${detail ? ` :: ${detail}` : ''}`); }
  else { failed += 1; console.log(`FAIL :: ${name}${detail ? ` :: ${detail}` : ''}`); }
}
async function expectThrow(name, fn, match = '') {
  try { await fn(); check(name, false, 'no error thrown'); }
  catch (err) {
    const m = String((err && err.message) || err);
    check(name, !match || m.includes(match), m.slice(0, 120));
  }
}
/* ================= mssql test double (file- or memory-backed) ================= */
const fakeSql = {
  VarChar: (n) => ({ t: 'VarChar', n }),
  NVarChar: (n) => ({ t: 'NVarChar', n }),
  DateTime2: { t: 'DateTime2' },
  Bit: { t: 'Bit' },
  Int: { t: 'Int' },
  Date: { t: 'Date' },
};

function makeFakePool(store, log) {
  return {
    request() {
      const req = {
        inputs: {},
        input(name, _type, value) { req.inputs[name] = value; return req; },
        async batch(sqlText) { log.push({ kind: 'batch', sql: sqlText, inputs: { ...req.inputs } }); return { recordset: [] }; },
        async query(sqlText) {
          log.push({ kind: 'query', sql: sqlText, inputs: { ...req.inputs } });
          if (sqlText.includes('SELECT TOP 1 provider, accesstoken')) {
            return { recordset: store.providerRow ? [{ ...store.providerRow }] : [] };
          }
          if (/UPDATE\s+\S*HR_WhatsAppConfig\s+SET/i.test(sqlText)) {
            const row = store.providerRow || (store.providerRow = {});
            for (const m of sqlText.matchAll(/(\w+)\s*=\s*@(\w+)/g)) row[m[1]] = req.inputs[m[2]];
            return { recordset: [], rowsAffected: [1] };
          }
          if (sqlText.includes('SELECT TOP 1 paycode, whatsappnumber, consentstatus, optedoutat')) {
            const row = (store.recipients || []).find((r) => r.paycode === req.inputs.paycode);
            return { recordset: row ? [{ ...row }] : [] };
          }
          if (sqlText.includes('MERGE') && sqlText.includes('HR_EmployeeWhatsApp')) {
            const inputs = req.inputs;
            const rows = store.recipients || (store.recipients = []);
            const row = rows.find((r) => r.paycode === inputs.paycode);
            if (row) {
              row.whatsappnumber = inputs.whatsappnumber ? inputs.whatsappnumber : row.whatsappnumber;
              row.consentstatus = inputs.consentstatus;
              row.consentat = inputs.consentat || row.consentat;
              row.consentsource = inputs.consentsource || row.consentsource;
              row.optedoutat = inputs.optedoutat;
              row.companycode = inputs.companycode || row.companycode;
              row.departmentcode = inputs.departmentcode || row.departmentcode;
              row.employeename = inputs.employeename || row.employeename;
            } else {
              rows.push({ paycode: inputs.paycode, whatsappnumber: inputs.whatsappnumber, consentstatus: inputs.consentstatus, consentat: inputs.consentat, consentsource: inputs.consentsource, optedoutat: inputs.optedoutat, companycode: inputs.companycode, departmentcode: inputs.departmentcode, employeename: inputs.employeename });
            }
            return { recordset: [{ m: row ? 'UPDATE' : 'INSERT' }], rowsAffected: [1] };
          }
          if (sqlText.includes('IF EXISTS (SELECT 1 FROM dbo.HR_EmployeeWhatsApp')) {
            const inputs = req.inputs;
            const rows = store.recipients || (store.recipients = []);
            const row = rows.find((r) => r.paycode === inputs.paycode);
            if (row) {
              row.whatsappnumber = inputs.whatsappnumber;
              row.companycode = inputs.companycode || row.companycode;
              row.departmentcode = inputs.departmentcode || row.departmentcode;
              row.employeename = inputs.employeename || row.employeename;
            } else {
              rows.push({ paycode: inputs.paycode, whatsappnumber: inputs.whatsappnumber, consentstatus: 'None', consentat: null, consentsource: null, optedoutat: null, companycode: inputs.companycode, departmentcode: inputs.departmentcode, employeename: inputs.employeename });
            }
            return { recordset: [], rowsAffected: [1] };
          }
          return { recordset: [] };
        },
      };
      return req;
    },
  };
}
/* ============ child-process phases: persistence across "restarts" ============
   --persist-write: save provider IDs + a recipient number into a JSON-backed
   fake DB file (only the backing store survives, exactly like SQL Server being
   the only state that survives a real Node restart).
   --persist-read : NEW process reads everything back through the production
   read paths. If anything were cached in module memory, this would fail. */
const storeFile = process.argv[3];
if (process.argv[2] === '--persist-write') {
  const store = { providerRow: null, recipients: [] };
  const pool = makeFakePool(store, []);
  await saveWhatsAppProviderSettings(pool, fakeSql, {
    phoneNumberId: '1555000999', businessAccountId: '1098765432109876',
    apiVersion: 'v21.0', accessToken: 'EAAG-persist-token-9876543210',
  }, 'HR-TEST');
  await setWhatsAppRecipientNumber(pool, fakeSql, {
    paycode: '1053', whatsappnumber: '919876543210', companycode: 'C1', departmentcode: 'D1', employeename: 'Test Emp',
  });
  fs.writeFileSync(storeFile, JSON.stringify(store));
  console.log('PERSIST_WRITE_OK');
  process.exit(0);
}
if (process.argv[2] === '--persist-read') {
  const store = JSON.parse(fs.readFileSync(storeFile, 'utf8'));
  const pool = makeFakePool(store, []);
  const settings = await getWhatsAppProviderSettings(pool);
  const row = await getWhatsAppRecipientRow(pool, fakeSql, '1053');
  console.log(JSON.stringify({
    phoneNumberId: settings.phoneNumberId,
    businessAccountId: settings.businessAccountId,
    source: settings.source,
    recipientNumber: row ? row.whatsappnumber : null,
    recipientConsent: row ? row.consentstatus : null,
  }));
  process.exit(0);
}

console.log('\n=== WhatsApp Module V3 focused tests (offline — no Meta/SQL) ===\n');

/* ============================ 1. PROVIDER CONFIG ============================ */
console.log('--- 1. Provider config: editable Phone Number ID + validation + masking ---');
const store1 = { providerRow: null, recipients: [] };
const log1 = [];
const pool1 = makeFakePool(store1, log1);

await saveWhatsAppProviderSettings(pool1, fakeSql, {
  phoneNumberId: '1555000111',
  businessAccountId: '1098765432109876',
  apiVersion: 'v21.0',
  accessToken: 'EAAG-test-token-1234567890',
  appSecret: 'app-secret-abcdef-123456',
}, 'HR-TEST');
let s = await getWhatsAppProviderSettings(pool1);
check('provider: saved Phone Number ID is loaded from storage', s.phoneNumberId === '1555000111', s.phoneNumberId);
check('provider: Business Account ID stored', s.businessAccountId === '1098765432109876');
check('provider: configured only after token + phone id present', s.configured === true);

await saveWhatsAppProviderSettings(pool1, fakeSql, { phoneNumberId: '1555000222' }, 'HR-TEST');
s = await getWhatsAppProviderSettings(pool1);
check('provider: Phone Number ID is EDITABLE — new saved value used dynamically', s.phoneNumberId === '1555000222', s.phoneNumberId);

await saveWhatsAppProviderSettings(pool1, fakeSql, { apiVersion: 'v22.0', phoneNumberId: '' }, 'HR-TEST');
s = await getWhatsAppProviderSettings(pool1);
check('provider: blank field keeps saved Phone Number ID (blank form never wipes)', s.phoneNumberId === '1555000222', s.phoneNumberId);
check('provider: other fields still save normally', s.apiVersion === 'v22.0', s.apiVersion);

await saveWhatsAppProviderSettings(pool1, fakeSql, { phoneNumberId: '*Clear' }, 'HR-TEST');
s = await getWhatsAppProviderSettings(pool1);
check('provider: explicit *Clear sentinel removes the saved Phone Number ID', s.phoneNumberId === '');

await saveWhatsAppProviderSettings(pool1, fakeSql, { phoneNumberId: '1555000333', businessAccountIdClear: true }, 'HR-TEST');
s = await getWhatsAppProviderSettings(pool1);
check('provider: explicit clear flag removes Business Account ID', s.businessAccountId === '' && s.phoneNumberId === '1555000333');

await expectThrow('provider: HR-style login (HR001) rejected as Business Account ID', () => saveWhatsAppProviderSettings(pool1, fakeSql, { businessAccountId: 'HR001' }, 'HR-TEST'), 'numeric');
await expectThrow('provider: non-numeric Phone Number ID rejected', () => saveWhatsAppProviderSettings(pool1, fakeSql, { phoneNumberId: 'abc' }, 'HR-TEST'), 'numeric');
await expectThrow('provider: malformed API version rejected', () => saveWhatsAppProviderSettings(pool1, fakeSql, { apiVersion: '21' }, 'HR-TEST'), 'v21.0');
check('provider: nothing was wiped by the rejected saves', (await getWhatsAppProviderSettings(pool1)).phoneNumberId === '1555000333');
const pub = publicWhatsAppProviderStatus(await getWhatsAppProviderSettings(pool1));
const pubJson = JSON.stringify(pub);
check('provider: public status never contains the raw access token', !pubJson.includes('EAAG-test-token-1234567890'));
check('provider: public status never contains the raw app secret', !pubJson.includes('app-secret-abcdef-123456'));
check('provider: secrets shown as masked hints only', pub.hasAccessToken === true && pub.accessTokenHint.includes('•'));
check('maskSecret keeps only first/last 4 chars', maskSecret('EAAG-test-token-1234567890') === 'EAAG••••••••7890', maskSecret('EAAG-test-token-1234567890'));
check('encrypt/decrypt round-trip works (AES-256-GCM at rest)', decryptSecret(encryptSecret('my-secret-value')) === 'my-secret-value');
check('stored secret is encrypted (ciphertext, not plaintext)', String(store1.providerRow.accesstoken).startsWith('enc:v1:') && !String(store1.providerRow.accesstoken).includes('EAAG-test-token'));

const providerSaveSql = log1.filter((l) => /UPDATE\s+\S*HR_WhatsAppConfig\s+SET/i.test(l.sql)).map((l) => l.sql).join('\n');
check('provider: save SQL touches only provider columns (enabled/mode/dryrun untouched)', providerSaveSql.includes('phonenumberid') && !/enabled\s*=/.test(providerSaveSql) && !/dryrun\s*=/.test(providerSaveSql) && !/[^_]mode\s*=/.test(providerSaveSql.replace(/provider = @provider/, '')));
check('provider: save records who changed it (providerupdatedby)', providerSaveSql.includes('providerupdatedby = @updatedby'));
const providerSelectSql = log1.filter((l) => l.sql.includes('SELECT TOP 1 provider, accesstoken')).map((l) => l.sql).join('\n');
check('provider: settings always re-read from storage (no in-memory value cache)', providerSelectSql.includes('FROM dbo.HR_WhatsAppConfig'));

/* ======================= 2. RECIPIENT NUMBER STORAGE ======================== */
console.log('\n--- 2. Recipient number: normalisation + persistence + consent safety ---');
check('number: +91 spaced input -> E.164 digits', normalizeWhatsAppNumber('+91 98765 43210') === '919876543210');
check('number: 0-prefixed local 10-digit -> country 91', normalizeWhatsAppNumber('09876543210') === '919876543210');
check('number: 00 international prefix handled', normalizeWhatsAppNumber('00919876543210') === '919876543210');
check('number: already-normalised E.164 kept', normalizeWhatsAppNumber('919876543210') === '919876543210');
check('number: non-India international kept (44...)', normalizeWhatsAppNumber('+44 20 7946 0958') === '442079460958');
check('number: masked/legacy value rejected', normalizeWhatsAppNumber('XXXXXX9155') === '');
check('number: too-short input rejected', normalizeWhatsAppNumber('123') === '');
check('number: letters-only input rejected', normalizeWhatsAppNumber('abc') === '');
check('number: empty input rejected', normalizeWhatsAppNumber('') === '');
const store2 = { providerRow: null, recipients: [] };
const log2 = [];
const pool2 = makeFakePool(store2, log2);
await setWhatsAppRecipientNumber(pool2, fakeSql, { paycode: '1053', whatsappnumber: '919876543210', employeename: 'Emp 1053' });
let r1053 = await getWhatsAppRecipientRow(pool2, fakeSql, '1053');
check('recipient: number saved durably and read back', !!r1053 && r1053.whatsappnumber === '919876543210');
check('recipient: number save does NOT grant consent (stays None)', r1053.consentstatus === 'None');
check('recipient: number save does NOT set any consent timestamp', !r1053.consentat && !r1053.optedoutat);

const numSql = log2.filter((l) => l.sql.includes('IF EXISTS (SELECT 1 FROM dbo.HR_EmployeeWhatsApp')).map((l) => l.sql).join('\n');
const updatePart = numSql.split('ELSE')[0];
const insertPart = numSql.split('ELSE')[1] || '';
check('recipient: UPDATE path never writes consent columns', !/consentstatus\s*=/.test(updatePart) && !/optedoutat\s*=/.test(updatePart) && !/consentat\s*=/.test(updatePart));
check('recipient: INSERT path creates row with consentstatus None (never Granted)', insertPart.includes("'None'") && !insertPart.includes("'Granted'"));
check('recipient: write targets the WhatsApp-specific table only', numSql.includes('HR_EmployeeWhatsApp') && !numSql.includes('tblemployee'));

await upsertWhatsAppConsent(pool2, fakeSql, { paycode: '1053', whatsappnumber: '', consentstatus: 'Granted', consentat: new Date(), consentsource: 'HR' });
r1053 = await getWhatsAppRecipientRow(pool2, fakeSql, '1053');
check('consent: grant keeps the managed number (never wiped by empty value)', r1053.whatsappnumber === '919876543210');
check('consent: grant sets consentstatus Granted', r1053.consentstatus === 'Granted');
const mergeSql = log2.filter((l) => l.sql.includes('MERGE')).map((l) => l.sql).join('\n');
check('consent: merge SQL protects saved numbers (COALESCE NULLIF rule)', mergeSql.includes("COALESCE(NULLIF(@whatsappnumber, ''), t.whatsappnumber)"));

await setWhatsAppRecipientNumber(pool2, fakeSql, { paycode: '1053', whatsappnumber: '919111122233' });
r1053 = await getWhatsAppRecipientRow(pool2, fakeSql, '1053');
check('recipient: number update never changes consent state', r1053.whatsappnumber === '919111122233' && r1053.consentstatus === 'Granted');
await setWhatsAppRecipientNumber(pool2, fakeSql, { paycode: '2001', whatsappnumber: '919444455566' });
const r2001 = await getWhatsAppRecipientRow(pool2, fakeSql, '2001');
check('recipient: new number row starts with consent None (opt-out safe)', r2001.consentstatus === 'None');

// ---- persistence across a simulated server restart (fresh process) ----
const tmpStore = path.join(os.tmpdir(), `wa-v3-store-${process.pid}.json`);
execFileSync(process.execPath, [__filename, '--persist-write', tmpStore], { stdio: 'pipe' });
const readOut = JSON.parse(String(execFileSync(process.execPath, [__filename, '--persist-read', tmpStore], { stdio: 'pipe' })).trim());
check('persistence: Phone Number ID survives a process restart (production read path)', readOut.phoneNumberId === '1555000999', JSON.stringify(readOut));
check('persistence: recipient number survives a process restart', readOut.recipientNumber === '919876543210');
check('persistence: consent state survives too (and was NOT auto-granted)', readOut.recipientConsent === 'None');
fs.unlinkSync(tmpStore);
/* ==================== 3. ELIGIBILITY GATE (replicated) ======================
   loadWhatsAppEligible lives inside server/index.js (starts Express on import,
   so it cannot be imported). The gate below is a REPLICATION kept in sync via
   source-text assertions right after it. */
const categoryMap = new Map([['001', 'STAFF'], ['002', 'WORKER'], ['003', 'GUARD']]);
const resolveCategory = (code) => { const c = String(code || '').trim().toUpperCase(); return categoryMap.get(c) || c; };
const isStaffCategory = (code) => ['STAFF', 'STF'].includes(resolveCategory(code));
function catOk(eligibleCatsRaw, code) {
  const eligibleCats = String(eligibleCatsRaw || '').split(',').map((c) => c.trim().toUpperCase()).filter(Boolean);
  const catCodeUpper = String(code || '').trim().toUpperCase();
  const catName = resolveCategory(code);
  return eligibleCats.length ? eligibleCats.some((c) => c === catCodeUpper || c === catName) : isStaffCategory(code);
}
function classify(emp) {
  if (emp.outOfScope) return 'OUT_OF_SCOPE';
  if (emp.inactive) return 'INACTIVE';
  if (!catOk(emp.eligibleCats, emp.cat)) return 'CATEGORY_MISMATCH';
  // Effective number: HR-managed WhatsApp number wins, else master telephone1.
  const managedNumber = String(emp.managedNumber || '').trim();
  const masterPhone = String(emp.masterPhone || '').trim();
  const rawPhone = managedNumber || masterPhone;
  if (!rawPhone) return 'NO_NUMBER';
  if (!normalizeWhatsAppNumber(rawPhone)) return 'INVALID_NUMBER';
  const consent = emp.consent;
  if (!consent || String(consent.consentstatus || '').trim() !== 'Granted') return 'NO_CONSENT';
  if (consent.optedoutat) return 'OPTED_OUT';
  return 'ELIGIBLE';
}
console.log('\n--- 3. Eligibility: reasons, counts, managed-number precedence ---');
const granted = { consentstatus: 'Granted', optedoutat: null };
check('eligibility: managed number replaces master phone for the number checks', classify({ cat: '001', eligibleCats: 'STAFF', managedNumber: '919876543210', masterPhone: 'XXXXXX9155', consent: granted }) === 'ELIGIBLE');
check('eligibility: falls back to master phone when no managed number', classify({ cat: '001', eligibleCats: 'STAFF', managedNumber: '', masterPhone: '9876543210', consent: granted }) === 'ELIGIBLE');
check('eligibility: invalid managed number is INVALID_NUMBER (even if master is fine)', classify({ cat: '001', eligibleCats: 'STAFF', managedNumber: '12', masterPhone: '9876543210', consent: granted }) === 'INVALID_NUMBER');

const dataset = [
  { paycode: '1001', cat: '001', eligibleCats: 'STAFF', managedNumber: '919876543210', masterPhone: '', consent: granted },
  { paycode: '1002', cat: '001', eligibleCats: 'STAFF', managedNumber: '', masterPhone: '', consent: granted },
  { paycode: '1003', cat: '001', eligibleCats: 'STAFF', managedNumber: '', masterPhone: '12', consent: granted },
  { paycode: '1004', cat: '001', eligibleCats: 'STAFF', managedNumber: '', masterPhone: '9876543210', consent: null },
  { paycode: '1005', cat: '001', eligibleCats: 'STAFF', managedNumber: '', masterPhone: '9876543210', consent: { consentstatus: 'Granted', optedoutat: '2026-01-01' } },
  { paycode: '1006', cat: '002', eligibleCats: 'STAFF', managedNumber: '', masterPhone: '9876543210', consent: granted },
  { paycode: '1007', cat: '001', eligibleCats: 'STAFF', managedNumber: '', masterPhone: '9876543210', consent: granted, inactive: true },
  { paycode: '1008', cat: '001', eligibleCats: 'STAFF', managedNumber: '', masterPhone: '9876543210', consent: granted, outOfScope: true },
];
const counts = { ELIGIBLE: 0, NO_NUMBER: 0, INVALID_NUMBER: 0, NO_CONSENT: 0, OPTED_OUT: 0, CATEGORY_MISMATCH: 0, INACTIVE: 0, OUT_OF_SCOPE: 0 };
for (const e of dataset) counts[classify(e)]++;
check('counts: eligible = 1', counts.ELIGIBLE === 1);
check('counts: missing number = 1', counts.NO_NUMBER === 1);
check('counts: invalid number = 1', counts.INVALID_NUMBER === 1);
check('counts: no consent = 1', counts.NO_CONSENT === 1);
check('counts: opted out = 1 (distinct from no-consent)', counts.OPTED_OUT === 1);
check('counts: category mismatch = 1', counts.CATEGORY_MISMATCH === 1);
check('counts: inactive = 1', counts.INACTIVE === 1);
check('counts: out of scope = 1', counts.OUT_OF_SCOPE === 1);
check('counts: every employee lands in exactly one bucket', Object.values(counts).reduce((a, b) => a + b, 0) === dataset.length);
// Paycode 1053: reason comes from REAL data fields — never a hardcoded exception.
console.log('\n--- 3b. Paycode 1053 is data-driven (no hardcoded exception) ---');
const base1053 = { paycode: '1053', cat: '001', eligibleCats: 'STAFF', managedNumber: '919876543210', masterPhone: '' };
check('1053: active + STAFF + valid number + Granted -> ELIGIBLE (by data)', classify({ ...base1053, consent: granted }) === 'ELIGIBLE');
check('1053: missing consent -> NO_CONSENT (no special case)', classify({ ...base1053, consent: null }) === 'NO_CONSENT');
check('1053: opted out -> OPTED_OUT (no special case)', classify({ ...base1053, consent: { consentstatus: 'Granted', optedoutat: '2026-02-01' } }) === 'OPTED_OUT');
check('1053: inactive -> INACTIVE (no special case)', classify({ ...base1053, consent: granted, inactive: true }) === 'INACTIVE');
check('1053: wrong category -> CATEGORY_MISMATCH (no special case)', classify({ ...base1053, cat: '002', consent: granted }) === 'CATEGORY_MISMATCH');

// Source guards: server/index.js must implement exactly this gate.
const idxSrc = readSrc('server/index.js');
check('source: index.js uses managed-number precedence', idxSrc.includes('const rawPhone = managedNumber || masterPhone;'));
check('source: index.js keeps mutually exclusive primary reasons', ['OUT_OF_SCOPE', 'INACTIVE', 'CATEGORY_MISMATCH', 'NO_NUMBER', 'INVALID_NUMBER', 'NO_CONSENT', 'OPTED_OUT'].every((r) => idxSrc.includes(`'${r}'`)));
check('source: WhatsApp block has no hardcoded 1053 exception', !idxSrc.split('WHATSAPP ATTENDANCE MESSAGING')[1].split('app.listen')[0].includes('1053'));

/* ======================= 4. CATEGORY FILTER (real data) ===================== */
console.log('\n--- 4. Category filter from real category data ---');
check('category: configured NAME "STAFF" matches employee code 001', catOk('STAFF', '001') === true);
check('category: configured CODE "001" matches employee code 001', catOk('001', '001') === true);
check('category: empty config falls back to staff rule', catOk('', '001') === true && catOk('', '002') === false);
check('category: WORKER matches 002, not 001', catOk('WORKER', '002') === true && catOk('WORKER', '001') === false);
check('category: filter selection alone never grants eligibility', classify({ paycode: 'X', cat: '002', eligibleCats: 'WORKER', managedNumber: '', masterPhone: '9876543210', consent: null }) === 'NO_CONSENT');
check('source: /api/whatsapp/categories serves real tblcategory data', idxSrc.includes("app.get('/api/whatsapp/categories'") && idxSrc.includes('loadCategoryNames(pool)'));
check('source: category filter is display-only (no eligibility write on filter)', idxSrc.includes('display-only') || readSrc('web-next/components/hr/WhatsAppSection.jsx').includes('display only'));
/* ==================== 5. MESSAGE FORMATTING (production) ==================== */
console.log('\n--- 5. Message formatting + URL encoding (production code) ---');
check('template: starts with plain bold heading (no emoji)', WHATSAPP_DEFAULT_TEMPLATE.startsWith('*DAILY ATTENDANCE*'));
for (const [label, token] of [['Name', '*Name:*'], ['Paycode', '*Paycode:*'], ['Date', '*Date:*'], ['In-Time', '*In-Time:*'], ['Out-Time', '*Out-Time:*'], ['Punch', '*Punch:*'], ['Status', '*Status:*'], ['Grace Used', '*Grace Used:*'], ['Grace Remaining', '*Grace Remaining:*']]) {
  check(`template: bold label ${label} present`, WHATSAPP_DEFAULT_TEMPLATE.includes(token));
}
for (const v of ['{{EmployeeName}}', '{{Paycode}}', '{{AttendanceDate}}', '{{InTime}}', '{{OutTime}}', '{{PunchStatus}}', '{{Status}}', '{{GraceUsed}}', '{{GraceRemaining}}']) {
  check(`template: variable ${v} preserved`, WHATSAPP_DEFAULT_TEMPLATE.includes(v));
}
check('template: clear line breaks (one field per line)', WHATSAPP_DEFAULT_TEMPLATE.split('\n').length >= 9);
check('template: no HTML / colored-font claims', !/<[a-z]/i.test(WHATSAPP_DEFAULT_TEMPLATE) && !/color/i.test(WHATSAPP_DEFAULT_TEMPLATE));
check('template: no hardcoded employee values in the template', !/\b1053\b/.test(WHATSAPP_DEFAULT_TEMPLATE) && !/98765/.test(WHATSAPP_DEFAULT_TEMPLATE));
check('template: legacy default kept verbatim (safe one-time migration match)', WHATSAPP_LEGACY_DEFAULT_TEMPLATE === 'Hello {{EmployeeName}} ({{Paycode}}),\nDate: {{AttendanceDate}}\nIn: {{InTime}} | Out: {{OutTime}}\nPunch: {{PunchStatus}} | Status: {{Status}}\nGrace Used: {{GraceUsed}} | Grace Remaining: {{GraceRemaining}}');

const vars = { EmployeeName: 'Ravi Kumar', Paycode: '1053', AttendanceDate: '2026-10-29', InTime: '09:02 AM', OutTime: '06:11 PM', PunchStatus: 'Complete', Status: 'Present', GraceUsed: '0m', GraceRemaining: '30m:2 1h:1 2h:1', CompanyCode: 'C1', Department: 'IT' };
const rendered = renderWhatsAppTemplate(WHATSAPP_DEFAULT_TEMPLATE, vars);
check('render: bold employee name is personalised', rendered.includes('*Name:* Ravi Kumar'));
check('render: paycode + date personalised', rendered.includes('*Paycode:* 1053') && rendered.includes('*Date:* 2026-10-29'));
check('render: punch + status personalised', rendered.includes('*Punch:* Complete') && rendered.includes('*Status:* Present'));
check('render: grace lines personalised', rendered.includes('*Grace Used:* 0m') && rendered.includes('*Grace Remaining:* 30m:2 1h:1 2h:1'));
check('render: placeholders are case-insensitive', renderWhatsAppTemplate('{{employeename}}', vars).includes('Ravi Kumar'));
check('render: unknown placeholders stay untouched', renderWhatsAppTemplate('{{Nope}} {{Paycode}}', vars) === '{{Nope}} 1053');
check('render: empty/missing values render as empty (no "undefined")', !renderWhatsAppTemplate('{{EmployeeName}}', { EmployeeName: undefined }).includes('undefined'));

const previewText = rendered; // UI preview shows exactly what is sent
const chatUrl = manualChatUrl('919876543210', previewText);
check('url: preview text and opened message are identical (decode round-trip)', decodeURIComponent(chatUrl.split('?text=')[1]) === previewText);
check('url: bold markers + plain heading survive encoding', decodeURIComponent(chatUrl.split('?text=')[1]).includes('*DAILY ATTENDANCE*') && decodeURIComponent(chatUrl.split('?text=')[1]).includes('*Name:* Ravi Kumar'));
check('url: wa.me link only (never Meta Graph endpoint)', chatUrl.startsWith('https://wa.me/') && !chatUrl.includes('graph.facebook.com'));
check('url: no auto-send flag ever appended', !chatUrl.includes('send=true'));
/* ================== 6. MULTI-SELECT MANUAL QUEUE (production) ================= */
console.log('\n--- 6. Multi-select manual queue (wa.me one-by-one, no auto-send) ---');
const previews = [
  { paycode: '2001', empname: 'Asha', whatsappnumber: '919111111111', text: 'Msg for Asha' },
  { paycode: '2002', empname: 'Ravi', whatsappnumber: '919222222222', text: 'Msg for Ravi' },
  { paycode: '2003', empname: 'Sita', whatsappnumber: '', text: 'Msg for Sita' }, // invalid number
  { paycode: '2004', empname: 'Mohan', whatsappnumber: '919444444444', text: 'Msg for Mohan' },
];
const q1 = buildManualQueue(previews, ['2004', '2001']);
check('queue: only selected recipients are queued', q1.length === 2);
check('queue: preview order preserved (stable Next/Previous)', q1.map((e) => e.paycode).join(',') === '2001,2004', q1.map((e) => e.paycode).join(','));
check('queue: each recipient keeps their OWN personalised message', q1[0].text === 'Msg for Asha' && q1[1].text === 'Msg for Mohan');
check('queue: invalid-number row can NOT enter the queue (even if selected)', buildManualQueue(previews, ['2003']).length === 0);
check('queue: all-eligible selection excludes the invalid row', buildManualQueue(previews, previews.map((p) => p.paycode)).length === 3);
check('queue: empty selection -> empty queue', buildManualQueue(previews, []).length === 0);
check('queue: entries are wa.me links only', q1.every((e) => e.chatUrl.startsWith('https://wa.me/') && !e.chatUrl.includes('graph.facebook.com')));
check('queue: URLs are prefill-only (no auto-send flag)', q1.every((e) => !e.chatUrl.includes('send=true')));

check('queue progress: "2 of 10" at index 1', queueProgressLabel(1, 10) === '2 of 10');
check('queue progress: first recipient is "1 of N"', queueProgressLabel(0, 3) === '1 of 3');
check('queue progress: empty queue shows nothing', queueProgressLabel(0, 0) === '');
check('queue nav: next advances', queueNeighborIndex(0, 3, 1) === 1);
check('queue nav: previous goes back', queueNeighborIndex(2, 3, -1) === 1);
check('queue nav: clamped at first (no wrap)', queueNeighborIndex(0, 3, -1) === 0);
check('queue nav: clamped at last (no wrap)', queueNeighborIndex(2, 3, 1) === 2);
check('queue nav: empty queue -> -1', queueNeighborIndex(0, 0, 1) === -1);

// UI source guards (web-next/components/hr/WhatsAppSection.jsx).
const uiSrc = readSrc('web-next/components/hr/WhatsAppSection.jsx');
check('ui: Select All Eligible + Clear Selection controls exist', uiSrc.includes('Select All Eligible') && uiSrc.includes('Clear Selection'));
check('ui: Start Manual WhatsApp Queue action exists', uiSrc.includes('Start Manual WhatsApp Queue'));
check('ui: progress shown via queueProgressLabel', uiSrc.includes('queueProgressLabel(queueIndex, queue.length)'));
check('ui: Next + Previous Recipient + Retry actions exist', uiSrc.includes('Next Recipient') && uiSrc.includes('Previous Recipient') && uiSrc.includes('Retry Open Chat'));
check('ui: rows without a valid number have their checkbox disabled', uiSrc.includes('disabled={!chatUrl}'));
check('ui: Select All is limited to the currently displayed results', uiSrc.includes('setSelectedPaycodes(selectablePaycodes)') && uiSrc.includes('selectablePaycodes = (previews || [])'));
check('ui: popup blocking is detectable (window.open without noopener)', uiSrc.includes("window.open(entry.chatUrl, '_blank')"));
check('ui: opening a chat never marks anything sent/delivered', !/chatUrl[\s\S]{0,200}status:\s*'Sent'/.test(uiSrc));
check('ui: queue never calls the Cloud API send endpoint', !uiSrc.split('function startManualQueue')[1]?.split('function gotoQueue')[0]?.includes('apiFetch'));
check('ui: manual queue is explained (Send must be pressed per recipient)', uiSrc.includes('Send khud dabana') || uiSrc.includes('Send khud dabayein'));
/* ==================== 7. CLOUD API SAFETY GATES ============================= */
console.log('\n--- 7. Cloud API mode separation + safety gates ---');
// Replicated canSendReal (same rule as server/index.js — source-guarded below).
function canSendReal(cfg, provider) {
  const mode = String(cfg.mode || 'FREE_MANUAL').toUpperCase();
  const enabled = cfg.enabled === true || cfg.enabled === 1;
  const approved = cfg.approved === true || cfg.approved === 1;
  const dryRun = cfg.dryrun === true || cfg.dryrun === 1;
  return mode === 'CLOUD_API' && enabled && approved && !dryRun && provider.configured;
}
check('gate: FREE_MANUAL mode never allows real send', canSendReal({ mode: 'FREE_MANUAL', enabled: true, approved: true, dryrun: false }, { configured: true }) === false);
check('gate: dry-run=true blocks real send', canSendReal({ mode: 'CLOUD_API', enabled: true, approved: true, dryrun: true }, { configured: true }) === false);
check('gate: disabled blocks real send', canSendReal({ mode: 'CLOUD_API', enabled: false, approved: true, dryrun: false }, { configured: true }) === false);
check('gate: unapproved template blocks real send', canSendReal({ mode: 'CLOUD_API', enabled: true, approved: false, dryrun: false }, { configured: true }) === false);
check('gate: unconfigured provider blocks real send', canSendReal({ mode: 'CLOUD_API', enabled: true, approved: true, dryrun: false }, { configured: false }) === false);
check('gate: all five conditions needed together', canSendReal({ mode: 'CLOUD_API', enabled: true, approved: true, dryrun: false }, { configured: true }) === true);
check('gate: editing provider alone does NOT arm sending (defaults stay safe)', canSendReal({ mode: 'FREE_MANUAL', enabled: false, approved: false, dryrun: true }, { configured: true }) === false);
check('source: index.js gates real sends behind canSendReal', idxSrc.includes('const real = forceReal === true && canSendReal(cfg, provider);'));
check('source: dry-run path short-circuits before any Cloud API call', idxSrc.includes('if (!real) { stat.dryRun++; previews.push(built); continue; }'));
check('source: sendWhatsAppTemplate is the ONLY Graph caller (isolated module)', !idxSrc.includes('graph.facebook.com') && readSrc('server/whatsapp-provider.js').includes('graph.facebook.com/${apiVersion}/${phoneNumberId}/messages'));
check('source: Cloud API uses the SAVED Phone Number ID dynamically', readSrc('server/whatsapp-provider.js').includes('const phoneNumberId = String(active.phoneNumberId || \'\').trim();'));
check('source: safe defaults preserved (FREE_MANUAL + dryrun default ON)', idxSrc.includes("mode: 'FREE_MANUAL'") && idxSrc.includes("DEFAULT(1)"));
check('source: billing warning preserved (scheduled templates may cost)', uiSrc.includes('MAY INCUR') && !uiSrc.includes('scheduled attendance templates are free'));
check('offline: zero network calls during this entire test run', fetchCalls === 0, `fetchCalls=${fetchCalls}`);

/* ==================== 8. REGRESSION / API CONTRACTS ========================= */
console.log('\n--- 8. Existing WhatsApp contracts preserved ---');
for (const route of ["app.get('/api/whatsapp/config'", "app.post('/api/whatsapp/config'", "app.get('/api/whatsapp/provider'", "app.post('/api/whatsapp/provider'", "app.get('/api/whatsapp/health'", "app.get('/api/whatsapp/eligibility'", "app.get('/api/whatsapp/preview'", "app.post('/api/whatsapp/export'", "app.post('/api/whatsapp/send'", "app.get('/api/whatsapp/log'", "app.get('/api/whatsapp/consent'", "app.put('/api/whatsapp/consent'", "app.post('/api/whatsapp/consent/:paycode'"]) {
  check(`contract: ${route.split("'")[1]} still present`, idxSrc.includes(route));
}
check('contract: eligibility response keeps employees/counts/rejected + adds recipients', idxSrc.includes('employees: eligible, rejected, recipients: rows'));
check('contract: new recipient-number endpoint is HR-gated', idxSrc.includes("app.put('/api/whatsapp/recipient-number', requireDbConfig, authenticate, requireRole('HR')"));
check('contract: recipient-number write goes through whatsapp-recipients.mjs', idxSrc.includes('setWhatsAppRecipientNumber(pool, sql,'));
check('contract: consent flows preserve managed numbers (body -> managed -> master)', idxSrc.includes('req.body?.whatsappnumber || managed || emp.telephone1'));
check('contract: template migration is conditional (custom templates untouched)', idxSrc.includes('WHERE templatebody IS NULL OR templatebody = @legacytpl'));
check('contract: consent audit fields still written on consent actions', idxSrc.includes('consentsource') && idxSrc.includes('optedoutat'));
for (const t of ['provider', 'eligibility', 'template', 'preview', 'logs']) {
  check(`ui: five tabs preserved — ${t}`, uiSrc.includes(`id: '${t}'`));
}
check('ui: individual Open WhatsApp + CSV Export + Dry-run + Send Real preserved', uiSrc.includes('Open WhatsApp') && uiSrc.includes('Export CSV') && uiSrc.includes('Run Dry-run') && uiSrc.includes('Send Real'));
check('ui: Provider Config keeps masked-secret behaviour (blank = keep)', uiSrc.includes('leave blank to keep') && uiSrc.includes('*Clear'));
check('ui: status wording is accurate (saved ≠ verified with Meta)', uiSrc.includes('not verified with Meta'));
check('ui: eligibility table shows number, consent, category, active, reason', uiSrc.includes('Status / Reason') && uiSrc.includes('Category') && uiSrc.includes('Consent'));
check('ui: recipient-number save message states consent unchanged', uiSrc.includes('Consent unchanged'));

console.log(`\n=== RESULT: ${passed} passed, ${failed} failed (network calls: ${fetchCalls}) ===`);
process.exit(failed ? 1 : 0);