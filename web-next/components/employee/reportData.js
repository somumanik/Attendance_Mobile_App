// web-next/components/employee/reportData.js
// Pure data logic for the Employee Reports tab (My Attendance Reports).
//
// Business rules are REUSED, never re-invented:
//  - Per-row status comes from the backend's classifyRow()/normalizeAttendance()
//    output (computedStatus/statusLabel) — the same helpers HR Single Employee
//    Audit uses.
//  - Per-day overlay precedence is the EXISTING Attendance tab rule
//    (AttendanceSection.jsx cellInfo): Holiday overlay > approved-Leave overlay >
//    register statusCode H/HOLIDAY > status label > No Record.
//  - Holidays come from GET /api/employee/holidays (employee-specific), and
//    "Leave" ONLY from GET /api/employee/leave/calendar, which expands APPROVED
//    leave requests only — a leave shows as Leave only when the leave system has
//    confirmed approval.
//  - Late arrivals = the backend's FINAL late count (after monthly grace
//    consumption). Grace usage counts are kept separate and never mixed in.
//  - Working hours are summed ONLY from recorded `hoursworked` values (minutes).
// Dates are handled as local calendar strings ('YYYY-MM-DD'); no UTC parsing, so
// a day can never shift.

export const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
export const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

export const STATUS_ORDER = ['present', 'absent', 'miss', 'leave', 'holiday', 'weekoff', 'noRecord', 'upcoming'];
export const STATUS_META = {
  present: { label: 'Present', color: '#059669' },
  absent: { label: 'Absent', color: '#DC2626' },
  miss: { label: 'Miss Punch', color: '#D97706' },
  leave: { label: 'Approved Leave', color: '#0891B2' },
  holiday: { label: 'Holiday', color: '#7C3AED' },
  weekoff: { label: 'Weekly Off', color: '#CA8A04' },
  noRecord: { label: 'No Record', color: '#64748B' },
  upcoming: { label: 'Upcoming', color: '#94A3B8' },
};

export const clean = (v) => String(v == null ? '' : v).trim();
export const DASH = '—';

/** 'YYYY-MM-DD' -> local Date from parts (no UTC parsing). */
export const partsOf = (v) => {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(clean(v));
  if (!m) return null;
  const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  if (d.getFullYear() !== Number(m[1]) || d.getMonth() !== Number(m[2]) - 1 || d.getDate() !== Number(m[3])) return null;
  return d;
};
export const isoOf = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
/** 'DD-MMM-YYYY' — calendar display only. */
export const fmtDate = (v) => {
  const d = partsOf(v);
  return d ? `${String(d.getDate()).padStart(2, '0')}-${MONTHS[d.getMonth()]}-${d.getFullYear()}` : DASH;
};
export const dayNameOf = (v) => {
  const d = partsOf(v);
  return d ? WEEKDAYS[d.getDay()] : DASH;
};

/** hoursworked is stored in MINUTES (existing register convention). */
export const hoursText = (minutes) => {
  const n = Number(minutes);
  if (!Number.isFinite(n) || n <= 0) return '0h';
  const h = Math.floor(n / 60);
  const r = n % 60;
  return r ? `${h}h ${String(r).padStart(2, '0')}m` : `${h}h`;
};
export const hoursDecimal = (minutes) => {
  const n = Number(minutes);
  return Number.isFinite(n) && n > 0 ? Math.round((n / 60) * 100) / 100 : 0;
};

/** First/last calendar date of a 'YYYY-MM' month key. */
export function monthRange(key) {
  const s = clean(key).slice(0, 7);
  if (!/^\d{4}-\d{2}$/.test(s)) return null;
  const [y, m] = s.split('-').map(Number);
  const last = new Date(y, m, 0).getDate();
  return { from: `${s}-01`, to: `${s}-${String(last).padStart(2, '0')}`, days: last };
}

