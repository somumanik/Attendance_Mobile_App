'use client';

// web-next/components/hr/HolidaysSection.jsx — Holiday Management (list).

import useApiData from '../useApiData';
import AsyncBox from '../employee/AsyncBox';
import { prettyDate } from '../../lib/format';

export default function HolidaysSection() {
  const { data, error, loading, reload } = useApiData('/hr/holidays');

  return (
    <AsyncBox loading={loading} error={error} onRetry={reload} label="Holidays load ho rahe hain...">
      <div className="card">
        <h3 className="card__title">Holidays</h3>
        {(data?.holidays || []).length ? (
          <div className="table-wrap">
            <table className="table">
              <thead><tr><th>Date</th><th>Name</th><th>Category</th><th>Company</th><th>Active</th><th>Half Day</th></tr></thead>
              <tbody>
                {(data.holidays || []).map((h, i) => (
                  <tr key={h.id ?? i}>
                    <td>{prettyDate(h.holidaydate)}</td>
                    <td>{h.holidayname}</td>
                    <td>{h.category || '—'}</td>
                    <td>{h.companycode || '—'}</td>
                    <td>{h.active ? 'Yes' : 'No'}</td>
                    <td>{h.isHalfDay ? 'Yes' : 'No'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <p className="empty">Koi holiday nahi.</p>
        )}
      </div>
    </AsyncBox>
  );
}
