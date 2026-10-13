import Link from 'next/link';
import PortalBranding from '../../../components/PortalBranding';
import HrLoginForm from '../../../components/HrLoginForm';

export default function HrLoginPage() {
  return (
    <main className="page">
      <div className="auth">
        <Link className="auth__back" href="/login">← Back to role selection</Link>
        <PortalBranding />
        <h2 className="auth__role">HR Admin Login</h2>
        <HrLoginForm />
      </div>
    </main>
  );
}
