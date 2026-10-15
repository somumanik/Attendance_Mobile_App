'use client';

// web-next/components/ForgotPasswordForm.jsx
// Employee forgot-password request (backend: POST /api/auth/employee/forgot-password).
// Backend generic message deta hai (account enumeration nahi hota); reset code email par jaata hai.

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import LoadingState from './LoadingState';
import { BadgeIcon } from './icons';

export default function ForgotPasswordForm() {
  const router = useRouter();
  const [paycode, setPaycode] = useState('');
  const [phase, setPhase] = useState('idle');
  const [error, setError] = useState('');
  const [sent, setSent] = useState(false);

  async function onSubmit(e) {
    e.preventDefault();
    if (!paycode.trim()) { setError('Paycode required hai.'); return; }
    setPhase('loading');
    setError('');
    try {
      const res = await fetch('/api/auth/employee/forgot-password', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ paycode: paycode.trim() }),
      });
      await res.json().catch(() => null);
      // Backend generic 200 deta hai — hum bhi wahi message show karte hain.
      setSent(true);
    } catch {
      setError('Backend se connect nahi ho paya. Thodi der baad try karein.');
    } finally {
      setPhase('idle');
    }
  }

  if (sent) {
    return (
      <div className="auth">
        <div className="auth__success" role="status">
          <p className="auth__success-title">Check your email</p>
          <p className="auth__success-text">If the account is eligible for password recovery, reset instructions have been sent to the registered email.</p>
          <p className="auth__success-hint">Apne registered email par reset code check karein, phir neeche Reset Password par code enter karein.</p>
        </div>
        <button className="btn btn--primary btn--block" type="button" onClick={() => router.push('/login/employee/reset')}>Open Reset Password</button>
        <div className="auth__links" style={{ marginTop: 12 }}>
          <a className="auth__forgot" href="/login/employee">Back to Login</a>
        </div>
      </div>
    );
  }

  return (
    <form className="auth" onSubmit={onSubmit}>
      {error ? <div className="auth__error" role="alert">{error}</div> : null}

      <div className="field">
        <label className="field__label" htmlFor="fg-paycode">Employee ID / Paycode</label>
        <div className="field__wrap field__wrap--icon">
          <span className="field__icon"><BadgeIcon /></span>
          <input id="fg-paycode" className="field__input" value={paycode} onChange={(e) => setPaycode(e.target.value)} autoComplete="username" required />
        </div>
      </div>

      <p className="auth__hint">Reset code aapke registered email par bheja jayega. Code ek hi baar use hoga aur 15 minute me expire ho jayega.</p>

      {phase === 'loading' ? (
        <LoadingState label="Sending..." compact />
      ) : (
        <button className="btn btn--primary btn--block" type="submit">Send Reset Instructions</button>
      )}
    </form>
  );
}
