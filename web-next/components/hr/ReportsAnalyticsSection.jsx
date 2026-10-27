'use client';

// web-next/components/hr/ReportsAnalyticsSection.jsx
// "Master Reports" — the HR Admin reports dashboard: company-wise,
// category-wise, department-wise, shift-wise and single-employee attendance
// reports with date filters, KPIs, charts, detailed register and Excel export.
//
// DATA (existing shared backend, company-scoped by the server on every call):
//   GET /api/hr/reports/filters    scoped company/category/department/shift options
//   GET /api/hr/reports/employees  scoped employee search (single-employee picker)
//   GET /api/hr/reports/summary    KPIs + trend + comparison groups
//   GET /api/hr/reports/register   detailed register (paginated)
//   GET /api/hr/reports/export     server-side .xlsx (Summary/Comparison/Register)
//
// SECURITY: this component only ever LIMITS what it asks for. The server derives
// the HR Admin identity and company scope from the authenticated session and
// rejects any unauthorised company (403 COMPANY_FORBIDDEN) — hiding a dropdown
// option is never the protection. The export goes through the same backend, so
// a manipulated export URL cannot read another company's rows either.
//
// RULES: statuses / Late / grace come from the shared backend classification
// (classifyRow / normalizeAttendance — Daily Master + Single Employee Audit);
// Attendance % = Present / (Present + Absent + Miss Punch); Week Off rows are
// excluded; hours are summed only from recorded hoursworked values.

import { useCallback, useEffect, useMemo, useState } from 'react';
import AsyncBox from '../employee/AsyncBox';
import ChartCanvas from '../ChartCanvas';
import useApiData from '../useApiData';
import apiFetch from '../../lib/api';
import { isoToday, prettyDate, dayName, fmtPunch } from '../../lib/format';
import { statusBadgeClass, hoursText } from '../../lib/hr';
import { HrCan } from './HrAccess';
import AbsentMissMonitor from './AbsentMissMonitor';

const REPORT_TYPES = [
  { key: 'company', label: 'Company-wise', icon: 'fa-building' },
  { key: 'category', label: 'Category-wise', icon: 'fa-layer-group' },
  { key: 'department', label: 'Department-wise', icon: 'fa-sitemap' },
  { key: 'shift', label: 'Shift-wise', icon: 'fa-clock' },
  { key: 'employee', label: 'Single Employee', icon: 'fa-user' },
];

const DIMENSIONS = ['company', 'category', 'department', 'shift'];

const inputCls = 'bg-[var(--input-bg)] border border-[var(--border)] rounded-xl px-3 py-2 text-xs text-[var(--text)] outline-none focus:border-[var(--accent)]';

function monthEnd(key) {
  const [y, m] = String(key).split('-').map(Number);
  const last = new Date(y, m, 0).getDate();
  return `${key}-${String(last).padStart(2, '0')}`;
}

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

/** KPI card (same visual language as AnalyticsSection's CatCard). */
function ReportKpiCard({ title, period, value, icon, barClass, color, subClass, barPct }) {
  return (
    <div className={`p-5 rounded-2xl ${barClass}`}>
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2.5">
          <div className={`w-10 h-10 rounded-xl ${color} flex items-center justify-center text-lg`}><i className={`fas ${icon}`}></i></div>
          <div><h4 className="font-bold text-sm text-[var(--text)]">{title}</h4><p className="text-[10px] text-[var(--muted)]">{period}</p></div>
        </div>
        <span className={`text-2xl font-extrabold ${subClass}`}>{value}</span>
      </div>
      {typeof barPct === 'number' ? (
        <div className="w-full bg-white/10 rounded-full h-2"><div className={`${color.replace('/20', '')} h-2 rounded-full transition-all duration-500`} style={{ width: `${Math.min(100, Math.max(0, barPct))}%` }}></div></div>
      ) : null}
    </div>
  );
}

const NOTES = [
  'Statuses are derived from the shared backend attendance classification (classifyRow/normalizeAttendance — the same rules Daily Master and Single Employee Audit use).',
  'Attendance % = Present ÷ (Present + Absent + Miss Punch) × 100. Week Off / Holiday register rows are excluded and never counted as Absent.',
  'Late days are flagged after the universal 5-minute grace. Single-employee reports also show the FINAL late count after the STAFF monthly grace, kept separate from the raw late days.',
  'Working hours are summed only from recorded hoursworked values in the attendance register.',
  "Days without any register row are never invented; employees with no rows at all are reported as 'No Record'.",
  'Every number, chart, filter option and exported Excel row is limited to the companies assigned to this HR Admin account by the SuperAdmin console (enforced on the server).',
];

