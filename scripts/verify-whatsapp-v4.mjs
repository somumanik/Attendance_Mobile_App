// scripts/verify-whatsapp-v4.mjs — WhatsApp Module V4 focused tests (offline).
// Covers:
//   C. Message Unicode/emoji integrity: conservative template, single URL
//      encoding, exact decode round-trip, U+FFFD/lone-surrogate stripping,
//      bold markers, newlines, spaces, &, #, Hindi text.
//   D. Grace Used trace: the authoritative computeLateStatus rule (replicated +
//      source-guarded against server/index.js) — early/on-time arrivals must NOT
//      be labelled grace-used; the Grace Used line is omitted when nothing was
//      consumed; Grace Remaining only for staff (valid value).
//   B. Search (paycode + name), filters, 25/50/200 pagination, select-page vs
//      select-all-filtered, selection persistence (production lib helpers).
//   E. Manual queue regression across pages/filters: per-recipient personalisation,
//      ineligible/invalid exclusion, progress labels.
// Offline by construction: global fetch throws, so NO Meta/WhatsApp/DB network
// call can happen. Live SQL was unreachable in this environment (ETIMEOUT) —
// employee/shift values (incl. Paycode 1109) could NOT be verified live; the
// grace tests use fixture shift maps (NOT a hardcoded 10:00/10:05 shift) and the
// configured project rules (universal 5-min grace; staff monthly 2/1/1 limits).
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

let fetchCalls = 0;
globalThis.fetch = (...args) => {
  fetchCalls += 1;
  throw new Error(`NETWORK CALL ATTEMPTED during offline tests: ${String(args[0])}`);
};

const __filename = fileURLToPath(import.meta.url);
const ROOT = path.resolve(path.dirname(__filename), '..');
const readSrc = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');

const {
  WHATSAPP_DEFAULT_TEMPLATE, WHATSAPP_LEGACY_DEFAULT_TEMPLATE, WHATSAPP_RISKY_CHARS,
  renderWhatsAppTemplate, normalizeWhatsAppNumber, hasRiskyTemplateSymbols, stripBrokenChars, stripDecorativeChars,
  completionSentence, formatHoursMinutes,
} = await import('../server/whatsapp-message.mjs');
const {
  manualChatUrl, buildManualQueue, queueNeighborIndex, queueProgressLabel,
  PAGE_SIZES, matchSearch, paginate, togglePaycodeSelection, mergePaycodeSelection,
} = await import('../web-next/lib/whatsapp.js');

let passed = 0;
let failed = 0;
function check(name, cond, detail = '') {
  if (cond) { passed += 1; console.log(`PASS :: ${name}${detail ? ` :: ${detail}` : ''}`); }
  else { failed += 1; console.log(`FAIL :: ${name}${detail ? ` :: ${detail}` : ''}`); }
}
console.log('\n=== WhatsApp Module V4 focused tests (offline — no Meta/SQL) ===\n');

/* ================== C. MESSAGE CHARACTERS + FORMATTING ====================== */
console.log('--- C. Unicode/emoji integrity + formatting (production code) ---');
check('template: plain bold heading kept (no emoji)', WHATSAPP_DEFAULT_TEMPLATE.startsWith('*DAILY ATTENDANCE*'));
check('template: NO risky symbols in the default template', !hasRiskyTemplateSymbols(WHATSAPP_DEFAULT_TEMPLATE));
check('template: risky set exactly targets the old problem glyphs', WHATSAPP_RISKY_CHARS.includes('\uFFFD') && WHATSAPP_RISKY_CHARS.includes('\uFE0F') && WHATSAPP_RISKY_CHARS.includes('\u{1F7E2}') && WHATSAPP_RISKY_CHARS.includes('\u{23F1}') && WHATSAPP_RISKY_CHARS.includes('\u{1F194}'));
check('template: old green-circle/stopwatch/squared-ID glyphs are gone', !WHATSAPP_DEFAULT_TEMPLATE.includes('\u{1F7E2}') && !WHATSAPP_DEFAULT_TEMPLATE.includes('\u{23F1}') && !WHATSAPP_DEFAULT_TEMPLATE.includes('\u{1F194}') && !WHATSAPP_DEFAULT_TEMPLATE.includes('\uFE0F'));
check('template: every emoji is a valid surrogate pair (no lone surrogates)', stripBrokenChars(WHATSAPP_DEFAULT_TEMPLATE) === WHATSAPP_DEFAULT_TEMPLATE);
check('template: bold labels present', ['*Name:*', '*Paycode:*', '*Date:*', '*In-Time:*', '*Out-Time:*', '*Punch:*', '*Status:*', '*Grace Used:*', '*Grace Remaining:*'].every((t) => WHATSAPP_DEFAULT_TEMPLATE.includes(t)));
check('template: all 9 variables preserved', ['{{EmployeeName}}', '{{Paycode}}', '{{AttendanceDate}}', '{{InTime}}', '{{OutTime}}', '{{PunchStatus}}', '{{Status}}', '{{GraceUsed}}', '{{GraceRemaining}}'].every((v) => WHATSAPP_DEFAULT_TEMPLATE.includes(v)));
check('template: clear line breaks + spacing', WHATSAPP_DEFAULT_TEMPLATE.split('\n').length >= 9);
check('template: no HTML / colored-font claims', !/<[a-z]/i.test(WHATSAPP_DEFAULT_TEMPLATE) && !/color/i.test(WHATSAPP_DEFAULT_TEMPLATE));
check('template: legacy default untouched (custom templates never auto-overwritten)', WHATSAPP_LEGACY_DEFAULT_TEMPLATE.startsWith('Hello {{EmployeeName}}'));

