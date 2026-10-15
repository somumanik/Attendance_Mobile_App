import Link from 'next/link';
import PortalBranding from '../../../../components/PortalBranding';
import FirstTimeSetupForm from '../../../../components/FirstTimeSetupForm';

export default function EmployeeSetupPage({ searchParams }) {
  const paycode = typeof searchParams?.paycode === 'string' ? searchParams.paycode : '';
  return (
    <main className="page">
      <div className="auth">
        <Link className="auth__back" href="/login/employee">← Back to login</Link>
        <PortalBranding />
        <h2 className="auth__role">Create Your Password</h2>
        <FirstTimeSetupForm initialPaycode={paycode} />
      </div>
    </main>
  );
}
