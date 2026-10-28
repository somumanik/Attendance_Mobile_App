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

export default { manualChatUrl };
