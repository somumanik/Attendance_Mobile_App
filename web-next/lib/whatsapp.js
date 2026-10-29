// web-next/lib/whatsapp.js — WhatsApp Messaging helpers (pure, client-safe).
// Kept here so the exact same code is used by the UI and the focused tests.

/**
 * WhatsApp click-to-chat URL (wa.me). Prefills the message text ONLY — it never
 * auto-submits; the HR user must press Send in WhatsApp. This is the FREE manual
 * route: it never contacts the Meta Cloud API and needs no credentials.
 */
export function manualChatUrl(number, text) {
  const digits = String(number == null ? '' : number).replace(/\D/g, '');
  return digits ? `https://wa.me/${digits}?text=${encodeURIComponent(String(text == null ? '' : text))}` : null;
}

/**
 * Build the manual send queue from the generated (already server-side eligible)
 * preview rows + the HR selection. Safety rules enforced here too:
 *  - only rows the HR ticked are queued;
 *  - every queued row must have a usable wa.me link (valid number), otherwise it
 *    is excluded — an ineligible/invalid-number row can never enter the queue;
 *  - each row keeps its OWN personalised message text (never mixed up).
 * Order follows the preview order (stable for Next/Previous navigation).
 */
export function buildManualQueue(previews, selectedPaycodes) {
  const selected = new Set((Array.isArray(selectedPaycodes) ? selectedPaycodes : []).map((p) => String(p == null ? '' : p).trim()).filter(Boolean));
  const queue = [];
  for (const p of (Array.isArray(previews) ? previews : [])) {
    if (!p) continue;
    const key = String(p.paycode == null ? '' : p.paycode).trim();
    if (!selected.has(key)) continue;
    const chatUrl = manualChatUrl(p.whatsappnumber, p.text);
    if (!chatUrl) continue; // invalid/missing number — never queued
    queue.push({ paycode: key, empname: p.empname || '', whatsappnumber: p.whatsappnumber, text: p.text || '', chatUrl });
  }
  return queue;
}

/** Next/previous queue index — clamped to [0, total-1]; -1 when the queue is empty. */
export function queueNeighborIndex(index, total, step) {
  const t = Number(total) || 0;
  if (t <= 0) return -1;
  const i = Math.max(0, Math.min(t - 1, Number(index) + (step >= 0 ? 1 : -1)));
  return i;
}

/** Human progress label, e.g. "2 of 10" (1-based). Empty string for an empty queue. */
export function queueProgressLabel(index, total) {
  const t = Number(total) || 0;
  if (t <= 0) return '';
  const i = Math.max(0, Math.min(t - 1, Number(index) || 0));
  return `${i + 1} of ${t}`;
}

/* ================= search / filter / pagination (pure, display-only) ================
   These operate on the FULL loaded result set client-side, so no database call
   happens per keystroke and pagination always counts the whole filtered set. */

export const PAGE_SIZES = [10, 25, 50, 200];

/** Case-insensitive substring match against any of the given values (paycode,
 *  employee name, ...). Empty/missing search term matches everything. */
export function matchSearch(term, ...values) {
  const t = String(term == null ? '' : term).trim().toLowerCase();
  if (!t) return true;
  return values.some((v) => String(v == null ? '' : v).toLowerCase().includes(t));
}

/** Slice the full filtered list for the requested page. The page number is
 *  clamped to [1, totalPages]; total/totalPages always reflect the whole list. */
export function paginate(rows, page, pageSize) {
  const list = Array.isArray(rows) ? rows : [];
  const size = Math.max(1, Number(pageSize) || 25);
  const total = list.length;
  const totalPages = Math.max(1, Math.ceil(total / size));
  const p = Math.min(Math.max(1, Number(page) || 1), totalPages);
  const start = (p - 1) * size;
  return { pageRows: list.slice(start, start + size), total, totalPages, page: p, pageSize: size };
}

/** Toggle one paycode in the selection list (immutably). Selection is keyed by
 *  paycode so it stays consistent across pages and filters. */
export function togglePaycodeSelection(selected, paycode) {
  const key = String(paycode == null ? '' : paycode).trim();
  const list = Array.isArray(selected) ? selected : [];
  if (!key) return list.slice();
  return list.includes(key) ? list.filter((p) => p !== key) : [...list, key];
}

/** Union of the current selection with a page/filtered paycode list (select-page
 *  and select-all-filtered both funnel through here). */
export function mergePaycodeSelection(selected, paycodes) {
  const add = (Array.isArray(paycodes) ? paycodes : []).map((p) => String(p == null ? '' : p).trim()).filter(Boolean);
  return [...new Set([...(Array.isArray(selected) ? selected : []), ...add])];
}

/* Characters known to render as diamond/box replacement glyphs on older WhatsApp
   clients (kept in sync with server/whatsapp-message.mjs WHATSAPP_RISKY_CHARS). */
const RISKY_TEMPLATE_CHARS = ['\uFFFD', '\uFE0F', '\u{1F7E2}', '\u{23F1}', '\u{1F194}'];

/** True when a template body contains symbols that may show as diamonds/boxes on
 *  some devices — the UI then suggests the safe "Use formatted default" reset. */
export function hasRiskyTemplateSymbols(text) {
  const s = String(text == null ? '' : text);
  return RISKY_TEMPLATE_CHARS.some((c) => s.includes(c));
}

export default {
  manualChatUrl, buildManualQueue, queueNeighborIndex, queueProgressLabel,
  PAGE_SIZES, matchSearch, paginate, togglePaycodeSelection, mergePaycodeSelection,
  hasRiskyTemplateSymbols,
};
