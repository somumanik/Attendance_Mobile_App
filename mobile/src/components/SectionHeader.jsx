// ============================================================================
// FILE: mobile/src/components/SectionHeader.jsx
// PURPOSE: Reusable section header component
// ============================================================================

/**
 * Ye component section headers ke liye reusable hai.
 * Consistent styling across all screens.
 */

import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { COLORS, TYPOGRAPHY, SPACING } from '../utils/colors';

/**
 * Section Header Component
 * @param {string} title - Section title
 * @param {string} subtitle - Optional subtitle
 * @param {ReactNode} action - Optional action button
 */
export const SectionHeader = ({ title, subtitle, action }) => {
  return (
    <View style={styles.container}>
      <View style={styles.textContainer}>
        <Text style={[styles.title, TYPOGRAPHY.h3]}>{title}</Text>
        {subtitle && <Text style={[styles.subtitle, TYPOGRAPHY.caption]}>{subtitle}</Text>}
      </View>
      {action}
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-end',
    marginBottom: SPACING.lg,
  },
  textContainer: {
    flex: 1,
  },
  title: {
    color: COLORS.textPrimary,
    marginBottom: SPACING.xs,
  },
  subtitle: {
    color: COLORS.textTertiary,
  },
});

export default SectionHeader;