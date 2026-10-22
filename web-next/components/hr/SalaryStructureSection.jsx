'use client';

// web-next/components/hr/SalaryStructureSection.jsx — SALARY STRUCTURE V1 UI.
//
// 4-sheet template download + workbook import (EmployeeSalaryMaster /
// EmployeePayElements / PayElementMaster) + shared data views + exports
// (row-based, master, pay element master and the dynamic pay-element report).
// Everything runs through the SAME /api/hr/salary/structure/* common backend
// the mobile app uses - records imported on either platform show on the other.
// Import previews show before committing; success messages only appear after
// the server confirms, and every mutation re-fetches (no stale UI).

import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import useApiData from '../useApiData';
import AsyncBox from '../employee/AsyncBox';
import apiFetch from '../../lib/api';
import {
  STRUCTURE_MASTER_COLUMNS, STRUCTURE_ELEMENT_COLUMNS, PAY_ELEMENT_MASTER_COLS,
  SHEET_NAMES, downloadStructureTemplate, parseStructureWorkbook, downloadRowsXlsx,
} from '../../lib/salaryStructure';

const clean = (v) => String(v == null ? '' : v).trim();
const money = (v) => (v === null || v === undefined || v === '' || Number.isNaN(Number(v)))
  ? '—' : `Rs ${Number(v).toLocaleString('en-IN', { maximumFractionDigits: 2 })}`;
const yn = (v) => (v === null || v === undefined ? '—' : (v ? 'Y' : 'N'));
// Export-only boolean mapping: unknown/unset value = BLANK cell (re-importable).
// Display tables use yn ('—'); exports never show a placeholder as if it were data.
const ynB = (v) => (v === null || v === undefined ? '' : v ? 'Y' : 'N');

/* Shared Add/Edit form field contracts (module scope so the modal never
   remounts while typing). optionsKey values resolve against the options map. */
const YN_OPTS = [{ value: '', label: '— (blank)' }, { value: 'Y', label: 'Y' }, { value: 'N', label: 'N' }];
const FP_OPTS = [{ value: '', label: '— select —' }, { value: 'FIXED', label: 'FIXED' }, { value: 'PERCENT', label: 'PERCENT' }];
const AD_OPTS = [{ value: '', label: '— select —' }, { value: 'ADD', label: 'ADD (earning)' }, { value: 'DEDUCT', label: 'DEDUCT (deduction)' }];
const PEM_AD_OPTS = [{ value: '', label: '— select —' }, { value: 'Addition', label: 'Addition' }, { value: 'Deduction', label: 'Deduction' }];

/* Employee Salary Master - EmployeeNumber intentionally NOT here (removed:
   Navision traceability only; Paycode is the identity). */
const MASTER_FORM_FIELDS = [
  { name: 'paycode', label: 'Paycode', type: 'select', optionsKey: 'emp', required: true },
  { name: 'effectivefrom', label: 'Effective From', type: 'date', required: true },
  { name: 'basicsalary', label: 'Basic Salary', type: 'number' },
  { name: 'pfapplicable', label: 'PF Applicable', type: 'select', optionsKey: 'yn' },
  { name: 'esiapplicable', label: 'ESI Applicable', type: 'select', optionsKey: 'yn' },
  { name: 'pfwage', label: 'PF Wage', type: 'number' },
  { name: 'esiwage', label: 'ESI Wage', type: 'number' },
  { name: 'currency', label: 'Currency' },
  { name: 'employeecode', label: 'Employee Code (Navision)' },
  { name: 'locationcode', label: 'Location Code' },
  { name: 'remarks', label: 'Remarks', type: 'textarea', wide: true },
];

const ELEM_FORM_FIELDS = [
  { name: 'paycode', label: 'Paycode', type: 'select', optionsKey: 'emp', required: true },
  { name: 'payelementcode', label: 'Pay Element Code', type: 'select', optionsKey: 'code', required: true },
  { name: 'payelementname', label: 'Pay Element Name' },
  { name: 'effectivefrom', label: 'Effective From', type: 'date', required: true },
  { name: 'fixedorpercent', label: 'Fixed / Percent', type: 'select', optionsKey: 'fp', required: true },
  { name: 'addordeduct', label: 'Add / Deduct', type: 'select', optionsKey: 'ad', required: true },
  { name: 'amount', label: 'Amount (FIXED)', type: 'number' },
  { name: 'percent', label: 'Percent (PERCENT)', type: 'number' },
  { name: 'computationtype', label: 'Computation Type' },
  { name: 'pfapplicable', label: 'PF', type: 'select', optionsKey: 'yn' },
  { name: 'ptapplicable', label: 'PT', type: 'select', optionsKey: 'yn' },
  { name: 'esiapplicability', label: 'ESI', type: 'select', optionsKey: 'yn' },
  { name: 'applicableforot', label: 'OT', type: 'select', optionsKey: 'yn' },
  { name: 'applicableforc', label: 'C-Off', type: 'select', optionsKey: 'yn' },
  { name: 'activepayelement', label: 'Active', type: 'select', optionsKey: 'yn' },
  { name: 'processed', label: 'Processed', type: 'select', optionsKey: 'yn' },
  { name: 'leaveencashment', label: 'Encash', type: 'select', optionsKey: 'yn' },
  { name: 'paycadre', label: 'Pay Cadre' },
  { name: 'payrollpostinggroup', label: 'Posting Group' },
  { name: 'employeecode', label: 'Employee Code' },
  { name: 'locationcode', label: 'Location Code' },
  { name: 'remarks', label: 'Remarks', type: 'textarea', wide: true },
];

const PEM_FORM_FIELDS = [
  { name: 'payelementcode', label: 'Code', required: true },
  { name: 'payelementname', label: 'Name', required: true },
  { name: 'description', label: 'Description' },
  { name: 'addordeduct', label: 'Add / Deduct', type: 'select', optionsKey: 'pemad', required: true },
  { name: 'applicableforot', label: 'OT', type: 'select', optionsKey: 'yn' },
  { name: 'esiapplicable', label: 'ESI', type: 'select', optionsKey: 'yn' },
  { name: 'pfapplicable', label: 'PF', type: 'select', optionsKey: 'yn' },
  { name: 'leaveencashment', label: 'Encash', type: 'select', optionsKey: 'yn' },
  { name: 'active', label: 'Active', type: 'select', optionsKey: 'yn' },
  { name: 'payrollpostinggroup', label: 'Posting Group' },
  { name: 'remarks', label: 'Remarks', type: 'textarea', wide: true },
];

/** Add/Edit modal - fields render from the contracts above; server validation
 *  errors map back onto the exact fields. */
