'use client';

// web-next/components/employee/ReportsSection.jsx
// "My Attendance Reports" — personal attendance insights, charts, daily
// register and PDF/Excel export for the logged-in employee.
//
// Data (existing common backend, JWT identity — a client paycode is never sent):
//   GET /api/employee/dashboard?month=YYYY-MM  (stats + attendance[] rows)
//   GET /api/employee/holidays?month=YYYY-MM   (employee-specific holidays)
//   GET /api/employee/leave/calendar           (APPROVED leave overlay only)
//   GET /api/employee/profile                  (own name/paycode/designation/...)
// Row statuses come from the backend's classifyRow()/normalizeAttendance()
// (same helpers as HR Single Employee Audit); the per-day overlay precedence is
// the established Attendance tab rule. See reportData.js for the exact rules.

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import ChartCanvas from '../ChartCanvas';
import apiFetch from '../../lib/api';
import { currentMonthKey, isoToday } from '../../lib/format';
import {
  fmtDate, monthLabel, shiftMonth, monthRange, hoursText, clean, DASH,
  STATUS_META, buildRegister, summariseRegister, buildWeeks, punctuality,
  hoursSeries, buildInsights,
} from './reportData';
import { buildPdf, downloadPdf, buildExcel, downloadExcel } from './reportExport';

const NOTES = [
  'Statuses are derived from the common backend attendance classification (classifyRow/normalizeAttendance — the same rules HR Single Employee Audit uses).',
  'Day-level precedence: Holiday (employee-specific holiday calendar) > Approved Leave (approval confirmed by the leave system) > register status.',
  'Holiday and Weekly Off days are never counted as Absent.',
  'Attendance % = Present ÷ (Present + Absent + Miss Punch) × 100.',
  'Late Arrivals is the FINAL late count after monthly grace consumption; grace usages are listed separately and never added to this count.',
  'Working hours are summed only from recorded hoursworked values in the attendance register.',
  'Future dates show "Upcoming" and dates without a source record show "No Record" — a status is never invented.',
  'All data belongs to the logged-in employee (identity from the authenticated session) and comes from the existing common backend.',
];

const readThemeColors = () => {
  if (typeof document === 'undefined') return { text: '#e2e8f0', muted: '#94a3b8', grid: 'rgba(255,255,255,0.08)', surface: '#1e2036' };
  const cs = getComputedStyle(document.documentElement);
  return {
    text: cs.getPropertyValue('--text').trim() || '#e2e8f0',
    muted: cs.getPropertyValue('--muted').trim() || '#94a3b8',
    grid: cs.getPropertyValue('--border').trim() || 'rgba(255,255,255,0.08)',
    surface: cs.getPropertyValue('--surface-solid').trim() || '#1e2036',
  };
};

