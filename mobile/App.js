// ============================================================================
// FILE: mobile/App.js
// PURPOSE: Main app entry point - ThemeProvider + RootNavigator
// ============================================================================

/**
 * Ye file mobile app ka main entry point hai.
 * ThemeProvider ke andar RootNavigator ko wrap karta hai.
 * Theme system initialize hota hai yahan se.
 * 
 * Architecture:
 * App.js
 *   ↓
 * ThemeProvider (loads saved theme from AsyncStorage)
 *   ↓
 * RootNavigator (NavigationContainer + SafeAreaProvider)
 *   ↓
 * AuthStore.initializeAuth() - stored token check karta hai
 *   ↓
 * Agar authenticated:
 *   - HR Role → HRNavigator (Bottom Tabs)
 *   - Employee Role → EmployeeNavigator (Bottom Tabs)
 * Agar NOT authenticated:
 *   - AuthNavigator (Stack: RoleSelection → HRLogin/EmployeeLogin)
 * 
 * Data Flow:
 * ThemeProvider → RootNavigator → Auth Store → Appropriate Navigator
 * 
 * Koi SQL credentials, JWT secrets, ya email credentials yahan NAHI hain.
 * Sirf navigation logic aur theme initialization hai.
 */

import React from 'react';
import { StatusBar } from 'expo-status-bar';
import { ThemeProvider, useTheme } from './src/theme';
import { RootNavigator } from './src/navigation/RootNavigator';

/**
 * StatusBar Wrapper - Theme-aware status bar
 */
const ThemedStatusBar = () => {
  const { theme } = useTheme();
  const isDark = theme.name === 'dark';
  
  return (
    <StatusBar
      style={isDark ? 'light' : 'dark'}
      backgroundColor={theme.background}
      translucent={false}
      animated={true}
    />
  );
};

/**
 * Main App Component
 */
export default function App() {
  return (
    <ThemeProvider>
      <RootNavigator />
      <ThemedStatusBar />
    </ThemeProvider>
  );
}