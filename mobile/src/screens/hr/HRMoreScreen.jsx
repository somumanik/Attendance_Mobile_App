// ============================================================================
// FILE: mobile/src/screens/hr/HRMoreScreen.jsx
// PURPOSE: "More" tab — overflow of modules the SuperAdmin placed in More
// ============================================================================

/**
 * HR Admin "More" menu (Prompt 3).
 *
 * Shows ONLY the management modules that
 *   (a) the HR Admin is permitted to VIEW  -> can(module,'view')
 *   (b) the SuperAdmin placed at 'more'    -> modulePlacement(module) === 'more'
 *
 * A module that is not permitted never appears here, and a module with no
 * placement (NULL) keeps its historical location in the bottom bar. This screen
 * is navigation only — every request is still authorised on the server.
 *
 * Each item opens the SAME existing screen as the corresponding primary tab, so
 * nothing is duplicated and Back returns to the previously focused screen.
 */

import React from 'react';
import { Text, ScrollView, StyleSheet, TouchableOpacity } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { ScreenContainer } from '../../components/ScreenContainer';
import { GradientIcon } from '../../components/GradientIcon';
import { getNavIcon } from '../../utils/navigationIcons';
import { useAuth } from '../../hooks/useAuth';
import { COLORS, SPACING } from '../../utils/colors';

/** module key -> existing HR tab route + its existing icon identity. */
const MODULE_ROUTES = {
  /* Phase 4.4 — every REAL HR navigation section now has a key here so the
     Visible/Hidden and Primary/More controls apply to all of them, not just four. */
  dashboard: { route: 'Dashboard', iconKey: 'Dashboard', label: 'Dashboard', glyph: 'speedometer' },
  employees: { route: 'Employees', iconKey: 'Employees', label: 'Employee Management', glyph: 'people' },
  audit: { route: 'Audit', iconKey: 'Audit', label: 'Attendance / Audit', glyph: 'search' },
  analytics: { route: 'Analytics', iconKey: 'Analytics', label: 'Analytics / Charts', glyph: 'analytics' },
  dailymaster: { route: 'DailyMaster', iconKey: 'DailyMaster', label: 'Daily Master', glyph: 'document-text' },
  celebrations: { route: 'Celebrations', iconKey: 'Celebrations', label: 'Celebrations', glyph: 'gift' },
  marriage: { route: 'Marriage', iconKey: 'Marriage', label: 'Marriage Anniversary', glyph: 'heart' },
  leave: { route: 'LeaveMgmt', iconKey: 'LeaveMgmt', label: 'Leave Management', glyph: 'calendar' },
  salary: { route: 'Salary', iconKey: 'Salary', label: 'Salary Management', glyph: 'cash' },
  holidays: { route: 'Holidays', iconKey: 'Holidays', label: 'Holiday Management', glyph: 'flag' },
};

/** Module keys that may be placed in the More menu (mirrors HRNavigator). */
export const MORE_CAPABLE_MODULES = Object.keys(MODULE_ROUTES);

export const HRMoreScreen = () => {
  const navigation = useNavigation();
  const { can, modulePlacement, isVisible } = useAuth();

  // A hidden section never appears here; a section with no placement keeps its
  // historical spot in the bottom bar.
  const items = Object.entries(MODULE_ROUTES).filter(
    ([key]) => can(key, 'view') && isVisible(key) && modulePlacement(key) === 'more',
  );

  return (
    <ScreenContainer title="More" showHeader={true}>
      <ScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false}>
        <Text style={styles.hint}>
          Modules placed in the More menu by your SuperAdmin. Only modules you are permitted to view appear here.
        </Text>
        {items.length ? (
          items.map(([key, meta]) => {
            const { from, to } = getNavIcon(meta.iconKey);
            return (
              <TouchableOpacity
                key={key}
                style={styles.row}
                activeOpacity={0.85}
                onPress={() => navigation.navigate(meta.route)}
              >
                <GradientIcon from={from} to={to} name={meta.glyph} size={40} glyphRatio={0.5} />
                <Text style={styles.label}>{meta.label}</Text>
                <Text style={styles.chevron}>›</Text>
              </TouchableOpacity>
            );
          })
        ) : (
          <Text style={styles.empty}>No modules are currently placed in the More menu.</Text>
        )}
      </ScrollView>
    </ScreenContainer>
  );
};

const styles = StyleSheet.create({
  scroll: { padding: SPACING.md, paddingBottom: SPACING.xl },
  hint: { fontSize: 11.5, color: COLORS.textSecondary, marginBottom: SPACING.md, lineHeight: 17 },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: SPACING.md,
    backgroundColor: COLORS.surface,
    borderWidth: 1,
    borderColor: COLORS.border,
    borderRadius: 14,
    padding: SPACING.md,
    marginBottom: SPACING.sm,
  },
  label: { flex: 1, minWidth: 0, fontSize: 14, fontWeight: '700', color: COLORS.textPrimary },
  chevron: { fontSize: 22, color: COLORS.textTertiary, fontWeight: '700' },
  empty: { fontSize: 12, color: COLORS.textSecondary, textAlign: 'center', paddingVertical: SPACING.lg },
});

export default HRMoreScreen;