// URL encoding: exactly once, byte-exact decode round-trip.
const tricky = '📋 *DAILY ATTENDANCE*\n👤 *Name:* रवि कुमार (Ravi & Sons #2)\n⏱ check 100% + 5min = ok?\n*Status:* Present';
const trickyUrl = manualChatUrl('919876543210', tricky);
const trickyDecoded = decodeURIComponent(trickyUrl.split('?text=')[1]);
check('url: decode(text) === intended message exactly (emoji + Hindi + & # % + = ?)', trickyDecoded === tricky);
check('url: encoded exactly once (no double-encode %2525; literal % is single-encoded)', !trickyUrl.includes('%2525') && !manualChatUrl('919876543210', 'plain *bold* text').includes('%25'));
check('url: newlines/spaces percent-encoded but preserved on decode', trickyUrl.includes('%0A') && trickyDecoded.includes('\n'));
check('url: emoji survive as UTF-8 percent-sequences', /%F0%9F/.test(trickyUrl) && trickyDecoded.includes('📋'));
check('url: wa.me link only, prefill-only', trickyUrl.startsWith('https://wa.me/') && !trickyUrl.includes('graph.facebook.com') && !trickyUrl.includes('send=true'));
// Broken-character stripping: literal U+FFFD and lone surrogates can never reach chat.
check('strip: literal U+FFFD removed from generated text', stripBrokenChars('A\uFFFDB') === 'AB');
check('strip: lone surrogates removed, valid emoji kept', stripBrokenChars('\uD83D test \uDC00 end 📋') === ' test  end 📋');
const corrupted = renderWhatsAppTemplate('*Name:* {{EmployeeName}}', { EmployeeName: 'Ravi\uFFFD Kumar' });
check('render: U+FFFD in variable values is stripped (never a diamond in chat)', corrupted === '*Name:* Ravi Kumar', JSON.stringify(corrupted));
check('render: valid emoji in values preserved byte-for-byte', renderWhatsAppTemplate('*X:* {{V}}', { V: '📋✅ रवि' }) === '*X:* 📋✅ रवि');

// Line omission (D7/D8 mechanics): empty-value lines disappear entirely.
const tpl = '📋 *DAILY ATTENDANCE*\n👤 *Name:* {{EmployeeName}}\n\n*Grace Used:* {{GraceUsed}}\n*Grace Remaining:* {{GraceRemaining}}';
const noGrace = renderWhatsAppTemplate(tpl, { EmployeeName: 'Ravi', GraceUsed: '', GraceRemaining: '' });
check('render: empty GraceUsed/GraceRemaining omit the ENTIRE lines', !noGrace.includes('Grace Used') && !noGrace.includes('Grace Remaining'), JSON.stringify(noGrace));
check('render: heading + name line survive, no dangling blank tail (template emoji stripped)', noGrace === '*DAILY ATTENDANCE*\n*Name:* Ravi', JSON.stringify(noGrace));
const onlyUsed = renderWhatsAppTemplate(tpl, { EmployeeName: 'Ravi', GraceUsed: '5min', GraceRemaining: '' });
check('render: consumed grace keeps its line, empty remaining line dropped', onlyUsed.includes('*Grace Used:* 5min') && !onlyUsed.includes('Grace Remaining'));
const legacyBoth = renderWhatsAppTemplate('Grace Used: {{GraceUsed}} | Grace Remaining: {{GraceRemaining}}', { GraceUsed: '', GraceRemaining: '' });
check('render: multi-var line drops only when ALL its values are empty', legacyBoth === '');
const legacyOne = renderWhatsAppTemplate('Grace Used: {{GraceUsed}} | Grace Remaining: {{GraceRemaining}}', { GraceUsed: '', GraceRemaining: '30min x2' });
check('render: multi-var line keeps label when at least one value exists', legacyOne === 'Grace Used:  | Grace Remaining: 30min x2');
check('render: unknown placeholders keep their line visible', renderWhatsAppTemplate('{{Nope}} {{Paycode}}', { Paycode: '1053' }) === '{{Nope}} 1053');
check('render: preview text === opened WhatsApp text (same render both sides)', decodeURIComponent(manualChatUrl('919876543210', noGrace).split('?text=')[1]) === noGrace);
check('hasRiskyTemplateSymbols flags the old V3 template symbols', hasRiskyTemplateSymbols('🟢 *In-Time:* x ⏱️ grace 🆔') === true);
check('hasRiskyTemplateSymbols passes the safe default', hasRiskyTemplateSymbols(WHATSAPP_DEFAULT_TEMPLATE) === false);

