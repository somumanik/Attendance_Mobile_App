'use client';

// web-next/components/useApiData.js — shared data-fetch hook (client).
// Path relative to /api (e.g. '/hr/dashboard'). Cookie auto-sent, middleware Bearer inject karta hai.

import { useCallback, useEffect, useRef, useState } from 'react';
import apiFetch from '../lib/api';

export default function useApiData(path, deps = []) {
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);
  const [loading, setLoading] = useState(true);
  // Stale-response guard: only the LATEST request may update state, so a slow
  // response from a previous selection can never overwrite the current one.
  const seqRef = useRef(0);

  const load = useCallback(async () => {
    const seq = ++seqRef.current;
    if (!path) {
      setData(null);
      setError(null);
      setLoading(false);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const result = await apiFetch(path);
      if (seq !== seqRef.current) return;
      setData(result);
    } catch (e) {
      if (seq !== seqRef.current) return;
      setError(e?.message || 'Data load nahi ho paya.');
    } finally {
      if (seq === seqRef.current) setLoading(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [path]);

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [load, ...deps]);

  return { data, error, loading, reload: load };
}
