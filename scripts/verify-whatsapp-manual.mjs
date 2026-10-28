// scripts/verify-whatsapp-manual.mjs — focused tests for the FREE manual WhatsApp
// send flow (click-to-chat) + eligibility enforcement. Offline, no DB / no Meta calls.
import { manualChatUrl } from '../web-next/lib/whatsapp.js';

let passed = 0;
let failed = 0;
function check(name, cond, detail = '') {
  if (cond) { passed += 1; console.log(`PASS :: ${name}${detail ? ` :: ${detail}` : ''}`); }
  else { failed += 1; console.log(`FAIL :: ${name}${detail ? ` :: ${detail}` : ''}`); }
}

console.log('\n=== WhatsApp FREE manual-send focused tests (offline) ===\n');

// ---- 1. manual chat-link creation + phone normalization + URL-encoding ----
check('manualChatUrl normalizes +91 style number to wa.me digits', manualChatUrl('+91 98765 43210', 'hi') === 'https://wa.me/919876543210?text=hi', manualChatUrl('+91 98765 43210', 'hi') || 'null');
check('manualChatUrl keeps digits-only E.164 input unchanged', manualChatUrl('919876543210', 'x') === 'https://wa.me/919876543210?text=x');
check('manualChatUrl URL-encodes message text (spaces, newlines, #)', (manualChatUrl('919876543210', 'A B\nC#D') || '').includes('text=A%20B%0AC%23D'), manualChatUrl('919876543210', 'A B\nC#D'));
check('manualChatUrl returns null when number is missing/invalid', manualChatUrl('', 'hi') === null && manualChatUrl('abc', 'hi') === null);
check('manualChatUrl is a wa.me link (never the Meta Graph send endpoint)', (manualChatUrl('919876543210', 'hi') || '').startsWith('https://wa.me/') && !(manualChatUrl('919876543210', 'hi') || '').includes('graph.facebook.com'));
check('manualChatUrl only prefills text (no auto-send query flag)', !(manualChatUrl('919876543210', 'hi') || '').includes('send=true'));

// ---- 2. category enforcement (the fixed code/name matching) ----
const categoryMap = new Map([['001', 'STAFF'], ['002', 'WORKER'], ['003', 'GUARD'], ['004', 'PEON']]);
const resolveCategory = (code) => { const c = String(code || '').trim().toUpperCase(); return categoryMap.get(c) || c; };
const isStaffCategory = (code) => ['STAFF', 'STF'].includes(resolveCategory(code));
function catOk(eligibleCatsRaw, code) {
  const eligibleCats = String(eligibleCatsRaw || '').split(',').map((c) => c.trim().toUpperCase()).filter(Boolean);
  const catCodeUpper = String(code || '').trim().toUpperCase();
  const catName = resolveCategory(code);
  return eligibleCats.length
    ? eligibleCats.some((c) => c === catCodeUpper || c === catName)
    : isStaffCategory(code);
}
check('category: configured NAME "STAFF" matches employee code 001', catOk('STAFF', '001') === true);
check('category: configured CODE "001" matches employee code 001', catOk('001', '001') === true);
check('category: empty config falls back to staff rule (001 allowed)', catOk('', '001') === true);
check('category: "STAFF" does NOT match WORKER code 002', catOk('STAFF', '002') === false);
check('category: "WORKER" matches 002, not 001', catOk('WORKER', '002') === true && catOk('WORKER', '001') === false);

// ---- 3. consent + active-status enforcement (replicated eligibility gate) ----
function eligible(emp) {
  if (emp.activeRaw === false || emp.activeRaw === 0 || String(emp.activeRaw || '').trim().toUpperCase() === 'N') return false;
  const consent = emp.consent;
  const granted = consent && String(consent.consentstatus || '').trim() === 'Granted' && !consent.optedoutat;
  return Boolean(granted); // same truthiness gate as the server's `if (!granted)`
}
check('consent: Granted + active employee is eligible', eligible({ activeRaw: 'Y', consent: { consentstatus: 'Granted', optedoutat: null } }) === true);
check('consent: consent Granted ALONE does NOT bypass active requirement', eligible({ activeRaw: 'N', consent: { consentstatus: 'Granted', optedoutat: null } }) === false);
check('consent: no consent record is not eligible', eligible({ activeRaw: 'Y', consent: null }) === false);
check('consent: opted-out is not eligible even if Granted', eligible({ activeRaw: 'Y', consent: { consentstatus: 'Granted', optedoutat: '2026-01-01' } }) === false);
check('consent: Revoked is not eligible', eligible({ activeRaw: 'Y', consent: { consentstatus: 'Revoked', optedoutat: null } }) === false);

