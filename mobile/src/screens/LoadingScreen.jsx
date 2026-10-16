// ============================================================================
// FILE: mobile/src/screens/LoadingScreen.jsx
// PURPOSE: Loading screen shown during app initialization
// ============================================================================

/**
 * Ye screen app initialization ke time dikhti hai.
 * Auth store initialize hone tak ye dikhti hai.
 * 
 * Navigation Flow:
 * RootNavigator → LoadingScreen (jab isLoading=true)
 * AuthStore.initializeAuth() complete hone ke baad → Next Navigator
 * 
 * Data Flow:
 * RootNavigator → LoadingScreen (jab isLoading=true)
 * AuthStore.initializeAuth() complete hone ke baad → Next Navigator
 */

import React from 'react';
import { View, Text, ActivityIndicator, StyleSheet } from 'react-native';
import { useTheme } from '../theme';
import { GradientIcon } from '../components';

/**
 * Loading Screen Component
 */
export const LoadingScreen = () => {
  const { theme } = useTheme();

  return (
    <View style={styles.container}>
      <GradientIcon from="#2563EB" to="#7C3AED" name="stats-chart" size={88} radius={26} glyphRatio={0.5} />
      <Text style={[styles.appName, { color: theme.textPrimary }]}>Mohani Attendance</Text>
      <ActivityIndicator size="large" color={theme.primary} style={styles.spinner} />
      <Text style={[styles.loadingText, { color: theme.textSecondary }]}>Loading...</Text>
      <Text style={[styles.versionText, { color: theme.textTertiary, marginTop: 8 }]}>v1.0.0</Text>
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  appName: {
    fontSize: 20,
    fontWeight: '800',
    letterSpacing: -0.3,
    marginTop: 16,
    marginBottom: 20,
  },
  spinner: {
    marginBottom: 12,
  },
  loadingText: {
    fontSize: 14,
    fontWeight: '600',
    letterSpacing: 0.2,
  },
  versionText: {
    fontSize: 11,
    fontWeight: '500',
  },
});

export default LoadingScreen;