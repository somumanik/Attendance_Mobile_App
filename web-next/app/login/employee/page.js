import Link from 'next/link';
import PortalBranding from '../../../components/PortalBranding';
import EmployeeLoginForm from '../../../components/EmployeeLoginForm';

export default function EmployeeLoginPage() {
  return (
    <main className="page">
      <div className="auth">
        <Link className="auth__back" href="/login">← Back to role selection</Link>
        <PortalBranding />
        <h2 className="auth__role">Employee Login</h2>
        <EmployeeLoginForm />
      </div>
    </main>
  );
}
