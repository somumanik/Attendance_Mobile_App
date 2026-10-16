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
import { Text, TouchableOpacity, StyleSheet, ActivityIndicator, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useTheme } from '../theme';
import { useAuth } from '../hooks/useAuth';

export const LogoutButton = () => {
  const { logout } = useAuth();
  const { theme } = useTheme();
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

  // Premium compact pill: tinted surface + logout glyph + label.
  // Header-safe width, 40pt+ tap target, clear pressed feedback.
  return (
    <TouchableOpacity
      onPress={handleLogout}
      disabled={isLoggingOut}
      activeOpacity={isLoggingOut ? 1 : 0.75}
      accessibilityRole="button"
      accessibilityLabel={isLoggingOut ? 'Logging out' : 'Logout'}
      style={[
        styles.pill,
        {
          backgroundColor: isLoggingOut ? theme.surfaceVariant : `${theme.error}14`,
          borderColor: isLoggingOut ? theme.border : `${theme.error}40`,
        },
      ]}
    >
      {isLoggingOut ? (
        <ActivityIndicator size="small" color={theme.error} />
      ) : (
        <View style={styles.content}>
          <Ionicons name="log-out-outline" size={16} color={theme.error} />
          <Text style={[styles.label, { color: theme.error }]}>Logout</Text>
        </View>
      )}
    </TouchableOpacity>
  );
};

const styles = StyleSheet.create({
  pill: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 12,
    borderWidth: 1,
    minWidth: 88,
    minHeight: 40,
    shadowColor: '#00000014',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.08,
    shadowRadius: 4,
    elevation: 1,
  },
  content: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  label: {
    fontSize: 12.5,
    fontWeight: '700',
    letterSpacing: 0.2,
  },
});

export default LogoutButton;