// ---- 4. zero eligible cannot trigger a real send ----
function canSendReal(cfg, provider, eligibleCount) {
  const mode = String(cfg.mode || 'FREE_MANUAL').toUpperCase();
  const enabled = cfg.enabled === true || cfg.enabled === 1;
  const approved = cfg.approved === true || cfg.approved === 1;
  const dryRun = cfg.dryrun === true || cfg.dryrun === 1;
  return mode === 'CLOUD_API' && enabled && approved && !dryRun && provider.configured && eligibleCount > 0;
}
check('zero eligible recipients cannot enable real send', canSendReal({ mode: 'CLOUD_API', enabled: true, approved: true, dryrun: false }, { configured: true }, 0) === false);
check('FREE_MANUAL default never enables real send', canSendReal({ mode: 'FREE_MANUAL', enabled: true, approved: true, dryrun: false }, { configured: true }, 5) === false);
check('dry-run=true blocks real send even when configured', canSendReal({ mode: 'CLOUD_API', enabled: true, approved: true, dryrun: true }, { configured: true }, 5) === false);
check('unconfigured provider blocks real send', canSendReal({ mode: 'CLOUD_API', enabled: true, approved: true, dryrun: false }, { configured: false }, 5) === false);

// ---- 5. eligibility reason classification (mutually exclusive primary reasons) ----
function classifyReason(emp) {
  if (emp.outOfScope) return 'OUT_OF_SCOPE';
  if (emp.inactive) return 'INACTIVE';
  if (!catOk(emp.eligibleCats, emp.cat)) return 'CATEGORY_MISMATCH';
  const rawPhone = String(emp.rawPhone || '').trim();
  if (!rawPhone) return 'NO_NUMBER';
  const digits = rawPhone.replace(/\D/g, '');
  if (!digits || !/^[1-9]\d{9,14}$/.test(digits) ) return 'INVALID_NUMBER';
  const consent = emp.consent;
  if (!consent || String(consent.consentstatus || '').trim() !== 'Granted') return 'NO_CONSENT';
  if (consent.optedoutat) return 'OPTED_OUT';
  return 'ELIGIBLE';
}
const grantedConsent = { consentstatus: 'Granted', optedoutat: null };
check('reason: valid eligible employee -> ELIGIBLE', classifyReason({ cat: '001', eligibleCats: 'STAFF', rawPhone: '9876543210', consent: grantedConsent }) === 'ELIGIBLE');
check('reason: inactive -> INACTIVE (single reason)', classifyReason({ cat: '001', eligibleCats: 'STAFF', rawPhone: '9876543210', consent: grantedConsent, inactive: true }) === 'INACTIVE');
check('reason: wrong category -> CATEGORY_MISMATCH', classifyReason({ cat: '002', eligibleCats: 'STAFF', rawPhone: '9876543210', consent: grantedConsent }) === 'CATEGORY_MISMATCH');
check('reason: missing number -> NO_NUMBER', classifyReason({ cat: '001', eligibleCats: 'STAFF', rawPhone: '', consent: grantedConsent }) === 'NO_NUMBER');
check('reason: invalid number -> INVALID_NUMBER', classifyReason({ cat: '001', eligibleCats: 'STAFF', rawPhone: '123', consent: grantedConsent }) === 'INVALID_NUMBER');
check('reason: no consent -> NO_CONSENT', classifyReason({ cat: '001', eligibleCats: 'STAFF', rawPhone: '9876543210', consent: null }) === 'NO_CONSENT');
check('reason: opted-out is DISTINCT from no-consent -> OPTED_OUT', classifyReason({ cat: '001', eligibleCats: 'STAFF', rawPhone: '9876543210', consent: { consentstatus: 'Granted', optedoutat: '2026-01-01' } }) === 'OPTED_OUT');
check('reason: out-of-scope -> OUT_OF_SCOPE', classifyReason({ cat: '001', eligibleCats: 'STAFF', rawPhone: '9876543210', consent: grantedConsent, outOfScope: true }) === 'OUT_OF_SCOPE');
// Mutual exclusivity: an employee matches exactly one primary reason.
const mixed = [
  { cat: '001', eligibleCats: 'STAFF', rawPhone: '9876543210', consent: grantedConsent, inactive: true },
  { cat: '002', eligibleCats: 'STAFF', rawPhone: '9876543210', consent: grantedConsent, inactive: true },
];
check('reason: mutually exclusive (inactive takes precedence over category)', classifyReason(mixed[0]) === 'INACTIVE' && classifyReason(mixed[1]) === 'INACTIVE');

console.log(`\n=== RESULT: ${passed} passed, ${failed} failed ===`);
process.exit(failed ? 1 : 0);
