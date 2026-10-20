// ============================================================================
// FILE: mobile/src/screens/auth/EmployeeLoginScreen.jsx
// PURPOSE: Employee login - password (primary) or 4-digit PIN (Phase I)
// ============================================================================

/**
 * Ye screen Employee login ke liye hai.
 *
 * Backend API: POST /api/auth/employee/login
 *
 * Do credentials supported hain (Phase I section 5):
 *   - PASSWORD : primary credential, hamesha available
 *   - PIN      : 4-digit, alternative; password login iska fallback bana rehta hai
 *
 * Employee Login ID = PAYCODE (real dbo.tblemployee.paycode).
 *
 * Navigation Flow:
 * RoleSelectionScreen → EmployeeLoginScreen
 *   ↓ (login OK)
 * RootNavigator → EmployeeNavigator
 *   ├── mustChangePassword = true → ChangePasswordScreen (Phase I gate)
 *   └── normal                  → Employee tabs (Dashboard)
 *
 * Data Flow:
 * Form Input → Auth Store (loginEmployee) → auth service → API client → Backend
 * Backend → JWT → GET /api/me (role + live mustChangePassword) → Auth Store
 *
 * IMPORTANT:
 * - Koi SQL credentials yahan NAHI hain
 * - JWT_SECRET mobile app mein NAHI hai
 * - Password/PIN sirf POST body mein jaate hain, kabhi store ya log nahi hote
 */

import React, { useState } from 'react';
import { View, Text, TouchableOpacity, StyleSheet, Keyboard, KeyboardAvoidingView, ScrollView, Platform } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useNavigation } from '@react-navigation/native';
import { useTheme } from '../../theme';
import { useAuth } from '../../hooks/useAuth';
import { Button, Input, Card, GradientIcon } from '../../components';
import { Ionicons } from '@expo/vector-icons';

/**
 * Employee Login Screen Component
 */
