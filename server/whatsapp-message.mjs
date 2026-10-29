// server/whatsapp-message.mjs — WhatsApp message rendering + number normalisation.
// PURE WhatsApp-specific helpers shared by server/index.js and the focused tests
// (scripts/verify-whatsapp-v3.mjs), so the tests always exercise the exact code the
// server runs. No DB, no network, no secrets here.

/* Default attendance template — WhatsApp click-to-chat text formatting.
   PLAIN-TEXT labels only (no emoji/icons/decorative Unicode): emoji were shown
   as � / diamond replacement glyphs on many devices, so the generated message
   never contains them. WhatsApp text formatting uses *bold* markers only —
   there is NO colored-font support, so none is used. Clear blank lines separate
   the heading and each field group.
   Lines whose variables resolve to empty are omitted entirely by
   renderWhatsAppTemplate below (e.g. GraceUsed when no grace was consumed,
   GraceRemaining when no valid value exists, Completion when completion is
   ambiguous/absent). {{Completion}} is an optional final status sentence that is
   only produced from the existing authoritative attendance/shift data.
   Variables: {{EmployeeName}}, {{Paycode}}, {{AttendanceDate}}, {{InTime}},
   {{OutTime}}, {{PunchStatus}}, {{Status}}, {{GraceUsed}}, {{GraceRemaining}},
   {{CompanyCode}}, {{Department}}, {{Completion}}. */
export const WHATSAPP_DEFAULT_TEMPLATE = `*DAILY ATTENDANCE*

*Name:* {{EmployeeName}}
*Paycode:* {{Paycode}}
*Date:* {{AttendanceDate}}

*In-Time:* {{InTime}}
*Out-Time:* {{OutTime}}
*Punch:* {{PunchStatus}}
*Status:* {{Status}}

*Grace Used:* {{GraceUsed}}
*Grace Remaining:* {{GraceRemaining}}
{{Completion}}`;

/* The previous plain-text default. Kept ONLY so a config row that is still on the
   unmodified legacy default can be upgraded to the formatted default one time.
   Any HR-customised template body is never touched. */
export const WHATSAPP_LEGACY_DEFAULT_TEMPLATE = 'Hello {{EmployeeName}} ({{Paycode}}),\nDate: {{AttendanceDate}}\nIn: {{InTime}} | Out: {{OutTime}}\nPunch: {{PunchStatus}} | Status: {{Status}}\nGrace Used: {{GraceUsed}} | Grace Remaining: {{GraceRemaining}}';

/* Characters that are known to render as diamond/box replacement glyphs on
   older WhatsApp clients: U+FFFD (literal replacement char), U+FE0F (variation
   selector — emoji-presentation hack), U+1F7E2 (green circle, Unicode 9),
   U+23F1 (stopwatch, text-style default), U+1F194 (squared ID). The UI warns
   when a saved template still contains these; the renderer strips U+FFFD and
   lone surrogates from every generated message. */
export const WHATSAPP_RISKY_CHARS = ['\uFFFD', '\uFE0F', '\u{1F7E2}', '\u{23F1}', '\u{1F194}'];

export function hasRiskyTemplateSymbols(text) {
  const s = String(text == null ? '' : text);
  return WHATSAPP_RISKY_CHARS.some((c) => s.includes(c));
}

/* Remove literal U+FFFD replacement characters and lone (unpaired) surrogates
   so a corrupted glyph can never reach the chat as a diamond/box. Valid
   surrogate pairs (real emoji) are preserved byte-for-byte. */
