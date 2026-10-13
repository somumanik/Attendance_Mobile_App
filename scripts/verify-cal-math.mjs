// UNIT + LIVE verification — monthGrid date math (pure, no server needed)
import { monthGrid, daysInMonth } from '../web-next/components/hr/monthGrid.js';
import { shiftMonth, currentMonthKey } from '../web-next/lib/format.js';

const results = [];
const check = (name, cond, detail = '') => {
  const pass = !!cond;
  results.push({ name, pass });
  console.log(`${pass ? 'PASS' : 'FAIL'} :: ${name} :: ${detail}`);
};

// Month lengths
check('Feb 2026 = 28 days', daysInMonth(2026, 2) === 28, String(daysInMonth(2026, 2)));
check('Feb 2024 (leap) = 29 days', daysInMonth(2024, 2) === 29, String(daysInMonth(2024, 2)));
check('Apr 2026 = 30 days', daysInMonth(2026, 4) === 30);
check('Jan 2026 = 31 days', daysInMonth(2026, 1) === 31);

// Weekday alignment (Monday-first): Feb 2026 starts Sunday -> leading=6
const feb26 = monthGrid('2026-02');
check('2026-02 leading blanks = 6 (Sun start, Mon-first)', feb26.leading === 6, `leading=${feb26.leading}`);
check('2026-02 cells contain exactly 28 in-month dates', feb26.cells.filter(Boolean).length === 28);
check('2026-02 first date is 2026-02-01', feb26.cells.find(Boolean) === '2026-02-01', String(feb26.cells.find(Boolean)));

const jan26 = monthGrid('2026-01'); // Jan 1 2026 = Thursday -> leading=3
check('2026-01 leading = 3 (Thu start)', jan26.leading === 3, `leading=${jan26.leading}`);

const feb24 = monthGrid('2024-02'); // Feb 1 2024 = Thursday -> leading=3, 29 days
check('2024-02 (leap) = 29 dates + correct lead', feb24.cells.filter(Boolean).length === 29 && feb24.leading === 3);

// Never show another month's dates
const months = ['2026-01', '2026-02', '2024-02', '2026-04', '2026-11', '2026-12', '2027-01'];
let clean = true;
for (const mk of months) {
  const g = monthGrid(mk);
  for (const cell of g.cells) {
    if (cell && !cell.startsWith(mk)) clean = false;
    if (cell && !/^\d{4}-\d{2}-\d{2}$/.test(cell)) clean = false;
    if (cell && Number(cell.slice(8, 10)) > g.days) clean = false;
  }
  if (g.cells.filter(Boolean).length !== g.days) clean = false;
}
check('All months: only own-month dates, exact day counts', clean);

// Grid is always full weeks (7 columns)
check('Grid rows are full 7-day weeks', months.every((mk) => monthGrid(mk).cells.length % 7 === 0));

// Repeated month navigation incl. year boundary
let m = '2026-11';
const seq = [];
for (let i = 0; i < 4; i += 1) { m = shiftMonth(m, 1); seq.push(m); }
check('Next x4 from 2026-11 crosses year: 2027-03 via 2027-01', seq[3] === '2027-03' && seq.includes('2027-01'), seq.join(' -> '));
let back = '2027-02';
for (let i = 0; i < 4; i += 1) back = shiftMonth(back, -1);
check('Prev x4 returns 2026-10 (repeat-safe)', back === '2026-10', back);
check('Today key format YYYY-MM', /^\d{4}-\d{2}$/.test(currentMonthKey()), currentMonthKey());
check('shiftMonth is inverse-stable (Dec->Jan->Dec)', shiftMonth(shiftMonth('2026-12', 1), -1) === '2026-12');

const pass = results.filter((x) => x.pass).length;
console.log(`\n${pass}/${results.length} unit checks passed`);
process.exit(pass === results.length ? 0 : 1);