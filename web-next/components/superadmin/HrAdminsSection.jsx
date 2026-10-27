'use client';

// web-next/components/superadmin/HrAdminsSection.jsx — HR Admin account +
// module/action permission management (SuperAdmin console).
//
// Website port of the mobile SuperAdminHRAdminsScreen against the SAME shared
// backend (/api/superadmin/hr-admins*, /api/superadmin/companies). The module/
// action catalog comes from the server — nothing is assumed per module.
//
// IMPORTANT: ye section sirf UI convenience hai. Har save ke baad permissions
// server par persist hoti hain aur har protected endpoint unhe LIVE enforce
// karta hai — button hide karna security nahi hai. Bootstrap (env) HR account
// always-full aur protected hai.

import { useCallback, useEffect, useRef, useState } from 'react';
import apiFetch from '../../lib/api';

const ACTION_LABELS = {
  view: 'View', create: 'Add', edit: 'Edit', delete: 'Delete',
  import: 'Import', export: 'Export', approve: 'Approve', email: 'Email',
};
const ACTION_KEYS = ['view', 'create', 'edit', 'delete', 'import', 'export', 'approve', 'email'];

/* Master Reports is configured with the EXISTING view/export actions; the chips
   are labelled with the permission names the console documents for it. */
const actionChipLabel = (moduleKey, action) => {
  if (moduleKey === 'reports' && action === 'view') return 'View Master Reports';
  if (moduleKey === 'reports' && action === 'export') return 'Export Master Reports';
  return ACTION_LABELS[action] || action;
};

const inputCls = 'px-3 py-2 rounded-xl bg-[var(--input-bg)] border border-[var(--border)] text-xs text-[var(--text)] outline-none focus:border-[var(--accent)] w-full';
const btnGhost = 'px-3 py-2 rounded-xl bg-white/5 border border-[var(--border)] text-[var(--text)] text-[11px] font-bold transition hover:bg-white/10 disabled:opacity-40';
const btnPrimary = 'px-4 py-2 rounded-xl card-gradient-1 text-white text-[11px] font-bold shadow-lg shadow-indigo-600/30 hover:opacity-95 transition disabled:opacity-50';
const smallBtn = 'px-2.5 py-1 rounded-lg bg-white/5 border border-[var(--border)] text-[var(--text)] text-[11px] font-bold transition hover:bg-white/10 disabled:opacity-40';
const dangerBtn = 'px-2.5 py-1 rounded-lg bg-rose-500/15 border border-rose-500/30 text-rose-300 hover:bg-rose-500/25 text-[11px] font-bold transition disabled:opacity-40';
const chipCls = (on) => `px-2.5 py-1 rounded-full border text-[10px] font-bold transition ${on ? 'bg-indigo-600 border-indigo-500 text-white' : 'bg-white/5 border-[var(--border)] text-[var(--muted)] hover:bg-white/10'}`;
const msgOk = 'text-[11px] rounded-xl px-3 py-2 border bg-emerald-500/10 border-emerald-500/20 text-emerald-300';
const msgErr = 'text-[11px] rounded-xl px-3 py-2 border bg-rose-500/10 border-rose-500/20 text-rose-300';

