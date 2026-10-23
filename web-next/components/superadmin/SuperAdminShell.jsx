'use client';

// web-next/components/superadmin/SuperAdminShell.jsx — SuperAdmin console shell.
// Left sidebar (module navigation) + right content workspace, replacing the old
// top horizontal nav. Same routes/module components as before — this is a pure
// navigation-layout change; API authorization stays SERVER-side (the
// SUPERADMIN_MANAGEMENT_PATHS allow-list in server/index.js).
//
// Icons use the project's existing FontAwesome set (clean, colourful) — no new
// icon dependency is introduced. The HR Admin dashboard's sidebar design language
// (portal-sidebar / sidebar-item / portal-header) is reused for consistency, with
// a distinct SuperAdmin brand mark.

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useEffect, useState } from 'react';
import LogoutButton from '../LogoutButton';

const LINKS = [
  { href: '/superadmin', label: 'Console', icon: 'fa-gauge-high', color: 'text-indigo-400' },
  { href: '/superadmin/credentials', label: 'Credentials', icon: 'fa-key', color: 'text-amber-400' },
  { href: '/superadmin/holidays', label: 'Holidays', icon: 'fa-flag', color: 'text-violet-400' },
  { href: '/superadmin/leave', label: 'Leave', icon: 'fa-calendar-check', color: 'text-sky-400' },
  { href: '/superadmin/salary', label: 'Salary', icon: 'fa-coins', color: 'text-emerald-400' },
  { href: '/superadmin/fullfinal', label: 'Full & Final', icon: 'fa-file-invoice-dollar', color: 'text-rose-400' },
  { href: '/superadmin/employees', label: 'Employees', icon: 'fa-users', color: 'text-indigo-400' },
  { href: '/superadmin/email', label: 'Email', icon: 'fa-envelope', color: 'text-teal-400' },
  { href: '/superadmin/hr-admins', label: 'HR Admins', icon: 'fa-user-shield', color: 'text-purple-400' },
  { href: '/superadmin/users', label: 'SuperAdmin Users', icon: 'fa-user-gear', color: 'text-pink-400' },
];

export default function SuperAdminShell({ children, userName }) {
  const pathname = usePathname();
  const [open, setOpen] = useState(false); // mobile / tablet sidebar drawer

  // Close the mobile drawer whenever the route changes.
  useEffect(() => { setOpen(false); }, [pathname]);

  return (
    <div className="sa-shell gradient-bg min-h-screen text-[var(--text)]">
      {/* ---- Left sidebar (fixed on desktop, collapsible drawer on small screens) ---- */}
      <aside
        className={`sa-sidebar portal-sidebar fixed inset-y-0 left-0 z-50 w-64 p-4 flex flex-col transition-transform duration-200 lg:translate-x-0 ${open ? 'translate-x-0' : '-translate-x-full'}`}
        aria-label="SuperAdmin modules"
      >
        <div className="flex items-center gap-3 px-2 py-1 mb-6">
          <div className="w-10 h-10 rounded-xl card-gradient-1 flex items-center justify-center shadow-lg shadow-indigo-600/30 shrink-0">
            <i className="fas fa-user-shield text-lg text-white"></i>
          </div>
          <div className="min-w-0">
            <h2 className="font-bold text-sm text-[var(--text)] truncate">SuperAdmin</h2>
            <p className="text-[10px] font-semibold text-[var(--accent-soft)] truncate">Management Console</p>
          </div>
        </div>

        <nav className="space-y-1 overflow-y-auto flex-1 min-h-0">
          {LINKS.map((l) => {
            const active = l.href === '/superadmin' ? pathname === '/superadmin' : pathname.startsWith(l.href);
            return (
              <Link
                key={l.href}
                href={l.href}
                className={`sidebar-item flex items-center gap-3 px-3.5 py-2.5 rounded-xl cursor-pointer text-xs font-semibold ${active ? 'active' : ''}`}
                aria-current={active ? 'page' : undefined}
              >
                <i className={`fas ${l.icon} w-4 ${l.color}`}></i> {l.label}
              </Link>
            );
          })}
        </nav>

        <div className="mt-4 px-2 pt-3 border-t border-[var(--border)] text-[10px] text-[var(--muted)] leading-snug">
          <i className="fas fa-database mr-1"></i>Common backend · synced with the Mobile App
        </div>
      </aside>

      {/* ---- Mobile backdrop ---- */}
      {open ? (
        <div
          className="fixed inset-0 z-40 bg-black/50 lg:hidden"
          onClick={() => setOpen(false)}
          aria-hidden="true"
        ></div>
      ) : null}

      {/* ---- Right workspace ---- */}
      <div className="lg:pl-64 flex flex-col min-h-screen">
        <header className="portal-header sticky top-0 z-30 px-4 md:px-6 py-4 flex items-center justify-between gap-3">
          <div className="flex items-center gap-3 min-w-0">
            <button
              type="button"
              onClick={() => setOpen(true)}
              className="lg:hidden w-9 h-9 rounded-lg bg-white/5 hover:bg-white/15 flex items-center justify-center text-[var(--text)] shrink-0"
              aria-label="Open navigation menu"
            >
              <i className="fas fa-bars"></i>
            </button>
            <div className="min-w-0">
              <h1 className="text-base font-bold text-[var(--text)] truncate">SuperAdmin Console</h1>
              <p className="text-xs text-[var(--muted)] truncate">
                {userName
                  ? <>Signed in as: <span className="text-[var(--accent-soft)] font-bold">{userName}</span></>
                  : 'Management Role'}
              </p>
            </div>
          </div>
          <LogoutButton />
        </header>

        <main className="p-4 md:p-6 space-y-6 flex-1 min-w-0 fade-in">{children}</main>
      </div>
    </div>
  );
}