/* ---- C2. Plain-text cleanup: exact required format + replacement-char tests ---- */
console.log('--- C2. Plain-text message (no emoji / no replacement characters) ---');
const goldenVars = {
  EmployeeName: 'Manik K Chaudhari', Paycode: '1053', AttendanceDate: '2026-10-29',
  InTime: '09:57 AM', OutTime: '—', PunchStatus: 'Missing OUT', Status: 'Present',
  GraceUsed: '', GraceRemaining: '30min x2 | 1hr x1 | 2hr x1', Completion: '',
};
const golden = renderWhatsAppTemplate(WHATSAPP_DEFAULT_TEMPLATE, goldenVars);
const goldenExpected = '*DAILY ATTENDANCE*\n\n*Name:* Manik K Chaudhari\n*Paycode:* 1053\n*Date:* 2026-10-29\n\n*In-Time:* 09:57 AM\n*Out-Time:* —\n*Punch:* Missing OUT\n*Status:* Present\n\n*Grace Remaining:* 30min x2 | 1hr x1 | 2hr x1';
check('golden: generated message matches the required plain-text format exactly', golden === goldenExpected, JSON.stringify(golden));
check('golden: NO emoji/icon/decorative symbols in the generated message', stripDecorativeChars(golden) === golden && !/\p{Extended_Pictographic}/u.test(golden));
check('golden: NO replacement characters (� or ?) in the generated message', !golden.includes('\uFFFD') && !golden.includes('?'));
check('golden: em-dash placeholder for missing Out-Time preserved', golden.includes('*Out-Time:* —'));
check('golden: Grace Used line omitted entirely (no grace consumed)', !golden.includes('Grace Used'));
check('golden: blank-line grouping (heading / identity / punches / grace)', golden.split('\n\n').length === 4);
const goldenUrl = manualChatUrl('919876543210', golden);
check('golden: URL decodes to the EXACT intended text (encoded once)', decodeURIComponent(goldenUrl.split('?text=')[1]) === golden && !goldenUrl.includes('%2525'));
const oldEmojiTpl = '📋 *DAILY ATTENDANCE*\n👤 *Name:* {{EmployeeName}}\n🟢 *In-Time:* {{InTime}}\n⏱️ *Grace Used:* {{GraceUsed}}';
const cleaned = renderWhatsAppTemplate(oldEmojiTpl, { EmployeeName: 'रवि कुमार', InTime: '09:57 AM', GraceUsed: '5min' });
check('cleanup: old emoji template renders PLAIN — symbols removed, values intact', cleaned === '*DAILY ATTENDANCE*\n*Name:* रवि कुमार\n*In-Time:* 09:57 AM\n*Grace Used:* 5min', JSON.stringify(cleaned));
check('cleanup: Hindi/punctuation values never become � or ?', cleaned.includes('रवि कुमार') && renderWhatsAppTemplate('*X:* {{V}}', { V: 'A—B·C〈D〉' }) === '*X:* A—B·C〈D〉');
check('cleanup: valid value emoji preserved byte-for-byte (values untouched)', renderWhatsAppTemplate('*X:* {{V}}', { V: '📋 रवि' }) === '*X:* 📋 रवि');

