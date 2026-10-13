'use client';

// web-next/components/hr/LeaveSection.jsx — Leave Management (types + balances + requests + approve/reject; real backend data).

import { useState } from 'react';
import useApiData from '../useApiData';
import AsyncBox from '../employee/AsyncBox';
import apiFetch from '../../lib/api';
import { prettyDate } from '../../lib/format';

export default function LeaveSection() {
  const [filter, setFilter] = useState('Pending');
  const [busy, setBusy] = useState(null);
  const [msg, setMsg] = useState('');

  const types = useApiData('/hr/leave/types');
  const balances = useApiData('/hr/leave/balances');
  const requests = useApiData('/hr/leave/requests');

  const typeList = types.data?.types || [];
  const typeName = {};
  typeList.forEach((t) => { typeName[t.leavetype] = t.typename || t.leavetype; });

  const empList = balances.data?.employees || [];
  const balanceRows = empList.flatMap((e) => (e.types || []).map((t) => ({ paycode: e.paycode, empname: e.empname, leavetype: t.leavetype, openingBalance: t.openingBalance })));

  const allReq = requests.data?.requests || [];
  const reqList = allReq.filter((r) => (filter === 'All' ? true : r.status === filter));

  async function decide(id, decision) {
    setBusy(id);
    setMsg('');
    try {
      await apiFetch(`/hr/leave/requests/${id}/decision`, { method: 'POST', body: { decision } });
      setMsg(`Request ${decision.toLowerCase()}.`);
      requests.reload();
      balances.reload();
    } catch (e) {
      setMsg(e?.message || 'Decision failed.');
    } finally {
      setBusy(null);
    }
  }

  const tabClass = (active) => `px-3.5 py-1.5 rounded-xl text-[11px] font-bold transition ${active ? 'bg-indigo-600 text-white' : 'bg-white/5 border border-[var(--border)] text-[var(--text)] hover:bg-white/10'}`;

  return (
    <>
      <div className="glass-card rounded-3xl p-6">
        <h3 className="font-bold text-base text-[var(--text)] flex items-center gap-2 mb-4"><i className="fas fa-clipboard-check text-sky-400"></i> Leave Management</h3>

        {msg ? <p className="text-xs text-[var(--accent-soft)] mb-3">{msg}</p> : null}

        <div className="flex items-center gap-2 mb-4">
          <button type="button" onClick={() => setFilter('Pending')} className={tabClass(filter === 'Pending')}>Pending</button>
          <button type="button" onClick={() => setFilter('All')} className={tabClass(filter === 'All')}>All</button>
        </div>

        <AsyncBox loading={requests.loading} error={requests.error} onRetry={requests.reload} label="Leave requests load ho rahe hain...">
          {reqList.length ? (
            <div className="overflow-x-auto">
              <table className="portal-table">
                <thead><tr><th>ID</th><th>Paycode</th><th>Name</th><th>Type</th><th>From</th><th>To</th><th>Days</th><th>Reason</th><th>Status</th><th className="text-center">Action</th></tr></thead>
                <tbody>
                  {reqList.map((r) => (
                    <tr key={r.id}>
                      <td className="mono text-[var(--accent-soft)]">{r.id}</td>
                      <td className="mono">{r.paycode}</td>
                      <td className="font-semibold">{r.empname}</td>
                      <td>{typeName[r.leavetype] || r.typename || r.leavetype}</td>
                      <td>{prettyDate(r.fromdate)}</td>
                      <td>{prettyDate(r.todate)}</td>
                      <td className="font-bold">{r.days}</td>
                      <td>{r.reason || '—'}</td>
                      <td><span className="badge">{r.status}</span></td>
                      <td className="text-center">
                        {r.status === 'Pending' ? (
                          <div className="flex justify-center gap-1.5">
                            <button type="button" onClick={() => decide(r.id, 'Approved')} disabled={busy === r.id} className="px-2.5 py-1 rounded-lg bg-emerald-500/15 border border-emerald-500/30 text-emerald-300 hover:bg-emerald-500/25 text-[11px] font-bold transition disabled:opacity-50"><i className="fas fa-check mr-1"></i>Approve</button>
                            <button type="button" onClick={() => decide(r.id, 'Rejected')} disabled={busy === r.id} className="px-2.5 py-1 rounded-lg bg-rose-500/15 border border-rose-500/30 text-rose-300 hover:bg-rose-500/25 text-[11px] font-bold transition disabled:opacity-50"><i className="fas fa-xmark mr-1"></i>Reject</button>
                          </div>
                        ) : <span className="text-[var(--muted)] text-[11px]">—</span>}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <p className="text-xs text-[var(--muted)] py-6 text-center">No leave request found.</p>
          )}
        </AsyncBox>
      </div>
      <div className="glass-card rounded-3xl p-6">
        <h3 className="font-bold text-sm text-[var(--text)] mb-4">Leave Balances</h3>
        <AsyncBox loading={balances.loading} error={balances.error} onRetry={balances.reload} label="...">
          {balanceRows.length ? (
            <div className="overflow-x-auto">
              <table className="portal-table">
                <thead><tr><th>Paycode</th><th>Name</th><th>Type</th><th>Opening</th></tr></thead>
                <tbody>
                  {balanceRows.map((b, i) => (
                    <tr key={i}><td className="mono">{b.paycode}</td><td>{b.empname}</td><td>{typeName[b.leavetype] || b.leavetype}</td><td>{b.openingBalance}</td></tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <p className="text-xs text-[var(--muted)] py-6 text-center">Koi leave balance data nahi (HR Excel import ke baad dikhega).</p>
          )}
        </AsyncBox>
      </div>

      <div className="glass-card rounded-3xl p-6">
        <h3 className="font-bold text-sm text-[var(--text)] mb-4">Leave Types</h3>
        <AsyncBox loading={types.loading} error={types.error} onRetry={types.reload} label="...">
          {typeList.length ? (
            <div className="overflow-x-auto">
              <table className="portal-table">
                <thead><tr><th>Code</th><th>Name</th><th>Sort</th><th>Active</th></tr></thead>
                <tbody>
                  {typeList.map((t, i) => (
                    <tr key={i}><td className="mono">{t.leavetype}</td><td>{t.typename}</td><td>{t.sortorder}</td><td>{t.active ? 'Yes' : 'No'}</td></tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <p className="text-xs text-[var(--muted)] py-6 text-center">Koi leave type nahi.</p>
          )}
        </AsyncBox>
      </div>
    </>
  );
}
