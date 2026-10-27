'use client';

// web-next/components/hr/SalarySection.jsx — Salary / Full & Final (Phase K parity).
//
// 5 tabs, same logical workflow as the mobile app's HRSalaryManagementScreen:
//   Import / Salary Data / Rules / Dues / Estimate
//
// ONE COMMON BACKEND + SHARED DATABASE: every read and write goes through the
// SAME /api/hr/salary/* endpoints the mobile app uses (server/salary-service.js,
// dbo.HR_Salary* tables). There is NO separate website salary store — after any
// import/save/create/decision the affected lists re-fetch from the server, so the
// UI never shows stale data or claims a success the server did not confirm.
// All validation and the Full & Final calculation stay server-side; this file is
// only a thin, responsive view + input layer over the existing API contract.

import { useEffect, useState } from 'react';
import useApiData from '../useApiData';
import AsyncBox from '../employee/AsyncBox';
import ExcelImport from './ExcelImport';
import SalaryEstimateBreakdown from '../SalaryEstimateBreakdown';
import SalaryStructureSection from './SalaryStructureSection';
import apiFetch from '../../lib/api';
import { SALARY_MASTER_COLUMNS, SALARY_ELEMENT_COLUMNS, downloadCsv } from '../../lib/excelImport';
import { HrCan } from './HrAccess';

const clean = (v) => String(v == null ? '' : v).trim();
const money = (v) => (v === null || v === undefined || v === '' || Number.isNaN(Number(v)))
  ? '—' : `Rs ${Number(v).toLocaleString('en-IN', { maximumFractionDigits: 2 })}`;

/* Settlement rules — EXACT keys and accepted values from the backend contract
   (server/salary-service.js DEFAULT_CONFIG / CONFIG_RULES). Nothing invented;
   every field here exists in the mobile CONFIG_FIELDS list and dbo.HR_SalaryConfig. */
const RULE_GROUPS = [
  {
    title: 'Gratuity', icon: 'fa-award', hint: "X days' wages per completed year, qualifying service >= Y years.",
    fields: [
      ['GratuityEnabled', 'Gratuity Enabled', 'yn'],
      ['GratuityDaysPerYear', 'Days per Year', 'number'],
      ['GratuityWageDivisor', 'Wage Divisor', 'number'],
      ['GratuityQualifyingYears', 'Qualifying Years', 'number'],
      ['GratuityWageBasis', 'Wage Basis', 'enum', ['BASIC', 'GROSS']],
    ],
  },
  {
    title: 'Bonus', icon: 'fa-gift', hint: 'Bonus period, rule/rate aur eligibility — koi month hardcoded nahi hai.',
    fields: [
      ['BonusEnabled', 'Bonus Enabled', 'yn'],
      ['BonusPeriodStart', 'Period Start (YYYY-MM-DD)', 'date'],
      ['BonusPeriodEnd', 'Period End (YYYY-MM-DD)', 'date'],
      ['BonusRule', 'Bonus Rule', 'enum', ['FIXED', 'PERCENTAGE_BASIC', 'PERCENTAGE_GROSS']],
      ['BonusRate', 'Rate / Amount', 'number'],
      ['BonusEligibilityMinMonths', 'Min Service Months', 'number'],
      ['BonusProrate', 'Prorate (Y/N)', 'yn'],
    ],
  },
  {
    title: 'Leave Encashment', icon: 'fa-umbrella-beach', hint: 'Employee category-wise eligible leave types (CSV), wage basis, divisor aur max days.',
    fields: [
      ['LeaveEncashmentEnabled', 'Encashment Enabled', 'yn'],
      ['LeaveEncashmentTypesFactory', 'Types — Factory Staff (CSV)', 'text'],
      ['LeaveEncashmentTypesOffice', 'Types — Office Staff (CSV)', 'text'],
      ['LeaveEncashmentTypesDefault', 'Types — Default (CSV)', 'text'],
      ['LeaveEncashmentBasis', 'Salary Basis', 'enum', ['BASIC', 'GROSS']],
      ['LeaveEncashmentWageDivisor', 'Wage Divisor', 'number'],
      ['LeaveEncashmentMaxDays', 'Max Days (0 = no cap)', 'number'],
    ],
  },
  {
    title: 'Notice Pay / Recovery', icon: 'fa-hourglass-half', hint: 'Notice period days, salary basis aur wage divisor.',
    fields: [
      ['NoticePeriodDays', 'Notice Period (Days)', 'number'],
      ['NoticeSalaryBasis', 'Salary Basis', 'enum', ['BASIC', 'GROSS']],
      ['NoticeWageDivisor', 'Wage Divisor', 'number'],
    ],
  },
  {
    title: 'Provident Fund', icon: 'fa-piggy-bank', hint: 'Employee/employer rates aur PF wage basis.',
    fields: [
      ['PFRateEmployee', 'Employee Rate (%)', 'number'],
      ['PFRateEmployer', 'Employer Rate (%)', 'number'],
      ['PFWageBasis', 'PF Wage Basis', 'enum', ['PF_WAGE', 'BASIC']],
    ],
  },
  {
    title: 'ESI', icon: 'fa-hand-holding-medical', hint: 'Employee/employer rates, wage basis aur applicable ceiling.',
    fields: [
      ['ESIRateEmployee', 'Employee Rate (%)', 'number'],
      ['ESIRateEmployer', 'Employer Rate (%)', 'number'],
      ['ESIWageBasis', 'ESI Wage Basis', 'enum', ['ESI_WAGE', 'BASIC']],
      ['ESIWageCeiling', 'Wage Ceiling (0 = none)', 'number'],
    ],
  },
];

