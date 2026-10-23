'use client';

// web-next/components/hr/LeaveSection.jsx — Leave Management (HR Admin).
// Tabs: Leave Balances / Requests / Opening Balances / Excel Import / Types & Rules.
// Reuses the same backend the mobile app uses; no separate data source.

import { useMemo, useState, useEffect, useRef, useCallback } from 'react';
import useApiData from '../useApiData';
import AsyncBox from '../employee/AsyncBox';
import apiFetch from '../../lib/api';
import { prettyDate } from '../../lib/format';
import ExcelImport from './ExcelImport';
import { LEAVE_COLUMNS, downloadCsv } from '../../lib/excelImport';
import { HrCan } from './HrAccess';

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
function fyLabelFromStart(start) {
  const s = Number(start) || new Date().getFullYear();
  return `${s}-${s + 1}`;
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
  const [tab, setTab] = useState('balances');
  const [fy, setFy] = useState(currentFyLabel());
  const [statusFilter, setStatusFilter] = useState('Pending');
  const [search, setSearch] = useState('');
  const [busyId, setBusyId] = useState(null);
  const [msg, setMsg] = useState('');

  // Leave Balances detail modal.
  const [detailEmp, setDetailEmp] = useState(null);

  // Opening Balances form + table search + employee picker.
  const [obModal, setObModal] = useState(null);
  const [obForm, setObForm] = useState({ paycode: '', employeecode: '', leaveyear: currentFyLabel(), leavetype: '', openingbalance: '' });
  const [obBusy, setObBusy] = useState(false);
  const [obMsg, setObMsg] = useState(null);
  const [obSearch, setObSearch] = useState('');
  const [empQuery, setEmpQuery] = useState('');
  const [employees, setEmployees] = useState([]);
  const employeesLoaded = useRef(false);

  // Types & Rules management.
  const [typeForm, setTypeForm] = useState({ leavetype: '', typename: '', sortorder: '' });
  const [typeBusy, setTypeBusy] = useState(false);
  const [typeMsg, setTypeMsg] = useState(null);
  const [typeAction, setTypeAction] = useState(null);

  const start = fyStart(fy);

  const types = useApiData('/hr/leave/types');
  const config = useApiData('/hr/leave/config');
  const requests = useApiData(`/hr/leave/requests?leaveyear=${start}`);
  const balances = useApiData(`/hr/leave/balances?leaveyear=${fy}`);
  const openingBalances = useApiData(`/hr/leave/opening-balances?leaveyear=${fy}`);

  const typeList = types.data?.types || [];
  const typeName = {};
  typeList.forEach((t) => { typeName[t.leavetype] = t.typename || t.leavetype; });
  const activeTypes = typeList.filter((t) => t.active !== false);
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
  const filteredEmp = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return empList;
    return empList.filter((e) => [e.paycode, e.empname, e.employeecode, e.companycode].join(' ').toLowerCase().includes(q));
  }, [empList, search]);

  const leaveYearLabel = balances.data?.leaveyear || fy;
  const pendingCount = allReq.filter((r) => r.status === 'Pending').length;
  const approvedCount = allReq.filter((r) => r.status === 'Approved').length;

  const obRows = openingBalances.data?.rows || [];
  const filteredObRows = useMemo(() => {
    const q = obSearch.trim().toLowerCase();
    if (!q) return obRows;
    return obRows.filter((r) => [r.paycode, r.empname, r.employeecode, r.leavetype, typeName[r.leavetype]].join(' ').toLowerCase().includes(q));
  }, [obRows, obSearch, typeName]);

  const loadEmployees = useCallback(async () => {
    if (employeesLoaded.current) return;
    employeesLoaded.current = true;
    try {
      const data = await apiFetch('/hr/leave/employees');
      setEmployees(Array.isArray(data?.employees) ? data.employees : []);
    } catch { /* picker may stay empty; manual paycode still allowed */ }
  }, []);

  useEffect(() => { if (obModal) loadEmployees(); }, [obModal, loadEmployees]);

  const empOptions = useMemo(() => {
    const q = empQuery.trim().toLowerCase();
    if (!q) return employees.slice(0, 50);
    return employees.filter((e) => [e.paycode, e.empname, e.companycode].join(' ').toLowerCase().includes(q)).slice(0, 50);
  }, [employees, empQuery]);
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
    if (!filteredEmp.length) return;
    downloadCsv('leave-balances.csv', [
      ['Leave Year', 'Employee Code', 'Paycode', 'Biometric Code', 'Employee Name', 'Company Code', 'Total Available'],
      ...filteredEmp.map((e) => [leaveYearLabel, e.employeecode || '', e.paycode, e.presentcardno || '', e.empname, e.companycode || '', e.totalAvailable ?? '']),
    ]);
  }

  function openAddOb() {
    setObMsg(null);
    setEmpQuery('');
    setObForm({ paycode: '', employeecode: '', leaveyear: currentFyLabel(), leavetype: activeTypes[0]?.leavetype || '', openingbalance: '' });
    setObModal({ mode: 'add' });
  }
  function openEditOb(row) {
    setObMsg(null);
    setEmpQuery('');
    setObForm({ paycode: row.paycode, employeecode: row.employeecode || '', leaveyear: fyLabelFromStart(row.leaveyear), leavetype: row.leavetype, openingbalance: String(row.openingBalance ?? '') });
    setObModal({ mode: 'edit', row });
  }
  async function saveOb(e) {
    e.preventDefault();
    setObBusy(true);
    setObMsg(null);
    try {
      const res = await apiFetch('/hr/leave/opening-balances', {
        method: 'POST',
        body: { paycode: obForm.paycode, employeecode: obForm.employeecode, leaveyear: obForm.leaveyear, leavetype: obForm.leavetype, openingbalance: obForm.openingbalance },
      });
      setObMsg({ ok: true, text: res?.openingBalance?.created ? 'Opening balance add ho gaya.' : 'Opening balance update ho gaya.' });
      setObModal(null);
      openingBalances.reload();
      balances.reload();
    } catch (err) {
      setObMsg({ ok: false, text: err?.message || 'Save failed.' });
    } finally {
      setObBusy(false);
    }
  }
  async function deleteOb(row) {
    if (!window.confirm(`Delete opening balance: ${row.empname} (${row.paycode}) · ${typeName[row.leavetype] || row.leavetype} · ${fyLabelFromStart(row.leaveyear)}?`)) return;
    setObBusy(true);
    setObMsg(null);
    try {
      await apiFetch(`/hr/leave/opening-balances/${row.id}`, { method: 'DELETE' });
      setObMsg({ ok: true, text: 'Opening balance delete ho gaya.' });
      openingBalances.reload();
      balances.reload();
    } catch (err) {
      setObMsg({ ok: false, text: err?.message || 'Delete failed.' });
    } finally {
      setObBusy(false);
    }
  }
  async function addType(e) {
    e.preventDefault();
    setTypeBusy(true);
    setTypeMsg(null);
    try {
      await apiFetch('/hr/leave/types', { method: 'POST', body: { leavetype: typeForm.leavetype, typename: typeForm.typename, sortorder: typeForm.sortorder } });
      setTypeForm({ leavetype: '', typename: '', sortorder: '' });
      setTypeMsg({ ok: true, text: 'Leave type add ho gaya.' });
      types.reload();
    } catch (err) {
      setTypeMsg({ ok: false, text: err?.message || 'Add failed.' });
    } finally {
      setTypeBusy(false);
    }
  }
  async function toggleType(t, active) {
    setTypeAction(t.leavetype);
    setTypeMsg(null);
    try {
      await apiFetch(`/hr/leave/types/${encodeURIComponent(t.leavetype)}/status`, { method: 'POST', body: { active } });
      setTypeMsg({ ok: true, text: `Leave type ${active ? 'activate' : 'deactivate'} ho gaya.` });
      types.reload();
    } catch (err) {
      setTypeMsg({ ok: false, text: err?.message || 'Update failed.' });
    } finally {
      setTypeAction(null);
    }
  }
  async function deleteType(t) {
    if (!window.confirm(`Delete leave type "${t.leavetype}" permanently? Agar ye historical data me used hai to server delete block karega — deactivate safer hoga.`)) return;
    setTypeAction(t.leavetype);
    setTypeMsg(null);
    try {
      await apiFetch(`/hr/leave/types/${encodeURIComponent(t.leavetype)}`, { method: 'DELETE' });
      setTypeMsg({ ok: true, text: 'Leave type delete ho gaya.' });
      types.reload();
    } catch (err) {
      setTypeMsg({ ok: false, text: err?.message || 'Delete failed.' });
    } finally {
      setTypeAction(null);
    }
  }

  const tabClass = (active) => `px-3.5 py-1.5 rounded-xl text-[11px] font-bold transition ${active ? 'bg-indigo-600 text-white' : 'bg-white/5 border border-[var(--border)] text-[var(--text)] hover:bg-white/10'}`;
  const inputCls = 'px-3 py-2 rounded-xl bg-[var(--input-bg)] border border-[var(--border)] text-xs text-[var(--text)] outline-none focus:border-[var(--accent)] w-full';
  const btnGhost = 'px-3 py-2 rounded-xl bg-white/5 border border-[var(--border)] text-[var(--text)] text-[11px] font-bold transition hover:bg-white/10 disabled:opacity-40';

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
          {[['balances', 'Leave Balances'], ['requests', 'Requests'], ['opening', 'Opening Balances'], ['import', 'Excel Import'], ['rules', 'Types & Rules']].map(([id, label]) => (
            <button key={id} type="button" onClick={() => setTab(id)} className={tabClass(tab === id)}>{label}</button>
          ))}
        </div>
      </div>
      {tab === 'balances' ? (
        <div className="glass-card rounded-3xl p-6">
          <div className="flex items-center justify-between gap-3 flex-wrap mb-4">
            <h3 className="font-bold text-sm text-[var(--text)]">Leave Balances · {leaveYearLabel}</h3>
            <div className="flex items-center gap-2">
              <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search name / code / paycode" className="px-3 py-2 rounded-xl bg-[var(--input-bg)] border border-[var(--border)] text-xs text-[var(--text)] outline-none focus:border-[var(--accent)] w-full sm:w-64" />
              <HrCan module="leave" action="export">
                <button type="button" onClick={exportBalances} disabled={!filteredEmp.length} className={btnGhost}><i className="fas fa-file-csv mr-1"></i>Export CSV</button>
              </HrCan>
            </div>
          </div>
          <AsyncBox loading={balances.loading} error={balances.error} onRetry={balances.reload} label="Balances load ho rahe hain...">
            {filteredEmp.length ? (
              <div className="overflow-x-auto">
                <table className="portal-table">
                  <thead><tr><th>Employee Name</th><th>Employee Code</th><th>Paycode</th><th>Leave Year</th><th>Total Available</th><th className="text-center">Action</th></tr></thead>
                  <tbody>
                    {filteredEmp.map((e) => (
                      <tr key={e.paycode}>
                        <td className="font-semibold">{e.empname}</td>
                        <td className="mono">{e.employeecode || '—'}</td>
                        <td><button type="button" onClick={() => setDetailEmp(e)} className="mono text-indigo-300 underline decoration-dotted hover:text-indigo-200 transition">{e.paycode}</button></td>
                        <td className="mono">{leaveYearLabel}</td>
                        <td className="font-bold">{e.totalAvailable ?? 0}</td>
                        <td className="text-center"><button type="button" onClick={() => setDetailEmp(e)} className="px-2.5 py-1 rounded-lg bg-white/5 border border-[var(--border)] text-[var(--text)] text-[11px] font-bold transition hover:bg-white/10"><i className="fas fa-eye mr-1"></i>View Details</button></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <p className="text-xs text-[var(--muted)] py-6 text-center">Koi leave balance data nahi (Opening Balances / Excel import ke baad dikhega).</p>
            )}
          </AsyncBox>
        </div>
      ) : null}
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
                              <HrCan module="leave" action="approve">
                                <button type="button" onClick={() => decide(r.id, 'Approved')} disabled={busyId === r.id} className="px-2.5 py-1 rounded-lg bg-emerald-500/15 border border-emerald-500/30 text-emerald-300 hover:bg-emerald-500/25 text-[11px] font-bold transition disabled:opacity-50">{busyId === r.id ? <i className="fas fa-spinner fa-spin mr-1"></i> : <i className="fas fa-check mr-1"></i>}Approve</button>
                              </HrCan>
                              <HrCan module="leave" action="approve">
                                <button type="button" onClick={() => decide(r.id, 'Rejected')} disabled={busyId === r.id} className="px-2.5 py-1 rounded-lg bg-rose-500/15 border border-rose-500/30 text-rose-300 hover:bg-rose-500/25 text-[11px] font-bold transition disabled:opacity-50"><i className="fas fa-xmark mr-1"></i>Reject</button>
                              </HrCan>
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
      {tab === 'opening' ? (
        <div className="glass-card rounded-3xl p-6">
          <div className="flex items-center justify-between gap-3 flex-wrap mb-4">
            <h3 className="font-bold text-sm text-[var(--text)]">Opening Balances · {openingBalances.data?.leaveyear || fy}</h3>
            <div className="flex items-center gap-2">
              <input value={obSearch} onChange={(e) => setObSearch(e.target.value)} placeholder="Search code / paycode / name / type" className="px-3 py-2 rounded-xl bg-[var(--input-bg)] border border-[var(--border)] text-xs text-[var(--text)] outline-none focus:border-[var(--accent)] w-full sm:w-64" />
              <HrCan module="leave" action="create">
                <button type="button" onClick={openAddOb} className="px-4 py-2 rounded-xl bg-indigo-600 text-white text-[11px] font-bold transition hover:bg-indigo-500"><i className="fas fa-plus mr-1"></i>Add Opening Balance</button>
              </HrCan>
            </div>
          </div>
          {obMsg ? <p className={`text-xs mb-3 px-3 py-2 rounded-xl border ${obMsg.ok ? 'text-emerald-300 bg-emerald-500/10 border-emerald-500/20' : 'text-rose-300 bg-rose-500/10 border-rose-500/20'}`}>{obMsg.text}</p> : null}
          <AsyncBox loading={openingBalances.loading} error={openingBalances.error} onRetry={openingBalances.reload} label="Opening balances load ho rahe hain...">
            {filteredObRows.length ? (
              <div className="overflow-x-auto">
                <table className="portal-table">
                  <thead><tr><th>Employee Code</th><th>Paycode</th><th>Employee Name</th><th>Leave Year</th><th>Leave Type</th><th>Opening Balance</th><th className="text-center">Actions</th></tr></thead>
                  <tbody>
                    {filteredObRows.map((r) => (
                      <tr key={r.id}>
                        <td className="mono">{r.employeecode || '—'}</td>
                        <td className="mono">{r.paycode}</td>
                        <td className="font-semibold">{r.empname}</td>
                        <td className="mono">{fyLabelFromStart(r.leaveyear)}</td>
                        <td>{r.typename || typeName[r.leavetype] || r.leavetype}</td>
                        <td className="font-bold">{r.openingBalance}</td>
                        <td className="text-center">
                          <div className="flex justify-center gap-1.5">
                            <HrCan module="leave" action="edit">
                              <button type="button" onClick={() => openEditOb(r)} disabled={obBusy} className="px-2.5 py-1 rounded-lg bg-sky-500/15 border border-sky-500/30 text-sky-300 hover:bg-sky-500/25 text-[11px] font-bold transition disabled:opacity-50"><i className="fas fa-pen mr-1"></i>Edit</button>
                            </HrCan>
                            <HrCan module="leave" action="delete">
                              <button type="button" onClick={() => deleteOb(r)} disabled={obBusy} className="px-2.5 py-1 rounded-lg bg-rose-500/15 border border-rose-500/30 text-rose-300 hover:bg-rose-500/25 text-[11px] font-bold transition disabled:opacity-50"><i className="fas fa-trash mr-1"></i>Delete</button>
                            </HrCan>
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <p className="text-xs text-[var(--muted)] py-6 text-center">Koi opening balance entry nahi. Add button se single entry add karein ya Excel Import se bulk import karein.</p>
            )}
          </AsyncBox>
        </div>
      ) : null}
      {tab === 'import' ? (
        <HrCan module="leave" action="import">
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
            onImported={() => { openingBalances.reload(); balances.reload(); }}
          />
        </div>
        </HrCan>
      ) : null}
      {tab === 'rules' ? (
        <div className="space-y-4">
          <div className="glass-card rounded-3xl p-6">
            <h3 className="font-bold text-sm text-[var(--text)] mb-4">Leave Types</h3>
            {typeMsg ? <p className={`text-xs mb-3 px-3 py-2 rounded-xl border ${typeMsg.ok ? 'text-emerald-300 bg-emerald-500/10 border-emerald-500/20' : 'text-rose-300 bg-rose-500/10 border-rose-500/20'}`}>{typeMsg.text}</p> : null}
            <AsyncBox loading={types.loading} error={types.error} onRetry={types.reload} label="Leave types load ho rahe hain...">
              {typeList.length ? (
                <div className="overflow-x-auto">
                  <table className="portal-table">
                    <thead><tr><th>Code</th><th>Name</th><th>Sort</th><th>Active</th><th className="text-center">Actions</th></tr></thead>
                    <tbody>
                      {typeList.map((t) => (
                        <tr key={t.leavetype}>
                          <td className="mono">{t.leavetype}</td>
                          <td>{t.typename}</td>
                          <td>{t.sortorder}</td>
                          <td>{t.active !== false ? <span className="badge badge--present">Active</span> : <span className="badge badge--neutral">Inactive</span>}</td>
                          <td className="text-center">
                            <div className="flex justify-center gap-1.5">
                            <HrCan module="leave" action="edit">
                              <button type="button" onClick={() => toggleType(t, t.active === false)} disabled={typeAction === t.leavetype} className="px-2.5 py-1 rounded-lg bg-white/5 border border-[var(--border)] text-[var(--text)] text-[11px] font-bold transition hover:bg-white/10 disabled:opacity-50">{typeAction === t.leavetype ? <i className="fas fa-spinner fa-spin mr-1"></i> : null}{t.active !== false ? 'Deactivate' : 'Activate'}</button>
                            </HrCan>
                            <HrCan module="leave" action="delete">
                              <button type="button" onClick={() => deleteType(t)} disabled={typeAction === t.leavetype} className="px-2.5 py-1 rounded-lg bg-rose-500/15 border border-rose-500/30 text-rose-300 hover:bg-rose-500/25 text-[11px] font-bold transition disabled:opacity-50"><i className="fas fa-trash mr-1"></i>Delete</button>
                            </HrCan>
                            </div>
                          </td>
                        </tr>
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
            <h3 className="font-bold text-sm text-[var(--text)] mb-4">Add Leave Type</h3>
            <form onSubmit={addType} className="grid grid-cols-1 sm:grid-cols-4 gap-3 items-end">
              <div><label className="block text-[10px] uppercase font-bold text-[var(--muted)] mb-1">Code</label><input value={typeForm.leavetype} onChange={(e) => setTypeForm({ ...typeForm, leavetype: e.target.value })} required className={inputCls} placeholder="e.g. ML" /></div>
              <div><label className="block text-[10px] uppercase font-bold text-[var(--muted)] mb-1">Name</label><input value={typeForm.typename} onChange={(e) => setTypeForm({ ...typeForm, typename: e.target.value })} required className={inputCls} placeholder="Maternity Leave" /></div>
              <div><label className="block text-[10px] uppercase font-bold text-[var(--muted)] mb-1">Sort Order</label><input value={typeForm.sortorder} onChange={(e) => setTypeForm({ ...typeForm, sortorder: e.target.value })} className={inputCls} placeholder="10" /></div>
              <HrCan module="leave" action="create">
                <button type="submit" disabled={typeBusy} className="px-4 py-2 rounded-xl bg-indigo-600 text-white text-[11px] font-bold transition hover:bg-indigo-500 disabled:opacity-50">{typeBusy ? <i className="fas fa-spinner fa-spin mr-1"></i> : <i className="fas fa-plus mr-1"></i>}Add Type</button>
              </HrCan>
            </form>
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

      {detailEmp ? (
        <div className="fixed inset-0 z-50 flex items-start justify-center bg-black/60 p-4 overflow-y-auto" onClick={() => setDetailEmp(null)}>
          <div className="w-full max-w-2xl glass-card rounded-3xl p-6 my-8" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-start justify-between gap-3 mb-4">
              <div>
                <h3 className="font-bold text-base text-[var(--text)]">{detailEmp.empname}</h3>
                <p className="text-xs text-[var(--muted)] mono mt-1">{detailEmp.paycode}{detailEmp.employeecode ? ` · ${detailEmp.employeecode}` : ''}{detailEmp.companycode ? ` · ${detailEmp.companycode}` : ''}</p>
              </div>
              <button type="button" onClick={() => setDetailEmp(null)} className="px-2.5 py-1.5 rounded-lg bg-white/5 border border-[var(--border)] text-[var(--text)] text-xs font-bold transition hover:bg-white/10"><i className="fas fa-xmark"></i></button>
            </div>
            <p className="text-xs text-[var(--muted)] mb-4">Leave Year <span className="mono text-[var(--text)]">{leaveYearLabel}</span> · Total Available <span className="font-bold text-[var(--text)]">{detailEmp.totalAvailable ?? 0}</span></p>
            <div className="overflow-x-auto">
              <table className="portal-table">
                <thead><tr><th>Leave Type</th><th>Opening Balance</th><th>Approved / Used</th><th>Pending</th><th>Available</th></tr></thead>
                <tbody>
                  {(detailEmp.types || []).map((t) => (
                    <tr key={t.leavetype}>
                      <td><strong>{t.typename || typeName[t.leavetype] || t.leavetype}</strong>{t.active === false ? <span className="badge badge--neutral ml-2">Inactive</span> : null}</td>
                      <td>{t.openingBalance ?? 0}</td>
                      <td>{t.approvedUsed ?? 0}</td>
                      <td>{t.pending ?? 0}</td>
                      <td className="font-bold">{t.availableBalance ?? 0}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      ) : null}
      {obModal ? (
        <div className="fixed inset-0 z-50 flex items-start justify-center bg-black/60 p-4 overflow-y-auto" onClick={() => { if (!obBusy) setObModal(null); }}>
          <div className="w-full max-w-lg glass-card rounded-3xl p-6 my-8" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between gap-3 mb-4">
              <h3 className="font-bold text-base text-[var(--text)]">{obModal.mode === 'edit' ? 'Edit Opening Balance' : 'Add Opening Balance'}</h3>
              <button type="button" onClick={() => setObModal(null)} disabled={obBusy} className="px-2.5 py-1.5 rounded-lg bg-white/5 border border-[var(--border)] text-[var(--text)] text-xs font-bold transition hover:bg-white/10"><i className="fas fa-xmark"></i></button>
            </div>
            {obMsg ? <p className={`text-xs mb-3 px-3 py-2 rounded-xl border ${obMsg.ok ? 'text-emerald-300 bg-emerald-500/10 border-emerald-500/20' : 'text-rose-300 bg-rose-500/10 border-rose-500/20'}`}>{obMsg.text}</p> : null}
            <form onSubmit={saveOb} className="space-y-3">
              <div>
                <label className="block text-[10px] uppercase font-bold text-[var(--muted)] mb-1">Employee (search / select)</label>
                <input value={empQuery} onChange={(e) => setEmpQuery(e.target.value)} placeholder="Search by name / paycode..." className={inputCls} />
                {obForm.paycode ? (
                  <p className="text-xs text-emerald-300 mt-1">Selected: <span className="mono">{obForm.paycode}</span></p>
                ) : (
                  <div className="max-h-40 overflow-y-auto rounded-xl border border-[var(--border)] mt-1">
                    {empOptions.length ? empOptions.map((e) => (
                      <button key={e.paycode} type="button" onClick={() => { setObForm({ ...obForm, paycode: e.paycode, employeecode: e.employeecode || '' }); setEmpQuery(''); }} className="w-full text-left px-3 py-2 text-xs text-[var(--text)] hover:bg-white/5 transition">
                        <span className="font-semibold">{e.empname}</span> <span className="mono text-[var(--muted)]">({e.paycode})</span>{e.employeecode ? <span className="text-indigo-300"> · {e.employeecode}</span> : null}{e.companycode ? <span className="text-[var(--muted)]"> · {e.companycode}</span> : null}
                      </button>
                    )) : <p className="px-3 py-2 text-xs text-[var(--muted)]">Koi employee nahi mila — search karein.</p>}
                  </div>
                )}
              </div>
              <div>
                <label className="block text-[10px] uppercase font-bold text-[var(--muted)] mb-1">Employee Code</label>
                <input value={obForm.employeecode} onChange={(e) => setObForm({ ...obForm, employeecode: e.target.value })} placeholder="Employee Code (optional — Paycode se alag)" className={inputCls} />
                <p className="text-[10px] text-[var(--muted)] mt-1">Employee Code (external/HR code) Paycode se alag hota hai. Master me available ho to select karte hi auto-fill hoga; warna manually enter karein. Khali chhodne par blank rahega.</p>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                <div><label className="block text-[10px] uppercase font-bold text-[var(--muted)] mb-1">Leave Year</label><input value={obForm.leaveyear} onChange={(e) => setObForm({ ...obForm, leaveyear: e.target.value })} required placeholder="2026-2027" className={inputCls} /></div>
                <div><label className="block text-[10px] uppercase font-bold text-[var(--muted)] mb-1">Leave Type</label><select value={obForm.leavetype} onChange={(e) => setObForm({ ...obForm, leavetype: e.target.value })} required className={inputCls}>{!obForm.leavetype ? <option value="">Select…</option> : null}{activeTypes.map((t) => <option key={t.leavetype} value={t.leavetype}>{t.leavetype} · {t.typename}</option>)}</select></div>
                <div><label className="block text-[10px] uppercase font-bold text-[var(--muted)] mb-1">Opening Balance</label><input value={obForm.openingbalance} onChange={(e) => setObForm({ ...obForm, openingbalance: e.target.value })} required type="number" min="0" step="0.5" placeholder="10" className={inputCls} /></div>
              </div>
              <div className="flex justify-end gap-2 pt-2">
                <button type="button" onClick={() => setObModal(null)} disabled={obBusy} className={btnGhost}>Cancel</button>
                <button type="submit" disabled={obBusy} className="px-5 py-2 rounded-xl bg-indigo-600 text-white text-[11px] font-bold transition hover:bg-indigo-500 disabled:opacity-50">{obBusy ? <i className="fas fa-spinner fa-spin mr-1"></i> : <i className="fas fa-check mr-1"></i>}Save</button>
              </div>
            </form>
          </div>
        </div>
      ) : null}
    </div>
  );
}