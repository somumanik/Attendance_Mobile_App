'use client';

// web-next/components/hr/HrEmployeeCredentialsSection.jsx
// HR-controlled employee credential management (parity with mobile HREmployeeCredentialsScreen).
// Backend enforces authenticate + requireRole('HR') + requirePaycodeInScope on EVERY action;
// response me kabhi password/PIN hash nahi aata.

import { useRef, useState } from 'react';
import apiFetch from '../../lib/api';
import { HrCan } from './HrAccess';

const inputCls = 'w-full mt-1 px-3 py-2 rounded-xl bg-[var(--input-bg)] border border-[var(--border)] text-xs text-[var(--text)] outline-none focus:border-[var(--accent)]';
const labelCls = 'text-[10px] uppercase font-bold text-[var(--muted)]';

function StatusBadge({ label, value, tone }) {
  const cls = {
    green: 'badge--present',
    amber: 'badge--miss',
    rose: 'badge--absent',
    sky: 'badge--leave',
    neutral: 'badge--neutral',
  }[tone || 'neutral'];
  return (
    <div className="flex items-center justify-between gap-3 rounded-xl bg-white/5 border border-white/5 px-3 py-2">
      <span className="text-[10px] uppercase font-bold text-[var(--muted)]">{label}</span>
      <span className={`badge ${cls}`}>{value}</span>
    </div>
  );
}

function Notice({ ok, children }) {
  return (
    <div className={`rounded-xl px-3 py-2 text-[11px] font-semibold leading-relaxed ${ok ? 'bg-emerald-500/10 border border-emerald-500/20 text-emerald-200' : 'bg-rose-500/10 border border-rose-500/20 text-rose-200'}`}>
      {children}
    </div>
  );
}

const digitsOnly = (t) => String(t || '').replace(/[^0-9]/g, '').slice(0, 4);

