import { redirect } from 'next/navigation';
import { getCurrentUser } from '../../lib/serverAuth';
import PortalShell from '../../components/PortalShell';

// Employee portal layout — har /employee/* route ke liye server-side auth gate.
// Identity sirf verified JWT (cookie -> /api/me) se aati hai; browser se koi paycode nahi.
export default async function EmployeeLayout({ children }) {
  const user = await getCurrentUser();
  if (!user?.role) redirect('/login');
  if (user.role === 'HR') redirect('/hr');
  if (user.role !== 'EMPLOYEE') redirect('/login');

  const emp = user.employee || {};
  const name = String(emp.empname || emp.paycode || 'Employee');
  const code = String(emp.paycode || '');

  const shell = (content) => (
    <PortalShell variant="employee" user={{ name, code }}>
      {content}
    </PortalShell>
  );

  // Backend gates (bilkul mobile jaisa) — bypass nahi hote.
  if (user.mustChangePassword === true) {
    return shell(
      <div className="gate">
        <p className="gate__title">Password change required</p>
        <p className="gate__text">Aapko naya password set karna zaroori hai. Ye screen agle approved phase me aayegi — abhi access blocked hai (backend bhi ise enforce karta hai).</p>
      </div>,
    );
  }

  if (user.pinSetupRequired === true) {
    return shell(
      <div className="gate">
        <p className="gate__title">PIN setup required</p>
        <p className="gate__text">Aapko 4-digit PIN banana zaroori hai. Ye screen agle approved phase me aayegi — abhi access blocked hai.</p>
      </div>,
    );
  }

  return shell(children);
}

