// web-next/components/LoadingState.jsx
// Reusable loading indicator. `compact` = chhota inline spinner, default = full block.

export default function LoadingState({ label = 'Loading data...', compact = false, hint }) {
  return (
    <div className={compact ? 'load load--compact' : 'load load--full'} role="status" aria-live="polite">
      <span className="load__spinner" aria-hidden="true" />
      <span className="load__text">{label}</span>
      {hint ? <span className="load__hint">{hint}</span> : null}
    </div>
  );
}
