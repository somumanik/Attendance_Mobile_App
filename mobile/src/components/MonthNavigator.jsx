// ============================================================================
// FILE: mobile/src/components/MonthNavigator.jsx
// PURPOSE: Simple previous-month navigator for month-wise attendance views
// ============================================================================

/**
 * Month selector used by the Executive Overview attendance audit and the Single
 * Employee Audit screen.
 *
 * - Value is a 'YYYY-MM' string.
 * - PHASE G.2: Previous AND Next both work (Next is capped at the current
 *   month so a FUTURE month can never be selected). Month maths is plain
 *   'YYYY-MM' integer arithmetic, so Prev -> Prev -> Next -> Next always
 *   returns to the same month and the API query always uses the displayed
 *   month (no stale state).
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
export const previousMonthKey = (key) => shiftMonthKey(key, -1);

/** Next calendar month for a 'YYYY-MM' key (PHASE G.2 root-cause fix). */
export const nextMonthKey = (key) => shiftMonthKey(key, 1);

/** Shift a 'YYYY-MM' key by +/- months using integer arithmetic only (no Date
 * mutation, no stale state — Prev -> Prev -> Next -> Next always round-trips). */
export const shiftMonthKey = (key, delta) => {
  const s = String(key || '').slice(0, 7);
  const m = /^(\d{4})-(\d{2})$/.exec(s);
  if (!m) return currentMonthKey();
  const total = (Number(m[2]) - 1) + delta;
  const year = Number(m[1]) + Math.floor(total / 12);
  const month = (((total % 12) + 12) % 12) + 1;
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
  // PHASE G.2: Next is enabled whenever the displayed month is BEFORE the
  // current month (same rule as EmployeeMonthNav). Future months stay blocked.
  const canGoNext = String(month || '').slice(0, 7) < currentMonthKey();
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
        style={[styles.arrow, !canGoNext && styles.arrowDisabled]}
        disabled={!canGoNext}
        onPress={() => onChange(nextMonthKey(month))}
        accessibilityLabel="Next month"
        activeOpacity={0.7}
      >
        <Ionicons name="chevron-forward" size={20} color={canGoNext ? COLORS.primary : COLORS.textTertiary} />
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