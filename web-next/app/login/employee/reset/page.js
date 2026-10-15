import Link from 'next/link';
import PortalBranding from '../../../../components/PortalBranding';
import ResetPasswordForm from '../../../../components/ResetPasswordForm';

export default function EmployeeResetPage() {
  return (
    <main className="page">
      <div className="auth">
        <Link className="auth__back" href="/login/employee">← Back to login</Link>
        <PortalBranding />
        <h2 className="auth__role">Reset Password</h2>
        <ResetPasswordForm />
      </div>
    </main>
  );
}
