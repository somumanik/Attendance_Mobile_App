'use client';

// web-next/components/superadmin/FullFinalSection.jsx — Full & Final Management
// (SuperAdmin console). DISTINCT management module, SAME existing engine.
//
// Every number below comes from the ONE common backend calculation service
// (server/salary-service.js computeFullFinal via GET /api/hr/salary/fullfinal/
// :paycode) with the SAVED settlement configuration (dbo.HR_SalaryConfig) — the
// identical endpoint the mobile app and the HR Estimate tab call. NOTHING is
// calculated in this file: the component is a view + input layer over the shared
// API, and the component-wise breakdown is rendered by the same shared
// SalaryEstimateBreakdown used everywhere else. Leaving date / notice inputs are
// estimation-only and are never persisted. The result is an ESTIMATE subject to
// the existing HR/payroll approval process.

import { useEffect, useState } from 'react';
import apiFetch from '../../lib/api';
import useApiData from '../useApiData';
import SalaryEstimateBreakdown from '../SalaryEstimateBreakdown';

const clean = (v) => String(v == null ? '' : v).trim();
const money = (v) => (v === null || v === undefined || v === '' || Number.isNaN(Number(v)))
  ? '—' : `Rs ${Number(v).toLocaleString('en-IN', { maximumFractionDigits: 2 })}`;

const inputCls = 'px-3 py-2 rounded-xl bg-[var(--input-bg)] border border-[var(--border)] text-xs text-[var(--text)] outline-none focus:border-[var(--accent)] w-full';
const btnGhost = 'px-3 py-2 rounded-xl bg-white/5 border border-[var(--border)] text-[var(--text)] text-[11px] font-bold transition hover:bg-white/10 disabled:opacity-40';
const btnPrimary = 'px-4 py-2 rounded-xl card-gradient-1 text-white text-[11px] font-bold shadow-lg shadow-indigo-600/30 hover:opacity-95 transition disabled:opacity-50';
const msgBox = (ok) => `text-[11px] rounded-xl px-3 py-2 border ${ok ? 'bg-emerald-500/10 border-emerald-500/20 text-emerald-300' : 'bg-rose-500/10 border-rose-500/20 text-rose-300'}`;

/**
 * Saved settlement configuration keys — EXACT keys of the backend contract
 * (server/salary-service.js DEFAULT_CONFIG / dbo.HR_SalaryConfig). This panel is
 * READ-ONLY: rules are edited in Salary Management → Rules and both platforms
 * read the same saved rows. Values that are not configured keep the engine's
 * pending/not-configured behaviour — nothing is invented here.
 */
const CONFIG_GROUPS = [
  ['Gratuity', ['GratuityEnabled', 'GratuityDaysPerYear', 'GratuityWageDivisor', 'GratuityQualifyingYears', 'GratuityWageBasis']],
  ['Bonus', ['BonusEnabled', 'BonusPeriodStart', 'BonusPeriodEnd', 'BonusRule', 'BonusRate', 'BonusEligibilityMinMonths', 'BonusProrate']],
  ['Leave Encashment', ['LeaveEncashmentEnabled', 'LeaveEncashmentTypesFactory', 'LeaveEncashmentTypesOffice', 'LeaveEncashmentTypesDefault', 'LeaveEncashmentBasis', 'LeaveEncashmentWageDivisor', 'LeaveEncashmentMaxDays']],
  ['Notice Pay / Recovery', ['NoticePayEnabled', 'NoticePeriodDays', 'NoticePayBasis', 'NoticePayWageDivisor']],
  ['PF / ESI', ['PFEnabled', 'PFRateEmployee', 'PFRateEmployer', 'ESIEnabled', 'ESIRateEmployee', 'ESIRateEmployer']],
];

