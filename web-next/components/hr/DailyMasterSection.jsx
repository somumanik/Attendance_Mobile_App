'use client';

// web-next/components/hr/DailyMasterSection.jsx — Daily Master Report (full parity with index.html `hrDaily`).
// Real data: GET /api/hr/daily?fromDate=&toDate=&departmentcode=&companycode=  (array of punch rows).
// Preserves original filters (date range, dept, company), client-side pagination, export and Late badge.

import { useState } from 'react';
import useApiData from '../useApiData';
import AsyncBox from '../employee/AsyncBox';
import { isoToday } from '../../lib/format';
import { statusBadgeClass } from '../../lib/hr';

// Mirrors index.html `formatTime`: keep HH:MM for raw/ISO values.
function formatTime(val) {
  if (!val || val === '--') return '--';
  if (/^\d{1,2}:\d{2}(:\d{2})?$/.test(String(val))) return String(val).substring(0, 5);
  const isoMatch = String(val).match(/T(\d{2}:\d{2}:\d{2})/);
  if (isoMatch) return isoMatch[1].substring(0, 5);
  return String(val);
}

export default function DailyMasterSection() {
  const [fromDate, setFromDate] = useState(isoToday());
  const [toDate, setToDate] = useState(isoToday());
  const [dept, setDept] = useState('All');
  const [company, setCompany] = useState('');
  const [pageSize, setPageSize] = useState(50);
  const [page, setPage] = useState(1);

  const filters = useApiData('/hr/filters');
  const f = filters.data || {};

  const params = new URLSearchParams({ fromDate, toDate });
  if (dept && dept !== 'All') params.set('departmentcode', dept);
  if (company && company !== 'All') params.set('companycode', company);
  const { data, error, loading, reload } = useApiData(`/hr/daily?${params.toString()}`, [fromDate, toDate, dept, company]);

  const rows = Array.isArray(data) ? data : [];
  const totalPages = Math.max(1, Math.ceil(rows.length / pageSize));
  const safePage = Math.min(page, totalPages);
  const start = (safePage - 1) * pageSize;
  const pageRows = rows.slice(start, start + pageSize);

  const deptMap = {};
  (f.departments || []).forEach((d) => { deptMap[d.code] = d.name || d.code; });

  function clearFilters() {
    setFromDate(isoToday());
    setToDate(isoToday());
    setDept('All');
    setCompany('');
    setPageSize(50);
    setPage(1);
  }

  function exportCSV() {
    const header = ['Paycode', 'Name', 'Department', 'In', 'Out', 'Hours', 'Status'];
    const lines = rows.map((r) => [
      r.paycode,
      r.empname,
      deptMap[r.departmentcode] || r.departmentcode || '',
      formatTime(r.in1 || r.inTime),
      formatTime(r.out1 || r.out2 || r.outTime),
      r.hoursworked ?? r.hrs ?? '',
      r.computedStatus || r.statusLabel || r.status || 'A',
    ]);
    const csv = [header, ...lines].map((row) => row.map((v) => `"${String(v == null ? '' : v).replace(/"/g, '""')}"`).join(',')).join('\r\n');
    const blob = new Blob(['\uFEFF' + csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `daily-master-${fromDate}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  return (
    <div className="glass-card rounded-3xl p-6">
      <div className="flex flex-wrap items-center justify-between gap-4 mb-6 pb-4 border-b border-[var(--border)]">
        <div>
          <h3 className="font-bold text-base text-[var(--text)] flex items-center gap-2">
            <i className="fas fa-calendar-day text-rose-400"></i> Daily Master Report
          </h3>
          <p className="text-xs text-[var(--muted)]">Punching logs of all employees for any date or date range</p>
        </div>
        <button type="button" onClick={exportCSV} className="px-4 py-2 rounded-xl bg-emerald-600/20 border border-emerald-500/30 text-emerald-300 hover:bg-emerald-600/30 text-xs font-bold transition">
          <i className="fas fa-file-csv mr-1"></i>Export
        </button>
      </div>

      <div className="flex flex-wrap items-end gap-4 mb-4 p-4 rounded-2xl bg-white/5 border border-[var(--border)]">
        <div className="flex flex-col gap-1 min-w-[160px]">
          <label className="text-[10px] uppercase font-bold text-[var(--muted)]">From Date</label>
          <input type="date" value={fromDate} onChange={(e) => { setFromDate(e.target.value); setPage(1); }} className="bg-[var(--input-bg)] border border-[var(--border)] rounded-xl px-3 py-2 text-xs text-[var(--text)] outline-none focus:border-[var(--accent)]" />
        </div>
        <div className="flex flex-col gap-1 min-w-[160px]">
          <label className="text-[10px] uppercase font-bold text-[var(--muted)]">To Date</label>
          <input type="date" value={toDate} onChange={(e) => { setToDate(e.target.value); setPage(1); }} className="bg-[var(--input-bg)] border border-[var(--border)] rounded-xl px-3 py-2 text-xs text-[var(--text)] outline-none focus:border-[var(--accent)]" />
        </div>
        <div className="flex flex-col gap-1 min-w-[160px]">
          <label className="text-[10px] uppercase font-bold text-[var(--muted)]">Department</label>
          <select value={dept} onChange={(e) => { setDept(e.target.value); setPage(1); }} className="bg-[var(--input-bg)] border border-[var(--border)] rounded-xl px-3 py-2 text-xs text-[var(--text)] outline-none focus:border-[var(--accent)]">
            <option value="All">All Departments</option>
            {(f.departments || []).map((d) => (<option key={d.code} value={d.code}>{d.name || d.code}</option>))}
          </select>
        </div>
        <div className="flex flex-col gap-1 min-w-[160px]">
          <label className="text-[10px] uppercase font-bold text-[var(--muted)]">Company</label>
          <select value={company} onChange={(e) => { setCompany(e.target.value); setPage(1); }} className="bg-[var(--input-bg)] border border-[var(--border)] rounded-xl px-3 py-2 text-xs text-[var(--text)] outline-none focus:border-[var(--accent)]">
            <option value="">All Companies</option>
            {(f.companies || []).map((c) => (<option key={c.code} value={c.code}>{c.name || c.code}</option>))}
          </select>
        </div>
        <div className="flex flex-col gap-1">
          <button type="button" onClick={reload} className="px-4 py-2 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-bold transition h-10">Fetch DB</button>
        </div>
        <div className="flex flex-col gap-1">
          <button type="button" onClick={clearFilters} className="px-4 py-2 rounded-xl bg-rose-600/20 border border-rose-500/30 text-rose-300 hover:bg-rose-600/30 text-xs font-bold transition h-10">
            <i className="fas fa-filter-circle-xmark mr-1"></i>Clear Filters
          </button>
        </div>
      </div>

      <AsyncBox loading={loading} error={error} onRetry={reload} label="Daily Master data load ho raha hai...">
        {rows.length ? (
          <>
            <div className="flex flex-wrap items-center justify-between gap-3 mt-4 mb-3 p-3 rounded-xl bg-white/5 border border-[var(--border)]">
              <div className="flex items-center gap-2">
                <span className="text-xs text-[var(--muted)]">Show</span>
                <select value={pageSize} onChange={(e) => { setPageSize(parseInt(e.target.value, 10)); setPage(1); }} className="bg-[var(--input-bg)] border border-[var(--border)] rounded-xl px-2 py-1 text-xs text-[var(--text)] outline-none focus:border-[var(--accent)]">
                  <option value={25}>25</option>
                  <option value={50}>50</option>
                  <option value={100}>100</option>
                </select>
                <span className="text-xs text-[var(--muted)]">per page</span>
              </div>
              <span className="text-xs text-[var(--muted)]">Page {safePage} of {totalPages} ({rows.length} employees)</span>
              <div className="flex items-center gap-1">
                <button type="button" onClick={() => setPage((p) => Math.max(1, p - 1))} disabled={safePage <= 1} className="px-3 py-1.5 rounded-lg bg-white/5 border border-[var(--border)] text-[var(--text)] text-xs font-bold transition disabled:opacity-50 disabled:cursor-not-allowed hover:bg-white/10">
                  <i className="fas fa-chevron-left"></i>
                </button>
                <button type="button" onClick={() => setPage((p) => Math.min(totalPages, p + 1))} disabled={safePage >= totalPages} className="px-3 py-1.5 rounded-lg bg-white/5 border border-[var(--border)] text-[var(--text)] text-xs font-bold transition disabled:opacity-50 disabled:cursor-not-allowed hover:bg-white/10">
                  <i className="fas fa-chevron-right"></i>
                </button>
              </div>
            </div>

            <div className="overflow-x-auto">
              <table className="portal-table">
                <thead>
                  <tr><th>ID</th><th>Name</th><th>Dept</th><th>In</th><th>Out</th><th>Worked</th><th>Status</th></tr>
                </thead>
                <tbody>
                  {pageRows.map((r, i) => {
                    const isLate = r.isLate || (r.latearrival && Number(r.latearrival) > 0);
                    const status = r.computedStatus || r.statusLabel || r.status || 'A';
                    return (
                      <tr key={i}>
                        <td className="mono text-[var(--accent-soft)]">{r.paycode}</td>
                        <td className="font-semibold">{r.empname}</td>
                        <td>{deptMap[r.departmentcode] || r.departmentcode || '—'}</td>
                        <td className="mono text-emerald-300">{formatTime(r.in1 || r.inTime)}</td>
                        <td className="mono text-rose-300">{formatTime(r.out1 || r.out2 || r.outTime)}</td>
                        <td className="font-semibold">{r.hoursworked ?? r.hrs ?? '--'}</td>
                        <td>
                          <div className="flex items-center gap-1.5">
                            <span className={`badge ${statusBadgeClass(status)}`}>{status}</span>
                            {isLate ? <span className="px-2 py-1 rounded-lg border border-indigo-500/30 bg-indigo-500/15 text-[10px] font-bold text-indigo-300">Late</span> : null}
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </>
        ) : (
          <p className="text-xs text-[var(--muted)] py-6 text-center">No attendance records found for the selected filters.</p>
        )}
      </AsyncBox>
    </div>
  );
}