/* ---- C3. Attendance completion sentence (authoritative data only) ---- */
console.log('--- C3. Completion sentence (completed / early departure / missing OUT) ---');
check('completion: IN+OUT with full worked hours -> completed', completionSentence({ hasIn: true, hasOut: true, presentDay: true, shiftStartMinutes: 540, shiftEndMinutes: 1080, workedMinutes: 540 }) === "Your today's attendance is completed.");
check('completion: early departure (worked < shift) -> not complete + remaining', completionSentence({ hasIn: true, hasOut: true, presentDay: true, shiftStartMinutes: 540, shiftEndMinutes: 1080, workedMinutes: 300 }) === 'Your shift is not yet complete. Remaining: 4h');
check('completion: remaining hours formatted (90 min -> 1h 30m)', completionSentence({ hasIn: true, hasOut: true, presentDay: true, shiftStartMinutes: 540, shiftEndMinutes: 1080, workedMinutes: 450 }) === 'Your shift is not yet complete. Remaining: 1h 30m');
check('completion: missing OUT while shift running -> not yet complete (no hours)', completionSentence({ hasIn: true, hasOut: false, presentDay: true, shiftStartMinutes: 540, shiftEndMinutes: 1080, nowMinutes: 900 }) === 'Your shift is not yet complete.');
check('completion: missing OUT after shift ended -> omit (miss punch keeps status)', completionSentence({ hasIn: true, hasOut: false, presentDay: true, shiftStartMinutes: 540, shiftEndMinutes: 1080, nowMinutes: 1100 }) === '');
check('completion: no IN punch -> omit', completionSentence({ hasIn: false, hasOut: false, presentDay: true, shiftStartMinutes: 540, shiftEndMinutes: 1080, workedMinutes: 540 }) === '');
check('completion: non-present day (week off/absent) -> omit', completionSentence({ hasIn: true, hasOut: true, presentDay: false, shiftStartMinutes: 540, shiftEndMinutes: 1080, workedMinutes: 540 }) === '');
check('completion: unknown shift -> omit (do not guess)', completionSentence({ hasIn: true, hasOut: true, presentDay: true, shiftStartMinutes: null, shiftEndMinutes: null, workedMinutes: 540 }) === '');
check('completion: cross-midnight shift -> omit', completionSentence({ hasIn: true, hasOut: true, presentDay: true, shiftStartMinutes: 1200, shiftEndMinutes: 240, crossMidnight: true, workedMinutes: 540 }) === '');
check('completion: worked-hours unavailable -> omit', completionSentence({ hasIn: true, hasOut: true, presentDay: true, shiftStartMinutes: 540, shiftEndMinutes: 1080, workedMinutes: null }) === '');
check('formatHoursMinutes: 90/60/45/0', formatHoursMinutes(90) === '1h 30m' && formatHoursMinutes(60) === '1h' && formatHoursMinutes(45) === '45m' && formatHoursMinutes(0) === '0m');
const completedMsg = renderWhatsAppTemplate(WHATSAPP_DEFAULT_TEMPLATE, { ...goldenVars, PunchStatus: 'Complete', OutTime: '06:00 PM', Completion: "Your today's attendance is completed." });
check('completion: rendered message includes the completed sentence', completedMsg.includes("Your today's attendance is completed.") && completedMsg.includes('*Punch:* Complete'));
check('completion: empty Completion line is omitted entirely', !golden.includes('Completion') && !golden.includes('completed'));
/* ============ D. GRACE USED — AUTHORITATIVE RULE (replicated + guarded) ======
   computeLateStatus lives inside server/index.js (not importable). The replica
   below mirrors it EXACTLY and is pinned by source-text guards afterwards.
   Fixture shift maps use the real loadShiftEndTimes shape and arbitrary start
   times (09:45 / 14:30 / 10:30) — NOT a hardcoded 10:00 or 10:05 shift. */
console.log('\n--- D. Grace Used: early arrival must NOT count as grace consumed ---');
const punchAt = (h, m) => new Date(Date.UTC(1900, 0, 1, h, m, 0));
const mkShift = (start, end, byCompany = {}) => ({
  byCompany: new Map(Object.entries(byCompany).map(([c, s]) => [c, s])),
  defaultStart: start, defaultEnd: end, defaultCross: end <= start,
});
const fixtureShiftMap = new Map([
  ['GEN', mkShift(9 * 60 + 45, 18 * 60 + 30, { C2: { start: 10 * 60 + 30, end: 19 * 60, cross: false } })], // 09:45 (C2: 10:30)
  ['EVE', mkShift(14 * 60 + 30, 23 * 60)], // 14:30
]);

function attendanceCodeRep(status) { return String(status || '').trim().toUpperCase(); }
function punchTimeToMinutesRep(punchValue) {
  if (!punchValue) return null;
  const d = punchValue instanceof Date ? punchValue : new Date(punchValue);
  if (Number.isNaN(d.valueOf())) return null;
  return d.getUTCHours() * 60 + d.getUTCMinutes();
}
function getShiftStartMinutesRep(shiftMap, shift, companycode) {
  if (!shiftMap || !shift) return null;
  const entry = shiftMap.get(String(shift).trim());
  if (!entry) return null;
  const comp = String(companycode || '').trim();
  const chosen = comp ? entry.byCompany.get(comp) : null;
  return chosen ? chosen.start : entry.defaultStart;
}
// Mirror of computeLateStatus (V4 corrected version).
function computeLateStatusRep(row, shiftMap, employeeCategory, companycode, paycode, shiftCodeOverride = null) {
  if (!row) return { isLate: false, lateMinutes: 0, graceUsed: null };
  if (attendanceCodeRep(row.status) === 'LATE' || attendanceCodeRep(row.statusCode) === 'LATE') {
    return { isLate: true, lateMinutes: Number(row.latearrival || 0), graceUsed: null };
  }
  const inTime = row.in1 || row.in2;
  const punchMinutes = punchTimeToMinutesRep(inTime);
  if (punchMinutes === null) return { isLate: false, lateMinutes: 0, graceUsed: null };
  const shiftCode = shiftCodeOverride ? String(shiftCodeOverride).trim() : (row.shift || '');
  const shiftStartMinutes = getShiftStartMinutesRep(shiftMap, shiftCode, companycode);
  if (shiftStartMinutes === null) {
    return { isLate: Number(row.latearrival || 0) > 0, lateMinutes: Number(row.latearrival || 0), graceUsed: null };
  }
  const graceThreshold = shiftStartMinutes + 5;
  const lateMinutes = Math.max(0, punchMinutes - graceThreshold);
  if (lateMinutes <= 0) {
    const graceConsumed = punchMinutes > shiftStartMinutes;
    return { isLate: false, lateMinutes: 0, graceUsed: graceConsumed ? '5min' : null };
  }
  return { isLate: true, lateMinutes, graceUsed: null };
}

