// ============================================================================
// FILE: mobile/src/screens/auth/ResetPasswordScreen.jsx
// PURPOSE: Employee password reset using emailed one-time code (Phase 3A.9)
// ============================================================================

/**
 * Ye screen email se mila one-time reset code use karke naya password set karta hai.
 *
 * Navigation Flow:
 * Employee Login → "Forgot Password?" → ForgotPasswordScreen
 *   ↓
// "Open Reset Password" ya direct link
//   ↓
// ResetPasswordScreen (Reset Code + New Password + Confirm Password)
 *   ↓ (success)
// Employee Login → naye password se login
 *
 * Data Flow:
 * ResetPasswordScreen
 *   ↓
// auth service → POST /api/auth/employee/reset-password
//   ↓
// Node/Express → token validate (single-use + expiry)
//   ↓
// dbo.HR_EmployeeAuth (scrypt hash store — password columns only)
//
// Security:
// - Sirf token se reset hota hai; paycode yahan accept nahi hota.
// - Token ek hi baar use ho sakta hai aur 15 minute me expire hota hai.
// - Password kabhi store, log ya response mein nahi jaata.
// - Ye screen PIN ko touch nahi karti.
 */

import React, { useState } from 'react';
import { View, Text, TouchableOpacity, StyleSheet, Alert, Keyboard } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { useTheme } from '../../theme';
import { resetPassword } from '../../services/auth';
import { Button, Input, Card } from '../../components';

export const ResetPasswordScreen = () => {
  const navigation = useNavigation();
  const { theme } = useTheme();

  const [token, setToken] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState('');

  const validate = () => {
    if (!token.trim()) return 'Reset code required hai.';
    if (!password.trim()) return 'Password required hai.';
    if (password !== confirmPassword) return 'Password aur confirmation match nahi kar rahe.';
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
      // Sirf token authorize karta hai — paycode yahan nahi bheja jaata.
      await resetPassword({ token: token.trim(), password, confirmPassword });
      setToken('');
      setPassword('');
      setConfirmPassword('');
      Alert.alert('Password updated', 'Ab naye password se login karein.', [
        { text: 'Go to Login', onPress: () => navigation.navigate('EmployeeLogin') },
      ]);
    } catch (err) {
      setError(err.message || 'Password reset failed. Please try again.');
    } finally {
      setIsLoading(false);
      Keyboard.dismiss();
    }
  };

  return (
    <View style={[styles.container, { backgroundColor: theme.background }]}>
      <TouchableOpacity
        style={styles.backButton}
        onPress={() => navigation.goBack()}
        hitSlop={{ top: 20, left: 20, bottom: 20, right: 20 }}
      >
        <Text style={styles.backText}>←</Text>
      </TouchableOpacity>

      <View style={styles.content}>
        <View style={styles.header}>
          <View style={[styles.logoCircle, { backgroundColor: theme.success }]}>
            <Text style={styles.logoIcon}>🔒</Text>
          </View>
          <Text style={[styles.title, { color: theme.textPrimary }]}>Reset Password</Text>
          <Text style={[styles.subtitle, { color: theme.textSecondary }]}>
            Email se mila reset code enter karein
          </Text>
        </View>

        <Card>
          <View style={styles.form}>
            <Input
              label="Reset Code"
              placeholder="Email se mila code"
              value={token}
              onChangeText={setToken}
              autoCapitalize="none"
              autoCorrect={false}
            />

            <Input
              label="New Password"
              placeholder="••••••••"
              value={password}
              onChangeText={setPassword}
              type="password"
              autoComplete="new-password"
            />

            <Input
              label="Confirm New Password"
              placeholder="••••••••"
              value={confirmPassword}
              onChangeText={setConfirmPassword}
              type="password"
              autoComplete="new-password"
              returnKeyType="go"
              onSubmitEditing={handleSubmit}
            />

            <View style={[styles.noteBox, { backgroundColor: `${theme.info}15`, borderColor: `${theme.info}30` }]}>
              <Text style={[styles.noteText, { color: theme.info }]}>
                Password minimum 8 characters aur letters + numbers dono hone chahiye. Code ek hi baar use hota hai.
              </Text>
            </View>

            {error ? (
              <View style={[styles.errorBox, { backgroundColor: `${theme.error}15`, borderColor: `${theme.error}30` }]}>
                <Text style={[styles.errorText, { color: theme.error }]}>⚠️ {error}</Text>
              </View>
            ) : null}

            <Button
              title={isLoading ? 'Updating password...' : 'Reset Password'}
              onPress={handleSubmit}
              loading={isLoading}
              disabled={isLoading}
              fullWidth
              size="large"
            />
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
  content: { flex: 1, paddingHorizontal: 24, paddingVertical: 24, justifyContent: 'center' },
  header: { alignItems: 'center', marginBottom: 28 },
  logoCircle: {
    width: 72,
    height: 72,
    borderRadius: 36,
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 16,
  },
  logoIcon: { fontSize: 32 },
  title: { fontSize: 20, fontWeight: '700', textAlign: 'center', marginBottom: 6 },
  subtitle: { fontSize: 13, textAlign: 'center' },
  form: { gap: 16 },
  noteBox: { padding: 12, borderRadius: 8, borderWidth: 1 },
  noteText: { fontSize: 12, textAlign: 'center' },
  errorBox: { padding: 12, borderRadius: 8, borderWidth: 1 },
  errorText: { fontSize: 12, fontWeight: '500', textAlign: 'center' },
});

export default ResetPasswordScreen;
