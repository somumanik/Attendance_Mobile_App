// ============================================================================
// FILE: mobile/src/components/StatCard.jsx
// PURPOSE: Reusable stat card component for dashboard metrics
// ============================================================================

/**
 * Ye component dashboard ke stat cards ke liye reusable hai.
 * 
 * Props:
 * - title: Card ka title
 * - value: Main value (number)
 * - subtitle: Optional subtitle
 * - icon: Ionicons glyph name (rendered as a colourful tinted tile)
 * - color: Accent colour (tile tint + value colour)
 * - trend: Optional trend indicator
 * 
 * Usage:
 * <StatCard title="Present" value={18} subtitle="This Month" icon="checkmark-circle" color="#059669" />
 */

import React from 'react';
import { View, Text, StyleSheet, TouchableOpacity } from 'react-native';
import { useTheme } from '../theme';
import { TintIcon } from './TintIcon';
import { TYPOGRAPHY, SPACING, SHADOWS } from '../utils/colors';

/**
 * Stat Card Component
 * onPress is optional: when provided the card becomes tappable.
 */
export const StatCard = ({ title, value, subtitle, icon, color, trend, onPress }) => {
  const { theme } = useTheme();
  const accent = color || theme.primary;

  const content = (
    <>
      <View style={styles.cardHeader}>
        <TintIcon name={icon} color={accent} size={36} iconSize={19} radius={11} />
        <Text style={[styles.title, { color: theme.textSecondary }]}>{title}</Text>
      </View>
      <View style={styles.cardBody}>
        <Text style={[styles.value, { color: accent }]}>{value}</Text>
        {subtitle && <Text style={[styles.subtitle, { color: theme.textTertiary }]}>{subtitle}</Text>}
        {trend && <Text style={[styles.trend, { color: trend.positive ? theme.success : theme.error }]}>{trend.text}</Text>}
      </View>
    </>
  );

  if (onPress) {
    return (
      <TouchableOpacity
        onPress={onPress}
        activeOpacity={0.8}
        style={[styles.card, styles.cardPressable, { borderLeftColor: accent, borderColor: theme.border }, SHADOWS.md]}
      >
        {content}
      </TouchableOpacity>
    );
  }

  return (
    <View style={[styles.card, { borderLeftColor: accent, backgroundColor: theme.surface }, SHADOWS.md]}>
      {content}
    </View>
  );
};

const styles = StyleSheet.create({
  card: {
    flex: 1,
    minWidth: '45%',
    borderRadius: 18,
    padding: SPACING.lg,
    borderLeftWidth: 4,
    ...SHADOWS.sm,
  },
  cardPressable: {
    borderWidth: 1,
  },
  cardHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: SPACING.sm,
    marginBottom: SPACING.sm,
  },
  title: {
    fontSize: 12,
    fontWeight: '700',
    letterSpacing: 0.2,
    flexShrink: 1,
  },
  cardBody: {
    gap: SPACING.xs,
  },
  value: {
    ...TYPOGRAPHY.h1,
    fontSize: 28,
  },
  subtitle: {
    fontSize: 11,
    fontWeight: '500',
  },
  trend: {
    fontSize: 11,
    fontWeight: '600',
  },
});

export default StatCard;