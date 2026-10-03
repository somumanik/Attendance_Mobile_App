// ============================================================================
// FILE: mobile/src/components/LoadingSpinner.jsx
// PURPOSE: Reusable loading spinner with message
// ============================================================================

/**
 * Ye reusable loading spinner component hai.
 * Full screen overlay, inline, or overlay variants support karta hai.
 * Message, size, color customization support karta hai.
 * 
 * Usage:
 * <LoadingSpinner message="Loading..." />
 * <LoadingSpinner variant="inline" size="small" />
 * <LoadingSpinner variant="overlay" message="Saving..." />
 * 
 * Data Flow:
 * Parent conditionally renders based on loading state
 *   ↓
 * LoadingSpinner renders with theme-aware styling
 *   ↓
 * User sees loading feedback
 */

import React from 'react';
import { View, ActivityIndicator, Text, StyleSheet } from 'react-native';
import { useTheme } from '../theme';

/**
 * LoadingSpinner Component
 * @param {string} variant - 'fullscreen' | 'inline' | 'overlay'
 * @param {string} message - Loading message
 * @param {string} size - 'small' | 'large'
 * @param {string} color - Spinner color
 * @param {Object} style - Additional styles
 */
export const LoadingSpinner = ({
  variant = 'fullscreen',
  message = 'Loading...',
  size = 'large',
  color,
  style,
}) => {
  const { theme } = useTheme();
  const spinnerColor = color || theme.primary;

  const baseStyles = [
    styles[variant],
    style,
  ];

  if (variant === 'fullscreen') {
    return (
      <View style={baseStyles}>
        <ActivityIndicator size={size} color={spinnerColor} />
        {message && <Text style={[styles.message, { color: theme.textSecondary }]}>{message}</Text>}
      </View>
    );
  }

  if (variant === 'overlay') {
    return (
      <View style={[
        styles.overlay,
        { backgroundColor: theme.modalOverlay },
        style,
      ]}>
        <View style={styles.overlayContent}>
          <ActivityIndicator size={size} color={spinnerColor} />
          {message && <Text style={[styles.message, { color: theme.textOnPrimary }]}>{message}</Text>}
        </View>
      </View>
    );
  }

  // inline variant
  return (
    <View style={baseStyles}>
      <ActivityIndicator size={size} color={spinnerColor} />
      {message && <Text style={[styles.message, { color: theme.textSecondary }]}>{message}</Text>}
    </View>
  );
};

const styles = StyleSheet.create({
  fullscreen: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: 20,
  },
  overlay: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    justifyContent: 'center',
    alignItems: 'center',
    zIndex: 100,
  },
  overlayContent: {
    backgroundColor: 'rgba(0,0,0,0.7)',
    padding: 24,
    borderRadius: 16,
    alignItems: 'center',
    gap: 12,
  },
  inline: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    paddingVertical: 16,
  },
  message: {
    fontSize: 14,
    fontWeight: '500',
    textAlign: 'center',
  },
});

export default LoadingSpinner;