'use client';

// web-next/components/hr/AuditModal.jsx — Employee audit modal (grace consumption + ascending attendance).

import { useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import useApiData from '../useApiData';
import { prettyDate, dayName, currentMonthKey } from '../../lib/format';
import { initials, hoursText } from '../../lib/hr';
import { execStatusBadgeClass } from './execStatusBadge';
import ExecPunch from './ExecPunch';

function StatBox({ value, label, cls }) {
  return (
    <div className={`p-3 rounded-xl ${cls} text-center`}>
      <p className={`text-xl font-extrabold ${cls.split(' ')[0] === 'bg-emerald-500/10' ? 'text-emerald-400' : cls.split(' ')[0] === 'bg-rose-500/10' ? 'text-rose-400' : cls.split(' ')[0] === 'bg-amber-500/10' ? 'text-amber-400' : 'text-indigo-400'}`}>{value}</p>
      <p className="text-[10px] text-[var(--muted)] uppercase">{label}</p>
    </div>
  );
}

export default function AuditModal({ paycode, onClose }) {
  const audit = useApiData(paycode ? `/hr/audit/${encodeURIComponent(paycode)}?month=${currentMonthKey()}` : null);
  const data = audit.data;
  const e = data?.employee || {};
  const stats = data?.stats || {};
  const attendance = [...(data?.attendance || [])].sort((a, b) => (String(a.date || '') < String(b.date || '') ? -1 : String(a.date || '') > String(b.date || '') ? 1 : 0));
  const lateDetails = data?.lateDetails || [];
  const grace = data?.graceRemaining || {};
  const month = currentMonthKey();
  /* PHASE 6.2C — grace eligibility (STAFF?) aur configured limits SHARED backend se
     aate hain (computeMonthlyLateForEmployee ka graceEligibility) — yahan category
     rules dobara implement nahi karte (AuditSection.jsx jaisa hi single source).
     Field na ho (legacy response) to null = unknown → purana condition. */
  const graceElig = data?.graceEligibility && typeof data.graceEligibility === 'object' ? data.graceEligibility : null;
  const graceLimits = (graceElig && graceElig.limits) || { grace30min: 2, grace1hr: 1, grace2hr: 1 };
  const graceUsedOf = (key) => Math.max(0, Number(graceLimits[key] || 0) - Number(grace[key] ?? 0));
  const staffGraceEligible = graceElig ? graceElig.isStaff === true : null;
  // PHASE (audit fix): the Late Arrival Details section is shown for EVERY category
  // (Late Occurrences + Monthly Staff Grace Used). Grace eligibility only decides
  // WHICH grace sub-block renders below (used/limit vs the non-applicable message)
  // — never whether the section shows. A category ineligible for staff grace still
  // shows its complete Late Occurrences (or an explicit empty state).
  const hasGrace = true;

  const graceLabel = (d) => {
    if (d.isFinalLate) return d.graceUsed == null ? 'No grace — FINAL LATE' : 'FINAL LATE';
    if (d.graceUsed === '30min') return 'Covered by 30-min grace';
    if (d.graceUsed === '1hr') return 'Covered by 1-hr grace';
    if (d.graceUsed === '2hr') return 'Covered by 2-hr grace';
    return 'Grace applied';
  };

  const closeButtonRef = useRef(null);

  // Escape + focus handling so the dialog is reachable and dismissible (ARIA).
  useEffect(() => {
    closeButtonRef.current?.focus();
    const onKey = (e) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);

  // Lock background page scroll while the dialog is open; restore on unmount.
  useEffect(() => {
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => { document.body.style.overflow = prevOverflow; };
  }, []);

  const modal = (
    <div role="dialog" aria-modal="true" aria-labelledby="audit-heading" className="exec-view fixed inset-0 z-[60] flex items-center justify-center p-4" style={{ background: 'rgba(4,3,13,.82)', backdropFilter: 'blur(8px)' }} onClick={onClose}>
      <div className="pop-in glass rounded-3xl w-full max-w-5xl flex flex-col overflow-hidden shadow-2xl" style={{ maxHeight: 'calc(100dvh - 32px)' }} onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between px-5 py-4 border-b border-white/10 shrink-0">
          <h3 id="audit-heading" className="font-bold text-base text-[var(--text)] flex items-center gap-2">
            <span className="w-9 h-9 rounded-xl bg-indigo-500/20 text-indigo-400 flex items-center justify-center shrink-0"><i className="fas fa-id-badge"></i></span>
            Employee Attendance Audit
          </h3>
          <button ref={closeButtonRef} type="button" onClick={onClose} className="w-8 h-8 rounded-lg bg-white/5 hover:bg-white/15 text-slate-400 hover:text-white transition flex items-center justify-center" aria-label="Close"><i className="fas fa-times text-sm"></i></button>
        </div>

        <div className="p-5 overflow-y-auto min-h-0 flex-1">
        {audit.loading ? (
          <div className="p-5 rounded-2xl bg-indigo-500/10 border border-indigo-500/20 text-sm text-[var(--text)]"><i className="fas fa-spinner fa-spin mr-2"></i>Loading attendance details for {month}...</div>
        ) : audit.error ? (
          <div className="p-5 rounded-2xl bg-rose-500/10 border border-rose-500/20 text-sm text-rose-300">Audit load nahi ho paya. <button onClick={audit.reload} className="underline ml-2">Retry</button></div>
        ) : data ? (
          <>
            <div className="flex items-center gap-4 p-4 rounded-2xl bg-white/5 border border-white/5">
              <div className="w-14 h-14 rounded-2xl card-gradient-1 flex items-center justify-center font-extrabold text-white overflow-hidden shrink-0">{initials(e.empname)}</div>
              <div className="min-w-0">
                <p className="font-extrabold text-[var(--text)]">{e.empname || '—'}</p>
                <p className="text-xs text-[var(--accent-soft)] font-semibold">{e.designation || '—'} • {e.departmentname || e.departmentcode || '—'}</p>
                <p className="text-[10px] text-[var(--muted)] mono mt-0.5">Paycode {e.paycode} | Card {e.presentcardno || '—'} | {e.companyname || e.companycode || '—'}</p>
              </div>
            </div>

            <div className="grid grid-cols-2 sm:grid-cols-5 gap-3 mt-4">
              <StatBox value={Number(stats.present || 0)} label="Present" cls="bg-emerald-500/10 border border-emerald-500/20" />
              <StatBox value={Number(stats.absent || 0)} label="Absent" cls="bg-rose-500/10 border border-rose-500/20" />
              <StatBox value={Number(stats.miss || 0)} label="Miss Punch" cls="bg-amber-500/10 border border-amber-500/20" />
              <StatBox value={Number(stats.late || 0)} label="Late Coming" cls="bg-indigo-500/10 border border-indigo-500/20" />
              <StatBox value={hoursText(stats.hours)} label="Hours" cls="bg-indigo-500/10 border border-indigo-500/20" />
            </div>
            {hasGrace ? (
              <div className="p-4 rounded-2xl bg-white/5 border border-white/5 mt-4">
                <h4 className="text-xs font-bold uppercase tracking-wider text-[var(--muted)] mb-3 flex items-center gap-2"><i className="fas fa-clock text-amber-400"></i>Late Arrival Details (Monthly Grace Consumption)</h4>
                <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                  <div>
                    <p className="text-[10px] font-bold text-amber-300 mb-2">Late Occurrences</p>
                    <div className="max-h-64 overflow-y-auto space-y-1">
                      {lateDetails.length ? lateDetails.map((d, i) => (
                        <div key={i} className={`flex items-center justify-between gap-2 text-[10px] p-1.5 rounded border ${d.isFinalLate ? 'bg-rose-500/10 border-rose-500/20' : 'bg-emerald-500/10 border-emerald-500/20'}`}>
                          <span className="text-[var(--text)]">{prettyDate(d.date)}</span>
                          <ExecPunch value={d.inTime} side="in" />
                          <span className={`${d.isFinalLate ? 'text-rose-300' : 'text-emerald-300'} font-semibold`}>{graceLabel(d)}</span>
                          {d.lateMinutes ? <span className="text-rose-300 mono">+{d.lateMinutes}m late</span> : null}
                        </div>
                      )) : <div className="text-[10px] text-[var(--muted)] p-2">No late occurrences this month</div>}
                    </div>
                  </div>
                  {/* PHASE 6.2C — Monthly Staff Grace Used: sirf grace-eligible (STAFF)
                      employees ke liye. Hinglish: used = configured limit - bacha hua
                      (graceRemaining); limits shared backend se. Non-STAFF par ye block
                      nahi dikhta. */}
                  {staffGraceEligible !== false ? (
                    <div>
                      <p className="text-[10px] font-bold text-amber-300 mb-2">Monthly Staff Grace Used</p>
                      <div className="space-y-2">
                        <div className="flex items-center justify-between p-2 rounded bg-white/5"><span className="text-[var(--text)] text-[10px]">30-min grace ({graceLimits.grace30min} per month)</span><span className="text-[var(--text)] font-bold mono">{graceUsedOf('grace30min')}/{graceLimits.grace30min}</span></div>
                        <div className="flex items-center justify-between p-2 rounded bg-white/5"><span className="text-[var(--text)] text-[10px]">1-hr grace ({graceLimits.grace1hr} per month)</span><span className="text-[var(--text)] font-bold mono">{graceUsedOf('grace1hr')}/{graceLimits.grace1hr}</span></div>
                        <div className="flex items-center justify-between p-2 rounded bg-white/5"><span className="text-[var(--text)] text-[10px]">2-hr grace ({graceLimits.grace2hr} per month)</span><span className="text-[var(--text)] font-bold mono">{graceUsedOf('grace2hr')}/{graceLimits.grace2hr}</span></div>
                      </div>
                      <p className="text-[9px] text-[var(--muted)] mt-2">Used/Total. Universal 5-min grace applies to all categories. Staff grace consumed chronologically (smallest first).</p>
                    </div>
                  ) : (
                    <div>
                      <p className="text-[10px] font-bold text-amber-300 mb-2">Monthly Staff Grace Used</p>
                      <p className="text-[10px] text-[var(--muted)] p-2">Not applicable — ye employee STAFF category ka nahi hai, isliye monthly staff grace rules apply nahi hote. Sab late occurrences FINAL LATE count hote hain.</p>
                    </div>
                  )}
                </div>
              </div>
            ) : null}

            <div className="p-4 rounded-2xl bg-white/5 border border-white/5 mt-4">
              <h4 className="text-xs font-bold uppercase tracking-wider text-[var(--muted)] mb-3">Attendance Details for {month} ({attendance.length} days)</h4>
              {attendance.length ? (
                <div className="overflow-x-auto">
                  <table className="portal-table">
                    <thead><tr><th>Date</th><th>Day</th><th>In</th><th>Out</th><th>Hrs</th><th>Status</th></tr></thead>
                    <tbody>
                      {attendance.map((r, i) => (
                        <tr key={i}>
                          <td className="mono">{prettyDate(r.date || r.dateoffice)}</td>
                          <td>{dayName(r.date || r.dateoffice)?.slice(0, 3)}</td>
                          <td><ExecPunch value={r.inTime} side="in" /></td>
                          <td><ExecPunch value={r.outTime} side="out" /></td>
                          <td>{hoursText(r.hoursworked)}</td>
                          <td><span className={`badge ${execStatusBadgeClass(r.computedStatus || r.statusLabel)}`}>{r.computedStatus || r.statusLabel || '—'}</span></td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : (
                <p className="text-xs text-[var(--muted)]">Is month ka koi attendance nahi.</p>
              )}
            </div>
          </>
        ) : null}
        </div>
      </div>
    </div>
  );

  if (typeof document === 'undefined') return null;
  return createPortal(modal, document.body);
}

