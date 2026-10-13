// ============================================================================
// FILE: mobile/src/components/EmployeeMonthNav.jsx
// PURPOSE: Employee month navigator (employee portal only)
// ============================================================================

/**
 * Month navigator for the EMPLOYEE portal.
 *
 * Why this exists instead of the shared MonthNavigator: the shared one is also
 * used by HR Admin (Executive Overview + Single Employee Audit) and its forward
 * arrow is intentionally inert there. Changing it would alter HR Admin
 * behaviour, so the employee portal gets its own control and HR Admin is left
 * exactly as it was.
 *
 * Behaviour:
 *   Previous : Sep 2026 -> Aug 2026 -> Jul 2026 -> ...
 *   Next     : Jul 2026 -> Aug 2026 -> Sep 2026 -> Oct 2026
 *   Current  : any month -> the current month
 *
 * Month maths is plain 'YYYY-MM' integer arithmetic, so it works identically in
 * both directions and across a year boundary, and no date is ever parsed through
 * UTC. Forward navigation stops at the current month, so a future month (and any
 * "future data") can never be selected.
 *
 * Layout is a single non-overlapping row:
 *   [ < ]  [  Month Year  ]  [ > ]  [ Current ]
 */

import React from 'react';
import { View, Text, StyleSheet, TouchableOpacity } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { COLORS, TYPOGRAPHY } from '../utils/colors';

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

export const currentMonthKey = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
};

/** Shift a 'YYYY-MM' key by +/- 1 month using integer arithmetic only. */
export const shiftMonthKey = (key, delta) => {
  const m = /^(\d{4})-(\d{2})$/.exec(String(key || '').slice(0, 7));
  if (!m) return currentMonthKey();
  const total = (Number(m[2]) - 1) + delta;
  const year = Number(m[1]) + Math.floor(total / 12);
  const month = (((total % 12) + 12) % 12) + 1;
  return `${year}-${String(month).padStart(2, '0')}`;
};

export const previousMonthKey = (key) => shiftMonthKey(key, -1);
export const nextMonthKey = (key) => shiftMonthKey(key, 1);
export const isCurrentMonthKey = (key) => String(key || '').slice(0, 7) === currentMonthKey();

export const formatMonthKey = (key) => {
  const m = /^(\d{4})-(\d{2})$/.exec(String(key || '').slice(0, 7));
  if (!m) return '—';
  return `${MONTHS[Number(m[2]) - 1]} ${m[1]}`;
};

export const EmployeeMonthNav = ({ month, onChange, theme }) => {
  const t = theme || {};
  const primary = t.primary || COLORS.primary;
  const textPrimary = t.textPrimary || COLORS.textPrimary;
  const textTertiary = t.textTertiary || COLORS.textTertiary;
  const border = t.border || COLORS.border;

  const isCurrent = isCurrentMonthKey(month);
  // Forward is capped at the current month so future data is never requested.
  const canGoNext = String(month || '').slice(0, 7) < currentMonthKey();

  return (
    <View style={[styles.bar, { borderColor: border, backgroundColor: t.surface || COLORS.surface }]}>
      <TouchableOpacity
        style={styles.arrow}
        accessibilityLabel="Previous month"
        onPress={() => onChange(previousMonthKey(month))}
        activeOpacity={0.7}
        hitSlop={{ top: 6, bottom: 6, left: 6, right: 6 }}
      >
        <Ionicons name="chevron-back" size={20} color={primary} />
      </TouchableOpacity>

      <Text
        style={[styles.label, TYPOGRAPHY.h4, { color: textPrimary }]}
        numberOfLines={1}
        accessibilityLabel="Selected month"
      >
        {formatMonthKey(month)}
      </Text>

      <TouchableOpacity
        style={[styles.arrow, !canGoNext && styles.arrowDisabled]}
        accessibilityLabel="Next month"
        disabled={!canGoNext}
        onPress={() => onChange(nextMonthKey(month))}
        activeOpacity={0.7}
        hitSlop={{ top: 6, bottom: 6, left: 6, right: 6 }}
      >
        <Ionicons name="chevron-forward" size={20} color={canGoNext ? primary : textTertiary} />
      </TouchableOpacity>

      {/* In normal flow (never absolutely positioned) so it cannot overlap Next. */}
      {isCurrent ? <View style={styles.currentSpacer} /> : (
        <TouchableOpacity
          style={[styles.current, { borderColor: `${primary}55`, backgroundColor: `${primary}15` }]}
          accessibilityLabel="Current month"
          onPress={() => onChange(currentMonthKey())}
          activeOpacity={0.8}
          hitSlop={{ top: 6, bottom: 6, left: 4, right: 4 }}
        >
          <Text style={[styles.currentText, { color: primary }]}>Current</Text>
        </TouchableOpacity>
      )}
    </View>
  );
};

const styles = StyleSheet.create({
  bar: {
    flexDirection: 'row',
    alignItems: 'center',
    borderRadius: 12,
    borderWidth: 1,
    paddingHorizontal: 6,
    paddingVertical: 6,
    marginBottom: 12,
  },
  arrow: {
    width: 40,
    minHeight: 40,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 10,
  },
  arrowDisabled: { opacity: 0.4 },
  label: { flex: 1, textAlign: 'center' },
  // Keeps the title centred whether or not the Current chip is shown.
  currentSpacer: { width: 62, height: 1 },
  current: {
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 999,
    borderWidth: 1,
    minHeight: 30,
    justifyContent: 'center',
  },
  currentText: { fontSize: 11, fontWeight: '800' },
});

export default EmployeeMonthNav;