function CrudForm({ title, fields, values, options, busy, errors, warnings, onCancel, onSubmit }) {
  const [vals, setVals] = useState(() => ({ ...values }));
  const set = (name, v) => setVals((s) => ({ ...s, [name]: v }));
  const errFor = (name) => (errors || []).find((e) => e.field === name)?.message || '';
  const cls = 'px-3 py-2 rounded-xl bg-[var(--input-bg)] border border-[var(--border)] text-xs text-[var(--text)] outline-none focus:border-[var(--accent)] w-full';

  // Background scroll-lock + Escape = Cancel. busy/onCancel refs se padhe jaate
  // hain taaki effect sirf mount/unmount par chale (lock/restore exactly once).
  const busyRef = useRef(!!busy);
  busyRef.current = !!busy;
  const cancelRef = useRef(onCancel);
  cancelRef.current = onCancel;
  useEffect(() => {
    const prevBody = document.body.style.overflow;
    const prevHtml = document.documentElement.style.overflow;
    const prevPad = document.body.style.paddingRight;
    const scrollbar = window.innerWidth - document.documentElement.clientWidth;
    document.body.style.overflow = 'hidden';
    document.documentElement.style.overflow = 'hidden';
    if (scrollbar > 0) document.body.style.paddingRight = `${scrollbar}px`;
    const onKey = (e) => {
      if (e.key === 'Escape' && !busyRef.current) cancelRef.current();
    };
    window.addEventListener('keydown', onKey);
    return () => {
      document.body.style.overflow = prevBody;
      document.documentElement.style.overflow = prevHtml;
      document.body.style.paddingRight = prevPad;
      window.removeEventListener('keydown', onKey);
    };
  }, []);

  return createPortal(
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4" style={{ background: 'rgba(0,0,0,0.55)' }} role="dialog" aria-modal="true">
      {/* Panel viewport ke centre me fixed: header/title aur Save/Cancel pinned,
          beech ka form body independently scroll hota hai (max-h 90vh). */}
      <div className="glass-card rounded-3xl w-full max-w-3xl max-h-[90vh] flex flex-col">
        <div className="p-6 pb-3 shrink-0">
          <h3 className="font-bold text-base text-[var(--text)]">{title}</h3>
          {(warnings || []).length ? (
            <div className="mt-3 rounded-xl p-2" style={{ background: 'var(--warn-soft-bg)' }}>
              {warnings.map((w, i) => <p key={i} className="text-[10px]" style={{ color: 'var(--warn-soft-text)' }}>{w}</p>)}
            </div>
          ) : null}
        </div>
        <form onSubmit={(e) => { e.preventDefault(); if (!busy) onSubmit(vals); }} className="flex flex-col min-h-0 flex-1">
          <div className="flex-1 min-h-0 overflow-y-auto px-6">
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
            {fields.map((f) => {
              const err = errFor(f.name);
              const opts = f.optionsKey ? (options[f.optionsKey] || []) : [];
              const ctl = `${cls} ${err ? 'border-red-400' : ''}`;
              return (
                <div key={f.name} className={f.wide ? 'sm:col-span-2 lg:col-span-3' : ''}>
                  <label className="block text-[10px] font-bold uppercase text-[var(--muted)] mb-1">
                    {f.label}{f.required ? ' *' : ''}
                  </label>
                  {f.type === 'select' ? (
                    <select className={ctl} value={vals[f.name] ?? ''} disabled={f.disabled || busy} onChange={(e) => set(f.name, e.target.value)}>
                      {opts.map((o) => <option key={String(o.value)} value={o.value}>{o.label}</option>)}
                    </select>
                  ) : f.type === 'textarea' ? (
                    <textarea className={ctl} rows={2} value={vals[f.name] ?? ''} disabled={f.disabled || busy} onChange={(e) => set(f.name, e.target.value)} />
                  ) : (
                    <input type={f.type || 'text'} step={f.type === 'number' ? '0.01' : undefined} min={f.type === 'number' ? '0' : undefined}
                      className={ctl} value={vals[f.name] ?? ''} disabled={f.disabled || busy}
                      onChange={(e) => set(f.name, e.target.value)} />
                  )}
                  {err ? <p className="text-[10px] mt-1" style={{ color: 'var(--err-soft-text)' }}>{err}</p> : null}
                </div>
              );
            })}
            </div>
          </div>
          <div className="flex items-center justify-end gap-2 p-6 pt-4 shrink-0">
            <button type="button" onClick={onCancel} disabled={busy} className="px-4 py-2 rounded-xl bg-white/5 border border-[var(--border)] text-[var(--text)] text-[11px] font-bold disabled:opacity-40">Cancel</button>
            <button type="submit" disabled={busy} className="px-5 py-2 rounded-xl card-gradient-1 text-white text-[11px] font-bold shadow-lg shadow-indigo-600/30 hover:opacity-95 transition disabled:opacity-50">
              {busy ? 'Saving...' : 'Save'}
            </button>
          </div>
        </form>
      </div>
    </div>,
    document.body,
  );
}