export const EmployeeLoginScreen = () => {
  const insets = useSafeAreaInsets();
  const navigation = useNavigation();
  const { theme } = useTheme();
  const { loginEmployee } = useAuth();
  const [paycode, setPaycode] = useState('');
  const [password, setPassword] = useState('');
  const [pin, setPin] = useState('');
  // Password primary hai; PIN optional shortcut. dono available rehte hain.
  const [usePin, setUsePin] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState('');
  // Backend batata hai ki employee ka password pehli baar banana hai ya nahi.
  const [needsFirstTimeSetup, setNeedsFirstTimeSetup] = useState(false);

  const handleLogin = async () => {
    if (!paycode.trim()) {
      setError('Paycode required hai');
      return;
    }
    if (usePin) {
      // Server par bhi exactly 4 digits ka rule hai; yahan pehle bata dete hain.
      if (!/^\d{4}$/.test(pin.trim())) {
        setError('PIN exactly 4 digits ka hona chahiye');
        return;
      }
    } else if (!password.trim()) {
      setError('Paycode aur password required hain');
      return;
    }

    setIsLoading(true);
    setError('');

    try {
      // Employee credentials existing backend API par jaate hain.
      // Backend JWT return karega, phir /api/me se EMPLOYEE role verify hoga.
      // Auth state update hone par RootNavigator Employee portal kholta hai.
      // mustChangePassword = true ho to EmployeeNavigator sirf
      // "Set New Password" screen dikhayega, Dashboard nahi.
      await loginEmployee(paycode.trim(), password, usePin ? pin.trim() : '');
    } catch (err) {
      // Backend ne bataya ki is employee ka password abhi set nahi hai.
      // Tab user ko first-time password setup screen par bhejte hain.
      if (err?.firstTimeSetupRequired) {
        setNeedsFirstTimeSetup(true);
        setError('Aapka password pehli baar set karna hai. Neeche button dabayein.');
      } else {
        setError(err.message || 'Login failed. Please try again.');
      }
    } finally {
      setIsLoading(false);
    }
  };

  const handleOpenFirstTimeSetup = () => {
    navigation.navigate('FirstTimeSetup', { paycode: paycode.trim() });
  };

  // Forgot Password link — sirf Paycode se request, password yahan set nahi hota.
  const handleOpenForgotPassword = () => {
    navigation.navigate('ForgotPassword');
  };

  const handleBack = () => {
    navigation.goBack();
    Keyboard.dismiss();
  };

  return (
    <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={[styles.container, { backgroundColor: theme.background, paddingTop: insets.top, paddingBottom: insets.bottom }]}>
      <TouchableOpacity style={[styles.backButton, { top: insets.top + 8 }]} onPress={handleBack} hitSlop={{ top: 20, left: 20, bottom: 20, right: 20 }}>
        <Ionicons name="arrow-back" size={24} color={theme.textPrimary} />
      </TouchableOpacity>

      <ScrollView contentContainerStyle={styles.contentContainer} keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}>
        {/* Header */}
        <View style={styles.header}>
          <GradientIcon from="#0D9488" to="#0891B2" name="person" size={96} radius={28} glyphRatio={0.5} />
          <Text style={[styles.title, { color: theme.textPrimary }]}>Employee Login</Text>
          <Text style={[styles.subtitle, { color: theme.textSecondary }]}>Enter your paycode and password</Text>
        </View>

        {/* Form */}
        <Card style={styles.formCard}>
          <View style={styles.formContainer}>
            <Input
              label="Paycode"
              placeholder="EMP001"
              value={paycode}
              onChangeText={setPaycode}
              autoCapitalize="characters"
              autoComplete="username"
              returnKeyType="next"
              autoFocus={true}
            />

            {/* Password ya PIN - dono supported, dono available (Phase I section 5) */}
            {usePin ? (
              <Input
                label="4-Digit PIN"
                placeholder="••••"
                value={pin}
                onChangeText={(v) => setPin(v.replace(/\D/g, '').slice(0, 4))}
                type="password"
                keyboardType="number-pad"
                maxLength={4}
                autoComplete="off"
                returnKeyType="go"
                onSubmitEditing={handleLogin}
              />
            ) : (
              <Input
                label="Password"
                placeholder="••••••••"
                value={password}
                onChangeText={setPassword}
                type="password"
                autoComplete="password"
                returnKeyType="go"
                onSubmitEditing={handleLogin}
              />
            )}

            {/* Password / PIN switch. Password hamesha fallback ban kar available hai. */}
            <TouchableOpacity
              style={styles.switchLink}
              onPress={() => { setUsePin((v) => !v); setError(''); }}
              hitSlop={{ top: 10, left: 10, bottom: 10, right: 10 }}
            >
              <Ionicons
                name={usePin ? 'key' : 'keypad'}
                size={15}
                color={theme.primary}
                style={styles.inlineIcon}
              />
              <Text style={[styles.switchText, { color: theme.primary }]}>
                {usePin ? 'Login with Password instead' : 'Login with 4-digit PIN'}
              </Text>
            </TouchableOpacity>

            {error ? (
              <View style={[styles.errorContainer, { backgroundColor: theme.errorContainer, borderColor: `${theme.error}40` }]}>
                <Ionicons name="alert-circle" size={16} color={theme.error} style={styles.inlineIcon} />
                <Text style={[styles.errorText, { color: theme.error }]}>{error}</Text>
              </View>
            ) : null}

            {/* Phase 2 Notice */}
            <View style={[styles.phaseNotice, { backgroundColor: theme.infoContainer, borderColor: `${theme.info}30` }]}>
              <Ionicons name="lock-closed" size={14} color={theme.textSecondary} style={styles.inlineIcon} />
              <Text style={[styles.phaseNoticeText, { color: theme.textSecondary }]}>Secure session: existing backend JWT authentication.</Text>
            </View>

            {/* Login Button */}
            <Button
              title={isLoading ? 'Signing in...' : 'Sign In'}
              onPress={handleLogin}
              loading={isLoading}
              disabled={isLoading}
              fullWidth
              size="large"
              color={theme.secondary}
            />

            {/* First-time password setup - sirf tab dikhta hai jab backend bataye
                ki is employee ka password pehle se set nahi hai. */}
            {needsFirstTimeSetup ? (
              <Button
                title="Create your password"
                onPress={handleOpenFirstTimeSetup}
                fullWidth
                variant="outline"
                size="medium"
              />
            ) : null}

            {/* Forgot Password */}
            <TouchableOpacity
              style={styles.forgotLink}
              onPress={handleOpenForgotPassword}
              hitSlop={{ top: 10, left: 10, bottom: 10, right: 10 }}
            >
              <Text style={[styles.forgotText, { color: theme.primary }]}>Forgot Password?</Text>
            </TouchableOpacity>
          </View>
        </Card>
      </ScrollView>
    </KeyboardAvoidingView>
  );
};

const styles = StyleSheet.create({
  forgotLink: { alignItems: 'center', paddingVertical: 4 },
  forgotText: { fontSize: 13, fontWeight: '600' },
  switchLink: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, paddingVertical: 4 },
  switchText: { fontSize: 12.5, fontWeight: '600' },
  inlineIcon: { marginTop: 1 },
  container: {
    flex: 1,
  },
  backButton: {
    position: 'absolute',
    top: 8,
    left: 8,
    zIndex: 10,
    padding: 8,
  },
  contentContainer: {
    flexGrow: 1,
    paddingHorizontal: 24,
    justifyContent: 'center',
    paddingVertical: 24,
  },
  header: {
    alignItems: 'center',
    marginBottom: 32,
    gap: 4,
  },
  title: {
    fontSize: 22,
    fontWeight: '800',
    letterSpacing: -0.4,
    textAlign: 'center',
    marginTop: 16,
    marginBottom: 6,
  },
  subtitle: {
    fontSize: 13,
    textAlign: 'center',
  },
  formCard: {
    padding: 0,
  },
  formContainer: {
    gap: 16,
  },
  errorContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    padding: 12,
    borderRadius: 12,
    borderWidth: 1,
  },
  errorText: {
    fontSize: 12,
    fontWeight: '600',
    textAlign: 'center',
    flexShrink: 1,
  },
  phaseNotice: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    padding: 12,
    borderRadius: 12,
    borderWidth: 1,
  },
  phaseNoticeText: {
    fontSize: 12,
    textAlign: 'center',
    flexShrink: 1,
  },
});