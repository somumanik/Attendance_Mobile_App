'use client';

// web-next/components/hr/MarriageImportModal.jsx — Marriage Anniversary Excel/CSV import (parity with index.html hrMarriage import workflow).
// Flow: parse file -> POST /api/marriage-anniversary/validate -> preview -> POST /api/marriage-anniversary/import.

import { useRef, useState } from 'react';
import apiFetch from '../../lib/api';
import { prettyDate } from '../../lib/format';

function validDate(year, month, day) {
  const d = new Date(year, month - 1, day);
  return d.getFullYear() === year && d.getMonth() === month - 1 && d.getDate() === day ? d : null;
}

function iso(d) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

// Mirrors index.html parseFlexibleDate: Date instance, Excel serial number, YYYY-MM-DD / DD-MM-YYYY, or Date().
function parseFlexibleDate(v) {
  if (v == null || v === '') return null;
  if (v instanceof Date && !isNaN(v)) return new Date(v.getFullYear(), v.getMonth(), v.getDate());
  if (typeof v === 'number') {
    const d = new Date(Math.round((v - 25569) * 86400 * 1000));
    if (!isNaN(d)) return new Date(d.getFullYear(), d.getMonth(), d.getDate());
    return null;
  }
  const s = String(v).trim();
  let m = s.match(/^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})/);
  if (m) return validDate(+m[1], +m[2], +m[3]);
  m = s.match(/^(\d{1,2})[-/.](\d{1,2})[-/.](\d{2,4})/);
  if (m) {
    let y = +m[3]; if (y < 100) y += 2000;
    return validDate(y, +m[2], +m[1]);
  }
  const d = new Date(s);
  if (!isNaN(d)) return validDate(d.getFullYear(), d.getMonth() + 1, d.getDate());
  return null;
}

const FILTERS = [
  { id: 'all', label: 'All' },
  { id: 'matched', label: 'Valid Only' },
  { id: 'unmatched', label: 'Not Found' },
  { id: 'invalid', label: 'Invalid Dates' },
  { id: 'duplicate', label: 'Duplicates' },
];

