'use client';

// web-next/components/employee/ReportsSection.jsx — monthly summary report + grace.

import useApiData from './useApiData';
import AsyncBox from './AsyncBox';
import { prettyDate, prettyMonth } from '../../lib/format';

export default function ReportsSection() {
  const { data, error, loading, reload } = useApiData('/employee/dashboard');

  return (
    <AsyncBox loading={loading} error={error} onRetry={reload} label="Report load ho raha hai...">
      {data ? (
        <>
          <div className="card">
            <h3 className="card__title">Monthly Report — {prettyMonth(data.month)}</h3>
            <dl className="kv">
              <div className="kv__row"><dt>Present</dt><dd>{Number(data.present || 0)}</dd></div>
              <div className="kv__row"><dt>Absent</dt><dd>{Number(data.absent || 0)}</dd></div>
              <div className="kv__row"><dt>Miss Punch</dt><dd>{Number(data.miss || 0)}</dd></div>
              <div className="kv__row"><dt>Week Off</dt><dd>{Number(data.weekOff || 0)}</dd></div>
              <div className="kv__row"><dt>Late (final)</dt><dd>{Number(data.late || 0)}</dd></div>
              <div className="kv__row"><dt>Attendance %</dt><dd>{Number(data.attendancePercentage || 0)}%</dd></div>
              <div className="kv__row"><dt>Total Records</dt><dd>{Number(data.records || 0)}</dd></div>
            </dl>
          </div>

          <div className="card">
            <h3 className="card__title">Grace Allowances (remaining)</h3>
            {data.graceRemaining ? (
              <dl className="kv">
                <div className="kv__row"><dt>30-min grace</dt><dd>{Number(data.graceRemaining.grace30min || 0)} / 2</dd></div>
                <div className="kv__row"><dt>1-hour grace</dt><dd>{Number(data.graceRemaining.grace1hr || 0)} / 1</dd></div>
                <div className="kv__row"><dt>2-hour grace</dt><dd>{Number(data.graceRemaining.grace2hr || 0)} / 1</dd></div>
              </dl>
            ) : (
              <p className="empty">Grace info unavailable.</p>
            )}
          </div>

          <div className="card">
            <h3 className="card__title">Late Arrivals</h3>
            {(data.lateDetails || []).length ? (
              <ul className="list">
                {(data.lateDetails || []).map((l, i) => (
                  <li key={i} className="list__item">
                    {prettyDate(l.date)} — +{Number(l.lateMinutes || 0)} min
                    {l.graceUsed ? <span className="muted"> · covered by {l.graceUsed}</span> : <span className="text-err"> · final late</span>}
                  </li>
                ))}
              </ul>
            ) : (
              <p className="empty">Koi late arrival nahi.</p>
            )}
          </div>
        </>
      ) : null}
    </AsyncBox>
  );
}