export function stripBrokenChars(text) {
  return String(text == null ? '' : text)
    .replace(/[\uD800-\uDBFF](?![\uDC00-\uDFFF])/g, '')
    .replace(/(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/g, '')
    .replace(/\uFFFD/g, '');
}

/* Emoji / icon / decorative-symbol characters that must NEVER appear in a
   generated WhatsApp message (they display as � / diamonds on many devices).
   Covers the supplementary emoji planes, dingbats, misc symbol blocks,
   the Misc-Technical icons (watch/stopwatch/alarm...), variation selectors and
   keycap combiners. Each removed symbol also swallows one following space/tab
   so no stray gap is left (e.g. "👤 *Name:*" -> "*Name:*"). Plain punctuation is
   preserved: — – · 〈 〉 and all text.
   Applied to TEMPLATE literal text only — substituted values keep their
   legitimate characters (Hindi/English text, names, punctuation). */
const DECORATIVE_CHARS_RE = /[\u{2300}-\u{2328}\u{232B}-\u{23FF}\u{2600}-\u{27BF}\u{2B00}-\u{2BFF}\u{FE0E}\u{FE0F}\u{20E3}\u{1F000}-\u{1FFFF}][ \t]?/gu;

export function stripDecorativeChars(text) {
  return String(text == null ? '' : text).replace(DECORATIVE_CHARS_RE, '');
}

/* Format minutes as a readable duration (e.g. 90 -> "1h 30m", 60 -> "1h"). */
export function formatHoursMinutes(min) {
  const n = Math.max(0, Math.round(Number(min) || 0));
  const h = Math.floor(n / 60);
  const r = n % 60;
  if (h && r) return `${h}h ${r}m`;
  if (h) return `${h}h`;
  return `${r}m`;
}

/* Optional WhatsApp status sentence built ONLY from existing authoritative
   attendance/shift data — never a new attendance rule.
   Returns '' when completion is ambiguous/unavailable (the caller then omits
   the sentence and the existing attendance status is retained).
     - completed: IN + OUT present, a present (working) day, and the recorded
       worked minutes reach the employee's OWN shift duration (no universal
       duration is assumed).
     - early departure: OUT present but worked minutes below the shift duration
       -> "Your shift is not yet complete." + reliably-calculable remaining time.
     - missing OUT: never completed; "not yet complete" only while the shift is
       still running (end time not yet reached).
     - unknown shift / cross-midnight / missing worked-hours / non-working day:
       omit (do not guess). */
export function completionSentence(opts) {
  const o = opts || {};
  const hasIn = !!o.hasIn;
  const hasOut = !!o.hasOut;
  if (!hasIn) return '';
  if (o.presentDay === false) return ''; // week off / absent / miss-punch → keep existing status
  const start = Number(o.shiftStartMinutes);
  const end = Number(o.shiftEndMinutes);
  const cross = !!o.crossMidnight;
  const durationKnown = Number.isFinite(start) && Number.isFinite(end) && !cross && end > start;
  if (!durationKnown) return ''; // shift/required-hours unavailable or ambiguous
  if (!hasOut) {
    const now = Number(o.nowMinutes);
    if (Number.isFinite(now) && now < end) return 'Your shift is not yet complete.';
    return ''; // shift already ended but OUT missing → retain existing status
  }
  const worked = o.workedMinutes;
  if (worked == null || worked === '' || !Number.isFinite(Number(worked))) return '';
  const w = Number(worked);
  const duration = end - start;
  if (w < duration) return `Your shift is not yet complete. Remaining: ${formatHoursMinutes(duration - w)}`;
  return "Your today's attendance is completed.";
}

// Case-insensitive placeholders: {{EmployeeName}}, {{Paycode}}, {{AttendanceDate}},
// {{InTime}}, {{OutTime}}, {{PunchStatus}}, {{Status}}, {{GraceUsed}},
// {{GraceRemaining}}, {{CompanyCode}}, {{Department}} — unknown ones stay untouched.
// Rendering rules (WhatsApp-specific renderer):
//  - A line whose every KNOWN variable resolved to empty is omitted entirely, so a
//    missing value (e.g. GraceUsed when no grace was consumed) removes the whole
//    line instead of rendering a misleading "label:" / "—" line. A line containing
//    an unknown placeholder is always kept (placeholder stays visible).
//  - Emoji/icon/decorative symbols in the TEMPLATE text are removed (plain-text
//    labels only) — they used to appear as �/diamond replacement glyphs.
//  - Literal U+FFFD replacement characters and lone surrogates are stripped so the
//    generated message can never contain a diamond/box glyph from corruption.
//  - Substituted VALUES are preserved exactly (Hindi/English text, names,
//    punctuation, line structure) — never converted to � or ?.
export function renderWhatsAppTemplate(tpl, vars) {
  const map = {};
  Object.entries(vars || {}).forEach(([k, v]) => { map[String(k).toLowerCase()] = (v === undefined || v === null) ? '' : String(v); });
  const outLines = [];
  for (const rawLine of String(tpl == null ? '' : tpl).split('\n')) {
    let sawKnown = false;
    let sawUnknown = false;
    let allKnownEmpty = true;
    // Decorative symbols are stripped from the template's literal text BEFORE
    // substitution, so placeholder values keep their exact characters.
    const line = stripDecorativeChars(rawLine).replace(/\{\{(\w+)\}\}/g, (m, k) => {
      const key = k.toLowerCase();
      if (!(key in map)) { sawUnknown = true; return m; }
      sawKnown = true;
      const val = map[key];
      if (val.trim() !== '') allKnownEmpty = false;
      return val;
    });
    if (sawKnown && !sawUnknown && allKnownEmpty) continue;
    outLines.push(line);
  }
  return stripBrokenChars(outLines.join('\n').replace(/\s+$/, ''));
}

// Normalize a phone number to E.164 (default country 91 for a 10-digit local
// number). Masked/legacy values (e.g. "XXXXXX9155") and invalid inputs return ''.
export function normalizeWhatsAppNumber(raw, defaultCountry = '91') {
  let s = String(raw == null ? '' : raw).trim();
  if (!s) return '';
  s = s.replace(/[^\d]/g, '');
  if (!s) return '';
  if (s.startsWith('00')) s = s.slice(2);
  else if (s.startsWith('0')) s = s.slice(1);
  if (s.length === 10) s = String(defaultCountry || '91') + s;
  if (!/^[1-9]\d{9,14}$/.test(s)) return '';
  return s;
}

export default {
  WHATSAPP_DEFAULT_TEMPLATE, WHATSAPP_LEGACY_DEFAULT_TEMPLATE, WHATSAPP_RISKY_CHARS,
  renderWhatsAppTemplate, normalizeWhatsAppNumber, hasRiskyTemplateSymbols, stripBrokenChars,
  stripDecorativeChars, completionSentence, formatHoursMinutes,
};