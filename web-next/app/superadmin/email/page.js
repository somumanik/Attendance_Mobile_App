import EmailSection from '../../../components/hr/EmailSection';

// SuperAdmin → Email Management — reuses the existing website section (same
// shared backend: /api/email/* configuration, health, log, send + imports).
export default function SuperAdminEmail() {
  return <EmailSection />;
}