export default function HrAdminsSection() {
  const [admins, setAdmins] = useState([]);
  const [modules, setModules] = useState([]);
  const [actions, setActions] = useState([]);
  const [availableCompanies, setAvailableCompanies] = useState([]);
  const [selected, setSelected] = useState(null);
  const [draft, setDraft] = useState({});
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [msg, setMsg] = useState('');
  const [form, setForm] = useState({ username: '', password: '', displayname: '' });
  const [pwFor, setPwFor] = useState(null);
  const [newPw, setNewPw] = useState('');
  /* Company codes come from the server's authoritative catalogue (real
     dbo.tblemployee.companycode values); nothing is hard-coded here. */
  const [newCompanies, setNewCompanies] = useState([]);
  const [editCompanies, setEditCompanies] = useState({});   // username -> [codes]
  const [confirmDelete, setConfirmDelete] = useState(null); // username awaiting confirmation
  /* Explicit save lifecycle so the UI can never claim a save the backend did not
     confirm, and two saves can never overlap. */
  const [saveState, setSaveState] = useState(null); // 'saving' | 'saved' | 'error'
  const savingRef = useRef(false);

  const load = useCallback(async () => {
    setError('');
    try {
      const res = await apiFetch('/superadmin/hr-admins');
      setAdmins(Array.isArray(res?.admins) ? res.admins : []);
      setModules(Array.isArray(res?.modules) ? res.modules : []);
      setActions(Array.isArray(res?.actions) ? res.actions : []);
      setAvailableCompanies(Array.isArray(res?.availableCompanies) ? res.availableCompanies : []);
    } catch (e) {
      setError(e?.data?.message || e?.message || 'HR Admin list load nahi ho payi.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const openEditor = (row) => {
    setMsg(''); setError('');
    setSelected(row.username);
    setPwFor(null);
    setDraft(JSON.parse(JSON.stringify(row.permissions || {})));
    // Preload the account's REAL assignments so they can be inspected and
    // updated without recreating the account.
    setEditCompanies((prev) => ({
      ...prev,
      [row.username]: Array.isArray(row.companies) ? [...row.companies] : [],
    }));
    setConfirmDelete(null);
  };

  const toggleAction = (moduleKey, action) => {
    setDraft((prev) => ({
      ...prev,
      [moduleKey]: { ...(prev[moduleKey] || {}), [action]: !(prev[moduleKey] || {})[action] },
    }));
  };

  /* Navigation placement for one module — 'primary' | 'more'. Clicking the
     active choice again clears it (NULL restores the default). LAYOUT ONLY. */
  const setPlacement = (moduleKey, placement) => {
    setDraft((prev) => {
      const current = (prev[moduleKey] || {}).placement;
      const next = current === placement ? null : placement;
      return { ...prev, [moduleKey]: { ...(prev[moduleKey] || {}), placement: next } };
    });
  };

  /* Visible / Hidden — independent of actions and placement. Contradiction
     guard: a Hidden section cannot be placed in a menu. */
  const setVisibility = (moduleKey, visible) => {
    setDraft((prev) => ({
      ...prev,
      [moduleKey]: {
        ...(prev[moduleKey] || {}),
        visible,
        placement: visible ? (prev[moduleKey] || {}).placement : null,
      },
    }));
  };

  /** Compares one module's settings. `undefined` = "off"/unset. */
  const sameModule = (a, b) => {
    const A = a || {}; const B = b || {};
    for (const f of ACTION_KEYS) {
      if (Boolean(A[f]) !== Boolean(B[f])) return false;
    }
    const vis = (m) => (m.visible === false ? false : (m.visible === true ? true : null));
    if (vis(A) !== vis(B)) return false;
    if ((A.placement || null) !== (B.placement || null)) return false;
    return true;
  };

  /** True when the form holds selections that are not persisted yet. */
  const dirtyFor = (username) => {
    if (username !== selected) return false;
    const row = admins.find((a) => a.username === username);
    const persisted = row?.permissions || {};
    const keys = [...new Set([...Object.keys(persisted), ...Object.keys(draft || {})])];
    return keys.some((k) => !sameModule(persisted[k], (draft || {})[k]));
  };

  /**
   * SAVE + CONFIRM permissions:
   *  - only one save can be in flight;
   *  - explicit saving → saved/failed state;
   *  - success is reported ONLY when the backend response matches what was sent;
   *  - the draft is re-synced from the SERVER payload, so stale frontend state
   *    can never show an unsaved selection as persisted.
   */
  const saveDraft = async () => {
    if (!selected) return;
    if (savingRef.current) return;
    savingRef.current = true;
    const username = selected;
    const sent = JSON.parse(JSON.stringify(draft || {}));
    setBusy(true); setError(''); setMsg(''); setSaveState('saving');
    try {
      const res = await apiFetch(`/superadmin/hr-admins/${encodeURIComponent(username)}`, {
        method: 'PUT',
        body: { permissions: sent },
      });
      const persisted = res?.permissions || null;
      await load(); // reload persisted state from the backend
      let mismatched;
      if (persisted) {
        const keys = [...new Set([...Object.keys(persisted), ...Object.keys(sent)])];
        mismatched = keys.filter((k) => !sameModule(persisted[k], sent[k]));
        setDraft(JSON.parse(JSON.stringify(persisted)));
      } else {
        mismatched = ['(no confirmation payload returned by the server)'];
      }
      if (mismatched.length) {
        setSaveState('error');
        setError(`Not confirmed by the server for: ${mismatched.join(', ')}. Reload and check before relying on it.`);
      } else {
        setSaveState('saved');
        setMsg(`Permissions saved successfully for ${username}.`);
      }
    } catch (e) {
      setSaveState('error');
      setError(e?.data?.message || e?.message || 'Save failed.');
    } finally {
      savingRef.current = false;
      setBusy(false);
    }
  };

  /** Toggle one company code inside an array of codes. */
  const toggleCode = (list, code) => (list.includes(code) ? list.filter((c) => c !== code) : [...list, code]);

  /** Persist this account's company assignments (server validates codes). */
  const saveCompanies = async (username) => {
    setBusy(true); setError(''); setMsg('');
    try {
      const codes = editCompanies[username] || [];
      if (!codes.length) { setError('Select at least one company for this account.'); return; }
      const res = await apiFetch(`/superadmin/hr-admins/${encodeURIComponent(username)}/companies`, {
        method: 'PUT',
        body: { companies: codes },
      });
      setMsg(`Companies saved for ${username}: ${(res?.companies || codes).join(', ')}`);
      await load();
    } catch (e) {
      setError(e?.data?.message || e?.message || 'Company assignment save failed.');
    } finally {
      setBusy(false);
    }
  };

  const addAdmin = async () => {
    setError(''); setMsg('');
    if (!form.username.trim() || !form.password) { setError('Username aur password required hain.'); return; }
    // A normal newly created HR Admin must get at least one valid company assignment.
    if (!newCompanies.length) { setError('Select at least one company for this HR Admin.'); return; }
    setBusy(true);
    try {
      await apiFetch('/superadmin/hr-admins', {
        method: 'POST',
        body: {
          username: form.username.trim(),
          password: form.password,
          displayname: form.displayname.trim(),
          companies: newCompanies,
        },
      });
      setForm({ username: '', password: '', displayname: '' });
      setNewCompanies([]);
      setMsg('HR Admin account ban gaya.');
      await load();
    } catch (e) {
      setError(e?.data?.message || e?.message || 'Create failed.');
    } finally {
      setBusy(false);
    }
  };

  const toggleActive = async (row) => {
    setError(''); setMsg('');
    try {
      await apiFetch(`/superadmin/hr-admins/${encodeURIComponent(row.username)}`, {
        method: 'PUT',
        body: { isactive: !row.isactive },
      });
      await load();
    } catch (e) {
      setError(e?.data?.message || e?.message || 'Update failed.');
    }
  };

  const resetPassword = async () => {
    if (!pwFor || !newPw) return;
    setError(''); setMsg('');
    try {
      await apiFetch(`/superadmin/hr-admins/${encodeURIComponent(pwFor)}/password`, {
        method: 'POST',
        body: { password: newPw },
      });
      setMsg(`Password updated for ${pwFor}.`);
      setPwFor(null); setNewPw('');
    } catch (e) {
      setError(e?.data?.message || e?.message || 'Password update failed.');
    }
  };

  /** In-app delete confirmation (names the account) — API only after confirm. */
  const doDelete = async (username) => {
    setError(''); setMsg('');
    try {
      await apiFetch(`/superadmin/hr-admins/${encodeURIComponent(username)}`, { method: 'DELETE' });
      if (selected === username) setSelected(null);
      setConfirmDelete(null);
      setMsg(`Deleted ${username}.`);
      await load();
    } catch (e) {
      setError(e?.data?.message || e?.message || 'Delete failed.');
    }
  };

  return (
    <div className="space-y-4">
      <div className="glass-card rounded-3xl p-6">
        <div className="flex items-center justify-between gap-3 flex-wrap mb-2">
          <h2 className="font-bold text-lg text-[var(--text)] flex items-center gap-2">
            <i className="fas fa-user-shield text-purple-400"></i> HR Admin Accounts &amp; Permissions
          </h2>
          <button type="button" onClick={load} className={btnGhost}><i className="fas fa-rotate mr-1"></i>Refresh</button>
        </div>
        <p className="text-[11px] text-[var(--muted)] max-w-3xl leading-relaxed">
          Permissions server par save hoti hain aur har API request par enforce hoti hain —
          revoked permission turant lagu hoti hai, chahe purana screen khula ho.
          <i className="fas fa-lock ml-1 mr-1 text-amber-400"></i>= bootstrap account (always full access).
        </p>
        {error ? <p className={`${msgErr} mt-3`}>{error}</p> : null}
        {msg ? <p className={`${msgOk} mt-3`}>{msg}</p> : null}
        {loading ? (
          <p className="text-[11px] text-[var(--muted)] mt-4"><i className="fas fa-spinner fa-spin mr-1"></i>Loading HR Admin accounts...</p>
        ) : null}
      </div>

      {admins.map((row) => (
        <div key={row.username} className="glass-card rounded-3xl p-6">
          <button
            type="button"
            onClick={() => (selected === row.username ? setSelected(null) : openEditor(row))}
            className="w-full flex items-center justify-between gap-3 text-left"
            aria-expanded={selected === row.username}
          >
            <span className="min-w-0">
              <span className="block text-sm font-extrabold text-[var(--text)]">
                {row.username}
                {row.isbootstrap ? <i className="fas fa-lock text-amber-400 text-[10px] ml-2"></i> : null}
              </span>
              <span className="block text-[11px] text-[var(--muted)]">{row.displayname || '—'}</span>
              <span className={`block text-[11px] font-bold ${row.isactive ? 'text-emerald-300' : 'text-rose-300'}`}>
                {row.isactive ? 'Active' : 'Disabled'}
              </span>
            </span>
            <i className={`fas ${selected === row.username ? 'fa-chevron-up' : 'fa-chevron-down'} text-[var(--muted)]`}></i>
          </button>

          {selected === row.username ? (
            <div className="mt-4 border-t border-white/10 pt-4 space-y-4">
              {!row.isbootstrap ? (
                <div className="flex flex-wrap items-center gap-2">
                  <button type="button" onClick={() => toggleActive(row)} className={smallBtn}>
                    {row.isactive ? 'Disable' : 'Enable'}
                  </button>
                  <button type="button" onClick={() => { setPwFor(pwFor === row.username ? null : row.username); setNewPw(''); }} className={smallBtn}>
                    Reset password
                  </button>
                  <button type="button" onClick={() => { setConfirmDelete(confirmDelete === row.username ? null : row.username); setError(''); }} className={dangerBtn}>
                    <i className="fas fa-trash mr-1"></i>Delete
                  </button>
                </div>
              ) : null}

              {pwFor === row.username ? (
                <div className="flex flex-wrap items-center gap-2">
                  <input
                    type="password"
                    className={`${inputCls} flex-1 min-w-[180px]`}
                    placeholder="New password (min 8, letters + numbers)"
                    value={newPw}
                    onChange={(e) => setNewPw(e.target.value)}
                    autoComplete="new-password"
                  />
                  <button type="button" onClick={resetPassword} className={smallBtn}>Save</button>
                </div>
              ) : null}

              {/* Company assignments: inspect AND update an existing account.
                  Codes come from the server's real catalogue; an account with no
                  assignment is denied company data. */}
              {!row.isbootstrap ? (
                <div>
                  <p className="text-[11px] font-bold text-[var(--text)] mb-1">Company codes</p>
                  {Array.isArray(row.companies) && row.companies.length ? (
                    <p className="text-[10px] text-[var(--muted)] mb-2">Currently assigned: {row.companies.join(', ')}</p>
                  ) : (
                    <p className="text-[10px] text-rose-300 mb-2">
                      No company assigned — this account is denied company data until one is set.
                    </p>
                  )}
                  <div className="flex flex-wrap gap-1.5">
                    {availableCompanies.map((code) => {
                      const list = editCompanies[row.username] || [];
                      const on = list.includes(code);
                      return (
                        <button
                          key={code}
                          type="button"
                          onClick={() => setEditCompanies((prev) => ({ ...prev, [row.username]: toggleCode(prev[row.username] || [], code) }))}
                          className={chipCls(on)}
                          aria-pressed={on}
                        >
                          {code}
                        </button>
                      );
                    })}
                  </div>
                  <button type="button" onClick={() => saveCompanies(row.username)} disabled={busy} className={`${btnGhost} mt-2 w-full sm:w-auto`}>
                    {busy ? <i className="fas fa-spinner fa-spin mr-1"></i> : null}Save companies
                  </button>
                </div>
              ) : null}

              {/* In-app delete confirmation (names the account). */}
              {!row.isbootstrap && confirmDelete === row.username ? (
                <div className="rounded-xl border border-rose-500/40 bg-rose-500/10 p-3">
                  <p className="text-[11px] text-[var(--text)] leading-relaxed">
                    Delete HR Admin &quot;{row.username}&quot;? This removes the account, its permissions and its
                    company assignments. This cannot be undone.
                  </p>
                  <div className="flex flex-wrap gap-2 mt-2">
                    <button type="button" onClick={() => setConfirmDelete(null)} className={smallBtn}>Cancel</button>
                    <button type="button" onClick={() => doDelete(row.username)} className={dangerBtn}>Confirm delete</button>
                  </div>
                </div>
              ) : null}

              {/* ---- module / action permission matrix (server catalog) ---- */}
              <div>
                <p className="text-[11px] font-bold text-[var(--text)] mb-2">Module permissions</p>
                <div className="space-y-3">
                  {modules.map((mod) => (
                    <div key={mod.key} className="rounded-xl border border-[var(--border)] p-3">
                      <p className="text-[11px] font-extrabold text-[var(--text)] mb-2">{mod.label}</p>
                      {mod.key === 'reports' ? (
                        <p className="text-[10px] text-[var(--muted)] mb-2 leading-relaxed">
                          <span className="font-bold text-[var(--text)]">View Master Reports</span> — access to the Master Reports page and its permitted data.
                          <span className="font-bold text-[var(--text)]"> Export Master Reports</span> — Excel export (requires View; company scope always applies).
                        </p>
                      ) : null}
                      {/* Visible / Hidden is INDEPENDENT of the action permissions
                          and of the Primary tab / More menu placement: it only
                          controls whether the section appears at all. */}
                      <div className="flex flex-wrap gap-1.5 mb-2">
                        {[['visible', 'Visible'], ['hidden', 'Hidden']].map(([mode, label]) => {
                          const cur = (draft[mod.key] || {}).visible;
                          const on = mode === 'visible' ? cur !== false : cur === false;
                          return (
                            <button
                              key={mode}
                              type="button"
                              onClick={() => setVisibility(mod.key, mode === 'visible')}
                              className={chipCls(on)}
                              aria-pressed={on}
                            >
                              {label}
                            </button>
                          );
                        })}
                      </div>
                      <div className="flex flex-wrap gap-1.5">
                        {actions.map((action) => {
                          const on = (draft[mod.key] || {})[action] === true;
                          return (
                            <button
                              key={action}
                              type="button"
                              onClick={() => toggleAction(mod.key, action)}
                              className={chipCls(on)}
                              aria-pressed={on}
                            >
                              {actionChipLabel(mod.key, action)}
                            </button>
                          );
                        })}
                      </div>
                      {/* Navigation placement. Only shown for a module the HR Admin
                          can actually VIEW — placement is layout only and never
                          grants access. Clicking the active choice clears it. */}
                      {(draft[mod.key] || {}).view === true ? (
                        <div className="flex flex-wrap gap-1.5 mt-2">
                          {['primary', 'more'].map((pl) => {
                            const on = (draft[mod.key] || {}).placement === pl;
                            return (
                              <button
                                key={pl}
                                type="button"
                                onClick={() => setPlacement(mod.key, pl)}
                                className={chipCls(on)}
                                aria-pressed={on}
                              >
                                {pl === 'primary' ? 'Primary tab' : 'More menu'}
                              </button>
                            );
                          })}
                        </div>
                      ) : null}
                    </div>
                  ))}
                </div>
              </div>

              {row.isbootstrap ? (
                <p className="text-[11px] text-[var(--muted)]">Bootstrap account always keeps full permissions.</p>
              ) : (
                <div>
                  {dirtyFor(row.username) ? (
                    <p className="text-[11px] font-bold text-amber-300 mb-2">Unsaved changes — not saved yet.</p>
                  ) : (
                    <p className="text-[11px] text-[var(--muted)] mb-2">No unsaved changes.</p>
                  )}
                  {saveState === 'saving' ? <p className="text-[11px] text-[var(--muted)] mb-2">Saving permissions...</p> : null}
                  {saveState === 'saved' ? <p className={`${msgOk} mb-2`}>Permissions saved successfully.</p> : null}
                  <button type="button" onClick={saveDraft} disabled={busy} className={`${btnPrimary} w-full sm:w-auto`}>
                    {busy ? <i className="fas fa-spinner fa-spin mr-1"></i> : <i className="fas fa-check mr-1"></i>}Save permissions
                  </button>
                </div>
              )}
            </div>
          ) : null}
        </div>
      ))}

      {/* ---- add an HR Admin ---- */}
      <div className="glass-card rounded-3xl p-6">
        <h3 className="font-bold text-base text-[var(--text)] flex items-center gap-2 mb-4">
          <i className="fas fa-user-plus text-emerald-400"></i> Add an HR Admin
        </h3>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          <div>
            <label className="block text-[10px] font-bold uppercase text-[var(--muted)] mb-1" htmlFor="ha-username">Username</label>
            <input id="ha-username" className={inputCls} placeholder="Username" autoCapitalize="none" value={form.username} onChange={(e) => setForm({ ...form, username: e.target.value })} />
          </div>
          <div>
            <label className="block text-[10px] font-bold uppercase text-[var(--muted)] mb-1" htmlFor="ha-displayname">Display name (optional)</label>
            <input id="ha-displayname" className={inputCls} placeholder="Display name" value={form.displayname} onChange={(e) => setForm({ ...form, displayname: e.target.value })} />
          </div>
          <div>
            <label className="block text-[10px] font-bold uppercase text-[var(--muted)] mb-1" htmlFor="ha-password">Password</label>
            <input id="ha-password" type="password" className={inputCls} placeholder="Password (min 8, letters + numbers)" autoComplete="new-password" value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} />
          </div>
        </div>
        <p className="text-[11px] font-bold text-[var(--text)] mt-4 mb-2">Company codes (select at least one)</p>
        {availableCompanies.length ? (
          <div className="flex flex-wrap gap-1.5">
            {availableCompanies.map((code) => {
              const on = newCompanies.includes(code);
              return (
                <button
                  key={code}
                  type="button"
                  onClick={() => setNewCompanies((prev) => toggleCode(prev, code))}
                  className={chipCls(on)}
                  aria-pressed={on}
                >
                  {code}
                </button>
              );
            })}
          </div>
        ) : (
          <p className="text-[11px] text-[var(--muted)]">No company codes were found in the employee master.</p>
        )}
        <button type="button" onClick={addAdmin} disabled={busy} className={`${btnPrimary} mt-4 w-full sm:w-auto`}>
          {busy ? <i className="fas fa-spinner fa-spin mr-1"></i> : <i className="fas fa-plus mr-1"></i>}Create HR Admin
        </button>
      </div>
    </div>
  );
}