// ============================================================================
// FILE: mobile/src/theme/ThemeContext.jsx
// PURPOSE: Centralized theme system with Dark/Light themes and persistence
// ============================================================================

/**
 * Ye centralized theme system hai.
 * User Dark ya Light theme select kar sakta hai.
 * Theme preference mobile storage (AsyncStorage) mein save hoti hai.
 * SQL Server ya backend mein theme setting save NAHI ki jayegi.
 * 
 * Data Flow:
 * User theme select karta hai
 *   ↓
 * ThemeContext state update hota hai
 *   ↓
 * AsyncStorage mein save hota hai
 *   ↓
 * App re-render hoti hai naye theme ke saath
 *   ↓
 * Next app launch pe saved theme load hoti hai
 */

import React, { createContext, useContext, useState, useEffect, useCallback } from 'react';
import { Platform } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';

// Theme storage key
const THEME_STORAGE_KEY = 'app_theme_preference';

// ==========================================
// THEME DEFINITIONS
// ==========================================

/**
 * Light Theme - Modern clean light theme
 * Professional HR application ke liye suitable
 */
const lightTheme = {
  name: 'light',
  // Background colors
  background: '#F8FAFC',        // Slate-50 - main background
  surface: '#FFFFFF',           // White - card/screen background
  surfaceVariant: '#F1F5F9',    // Slate-100 - subtle variant
  surfaceElevated: '#FFFFFF',   // Elevated surfaces
  
  // Text colors
  textPrimary: '#0F172A',       // Slate-900 - primary text
  textSecondary: '#475569',     // Slate-600 - secondary text
  textTertiary: '#94A3B8',      // Slate-400 - tertiary/disabled text
  textOnPrimary: '#FFFFFF',     // White - text on primary background
  textInverse: '#FFFFFF',       // Text on dark backgrounds
  
  // Brand colors
  primary: '#2563EB',           // Blue-600 - main brand color
  primaryLight: '#3B82F6',      // Blue-500
  primaryDark: '#1D4ED8',       // Blue-700
  primaryContainer: '#DBEAFE',  // Blue-100 - for chips/badges
  
  secondary: '#0D9488',         // Teal-600
  secondaryLight: '#14B8A6',    // Teal-500
  secondaryContainer: '#CCFBF1', // Teal-100
  
  // Semantic colors
  success: '#059669',           // Emerald-600
  successLight: '#10B981',      // Emerald-500
  successContainer: '#D1FAE5',  // Emerald-100
  
  warning: '#D97706',           // Amber-600
  warningLight: '#F59E0B',      // Amber-500
  warningContainer: '#FEF3C7',  // Amber-100
  
  error: '#DC2626',             // Red-600
  errorLight: '#EF4444',        // Red-500
  errorContainer: '#FEE2E2',    // Red-100
  
  info: '#0284C7',              // Sky-600
  infoContainer: '#E0F2FE',     // Sky-100
  
  // Border & Divider
  border: '#E2E8F0',            // Slate-200
  borderLight: '#F1F5F9',       // Slate-100
  divider: '#F1F5F9',           // Slate-100
  
  // Status Colors (Attendance specific)
  status: {
    present: '#059669',         // Green - Present
    absent: '#DC2626',          // Red - Absent
    missPunch: '#D97706',       // Amber - Miss Punch
    late: '#DC2626',            // Red - Late
    weekOff: '#64748B',         // Slate-500 - Week Off
    halfDay: '#0284C7',         // Sky - Half Day
    shortLeave: '#0D9488',      // Teal - Short Leave
  },
  
  // Shadow
  shadow: 'rgba(15, 23, 42, 0.08)',
  shadowMedium: 'rgba(15, 23, 42, 0.12)',
  shadowStrong: 'rgba(15, 23, 42, 0.16)',
  
  // Overlay
  overlay: 'rgba(15, 23, 42, 0.5)',
  modalOverlay: 'rgba(15, 23, 42, 0.4)',
  
  // Input
  inputBackground: '#FFFFFF',
  inputBorder: '#E2E8F0',
  inputBorderFocus: '#2563EB',
  inputPlaceholder: '#94A3B8',
  
  // Button
  buttonPrimary: '#2563EB',
  buttonPrimaryText: '#FFFFFF',
  buttonSecondary: '#F1F5F9',
  buttonSecondaryText: '#0F172A',
  buttonOutline: '#2563EB',
  buttonOutlineText: '#2563EB',
  buttonDisabled: '#E2E8F0',
  buttonDisabledText: '#94A3B8',
  
  // Chip/Tag
  chipBackground: '#DBEAFE',
  chipText: '#1E40AF',
};

/**
 * Dark Theme - Modern professional dark theme
 * Matches desktop app aesthetic but mobile-optimized
 */
