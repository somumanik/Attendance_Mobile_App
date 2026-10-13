'use client';

// web-next/components/hr/HrNav.jsx — HR admin section links (active highlight).

import Link from 'next/link';
import { usePathname } from 'next/navigation';

const LINKS = [
  { href: '/hr', label: 'Overview' },
  { href: '/hr/employees', label: 'Employees' },
  { href: '/hr/audit', label: 'Audit' },
  { href: '/hr/analytics', label: 'Analytics' },
  { href: '/hr/celebrations', label: 'Celebrations' },
  { href: '/hr/marriage', label: 'Marriage' },
  { href: '/hr/leave', label: 'Leave' },
  { href: '/hr/salary', label: 'Salary' },
  { href: '/hr/holidays', label: 'Holidays' },
  { href: '/hr/email', label: 'Email' },
];

export default function HrNav() {
  const pathname = usePathname();
  return (
    <nav className="emp-nav" aria-label="HR admin sections">
      {LINKS.map((l) => {
        const active = pathname === l.href;
        return (
          <Link key={l.href} className={active ? 'emp-nav__link emp-nav__link--active' : 'emp-nav__link'} href={l.href} aria-current={active ? 'page' : undefined}>
            {l.label}
          </Link>
        );
      })}
    </nav>
  );
}
