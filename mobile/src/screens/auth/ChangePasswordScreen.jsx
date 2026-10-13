// ============================================================================
// FILE: mobile/src/screens/auth/ChangePasswordScreen.jsx
// PURPOSE: Employee sets a NEW password - forced (Phase I) or voluntary
// ============================================================================

/**
 * Ye screen ek signed-in employee ka password badalta hai.
 *
 * Do situations mein same screen use hota hai:
 *   1. FORCED (Phase I section 2): HR ne temporary password set kiya
 *      (mustChangePassword = true) ya force-change lagaya hai. Tab employee
 *      Dashboard/Attendance/Profile tak pahunch nahi sakta jab tak ye complete
 *      nahi hota — backend bhi 403 PASSWORD_CHANGE_REQUIRED deta hai.
 *   2. VOLUNTARY: employee Profile se apna password khud change karta hai.
 *
 * Navigation Flow:
 * Employee Login (temporary password) ─┐
 * EmployeeNavigator gate ──────────────┼→ ChangePasswordScreen → Employee Portal
 * Profile → Change Password ───────────┘
 *
 * Data Flow:
 *   POST /api/employee/password/change { currentPassword, newPassword, confirmPassword }
 *     → backend employee identity JWT se leta hai (paycode body se nahi)
 *     → dbo.HR_EmployeeAuth: scrypt hash update + mustchangepassword = 0
 *     → { success, mustChangePassword: false }   (password/hash kabhi nahi)
 *
 * Security:
 * - Current password hamesha verify hota hai (temporary password bhi), isliye
 *   forced flow bhi safe hai: employee ko wahi password pata hona chahiye
 *   jo HR ne diya.
 * - Password sirf POST body mein jaata hai, kahin store ya log nahi hota.
 * - Forced mode mein EmployeeNavigator sirf ISI screen ko render karta hai, isliye
 *   Dashboard/Attendance/Profile UI par pahunch hi nahi sakte (aur backend bhi
 *   unhe 403 PASSWORD_CHANGE_REQUIRED se rokta hai).
 */

import React, { useState } from 'react';
import { View, Text, TouchableOpacity, StyleSheet, Keyboard } from 'react-native';
import { useNavigation, useRoute } from '@react-navigation/native';
import { useTheme } from '../../theme';
import { useAuth } from '../../hooks/useAuth';
import { changeMyPassword } from '../../services/auth';
import { Button, Input, Card } from '../../components';

/** Mirrors the server-side policy in employee-auth.js so the user sees it early. */
const PASSWORD_RULES = [
  'At least 8 characters',
  'At least one letter and one number',
];

