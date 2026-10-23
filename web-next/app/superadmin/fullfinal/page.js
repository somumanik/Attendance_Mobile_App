import FullFinalSection from '../../../components/superadmin/FullFinalSection';

// SuperAdmin → Full & Final Management — DISTINCT module over the SAME shared
// calculation engine and saved configuration (server/salary-service.js via
// GET /api/hr/salary/fullfinal/:paycode). No second calculation implementation.
export default function SuperAdminFullFinal() {
  return <FullFinalSection />;
}