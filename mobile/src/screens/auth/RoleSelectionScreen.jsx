// ============================================================================
// FILE: mobile/src/screens/auth/RoleSelectionScreen.jsx
// PURPOSE: First screen - User selects HR Admin or Employee role
// ============================================================================

/**
 * Ye screen login flow ka pehla step hai - role selection.
 * 
 * Navigation Flow:
 * AuthNavigator (initial) → RoleSelectionScreen
 *   ↓
 * User taps "HR Admin" → navigate('HRLogin')
 * User taps "Employee" → navigate('EmployeeLogin')
 * 
 * Data Flow:
 * Sirf navigation decision - koi API call NAHI.
 * Role selection ke baad appropriate login screen khulta hai.
 */

import React from 'react';
import { View, Text, TouchableOpacity, StyleSheet, ScrollView } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useNavigation } from '@react-navigation/native';
import { Ionicons } from '@expo/vector-icons';
import { useTheme } from '../../theme';
import { Button, Card, GradientIcon, TintIcon } from '../../components';

/**
 * Role Selection Screen Component
 */
export const RoleSelectionScreen = () => {
  const navigation = useNavigation();
  const { theme } = useTheme();

  const handleRoleSelect = (role) => {
    if (role === 'HR') {
      navigation.navigate('HRLogin');
    } else if (role === 'SUPERADMIN') {
      navigation.navigate('SuperAdminLogin');
    } else {
      navigation.navigate('EmployeeLogin');
    }
  };

  return (
    <SafeAreaView style={[styles.container, { backgroundColor: theme.background }]} edges={['top', 'left', 'right']}>
      <ScrollView contentContainerStyle={styles.scrollContent} showsVerticalScrollIndicator={false}>
        {/* Logo Area */}
        <View style={styles.logoContainer}>
          <View style={[styles.logoCircle, { backgroundColor: theme.primary }]}>
            <GradientIcon
              from="#2563EB"
              to="#7C3AED"
              name="stats-chart"
              size={100}
              radius={50}
              glyphRatio={0.5}
            />
          </View>
          <Text style={[styles.appTitle, { color: theme.textPrimary }]}>Mohani Attendance</Text>
          <Text style={[styles.appSubtitle, { color: theme.textSecondary }]}>Mobile Portal</Text>
        </View>

        {/* Role Selection Cards */}
        <View style={styles.cardsContainer}>
          {/* HR Admin Card */}
          <Card
            elevation="raised"
            clickable
            onPress={() => handleRoleSelect('HR')}
            bordered
            style={styles.roleCard}
          >
            <View style={styles.cardContent}>
              <TintIcon name="shield-checkmark" color={theme.primary} size={60} iconSize={30} radius={16} />
              <View style={styles.roleTextContent}>
                <Text style={[styles.roleTitle, { color: theme.textPrimary }]}>HR Admin</Text>
                <Text style={[styles.roleDesc, { color: theme.textSecondary }]}>Dashboard, Reports, Employee Management</Text>
              </View>
              <View style={[styles.arrowContainer, { backgroundColor: `${theme.primary}12` }]}>
                <Ionicons name="chevron-forward" size={20} color={theme.primary} />
              </View>
            </View>
          </Card>

          {/* Employee Card */}
          <Card
            elevation="raised"
            clickable
            onPress={() => handleRoleSelect('Employee')}
            bordered
            style={styles.roleCard}
          >
            <View style={styles.cardContent}>
              <TintIcon name="person" color={theme.secondary} size={60} iconSize={30} radius={16} />
              <View style={styles.roleTextContent}>
                <Text style={[styles.roleTitle, { color: theme.textPrimary }]}>Employee</Text>
                <Text style={[styles.roleDesc, { color: theme.textSecondary }]}>My Attendance, Leave, Profile</Text>
              </View>
              <View style={[styles.arrowContainer, { backgroundColor: `${theme.secondary}12` }]}>
                <Ionicons name="chevron-forward" size={20} color={theme.secondary} />
              </View>
            </View>
          </Card>

          {/* SuperAdmin Card — additive third option. The HR Admin and Employee
              cards above are byte-for-byte unchanged. */}
          <Card
            elevation="raised"
            clickable
            onPress={() => handleRoleSelect('SUPERADMIN')}
            bordered
            style={styles.roleCard}
          >
            <View style={styles.cardContent}>
              <TintIcon name="settings" color={theme.accentViolet} size={60} iconSize={30} radius={16} />
              <View style={styles.roleTextContent}>
                <Text style={[styles.roleTitle, { color: theme.textPrimary }]}>SuperAdmin</Text>
                <Text style={[styles.roleDesc, { color: theme.textSecondary }]}>Management console · Leave, Credentials, Holidays, Salary</Text>
              </View>
              <View style={[styles.arrowContainer, { backgroundColor: `${theme.accentViolet}12` }]}>
                <Ionicons name="chevron-forward" size={20} color={theme.accentViolet} />
              </View>
            </View>
          </Card>
        </View>

        {/* Info Text */}
        <View style={styles.infoContainer}>
          <Text style={[styles.infoText, { color: theme.textTertiary }]}>
            Select your role to continue to the appropriate portal
          </Text>
        </View>

        {/* Version */}
        <Text style={[styles.versionText, { color: theme.textTertiary }]}>v1.0.0</Text>
      </ScrollView>
    </SafeAreaView>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  scrollContent: {
    paddingHorizontal: 24,
    paddingVertical: 32,
    paddingBottom: 48,
  },
  logoContainer: {
    alignItems: 'center',
    marginBottom: 32,
    paddingTop: 16,
  },
  logoCircle: {
    width: 100,
    height: 100,
    borderRadius: 50,
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 16,
    shadowColor: '#2563EB',
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.35,
    shadowRadius: 16,
    elevation: 8,
  },
  appTitle: {
    fontSize: 28,
    fontWeight: '800',
    letterSpacing: -0.5,
    textAlign: 'center',
  },
  appSubtitle: {
    marginTop: 6,
    fontSize: 13,
    fontWeight: '600',
    letterSpacing: 1,
    textTransform: 'uppercase',
  },
  cardsContainer: {
    gap: 16,
    marginBottom: 32,
  },
  roleCard: {
    padding: 0,
  },
  cardContent: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 20,
    gap: 16,
  },
  roleTextContent: {
    flex: 1,
    gap: 4,
  },
  roleTitle: {
    fontSize: 18,
    fontWeight: '700',
    letterSpacing: -0.2,
  },
  roleDesc: {
    fontSize: 13,
    fontWeight: '400',
  },
  arrowContainer: {
    width: 40,
    height: 40,
    borderRadius: 12,
    justifyContent: 'center',
    alignItems: 'center',
  },
  infoContainer: {
    alignItems: 'center',
    paddingTop: 16,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: '#E2E8F0', // Will be theme-aware
  },
  infoText: {
    fontSize: 12,
    textAlign: 'center',
  },
  versionText: {
    fontSize: 11,
    fontWeight: '500',
  },
});