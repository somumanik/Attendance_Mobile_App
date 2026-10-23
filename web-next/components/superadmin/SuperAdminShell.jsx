'use client';

// web-next/components/superadmin/SuperAdminShell.jsx — SuperAdmin console shell.
// Same navigation model as the mobile SuperAdminNavigator: a management console
// with the 9 allow-listed areas. API authorization stays SERVER-side (the
// SUPERADMIN_MANAGEMENT_PATHS allow-list in server/index.js).

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import LogoutButton from '../LogoutButton';

const LINKS = [
  { href: '/superadmin', label: 'Console' },
  { href: '/superadmin/credentials', label: 'Credentials' },
  { href: '/superadmin/holidays', label: 'Holidays' },
  { href: '/superadmin/leave', label: 'Leave' },
  { href: '/superadmin/salary', label: 'Salary' },
  { href: '/superadmin/fullfinal', label: 'Full & Final' },
  { href: '/superadmin/employees', label: 'Employees' },
  { href: '/superadmin/email', label: 'Email' },
  { href: '/superadmin/hr-admins', label: 'HR Admins' },
  { href: '/superadmin/users', label: 'SuperAdmin Users' },
];

export default function SuperAdminShell({ children }) {
  const pathname = usePathname();
  return (
    <div className="emp-shell">
      <header className="emp-header">
        <div className="emp-header__id">
          <span className="emp-header__name">SuperAdmin Console</span>
          <span className="emp-header__code">Management Role</span>
        </div>
        <LogoutButton />
      </header>
      <nav className="emp-nav" aria-label="SuperAdmin management sections">
        {LINKS.map((l) => {
          const active = l.href === '/superadmin' ? pathname === '/superadmin' : pathname.startsWith(l.href);
          return (
            <Link key={l.href} className={active ? 'emp-nav__link emp-nav__link--active' : 'emp-nav__link'} href={l.href} aria-current={active ? 'page' : undefined}>
              {l.label}
            </Link>
          );
        })}
      </nav>
      <main className="emp-content">{children}</main>
    </div>
  );
}