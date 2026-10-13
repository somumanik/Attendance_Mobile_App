'use client';

// web-next/components/hr/AttendanceCalendar.jsx — Google-Calendar-style monthly
// attendance calendar for Single Employee Audit. Presentational only: real rows
// and applicable active holidays come from the existing /hr/audit API response.

import { monthGrid } from './monthGrid';
import { prettyMonth, currentMonthKey, dayName, prettyDate } from '../../lib/format';

const WEEKDAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

export function dateOf(r) {
  return String(r?.date || r?.dateoffice || '').slice(0, 10);
}

// Display classification only — the server's classifyRow result is never altered.
export function dayStatus(row, holiday) {
  if (holiday) return { key: 'holiday', label: 'Holiday', short: 'Holiday' };
  const s = String(row?.computedStatus || row?.statusLabel || '').trim();
  const low = s.toLowerCase();
  if (!s || low === 'no record') return { key: 'none', label: s || 'No record', short: '' };
  if (low.includes('miss')) return { key: 'miss', label: s, short: 'Miss' };
  if (low.includes('absent')) return { key: 'absent', label: s, short: 'Absent' };
  if (low.includes('present')) return { key: 'present', label: s, short: 'Present' };
  if (low.includes('week') || low.includes('off')) return { key: 'weekoff', label: s, short: 'W-Off' };
  return { key: 'none', label: s, short: '' };
}

export default function AttendanceCalendar({ monthKey, onPrev, onNext, onToday, rows, holidays, selectedDate, onSelectDate, loading, error, onRetry }) {
  const grid = monthGrid(monthKey);
  const rowByDate = new Map();
  for (const r of rows || []) {
    const key = dateOf(r);
    if (key && !rowByDate.has(key)) rowByDate.set(key, r);
  }
  const holidayByDate = new Map();
  for (const h of holidays || []) {
    const key = String(h?.holidaydate || '').slice(0, 10);
    if (key && h.active !== false && !holidayByDate.has(key)) holidayByDate.set(key, h);
  }
  const todayIso = currentMonthKey() === monthKey ? new Date().toISOString().slice(0, 10) : '';

  return (
    <div>
      <div className="flex flex-wrap items-center justify-between gap-3 mb-3">
        <h4 className="text-sm font-extrabold text-[var(--text)]">
          <i className="fas fa-calendar-days text-indigo-400 mr-2"></i>{prettyMonth(monthKey)}
        </h4>
        <div className="flex items-center gap-2">
          <button type="button" onClick={onPrev} className="cal-btn" aria-label="Previous month"><i className="fas fa-chevron-left"></i></button>
          <button type="button" onClick={onToday} className="cal-btn cal-btn--today">Today</button>
          <button type="button" onClick={onNext} className="cal-btn" aria-label="Next month"><i className="fas fa-chevron-right"></i></button>
        </div>
      </div>

      {error ? (
        <div className="p-4 rounded-2xl bg-rose-500/10 border border-rose-500/20 text-sm text-rose-300">
          {error} <button type="button" onClick={onRetry} className="underline ml-2">Retry</button>
        </div>
      ) : loading ? (
        <div className="p-4 rounded-2xl bg-indigo-500/10 border border-indigo-500/20 text-sm text-[var(--text)]">
          <i className="fas fa-spinner fa-spin mr-2"></i>Loading attendance…
        </div>
      ) : (
        <>
          <div className="cal-grid cal-grid--head">
            {WEEKDAYS.map((d) => <div key={d} className="cal-head">{d}</div>)}
          </div>
          <div className="cal-grid">
            {grid.cells.map((dateStr, i) => {
              if (!dateStr) return <div key={`e${i}`} className="cal-cell cal-cell--empty" aria-hidden="true"></div>;
              const row = rowByDate.get(dateStr);
              const holiday = holidayByDate.get(dateStr);
              const st = dayStatus(row, holiday);
              const isLate = Boolean(row && (row.isLate || Number(row.latearrival) > 0));
              const cls = [
                'cal-cell',
                `cal-cell--${st.key}`,
                dateStr === todayIso ? 'cal-cell--today' : '',
                dateStr === selectedDate ? 'cal-cell--selected' : '',
              ].filter(Boolean).join(' ');
              return (
                <button key={dateStr} type="button" className={cls} onClick={() => onSelectDate(dateStr)} aria-pressed={dateStr === selectedDate}>
                  <span className="cal-num">{Number(dateStr.slice(8, 10))}</span>
                  {st.short ? <span className="cal-status">{st.short}</span> : null}
                  {isLate ? <span className="cal-late" title="Late arrival">L</span> : null}
                </button>
              );
            })}
          </div>
          <div className="cal-legend">
            <span><i className="cal-dot cal-cell--present"></i>Present</span>
            <span><i className="cal-dot cal-cell--absent"></i>Absent</span>
            <span><i className="cal-dot cal-cell--miss"></i>Miss Punch</span>
            <span><i className="cal-dot cal-cell--weekoff"></i>Weekly Off</span>
            <span><i className="cal-dot cal-cell--holiday"></i>Holiday</span>
            <span><i className="cal-late cal-late--legend">L</i>Late arrival</span>
          </div>
          <p className="text-[10px] text-[var(--muted)] mt-2">
            {prettyMonth(monthKey)} • {grid.days} days • click a date for details
          </p>
        </>
      )}
    </div>
  );
}