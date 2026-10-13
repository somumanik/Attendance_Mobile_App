// web-next/components/hr/ExecPunch.jsx — Executive Overview scoped punch-time cell.
// Original React website colours: IN = text-emerald-300, OUT = text-rose-300.
// A missing punch renders a neutral muted em dash (never coloured like a real
// punch time). The formatted value itself is passed through unchanged.

import { fmtPunch } from '../../lib/format';

export default function ExecPunch({ value, side }) {
  const text = fmtPunch(value);
  const missing = !value || text === '—';
  return (
    <span className={`mono ${missing ? 'punch-missing' : side === 'out' ? 'punch-out' : 'punch-in'}`}>
      {missing ? '—' : text}
    </span>
  );
}