export default function ReportsSection() {
  const [month, setMonth] = useState(currentMonthKey());
  const [data, setData] = useState(null);
  const [holidays, setHolidays] = useState([]);
  const [leaveDates, setLeaveDates] = useState([]);
  const [profile, setProfile] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [exporting, setExporting] = useState('');
  const [exportMsg, setExportMsg] = useState(null);
  const [themeColors, setThemeColors] = useState(readThemeColors);
  const [prev, setPrev] = useState(null);
  const shownMonth = useRef(currentMonthKey());
  const seqRef = useRef(0);

  const load = useCallback(async (targetMonth) => {
    const seq = ++seqRef.current;
    shownMonth.current = targetMonth;
    setLoading(true);
    setError('');
    setPrev(null);
    const range = monthRange(targetMonth) || { from: `${targetMonth}-01`, to: `${targetMonth}-28` };
    try {
      const dash = await apiFetch(`/employee/dashboard?month=${targetMonth}`);
      if (seq !== seqRef.current) return;
      setData(dash);
    } catch (e) {
      if (seq !== seqRef.current) return;
      setData(null);
      setError(e?.message || 'Unable to load your attendance data. Please try again.');
      setLoading(false);
      return;
    }
    apiFetch(`/employee/holidays?month=${targetMonth}`)
      .then((h) => { if (seq === seqRef.current) setHolidays(Array.isArray(h?.holidays) ? h.holidays : []); })
      .catch(() => { if (seq === seqRef.current) setHolidays([]); });
    apiFetch(`/employee/leave/calendar?from=${range.from}&to=${range.to}`)
      .then((l) => { if (seq === seqRef.current) setLeaveDates(Array.isArray(l?.dates) ? l.dates : []); })
      .catch(() => { if (seq === seqRef.current) setLeaveDates([]); });
    setLoading(false);
  }, []);

  useEffect(() => { load(month); }, [month, load]);

  // Own profile once (for the report headers/exports).
  useEffect(() => {
    let active = true;
    apiFetch('/employee/profile')
      .then((r) => { if (active) setProfile(r?.profile || null); })
      .catch(() => { if (active) setProfile(null); });
    return () => { active = false; };
  }, []);

  // Previous-month snapshot (same endpoints + same rules) — only for the
  // month-on-month insights; failures simply skip the comparisons.
  useEffect(() => {
    if (!data) return;
    const seq = seqRef.current;
    const prevMonth = shiftMonth(month, -1);
    const range = monthRange(prevMonth) || { from: `${prevMonth}-01`, to: `${prevMonth}-28` };
    (async () => {
      try {
        const dash = await apiFetch(`/employee/dashboard?month=${prevMonth}`);
        const hols = await apiFetch(`/employee/holidays?month=${prevMonth}`).catch(() => ({ holidays: [] }));
        const lv = await apiFetch(`/employee/leave/calendar?from=${range.from}&to=${range.to}`).catch(() => ({ dates: [] }));
        if (seq !== seqRef.current) return;
        const prevRegister = buildRegister({
          month: prevMonth,
          attendance: dash?.attendance || [],
          holidays: hols?.holidays || [],
          leaveDates: lv?.dates || [],
          todayIso: dash?.today || isoToday(),
        });
        setPrev({ label: monthLabel(prevMonth), summary: summariseRegister(prevRegister, dash), complete: true });
      } catch { /* previous month unavailable — comparisons stay hidden */ }
    })();
  }, [data, month]);

  // Chart colours follow the active website theme instantly (data-theme system).
  useEffect(() => {
    const obs = new MutationObserver(() => setThemeColors(readThemeColors()));
    obs.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
    return () => obs.disconnect();
  }, []);

  // ---------- derived data (pure reportData rules) ----------
  const todayIso = clean(data?.today) || isoToday();
  const register = useMemo(
    () => buildRegister({ month, attendance: data?.attendance, holidays, leaveDates, todayIso }),
    [month, data, holidays, leaveDates, todayIso],
  );
  const summary = useMemo(() => summariseRegister(register, data), [register, data]);
  const weeks = useMemo(() => buildWeeks(register), [register]);
  const punct = useMemo(() => punctuality(register, data), [register, data]);
  const hours = useMemo(() => hoursSeries(register), [register]);
  const insights = useMemo(
    () => buildInsights({ register, weeks, summary, month, prev }),
    [register, weeks, summary, month, prev],
  );

  const inProgress = month === currentMonthKey();
  const canGoNext = month < currentMonthKey();

  // ---------- chart configs ----------
  const distData = useMemo(() => {
    const kinds = ['present', 'absent', 'miss', 'leave', 'holiday', 'weekoff'];
    if (summary.noRecord > 0) kinds.push('noRecord');
    const used = kinds.filter((k) => summary[k] > 0);
    return {
      labels: used.map((k) => STATUS_META[k].label),
      datasets: [{
        data: used.map((k) => summary[k]),
        backgroundColor: used.map((k) => STATUS_META[k].color),
        borderColor: themeColors.surface,
        borderWidth: 2,
      }],
    };
  }, [summary, themeColors]);

  const weekData = useMemo(() => ({
    labels: weeks.map((w) => `${w.label} · ${fmtDate(w.from).slice(0, 6)}`),
    datasets: [
      { label: 'Present', data: weeks.map((w) => w.present), backgroundColor: STATUS_META.present.color },
      { label: 'Absent', data: weeks.map((w) => w.absent), backgroundColor: STATUS_META.absent.color },
      { label: 'Miss Punch', data: weeks.map((w) => w.miss), backgroundColor: STATUS_META.miss.color },
      { label: 'Approved Leave', data: weeks.map((w) => w.leave), backgroundColor: STATUS_META.leave.color },
    ],
  }), [weeks]);

  const punctData = useMemo(() => ({
    labels: ['On Time', 'Late (covered by grace)', 'Late (final)'],
    datasets: [{
      label: 'Recorded working days',
      data: [punct.onTime, punct.lateCovered, punct.lateFinal],
      backgroundColor: [STATUS_META.present.color, '#0891B2', STATUS_META.absent.color],
    }],
  }), [punct]);

  const hoursData = useMemo(() => ({
    labels: hours.map((h) => fmtDate(h.date).slice(0, 6)),
    datasets: [{
      label: 'Recorded hours',
      data: hours.map((h) => h.hours),
      backgroundColor: 'rgba(79, 70, 229, 0.55)',
      borderColor: 'rgba(79, 70, 229, 0.9)',
      borderWidth: 1,
    }],
  }), [hours]);

  const axisColors = { ticks: themeColors.muted, grid: themeColors.grid };
  const legendColor = themeColors.text;

  // ---------- export handlers (authenticated session data only) ----------
  const captureChart = (id) => {
    if (typeof document === 'undefined') return null;
    const canvas = document.querySelector(`#${id} canvas`);
    try { return canvas ? canvas.toDataURL('image/png') : null; } catch { return null; }
  };

  const runExport = useCallback(async (kind) => {
    if (exporting) return;
    setExporting(kind);
    setExportMsg(null);
    try {
      const monthText = monthLabel(month);
      if (kind === 'pdf') {
        const doc = buildPdf({
          profile, month, summary, register, insights, punct,
          chartImages: {
            dist: captureChart('rpt-chart-dist'),
            week: captureChart('rpt-chart-week'),
            punct: captureChart('rpt-chart-punct'),
          },
          notes: NOTES,
        });
        downloadPdf(doc, `attendance-report-${month}.pdf`);
      } else {
        const wb = buildExcel({ profile, month, summary, register, notes: NOTES });
        downloadExcel(wb, `attendance-report-${month}.xlsx`);
      }
      setExportMsg({ kind: 'ok', text: `${kind === 'pdf' ? 'PDF' : 'Excel'} report generated for ${monthText}.` });
    } catch {
      setExportMsg({ kind: 'error', text: `Unable to generate the ${kind === 'pdf' ? 'PDF' : 'Excel'} report. Please try again.` });
    } finally {
      setExporting('');
    }
  }, [exporting, profile, month, summary, register, insights, punct]);

  const sumCard = (label, value, color, sub) => (
    <div className="rpt-sum" key={label}>
      <div className="rpt-sum__value" style={{ color }}>{value}</div>
      <div className="rpt-sum__label">{label}</div>
      {sub ? <div className="rpt-sum__sub">{sub}</div> : null}
    </div>
  );

  if (loading) {
    return (
      <div className="rpt">
        <div className="card"><p className="empty">Loading your attendance report...</p></div>
      </div>
    );
  }
  if (error) {
    return (
      <div className="rpt">
        <div className="card">
          <p className="empty">{error}</p>
          <div className="rpt-actions">
            <button type="button" className="btn btn--primary" onClick={() => load(month)}>Retry</button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="rpt">
      {/* ---------- Header + month selector + downloads ---------- */}
      <div className="card rpt-head">
        <div className="rpt-head__row">
          <div className="rpt-head__id">
            <h3 className="card__title" style={{ margin: 0 }}>My Attendance Reports</h3>
            <p className="rpt-head__sub">
              {monthLabel(month)}
              {inProgress ? <span className="rpt-chip">Month in progress</span> : null}
            </p>
          </div>
          <div className="rpt-ctrl">
            <button type="button" className="btn btn--ghost" onClick={() => setMonth((m) => shiftMonth(m, -1))}>‹ Prev</button>
            <button type="button" className="btn btn--ghost" onClick={() => setMonth(currentMonthKey())}>Current Month</button>
            <button type="button" className="btn btn--ghost" disabled={!canGoNext} onClick={() => canGoNext && setMonth((m) => shiftMonth(m, 1))}>Next ›</button>
            <button type="button" className="btn btn--primary" disabled={!!exporting} onClick={() => runExport('pdf')}>
              {exporting === 'pdf' ? 'Generating...' : 'Download PDF'}
            </button>
            <button type="button" className="btn btn--primary" disabled={!!exporting} onClick={() => runExport('excel')}>
              {exporting === 'excel' ? 'Generating...' : 'Download Excel'}
            </button>
          </div>
        </div>
        {exportMsg ? (
          <div className={exportMsg.kind === 'ok' ? 'rpt-msg rpt-msg--ok' : 'rpt-msg rpt-msg--error'} role="status">{exportMsg.text}</div>
        ) : null}
      </div>

      {/* ---------- Monthly summary cards ---------- */}
      <div className="rpt-summary">
        {sumCard('Present Days', summary.present, STATUS_META.present.color, `of ${summary.totalDays} calendar days`)}
        {sumCard('Absent Days', summary.absent, STATUS_META.absent.color, 'Excludes leave / holiday / weekly off')}
        {sumCard('Miss Punch', summary.miss, STATUS_META.miss.color, 'Incomplete punch records')}
        {sumCard('Late Arrivals', summary.lateFinal, '#7C3AED', `final after grace · ${summary.lateRaw} late day(s) total`)}
        {sumCard('Attendance %', summary.attendancePct === null ? DASH : `${summary.attendancePct}%`, '#2563EB', 'Present ÷ (Present + Absent + Miss Punch)')}
        {sumCard('Recorded Hours', summary.recordedDays > 0 ? hoursText(summary.hoursMin) : DASH, '#0891B2', summary.recordedDays > 0 ? `${summary.recordedDays} recorded day(s)` : 'No recorded hours in source')}
      </div>

      {/* ---------- Visual attendance analysis ---------- */}
      <div className="rpt-charts">
        <div className="card">
          <h3 className="card__title">Attendance Distribution</h3>
          <p className="rpt-note">Holiday and Weekly Off are shown separately — never inside Absent.</p>
          <div id="rpt-chart-dist">
            <ChartCanvas type="doughnut" height={260} data={distData}
              options={{ plugins: { legend: { position: 'bottom', labels: { color: legendColor, boxWidth: 12, font: { size: 11 } } } }, borderColor: themeColors.surface }} />
          </div>
        </div>
        <div className="card">
          <h3 className="card__title">Week-wise Attendance Trend</h3>
          <p className="rpt-note">Calendar weeks (Mon–Sun), actual recorded statuses.</p>
          <div id="rpt-chart-week">
            <ChartCanvas type="bar" height={260} data={weekData}
              options={{
                scales: {
                  x: { stacked: true, ticks: { color: axisColors.ticks, font: { size: 10 } }, grid: { color: axisColors.grid } },
                  y: { stacked: true, ticks: { color: axisColors.ticks, precision: 0 }, grid: { color: axisColors.grid } },
                },
                plugins: { legend: { position: 'bottom', labels: { color: legendColor, boxWidth: 12, font: { size: 11 } } } },
              }} />
          </div>
        </div>
        <div className="card">
          <h3 className="card__title">Punctuality Analysis</h3>
          <p className="rpt-note">Late = raw late arrivals; only the FINAL late count (after monthly grace) is reported as Late Arrivals.</p>
          <div id="rpt-chart-punct">
            <ChartCanvas type="bar" height={220} data={punctData}
              options={{
                scales: {
                  x: { ticks: { color: axisColors.ticks, font: { size: 10 } }, grid: { color: axisColors.grid } },
                  y: { ticks: { color: axisColors.ticks, precision: 0 }, grid: { color: axisColors.grid } },
                },
                plugins: { legend: { display: false } },
              }} />
          </div>
          <div className="rpt-grace">
            {punct.graceRemaining ? (
              <span>
                Grace remaining this month — 30 min: {Number(punct.graceRemaining.grace30min || 0)}/2 ·
                1 hr: {Number(punct.graceRemaining.grace1hr || 0)}/1 ·
                2 hr: {Number(punct.graceRemaining.grace2hr || 0)}/1
              </span>
            ) : <span>Grace information unavailable for this month.</span>}
          </div>
          {(data?.lateDetails || []).length ? (
            <ul className="list rpt-late-list">
              {(data.lateDetails || []).map((l, i) => (
                <li key={`${clean(l.date)}-${i}`} className="list__item">
                  {fmtDate(l.date)} — +{Number(l.lateMinutes || 0)} min
                  {l.isFinalLate === false
                    ? <span className="muted"> · covered by {clean(l.graceUsed) || 'grace'}</span>
                    : <span className="rpt-late-final"> · final late</span>}
                </li>
              ))}
            </ul>
          ) : (
            <p className="empty">No late arrivals recorded this month.</p>
          )}
        </div>
        <div className="card">
          <h3 className="card__title">Working Hours Trend</h3>
          <p className="rpt-note">Recorded working hours per day (only days present in the attendance register).</p>
          <div id="rpt-chart-hours">
            {hours.length ? (
              <ChartCanvas type="bar" height={260} data={hoursData}
                options={{
                  scales: {
                    x: { ticks: { color: axisColors.ticks, font: { size: 9 }, maxRotation: 60 }, grid: { color: axisColors.grid } },
                    y: { ticks: { color: axisColors.ticks }, grid: { color: axisColors.grid }, title: { display: true, text: 'Hours', color: axisColors.ticks } },
                  },
                  plugins: { legend: { display: false } },
                }} />
            ) : (
              <p className="empty">No recorded working hours in the source for this month.</p>
            )}
          </div>
        </div>
      </div>

      {/* ---------- My Month at a Glance ---------- */}
      <div className="card">
        <h3 className="card__title">My Month at a Glance</h3>
        <p className="rpt-note">Factual insights from your own recorded data — no scores or rankings.</p>
        {insights.length ? (
          <div className="rpt-insights">
            {insights.map((it) => (
              <div className="rpt-insight" key={it.id}>
                <div className="rpt-insight__title">{it.title}</div>
                <div className="rpt-insight__value">{it.value}</div>
                <div className="rpt-insight__note">{it.note}</div>
              </div>
            ))}
          </div>
        ) : (
          <p className="empty">Not enough recorded data this month for insights.</p>
        )}
      </div>

      {/* ---------- Complete daily attendance register ---------- */}
      <div className="card">
        <h3 className="card__title">Daily Attendance Register</h3>
        <p className="rpt-note">
          Every calendar date of {monthLabel(month)}
          {inProgress ? ' · current month in progress — future dates are marked Upcoming' : ''}
        </p>
        <div className="rpt-legend">
          {Object.entries(STATUS_META).map(([k, m]) => (
            <span className="rpt-legend__item" key={k}>
              <span className="rpt-legend__dot" style={{ background: m.color }} /> {m.label}
            </span>
          ))}
        </div>
        <div className="table-wrap">
          <table className="table rpt-table">
            <thead>
              <tr>
                <th>Date</th><th>Day</th><th>In Time</th><th>Out Time</th>
                <th>Worked Hours</th><th>Attendance Status</th><th>Late Duration</th><th>Remark / Reason</th>
              </tr>
            </thead>
            <tbody>
              {register.map((r) => (
                <tr key={r.date} className={r.future ? 'rpt-row--future' : (r.inProgress ? 'rpt-row--today' : '')}>
                  <td>{fmtDate(r.date)}</td>
                  <td>{r.dayName}</td>
                  <td>{r.inTime || DASH}</td>
                  <td>{r.outTime || DASH}</td>
                  <td>{r.hasRow ? r.hoursText : DASH}</td>
                  <td>
                    <span className="rpt-status" style={{ color: (STATUS_META[r.kind] || STATUS_META.noRecord).color, borderColor: `${(STATUS_META[r.kind] || STATUS_META.noRecord).color}55` }}>
                      {r.status}
                    </span>
                  </td>
                  <td>
                    {r.lateText
                      ? (r.graceUsed ? `${r.lateText} (covered by ${r.graceUsed})` : r.lateText)
                      : DASH}
                  </td>
                  <td className="rpt-remark">{r.remark || DASH}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* ---------- Status legend + calculation notes ---------- */}
      <div className="card">
        <h3 className="card__title">Calculation Notes</h3>
        <ol className="rpt-notes">
          {NOTES.map((n) => <li key={n}>{n}</li>)}
        </ol>
      </div>
    </div>
  );
}
