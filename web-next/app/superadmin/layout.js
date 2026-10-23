import { redirect } from 'next/navigation';
import { getCurrentUser } from '../../lib/serverAuth';
import SuperAdminShell from '../../components/superadmin/SuperAdminShell';

// SuperAdmin management console layout — har /superadmin/* route ke liye
// server-side role gate. HR Admin yahan nahi aa sakta; SuperAdmin /hr/* ka
// role gate bhi waisa hi hai (app/hr/layout.js). Enforcement API par server
// par hota hai — ye sirf navigation gate hai.
export default async function SuperAdminLayout({ children }) {
  const user = await getCurrentUser();
  if (user?.role === 'EMPLOYEE') redirect('/employee');
  if (user?.role === 'HR') redirect('/hr');
  if (user?.role !== 'SUPERADMIN') redirect('/login/superadmin');

  return <SuperAdminShell>{children}</SuperAdminShell>;
}