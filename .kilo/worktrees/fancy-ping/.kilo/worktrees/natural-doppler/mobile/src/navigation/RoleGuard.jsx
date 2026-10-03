// ============================================================================
// FILE: mobile/src/navigation/RoleGuard.jsx
// PURPOSE: Navigation guard for HR and Employee portal separation
// ============================================================================

/**
 * Ye component role protection ke liye hai.
 * Hidden buttons par depend nahi karta; authenticated role se portal decide hota hai.
 *
 * Navigation Flow:
 * Authenticated + HR → HRNavigator
 * Authenticated + EMPLOYEE → EmployeeNavigator
 * Not authenticated → AuthNavigator
 * Wrong role attempt → current role ke correct portal par redirect
 *
 * Data Flow:
 * Auth Store state → useAuth → RoleGuard → Root portal
 */

import React from 'react';
import { useAuth } from '../hooks/useAuth';
import { AuthNavigator } from './AuthNavigator';
import { EmployeeNavigator } from './EmployeeNavigator';
import { HRNavigator } from './HRNavigator';
import { LoadingScreen } from '../screens/LoadingScreen';
import { USER_ROLES } from '../utils/constants';

export const RoleGuard = ({ requiredRole, children }) => {
  const { isAuthenticated, isLoading, userRole } = useAuth();

  if (isLoading) return <LoadingScreen />;
  if (!isAuthenticated) return <AuthNavigator />;

  // Wrong portal manually open karne ki koshish yahan deny/redirect hoti hai.
  if (userRole !== requiredRole) {
    return userRole === USER_ROLES.HR ? <HRNavigator /> : <EmployeeNavigator />;
  }

  return children;
};

export default RoleGuard;
