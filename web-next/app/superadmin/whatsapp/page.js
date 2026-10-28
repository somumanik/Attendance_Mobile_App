import WhatsAppSection from '../../../components/hr/WhatsAppSection';

// SuperAdmin → WhatsApp Messaging — reuses the existing website section (same
// shared backend: /api/whatsapp/* configuration, templates, dry-run and sending).
export default function SuperAdminWhatsApp() {
  return <WhatsAppSection />;
}