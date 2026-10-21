'use client';

// web-next/components/employee/FullFinalSection.jsx — Full & Final ESTIMATE (self-service).
//
// Parity with the mobile app's EmployeeGratuityScreen estimation workflow:
//   INPUTS  → Proposed Leaving Date, Notice Served Days, Notice Waived (estimation
//             inputs only — NEVER saved anywhere, exactly like the mobile app)
//   RESULT  → component-wise breakdown from the SHARED backend engine
//             (GET /api/employee/fullfinal — identity comes from the JWT; the
//             browser never sends a paycode)
//
// All amounts/basis text come from server/salary-service.js computeFullFinal —
// the same engine behind the HR Estimate tab and the mobile app.

import { useState } from 'react';
import useApiData from './useApiData';
import AsyncBox from './AsyncBox';
import SalaryEstimateBreakdown from '../SalaryEstimateBreakdown';

export default function FullFinalSection() {
  const [leavingDate, setLeavingDate] = useState('');
  const [noticeServed, setNoticeServed] = useState('');
  const [noticeWaived, setNoticeWaived] = useState(false);
  const [query, setQuery] = useState('');

  const path = `/employee/fullfinal${query}`;
  const { data, error, loading, reload } = useApiData(path);

  function calculate(e) {
    e.preventDefault();
    const params = new URLSearchParams();
    if (leavingDate) params.set('leavingdate', leavingDate);
    if (String(noticeServed).trim() !== '') params.set('noticeServedDays', String(noticeServed).trim());
    if (noticeWaived) params.set('noticeWaived', 'true');
    const qs = params.toString();
    setQuery(qs ? `?${qs}` : '');
    if (qs && path === `/employee/fullfinal?${qs}`) reload();
  }

  return (
    <div>
      <form className="card" onSubmit={calculate}>
        <h3 className="card__title">Full &amp; Final Estimate</h3>

        <div className="field">
          <label className="field__label" htmlFor="ff-leaving">Proposed Leaving Date</label>
          <input id="ff-leaving" className="field__input" type="date" value={leavingDate} onChange={(e) => setLeavingDate(e.target.value)} />
          <p className="muted" style={{ marginTop: 6, fontSize: 11 }}>Estimation input only (YYYY-MM-DD). Ye official leaving date NAHI hai aur kahin save nahi hota.</p>
        </div>

        <div className="field">
          <label className="field__label" htmlFor="ff-notice">Notice Served Days (optional)</label>
          <input id="ff-notice" className="field__input" type="text" inputMode="numeric" value={noticeServed} onChange={(e) => setNoticeServed(e.target.value)} placeholder="e.g. 15" />
        </div>

        <div className="field">
          <label className="field__label" htmlFor="ff-waived" style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <input id="ff-waived" type="checkbox" checked={noticeWaived} onChange={(e) => setNoticeWaived(e.target.checked)} />
            Notice waived by employer (unserved notice payable to employee)
          </label>
        </div>

        <button className="btn btn--primary" type="submit">Calculate Estimate</button>
        <p className="muted" style={{ marginTop: 10 }}>Ye sirf ek ESTIMATE hai — final settled amount nahi.</p>
      </form>

      <AsyncBox loading={loading} error={error} onRetry={reload} label="Estimate load ho raha hai...">
        {data ? <SalaryEstimateBreakdown data={data} /> : null}
      </AsyncBox>
    </div>
  );
}