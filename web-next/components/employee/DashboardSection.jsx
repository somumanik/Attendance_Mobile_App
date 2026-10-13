'use client';

// web-next/components/employee/DashboardSection.jsx — real employee dashboard, original layout.

import useApiData from './useApiData';
import AsyncBox from './AsyncBox';
import ChartCanvas from '../ChartCanvas';
import { prettyDate, fmtPunch } from '../../lib/format';

const statusClass = (s) => {
  const c = String(s || '').toLowerCase();
  if (c.includes('present')) return 'badge--present';
  if (c.includes('absent')) return 'badge--absent';
  if (c.includes('miss')) return 'badge--miss';
  if (c.includes('week') || c.includes('holiday')) return 'badge--weekoff';
  if (c.includes('leave')) return 'badge--leave';
  return 'badge--neutral';
};

const hoursText = (m) => {
  const n = Number(m);
  if (!Number.isFinite(n) || n <= 0) return '0';
  const h = Math.floor(n / 60);
  const r = n % 60;
  return r ? `${h}h ${r}m` : `${h}h`;
};

const daysUntil = (iso) => {
  const s = String(iso || '').slice(5, 10);
  if (!s || s.length !== 5) return null;
  const now = new Date();
  const [m, d] = s.split('-').map(Number);
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const next = new Date(now.getFullYear(), m - 1, d);
  if (next < today) next.setFullYear(now.getFullYear() + 1);
  return Math.round((next - today) / 86400000);
};

