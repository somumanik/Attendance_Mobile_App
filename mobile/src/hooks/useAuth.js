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
 * Login Screen → useAuth.loginHR/loginEmployee → Auth Store → Root Navigator
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
    isHR: authState.isAuthenticated && authState.userRole === 'HR',
    isEmployee: authState.isAuthenticated && authState.userRole === 'EMPLOYEE',
    loginHR: authStore.loginHR,
    loginEmployee: authStore.loginEmployee,
    logout: authStore.clearAuth,
    restoreSession: authStore.restoreSession,
    initialize: authStore.initializeAuth,
    setError: authStore.setError,
    clearMustChangePassword: authStore.clearMustChangePassword,
    clearError: () => authStore.setError(null),
  };
};

export default useAuth;
