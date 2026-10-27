'use client';

// web-next/components/PortalShell.jsx — original post-login shell (left sidebar + sticky header).

import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useCallback, useEffect, useState } from 'react';
import { useHrAccess } from './hr/HrAccess';

const CONFIG = {
  employee: {
    brand: { icon: 'fa-fingerprint', title: 'Employee Portal', sub: 'Self-Service Login', grad: 'card-gradient-1', glow: 'shadow-indigo-600/30', subColor: 'text-indigo-400' },
    sync: { title: 'Live SQL Sync', note: 'Savior tbltimeregister se records auto-refresh hote hain.', panel: 'bg-indigo-950/30 border-indigo-500/20', accent: 'text-indigo-300' },
    headerRole: 'employee',
    items: [
      { href: '/employee', label: 'Dashboard', title: 'Dashboard Overview', short: 'Dashboard', icon: 'fa-gauge-high', color: 'text-indigo-400' },
      { href: '/employee/attendance', label: 'Attendance', title: 'Attendance Register', short: 'Attendance', icon: 'fa-calendar-check', color: 'text-emerald-400' },
      { href: '/employee/leave', label: 'Leave', title: 'Leave Management', short: 'Leave', icon: 'fa-plane-departure', color: 'text-amber-400' },
      { href: '/employee/reports', label: 'Reports', title: 'Reports & Analytics', short: 'Reports', icon: 'fa-chart-column', color: 'text-purple-400' },
      { href: '/employee/celebrations', label: 'Celebrations', title: 'Celebrations', short: 'Celebrations', icon: 'fa-cake-candles', color: 'text-pink-400' },
      { href: '/employee/fullfinal', label: 'Full & Final', title: 'Full & Final Settlement', short: 'Full & Final', icon: 'fa-file-contract', color: 'text-rose-400' },
      { href: '/employee/profile', label: 'Employee Profile', title: 'Employee Profile', short: 'Profile', icon: 'fa-user-circle', color: 'text-pink-400' },
    ],
  },
  hr: {
    brand: { icon: 'fa-user-shield', title: 'HR Admin Control', sub: 'Savior SQL Portal', grad: 'card-gradient-2', glow: 'shadow-rose-600/30', subColor: 'text-rose-400' },
    sync: { title: 'Master DB Sync', note: 'Savior Biometric Server polling active.', panel: 'bg-rose-950/20 border-rose-500/20', accent: 'text-rose-300' },
    headerRole: 'hr',
    headerSub: 'HR Administrator Portal • master SQL database',
    items: [
      { href: '/hr', module: 'dashboard', label: 'Executive Overview', title: 'Executive Overview', short: 'Overview', icon: 'fa-th-large', color: 'text-indigo-400' },
      { href: '/hr/employees', module: 'employees', label: 'All Employees Roster', title: 'All Employees Roster', short: 'Roster', icon: 'fa-users', color: 'text-emerald-400' },
      { href: '/hr/audit', module: 'audit', label: 'Single Employee Audit', title: 'Single Employee Audit', short: 'Audit', icon: 'fa-user-check', color: 'text-purple-400' },
      { href: '/hr/analytics', module: 'analytics', label: 'Category-wise Analytics', title: 'Category-wise Analytics', short: 'Analytics', icon: 'fa-layer-group', color: 'text-amber-400' },
      { href: '/hr/reports', module: 'reports', label: 'Master Reports', title: 'Master Reports', short: 'Reports', icon: 'fa-chart-line', color: 'text-emerald-400' },
      { href: '/hr/daily', module: 'dailymaster', label: 'Daily Master Report', title: 'Daily Master Report', short: 'Daily Master', icon: 'fa-calendar-day', color: 'text-rose-400' },
      { href: '/hr/celebrations', module: 'celebrations', label: 'Birthdays & Anniversaries', title: 'Birthdays & Anniversaries', short: 'Celebrations', icon: 'fa-cake-candles', color: 'text-pink-400' },
      { href: '/hr/marriage', module: 'marriage', label: 'Marriage Anniversary', title: 'Marriage Anniversary', short: 'Marriage', icon: 'fa-file-excel', color: 'text-teal-400' },
      { href: '/hr/email', module: 'email', label: 'Email Configuration', title: 'Email Configuration', short: 'Email', icon: 'fa-envelope', color: 'text-violet-400' },
      { href: '/hr/whatsapp', module: 'whatsapp', label: 'WhatsApp Messaging', title: 'WhatsApp Messaging', short: 'WhatsApp', icon: 'fa-comment-dots', color: 'text-emerald-400' },
      { href: '/hr/leave', module: 'leave', label: 'Leave Management', title: 'Leave Management', short: 'Leave', icon: 'fa-clipboard-check', color: 'text-sky-400' },
      { href: '/hr/salary', module: 'salary', label: 'Salary / Full & Final', title: 'Salary / Full & Final', short: 'Salary', icon: 'fa-money-bill-wave', color: 'text-emerald-400' },
      { href: '/hr/holidays', module: 'holidays', label: 'Holiday Management', title: 'Holiday Management', short: 'Holidays', icon: 'fa-calendar-days', color: 'text-rose-400' },
      { href: '/hr/credentials', module: 'credentials', label: 'Employee Credential Management', title: 'Employee Credential Management', short: 'Credentials', icon: 'fa-id-badge', color: 'text-cyan-400' },
    ],
  },
};

