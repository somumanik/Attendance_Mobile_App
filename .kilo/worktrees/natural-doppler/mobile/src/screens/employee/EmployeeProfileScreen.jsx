// ============================================================================
// FILE: mobile/src/screens/employee/EmployeeProfileScreen.jsx
// PURPOSE: Employee Profile - Personal info, bio data, contact details
// ============================================================================

/**
 * Ye screen Employee ki profile information dikhati hai.
 * 
 * Navigation Flow:
 * EmployeeNavigator (Profile Tab) → EmployeeProfileScreen
 * 
 * Data Flow (Phase 2):
 * Screen Mount → API Service (GET /api/me) → Backend
 * Backend → Employee Data → Screen State → UI Render
 * 
 * Backend API: GET /api/me (Employee role required)
 * Response: { paycode, empname, presentcardno, companycode, departmentcode, designation, dateofbirth, dateofjoin, sex, cat, ismarried, active, e_mail1, telephone1, address1, pincode1, qualification, experience }
 * 
 * Phase 1: Placeholder UI with demo data
 * Phase 2: Real API integration
 */

import React, { useState, useEffect } from 'react';
import { View, Text, ScrollView, StyleSheet, Image, TouchableOpacity, Alert } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { COLORS, TYPOGRAPHY, SPACING, SHADOWS } from '../../utils/colors';
import { formatDate } from '../../utils/format';
import { ScreenContainer } from '../../components/ScreenContainer';
import { PlaceholderCard } from '../../components/PlaceholderCard';
import { LogoutButton } from '../../components/LogoutButton';
import { getPinStatus } from '../../services/auth';

/**
 * Employee Profile Screen Component
 */
