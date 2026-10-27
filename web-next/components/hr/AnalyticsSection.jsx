'use client';

// web-next/components/hr/AnalyticsSection.jsx — Category-wise Analytics (full parity).

import { useState } from 'react';
import useApiData from '../useApiData';
import AsyncBox from '../employee/AsyncBox';
import ChartCanvas from '../ChartCanvas';
import { isoToday, currentMonthKey } from '../../lib/format';

function mondayOfWeek() {
  const d = new Date();
  const day = (d.getDay() + 6) % 7;
  d.setDate(d.getDate() - day);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
function sundayOfWeek() {
  const d = new Date(mondayOfWeek() + 'T00:00:00');
  d.setDate(d.getDate() + 6);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
function monthEnd(key) {
  const [y, m] = String(key).split('-').map(Number);
  const last = new Date(y, m, 0).getDate();
  return `${key}-${String(last).padStart(2, '0')}`;
}

export default function AnalyticsSection() {
  const [mode, setMode] = useState('daily');
  const [date, setDate] = useState(isoToday());
  const [weekFrom, setWeekFrom] = useState(mondayOfWeek());
  const [weekTo, setWeekTo] = useState(sundayOfWeek());
  const [month, setMonth] = useState(currentMonthKey());

  let from, to;
  if (mode === 'daily') { from = date; to = date; }
  else if (mode === 'weekly') { from = weekFrom; to = weekTo; }
  else { from = `${month}-01`; to = monthEnd(month); }

  const { data, error, loading, reload } = useApiData(`/hr/category-analytics?mode=${mode}&fromDate=${from}&toDate=${to}`, [mode, from, to]);
  const summary = useApiData('/hr/dashboard');

  const d = data || {};
  const total = Number(summary.data?.totalstaff || 1);
  const pctStaff = (v) => (total ? ((Number(v || 0) / total) * 100).toFixed(1) : 0);
  const word = mode === 'daily' ? 'Today' : mode === 'weekly' ? 'This Week' : 'This Month';

  const deptData = (d.departments || []).length ? {
    labels: d.departments.map((x) => x.departmentcode),
    datasets: [
      { label: 'Present', data: d.departments.map((x) => Number(x.complete) || 0), backgroundColor: '#10b981', borderRadius: 4 },
      { label: 'Absent', data: d.departments.map((x) => Number(x.absent) || 0), backgroundColor: '#f43f5e', borderRadius: 4 },
    ],
  } : null;

  const ratioData = {
    labels: ['Complete Attendance', 'Absent', 'Miss Punch'],
    datasets: [{ data: [Number(d.complete || 0), Number(d.absent || 0), Number(d.miss || 0)], backgroundColor: ['#10b981', '#f43f5e', '#f59e0b'], borderWidth: 0 }],
  };

  function CatCard({ title, period, value, color, barColor, icon, barClass, subClass }) {
    return (
      <div className={`p-5 rounded-2xl ${barClass}`}>
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center gap-2.5">
            <div className={`w-10 h-10 rounded-xl ${color} flex items-center justify-center text-lg`}><i className={`fas ${icon}`}></i></div>
            <div><h4 className="font-bold text-sm text-[var(--text)]">{title}</h4><p className="text-[10px] text-[var(--muted)]">{period}</p></div>
          </div>
          <span className={`text-2xl font-extrabold ${subClass}`}>{Number(value || 0).toLocaleString('en-IN')}</span>
        </div>
        <div className="w-full bg-white/10 rounded-full h-2"><div className={`${barColor} h-2 rounded-full transition-all duration-500`} style={{ width: `${pctStaff(value)}%` }}></div></div>
        <p className={`text-[11px] ${subClass} font-semibold mt-2`}>{pctStaff(value)}% of Staff</p>
      </div>
    );
  }
  return (
    <div className="glass-card rounded-3xl p-6">
      <div className="flex flex-wrap items-center justify-between gap-4 mb-6 pb-4 border-b border-[var(--border)]">
        <div>
          <h3 className="font-bold text-base text-[var(--text)] flex items-center gap-2"><i className="fas fa-layer-group text-amber-400"></i> Category-wise Punch Analytics</h3>
          <p className="text-xs text-[var(--muted)]">Punched, Absent, Miss Punch, Late across organization</p>
        </div>
        <div className="flex gap-2 p-1 bg-black/40 rounded-2xl border border-white/5">
          {['daily', 'weekly', 'monthly'].map((m) => (
            <button key={m} onClick={() => setMode(m)} className={`tabbtn ${mode === m ? 'active' : ''} px-3.5 py-1.5 rounded-xl text-xs font-bold`}>{m === 'daily' ? 'Daily' : m === 'weekly' ? 'Weekly' : 'Monthly'}</button>
          ))}
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-3 mb-5">
        <span className="text-[11px] font-bold uppercase tracking-wider text-[var(--muted)]"><i className="fas fa-filter text-indigo-400 mr-1"></i>Attendance Period:</span>
        {mode === 'daily' && (
          <span className="flex items-center gap-2"><label className="text-xs font-semibold text-[var(--text)]">Attendance Date:</label><input type="date" value={date} onChange={(e) => setDate(e.target.value)} className="bg-[var(--input-bg)] border border-[var(--border)] rounded-xl px-3 py-2 text-xs text-[var(--text)] outline-none focus:border-[var(--accent)]" /></span>
        )}
        {mode === 'weekly' && (
          <span className="flex items-center gap-2">
            <label className="text-xs font-semibold text-[var(--text)]">Week:</label>
            <input type="date" value={weekFrom} onChange={(e) => setWeekFrom(e.target.value)} className="bg-[var(--input-bg)] border border-[var(--border)] rounded-xl px-3 py-2 text-xs text-[var(--text)] outline-none focus:border-[var(--accent)]" />
            <span className="text-xs text-[var(--muted)]">to</span>
            <input type="date" value={weekTo} onChange={(e) => setWeekTo(e.target.value)} className="bg-[var(--input-bg)] border border-[var(--border)] rounded-xl px-3 py-2 text-xs text-[var(--text)] outline-none focus:border-[var(--accent)]" />
          </span>
        )}
        {mode === 'monthly' && (
          <span className="flex items-center gap-2"><label className="text-xs font-semibold text-[var(--text)]">Month:</label><input type="month" value={month} onChange={(e) => setMonth(e.target.value)} className="bg-[var(--input-bg)] border border-[var(--border)] rounded-xl px-3 py-2 text-xs text-[var(--text)] outline-none focus:border-[var(--accent)]" /></span>
        )}
        <span className="ml-auto text-[11px] mono font-bold text-[var(--accent-soft)]">{mode.toUpperCase()} • {from} → {to}</span>
      </div>

      <AsyncBox loading={loading} error={error} onRetry={reload} label="Analytics load ho raha hai...">
        <>
          <div className="grid grid-cols-1 md:grid-cols-4 gap-5 mb-6">
            <CatCard title={`Punched ${word}`} period="Any IN/OUT punch" value={d.punched} color="bg-cyan-500/20 text-cyan-400" barColor="bg-cyan-500" icon="fa-fingerprint" barClass="bg-cyan-500/10 border border-cyan-500/20" subClass="text-cyan-300" />
            <CatCard title="Absent" period={`Absent ${word}`} value={d.absent} color="bg-rose-500/20 text-rose-400" barColor="bg-rose-500" icon="fa-user-xmark" barClass="bg-rose-500/10 border border-rose-500/20" subClass="text-rose-300" />
            <CatCard title="Miss Punch" period={`Miss Punch ${word}`} value={d.miss} color="bg-amber-500/20 text-amber-400" barColor="bg-amber-500" icon="fa-triangle-exclamation" barClass="bg-amber-500/10 border border-amber-500/20" subClass="text-amber-300" />
            <CatCard title="Late" period={`Late ${word}`} value={d.late} color="bg-indigo-500/20 text-indigo-400" barColor="bg-indigo-500" icon="fa-business-time" barClass="bg-indigo-500/10 border border-indigo-500/20" subClass="text-indigo-300" />
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            <div className="p-4 rounded-2xl bg-white/5 border border-white/5">
              <h4 className="text-xs font-bold uppercase tracking-wider text-[var(--muted)] mb-3">Department-wise Category Share</h4>
              {deptData ? <ChartCanvas type="bar" data={deptData} options={{ scales: { x: { stacked: false, grid: { display: false } }, y: { beginAtZero: true } } }} height={256} /> : <p className="text-[11px] text-[var(--muted)] text-center py-8">No attendance data for selected period</p>}
            </div>
            <div className="p-4 rounded-2xl bg-white/5 border border-white/5 flex flex-col justify-between">
              <h4 className="text-xs font-bold uppercase tracking-wider text-[var(--muted)] mb-3">Overall Category Ratio</h4>
              <ChartCanvas type="doughnut" data={ratioData} options={{ cutout: '62%', plugins: { legend: { position: 'bottom', labels: { boxWidth: 10 } } } }} height={224} />
            </div>
          </div>
        </>
      </AsyncBox>
    </div>
  );
}

