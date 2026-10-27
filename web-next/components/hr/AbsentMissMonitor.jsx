'use client';

// web-next/components/hr/AbsentMissMonitor.jsx
// "Company-wise Absent & Miss Punch Monitor" — the Master Reports date-wise
// absent/miss-punch drill-down surface. Reuses the existing scoped backend:
//   GET /api/hr/reports/absent-miss           KPIs + trend + company comparison
//   GET /api/hr/reports/absent-miss/employees drill-down (status + search + page)
//   GET /api/hr/reports/absent-miss/export    server-side .xlsx (same Export perm)
// The server applies company scope, the existing attendance classification, and
// the Holiday > Approved Leave > register precedence. This component only filters
// what it asks for — hiding a dropdown/button is never the security boundary.

import { useCallback, useMemo, useState } from 'react';
import AsyncBox from '../employee/AsyncBox';
import ChartCanvas from '../ChartCanvas';
import useApiData from '../useApiData';
import apiFetch from '../../lib/api';
import { isoToday, prettyDate, dayName } from '../../lib/format';
import { hoursText } from '../../lib/hr';
import { HrCan } from './HrAccess';

const inputCls = 'bg-[var(--input-bg)] border border-[var(--border)] rounded-xl px-3 py-2 text-xs text-[var(--text)] outline-none focus:border-[var(--accent)]';

const STATUS_META = {
  Present: { label: 'Present', color: '#10b981', icon: 'fa-user-check', cls: 'text-emerald-300 bg-emerald-500/10 border-emerald-500/20' },
  Absent: { label: 'Absent', color: '#f43f5e', icon: 'fa-user-xmark', cls: 'text-rose-300 bg-rose-500/10 border-rose-500/20' },
  'Miss Punch': { label: 'Miss Punch', color: '#f97316', icon: 'fa-triangle-exclamation', cls: 'text-orange-300 bg-orange-500/10 border-orange-500/20' },
  'Approved Leave': { label: 'Approved Leave', color: '#06b6d4', icon: 'fa-plane-departure', cls: 'text-cyan-300 bg-cyan-500/10 border-cyan-500/20' },
  Holiday: { label: 'Holiday', color: '#8b5cf6', icon: 'fa-calendar-star', cls: 'text-violet-300 bg-violet-500/10 border-violet-500/20' },
  'Week Off': { label: 'Weekly Off', color: '#eab308', icon: 'fa-umbrella-beach', cls: 'text-yellow-300 bg-yellow-500/10 border-yellow-500/20' },
  'No Record': { label: 'No Record', color: '#64748b', icon: 'fa-circle-question', cls: 'text-slate-300 bg-slate-500/10 border-slate-500/20' },
};

const BUCKET_ORDER = ['Present', 'Absent', 'Miss Punch', 'Approved Leave', 'Holiday', 'Week Off', 'No Record'];

const PRESETS = [
  { key: 'today', label: 'Today' },
  { key: 'yesterday', label: 'Yesterday' },
  { key: 'week', label: 'This Week' },
  { key: 'month', label: 'This Month' },
];

