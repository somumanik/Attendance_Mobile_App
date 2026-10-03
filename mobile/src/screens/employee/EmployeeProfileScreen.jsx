// ============================================================================
// FILE: mobile/src/screens/employee/EmployeeProfileScreen.jsx
// PURPOSE: Employee Profile - real master data + self-service editing
// ============================================================================

/**
 * Ye screen EMPLOYEE ka apna profile dikhati hai.
 *
 * Navigation Flow:
 * EmployeeNavigator (Profile Tab) -> EmployeeProfileScreen
 *
 * Data Flow:
 * Employee Login -> JWT (paycode inside the token)
 *              -> GET  /api/employee/profile   (read)
 *              -> PUT  /api/employee/profile   (self-service save)
 *
 * Identity & security:
 * The client NEVER sends a paycode. The backend resolves the employee from the
 * verified JWT on every call, so one employee can never read or update another
 * employee's profile by changing a request parameter.
 *
 * Read-only (HR master, shown for information only - the server refuses to
 * write them): name, paycode, biometric card, designation, department, company,
 * date of joining, date of birth, gender, marital status, category,
 * qualification, experience, blood group, active status.
 *
 * Self-service (employee maintainable, stored in the EXISTING dbo.tblemployee
 * contact columns): mobile, personal email, address, pin code, emergency contact
 * name, emergency contact number.
 */

import React, { useState, useEffect, useCallback } from 'react';
import { View, Text, ScrollView, StyleSheet, TouchableOpacity, TextInput, ActivityIndicator } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { COLORS, TYPOGRAPHY, SPACING, SHADOWS } from '../../utils/colors';
import { ScreenContainer } from '../../components/ScreenContainer';
import { Button } from '../../components/Button';
import { PlaceholderCard } from '../../components/PlaceholderCard';
import { LogoutButton } from '../../components/LogoutButton';
import { getPinStatus, getMyProfile, saveMyProfile } from '../../services/auth';

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const clean = (v) => String(v == null ? '' : v).trim();
const DASH = '—';

/** Calendar dates only - never parsed through UTC, so a date cannot shift. */
const fmtDate = (v) => {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(clean(v));
  if (!m) return '';
  return `${m[3]}-${MONTHS[Number(m[2]) - 1]}-${m[1]}`;
};
const yearsSince = (v) => {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(clean(v));
  if (!m) return null;
  const b = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  if (Number.isNaN(b.getTime())) return null;
  const n = new Date();
  let y = n.getFullYear() - b.getFullYear();
  const md = n.getMonth() - b.getMonth();
  if (md < 0 || (md === 0 && n.getDate() < b.getDate())) y -= 1;
  return y < 0 ? null : y;
};
const show = (v) => { const s = clean(v); return s ? s : DASH; };

/** Fields the employee may edit (mirrors the server whitelist). */
const EDITABLE = [
  { key: 'mobile', label: 'Mobile Number', placeholder: 'e.g. 9876543210', keyboard: 'phone-pad' },
  { key: 'email', label: 'Personal Email', placeholder: 'name@example.com', keyboard: 'email-address' },
  { key: 'address', label: 'Address', placeholder: 'House / street / city', keyboard: 'default' },
  { key: 'pincode', label: 'PIN Code', placeholder: 'e.g. 560001', keyboard: 'number-pad' },
  { key: 'emergencyName', label: 'Emergency Contact Name', placeholder: 'Contact name', keyboard: 'default' },
  { key: 'emergencyNumber', label: 'Emergency Contact Number', placeholder: 'Contact number', keyboard: 'phone-pad' },
];

const EMPTY_EDIT = EDITABLE.reduce((a, f) => ({ ...a, [f.key]: '' }), {});

/**
 * Employee Profile Screen Component
 */