function LogoutControl() {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  async function logout() {
    setBusy(true);
    try {
      await fetch('/api/auth/logout', { method: 'POST' });
    } catch {
      /* ignore */
    }
    router.replace('/login');
    router.refresh();
  }
  return (
    <button type="button" onClick={logout} disabled={busy} className="px-3.5 py-2 rounded-xl bg-rose-500/15 border border-rose-500/30 text-rose-300 hover:bg-rose-500/25 text-xs font-bold transition flex items-center gap-2">
      <i className="fas fa-power-off"></i>
      <span>Logout</span>
    </button>
  );
}
function SyncGuideModal({ variant, onClose }) {
  const [status, setStatus] = useState('checking');
  const check = useCallback(async () => {
    setStatus('checking');
    try {
      const res = await fetch('/api/diagnostics/db', { method: 'GET', headers: { Accept: 'application/json' }, cache: 'no-store' });
      const data = await res.json().catch(() => null);
      if (res.ok && data?.success === true && data?.status === 'connected') setStatus('connected');
      else setStatus('unavailable');
    } catch {
      setStatus('unavailable');
    }
  }, []);
  useEffect(() => {
    check();
  }, [check]);

  const isHr = variant === 'hr';
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4" style={{ background: 'rgba(4,3,13,.82)', backdropFilter: 'blur(8px)' }} onClick={onClose}>
      <div className="pop-in glass rounded-3xl p-6 w-full max-w-md shadow-2xl" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between mb-4">
          <h3 className="font-bold text-sm text-[var(--text)] flex items-center gap-2">
            <i className="fas fa-plug text-[var(--accent-soft)]"></i> Sync / API Setup
          </h3>
          <button type="button" onClick={onClose} className="text-[var(--muted)] hover:text-[var(--text)] text-sm" aria-label="Close">
            <i className="fas fa-xmark"></i>
          </button>
        </div>

        <div className="p-4 rounded-2xl bg-[var(--surface-solid)] border border-[var(--border)] mb-4 flex items-center justify-between">
          <span className="text-xs font-bold text-[var(--text)] flex items-center gap-2">
            <span className={`pulse-dot w-2 h-2 rounded-full ${status === 'connected' ? 'bg-emerald-400' : status === 'checking' ? 'bg-amber-400' : 'bg-rose-400'}`}></span>
            Savior Biometric SQL Server
          </span>
          <button type="button" onClick={check} className="text-[10px] font-bold text-[var(--accent-soft)] hover:opacity-80">
            <i className="fas fa-rotate mr-1"></i>Re-check
          </button>
        </div>

        <p className="text-[11px] text-[var(--muted)] leading-relaxed mb-3">
          Attendance data <span className="mono text-[var(--accent-soft)]">dbo.tbltimeregister</span> se live sync hota hai. Browser kabhi SQL Server se direct connect nahi karta — saare calls existing Express backend (<span className="mono text-[var(--accent-soft)]">/api</span> proxy) se hote hain.
        </p>

        <div className="p-3 rounded-xl border border-[var(--border)] bg-[var(--surface)] text-[11px] text-[var(--text)]">
          <i className="fas fa-shield-halved mr-1"></i>
          Role-based authentication active — {isHr ? 'HR Admin' : 'Employee'} session verified per request.
        </div>

        <button type="button" onClick={onClose} className="mt-4 w-full py-2.5 rounded-xl bg-[var(--surface-solid)] border border-[var(--border)] text-[var(--text)] font-bold text-xs hover:opacity-80 transition">
          Close
        </button>
      </div>
    </div>
  );
}
export default function PortalShell({ variant = 'employee', user, children }) {
  const pathname = usePathname();
  const cfg = CONFIG[variant] || CONFIG.employee;
  // Phase 3: HR nav items are filtered by the account's SAVED permissions
  // (Visible/Hidden + View), and 'more'-placed modules move into a More group.
  const hrAccess = useHrAccess();
  const isHr = variant === 'hr';
  const visibleItems = isHr
    ? (cfg.items || []).filter((it) => hrAccess.isVisible(it.module) && hrAccess.can(it.module, 'view'))
    : cfg.items;
  const primaryItems = isHr ? visibleItems.filter((it) => hrAccess.placement(it.module) !== 'more') : visibleItems;
  const moreItems = isHr ? visibleItems.filter((it) => hrAccess.placement(it.module) === 'more') : [];
  const active = visibleItems.find((it) => it.href === pathname) || primaryItems[0] || { title: '', href: '/' };
  const [syncOpen, setSyncOpen] = useState(false);
  const [lastSync, setLastSync] = useState(null);
  const [syncState, setSyncState] = useState('checking'); // checking | connected | disconnected
  const [moreOpen, setMoreOpen] = useState(false);

  useEffect(() => {
    let alive = true;
    const check = async () => {
      try {
        const res = await fetch('/api/diagnostics/db', { method: 'GET', headers: { Accept: 'application/json' }, cache: 'no-store' });
        const data = await res.json().catch(() => null);
        if (!alive) return;
        if (res.ok && data?.success === true && data?.status === 'connected') {
          setSyncState('connected');
          setLastSync(new Date());
        } else {
          setSyncState('disconnected');
        }
      } catch {
        if (alive) setSyncState('disconnected');
      }
    };
    check();
    const t = setInterval(check, 30000);
    return () => { alive = false; clearInterval(t); };
  }, []);

  const syncLabel = () => {
    if (syncState === 'disconnected') return 'Offline Mode';
    if (syncState === 'connected' && lastSync) {
      const t = lastSync.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' });
      return `${cfg.headerRole === 'hr' ? 'Live SQL Synced' : 'Live SQL'} • ${t}`;
    }
    return cfg.headerRole === 'hr' ? 'SQL Syncing...' : 'Live SQL Sync';
  };

  const name = String(user?.name || '');
  const code = String(user?.code || '');
  // Employee-Portal-only sidebar polish scope (Task A): the class is added ONLY
  // for the employee variant, so the HR Admin sidebar markup stays identical.
  const isEmployeeVariant = variant === 'employee';

  return (
    <div className="gradient-bg min-h-screen text-[var(--text)]">
      <div className="flex">
        <aside className={`portal-sidebar${isEmployeeVariant ? ' portal-sidebar--employee' : ''} w-64 h-screen p-4 hidden lg:flex lg:flex-col fixed z-30`}>
          <div className="flex-1 min-h-0 flex flex-col">
            <div className="shrink-0 flex items-center gap-3 mb-8 px-2 py-1">
              <div className={`w-10 h-10 rounded-xl ${cfg.brand.grad} flex items-center justify-center shadow-lg ${cfg.brand.glow}`}>
                <i className={`fas ${cfg.brand.icon} text-lg text-white`}></i>
              </div>
              <div>
                <h2 className="font-bold text-sm text-[var(--text)]">{cfg.brand.title}</h2>
                <p className="text-[10px] font-semibold text-[var(--accent-soft)]">{cfg.brand.sub}</p>
              </div>
            </div>
            <nav className={`${isEmployeeVariant ? 'emp-nav-list' : 'space-y-1.5'} flex-1 min-h-0 overflow-y-auto`}>
              {primaryItems.map((it) => {
                const isActive = pathname === it.href;
                return (
                  <Link key={it.href} href={it.href} className={`sidebar-item flex items-center gap-3 px-3.5 py-2.5 rounded-xl cursor-pointer text-xs font-semibold ${isActive ? 'active' : ''}`} aria-current={isActive ? 'page' : undefined}>
                    <i className={`fas ${it.icon} w-4 ${it.color}`}></i> {it.label}
                  </Link>
                );
              })}
              {moreItems.length ? (
                <div className="pt-2">
                  <button type="button" onClick={() => setMoreOpen((v) => !v)} className="w-full flex items-center gap-3 px-3.5 py-2.5 rounded-xl cursor-pointer text-xs font-bold text-[var(--muted)] hover:text-[var(--text)]" aria-expanded={moreOpen}>
                    <i className="fas fa-ellipsis w-4"></i> More
                    <i className={`fas ${moreOpen ? 'fa-chevron-up' : 'fa-chevron-down'} ml-auto text-[9px]`}></i>
                  </button>
                  {moreOpen ? (
                    <div className="space-y-1 mt-1">
                      {moreItems.map((it) => {
                        const isActive = pathname === it.href;
                        return (
                          <Link key={it.href} href={it.href} className={`sidebar-item flex items-center gap-3 px-3.5 py-2.5 rounded-xl cursor-pointer text-xs font-semibold ${isActive ? 'active' : ''}`} aria-current={isActive ? 'page' : undefined}>
                            <i className={`fas ${it.icon} w-4 ${it.color}`}></i> {it.label}
                          </Link>
                        );
                      })}
                    </div>
                  ) : null}
                </div>
              ) : null}
            </nav>
          </div>
          <div className="shrink-0 mt-4 p-4 rounded-2xl bg-[var(--surface)] border border-[var(--border)] text-xs">
            <div className="flex items-center justify-between mb-2">
              <span className="text-[10px] font-bold uppercase tracking-wider text-[var(--accent-soft)]">{cfg.sync.title}</span>
              <span className="pulse-dot w-2 h-2 bg-emerald-400 rounded-full"></span>
            </div>
            <p className="text-[11px] text-[var(--muted)] leading-snug">{cfg.sync.note}</p>
            <button type="button" onClick={() => setSyncOpen(true)} className="mt-3 w-full py-2 rounded-xl bg-[var(--surface-solid)] border border-[var(--border)] hover:opacity-80 text-[10px] font-bold text-[var(--text)] transition">
              <i className="fas fa-plug mr-1"></i> Sync / API Setup
            </button>
          </div>
        </aside>

        {/* min-w-0: flex items ki automatic minimum size (min-width:auto) wide
            tables ki min-content width ko poori document width tak faila deti
            thi (page-level horizontal scrollbar). min-w-0 se overflow table
            containers par hi scroll hota hai — layout viewport ke andar rehta hai. */}
        <div className="flex-1 min-w-0 lg:ml-64 flex flex-col min-h-screen pb-20 lg:pb-0">
          <header className="portal-header sticky top-0 z-40 px-6 py-4 flex items-center justify-between">
            <div>
              <h1 className="text-base font-bold text-[var(--text)]">{active.title}</h1>
              {cfg.headerRole === 'hr' ? (
                <p className="text-xs text-[var(--muted)] truncate max-w-[60vw]">
                  Signed in as: <span className="text-[var(--accent-soft)] font-bold">{hrAccess.name || '—'}</span>
                </p>
              ) : (
                <p className="text-xs text-[var(--muted)]">
                  Logged in as: <span className="text-[var(--accent-soft)] font-bold">{name || '—'}</span> • Employee ID:{' '}
                  <span className="text-[var(--text)] mono font-bold">{code || '—'}</span>
                </p>
              )}
            </div>
            <div className="flex items-center gap-3">
              <button type="button" onClick={() => setSyncOpen(true)} className={`hidden sm:flex items-center gap-2 px-3 py-1.5 rounded-xl text-xs transition ${syncState === 'disconnected' ? 'bg-rose-500/10 border border-rose-500/20 text-rose-300 hover:bg-rose-500/20' : 'bg-emerald-500/10 border border-emerald-500/20 text-emerald-300 hover:bg-emerald-500/20'}`}>
                <i className="fas fa-database"></i>
                <span className="font-semibold">{syncLabel()}</span>
              </button>
              <LogoutControl />
            </div>
          </header>

          <main className="p-4 md:p-6 space-y-6 flex-1 min-w-0 fade-in">{children}</main>
        </div>
      </div>

      <nav className="portal-mobile-nav lg:hidden fixed bottom-0 left-0 right-0 z-40">
        <div className="flex justify-around py-2 overflow-x-auto">
          {primaryItems.map((it) => {
            const isActive = pathname === it.href;
            return (
              <Link key={it.href} href={it.href} className={`flex flex-col items-center gap-0.5 px-2 py-1 text-[9px] font-semibold ${isActive ? 'text-[var(--text)]' : 'text-[var(--muted)]'}`}>
                <i className={`fas ${it.icon} text-base ${it.color}`}></i>
                <span className="whitespace-nowrap">{it.short}</span>
              </Link>
            );
          })}
        </div>
      </nav>

      {syncOpen ? <SyncGuideModal variant={variant} onClose={() => setSyncOpen(false)} /> : null}
    </div>
  );
}


