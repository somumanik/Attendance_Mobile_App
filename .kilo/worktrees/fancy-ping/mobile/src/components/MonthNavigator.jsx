// ============================================================================
// FILE: mobile/src/components/MonthNavigator.jsx
// PURPOSE: Simple previous-month navigator for month-wise attendance views
// ============================================================================

/**
 * Month selector used by the Executive Overview attendance audit and the Single
 * Employee Audit screen.
 *
 * - Value is a 'YYYY-MM' string.
 * - Starts at the current month and only moves backwards, so a FUTURE month can
 *   never be selected.
 * - Purely presentational: it only reports the month the user picked; loading the
 *   actual attendance stays with the caller so each screen reuses its existing
 *   data-loading path (no new backend call and no new calculation).
 */

import React from 'react';
import { View, Text, StyleSheet, TouchableOpacity } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { COLORS, TYPOGRAPHY, SPACING } from '../utils/colors';

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

export const currentMonthKey = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
};

/** Previous calendar month for a 'YYYY-MM' key. */
export const previousMonthKey = (key) => {
  const s = String(key || '').slice(0, 7);
  const m = /^(\d{4})-(\d{2})$/.exec(s);
  if (!m) return currentMonthKey();
  let year = Number(m[1]);
  let month = Number(m[2]) - 1;
  if (month === 0) { year -= 1; month = 12; }
  return `${year}-${String(month).padStart(2, '0')}`;
};

export const isCurrentMonthKey = (key) => String(key || '').slice(0, 7) === currentMonthKey();

export const formatMonthKey = (key) => {
  const m = /^(\d{4})-(\d{2})$/.exec(String(key || '').slice(0, 7));
  if (!m) return '—';
  return `${MONTHS[Number(m[2]) - 1]} ${m[1]}`;
};

export const MonthNavigator = ({ month, onChange }) => {
  const isCurrent = isCurrentMonthKey(month);
  return (
    <View style={styles.wrap}>
      <TouchableOpacity
        style={styles.arrow}
        onPress={() => onChange(previousMonthKey(month))}
        accessibilityLabel="Previous month"
        activeOpacity={0.7}
      >
        <Ionicons name="chevron-back" size={20} color={COLORS.primary} />
      </TouchableOpacity>

      <Text style={[styles.label, TYPOGRAPHY.h4]}>{formatMonthKey(month)}</Text>

      <TouchableOpacity
        style={[styles.arrow, isCurrent && styles.arrowDisabled]}
        // Future months are never available.
        disabled={isCurrent}
        onPress={() => {}}
        accessibilityLabel="Next month"
        activeOpacity={0.7}
      >
        <Ionicons name="chevron-forward" size={20} color={isCurrent ? COLORS.textTertiary : COLORS.primary} />
      </TouchableOpacity>

      {!isCurrent ? (
        <TouchableOpacity style={styles.todayChip} onPress={() => onChange(currentMonthKey())} activeOpacity={0.8}>
          <Ionicons name="calendar" size={11} color={COLORS.primary} />
          <Text style={styles.todayChipText}>Current</Text>
        </TouchableOpacity>
      ) : null}
    </View>
  );
};

const styles = StyleSheet.create({
  wrap: {
    flexDirection: 'row',
    alignItems: 'center',
    alignSelf: 'center',
    backgroundColor: COLORS.surface,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: COLORS.divider,
    paddingHorizontal: 4,
    paddingVertical: 3,
    marginBottom: SPACING.md,
  },
  arrow: {
    width: 38,
    paddingVertical: 6,
    alignItems: 'center',
    justifyContent: 'center',
  },
  arrowDisabled: { opacity: 0.5 },
  label: {
    minWidth: 118,
    textAlign: 'center',
    color: COLORS.textPrimary,
  },
  todayChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 9,
    paddingVertical: 5,
    borderRadius: 999,
    backgroundColor: `${COLORS.primary}12`,
    borderWidth: 1,
    borderColor: `${COLORS.primary}30`,
  },
  todayChipText: { fontSize: 11, fontWeight: '700', color: COLORS.primary },
});