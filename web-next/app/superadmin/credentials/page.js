import HrEmployeeCredentialsSection from '../../../components/hr/HrEmployeeCredentialsSection';

// SuperAdmin → Employee Credential Management — reuses the existing website
// section (same shared backend: /api/hr/employee/credentials*, /api/employees).
export default function SuperAdminCredentials() {
  return <HrEmployeeCredentialsSection />;
}