// web-next/components/hr/monthGrid.js — pure month date-math for the attendance
// calendar (Single Employee Audit). No React, no data — easily unit-testable.
//
// monthGrid('YYYY-MM') returns Monday-first week rows containing ONLY that
// month's dates (blank cells for leading/trailing padding — never a date from
// another month), with correct day counts for 28/29/30/31-day months.

export function daysInMonth(year, month1) {
  // month1 = 1..12; Date(y, m, 0) = last day of month m
  return new Date(year, month1, 0).getDate();
}

function pad(n) {
  return String(n).padStart(2, '0');
}

export function monthGrid(monthKey) {
  const [y, m] = String(monthKey || '').split('-').map(Number);
  const year = y || new Date().getFullYear();
  const month = m || 1;
  const days = daysInMonth(year, month);
  const firstDow = new Date(year, month - 1, 1).getDay(); // 0=Sun
  const leading = (firstDow + 6) % 7; // Monday-first offset
  const cells = [];
  for (let i = 0; i < leading; i += 1) cells.push(null);
  for (let d = 1; d <= days; d += 1) cells.push(`${year}-${pad(month)}-${pad(d)}`);
  while (cells.length % 7 !== 0) cells.push(null);
  const weeks = [];
  for (let i = 0; i < cells.length; i += 7) weeks.push(cells.slice(i, i + 7));
  return { year, month, days, leading, cells, weeks };
}