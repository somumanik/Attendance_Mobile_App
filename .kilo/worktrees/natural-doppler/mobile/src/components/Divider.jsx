// ============================================================================
// FILE: mobile/src/components/Divider.jsx
// PURPOSE: Reusable divider component
// ============================================================================

/**
 * Ye reusable divider component hai.
 * Horizontal line with optional label in center.
 * Theme-aware coloring.
 * 
 * Usage:
 * <Divider />
 * <Divider label="OR" />
 * <Divider vertical style={{ height: 100 }} />
 * 
 * Data Flow:
 * Parent renders divider
 *   ↓
 * Divider renders with theme-aware styling
 */

import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { useTheme } from '../theme';

/**
 * Divider Component
 * @param {string} label - Optional center label
 * @param {boolean} vertical - Vertical divider
 * @param {Object} style - Additional styles
 */
export const Divider = ({
  label,
  vertical = false,
  style,
}) => {
  const { theme } = useTheme();

  if (vertical) {
    return (
      <View style={[
        styles.vertical,
        { backgroundColor: theme.border },
        style,
      ]} />
    );
  }

  if (label) {
    return (
      <View style={[styles.horizontal, style]}>
        <View style={styles.line} />
        <View style={styles.labelContainer}>
          <Text style={[styles.label, { color: theme.textTertiary }]}>{label}</Text>
        </View>
        <View style={styles.line} />
      </View>
    );
  }

  return (
    <View style={[
      styles.horizontal,
      { borderTopColor: theme.divider },
      style,
    ]} />
  );
};

const styles = StyleSheet.create({
  horizontal: {
    flexDirection: 'row',
    alignItems: 'center',
    width: '100%',
    gap: 12,
  },
  vertical: {
    width: StyleSheet.hairlineWidth,
  },
  line: {
    flex: 1,
    height: StyleSheet.hairlineWidth,
    backgroundColor: '#E2E8F0', // Will be overridden by theme
  },
  labelContainer: {
    paddingHorizontal: 8,
    flexShrink: 0,
  },
  label: {
    fontSize: 11,
    fontWeight: '600',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
});

export default Divider;