export default function SalaryStructureSection() {
  const [filters, setFilters] = useState({ paycode: '', search: '', from: '', to: '', asOf: '' });
  const [debounced, setDebounced] = useState(filters);
  useEffect(() => {
    const t = setTimeout(() => setDebounced(filters), 350);
    return () => clearTimeout(t);
  }, [filters]);

  const qs = (extra = {}) => {
    const p = new URLSearchParams();
    const f = { ...debounced, ...extra };
    if (clean(f.paycode)) p.set('paycode', clean(f.paycode));
    if (clean(f.search)) p.set('search', clean(f.search));
    if (clean(f.from)) p.set('from', clean(f.from));
    if (clean(f.to)) p.set('to', clean(f.to));
    if (clean(f.asOf)) p.set('asOf', clean(f.asOf));
    if (f.limit) p.set('limit', String(f.limit));
    const s = p.toString();
    return s ? `?${s}` : '';
  };

  const master = useApiData(`/hr/salary/structure/master${qs({ asOf: '', limit: 500 })}`);
  const elements = useApiData(`/hr/salary/structure/elements${qs({ asOf: '', limit: 1000 })}`);
  const payElementMaster = useApiData('/hr/salary/payelement-master?limit=1000');

  const masterRows = master.data?.rows || [];
  const elementRows = elements.data?.rows || [];
  const pemRows = payElementMaster.data?.rows || [];

  /* ------------------------------ Import ------------------------------ */
  const [file, setFile] = useState(null);
  const [parsed, setParsed] = useState(null);
  const [importing, setImporting] = useState(false);
  const [summaries, setSummaries] = useState(null);
  const [importError, setImportError] = useState('');
  const [tplBusy, setTplBusy] = useState(false);
  const [tplError, setTplError] = useState('');
  const [tplNotice, setTplNotice] = useState(null);

  async function onFileChosen(e) {
    const f = e.target.files && e.target.files[0];
    if (e.target) e.target.value = '';
    if (!f) return;
    setImportError('');
    setSummaries(null);
    setFile(null);
    setParsed(null);
    try {
      const result = await parseStructureWorkbook(f);
      const total = result.master.length + result.elements.length + result.payElementMaster.length;
      if (!total) {
        setImportError('Workbook me koi data row nahi mili. Template download karke sheets check karein.');
        return;
      }
      setFile(f);
      setParsed(result);
    } catch {
      setImportError('File read nahi ho payi. Valid .xlsx workbook select karein.');
    }
  }

  async function confirmImport() {
    if (!parsed || importing) return;
    setImporting(true);
    setImportError('');
    try {
      const res = await apiFetch('/hr/salary/structure/import', {
        method: 'POST',
        body: {
          master: parsed.master,
          elements: parsed.elements,
          payElementMaster: parsed.payElementMaster,
        },
      });
      setSummaries(res?.summaries || null);
      setParsed(null);
      setFile(null);
      master.reload();
      elements.reload();
      payElementMaster.reload();
    } catch (err) {
      setImportError(err?.message || 'Import service unavailable - koi data save nahi hua.');
    } finally {
      setImporting(false);
    }
  }

  /* Template download PRE-FILLED with the real saved records (read-only fetch
     through the authorized backend - same filter scope as the exports). The
     workbook stays fully re-importable: unchanged rows skip, edits update. */
  async function downloadTemplateWithData() {
    if (tplBusy) return;
    setTplBusy(true);
    setTplError('');
    setTplNotice(null);
    try {
      // SOURCE-FIRST: the pre-fill comes from the genuine Savior SQL Server
      // roster through the common backend (read-only). The application's
      // HR_Salary* tables are NEVER used as the source; salary fields Savior
      // does not contain stay BLANK and are reported explicitly.
      const src = await apiFetch('/hr/salary/structure/template-source');
      await downloadStructureTemplate('salary-structure-template.xlsx', {
        master: src?.master || [], elements: src?.elements || [], payElementMaster: src?.payElementMaster || [],
      });
      setTplNotice(src?.report || null);
    } catch {
      setTplError('Savior database se data fetch nahi ho paya — template download nahi hua (blank ya application-data fallback serve karke mislead nahi kiya). Backend/API check karke dobara try karein.');
    } finally {
      setTplBusy(false);
    }
  }

  /* ------------------------------ Exports ----------------------------- */
  async function exportMaster() {
    const res = await apiFetch(`/hr/salary/structure/master${qs({ asOf: '', limit: 5000 })}`);
    const rows = res?.rows || [];
    // EmployeeNumber intentionally excluded (removed: Navision traceability
    // only, no business use). Paycode remains the employee identity.
    const header = ['EmployeeCode', 'Paycode', 'BiometricCode', 'EmployeeName', 'CompanyCode', 'LocationCode', 'Department', 'Designation', 'EffectiveFrom', 'BasicSalary', 'PFApplicable', 'ESIApplicable', 'PFWage', 'ESIWage', 'Currency', 'Remarks'];
    await downloadRowsXlsx('employee-salary-master.xlsx', header, rows.map((r) => [
      r.employeecode, r.paycode, r.presentcardno, r.empname, r.companycode,
      r.locationcode, r.departmentcode, r.designation, r.effectivefrom, r.basicsalary,
      ynB(r.pfapplicable), ynB(r.esiapplicable), r.pfwage, r.esiwage, r.currency, r.remarks,
    ]), SHEET_NAMES.master);
  }

  async function exportElements() {
    const res = await apiFetch(`/hr/salary/structure/elements${qs({ asOf: '', limit: 5000 })}`);
    const rows = res?.rows || [];
    // Detailed row-based export = the EmployeePayElements structure exactly.
    // Unknown imported columns (extrafields) are re-emitted - never lost.
    const extraKeys = [...new Set(rows.flatMap((r) => Object.keys(r.extrafields || {})))];
    const header = ['Paycode', 'EmployeeCode', 'EmployeeName', 'CompanyCode', 'LocationCode', 'EffectiveFrom', 'PayElementCode', 'PayElementName', 'FixedOrPercent', 'Amount', 'Percent', 'ComputationType', 'AddOrDeduct', 'PFApplicable', 'PTApplicable', 'ESIApplicability', 'ApplicableForOT', 'ApplicableForCOff', 'PayCadre', 'ActivePayElement', 'Processed', 'PayrollPostingGroup', 'LeaveEncashment', 'Remarks', ...extraKeys];
    await downloadRowsXlsx('employee-pay-elements.xlsx', header, rows.map((r) => [
      r.paycode, r.employeecode, r.empname, r.companycode, r.locationcode, r.effectivefrom,
      r.payelementcode, r.payelementname, r.fixedorpercent, r.amount, r.percent,
      r.computationtype, r.addordeduct, ynB(r.pfapplicable), ynB(r.ptapplicable), ynB(r.esiapplicability),
      ynB(r.applicableforot), ynB(r.applicableforc), r.paycadre, ynB(r.activepayelement),
      ynB(r.processed), r.payrollpostinggroup, ynB(r.leaveencashment), r.remarks,
      ...extraKeys.map((k) => (r.extrafields ? r.extrafields[k] : '')),
    ]), SHEET_NAMES.elements);
  }

  async function exportPayElementMaster() {
    const res = await apiFetch('/hr/salary/payelement-master?limit=5000');
    const rows = res?.rows || [];
    // All supported master fields. Booleans export as Y/N and blank = not
    // specified (re-importable); AddDeduct exports its business values.
    const ynb = (v) => (v === null || v === undefined ? '' : v ? 'Y' : 'N');
    const ad = (v) => (v === 'ADD' ? 'Addition' : v === 'DEDUCT' ? 'Deduction' : (v || ''));
    await downloadRowsXlsx('pay-element-master.xlsx',
      ['PayElementCode', 'Description', 'PayElementName', 'AddDeduct', 'ApplicableForOT', 'ESIApplicable', 'PFApplicable', 'LeaveEncashmentApplicable', 'PayrollPostingGroup', 'Remarks', 'Active'],
      rows.map((r) => [r.payelementcode, r.description, r.payelementname, ad(r.addordeduct),
        ynb(r.applicableforot), ynb(r.esiapplicable), ynb(r.pfapplicable), ynb(r.leaveencashment),
        r.payrollpostinggroup, r.remarks, ynb(r.active)]), SHEET_NAMES.payElementMaster);
  }

  async function exportReport() {
    const rep = await apiFetch(`/hr/salary/structure/report${qs({ limit: 2000 })}`);
    const codes = rep?.elementCodes || [];
    const rows = rep?.rows || [];
    const grossCol = rep?.grossColumnAvailable ? ['Gross Salary'] : [];
    const header = ['Paycode', 'EmployeeCode', 'EmployeeName', 'CompanyCode', 'Department', 'Designation', 'EffectiveFrom', 'Currency', ...codes, ...grossCol];
    const body = rows.map((r) => [
      r.paycode, r.employeecode, r.empname, r.companycode, r.departmentcode, r.designation,
      r.effectivefrom, r.currency,
      ...codes.map((c) => (r.cells && r.cells[c] != null ? r.cells[c] : '')),
      ...(grossCol.length ? [r.gross != null ? r.gross : ''] : []),
    ]);
    await downloadRowsXlsx('salary-structure-report.xlsx', header, body, 'SalaryStructureReport');
    // Report notes travel with the file so Gross/CTC semantics stay explicit.
    await downloadRowsXlsx('salary-structure-report-notes.xlsx', ['Note'], [
      [rep?.grossRule || ''], [rep?.note || ''], [`Generated for as-of date: ${rep?.asOf || ''}`],
    ], 'Notes');
  }


  /* ------------------ Row selection + manual CRUD ------------------- */
  const [selMaster, setSelMaster] = useState(() => new Set());
  const [selElem, setSelElem] = useState(() => new Set());
  const [selPem, setSelPem] = useState(() => new Set());
  const [form, setForm] = useState(null);
  const [opMsg, setOpMsg] = useState({});
  const [busyOp, setBusyOp] = useState('');

  // Stale selections are pruned whenever the loaded data changes (refresh or
  // filter) so a removed / filtered-out row can never be edited or deleted.
  useEffect(() => {
    const prune = (prev, rows) => {
      const next = new Set([...prev].filter((id) => rows.some((r) => r.id === id)));
      return next.size === prev.size ? prev : next;
    };
    setSelMaster((prev) => prune(prev, masterRows));
    setSelElem((prev) => prune(prev, elementRows));
    setSelPem((prev) => prune(prev, pemRows));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [master.data, elements.data, payElementMaster.data]);

  // Real employee master (dbo.tblemployee) powers the Paycode selectors.
  const empData = useApiData('/hr/employees?limit=1000');
  const empRows = Array.isArray(empData.data) ? empData.data : (empData.data?.employees || empData.data?.rows || empData.data?.data || []);
  const empOptions = [{ value: '', label: '— select employee —' },
    ...empRows.map((e) => ({ value: clean(e.paycode), label: `${clean(e.paycode)} — ${clean(e.empname || e.name || '')}` }))];
  const codeOptions = [{ value: '', label: '— select code —' },
    ...pemRows.map((r) => ({ value: r.payelementcode, label: `${r.payelementcode} — ${clean(r.description || r.payelementname)}` }))];
  const YN = [{ value: '', label: '— (blank)' }, { value: 'Y', label: 'Y' }, { value: 'N', label: 'N' }];
  const boolVal = (v) => (v === null || v === undefined ? '' : v ? 'Y' : 'N');

  const toggleRow = (setter, id) => setter((prev) => {
    const next = new Set(prev);
    if (next.has(id)) next.delete(id); else next.add(id);
    return next;
  });
  const toggleAll = (setter, rows) => setter((prev) => (
    rows.length && rows.every((r) => prev.has(r.id)) ? new Set() : new Set(rows.map((r) => r.id))
  ));

  const prefill = (s, r) => {
    const iso = (d) => String(d || '').slice(0, 10);
    if (s === 'master') return {
      paycode: r.paycode, effectivefrom: iso(r.effectivefrom),
      basicsalary: r.basicsalary ?? '', pfapplicable: boolVal(r.pfapplicable), esiapplicable: boolVal(r.esiapplicable),
      pfwage: r.pfwage ?? '', esiwage: r.esiwage ?? '', currency: r.currency || '',
      employeecode: r.employeecode || '', locationcode: r.locationcode || '', remarks: r.remarks || '',
    };
    if (s === 'elem') return {
      paycode: r.paycode, payelementcode: r.payelementcode, payelementname: r.payelementname || '',
      effectivefrom: iso(r.effectivefrom), fixedorpercent: r.fixedorpercent || 'FIXED',
      amount: r.amount ?? '', percent: r.percent ?? '', computationtype: r.computationtype || '',
      addordeduct: r.addordeduct || '', pfapplicable: boolVal(r.pfapplicable), ptapplicable: boolVal(r.ptapplicable),
      esiapplicability: boolVal(r.esiapplicability), applicableforot: boolVal(r.applicableforot),
      applicableforc: boolVal(r.applicableforc), activepayelement: boolVal(r.activepayelement),
      processed: boolVal(r.processed), leaveencashment: boolVal(r.leaveencashment),
      paycadre: r.paycadre || '', payrollpostinggroup: r.payrollpostinggroup || '', remarks: r.remarks || '',
    };
    return {
      payelementcode: r.payelementcode, payelementname: r.payelementname || '', description: r.description || '',
      addordeduct: r.addordeduct === 'ADD' ? 'Addition' : r.addordeduct === 'DEDUCT' ? 'Deduction' : '',
      applicableforot: boolVal(r.applicableforot), esiapplicable: boolVal(r.esiapplicable),
      pfapplicable: boolVal(r.pfapplicable), leaveencashment: boolVal(r.leaveencashment),
      active: r.active === null || r.active === undefined ? 'Y' : boolVal(r.active),
      payrollpostinggroup: r.payrollpostinggroup || '', remarks: r.remarks || '',
    };
  };

  const sectionRows = (s) => (s === 'master' ? masterRows : s === 'elem' ? elementRows : pemRows);
  const sectionSel = (s) => (s === 'master' ? selMaster : s === 'elem' ? selElem : selPem);
  const sectionSetSel = (s) => (s === 'master' ? setSelMaster : s === 'elem' ? setSelElem : setSelPem);
  const sectionPath = (s) => (s === 'master' ? '/hr/salary/structure/master' : s === 'elem' ? '/hr/salary/structure/elements' : '/hr/salary/payelement-master');
  const sectionReload = (s) => (s === 'master' ? master.reload() : s === 'elem' ? elements.reload() : payElementMaster.reload());

  function openAdd(s) {
    setOpMsg((m) => ({ ...m, [s]: null }));
    setForm({ section: s, mode: 'add', values: {} });
  }
  function openEdit(s) {
    const sel = sectionSel(s);
    if (sel.size !== 1) return;
    const id = [...sel][0];
    const row = sectionRows(s).find((r) => r.id === id);
    if (!row) return;
    setOpMsg((m) => ({ ...m, [s]: null }));
    setForm({ section: s, mode: 'edit', rowId: id, values: prefill(s, row) });
  }

  async function saveForm(values) {
    const { section, mode, rowId } = form;
    setBusyOp('save');
    try {
      const path = sectionPath(section);
      const res = await apiFetch(mode === 'add' ? path : `${path}/${rowId}`, {
        method: mode === 'add' ? 'POST' : 'PUT', body: values,
      });
      setOpMsg((m) => ({ ...m, [section]: { type: 'ok', text: res?.message || 'Saved.' } }));
      setForm(null);
      sectionReload(section);
    } catch (err) {
      const errors = err?.data?.errors;
      if (Array.isArray(errors) && errors.length) {
        setForm((f) => (f ? { ...f, errors, warnings: err?.data?.warnings || [] } : f));
      } else {
        setOpMsg((m) => ({ ...m, [section]: { type: 'err', text: err?.message || 'Save failed - koi change save nahi hua.' } }));
        setForm(null);
      }
    } finally {
      setBusyOp('');
    }
  }

  async function deleteSelected(s) {
    const ids = [...sectionSel(s)];
    if (!ids.length) return;
    if (!window.confirm(`Delete ${ids.length} selected record(s)? This cannot be undone.`)) return;
    setBusyOp(`del-${s}`);
    try {
      const res = await apiFetch(sectionPath(s), { method: 'DELETE', body: { ids } });
      const kept = (res?.results || []).filter((r) => r.status !== 'Deleted');
      setOpMsg((m) => ({
        ...m,
        [s]: {
          type: kept.length ? 'warn' : 'ok',
          text: `Deleted ${res?.deleted ?? 0} of ${ids.length} selected record(s) (server-confirmed).`,
          details: kept.map((r) => `${r.status}: ${r.message}`),
        },
      }));
      sectionSetSel(s)(new Set());
      sectionReload(s);
    } catch (err) {
      setOpMsg((m) => ({ ...m, [s]: { type: 'err', text: err?.message || 'Delete failed - koi row delete nahi hua.' } }));
    } finally {
      setBusyOp('');
    }
  }

  function renderOp(s) {
    const m = opMsg[s];
    if (!m) return null;
    return (
      <div className="mt-3 rounded-xl p-3 text-[11px]" style={{
        background: m.type === 'err' ? 'var(--err-soft-bg)' : m.type === 'warn' ? 'var(--warn-soft-bg)' : 'var(--ok-soft-bg, rgba(16,185,129,0.12))',
        color: m.type === 'err' ? 'var(--err-soft-text)' : m.type === 'warn' ? 'var(--warn-soft-text)' : 'var(--ok-soft-text, #059669)',
      }}>
        <p className="font-bold">{m.text}</p>
        {(m.details || []).map((d, i) => <p key={i}>{d}</p>)}
      </div>
    );
  }

  const inputCls = 'px-3 py-2 rounded-xl bg-[var(--input-bg)] border border-[var(--border)] text-xs text-[var(--text)] outline-none focus:border-[var(--accent)] w-full';
  const btnGhost = 'px-3 py-2 rounded-xl bg-white/5 border border-[var(--border)] text-[var(--text)] text-[11px] font-bold transition hover:bg-white/10 disabled:opacity-40';
  const btnPrimary = 'px-4 py-2 rounded-xl card-gradient-1 text-white text-[11px] font-bold shadow-lg shadow-indigo-600/30 hover:opacity-95 transition disabled:opacity-50';

  return (
    <div className="space-y-4">
      {/* ---- Template + import ---- */}
      <div className="glass-card rounded-3xl p-6">
        <div className="flex items-center justify-between gap-3 flex-wrap mb-1">
          <h3 className="font-bold text-base text-[var(--text)] flex items-center gap-2">
            <i className="fas fa-sitemap text-indigo-400"></i> Salary Structure — Excel Template &amp; Import
          </h3>
          <button type="button" onClick={downloadTemplateWithData} disabled={tplBusy} className={btnGhost}>
            {tplBusy ? <i className="fas fa-spinner fa-spin mr-1"></i> : <i className="fas fa-file-arrow-down mr-1"></i>}Download Template (.xlsx)
          </button>
        </div>
        <p className="text-[11px] text-[var(--muted)] mb-4">
          Template me 4 sheets: <span className="mono text-[var(--text)]">{SHEET_NAMES.master}</span>,{' '}
          <span className="mono text-[var(--text)]">{SHEET_NAMES.elements}</span>,{' '}
          <span className="mono text-[var(--text)]">{SHEET_NAMES.payElementMaster}</span> aur ReadMe.
          Import se pehle preview dikhta hai; validation SERVER par hota hai (real employee roster ke against)
          aur Imported / Updated / Skipped / Failed counts backend ke actual response se aate hain.
          Template abhi <strong>SAVIOR SQL Server ke actual employee roster</strong> (dbo.tblemployee) se pre-filled
          download hota hai (read-only, company-scoped). Savior me employee-wise salary/pay-element data available
          na hone par woh fields blank rehte hain — application ki imported salary tables kabhi fallback source nahi
          banti. Unchanged rows dubara import par duplicate nahi bante; edited/completed rows matching
          (Paycode + EffectiveFrom) version ko update karte hain.
        </p>
        {tplError ? (
          <p className="text-[11px] rounded-xl px-3 py-2 border bg-rose-500/10 border-rose-500/20 text-rose-300 mb-4">
            <i className="fas fa-circle-exclamation mr-1"></i>{tplError}
          </p>
        ) : null}
        {tplNotice ? (
          <div className="text-[11px] rounded-xl px-3 py-2 border mb-4" style={{ background: 'var(--warn-soft-bg)', borderColor: 'var(--warn)', color: 'var(--warn-soft-text)' }}>
            <p className="font-bold"><i className="fas fa-circle-info mr-1"></i>Source: {tplNotice.source} — {tplNotice.employees} employee record(s) exported.</p>
            {tplNotice.unavailableFields?.length ? (
              <p className="mt-1">
                Blank fields (no Savior source): <span className="mono">{tplNotice.unavailableFields.join(', ')}</span>. {tplNotice.unavailableReason}
              </p>
            ) : null}
          </div>
        ) : null}

        <div className="flex items-center gap-3 flex-wrap">
          <label className={`${btnPrimary} cursor-pointer`}>
            <i className="fas fa-upload mr-1"></i>Choose Workbook (.xlsx)
            <input type="file" accept=".xlsx,.xls,.csv" className="hidden" onChange={onFileChosen} />
          </label>
          {file ? <span className="text-[11px] text-[var(--muted)] mono">{clean(file.name)}</span> : null}
        </div>

        {importError ? (
          <p className="text-[11px] rounded-xl px-3 py-2 border bg-rose-500/10 border-rose-500/20 text-rose-300 mt-4">
            <i className="fas fa-circle-exclamation mr-1"></i>{importError}
          </p>
        ) : null}

        {/* ---- Preview before commit ---- */}
        {parsed ? (
          <div className="mt-4 space-y-3">
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
              {[
                ['EmployeeSalaryMaster', parsed.master.length],
                ['EmployeePayElements', parsed.elements.length],
                ['PayElementMaster', parsed.payElementMaster.length],
                ['ReadMe', 'skip'],
              ].map(([label, value]) => (
                <div key={label} className="p-3.5 rounded-2xl border border-[var(--border)] text-center">
                  <p className="text-2xl font-extrabold text-[var(--text)]">{value}</p>
                  <p className="text-[10px] text-[var(--muted)] uppercase font-bold mt-1">{label}</p>
                </div>
              ))}
            </div>
            {parsed.sheetWarnings.length ? (
              <div className="rounded-2xl border p-3" style={{ borderColor: 'var(--warn)', background: 'var(--warn-soft-bg)' }}>
                {parsed.sheetWarnings.map((w, i) => (
                  <p key={i} className="text-[11px]" style={{ color: 'var(--warn-soft-text)' }}>{w}</p>
                ))}
              </div>
            ) : null}
            <div className="flex items-center justify-end gap-3 pt-2">
              <button type="button" onClick={() => { setParsed(null); setFile(null); }} disabled={importing} className={btnGhost}>Cancel</button>
              <button type="button" onClick={confirmImport} disabled={importing} className={btnPrimary}>
                {importing ? <i className="fas fa-spinner fa-spin mr-1"></i> : <i className="fas fa-check-double mr-1"></i>}
                Confirm &amp; Import ({parsed.master.length + parsed.elements.length + parsed.payElementMaster.length} rows)
              </button>
            </div>
          </div>
        ) : null}
      </div>


      {/* ---- Server-confirmed import summaries ---- */}
      {summaries ? (
        <div className="glass-card rounded-3xl p-6 space-y-4">
          <h3 className="font-bold text-base text-[var(--text)] flex items-center gap-2">
            <i className="fas fa-clipboard-check text-emerald-400"></i> Import Summary (server-confirmed)
          </h3>
          {[
            ['EmployeeSalaryMaster', summaries.master],
            ['EmployeePayElements', summaries.elements],
            ['PayElementMaster', summaries.payElementMaster],
          ].map(([label, s]) => (s ? (
            <div key={label} className="rounded-2xl border border-[var(--border)] p-4">
              <p className="text-xs font-extrabold text-[var(--text)] mb-2">{label}</p>
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                <div className="p-3 rounded-2xl border border-[var(--border)] text-center bg-emerald-500/10"><p className="text-xl font-extrabold text-[var(--text)]">{s.imported ?? 0}</p><p className="text-[10px] text-[var(--muted)] uppercase font-bold">Imported</p></div>
                <div className="p-3 rounded-2xl border border-[var(--border)] text-center bg-sky-500/10"><p className="text-xl font-extrabold text-[var(--text)]">{s.updated ?? 0}</p><p className="text-[10px] text-[var(--muted)] uppercase font-bold">Updated</p></div>
                <div className="p-3 rounded-2xl border border-[var(--border)] text-center"><p className="text-xl font-extrabold text-[var(--text)]">{s.skipped ?? 0}</p><p className="text-[10px] text-[var(--muted)] uppercase font-bold">Skipped</p></div>
                <div className="p-3 rounded-2xl border border-[var(--border)] text-center bg-rose-500/10"><p className="text-xl font-extrabold text-[var(--text)]">{s.failed ?? 0}</p><p className="text-[10px] text-[var(--muted)] uppercase font-bold">Failed</p></div>
              </div>
              {(s.warnings || []).length ? (
                <div className="mt-2 rounded-xl p-2" style={{ background: 'var(--warn-soft-bg)' }}>
                  {(s.warnings || []).map((w, i) => (
                    <p key={i} className="text-[10px]" style={{ color: 'var(--warn-soft-text)' }}>{w}</p>
                  ))}
                </div>
              ) : null}
              {(s.errors || []).length ? (
                <div className="mt-2 max-h-48 overflow-auto rounded-xl border border-[var(--border)]">
                  {(s.errors || []).slice(0, 50).map((e, i) => (
                    <p key={i} className="px-3 py-1.5 text-[10px] text-[var(--text)]">
                      <span className="mono text-[var(--muted)]">Row {e.row ?? '—'}</span>
                      {e.employeeCode ? <span className="mono text-indigo-300"> {e.employeeCode}</span> : null}
                      <span style={{ color: 'var(--err-soft-text)' }}> — {e.message || 'Unknown error'}</span>
                    </p>
                  ))}
                </div>
              ) : null}
            </div>
          ) : null))}
        </div>
      ) : null}

      {/* ---- Filters ---- */}
      <div className="glass-card rounded-3xl p-6">
        <h3 className="font-bold text-base text-[var(--text)] flex items-center gap-2 mb-3">
          <i className="fas fa-filter text-sky-400"></i> Filters (lists + exports)
        </h3>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-3">
          <div>
            <label className="block text-[10px] font-bold uppercase text-[var(--muted)] mb-1" htmlFor="st-paycode">Paycode</label>
            <input id="st-paycode" className={inputCls} value={filters.paycode} onChange={(e) => setFilters({ ...filters, paycode: e.target.value })} placeholder="e.g. 0002" />
          </div>
          <div>
            <label className="block text-[10px] font-bold uppercase text-[var(--muted)] mb-1" htmlFor="st-search">Search</label>
            <input id="st-search" className={inputCls} value={filters.search} onChange={(e) => setFilters({ ...filters, search: e.target.value })} placeholder="Name / code / element" />
          </div>
          <div>
            <label className="block text-[10px] font-bold uppercase text-[var(--muted)] mb-1" htmlFor="st-from">Effective From</label>
            <input id="st-from" type="date" className={inputCls} value={filters.from} onChange={(e) => setFilters({ ...filters, from: e.target.value })} />
          </div>
          <div>
            <label className="block text-[10px] font-bold uppercase text-[var(--muted)] mb-1" htmlFor="st-to">Effective To</label>
            <input id="st-to" type="date" className={inputCls} value={filters.to} onChange={(e) => setFilters({ ...filters, to: e.target.value })} />
          </div>
          <div>
            <label className="block text-[10px] font-bold uppercase text-[var(--muted)] mb-1" htmlFor="st-asof">Report As-Of</label>
            <input id="st-asof" type="date" className={inputCls} value={filters.asOf} onChange={(e) => setFilters({ ...filters, asOf: e.target.value })} />
          </div>
        </div>
      </div>


      {/* ---- Employee Salary Master ---- */}
      <div className="glass-card rounded-3xl p-6">
        <div className="flex items-center justify-between gap-3 mb-4 flex-wrap">
          <h3 className="font-bold text-base text-[var(--text)] flex items-center gap-2"><i className="fas fa-coins text-emerald-400"></i> Employee Salary Master</h3>
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-[11px] text-[var(--muted)]">{masterRows.length} version row(s) · har effective-date version preserved</span>
            <button type="button" onClick={() => openAdd('master')} disabled={!!busyOp} className={btnPrimary}><i className="fas fa-plus mr-1"></i>Add</button>
            <button type="button" onClick={() => openEdit('master')} disabled={!!busyOp || selMaster.size !== 1} className={btnGhost}><i className="fas fa-pen mr-1"></i>Edit{selMaster.size === 1 ? '' : ' (select 1 row)'}</button>
            <button type="button" onClick={() => deleteSelected('master')} disabled={!!busyOp || selMaster.size === 0} className={btnGhost}><i className="fas fa-trash mr-1"></i>Delete Selected{selMaster.size ? ` (${selMaster.size})` : ''}</button>
            <button type="button" onClick={exportMaster} disabled={!masterRows.length} className={btnGhost}><i className="fas fa-file-excel mr-1"></i>Export</button>
          </div>
        </div>
        {renderOp('master')}
        <AsyncBox loading={master.loading} error={master.error} onRetry={master.reload} label="Salary master load ho raha hai...">
          {masterRows.length ? (
            <div className="table-scroll overflow-x-auto">
              <table className="portal-table">
                <thead>
                  <tr>
                    <th><input type="checkbox" aria-label="Select all salary master rows" checked={masterRows.length > 0 && masterRows.every((r) => selMaster.has(r.id))} onChange={() => toggleAll(setSelMaster, masterRows)} /></th>
                    <th>Paycode</th><th>Employee Code</th><th>Name</th>
                    <th>Biometric</th><th>Company</th><th>Location</th><th>Department</th><th>Designation</th>
                    <th>Effective From</th><th>Basic</th><th>PF</th><th>PF Wage</th><th>ESI</th><th>ESI Wage</th>
                    <th>Currency</th><th>Remarks</th>
                  </tr>
                </thead>
                <tbody>
                  {masterRows.map((r, i) => (
                    <tr key={`${r.paycode}-${r.effectivefrom}-${i}`}>
                      <td><input type="checkbox" aria-label={`Select salary version ${r.paycode} ${r.effectivefrom}`} checked={selMaster.has(r.id)} onChange={() => toggleRow(setSelMaster, r.id)} /></td>
                      <td className="mono">{r.paycode}</td>
                      <td className="mono">{r.employeecode || '—'}</td>
                      <td className="font-semibold">{r.empname || '—'}</td>
                      <td className="mono">{r.presentcardno || '—'}</td>
                      <td className="mono">{r.companycode || '—'}</td>
                      <td className="mono">{r.locationcode || '—'}</td>
                      <td>{r.departmentcode || '—'}</td>
                      <td>{r.designation || '—'}</td>
                      <td className="mono">{r.effectivefrom || '—'}</td>
                      <td>{money(r.basicsalary)}</td>
                      <td>{yn(r.pfapplicable)}</td>
                      <td>{r.pfapplicable ? money(r.pfwage) : '—'}</td>
                      <td>{yn(r.esiapplicable)}</td>
                      <td>{r.esiapplicable ? money(r.esiwage) : '—'}</td>
                      <td>{r.currency || '—'}</td>
                      <td>{r.remarks || '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <p className="text-xs text-[var(--muted)] py-6 text-center">Koi salary master version nahi mili — template download karke import karein.</p>
          )}
        </AsyncBox>
      </div>


      {/* ---- Employee Pay Elements ---- */}
      <div className="glass-card rounded-3xl p-6">
        <div className="flex items-center justify-between gap-3 mb-4 flex-wrap">
          <h3 className="font-bold text-base text-[var(--text)] flex items-center gap-2"><i className="fas fa-list-ul text-sky-400"></i> Employee Pay Elements</h3>
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-[11px] text-[var(--muted)]">{elementRows.length} element row(s)</span>
            <button type="button" onClick={() => openAdd('elem')} disabled={!!busyOp} className={btnPrimary}><i className="fas fa-plus mr-1"></i>Add</button>
            <button type="button" onClick={() => openEdit('elem')} disabled={!!busyOp || selElem.size !== 1} className={btnGhost}><i className="fas fa-pen mr-1"></i>Edit{selElem.size === 1 ? '' : ' (select 1 row)'}</button>
            <button type="button" onClick={() => deleteSelected('elem')} disabled={!!busyOp || selElem.size === 0} className={btnGhost}><i className="fas fa-trash mr-1"></i>Delete Selected{selElem.size ? ` (${selElem.size})` : ''}</button>
            <button type="button" onClick={exportElements} disabled={!elementRows.length} className={btnGhost}><i className="fas fa-file-excel mr-1"></i>Export</button>
          </div>
        </div>
        {renderOp('elem')}
        <AsyncBox loading={elements.loading} error={elements.error} onRetry={elements.reload} label="Pay elements load ho rahe hain...">
          {elementRows.length ? (
            <div className="table-scroll overflow-x-auto">
              <table className="portal-table">
                <thead>
                  <tr>
                    <th><input type="checkbox" aria-label="Select all pay element rows" checked={elementRows.length > 0 && elementRows.every((r) => selElem.has(r.id))} onChange={() => toggleAll(setSelElem, elementRows)} /></th>
                    <th>Paycode</th><th>Name</th><th>Pay Element Code</th><th>Pay Element Name</th><th>Fixed/Percent</th>
                    <th>Amount</th><th>Percent</th><th>Computation</th><th>Add/Deduct</th>
                    <th>PF</th><th>PT</th><th>ESI</th><th>OT</th><th>C-Off</th><th>Cadre</th>
                    <th>Active</th><th>Processed</th><th>Posting Group</th><th>Encash</th><th>Effective From</th><th>Remarks</th>
                  </tr>
                </thead>
                <tbody>
                  {elementRows.map((r, i) => (
                    <tr key={`${r.paycode}-${r.payelementcode}-${r.effectivefrom}-${i}`}>
                      <td><input type="checkbox" aria-label={`Select pay element ${r.payelementcode}`} checked={selElem.has(r.id)} onChange={() => toggleRow(setSelElem, r.id)} /></td>
                      <td className="mono">{r.paycode}</td>
                      <td className="font-semibold">{r.empname || '—'}</td>
                      {/* Code and Name are separate readable values - never
                          concatenated (HRA and House Rent Allowance are the
                          same element, not two names). */}
                      <td className="mono">{r.payelementcode}</td>
                      <td>{r.payelementname || '—'}</td>
                      <td>{r.fixedorpercent || '—'}</td>
                      <td>{r.amount === null ? '—' : money(r.amount)}</td>
                      <td>{r.percent === null ? '—' : `${r.percent}%`}</td>
                      <td>{r.computationtype || '—'}</td>
                      <td>{r.addordeduct || '—'}</td>
                      <td>{yn(r.pfapplicable)}</td>
                      <td>{yn(r.ptapplicable)}</td>
                      <td>{yn(r.esiapplicability)}</td>
                      <td>{yn(r.applicableforot)}</td>
                      <td>{yn(r.applicableforc)}</td>
                      <td>{r.paycadre || '—'}</td>
                      <td>{yn(r.activepayelement)}</td>
                      <td>{yn(r.processed)}</td>
                      <td>{r.payrollpostinggroup || '—'}</td>
                      <td>{yn(r.leaveencashment)}</td>
                      <td className="mono">{r.effectivefrom || '—'}</td>
                      <td>{r.remarks || '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <p className="text-xs text-[var(--muted)] py-6 text-center">Koi pay element row nahi hai — EmployeePayElements sheet se import karein.</p>
          )}
        </AsyncBox>
      </div>


      {/* ---- Pay Element Master ---- */}
      <div className="glass-card rounded-3xl p-6">
        <div className="flex items-center justify-between gap-3 mb-4 flex-wrap">
          <h3 className="font-bold text-base text-[var(--text)] flex items-center gap-2"><i className="fas fa-book text-violet-400"></i> Pay Element Master</h3>
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-[11px] text-[var(--muted)]">{pemRows.length} code(s) · naye codes bina schema/frontend change ke import hote hain</span>
            <button type="button" onClick={() => openAdd('pem')} disabled={!!busyOp} className={btnPrimary}><i className="fas fa-plus mr-1"></i>Add</button>
            <button type="button" onClick={() => openEdit('pem')} disabled={!!busyOp || selPem.size !== 1} className={btnGhost}><i className="fas fa-pen mr-1"></i>Edit{selPem.size === 1 ? '' : ' (select 1 row)'}</button>
            <button type="button" onClick={() => deleteSelected('pem')} disabled={!!busyOp || selPem.size === 0} className={btnGhost}><i className="fas fa-trash mr-1"></i>Delete Selected{selPem.size ? ` (${selPem.size})` : ''}</button>
            <button type="button" onClick={exportPayElementMaster} disabled={!pemRows.length} className={btnGhost}><i className="fas fa-file-excel mr-1"></i>Export</button>
          </div>
        </div>
        {renderOp('pem')}
        <AsyncBox loading={payElementMaster.loading} error={payElementMaster.error} onRetry={payElementMaster.reload} label="Pay element master load ho raha hai...">
          {pemRows.length ? (
            <div className="table-scroll overflow-x-auto">
              <table className="portal-table">
                <thead>
                  <tr><th><input type="checkbox" aria-label="Select all pay element master rows" checked={pemRows.length > 0 && pemRows.every((r) => selPem.has(r.id))} onChange={() => toggleAll(setSelPem, pemRows)} /></th><th>Code</th><th>Description</th><th>Name</th><th>Add/Deduct</th><th>OT</th><th>ESI</th><th>PF</th><th>Encash</th><th>Posting Group</th><th>Active</th><th>Remarks</th></tr>
                </thead>
                <tbody>
                  {pemRows.map((r) => (
                    <tr key={r.id}>
                      <td><input type="checkbox" aria-label={`Select master code ${r.payelementcode}`} checked={selPem.has(r.id)} onChange={() => toggleRow(setSelPem, r.id)} /></td>
                      <td className="mono">{r.payelementcode}</td>
                      <td className="font-semibold">{r.description || '—'}</td>
                      <td>{r.payelementname || '—'}</td>
                      <td>{r.addordeduct || '—'}</td>
                      <td>{yn(r.applicableforot)}</td>
                      <td>{yn(r.esiapplicable)}</td>
                      <td>{yn(r.pfapplicable)}</td>
                      <td>{yn(r.leaveencashment)}</td>
                      <td className="mono">{r.payrollpostinggroup || '—'}</td>
                      <td>{yn(r.active)}</td>
                      <td>{r.remarks || '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <p className="text-xs text-[var(--muted)] py-6 text-center">Pay element master khali hai — PayElementMaster sheet se codes import karein ya upar Add se naya code banayein (unknown codes kabhi auto-register nahi hote).</p>
          )}
        </AsyncBox>
      </div>

      {/* ---- Exports ---- */}
      <div className="glass-card rounded-3xl p-6">
        <h3 className="font-bold text-base text-[var(--text)] flex items-center gap-2 mb-1">
          <i className="fas fa-file-export text-teal-400"></i> Exports
        </h3>
        <p className="text-[11px] text-[var(--muted)] mb-4">
          Sab exports isi shared backend ke saved records se bante hain (mobile app se bhi wahi data).
          Dynamic report me pay element columns selected data me actually present codes ke union hote hain
          (koi fixed list nahi). Gross Salary sirf explicit GROSS source element par dikhta hai —
          positive amounts ka sum kabhi nahi — aur ye CTC nahi hai.
        </p>
        <div className="flex items-center gap-3 flex-wrap">
          <button type="button" onClick={exportMaster} disabled={!masterRows.length} className={btnGhost}><i className="fas fa-file-excel mr-1"></i>Employee Salary Master</button>
          <button type="button" onClick={exportElements} disabled={!elementRows.length} className={btnGhost}><i className="fas fa-file-excel mr-1"></i>Employee Pay Elements (row-based)</button>
          <button type="button" onClick={exportPayElementMaster} disabled={!pemRows.length} className={btnGhost}><i className="fas fa-file-excel mr-1"></i>Pay Element Master</button>
          <button type="button" onClick={exportReport} className={btnPrimary}><i className="fas fa-table mr-1"></i>Dynamic Report (as-of {filters.asOf || 'today'})</button>
        </div>
      </div>

      {form ? (
        <CrudForm
          key={`${form.section}-${form.mode}-${form.rowId || 'new'}`}
          title={`${form.mode === 'add' ? 'Add' : 'Edit'} — ${form.section === 'master' ? 'Employee Salary Master' : form.section === 'elem' ? 'Employee Pay Element' : 'Pay Element Master'}`}
          fields={form.section === 'master' ? MASTER_FORM_FIELDS : form.section === 'elem' ? ELEM_FORM_FIELDS : PEM_FORM_FIELDS}
          values={form.values}
          options={{ emp: empOptions, code: codeOptions, yn: YN_OPTS, fp: FP_OPTS, ad: AD_OPTS, pemad: PEM_AD_OPTS }}
          busy={!!busyOp}
          errors={form.errors}
          warnings={form.warnings}
          onCancel={() => setForm(null)}
          onSubmit={saveForm}
        />
      ) : null}
    </div>
  );
}