const g = (punch, opts = {}) => computeLateStatusRep({ in1: punch, in2: null, status: opts.status || 'P', shift: opts.shift || 'GEN', latearrival: opts.latearrival || 0 }, fixtureShiftMap, '001', opts.companycode || 'C1', 'X', opts.shift || 'GEN');
// Shift GEN starts 09:45 (fixture — NOT 10:00/10:05).
check('grace: EARLY arrival (09:25 for 09:45 shift) consumed NO grace', g(punchAt(9, 25)).graceUsed === null && g(punchAt(9, 25)).isLate === false);
check('grace: EXACTLY at shift start (09:45) consumed NO grace', g(punchAt(9, 45)).graceUsed === null && g(punchAt(9, 45)).isLate === false);
check('grace: within 5-min window (09:48) consumed the 5min universal grace', g(punchAt(9, 48)).graceUsed === '5min' && g(punchAt(9, 48)).isLate === false);
check('grace: window edge (09:50 = start+5) still the 5min grace, not late', g(punchAt(9, 50)).graceUsed === '5min' && g(punchAt(9, 50)).lateMinutes === 0);
check('grace: beyond window (09:52) is late by 2 min with NO universal label', g(punchAt(9, 52)).isLate === true && g(punchAt(9, 52)).lateMinutes === 2 && g(punchAt(9, 52)).graceUsed === null);
check('grace: second fixture shift EVE 14:30 — early 14:00 consumes nothing', g(punchAt(14, 0), { shift: 'EVE' }).graceUsed === null);
check('grace: EVE within window 14:33 shows 5min', g(punchAt(14, 33), { shift: 'EVE' }).graceUsed === '5min');
check('grace: company-specific start (C2 10:30) respected — 10:10 is early', g(punchAt(10, 10), { companycode: 'C2' }).graceUsed === null);
check('grace: missing IN punch -> no grace, not fabricated', g(null).graceUsed === null && g(null).isLate === false);
check('grace: missing OUT punch keeps existing meaning (grace only looks at IN)', computeLateStatusRep({ in1: punchAt(9, 48), out1: null, status: 'P', shift: 'GEN' }, fixtureShiftMap, '001', 'C1', 'X', 'GEN').graceUsed === '5min');
check('grace: explicit LATE status row -> late from DB value, no grace label', g(punchAt(9, 30), { status: 'LATE', latearrival: 15 }).isLate === true && g(punchAt(9, 30), { status: 'LATE', latearrival: 15 }).graceUsed === null);
check('grace: no shift info falls back to DB latearrival (no invented grace)', computeLateStatusRep({ in1: punchAt(9, 48), status: 'P', shift: 'UNK', latearrival: 7 }, fixtureShiftMap, '001', 'C1', 'X', 'UNK').graceUsed === null);
// Monthly STAFF grace application (mirror of computeMonthlyLateForEmployee's
// consumption block; limits are the project's configured values).
const STAFF_MONTHLY_GRACE_LIMITS = Object.freeze({ grace30min: 2, grace1hr: 1, grace2hr: 1 });
function applyMonthlyGraceRep(lateMinutesList, isStaff) {
  let grace30minRemaining = isStaff ? STAFF_MONTHLY_GRACE_LIMITS.grace30min : 0;
  let grace1hrRemaining = isStaff ? STAFF_MONTHLY_GRACE_LIMITS.grace1hr : 0;
  let grace2hrRemaining = isStaff ? STAFF_MONTHLY_GRACE_LIMITS.grace2hr : 0;
  const details = [];
  let finalLateCount = 0;
  for (const lateMinutes of lateMinutesList) {
    let graceApplied = null;
    let covered = false;
    if (isStaff) {
      if (lateMinutes <= 30 && grace30minRemaining > 0) { grace30minRemaining--; graceApplied = '30min'; covered = true; }
      else if (lateMinutes <= 60 && grace1hrRemaining > 0) { grace1hrRemaining--; graceApplied = '1hr'; covered = true; }
      else if (lateMinutes <= 120 && grace2hrRemaining > 0) { grace2hrRemaining--; graceApplied = '2hr'; covered = true; }
    }
    if (!covered) finalLateCount++;
    details.push({ lateMinutes, graceUsed: graceApplied, isFinalLate: !covered });
  }
  return { finalLateCount, details, graceRemaining: { grace30min: grace30minRemaining, grace1hr: grace1hrRemaining, grace2hr: grace2hrRemaining } };
}
const monthly = applyMonthlyGraceRep([10, 20, 40, 70, 130], true);
check('monthly: small lates consume 30min x2 first (configured limit)', monthly.details[0].graceUsed === '30min' && monthly.details[1].graceUsed === '30min');
check('monthly: 40-min late covered by 1hr allowance', monthly.details[2].graceUsed === '1hr');
check('monthly: 70-min late covered by 2hr allowance', monthly.details[3].graceUsed === '2hr');
check('monthly: late BEYOND all grace -> final late with NO grace label', monthly.details[4].graceUsed === null && monthly.details[4].isFinalLate === true && monthly.finalLateCount === 1);
check('monthly: staff allowances fully consumed -> remaining all zero', monthly.graceRemaining.grace30min === 0 && monthly.graceRemaining.grace1hr === 0 && monthly.graceRemaining.grace2hr === 0);
const nonStaff = applyMonthlyGraceRep([10], false);
check('monthly: non-staff never consumes staff grace', nonStaff.details[0].graceUsed === null && nonStaff.finalLateCount === 1);
// WhatsApp message mapping (mirror of buildWhatsAppMessageForEmployee's mapping).
function mapGraceForMessageRep(lateDetailGraceUsed, rowGraceUsed, isStaff, remaining) {
  const graceUsed = lateDetailGraceUsed ? lateDetailGraceUsed : (rowGraceUsed || '');
  const graceRemaining = isStaff && remaining
    ? `30min x${remaining.grace30min ?? 0} | 1hr x${remaining.grace1hr ?? 0} | 2hr x${remaining.grace2hr ?? 0}`
    : '';
  return { graceUsed, graceRemaining };
}
check('map: early/on-time day (no grace consumed) -> GraceUsed empty (line omitted)', mapGraceForMessageRep(null, null, true, { grace30min: 2, grace1hr: 1, grace2hr: 1 }).graceUsed === '');
check('map: within-grace day shows the 5min universal allowance', mapGraceForMessageRep(null, '5min', true, { grace30min: 2, grace1hr: 1, grace2hr: 1 }).graceUsed === '5min');
check('map: monthly-covered late day shows the consumed allowance', mapGraceForMessageRep('30min', null, true, { grace30min: 1, grace1hr: 1, grace2hr: 1 }).graceUsed === '30min');
check('map: final-late day without coverage shows NO GraceUsed', mapGraceForMessageRep(null, null, true, null).graceUsed === '');
check('map: staff GraceRemaining is a clean readable format', mapGraceForMessageRep(null, null, true, { grace30min: 2, grace1hr: 1, grace2hr: 0 }).graceRemaining === '30min x2 | 1hr x1 | 2hr x0');
check('map: non-staff GraceRemaining is omitted entirely', mapGraceForMessageRep(null, '5min', false, { grace30min: 0, grace1hr: 0, grace2hr: 0 }).graceRemaining === '');
const endToEnd = renderWhatsAppTemplate(WHATSAPP_DEFAULT_TEMPLATE, {
  EmployeeName: 'Test Emp', Paycode: '9001', AttendanceDate: '2026-10-29',
  InTime: '09:25 AM', OutTime: '06:30 PM', PunchStatus: 'Complete', Status: 'Present',
  GraceUsed: mapGraceForMessageRep(null, null, true, { grace30min: 2, grace1hr: 1, grace2hr: 1 }).graceUsed,
  GraceRemaining: mapGraceForMessageRep(null, null, true, { grace30min: 2, grace1hr: 1, grace2hr: 1 }).graceRemaining,
});
check('end-to-end: early-arrival message has NO Grace Used line and NO 0min/— text', !endToEnd.includes('Grace Used') && !/\b0min\b/.test(endToEnd) && !endToEnd.includes('—'));
check('end-to-end: Grace Remaining line present for staff with valid counts', endToEnd.includes('*Grace Remaining:* 30min x2 | 1hr x1 | 2hr x1'));