function StatCard({ label, value, suffix, sub, icon, border, iconBg, suffixClass = '' }) {
  return (
    <div className={`stat-card glass-card rounded-2xl p-5 border-l-4 ${border}`}>
      <div className="flex items-center justify-between mb-2">
        <span className="text-xs font-bold text-[var(--muted)] uppercase">{label}</span>
        <div className={`w-9 h-9 rounded-xl ${iconBg} flex items-center justify-center`}>
          <i className={`fas ${icon}`}></i>
        </div>
      </div>
      <div className="flex items-baseline gap-2">
        <span className="text-3xl font-extrabold text-[var(--text)]">{value}</span>
        {suffix ? <span className={`text-xs font-medium ${suffixClass}`}>{suffix}</span> : null}
      </div>
      <p className="text-[11px] text-[var(--muted)] mt-2">{sub}</p>
    </div>
  );
}
export default function DashboardSection() {
  const { data, error, loading, reload } = useApiData('/employee/dashboard');
  const profile = useApiData('/employee/profile');

  const present = Number(data?.present || 0);
  const absent = Number(data?.absent || 0);
  const miss = Number(data?.miss || 0);
  const late = Number(data?.late || 0);
  const hours = Number(data?.hours || 0);
  const total = present + absent + miss;
  const presentPct = total ? Math.round((present / total) * 100) : 0;
  const absentPct = total ? Math.round((absent / total) * 100) : 0;
  const missPct = total ? Math.round((miss / total) * 100) : 0;

  const trend = data?.trend || [];
  const trendLabels = trend.map((t) => String(t.date || '').slice(5));
  const trendPresent = trend.map((t) => (String(t.status || '').toLowerCase().includes('present') ? 1 : 0));
  const trendAbsent = trend.map((t) => (String(t.status || '').toLowerCase().includes('absent') ? 1 : 0));
  const trendMiss = trend.map((t) => (String(t.status || '').toLowerCase().includes('miss') ? 1 : 0));

  const trendData = {
    labels: trendLabels,
    datasets: [
      { label: 'Present', data: trendPresent, backgroundColor: '#10b981', borderRadius: 3 },
      { label: 'Absent', data: trendAbsent, backgroundColor: '#f43f5e', borderRadius: 3 },
      { label: 'Miss Punch', data: trendMiss, backgroundColor: '#f59e0b', borderRadius: 3 },
    ],
  };

  const ratioData = {
    labels: ['Present', 'Absent', 'Miss Punch'],
    datasets: [{ data: [present, absent, miss], backgroundColor: ['#10b981', '#f43f5e', '#f59e0b'], borderWidth: 0, hoverOffset: 6 }],
  };

  const dob = profile.data?.profile?.dateofbirth;
  const doj = profile.data?.profile?.dateofjoin;
  const dobDays = daysUntil(dob);
  const joinYears = doj ? Math.max(0, new Date().getFullYear() - Number(String(doj).slice(0, 4))) : null;

  return (
    <AsyncBox loading={loading} error={error} onRetry={reload} label="Dashboard load ho raha hai...">
      {data ? (
        <>
          <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4">
            <StatCard label="Present Days" value={present} suffix={`/ ${total} Days`} suffixClass="text-emerald-400" sub="Current Month Attendance" icon="fa-calendar-check" border="border-l-emerald-500" iconBg="bg-emerald-500/20 text-emerald-400" />
            <StatCard label="Absent Days" value={absent} suffix="Days" suffixClass="text-rose-400" sub="Leaves / Unscheduled" icon="fa-calendar-xmark" border="border-l-rose-500" iconBg="bg-rose-500/20 text-rose-400" />
            <StatCard label="Missed Punches" value={miss} suffix="Punches" suffixClass="text-amber-400" sub="In/Out punch missing" icon="fa-triangle-exclamation" border="border-l-amber-500" iconBg="bg-amber-500/20 text-amber-400" />
            <StatCard label="Late Arrivals" value={late} suffix="After 09:15" suffixClass="text-[var(--accent-soft)]" sub={`Total Output: ${hoursText(hours)}`} icon="fa-business-time" border="border-l-indigo-500" iconBg="bg-indigo-500/20 text-indigo-400" />
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
            <div className="glass-card rounded-3xl p-6 lg:col-span-2">
              <h3 className="font-bold text-sm text-[var(--text)] flex items-center gap-2 mb-1">
                <i className="fas fa-chart-line text-indigo-400"></i> Attendance Trends (Last 30 Days)
              </h3>
              <p className="text-xs text-[var(--muted)] mb-4">Daily Present vs Absent from <span className="mono text-[var(--accent-soft)]">dbo.tbltimeregister</span></p>
              <ChartCanvas type="bar" data={trendData} options={{ scales: { x: { stacked: true, ticks: { maxRotation: 0, autoSkip: true, maxTicksLimit: 10 } }, y: { stacked: true, beginAtZero: true, ticks: { stepSize: 1 } } } }} height={250} />
            </div>
            <div className="glass-card rounded-3xl p-6 flex flex-col">
              <div className="mb-4">
                <h3 className="font-bold text-sm text-[var(--text)] flex items-center gap-2"><i className="fas fa-chart-pie text-indigo-400"></i> Monthly Ratio</h3>
                <p className="text-xs text-[var(--muted)]">Current Month Distribution</p>
              </div>
              <div className="relative h-44 flex items-center justify-center">
                <ChartCanvas type="doughnut" data={ratioData} options={{ cutout: '72%', plugins: { legend: { display: false } } }} height={170} />
                <div className="absolute inset-0 flex flex-col items-center justify-center pointer-events-none">
                  <span className="text-2xl font-extrabold text-emerald-400">{presentPct}%</span>
                  <span className="text-[9px] uppercase tracking-widest text-[var(--muted)] font-bold">Present</span>
                </div>
              </div>
              <div className="grid grid-cols-2 gap-2.5 mt-4">
                <div className="p-3 rounded-xl bg-rose-500/10 border border-rose-500/20 text-center">
                  <p className="text-base font-extrabold text-rose-400">{absentPct}%</p>
                  <p className="text-[9px] text-[var(--muted)] uppercase font-bold mt-0.5">Absent</p>
                </div>
                <div className="p-3 rounded-xl bg-amber-500/10 border border-amber-500/20 text-center">
                  <p className="text-base font-extrabold text-amber-400">{missPct}%</p>
                  <p className="text-[9px] text-[var(--muted)] uppercase font-bold mt-0.5">Miss Punch</p>
                </div>
              </div>
            </div>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            <div className="glass-card rounded-3xl p-6 border-l-4 border-l-pink-500">
              <h3 className="font-bold text-sm text-[var(--text)] flex items-center gap-2 mb-1"><i className="fas fa-cake-candles text-pink-400"></i> My Birthday</h3>
              <p className="text-xs text-[var(--muted)] mb-3">Source: <span className="mono text-[var(--accent-soft)]">dbo.tblemployee.dateofbirth</span></p>
              <div className="text-sm text-[var(--text)]">
                {dob ? `${prettyDate(dob)}${dobDays != null ? ` · in ${dobDays} day${dobDays === 1 ? '' : 's'}` : ''}` : '—'}
              </div>
            </div>
            <div className="glass-card rounded-3xl p-6 border-l-4 border-l-amber-500">
              <h3 className="font-bold text-sm text-[var(--text)] flex items-center gap-2 mb-1"><i className="fas fa-award text-amber-400"></i> My Work Anniversary</h3>
              <p className="text-xs text-[var(--muted)] mb-3">Source: <span className="mono text-[var(--accent-soft)]">dbo.tblemployee.dateofjoin</span></p>
              <div className="text-sm text-[var(--text)]">
                {doj ? `${prettyDate(doj)}${joinYears != null ? ` · ${joinYears} year${joinYears === 1 ? '' : 's'}` : ''}` : '—'}
              </div>
            </div>
          </div>

          <div className="glass-card rounded-3xl p-6">
            <div className="flex flex-wrap items-center justify-between gap-4 mb-4">
              <div>
                <h3 className="font-bold text-sm text-[var(--text)] flex items-center gap-2"><i className="fas fa-bolt text-amber-400"></i> Recent Savior Biometric Punches</h3>
                <p className="text-xs text-[var(--muted)]">Live synced records from hardware reader</p>
              </div>
            </div>
            {(data.attendance || []).length ? (
              <div className="overflow-x-auto">
                <table className="portal-table">
                  <thead><tr><th>Date</th><th>In-Time</th><th>Out-Time</th><th>Worked</th><th>Status</th></tr></thead>
                  <tbody>
                    {(data.attendance || []).slice(0, 10).map((r, i) => (
                      <tr key={i}>
                        <td>{prettyDate(r.date)}</td>
                        <td>{fmtPunch(r.inTime) || '—'}</td>
                        <td>{fmtPunch(r.outTime) || '—'}</td>
                        <td>{hoursText(r.hoursworked)}</td>
                        <td><span className={`badge ${statusClass(r.computedStatus || r.statusLabel)}`}>{r.computedStatus || r.statusLabel || '—'}</span></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <p className="text-xs text-[var(--muted)]">Is period ka koi attendance record nahi hai.</p>
            )}
          </div>
        </>
      ) : null}
    </AsyncBox>
  );
}


