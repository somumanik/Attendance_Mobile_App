// One-off verification (not part of the app bundle): replays the EXACT
// calendarCells + week-grouping logic from EmployeeAttendanceScreen and checks
// the 7-column Mon..Sun alignment and Sunday population across several months.
const isoOf = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const WEEK_HEADER = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
let fail = 0;

for (const [y, m] of [[2026, 0], [2026, 1], [2026, 9], [2024, 1], [2023, 4], [2027, 11]]) {
  const first = new Date(y, m, 1);
  const lead = (first.getDay() + 6) % 7;
  const gridStart = new Date(y, m, 1 - lead);
  const cells = [];
  for (let i = 0; i < 42; i += 1) {
    const d = new Date(gridStart.getFullYear(), gridStart.getMonth(), gridStart.getDate() + i);
    cells.push({ key: isoOf(d), day: d.getDate(), inMonth: d.getMonth() === m && d.getFullYear() === y });
  }
  // Same grouping as calendarWeeks in the screen.
  const weeks = [];
  for (let i = 0; i < cells.length; i += 7) weeks.push(cells.slice(i, i + 7));
  if (weeks.length !== 6 || weeks.some((w) => w.length !== 7)) {
    console.log('FAIL row count', y, m);
    fail += 1;
  }
  cells.forEach((c, idx) => {
    const col = idx % 7;
    const p = c.key.split('-').map((v, i) => (i === 1 ? Number(v) - 1 : Number(v)));
    const dt = new Date(p[0], p[1], p[2]);
    const realCol = (dt.getDay() + 6) % 7;
    if (col !== realCol || WEEK_HEADER[col] !== WEEK_HEADER[realCol]) {
      console.log('FAIL align', c.key);
      fail += 1;
    }
  });
  const monthCells = cells.filter((c) => c.inMonth);
  const expected = new Date(y, m + 1, 0).getDate();
  if (monthCells.length !== expected) {
    console.log('FAIL month coverage', y, m);
    fail += 1;
  }
  const sunDates = cells.filter((c, idx) => idx % 7 === 6).map((c) => c.day);
  console.log(`${y}-${String(m + 1).padStart(2, '0')}`, '6x7 grid OK; Sunday column dates:', sunDates.join(','));
}
console.log(fail ? `FAILURES: ${fail}` : 'RESULT: all months align 7 columns Mon..Sun; Sunday column always populated (6 dates)');
process.exit(fail ? 1 : 0);