// Source guards: the authoritative server/index.js must contain exactly this logic.
const idxSrc = readSrc('server/index.js');
check('source: early-arrival fix present (grace consumed only after shift start)', idxSrc.includes('const graceConsumed = punchMinutes > shiftStartMinutes;') && idxSrc.includes("graceUsed: graceConsumed ? '5min' : null };"));
check('source: old always-5min bug is GONE', !idxSrc.includes("return { isLate: false, lateMinutes: 0, graceUsed: '5min' };"));
check('source: universal 5-minute grace rule unchanged', idxSrc.includes('const graceThreshold = shiftStartMinutes + 5;'));
check('source: staff monthly limits unchanged (2/1/1)', idxSrc.includes('const STAFF_MONTHLY_GRACE_LIMITS = Object.freeze({ grace30min: 2, grace1hr: 1, grace2hr: 1 });'));
check('source: monthly consumption thresholds unchanged', idxSrc.includes('lateStatus.lateMinutes <= 30 && grace30minRemaining > 0') && idxSrc.includes('lateStatus.lateMinutes <= 60 && grace1hrRemaining > 0') && idxSrc.includes('lateStatus.lateMinutes <= 120 && grace2hrRemaining > 0'));
check('source: WhatsApp mapping reuses authoritative values (no new formula)', idxSrc.includes("const graceUsed = (lateDetail && lateDetail.graceUsed) ? lateDetail.graceUsed : (row.graceUsed || '');"));
check('source: no-record rows get empty grace (lines omitted, no fabrication)', idxSrc.includes("graceUsed: '', graceRemaining: ''"));
check('source: GraceRemaining uses clean format for staff only', idxSrc.includes('30min x${') && idxSrc.includes(": '';"));
check('source: GraceRemaining uses pipe separators (readable counts)', idxSrc.includes(' | 1hr x${'));
check('source: builder produces the completion sentence from existing data only', idxSrc.includes('completionSentence({') && idxSrc.includes('Completion: completion'));
/* ================= B. SEARCH / PAGINATION / SELECTION ======================== */
console.log('\n--- B. Search, 25/50/200 pagination, select-page vs select-all ---');
check('PAGE_SIZES offers exactly 10/25/50/200', JSON.stringify(PAGE_SIZES) === '[10,25,50,200]');
check('search: matches Paycode case-insensitively', matchSearch('1053', '1053', 'Ravi Kumar') === true && matchSearch('105', '1053', 'Ravi') === true);
check('search: matches employee name case-insensitively', matchSearch('ravi', '1053', 'Ravi Kumar') === true && matchSearch('KUMAR', '1053', 'Ravi Kumar') === true);
check('search: non-matching term excludes the row', matchSearch('zzz', '1053', 'Ravi Kumar') === false);
check('search: empty term matches everything', matchSearch('', '1053', 'Ravi') === true && matchSearch(null, '1053', 'Ravi') === true);
check('search: works against partial paycode AND partial name', matchSearch('kum', '1053', 'Ravi Kumar') === true && matchSearch('05', '1053', 'Ravi Kumar') === true);