export const ChangePasswordScreen = () => {
  const navigation = useNavigation();
  const route = useRoute();
  const { theme } = useTheme();
  const { mustChangePassword, clearMustChangePassword, userData } = useAuth();

  // route param se override kar sakte hain, warna live auth state se padhta hai.
  const isForced = route?.params?.mustChange === true || mustChangePassword === true;

  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState('');

  const validate = () => {
    if (!currentPassword.trim()) return 'Current password required hai.';
    if (!newPassword.trim()) return 'New password required hai.';
    if (newPassword !== confirmPassword) return 'New password aur confirmation match nahi kar rahe.';
    if (newPassword === currentPassword) return 'New password current password se alag hona chahiye.';
    // Server bhi yehi check karta hai; yahan pehle bata dena behtar UX hai.
    if (newPassword.length < 8) return 'Password kam se kam 8 characters ka ho.';
    if (!/[A-Za-z]/.test(newPassword) || !/[0-9]/.test(newPassword)) {
      return 'Password mein kam se kam ek letter aur ek number hona chahiye.';
    }
    return '';
  };

  const handleSubmit = async () => {
    const validationError = validate();
    if (validationError) {
      setError(validationError);
      return;
    }

    setIsLoading(true);
    setError('');

    try {
      await changeMyPassword({ currentPassword, newPassword, confirmPassword });

      // Forced flag clear karo, taaki app Portal khol sake.
      // Forced mode mein EmployeeNavigator apne aap tabs par wapas switch kar
      // deta hai, isliye koi manual navigation navigate() ki zarurat nahi.
      clearMustChangePassword();
      setCurrentPassword('');
      setNewPassword('');
      setConfirmPassword('');

      if (!isForced) {
        // Voluntary change: user jahan se aaya hai wapas bhej do.
        navigation.goBack();
      }
    } catch (err) {
      setError(err.message || 'Password change nahi ho paya. Dobara try karein.');
    } finally {
      setIsLoading(false);
      Keyboard.dismiss();
    }
  };

  // Forced mode mein employee ko is screen se nikal nahi sakte - wapas jaane
  // ka koi matlab nahi jab tak password set nahi hota (backend bhi block karega).
  const handleBack = () => {
    if (isForced) return;
    Keyboard.dismiss();
    navigation.goBack();
  };

  return (
    <View style={[styles.container, { backgroundColor: theme.background }]}>
      {!isForced ? (
        <TouchableOpacity
          style={styles.backButton}
          onPress={handleBack}
          hitSlop={{ top: 20, left: 20, bottom: 20, right: 20 }}
        >
          <Text style={styles.backText}>←</Text>
        </TouchableOpacity>
      ) : null}

      <View style={styles.contentContainer}>
        <View style={styles.header}>
          <View style={[styles.logoCircle, { backgroundColor: theme.secondary }]}>
            <Text style={styles.logoIcon}>🔐</Text>
          </View>
          <Text style={[styles.title, { color: theme.textPrimary }]}>Set New Password</Text>
          <Text style={[styles.subtitle, { color: theme.textSecondary }]}>
            {isForced
              ? 'Aapka password update karna zaroori hai, tabhi aap app use kar payenge'
              : 'Apna current password enter karke naya password set karein'}
          </Text>
        </View>

        {/* Forced mode mein employee ko exactly kya karna hai, ye saaf bataya jata hai. */}
        {isForced ? (
          <View style={styles.forcedNotice}>
            <Text style={styles.forcedTitle}>⚠️ Password change required</Text>
            <Text style={styles.forcedText}>
              {`HR ne aapke liye ek temporary password set kiya hai. ${userData?.paycode ? `Paycode ${String(userData.paycode).trim()}: ` : ''}`}
              {'Neeche "Current / Temporary Password" mein wahi password daalein, phir apna naya password set karein.'}
            </Text>
          </View>
        ) : null}

        <Card style={styles.formCard}>
          <View style={styles.formContainer}>
            <Input
              label={isForced ? 'Current / Temporary Password' : 'Current Password'}
              placeholder="••••••••"
              value={currentPassword}
              onChangeText={setCurrentPassword}
              secureTextEntry
              autoComplete="current-password"
            />

            <Input
              label="New Password"
              placeholder="••••••••"
              value={newPassword}
              onChangeText={setNewPassword}
              secureTextEntry
              autoComplete="new-password"
            />

            <Input
              label="Confirm New Password"
              placeholder="••••••••"
              value={confirmPassword}
              onChangeText={setConfirmPassword}
              secureTextEntry
              autoComplete="new-password"
              returnKeyType="go"
              onSubmitEditing={handleSubmit}
            />

            {/* Policy screen par hi dikhai jati hai, taaki user guess na kare. */}
            <View style={styles.rulesBox}>
              {PASSWORD_RULES.map((rule) => (
                <Text key={rule} style={[styles.ruleText, { color: theme.textSecondary }]}>
                  {`• ${rule}`}
                </Text>
              ))}
            </View>

            {error ? (
              <View style={styles.errorContainer}>
                <Text style={styles.errorText}>⚠️ {error}</Text>
              </View>
            ) : null}

            <Button
              title={isLoading ? 'Saving...' : 'Set New Password'}
              onPress={handleSubmit}
              loading={isLoading}
              disabled={isLoading}
              fullWidth
              size="large"
              color={theme.secondary}
            />

            {!isForced ? (
              <TouchableOpacity
                style={styles.cancelLink}
                onPress={handleBack}
                hitSlop={{ top: 10, left: 10, bottom: 10, right: 10 }}
              >
                <Text style={[styles.cancelText, { color: theme.textSecondary }]}>Cancel</Text>
              </TouchableOpacity>
            ) : null}
          </View>
        </Card>
      </View>
    </View>
  );
};

const styles = StyleSheet.create({
  container: { flex: 1 },
  backButton: { position: 'absolute', top: 8, left: 8, zIndex: 10, padding: 8 },
  backText: { fontSize: 28, fontWeight: '600' },
  contentContainer: {
    flex: 1,
    paddingHorizontal: 24,
    justifyContent: 'center',
    paddingVertical: 24,
  },
  header: { alignItems: 'center', marginBottom: 24 },
  logoCircle: {
    width: 72,
    height: 72,
    borderRadius: 36,
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 16,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.15,
    shadowRadius: 12,
    elevation: 4,
  },
  logoIcon: { fontSize: 32 },
  title: { fontSize: 21, fontWeight: '700', textAlign: 'center', marginBottom: 6 },
  subtitle: { fontSize: 13, textAlign: 'center', paddingHorizontal: 8 },
  forcedNotice: {
    padding: 12,
    backgroundColor: '#FEF3C7',
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#FDE68A',
    marginBottom: 16,
  },
  forcedTitle: { fontSize: 12.5, fontWeight: '700', color: '#92400E', marginBottom: 4 },
  forcedText: { fontSize: 12, color: '#78350F', lineHeight: 17 },
  formCard: { padding: 0 },
  formContainer: { gap: 16 },
  rulesBox: { gap: 3, paddingHorizontal: 2 },
  ruleText: { fontSize: 11.5 },
  errorContainer: {
    padding: 12,
    backgroundColor: '#FEE2E2',
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#FECACA',
  },
  errorText: { fontSize: 12, fontWeight: '500', textAlign: 'center' },
  cancelLink: { alignItems: 'center', paddingVertical: 4 },
  cancelText: { fontSize: 13, fontWeight: '600' },
});

export default ChangePasswordScreen;