function mondayOfWeek() {
  const d = new Date();
  const day = (d.getDay() + 6) % 7;
  d.setDate(d.getDate() - day);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
function shiftDays(iso, delta) {
  const [y, m, d] = String(iso).split('-').map(Number);
  const dt = new Date(y, m - 1, d + delta);
  return `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, '0')}-${String(dt.getDate()).padStart(2, '0')}`;
}
function monthEnd(key) {
  const [y, m] = String(key).split('-').map(Number);
  const last = new Date(y, m, 0).getDate();
  return `${key}-${String(last).padStart(2, '0')}`;
}
function ymd(iso) {
  const s = String(iso || '').slice(0, 10);
  return s;
}

/** Colorful status KPI card. */
function MonitorCard({ title, value, meta, icon, cls, subtitle }) {
  return (
    <div className={`p-4 rounded-2xl border ${cls}`} title={meta}>
      <div className="flex items-center justify-between mb-2">
        <span className="text-[10px] uppercase font-bold text-[var(--muted)]">{title}</span>
        <i className={`fas ${icon} text-sm`}></i>
      </div>
      <p className="text-2xl font-extrabold">{value}</p>
      {subtitle ? <p className="text-[10px] text-[var(--muted)] mt-1">{subtitle}</p> : null}
    </div>
  );
}

export default function AbsentMissMonitor() {
  const [fromDate, setFromDate] = useState(isoToday());
  const [toDate, setToDate] = useState(isoToday());
  const [company, setCompany] = useState('');
  const [cat, setCat] = useState('');
  const [dept, setDept] = useState('');
  const [search, setSearch] = useState('');
  const [drillStatus, setDrillStatus] = useState(null); // 'Absent' | 'Miss Punch' | null
  const [drillCompany, setDrillCompany] = useState('');
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(50);
  const [exporting, setExporting] = useState(false);
  const [exportMsg, setExportMsg] = useState(null);

  const filtersData = useApiData('/hr/reports/filters');
  const f = filtersData.data || {};

  const params = useMemo(() => {
    const p = new URLSearchParams({ fromDate, toDate });
    if (company) p.set('companycode', company);
    if (cat) p.set('cat', cat);
    if (dept) p.set('departmentcode', dept);
    if (search.trim()) p.set('search', search.trim());
    return p;
  }, [fromDate, toDate, company, cat, dept, search]);

  const summary = useApiData(`/hr/reports/absent-miss?${params.toString()}`);

  const drillParams = useMemo(() => {
    const p = new URLSearchParams(params.toString());
    if (drillStatus) p.set('status', drillStatus);
    if (drillCompany) p.set('companycode', drillCompany);
    p.set('page', String(page));
    p.set('pageSize', String(pageSize));
    return p;
  }, [params, drillStatus, drillCompany, page, pageSize]);

  const drill = useApiData(drillStatus ? `/hr/reports/absent-miss/employees?${drillParams.toString()}` : '');

  const s = summary.data || {};
  const kpis = s.kpis || {};
  const trend = s.trend || [];
  const comparison = s.comparison || [];
  const reg = drill.data || {};
  const rows = reg.rows || [];

  const num = (v) => (v === null || v === undefined ? '—' : Number(v).toLocaleString('en-IN'));
  const pctText = (v) => (v === null || v === undefined ? '—' : `${v}%`);

  function applyPreset(kind) {
    setPage(1);
    const today = isoToday();
    if (kind === 'today') { setFromDate(today); setToDate(today); }
    else if (kind === 'yesterday') { const y = shiftDays(today, -1); setFromDate(y); setToDate(y); }
    else if (kind === 'week') { const from = mondayOfWeek(); setFromDate(from); setToDate(shiftDays(from, 6)); }
    else if (kind === 'month') { const key = today.slice(0, 7); setFromDate(`${key}-01`); setToDate(monthEnd(key)); }
  }

  function clearFilters() {
    setFromDate(isoToday()); setToDate(isoToday());
    setCompany(''); setCat(''); setDept(''); setSearch('');
    setDrillStatus(null); setDrillCompany(''); setPage(1); setExportMsg(null);
  }

  function openDrill(status, companyCode) {
    setDrillStatus(status);
    setDrillCompany(companyCode || company || '');
    setPage(1);
  }

  const downloadExport = useCallback(async () => {
    setExporting(true);
    setExportMsg(null);
    try {
      const res = await fetch(`/api/hr/reports/absent-miss/export?${params.toString()}`, { credentials: 'include' });
      if (!res.ok) {
        const data = await res.json().catch(() => null);
        throw new Error(data?.message || `Export failed (HTTP ${res.status}).`);
      }
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `Master-Reports-Absent-Miss_${fromDate}_${toDate}.xlsx`;
      a.click();
      URL.revokeObjectURL(url);
      setExportMsg({ ok: true, text: 'Absent & Miss Punch report downloaded.' });
    } catch (e) {
      setExportMsg({ ok: false, text: e?.message || 'Export failed. Please try again.' });
    } finally {
      setExporting(false);
    }
  }, [params, fromDate, toDate]);

  // Chart data
  const statusData = {
    labels: BUCKET_ORDER.map((k) => STATUS_META[k].label),
    datasets: [{
      data: BUCKET_ORDER.map((k) => Number(({
        Present: kpis.present, Absent: kpis.absent, 'Miss Punch': kpis.missPunch,
        'Approved Leave': kpis.approvedLeave, Holiday: kpis.holiday,
        'Week Off': kpis.weekOff, 'No Record': kpis.noRecord,
      })[k] || 0)),
      backgroundColor: BUCKET_ORDER.map((k) => STATUS_META[k].color),
      borderWidth: 0,
    }],
  };

  const trendData = trend.length ? {
    labels: trend.map((t) => prettyDate(t.date).slice(0, 6)),
    datasets: [
      { label: 'Present', data: trend.map((t) => t.present), backgroundColor: '#10b981', borderRadius: 3 },
      { label: 'Absent', data: trend.map((t) => t.absent), backgroundColor: '#f43f5e', borderRadius: 3 },
      { label: 'Miss Punch', data: trend.map((t) => t.missPunch), backgroundColor: '#f97316', borderRadius: 3 },
    ],
  } : null;

  const comparisonData = comparison.length ? {
    labels: comparison.map((g) => g.label || g.key || '—'),
    datasets: [
      { label: 'Present', data: comparison.map((g) => g.present), backgroundColor: '#10b981', borderRadius: 3 },
      { label: 'Absent', data: comparison.map((g) => g.absent), backgroundColor: '#f43f5e', borderRadius: 3 },
      { label: 'Miss Punch', data: comparison.map((g) => g.missPunch), backgroundColor: '#f97316', borderRadius: 3 },
    ],
  } : null;

  return (
    <section className="mb-6">
      <div className="glass-card rounded-3xl p-6 border-l-4 border-l-rose-500">
        <div className="flex flex-wrap items-center justify-between gap-4 mb-4 pb-4 border-b border-[var(--border)]">
          <div>
            <h3 className="font-bold text-base text-[var(--text)] flex items-center gap-2">
              <i className="fas fa-user-clock text-rose-400"></i> Company-wise Absent &amp; Miss Punch Monitor
            </h3>
            <p className="text-xs text-[var(--muted)]">
              Date-wise absence &amp; miss-punch intelligence per company — Holiday, Weekly Off and approved Leave are never counted as Absent.
            </p>
          </div>
          <HrCan module="reports" action="export">
            <button type="button" onClick={downloadExport} disabled={exporting} className="px-4 py-2 rounded-xl bg-emerald-600/20 border border-emerald-500/30 text-emerald-300 hover:bg-emerald-600/30 text-xs font-bold transition disabled:opacity-50">
              <i className="fas fa-file-excel mr-1"></i>{exporting ? 'Exporting...' : 'Export Excel'}
            </button>
          </HrCan>
        </div>
        {exportMsg ? (
          <p className={`text-[11px] font-semibold mb-4 ${exportMsg.ok ? 'text-emerald-300' : 'text-rose-300'}`}>{exportMsg.text}</p>
        ) : null}

        <div className="flex flex-wrap items-end gap-4 mb-4 p-4 rounded-2xl bg-white/5 border border-[var(--border)]">
          <div className="flex flex-col gap-1">
            <label className="text-[10px] uppercase font-bold text-[var(--muted)]">Period</label>
            <div className="flex gap-1.5">
              {PRESETS.map((p) => (
                <button key={p.key} type="button" onClick={() => applyPreset(p.key)} className="px-3 py-2 rounded-xl bg-white/5 border border-[var(--border)] text-[var(--text)] text-[11px] font-bold hover:bg-white/10">{p.label}</button>
              ))}
            </div>
          </div>
          <div className="flex flex-col gap-1 min-w-[150px]">
            <label className="text-[10px] uppercase font-bold text-[var(--muted)]">From Date</label>
            <input type="date" value={fromDate} onChange={(e) => { setFromDate(e.target.value); setPage(1); }} className={inputCls} />
          </div>
          <div className="flex flex-col gap-1 min-w-[150px]">
            <label className="text-[10px] uppercase font-bold text-[var(--muted)]">To Date</label>
            <input type="date" value={toDate} onChange={(e) => { setToDate(e.target.value); setPage(1); }} className={inputCls} />
          </div>
          <div className="flex flex-col gap-1 min-w-[150px]">
            <label className="text-[10px] uppercase font-bold text-[var(--muted)]">Company</label>
            <select value={company} onChange={(e) => { setCompany(e.target.value); setPage(1); }} className={inputCls}>
              <option value="">All (assigned) Companies</option>
              {(f.companies || []).map((c) => (<option key={c.code} value={c.code}>{c.name || c.code}</option>))}
            </select>
          </div>
          <div className="flex flex-col gap-1 min-w-[140px]">
            <label className="text-[10px] uppercase font-bold text-[var(--muted)]">Category</label>
            <select value={cat} onChange={(e) => { setCat(e.target.value); setPage(1); }} className={inputCls}>
              <option value="">All Categories</option>
              {(f.categories || []).map((c) => (<option key={c.code} value={c.code}>{c.name || c.code}</option>))}
            </select>
          </div>
          <div className="flex flex-col gap-1 min-w-[150px]">
            <label className="text-[10px] uppercase font-bold text-[var(--muted)]">Department</label>
            <select value={dept} onChange={(e) => { setDept(e.target.value); setPage(1); }} className={inputCls}>
              <option value="">All Departments</option>
              {(f.departments || []).map((d) => (<option key={d.code} value={d.code}>{d.name || d.code}</option>))}
            </select>
          </div>
          <div className="flex flex-col gap-1 min-w-[180px]">
            <label className="text-[10px] uppercase font-bold text-[var(--muted)]">Employee Search</label>
            <input type="text" value={search} onChange={(e) => { setSearch(e.target.value); setPage(1); }} placeholder="Name or ID..." className={inputCls} />
          </div>
          <div className="flex flex-col gap-1">
            <button type="button" onClick={clearFilters} className="px-4 py-2 rounded-xl bg-rose-600/20 border border-rose-500/30 text-rose-300 hover:bg-rose-600/30 text-xs font-bold transition h-10">
              <i className="fas fa-filter-circle-xmark mr-1"></i>Clear Filters
            </button>
          </div>
          <span className="ml-auto text-[11px] mono font-bold text-[var(--accent-soft)]">{fromDate} → {toDate}</span>
        </div>

        <AsyncBox loading={summary.loading} error={summary.error} onRetry={summary.reload} label="Absent & Miss Punch data load ho raha hai...">
          <div className="grid grid-cols-2 md:grid-cols-4 xl:grid-cols-8 gap-3 mb-5">
            <MonitorCard title="Employees" value={num(kpis.employees)} icon="fa-users" cls="text-indigo-300 bg-indigo-500/10 border-indigo-500/20" subtitle="In scope" />
            <MonitorCard title="Present" value={num(kpis.present)} icon="fa-user-check" cls={STATUS_META.Present.cls} />
            <MonitorCard title="Absent" value={num(kpis.absent)} icon="fa-user-xmark" cls={STATUS_META.Absent.cls} subtitle="Final Absent" />
            <MonitorCard title="Miss Punch" value={num(kpis.missPunch)} icon="fa-triangle-exclamation" cls={STATUS_META['Miss Punch'].cls} />
            <MonitorCard title="Approved Leave" value={num(kpis.approvedLeave)} icon="fa-plane-departure" cls={STATUS_META['Approved Leave'].cls} />
            <MonitorCard title="Holiday" value={num(kpis.holiday)} icon="fa-calendar-star" cls={STATUS_META.Holiday.cls} />
            <MonitorCard title="Weekly Off" value={num(kpis.weekOff)} icon="fa-umbrella-beach" cls={STATUS_META['Week Off'].cls} />
            <MonitorCard title="Attendance %" value={pctText(kpis.attendancePct)} icon="fa-chart-pie" cls="text-teal-300 bg-teal-500/10 border-teal-500/20" subtitle="P ÷ (P + A + Miss)" />
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-5">
            <div className="p-4 rounded-2xl bg-white/5 border border-white/5">
              <h4 className="text-xs font-bold uppercase tracking-wider text-[var(--muted)] mb-3">Status Distribution</h4>
              <ChartCanvas type="doughnut" data={statusData} options={{ cutout: '60%', plugins: { legend: { position: 'bottom', labels: { boxWidth: 10 } } } }} height={224} />
            </div>
            <div className="p-4 rounded-2xl bg-white/5 border border-white/5">
              <h4 className="text-xs font-bold uppercase tracking-wider text-[var(--muted)] mb-3">Date-wise Attendance Trend</h4>
              {trendData ? (
                <ChartCanvas type="bar" data={trendData} options={{ scales: { x: { stacked: false, grid: { display: false } }, y: { beginAtZero: true, ticks: { precision: 0 } } }, plugins: { legend: { position: 'bottom', labels: { boxWidth: 10 } } } }} height={224} />
              ) : (
                <p className="text-[11px] text-[var(--muted)] text-center py-8">No data for the selected period</p>
              )}
            </div>
          </div>

          <div className="p-4 rounded-2xl bg-white/5 border border-white/5 mb-5">
            <h4 className="text-xs font-bold uppercase tracking-wider text-[var(--muted)] mb-3">Company-wise Comparison</h4>
            {comparisonData ? (
              <ChartCanvas type="bar" data={comparisonData} options={{ scales: { x: { stacked: false, grid: { display: false } }, y: { beginAtZero: true, ticks: { precision: 0 } } }, plugins: { legend: { position: 'bottom', labels: { boxWidth: 10 } } } }} height={240} />
            ) : (
              <p className="text-[11px] text-[var(--muted)] text-center py-8">No company data for the selected period</p>
            )}
          </div>

          <div className="mb-5">
            <h4 className="text-xs font-bold uppercase tracking-wider text-[var(--muted)] mb-3">Company-wise status summary</h4>
            <div className="overflow-x-auto">
              <table className="portal-table">
                <thead>
                  <tr>
                    <th>Company</th><th>Employees</th><th className="text-emerald-300">Present</th><th className="text-rose-300">Absent</th><th className="text-orange-300">Miss Punch</th><th className="text-cyan-300">Leave</th><th className="text-violet-300">Holiday</th><th className="text-yellow-300">Week Off</th><th>No Record</th><th>Attendance %</th>
                  </tr>
                </thead>
                <tbody>
                  {comparison.map((g) => (
                    <tr key={g.key || g.label}>
                      <td className="font-semibold">{g.label || g.key || '—'}</td>
                      <td>{num(g.employees)}</td>
                      <td className="text-emerald-300 font-semibold">{num(g.present)}</td>
                      <td>
                        <button type="button" onClick={() => openDrill('Absent', g.key)} className="text-rose-300 font-bold underline decoration-dotted underline-offset-2 hover:text-rose-200" title={`Show Absent employees for ${g.label}`}>{num(g.absent)}</button>
                      </td>
                      <td>
                        <button type="button" onClick={() => openDrill('Miss Punch', g.key)} className="text-orange-300 font-bold underline decoration-dotted underline-offset-2 hover:text-orange-200" title={`Show Miss Punch employees for ${g.label}`}>{num(g.missPunch)}</button>
                      </td>
                      <td className="text-cyan-300 font-semibold">{num(g.approvedLeave)}</td>
                      <td className="text-violet-300 font-semibold">{num(g.holiday)}</td>
                      <td className="text-yellow-300 font-semibold">{num(g.weekOff)}</td>
                      <td>{num(g.noRecord)}</td>
                      <td className="mono text-[var(--accent-soft)] font-bold">{pctText(g.attendancePct)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <p className="text-[10px] text-[var(--muted)] mt-2">Click an <span className="text-rose-300 font-bold">Absent</span> or <span className="text-orange-300 font-bold">Miss Punch</span> count to open the matching employees below.</p>
          </div>

          {/* ---------- drill-down employee register ---------- */}
          {drillStatus ? (
            <div className="rounded-2xl border border-[var(--border)] p-4 bg-white/5">
              <div className="flex flex-wrap items-center justify-between gap-3 mb-3">
                <h4 className="text-xs font-bold uppercase tracking-wider text-[var(--text)]">
                  <i className={`fas ${STATUS_META[drillStatus].icon} mr-1`}></i>
                  {STATUS_META[drillStatus].label} employees
                  {drillCompany ? ` — ${drillCompany}` : ''} ({num(reg.total || 0)})
                </h4>
                <button type="button" onClick={() => setDrillStatus(null)} className="px-3 py-1.5 rounded-lg bg-white/5 border border-[var(--border)] text-[var(--text)] text-xs font-bold hover:bg-white/10">Close</button>
              </div>
              <AsyncBox loading={drill.loading} error={drill.error} onRetry={drill.reload} label="Employee list load ho rahi hai...">
                {rows.length ? (
                  <>
                    <div className="flex flex-wrap items-center justify-between gap-3 mb-3 p-3 rounded-xl bg-white/5 border border-[var(--border)]">
                      <div className="flex items-center gap-2">
                        <span className="text-xs text-[var(--muted)]">Show</span>
                        <select value={pageSize} onChange={(e) => { setPageSize(parseInt(e.target.value, 10)); setPage(1); }} className="bg-[var(--input-bg)] border border-[var(--border)] rounded-xl px-2 py-1 text-xs text-[var(--text)] outline-none focus:border-[var(--accent)]">
                          <option value={25}>25</option><option value={50}>50</option><option value={100}>100</option><option value={200}>200</option>
                        </select>
                        <span className="text-xs text-[var(--muted)]">per page</span>
                      </div>
                      <span className="text-xs text-[var(--muted)]">Page {reg.page || 1} of {reg.totalPages || 1}</span>
                      <div className="flex items-center gap-1">
                        <button type="button" onClick={() => setPage((p) => Math.max(1, p - 1))} disabled={(reg.page || 1) <= 1} className="px-3 py-1.5 rounded-lg bg-white/5 border border-[var(--border)] text-[var(--text)] text-xs font-bold transition disabled:opacity-50 hover:bg-white/10"><i className="fas fa-chevron-left"></i></button>
                        <button type="button" onClick={() => setPage((p) => p + 1)} disabled={(reg.page || 1) >= (reg.totalPages || 1)} className="px-3 py-1.5 rounded-lg bg-white/5 border border-[var(--border)] text-[var(--text)] text-xs font-bold transition disabled:opacity-50 hover:bg-white/10"><i className="fas fa-chevron-right"></i></button>
                      </div>
                    </div>
                    <div className="overflow-x-auto">
                      <table className="portal-table">
                        <thead>
                          <tr>
                            <th>Date</th><th>ID</th><th>Name</th><th>Company</th><th>Category</th><th>Dept</th><th>Status</th><th>In</th><th>Out</th><th>Hours</th><th>Late</th><th>Holiday/Leave</th>
                          </tr>
                        </thead>
                        <tbody>
                          {rows.map((r, i) => (
                            <tr key={`${r.paycode}-${r.date}-${i}`}>
                              <td className="mono text-[var(--accent-soft)]">{prettyDate(r.date)} ({dayName(r.date)})</td>
                              <td className="mono text-[var(--accent-soft)]">{r.paycode}</td>
                              <td className="font-semibold">{r.empname}</td>
                              <td>{r.companyname || r.companycode || '—'}</td>
                              <td>{r.category || '—'}</td>
                              <td>{r.departmentname || r.departmentcode || '—'}</td>
                              <td><span className="text-xs font-bold" style={{ color: STATUS_META[r.status]?.color || '#94a3b8' }}>{r.status}</span></td>
                              <td className="mono text-emerald-300">{r.inTime || '—'}</td>
                              <td className="mono text-rose-300">{r.outTime || '—'}</td>
                              <td className="font-semibold">{r.hoursworked === null || r.hoursworked === undefined ? '--' : hoursText(Number(r.hoursworked))}</td>
                              <td>{r.isLate ? <span className="px-2 py-1 rounded-lg border border-indigo-500/30 bg-indigo-500/15 text-[10px] font-bold text-indigo-300">Late</span> : '—'}</td>
                              <td className="text-[var(--muted)]">{r.holidayName || r.leaveType || '—'}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </>
                ) : (
                  <p className="text-xs text-[var(--muted)] py-6 text-center">No matching employees for this selection.</p>
                )}
              </AsyncBox>
            </div>
          ) : null}
        </AsyncBox>

        {/* ---------- legend ---------- */}
        <div className="flex flex-wrap gap-2 mt-4">
          {BUCKET_ORDER.map((k) => (
            <span key={k} className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full border border-[var(--border)] bg-white/5 text-[10px] font-semibold text-[var(--muted)]">
              <span className="w-2.5 h-2.5 rounded-full" style={{ backgroundColor: STATUS_META[k].color }}></span>
              {STATUS_META[k].label}
            </span>
          ))}
        </div>
        <p className="text-[10px] text-[var(--muted)] mt-2 leading-relaxed">
          Rules: Holiday, Weekly Off and full-day approved Leave are never counted as Absent. Miss Punch is an incomplete (IN-without-OUT) punch after the shift window — a partial punch is never auto-Absent. Days with no register row are "No Record" (not Absent). Half-day holiday/leave falls back to the register. Current-day status respects the ongoing-shift rule.
        </p>
      </div>
    </section>
  );
}