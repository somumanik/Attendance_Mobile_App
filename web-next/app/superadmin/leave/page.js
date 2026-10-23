import LeaveSection from '../../../components/hr/LeaveSection';

// SuperAdmin → Leave Management — reuses the existing website section (same
// shared backend: /api/hr/leave/* incl. balance import + request decisions).
export default function SuperAdminLeave() {
  return <LeaveSection />;
}