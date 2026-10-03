// ============================================================================
// FILE: mobile/src/screens/auth/EmployeeLoginScreen.jsx
// PURPOSE: Employee login screen - placeholder for Phase 2
// ============================================================================

/**
 * Ye screen Employee login ke liye hai.
 * 
 * Phase 1: Placeholder UI only - actual login Phase 2 mein implement hoga.
 * Backend API: POST /api/auth/employee/login (already exists)
 * 
 * AUDIT FINDING: Employee password verification production-secure NAHI hai.
 * Phase 2 mein fix hoga - separate authentication phase.
 * 
 * Navigation Flow:
 * RoleSelectionScreen → EmployeeLoginScreen
 *   ↓ (Login successful - Phase 2)
 * RootNavigator → EmployeeNavigator
 * 
 * Data Flow (Phase 2):
 * Form Input (paycode + password) → Auth Service (loginEmployee) → API Service → Backend
 * Backend → JWT Token → Storage → Auth Store (setAuth) → Navigation
 * 
 * IMPORTANT:
 * - Koi SQL credentials yahan NAHI hain
 * - JWT_SECRET mobile app mein NAHI hai
 * - Sirf paycode/password collect karta hai
 */

import React, { useState } from 'react';
import { View, Text, TouchableOpacity, StyleSheet, Keyboard } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { useTheme } from '../../theme';
import { useAuth } from '../../hooks/useAuth';
import { Button, Input, Card } from '../../components';

/**
 * Employee Login Screen Component
 */
export const EmployeeLoginScreen = () => {
  const navigation = useNavigation();
  const { theme } = useTheme();
  const { loginEmployee } = useAuth();
  const [paycode, setPaycode] = useState('');
  const [password, setPassword] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState('');
  // Backend batata hai ki employee ka password pehli baar banana hai ya nahi.
  const [needsFirstTimeSetup, setNeedsFirstTimeSetup] = useState(false);

  const handleLogin = async () => {
    if (!paycode.trim() || !password.trim()) {
      setError('Paycode aur password required hain');
      return;
    }

    setIsLoading(true);
    setError('');

    try {
      // Employee credentials existing backend API par jaate hain.
      // Backend JWT return karega, phir /api/me se EMPLOYEE role verify hoga.
      // Auth state update hone par RootNavigator Employee portal kholta hai.
      await loginEmployee(paycode.trim(), password);
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
    <View style={[styles.container, { backgroundColor: theme.background }]}>
      <TouchableOpacity style={styles.backButton} onPress={handleBack} hitSlop={{ top: 20, left: 20, bottom: 20, right: 20 }}>
        <Text style={styles.backText}>←</Text>
      </TouchableOpacity>

      <View style={styles.contentContainer}>
        {/* Header */}
        <View style={styles.header}>
          <View style={[styles.logoCircle, { backgroundColor: theme.secondary }]}>
            <Text style={styles.logoIcon}>👤</Text>
          </View>
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

            <Input
              label="Password"
              placeholder="••••••••"
              value={password}
              onChangeText={setPassword}
              secureTextEntry={true}
              autoComplete="password"
              returnKeyType="go"
              onSubmitEditing={handleLogin}
            />

            {error ? (
              <View style={styles.errorContainer}>
                <Text style={styles.errorText}>⚠️ {error}</Text>
              </View>
            ) : null}

            {/* Audit Notice */}
            <View style={styles.auditNotice}>
              <Text style={styles.auditNoticeText}>⚠️ Employee password verification backend hardening abhi separate task hai.</Text>
            </View>

            {/* Phase 2 Notice */}
            <View style={styles.phaseNotice}>
              <Text style={styles.phaseNoticeText}>🔐 Secure session: existing backend JWT authentication.</Text>
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
      </View>
    </View>
  );
};

const styles = StyleSheet.create({
  forgotLink: { alignItems: 'center', paddingVertical: 4 },
  forgotText: { fontSize: 13, fontWeight: '600' },
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
  backText: {
    fontSize: 28,
    fontWeight: '600',
  },
  contentContainer: {
    flex: 1,
    paddingHorizontal: 24,
    justifyContent: 'center',
    paddingVertical: 24,
  },
  header: {
    alignItems: 'center',
    marginBottom: 32,
  },
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
  logoIcon: {
    fontSize: 36,
  },
  title: {
    fontSize: 22,
    fontWeight: '700',
    textAlign: 'center',
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
    padding: 12,
    backgroundColor: '#FEE2E2',
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#FECACA',
  },
  errorText: {
    fontSize: 12,
    fontWeight: '500',
    textAlign: 'center',
  },
  auditNotice: {
    padding: 12,
    backgroundColor: '#FEF3C7',
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#FDE68A',
  },
  auditNoticeText: {
    fontSize: 12,
    textAlign: 'center',
  },
  phaseNotice: {
    padding: 12,
    backgroundColor: '#E0F2FE',
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#BAE6FD',
  },
  phaseNoticeText: {
    fontSize: 12,
    textAlign: 'center',
  },
});