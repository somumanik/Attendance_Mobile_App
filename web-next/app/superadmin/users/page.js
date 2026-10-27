import SuperAdminUsersSection from '../../../components/superadmin/SuperAdminUsersSection';

// SuperAdmin → SuperAdmin Users — port of the mobile SuperAdminUsersScreen over
// the same shared backend (/api/superadmin/super-admins*). Bootstrap SuperAdmin
// is protected server-side; passwords are never returned.
export default function SuperAdminUsers() {
  return <SuperAdminUsersSection />;
}