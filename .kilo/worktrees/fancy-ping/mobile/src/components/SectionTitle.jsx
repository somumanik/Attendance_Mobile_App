// ============================================================================
// FILE: mobile/src/components/SectionTitle.jsx
// PURPOSE: Reusable section title with optional action and subtitle
// ============================================================================

/**
 * Ye reusable section title component hai.
 * Title, subtitle, action button, and divider support karta hai.
 * Consistent styling across all screens.
 * 
 * Usage:
 * <SectionTitle title="Attendance" subtitle="This Month" action={<Button />} showDivider />
 * 
 * Data Flow:
 * Parent passes title, subtitle, action
 *   ↓
 * SectionTitle renders with theme-aware styling
 *   ↓
 * Action button calls navigation/API handler
 */

import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { useTheme } from '../theme';

/**
 * SectionTitle Component
 * @param {string} title - Section title
 * @param {string} subtitle - Optional subtitle
 * @param {ReactNode} action - Optional action element (Button, Icon, etc.)
 * @param {boolean} showDivider - Show bottom divider
 * @param {Object} style - Additional styles
 */
export const SectionTitle = ({
  title,
  subtitle,
  action,
  showDivider = false,
  style,
}) => {
  const { theme } = useTheme();

  return (
    <View style={[styles.container, style]}>
      <View style={styles.header}>
        <View style={styles.textContainer}>
          <Text style={[styles.title, { color: theme.textPrimary }]}>{title}</Text>
          {subtitle && <Text style={[styles.subtitle, { color: theme.textSecondary }]}>{subtitle}</Text>}
        </View>
        {action && <View style={styles.actionContainer}>{action}</View>}
      </View>
      {showDivider && <View style={[styles.divider, { backgroundColor: theme.divider }]} />}
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    marginBottom: 8,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 4,
  },
  textContainer: {
    flex: 1,
    gap: 2,
  },
  title: {
    fontSize: 18,
    fontWeight: '700',
  },
  subtitle: {
    fontSize: 12,
    fontWeight: '400',
  },
  actionContainer: {
    marginLeft: 12,
  },
  divider: {
    height: StyleSheet.hairlineWidth,
    marginTop: 8,
  },
});

export default SectionTitle;