export const EmployeeProfileScreen = () => {
  const navigation = useNavigation();
  const [profile, setProfile] = useState(null);
  const [isLoading, setIsLoading] = useState(true);
  // Phase 3A.8: employee ka 4-digit PIN set hai ya nahi.
  const [pinConfigured, setPinConfigured] = useState(false);

  // PIN status backend se puchte hain. Backend apni identity JWT se leta hai.
  useEffect(() => {
    let active = true;
    getPinStatus()
      .then((status) => { if (active) setPinConfigured(status.pinConfigured); })
      .catch(() => { if (active) setPinConfigured(false); });
    return () => { active = false; };
  }, []);

  // PIN set hai ya nahi — usi hisaab se Create ya Change screen kholte hain.
  const handlePinPress = () => {
    navigation.navigate(pinConfigured ? 'PinChange' : 'PinSetup');
  };

  useEffect(() => {
    // Phase 2: Real API call
    // const data = await api.get(API_ENDPOINTS.ME);
    // setProfile(data.employee);
    
    // Phase 1: Demo data
    setTimeout(() => {
      setProfile({
        paycode: 'EMP001',
        empname: 'Rajesh Kumar',
        presentcardno: '1001',
        companycode: 'SAVIOR INFOTECH',
        departmentcode: 'IT',
        designation: 'Software Engineer',
        dateofbirth: '1990-05-15',
        dateofjoin: '2022-03-01',
        sex: 'M',
        cat: 'STF',
        ismarried: 'Y',
        active: 'Y',
        telephone1: '9876543210',
        e_mail1: 'rajesh.kumar@savior.co.in',
        address1: '123 Tech Park, Bangalore',
        pincode1: '560001',
        qualification: 'B.Tech (CSE)',
        experience: '4 Years',
      });
      setIsLoading(false);
    }, 500);
  }, []);

  if (isLoading) {
    return (
      <ScreenContainer title="My Profile" showHeader={true}>
        <View style={styles.loadingContainer}>
          <Text style={[styles.loadingText, TYPOGRAPHY.body]}>Loading profile...</Text>
        </View>
      </ScreenContainer>
    );
  }

  const calculateAge = (dob) => {
    const birthDate = new Date(dob);
    const today = new Date();
    let age = today.getFullYear() - birthDate.getFullYear();
    const monthDiff = today.getMonth() - birthDate.getMonth();
    if (monthDiff < 0 || (monthDiff === 0 && today.getDate() < birthDate.getDate())) {
      age--;
    }
    return age;
  };

  const calculateServiceYears = (doj) => {
    const joinDate = new Date(doj);
    const today = new Date();
    let years = today.getFullYear() - joinDate.getFullYear();
    const monthDiff = today.getMonth() - joinDate.getMonth();
    if (monthDiff < 0 || (monthDiff === 0 && today.getDate() < joinDate.getDate())) {
      years--;
    }
    return years;
  };

  const age = profile ? calculateAge(profile.dateofbirth) : 0;
  const serviceYears = profile ? calculateServiceYears(profile.dateofjoin) : 0;

  return (
      <ScreenContainer title="My Profile" showHeader={true} rightAction={<LogoutButton />}>
        <ScrollView contentContainerStyle={styles.scrollContent}>
        {/* Profile Header */}
        <View style={styles.profileHeader}>
          <View style={styles.avatarContainer}>
            <View style={styles.avatar}>
              <Text style={styles.avatarText}>{profile?.empname?.charAt(0) || 'R'}</Text>
            </View>
          </View>
          <View style={styles.profileInfo}>
            <Text style={[styles.profileName, TYPOGRAPHY.h2]}>{profile?.empname || 'Loading...'}</Text>
            <Text style={[styles.profileDesignation, TYPOGRAPHY.body]}>{profile?.designation || '—'}</Text>
            <View style={styles.badgeRow}>
              <View style={[styles.badge, { backgroundColor: COLORS.primary + '15' }]}>
                <Text style={[styles.badgeText, { color: COLORS.primary }]}>
                  {profile?.departmentcode || '—'}
                </Text>
              </View>
              <View style={[styles.badge, { backgroundColor: COLORS.success + '15' }]}>
                <Text style={[styles.badgeText, { color: COLORS.success }]}>Active</Text>
              </View>
            </View>
          </View>
        </View>

        {/* Employee ID Card */}
        <View style={styles.idCard}>
          <View style={styles.idCardHeader}>
            <Text style={[styles.idCardLabel, TYPOGRAPHY.caption]}>Employee ID</Text>
            <View style={styles.idCardChip}>
              <Text style={styles.idCardCode}>{profile?.paycode || '—'}</Text>
            </View>
          </View>
          <View style={styles.idCardFooter}>
            <Text style={[styles.idCardBioLabel, TYPOGRAPHY.caption]}>Biometric Card</Text>
            <Text style={styles.idCardBioValue}>{profile?.presentcardno || '—'}</Text>
          </View>
        </View>

        {/* Security — 4-Digit PIN (Phase 3A.8) */}
        <View style={styles.section}>
          <Text style={[styles.sectionTitle, TYPOGRAPHY.h3]}>Security</Text>
          <TouchableOpacity
            style={[styles.securityRow, { backgroundColor: COLORS.surface, borderColor: COLORS.border }]}
            onPress={handlePinPress}
            activeOpacity={0.9}
          >
            <View style={styles.securityLeft}>
              <Text style={styles.securityIcon}>🔐</Text>
              <View>
                <Text style={styles.securityTitle}>
                  {pinConfigured ? 'Change 4-Digit PIN' : 'Create 4-Digit PIN'}
                </Text>
                <Text style={[styles.securitySubtitle, TYPOGRAPHY.caption]}>
                  {pinConfigured ? 'PIN set hai — badal sakte hain' : 'PIN abhi set nahi hai'}
                </Text>
              </View>
            </View>
            <Text style={styles.securityArrow}>›</Text>
          </TouchableOpacity>
        </View>

        {/* Personal Info Section */}
        <View style={styles.section}>
          <Text style={[styles.sectionTitle, TYPOGRAPHY.h3]}>Personal Information</Text>
          
          <View style={styles.infoGrid}>
            <PlaceholderCard
              title="Date of Birth"
              value={profile?.dateofbirth ? formatDate(profile.dateofbirth) : '—'}
              subtitle={`${age} years`}
              color={COLORS.info}
            />
            <PlaceholderCard
              title="Gender"
              value={profile?.sex === 'M' ? 'Male' : profile?.sex === 'F' ? 'Female' : '—'}
              color={COLORS.primary}
            />
            <PlaceholderCard
              title="Marital Status"
              value={profile?.ismarried === 'Y' ? 'Married' : 'Single'}
              color={COLORS.secondary}
            />
            <PlaceholderCard
              title="Category"
              value={profile?.cat || '—'}
              color={COLORS.warning}
            />
          </View>
        </View>

        {/* Employment Info Section */}
        <View style={styles.section}>
          <Text style={[styles.sectionTitle, TYPOGRAPHY.h3]}>Employment Details</Text>
          
          <View style={styles.infoGrid}>
            <PlaceholderCard
              title="Date of Joining"
              value={profile?.dateofjoin ? formatDate(profile.dateofjoin) : '—'}
              subtitle={`${serviceYears} years service`}
              color={COLORS.success}
            />
            <PlaceholderCard
              title="Designation"
              value={profile?.designation || '—'}
              color={COLORS.primary}
            />
            <PlaceholderCard
              title="Department"
              value={profile?.departmentcode || '—'}
              color={COLORS.info}
            />
            <PlaceholderCard
              title="Company"
              value={profile?.companycode || '—'}
              color={COLORS.warning}
            />
          </View>
        </View>

        {/* Contact Info Section */}
        <View style={styles.section}>
          <Text style={[styles.sectionTitle, TYPOGRAPHY.h3]}>Contact Information</Text>
          
          <View style={styles.infoGrid}>
            <PlaceholderCard
              title="Mobile"
              value={profile?.telephone1 || '—'}
              color={COLORS.primary}
            />
            <PlaceholderCard
              title="Email"
              value={profile?.e_mail1 || '—'}
              color={COLORS.secondary}
            />
            <PlaceholderCard
              title="Address"
              value={profile?.address1 || '—'}
              subtitle={profile?.pincode1 || ''}
              color={COLORS.info}
            />
          </View>
        </View>

        {/* Qualification Section */}
        <View style={styles.section}>
          <Text style={[styles.sectionTitle, TYPOGRAPHY.h3]}>Qualification & Experience</Text>
          
          <View style={styles.infoGrid}>
            <PlaceholderCard
              title="Qualification"
              value={profile?.qualification || '—'}
              color={COLORS.primary}
            />
            <PlaceholderCard
              title="Total Experience"
              value={profile?.experience || '—'}
              color={COLORS.success}
            />
          </View>
        </View>

        {/* Phase 2 Notice */}
        <View style={styles.phaseNotice}>
          <Text style={[styles.phaseNoticeText, TYPOGRAPHY.caption]}>
            ℹ️ Phase 1 - Demo data. Real API: GET /api/me
          </Text>
        </View>
      </ScrollView>
    </ScreenContainer>
  );
};