export default function ReportsAnalyticsSection() {
  const [reportType, setReportType] = useState('company');
  const [fromDate, setFromDate] = useState(isoToday());
  const [toDate, setToDate] = useState(isoToday());
  const [company, setCompany] = useState('');
  const [cat, setCat] = useState('');
  const [dept, setDept] = useState('');
  const [shift, setShift] = useState('');
  const [active, setActive] = useState('Y');
  const [empSearch, setEmpSearch] = useState('');
  const [empOptions, setEmpOptions] = useState([]);
  const [empLoading, setEmpLoading] = useState(false);
  const [paycode, setPaycode] = useState('');
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(50);
  const [exporting, setExporting] = useState(false);
  const [exportMsg, setExportMsg] = useState(null);

  const filtersData = useApiData('/hr/reports/filters');
  const f = filtersData.data || {};

  const dimension = DIMENSIONS.includes(reportType) ? reportType : 'company';
  const singleMode = reportType === 'employee';
  const readyForData = !singleMode || Boolean(paycode);

  const baseParams = useMemo(() => {
    const p = new URLSearchParams({ fromDate, toDate });
    if (company) p.set('companycode', company);
    if (cat) p.set('cat', cat);
    if (dept) p.set('departmentcode', dept);
    if (shift) p.set('shiftcode', shift);
    if (active !== 'ALL') p.set('active', active);
    return p;
  }, [fromDate, toDate, company, cat, dept, shift, active]);

  const summaryPath = readyForData
    ? `/hr/reports/summary?${baseParams.toString()}&dimension=${dimension}${singleMode ? `&paycode=${encodeURIComponent(paycode)}` : ''}`
    : '';
  const registerPath = readyForData
    ? `/hr/reports/register?${baseParams.toString()}${singleMode ? `&paycode=${encodeURIComponent(paycode)}` : ''}&page=${page}&pageSize=${pageSize}`
    : '';

  const summary = useApiData(summaryPath);
  const register = useApiData(registerPath);

  // Scoped employee search for the single-employee picker (server-side filters +
  // company scope apply here too — the options can never list another company).
  useEffect(() => {
    if (!singleMode) return undefined;
    let cancelled = false;
    setEmpLoading(true);
    const timer = setTimeout(async () => {
      try {
        const p = new URLSearchParams(baseParams.toString());
        if (empSearch.trim()) p.set('search', empSearch.trim());
        const res = await apiFetch(`/hr/reports/employees?${p.toString()}`);
        if (!cancelled) setEmpOptions(Array.isArray(res?.employees) ? res.employees : []);
      } catch {
        if (!cancelled) setEmpOptions([]);
      } finally {
        if (!cancelled) setEmpLoading(false);
      }
    }, 300);
    return () => { cancelled = true; clearTimeout(timer); };
  }, [singleMode, empSearch, baseParams]);

  const exportParams = useMemo(() => {
    const p = new URLSearchParams(baseParams.toString());
    p.set('dimension', dimension);
    if (singleMode && paycode) p.set('paycode', paycode);
    return p;
  }, [baseParams, dimension, singleMode, paycode]);

  const downloadExport = useCallback(async () => {
    setExporting(true);
    setExportMsg(null);
    try {
      const res = await fetch(`/api/hr/reports/export?${exportParams.toString()}`, { credentials: 'include' });
      if (!res.ok) {
        const data = await res.json().catch(() => null);
        throw new Error(data?.message || `Export failed (HTTP ${res.status}).`);
      }
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `Master-Reports_${fromDate}_${toDate}.xlsx`;
      a.click();
      URL.revokeObjectURL(url);
      setExportMsg({ ok: true, text: 'Excel report downloaded.' });
    } catch (e) {
      setExportMsg({ ok: false, text: e?.message || 'Export failed. Please try again.' });
    } finally {
      setExporting(false);
    }
  }, [exportParams, fromDate, toDate]);

  function clearFilters() {
    setCompany(''); setCat(''); setDept(''); setShift(''); setActive('Y');
    setEmpSearch(''); setPaycode(''); setPage(1); setExportMsg(null);
  }

  const s = summary.data || {};
  const kpis = s.kpis || {};
  const trend = s.trend || [];
  const breakdown = s.breakdown || [];
  const companyComparison = s.companyComparison || [];
  const employeeInfo = s.employee || null;
  const reg = register.data || {};
  const rows = reg.rows || [];

  const num = (v) => (v === null || v === undefined ? '—' : Number(v).toLocaleString('en-IN'));
  const pctText = (v) => (v === null || v === undefined ? '—' : `${v}%`);

  const trendData = useMemo(() => {
    if (!trend.length) return null;
    return {
      labels: trend.map((t) => prettyDate(t.date).slice(0, 6)),
      datasets: [
        { label: 'Present', data: trend.map((t) => t.present), borderColor: '#10b981', backgroundColor: 'rgba(16,185,129,0.25)', tension: 0.3, fill: true },
        { label: 'Absent', data: trend.map((t) => t.absent), borderColor: '#f43f5e', backgroundColor: 'rgba(244,63,94,0.20)', tension: 0.3, fill: true },
        { label: 'Miss Punch', data: trend.map((t) => t.miss), borderColor: '#f59e0b', backgroundColor: 'rgba(245,158,11,0.20)', tension: 0.3, fill: true },
      ],
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [JSON.stringify(trend)]);

  const breakdownData = useMemo(() => {
    if (!breakdown.length) return null;
    return {
      labels: breakdown.map((g) => g.label || g.key || '—'),
      datasets: [
        { label: 'Present Days', data: breakdown.map((g) => g.presentDays), backgroundColor: '#10b981', borderRadius: 4 },
        { label: 'Absent Days', data: breakdown.map((g) => g.absentDays), backgroundColor: '#f43f5e', borderRadius: 4 },
        { label: 'Miss Punch', data: breakdown.map((g) => g.missDays), backgroundColor: '#f59e0b', borderRadius: 4 },
        { label: 'Late Days', data: breakdown.map((g) => g.lateDays), backgroundColor: '#6366f1', borderRadius: 4 },
      ],
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [JSON.stringify(breakdown)]);

  const statusData = {
    labels: ['Present', 'Absent', 'Miss Punch', 'Week Off'],
    datasets: [{ data: [Number(kpis.presentDays || 0), Number(kpis.absentDays || 0), Number(kpis.missDays || 0), Number(kpis.weekOffDays || 0)], backgroundColor: ['#10b981', '#f43f5e', '#f59e0b', '#64748b'], borderWidth: 0 }],
  };

  const dimensionTitle = {
    company: 'Company-wise Comparison', category: 'Category-wise Report',
    department: 'Department-wise Report', shift: 'Shift-wise Report', employee: 'Single Employee Report',
  }[reportType] || 'Report';

  const applyPreset = (kind) => {
    setPage(1);
    if (kind === 'today') { setFromDate(isoToday()); setToDate(isoToday()); }
    else if (kind === 'week') { const from = mondayOfWeek(); setFromDate(from); setToDate(shiftDays(from, 6)); }
    else if (kind === 'month') { const key = isoToday().slice(0, 7); setFromDate(`${key}-01`); setToDate(monthEnd(key)); }
  };

  return (
    <div className="glass-card rounded-3xl p-6">
      {/* ---------- Company-wise Absent & Miss Punch Monitor (prominent) ---------- */}
      <AbsentMissMonitor />

      {/* ---------- header ---------- */}
      <div className="flex flex-wrap items-center justify-between gap-4 mb-6 pb-4 border-b border-[var(--border)]">
        <div>
          <h3 className="font-bold text-base text-[var(--text)] flex items-center gap-2">
            <i className="fas fa-chart-line text-emerald-400"></i> Master Reports
          </h3>
          <p className="text-xs text-[var(--muted)]">
            {dimensionTitle} • KPIs, charts, detailed register and Excel export — limited to the companies assigned to your HR Admin account
          </p>
        </div>
        <HrCan module="reports" action="export">
          <button type="button" onClick={downloadExport} disabled={exporting || !readyForData} className="px-4 py-2 rounded-xl bg-emerald-600/20 border border-emerald-500/30 text-emerald-300 hover:bg-emerald-600/30 text-xs font-bold transition disabled:opacity-50 disabled:cursor-not-allowed">
            <i className="fas fa-file-excel mr-1"></i>{exporting ? 'Exporting...' : 'Export Excel'}
          </button>
        </HrCan>
      </div>
      {exportMsg ? (
        <p className={`text-[11px] font-semibold mb-4 ${exportMsg.ok ? 'text-emerald-300' : 'text-rose-300'}`}>{exportMsg.text}</p>
      ) : null}

      {/* ---------- report type selector ---------- */}
      <div className="flex flex-wrap gap-2 mb-4">
        {REPORT_TYPES.map((t) => (
          <button
            key={t.key}
            type="button"
            onClick={() => { setReportType(t.key); setPage(1); setExportMsg(null); }}
            className={`px-4 py-2 rounded-xl text-xs font-bold transition border ${reportType === t.key ? 'bg-indigo-600 border-indigo-500 text-white' : 'bg-white/5 border-[var(--border)] text-[var(--muted)] hover:text-[var(--text)] hover:bg-white/10'}`}
          >
            <i className={`fas ${t.icon} mr-1.5`}></i>{t.label}
          </button>
        ))}
      </div>

      {/* ---------- filters ---------- */}
      <div className="flex flex-wrap items-end gap-4 mb-4 p-4 rounded-2xl bg-white/5 border border-[var(--border)]">
        <div className="flex flex-col gap-1">
          <label className="text-[10px] uppercase font-bold text-[var(--muted)]">Period</label>
          <div className="flex gap-1.5">
            <button type="button" onClick={() => applyPreset('today')} className="px-3 py-2 rounded-xl bg-white/5 border border-[var(--border)] text-[var(--text)] text-[11px] font-bold hover:bg-white/10">Today</button>
            <button type="button" onClick={() => applyPreset('week')} className="px-3 py-2 rounded-xl bg-white/5 border border-[var(--border)] text-[var(--text)] text-[11px] font-bold hover:bg-white/10">This Week</button>
            <button type="button" onClick={() => applyPreset('month')} className="px-3 py-2 rounded-xl bg-white/5 border border-[var(--border)] text-[var(--text)] text-[11px] font-bold hover:bg-white/10">This Month</button>
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
        <div className="flex flex-col gap-1 min-w-[150px]">
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
        <div className="flex flex-col gap-1 min-w-[130px]">
          <label className="text-[10px] uppercase font-bold text-[var(--muted)]">Shift</label>
          <select value={shift} onChange={(e) => { setShift(e.target.value); setPage(1); }} className={inputCls}>
            <option value="">All Shifts</option>
            {(f.shifts || []).map((sft) => (<option key={sft.code} value={sft.code}>{sft.name || sft.code}</option>))}
          </select>
        </div>
        <div className="flex flex-col gap-1 min-w-[110px]">
          <label className="text-[10px] uppercase font-bold text-[var(--muted)]">Status</label>
          <select value={active} onChange={(e) => { setActive(e.target.value); setPage(1); }} className={inputCls}>
            <option value="Y">Active</option>
            <option value="N">Inactive</option>
            <option value="ALL">All</option>
          </select>
        </div>
        <div className="flex flex-col gap-1">
          <button type="button" onClick={clearFilters} className="px-4 py-2 rounded-xl bg-rose-600/20 border border-rose-500/30 text-rose-300 hover:bg-rose-600/30 text-xs font-bold transition h-10">
            <i className="fas fa-filter-circle-xmark mr-1"></i>Clear Filters
          </button>
        </div>
        <span className="ml-auto text-[11px] mono font-bold text-[var(--accent-soft)]">{fromDate} → {toDate}</span>
      </div>

      {/* ---------- single-employee picker (scoped search) ---------- */}
      {singleMode ? (
        <div className="flex flex-wrap items-end gap-4 mb-4 p-4 rounded-2xl bg-white/5 border border-[var(--border)]">
          <div className="flex flex-col gap-1 min-w-[220px]">
            <label className="text-[10px] uppercase font-bold text-[var(--muted)]">Search Employee (name or ID)</label>
            <input
              type="text"
              value={empSearch}
              onChange={(e) => { setEmpSearch(e.target.value); setPage(1); }}
              placeholder="Type to search..."
              className={inputCls}
            />
          </div>
          <div className="flex flex-col gap-1 min-w-[260px]">
            <label className="text-[10px] uppercase font-bold text-[var(--muted)]">Employee {empLoading ? '(searching...)' : `(${empOptions.length} found)`}</label>
            <select
              value={paycode}
              onChange={(e) => { setPaycode(e.target.value); setPage(1); setExportMsg(null); }}
              className={inputCls}
            >
              <option value="">Select an employee</option>
              {empOptions.map((e) => (
                <option key={e.paycode} value={e.paycode}>
                  {e.empname} — {e.paycode} ({e.companyname || e.companycode || '—'})
                </option>
              ))}
            </select>
          </div>
          {employeeInfo ? (
            <div className="text-[11px] text-[var(--muted)] leading-5">
              <p><span className="font-bold text-[var(--text)]">{employeeInfo.empname}</span> • {employeeInfo.paycode}</p>
              <p>{employeeInfo.companyname || employeeInfo.companycode || '—'} • {employeeInfo.departmentname || employeeInfo.departmentcode || '—'} • {employeeInfo.category || '—'} • Shift {employeeInfo.shiftcode || '—'}</p>
            </div>
          ) : null}
          <p className="text-[10px] text-[var(--muted)] w-full">Employee search results are limited to the companies assigned to your HR Admin account.</p>
        </div>
      ) : null}

      <AsyncBox loading={summary.loading} error={summary.error} onRetry={summary.reload} label="Report load ho raha hai...">
        {!readyForData ? (
          <div className="glass-card rounded-2xl p-10 text-center">
            <i className="fas fa-user-shield text-2xl text-indigo-400"></i>
            <p className="text-sm font-bold text-[var(--text)] mt-3">Single Employee Report</p>
            <p className="text-xs text-[var(--muted)] mt-1">Search and select an employee above to generate the detailed report.</p>
          </div>
        ) : (
          <>
            {/* ---------- KPI cards ---------- */}
            <div className="grid grid-cols-1 md:grid-cols-4 gap-5 mb-6">
              <ReportKpiCard title="Employees" period={`Matching filters • ${kpis.employeesWithoutRecords || 0} without rows`} value={num(kpis.employees)} icon="fa-users" color="bg-indigo-500/20 text-indigo-400" barClass="bg-indigo-500/10 border border-indigo-500/20" subClass="text-indigo-300" />
              <ReportKpiCard title="Present Days" period="Complete / half / short" value={num(kpis.presentDays)} icon="fa-user-check" color="bg-emerald-500/20 text-emerald-400" barClass="bg-emerald-500/10 border border-emerald-500/20" subClass="text-emerald-300" barPct={Number(kpis.attendancePct || 0)} />
              <ReportKpiCard title="Absent Days" period="Register rows marked Absent" value={num(kpis.absentDays)} icon="fa-user-xmark" color="bg-rose-500/20 text-rose-400" barClass="bg-rose-500/10 border border-rose-500/20" subClass="text-rose-300" />
              <ReportKpiCard title="Miss Punch Days" period="IN without OUT (completed day)" value={num(kpis.missDays)} icon="fa-triangle-exclamation" color="bg-amber-500/20 text-amber-400" barClass="bg-amber-500/10 border border-amber-500/20" subClass="text-amber-300" />
              <ReportKpiCard title="Late Days" period="After 5-minute grace" value={num(kpis.lateDays)} icon="fa-business-time" color="bg-indigo-500/20 text-indigo-400" barClass="bg-indigo-500/10 border border-indigo-500/20" subClass="text-indigo-300" />
              <ReportKpiCard title="Attendance %" period="Present ÷ (P + A + Miss)" value={pctText(kpis.attendancePct)} icon="fa-chart-pie" color="bg-cyan-500/20 text-cyan-400" barClass="bg-cyan-500/10 border border-cyan-500/20" subClass="text-cyan-300" barPct={Number(kpis.attendancePct || 0)} />
              <ReportKpiCard title="Recorded Hours" period="Sum of hoursworked only" value={hoursText(Number(kpis.hoursMinutes || 0))} icon="fa-hourglass-half" color="bg-teal-500/20 text-teal-400" barClass="bg-teal-500/10 border border-teal-500/20" subClass="text-teal-300" />
              <ReportKpiCard title="Week Off Days" period="Excluded from Attendance %" value={num(kpis.weekOffDays)} icon="fa-umbrella-beach" color="bg-slate-500/20 text-slate-300" barClass="bg-slate-500/10 border border-slate-500/20" subClass="text-slate-200" />
            </div>
            {singleMode && employeeInfo && employeeInfo.lateFinal !== null && employeeInfo.lateFinal !== undefined ? (
              <div className="mb-6 p-4 rounded-2xl bg-indigo-500/10 border border-indigo-500/20 text-[11px] text-indigo-200">
                <span className="font-bold">Final late arrivals (after STAFF monthly grace): {employeeInfo.lateFinal}</span>
                <span className="text-[var(--muted)]"> — the established Single Employee Audit rule; raw late days above are kept separate.</span>
              </div>
            ) : null}
          </>
        )}
      </AsyncBox>

      {readyForData ? (
        <>
          {/* ---------- charts ---------- */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-6">
            <div className="p-4 rounded-2xl bg-white/5 border border-white/5">
              <h4 className="text-xs font-bold uppercase tracking-wider text-[var(--muted)] mb-3">Daily Attendance Trend</h4>
              {trendData ? (
                <ChartCanvas type="line" data={trendData} options={{ scales: { x: { grid: { display: false } }, y: { beginAtZero: true, ticks: { precision: 0 } } }, plugins: { legend: { position: 'bottom', labels: { boxWidth: 10 } } } }} height={256} />
              ) : (
                <p className="text-[11px] text-[var(--muted)] text-center py-8">No attendance data for the selected period</p>
              )}
            </div>
            <div className="p-4 rounded-2xl bg-white/5 border border-white/5">
              <h4 className="text-xs font-bold uppercase tracking-wider text-[var(--muted)] mb-3">Status Distribution (register days)</h4>
              <ChartCanvas type="doughnut" data={statusData} options={{ cutout: '62%', plugins: { legend: { position: 'bottom', labels: { boxWidth: 10 } } } }} height={224} />
            </div>
          </div>

          <div className="p-4 rounded-2xl bg-white/5 border border-white/5 mb-6">
            <h4 className="text-xs font-bold uppercase tracking-wider text-[var(--muted)] mb-3">
              {singleMode ? 'Employee Overview' : `${dimensionTitle} — day counts`}
            </h4>
            {breakdownData ? (
              <ChartCanvas type="bar" data={breakdownData} options={{ scales: { x: { stacked: false, grid: { display: false } }, y: { beginAtZero: true, ticks: { precision: 0 } } }, plugins: { legend: { position: 'bottom', labels: { boxWidth: 10 } } } }} height={260} />
            ) : (
              <p className="text-[11px] text-[var(--muted)] text-center py-8">No attendance data for the selected period</p>
            )}
          </div>

          {/* ---------- comparison table ---------- */}
          {!singleMode ? (
            <div className="mb-6">
              <h4 className="text-xs font-bold uppercase tracking-wider text-[var(--muted)] mb-3">
                {reportType === 'company' ? 'Company Comparison (authorised companies only)' : `${dimensionTitle} Summary`}
              </h4>
              <div className="overflow-x-auto">
                <table className="portal-table">
                  <thead>
                    <tr>
                      <th>Group</th><th>Employees</th><th>Present</th><th>Absent</th><th>Miss Punch</th><th>Week Off</th><th>Late</th><th>Hours</th><th>Attendance %</th>
                    </tr>
                  </thead>
                  <tbody>
                    {(reportType === 'company' ? companyComparison : breakdown).map((g) => (
                      <tr key={g.key || g.label}>
                        <td className="font-semibold">{g.label || g.key || '—'}</td>
                        <td>{num(g.employees)}</td>
                        <td className="text-emerald-300 font-semibold">{num(g.presentDays)}</td>
                        <td className="text-rose-300 font-semibold">{num(g.absentDays)}</td>
                        <td className="text-amber-300 font-semibold">{num(g.missDays)}</td>
                        <td>{num(g.weekOffDays)}</td>
                        <td className="text-indigo-300 font-semibold">{num(g.lateDays)}</td>
                        <td>{hoursText(Number(g.hoursMinutes || 0))}</td>
                        <td className="mono text-[var(--accent-soft)] font-bold">{pctText(g.attendancePct)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          ) : null}
        </>
      ) : null}

      {/* ---------- detailed attendance register ---------- */}
      {readyForData ? (
        <div className="mb-6">
          <div className="flex flex-wrap items-center justify-between gap-3 mb-3">
            <h4 className="text-xs font-bold uppercase tracking-wider text-[var(--muted)]">Detailed Attendance Register</h4>
            <span className="text-[11px] text-[var(--muted)]">{num(reg.total || 0)} row(s) • {num(reg.employees || 0)} employee(s)</span>
          </div>
          <AsyncBox loading={register.loading} error={register.error} onRetry={register.reload} label="Register load ho raha hai...">
            {rows.length ? (
              <>
                <div className="flex flex-wrap items-center justify-between gap-3 mb-3 p-3 rounded-xl bg-white/5 border border-[var(--border)]">
                  <div className="flex items-center gap-2">
                    <span className="text-xs text-[var(--muted)]">Show</span>
                    <select value={pageSize} onChange={(e) => { setPageSize(parseInt(e.target.value, 10)); setPage(1); }} className="bg-[var(--input-bg)] border border-[var(--border)] rounded-xl px-2 py-1 text-xs text-[var(--text)] outline-none focus:border-[var(--accent)]">
                      <option value={25}>25</option>
                      <option value={50}>50</option>
                      <option value={100}>100</option>
                      <option value={200}>200</option>
                    </select>
                    <span className="text-xs text-[var(--muted)]">per page</span>
                  </div>
                  <span className="text-xs text-[var(--muted)]">Page {reg.page || 1} of {reg.totalPages || 1}</span>
                  <div className="flex items-center gap-1">
                    <button type="button" onClick={() => setPage((p) => Math.max(1, p - 1))} disabled={(reg.page || 1) <= 1} className="px-3 py-1.5 rounded-lg bg-white/5 border border-[var(--border)] text-[var(--text)] text-xs font-bold transition disabled:opacity-50 disabled:cursor-not-allowed hover:bg-white/10">
                      <i className="fas fa-chevron-left"></i>
                    </button>
                    <button type="button" onClick={() => setPage((p) => p + 1)} disabled={(reg.page || 1) >= (reg.totalPages || 1)} className="px-3 py-1.5 rounded-lg bg-white/5 border border-[var(--border)] text-[var(--text)] text-xs font-bold transition disabled:opacity-50 disabled:cursor-not-allowed hover:bg-white/10">
                      <i className="fas fa-chevron-right"></i>
                    </button>
                  </div>
                </div>
                <div className="overflow-x-auto">
                  <table className="portal-table">
                    <thead>
                      <tr>
                        <th>Date</th><th>ID</th><th>Name</th><th>Company</th><th>Dept</th><th>Shift</th><th>In</th><th>Out</th><th>Worked</th><th>Status</th>
                      </tr>
                    </thead>
                    <tbody>
                      {rows.map((r, i) => (
                        <tr key={`${r.paycode}-${r.date || 'none'}-${i}`}>
                          <td className="mono text-[var(--accent-soft)]">{r.date ? `${prettyDate(r.date)} (${dayName(r.date)})` : 'No Record'}</td>
                          <td className="mono text-[var(--accent-soft)]">{r.paycode}</td>
                          <td className="font-semibold">{r.empname}</td>
                          <td>{r.companyname || r.companycode || '—'}</td>
                          <td>{r.departmentname || r.departmentcode || '—'}</td>
                          <td className="mono">{r.shiftcode || '—'}</td>
                          <td className="mono text-emerald-300">{fmtPunch(r.inTime)}</td>
                          <td className="mono text-rose-300">{fmtPunch(r.outTime)}</td>
                          <td className="font-semibold">{r.hoursworked === null || r.hoursworked === undefined ? '--' : hoursText(Number(r.hoursworked))}</td>
                          <td>
                            <div className="flex items-center gap-1.5">
                              <span className={`badge ${statusBadgeClass(r.status)}`}>{r.status}</span>
                              {r.isLate ? <span className="px-2 py-1 rounded-lg border border-indigo-500/30 bg-indigo-500/15 text-[10px] font-bold text-indigo-300">Late{r.lateMinutes ? ` +${Math.round(r.lateMinutes)}m` : ''}</span> : null}
                            </div>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </>
            ) : (
              <p className="text-xs text-[var(--muted)] py-6 text-center">No attendance records found for the selected filters.</p>
            )}
          </AsyncBox>
        </div>
      ) : null}

      {/* ---------- notes ---------- */}
      <div className="p-4 rounded-2xl bg-white/5 border border-[var(--border)]">
        <h4 className="text-xs font-bold uppercase tracking-wider text-[var(--muted)] mb-2">Report Notes &amp; Business Rules</h4>
        <ul className="space-y-1">
          {NOTES.map((n) => (
            <li key={n} className="text-[11px] text-[var(--muted)] leading-relaxed flex gap-2">
              <i className="fas fa-circle-info text-[9px] text-[var(--accent-soft)] mt-1"></i>
              <span>{n}</span>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}