import SalarySection from '../../../components/hr/SalarySection';

// SuperAdmin → Salary Management — reuses the existing website section with its
// working Import / Salary Data / Rules / Dues / Estimate / Structure tabs (same
// shared backend + calculation engine: /api/hr/salary/*, server/salary-service.js).
// Full & Final Management is a SEPARATE module (/superadmin/fullfinal).
export default function SuperAdminSalary() {
  return <SalarySection />;
}