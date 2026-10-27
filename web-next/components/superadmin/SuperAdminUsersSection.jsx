'use client';

// web-next/components/superadmin/SuperAdminUsersSection.jsx — SuperAdmin user
// management (list / create / enable / disable / delete).
//
// Website port of the mobile SuperAdminUsersScreen over the SAME shared backend
// (/api/superadmin/super-admins*). SECURITY: these endpoints require the
// SUPERADMIN role (server-side). Bootstrap (env) SuperAdmin is protected — the
// server refuses delete/disable, and the last active SuperAdmin is protected
// too. Passwords never appear in responses; only status/list data.

import { useCallback, useEffect, useState } from 'react';
import apiFetch from '../../lib/api';

const inputCls = 'px-3 py-2 rounded-xl bg-[var(--input-bg)] border border-[var(--border)] text-xs text-[var(--text)] outline-none focus:border-[var(--accent)] w-full';
const btnGhost = 'px-3 py-2 rounded-xl bg-white/5 border border-[var(--border)] text-[var(--text)] text-[11px] font-bold transition hover:bg-white/10 disabled:opacity-40';
const btnPrimary = 'px-4 py-2 rounded-xl card-gradient-1 text-white text-[11px] font-bold shadow-lg shadow-indigo-600/30 hover:opacity-95 transition disabled:opacity-50';
const smallBtn = 'px-2.5 py-1 rounded-lg bg-white/5 border border-[var(--border)] text-[var(--text)] text-[11px] font-bold transition hover:bg-white/10 disabled:opacity-40';
const dangerBtn = 'px-2.5 py-1 rounded-lg bg-rose-500/15 border border-rose-500/30 text-rose-300 hover:bg-rose-500/25 text-[11px] font-bold transition disabled:opacity-40';
const msgOk = 'text-[11px] rounded-xl px-3 py-2 border bg-emerald-500/10 border-emerald-500/20 text-emerald-300';
const msgErr = 'text-[11px] rounded-xl px-3 py-2 border bg-rose-500/10 border-rose-500/20 text-rose-300';

