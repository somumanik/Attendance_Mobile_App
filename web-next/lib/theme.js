// web-next/lib/theme.js — client-only theme helpers (localStorage + data-theme).
// Sirf theme preference yahan save hota hai; koi credential/token kabhi nahi.

export const THEME_STORAGE_KEY = 'attendance_theme';
export const DEFAULT_THEME = 'purple';

export const THEMES = [
  { id: 'purple', label: 'Dark Purple', swatch: '#7c3aed' },
  { id: 'light', label: 'Light Professional', swatch: '#4f46e5' },
  { id: 'blue', label: 'Midnight Blue', swatch: '#3b82f6' },
  { id: 'emerald', label: 'Emerald Dark', swatch: '#10b981' },
];

export function applyTheme(id) {
  if (typeof document === 'undefined') return;
  const next = id || DEFAULT_THEME;
  document.documentElement.setAttribute('data-theme', next);
  try {
    localStorage.setItem(THEME_STORAGE_KEY, next);
  } catch {
    /* private mode / blocked storage — theme still applies for this visit */
  }
}

export function readTheme() {
  if (typeof document === 'undefined') return DEFAULT_THEME;
  return document.documentElement.getAttribute('data-theme') || DEFAULT_THEME;
}
