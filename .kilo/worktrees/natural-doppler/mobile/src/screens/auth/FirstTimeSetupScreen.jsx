// ============================================================================
// FILE: mobile/src/screens/auth/FirstTimeSetupScreen.jsx
// PURPOSE: Employee first-time password creation (Phase 3A.7)
// ============================================================================

/**
 * Ye screen employee ke liye FIRST-TIME password banane ke liye hai.
 * Jab employee pehli baar login karta hai aur uska password set nahi hota,
 * tab Employee Login screen user ko yahan bhejta hai.
//
// Navigation Flow:
// Role Selection → Employee Login (password set nahi hai)
//   ↓
// FirstTimeSetupScreen
//   ↓ (password create hota hai)
// Employee Login (normal login) → Employee Portal
//
// Data Flow:
// FirstTimeSetupScreen
//   ↓
// auth service → POST /api/auth/employee/first-time-setup
//   ↓
// Node/Express → dbo.tblemployee (identity check)
//   ↓
// dbo.HR_EmployeeAuth (scrypt hash store — app-owned table)
//   ↓
// JSON response (sirf success/failure, password kabhi nahi)
//
// Security:
// - Password aur confirmation sirf POST body mein jaate hain, kahin store nahi hote.
// - Response ya logs mein password/hash kabhi nahi aata.
// - Ye flow existing password ko kabhi overwrite nahi karta.
//
// NOTE: Ye Phase 3A.7 ka first-time setup hai.
//       PIN (3A.8), Forgot Password (3A.9) aur HR reset (3A.10) is screen par nahi hain.
 */

import React, { useState } from 'react';
import { View, Text, TouchableOpacity, StyleSheet, Alert, Keyboard } from 'react-native';
import { useNavigation, useRoute } from '@react-navigation/native';
import { useTheme } from '../../theme';
import { completeFirstTimeSetup } from '../../services/auth';
import { Button, Input, Card } from '../../components';

export const FirstTimeSetupScreen = () => {
  const navigation = useNavigation();
  const route = useRoute();
  const { theme } = useTheme();

  // Employee Login screen paycode bhejta hai; manually aane par bhi editable hai.
  const [paycode, setPaycode] = useState(String(route?.params?.paycode || ''));
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState('');

  const validate = () => {
    if (!paycode.trim()) return 'Paycode required hai.';
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
      // Password backend ko bheja jata hai; backend use hash karke store karta hai.
      // Backend koi token nahi deta — user ko normal login karna hota hai.
      await completeFirstTimeSetup({
        paycode: paycode.trim(),
        password,
        confirmPassword,
      });

      Alert.alert(
        'Password created',
        'Aapka password set ho gaya hai. Ab normal login karein.',
        [{ text: 'Go to Login', onPress: () => navigation.goBack() }]
      );
      setPassword('');
      setConfirmPassword('');
    } catch (err) {
      setError(err.message || 'Password setup failed. Please try again.');
    } finally {
      setIsLoading(false);
      Keyboard.dismiss();
    }
  };

  const handleBack = () => {
    Keyboard.dismiss();
    navigation.goBack();
  };

  return (
    <View style={[styles.container, { backgroundColor: theme.background }]}>
      <TouchableOpacity
        style={styles.backButton}
        onPress={handleBack}
        hitSlop={{ top: 20, left: 20, bottom: 20, right: 20 }}
      >
        <Text style={styles.backText}>←</Text>
      </TouchableOpacity>

      <View style={styles.contentContainer}>
        <View style={styles.header}>
          <View style={[styles.logoCircle, { backgroundColor: theme.secondary }]}>
            <Text style={styles.logoIcon}>🔑</Text>
          </View>
          <Text style={[styles.title, { color: theme.textPrimary }]}>Create Your Password</Text>
          <Text style={[styles.subtitle, { color: theme.textSecondary }]}>
            First time login par apna password set karein
          </Text>
        </View>

        <Card>
          <View style={styles.formContainer}>
            <Input
              label="Paycode"
              placeholder="EMP001"
              value={paycode}
              onChangeText={setPaycode}
              autoCapitalize="characters"
              autoComplete="username"
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
              label="Confirm Password"
              placeholder="••••••••"
              value={confirmPassword}
              onChangeText={setConfirmPassword}
              type="password"
              autoComplete="new-password"
              returnKeyType="go"
              onSubmitEditing={handleSubmit}
            />

            <View style={[styles.policyBox, { backgroundColor: `${theme.info}15`, borderColor: `${theme.info}30` }]}>
              <Text style={[styles.policyText, { color: theme.info }]}>
                Password minimum 8 characters ka hona chahiye aur usme letters + numbers dono hone chahiye.
              </Text>
            </View>

            {error ? (
              <View style={[styles.errorContainer, { backgroundColor: `${theme.error}15`, borderColor: `${theme.error}30` }]}>
                <Text style={[styles.errorText, { color: theme.error }]}>⚠️ {error}</Text>
              </View>
            ) : null}

            <Button
              title={isLoading ? 'Creating password...' : 'Create Password'}
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
  contentContainer: { flex: 1, paddingHorizontal: 24, justifyContent: 'center', paddingVertical: 24 },
  header: { alignItems: 'center', marginBottom: 32 },
  logoCircle: {
    width: 80,
    height: 80,
    borderRadius: 40,
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 20,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.15,
    shadowRadius: 12,
    elevation: 4,
  },
  logoIcon: { fontSize: 36 },
  title: { fontSize: 22, fontWeight: '700', textAlign: 'center', marginBottom: 6 },
  subtitle: { fontSize: 13, textAlign: 'center' },
  formContainer: { gap: 16 },
  policyBox: { padding: 12, borderRadius: 8, borderWidth: 1 },
  policyText: { fontSize: 12, textAlign: 'center' },
  errorContainer: { padding: 12, borderRadius: 8, borderWidth: 1 },
  errorText: { fontSize: 12, fontWeight: '500', textAlign: 'center' },
});

export default FirstTimeSetupScreen;
