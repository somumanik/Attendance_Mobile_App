// web-next/lib/hr.js — client-safe HR display helpers (mirror the original website's front-end utils).

export function initials(name) {
  const parts = String(name || '').trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return '?';
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

export function ageFrom(iso) {
  const s = String(iso || '').slice(0, 10);
  if (!s || s.length !== 10) return null;
  const d = new Date(`${s}T00:00:00`);
  if (Number.isNaN(d.getTime())) return null;
  const now = new Date();
  let age = now.getFullYear() - d.getFullYear();
  const m = now.getMonth() - d.getMonth();
  if (m < 0 || (m === 0 && now.getDate() < d.getDate())) age -= 1;
  return age;
}

export function yearsCompleted(iso) {
  return ageFrom(iso);
}

export function daysUntilMonthDay(iso) {
  const s = String(iso || '').slice(5, 10);
  if (!s || s.length !== 5) return null;
  const [m, d] = s.split('-').map(Number);
  if (!m || !d) return null;
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  let next = new Date(now.getFullYear(), m - 1, d);
  if (next < today) next.setFullYear(now.getFullYear() + 1);
  return Math.round((next - today) / 86400000);
}

export function isTodayMMDD(iso) {
  const s = String(iso || '').slice(5, 10);
  if (!s || s.length !== 5) return false;
  const now = new Date();
  return s === `${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
}

export function statusBadgeClass(status) {
  const c = String(status || '').toLowerCase();
  if (c.includes('present') || c.includes('complete')) return 'badge--present';
  if (c.includes('absent')) return 'badge--absent';
  if (c.includes('miss')) return 'badge--miss';
  if (c.includes('late')) return 'badge--late';
  if (c.includes('week') || c.includes('holiday') || c.includes('off')) return 'badge--weekoff';
  if (c.includes('leave')) return 'badge--leave';
  return 'badge--neutral';
}

export function hoursText(m) {
  const n = Number(m);
  if (!Number.isFinite(n) || n <= 0) return '0';
  const h = Math.floor(n / 60);
  const r = n % 60;
  return r ? `${h}h ${r}m` : `${h}h`;
}

export const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
export const DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
