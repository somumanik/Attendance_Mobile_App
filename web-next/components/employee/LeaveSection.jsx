'use client';

// web-next/components/employee/LeaveSection.jsx — real leave balance + requests.

import useApiData from './useApiData';
import AsyncBox from './AsyncBox';
import { prettyDate } from '../../lib/format';

export default function LeaveSection() {
  const balance = useApiData('/employee/leave/balance');
  const requests = useApiData('/employee/leave/requests');

  return (
    <>
      <div className="card">
        <h3 className="card__title">Leave Balance</h3>
        <AsyncBox loading={balance.loading} error={balance.error} onRetry={balance.reload} label="Balance load ho raha hai...">
          {(balance.data?.types || []).length ? (
            <div className="table-wrap">
              <table className="table">
                <thead><tr><th>Type</th><th>Opening</th><th>Approved</th><th>Pending</th><th>Available</th></tr></thead>
                <tbody>
                  {(balance.data.types || []).map((t, i) => (
                    <tr key={i}>
                      <td>{t.typename || t.leavetype}</td>
                      <td>{Number(t.openingBalance || 0)}</td>
                      <td>{Number(t.approvedUsed || 0)}</td>
                      <td>{Number(t.pending || 0)}</td>
                      <td>{Number(t.availableBalance || 0)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <p className="empty">Koi leave balance configured nahi hai.</p>
          )}
        </AsyncBox>
      </div>

      <div className="card">
        <h3 className="card__title">My Leave Requests</h3>
        <AsyncBox loading={requests.loading} error={requests.error} onRetry={requests.reload} label="Requests load ho rahe hain...">
          {(requests.data?.requests || []).length ? (
            <div className="table-wrap">
              <table className="table">
                <thead><tr><th>Type</th><th>From</th><th>To</th><th>Status</th><th>Reason</th></tr></thead>
                <tbody>
                  {(requests.data.requests || []).map((r, i) => (
                    <tr key={r.id ?? i}>
                      <td>{r.typename || r.leavetype}</td>
                      <td>{prettyDate(r.fromdate)}</td>
                      <td>{prettyDate(r.todate)}</td>
                      <td><span className="badge">{r.status || '—'}</span></td>
                      <td>{r.reason || '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <p className="empty">Koi leave request nahi hai.</p>
          )}
        </AsyncBox>
      </div>
    </>
  );
}
