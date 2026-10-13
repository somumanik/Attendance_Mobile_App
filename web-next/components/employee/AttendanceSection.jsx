'use client';

// web-next/components/employee/AttendanceSection.jsx — real month-wise attendance + month nav.

import { useState } from 'react';
import useApiData from './useApiData';
import AsyncBox from './AsyncBox';
import { currentMonthKey, shiftMonth, prettyMonth, prettyDate, dayName, fmtPunch } from '../../lib/format';

const hoursText = (m) => {
  const n = Number(m);
  if (!Number.isFinite(n) || n <= 0) return '0h';
  const h = Math.floor(n / 60);
  const r = n % 60;
  return r ? `${h}h ${r}m` : `${h}h`;
};

const statusClass = (s) => {
  const c = String(s || '').toLowerCase();
  if (c.includes('present')) return 'status--present';
  if (c.includes('absent')) return 'status--absent';
  if (c.includes('miss')) return 'status--miss';
  if (c.includes('week') || c.includes('holiday')) return 'status--weekoff';
  if (c.includes('leave')) return 'status--leave';
  return '';
};

export default function AttendanceSection() {
  const [month, setMonth] = useState(currentMonthKey());
  const { data, error, loading, reload } = useApiData(`/employee/dashboard?month=${month}`, [month]);

  return (
    <div>
      <div className="month-nav">
        <button className="btn btn--ghost" type="button" onClick={() => setMonth((m) => shiftMonth(m, -1))}>‹ Prev</button>
        <span className="month-nav__label">{prettyMonth(month)}</span>
        <button className="btn btn--ghost" type="button" onClick={() => setMonth((m) => shiftMonth(m, 1))}>Next ›</button>
      </div>

      <AsyncBox loading={loading} error={error} onRetry={reload} label="Attendance load ho raha hai...">
        {data ? (
          <>
            {data.shift?.resolved ? (
              <p className="muted">Shift: {data.shift.shiftName || data.shift.shiftCode}{data.shift.startTime && data.shift.endTime ? ` (${data.shift.startTime} – ${data.shift.endTime})` : ''}</p>
            ) : null}
            {(data.attendance || []).length ? (
              <div className="table-wrap">
                <table className="table">
                  <thead><tr><th>Date</th><th>Day</th><th>In</th><th>Out</th><th>Hours</th><th>Status</th></tr></thead>
                  <tbody>
                    {(data.attendance || []).map((r, i) => (
                      <tr key={i}>
                        <td>{prettyDate(r.date || r.dateoffice)}</td>
                        <td>{dayName(r.date || r.dateoffice)}</td>
                        <td>{fmtPunch(r.inTime) || '—'}</td>
                        <td>{fmtPunch(r.outTime) || '—'}</td>
                        <td>{hoursText(r.hoursworked)}</td>
                        <td><span className={`badge ${statusClass(r.computedStatus || r.statusLabel)}`}>{r.computedStatus || r.statusLabel || '—'}</span></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <p className="empty">Is month ka koi attendance data nahi hai.</p>
            )}
          </>
        ) : null}
      </AsyncBox>
    </div>
  );
}
