// ============================================================================
// FILE: mobile/src/navigation/RootNavigator.jsx
// PURPOSE: Root navigation - decides between Auth, HR, Employee based on auth state
// ============================================================================

/**
 * Ye file root navigation control karti hai - app ka entry point.
 * 
 * Navigation Flow:
 * App Start
 *   ↓
 * RootNavigator
 *   ↓
 * AuthStore.initializeAuth() - stored token check karta hai
 *   ↓
 * Agar authenticated:
 *   - HR Role → HRNavigator
 *   - Employee Role → EmployeeNavigator
 * Agar NOT authenticated:
 *   - AuthNavigator
 * 
 * Data Flow:
 * Auth Store (authStore) → Root Navigator → Appropriate Navigator
 * 
 * Ye file koi API call NAHI karti - sirf navigation logic.
 */

import React, { useEffect } from 'react';
import { NavigationContainer } from '@react-navigation/native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { AuthNavigator } from './AuthNavigator';
import { EmployeeNavigator } from './EmployeeNavigator';
import { HRNavigator } from './HRNavigator';
import { authStore } from '../store/authStore';
import { LoadingScreen } from '../screens/LoadingScreen';
import { RoleGuard } from './RoleGuard';

/**
 * Root Navigator Component
 * Auth state ke hisaab se correct navigator render karta hai
 */
export const RootNavigator = () => {
  // Auth store se state subscribe karo
  const [authState, setAuthState] = React.useState(authStore.getState());

  useEffect(() => {
    // Subscribe to auth state changes
    const unsubscribe = authStore.subscribe(setAuthState);
    
    // App start pe stored session restore karo; 401 par token clear hota hai.
    authStore.restoreSession();
    
    return unsubscribe;
  }, []);

  const { isAuthenticated, userRole, isBootstrapped } = authState;

  // App startup restoration complete hone tak loading screen; login actions is
  // screen ko dobara mount nahi karte, isliye invalid login ka error visible rehta hai.
  if (!isBootstrapped) {
    return <LoadingScreen />;
  }

  return (
    <SafeAreaProvider>
      <NavigationContainer>
        {isAuthenticated ? (
          // RoleGuard role verify karta hai; wrong portal access redirect hota hai.
          <RoleGuard requiredRole={userRole}>
            {userRole === 'HR' ? <HRNavigator /> : <EmployeeNavigator />}
          </RoleGuard>
        ) : (
          <AuthNavigator />
        )}
      </NavigationContainer>
    </SafeAreaProvider>
  );
};

export default RootNavigator;