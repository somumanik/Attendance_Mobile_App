'use client';

// web-next/components/hr/LeaveSection.jsx — Leave Management (HR Admin).
// Tabs: Requests / Leave Balances / Excel Import / Leave Types & Rules.
// Reuses the same backend the mobile app uses; no separate data source.

import { useMemo, useState } from 'react';
import useApiData from '../useApiData';
import AsyncBox from '../employee/AsyncBox';
import apiFetch from '../../lib/api';
import { prettyDate } from '../../lib/format';
import ExcelImport from './ExcelImport';
import { LEAVE_COLUMNS, downloadCsv } from '../../lib/excelImport';

function currentFyLabel() {
  const d = new Date();
  const y = d.getFullYear();
  const start = (d.getMonth() + 1) >= 4 ? y : y - 1;
  return `${start}-${start + 1}`;
}
function shiftFy(label, delta) {
  const start = Number(String(label || '').split('-')[0]) || new Date().getFullYear();
  const s = start + delta;
  return `${s}-${s + 1}`;
}
function fyStart(label) {
  return Number(String(label || '').split('-')[0]) || new Date().getFullYear();
}
function fmtDateTime(v) {
  const s = String(v || '');
  if (!s) return '—';
  const d = s.slice(0, 10);
  return prettyDate(d) || d;
}
function durationText(r) {
  if (r?.isHalfDay) return '0.5 (Half day)';
  return `${r?.days ?? 0} day${Number(r?.days) === 1 ? '' : 's'}`;
}
function statusBadge(status) {
  const c = String(status || '').toLowerCase();
  if (c === 'pending') return <span className="badge badge--leave">Pending</span>;
  if (c === 'approved') return <span className="badge badge--present">Approved</span>;
  if (c === 'rejected') return <span className="badge badge--absent">Rejected</span>;
  if (c === 'cancelled') return <span className="badge badge--neutral">Cancelled</span>;
  return <span className="badge badge--neutral">{status || '—'}</span>;
}