export function shiftMonth(key, delta) {
  const m = /^(\d{4})-(\d{2})$/.exec(clean(key));
  if (!m) return clean(key);
  const d = new Date(Number(m[1]), Number(m[2]) - 1 + delta, 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

/** Late duration text where supported ('+32 min'), else ''. */
export const lateText = (minutes) => {
  const n = Number(minutes);
  return Number.isFinite(n) && n > 0 ? `+${Math.round(n)} min` : '';
};

/**
 * Per-day status — mirrors the EXISTING Attendance tab (cellInfo) precedence:
 * holiday overlay > approved-leave overlay > register row. The row's label uses
 * the backend's classification (computedStatus), with the established special
 * labels (Holiday / Half Day / Short Leave / Present (Week Off)) preserved.
 */
export function dayStatus({ key, row, holidays, leaves }) {
  const hols = (holidays || []).filter((h) => clean(h.holidaydate).slice(0, 10) === key);
  const lv = (leaves || []).filter((l) => clean(l?.date).slice(0, 10) === key);
  if (hols.length) {
    return { kind: 'holiday', label: 'Holiday', remark: clean(hols.map((h) => clean(h.holidayname)).filter(Boolean).join(', ')), row, leaves: lv, hols };
  }
  if (lv.length) {
    const names = clean(lv.map((l) => clean((l?.leaves || []).map((x) => clean(x?.typename)).filter(Boolean).join('/'))).filter(Boolean).join(', '));
    return { kind: 'leave', label: 'Approved Leave', remark: names ? `Approved leave — ${names}` : 'Approved leave', row, leaves: lv, hols };
  }
  if (row) {
    const code = clean(row.statusCode).toUpperCase();
    const statusLabel = clean(row.statusLabel);
    const label = (code === 'H' || code === 'HOLIDAY') ? 'Holiday'
      : (statusLabel === 'Half Day' || statusLabel === 'Short Leave' || statusLabel === 'Present (Week Off)') ? statusLabel
      : (clean(row.computedStatus) || statusLabel || 'No Record');
    if (label === 'Holiday') return { kind: 'holiday', label: 'Holiday', remark: '', row, leaves: lv, hols };
    if (label === 'Week Off') return { kind: 'weekoff', label: 'Weekly Off', remark: '', row, leaves: lv, hols };
    if (label === 'Miss Punch') return { kind: 'miss', label: 'Miss Punch', remark: 'Incomplete punch record', row, leaves: lv, hols };
    if (label === 'Absent') return { kind: 'absent', label: 'Absent', remark: clean(row.reason), row, leaves: lv, hols };
    if (label === 'Half Day' || label === 'Short Leave' || label === 'Present (Week Off)') {
      return { kind: 'present', label, remark: clean(row.reason), row, leaves: lv, hols };
    }
    if (label === 'Present') return { kind: 'present', label: 'Present', remark: clean(row.reason), row, leaves: lv, hols };
    return { kind: 'noRecord', label: label || 'No Record', remark: clean(row.reason), row, leaves: lv, hols };
  }
  return { kind: 'noRecord', label: 'No Record', remark: 'No attendance record in source', row: null, leaves: lv, hols };
}
export const monthLabel = (key) => {
  const s = clean(key);
  return `${MONTHS[Number(s.slice(5, 7)) - 1] || ''} ${s.slice(0, 4)}`.trim();
};

/**
 * Full daily register: one row per calendar date of the selected month.
 * Future dates are 'Upcoming' (never a final status), today with an unfinished
 * punch pair is flagged in-progress, and dates the source cannot establish get
 * an honest 'No Record' state instead of an invented status.
 */
export function buildRegister({ month, attendance, holidays, leaveDates, todayIso }) {
  const range = monthRange(month);
  if (!range) return [];
  const byDate = new Map();
  (attendance || []).forEach((r) => {
    const key = clean(r.date || r.dateoffice).slice(0, 10);
    if (key) byDate.set(key, r);
  });
  const out = [];
  for (let day = 1; day <= range.days; day += 1) {
    const key = `${clean(month).slice(0, 7)}-${String(day).padStart(2, '0')}`;
    const row = byDate.get(key) || null;
    const future = Boolean(todayIso) && key > todayIso;
    const st = future
      ? { kind: 'upcoming', label: 'Upcoming', remark: 'Date not reached yet', row: null, leaves: [], hols: [] }
      : dayStatus({ key, row, holidays, leaves: leaveDates });
    const mins = Number(row?.hoursworked || 0);
    const inProgress = Boolean(todayIso) && key === todayIso && Boolean(row) && clean(row.inTime) && !clean(row.outTime);
    let remark = st.remark;
    if (inProgress) remark = [remark, 'Day in progress — final status pending'].filter(Boolean).join(' · ');
    out.push({
      date: key,
      dayName: dayNameOf(key),
      inTime: clean(row?.inTime),
      outTime: clean(row?.outTime),
      hoursMin: row ? mins : null,
      hoursText: row ? hoursText(mins) : DASH,
      lateMin: row ? Number(row.latearrival || 0) : 0,
      lateText: row ? lateText(row.latearrival) : '',
      graceUsed: clean(row?.graceUsed),
      isLate: Boolean(row && row.isLate),
      status: st.label,
      kind: st.kind,
      remark,
      future,
      inProgress,
      hasRow: Boolean(row),
    });
  }
  return out;
}

/** Summary from the register rows (single source of truth with the table). */
export function summariseRegister(register, data) {
  const s = { present: 0, absent: 0, miss: 0, leave: 0, holiday: 0, weekoff: 0, noRecord: 0, upcoming: 0 };
  let hoursMin = 0;
  let recordedDays = 0;
  (register || []).forEach((r) => {
    if (s[r.kind] !== undefined) s[r.kind] += 1;
    if (r.hasRow && Number.isFinite(r.hoursMin)) { hoursMin += r.hoursMin; recordedDays += 1; }
  });
  const denom = s.present + s.absent + s.miss;
  return {
    ...s,
    hoursMin,
    hoursDecimal: hoursDecimal(hoursMin),
    recordedDays,
    // FINAL late count (grace consumption applied) — never the grace-usage count.
    lateFinal: Number(data?.late || 0),
    lateRaw: Array.isArray(data?.lateDetails) ? data.lateDetails.length : Number(data?.late || 0),
    attendancePct: denom ? Math.round((s.present / denom) * 1000) / 10 : null,
    totalDays: (register || []).length,
  };
}

/**
 * Month split into Mon–Sun weeks (the same week convention the backend uses),
 * each with real per-week status counts, late days and recorded hours.
 */
export function buildWeeks(register) {
  const weeks = [];
  let cur = null;
  (register || []).forEach((r) => {
    const d = partsOf(r.date);
    const dowIso = (d.getDay() + 6) % 7; // Mon = 0
    if (!cur || dowIso === 0) {
      cur = { label: `Week ${weeks.length + 1}`, from: r.date, to: r.date, present: 0, absent: 0, miss: 0, leave: 0, lateDays: 0, workingDays: 0, hoursMin: 0, onTimeDays: 0 };
      weeks.push(cur);
    }
    cur.to = r.date;
    if (r.kind === 'present') cur.present += 1;
    else if (r.kind === 'absent') cur.absent += 1;
    else if (r.kind === 'miss') cur.miss += 1;
    else if (r.kind === 'leave') cur.leave += 1;
    if (r.hasRow && (r.kind === 'present' || r.kind === 'absent' || r.kind === 'miss')) {
      cur.workingDays += 1;
      if (r.isLate) cur.lateDays += 1; else cur.onTimeDays += 1;
      cur.hoursMin += Number(r.hoursMin || 0);
    }
  });
  return weeks;
}

/** Punctuality split from established numbers (lateDetails = grace-aware). */
export function punctuality(register, data) {
  const lateDetails = Array.isArray(data?.lateDetails) ? data.lateDetails : [];
  const covered = lateDetails.filter((l) => l.isFinalLate === false).length;
  const finalLate = Number(data?.late || 0);
  const recordedWorking = (register || []).filter((r) => r.hasRow && (r.kind === 'present' || r.kind === 'miss')).length;
  const lateDays = lateDetails.length;
  return {
    onTime: Math.max(0, recordedWorking - lateDays),
    lateCovered: covered,
    lateFinal: finalLate,
    lateDays,
    graceRemaining: data?.graceRemaining || null,
    recordedWorking,
  };
}

/** Daily recorded-hours series (only days that actually carry a register row). */
export function hoursSeries(register) {
  return (register || [])
    .filter((r) => r.hasRow && Number.isFinite(r.hoursMin))
    .map((r) => ({ date: r.date, hours: hoursDecimal(r.hoursMin), minutes: r.hoursMin }));
}

/**
 * "My Month at a Glance" — factual, neutral, derived only from real data.
 * Items whose preconditions are not met are OMITTED (never fabricated), and the
 * caller shows an honest message when nothing qualifies.
 * `prev` (optional): { summary, label, complete } from the previous month,
 * computed with the SAME rules — comparisons appear only when both periods have
 * comparable recorded data.
 */
export function buildInsights({ register, weeks, summary, month, prev }) {
  const items = [];
  const label = monthLabel(month);

  // 1. Consecutive present working-day streak (within the month).
  let best = null, run = null;
  (register || []).forEach((r) => {
    if (r.kind === 'present') {
      if (run) { run.to = r.date; run.days += 1; }
      else run = { from: r.date, to: r.date, days: 1 };
      if (!best || run.days > best.days) best = { ...run };
    } else run = null;
  });
  if (best && best.days >= 2) {
    items.push({
      id: 'streak',
      title: 'Longest present streak',
      value: `${best.days} working days`,
      note: `${fmtDate(best.from)} to ${fmtDate(best.to)} (within ${label})`,
    });
  }

  // 2. Most punctual week (needs at least two comparable weeks).
  const eligible = (weeks || []).filter((w) => w.workingDays >= 3);
  if (eligible.length >= 2) {
    const ranked = eligible.slice().sort((a, b) => (b.onTimeDays / b.workingDays) - (a.onTimeDays / a.workingDays));
    const top = ranked[0];
    const pct = Math.round((top.onTimeDays / top.workingDays) * 100);
    items.push({
      id: 'punctual-week',
      title: 'Most punctual week',
      value: `${top.label} · ${pct}% on time`,
      note: `${fmtDate(top.from)} to ${fmtDate(top.to)} · ${top.onTimeDays}/${top.workingDays} recorded working days on time`,
    });
  }

  // 3. Highest late-arrival week (only when at least one late day exists).
  const lateWeeks = (weeks || []).filter((w) => w.lateDays > 0);
  if (lateWeeks.length >= 1) {
    const worst = lateWeeks.slice().sort((a, b) => b.lateDays - a.lateDays)[0];
    items.push({
      id: 'late-week',
      title: 'Highest late-arrival week',
      value: `${worst.label} · ${worst.lateDays} late day(s)`,
      note: `${fmtDate(worst.from)} to ${fmtDate(worst.to)}`,
    });
  }

  // 4. Total recorded working hours.
  if (summary?.recordedDays > 0) {
    const avg = Math.round(summary.hoursMin / summary.recordedDays);
    items.push({
      id: 'hours',
      title: 'Total recorded working hours',
      value: hoursText(summary.hoursMin),
      note: `${hoursText(avg)} avg across ${summary.recordedDays} recorded day(s)`,
    });
  }

  // 5/6. Previous-month comparison — only when both periods are comparable
  // (same classification rules; both have recorded working data; the previous
  // month must be fully elapsed).
  const prevComparable = Boolean(prev && prev.summary && prev.complete !== false
    && prev.summary.recordedDays > 0 && summary?.recordedDays > 0);
  if (prevComparable) {
    const dLate = summary.lateFinal - prev.summary.lateFinal;
    items.push({
      id: 'late-change',
      title: 'Late arrivals vs previous month',
      value: `${summary.lateFinal} vs ${prev.summary.lateFinal} (${dLate > 0 ? '+' : ''}${dLate})`,
      note: `${label} vs ${prev.label}${prev.inProgressNote ? '' : ''}`,
    });
    if (summary.attendancePct !== null && prev.summary.attendancePct !== null) {
      const dPct = Math.round((summary.attendancePct - prev.summary.attendancePct) * 10) / 10;
      items.push({
        id: 'pct-change',
        title: 'Attendance % vs previous month',
        value: `${summary.attendancePct}% vs ${prev.summary.attendancePct}% (${dPct > 0 ? '+' : ''}${dPct} pp)`,
        note: `${label} vs ${prev.label}`,
      });
    }
  }

  return items;
}