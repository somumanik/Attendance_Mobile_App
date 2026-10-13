// PHASE G.2 offline logic check (no DB, no server): month arithmetic +
// Monday-first calendar grid + holiday date-key matching + applicability.
// Usage: node scripts/check-g2-logic.cjs
const shift = (key, delta) => {
  const m = /^(\d{4})-(\d{2})$/.exec(String(key || '').slice(0, 7));
  if (!m) return null;
  const total = (Number(m[2]) - 1) + delta;
  const year = Number(m[1]) + Math.floor(total / 12);
  const month = (((total % 12) + 12) % 12) + 1;
  return `${year}-${String(month).padStart(2, '0')}`;
};
let pass = 0; let fail = 0;
const check = (name, cond, detail = '') => {
  if (cond) { pass += 1; console.log(`  PASS  ${name}`); }
  else { fail += 1; console.log(`  FAIL  ${name}${detail ? ` -> ${detail}` : ''}`); }
};
console.log('=== month navigation round-trip ===');
check('Oct26 -> Sep26', shift('2026-10', -1) === '2026-09', shift('2026-10', -1));
check('Sep26 -> Aug26', shift('2026-09', -1) === '2026-08', shift('2026-09', -1));
check('Aug26 -> Sep26', shift('2026-08', 1) === '2026-09', shift('2026-08', 1));
check('Sep26 -> Oct26', shift('2026-09', 1) === '2026-10', shift('2026-09', 1));
check('Jan26 -> Dec25', shift('2026-01', -1) === '2025-12', shift('2026-01', -1));
check('Dec25 -> Jan26', shift('2025-12', 1) === '2026-01', shift('2025-12', 1));
const rt = shift(shift(shift(shift('2026-10', -1), -1), 1), 1);
check('Oct -> Prev -> Prev -> Next -> Next == Oct', rt === '2026-10', rt);
const cur = '2026-10';
check('Next blocked only at current month', ('2026-09' < cur) === true && ('2026-10' < cur) === false);

console.log('=== Monday-first calendar grid (fixed 42-cell algorithm) ===');
const isoOf = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const grid = (monthKey) => {
  const m = /^(\d{4})-(\d{2})$/.exec(monthKey);
  const year = Number(m[1]); const mon = Number(m[2]) - 1;
  const first = new Date(year, mon, 1);
  const lead = (first.getDay() + 6) % 7;
  const start = new Date(year, mon, 1 - lead);
  const cells = [];
  for (let i = 0; i < 42; i += 1) {
    const d = new Date(start); d.setDate(start.getDate() + i);
    cells.push({ key: isoOf(d), inMonth: d.getMonth() === mon && d.getFullYear() === year });
  }
  return cells;
};
for (const mk of ['2026-02', '2028-02', '2026-04', '2026-09', '2026-10', '2026-12', '2027-01']) {
  const cells = grid(mk);
  const [y, mo] = mk.split('-').map(Number);
  const inMonth = cells.filter((c) => c.inMonth);
  const dim = new Date(y, mo, 0).getDate();
  const first = new Date(y, mo - 1, 1);
  const lead = (first.getDay() + 6) % 7;
  const contiguous = inMonth.every((c, i) => c.key === `${mk}-${String(i + 1).padStart(2, '0')}`);
  check(`${mk}: ${dim} in-month days, contiguous from the 1st`, cells.length === 42 && inMonth.length === dim && contiguous,
    `cells=${cells.length} inMonth=${inMonth.length} dim=${dim}`);
  check(`${mk}: Monday-first lead=${lead}`, cells[lead] && cells[lead].key === `${mk}-01`, cells[lead] && cells[lead].key);
}
check('Sep-2026 grid contains 2026-09-17', grid('2026-09').some((c) => c.key === '2026-09-17' && c.inMonth));
check('Oct-2026 grid contains 2026-10 days', grid('2026-10').filter((c) => c.inMonth).length === 31);

console.log('=== holiday overlay predicate (company+category, never category alone) ===');
const HOLIDAY_ALL = 'All Employees';
const applies = (h, companies, cats, pairs, co, ca) => {
  if (pairs.length) return pairs.some((p) => p.companycode === co && p.categorycode === ca);
  if (String(h.category || '') === HOLIDAY_ALL) return true;
  if (companies.length && cats.length) return companies.includes(co) && cats.includes(ca);
  if (companies.length) return companies.includes(co);
  if (cats.length) return cats.includes(ca);
  return false;
};
const mkH = (name) => ({ holidayname: name, category: 'STAFF, WORKER' });
check('B-36+STAFF matches pair', applies(mkH('x'), [], [], [{ companycode: 'B-36', categorycode: 'STAFF' }], 'B-36', 'STAFF') === true);
check('B-36+WORKER does NOT match STAFF pair', applies(mkH('x'), [], [], [{ companycode: 'B-36', categorycode: 'STAFF' }], 'B-36', 'WORKER') === false);
check('002+OFFICE does NOT match B-36 pair (company must match)', applies(mkH('x'), [], [], [{ companycode: 'B-36', categorycode: 'STAFF' }], '002', 'OFFICE') === false);
check('category-only never matches across companies', applies(mkH('x'), [], [], [{ companycode: 'B-36', categorycode: 'STAFF' }], 'OFFICE', 'STAFF') === false);
check('All Employees matches everyone', applies({ category: HOLIDAY_ALL }, [], [], [], '002', 'OFFICE') === true);
check('companies x categories needs BOTH sides', applies(mkH('x'), ['B-36'], ['STAFF'], [], 'B-36', 'WORKER') === false);
check('companies x categories matches when both match', applies(mkH('x'), ['B-36'], ['STAFF'], [], 'B-36', 'STAFF') === true);

console.log(`\nRESULT: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
