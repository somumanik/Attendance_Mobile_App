'use client';

// web-next/components/ResetPasswordForm.jsx
// Employee password reset using emailed one-time code (backend: POST /api/auth/employee/reset-password).
// Sirf token authorize karta hai — paycode yahan accept nahi hota.

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import LoadingState from './LoadingState';
import { EyeIcon, EyeOffIcon, LockIcon, FingerprintIcon } from './icons';

export default function ResetPasswordForm() {
  const router = useRouter();
  const [token, setToken] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [phase, setPhase] = useState('idle');
  const [error, setError] = useState('');

  async function onSubmit(e) {
    e.preventDefault();
    if (!token.trim()) { setError('Reset code required hai.'); return; }
    if (!password) { setError('Password required hai.'); return; }
    if (password !== confirmPassword) { setError('Password aur confirmation match nahi kar rahe.'); return; }
    setPhase('loading');
    setError('');
    try {
      const res = await fetch('/api/auth/employee/reset-password', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token: token.trim(), newPassword: password, confirmPassword }),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok || !data?.success) {
        setError(data?.message || 'Password reset failed. Please try again.');
        setPhase('error');
        return;
      }
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
        <label className="field__label" htmlFor="rp-token">Reset Code</label>
        <div className="field__wrap field__wrap--icon">
          <span className="field__icon"><FingerprintIcon /></span>
          <input id="rp-token" className="field__input" value={token} onChange={(e) => setToken(e.target.value)} autoComplete="off" required />
        </div>
      </div>

      <div className="field">
        <label className="field__label" htmlFor="rp-password">New Password</label>
        <div className="field__wrap field__wrap--icon">
          <span className="field__icon"><LockIcon /></span>
          <input id="rp-password" className="field__input" type={showPassword ? 'text' : 'password'} value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="new-password" required />
          <button type="button" className="field__toggle" onClick={() => setShowPassword((v) => !v)} aria-label={showPassword ? 'Hide' : 'Show'} aria-pressed={showPassword}>
            {showPassword ? <EyeOffIcon /> : <EyeIcon />}
          </button>
        </div>
      </div>

      <div className="field">
        <label className="field__label" htmlFor="rp-confirm">Confirm New Password</label>
        <div className="field__wrap field__wrap--icon">
          <span className="field__icon"><LockIcon /></span>
          <input id="rp-confirm" className="field__input" type={showPassword ? 'text' : 'password'} value={confirmPassword} onChange={(e) => setConfirmPassword(e.target.value)} autoComplete="new-password" required />
        </div>
      </div>

      <p className="auth__hint">Password minimum 8 characters aur letters + numbers dono hone chahiye. Code ek hi baar use hota hai.</p>

      {phase === 'loading' ? (
        <LoadingState label="Password update ho raha hai..." compact />
      ) : (
        <button className="btn btn--primary btn--block" type="submit">Reset Password</button>
      )}
    </form>
  );
}