const styles = StyleSheet.create({
  scrollContent: {
    paddingHorizontal: SPACING.lg,
    paddingBottom: SPACING.xxl,
  },
  securityRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: SPACING.lg,
    borderRadius: 12,
    borderWidth: 1,
  },
  securityLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: SPACING.md,
  },
  securityIcon: {
    fontSize: 24,
  },
  securityTitle: {
    fontSize: 15,
    fontWeight: '600',
    color: COLORS.textPrimary,
  },
  securitySubtitle: {
    color: COLORS.textTertiary,
  },
  securityArrow: {
    fontSize: 24,
    color: COLORS.textTertiary,
  },
  profileHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: SPACING.xl,
    paddingBottom: SPACING.lg,
    borderBottomWidth: 1,
    borderBottomColor: COLORS.divider,
  },
  avatarContainer: {
    marginRight: SPACING.lg,
  },
  avatar: {
    width: 80,
    height: 80,
    borderRadius: 40,
    backgroundColor: COLORS.primary,
    justifyContent: 'center',
    alignItems: 'center',
    ...SHADOWS.lg,
  },
  avatarText: {
    fontSize: 32,
    fontWeight: '700',
    color: COLORS.textOnPrimary,
  },
  profileInfo: {
    flex: 1,
  },
  profileName: {
    color: COLORS.textPrimary,
    marginBottom: SPACING.xs,
  },
  profileDesignation: {
    color: COLORS.textSecondary,
  },
  badgeRow: {
    flexDirection: 'row',
    gap: SPACING.sm,
    marginTop: SPACING.md,
  },
  badge: {
    paddingHorizontal: SPACING.md,
    paddingVertical: SPACING.xs,
    borderRadius: 20,
  },
  badgeText: {
    fontSize: 10,
    fontWeight: '700',
  },
  idCard: {
    backgroundColor: COLORS.primary,
    borderRadius: 16,
    padding: SPACING.lg,
    marginBottom: SPACING.xl,
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    ...SHADOWS.lg,
  },
  idCardHeader: {
    flexDirection: 'column',
  },
  idCardLabel: {
    color: 'rgba(255,255,255,0.8)',
    fontSize: 11,
    textTransform: 'uppercase',
    letterSpacing: 1,
  },
  idCardCode: {
    fontSize: 24,
    fontWeight: '700',
    color: COLORS.textOnPrimary,
    marginTop: SPACING.xs,
  },
  idCardFooter: {
    alignItems: 'flex-end',
  },
  idCardBioLabel: {
    color: 'rgba(255,255,255,0.8)',
    fontSize: 11,
    textTransform: 'uppercase',
    letterSpacing: 1,
  },
  idCardBioValue: {
    fontSize: 18,
    fontWeight: '700',
    color: COLORS.textOnPrimary,
  },
  section: {
    marginBottom: SPACING.xl,
  },
  sectionTitle: {
    color: COLORS.textPrimary,
    marginBottom: SPACING.lg,
  },
  infoGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'space-between',
    gap: SPACING.md,
  },
  phaseNotice: {
    backgroundColor: COLORS.info + '15',
    borderWidth: 1,
    borderColor: COLORS.info + '30',
    borderRadius: 12,
    padding: SPACING.md,
    marginTop: SPACING.lg,
  },
  phaseNoticeText: {
    color: COLORS.info,
    textAlign: 'center',
  },
});