const sixty = Array.from({ length: 60 }, (_, i) => ({ paycode: String(1000 + i), empname: `Emp ${i}` }));
const p25 = paginate(sixty, 1, 25);
check('paginate: 60 rows @25 -> 3 pages, page 1 has 25, total 60', p25.totalPages === 3 && p25.pageRows.length === 25 && p25.total === 60);
const p25b = paginate(sixty, 2, 25);
check('paginate: page 2 slices the FULL set (rows 26-50), not just visible', p25b.pageRows[0].paycode === '1025' && p25b.pageRows.length === 25 && p25b.total === 60);
check('paginate: page size 50 -> 2 pages (counts match)', paginate(sixty, 1, 50).totalPages === 2);
check('paginate: page size 200 -> 1 page with all rows', paginate(sixty, 1, 200).totalPages === 1 && paginate(sixty, 1, 200).pageRows.length === 60);
check('paginate: page number clamped (99 -> last, 0 -> first)', paginate(sixty, 99, 25).page === 3 && paginate(sixty, 0, 25).page === 1);
check('paginate: counts reflect filters (filtered list is the input)', paginate(sixty.slice(0, 7), 1, 25).total === 7 && paginate(sixty.slice(0, 7), 1, 25).totalPages === 1);
check('paginate: page size 10 -> 6 pages for 60 rows, 10 per page', paginate(sixty, 1, 10).totalPages === 6 && paginate(sixty, 1, 10).pageRows.length === 10);
check('paginate: page 2 @10 slices rows 11-20 of the full set', paginate(sixty, 2, 10).pageRows[0].paycode === '1010' && paginate(sixty, 2, 10).pageRows[9].paycode === '1019');

let sel = [];
sel = togglePaycodeSelection(sel, '1001');
sel = togglePaycodeSelection(sel, '1002');
check('selection: toggle adds paycodes (order kept)', sel.join(',') === '1001,1002');
sel = togglePaycodeSelection(sel, '1001');
check('selection: toggle removes paycode', sel.join(',') === '1002');
const merged = mergePaycodeSelection(['1002', '1003'], ['1003', '1004', '  ']);
check('selection: select-page merges without duplicates', merged.join(',') === '1002,1003,1004');
check('selection: survives paging (keyed by paycode, not row index)', togglePaycodeSelection(paginate(sixty, 2, 25).pageRows.map((r) => r.paycode), '1050').includes('1050'));

