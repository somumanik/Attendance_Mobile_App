'use client';

// web-next/components/employee/FullFinalSection.jsx — Full & Final ESTIMATE (self-service, read-only).

import { useState } from 'react';
import useApiData from './useApiData';
import AsyncBox from './AsyncBox';
import { isoToday } from '../../lib/format';

export default function FullFinalSection() {
  const [leavingDate, setLeavingDate] = useState('');
  const [query, setQuery] = useState('');
  const path = `/employee/fullfinal${query ? `?leavingdate=${encodeURIComponent(query)}` : ''}`;
  const { data, error, loading, reload } = useApiData(path);

  function calculate(e) {
    e.preventDefault();
    setQuery(leavingDate || isoToday());
  }

  return (
    <div>
      <form className="card" onSubmit={calculate}>
        <h3 className="card__title">Full &amp; Final Estimate</h3>
        <div className="field">
          <label className="field__label" htmlFor="ff-leaving">Leaving Date</label>
          <input id="ff-leaving" className="field__input" type="date" value={leavingDate} onChange={(e) => setLeavingDate(e.target.value)} />
        </div>
        <button className="btn btn--primary" type="submit">Calculate Estimate</button>
        <p className="muted" style={{ marginTop: 10 }}>Ye sirf ek ESTIMATE hai — final settled amount nahi.</p>
      </form>

      <AsyncBox loading={loading} error={error} onRetry={reload} label="Estimate load ho raha hai...">
        {data ? (
          data.salary?.available === false ? (
            <div className="card"><p className="empty">Salary information is not available for calculation (import nahi hui).</p></div>
          ) : (
            <div className="card">
              <h3 className="card__title">Estimate</h3>
              <dl className="kv">
                {Object.entries(data.estimate || {}).map(([k, v]) => (
                  <div className="kv__row" key={k}>
                    <dt>{k}</dt>
                    <dd>{typeof v === 'object' && v !== null ? (v.amount != null ? `${v.amount}${v.basis ? ` (${v.basis})` : ''}` : JSON.stringify(v)) : String(v)}</dd>
                  </div>
                ))}
              </dl>
              {data.disclaimer ? <p className="muted" style={{ marginTop: 10 }}>{data.disclaimer}</p> : null}
            </div>
          )
        ) : null}
      </AsyncBox>
    </div>
  );
}
