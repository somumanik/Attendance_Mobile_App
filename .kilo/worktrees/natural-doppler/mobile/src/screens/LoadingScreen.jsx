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

/**
 * Loading Screen Component
 */
export const LoadingScreen = () => {
  const { theme } = useTheme();

  return (
    <View style={styles.container}>
      <ActivityIndicator size="large" color={theme.primary} />
      <Text style={[styles.loadingText, { color: theme.textSecondary, marginTop: 16 }]}>Loading...</Text>
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
});

export default LoadingScreen;