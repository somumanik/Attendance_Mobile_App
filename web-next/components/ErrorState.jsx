// web-next/components/ErrorState.jsx
// Reusable error state. `onRetry` pass karo tabhi Retry button dikhta hai.
// Kabhi bhi fake/empty success nahi dikhata.

export default function ErrorState({ message = 'Something went wrong.', onRetry }) {
  return (
    <div className="error" role="alert">
      <span className="error__icon" aria-hidden="true">⚠️</span>
      <p className="error__text">{message}</p>
      {typeof onRetry === 'function' ? (
        <button className="error__retry" type="button" onClick={onRetry}>
          Retry
        </button>
      ) : null}
    </div>
  );
}