export default function SuperAdminUsersSection() {
  const [admins, setAdmins] = useState([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [msg, setMsg] = useState('');
  const [form, setForm] = useState({ username: '', password: '', displayname: '' });
  const [pwFor, setPwFor] = useState(null);
  const [newPw, setNewPw] = useState('');
  const [confirmDelete, setConfirmDelete] = useState(null);

  const load = useCallback(async () => {
    setError('');
    try {
      const res = await apiFetch('/superadmin/super-admins');
      setAdmins(Array.isArray(res?.admins) ? res.admins : []);
    } catch (e) {
      setError(e?.data?.message || e?.message || 'SuperAdmin list load nahi ho payi.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const submit = async () => {
    setMsg(''); setError('');
    if (!form.username.trim() || !form.password) { setError('Username aur password required hain.'); return; }
    setBusy(true);
    try {
      await apiFetch('/superadmin/super-admins', {
        method: 'POST',
        body: {
          username: form.username.trim(),
          password: form.password,
          displayname: form.displayname.trim(),
        },
      });
      setForm({ username: '', password: '', displayname: '' });
      setMsg('SuperAdmin account ban gaya.');
      await load();
    } catch (e) {
      setError(e?.data?.message || e?.message || 'Create failed.');
    } finally {
      setBusy(false);
    }
  };

  const toggle = async (row) => {
    setError(''); setMsg('');
    try {
      await apiFetch(`/superadmin/super-admins/${encodeURIComponent(row.username)}`, {
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
      await apiFetch(`/superadmin/super-admins/${encodeURIComponent(pwFor)}/password`, {
        method: 'POST',
        body: { password: newPw },
      });
      setMsg(`Password updated for ${pwFor}.`);
      setPwFor(null); setNewPw('');
    } catch (e) {
      setError(e?.data?.message || e?.message || 'Password update failed.');
    }
  };

  const doDelete = async (username) => {
    setError(''); setMsg('');
    try {
      await apiFetch(`/superadmin/super-admins/${encodeURIComponent(username)}`, { method: 'DELETE' });
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
            <i className="fas fa-user-gear text-pink-400"></i> SuperAdmin Users
          </h2>
          <button type="button" onClick={load} className={btnGhost}><i className="fas fa-rotate mr-1"></i>Refresh</button>
        </div>
        <p className="text-[11px] text-[var(--muted)] max-w-3xl leading-relaxed">
          Bootstrap (server environment) SuperAdmin permanent hai — delete ya disable nahi hota.
          Aur last active SuperAdmin bhi protect hai. Passwords kabhi response me nahi aate.
        </p>
        {error ? <p className={`${msgErr} mt-3`}>{error}</p> : null}
        {msg ? <p className={`${msgOk} mt-3`}>{msg}</p> : null}
        {loading ? (
          <p className="text-[11px] text-[var(--muted)] mt-4"><i className="fas fa-spinner fa-spin mr-1"></i>Loading SuperAdmin accounts...</p>
        ) : null}

        <div className="space-y-3 mt-4">
          {admins.map((row) => (
            <div key={row.username} className="rounded-2xl border border-[var(--border)] p-4">
              <div className="flex items-center justify-between gap-3 flex-wrap">
                <div className="min-w-0">
                  <p className="text-sm font-extrabold text-[var(--text)]">
                    {row.username}
                    {row.isbootstrap ? <i className="fas fa-lock text-amber-400 text-[10px] ml-2"></i> : null}
                  </p>
                  <p className="text-[11px] text-[var(--muted)]">{row.displayname || '—'}</p>
                  <p className={`text-[11px] font-bold ${row.isactive ? 'text-emerald-300' : 'text-rose-300'}`}>
                    {row.isactive ? 'Active' : 'Disabled'}{row.source === 'env' ? ' · env-managed' : ''}
                  </p>
                </div>
                {row.isbootstrap ? null : (
                  <div className="flex flex-wrap items-center gap-2">
                    <button type="button" onClick={() => toggle(row)} className={smallBtn}>
                      {row.isactive ? 'Disable' : 'Enable'}
                    </button>
                    <button type="button" onClick={() => { setPwFor(pwFor === row.username ? null : row.username); setNewPw(''); }} className={smallBtn}>
                      Reset password
                    </button>
                    <button type="button" onClick={() => setConfirmDelete(confirmDelete === row.username ? null : row.username)} className={dangerBtn}>
                      <i className="fas fa-trash mr-1"></i>Delete
                    </button>
                  </div>
                )}
              </div>

              {pwFor === row.username ? (
                <div className="flex flex-wrap items-center gap-2 mt-3">
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

              {confirmDelete === row.username ? (
                <div className="rounded-xl border border-rose-500/40 bg-rose-500/10 p-3 mt-3">
                  <p className="text-[11px] text-[var(--text)] leading-relaxed">
                    Delete SuperAdmin &quot;{row.username}&quot;? This cannot be undone.
                  </p>
                  <div className="flex flex-wrap gap-2 mt-2">
                    <button type="button" onClick={() => setConfirmDelete(null)} className={smallBtn}>Cancel</button>
                    <button type="button" onClick={() => doDelete(row.username)} className={dangerBtn}>Confirm delete</button>
                  </div>
                </div>
              ) : null}
            </div>
          ))}
          {!loading && !admins.length ? (
            <p className="text-xs text-[var(--muted)] py-4 text-center">Koi SuperAdmin account nahi mila.</p>
          ) : null}
        </div>
      </div>

      {/* ---- add a SuperAdmin ---- */}
      <div className="glass-card rounded-3xl p-6">
        <h3 className="font-bold text-base text-[var(--text)] flex items-center gap-2 mb-4">
          <i className="fas fa-user-plus text-emerald-400"></i> Add a SuperAdmin
        </h3>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          <div>
            <label className="block text-[10px] font-bold uppercase text-[var(--muted)] mb-1" htmlFor="sa-new-username">Username</label>
            <input id="sa-new-username" className={inputCls} placeholder="Username" autoCapitalize="none" value={form.username} onChange={(e) => setForm({ ...form, username: e.target.value })} />
          </div>
          <div>
            <label className="block text-[10px] font-bold uppercase text-[var(--muted)] mb-1" htmlFor="sa-new-displayname">Display name (optional)</label>
            <input id="sa-new-displayname" className={inputCls} placeholder="Display name" value={form.displayname} onChange={(e) => setForm({ ...form, displayname: e.target.value })} />
          </div>
          <div>
            <label className="block text-[10px] font-bold uppercase text-[var(--muted)] mb-1" htmlFor="sa-new-password">Password</label>
            <input id="sa-new-password" type="password" className={inputCls} placeholder="Password (min 8, letters + numbers)" autoComplete="new-password" value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} />
          </div>
        </div>
        <button type="button" onClick={submit} disabled={busy} className={`${btnPrimary} mt-4 w-full sm:w-auto`}>
          {busy ? <i className="fas fa-spinner fa-spin mr-1"></i> : <i className="fas fa-plus mr-1"></i>}Create SuperAdmin
        </button>
      </div>
    </div>
  );
}