export default function MarriageImportModal({ onClose, onImported }) {
  const [step, setStep] = useState(1);
  const [rows, setRows] = useState([]);
  const [filter, setFilter] = useState('all');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [summary, setSummary] = useState(null);
  const fileRef = useRef(null);

  async function handleFile(e) {
    const file = e.target.files && e.target.files[0];
    if (!file) return;
    setBusy(true);
    setError('');
    try {
      const isCSV = /\.csv$/i.test(file.name);
      let grid = [];
      if (isCSV) {
        const text = await file.text();
        grid = text.split(/\r?\n/).filter((l) => l.trim()).map((l) => l.split(/[,;\t]/));
      } else {
        const XLSX = await import('xlsx');
        const buf = await file.arrayBuffer();
        const wb = XLSX.read(new Uint8Array(buf), { type: 'array', cellDates: true });
        const ws = wb.Sheets[wb.SheetNames[0]];
        grid = XLSX.utils.sheet_to_json(ws, { header: 1, raw: true, defval: '' });
      }
      await processGrid(grid);
    } catch {
      setError('File read nahi ho payi. Valid Excel/CSV select karein.');
    } finally {
      setBusy(false);
    }
  }

  async function processGrid(grid) {
    if (!grid || !grid.length) { setError('File empty hai.'); return; }
    let headerIdx = 0;
    for (let i = 0; i < Math.min(grid.length, 5); i++) {
      const joined = grid[i].join('|').toLowerCase();
      if (joined.includes('employee') || joined.includes('biometric') || joined.includes('marriage') || joined.includes('anniversary')) { headerIdx = i; break; }
    }
    const header = grid[headerIdx].map((h) => String(h || '').toLowerCase().replace(/[^a-z]/g, ''));
    const idx = {
      code: header.findIndex((h) => h.includes('employeecode') || h === 'paycode' || h === 'empcode' || h === 'code'),
      bio: header.findIndex((h) => h.includes('biometric') || h.includes('cardno') || h === 'card'),
      date: header.findIndex((h) => h.includes('anniversary') || h.includes('marriage') || h.includes('date')),
    };
    if (idx.code === -1 && idx.bio === -1) { setError('EmployeeCode ya BiometricCode column nahi mila.'); return; }
    if (idx.date === -1) { setError('MarriageAnniversaryDate column nahi mila.'); return; }

    const parsed = [];
    for (let r = headerIdx + 1; r < grid.length; r++) {
      const row = grid[r];
      if (!row || row.join('').trim() === '') continue;
      const codeRaw = idx.code > -1 ? String(row[idx.code] || '').trim() : '';
      const bioRaw = idx.bio > -1 ? String(row[idx.bio] || '').trim() : '';
      const dateRaw = row[idx.date];
      const p = parseFlexibleDate(dateRaw);
      parsed.push({
        line: r + 1,
        codeRaw,
        bioRaw,
        dateRaw: dateRaw instanceof Date ? iso(dateRaw) : String(dateRaw == null ? '' : dateRaw),
        parsed: p ? iso(p) : null,
      });
    }
    if (!parsed.length) { setError('Koi data row nahi mili.'); return; }

    try {
      const res = await apiFetch('/marriage-anniversary/validate', {
        method: 'POST',
        body: { rows: parsed.map((r) => ({ employeeCode: r.codeRaw, biometricCode: r.bioRaw, anniversaryDate: r.parsed })) },
      });
      (res.rows || []).forEach((row, i) => {
        const local = parsed[i];
        local.emp = row.employee || null;
        if (!local.emp) { local.state = 'unmatched'; local.reason = 'Employee not found in dbo.tblemployee'; }
        else if (!local.parsed) { local.state = 'invalid'; local.reason = 'Invalid date'; }
        else { local.state = 'matched'; local.reason = 'Ready to import'; }
      });
    } catch {
      setError('Server employee validation unavailable.');
      return;
    }

    const seen = new Set();
    parsed.forEach((r) => {
      const key = (r.emp && r.emp.paycode ? r.emp.paycode : r.codeRaw).toLowerCase();
      if (!key) return;
      if (seen.has(key)) { r.state = 'duplicate'; r.reason = 'Duplicate Paycode in file (first occurrence will be imported)'; }
      else seen.add(key);
    });

    setRows(parsed);
    setStep(2);
  }

  async function confirmImport() {
    const matched = rows.filter((r) => r.state === 'matched');
    if (!matched.length) return;
    setBusy(true);
    setError('');
    try {
      const validation = await apiFetch('/marriage-anniversary/validate', {
        method: 'POST',
        body: { rows: matched.map((r) => ({ employeeCode: r.codeRaw, biometricCode: r.bioRaw, anniversaryDate: r.parsed })) },
      });
      const validRows = (validation.rows || []).filter((r) => r.employee);
      const isNew = (r) => !r.employee.existingDate;
      const isChanged = (r) => r.employee.existingDate && String(r.employee.existingDate).slice(0, 10) !== String(r.anniversaryDate || '').slice(0, 10);
      const toImport = validRows.filter((r) => isNew(r) || isChanged(r));
      const s = {
        total: rows.length,
        imported: toImport.length,
        fresh: validRows.filter(isNew).length,
        updated: validRows.filter(isChanged).length,
        unchanged: validRows.length - toImport.length,
        skipped: rows.length - validRows.length,
      };
      if (toImport.length) {
        await apiFetch('/marriage-anniversary/import', { method: 'POST', body: { importedBy: 'HR001', rows: toImport } });
      }
      setSummary(s);
      setStep(3);
      if (onImported) onImported();
    } catch (e) {
      setError(e?.message || 'Import service unavailable.');
    } finally {
      setBusy(false);
    }
  }

  function downloadTemplate() {
    const csv = 'Paycode,EmployeeName,MarriageDate\nEMP001,John Doe,15-02-2015\n';
    const blob = new Blob(['\uFEFF' + csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'marriage-anniversary-template.csv';
    a.click();
    URL.revokeObjectURL(url);
  }

  function loadSample() {
    const grid = [
      ['Paycode', 'EmployeeName', 'MarriageDate'],
      ['EMP001', 'Sample One', '15-02-2015'],
      ['EMP999', 'UNKNOWN PERSON', '15-02-2015'],
      ['EMP002', 'BAD DATE ROW', '32-13-2018'],
    ];
    processGrid(grid);
  }

  const counts = {
    matched: rows.filter((r) => r.state === 'matched').length,
    unmatched: rows.filter((r) => r.state === 'unmatched').length,
    invalid: rows.filter((r) => r.state === 'invalid').length,
    duplicate: rows.filter((r) => r.state === 'duplicate').length,
  };
  const visible = rows.filter((r) => (filter === 'all' ? true : r.state === filter));

  return (
    <div className="fixed inset-0 z-[70] flex items-center justify-center p-4" style={{ background: 'rgba(4,3,13,.82)', backdropFilter: 'blur(8px)' }} onClick={onClose}>
      <div className="pop-in glass rounded-3xl p-5 w-full max-w-4xl max-h-[90vh] overflow-y-auto shadow-2xl" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between mb-4">
          <h3 className="font-bold text-base text-[var(--text)] flex items-center gap-2"><i className="fas fa-file-excel text-teal-400"></i> Marriage Anniversary Excel Import</h3>
          <button type="button" onClick={onClose} className="text-[var(--muted)] hover:text-[var(--text)] text-lg" aria-label="Close"><i className="fas fa-xmark"></i></button>
        </div>

        {error ? <div className="p-3 rounded-xl bg-rose-500/10 border border-rose-500/20 text-rose-300 text-xs mb-3">{error}</div> : null}

        {step === 1 && (
          <div className="space-y-4">
            <p className="text-xs text-[var(--muted)]">Expected columns: <strong className="text-[var(--text)]">Paycode</strong> (primary matching key) + <strong className="text-[var(--text)]">EmployeeName</strong> (display only) + <strong className="text-[var(--text)]">MarriageDate</strong> (DD-MM-YYYY / YYYY-MM-DD / real Excel date). Duplicate Paycode, invalid dates aur unmatched rows skip honge.</p>
            <div className="flex flex-wrap gap-2">
              <button type="button" onClick={downloadTemplate} className="px-4 py-2.5 rounded-xl bg-white/5 border border-[var(--border)] hover:bg-white/10 text-[11px] font-bold text-[var(--text)] transition"><i className="fas fa-download mr-1"></i>Download Excel Template</button>
              <button type="button" onClick={loadSample} disabled={busy} className="px-4 py-2.5 rounded-xl bg-indigo-600/20 border border-indigo-500/30 text-indigo-300 hover:bg-indigo-600/30 text-[11px] font-bold transition disabled:opacity-50"><i className="fas fa-wand-magic-sparkles mr-1"></i>Load Sample Sheet</button>
            </div>
            <div className="drop-zone p-8 rounded-2xl border-2 border-dashed text-center">
              <input ref={fileRef} type="file" accept=".xlsx,.xls,.csv" className="hidden" onChange={handleFile} />
              <button type="button" onClick={() => fileRef.current && fileRef.current.click()} disabled={busy} className="px-5 py-2.5 rounded-xl card-gradient-1 text-white text-xs font-bold transition disabled:opacity-50">
                {busy ? <i className="fas fa-spinner fa-spin mr-1"></i> : <i className="fas fa-upload mr-1"></i>} Select Excel / CSV File
              </button>
              <p className="text-[10px] text-[var(--muted)] mt-3">.xlsx, .xls ya .csv file chunein</p>
            </div>
          </div>
        )}

        {step === 2 && (
          <>
            <div className="flex flex-wrap gap-2 mb-4">
              {FILTERS.map((f) => (
                <button key={f.id} type="button" onClick={() => setFilter(f.id)} className={`px-3 py-1.5 rounded-xl text-[11px] font-bold transition ${filter === f.id ? 'bg-indigo-600 text-white' : 'bg-white/5 border border-[var(--border)] text-[var(--muted)] hover:bg-white/10'}`}>
                  {f.label} <span className="opacity-70">({counts[f.id]})</span>
                </button>
              ))}
            </div>

            <div className="overflow-x-auto">
              <table className="portal-table">
                <thead><tr><th>Line</th><th>Paycode</th><th>Card</th><th>Name</th><th>Anniversary</th><th>Status</th></tr></thead>
                <tbody>
                  {visible.length ? visible.map((r) => {
                    const badge = r.state === 'matched'
                      ? (r.emp && r.emp.existingDate
                        ? <span className="badge badge--neutral"><i className="fas fa-rotate mr-1"></i>Update</span>
                        : <span className="badge badge--present"><i className="fas fa-plus mr-1"></i>New</span>)
                      : r.state === 'duplicate'
                        ? <span className="badge badge--weekoff">Duplicate</span>
                        : r.state === 'invalid'
                          ? <span className="badge badge--miss">Invalid date</span>
                          : <span className="badge badge--absent">Not found</span>;
                    return (
                      <tr key={r.line}>
                        <td className="mono">{r.line}</td>
                        <td className="mono">{r.codeRaw || '—'}</td>
                        <td className="mono">{r.bioRaw || '—'}</td>
                        <td>{r.emp ? r.emp.empname || '—' : '—'}</td>
                        <td>{r.parsed ? prettyDate(r.parsed) : (r.dateRaw || '—')}</td>
                        <td>
                          <div className="flex items-center gap-1.5">{badge}
                            {r.state === 'matched' && r.emp && r.emp.existingDate ? <span className="text-[10px] text-[var(--muted)]">Existing: {prettyDate(r.emp.existingDate)}</span> : null}
                          </div>
                        </td>
                      </tr>
                    );
                  }) : <tr><td colSpan={6} className="py-6 text-center text-[var(--muted)]">Is filter me koi row nahi.</td></tr>}
                </tbody>
              </table>
            </div>

            <div className="flex items-center justify-end gap-3 mt-4 pt-4 border-t border-[var(--border)]">
              <button type="button" onClick={() => { setRows([]); setStep(1); }} className="px-4 py-2 rounded-xl bg-white/5 border border-[var(--border)] text-[var(--text)] text-xs font-bold transition">Back</button>
              <button type="button" onClick={confirmImport} disabled={busy || counts.matched === 0} className="px-5 py-2.5 rounded-xl card-gradient-1 text-white text-[11px] font-bold shadow-lg shadow-indigo-600/30 hover:opacity-95 transition disabled:opacity-50">
                {busy ? <i className="fas fa-spinner fa-spin mr-1"></i> : <i className="fas fa-check-double mr-1"></i>}Confirm &amp; Import Valid Records
              </button>
            </div>
          </>
        )}

        {step === 3 && summary && (
          <div className="space-y-4">
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
              <div className="p-3.5 rounded-2xl bg-white/5 border border-white/5 text-center"><p className="text-2xl font-extrabold text-[var(--text)]">{summary.total}</p><p className="text-[10px] text-[var(--muted)] uppercase font-bold mt-1">Total Rows</p></div>
              <div className="p-3.5 rounded-2xl bg-emerald-500/10 border border-emerald-500/20 text-center"><p className="text-2xl font-extrabold text-emerald-400">{summary.imported}</p><p className="text-[10px] text-[var(--muted)] uppercase font-bold mt-1">Imported</p><p className="text-[10px] text-emerald-300/80 mt-0.5">{summary.fresh} new • {summary.updated} update</p></div>
              <div className="p-3.5 rounded-2xl bg-sky-500/10 border border-sky-500/20 text-center"><p className="text-2xl font-extrabold text-sky-400">{summary.unchanged}</p><p className="text-[10px] text-[var(--muted)] uppercase font-bold mt-1">Unchanged (skipped)</p><p className="text-[10px] text-sky-300/80 mt-0.5">Already same date in DB</p></div>
              <div className="p-3.5 rounded-2xl bg-rose-500/10 border border-rose-500/20 text-center"><p className="text-2xl font-extrabold text-rose-400">{summary.skipped}</p><p className="text-[10px] text-[var(--muted)] uppercase font-bold mt-1">Skipped</p><p className="text-[10px] text-rose-300/80 mt-0.5">Not found / invalid / duplicate</p></div>
            </div>
            <p className="text-xs text-[var(--muted)]">Records HR marriage anniversary register me save ho gaye.</p>
            <div className="text-right">
              <button type="button" onClick={onClose} className="px-5 py-2 rounded-xl bg-indigo-600 text-white text-xs font-bold transition">Done</button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

