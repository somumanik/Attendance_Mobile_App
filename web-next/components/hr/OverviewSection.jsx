'use client';

// web-next/components/hr/OverviewSection.jsx — Executive Overview (full parity).

import { useState } from 'react';
import useApiData from '../useApiData';
import AsyncBox from '../employee/AsyncBox';
import ChartCanvas from '../ChartCanvas';
import AuditModal from './AuditModal';
import LateEmployeesModal from './LateEmployeesModal';
import { isoToday, prettyDate } from '../../lib/format';
import { initials, ageFrom, yearsCompleted, isTodayMMDD } from '../../lib/hr';
import { execStatusBadgeClass } from './execStatusBadge';
import ExecPunch from './ExecPunch';

const cleanLabel = (s) => String(s || '').replace(/\s+/g, ' ').trim();

function HrStat({ label, value, pct, sub, icon, border, iconBg, valueClass = 'text-[var(--text)]', pctClass = '' }) {
  return (
    <div className={`stat-card glass-card rounded-2xl p-5 border-l-4 ${border}`}>
      <div className="flex items-center justify-between mb-2">
        <span className="text-xs font-bold text-[var(--muted)] uppercase">{label}</span>
        <div className={`w-9 h-9 rounded-xl ${iconBg} flex items-center justify-center`}><i className={`fas ${icon}`}></i></div>
      </div>
      <div className="flex items-baseline gap-2">
        <span className={`text-3xl font-extrabold ${valueClass}`}>{value}</span>
        {pct != null ? <span className={`text-xs font-bold ${pctClass}`}>{pct}%</span> : null}
      </div>
      <p className="text-[11px] text-[var(--muted)] mt-2">{sub}</p>
    </div>
  );
}