export default function FullFinalSection() {
  // ---- employee picker (real employee records only) ----
  const [empQuery, setEmpQuery] = useState('');
  const [empResults, setEmpResults] = useState([]);
  const [empBusy, setEmpBusy] = useState(false);
  const [selected, setSelected] = useState(null); // { paycode, empname, ... }

  // ---- estimate inputs (estimation only — never saved) ----
  const [leavingdate, setLeavingdate] = useState('');
  const [notice, setNotice] = useState('');
  const [noticeWaived, setNoticeWaived] = useState(false);
  const [estData, setEstData] = useState(null);
  const [estError, setEstError] = useState('');
  const [estBusy, setEstBusy] = useState(false);

  // ---- bonus settlements (explicit records; estimate never writes) ----
  const [settlements, setSettlements] = useState([]);
  const [settleMsg, setSettleMsg] = useState(null);
  const [settleBusy, setSettleBusy] = useState(false);

  // ---- dues / recoveries for the selected employee ----
  const dues = useApiData(selected?.paycode ? `/hr/salary/dues?paycode=${encodeURIComponent(selected.paycode)}&limit=300` : null);
  const [dueForm, setDueForm] = useState({ category: 'DUE', kind: '', description: '', amount: '' });
  const [dueMsg, setDueMsg] = useState(null);
  const [dueBusy, setDueBusy] = useState(false);
  const [decidingId, setDecidingId] = useState(null);

  // ---- saved settlement configuration (read-only summary) ----
  const configApi = useApiData('/hr/salary/config');
  const config = configApi.data?.config || null;

  useEffect(() => {
    if (!empQuery.trim()) { setEmpResults([]); return; }
    let active = true;
    setEmpBusy(true);
    const t = setTimeout(async () => {
      try {
        const d = await apiFetch('/employees?search=' + encodeURIComponent(empQuery.trim()) + '&pageSize=12');
        if (!active) return;
        setEmpResults(Array.isArray(d?.employees) ? d.employees : (Array.isArray(d?.rows) ? d.rows : []));
      } catch {
        if (active) setEmpResults([]);
      } finally {
        if (active) setEmpBusy(false);
      }
    }, 250);
    return () => { active = false; clearTimeout(t); };
  }, [empQuery]);

  const pickEmployee = (emp) => {
    setSelected(emp);
    setEmpQuery('');
    setEmpResults([]);
    setEstData(null);
    setEstError('');
    setSettlements([]);
    setSettleMsg(null);
    setDueMsg(null);
    setDueForm({ category: 'DUE', kind: '', description: '', amount: '' });
  };

  /* ---------------- Estimate — the shared engine only ---------------- */
  async function runEstimate(e) {
    e?.preventDefault?.();
    if (estBusy || !selected?.paycode) return;
    setEstBusy(true);
    setEstError('');
    setEstData(null);
    try {
      const params = new URLSearchParams();
      if (clean(leavingdate)) params.set('leavingdate', clean(leavingdate));
      if (clean(notice) !== '') params.set('noticeServedDays', clean(notice));
      if (noticeWaived) params.set('noticeWaived', 'true');
      const qs = params.toString();
      const res = await apiFetch(`/hr/salary/fullfinal/${encodeURIComponent(clean(selected.paycode))}${qs ? `?${qs}` : ''}`);
      setEstData(res);
    } catch (err) {
      setEstError(err?.message || 'Estimate load nahi ho paya.');
    } finally {
      setEstBusy(false);
    }
  }

  /* ---------------- Bonus settlements (explicit records) ---------------- */
  async function loadSettlements(paycode) {
    if (!clean(paycode)) { setSettlements([]); return; }
    try {
      const res = await apiFetch(`/hr/salary/bonus-settlements?paycode=${encodeURIComponent(clean(paycode))}`);
      setSettlements(res?.rows || []);
    } catch {
      setSettlements([]);
    }
  }

  useEffect(() => {
    loadSettlements(selected?.paycode);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selected?.paycode]);

  async function recordSettlement() {
    const bonus = estData?.estimate?.bonus;
    if (!bonus?.eligible || !clean(bonus.eligibleServiceFrom) || settleBusy) return;
    setSettleBusy(true);
    setSettleMsg(null);
    try {
      await apiFetch('/hr/salary/bonus-settlements', {
        method: 'POST',
        body: {
          paycode: clean(estData.employee.paycode),
          bonusperiodstart: clean(bonus.periodStart),
          bonusperiodend: clean(bonus.periodEnd),
          servicestart: clean(bonus.eligibleServiceFrom),
          serviceend: clean(bonus.eligibleServiceTo),
          amount: Number(bonus.amount) || 0,
          note: 'Recorded from the Full & Final Management module.',
        },
      });
      setSettleMsg({ ok: true, text: 'Bonus settlement recorded — estimate refresh hone par ab "previously settled" dikhega.' });
      await loadSettlements(estData.employee.paycode);
      await runEstimate();
    } catch (err) {
      setSettleMsg({ ok: false, text: err?.message || 'Settlement record nahi hua — koi change save nahi hua.' });
    } finally {
      setSettleBusy(false);
    }
  }

  async function removeSettlement(id) {
    if (settleBusy) return;
    if (!window.confirm('Remove this bonus settlement record? The service period becomes unsettled again.')) return;
    setSettleBusy(true);
    setSettleMsg(null);
    try {
      await apiFetch('/hr/salary/bonus-settlements', { method: 'DELETE', body: { ids: [id] } });
      setSettleMsg({ ok: true, text: 'Settlement record removed.' });
      await loadSettlements(estData.employee.paycode);
      await runEstimate();
    } catch (err) {
      setSettleMsg({ ok: false, text: err?.message || 'Remove fail — record abhi bhi maujood hai.' });
    } finally {
      setSettleBusy(false);
    }
  }

  /* ---------------- Dues / recoveries (shared records) ---------------- */
  async function addDue(e) {
    e.preventDefault();
    if (dueBusy || !selected?.paycode) return;
    setDueBusy(true);
    setDueMsg(null);
    try {
      await apiFetch('/hr/salary/dues', {
        method: 'POST',
        body: {
          paycode: clean(selected.paycode),
          category: clean(dueForm.category),
          kind: clean(dueForm.kind),
          description: clean(dueForm.description),
          amount: Number(dueForm.amount),
        },
      });
      setDueForm({ category: 'DUE', kind: '', description: '', amount: '' });
      setDueMsg({ ok: true, text: 'Entry add ho gayi — dono platforms par ab dikhengi.' });
      dues.reload();
    } catch (err) {
      setDueMsg({ ok: false, text: err?.message || 'Entry add nahi ho payi.' });
    } finally {
      setDueBusy(false);
    }
  }

  async function decideDue(row, decision) {
    if (decidingId) return;
    setDecidingId(row.id);
    setDueMsg(null);
    try {
      await apiFetch(`/hr/salary/dues/${encodeURIComponent(row.id)}/decision`, {
        method: 'POST',
        body: { decision, note: '' },
      });
      setDueMsg({ ok: true, text: `Entry ${decision === 'Approved' ? 'approved' : 'rejected'}.` });
      dues.reload();
    } catch (err) {
      setDueMsg({ ok: false, text: err?.message || 'Decision fail ho gaya.' });
    } finally {
      setDecidingId(null);
    }
  }

  const dueRows = dues.data?.rows || [];

  return (
    <div className="space-y-4">
      {/* ---- header ---- */}
      <div className="glass-card rounded-3xl p-6">
        <div className="flex items-center justify-between gap-3 flex-wrap mb-2">
          <h2 className="font-bold text-lg text-[var(--text)] flex items-center gap-2">
            <i className="fas fa-file-invoice-dollar text-rose-400"></i> Full &amp; Final Management
          </h2>
          <p className="text-[11px] text-[var(--muted)]">
            <i className="fas fa-database mr-1"></i>Same shared calculation engine + saved rules as the Mobile App
          </p>
        </div>
        <p className="text-[11px] text-[var(--muted)] max-w-3xl leading-relaxed">
          Gratuity, Bonus, Leave encashment, Notice pay, Other dues / recoveries aur deductions ka
          estimate server-side calculate hota hai (saved configuration ke saath) — website par koi
          formula ya rate duplicate nahi hota. Ye ek ESTIMATE hai jo existing HR/payroll approval
          process ke adheen hai.
        </p>

        {/* ---- employee picker ---- */}
        <div className="mt-4">
          <label className="block text-[10px] font-bold uppercase text-[var(--muted)] mb-1" htmlFor="ff-emp-search">
            Employee (search / select)
          </label>
          <input
            id="ff-emp-search"
            className={inputCls}
            value={empQuery}
            onChange={(e) => setEmpQuery(e.target.value)}
            placeholder="Search by name / paycode..."
          />
          {selected ? (
            <p className="text-xs text-emerald-300 mt-2">
              Selected: <span className="font-semibold">{selected.empname || '—'}</span>{' '}
              <span className="mono">({selected.paycode})</span>
              <button type="button" onClick={() => { setSelected(null); setEstData(null); setEstError(''); }} className="ml-3 underline text-[var(--muted)] hover:text-[var(--text)]">Change</button>
            </p>
          ) : (
            <div className="max-h-44 overflow-y-auto rounded-xl border border-[var(--border)] mt-2">
              {empBusy ? (
                <p className="px-3 py-2 text-xs text-[var(--muted)]"><i className="fas fa-spinner fa-spin mr-1"></i>Searching...</p>
              ) : empResults.length ? empResults.map((emp) => (
                <button key={emp.paycode} type="button" onClick={() => pickEmployee(emp)} className="w-full text-left px-3 py-2 text-xs text-[var(--text)] hover:bg-white/5 transition">
                  <span className="font-semibold">{emp.empname}</span> <span className="mono text-[var(--muted)]">({emp.paycode})</span>
                  {emp.companycode ? <span className="text-[var(--muted)]"> · {emp.companycode}</span> : null}
                </button>
              )) : (
                <p className="px-3 py-2 text-xs text-[var(--muted)]">
                  {empQuery.trim() ? 'Koi employee nahi mila — search karein.' : 'Employee search karke select karein.'}
                </p>
              )}
            </div>
          )}
        </div>
      </div>

      {/* ---- estimate inputs ---- */}
      <div className="glass-card rounded-3xl p-6">
        <h3 className="font-bold text-base text-[var(--text)] flex items-center gap-2 mb-1">
          <i className="fas fa-calculator text-indigo-400"></i> Settlement Estimate
        </h3>
        <p className="text-[11px] text-[var(--muted)] mb-4">
          Proposed leaving date aur notice served days sirf ESTIMATION inputs hain — kahin save nahi hote.
        </p>
        <form onSubmit={runEstimate} className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3 items-end">
          <div>
            <label className="block text-[10px] font-bold uppercase text-[var(--muted)] mb-1" htmlFor="ff-leaving">Proposed Leaving Date</label>
            <input id="ff-leaving" type="date" className={inputCls} value={leavingdate} onChange={(e) => setLeavingdate(e.target.value)} />
          </div>
          <div>
            <label className="block text-[10px] font-bold uppercase text-[var(--muted)] mb-1" htmlFor="ff-notice">Notice Served Days</label>
            <input id="ff-notice" className={`${inputCls} mono`} inputMode="numeric" value={notice} onChange={(e) => setNotice(e.target.value)} placeholder="optional" />
          </div>
          <div className="flex items-center gap-2 pb-2">
            <input id="ff-waived" type="checkbox" checked={noticeWaived} onChange={(e) => setNoticeWaived(e.target.checked)} className="accent-indigo-500" />
            <label htmlFor="ff-waived" className="text-[11px] font-bold text-[var(--text)]">Notice waived</label>
          </div>
          <div>
            <button type="submit" disabled={estBusy || !selected?.paycode} className={`${btnPrimary} w-full`}>
              {estBusy ? <i className="fas fa-spinner fa-spin mr-1"></i> : <i className="fas fa-play mr-1"></i>}Run Estimate
            </button>
          </div>
        </form>
        {estError ? <p className={`${msgBox(false)} mt-4`}><i className="fas fa-circle-exclamation mr-1"></i>{estError}</p> : null}
        {!selected ? (
          <p className="text-[11px] text-[var(--muted)] mt-4"><i className="fas fa-circle-info mr-1"></i>Pehle employee select karein.</p>
        ) : null}
        <p className="text-[11px] text-[var(--muted)] mt-4">
          <i className="fas fa-triangle-exclamation mr-1"></i>
          Ye ek ESTIMATE hai — official payroll settlement nahi. Final settlement existing HR/payroll
          approval process ke baad hi hoti hai.
        </p>
      </div>

      {/* ---- estimate result (shared engine response via the shared view) ---- */}
      {estData ? (
        <div className="glass-card rounded-3xl p-6">
          <h3 className="font-bold text-base text-[var(--text)] flex items-center gap-2 mb-4">
            <i className="fas fa-file-invoice-dollar text-emerald-400"></i>
            {clean(estData.employee?.empname) || clean(estData.employee?.paycode)} — Estimate
          </h3>
          <SalaryEstimateBreakdown data={estData} />

          {/* ---- Bonus settlement history (explicit records only) ---- */}
          {estData.estimate?.bonus?.enabled ? (
            <div className="mt-4 rounded-2xl border border-[var(--border)] p-4">
              <div className="flex items-center justify-between gap-3 flex-wrap">
                <div className="min-w-0">
                  <p className="text-xs font-extrabold text-[var(--text)]"><i className="fas fa-file-signature mr-1" style={{ color: 'var(--accent)' }}></i>Bonus Settlement History</p>
                  <p className="text-[10px] text-[var(--muted)] mt-0.5">
                    Estimate kabhi automatically bonus paid mark nahi karta. Sirf neeche Record karne par woh service settled maani jaati hai.
                  </p>
                </div>
                <button type="button" onClick={recordSettlement} disabled={settleBusy || !estData.estimate.bonus.eligible || !(Number(estData.estimate.bonus.amount) > 0)} className={btnGhost}>
                  <i className="fas fa-stamp mr-1"></i>Record Bonus Settlement ({money(estData.estimate.bonus.amount)})
                </button>
              </div>
              {settleMsg ? <p className={`${msgBox(settleMsg.ok)} mt-3`}>{settleMsg.text}</p> : null}
              {settlements.length ? (
                <div className="overflow-x-auto mt-3">
                  <table className="portal-table">
                    <thead>
                      <tr><th>Bonus Period</th><th>Settled Service</th><th>Amount</th><th>Status</th><th>Recorded By</th><th className="text-right">Action</th></tr>
                    </thead>
                    <tbody>
                      {settlements.map((s) => (
                        <tr key={s.id}>
                          <td className="mono">{s.bonusperiodstart} .. {s.bonusperiodend}</td>
                          <td className="mono">{s.servicestart} .. {s.serviceend}</td>
                          <td className="font-bold">{money(s.amount)}</td>
                          <td><span className="badge badge--present">{s.status}</span></td>
                          <td className="text-[10px] text-[var(--muted)]">{clean(s.createdby) || '—'}</td>
                          <td className="text-right">
                            <button type="button" onClick={() => removeSettlement(s.id)} disabled={settleBusy} className="px-2.5 py-1.5 rounded-lg bg-white/5 border border-[var(--border)] text-[var(--text)] text-[10px] font-bold disabled:opacity-40">Remove</button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : (
                <p className="text-[11px] text-[var(--muted)] mt-3">
                  Koi recorded bonus settlement nahi hai — isliye koi bonus pehle paid assume nahi hua (unsettled eligible service hi estimate me hai).
                </p>
              )}
            </div>
          ) : null}
        </div>
      ) : null}

      {/* ---- dues / recoveries (shared records, both platforms see them) ---- */}
      {selected ? (
        <div className="glass-card rounded-3xl p-6">
          <h3 className="font-bold text-base text-[var(--text)] flex items-center gap-2 mb-1">
            <i className="fas fa-right-left text-sky-400"></i> Other Dues / Recoveries — {clean(selected.empname) || clean(selected.paycode)}
          </h3>
          <p className="text-[11px] text-[var(--muted)] mb-4">
            Approved dues / recoveries isi employee ke Full &amp; Final estimate me itemised dikhte hain.
            Entries common backend me save hoti hain — Mobile App par bhi.
          </p>
          <form onSubmit={addDue} className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-3 items-end">
            <div>
              <label className="block text-[10px] font-bold uppercase text-[var(--muted)] mb-1" htmlFor="ff-due-cat">Category</label>
              <select id="ff-due-cat" className={inputCls} value={dueForm.category} onChange={(e) => setDueForm({ ...dueForm, category: e.target.value })}>
                <option value="DUE">DUE (payable)</option>
                <option value="RECOVERY">RECOVERY (deduction)</option>
              </select>
            </div>
            <div>
              <label className="block text-[10px] font-bold uppercase text-[var(--muted)] mb-1" htmlFor="ff-due-kind">Kind</label>
              <input id="ff-due-kind" className={inputCls} value={dueForm.kind} onChange={(e) => setDueForm({ ...dueForm, kind: e.target.value })} placeholder="e.g. Notice Pay" />
            </div>
            <div>
              <label className="block text-[10px] font-bold uppercase text-[var(--muted)] mb-1" htmlFor="ff-due-desc">Description</label>
              <input id="ff-due-desc" className={inputCls} value={dueForm.description} onChange={(e) => setDueForm({ ...dueForm, description: e.target.value })} placeholder="optional" />
            </div>
            <div>
              <label className="block text-[10px] font-bold uppercase text-[var(--muted)] mb-1" htmlFor="ff-due-amount">Amount</label>
              <input id="ff-due-amount" type="number" min="0" step="0.01" className={inputCls} value={dueForm.amount} onChange={(e) => setDueForm({ ...dueForm, amount: e.target.value })} placeholder="0.00" required />
            </div>
            <div>
              <button type="submit" disabled={dueBusy} className={`${btnPrimary} w-full`}>
                {dueBusy ? <i className="fas fa-spinner fa-spin mr-1"></i> : <i className="fas fa-plus mr-1"></i>}Add Entry
              </button>
            </div>
          </form>
          {dueMsg ? <p className={`${msgBox(dueMsg.ok)} mt-3`}>{dueMsg.text}</p> : null}

          <div className="mt-4">
            {dues.loading ? (
              <p className="text-[11px] text-[var(--muted)]"><i className="fas fa-spinner fa-spin mr-1"></i>Loading entries...</p>
            ) : dues.error ? (
              <p className={msgBox(false)}>{dues.error} <button type="button" onClick={dues.reload} className="underline ml-2">Retry</button></p>
            ) : dueRows.length ? (
              <div className="overflow-x-auto">
                <table className="portal-table">
                  <thead>
                    <tr><th>Category</th><th>Kind</th><th>Description</th><th>Amount</th><th>Status</th><th>Decision</th><th className="text-center">Action</th></tr>
                  </thead>
                  <tbody>
                    {dueRows.map((d) => (
                      <tr key={d.id}>
                        <td>{d.category === 'RECOVERY' ? 'RECOVERY' : 'DUE'}</td>
                        <td>{d.kind || '—'}</td>
                        <td>{d.description || '—'}</td>
                        <td className="font-bold">{money(d.amount)}</td>
                        <td>
                          <span className={`badge ${d.status === 'Approved' ? 'badge--present' : d.status === 'Rejected' ? 'badge--absent' : 'badge--miss'}`}>{d.status}</span>
                        </td>
                        <td className="text-[10px] text-[var(--muted)]">
                          {d.decidedby ? <>{d.decidedby}{d.decisionnote ? ` — ${d.decisionnote}` : ''}</> : '—'}
                        </td>
                        <td className="text-center">
                          {clean(d.status) === 'Pending' ? (
                            <span className="inline-flex items-center gap-2">
                              <button type="button" onClick={() => decideDue(d, 'Approved')} disabled={!!decidingId} className="px-2.5 py-1.5 rounded-lg bg-emerald-600 text-white text-[10px] font-bold transition hover:opacity-90 disabled:opacity-40">
                                {decidingId === d.id ? <i className="fas fa-spinner fa-spin"></i> : 'Approve'}
                              </button>
                              <button type="button" onClick={() => decideDue(d, 'Rejected')} disabled={!!decidingId} className="px-2.5 py-1.5 rounded-lg bg-white/5 border border-[var(--border)] text-[var(--text)] text-[10px] font-bold transition hover:bg-white/10 disabled:opacity-40">
                                Reject
                              </button>
                            </span>
                          ) : '—'}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <p className="text-xs text-[var(--muted)] py-4 text-center">Is employee ke liye koi dues/recovery entry nahi hai.</p>
            )}
          </div>
        </div>
      ) : null}

      {/* ---- saved settlement configuration (read-only summary) ---- */}
      <div className="glass-card rounded-3xl p-6">
        <div className="flex items-center justify-between gap-3 flex-wrap mb-1">
          <h3 className="font-bold text-base text-[var(--text)] flex items-center gap-2">
            <i className="fas fa-sliders text-amber-400"></i> Saved Settlement Configuration
          </h3>
          <p className="text-[10px] text-[var(--muted)]">
            Read-only — rules edit karne ke liye Salary Management → Rules use karein
          </p>
        </div>
        <p className="text-[11px] text-[var(--muted)] mb-4 max-w-3xl leading-relaxed">
          Neeche wahi saved rules dikhte hain jinse estimate calculate hota hai (dbo.HR_SalaryConfig —
          Mobile App aur Website dono ke liye same). Koi rule configure nahi ho to engine apna
          existing pending / not-configured behaviour preserve karta hai — koi financial result
          invent nahi kiya jata.
        </p>
        {configApi.loading ? (
          <p className="text-[11px] text-[var(--muted)]"><i className="fas fa-spinner fa-spin mr-1"></i>Loading saved configuration...</p>
        ) : configApi.error ? (
          <p className={msgBox(false)}>{configApi.error} <button type="button" onClick={configApi.reload} className="underline ml-2">Retry</button></p>
        ) : config ? (
          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
            {CONFIG_GROUPS.map(([title, keys]) => (
              <div key={title} className="rounded-2xl border border-[var(--border)] p-4">
                <p className="text-[11px] font-extrabold text-[var(--text)] mb-2">{title}</p>
                {keys.map((k) => {
                  const v = config[k];
                  const isUnset = v === undefined || v === null || v === '';
                  return (
                    <div key={k} className="flex items-start justify-between gap-3 py-1 border-b border-white/5 last:border-b-0">
                      <span className="text-[10px] text-[var(--muted)] mono min-w-0 break-all">{k}</span>
                      <span className={`text-[10px] font-bold whitespace-nowrap ${isUnset ? 'text-amber-300' : 'text-[var(--text)]'}`}>
                        {isUnset ? 'not configured' : String(v)}
                      </span>
                    </div>
                  );
                })}
              </div>
            ))}
          </div>
        ) : (
          <p className="text-[11px] text-[var(--muted)]">Koi saved configuration nahi mili — engine defaults / not-configured behaviour apply hoga.</p>
        )}
      </div>
    </div>
  );
}