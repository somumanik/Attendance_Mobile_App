import HolidaysSection from '../../../components/hr/HolidaysSection';

// SuperAdmin → Holiday Management — reuses the existing website section with its
// working calendar, company/category filters, Full/Half Day handling and CRUD
// (same shared backend: /api/hr/holidays*, /api/hr/holiday-categories).
export default function SuperAdminHolidays() {
  return <HolidaysSection />;
}