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
import { useNavigation } from '@react-navigation/native';
import { useTheme } from '../../theme';
import { Button, Card } from '../../components';

/**
 * Role Selection Screen Component
 */
export const RoleSelectionScreen = () => {
  const navigation = useNavigation();
  const { theme } = useTheme();

  const handleRoleSelect = (role) => {
    if (role === 'HR') {
      navigation.navigate('HRLogin');
    } else {
      navigation.navigate('EmployeeLogin');
    }
  };

  return (
    <View style={[styles.container, { backgroundColor: theme.background }]}>
      <ScrollView contentContainerStyle={styles.scrollContent} showsVerticalScrollIndicator={false}>
        {/* Logo Area */}
        <View style={styles.logoContainer}>
          <View style={[styles.logoCircle, { backgroundColor: theme.primary }]}>
            <Text style={styles.logoIcon}>📊</Text>
          </View>
          <Text style={[styles.appTitle, { color: theme.textPrimary }]}>Savior Attendance</Text>
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
              <View style={[styles.roleIconContainer, { backgroundColor: `${theme.primary}15` }]}>
                <Text style={styles.roleIcon}>🛡️</Text>
              </View>
              <View style={styles.roleTextContent}>
                <Text style={[styles.roleTitle, { color: theme.textPrimary }]}>HR Admin</Text>
                <Text style={[styles.roleDesc, { color: theme.textSecondary }]}>Dashboard, Reports, Employee Management</Text>
              </View>
              <View style={styles.arrowContainer}>
                <Text style={styles.arrowText}>→</Text>
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
              <View style={[styles.roleIconContainer, { backgroundColor: `${theme.secondary}15` }]}>
                <Text style={styles.roleIcon}>👤</Text>
              </View>
              <View style={styles.roleTextContent}>
                <Text style={[styles.roleTitle, { color: theme.textPrimary }]}>Employee</Text>
                <Text style={[styles.roleDesc, { color: theme.textSecondary }]}>My Attendance, Leave, Profile</Text>
              </View>
              <View style={styles.arrowContainer}>
                <Text style={styles.arrowText}>→</Text>
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
    </View>
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
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.15,
    shadowRadius: 12,
    elevation: 4,
  },
  logoIcon: {
    fontSize: 48,
  },
  appTitle: {
    fontSize: 28,
    fontWeight: '700',
    textAlign: 'center',
  },
  appSubtitle: {
    marginTop: 6,
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
  roleIconContainer: {
    width: 60,
    height: 60,
    borderRadius: 16,
    justifyContent: 'center',
    alignItems: 'center',
    flexShrink: 0,
  },
  roleIcon: {
    fontSize: 28,
  },
  roleTextContent: {
    flex: 1,
    gap: 4,
  },
  roleTitle: {
    fontSize: 18,
    fontWeight: '700',
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
  arrowText: {
    fontSize: 20,
    fontWeight: '600',
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
});