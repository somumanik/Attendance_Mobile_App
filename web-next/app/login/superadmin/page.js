import Link from 'next/link';
import PortalBranding from '../../../components/PortalBranding';
import SuperAdminLoginForm from '../../../components/SuperAdminLoginForm';

export default function SuperAdminLoginPage() {
  return (
    <main className="page">
      <div className="auth">
        <Link className="auth__back" href="/login">← Back to role selection</Link>
        <PortalBranding />
        <h2 className="auth__role">SuperAdmin Login</h2>
        <SuperAdminLoginForm />
      </div>
    </main>
  );
}
