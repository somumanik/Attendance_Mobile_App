'use client';

// web-next/components/SalaryEstimateBreakdown.jsx
// Shared Full & Final ESTIMATE breakdown — HR "Estimate" tab + employee self-service.
// PURE VIEW of the shared backend response (server/salary-service.js computeFullFinal
// / buildEstimate). Nothing is calculated or invented here — amounts, basis text,
// notes and totals all come from the one common engine, so Mobile App and Website
// always show identical results for the same inputs + saved rules.

const clean = (v) => String(v == null ? '' : v).trim();

const money = (v) => (v === null || v === undefined || v === '' || Number.isNaN(Number(v)))
  ? '—'
  : `Rs ${Number(v).toLocaleString('en-IN', { maximumFractionDigits: 2 })}`;

/** One transparent component line: label + calculation basis + amount. */
function ComponentRow({ label, basis, note, amount, negative, details }) {
  const n = Number(amount) || 0;
  return (
    <div className="flex items-start justify-between gap-4 py-2.5 border-b border-[var(--border)] last:border-b-0">
      <div className="min-w-0">
        <p className="text-xs font-semibold text-[var(--text)]">{label}</p>
        {basis ? <p className="text-[10px] text-[var(--muted)] mt-0.5 leading-relaxed">{basis}</p> : null}
        {(details || []).filter(Boolean).map((d, i) => (
          <p key={i} className="text-[10px] text-[var(--muted)] mt-0.5 leading-relaxed">{d}</p>
        ))}
        {note ? <p className="text-[10px] mt-0.5 leading-relaxed" style={{ color: 'var(--warn-soft-text)' }}>{note}</p> : null}
      </div>
      <p className="text-xs font-extrabold whitespace-nowrap" style={{ color: negative ? 'var(--err-soft-text)' : 'var(--text)' }}>
        {negative && n > 0 ? '− ' : ''}{money(negative ? Math.abs(n) : n)}
      </p>
    </div>
  );
}

/** Itemised line (dues / recoveries / deductions / employer contributions). */
function ItemList({ title, items, note }) {
  const rows = Array.isArray(items) ? items : [];
  if (!rows.length && !note) return null;
  return (
    <div className="mt-2 rounded-xl border border-[var(--border)] overflow-hidden">
      <div className="px-3 py-1.5 text-[10px] uppercase font-bold" style={{ color: 'var(--muted)', background: 'var(--surface)' }}>{title}</div>
      {rows.map((it, i) => (
        <div key={`${it.code || it.kind || 'item'}-${i}`} className="flex items-start justify-between gap-3 px-3 py-1.5 border-t border-[var(--border)]">
          <div className="min-w-0">
            <p className="text-[11px] text-[var(--text)]">
              {clean(it.name) || clean(it.kind)}
              {clean(it.code) ? <span className="mono text-[10px] text-[var(--muted)]"> · {clean(it.code)}</span> : null}
            </p>
            {clean(it.description) ? <p className="text-[10px] text-[var(--muted)]">{clean(it.description)}</p> : null}
            {clean(it.formula) ? <p className="text-[10px] text-[var(--muted)]">{clean(it.formula)}</p> : null}
          </div>
          <p className="text-[11px] font-bold text-[var(--text)] whitespace-nowrap">{money(it.amount)}</p>
        </div>
      ))}
      {note ? <p className="px-3 py-1.5 text-[10px] border-t border-[var(--border)]" style={{ color: 'var(--muted)' }}>{note}</p> : null}
    </div>
  );
}

