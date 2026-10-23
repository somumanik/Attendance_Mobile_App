import Link from 'next/link';

// web-next/app/superadmin/page.js — SuperAdmin Management Console home.
// Same 9 management areas as the mobile SuperAdminHomeScreen. Each card opens
// the matching website module (existing sections are reused; the shared common
// backend + server-side SUPERADMIN allow-list decide what is permitted).

const MODULES = [
  { href: '/superadmin/credentials', icon: 'fa-key', color: 'text-amber-400', label: 'Employee Credential Management', desc: 'Password / PIN reset and login access' },
  { href: '/superadmin/holidays', icon: 'fa-flag', color: 'text-violet-400', label: 'Holiday Management', desc: 'Holiday calendar by company & category' },
  { href: '/superadmin/leave', icon: 'fa-calendar-check', color: 'text-sky-400', label: 'Leave Management', desc: 'Leave types, balances, requests & approvals' },
  { href: '/superadmin/salary', icon: 'fa-coins', color: 'text-emerald-400', label: 'Salary Management', desc: 'Salary configuration, elements and dues' },
  { href: '/superadmin/fullfinal', icon: 'fa-file-invoice-dollar', color: 'text-rose-400', label: 'Full & Final Management', desc: 'Settlement and full & final computation' },
  { href: '/superadmin/employees', icon: 'fa-users', color: 'text-indigo-400', label: 'Employee Management', desc: 'Employee master list and details' },
  { href: '/superadmin/email', icon: 'fa-envelope', color: 'text-teal-400', label: 'Email Management', desc: 'Email configuration, notifications and health' },
  { href: '/superadmin/hr-admins', icon: 'fa-user-shield', color: 'text-purple-400', label: 'HR Admin & Permissions', desc: 'Accounts, module and action permissions' },
  { href: '/superadmin/users', icon: 'fa-user-gear', color: 'text-pink-400', label: 'SuperAdmin Users', desc: 'Manage SuperAdmin accounts' },
];

export default function SuperAdminHome() {
  return (
    <div className="space-y-4">
      <div className="glass-card rounded-3xl p-6">
        <h2 className="font-bold text-lg text-[var(--text)] flex items-center gap-2">
          <i className="fas fa-gauge-high text-indigo-400"></i> Management Console
        </h2>
        <p className="text-xs text-[var(--muted)] mt-2 max-w-3xl leading-relaxed">
          SuperAdmin is a management role separate from HR Admin. You have full management access
          to every module below. HR Admin accounts and their module/action permissions are
          configured here and enforced on the server. Saara data ek hi common backend aur shared
          database se aata hai — Mobile App ke saath fully synced.
        </p>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-4">
        {MODULES.map((mod) => (
          <Link key={mod.href} href={mod.href} className="glass-card rounded-3xl p-5 flex items-center gap-4 hover:bg-white/5 transition focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-400">
            <span className={`w-12 h-12 rounded-2xl bg-white/5 border border-[var(--border)] flex items-center justify-center shrink-0 ${mod.color}`}>
              <i className={`fas ${mod.icon} text-lg`}></i>
            </span>
            <span className="min-w-0 flex-1">
              <span className="block text-sm font-extrabold text-[var(--text)] leading-snug">{mod.label}</span>
              <span className="block text-[11px] text-[var(--muted)] mt-0.5 leading-snug">{mod.desc}</span>
            </span>
            <i className="fas fa-chevron-right text-[var(--muted)] text-xs shrink-0"></i>
          </Link>
        ))}
      </div>
    </div>
  );
}