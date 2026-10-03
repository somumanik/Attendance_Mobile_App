// ============================================================================
// FILE: mobile/src/components/LogoutButton.jsx
// PURPOSE: Shared logout action for authenticated portal screens
// ============================================================================

/**
 * Ye button authenticated HR/Employee portal se logout karne ke liye hai.
 * Logout token aur user state clear karta hai; theme preference safe rehta hai.
 *
 * Navigation Flow:
 * HR/Employee Portal → LogoutButton → authStore.clearAuth()
 *   ↓
 * RootNavigator → AuthNavigator → Role Selection
 */

import React, { useState } from 'react';
import { Button } from './Button';
import { useAuth } from '../hooks/useAuth';

export const LogoutButton = () => {
  const { logout } = useAuth();
  const [isLoggingOut, setIsLoggingOut] = useState(false);

  const handleLogout = async () => {
    if (isLoggingOut) return;
    setIsLoggingOut(true);
    try {
      await logout();
    } finally {
      setIsLoggingOut(false);
    }
  };

  return (
    <Button
      title={isLoggingOut ? 'Logging out' : 'Logout'}
      onPress={handleLogout}
      loading={isLoggingOut}
      disabled={isLoggingOut}
      variant="outline"
      size="small"
    />
  );
};

export default LogoutButton;
