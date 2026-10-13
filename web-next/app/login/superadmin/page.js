import Link from 'next/link';
import PortalBranding from '../../../components/PortalBranding';
import ThemeSelector from '../../../components/ThemeSelector';

export default function SuperAdminLoginPage() {
  return (
    <main className="page">
      <div className="auth">
        <Link className="auth__back" href="/login">← Back to role selection</Link>
        <PortalBranding />
        <h2 className="auth__role">SuperAdmin</h2>

        <div className="pending">
          <div className="pending__icon" aria-hidden="true">🔐</div>
          <h2 className="pending__title">Website access setup pending</h2>
          <p className="pending__text">
            SuperAdmin ka website authentication integration abhi pending hai.
            Mobile app ka SuperAdmin login alag hai aur is website se connected nahi hai.
            Ye section agle approved phase me migrate hoga — SuperAdmin tabs ke
            screenshots milne ke baad.
          </p>
          <Link className="btn btn--primary" href="/login">Back to role selection</Link>
        </div>
      </div>

      <div style={{ marginTop: 20 }}>
        <ThemeSelector />
      </div>
    </main>
  );
}
