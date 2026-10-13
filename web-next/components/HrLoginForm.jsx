'use client';

// web-next/components/HrLoginForm.jsx
// HR Admin login form. Existing backend /api/auth/hr/login se (Next route handler ke through)
// verify karta hai. Token browser JS me kabhi nahi aata (httpOnly cookie).

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import LoadingState from './LoadingState';
import { EyeIcon, EyeOffIcon, PersonIcon, LockIcon } from './icons';

export default function HrLoginForm() {
  const router = useRouter();
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [phase, setPhase] = useState('idle'); // idle | loading | error
  const [error, setError] = useState('');

  async function onSubmit(e) {
    e.preventDefault();
    if (!username.trim() || !password) {
      setError('HR username aur password required hain.');
      return;
    }
    setPhase('loading');
    setError('');
    try {
      const res = await fetch('/api/auth/hr', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username, password }),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok || !data?.success) {
        setError(data?.message || 'Login failed.');
        setPhase('error');
        return;
      }
      router.replace('/hr');
      router.refresh();
    } catch {
      setError('Backend se connect nahi ho paya. Thodi der baad try karein.');
      setPhase('error');
    }
  }

  return (
    <form className="auth" onSubmit={onSubmit} noValidate={false}>
      {error ? (
        <div className="auth__error" role="alert">{error}</div>
      ) : null}

      <div className="field">
        <label className="field__label" htmlFor="hr-username">HR Username</label>
        <div className="field__wrap field__wrap--icon">
          <span className="field__icon"><PersonIcon /></span>
          <input
            id="hr-username"
            className="field__input"
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            autoComplete="username"
            required
          />
        </div>
      </div>

      <div className="field">
        <label className="field__label" htmlFor="hr-password">Password</label>
        <div className="field__wrap field__wrap--icon">
          <span className="field__icon"><LockIcon /></span>
          <input
            id="hr-password"
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
