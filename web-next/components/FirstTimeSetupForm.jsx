'use client';

// web-next/components/FirstTimeSetupForm.jsx
// Employee first-time password creation (backend: POST /api/auth/employee/first-time-setup).
// Backend koi token nahi deta — employee ko normal login karna hota hai.

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import LoadingState from './LoadingState';
import { EyeIcon, EyeOffIcon, BadgeIcon, LockIcon } from './icons';

export default function FirstTimeSetupForm({ initialPaycode = '' }) {
  const router = useRouter();
  const [paycode, setPaycode] = useState(initialPaycode);
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [phase, setPhase] = useState('idle');
  const [error, setError] = useState('');

  async function onSubmit(e) {
    e.preventDefault();
    if (!paycode.trim()) { setError('Paycode required hai.'); return; }
    if (!password) { setError('Password required hai.'); return; }
    if (password !== confirmPassword) { setError('Password aur confirmation match nahi kar rahe.'); return; }
    setPhase('loading');
    setError('');
    try {
      const res = await fetch('/api/auth/employee/first-time-setup', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ paycode: paycode.trim(), password, confirmPassword }),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok || !data?.success) {
        setError(data?.message || 'Password setup failed. Please try again.');
        setPhase('error');
        return;
      }
      // Password set ho gaya — ab normal login karein.
      router.replace('/login/employee');
      router.refresh();
    } catch {
      setError('Backend se connect nahi ho paya. Thodi der baad try karein.');
      setPhase('error');
    }
  }

  return (
    <form className="auth" onSubmit={onSubmit}>
      {error ? <div className="auth__error" role="alert">{error}</div> : null}

      <div className="field">
        <label className="field__label" htmlFor="fts-paycode">Employee ID / Paycode</label>
        <div className="field__wrap field__wrap--icon">
          <span className="field__icon"><BadgeIcon /></span>
          <input id="fts-paycode" className="field__input" value={paycode} onChange={(e) => setPaycode(e.target.value)} autoComplete="username" required />
        </div>
      </div>

      <div className="field">
        <label className="field__label" htmlFor="fts-password">New Password</label>
        <div className="field__wrap field__wrap--icon">
          <span className="field__icon"><LockIcon /></span>
          <input id="fts-password" className="field__input" type={showPassword ? 'text' : 'password'} value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="new-password" required />
          <button type="button" className="field__toggle" onClick={() => setShowPassword((v) => !v)} aria-label={showPassword ? 'Hide' : 'Show'} aria-pressed={showPassword}>
            {showPassword ? <EyeOffIcon /> : <EyeIcon />}
          </button>
        </div>
      </div>

      <div className="field">
        <label className="field__label" htmlFor="fts-confirm">Confirm Password</label>
        <div className="field__wrap field__wrap--icon">
          <span className="field__icon"><LockIcon /></span>
          <input id="fts-confirm" className="field__input" type={showPassword ? 'text' : 'password'} value={confirmPassword} onChange={(e) => setConfirmPassword(e.target.value)} autoComplete="new-password" required />
        </div>
      </div>

      <p className="auth__hint">Password minimum 8 characters ka hona chahiye aur usme letters + numbers dono hone chahiye.</p>

      {phase === 'loading' ? (
        <LoadingState label="Password create ho raha hai..." compact />
      ) : (
        <button className="btn btn--primary btn--block" type="submit">Create Password</button>
      )}
    </form>
  );
}
