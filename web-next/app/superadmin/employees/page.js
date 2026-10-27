import RosterSection from '../../../components/hr/RosterSection';

// SuperAdmin → Employee Management — reuses the existing website roster (same
// shared backend: /api/employees, /api/hr/filters).
export default function SuperAdminEmployees() {
  return <RosterSection />;
}