export const EmployeeProfileScreen = () => {
  const navigation = useNavigation();
  const [profile, setProfile] = useState(null);
  const [isLoading, setIsLoading] = useState(true);
  const [loadError, setLoadError] = useState(null);
  // 4-digit PIN state (existing functionality - unchanged).
  const [pinConfigured, setPinConfigured] = useState(false);

  // Edit / save state for the self-service fields only.
  const [editing, setEditing] = useState(false);
  const [form, setForm] = useState(EMPTY_EDIT);
  const [saving, setSaving] = useState(false);
  const [formMessage, setFormMessage] = useState(null); // { kind, text }

  const loadProfile = useCallback(async (isRefresh) => {
    if (isRefresh) setIsLoading(true);
    setLoadError(null);
    try {
      const p = await getMyProfile();
      setProfile(p);
      if (p) {
        setForm({
          mobile: clean(p.mobile),
          email: clean(p.email),
          address: clean(p.address),
          pincode: clean(p.pincode),
          emergencyName: clean(p.emergencyName),
          emergencyNumber: clean(p.emergencyNumber),
        });
      }
    } catch (e) {
      setProfile(null);
      setLoadError('Unable to load your profile. Please try again.');
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => { loadProfile(false); }, [loadProfile]);

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

  const startEdit = () => {
    setForm({
      mobile: clean(profile?.mobile),
      email: clean(profile?.email),
      address: clean(profile?.address),
      pincode: clean(profile?.pincode),
      emergencyName: clean(profile?.emergencyName),
      emergencyNumber: clean(profile?.emergencyNumber),
    });
    setFormMessage(null);
    setEditing(true);
  };

  const cancelEdit = () => {
    setEditing(false);
    setFormMessage(null);
    setForm({
      mobile: clean(profile?.mobile),
      email: clean(profile?.email),
      address: clean(profile?.address),
      pincode: clean(profile?.pincode),
      emergencyName: clean(profile?.emergencyName),
      emergencyNumber: clean(profile?.emergencyNumber),
    });
  };

  const saveEdit = async () => {
    if (saving) return;                       // block duplicate taps
    setSaving(true);
    setFormMessage(null);
    try {
      const res = await saveMyProfile(form);
      const updated = res?.profile || null;
      if (updated) {
        setProfile(updated);
        setForm({
          mobile: clean(updated.mobile),
          email: clean(updated.email),
          address: clean(updated.address),
          pincode: clean(updated.pincode),
          emergencyName: clean(updated.emergencyName),
          emergencyNumber: clean(updated.emergencyNumber),
        });
      }
      setEditing(false);
      setFormMessage({ kind: 'ok', text: 'Profile saved successfully.' });
    } catch (e) {
      const msg = clean(e?.response?.data?.message) || 'Unable to save profile. Please try again.';
      setFormMessage({ kind: 'error', text: msg });
    } finally {
      setSaving(false);
    }
  };

  if (isLoading) {
    return (
      <ScreenContainer title="My Profile" showHeader={true}>
        <View style={styles.loadingContainer}>
          <ActivityIndicator size="large" color={COLORS.primary} />
          <Text style={[styles.loadingText, TYPOGRAPHY.body]}>Loading your profile...</Text>
        </View>
      </ScreenContainer>
    );
  }

  if (loadError || !profile) {
    return (
      <ScreenContainer title="My Profile" showHeader={true} rightAction={<LogoutButton />}>
        <View style={styles.loadingContainer}>
          <Text style={[styles.loadingText, { color: COLORS.error }]}>⚠️ {loadError || 'Profile not found.'}</Text>
          <Button title="Retry" onPress={() => loadProfile(true)} variant="outline" size="small" style={{ marginTop: 12 }} />
        </View>
      </ScreenContainer>
    );
  }

  const age = yearsSince(profile.dateofbirth);
  const serviceYears = yearsSince(profile.dateofjoin);

  const readOnlyRow = (label, value) => (
    <View style={[styles.infoRow, { backgroundColor: COLORS.surface, borderColor: COLORS.border }]}>
      <Text style={[styles.infoLabel, TYPOGRAPHY.caption]}>{label}</Text>
      <Text style={styles.infoValue} numberOfLines={2}>{show(value)}</Text>
    </View>
  );

  return (
    <ScreenContainer title="My Profile" showHeader={true} rightAction={<LogoutButton />}>
      <ScrollView contentContainerStyle={styles.scrollContent}>
        {/* Profile Header — real authenticated employee */}
        <View style={styles.profileHeader}>
          <View style={styles.avatarContainer}>
            <View style={styles.avatar}>
              <Text style={styles.avatarText}>{clean(profile.empname).charAt(0) || 'E'}</Text>
            </View>
          </View>
          <View style={styles.profileInfo}>
            <Text style={[styles.profileName, TYPOGRAPHY.h2]} numberOfLines={1}>{show(profile.empname)}</Text>
            <Text style={[styles.profileDesignation, TYPOGRAPHY.body]} numberOfLines={1}>{show(profile.designation)}</Text>
            <View style={styles.badgeRow}>
              <View style={[styles.badge, { backgroundColor: COLORS.primary + '15' }]}>
                <Text style={[styles.badgeText, { color: COLORS.primary }]} numberOfLines={1}>
                  {show(profile.departmentname || profile.departmentcode)}
                </Text>
              </View>
              <View style={[styles.badge, { backgroundColor: COLORS.success + '15' }]}>
                <Text style={[styles.badgeText, { color: COLORS.success }]}>
                  {clean(profile.active).toUpperCase() === 'Y' ? 'Active' : 'Inactive'}
                </Text>
              </View>
            </View>
          </View>
        </View>

        {/* Employee ID Card */}
        <View style={styles.idCard}>
          <View style={styles.idCardHeader}>
            <Text style={[styles.idCardLabel, TYPOGRAPHY.caption]}>Employee ID</Text>
            <View style={styles.idCardChip}>
              <Text style={styles.idCardCode}>{show(profile.paycode)}</Text>
            </View>
          </View>
          <View style={styles.idCardFooter}>
            <Text style={[styles.idCardBioLabel, TYPOGRAPHY.caption]}>Biometric Card</Text>
            <Text style={styles.idCardBioValue}>{show(profile.presentcardno)}</Text>
          </View>
        </View>

        {/* Official employment information — READ ONLY (HR master) */}
        <View style={styles.section}>
          <View style={styles.sectionTitleRow}>
            <Text style={[styles.sectionTitle, TYPOGRAPHY.h3]}>Official Information</Text>
            <View style={[styles.lockBadge, { backgroundColor: COLORS.info + '15' }]}>
              <Text style={[styles.lockBadgeText, { color: COLORS.info }]}>READ ONLY</Text>
            </View>
          </View>
          <Text style={[styles.sectionHint, TYPOGRAPHY.caption]}>
            Ye HR master fields hain — inhe employee change nahi kar sakta.
          </Text>

          <View style={styles.infoList}>
            {readOnlyRow('Employee Name', profile.empname)}
            {readOnlyRow('Paycode', profile.paycode)}
            {readOnlyRow('Biometric Card', profile.presentcardno)}
            {readOnlyRow('Designation', profile.designation)}
            {readOnlyRow('Department', profile.departmentname || profile.departmentcode)}
            {readOnlyRow('Company', profile.companyname || profile.companycode)}
            {readOnlyRow('Date of Joining', fmtDate(profile.dateofjoin))}
            {readOnlyRow('Date of Birth', fmtDate(profile.dateofbirth))}
            {readOnlyRow('Gender', profile.sex === 'M' ? 'Male' : profile.sex === 'F' ? 'Female' : '')}
            {readOnlyRow('Marital Status', profile.ismarried === 'Y' ? 'Married' : profile.ismarried === 'N' ? 'Unmarried' : '')}
            {readOnlyRow('Category', profile.cat)}
            {readOnlyRow('Qualification', profile.qualification)}
            {readOnlyRow('Experience', profile.experience)}
            {readOnlyRow('Blood Group', profile.bloodgroup)}
          </View>

          {(age !== null || serviceYears !== null) ? (
            <Text style={[styles.sectionHint, TYPOGRAPHY.caption]}>
              {age !== null ? `Age ${age} years` : ''}{age !== null && serviceYears !== null ? ' · ' : ''}
              {serviceYears !== null ? `${serviceYears} years service` : ''}
            </Text>
          ) : null}
        </View>

        {/* Self-service fields — EDITABLE */}
        <View style={styles.section}>
          <View style={styles.sectionTitleRow}>
            <Text style={[styles.sectionTitle, TYPOGRAPHY.h3]}>My Details</Text>
            {!editing ? (
              <TouchableOpacity style={[styles.editBtn, { backgroundColor: COLORS.primary + '15' }]} onPress={startEdit} activeOpacity={0.8}>
                <Text style={[styles.editBtnText, { color: COLORS.primary }]}>Edit Profile</Text>
              </TouchableOpacity>
            ) : null}
          </View>
          <Text style={[styles.sectionHint, TYPOGRAPHY.caption]}>
            Ye details aap khud update kar sakte hain. Save ke baad turant reflect hote hain.
          </Text>

          {formMessage ? (
            <View style={[
              styles.formMsg,
              formMessage.kind === 'ok' ? { backgroundColor: COLORS.success + '15', borderColor: COLORS.success + '33' }
                : { backgroundColor: COLORS.error + '12', borderColor: COLORS.error + '33' },
            ]}>
              <Text style={[styles.formMsgText, { color: formMessage.kind === 'ok' ? COLORS.success : COLORS.error }]}>
                {formMessage.kind === 'ok' ? '✅' : '⚠️'} {formMessage.text}
              </Text>
            </View>
          ) : null}

          {editing ? (
            <View style={styles.formList}>
              {EDITABLE.map((f) => (
                <View key={f.key} style={styles.formGroup}>
                  <Text style={[styles.formLabel, TYPOGRAPHY.caption]}>{f.label}</Text>
                  <TextInput
                    style={[styles.formInput, TYPOGRAPHY.body]}
                    value={form[f.key]}
                    onChangeText={(t) => setForm((p) => ({ ...p, [f.key]: t }))}
                    placeholder={f.placeholder}
                    placeholderTextColor={COLORS.textTertiary}
                    keyboardType={f.keyboard}
                    autoCapitalize="none"
                    autoCorrect={false}
                    editable={!saving}
                  />
                </View>
              ))}
              <View style={styles.formActions}>
                <Button title="Cancel" onPress={cancelEdit} variant="outline" size="small" disabled={saving} style={styles.formBtn} />
                <Button
                  title={saving ? 'Saving...' : 'Save Profile'}
                  onPress={saveEdit}
                  loading={saving}
                  disabled={saving}
                  size="small"
                  style={styles.formBtn}
                />
              </View>
              {saving ? (
                <View style={styles.savingRow}>
                  <ActivityIndicator size="small" color={COLORS.primary} />
                  <Text style={[styles.savingText, TYPOGRAPHY.caption]}>Saving your details...</Text>
                </View>
              ) : null}
            </View>
          ) : (
            <View style={styles.infoList}>
              {readOnlyRow('Mobile Number', profile.mobile)}
              {readOnlyRow('Personal Email', profile.email)}
              {readOnlyRow('Address', profile.address)}
              {readOnlyRow('PIN Code', profile.pincode)}
              {readOnlyRow('Emergency Contact Name', profile.emergencyName)}
              {readOnlyRow('Emergency Contact Number', profile.emergencyNumber)}
            </View>
          )}
        </View>

        {/* Security — 4-Digit PIN (existing functionality, unchanged) */}
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
      </ScrollView>
    </ScreenContainer>
  );
};

const styles = StyleSheet.create({
  scrollContent: { padding: SPACING.lg, paddingBottom: SPACING.xxl },
  loadingContainer: { paddingVertical: SPACING.xxl, alignItems: 'center', gap: SPACING.sm },
  loadingText: { color: COLORS.textSecondary, fontSize: 13 },

  profileHeader: { flexDirection: 'row', alignItems: 'center', marginBottom: SPACING.lg },
  avatarContainer: { marginRight: SPACING.lg },
  avatar: {
    width: 72, height: 72, borderRadius: 36, backgroundColor: COLORS.primary,
    alignItems: 'center', justifyContent: 'center',
  },
  avatarText: { color: COLORS.textOnPrimary, fontSize: 30, fontWeight: '700' },
  profileInfo: { flex: 1 },
  profileName: { color: COLORS.textPrimary },
  profileDesignation: { color: COLORS.textSecondary, marginTop: 2 },
  badgeRow: { flexDirection: 'row', gap: SPACING.sm, marginTop: SPACING.sm, flexWrap: 'wrap' },
  badge: { paddingHorizontal: 10, paddingVertical: 3, borderRadius: 12 },
  badgeText: { fontSize: 11, fontWeight: '600' },

  idCard: {
    backgroundColor: COLORS.primary, borderRadius: 16, padding: SPACING.lg, marginBottom: SPACING.lg,
    ...SHADOWS.md,
  },
  idCardHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  idCardLabel: { color: COLORS.textOnPrimary, opacity: 0.85 },
  idCardChip: { backgroundColor: 'rgba(255,255,255,0.22)', paddingHorizontal: 12, paddingVertical: 4, borderRadius: 10 },
  idCardCode: { color: COLORS.textOnPrimary, fontWeight: '800', fontSize: 14 },
  idCardFooter: { marginTop: SPACING.md, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  idCardBioLabel: { color: COLORS.textOnPrimary, opacity: 0.85 },
  idCardBioValue: { color: COLORS.textOnPrimary, fontWeight: '700' },

  section: { marginBottom: SPACING.lg },
  sectionTitleRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  sectionTitle: { color: COLORS.textPrimary, marginBottom: SPACING.xs },
  sectionHint: { color: COLORS.textTertiary, marginBottom: SPACING.sm },
  lockBadge: { paddingHorizontal: 9, paddingVertical: 3, borderRadius: 999 },
  lockBadgeText: { fontSize: 9.5, fontWeight: '800' },
  editBtn: { paddingHorizontal: 12, paddingVertical: 6, borderRadius: 999 },
  editBtnText: { fontSize: 11.5, fontWeight: '800' },

  infoList: { gap: SPACING.sm },
  infoRow: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: SPACING.md, paddingVertical: 10, borderRadius: 12, borderWidth: 1, gap: SPACING.md,
  },
  infoLabel: { color: COLORS.textSecondary },
  infoValue: { color: COLORS.textPrimary, fontWeight: '700', fontSize: 13, flex: 1, textAlign: 'right' },

  formList: { gap: SPACING.md },
  formGroup: { gap: 4 },
  formLabel: { color: COLORS.textSecondary },
  formInput: {
    borderWidth: 1, borderColor: COLORS.border, borderRadius: 10,
    paddingHorizontal: SPACING.md, paddingVertical: 9, color: COLORS.textPrimary, fontSize: 13,
    backgroundColor: COLORS.surface,
  },
  formActions: { flexDirection: 'row', gap: SPACING.md, marginTop: SPACING.xs },
  formBtn: { flex: 1 },
  savingRow: { flexDirection: 'row', alignItems: 'center', gap: SPACING.sm, justifyContent: 'center' },
  savingText: { color: COLORS.textSecondary },

  formMsg: { padding: SPACING.md, borderRadius: 10, borderWidth: 1, marginBottom: SPACING.md },
  formMsgText: { fontSize: 11.5, fontWeight: '600' },

  securityRow: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    padding: SPACING.md, borderRadius: 12, borderWidth: 1,
  },
  securityLeft: { flexDirection: 'row', alignItems: 'center', gap: SPACING.md },
  securityIcon: { fontSize: 20 },
  securityTitle: { color: COLORS.textPrimary, fontWeight: '700', fontSize: 13.5 },
  securitySubtitle: { color: COLORS.textTertiary },
  securityArrow: { fontSize: 22, color: COLORS.textTertiary },
});

export default EmployeeProfileScreen;