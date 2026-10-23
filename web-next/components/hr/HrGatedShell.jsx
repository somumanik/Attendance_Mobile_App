'use client';

// web-next/components/hr/HrGatedShell.jsx — the HR shell gate (Phase 3).
// While the account's saved permissions are being retrieved it shows a loading
// state; if they cannot be verified it shows a safe error + retry (never full
// access). Once ready it renders the existing HR shell with the children.

import PortalShell from '../PortalShell';
import LoadingState from '../LoadingState';
import ErrorState from '../ErrorState';
import { useHrAccess, HrRouteGuard } from './HrAccess';

export default function HrGatedShell({ children }) {
  const { status, error, retry } = useHrAccess();

  if (status === 'loading') {
    return (
      <div className="emp-shell">
        <main className="emp-content">
          <div className="glass-card rounded-3xl p-10">
            <LoadingState label="Aapki permissions load ho rahi hain..." />
          </div>
        </main>
      </div>
    );
  }

  if (status === 'error') {
    return (
      <div className="emp-shell">
        <main className="emp-content">
          <div className="glass-card rounded-3xl p-10">
            <ErrorState message={error || 'Permissions verify nahi ho payi.'} onRetry={retry} />
          </div>
        </main>
      </div>
    );
  }

  return (
    <PortalShell variant="hr">
      <HrRouteGuard>{children}</HrRouteGuard>
    </PortalShell>
  );
}