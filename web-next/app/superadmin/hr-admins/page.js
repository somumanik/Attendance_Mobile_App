import HrAdminsSection from '../../../components/superadmin/HrAdminsSection';

// SuperAdmin → HR Admin & Permissions — port of the mobile SuperAdminHRAdmins
// screen over the same shared backend (/api/superadmin/*). Permission changes
// persist in the common backend and are enforced server-side on every request.
export default function SuperAdminHrAdmins() {
  return <HrAdminsSection />;
}