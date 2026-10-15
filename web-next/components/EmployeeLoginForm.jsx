'use client';

// web-next/components/EmployeeLoginForm.jsx
// Employee login form. Existing backend /api/auth/employee/login se verify karta hai
// (password ya 4-digit PIN). Paycode browser se sirf credential ke roop me jata hai —
// asli identity backend (JWT + dbo.tblemployee) se aati hai, browser pe bharosa nahi hota.

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import LoadingState from './LoadingState';
import { EyeIcon, EyeOffIcon, BadgeIcon, LockIcon, FingerprintIcon } from './icons';

export default function EmployeeLoginForm() {
  const router = useRouter();
  const [paycode, setPaycode] = useState('');
  const [password, setPassword] = useState('');
  const [pin, setPin] = useState('');
  const [usePin, setUsePin] = useState(false);
  const [showSecret, setShowSecret] = useState(false);
  const [phase, setPhase] = useState('idle'); // idle | loading | error
  const [error, setError] = useState('');

  function switchMode() {
    setUsePin((v) => !v);
    setPassword('');
    setPin('');
    setShowSecret(false);
    setError('');
  }

  async function onSubmit(e) {
    e.preventDefault();
    if (!paycode.trim()) {
      setError('Employee paycode required hai.');
      return;
    }
    if (usePin) {
      if (!/^\d{4}$/.test(pin.trim())) {
        setError('PIN exactly 4 digits ka hona chahiye.');
        return;
      }
    } else if (!password) {
      setError('Employee paycode aur password required hain.');
      return;
    }

    setPhase('loading');
    setError('');
    try {
      const body = usePin
        ? { paycode: paycode.trim(), pin: pin.trim(), credential: 'pin' }
        : { paycode: paycode.trim(), password };
      const res = await fetch('/api/auth/employee', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      const data = await res.json().catch(() => null);

      if (!res.ok || !data?.success) {
        // Backend batata hai ki is employee ka password abhi set nahi hai.
        if (data?.firstTimeSetupRequired === true) {
          router.replace('/login/employee/setup?paycode=' + encodeURIComponent(paycode.trim()));
          return;
        }
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
        <label className="field__label" htmlFor="emp-secret">{usePin ? '4-Digit PIN' : 'Password'}</label>
        <div className="field__wrap field__wrap--icon">
          <span className="field__icon">{usePin ? <FingerprintIcon /> : <LockIcon />}</span>
          {usePin ? (
            <input
              id="emp-secret"
              className="field__input"
              type={showSecret ? 'text' : 'password'}
              inputMode="numeric"
              autoComplete="off"
              maxLength={4}
              value={pin}
              onChange={(e) => setPin(e.target.value.replace(/[^0-9]/g, '').slice(0, 4))}
              placeholder="••••"
              required
            />
          ) : (
            <input
              id="emp-secret"
              className="field__input"
              type={showSecret ? 'text' : 'password'}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              autoComplete="current-password"
              required
            />
          )}
          <button
            type="button"
            className="field__toggle"
            onClick={() => setShowSecret((v) => !v)}
            aria-label={showSecret ? 'Hide' : 'Show'}
            aria-pressed={showSecret}
          >
            {showSecret ? <EyeOffIcon /> : <EyeIcon />}
          </button>
        </div>
      </div>

      <div className="auth__switch">
        <button type="button" onClick={switchMode}>
          {usePin ? 'Use Password instead' : 'Login with 4-digit PIN'}
        </button>
      </div>

      {phase === 'loading' ? (
        <LoadingState label="Login ho raha hai..." compact />
      ) : (
        <button className="btn btn--primary btn--block" type="submit">Login</button>
      )}

      <div className="auth__links">
        <a className="auth__forgot" href="/login/employee/forgot">Forgot Password?</a>
      </div>
    </form>
  );
}
