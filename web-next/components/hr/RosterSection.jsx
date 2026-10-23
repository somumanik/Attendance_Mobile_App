'use client';

// web-next/components/hr/RosterSection.jsx — All Employees Roster (full parity).

import { useEffect, useState } from 'react';
import useApiData from '../useApiData';
import AsyncBox from '../employee/AsyncBox';
import { prettyDate } from '../../lib/format';
import { HrCan } from './HrAccess';
import AuditModal from './AuditModal';

function Select({ label, value, onChange, options, placeholder }) {
  return (
    <select value={value} onChange={(e) => onChange(e.target.value)} className="bg-[var(--input-bg)] border border-[var(--border)] rounded-xl px-3 py-2 text-xs text-[var(--text)] outline-none focus:border-[var(--accent)]">
      <option value="">{placeholder}</option>
      {options.map((o) => (
        <option key={o.value} value={o.value}>{o.label}</option>
      ))}
    </select>
  );
}

export default function RosterSection() {
  const [search, setSearch] = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');
  const [dept, setDept] = useState('All');
  const [company, setCompany] = useState('');
  const [gender, setGender] = useState('');
  const [cat, setCat] = useState('');
  const [designation, setDesignation] = useState('');
  const [marital, setMarital] = useState('');
  const [active, setActive] = useState('Y');
  const [page, setPage] = useState(1);
  const [auditPaycode, setAuditPaycode] = useState(null);

  useEffect(() => {
    const t = setTimeout(() => { setDebouncedSearch(search); setPage(1); }, 250);
    return () => clearTimeout(t);
  }, [search]);

  const filters = useApiData('/hr/filters');
  const f = filters.data || {};

  const params = new URLSearchParams({ page: String(page), pageSize: '50' });
  if (debouncedSearch) params.set('search', debouncedSearch);
  if (company) params.set('companycode', company);
  if (dept && dept !== 'All') params.set('departmentcode', dept);
  if (gender) params.set('sex', gender);
  if (cat) params.set('cat', cat);
  if (designation) params.set('designation', designation);
  if (marital) params.set('ismarried', marital);
  if (active) params.set('active', active);
  const { data, error, loading, reload } = useApiData(`/employees?${params.toString()}`, [debouncedSearch, dept, company, gender, cat, designation, marital, active, page]);

  const rows = data?.rows || [];
  const total = Number(data?.total || 0);
  const totalPages = Math.max(1, Math.ceil(total / 50));

  function clearFilters() {
    setSearch(''); setDebouncedSearch(''); setDept('All'); setCompany(''); setGender('');
    setCat(''); setDesignation(''); setMarital(''); setActive('Y'); setPage(1);
  }

  function exportCSV() {
    const header = ['Paycode', 'Name', 'Department', 'Designation', 'DOB', 'DOJ', 'Present', 'Absent', 'Miss', 'Attendance%'];
    const lines = rows.map((e) => [e.paycode, e.empname, e.departmentname || e.departmentcode, e.designation, e.dateofbirth, e.dateofjoin,
      e.attendanceStats?.present || 0, e.attendanceStats?.absent || 0, e.attendanceStats?.miss || 0, attendancePct(e)]);
    const csv = [header, ...lines].map((r) => r.map((v) => `"${String(v == null ? '' : v).replace(/"/g, '""')}"`).join(',')).join('\r\n');
    const blob = new Blob(['\uFEFF' + csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = 'employees_roster.csv'; a.click();
    URL.revokeObjectURL(url);
  }

  function attendancePct(e) {
    const s = e.attendanceStats || {};
    const tot = Number(s.present || 0) + Number(s.absent || 0) + Number(s.miss || 0);
    return tot ? Math.round((Number(s.present || 0) / tot) * 100) : 0;
  }
  return (
    <div className="glass-card rounded-3xl p-6">
      <div className="flex flex-wrap items-center justify-between gap-4 mb-6 pb-4 border-b border-[var(--border)]">
        <div>
          <h3 className="font-bold text-base text-[var(--text)] flex items-center gap-2"><i className="fas fa-users text-indigo-400"></i> Complete Employees Roster</h3>
          <p className="text-xs text-[var(--muted)]">Employee status from real register rows (current month) — IN without OUT stays visible as Miss Punch</p>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <div className="relative">
            <i className="fas fa-search absolute left-3 top-2.5 text-[var(--muted)] text-xs"></i>
            <input type="text" value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search Name or ID..." className="bg-[var(--input-bg)] border border-[var(--border)] rounded-xl py-2 pl-9 pr-3 text-xs text-[var(--text)] placeholder-[var(--muted)] outline-none focus:border-[var(--accent)] w-44" />
          </div>
          <select value={dept} onChange={(e) => { setDept(e.target.value); setPage(1); }} className="bg-[var(--input-bg)] border border-[var(--border)] rounded-xl px-3 py-2 text-xs text-[var(--text)] outline-none focus:border-[var(--accent)]">
            <option value="All">All Departments</option>
            {(f.departments || []).map((d) => <option key={d.code} value={d.code}>{d.name || d.code}</option>)}
          </select>
          <Select label="Company" value={company} onChange={(v) => { setCompany(v); setPage(1); }} options={(f.companies || []).map((c) => ({ value: c.code, label: c.name || c.code }))} placeholder="All Companies" />
          <Select label="Gender" value={gender} onChange={(v) => { setGender(v); setPage(1); }} options={(f.genders || []).map((g) => ({ value: g, label: g === 'M' ? 'Male' : g === 'F' ? 'Female' : g }))} placeholder="All Genders" />
          <Select label="Category" value={cat} onChange={(v) => { setCat(v); setPage(1); }} options={(f.categories || []).map((c) => ({ value: c.code, label: c.name || c.code }))} placeholder="All Categories" />
          <Select label="Designation" value={designation} onChange={(v) => { setDesignation(v); setPage(1); }} options={(f.designations || []).map((d) => ({ value: d, label: d }))} placeholder="All Designations" />
          <Select label="Marital" value={marital} onChange={(v) => { setMarital(v); setPage(1); }} options={(f.maritalStatuses || []).map((m) => ({ value: m, label: m === 'Y' ? 'Married' : m === 'N' ? 'Unmarried' : m }))} placeholder="All Marital Statuses" />
          <Select label="Status" value={active} onChange={(v) => { setActive(v); setPage(1); }} options={(f.statuses || []).map((s) => ({ value: s, label: s === 'Y' ? 'Active' : s === 'N' ? 'Inactive' : s }))} placeholder="All Employee Statuses" />
          <button onClick={clearFilters} className="px-3.5 py-2 rounded-xl bg-indigo-600/20 border border-indigo-500/30 text-indigo-300 hover:bg-indigo-600/30 text-[11px] font-bold transition"><i className="fas fa-filter-circle-xmark mr-1"></i>Clear Filters</button>
          <HrCan module="employees" action="export">
            <button onClick={exportCSV} className="px-3.5 py-2 rounded-xl bg-emerald-600/20 border border-emerald-500/30 text-emerald-300 hover:bg-emerald-600/30 text-[11px] font-bold transition"><i className="fas fa-file-csv mr-1"></i>Export</button>
          </HrCan>
        </div>
      </div>
      <AsyncBox loading={loading} error={error} onRetry={reload} label="Roster load ho raha hai...">
        {rows.length ? (
          <>
            <div className="overflow-x-auto">
              <table className="portal-table">
                <thead><tr><th>ID</th><th>Name</th><th>Dept</th><th>Designation</th><th>DOB</th><th>DOJ</th><th>Present</th><th>Absent</th><th>Miss</th><th>%</th><th className="text-center">Action</th></tr></thead>
                <tbody>
                  {rows.map((e) => {
                    const s = e.attendanceStats || {};
                    const pct = attendancePct(e);
                    const barColor = pct >= 90 ? 'bg-emerald-500' : pct >= 75 ? 'bg-amber-500' : 'bg-rose-500';
                    return (
                      <tr key={e.paycode}>
                        <td className="mono">{e.paycode}</td>
                        <td>{e.empname}</td>
                        <td>{e.departmentname || e.departmentcode || '—'}</td>
                        <td>{e.designation || '—'}</td>
                        <td>{prettyDate(e.dateofbirth)}</td>
                        <td>{prettyDate(e.dateofjoin)}</td>
                        <td><span className="text-emerald-400 font-bold">{s.present || 0}</span></td>
                        <td><span className="text-rose-400 font-bold">{s.absent || 0}</span></td>
                        <td><span className="text-amber-400 font-bold">{s.miss || 0}</span></td>
                        <td>
                          <div className="flex items-center gap-2">
                            <div className="w-14 bg-white/10 rounded-full h-1.5"><div className={`${barColor} h-1.5 rounded-full`} style={{ width: `${pct}%` }}></div></div>
                            <span className="text-[var(--text)] text-[11px] font-bold">{pct}%</span>
                          </div>
                        </td>
                        <td className="text-center">
                          <button type="button" onClick={() => setAuditPaycode(e.paycode)} className="px-2.5 py-1 rounded-lg bg-indigo-500/15 border border-indigo-500/30 text-indigo-300 hover:bg-indigo-500/25 text-[11px] font-bold transition"><i className="fas fa-eye mr-1"></i>View</button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            <div className="flex items-center justify-between mt-4 text-xs text-[var(--muted)]">
              <span>Page {page} of {totalPages} ({total} employees)</span>
              <div className="flex gap-2">
                <button onClick={() => setPage((p) => Math.max(1, p - 1))} disabled={page <= 1} className="px-3 py-1.5 rounded-lg bg-white/5 border border-[var(--border)] disabled:opacity-40">Previous</button>
                <button onClick={() => setPage((p) => Math.min(totalPages, p + 1))} disabled={page >= totalPages} className="px-3 py-1.5 rounded-lg bg-white/5 border border-[var(--border)] disabled:opacity-40">Next</button>
              </div>
            </div>
          </>
        ) : (
          <p className="text-xs text-[var(--muted)] py-6 text-center">No employee matched.</p>
        )}
      </AsyncBox>
      {auditPaycode ? <AuditModal paycode={auditPaycode} onClose={() => setAuditPaycode(null)} /> : null}
    </div>
  );
}