const darkTheme = {
  name: 'dark',
  // Background colors
  background: '#0F172A',        // Slate-950 - main background
  surface: '#1E293B',           // Slate-800 - card/screen background
  surfaceVariant: '#334155',    // Slate-700 - subtle variant
  surfaceElevated: '#1E293B',   // Elevated surfaces
  
  // Text colors
  textPrimary: '#F1F5F9',       // Slate-100 - primary text
  textSecondary: '#CBD5E1',     // Slate-300 - secondary text
  textTertiary: '#94A3B8',      // Slate-400 - tertiary/disabled text
  textOnPrimary: '#FFFFFF',     // White - text on primary background
  textInverse: '#0F172A',       // Text on light backgrounds
  
  // Brand colors
  primary: '#60A5FA',           // Blue-400 - main brand color (lighter for dark bg)
  primaryLight: '#93C5FD',      // Blue-300
  primaryDark: '#3B82F6',       // Blue-500
  primaryContainer: '#1E3A5F',  // Dark blue - for chips/badges
  
  secondary: '#2DD4BF',         // Teal-400
  secondaryLight: '#5EEAD4',    // Teal-300
  secondaryContainer: '#134E4A', // Dark teal
  
  // Semantic colors
  success: '#34D399',           // Emerald-400
  successLight: '#6EE7B7',      // Emerald-300
  successContainer: '#064E3B',  // Dark emerald
  
  warning: '#FBBF24',           // Amber-400
  warningLight: '#FDE047',      // Amber-300
  warningContainer: '#78350F',  // Dark amber
  
  error: '#F87171',             // Red-400
  errorLight: '#FCA5A5',        // Red-300
  errorContainer: '#7F1D1D',    // Dark red
  
  info: '#38BDF8',              // Sky-400
  infoContainer: '#1E3A5F',     // Dark blue
  
  // Border & Divider
  border: '#334155',            // Slate-700
  borderLight: '#1E293B',       // Slate-800
  divider: '#334155',           // Slate-700
  
  // Status Colors (Attendance specific)
  status: {
    present: '#34D399',         // Green - Present
    absent: '#F87171',          // Red - Absent
    missPunch: '#FBBF24',       // Amber - Miss Punch
    late: '#F87171',            // Red - Late
    weekOff: '#94A3B8',         // Slate-400 - Week Off
    halfDay: '#38BDF8',         // Sky - Half Day
    shortLeave: '#2DD4BF',      // Teal - Short Leave
  },
  
  // Shadow
  shadow: 'rgba(0, 0, 0, 0.3)',
  shadowMedium: 'rgba(0, 0, 0, 0.4)',
  shadowStrong: 'rgba(0, 0, 0, 0.5)',
  
  // Overlay
  overlay: 'rgba(0, 0, 0, 0.6)',
  modalOverlay: 'rgba(0, 0, 0, 0.5)',
  
  // Input
  inputBackground: '#1E293B',
  inputBorder: '#334155',
  inputBorderFocus: '#60A5FA',
  inputPlaceholder: '#64748B',
  
  // Button
  buttonPrimary: '#60A5FA',
  buttonPrimaryText: '#0F172A',
  buttonSecondary: '#334155',
  buttonSecondaryText: '#F1F5F9',
  buttonOutline: '#60A5FA',
  buttonOutlineText: '#60A5FA',
  buttonDisabled: '#334155',
  buttonDisabledText: '#64748B',
  
  // Chip/Tag
  chipBackground: '#1E3A5F',
  chipText: '#93C5FD',
};

// ==========================================
// THEME CONTEXT
// ==========================================

const ThemeContext = createContext(null);

/**
 * Theme Provider Component
 * Wraps the app and provides theme context to all children
 * 
 * Navigation Flow:
 * App Start
 *   ↓
 * ThemeProvider (loads saved theme from AsyncStorage)
 *   ↓
 * RootNavigator (uses theme via useTheme hook)
 *   ↓
 * All Screens (use theme via useTheme hook)
 */
export const ThemeProvider = ({ children }) => {
  const [theme, setThemeState] = useState(() => {
    // Initial state - will be overridden by useEffect
    return lightTheme;
  });
  const [isLoading, setIsLoading] = useState(true);
  const [mounted, setMounted] = useState(false);

  // Load saved theme on mount
  useEffect(() => {
    const loadTheme = async () => {
      try {
        const savedTheme = await AsyncStorage.getItem(THEME_STORAGE_KEY);
        if (savedTheme) {
          const parsed = JSON.parse(savedTheme);
          setThemeState(parsed.name === 'dark' ? darkTheme : lightTheme);
        } else {
          // Default to system preference if available
          // For now default to light
          setThemeState(lightTheme);
        }
      } catch (error) {
        console.error('[ThemeProvider] Failed to load theme:', error);
        setThemeState(lightTheme);
      } finally {
        setIsLoading(false);
        setMounted(true);
      }
    };

    loadTheme();
  }, []);

  // Save theme to AsyncStorage
  const setTheme = useCallback(async (newTheme) => {
    try {
      setThemeState(newTheme);
      await AsyncStorage.setItem(THEME_STORAGE_KEY, JSON.stringify({ name: newTheme.name }));
    } catch (error) {
      console.error('[ThemeProvider] Failed to save theme:', error);
    }
  }, []);

  // Toggle theme
  const toggleTheme = useCallback(() => {
    setTheme(theme.name === 'dark' ? lightTheme : darkTheme);
  }, [theme, setTheme]);

  // Prevent flash on SSR/hydration
  if (!mounted) {
    return null; // or return a loading skeleton
  }

  return (
    <ThemeContext.Provider value={{ theme, setTheme, toggleTheme, isLoading }}>
      {children}
    </ThemeContext.Provider>
  );
};

/**
 * useTheme Hook - Access theme values anywhere in the app
 * 
 * Usage:
 * const { theme, toggleTheme, setTheme } = useTheme();
 * const styles = StyleSheet.create({
 *   container: { backgroundColor: theme.background }
 * });
 */
export const useTheme = () => {
  const context = useContext(ThemeContext);
  if (!context) {
    throw new Error('useTheme must be used within a ThemeProvider');
  }
  return context;
};

export { lightTheme, darkTheme };
export default ThemeContext;