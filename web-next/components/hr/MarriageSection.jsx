'use client';

// web-next/components/hr/MarriageSection.jsx — Marriage Anniversary Register (full table + remove; parity with index.html hrMarriage).

import { useState } from 'react';
import useApiData from '../useApiData';
import AsyncBox from '../employee/AsyncBox';
import apiFetch from '../../lib/api';
import { prettyDate } from '../../lib/format';
import { yearsCompleted } from '../../lib/hr';
import MarriageImportModal from './MarriageImportModal';

export default function MarriageSection() {
  const roster = useApiData('/employees?page=1&pageSize=500&active=ALL');
  const mar = useApiData('/marriage-anniversary');
  const [busy, setBusy] = useState(null);
  const [msg, setMsg] = useState('');
  const [showImport, setShowImport] = useState(false);

  const employees = roster.data?.rows || [];
  const list = Array.isArray(mar.data) ? mar.data : [];
  const empMap = {};
  employees.forEach((e) => { empMap[e.paycode] = e; });

  async function remove(paycode) {
    if (!window.confirm('Remove marriage anniversary record for ' + paycode + '?')) return;
    setBusy(paycode);
    setMsg('');
    try {
      await apiFetch(`/marriage-anniversary/${encodeURIComponent(paycode)}`, { method: 'DELETE' });
      setMsg('Record removed.');
      mar.reload();
    } catch (e) {
      setMsg(e?.message || 'Delete failed.');
    } finally {
      setBusy(null);
    }
  }

  return (
    <>
      <AsyncBox loading={roster.loading || mar.loading} error={roster.error || mar.error} onRetry={() => { roster.reload(); mar.reload(); }} label="Marriage records load ho rahe hain...">
      <div className="glass-card rounded-3xl p-6">
        <div className="flex flex-wrap items-center justify-between gap-4 mb-5 pb-4 border-b border-[var(--border)]">
          <div>
            <h3 className="font-bold text-base text-[var(--text)] flex items-center gap-2"><i className="fas fa-ring text-teal-400"></i> Marriage Anniversary Register</h3>
            <p className="text-xs text-[var(--muted)]">HR application table • matching key: paycode / presentcardno</p>
          </div>
          <button type="button" onClick={() => setShowImport(true)} className="px-3.5 py-2 rounded-xl bg-teal-600/20 border border-teal-500/30 text-teal-300 hover:bg-teal-600/30 text-[11px] font-bold transition">
            <i className="fas fa-file-excel mr-1"></i>Import Excel
          </button>
        </div>

        {msg ? <p className="text-xs text-[var(--accent-soft)] mb-3">{msg}</p> : null}

        {list.length ? (
          <div className="overflow-x-auto">
            <table className="portal-table">
              <thead>
                <tr><th>Paycode</th><th>Card No</th><th>Name</th><th>Dept</th><th>Anniversary</th><th>Years</th><th>Imported By</th><th>Updated</th><th className="text-center">Action</th></tr>
              </thead>
              <tbody>
                {list.map((m) => {
                  const e = empMap[m.paycode] || {};
                  return (
                    <tr key={m.id ?? m.paycode}>
                      <td className="mono text-teal-300">{m.paycode || '—'}</td>
                      <td className="mono">{m.presentcardno || '—'}</td>
                      <td className="font-semibold">{e.empname || '—'}</td>
                      <td>{e.departmentcode || '—'}</td>
                      <td className="text-rose-300">{prettyDate(m.anniversarydate)}</td>
                      <td className="font-bold">{yearsCompleted(m.anniversarydate)}</td>
                      <td className="mono text-[10px]">{m.importedby || '—'}</td>
                      <td className="text-[10px]">{prettyDate(m.updateddate || m.createddate)}</td>
                      <td className="text-center">
                        <button type="button" onClick={() => remove(m.paycode)} disabled={busy === m.paycode} className="px-2.5 py-1 rounded-lg bg-rose-500/15 border border-rose-500/30 text-rose-300 hover:bg-rose-500/25 text-[11px] font-bold transition disabled:opacity-50">
                          <i className="fas fa-trash mr-1"></i>Remove
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        ) : (
          <p className="text-xs text-[var(--muted)] py-8 text-center">Koi marriage anniversary record nahi hai. "Import Excel" se HR data upload karein (matching key: paycode / presentcardno).</p>
        )}
      </div>
    </AsyncBox>
      {showImport ? <MarriageImportModal onClose={() => setShowImport(false)} onImported={mar.reload} /> : null}
    </>
  );
}
