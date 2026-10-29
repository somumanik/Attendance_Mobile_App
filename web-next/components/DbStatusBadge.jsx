'use client';

// web-next/components/DbStatusBadge.jsx
// Real Savior SQL Server status. Existing backend GET /api/diagnostics/db use karta hai
// (ye explicitly `status: connected | unavailable | not_configured` batata hai).
// Sirf success + status read karte hain — `config`/`database`/`message` browser me nahi dikhate
// (wo internal details / raw error ho sakte hain). Click = manual re-check, koi polling nahi.

import { useCallback, useEffect, useState } from 'react';

const LABELS = {
  checking: 'Checking connection…',
  connected: 'Savior PORTAL Server: Connected',
  disconnected: 'Savior PORTAL Server: Disconnected',
  unavailable: 'Savior PORTAL Server: Status unavailable',
};

export default function DbStatusBadge() {
  const [state, setState] = useState('checking'); // checking | connected | disconnected | unavailable

  const check = useCallback(async () => {
    setState('checking');
    try {
      const res = await fetch('/api/diagnostics/db', {
        method: 'GET',
        headers: { Accept: 'application/json' },
        cache: 'no-store',
      });
      let data = null;
      try {
        data = await res.json();
      } catch {
        data = null;
      }
      if (res.ok && data?.success === true && data?.status === 'connected') {
        setState('connected');
      } else if (data && (data?.status === 'unavailable' || data?.status === 'not_configured')) {
        setState('disconnected');
      } else {
        setState('unavailable');
      }
    } catch {
      setState('unavailable');
    }
  }, []);

  useEffect(() => {
    check();
  }, [check]);

  return (
    <button
      type="button"
      className={`dbstatus dbstatus--${state}`}
      onClick={check}
      title="Click to re-check connection"
      aria-live="polite"
    >
      <span className="dbstatus__dot" aria-hidden="true" />
      {LABELS[state] || LABELS.unavailable}
    </button>
  );
}
