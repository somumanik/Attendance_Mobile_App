'use client';

// web-next/components/ThemeSelector.jsx — 4 theme switcher (instant, localStorage me yaad rehta hai).

import { useEffect, useState } from 'react';
import { THEMES, DEFAULT_THEME, applyTheme, readTheme } from '../lib/theme';

export default function ThemeSelector() {
  const [active, setActive] = useState(DEFAULT_THEME);

  useEffect(() => {
    setActive(readTheme());
  }, []);

  function select(id) {
    applyTheme(id);
    setActive(id);
  }

  return (
    <div className="theme-picker" role="group" aria-label="Choose theme">
      <span className="theme-picker__label">Theme</span>
      {THEMES.map((t) => (
        <button
          key={t.id}
          type="button"
          className="theme-picker__btn"
          aria-pressed={active === t.id}
          onClick={() => select(t.id)}
        >
          <span className="theme-picker__swatch" style={{ background: t.swatch }} aria-hidden="true" />
          {t.label}
        </button>
      ))}
    </div>
  );
}
