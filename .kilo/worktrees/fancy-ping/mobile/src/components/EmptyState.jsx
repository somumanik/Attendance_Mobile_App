// ============================================================================
// FILE: mobile/src/components/EmptyState.jsx
// PURPOSE: Reusable empty state component with illustration, message, and action
// ============================================================================

/**
 * Ye reusable empty state component hai.
 * Illustration, title, message, action button support karta hai.
 * Multiple preset types: default, search, filter, no-data, no-network, no-permission
 * 
 * Usage:
 * <EmptyState title="No Data" message="No records found" action={{ title: 'Refresh', onPress: handleRefresh }} />
 * <EmptyState type="search" onClearSearch={handleClearSearch} />
 * <EmptyState type="no-network" onRetry={handleRetry} />
 * 
 * Data Flow:
 * Parent conditionally renders when data is empty
 *   ↓
 * EmptyState renders with theme-aware styling and action
 *   ↓
 * User taps action → calls onPress handler
 *   ↓
 * Parent handles refresh/retry/navigation
 */

import React from 'react';
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import { useTheme } from '../theme';

/**
 * EmptyState Component
 * @param {string} type - 'default' | 'search' | 'filter' | 'no-data' | 'no-network' | 'no-permission' | 'no-results'
 * @param {string} title - Title text
 * @param {string} message - Description message
 * @param {Object} action - { title: string, onPress: Function, variant?: string }
 * @param {ReactNode} illustration - Custom illustration
 * @param {Object} style - Additional styles
 */
export const EmptyState = ({
  type = 'default',
  title,
  message,
  action,
  illustration,
  style,
}) => {
  const { theme } = useTheme();

  // Type-based defaults
  const getDefaults = () => {
    switch (type) {
      case 'search':
        return {
          title: 'No Results',
          message: 'Try adjusting your search terms or filters',
          illustration: '🔍',
        };
      case 'filter':
        return {
          title: 'No Matching Records',
          message: 'Try adjusting your filters',
          illustration: '🔧',
        };
      case 'no-network':
        return {
          title: 'No Connection',
          message: 'Check your internet connection and try again',
          illustration: '📡',
        };
      case 'no-permission':
        return {
          title: 'Access Denied',
          message: 'You don\'t have permission to view this content',
          illustration: '🔒',
        };
      case 'no-results':
        return {
          title: 'No Data Found',
          message: 'No records match your criteria',
          illustration: '📭',
        };
      case 'no-data':
      default:
        return {
          title: 'No Data Available',
          message: 'There are no records to display at this time',
          illustration: '📦',
        };
    }
  };

  const defaults = getDefaults();
  const finalTitle = title || defaults.title;
  const finalMessage = message || defaults.message;
  const finalIllustration = illustration || defaults.illustration;

  return (
    <View style={[styles.container, { backgroundColor: theme.background }, style]}>
      <View style={styles.content}>
        <Text style={styles.illustration}>{finalIllustration}</Text>
        <Text style={[styles.title, { color: theme.textPrimary }]}>{finalTitle}</Text>
        <Text style={[styles.message, { color: theme.textSecondary }]}>{finalMessage}</Text>
        {action && (
          <TouchableOpacity
            style={[styles.actionButton, { backgroundColor: theme.primary }]}
            onPress={action.onPress}
            activeOpacity={0.85}
          >
            <Text style={[styles.actionButtonText, { color: '#FFFFFF' }]}>
              {action.title}
            </Text>
          </TouchableOpacity>
        )}
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
  actionButton: {
    marginTop: 8,
    paddingHorizontal: 24,
    paddingVertical: 12,
    borderRadius: 12,
    alignItems: 'center',
  },
  actionButtonText: {
    fontSize: 15,
    fontWeight: '600',
  },
});

export default EmptyState;