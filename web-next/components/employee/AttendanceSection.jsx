'use client';

// web-next/components/employee/AttendanceSection.jsx
// Employee Attendance — month calendar + summary + date details + records + late.
// Data (same verified backend as the mobile app):
//   /api/employee/dashboard?month=YYYY-MM   (punches, status, hours, late + grace)
//   /api/employee/holidays?month=YYYY-MM    (holiday overlay for this employee)
//   /api/employee/leave/calendar            (approved-leave overlay)
// Identity comes from the JWT (server side) — never from the browser.

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import apiFetch from '../../lib/api';
import { currentMonthKey, shiftMonth, prettyMonth, prettyDate, dayName, fmtPunch, isoToday } from '../../lib/format';

const WEEK_HEADER = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
const PLACEHOLDER = '—';

const C = {
  present: '#059669', absent: '#DC2626', miss: '#D97706',
  holiday: '#7C3AED', weekoff: '#CA8A04', leave: '#0891B2', neutral: '#64748B',
};

const hoursText = (minutes) => {
  const n = Number(minutes);
  if (!Number.isFinite(n) || n <= 0) return '0h';
  const h = Math.floor(n / 60);
  const r = n % 60;
  return r ? `${h}h ${String(r).padStart(2, '0')}m` : `${h}h`;
};
const clean = (v) => String(v == null ? '' : v).trim();
const isoOf = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
function monthRange(key) {
  const [y, m] = String(key).split('-').map(Number);
  const last = new Date(y, m, 0).getDate();
  return { from: `${key}-01`, to: `${key}-${String(last).padStart(2, '0')}` };
}

