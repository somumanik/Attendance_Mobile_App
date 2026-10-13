'use client';

// web-next/components/EmployeeLoginForm.jsx
// Employee login form. Existing backend /api/auth/employee/login se verify karta hai.
// Paycode browser se sirf credential ke roop me jata hai — asli identity backend
// (JWT + dbo.tblemployee) se aati hai, browser pe bharosa nahi hota.

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import LoadingState from './LoadingState';
import { EyeIcon, EyeOffIcon, BadgeIcon, LockIcon } from './icons';

export default function EmployeeLoginForm() {
  const router = useRouter();
  const [paycode, setPaycode] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [phase, setPhase] = useState('idle');
  const [error, setError] = useState('');

  async function onSubmit(e) {
    e.preventDefault();
    if (!paycode.trim() || !password) {
      setError('Employee paycode aur password required hain.');
      return;
    }
    setPhase('loading');
    setError('');
    try {
      const res = await fetch('/api/auth/employee', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ paycode, password }),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok || !data?.success) {
        setError(data?.message || 'Login failed.');
        setPhase('error');
        return;
      }
      // mustChangePassword / pinSetupRequired gates `/employee` server component
      // khud handle karega (backend /api/me se live flags padhke).
      router.replace('/employee');
      router.refresh();
    } catch {
      setError('Backend se connect nahi ho paya. Thodi der baad try karein.');
      setPhase('error');
    }
  }

  return (
    <form className="auth" onSubmit={onSubmit}>
      {error ? (
        <div className="auth__error" role="alert">{error}</div>
      ) : null}

      <div className="field">
        <label className="field__label" htmlFor="emp-paycode">Employee ID / Paycode</label>
        <div className="field__wrap field__wrap--icon">
          <span className="field__icon"><BadgeIcon /></span>
          <input
            id="emp-paycode"
            className="field__input"
            value={paycode}
            onChange={(e) => setPaycode(e.target.value)}
            autoComplete="username"
            required
          />
        </div>
      </div>

      <div className="field">
        <label className="field__label" htmlFor="emp-password">Password</label>
        <div className="field__wrap field__wrap--icon">
          <span className="field__icon"><LockIcon /></span>
          <input
            id="emp-password"
            className="field__input"
            type={showPassword ? 'text' : 'password'}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            autoComplete="current-password"
            required
          />
          <button
            type="button"
            className="field__toggle"
            onClick={() => setShowPassword((v) => !v)}
            aria-label={showPassword ? 'Hide password' : 'Show password'}
            aria-pressed={showPassword}
          >
            {showPassword ? <EyeOffIcon /> : <EyeIcon />}
          </button>
        </div>
      </div>

      {phase === 'loading' ? (
        <LoadingState label="Login ho raha hai..." compact />
      ) : (
        <button className="btn btn--primary btn--block" type="submit">Login</button>
      )}
    </form>
  );
}
