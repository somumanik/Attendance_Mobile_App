// ============================================================================
// FILE: mobile/src/hooks/useAuth.js
// PURPOSE: React hook for auth state and login/logout actions
// ============================================================================

/**
 * Ye hook AuthStore ko React components se connect karta hai.
 * Login screens is hook se loginHR/loginEmployee call karte hain.
 * Logout button is hook se clearAuth call karta hai.
 *
 * Navigation Flow:
 * Login Screen → useAuth.loginHR/loginSuperAdmin/loginEmployee → Auth Store → Root Navigator
 * Logout Button → useAuth.logout → token clear → Role Selection
 */

import { useEffect, useState } from 'react';
import { authStore } from '../store/authStore';

export const useAuth = () => {
  const [authState, setAuthState] = useState(authStore.getState());

  useEffect(() => authStore.subscribe(setAuthState), []);

  return {
    token: authState.token,
    isAuthenticated: authState.isAuthenticated,
    userRole: authState.userRole,
    userData: authState.userData,
    isLoading: authState.isLoading,
    error: authState.error,
    // Phase I: employee ka forced password setup pending hai.
    mustChangePassword: authState.mustChangePassword === true,
    // Phase I section 2: one-time 4-digit PIN setup pending hai.
    pinSetupRequired: authState.pinSetupRequired === true,
    isHR: authState.isAuthenticated && authState.userRole === 'HR',
    isEmployee: authState.isAuthenticated && authState.userRole === 'EMPLOYEE',
    // Separate management role; HR/Employee flags above are unaffected by it.
    isSuperAdmin: authState.isAuthenticated && authState.userRole === 'SUPERADMIN',
    // SuperAdmin console: HR Admin module/action permissions (UI filtering only —
    // the server enforces every request against the same saved permissions).
    permissions: authState.permissions || null,
    /** can('holidays','create') -> UI eligibility. Never a substitute for server authz. */
    can: (module, action = 'view') => {
      if (!authState.isAuthenticated) return false;
      if (authState.userRole === 'SUPERADMIN') return true;   // full management access
      const perms = authState.permissions;
      if (!perms) return true;                                 // no payload -> preserve old behaviour
      const mod = perms[module];
      return mod ? mod[action] === true : false;
    },
    /**
     * Phase 4.4 — Visible / Hidden for one section.
     * An explicit Hidden row (`visible === false`) removes the section from BOTH
     * navigation surfaces. Anything else — including a section this account has no
     * stored row for — keeps the historical VISIBLE behaviour, so existing accounts
     * are never affected by this feature.
     */
    isVisible: (module) => {
      if (!authState.isAuthenticated) return false;
      if (authState.userRole === 'SUPERADMIN') return true;    // full management access
      const perms = authState.permissions;
      if (!perms) return true;                                 // no payload -> preserve old behaviour
      const mod = perms[module];
      return mod ? mod.visible !== false : true;
    },
    /**
     * LAYOUT ONLY (Prompt 3): where the SuperAdmin placed a permitted module for
     * this HR Admin. Returns 'primary', 'more', or null.
     * `null` = historical/default behaviour, so existing rows are never moved.
     */
    modulePlacement: (module) => {
      const perms = authState.permissions;
      const value = perms && perms[module] ? perms[module].placement : null;
      if (value === 'more') return 'more';
      if (value === 'primary') return 'primary';
      return null;
    },
    loginHR: authStore.loginHR,
    loginSuperAdmin: authStore.loginSuperAdmin,
    loginEmployee: authStore.loginEmployee,
    logout: authStore.clearAuth,
    restoreSession: authStore.restoreSession,
    initialize: authStore.initializeAuth,
    setError: authStore.setError,
    clearMustChangePassword: authStore.clearMustChangePassword,
    clearPinSetupRequired: authStore.clearPinSetupRequired,
    clearError: () => authStore.setError(null),
  };
};

export default useAuth;