export default function HrEmployeeCredentialsSection() {
  const [search, setSearch] = useState('');
  const [results, setResults] = useState([]);
  const [open, setOpen] = useState(false);
  const [searching, setSearching] = useState(false);
  const [selected, setSelected] = useState(null); // { paycode, empname }
  const [status, setStatus] = useState(null);
  const [statusLoading, setStatusLoading] = useState(false);

  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [pin, setPin] = useState('');
  const [confirmPin, setConfirmPin] = useState('');

  const [pwBusy, setPwBusy] = useState(false);
  const [pinBusy, setPinBusy] = useState(false);
  const [forceBusy, setForceBusy] = useState(false);
  const [requirePinBusy, setRequirePinBusy] = useState(false);
  const [notice, setNotice] = useState(null); // { ok, text }
  const timer = useRef(null);

  async function runSearch(term) {
    const q = String(term ?? '').trim();
    if (q.length < 2) { setResults([]); setOpen(false); return; }
    setSearching(true);
    try {
      const d = await apiFetch('/employees?search=' + encodeURIComponent(q) + '&pageSize=10');
      setResults(d.rows || []);
      setOpen(true);
    } catch {
      setResults([]);
    } finally {
      setSearching(false);
    }
  }

  function onSearchInput(q) {
    setSearch(q);
    clearTimeout(timer.current);
    timer.current = setTimeout(() => runSearch(q), 300);
  }

  async function loadStatus(paycode) {
    setStatusLoading(true);
    try {
      const d = await apiFetch('/hr/employee/credentials?paycode=' + encodeURIComponent(paycode));
      setStatus(d);
    } catch (err) {
      setNotice({ ok: false, text: err?.message || 'Credential status load failed.' });
      setStatus(null);
    } finally {
      setStatusLoading(false);
    }
  }

  function selectEmployee(e) {
    setSelected({ paycode: e.paycode, empname: e.empname });
    setOpen(false);
    setNotice(null);
    setPassword('');
    setConfirmPassword('');
    setPin('');
    setConfirmPin('');
    setStatus(null);
    loadStatus(e.paycode);
  }

  async function resetPassword(mustChange) {
    if (!selected) return;
    if (!password) { setNotice({ ok: false, text: 'Naya password likhein.' }); return; }
    if (password !== confirmPassword) { setNotice({ ok: false, text: 'Password aur confirmation match nahi kar rahe.' }); return; }
    setPwBusy(true); setNotice(null);
    try {
      const d = await apiFetch('/hr/employee/credentials/password', {
        method: 'POST',
        body: { paycode: selected.paycode, password, confirmPassword, mustChange },
      });
      setNotice({ ok: true, text: d.message || (d.mustChangePassword ? 'Temporary password set.' : 'Password updated.') });
      setPassword(''); setConfirmPassword('');
      loadStatus(selected.paycode);
    } catch (err) {
      setNotice({ ok: false, text: err?.message || 'Password reset failed.' });
    } finally {
      setPwBusy(false);
    }
  }

  async function forcePasswordChange() {
    if (!selected) return;
    setForceBusy(true); setNotice(null);
    try {
      await apiFetch('/hr/employee/credentials/force-password-change', { method: 'POST', body: { paycode: selected.paycode } });
      setNotice({ ok: true, text: 'Employee ko next login par naya password banana hoga.' });
      loadStatus(selected.paycode);
    } catch (err) {
      setNotice({ ok: false, text: err?.message || 'Force password change failed.' });
    } finally {
      setForceBusy(false);
    }
  }

  async function resetPin() {
    if (!selected) return;
    if (!/^\d{4}$/.test(pin)) { setNotice({ ok: false, text: 'PIN exactly 4 digits ka hona chahiye.' }); return; }
    if (pin !== confirmPin) { setNotice({ ok: false, text: 'PIN aur confirmation match nahi kar rahe.' }); return; }
    setPinBusy(true); setNotice(null);
    try {
      await apiFetch('/hr/employee/credentials/pin', { method: 'POST', body: { paycode: selected.paycode, pin, confirmPin } });
      setNotice({ ok: true, text: 'Employee PIN updated.' });
      setPin(''); setConfirmPin('');
      loadStatus(selected.paycode);
    } catch (err) {
      setNotice({ ok: false, text: err?.message || 'PIN reset failed.' });
    } finally {
      setPinBusy(false);
    }
  }

  async function requirePinSetup() {
    if (!selected) return;
    setRequirePinBusy(true); setNotice(null);
    try {
      await apiFetch('/hr/employee/credentials/require-pin-setup', { method: 'POST', body: { paycode: selected.paycode } });
      setNotice({ ok: true, text: 'Employee must complete the 4-digit PIN setup before the dashboard.' });
      loadStatus(selected.paycode);
    } catch (err) {
      setNotice({ ok: false, text: err?.message || 'Require PIN setup failed.' });
    } finally {
      setRequirePinBusy(false);
    }
  }

  return (
    <div className="glass-card rounded-3xl p-6">
      <div className="flex flex-wrap items-center justify-between gap-4 mb-5 pb-4 border-b border-[var(--border)]">
        <div>
          <h3 className="font-bold text-base text-[var(--text)] flex items-center gap-2"><i className="fas fa-id-badge text-indigo-400"></i> Employee Credential Management</h3>
          <p className="text-xs text-[var(--muted)]">Real employee ka password / 4-digit PIN reset — HR Admin only, identity real Savior paycode se.</p>
        </div>
      </div>

      {/* Search */}
      <div className="p-4 rounded-2xl bg-white/5 border border-white/5 relative mb-5">
        <p className="text-xs font-bold text-[var(--text)] mb-3"><i className="fas fa-magnifying-glass text-indigo-400 mr-1.5"></i>Find Employee <span className="text-[10px] font-normal text-[var(--muted)]">— Paycode ya Name</span></p>
        <input value={search} onChange={(e) => onSearchInput(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') runSearch(search); }} className={inputCls} placeholder="Paycode / Employee Name…" />
        {searching ? <p className="text-[11px] text-[var(--muted)] mt-1.5">Searching…</p> : null}
        {open && (
          <div className="absolute left-4 right-4 top-full mt-1 z-20 glass rounded-2xl p-1.5 max-h-64 overflow-y-auto border border-white/10">
            {results.length ? (
              results.map((e) => (
                <button key={e.paycode} type="button" onClick={() => selectEmployee(e)} className="w-full text-left px-3 py-2 rounded-xl hover:bg-white/10 flex items-center justify-between gap-3">
                  <span className="text-xs font-bold text-[var(--text)] truncate">{e.empname}</span>
                  <span className="text-[10px] mono text-indigo-300 whitespace-nowrap">{e.paycode} • {e.companycode || '—'}/{e.departmentcode || '—'}</span>
                </button>
              ))
            ) : (
              <p className="px-3 py-2 text-xs text-[var(--muted)]">Koi employee nahi mila.</p>
            )}
          </div>
        )}
      </div>

      {/* Selected employee + status */}
      {selected ? (
        <div className="p-4 rounded-2xl bg-white/5 border border-white/5 mb-5">
          <div className="flex flex-wrap items-center justify-between gap-3 mb-3">
            <div>
              <p className="text-sm font-bold text-[var(--text)]">{selected.empname}</p>
              <p className="text-[11px] mono text-indigo-300">{selected.paycode}</p>
            </div>
            {statusLoading ? <p className="text-[11px] text-[var(--muted)]">Status load ho raha hai…</p> : null}
          </div>
          {status ? (
            <div className="grid grid-cols-1 md:grid-cols-3 gap-2.5">
              <StatusBadge label="Password" value={status.passwordSet ? 'Set' : 'Not set'} tone={status.passwordSet ? 'green' : 'amber'} />
              <StatusBadge label="4-Digit PIN" value={status.pinSet ? 'Set' : 'Not set'} tone={status.pinSet ? 'green' : 'amber'} />
              <StatusBadge label="Login" value={status.loginEnabled === false ? 'Disabled' : 'Enabled'} tone={status.loginEnabled === false ? 'rose' : 'green'} />
              <StatusBadge label="Must Change Password" value={status.mustChangePassword ? 'Yes' : 'No'} tone={status.mustChangePassword ? 'amber' : 'neutral'} />
              <StatusBadge label="PIN Setup Required" value={status.pinSetupRequired ? 'Yes' : 'No'} tone={status.pinSetupRequired ? 'amber' : 'neutral'} />
              <StatusBadge label="Account Active" value={status.accountActive ? 'Yes' : 'No'} tone={status.accountActive ? 'green' : 'rose'} />
            </div>
          ) : null}
        </div>
      ) : (
        <p className="text-xs text-[var(--muted)] py-4 text-center mb-5">Employee select karein — phir uska password ya PIN reset kar sakte hain.</p>
      )}

      {notice ? <div className="mb-5"><Notice ok={notice.ok}>{notice.text}</Notice></div> : null}

      {selected ? (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
          {/* Password management */}
          <div className="p-4 rounded-2xl bg-white/5 border border-white/5">
            <p className="text-xs font-bold text-[var(--text)] mb-3"><i className="fas fa-lock text-emerald-400 mr-1.5"></i>Password Management</p>
            <div className="space-y-2.5">
              <div><label className={labelCls}>New Password</label><input type="password" autoComplete="off" value={password} onChange={(e) => setPassword(e.target.value)} className={inputCls} placeholder="••••••••" /></div>
              <div><label className={labelCls}>Confirm Password</label><input type="password" autoComplete="off" value={confirmPassword} onChange={(e) => setConfirmPassword(e.target.value)} className={inputCls} placeholder="••••••••" /></div>
              <p className="text-[10px] text-[var(--muted)] leading-relaxed">Password minimum 8 characters + letters &amp; numbers. Password reset se employee ka PIN change NAHI hota.</p>
              <HrCan module="credentials" action="edit">
                <button type="button" onClick={() => resetPassword(false)} disabled={pwBusy} className="w-full py-2.5 rounded-xl bg-emerald-500/15 border border-emerald-500/30 text-emerald-300 hover:bg-emerald-500/25 text-xs font-bold transition disabled:opacity-50">
                  {pwBusy ? 'Updating...' : 'Reset Password'}
                </button>
              </HrCan>
              <HrCan module="credentials" action="edit">
                <button type="button" onClick={() => resetPassword(true)} disabled={pwBusy} className="w-full py-2.5 rounded-xl bg-amber-500/15 border border-amber-500/30 text-amber-300 hover:bg-amber-500/25 text-xs font-bold transition disabled:opacity-50">
                  {pwBusy ? 'Updating...' : 'Set Temporary Password'}
                </button>
              </HrCan>
              <HrCan module="credentials" action="edit">
                <button type="button" onClick={forcePasswordChange} disabled={forceBusy} className="w-full py-2.5 rounded-xl bg-white/5 border border-[var(--border)] hover:bg-white/10 text-[var(--text)] text-xs font-bold transition disabled:opacity-50">
                  {forceBusy ? 'Forcing...' : 'Force Password Change'}
                </button>
              </HrCan>
            </div>
          </div>

          {/* PIN management */}
          <div className="p-4 rounded-2xl bg-white/5 border border-white/5">
            <p className="text-xs font-bold text-[var(--text)] mb-3"><i className="fas fa-fingerprint text-sky-400 mr-1.5"></i>Reset 4-Digit PIN</p>
            <div className="space-y-2.5">
              <div><label className={labelCls}>New 4-Digit PIN</label><input type="password" inputMode="numeric" autoComplete="off" maxLength={4} value={pin} onChange={(e) => setPin(digitsOnly(e.target.value))} className={inputCls} placeholder="••••" /></div>
              <div><label className={labelCls}>Confirm 4-Digit PIN</label><input type="password" inputMode="numeric" autoComplete="off" maxLength={4} value={confirmPin} onChange={(e) => setConfirmPin(digitsOnly(e.target.value))} className={inputCls} placeholder="••••" /></div>
              <p className="text-[10px] text-[var(--muted)] leading-relaxed">Exactly 4 numbers. PIN reset se employee ka password change NAHI hota.</p>
              <HrCan module="credentials" action="edit">
                <button type="button" onClick={resetPin} disabled={pinBusy} className="w-full py-2.5 rounded-xl bg-sky-500/15 border border-sky-500/30 text-sky-300 hover:bg-sky-500/25 text-xs font-bold transition disabled:opacity-50">
                  {pinBusy ? 'Updating...' : 'Reset PIN'}
                </button>
              </HrCan>
              <HrCan module="credentials" action="edit">
                <button type="button" onClick={requirePinSetup} disabled={requirePinBusy} className="w-full py-2.5 rounded-xl bg-white/5 border border-[var(--border)] hover:bg-white/10 text-[var(--text)] text-xs font-bold transition disabled:opacity-50">
                  {requirePinBusy ? 'Requiring...' : 'Require PIN Setup Again'}
                </button>
              </HrCan>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
