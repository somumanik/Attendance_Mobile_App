import { redirect } from 'next/navigation';
import { getCurrentUser } from '../../lib/serverAuth';
import PortalShell from '../../components/PortalShell';

// HR admin layout — har /hr/* route ke liye server-side role gate.
// Employee HR pages nahi khol sakta; SuperAdmin HR role nahi ban jaata.
export default async function HrLayout({ children }) {
  const user = await getCurrentUser();
  if (!user?.role) redirect('/login');
  if (user.role === 'EMPLOYEE') redirect('/employee');
  if (user.role !== 'HR') redirect('/login');

  return <PortalShell variant="hr">{children}</PortalShell>;
}

