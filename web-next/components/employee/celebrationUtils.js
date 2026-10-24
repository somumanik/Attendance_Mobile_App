// web-next/components/employee/celebrationUtils.js
// Employee Celebration tab ke pure date/filter logic — 1:1 port of the Mobile App
// reference (mobile/src/screens/employee/EmployeeBdayAnniversaryScreen.jsx).
//
// Data contract (GET /api/employee/celebrations, existing shared backend):
//   { today, weekEnd, birthdays, workAnniversaries, marriageAnniversaries,
//     marriageAvailable } — har group { today[], thisWeek[], thisMonth[], upcoming[] }
//   item = { name, department, designation, date, age?, years?, joinedOn?, daysUntil, bucket }
//
// Dates plain 'YYYY-MM-DD' strings me aate hain aur local date parts se hi render
// hote hain — kabhi UTC date parsing se nahi, taaki koi din shift na ho
// (mobile screen ke bilkul same convention ke saath).

export const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
export const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

export const clean = (v) => String(v == null ? '' : v).trim();
export const PLACEHOLDER = '—';

/** Plain 'YYYY-MM-DD' -> local parts se Date, taaki date kabhi din shift na ho. */
export const partsOf = (v) => {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(clean(v));
  if (!m) return null;
  const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  if (d.getFullYear() !== Number(m[1]) || d.getMonth() !== Number(m[2]) - 1 || d.getDate() !== Number(m[3])) return null;
  return d;
};

/** "08 Oct" style, exactly like the mobile card design. */
export const longDate = (v) => {
  const d = partsOf(v);
  return d ? `${String(d.getDate()).padStart(2, '0')} ${MONTHS[d.getMonth()]}` : PLACEHOLDER;
};

export const dayName = (v) => {
  const d = partsOf(v);
  return d ? WEEKDAYS[d.getDay()] : PLACEHOLDER;
};

export const joinedLabel = (v) => {
  const d = partsOf(v);
  return d ? `Joined: ${String(d.getDate()).padStart(2, '0')} ${MONTHS[d.getMonth()]} ${d.getFullYear()}` : '';
};

/** Filter chips: All / Today / This Week / This Month / Upcoming — mobile jaise. */
export const FILTERS = [
  { id: 'all', label: 'All' },
  { id: 'today', label: 'Today' },
  { id: 'thisWeek', label: 'This Week' },
  { id: 'thisMonth', label: 'This Month' },
  { id: 'upcoming', label: 'Upcoming' },
];

/** Backend bucket order — 'All' filter isi order me lists ko concat karta hai. */
export const BUCKET_ORDER = ['today', 'thisWeek', 'thisMonth', 'upcoming'];

/** Sections — titles, accent colors aur card texts mobile reference se match karte hain.
 *  Accent THEME-AWARE hain: `var(--celv-pink|gold|red)` tokens globals.css ke
 *  celebrations block me har theme (Dark Purple / Light Professional / Midnight
 *  Blue / Emerald Dark) ke liye define hain — category identity (pink/gold/red)
 *  har theme me preserve rehti hai, aur component inhe `--celv-accent` me set karta hai. */
export const SECTIONS = [
  {
    id: 'birthdays',
    title: 'Birthdays',
    icon: 'fas fa-gift',
    accent: 'var(--celv-pink)',
    empty: 'No birthdays found.',
    line: (it) => `Birthday · ${longDate(it.date)}`,
    sub: (it) => (it.age === null || it.age === undefined ? '' : `Turning ${Number(it.age) + 1}`),
  },
  {
    id: 'workAnniversaries',
    title: 'Work Anniversaries',
    icon: 'fas fa-wand-magic-sparkles',
    accent: 'var(--celv-gold)',
    empty: 'No work anniversaries found.',
    line: (it) => `Work Anniversary · ${longDate(it.date)}`,
    sub: (it) => (it.years === null || it.years === undefined ? '' : `${Number(it.years) + 1} year(s) completed`),
  },
  {
    id: 'marriageAnniversaries',
    title: 'Marriage Anniversaries',
    icon: 'fas fa-heart',
    accent: 'var(--celv-red)',
    empty: 'Marriage anniversary data is currently unavailable.',
    line: (it) => `Marriage Anniversary · ${longDate(it.date)}`,
    sub: (it) => (it.years === null || it.years === undefined ? '' : `${Number(it.years) + 1} year(s) completed`),
  },
];

/** Har section ka total count (4 buckets ka sum) — mobile ke header chip jaisa. */
export function sectionTotal(data, sectionId) {
  const g = data ? data[sectionId] : null;
  if (!g) return 0;
  return BUCKET_ORDER.reduce((a, k) => a + (Array.isArray(g[k]) ? g[k].length : 0), 0);
}

/**
 * Active filter ke items — mobile ke itemsFor() jaisa:
 * 'all' = 4 buckets ka union (today, thisWeek, thisMonth, upcoming order me),
 * warna sirf us bucket ke items. Sorting backend ke andar hi hoti hai
 * (daysUntil, phir name) — client sirf buckets ka order preserve karta hai.
 */
export function itemsFor(data, sectionId, filter) {
  const g = data ? data[sectionId] : null;
  if (!g) return [];
  if (filter === 'all') {
    return BUCKET_ORDER.flatMap((k) => (Array.isArray(g[k]) ? g[k] : []));
  }
  return Array.isArray(g[filter]) ? g[filter] : [];
}