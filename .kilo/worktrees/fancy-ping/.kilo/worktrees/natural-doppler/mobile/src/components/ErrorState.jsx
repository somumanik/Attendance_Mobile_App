// ============================================================================
// FILE: mobile/src/components/ErrorState.jsx
// PURPOSE: Reusable error state component with retry action
// ============================================================================

/**
 * Ye reusable error state component hai.
 * Error message, retry action, dismiss action support karta hai.
 * Different error types: generic, network, server, not-found, permission
 * 
 * Usage:
 * <ErrorState error={error} onRetry={handleRetry} onDismiss={handleDismiss} />
 * <ErrorState type="network" onRetry={handleRetry} />
 * <ErrorState message="Custom error message" onRetry={handleRetry} />
 * 
 * Data Flow:
 * Parent catches error and renders ErrorState
 *   ↓
 * ErrorState renders with theme-aware styling and retry action
 *   ↓
 * User taps retry → calls onRetry handler
 *   ↓
 * Parent re-fetches data or retries operation
 */

import React from 'react';
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import { useTheme } from '../theme';

/**
 * ErrorState Component
 * @param {Error|string} error - Error object or message
 * @param {string} type - 'generic' | 'network' | 'server' | 'not-found' | 'permission'
 * @param {string} message - Custom error message
 * @param {Function} onRetry - Retry handler
 * @param {Function} onDismiss - Dismiss handler
 * @param {boolean} dismissible - Show dismiss button
 * @param {Object} style - Additional styles
 */
export const ErrorState = ({
  error,
  type = 'generic',
  message,
  onRetry,
  onDismiss,
  dismissible = false,
  style,
}) => {
  const { theme } = useTheme();

  // Get error message
  const getErrorMessage = () => {
    if (message) return message;
    if (typeof error === 'string') return error;
    if (error?.message) return error.message;
    return 'An unexpected error occurred';
  };

  // Type-based defaults
  const getTypeConfig = () => {
    switch (type) {
      case 'network':
        return {
          title: 'Connection Error',
          illustration: '📡',
          message: 'Unable to connect to server. Please check your internet connection.',
        };
      case 'server':
        return {
          title: 'Server Error',
          illustration: '🖥️',
          message: 'Server is temporarily unavailable. Please try again later.',
        };
      case 'not-found':
        return {
          title: 'Not Found',
          illustration: '🔍',
          message: 'The requested resource was not found.',
        };
      case 'permission':
        return {
          title: 'Access Denied',
          illustration: '🔒',
          message: 'You don\'t have permission to perform this action.',
        };
      case 'generic':
      default:
        return {
          title: 'Something Went Wrong',
          illustration: '⚠️',
          message: getErrorMessage(),
        };
    }
  };

  const config = getTypeConfig();

  return (
    <View style={[styles.container, { backgroundColor: theme.background }, style]}>
      <View style={styles.content}>
        <Text style={styles.illustration}>{config.illustration}</Text>
        <Text style={[styles.title, { color: theme.textPrimary }]}>{config.title}</Text>
        <Text style={[styles.message, { color: theme.textSecondary }]}>{config.message}</Text>

        <View style={styles.actions}>
          {onRetry && (
            <TouchableOpacity
              style={[styles.retryButton, { backgroundColor: theme.primary }]}
              onPress={onRetry}
              activeOpacity={0.85}
            >
              <Text style={[styles.buttonText, { color: '#FFFFFF' }]}>
                Try Again
              </Text>
            </TouchableOpacity>
          )}

          {dismissible && onDismiss && (
            <TouchableOpacity
              style={[styles.dismissButton, { borderColor: theme.border }]}
              onPress={onDismiss}
              activeOpacity={0.85}
            >
              <Text style={[styles.buttonText, { color: theme.textSecondary }]}>
                Dismiss
              </Text>
            </TouchableOpacity>
          )}
        </View>
      </View>
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: 24,
  },
  content: {
    alignItems: 'center',
    gap: 16,
    paddingHorizontal: 32,
  },
  illustration: {
    fontSize: 64,
  },
  title: {
    fontSize: 18,
    fontWeight: '700',
    textAlign: 'center',
  },
  message: {
    fontSize: 14,
    color: '#64748B',
    textAlign: 'center',
    lineHeight: 20,
  },
  actions: {
    flexDirection: 'row',
    gap: 12,
    marginTop: 8,
    flexWrap: 'wrap',
    justifyContent: 'center',
  },
  retryButton: {
    paddingHorizontal: 24,
    paddingVertical: 12,
    borderRadius: 12,
    alignItems: 'center',
    minWidth: 120,
  },
  dismissButton: {
    paddingHorizontal: 24,
    paddingVertical: 12,
    borderRadius: 12,
    alignItems: 'center',
    borderWidth: 1,
    minWidth: 120,
  },
  buttonText: {
    fontSize: 15,
    fontWeight: '600',
  },
});

export default ErrorState;