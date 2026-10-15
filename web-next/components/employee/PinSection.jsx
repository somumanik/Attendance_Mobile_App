'use client';

// web-next/components/employee/PinSection.jsx
// Employee 4-digit PIN setup (forced/voluntary) aur change (voluntary).
// Backend identity JWT se leta hai — paycode body se kabhi nahi. PIN kabhi store,
// log ya response mein nahi jaata.

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import useApiData from '../useApiData';
import AsyncBox from '../employee/AsyncBox';
import apiFetch from '../../lib/api';
import { FingerprintIcon } from '../icons';

const PIN_LENGTH = 4;
const digitsOnly = (text) => String(text || '').replace(/[^0-9]/g, '').slice(0, PIN_LENGTH);

export default function PinSection({ forced = false }) {
  const router = useRouter();
  const status = useApiData('/employee/pin/status');

  const [mode, setMode] = useState('change'); // 'setup' | 'change'
  const [currentPin, setCurrentPin] = useState('');
  const [newPin, setNewPin] = useState('');
  const [confirmPin, setConfirmPin] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!status.data) return;
    const needsSetup = forced === true || status.data.pinSetupRequired === true || status.data.pinConfigured === false;
    setMode(needsSetup ? 'setup' : 'change');
  }, [status.data, forced]);

  async function submitSetup(e) {
    e.preventDefault();
    if (!/^\d{4}$/.test(newPin)) { setError('PIN exactly 4 digits ka hona chahiye.'); return; }
    if (newPin !== confirmPin) { setError('PIN aur confirmation match nahi kar rahe.'); return; }
    setBusy(true);
    setError('');
    try {
      await apiFetch('/employee/pin/setup', { method: 'POST', body: { pin: newPin, confirmPin } });
      router.refresh();
    } catch (err) {
      setError(err?.message || 'PIN setup failed. Please try again.');
    } finally {
      setBusy(false);
    }
  }

  async function submitChange(e) {
    e.preventDefault();
    if (!/^\d{4}$/.test(currentPin)) { setError('Current PIN exactly 4 digits ka hona chahiye.'); return; }
    if (!/^\d{4}$/.test(newPin)) { setError('New PIN exactly 4 digits ka hona chahiye.'); return; }
    if (newPin !== confirmPin) { setError('New PIN aur confirmation match nahi kar rahe.'); return; }
    if (currentPin === newPin) { setError('New PIN current PIN se different hona chahiye.'); return; }
    setBusy(true);
    setError('');
    try {
      await apiFetch('/employee/pin/change', { method: 'POST', body: { currentPin, newPin, confirmPin } });
      router.refresh();
    } catch (err) {
      setError(err?.message || 'PIN change failed. Please try again.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <AsyncBox loading={status.loading} error={status.error} onRetry={status.reload} label="PIN status load ho raha hai...">
      <div className="card">
        <h3 className="card__title">{mode === 'setup' ? 'Create 4-Digit PIN' : 'Change 4-Digit PIN'}</h3>

        {mode === 'setup' && forced ? (
          <div className="gate" style={{ marginBottom: 14 }}>
            <p className="gate__title">PIN setup required</p>
            <p className="gate__text">Dashboard kholne se pehle apna 4-digit PIN banana zaroori hai. Ye aapke password ka replacement nahi hai.</p>
          </div>
        ) : null}

        {mode === 'setup' ? (
          <form onSubmit={submitSetup}>
            {error ? <div className="auth__error" role="alert">{error}</div> : null}

            <div className="field">
              <label className="field__label" htmlFor="pin-setup">Create 4-Digit PIN</label>
              <div className="field__wrap field__wrap--icon">
                <span className="field__icon"><FingerprintIcon /></span>
                <input id="pin-setup" className="field__input" type="password" inputMode="numeric" autoComplete="off" maxLength={PIN_LENGTH} value={newPin} onChange={(e) => setNewPin(digitsOnly(e.target.value))} placeholder="••••" required />
              </div>
            </div>

            <div className="field">
              <label className="field__label" htmlFor="pin-setup-confirm">Confirm 4-Digit PIN</label>
              <div className="field__wrap field__wrap--icon">
                <span className="field__icon"><FingerprintIcon /></span>
                <input id="pin-setup-confirm" className="field__input" type="password" inputMode="numeric" autoComplete="off" maxLength={PIN_LENGTH} value={confirmPin} onChange={(e) => setConfirmPin(digitsOnly(e.target.value))} placeholder="••••" required />
              </div>
            </div>

            <p className="auth__hint">PIN exactly 4 numbers ka hona chahiye.</p>
            <button className="btn btn--primary btn--block" type="submit" disabled={busy}>{busy ? 'Saving PIN...' : 'Create PIN'}</button>
          </form>
        ) : (
          <form onSubmit={submitChange}>
            {error ? <div className="auth__error" role="alert">{error}</div> : null}

            <div className="field">
              <label className="field__label" htmlFor="pin-current">Current 4-Digit PIN</label>
              <div className="field__wrap field__wrap--icon">
                <span className="field__icon"><FingerprintIcon /></span>
                <input id="pin-current" className="field__input" type="password" inputMode="numeric" autoComplete="off" maxLength={PIN_LENGTH} value={currentPin} onChange={(e) => setCurrentPin(digitsOnly(e.target.value))} placeholder="••••" required />
              </div>
            </div>

            <div className="field">
              <label className="field__label" htmlFor="pin-new">New 4-Digit PIN</label>
              <div className="field__wrap field__wrap--icon">
                <span className="field__icon"><FingerprintIcon /></span>
                <input id="pin-new" className="field__input" type="password" inputMode="numeric" autoComplete="off" maxLength={PIN_LENGTH} value={newPin} onChange={(e) => setNewPin(digitsOnly(e.target.value))} placeholder="••••" required />
              </div>
            </div>

            <div className="field">
              <label className="field__label" htmlFor="pin-confirm">Confirm New 4-Digit PIN</label>
              <div className="field__wrap field__wrap--icon">
                <span className="field__icon"><FingerprintIcon /></span>
                <input id="pin-confirm" className="field__input" type="password" inputMode="numeric" autoComplete="off" maxLength={PIN_LENGTH} value={confirmPin} onChange={(e) => setConfirmPin(digitsOnly(e.target.value))} placeholder="••••" required />
              </div>
            </div>

            <button className="btn btn--primary btn--block" type="submit" disabled={busy}>{busy ? 'Updating PIN...' : 'Change PIN'}</button>
          </form>
        )}
      </div>
    </AsyncBox>
  );
}
