'use client';

// web-next/components/hr/LateEmployeesModal.jsx — Late Employees detail (parity with index.html showLateEmployeesHover/openLateEmployeesAudit).
// Real data: GET /api/hr/late-employees?fromDate=&toDate=  → { late, employees: [...] }.

import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import apiFetch from '../../lib/api';
import { prettyDate } from '../../lib/format';
import ExecPunch from './ExecPunch';

export default function LateEmployeesModal({ onClose, onAudit }) {
  const [data, setData] = useState(null);
  const [error, setError] = useState('');
  const closeButtonRef = useRef(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const d = new Date();
        const iso = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
        const res = await apiFetch(`/hr/late-employees?fromDate=${iso}&toDate=${iso}`);
        if (!cancelled) setData(res);
      } catch (e) {
        if (!cancelled) setError(e?.message || 'Late details load nahi ho paye.');
      }
    })();
    return () => { cancelled = true; };
  }, []);

  // Focus + Esc handling so the dialog is reachable and dismissible (ARIA):
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

  const employees = data?.employees || [];

  const modal = (
    <div role="dialog" aria-modal="true" aria-labelledby="late-heading" className="exec-view fixed inset-0 z-[70] flex items-center justify-center p-4" style={{ background: 'rgba(4,3,13,.82)', backdropFilter: 'blur(8px)' }} onClick={onClose}>
      <div className="pop-in glass rounded-3xl w-full max-w-3xl flex flex-col overflow-hidden shadow-2xl" style={{ maxHeight: 'calc(100dvh - 32px)' }} onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between px-5 py-4 border-b border-white/10 shrink-0">
          <h3 id="late-heading" className="font-bold text-base text-[var(--text)] flex items-center gap-2">
            <span className="w-9 h-9 rounded-xl bg-indigo-500/20 text-indigo-400 flex items-center justify-center shrink-0"><i className="fas fa-business-time"></i></span>
            Late Employees
          </h3>
          <button ref={closeButtonRef} type="button" onClick={onClose} className="w-8 h-8 rounded-lg bg-white/5 hover:bg-white/15 text-slate-400 hover:text-white transition flex items-center justify-center" aria-label="Close"><i className="fas fa-times text-sm"></i></button>
        </div>

        <div className="p-5 overflow-y-auto min-h-0 flex-1">
        {error ? (
          <div className="p-4 rounded-2xl bg-rose-500/10 border border-rose-500/20 text-sm text-rose-300">{error}</div>
        ) : !data ? (
          <div className="p-5 rounded-2xl bg-indigo-500/10 border border-indigo-500/20 text-sm text-[var(--text)]"><i className="fas fa-spinner fa-spin mr-2"></i>Loading late details...</div>
        ) : employees.length === 0 ? (
          <p className="text-xs text-[var(--muted)] py-6 text-center">No late attendance records for today.</p>
        ) : (
          <>
            <p className="text-xs text-[var(--muted)] mb-3">{data.late ?? employees.length} late employee(s)</p>
            <div className="overflow-x-auto">
              <table className="portal-table">
                <thead><tr><th>ID</th><th>Name</th><th>Department</th><th>Designation</th><th>Date</th><th>In</th><th>Out</th><th>Status</th><th className="text-center">Audit</th></tr></thead>
                <tbody>
                  {employees.map((e, i) => (
                    <tr key={e.paycode + i}>
                      <td className="mono text-indigo-300">{e.paycode}</td>
                      <td className="font-semibold text-[var(--text)]">{e.empname}</td>
                      <td className="text-[var(--muted)]">{e.departmentname || e.departmentcode || '—'}</td>
                      <td className="text-[var(--muted)]">{e.designation || '—'}</td>
                      <td className="text-[var(--muted)]">{prettyDate(e.date || e.dateoffice)}</td>
                      <td><ExecPunch value={e.inTime} side="in" /></td>
                      <td><ExecPunch value={e.outTime} side="out" /></td>
                      <td>
                        <span className="badge badge--late">Late</span>
                        {e.latearrival ? <span className="text-rose-300 mono text-[10px] ml-1.5">+{e.latearrival}m</span> : null}
                        {e.status ? <span className="text-[var(--muted)] text-[10px] ml-1.5">{e.status}</span> : null}
                      </td>
                      <td className="text-center">
                        <button type="button" onClick={() => onAudit(e.paycode)} className="px-2.5 py-1 rounded-lg bg-indigo-500/15 border border-indigo-500/30 text-indigo-300 hover:bg-indigo-500/25 font-semibold text-[11px] transition"><i className="fas fa-magnifying-glass mr-1"></i>View</button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        )}
        </div>
      </div>
    </div>
  );

  if (typeof document === 'undefined') return null;
  return createPortal(modal, document.body);
}