export default function SalaryEstimateBreakdown({ data }) {
  const employee = data?.employee || {};
  const salary = data?.salary || {};
  const rules = data?.rules || {};
  const est = data?.estimate;
  const period = est?.servicePeriod;

  // Transparency detail lines (all values server-calculated; nothing invented).
  const b = est?.bonus || {};
  const bonusDetails = b.enabled === false || !clean(b.basisText) ? [] : [
    `Configured bonus period: ${clean(b.periodStart) || '(not set)'} to ${clean(b.periodEnd) || '(not set)'}${b.rule === 'FIXED' && Number(b.annualAmount) ? ` · Annual fixed bonus: ${money(b.annualAmount)}` : ''}`,
    `Eligible service period: ${clean(b.eligibleServiceFrom) || '(none)'} to ${clean(b.eligibleServiceTo) || '(none)'} = ${b.eligibleMonths ?? 0} eligible month(s) · Min-service eligibility: ${b.eligibilityMinMonths ?? 0} month(s) ${b.minServiceMet ? 'MET' : 'NOT met'} (${b.serviceAtLeavingMonths ?? 0} at leaving)`,
    `Previously settled: ${money(b.previouslySettledAmount || 0)} (${b.previouslySettledCount ?? 0} recorded settlement(s)) · Unsettled eligible period: ${b.unsettledMonths ?? 0} month(s)${(b.unsettledRanges || []).length ? ` (${b.unsettledRanges.map((r) => `${r.from}..${r.to}`).join(', ')})` : ''}`,
    `Proration basis: ${clean(b.prorationText) || (b.prorate ? 'month/day accrual' : 'full-eligibility rule')}`,
  ].concat((b.issues || []).map((i) => `Issue: ${i}`));
  const e2 = est?.leaveEncashment || {};
  const encDetails = e2.enabled === false || !clean(e2.basisText) ? [] : [
    `Monthly ${e2.basis === 'GROSS' ? 'gross' : 'basic'} salary used: ${money(e2.monthlyBasisValue)} · Annual gross/basis: ${money(e2.annualBasisValue)}`,
    `Daily salary formula: monthly x 12 / ${e2.wageDivisor} = ${money(e2.dailySalary)} per day`,
    `Eligible leave types (${clean(e2.staffGroup) || 'DEFAULT'}): ${(e2.eligibleTypes || []).join(', ') || '(none configured)'} · Eligible unused leave days: ${e2.daysBeforeCap ?? e2.days ?? 0}${e2.maxDays > 0 ? ` · Max-day cap: ${e2.maxDays}${e2.capApplied ? ' (applied)' : ' (not binding)'}` : ' · Max-day cap: 0 (no cap)'}`,
  ].concat((e2.issues || []).map((i) => `Issue: ${i}`));

  return (
    <div className="space-y-4">
      {/* ---- Employee + service summary ---- */}
      <div className="rounded-2xl border border-[var(--border)] p-4">
        <div className="flex items-start justify-between gap-3 flex-wrap">
          <div>
            <p className="text-sm font-extrabold text-[var(--text)]">
              {clean(employee.empname) || clean(employee.paycode)}
              {clean(employee.paycode) ? <span className="mono text-xs text-[var(--muted)]"> · {clean(employee.paycode)}</span> : null}
            </p>
            <p className="text-[11px] text-[var(--muted)] mt-0.5">
              {[clean(employee.designation), clean(employee.departmentcode), clean(employee.companycode), clean(employee.categorycode)].filter(Boolean).join(' · ') || '—'}
            </p>
          </div>
          <div className="text-right">
            <p className="text-[11px] text-[var(--muted)]">Joined <span className="mono text-[var(--text)]">{clean(employee.dateofjoin) || '—'}</span></p>
            <p className="text-[11px] text-[var(--muted)]">
              Leaving <span className="mono text-[var(--text)]">{clean(est?.leavingdate) || clean(employee.leavingdate) || '—'}</span>
              {clean(est?.leavingdateSource) ? <span className="text-[10px]"> ({clean(est.leavingdateSource)})</span> : null}
            </p>
            {period ? (
              <p className="text-[11px] text-[var(--muted)]">
                Service: <span className="text-[var(--text)] font-semibold">{period.years}y {period.months}m {period.days}d</span>
              </p>
            ) : null}
          </div>
        </div>
      </div>

      {/* ---- Salary snapshot (or truthful "not available") ---- */}
      {salary.available === false ? (
        <div className="rounded-2xl border p-4" style={{ borderColor: 'var(--warn)', background: 'var(--warn-soft-bg)' }}>
          <p className="text-xs font-bold" style={{ color: 'var(--warn-soft-text)' }}>Salary data available nahi hai</p>
          <p className="text-[11px] mt-1" style={{ color: 'var(--warn-soft-text)' }}>{clean(salary.reason) || 'Imported salary data ke bina estimate possible nahi hai.'}</p>
        </div>
      ) : (
        <div className="rounded-2xl border border-[var(--border)] p-4 flex items-center gap-6 flex-wrap">
          <div><p className="text-[10px] uppercase font-bold text-[var(--muted)]">Basic</p><p className="text-sm font-extrabold text-[var(--text)]">{money(est?.salaryUsed?.basic ?? salary.basic)}</p></div>
          <div><p className="text-[10px] uppercase font-bold text-[var(--muted)]">Gross</p><p className="text-sm font-extrabold text-[var(--text)]">{money(est?.salaryUsed?.gross ?? salary.gross)}</p></div>
          <div><p className="text-[10px] uppercase font-bold text-[var(--muted)]">Salary Effective From</p><p className="text-sm font-extrabold mono text-[var(--text)]">{clean(est?.salaryUsed?.effectivefrom ?? salary.effectivefrom) || '—'}</p></div>
          {(salary.warnings || []).length ? (
            <div className="w-full">
              {salary.warnings.map((w, i) => (
                <p key={i} className="text-[10px] mt-1 leading-relaxed" style={{ color: 'var(--warn-soft-text)' }}>
                  <i className="fas fa-triangle-exclamation mr-1"></i>{clean(w)}
                </p>
              ))}
            </div>
          ) : null}
        </div>
      )}

      {/* ---- Component-wise breakdown (server-calculated) ---- */}
      {est ? (
        <>
          <div className="rounded-2xl border border-[var(--border)] p-4">
            <p className="text-xs font-extrabold text-[var(--text)] mb-2"><i className="fas fa-calculator mr-1" style={{ color: 'var(--accent)' }}></i>Component-wise Breakdown</p>
            <ComponentRow label="Gratuity" basis={est.gratuity?.basisText} note={est.gratuity?.note} amount={est.gratuity?.amount} />
            <ComponentRow label="Bonus" basis={est.bonus?.basisText} details={bonusDetails} note={est.bonus?.note} amount={est.bonus?.amount} />
            <ComponentRow label="Leave Encashment" basis={est.leaveEncashment?.basisText} details={encDetails} note={est.leaveEncashment?.note} amount={est.leaveEncashment?.amount} />
            <ComponentRow label="Notice Pay" basis={est.notice?.basisText} note={est.notice?.note} amount={est.notice?.payAmount} />
            <ComponentRow label="Other Dues (approved)" basis="Approved HR dues/recoveries entries" amount={est.otherDues?.total} />
            <ItemList title="Other dues — items" items={est.otherDues?.items} />
            <ComponentRow label="Notice Recovery" basis={est.notice?.basisText} amount={est.notice?.recoveryAmount} negative />
            <ComponentRow label="Other Recoveries (approved)" basis="Approved HR dues/recoveries entries" amount={est.otherRecoveries?.total} negative />
            <ItemList title="Other recoveries — items" items={est.otherRecoveries?.items} />
            <ComponentRow label="Employee Deductions" basis="Pay elements + employee PF/ESI (configurable rules)" amount={est.employeeDeductions?.total} negative />
            <ItemList title="Employee deductions — items" items={est.employeeDeductions?.items} note={(est.employeeDeductions?.notes || []).join(' ')} />
          </div>

          {/* ---- Employer contributions (informational ONLY) ---- */}
          {Number(est.employerContributions?.total) > 0 ? (
            <div className="rounded-2xl border border-[var(--border)] p-4">
              <p className="text-xs font-extrabold text-[var(--text)] mb-1"><i className="fas fa-building mr-1" style={{ color: 'var(--muted)' }}></i>Employer Contributions (information only)</p>
              <p className="text-[10px] text-[var(--muted)] mb-2">{clean(est.employerContributions?.note)}</p>
              <ItemList title="Employer contributions — items" items={est.employerContributions?.items} />
              <div className="flex items-center justify-between pt-2 border-t border-[var(--border)]">
                <p className="text-[11px] font-semibold text-[var(--muted)]">Employer total (NOT payable)</p>
                <p className="text-xs font-extrabold text-[var(--text)]">{money(est.employerContributions?.total)}</p>
              </div>
            </div>
          ) : null}

          {/* ---- Transparent totals ---- */}
          <div className="rounded-2xl border border-[var(--border)] p-4">
            <div className="flex items-center justify-between py-1.5">
              <p className="text-[11px] font-semibold text-[var(--muted)]">Additions (Gratuity + Bonus + Encashment + Notice Pay + Other Dues)</p>
              <p className="text-xs font-bold text-[var(--text)]">{money(est.additionsTotal)}</p>
            </div>
            <div className="flex items-center justify-between py-1.5 border-t border-[var(--border)]">
              <p className="text-[11px] font-semibold text-[var(--muted)]">Subtractions (Notice Recovery + Other Recoveries + Employee Deductions)</p>
              <p className="text-xs font-bold" style={{ color: 'var(--err-soft-text)' }}>− {money(est.subtractionsTotal)}</p>
            </div>
            <div className="flex items-center justify-between pt-3 mt-2 border-t border-[var(--border)]">
              <p className="text-sm font-extrabold text-[var(--text)]">Estimated Full &amp; Final</p>
              <p className="text-lg font-extrabold" style={{ color: 'var(--accent)' }}>{money(est.estimatedTotal)}</p>
            </div>
            {est.formula ? <p className="text-[10px] text-[var(--muted)] mt-2 leading-relaxed">{clean(est.formula)}</p> : null}
          </div>
        </>
      ) : null}


      {/* ---- Applicable rules (saved configuration, readable basis) ---- */}
      {rules && (rules.gratuity || rules.bonus || rules.leaveEncashment || rules.notice || rules.pf || rules.esi) ? (
        <div className="rounded-2xl border border-[var(--border)] p-4">
          <p className="text-xs font-extrabold text-[var(--text)] mb-2"><i className="fas fa-sliders mr-1" style={{ color: 'var(--accent)' }}></i>Applicable Rules (saved configuration)</p>
          <div className="space-y-1.5">
            {[
              ['Gratuity', rules.gratuity?.basisText],
              ['Bonus', rules.bonus?.basisText],
              ['Leave Encashment', rules.leaveEncashment?.basisText],
              ['Notice', rules.notice?.basisText],
              ['PF', rules.pf?.basisText],
              ['ESI', rules.esi?.basisText],
            ].filter(([, text]) => clean(text)).map(([label, text]) => (
              <div key={label} className="flex items-start gap-3">
                <p className="text-[10px] font-bold uppercase text-[var(--muted)] w-28 shrink-0">{label}</p>
                <p className="text-[11px] text-[var(--text)] leading-relaxed">{clean(text)}</p>
              </div>
            ))}
          </div>
        </div>
      ) : null}

      {/* ---- Mandatory estimate disclaimer (never a final settlement) ---- */}
      {data?.disclaimer ? (
        <div className="rounded-2xl border p-4" style={{ borderColor: 'var(--accent-border)', background: 'var(--surface)' }}>
          <p className="text-[11px] leading-relaxed" style={{ color: 'var(--accent-soft)' }}>
            <i className="fas fa-circle-info mr-1"></i>{clean(data.disclaimer)}
          </p>
        </div>
      ) : null}
    </div>
  );
}