export default function SalarySection() {
  const [tab, setTab] = useState('import');

  // Authoritative data — always fetched from the shared backend (never local-only).
  const master = useApiData('/hr/salary/master?limit=300');
  const elements = useApiData('/hr/salary/elements?limit=500');
  const config = useApiData('/hr/salary/config');
  const dues = useApiData('/hr/salary/dues?limit=300');

  const rows = master.data?.rows || [];
  const elementRows = elements.data?.rows || [];
  const dueRows = dues.data?.rows || [];

  /* ------------------------------ Rules tab ------------------------------ */
  const [draft, setDraft] = useState({});
  const [savingRules, setSavingRules] = useState(false);
  const [rulesMsg, setRulesMsg] = useState(null); // { ok, text }

  // Jab tak user edit na kare, saved config values hi draft hain.
  useEffect(() => {
    if (config.data?.config) setDraft(config.data.config);
  }, [config.data]);

  async function saveRules() {
    if (savingRules) return;
    setSavingRules(true);
    setRulesMsg(null);
    try {
      const patch = {};
      for (const group of RULE_GROUPS) {
        for (const [key] of group.fields) patch[key] = clean(draft[key]);
      }
      // Server validates every key (CONFIG_RULES) and rejects invalid values —
      // success message tabhi dikhta hai jab server ne rules persist kiye hon.
      const res = await apiFetch('/hr/salary/config', { method: 'PUT', body: patch });
      if (res?.config) setDraft(res.config);
      setRulesMsg({ ok: true, text: 'Rules saved — ab yahi values Mobile App aur Website dono par apply hongi.' });
      config.reload();
    } catch (err) {
      setRulesMsg({ ok: false, text: err?.message || 'Rules save nahi ho paye.' });
    } finally {
      setSavingRules(false);
    }
  }

  /* ------------------------------- Dues tab ------------------------------ */
  const [dueForm, setDueForm] = useState({ paycode: '', category: 'DUE', kind: '', description: '', amount: '' });
  const [dueMsg, setDueMsg] = useState(null);
  const [dueBusy, setDueBusy] = useState(false);
  const [decidingId, setDecidingId] = useState(null);

  async function addDue(e) {
    e.preventDefault();
    if (dueBusy) return;
    setDueBusy(true);
    setDueMsg(null);
    try {
      await apiFetch('/hr/salary/dues', {
        method: 'POST',
        body: {
          paycode: clean(dueForm.paycode),
          category: clean(dueForm.category),
          kind: clean(dueForm.kind),
          description: clean(dueForm.description),
          amount: Number(dueForm.amount),
        },
      });
      setDueForm({ paycode: '', category: 'DUE', kind: '', description: '', amount: '' });
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

  /* ----------------------------- Estimate tab ---------------------------- */
  const [estForm, setEstForm] = useState({ paycode: '', leavingdate: '', notice: '' });
  const [estData, setEstData] = useState(null);
  const [estError, setEstError] = useState('');
  const [estBusy, setEstBusy] = useState(false);

  async function runEstimate(e) {
    e?.preventDefault?.();
    if (estBusy) return;
    const paycode = clean(estForm.paycode);
    if (!paycode) {
      setEstError('Employee Code required hai.');
      return;
    }
    setEstBusy(true);
    setEstError('');
    setEstData(null);
    try {
      // Same shared engine as the mobile app: GET /api/hr/salary/fullfinal/:paycode
      const params = new URLSearchParams();
      if (clean(estForm.leavingdate)) params.set('leavingdate', clean(estForm.leavingdate));
      if (clean(estForm.notice) !== '') params.set('noticeServedDays', clean(estForm.notice));
      const qs = params.toString();
      const res = await apiFetch(`/hr/salary/fullfinal/${encodeURIComponent(paycode)}${qs ? `?${qs}` : ''}`);
      setEstData(res);
    } catch (err) {
      setEstError(err?.message || 'Estimate load nahi ho paya.');
    } finally {
      setEstBusy(false);
    }
  }

  /* ------------------- Bonus settlement history (explicit) ---------------- */
  const [settlements, setSettlements] = useState([]);
  const [settleMsg, setSettleMsg] = useState(null);
  const [settleBusy, setSettleBusy] = useState(false);

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
    loadSettlements(estData?.employee?.paycode);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [estData?.employee?.paycode]);

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
          note: 'Recorded from the Full & Final estimate screen.',
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

  /* ----------------------- CSV export (preserved) ----------------------- */
  function exportMaster() {
    if (!rows.length) return;
    downloadCsv('salary-master.csv', [
      ['Paycode', 'Biometric Code', 'Employee Name', 'Company Code', 'Effective From', 'Basic Salary', 'PF Applicable', 'ESI Applicable', 'PF Wage', 'ESI Wage'],
      ...rows.map((r) => [
        r.paycode,
        r.presentcardno || '',
        r.empname || '',
        r.companycode || '',
        r.effectivefrom || '',
        r.basicsalary ?? '',
        r.pfapplicable ? 'Y' : 'N',
        r.esiapplicable ? 'Y' : 'N',
        r.pfwage ?? '',
        r.esiwage ?? '',
      ]),
    ]);
  }

  function exportElements() {
    if (!elementRows.length) return;
    downloadCsv('salary-elements.csv', [
      ['Paycode', 'Biometric Code', 'Employee Name', 'Company Code', 'Pay Element Code', 'Pay Element Name', 'Pay Element Type', 'Calculation Type', 'Amount', 'Percentage', 'Percentage Base', 'Effective From'],
      ...elementRows.map((r) => [
        r.paycode,
        r.presentcardno || '',
        r.empname || '',
        r.companycode || '',
        r.payelementcode || '',
        r.payelementname || '',
        r.payelementtype || '',
        r.calculationtype || '',
        r.amount ?? '',
        r.percentage ?? '',
        r.percentagebase || '',
        r.effectivefrom || '',
      ]),
    ]);
  }

  /* --------------------------- shared UI helpers ------------------------- */
  const tabClass = (active) => `px-3.5 py-1.5 rounded-xl text-[11px] font-bold transition ${active ? 'bg-indigo-600 text-white' : 'bg-white/5 border border-[var(--border)] text-[var(--text)] hover:bg-white/10'}`;
  const inputCls = 'px-3 py-2 rounded-xl bg-[var(--input-bg)] border border-[var(--border)] text-xs text-[var(--text)] outline-none focus:border-[var(--accent)] w-full';
  const btnGhost = 'px-3 py-2 rounded-xl bg-white/5 border border-[var(--border)] text-[var(--text)] text-[11px] font-bold transition hover:bg-white/10 disabled:opacity-40';
  const btnPrimary = 'px-4 py-2 rounded-xl card-gradient-1 text-white text-[11px] font-bold shadow-lg shadow-indigo-600/30 hover:opacity-95 transition disabled:opacity-50';
  const msgBox = (ok) => `text-[11px] rounded-xl px-3 py-2 border ${ok ? 'bg-emerald-500/10 border-emerald-500/20 text-emerald-300' : 'bg-rose-500/10 border-rose-500/20 text-rose-300'}`;

  const TABS = [
    ['import', 'Import', 'fa-cloud-arrow-up'],
    ['data', 'Salary Data', 'fa-server'],
    ['rules', 'Rules', 'fa-sliders'],
    ['dues', 'Dues', 'fa-right-left'],
    ['estimate', 'Estimate', 'fa-calculator'],
    ['structure', 'Structure', 'fa-sitemap'],
  ];

  return (
    <div className="space-y-4">
      {/* ---- header + tab bar (same 5 tabs as the mobile app) ---- */}
      <div className="glass-card rounded-3xl p-6">
        <div className="flex items-center justify-between gap-3 flex-wrap mb-4">
          <h2 className="font-bold text-lg text-[var(--text)] flex items-center gap-2"><i className="fas fa-coins text-emerald-400"></i> Salary &amp; Full &amp; Final</h2>
          <p className="text-[11px] text-[var(--muted)]">
            <i className="fas fa-database mr-1"></i>Common backend · shared database — Mobile App ke saath fully synced
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {TABS.map(([id, label, icon]) => (
            <button key={id} type="button" onClick={() => setTab(id)} className={tabClass(tab === id)}>
              <i className={`fas ${icon} mr-1`}></i>{label}
            </button>
          ))}
        </div>
      </div>

      {/* ============================== IMPORT ============================== */}
      {tab === 'import' ? (
        <HrCan module="salary" action="import">
        <div className="glass-card rounded-3xl p-6">
          <h3 className="font-bold text-base text-[var(--text)] flex items-center gap-2 mb-1"><i className="fas fa-file-excel text-teal-400"></i> Excel Import</h3>
          <p className="text-[11px] text-[var(--muted)] mb-4">
            File yahan parse hoti hai, lekin saara validation SERVER par hota hai (real active roster ke against).
            Summary hamesha backend ke actual Imported / Updated / Skipped / Failed counts dikhata hai — invalid row kabhi silently drop nahi hoti.
          </p>
          <div className="space-y-4">
            <ExcelImport
              title="Dataset A — Salary Master"
              endpoint="/hr/salary/master/import"
              templateFilename="salary-master-template.csv"
              columns={SALARY_MASTER_COLUMNS}
              hint="EmployeeCode → paycode, BiometricCode → presentcardno. EffectiveFrom = YYYY-MM-DD. PFApplicable/ESIApplicable = Y/N. PFWage/ESIWage required jab PF/ESI = Y. Duplicate rows upsert hote hain — unintended duplicates nahi bante."
              onImported={master.reload}
            />
            <ExcelImport
              title="Dataset B — Pay Elements"
              endpoint="/hr/salary/elements/import"
              templateFilename="salary-elements-template.csv"
              columns={SALARY_ELEMENT_COLUMNS}
              hint="PayElementType = EARNING / DEDUCTION / EMPLOYER_CONTRIBUTION. CalculationType = FIXED (Amount required) ya PERCENTAGE (Percentage + PercentageBase required: BASIC/GROSS/PF_WAGE/ESI_WAGE)."
              onImported={elements.reload}
            />
          </div>
        </div>
        </HrCan>
      ) : null}
      {/* =========================== SALARY DATA ============================ */}
      {tab === 'data' ? (
        <>
          <div className="glass-card rounded-3xl p-6">
            <div className="flex items-center justify-between gap-3 mb-4 flex-wrap">
              <h3 className="font-bold text-base text-[var(--text)] flex items-center gap-2"><i className="fas fa-coins text-emerald-400"></i> Salary Master</h3>
              <div className="flex items-center gap-2 flex-wrap">
                <span className="text-[11px] text-[var(--muted)]">{rows.length} row(s) · har effective-date version preserved</span>
                <HrCan module="salary" action="export">
                  <button type="button" onClick={exportMaster} disabled={!rows.length} className={btnGhost}>
                    <i className="fas fa-file-csv mr-1"></i>Export CSV
                  </button>
                </HrCan>
              </div>
            </div>
            <AsyncBox loading={master.loading} error={master.error} onRetry={master.reload} label="Salary data load ho raha hai...">
              {rows.length ? (
                <div className="table-scroll overflow-x-auto">
                  <table className="portal-table">
                    <thead>
                      <tr>
                        <th>Employee Paycode</th><th>Employee Name</th><th>Biometric Code</th><th>Company</th>
                        <th>Effective From</th><th>Basic Salary</th><th>PF Applicable</th><th>PF Wage</th>
                        <th>ESI Applicable</th><th>ESI Wage</th>
                      </tr>
                    </thead>
                    <tbody>
                      {rows.map((r, i) => (
                        <tr key={`${r.paycode}-${r.effectivefrom}-${i}`}>
                          <td className="mono">{r.paycode}</td>
                          <td className="font-semibold">{r.empname || '—'}</td>
                          <td className="mono">{r.presentcardno || '—'}</td>
                          <td className="mono">{r.companycode || '—'}</td>
                          <td className="mono">{r.effectivefrom || '—'}</td>
                          <td>{money(r.basicsalary)}</td>
                          <td>{r.pfapplicable ? 'Y' : 'N'}</td>
                          <td>{r.pfapplicable ? money(r.pfwage) : '—'}</td>
                          <td>{r.esiapplicable ? 'Y' : 'N'}</td>
                          <td>{r.esiapplicable ? money(r.esiwage) : '—'}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : (
                <p className="text-xs text-[var(--muted)] py-6 text-center">Salary data import nahi hui — Import tab se Dataset A import karein.</p>
              )}
            </AsyncBox>
          </div>


          <div className="glass-card rounded-3xl p-6">
            <div className="flex items-center justify-between gap-3 mb-4 flex-wrap">
              <h3 className="font-bold text-base text-[var(--text)] flex items-center gap-2"><i className="fas fa-list-ul text-sky-400"></i> Pay Elements</h3>
              <div className="flex items-center gap-2 flex-wrap">
                <span className="text-[11px] text-[var(--muted)]">{elementRows.length} element(s)</span>
                <HrCan module="salary" action="export">
                  <button type="button" onClick={exportElements} disabled={!elementRows.length} className={btnGhost}>
                  <i className="fas fa-file-csv mr-1"></i>Export CSV
                </button>
                </HrCan>
              </div>
            </div>
            <AsyncBox loading={elements.loading} error={elements.error} onRetry={elements.reload} label="Pay elements load ho rahe hain...">
              {elementRows.length ? (
                <div className="table-scroll overflow-x-auto">
                  <table className="portal-table">
                    <thead>
                      <tr>
                        <th>Employee Paycode</th><th>Employee Name</th><th>Element Code</th><th>Element Name</th>
                        <th>Type</th><th>Calculation Type</th><th>Amount</th><th>Percentage</th><th>Percentage Base</th><th>Effective From</th>
                      </tr>
                    </thead>
                    <tbody>
                      {elementRows.map((r, i) => (
                        <tr key={`${r.paycode}-${r.payelementcode}-${r.effectivefrom}-${i}`}>
                          <td className="mono">{r.paycode}</td>
                          <td className="font-semibold">{r.empname || '—'}</td>
                          <td className="mono">{r.payelementcode || '—'}</td>
                          <td>{r.payelementname || '—'}</td>
                          <td>{r.payelementtype || '—'}</td>
                          <td>{r.calculationtype || '—'}</td>
                          <td>{r.calculationtype === 'FIXED' ? money(r.amount) : '—'}</td>
                          <td>{r.calculationtype === 'PERCENTAGE' ? `${r.percentage ?? '—'}%` : '—'}</td>
                          <td>{r.calculationtype === 'PERCENTAGE' ? (r.percentagebase || '—') : '—'}</td>
                          <td className="mono">{r.effectivefrom || '—'}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : (
                <p className="text-xs text-[var(--muted)] py-6 text-center">Pay elements import nahi hue — Import tab se Dataset B import karein.</p>
              )}
            </AsyncBox>
          </div>
        </>
      ) : null}


      {/* =============================== RULES ============================== */}
      {tab === 'rules' ? (
        <div className="glass-card rounded-3xl p-6">
          <div className="flex items-center justify-between gap-3 flex-wrap mb-1">
            <h3 className="font-bold text-base text-[var(--text)] flex items-center gap-2"><i className="fas fa-sliders text-violet-400"></i> Settlement Rules</h3>
            <HrCan module="salary" action="edit">
              <button type="button" onClick={saveRules} disabled={savingRules} className={btnPrimary}>
                {savingRules ? <i className="fas fa-spinner fa-spin mr-1"></i> : <i className="fas fa-floppy-disk mr-1"></i>}Save Rules
              </button>
            </HrCan>
          </div>
          <p className="text-[11px] text-[var(--muted)] mb-3">
            Gratuity, bonus period, encashment, notice, PF aur ESI ke rules — sab kuch configurable (koi formula/month hardcoded nahi).
            Save karne par common backend/database update hota hai aur yahi saved values Mobile App aur Website dono par load hoti hain.
          </p>
          {rulesMsg ? <p className={`${msgBox(rulesMsg.ok)} mb-4`}><i className={`fas ${rulesMsg.ok ? 'fa-circle-check' : 'fa-circle-exclamation'} mr-1`}></i>{rulesMsg.text}</p> : null}
          <AsyncBox loading={config.loading} error={config.error} onRetry={config.reload} label="Rules load ho rahe hain...">
            <div className="space-y-5">
              {RULE_GROUPS.map((group) => (
                <div key={group.title} className="rounded-2xl border border-[var(--border)] p-4">
                  <p className="text-xs font-extrabold text-[var(--text)] mb-1"><i className={`fas ${group.icon} mr-1`} style={{ color: 'var(--accent)' }}></i>{group.title}</p>
                  <p className="text-[10px] text-[var(--muted)] mb-3">{group.hint}</p>
                  <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
                    {group.fields.map(([key, label, type, options]) => {
                      const val = clean(draft[key]);
                      const opts = type === 'yn' ? ['Y', 'N'] : (options || []);
                      const allOpts = val && !opts.includes(val) ? [val, ...opts] : opts;
                      return (
                        <div key={key}>
                          <label className="block text-[10px] font-bold uppercase text-[var(--muted)] mb-1" htmlFor={`cfg-${key}`}>{label}</label>
                          {type === 'yn' || type === 'enum' ? (
                            <select id={`cfg-${key}`} className={inputCls} value={val} onChange={(e) => setDraft({ ...draft, [key]: e.target.value })}>
                              {!val ? <option value="">—</option> : null}
                              {allOpts.map((o) => <option key={o} value={o}>{o}</option>)}
                            </select>
                          ) : type === 'date' ? (
                            <input id={`cfg-${key}`} type="date" className={inputCls} value={val}
                              onChange={(e) => setDraft({ ...draft, [key]: e.target.value })} />
                          ) : (
                            <input id={`cfg-${key}`} type="text" inputMode={type === 'number' ? 'decimal' : undefined}
                              className={`${inputCls} mono`} value={val} placeholder={clean(config.data?.config?.[key]) || ''}
                              onChange={(e) => setDraft({ ...draft, [key]: e.target.value })} />
                          )}
                        </div>
                      );
                    })}
                  </div>
                </div>
              ))}
            </div>
          </AsyncBox>
          <div className="flex items-center justify-between gap-3 flex-wrap mt-5">
            {rulesMsg ? <p className={`${msgBox(rulesMsg.ok)} flex-1`}><i className={`fas ${rulesMsg.ok ? 'fa-circle-check' : 'fa-circle-exclamation'} mr-1`}></i>{rulesMsg.text}</p> : <span />}
            <HrCan module="salary" action="edit">
              <button type="button" onClick={saveRules} disabled={savingRules} className={btnPrimary}>
                {savingRules ? <i className="fas fa-spinner fa-spin mr-1"></i> : <i className="fas fa-floppy-disk mr-1"></i>}Save Rules
              </button>
            </HrCan>
          </div>
        </div>
      ) : null}


      {/* =============================== DUES =============================== */}
      {tab === 'dues' ? (
        <>
          <div className="glass-card rounded-3xl p-6">
            <h3 className="font-bold text-base text-[var(--text)] flex items-center gap-2 mb-1"><i className="fas fa-right-left text-amber-400"></i> Other Dues / Recoveries</h3>
            <p className="text-[11px] text-[var(--muted)] mb-4">
              HR-managed dues/recoveries — sirf APPROVED entries Full &amp; Final estimate me count hoti hain.
              Entries common backend me persist hoti hain aur Mobile App par bhi dikhengi.
            </p>
            {dueMsg ? <p className={`${msgBox(dueMsg.ok)} mb-4`}><i className={`fas ${dueMsg.ok ? 'fa-circle-check' : 'fa-circle-exclamation'} mr-1`}></i>{dueMsg.text}</p> : null}
            <form onSubmit={addDue} className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
              <div>
                <label className="block text-[10px] font-bold uppercase text-[var(--muted)] mb-1" htmlFor="due-paycode">Employee Code</label>
                <input id="due-paycode" className={inputCls} value={dueForm.paycode} onChange={(e) => setDueForm({ ...dueForm, paycode: e.target.value })} placeholder="e.g. 0002" />
              </div>
              <div>
                <span className="block text-[10px] font-bold uppercase text-[var(--muted)] mb-1">Category</span>
                <div className="flex items-center gap-2">
                  {['DUE', 'RECOVERY'].map((c) => (
                    <button key={c} type="button" onClick={() => setDueForm({ ...dueForm, category: c })}
                      className={`px-3.5 py-2 rounded-xl text-[11px] font-bold transition ${dueForm.category === c ? 'bg-indigo-600 text-white' : 'bg-white/5 border border-[var(--border)] text-[var(--text)] hover:bg-white/10'}`}>
                      {c}
                    </button>
                  ))}
                </div>
              </div>
              <div>
                <label className="block text-[10px] font-bold uppercase text-[var(--muted)] mb-1" htmlFor="due-kind">Kind</label>
                <input id="due-kind" className={inputCls} value={dueForm.kind} onChange={(e) => setDueForm({ ...dueForm, kind: e.target.value })} placeholder="e.g. arrears, incentive, loan, asset recovery" />
              </div>
              <div className="sm:col-span-2">
                <label className="block text-[10px] font-bold uppercase text-[var(--muted)] mb-1" htmlFor="due-desc">Description</label>
                <input id="due-desc" className={inputCls} value={dueForm.description} onChange={(e) => setDueForm({ ...dueForm, description: e.target.value })} placeholder="Details..." />
              </div>
              <div>
                <label className="block text-[10px] font-bold uppercase text-[var(--muted)] mb-1" htmlFor="due-amount">Amount</label>
                <input id="due-amount" className={`${inputCls} mono`} inputMode="decimal" value={dueForm.amount} onChange={(e) => setDueForm({ ...dueForm, amount: e.target.value })} placeholder="0.00" />
              </div>
              <div className="sm:col-span-2 lg:col-span-3 flex justify-end">
              <HrCan module="salary" action="create">
                <button type="submit" disabled={dueBusy} className={btnPrimary}>
                  {dueBusy ? <i className="fas fa-spinner fa-spin mr-1"></i> : <i className="fas fa-plus mr-1"></i>}Add Entry
                </button>
              </HrCan>
              </div>
            </form>
          </div>


          <div className="glass-card rounded-3xl p-6">
            <h3 className="font-bold text-base text-[var(--text)] flex items-center gap-2 mb-4"><i className="fas fa-list-check text-sky-400"></i> Added Entries</h3>
            <AsyncBox loading={dues.loading} error={dues.error} onRetry={dues.reload} label="Dues/recoveries load ho rahe hain...">
              {dueRows.length ? (
                <div className="table-scroll overflow-x-auto">
                  <table className="portal-table">
                    <thead>
                      <tr>
                        <th>Employee Code</th><th>Employee Name</th><th>Category</th><th>Kind</th>
                        <th>Description</th><th>Amount</th><th>Status</th><th>Decision</th><th className="text-center">Action</th>
                      </tr>
                    </thead>
                    <tbody>
                      {dueRows.map((d) => (
                        <tr key={d.id}>
                          <td className="mono">{d.paycode}</td>
                          <td className="font-semibold">{d.empname || '—'}</td>
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
                                <HrCan module="salary" action="approve">
                                  <button type="button" onClick={() => decideDue(d, 'Approved')} disabled={!!decidingId} className="px-2.5 py-1.5 rounded-lg bg-emerald-600 text-white text-[10px] font-bold transition hover:opacity-90 disabled:opacity-40">
                                    {decidingId === d.id ? <i className="fas fa-spinner fa-spin"></i> : 'Approve'}
                                  </button>
                                </HrCan>
                                <HrCan module="salary" action="approve">
                                  <button type="button" onClick={() => decideDue(d, 'Rejected')} disabled={!!decidingId} className="px-2.5 py-1.5 rounded-lg bg-white/5 border border-[var(--border)] text-[var(--text)] text-[10px] font-bold transition hover:bg-white/10 disabled:opacity-40">
                                    Reject
                                  </button>
                                </HrCan>
                              </span>
                            ) : '—'}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : (
                <p className="text-xs text-[var(--muted)] py-6 text-center">Koi dues/recovery entry nahi hai — upar form se add karein.</p>
              )}
            </AsyncBox>
          </div>
        </>
      ) : null}

      {/* ============================== ESTIMATE ============================= */}
      {tab === 'estimate' ? (
        <>
          <div className="glass-card rounded-3xl p-6">
            <h3 className="font-bold text-base text-[var(--text)] flex items-center gap-2 mb-1"><i className="fas fa-calculator text-indigo-400"></i> Full &amp; Final Estimate</h3>
            <p className="text-[11px] text-[var(--muted)] mb-4">
              Same shared calculation engine as the Mobile App — Employee Code, Leaving Date aur Notice Served Days ke liye
              saved rules + imported salary data se server-side estimate banta hai.
            </p>
            <form onSubmit={runEstimate} className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3 items-end">
              <div>
                <label className="block text-[10px] font-bold uppercase text-[var(--muted)] mb-1" htmlFor="est-paycode">Employee Code</label>
                <input id="est-paycode" className={inputCls} value={estForm.paycode} onChange={(e) => setEstForm({ ...estForm, paycode: e.target.value })} placeholder="e.g. 0002" />
              </div>
              <div>
                <label className="block text-[10px] font-bold uppercase text-[var(--muted)] mb-1" htmlFor="est-leaving">Leaving Date</label>
                <input id="est-leaving" type="date" className={inputCls} value={estForm.leavingdate} onChange={(e) => setEstForm({ ...estForm, leavingdate: e.target.value })} />
              </div>
              <div>
                <label className="block text-[10px] font-bold uppercase text-[var(--muted)] mb-1" htmlFor="est-notice">Notice Served Days</label>
                <input id="est-notice" className={`${inputCls} mono`} inputMode="numeric" value={estForm.notice} onChange={(e) => setEstForm({ ...estForm, notice: e.target.value })} placeholder="optional" />
              </div>
              <div>
                <button type="submit" disabled={estBusy || !clean(estForm.paycode)} className={`${btnPrimary} w-full`}>
                  {estBusy ? <i className="fas fa-spinner fa-spin mr-1"></i> : <i className="fas fa-play mr-1"></i>}Run Estimate
                </button>
              </div>
            </form>
            {estError ? <p className={`${msgBox(false)} mt-4`}><i className="fas fa-circle-exclamation mr-1"></i>{estError}</p> : null}
            <p className="text-[11px] text-[var(--muted)] mt-4">
              <i className="fas fa-triangle-exclamation mr-1"></i>
              Ye ek ESTIMATE hai — official payroll settlement nahi. Leaving date sirf estimation input hai, kahin save nahi hota.
            </p>
          </div>

          {estData ? (
            <div className="glass-card rounded-3xl p-6">
              <h3 className="font-bold text-base text-[var(--text)] flex items-center gap-2 mb-4">
                <i className="fas fa-file-invoice-dollar text-emerald-400"></i>
                {clean(estData.employee?.empname) || clean(estData.employee?.paycode)} — Estimate
              </h3>
              <SalaryEstimateBreakdown data={estData} />

              {/* ---- Bonus settlement history (explicit HR records only) ---- */}
              {estData.estimate?.bonus?.enabled ? (
                <div className="mt-4 rounded-2xl border border-[var(--border)] p-4">
                  <div className="flex items-center justify-between gap-3 flex-wrap">
                    <div className="min-w-0">
                      <p className="text-xs font-extrabold text-[var(--text)]"><i className="fas fa-file-signature mr-1" style={{ color: 'var(--accent)' }}></i>Bonus Settlement History</p>
                      <p className="text-[10px] text-[var(--muted)] mt-0.5">
                        Estimate kabhi automatically bonus paid mark nahi karta. Sirf neeche Record karne par woh service settled maani jaati hai.
                      </p>
                    </div>
                    <HrCan module="salary" action="create">
                      <button type="button" onClick={recordSettlement} disabled={settleBusy || !estData.estimate.bonus.eligible || !(Number(estData.estimate.bonus.amount) > 0)} className={btnGhost}>
                        <i className="fas fa-stamp mr-1"></i>Record Bonus Settlement ({money(estData.estimate.bonus.amount)})
                      </button>
                    </HrCan>
                  </div>
                  {settleMsg ? <p className={`${msgBox(settleMsg.ok)} mt-3`}>{settleMsg.text}</p> : null}
                  {settlements.length ? (
                    <div className="table-scroll overflow-x-auto mt-3">
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
                                <HrCan module="salary" action="delete">
                                  <button type="button" onClick={() => removeSettlement(s.id)} disabled={settleBusy} className="px-2.5 py-1.5 rounded-lg bg-white/5 border border-[var(--border)] text-[var(--text)] text-[10px] font-bold disabled:opacity-40">Remove</button>
                                </HrCan>
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
        </>
      ) : null}

      {/* ============================= STRUCTURE ============================ */}
      {tab === 'structure' ? <SalaryStructureSection /> : null}
    </div>
  );
}

