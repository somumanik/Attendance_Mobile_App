// web-next/components/employee/AsyncBox.jsx — shared loading/error wrapper.

import LoadingState from '../LoadingState';
import ErrorState from '../ErrorState';

export default function AsyncBox({ loading, error, onRetry, children, label }) {
  if (loading) return <LoadingState label={label || 'Loading data...'} />;
  if (error) return <ErrorState message={error} onRetry={onRetry} />;
  return children;
}
