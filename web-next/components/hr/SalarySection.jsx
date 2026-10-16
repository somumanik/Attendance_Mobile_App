'use client';

// web-next/components/hr/SalarySection.jsx — Salary / Payroll.
// Read-only lists (authoritative data) + Excel import for Dataset A (Salary Master)
// and Dataset B (Pay Elements), plus CSV export of each list (permission-scoped by
// the backend). All import/export reuses the existing mobile/backend contracts.

import useApiData from '../useApiData';
import AsyncBox from '../employee/AsyncBox';
import ExcelImport from './ExcelImport';
import { SALARY_MASTER_COLUMNS, SALARY_ELEMENT_COLUMNS, downloadCsv } from '../../lib/excelImport';

export default function SalarySection() {
  const master = useApiData('/hr/salary/master');
  const elements = useApiData('/hr/salary/elements');
  const rows = master.data?.rows || [];
  const elementRows = elements.data?.rows || [];

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

  return (
    <div className="space-y-4">
      <div className="glass-card rounded-3xl p-6">
        <div className="flex items-center justify-between gap-3 mb-4 flex-wrap">
          <h3 className="font-bold text-base text-[var(--text)] flex items-center gap-2"><i className="fas fa-coins text-emerald-400"></i> Salary Master</h3>
          <button type="button" onClick={exportMaster} disabled={!rows.length} className="px-3.5 py-2 rounded-xl bg-white/5 border border-[var(--border)] text-[var(--text)] text-[11px] font-bold transition hover:bg-white/10 disabled:opacity-40">
            <i className="fas fa-file-csv mr-1"></i>Export CSV
          </button>
        </div>
        <AsyncBox loading={master.loading} error={master.error} onRetry={master.reload} label="Salary data load ho raha hai...">
          {rows.length ? (
            <div className="overflow-x-auto">
              <table className="portal-table">
                <thead><tr><th>Paycode</th><th>Name</th><th>Effective From</th><th>Basic</th><th>PF</th><th>ESI</th></tr></thead>
                <tbody>
                  {rows.map((r, i) => (
                    <tr key={i}>
                      <td className="mono">{r.paycode}</td>
                      <td>{r.empname || ''}</td>
                      <td className="mono">{r.effectivefrom || '—'}</td>
                      <td>{r.basicsalary ?? ''}</td>
                      <td>{r.pfapplicable ? 'Y' : 'N'}</td>
                      <td>{r.esiapplicable ? 'Y' : 'N'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <p className="text-xs text-[var(--muted)] py-6 text-center">Salary data import nahi hui (niche Excel import ke baad dikhega).</p>
          )}
        </AsyncBox>
      </div>

      <div className="glass-card rounded-3xl p-6">
        <div className="flex items-center justify-between gap-3 mb-4 flex-wrap">
          <h3 className="font-bold text-base text-[var(--text)] flex items-center gap-2"><i className="fas fa-list-ul text-sky-400"></i> Pay Elements</h3>
          <button type="button" onClick={exportElements} disabled={!elementRows.length} className="px-3.5 py-2 rounded-xl bg-white/5 border border-[var(--border)] text-[var(--text)] text-[11px] font-bold transition hover:bg-white/10 disabled:opacity-40">
            <i className="fas fa-file-csv mr-1"></i>Export CSV
          </button>
        </div>
        <AsyncBox loading={elements.loading} error={elements.error} onRetry={elements.reload} label="Pay elements load ho rahe hain...">
          {elementRows.length ? (
            <div className="overflow-x-auto">
              <table className="portal-table">
                <thead><tr><th>Paycode</th><th>Name</th><th>Element Code</th><th>Element Name</th><th>Type</th><th>Calc</th><th>Value</th><th>From</th></tr></thead>
                <tbody>
                  {elementRows.map((r, i) => (
                    <tr key={i}>
                      <td className="mono">{r.paycode}</td>
                      <td>{r.empname || ''}</td>
                      <td className="mono">{r.payelementcode || ''}</td>
                      <td>{r.payelementname || ''}</td>
                      <td>{r.payelementtype || ''}</td>
                      <td>{r.calculationtype || ''}</td>
                      <td>{r.calculationtype === 'PERCENTAGE' ? `${r.percentage ?? ''}% of ${r.percentagebase || ''}` : (r.amount ?? '')}</td>
                      <td className="mono">{r.effectivefrom || '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <p className="text-xs text-[var(--muted)] py-6 text-center">Pay elements import nahi hue (niche Excel import ke baad dikhenge).</p>
          )}
        </AsyncBox>
      </div>

      <div className="glass-card rounded-3xl p-6">
        <h3 className="font-bold text-base text-[var(--text)] flex items-center gap-2 mb-4"><i className="fas fa-file-excel text-teal-400"></i> Excel Import</h3>
        <div className="space-y-4">
          <ExcelImport
            title="Dataset A — Salary Master"
            endpoint="/hr/salary/master/import"
            templateFilename="salary-master-template.csv"
            columns={SALARY_MASTER_COLUMNS}
            hint="EmployeeCode → paycode, BiometricCode → presentcardno. EffectiveFrom = YYYY-MM-DD. PFApplicable/ESIApplicable = Y/N. PFWage/ESIWage required jab PF/ESI = Y."
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
    </div>
  );
}

