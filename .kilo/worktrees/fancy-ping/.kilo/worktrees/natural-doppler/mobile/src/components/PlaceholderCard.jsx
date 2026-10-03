// ============================================================================
// FILE: mobile/src/components/PlaceholderCard.jsx
// PURPOSE: Reusable placeholder card for info display
// ============================================================================

/**
 * Ye component information display ke liye reusable card hai.
 * Dashboard stats, profile info, etc. ke liye use hota hai.
 * 
 * Props:
 * - title: Card title
 * - value: Main value
 * - subtitle: Optional subtitle
 * - color: Accent color
 * - description: Optional description text
 */

import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { COLORS, TYPOGRAPHY, SPACING, SHADOWS } from '../utils/colors';

/**
 * Placeholder Card Component
 */
export const PlaceholderCard = ({ 
  title, 
  value, 
  subtitle, 
  color = COLORS.primary, 
  description 
}) => {
  return (
    <View style={[styles.card, { borderLeftColor: color }, SHADOWS.sm]}>
      <Text style={[styles.title, TYPOGRAPHY.caption]}>{title}</Text>
      <Text style={[styles.value, { color }]}>{value}</Text>
      {subtitle && <Text style={[styles.subtitle, TYPOGRAPHY.caption]}>{subtitle}</Text>}
      {description && <Text style={[styles.description, TYPOGRAPHY.caption]}>{description}</Text>}
    </View>
  );
};

const styles = StyleSheet.create({
  card: {
    flex: 1,
    minWidth: 140,
    backgroundColor: COLORS.surface,
    borderRadius: 12,
    padding: SPACING.md,
    borderLeftWidth: 3,
    borderWidth: 1,
    borderColor: COLORS.divider,
    ...SHADOWS.sm,
  },
  title: {
    color: COLORS.textSecondary,
    marginBottom: SPACING.xs,
  },
  value: {
    fontSize: 20,
    fontWeight: '700',
    marginBottom: SPACING.xs,
  },
  subtitle: {
    color: COLORS.textTertiary,
    fontSize: 11,
  },
  description: {
    color: COLORS.textTertiary,
    marginTop: SPACING.xs,
    fontSize: 10,
  },
});

export default PlaceholderCard;