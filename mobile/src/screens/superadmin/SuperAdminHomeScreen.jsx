// ============================================================================
// FILE: mobile/src/screens/superadmin/SuperAdminHomeScreen.jsx
// PURPOSE: SuperAdmin management console overview
// ============================================================================

/**
 * Ye SuperAdmin ka console home hai.
 *
 * Navigation Flow:
 * RootNavigator (role = SUPERADMIN) → SuperAdminNavigator → SuperAdminHomeScreen
 *
 * Console kya karta hai:
 *   Sirf WOH management modules kholta hai jo backend par SuperAdmin ke liye
 *   allow-listed hain (leave, credentials, holidays, salary). Yeh sirf ek menu
 *   hai - asli permission server par enforce hoti hai (role-based), UI hiding
 *   par nahi.
 *
 * Koi API call yahan nahi hoti aur koi Savior data touch nahi hota.
 */

import React from 'react';
import { View, Text, ScrollView, StyleSheet, TouchableOpacity } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { ScreenContainer } from '../../components/ScreenContainer';
import { LogoutButton } from '../../components/LogoutButton';
import { GradientIcon } from '../../components/GradientIcon';
import { getNavIcon } from '../../utils/navigationIcons';
import { COLORS, SPACING, SHADOWS } from '../../utils/colors';

/** The 9 management areas of the console. */
const MODULES = [
  { key: 'Credentials', glyph: 'key', route: 'SuperAdminCredentials', label: 'Employee Credential Management', desc: 'Password / PIN reset and login access' },
  { key: 'Holidays', glyph: 'flag', route: 'SuperAdminHolidays', label: 'Holiday Management', desc: 'Holiday calendar by company & category' },
  { key: 'LeaveMgmt', glyph: 'calendar', route: 'SuperAdminLeave', label: 'Leave Management', desc: 'Leave types, balances, requests & approvals' },
  { key: 'Salary', glyph: 'cash', route: 'SuperAdminSalary', label: 'Salary Management', desc: 'Salary configuration, elements and dues' },
  { key: 'FullFinal', glyph: 'document-text', route: 'SuperAdminFullFinal', label: 'Full & Final Management', desc: 'Settlement and full & final computation' },
  { key: 'Employees', glyph: 'people', route: 'SuperAdminEmployees', label: 'Employee Management', desc: 'Employee master list and details' },
  { key: 'Email', glyph: 'mail', route: 'SuperAdminEmail', label: 'Email Management', desc: 'Email configuration, notifications and health' },
  { key: 'HRAdmins', glyph: 'shield-checkmark', route: 'SuperAdminHRAdmins', label: 'HR Admin & Permissions', desc: 'Accounts, module and action permissions' },
  { key: 'SuperAdmins', glyph: 'settings', route: 'SuperAdminUsers', label: 'SuperAdmin Users', desc: 'Manage SuperAdmin accounts' },
];

export const SuperAdminHomeScreen = () => {
  const navigation = useNavigation();

  return (
    <ScreenContainer title="SuperAdmin Console" showHeader={true}>
      <ScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false}>
        <View style={styles.intro}>
          <Text style={styles.introTitle}>Management Console</Text>
          <Text style={styles.introText}>
            SuperAdmin is a management role separate from HR Admin. You have full management access
            to every module below. HR Admin accounts and their module/action permissions are
            configured here and enforced on the server.
          </Text>
        </View>

        {MODULES.map((mod) => {
          const { from, to } = getNavIcon(mod.key);
          return (
            <TouchableOpacity
              key={mod.key}
              style={[styles.moduleCard, SHADOWS.sm]}
              activeOpacity={0.85}
              onPress={() => navigation.navigate(mod.route)}
            >
              <GradientIcon from={from} to={to} name={mod.glyph} size={44} glyphRatio={0.5} />
              <View style={styles.moduleText}>
                <Text style={styles.moduleLabel}>{mod.label}</Text>
                <Text style={styles.moduleDesc}>{mod.desc}</Text>
              </View>
              <Text style={styles.chevron}>›</Text>
            </TouchableOpacity>
          );
        })}

        <View style={styles.logoutWrap}>
          <LogoutButton />
        </View>
      </ScrollView>
    </ScreenContainer>
  );
};

const styles = StyleSheet.create({
  scroll: { padding: SPACING.md, paddingBottom: SPACING.xl },
  intro: { marginBottom: SPACING.lg },
  introTitle: { fontSize: 20, fontWeight: '800', color: COLORS.textPrimary },
  introText: { marginTop: 6, fontSize: 12.5, lineHeight: 18, color: COLORS.textSecondary },
  moduleCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: SPACING.md,
    backgroundColor: COLORS.surface,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: COLORS.border,
    padding: SPACING.md,
    marginBottom: SPACING.md,
  },
  moduleText: { flex: 1, minWidth: 0 },
  moduleLabel: { fontSize: 14.5, fontWeight: '800', color: COLORS.textPrimary },
  moduleDesc: { marginTop: 2, fontSize: 11.5, color: COLORS.textSecondary },
  chevron: { fontSize: 24, color: COLORS.textTertiary, fontWeight: '700' },
  logoutWrap: { marginTop: SPACING.lg },
});

export default SuperAdminHomeScreen;
