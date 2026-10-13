// web-next/lib/format.js — client-safe date/format helpers (no timezone shift for dates).

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

export function isoToday() {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

export function currentMonthKey() {
  return isoToday().slice(0, 7);
}

export function shiftMonth(key, delta) {
  const [y, m] = String(key || '').split('-').map(Number);
  if (!y || !m) return currentMonthKey();
  const d = new Date(y, m - 1 + delta, 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

export function prettyMonth(key) {
  const [y, m] = String(key || '').split('-').map(Number);
  if (!y || !m) return key || '';
  return `${MONTHS[m - 1]} ${y}`;
}

export function prettyDate(iso) {
  const s = String(iso || '').slice(0, 10);
  const [y, m, d] = s.split('-').map(Number);
  if (!y || !m || !d) return s;
  return `${String(d).padStart(2, '0')} ${MONTHS[m - 1]} ${y}`;
}

export function dayName(iso) {
  const s = String(iso || '').slice(0, 10);
  const d = new Date(`${s}T00:00:00`);
  if (Number.isNaN(d.getTime())) return '';
  return ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'][d.getDay()];
}

export function fmtPunch(value) {
  if (!value) return '—';
  // The backend already returns a display-only string "HH:MM AM/PM"
  // (server/index.js formatPunchTimeIST). Pass those through unchanged —
  // re-parsing them with new Date() would yield Invalid Date.
  if (typeof value === 'string') {
    const t = value.trim();
    if (/^\d{1,2}:\d{2}(:\d{2})?\s*(AM|PM)?$/i.test(t)) return t;
  }
  const d = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(d.getTime())) return '—';
  let h = d.getUTCHours();
  const m = d.getUTCMinutes();
  const ampm = h >= 12 ? 'PM' : 'AM';
  let h12 = h % 12;
  if (h12 === 0) h12 = 12;
  return `${String(h12).padStart(2, '0')}:${String(m).padStart(2, '0')} ${ampm}`;
}
