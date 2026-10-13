'use client';

// web-next/components/ApiHealthCheck.jsx
// Existing backend se connection test karta hai (GET /api/health through Next proxy).
// Loading / success / error states honestly dikhata hai. Koi secret expose nahi karta.

import { useCallback, useEffect, useState } from 'react';
import apiFetch from '../lib/api';
import LoadingState from './LoadingState';
import ErrorState from './ErrorState';

export default function ApiHealthCheck() {
  const [phase, setPhase] = useState('loading'); // 'loading' | 'ok' | 'error'
  const [info, setInfo] = useState(null);
  const [message, setMessage] = useState('');

  const run = useCallback(async () => {
    setPhase('loading');
    setMessage('');
    setInfo(null);
    try {
      const data = await apiFetch('/health');
      setInfo({ status: data?.status, source: data?.source });
      setPhase('ok');
    } catch (err) {
      setMessage(err?.message || 'Backend se connect nahi ho paya.');
      setPhase('error');
    }
  }, []);

  useEffect(() => {
    run();
  }, [run]);

  if (phase === 'loading') {
    return <LoadingState label="Backend connection test ho rahi hai..." />;
  }

  if (phase === 'error') {
    return <ErrorState message={message} onRetry={run} />;
  }

  return (
    <div className="health" role="status" aria-live="polite">
      <span className="health__dot" aria-hidden="true" />
      <span>
        Backend connected — {info?.source || 'API online'} ({info?.status || 'ok'})
      </span>
      <button className="health__again" type="button" onClick={run}>
        Test again
      </button>
    </div>
  );
}
