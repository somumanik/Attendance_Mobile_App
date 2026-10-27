'use client';

// web-next/components/ThemeSync.jsx — hydration-safe theme bootstrap.
//
// ROOT CAUSE of the recurring Next.js hydration mismatch: the old root layout ran
// an inline <script> that mutated document.documentElement's data-theme BEFORE
// React hydrated. The server-rendered HTML therefore differed from the DOM React
// tried to hydrate, so React reported "some attributes of the server rendered HTML
// didn't match the client properties" for data-theme (e.g. purple vs emerald).
//
// Fix: never touch data-theme before hydration. The server HTML and the first
// client render both leave <html> without a data-theme attribute (deterministic,
// identical) — the :root theme vars already style the default look. Only after
// React has hydrated do we apply the saved preference. This keeps the persisted
// theme, works on refresh / direct navigation / client navigation, and needs no
// suppressHydrationWarning. It uses the existing preference system unchanged
// (localStorage THEME_STORAGE_KEY + DEFAULT_THEME fallback).

import { useEffect } from 'react';
import { THEME_STORAGE_KEY, DEFAULT_THEME } from '../lib/theme';

export default function ThemeSync() {
  useEffect(() => {
    let next = DEFAULT_THEME;
    try {
      next = window.localStorage.getItem(THEME_STORAGE_KEY) || DEFAULT_THEME;
    } catch {
      /* private mode / blocked storage — fall back to the default theme */
    }
    document.documentElement.setAttribute('data-theme', next);
  }, []);

  return null;
}