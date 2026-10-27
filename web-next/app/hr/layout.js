import { redirect } from 'next/navigation';
import { getCurrentUser } from '../../lib/serverAuth';
import { HrAccessProvider } from '../../components/hr/HrAccess';
import HrGatedShell from '../../components/hr/HrGatedShell';

// HR admin layout — har /hr/* route ke liye server-side role gate + client-side
// permission gate (Phase 3). Employee HR pages nahi khol sakta; SuperAdmin HR
// role nahi ban jaata. Saved permissions ab website navigation / routes /
// actions par bhi apply hote hain (same /api/me source the mobile app uses).
export default async function HrLayout({ children }) {
  const user = await getCurrentUser();
  if (!user?.role) redirect('/login');
  if (user.role === 'EMPLOYEE') redirect('/employee');
  if (user.role !== 'HR') redirect('/login');

  return (
    <HrAccessProvider>
      <HrGatedShell>{children}</HrGatedShell>
    </HrAccessProvider>
  );
}