function PersonRow({ e, detail }) {
  return (
    <div className="flex items-center gap-3 p-2.5 rounded-xl bg-white/5 border border-white/5">
      <div className="w-9 h-9 rounded-xl card-gradient-1 flex items-center justify-center text-xs font-extrabold text-white shrink-0">{initials(e.empname)}</div>
      <div className="min-w-0">
        <p className="text-xs font-bold text-[var(--text)] truncate">{e.empname}</p>
        <p className="text-[10px] text-[var(--muted)] mono">{e.paycode}</p>
        {detail}
      </div>
    </div>
  );
}
export default function OverviewSection() {
  const summary = useApiData('/hr/dashboard');
  const charts = useApiData('/hr/dashboard-charts');
  const cele = useApiData('/hr/celebrations');
  const today = isoToday();
  const daily = useApiData(`/hr/daily?fromDate=${today}&toDate=${today}`);
  const [auditPaycode, setAuditPaycode] = useState(null);
  const [showLate, setShowLate] = useState(false);

  // Birthdays / anniversaries come from the SAME '/hr/celebrations' request used for
  // the marriage card (server-side returns dateofbirth/dateofjoin for every active
  // employee). This avoids page-looping the full directory just to find today's DOB/DOJ.

  const s = summary.data || {};
  const total = Number(s.totalstaff || 0);
  const punched = Number(s.punchedtoday || 0);
  const absent = Number(s.absenttoday || 0);
  const miss = Number(s.misstoday || 0);
  const late = Number(s.latetoday || 0);
  const pct = (n) => (total ? Math.round((n / total) * 100) : 0);

  const c = charts.data || {};
  const celeEmployees = cele.data?.employees || [];
  const birthdays = celeEmployees.filter((e) => isTodayMMDD(e.dateofbirth));
  const anniversaries = celeEmployees.filter((e) => isTodayMMDD(e.dateofjoin));
  const marriages = (cele.data?.marriages || []).filter((m) => isTodayMMDD(m.anniversarydate));
  const notifs = [
    ...birthdays.map((e) => ({ key: 'b' + e.paycode, paycode: e.paycode, icon: 'fa-cake-candles', cls: 'text-pink-400', text: `${e.empname} • Birthday` })),
    ...anniversaries.map((e) => ({ key: 'a' + e.paycode, paycode: e.paycode, icon: 'fa-award', cls: 'text-amber-400', text: `${e.empname} • Work Anniversary` })),
    ...marriages.map((m) => ({ key: 'm' + m.paycode, paycode: m.paycode, icon: 'fa-heart', cls: 'text-rose-400', text: `${m.empname || m.paycode} • Marriage Anniversary` })),
  ];

  return (
    <div className="exec-view contents">
      <div>
        <h1 className="exec-title">Executive Overview</h1>
        <p className="exec-subtitle">HR Administrator Portal • master SQL database</p>
      </div>
      <AsyncBox loading={summary.loading || cele.loading} error={summary.error} onRetry={summary.reload} label="Overview load ho raha hai...">
      {summary.data ? (
        <>
          <div className="glass-card rounded-2xl p-4 border-l-4 border-l-pink-500">
            <div className="flex items-center justify-between gap-3 mb-2.5">
              <h3 className="font-bold text-sm text-[var(--text)] flex items-center gap-2"><i className="fas fa-bell text-pink-400"></i> Notifications</h3>
              <span className="chip bg-pink-500/15 border border-pink-500/30 text-pink-300">{notifs.length}</span>
            </div>
            <div className="flex flex-wrap gap-2">
              {notifs.length ? notifs.map((n) => (
                <button key={n.key} type="button" onClick={() => setAuditPaycode(n.paycode)} className="flex items-center gap-2 px-3 py-2 rounded-xl bg-white/5 border border-white/10 text-[11px] font-semibold text-[var(--text)] hover:bg-white/10 transition">
                  <i className={`fas ${n.icon} ${n.cls} shrink-0`}></i>{n.text}
                </button>
              )) : <span className="text-[11px] text-[var(--muted)]">Aaj koi notification nahi hai.</span>}
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-5 gap-4">
            <HrStat label="Total Staff" value={total} sub="Active in dbo.tblemployee" icon="fa-users" border="border-l-indigo-500" iconBg="bg-indigo-500/20 text-indigo-400" />
            <HrStat label="Punched Today" value={punched} pct={pct(punched)} sub="Employees with any real IN/OUT punch" icon="fa-fingerprint" border="border-l-emerald-500" iconBg="bg-emerald-500/20 text-emerald-400" valueClass="text-emerald-400" pctClass="text-emerald-300" />
            <HrStat label="Absent Today" value={absent} pct={pct(absent)} sub="No punch recorded" icon="fa-user-xmark" border="border-l-rose-500" iconBg="bg-rose-500/20 text-rose-400" valueClass="text-rose-400" pctClass="text-rose-300" />
            <HrStat label="Missed Punches" value={miss} pct={pct(miss)} sub="Requires HR clearance" icon="fa-triangle-exclamation" border="border-l-amber-500" iconBg="bg-amber-500/20 text-amber-400" valueClass="text-amber-400" pctClass="text-amber-300" />
            <button type="button" onClick={() => setShowLate(true)} className="stat-card glass-card rounded-2xl p-5 border-l-4 border-l-indigo-500 text-left cursor-pointer w-full">
              <div className="flex items-center justify-between mb-2"><span className="text-xs font-bold text-[var(--muted)] uppercase">Late Employees</span><div className="w-9 h-9 rounded-xl bg-indigo-500/20 text-indigo-400 flex items-center justify-center"><i className="fas fa-business-time"></i></div></div>
              <div className="flex items-baseline gap-2"><span className="text-3xl font-extrabold text-indigo-400">{late}</span></div>
              <p className="text-[11px] text-[var(--muted)] mt-2">View real attendance records</p>
            </button>
          </div>
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
            <div className="glass-card rounded-3xl p-6 border-l-4 border-l-pink-500">
              <div className="flex items-center justify-between mb-3">
                <h3 className="font-bold text-sm text-[var(--text)] flex items-center gap-2"><i className="fas fa-cake-candles text-pink-400"></i> Today's Birthdays</h3>
                <span className="chip bg-pink-500/15 border border-pink-500/30 text-pink-300">{birthdays.length}</span>
              </div>
              <div className="space-y-2.5 max-h-64 overflow-y-auto pr-1">
                {birthdays.length ? birthdays.map((e) => (
                  <PersonRow key={e.paycode} e={e} detail={<p className="text-[10px] text-pink-300 mt-0.5"><i className="fas fa-cake-candles mr-1"></i>{prettyDate(e.dateofbirth)} • Age {ageFrom(e.dateofbirth)}</p>} />
                )) : <p className="text-xs text-[var(--muted)]">Aaj koi birthday nahi hai.</p>}
              </div>
            </div>
            <div className="glass-card rounded-3xl p-6 border-l-4 border-l-amber-500">
              <div className="flex items-center justify-between mb-3">
                <h3 className="font-bold text-sm text-[var(--text)] flex items-center gap-2"><i className="fas fa-award text-amber-400"></i> Today's Work Anniversaries</h3>
                <span className="chip bg-amber-500/15 border border-amber-500/30 text-amber-300">{anniversaries.length}</span>
              </div>
              <div className="space-y-2.5 max-h-64 overflow-y-auto pr-1">
                {anniversaries.length ? anniversaries.map((e) => (
                  <PersonRow key={e.paycode} e={e} detail={<p className="text-[10px] text-amber-300 mt-0.5"><i className="fas fa-award mr-1"></i>{yearsCompleted(e.dateofjoin)} yrs service</p>} />
                )) : <p className="text-xs text-[var(--muted)]">Aaj koi work anniversary nahi hai.</p>}
              </div>
            </div>
            <div className="glass-card rounded-3xl p-6 border-l-4 border-l-rose-500">
              <div className="flex items-center justify-between mb-3">
                <h3 className="font-bold text-sm text-[var(--text)] flex items-center gap-2"><i className="fas fa-heart text-rose-400"></i> Marriage Anniversaries</h3>
                <span className="chip bg-rose-500/15 border border-rose-500/30 text-rose-300">{marriages.length}</span>
              </div>
              <div className="space-y-2.5 max-h-64 overflow-y-auto pr-1">
                {marriages.length ? marriages.map((m) => (
                  <PersonRow key={m.paycode} e={{ empname: m.empname || m.paycode, paycode: m.paycode }} detail={<p className="text-[10px] text-rose-300 mt-0.5"><i className="fas fa-heart mr-1"></i>{prettyDate(m.anniversarydate)}</p>} />
                )) : <p className="text-xs text-[var(--muted)]">Aaj koi marriage anniversary nahi hai.</p>}
              </div>
            </div>
          </div>
          <AsyncBox loading={charts.loading} error={charts.error} onRetry={charts.reload} label="Charts load ho rahe hain...">
            <div className="grid grid-cols-1 gap-6 mb-6">
              <div className="glass-card rounded-3xl p-5 sm:p-6">
                <h3 className="font-bold text-sm sm:text-base text-[var(--text)] flex items-center gap-2 mb-3"><i className="fas fa-building text-indigo-400"></i> Department-wise Attendance</h3>
                {c.chart5 ? <ChartCanvas type="bar" data={{ labels: (c.chart5.labels || []).map(cleanLabel), datasets: c.chart5.datasets }} options={{ plugins: { legend: { labels: { color: '#cbd5e1', font: { size: 10 } } } }, scales: { x: { ticks: { color: '#94a3b8' }, grid: { display: false } }, y: { ticks: { color: '#94a3b8' }, grid: { color: 'rgba(255,255,255,.05)' }, beginAtZero: true } } }} height={260} />
                  : <p className="text-center text-xs text-[var(--muted)] py-2">No attendance data for selected period</p>}
              </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-6 mb-6">
              <div className="glass-card rounded-3xl p-4 sm:p-5">
                <h3 className="font-bold text-xs sm:text-sm text-[var(--text)] flex items-center gap-2 mb-3"><i className="fas fa-chart-pie text-indigo-400"></i> Attendance Activity</h3>
                {c.chart1 ? <ChartCanvas type="doughnut" data={{ labels: c.chart1.labels, datasets: [{ data: c.chart1.data, backgroundColor: c.chart1.colors, borderWidth: 0 }] }} options={{ cutout: '60%', plugins: { legend: { position: 'bottom', labels: { color: '#cbd5e1', font: { size: 10 }, padding: 10 } } } }} height={170} /> : <p className="text-center text-xs text-[var(--muted)] py-2">No data for selected period</p>}
              </div>
              <div className="glass-card rounded-3xl p-4 sm:p-5">
                <h3 className="font-bold text-xs sm:text-sm text-[var(--text)] flex items-center gap-2 mb-3"><i className="fas fa-chart-column text-emerald-400"></i> Last 10 Days Presence</h3>
                {c.chart2 ? <ChartCanvas type="bar" data={{ labels: c.chart2.labels, datasets: c.chart2.datasets }} options={{ plugins: { legend: { labels: { color: '#cbd5e1', font: { size: 10 } } } }, scales: { x: { ticks: { color: '#94a3b8' }, stacked: true, grid: { display: false } }, y: { ticks: { color: '#94a3b8' }, grid: { color: 'rgba(255,255,255,.05)' }, stacked: true, beginAtZero: true } } }} height={170} /> : <p className="text-center text-xs text-[var(--muted)] py-2">No data for selected period</p>}
              </div>
              <div className="glass-card rounded-3xl p-4 sm:p-5">
                <h3 className="font-bold text-xs sm:text-sm text-[var(--text)] flex items-center gap-2 mb-3"><i className="fas fa-users-viewfinder text-amber-400"></i> Currently Present by Company</h3>
                {c.chart3 && (c.chart3.data || []).some((v) => v > 0) ? <ChartCanvas type="bar" data={{ labels: (c.chart3.labels || []).map(cleanLabel), datasets: [{ label: 'Employees Present', data: c.chart3.data, backgroundColor: c.chart3.backgroundColor, borderRadius: 5 }] }} options={{ indexAxis: 'y', plugins: { legend: { display: false } }, scales: { x: { ticks: { color: '#94a3b8' }, grid: { color: 'rgba(255,255,255,.05)' }, beginAtZero: true }, y: { ticks: { color: '#94a3b8' }, grid: { display: false } } } }} height={170} /> : <p className="text-center text-xs text-[var(--muted)] py-2">No employees currently present</p>}
              </div>
              <div className="glass-card rounded-3xl p-4 sm:p-5">
                <h3 className="font-bold text-xs sm:text-sm text-[var(--text)] flex items-center gap-2 mb-3"><i className="fas fa-calendar-day text-rose-400"></i> Yesterday's Attendance</h3>
                {c.chart4 && (c.chart4.data || []).some((v) => v > 0) ? <ChartCanvas type="bar" data={{ labels: c.chart4.labels, datasets: [{ data: c.chart4.data, backgroundColor: c.chart4.colors, borderRadius: 5 }] }} options={{ plugins: { legend: { display: false } }, scales: { x: { ticks: { color: '#94a3b8' }, grid: { display: false } }, y: { ticks: { color: '#94a3b8' }, grid: { color: 'rgba(255,255,255,.05)' }, beginAtZero: true } } }} height={170} /> : <p className="text-center text-xs text-[var(--muted)] py-2">No data for yesterday</p>}
              </div>
            </div>
          </AsyncBox>

          <div className="glass-card rounded-3xl p-6">
            <div className="flex flex-wrap items-center justify-between gap-4 mb-4">
              <div>
                <h3 className="font-bold text-sm text-[var(--text)] flex items-center gap-2"><i className="fas fa-users-viewfinder text-indigo-400"></i> Live Biometric Status</h3>
                <p className="text-xs text-[var(--muted)]">Real-time punch records from Savior network</p>
              </div>
            </div>
            {(daily.data || []).length ? (
              <div className="overflow-x-auto max-h-[420px]">
                <table className="portal-table">
                  <thead><tr><th>ID</th><th>Name</th><th>Dept</th><th>In</th><th>Out</th><th>Status</th><th className="text-center">Audit</th></tr></thead>
                  <tbody>
                    {(daily.data || []).map((r, i) => (
                      <tr key={i}>
                        <td className="mono text-indigo-300">{r.paycode}</td>
                        <td className="text-[var(--text)] font-semibold">{r.empname}</td>
                        <td className="text-[var(--muted)]">{r.departmentname || r.departmentcode || '—'}</td>
                        <td><ExecPunch value={r.inTime} side="in" /></td>
                        <td><ExecPunch value={r.outTime} side="out" /></td>
                        <td><span className={`badge ${execStatusBadgeClass(r.computedStatus || r.statusLabel)}`}>{r.computedStatus || r.statusLabel || '—'}</span></td>
                        <td className="text-center">
                          <button type="button" onClick={() => setAuditPaycode(r.paycode)} className="exec-audit-link"><i className="fas fa-magnifying-glass mr-1"></i>Audit</button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <p className="text-xs text-[var(--muted)]">Aaj ka koi live punch record nahi hai.</p>
            )}
          </div>
          {auditPaycode ? <AuditModal paycode={auditPaycode} onClose={() => setAuditPaycode(null)} /> : null}
          {showLate ? <LateEmployeesModal onClose={() => setShowLate(false)} onAudit={(pc) => { setShowLate(false); setAuditPaycode(pc); }} /> : null}
        </>
      ) : null}
      </AsyncBox>
    </div>
  );
}



