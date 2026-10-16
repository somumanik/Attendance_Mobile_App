'use client';

// web-next/components/hr/ExcelImport.jsx — reusable Excel/CSV import workflow for HR.
// Used by Salary (Dataset A/B) and Leave opening-balance imports. All validation is
// done by the authoritative backend import endpoint; this component only parses the
// file, shows a preview, and displays the backend's Imported/Updated/Skipped/Failed
// summary with per-row errors.

import { useRef, useState } from 'react';
import apiFetch from '../../lib/api';
import { readSheetGrid, buildImportRows, downloadCsv, downloadXlsx } from '../../lib/excelImport';

const PREVIEW_LIMIT = 20;

export default function ExcelImport({ columns, endpoint, templateFilename, title, hint, onImported, exampleRow, templateRowsProvider }) {
  const [phase, setPhase] = useState('idle'); // idle | preview | done
  const [rows, setRows] = useState([]);
  const [summary, setSummary] = useState(null);
  const [busy, setBusy] = useState(false);
  const [templateBusy, setTemplateBusy] = useState(false);
  const [error, setError] = useState('');
  const fileRef = useRef(null);

  const headerRow = columns.map((c) => c.key);

  async function downloadTemplate() {
    if (templateBusy) return;
    setTemplateBusy(true);
    setError('');
    try {
      if (typeof templateRowsProvider === 'function') {
        const rows = await templateRowsProvider();
        if (!Array.isArray(rows) || !rows.length) {
          setError('Template banane ke liye koi data nahi mila.');
          return;
        }
        await downloadXlsx(templateFilename, rows);
      } else {
        const rows = [headerRow];
        if (Array.isArray(exampleRow) && exampleRow.length) rows.push(exampleRow);
        downloadCsv(templateFilename, rows);
      }
    } catch (err) {
      setError('Template download fail: ' + (err?.message || 'unknown error'));
    } finally {
      setTemplateBusy(false);
    }
  }

  async function handleFile(e) {
    const file = e.target.files && e.target.files[0];
    if (e.target) e.target.value = ''; // allow re-selecting the same file
    if (!file) return;
    setBusy(true);
    setError('');
    try {
      const grid = await readSheetGrid(file);
      if (!grid.length) {
        setError('File empty hai.');
        return;
      }
      const parsed = buildImportRows(grid, columns);
      if (parsed.missing.length) {
        setError(`In columns file me nahi mile: ${parsed.missing.join(', ')}. Template download karke wahi headers use karein.`);
        return;
      }
      if (!parsed.rows.length) {
        setError('Koi data row nahi mili.');
        return;
      }
      setRows(parsed.rows);
      setSummary(null);
      setPhase('preview');
    } catch {
      setError('File read nahi ho payi. Valid Excel/CSV select karein.');
    } finally {
      setBusy(false);
    }
  }

  async function confirmImport() {
    if (!rows.length || busy) return;
    setBusy(true);
    setError('');
    try {
      const payload = rows.map((r) => r.values);
      const res = await apiFetch(endpoint, { method: 'POST', body: { rows: payload } });
      setSummary(res?.summary || null);
      setPhase('done');
      if (onImported) onImported();
    } catch (err) {
      setError(err?.message || 'Import service unavailable.');
    } finally {
      setBusy(false);
    }
  }

  function reset() {
    setRows([]);
    setSummary(null);
    setError('');
    setPhase('idle');
  }

  const stat = (label, value, tone) => (
    <div className={`p-3.5 rounded-2xl border text-center ${tone}`}>
      <p className="text-2xl font-extrabold text-[var(--text)]">{value}</p>
      <p className="text-[10px] text-[var(--muted)] uppercase font-bold mt-1">{label}</p>
    </div>
  );

  return (
    <div className="rounded-2xl border border-white/5 bg-white/[0.02] p-4 space-y-4">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <h4 className="font-bold text-sm text-[var(--text)]">{title}</h4>
        <div className="flex items-center gap-2">
          <button type="button" onClick={downloadTemplate} disabled={templateBusy} className="px-3.5 py-2 rounded-xl bg-white/5 border border-[var(--border)] text-[var(--text)] text-[11px] font-bold transition hover:bg-white/10 disabled:opacity-50">
            {templateBusy ? <i className="fas fa-spinner fa-spin mr-1"></i> : <i className="fas fa-download mr-1"></i>}Download Template
          </button>
          <button type="button" onClick={() => fileRef.current && fileRef.current.click()} disabled={busy} className="px-3.5 py-2 rounded-xl card-gradient-1 text-white text-[11px] font-bold transition disabled:opacity-50">
            {busy ? <i className="fas fa-spinner fa-spin mr-1"></i> : <i className="fas fa-upload mr-1"></i>}Choose Excel
          </button>
          <input ref={fileRef} type="file" accept=".xlsx,.xls,.csv" className="hidden" onChange={handleFile} />
        </div>
      </div>

      {hint ? <p className="text-[11px] text-[var(--muted)] leading-relaxed">{hint}</p> : null}

      {phase === 'idle' ? (
        <div className="flex flex-wrap gap-1.5">
          {columns.map((c) => (
            <span key={c.key} className={`chip ${c.required ? 'bg-indigo-500/10 text-indigo-300' : 'bg-white/5 text-[var(--muted)]'}`}>{c.label}</span>
          ))}
        </div>
      ) : null}

      {error ? <p className="text-xs font-semibold text-rose-300 bg-rose-500/10 border border-rose-500/20 rounded-xl px-3 py-2">{error}</p> : null}

      {phase === 'preview' ? (
        <>
          <p className="text-xs text-[var(--muted)] leading-relaxed">
            <span className="font-bold text-[var(--text)]">{rows.length}</span> row(s) mili (header row exclude). Final validation backend par hoga — unmatched employee, invalid date/type ya out-of-scope company wali rows <span className="text-rose-300">import nahi</span> hongi aur summary me alag dikhengi.
          </p>
          <div className="overflow-x-auto rounded-2xl border border-white/5 max-h-72">
            <table className="portal-table">
              <thead>
                <tr>
                  <th>Row</th>
                  {columns.map((c) => <th key={c.key}>{c.label}</th>)}
                </tr>
              </thead>
              <tbody>
                {rows.slice(0, PREVIEW_LIMIT).map((r) => (
                  <tr key={r.line}>
                    <td className="mono text-[var(--muted)]">{r.line}</td>
                    {columns.map((c) => <td key={c.key} className="mono">{String(r.values[c.key] ?? '')}</td>)}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {rows.length > PREVIEW_LIMIT ? <p className="text-[11px] text-[var(--muted)]">…aur {rows.length - PREVIEW_LIMIT} rows preview me nahi dikhai.</p> : null}
          <div className="flex items-center justify-end gap-3 pt-3 border-t border-[var(--border)]">
            <button type="button" onClick={reset} disabled={busy} className="px-4 py-2 rounded-xl bg-white/5 border border-[var(--border)] text-[var(--text)] text-xs font-bold transition">Back</button>
            <button type="button" onClick={confirmImport} disabled={busy} className="px-5 py-2.5 rounded-xl card-gradient-1 text-white text-[11px] font-bold shadow-lg shadow-indigo-600/30 hover:opacity-95 transition disabled:opacity-50">
              {busy ? <i className="fas fa-spinner fa-spin mr-1"></i> : <i className="fas fa-check-double mr-1"></i>}Confirm &amp; Import ({rows.length} rows)
            </button>
          </div>
        </>
      ) : null}

      {phase === 'done' && summary ? (
        <div className="space-y-4">
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            {stat('Imported', summary.imported ?? 0, 'bg-emerald-500/10 border-emerald-500/20')}
            {stat('Updated', summary.updated ?? 0, 'bg-sky-500/10 border-sky-500/20')}
            {stat('Skipped', summary.skipped ?? 0, 'bg-white/5 border-white/5')}
            {stat('Failed', summary.failed ?? 0, 'bg-rose-500/10 border-rose-500/20')}
          </div>
          {(summary.errors || []).length ? (
            <div className="rounded-2xl border border-white/5 overflow-hidden">
              <div className="px-3 py-2 bg-white/5 text-[10px] uppercase font-bold text-[var(--muted)]">Errors ({(summary.errors || []).length})</div>
              <div className="max-h-56 overflow-auto divide-y divide-white/5">
                {(summary.errors || []).slice(0, 50).map((e, i) => (
                  <div key={i} className="px-3 py-2 text-[11px] text-[var(--text)]">
                    <span className="mono text-[var(--muted)]">Row {e.row ?? '—'}</span>
                    {e.employeeCode ? <span className="mono text-indigo-300"> {e.employeeCode}</span> : null}
                    <span className="text-rose-300"> — {e.message || 'Unknown error'}</span>
                  </div>
                ))}
              </div>
              {(summary.errors || []).length > 50 ? <div className="px-3 py-2 text-[10px] text-[var(--muted)]">…aur {(summary.errors || []).length - 50} errors.</div> : null}
            </div>
          ) : null}
          <div className="text-right">
            <button type="button" onClick={reset} className="px-5 py-2 rounded-xl bg-indigo-600 text-white text-xs font-bold transition">Import Another</button>
          </div>
        </div>
      ) : null}
    </div>
  );
}
