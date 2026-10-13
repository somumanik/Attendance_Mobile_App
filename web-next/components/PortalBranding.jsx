// web-next/components/PortalBranding.jsx — old Attendance Portal branding (server component).
// Fingerprint logo + "Attendance Portal" + subtitle + real DB status badge.

import { FingerprintIcon } from './icons';
import DbStatusBadge from './DbStatusBadge';

export default function PortalBranding() {
  return (
    <header className="brand">
      <div className="brand__logo" aria-hidden="true">
        <FingerprintIcon />
      </div>
      <h1 className="brand__title">Attendance Portal</h1>
      <p className="brand__subtitle">Savior Biometric SQL Server • Self Service &amp; HR Admin</p>
      <DbStatusBadge />
    </header>
  );
}
