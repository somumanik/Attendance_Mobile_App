import { redirect } from 'next/navigation';
import { getCurrentUser } from '../../lib/serverAuth';
import PortalShell from '../../components/PortalShell';
import PasswordChangeSection from '../../components/employee/PasswordChangeSection';
import PinSection from '../../components/employee/PinSection';

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

  // Backend gates (bilkul mobile jaisa) — forced screens render inline. Employee
  // data routes bhi backend par 403 dete hain jab tak flag clear nahi hota.
  if (user.mustChangePassword === true) {
    return shell(<PasswordChangeSection forced />);
  }

  if (user.pinSetupRequired === true) {
    return shell(<PinSection forced />);
  }

  return shell(children);
}