export default function AttendanceSection() {
  const [month, setMonth] = useState(currentMonthKey());
  const [data, setData] = useState(null);
  const [holidays, setHolidays] = useState([]);
  const [leaveDates, setLeaveDates] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [selected, setSelected] = useState(null);
  const shownMonth = useRef(currentMonthKey());

  const load = useCallback(async (targetMonth) => {
    shownMonth.current = targetMonth;
    setLoading(true);
    setError('');
    const { from, to } = monthRange(targetMonth);
    try {
      const dash = await apiFetch(`/employee/dashboard?month=${targetMonth}`);
      if (shownMonth.current !== targetMonth) return;
      setData(dash);
    } catch (e) {
      if (shownMonth.current !== targetMonth) return;
      setData(null);
      setError(e?.message || 'Unable to load your attendance data. Please try again.');
      setLoading(false);
      return;
    }
    apiFetch(`/employee/holidays?month=${targetMonth}`)
      .then((h) => { if (shownMonth.current === targetMonth) setHolidays(Array.isArray(h?.holidays) ? h.holidays : []); })
      .catch(() => { if (shownMonth.current === targetMonth) setHolidays([]); });
    apiFetch(`/employee/leave/calendar?from=${from}&to=${to}`)
      .then((l) => { if (shownMonth.current === targetMonth) setLeaveDates(Array.isArray(l?.dates) ? l.dates : []); })
      .catch(() => { if (shownMonth.current === targetMonth) setLeaveDates([]); });
    setLoading(false);
  }, []);

  useEffect(() => { load(month); }, [month, load]);

  const rows = useMemo(() => {
    const list = Array.isArray(data?.attendance) ? data.attendance.slice() : [];
    return list
      .map((r, i) => ({ r, i, key: clean(r.date || r.dateoffice).slice(0, 10) }))
      .sort((a, b) => (a.key < b.key ? -1 : a.key > b.key ? 1 : a.i - b.i))
      .map((x) => x.r);
  }, [data]);

  const byDate = useMemo(() => {
    const m = new Map();
    rows.forEach((r) => m.set(clean(r.date || r.dateoffice).slice(0, 10), r));
    return m;
  }, [rows]);

  const holidayByDate = useMemo(() => {
    const m = new Map();
    holidays.forEach((h) => {
      const key = clean(h.holidaydate).slice(0, 10);
      if (!key) return;
      const list = m.get(key) || [];
      list.push(h);
      m.set(key, list);
    });
    return m;
  }, [holidays]);

  const leaveByDate = useMemo(() => {
    const m = new Map();
    leaveDates.forEach((e) => {
      const key = clean(e?.date).slice(0, 10);
      if (!key) return;
      m.set(key, Array.isArray(e?.leaves) ? e.leaves : []);
    });
    return m;
  }, [leaveDates]);
  // One status + colour per day (Holiday > Leave > Week Off > attendance status).
  const cellInfo = useCallback((key) => {
    const hols = holidayByDate.get(key) || [];
    const lv = leaveByDate.get(key) || [];
    const row = byDate.get(key) || null;
    let status, color, kind;
    if (hols.length) { status = 'Holiday'; color = C.holiday; kind = 'holiday'; }
    else if (lv.length) { status = 'Leave'; color = C.leave; kind = 'leave'; }
    else if (row) {
      const code = clean(row.statusCode).toUpperCase();
      const label = clean(row.statusLabel) || clean(row.computedStatus);
      if (code === 'H' || code === 'HOLIDAY') { status = 'Holiday'; color = C.holiday; kind = 'holiday'; }
      else if (label === 'Week Off') { status = 'Week Off'; color = C.weekoff; kind = 'weekoff'; }
      else if (label === 'Miss Punch') { status = 'Miss Punch'; color = C.miss; kind = 'miss'; }
      else if (label === 'Absent') { status = 'Absent'; color = C.absent; kind = 'absent'; }
      else if (label === 'Half Day') { status = 'Half Day'; color = C.present; kind = 'present'; }
      else if (label === 'Short Leave') { status = 'Short Leave'; color = C.present; kind = 'present'; }
      else if (label === 'Present (Week Off)') { status = 'Present (Week Off)'; color = C.present; kind = 'present'; }
      else if (label === 'Present') { status = 'Present'; color = C.present; kind = 'present'; }
      else { status = label || 'No Record'; color = C.neutral; kind = 'neutral'; }
    } else { status = 'No Record'; color = C.neutral; kind = 'neutral'; }
    return { key, status, color, kind, row, hols, lv, isLate: !!(row && row.isLate) };
  }, [byDate, holidayByDate, leaveByDate]);

  // Monday-first 42-cell grid; leap years & month lengths handled by Date.
  const cells = useMemo(() => {
    const [y, m] = month.split('-').map(Number);
    const year = y, mon = m - 1;
    const first = new Date(year, mon, 1);
    const lead = (first.getDay() + 6) % 7;
    const gridStart = new Date(year, mon, 1 - lead);
    const out = [];
    for (let i = 0; i < 42; i += 1) {
      const d = new Date(gridStart.getFullYear(), gridStart.getMonth(), gridStart.getDate() + i);
      const key = isoOf(d);
      out.push({ key, day: d.getDate(), inMonth: d.getMonth() === mon && d.getFullYear() === year, ...cellInfo(key) });
    }
    return out;
  }, [month, cellInfo]);

  // Summary from the calendar cells (one status per day) + grace-aware late + hours.
  const summary = useMemo(() => {
    const s = { present: 0, absent: 0, miss: 0, holiday: 0, weekoff: 0, leave: 0 };
    cells.forEach((c) => {
      if (!c.inMonth) return;
      if (c.kind === 'present') s.present += 1;
      else if (c.kind === 'absent') s.absent += 1;
      else if (c.kind === 'miss') s.miss += 1;
      else if (c.kind === 'holiday') s.holiday += 1;
      else if (c.kind === 'weekoff') s.weekoff += 1;
      else if (c.kind === 'leave') s.leave += 1;
    });
    return { ...s, late: Number(data?.late || 0), hours: Number(data?.hours || 0) };
  }, [cells, data]);

  const lateList = useMemo(() => {
    const list = Array.isArray(data?.lateDetails) ? data.lateDetails : [];
    return list
      .map((l, i) => {
        const key = clean(l.date).slice(0, 10);
        const row = byDate.get(key);
        return {
          key: `${key}-${i}`, date: key,
          inTime: clean(row?.inTime) || PLACEHOLDER,
          shift: clean(row?.currentShift || row?.shift) || PLACEHOLDER,
          lateMinutes: Number(l.lateMinutes || 0),
          graceUsed: clean(l.graceUsed), covered: l.isFinalLate === false,
        };
      })
      .sort((a, b) => (a.date < b.date ? -1 : 1));
  }, [data, byDate]);

  const detail = selected ? cellInfo(selected) : null;
  const today = isoToday();

  const sumCard = (label, value, color, sub) => (
    <div key={label} className="att-sum" style={{ borderColor: `${color}55` }}>
      <div className="att-sum__value" style={{ color }}>{value}</div>
      <div className="att-sum__label">{label}</div>
      {sub ? <div className="att-sum__sub">{sub}</div> : null}
    </div>
  );

  return (
    <div className="att">
      <div className="card att-head">
        <div className="att-head__row">
          <h3 className="card__title" style={{ margin: 0 }}>My Attendance</h3>
          <div className="att-month-ctrl">
            <button type="button" className="btn btn--ghost" onClick={() => setMonth((m) => shiftMonth(m, -1))}>‹ Prev</button>
            <button type="button" className="btn btn--ghost" onClick={() => setMonth(currentMonthKey())}>Today</button>
            <span className="month-nav__label">{prettyMonth(month)}</span>
            <button type="button" className="btn btn--ghost" onClick={() => setMonth((m) => shiftMonth(m, 1))}>Next ›</button>
            <label className="att-jump">
              <span className="att-jump__label">Jump</span>
              <select className="att-jump__select" value={month} onChange={(e) => e.target.value && setMonth(e.target.value)}>
                {(() => {
                  const [y] = month.split('-').map(Number);
                  const opts = [];
                  for (let yy = y + 1; yy >= y - 3; yy -= 1) {
                    for (let mm = 12; mm >= 1; mm -= 1) {
                      const key = `${yy}-${String(mm).padStart(2, '0')}`;
                      opts.push(<option key={key} value={key}>{prettyMonth(key)}</option>);
                    }
                  }
                  return opts;
                })()}
              </select>
            </label>
          </div>
        </div>
        <p className="muted att-sub">
          Real Savior attendance for {prettyMonth(month)} · shift: {data?.shift?.resolved ? (data.shift.shiftName || data.shift.shiftCode) : PLACEHOLDER}
          {data?.shift?.resolved && data.shift.startTime && data.shift.endTime ? ` (${data.shift.startTime}–${data.shift.endTime})` : ''}
        </p>
      </div>
      {loading ? (
        <div className="card"><p className="muted">Attendance load ho raha hai…</p></div>
      ) : error ? (
        <div className="card">
          <p className="auth__error" role="alert">{error}</p>
          <button type="button" className="btn btn--ghost" onClick={() => load(month)}>Retry</button>
        </div>
      ) : (
        <>
          <div className="att-summary">
            {sumCard('Present', summary.present, C.present)}
            {sumCard('Absent', summary.absent, C.absent)}
            {sumCard('Miss Punch', summary.miss, C.miss)}
            {sumCard('Late', summary.late, C.miss, 'after grace')}
            {sumCard('Holiday', summary.holiday, C.holiday)}
            {sumCard('Weekly Off', summary.weekoff, C.weekoff)}
            {sumCard('Leave', summary.leave, C.leave)}
            {sumCard('Total Hours', hoursText(summary.hours), C.present)}
          </div>

          <div className="att-grid">
            <div className="card att-cal">
              <div className="cal">
                <div className="cal__head">
                  {WEEK_HEADER.map((w) => <div key={w} className="cal__weekday">{w}</div>)}
                </div>
                <div className="cal__grid">
                  {cells.map((c) => {
                    const active = selected === c.key;
                    const isToday = c.key === today;
                    return (
                      <button
                        key={c.key}
                        type="button"
                        onClick={() => setSelected(c.key)}
                        className={'cal__cell' + (c.inMonth ? '' : ' cal__cell--out') + (active ? ' cal__cell--active' : '') + (isToday ? ' cal__cell--today' : '')}
                        style={{ '--cell-color': c.color }}
                      >
                        <span className="cal__day">{c.day}</span>
                        {c.isLate ? <span className="cal__late" title="Late arrival">L</span> : null}
                        <span className="cal__dot" />
                      </button>
                    );
                  })}
                </div>
              </div>
              <div className="cal-legend">
                {[['Present', C.present], ['Absent', C.absent], ['Miss Punch', C.miss], ['Holiday', C.holiday], ['Weekly Off', C.weekoff], ['Leave', C.leave], ['No Record', C.neutral]].map(([label, color]) => (
                  <span key={label} className="cal-legend__item">
                    <span className="cal-legend__dot" style={{ background: color }} />{label}
                  </span>
                ))}
                <span className="cal-legend__item"><span className="cal-legend__late">L</span> Late</span>
              </div>
            </div>
            <div className="card att-detail">
              <h3 className="card__title">{detail ? prettyDate(detail.key) : 'Date Details'}</h3>
              {!detail ? (
                <p className="empty">Calendar se koi date select karein.</p>
              ) : (
                <div className="att-detail__body">
                  <div className="att-detail__status">
                    <span className="badge" style={{ background: `${detail.color}22`, color: detail.color, border: `1px solid ${detail.color}66` }}>{detail.status}</span>
                    {detail.isLate ? <span className="badge" style={{ background: 'rgba(220,38,38,.15)', color: '#f87171', border: '1px solid rgba(220,38,38,.4)' }}>Late{detail.row?.latearrival ? ` ${Number(detail.row.latearrival)}m` : ''}</span> : null}
                  </div>
                  <dl className="kv">
                    {detail.hols.map((h, i) => (
                      <div key={`h${i}`} className="kv__row"><dt>Holiday</dt><dd style={{ color: C.holiday }}>{clean(h.holidayname) || PLACEHOLDER}{clean(h.category) ? ` · ${clean(h.category)}` : ''}</dd></div>
                    ))}
                    {detail.hols.filter((h) => clean(h.description)).map((h, i) => (
                      <div key={`hd${i}`} className="kv__row"><dt>Note</dt><dd>{clean(h.description)}</dd></div>
                    ))}
                    {detail.lv.map((l, i) => (
                      <div key={`l${i}`} className="kv__row"><dt>Leave</dt><dd style={{ color: C.leave }}>{clean(l.typename) || clean(l.leavetype)}{l.isHalfDay ? ' (Half)' : ''}{clean(l.reason) ? ` — ${clean(l.reason)}` : ''}</dd></div>
                    ))}
                    <div className="kv__row"><dt>Status</dt><dd>{detail.status}</dd></div>
                    <div className="kv__row"><dt>Day</dt><dd>{dayName(detail.key)}</dd></div>
                    <div className="kv__row"><dt>In Time</dt><dd>{detail.row ? (fmtPunch(detail.row.inTime) || PLACEHOLDER) : PLACEHOLDER}</dd></div>
                    <div className="kv__row"><dt>Out Time</dt><dd>{detail.row ? (fmtPunch(detail.row.outTime) || PLACEHOLDER) : PLACEHOLDER}</dd></div>
                    <div className="kv__row"><dt>Hours</dt><dd>{detail.row ? hoursText(detail.row.hoursworked) : PLACEHOLDER}</dd></div>
                    {(() => {
                      const rs = clean(detail.row?.currentShift || detail.row?.shift);
                      const rt = clean(detail.row?.shiftStart) && clean(detail.row?.shiftEnd) ? `${clean(detail.row.shiftStart)}–${clean(detail.row.shiftEnd)}` : '';
                      return rs || rt ? <div className="kv__row"><dt>Shift</dt><dd>{rs}{rt ? ` · ${rt}` : ''}</dd></div> : null;
                    })()}
                    {detail.row && detail.row.isLate ? (
                      <div className="kv__row"><dt>Late</dt><dd style={{ color: C.absent }}>{Number(detail.row.latearrival || 0)} min{detail.row.graceUsed ? ` (grace: ${detail.row.graceUsed})` : ''}</dd></div>
                    ) : null}
                    {detail.row && /MISS|MIS/i.test(clean(detail.row.statusCode)) ? (
                      <div className="kv__row"><dt>Miss Punch</dt><dd style={{ color: C.miss }}>{clean(detail.row.reason) || 'Incomplete punch (IN/OUT missing)'}</dd></div>
                    ) : null}
                    {!detail.row && !detail.hols.length && !detail.lv.length ? (
                      <div className="kv__row"><dt>Record</dt><dd className="muted">Not available for this date.</dd></div>
                    ) : null}
                  </dl>
                </div>
              )}
            </div>
          </div>
          <div className="card">
            <h3 className="card__title">Attendance Records · {prettyMonth(month)}</h3>
            {rows.length ? (
              <div className="table-wrap">
                <table className="table att-table">
                  <thead>
                    <tr><th>Date</th><th>Day</th><th>In</th><th>Out</th><th>Hours</th><th>Shift</th><th>Status</th></tr>
                  </thead>
                  <tbody>
                    {rows.map((r, i) => {
                      const key = clean(r.date || r.dateoffice).slice(0, 10);
                      const info = cellInfo(key);
                      return (
                        <tr key={`${key}-${i}`} className={selected === key ? 'table-row--selected' : ''} onClick={() => setSelected(key)}>
                          <td>{prettyDate(key)}</td>
                          <td>{dayName(key)}</td>
                          <td>{fmtPunch(r.inTime) || PLACEHOLDER}</td>
                          <td>{fmtPunch(r.outTime) || PLACEHOLDER}</td>
                          <td>{hoursText(r.hoursworked)}</td>
                          <td>{clean(r.currentShift || r.shift) || PLACEHOLDER}</td>
                          <td>
                            <span className="badge" style={{ background: `${info.color}22`, color: info.color, border: `1px solid ${info.color}66` }}>{info.status}</span>
                            {r.isLate ? <span className="badge att-late-badge">L</span> : null}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            ) : (
              <p className="empty">Is month ka koi attendance data nahi hai.</p>
            )}
          </div>

          <div className="card">
            <h3 className="card__title">Late Arrivals · {prettyMonth(month)}</h3>
            {lateList.length ? (
              <div className="table-wrap">
                <table className="table">
                  <thead><tr><th>Date</th><th>In</th><th>Shift</th><th>Late (min)</th><th>Grace</th></tr></thead>
                  <tbody>
                    {lateList.map((l) => (
                      <tr key={l.key}>
                        <td>{prettyDate(l.date)}</td>
                        <td>{l.inTime}</td>
                        <td>{l.shift}</td>
                        <td style={{ color: C.absent }}>{l.lateMinutes}</td>
                        <td>{l.covered ? `Covered (${l.graceUsed || 'grace'})` : 'Final late'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <p className="empty">Is month koi late arrival nahi hai.</p>
            )}
          </div>
        </>
      )}
    </div>
  );
}
