'use client';

// web-next/components/hr/HrAccess.jsx — HR Admin permission context (Phase 3).
//
// The common backend returns the authenticated account's SAVED permissions,
// company scope and display name from GET /api/me. This provider loads them once
// and exposes strict helpers for the website UI — mirroring the mobile app's
// useAuth().can / isVisible / modulePlacement. Nothing here is security: the
// server still enforces every request (enforceHrAccess + enforceHrModulePermission).
//
// STRICT (unlike the mobile legacy fallback): an HR account with NO permission
// payload is treated as having NO access here — the server always returns a real
// map, so a missing/unexpected payload must fail closed, never grant full access.

import { createContext, useContext, useEffect, useState } from 'react';
import { usePathname } from 'next/navigation';
import apiFetch from '../../lib/api';

const HrAccessContext = createContext(null);

/* No-provider default (SuperAdmin pages / shared sections outside the HR layout):
   allow all, matching the server's SuperAdmin bypass. */
const ALLOW_ALL = {
  status: 'ready',
  error: null,
  role: null,
  isSuperAdmin: true,
  name: null,
  companies: null,
  modules: [],
  can: () => true,
  isVisible: () => true,
  placement: () => null,
};

export function HrAccessProvider({ children }) {
  const [state, setState] = useState({ status: 'loading', error: null, me: null });

  const load = async () => {
    setState({ status: 'loading', error: null, me: null });
    try {
      const me = await apiFetch('/me');
      setState({ status: 'ready', error: null, me });
    } catch (e) {
      setState({ status: 'error', error: e?.data?.message || e?.message || 'Session verify nahi ho payi.', me: null });
    }
  };

  useEffect(() => { load(); }, []);

  const me = state.me;
  const isSuperAdmin = me?.role === 'SUPERADMIN' || me?.fullAccess === true;

  const value = {
    status: state.status,
    error: state.error,
    retry: load,
    role: me?.role || null,
    username: me?.username || null,
    displayname: me?.displayname || null,
    name: me?.displayname || me?.username || null,
    companies: me?.companies ?? null,
    // Server module catalog (label lookup for guard messages) — additive.
    modules: me?.modules || [],
    isSuperAdmin,
    can: (module, action = 'view') => {
      if (!me) return false;
      if (isSuperAdmin) return true;
      const perms = me?.permissions;
      if (!perms) return false; // fail closed
      const mod = perms[module];
      return mod ? mod[action] === true : false;
    },
    isVisible: (module) => {
      if (!me) return false;
      if (isSuperAdmin) return true;
      const perms = me?.permissions;
      if (!perms) return false;
      const mod = perms[module];
      return mod ? mod.visible !== false : false;
    },
    placement: (module) => {
      const perms = me?.permissions;
      const v = perms && perms[module] ? perms[module].placement : null;
      if (v === 'more') return 'more';
      if (v === 'primary') return 'primary';
      return null;
    },
  };

  return <HrAccessContext.Provider value={value}>{children}</HrAccessContext.Provider>;
}

export function useHrAccess() {
  const ctx = useContext(HrAccessContext);
  return ctx || ALLOW_ALL;
}

/** Wrap a control in <HrCan module action> to show it only when permitted. */
export function HrCan({ module, action = 'view', children }) {
  const { can } = useHrAccess();
  return can(module, action) ? children : null;
}

/** pathname → module key (exact). Only the website's HR routes are mapped. */
const ROUTE_MODULE = {
  '/hr': 'dashboard',
  '/hr/employees': 'employees',
  '/hr/audit': 'audit',
  '/hr/analytics': 'analytics',
  '/hr/reports': 'reports',
  '/hr/daily': 'dailymaster',
  '/hr/celebrations': 'celebrations',
  '/hr/marriage': 'marriage',
  '/hr/email': 'email',
  '/hr/whatsapp': 'whatsapp',
  '/hr/leave': 'leave',
  '/hr/salary': 'salary',
  '/hr/holidays': 'holidays',
  '/hr/credentials': 'credentials',
};

/** Direct-URL guard: a hidden / view-denied module shows a safe state. */
export function HrRouteGuard({ children }) {
  const pathname = usePathname();
  const { can, status, modules } = useHrAccess();
  const module = ROUTE_MODULE[pathname];
  if (!module) return children;
  if (status !== 'ready') return children; // the gated shell already handles loading/error
  if (can(module, 'view')) return children;
  // Display-name the module (e.g. "Master Reports") from the server catalog.
  const label = (modules || []).find((m) => m.key === module)?.label || module;
  return (
    <div className="glass-card rounded-3xl p-10 text-center">
      <i className="fas fa-lock text-2xl text-amber-400"></i>
      <p className="text-sm font-bold text-[var(--text)] mt-3">Access not permitted</p>
      <p className="text-xs text-[var(--muted)] mt-1">
        {label} — aapke HR Admin account ke paas is module ka View permission nahi hai. SuperAdmin se sampark karein.
      </p>
    </div>
  );
}