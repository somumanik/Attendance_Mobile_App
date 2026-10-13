'use client';

// web-next/components/employee/EmployeeNav.jsx — employee portal section links (active highlight).

import Link from 'next/link';
import { usePathname } from 'next/navigation';

const LINKS = [
  { href: '/employee', label: 'Dashboard' },
  { href: '/employee/attendance', label: 'Attendance' },
  { href: '/employee/leave', label: 'Leave' },
  { href: '/employee/reports', label: 'Reports' },
  { href: '/employee/celebrations', label: 'Celebrations' },
  { href: '/employee/fullfinal', label: 'Full & Final' },
  { href: '/employee/profile', label: 'Profile' },
];

export default function EmployeeNav() {
  const pathname = usePathname();

  return (
    <nav className="emp-nav" aria-label="Employee portal sections">
      {LINKS.map((l) => {
        const active = pathname === l.href;
        return (
          <Link
            key={l.href}
            className={active ? 'emp-nav__link emp-nav__link--active' : 'emp-nav__link'}
            href={l.href}
            aria-current={active ? 'page' : undefined}
          >
            {l.label}
          </Link>
        );
      })}
    </nav>
  );
}
