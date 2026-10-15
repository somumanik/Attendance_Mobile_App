'use client';

// web-next/components/employee/PasswordChangeSection.jsx
// Employee apna password badalta hai (forced ya voluntary).
// Backend identity JWT se leta hai — paycode body se kabhi nahi. Current password
// hamesha verify hota hai (temporary password bhi), isliye forced flow bhi safe hai.

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import apiFetch from '../../lib/api';
import { EyeIcon, EyeOffIcon, LockIcon } from '../icons';

const RULES = ['At least 8 characters', 'At least one letter and one number'];

export default function PasswordChangeSection({ forced = false }) {
  const router = useRouter();
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  async function onSubmit(e) {
    e.preventDefault();
    if (!currentPassword) { setError('Current password required hai.'); return; }
    if (!newPassword) { setError('New password required hai.'); return; }
    if (newPassword !== confirmPassword) { setError('New password aur confirmation match nahi kar rahe.'); return; }
    if (newPassword === currentPassword) { setError('New password current password se alag hona chahiye.'); return; }
    setBusy(true);
    setError('');
    try {
      await apiFetch('/employee/password/change', {
        method: 'POST',
        body: { currentPassword, newPassword, confirmPassword },
      });
      // Backend ne mustchangepassword = 0 kar diya hai. Live flags dobara padhne ke
      // liye server components refresh karte hain (gate turant clear ho jaata hai).
      router.refresh();
    } catch (err) {
      setError(err?.message || 'Password change failed. Please try again.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="card">
      <h3 className="card__title">Change Password</h3>
      {forced ? (
        <div className="gate" style={{ marginBottom: 14 }}>
          <p className="gate__title">Password change required</p>
          <p className="gate__text">Aapko naya password set karna zaroori hai. Dashboard aur baaki sections tab tak locked hain jab tak naya password set nahi hota.</p>
        </div>
      ) : null}

      <form onSubmit={onSubmit}>
        {error ? <div className="auth__error" role="alert">{error}</div> : null}

        <div className="field">
          <label className="field__label" htmlFor="pc-current">Current Password</label>
          <div className="field__wrap field__wrap--icon">
            <span className="field__icon"><LockIcon /></span>
            <input id="pc-current" className="field__input" type={showPassword ? 'text' : 'password'} value={currentPassword} onChange={(e) => setCurrentPassword(e.target.value)} autoComplete="current-password" required />
          </div>
        </div>

        <div className="field">
          <label className="field__label" htmlFor="pc-new">New Password</label>
          <div className="field__wrap field__wrap--icon">
            <span className="field__icon"><LockIcon /></span>
            <input id="pc-new" className="field__input" type={showPassword ? 'text' : 'password'} value={newPassword} onChange={(e) => setNewPassword(e.target.value)} autoComplete="new-password" required />
            <button type="button" className="field__toggle" onClick={() => setShowPassword((v) => !v)} aria-label={showPassword ? 'Hide' : 'Show'} aria-pressed={showPassword}>
              {showPassword ? <EyeOffIcon /> : <EyeIcon />}
            </button>
          </div>
        </div>

        <div className="field">
          <label className="field__label" htmlFor="pc-confirm">Confirm New Password</label>
          <div className="field__wrap field__wrap--icon">
            <span className="field__icon"><LockIcon /></span>
            <input id="pc-confirm" className="field__input" type={showPassword ? 'text' : 'password'} value={confirmPassword} onChange={(e) => setConfirmPassword(e.target.value)} autoComplete="new-password" required />
          </div>
        </div>

        <ul className="auth__hint" style={{ listStyle: 'none', padding: 0, margin: '0 0 14px' }}>
          {RULES.map((r) => <li key={r}>• {r}</li>)}
        </ul>

        <button className="btn btn--primary btn--block" type="submit" disabled={busy}>
          {busy ? 'Saving...' : 'Set New Password'}
        </button>
      </form>
    </div>
  );
}