export default function LeaveSection() {
  const [tab, setTab] = useState('requests');
  const [fy, setFy] = useState(currentFyLabel());
  const [statusFilter, setStatusFilter] = useState('Pending');
  const [search, setSearch] = useState('');
  const [busyId, setBusyId] = useState(null);
  const [msg, setMsg] = useState('');

  const start = fyStart(fy);

  const types = useApiData('/hr/leave/types');
  const config = useApiData('/hr/leave/config');
  const requests = useApiData(`/hr/leave/requests?leaveyear=${start}`);
  const balances = useApiData(`/hr/leave/balances?leaveyear=${fy}`);

  const typeList = types.data?.types || [];
  const typeName = {};
  typeList.forEach((t) => { typeName[t.leavetype] = t.typename || t.leavetype; });
  const cfg = config.data?.config || {};

  const allReq = requests.data?.requests || [];
  const reqList = useMemo(() => {
    const q = search.trim().toLowerCase();
    return allReq.filter((r) => {
      if (statusFilter !== 'All' && r.status !== statusFilter) return false;
      if (!q) return true;
      const hay = [r.paycode, r.empname, r.leavetype, typeName[r.leavetype], r.reason].join(' ').toLowerCase();
      return hay.includes(q);
    });
  }, [allReq, statusFilter, search, typeName]);

  const empList = balances.data?.employees || [];
  const balanceRows = useMemo(() => {
    const q = search.trim().toLowerCase();
    const rows = empList.flatMap((e) => (e.types || []).map((t) => ({ paycode: e.paycode, empname: e.empname, presentcardno: e.presentcardno, companycode: e.companycode, leavetype: t.leavetype, openingBalance: t.openingBalance })));
    if (!q) return rows;
    return rows.filter((b) => [b.paycode, b.empname, b.leavetype, typeName[b.leavetype]].join(' ').toLowerCase().includes(q));
  }, [empList, search, typeName]);

  const leaveYearLabel = balances.data?.leaveyear || fy;
  const pendingCount = allReq.filter((r) => r.status === 'Pending').length;
  const approvedCount = allReq.filter((r) => r.status === 'Approved').length;

  async function decide(id, decision) {
    setBusyId(id);
    setMsg('');
    try {
      await apiFetch(`/hr/leave/requests/${id}/decision`, { method: 'POST', body: { decision } });
      setMsg(`Request ${decision.toLowerCase()} ho gaya.`);
      requests.reload();
    } catch (e) {
      setMsg(e?.message || 'Decision failed.');
    } finally {
      setBusyId(null);
    }
  }

  function exportBalances() {
    if (!balanceRows.length) return;
    downloadCsv('leave-opening-balances.csv', [
      ['Leave Year', 'Paycode', 'Biometric Code', 'Employee Name', 'Company Code', 'Leave Type', 'Opening Balance'],
      ...balanceRows.map((b) => [leaveYearLabel, b.paycode, b.presentcardno || '', b.empname, b.companycode || '', b.leavetype, b.openingBalance ?? '']),
    ]);
  }

  const tabClass = (active) => `px-3.5 py-1.5 rounded-xl text-[11px] font-bold transition ${active ? 'bg-indigo-600 text-white' : 'bg-white/5 border border-[var(--border)] text-[var(--text)] hover:bg-white/10'}`;


  return (
    <div className="space-y-4">
      <div className="glass-card rounded-3xl p-6">
        <div className="flex items-center justify-between gap-4 flex-wrap mb-5">
          <h2 className="font-bold text-lg text-[var(--text)] flex items-center gap-2"><i className="fas fa-clipboard-check text-sky-400"></i> Leave Management</h2>
          <div className="flex items-center gap-2">
            <button type="button" onClick={() => setFy(shiftFy(fy, -1))} className="px-2.5 py-1.5 rounded-lg bg-white/5 border border-[var(--border)] text-[var(--text)] text-xs font-bold transition hover:bg-white/10"><i className="fas fa-chevron-left mr-1"></i>Prev</button>
            <span className="px-3 py-1.5 rounded-lg bg-indigo-600/15 border border-indigo-500/30 text-indigo-200 text-xs font-bold mono">{fy}</span>
            <button type="button" onClick={() => setFy(shiftFy(fy, 1))} className="px-2.5 py-1.5 rounded-lg bg-white/5 border border-[var(--border)] text-[var(--text)] text-xs font-bold transition hover:bg-white/10">Next<i className="fas fa-chevron-right ml-1"></i></button>
          </div>
        </div>

        {msg ? <p className="text-xs text-[var(--accent-soft)] mb-4 bg-white/5 border border-[var(--border)] rounded-xl px-3 py-2">{msg}</p> : null}

        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
          <div className="p-4 rounded-2xl bg-amber-500/10 border border-amber-500/20 text-center"><p className="text-2xl font-extrabold text-amber-300">{pendingCount}</p><p className="text-[10px] text-[var(--muted)] uppercase font-bold mt-1">Pending Requests</p></div>
          <div className="p-4 rounded-2xl bg-emerald-500/10 border border-emerald-500/20 text-center"><p className="text-2xl font-extrabold text-emerald-300">{approvedCount}</p><p className="text-[10px] text-[var(--muted)] uppercase font-bold mt-1">Approved Requests</p></div>
          <div className="p-4 rounded-2xl bg-sky-500/10 border border-sky-500/20 text-center"><p className="text-2xl font-extrabold text-sky-300">{empList.length}</p><p className="text-[10px] text-[var(--muted)] uppercase font-bold mt-1">Employees with Balances</p></div>
          <div className="p-4 rounded-2xl bg-violet-500/10 border border-violet-500/20 text-center"><p className="text-2xl font-extrabold text-violet-300">{typeList.length}</p><p className="text-[10px] text-[var(--muted)] uppercase font-bold mt-1">Leave Types</p></div>
        </div>

        <div className="flex flex-wrap items-center gap-2 mt-5 mb-4">
          {[['requests', 'Requests'], ['balances', 'Leave Balances'], ['import', 'Excel Import'], ['rules', 'Types & Rules']].map(([id, label]) => (
            <button key={id} type="button" onClick={() => setTab(id)} className={tabClass(tab === id)}>{label}</button>
          ))}
        </div>
      </div>

      {tab === 'requests' ? (
        <div className="glass-card rounded-3xl p-6">

          <div className="flex items-center justify-between gap-3 flex-wrap mb-4">
            <div className="flex items-center gap-2 flex-wrap">
              {['Pending', 'Approved', 'Rejected', 'Cancelled', 'All'].map((s) => (
                <button key={s} type="button" onClick={() => setStatusFilter(s)} className={tabClass(statusFilter === s)}>{s}</button>
              ))}
            </div>
            <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search paycode / name / type / reason" className="px-3 py-2 rounded-xl bg-[var(--input-bg)] border border-[var(--border)] text-xs text-[var(--text)] outline-none focus:border-[var(--accent)] w-full sm:w-72" />
          </div>

          <AsyncBox loading={requests.loading} error={requests.error} onRetry={requests.reload} label="Leave requests load ho rahe hain...">
            {reqList.length ? (
              <div className="overflow-x-auto">
                <table className="portal-table">
                  <thead><tr><th>ID</th><th>Paycode</th><th>Employee</th><th>Type</th><th>From</th><th>To</th><th>Duration</th><th>Reason</th><th>Applied</th><th>Status</th><th className="text-center">Action</th></tr></thead>
                  <tbody>
                    {reqList.map((r) => (
                      <tr key={r.id}>
                        <td className="mono text-[var(--accent-soft)]">{r.id}</td>
                        <td className="mono">{r.paycode}</td>
                        <td className="font-semibold">{r.empname}</td>
                        <td>{typeName[r.leavetype] || r.typename || r.leavetype}</td>
                        <td className="mono">{prettyDate(r.fromdate)}</td>
                        <td className="mono">{prettyDate(r.todate)}</td>
                        <td>{durationText(r)}</td>
                        <td>{r.reason || '—'}</td>
                        <td className="mono">{fmtDateTime(r.appliedat)}</td>
                        <td>{statusBadge(r.status)}</td>
                        <td className="text-center">
                          {r.status === 'Pending' ? (
                            <div className="flex justify-center gap-1.5">
                              <button type="button" onClick={() => decide(r.id, 'Approved')} disabled={busyId === r.id} className="px-2.5 py-1 rounded-lg bg-emerald-500/15 border border-emerald-500/30 text-emerald-300 hover:bg-emerald-500/25 text-[11px] font-bold transition disabled:opacity-50">{busyId === r.id ? <i className="fas fa-spinner fa-spin mr-1"></i> : <i className="fas fa-check mr-1"></i>}Approve</button>
                              <button type="button" onClick={() => decide(r.id, 'Rejected')} disabled={busyId === r.id} className="px-2.5 py-1 rounded-lg bg-rose-500/15 border border-rose-500/30 text-rose-300 hover:bg-rose-500/25 text-[11px] font-bold transition disabled:opacity-50"><i className="fas fa-xmark mr-1"></i>Reject</button>
                            </div>
                          ) : <span className="text-[var(--muted)] text-[11px]">—</span>}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <p className="text-xs text-[var(--muted)] py-6 text-center">{allReq.length ? 'Is filter/search me koi request nahi.' : 'Koi leave request nahi mili.'}</p>
            )}
          </AsyncBox>
        </div>
      ) : null}
      {tab === 'balances' ? (
        <div className="glass-card rounded-3xl p-6">
          <div className="flex items-center justify-between gap-3 flex-wrap mb-4">
            <h3 className="font-bold text-sm text-[var(--text)]">Leave Balances · {leaveYearLabel}</h3>
            <div className="flex items-center gap-2">
              <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search paycode / name / type" className="px-3 py-2 rounded-xl bg-[var(--input-bg)] border border-[var(--border)] text-xs text-[var(--text)] outline-none focus:border-[var(--accent)] w-full sm:w-64" />
              <button type="button" onClick={exportBalances} disabled={!balanceRows.length} className="px-3.5 py-2 rounded-xl bg-white/5 border border-[var(--border)] text-[var(--text)] text-[11px] font-bold transition hover:bg-white/10 disabled:opacity-40"><i className="fas fa-file-csv mr-1"></i>Export CSV</button>
            </div>
          </div>
          <AsyncBox loading={balances.loading} error={balances.error} onRetry={balances.reload} label="Balances load ho rahe hain...">
            {balanceRows.length ? (
              <div className="overflow-x-auto">
                <table className="portal-table">
                  <thead><tr><th>Paycode</th><th>Employee</th><th>Leave Year</th><th>Leave Type</th><th>Opening Balance</th></tr></thead>
                  <tbody>
                    {balanceRows.map((b, i) => (
                      <tr key={i}><td className="mono">{b.paycode}</td><td className="font-semibold">{b.empname}</td><td className="mono">{leaveYearLabel}</td><td>{typeName[b.leavetype] || b.leavetype}</td><td className="font-bold">{b.openingBalance}</td></tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <p className="text-xs text-[var(--muted)] py-6 text-center">Koi leave balance data nahi (HR Excel import ke baad dikhega).</p>
            )}
          </AsyncBox>
        </div>
      ) : null}

      {tab === 'import' ? (
        <div className="glass-card rounded-3xl p-6">
          <h3 className="font-bold text-base text-[var(--text)] flex items-center gap-2 mb-4"><i className="fas fa-file-excel text-teal-400"></i> Excel Import — Opening Balances</h3>
          <ExcelImport
            title="Leave Opening Balances"
            endpoint="/hr/leave/balances/import"
            templateFilename="leave-opening-balances-template.xlsx"
            columns={LEAVE_COLUMNS}
            hint="EmployeeCode = HR ka external/Navision code (khud bharein; ye Savior me lookup nahi hota). BiometricCode auto-populated hota hai aur usi se employee resolve hota hai. LeaveYear = financial year YYYY-YYYY (e.g. 2026-2027). LeaveType configured hona chahiye (PL/SL/CL/OLA/OLB/CO). OpeningBalance number >= 0."
            templateRowsProvider={async () => {
              const data = await apiFetch('/hr/leave/import-template');
              const employees = Array.isArray(data?.employees) ? data.employees : [];
              const leaveTypes = (Array.isArray(data?.leaveTypes) && data.leaveTypes.length) ? data.leaveTypes : ['PL', 'SL', 'CL', 'OLA', 'OLB', 'CO'];
              const leaveYear = data?.leaveYear || '';
              const header = LEAVE_COLUMNS.map((c) => c.key);
              const rows = [header];
              for (const e of employees) {
                for (const lt of leaveTypes) {
                  rows.push(['', String(e.presentcardno || ''), String(e.empname || ''), String(e.companycode || ''), leaveYear, String(lt), '']);
                }
              }
              return rows;
            }}
            onImported={balances.reload}
          />
        </div>
      ) : null}

      {tab === 'rules' ? (
        <div className="space-y-4">
          <div className="glass-card rounded-3xl p-6">
            <h3 className="font-bold text-sm text-[var(--text)] mb-4">Leave Types</h3>
            <AsyncBox loading={types.loading} error={types.error} onRetry={types.reload} label="Leave types load ho rahe hain...">
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

          <div className="glass-card rounded-3xl p-6">
            <h3 className="font-bold text-sm text-[var(--text)] mb-4">Company Rules</h3>
            <AsyncBox loading={config.loading} error={config.error} onRetry={config.reload} label="Company rules load ho rahe hain...">
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                <div className="p-4 rounded-2xl bg-white/5 border border-white/5">
                  <p className="text-[10px] uppercase font-bold text-[var(--muted)] mb-2">Allow requests beyond available balance</p>
                  <p className="text-sm font-bold text-[var(--text)]">{cfg.allowNegativeBalance ? 'Yes' : 'No'}</p>
                </div>
                <div className="p-4 rounded-2xl bg-white/5 border border-white/5">
                  <p className="text-[10px] uppercase font-bold text-[var(--muted)] mb-2">Maximum backdated leave (days)</p>
                  <p className="text-sm font-bold text-[var(--text)]">{cfg.maxBackdateDays ?? '—'}</p>
                </div>
                <div className="p-4 rounded-2xl bg-white/5 border border-white/5">
                  <p className="text-[10px] uppercase font-bold text-[var(--muted)] mb-2">Attachment required above (days)</p>
                  <p className="text-sm font-bold text-[var(--text)]">{cfg.attachmentRequiredAboveDays ?? '—'}</p>
                </div>
              </div>
            </AsyncBox>
          </div>
        </div>
      ) : null}
    </div>
  );
}