// UI source guards for B.
const uiSrc = readSrc('web-next/components/hr/WhatsAppSection.jsx');
check('ui: search box matches Paycode AND Name', uiSrc.includes('matchSearch(eligSearch, r.paycode, r.empname)') && uiSrc.includes('matchSearch(prevSearch, p.paycode, p.empname)'));
check('ui: filters reset to page 1 on change', uiSrc.includes('setEligPage(1)') && uiSrc.includes('setPrevPage(1)') && uiSrc.includes('setConsPage(1)'));
check('ui: page size options come from PAGE_SIZES (25/50/200)', uiSrc.includes('PAGE_SIZES.map'));
check('ui: pagination shows current page + total matching records', uiSrc.includes('matching records') && uiSrc.includes('previewPager.page'));
check('ui: rows render from the current PAGE (full set paginated)', uiSrc.includes('previewPager.pageRows.map') && uiSrc.includes('pager.pageRows.map'));
check('ui: Select This Page is separate from Select All filtered', uiSrc.includes('Select This Page') && uiSrc.includes('Select All Eligible — filtered'));
check('ui: select-all only covers filtered eligible rows', uiSrc.includes('setSelectedPaycodes(selectablePaycodes)') && uiSrc.includes('selectablePaycodes = (previews || [])'));
check('ui: select-page merges into the persistent selection', uiSrc.includes('mergePaycodeSelection(prev, pageSelectablePaycodes)'));
check('ui: eligibility counters/phone-edit/consent controls preserved', uiSrc.includes('Save Number') && uiSrc.includes('Consent unchanged') && uiSrc.includes('COUNT_LABELS') && uiSrc.includes('Status / Reason'));
/* =============== E. MANUAL QUEUE REGRESSION ACROSS PAGES ==================== */
console.log('\n--- E. Queue regression: right person, right message, right number ---');
// 60 preview rows (all server-side eligible), selection spans "pages" + a filter.
const previews = Array.from({ length: 60 }, (_, i) => ({
  paycode: String(1000 + i), empname: `Emp ${i}`, whatsappnumber: i % 10 === 7 ? '' : `9190${1000 + i}`,
  text: `Msg for ${1000 + i}`, catname: i % 2 ? 'STAFF' : 'WORKER', status: 'Present',
}));
const page1 = paginate(previews, 1, 25).pageRows.map((p) => p.paycode);
const page3 = paginate(previews, 3, 25).pageRows.map((p) => p.paycode);
const acrossPages = mergePaycodeSelection(page1, page3);
const queue = buildManualQueue(previews, acrossPages);
check('queue: selection across pages queues each selected employee once', queue.length === 32, `got ${queue.length}`);
check('queue: every entry keeps ITS OWN message (never another employee\'s)', queue.every((e) => e.text === `Msg for ${e.paycode}`));
check('queue: every entry keeps ITS OWN number', queue.every((e) => e.whatsappnumber === `9190${e.paycode}`));
check('queue: invalid-number rows (even if selected) never enter', buildManualQueue(previews, ['1007']).length === 0);
check('queue: only rows selected on a filtered subset are queued', buildManualQueue(previews, ['1000', '1001']).map((e) => e.paycode).join(',') === '1000,1001');
check('queue: order is stable across pages for Next/Previous', queue[22].paycode === '1024' && queue[23].paycode === '1050', queue.slice(22, 24).map((e) => e.paycode).join(','));
check('queue: progress label "2 of 10" style preserved', queueProgressLabel(1, 10) === '2 of 10' && queueProgressLabel(0, queue.length) === '1 of 32');
check('queue: previous/next never leaves bounds', queueNeighborIndex(0, queue.length, -1) === 0 && queueNeighborIndex(queue.length - 1, queue.length, 1) === queue.length - 1);

// Queue regression source guards (E: manual send only, nothing auto-sent).
check('ui: queue built from FULL previews + selection (page-independent)', uiSrc.includes('buildManualQueue(previews || [], selectedPaycodes)'));
check('ui: opening a chat never records sent/delivered (no log write in queue)', !/openQueueChat[\s\S]{0,400}(status:\s*'Sent'|logWhatsApp|whatsapp\/send)/.test(uiSrc));
check('ui: queue fns never call the API (manual wa.me only)', !uiSrc.split('function startManualQueue')[1]?.split('function gotoQueue')[0]?.includes('apiFetch'));
check('ui: checkbox disabled for invalid numbers (can not enter queue)', uiSrc.includes('disabled={!chatUrl}'));
check('ui: Send-presses-are-manual explanation still shown', uiSrc.includes('Send khud dabana'));

/* ==================== REGRESSION / CONTRACT GUARDS ========================== */
console.log('\n--- Regression: existing WhatsApp behaviour preserved ---');
for (const s of ["app.get('/api/whatsapp/preview'", "app.post('/api/whatsapp/export'", "app.post('/api/whatsapp/send'", "app.get('/api/whatsapp/log'", "app.put('/api/whatsapp/consent'", "app.put('/api/whatsapp/recipient-number'", "app.get('/api/whatsapp/categories'"]) {
  check(`contract: ${s.split("'")[1]} present`, idxSrc.includes(s));
}
check('contract: template migration still only targets unmodified legacy default', idxSrc.includes('WHERE templatebody IS NULL OR templatebody = @legacytpl'));
check('contract: FREE_MANUAL + dryrun-safe defaults untouched', idxSrc.includes("mode: 'FREE_MANUAL'") && idxSrc.includes('DEFAULT(1)'));
check('contract: eligibility gate + managed-number precedence untouched', idxSrc.includes('const rawPhone = managedNumber || masterPhone;'));
for (const t of ['provider', 'eligibility', 'template', 'preview', 'logs']) {
  check(`ui: five tabs preserved — ${t}`, uiSrc.includes(`id: '${t}'`));
}
check('ui: provider masked-secret + *Clear* behaviour preserved', uiSrc.includes('leave blank to keep') && uiSrc.includes('*Clear'));
check('ui: dry-run / CSV / Send Real / individual Open WhatsApp preserved', uiSrc.includes('Export CSV') && uiSrc.includes('Run Dry-run') && uiSrc.includes('Send Real') && uiSrc.includes('Open WhatsApp'));
check('offline: zero network calls during this entire test run', fetchCalls === 0, `fetchCalls=${fetchCalls}`);

console.log(`\n=== RESULT: ${passed} passed, ${failed} failed (network calls: ${fetchCalls}) ===`);
process.exit(failed ? 1 : 0);