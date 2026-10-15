import Link from 'next/link';
import PortalBranding from '../../../../components/PortalBranding';
import ForgotPasswordForm from '../../../../components/ForgotPasswordForm';

export default function EmployeeForgotPage() {
  return (
    <main className="page">
      <div className="auth">
        <Link className="auth__back" href="/login/employee">← Back to login</Link>
        <PortalBranding />
        <h2 className="auth__role">Forgot Password</h2>
        <ForgotPasswordForm />
      </div>
    </main>
  );
}
