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
 * - icon: Emoji/icon string
 * - color: Theme color
 * - trend: Optional trend indicator
 * 
 * Usage:
 * <StatCard title="Present" value={18} subtitle="This Month" icon="✅" color="#059669" />
 */

import React from 'react';
import { View, Text, StyleSheet, TouchableOpacity } from 'react-native';
import { COLORS, TYPOGRAPHY, SPACING, SHADOWS } from '../utils/colors';

/**
 * Stat Card Component
 * onPress is optional: when provided the card becomes tappable.
 */
export const StatCard = ({ title, value, subtitle, icon, color, trend, onPress }) => {
  const content = (
    <>
      <View style={styles.cardHeader}>
        <Text style={styles.icon}>{icon}</Text>
        <Text style={styles.title}>{title}</Text>
      </View>
      <View style={styles.cardBody}>
        <Text style={[styles.value, { color }]}>{value}</Text>
        {subtitle && <Text style={styles.subtitle}>{subtitle}</Text>}
        {trend && <Text style={[styles.trend, { color: trend.positive ? COLORS.success : COLORS.error }]}>{trend.text}</Text>}
      </View>
    </>
  );

  if (onPress) {
    return (
      <TouchableOpacity
        onPress={onPress}
        activeOpacity={0.8}
        style={[styles.card, styles.cardPressable, { borderLeftColor: color }, SHADOWS.md]}
      >
        {content}
      </TouchableOpacity>
    );
  }

  return (
    <View style={[styles.card, { borderLeftColor: color }, SHADOWS.md]}>
      {content}
    </View>
  );
};

const styles = StyleSheet.create({
  card: {
    flex: 1,
    minWidth: '45%',
    backgroundColor: COLORS.surface,
    borderRadius: 16,
    padding: SPACING.lg,
    borderLeftWidth: 4,
    ...SHADOWS.sm,
  },
  cardPressable: {
    borderWidth: 1,
    borderColor: COLORS.border,
  },
  cardHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: SPACING.sm,
    marginBottom: SPACING.sm,
  },
  icon: {
    fontSize: 20,
  },
  title: {
    fontSize: 12,
    color: COLORS.textSecondary,
    fontWeight: '600',
  },
  cardBody: {
    gap: SPACING.xs,
  },
  value: {
    fontSize: 28,
    fontWeight: '700',
  },
  subtitle: {
    fontSize: 11,
    color: COLORS.textTertiary,
  },
  trend: {
    fontSize: 11,
    fontWeight: '600',
  },
});

export default StatCard;