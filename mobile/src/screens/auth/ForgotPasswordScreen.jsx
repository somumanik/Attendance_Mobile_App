// ============================================================================
// FILE: mobile/src/screens/auth/ForgotPasswordScreen.jsx
// PURPOSE: Employee forgot-password request (Phase 3A.9)
// ============================================================================

/**
 * Ye screen employee se Paycode lekar reset instructions email karwata hai.
 *
 * Navigation Flow:
 * Employee Login → "Forgot Password?"
 *   ↓
 * ForgotPasswordScreen → Paycode submit
 *   ↓
 * Backend → email se one-time reset code bhejta hai
 *   ↓
 * Employee manually ResetPasswordScreen par code enter karta hai
 *
 * Data Flow:
 * ForgotPasswordScreen
 *   ↓
// auth service → POST /api/auth/employee/forgot-password
//   ↓
// Node/Express → dbo.tblemployee (identity + registered email check)
//   ↓
// dbo.HR_EmployeePasswordReset (token ka SHA-256 hash store)
//   ↓
// Existing email infra (sendEmailNow) se reset code email
//
// Security:
// - Backend generic message deta hai — pata nahi chalta paycode exist karta hai ya nahi.
// - Screen par koi token/email dikhaya nahi jata.
// - Yahan password set nahi hota — sirf request bheji jaati hai.
 */

import React, { useState } from 'react';
import { Ionicons } from '@expo/vector-icons';
import { View, Text, TouchableOpacity, StyleSheet, Keyboard, KeyboardAvoidingView, ScrollView, Platform } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useNavigation } from '@react-navigation/native';
import { useTheme } from '../../theme';
import { requestPasswordReset } from '../../services/auth';
import { Button, Input, Card } from '../../components';

export const ForgotPasswordScreen = () => {
  const insets = useSafeAreaInsets();
  const navigation = useNavigation();
  const { theme } = useTheme();

  const [paycode, setPaycode] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState('');
  const [sent, setSent] = useState(false);

  const handleSubmit = async () => {
    if (!paycode.trim()) {
      setError('Paycode required hai.');
      return;
    }

    setIsLoading(true);
    setError('');

    try {
      // Backend generic response deta hai — hum bhi wahi message show karte hain.
      await requestPasswordReset(paycode.trim());
      setSent(true);
    } catch (err) {
      setError(err.message || 'Request bhejne mein problem hui. Please try again.');
    } finally {
      setIsLoading(false);
      Keyboard.dismiss();
    }
  };

  return (
    <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={[styles.container, { backgroundColor: theme.background, paddingTop: insets.top, paddingBottom: insets.bottom }]}>
      <TouchableOpacity
        style={[styles.backButton, { top: insets.top + 8 }]}
        onPress={() => navigation.goBack()}
        hitSlop={{ top: 20, left: 20, bottom: 20, right: 20 }}
      >
        <Ionicons name="arrow-back" size={24} color={theme.textPrimary} />
      </TouchableOpacity>

      <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}>
        <View style={styles.header}>
          <View style={[styles.logoCircle, { backgroundColor: theme.warning }]}>
            <Ionicons name="key" size={32} color="#FFFFFF" />
          </View>
          <Text style={[styles.title, { color: theme.textPrimary }]}>Forgot Password</Text>
          <Text style={[styles.subtitle, { color: theme.textSecondary }]}>
            Apna Paycode enter karein — reset code email par aayega
          </Text>
        </View>

        <Card>
          {sent ? (
            <View style={styles.sentBox}>
              <Ionicons name="mail" size={40} color={theme.success} />
              <Text style={[styles.sentText, { color: theme.textPrimary }]}>
                If the account is eligible for password recovery, reset instructions have been sent.
              </Text>
              <Text style={[styles.sentHint, { color: theme.textSecondary }]}>
                Apne registered email par reset code check karein, phir Reset Password screen par code enter karein.
              </Text>
              <Button
                title="Open Reset Password"
                onPress={() => navigation.navigate('ResetPassword')}
                fullWidth
                size="medium"
              />
              <Button
                title="Back to Login"
                onPress={() => navigation.goBack()}
                variant="ghost"
                fullWidth
                size="small"
              />
            </View>
          ) : (
            <View style={styles.form}>
              <Input
                label="Paycode"
                placeholder="EMP001"
                value={paycode}
                onChangeText={setPaycode}
                autoCapitalize="characters"
                autoComplete="username"
                returnKeyType="go"
                onSubmitEditing={handleSubmit}
              />

              <View style={[styles.infoBox, { backgroundColor: `${theme.info}15`, borderColor: `${theme.info}30` }]}>
                <Text style={[styles.infoText, { color: theme.info }]}>
                  Reset code aapke registered email par bheja jayega. Code ek hi baar use hoga aur 15 minute me expire ho jayega.
                </Text>
              </View>

              {error ? (
                <View style={[styles.errorBox, { backgroundColor: `${theme.error}15`, borderColor: `${theme.error}30` }]}>
                  <Text style={[styles.errorText, { color: theme.error }]}><Ionicons name="alert-circle" size={13} /> {error}</Text>
                </View>
              ) : null}

              <Button
                title={isLoading ? 'Sending...' : 'Send Reset Instructions'}
                onPress={handleSubmit}
                loading={isLoading}
                disabled={isLoading}
                fullWidth
                size="large"
              />
            </View>
          )}
        </Card>
      </ScrollView>
    </KeyboardAvoidingView>
  );
};

const styles = StyleSheet.create({
  container: { flex: 1 },
  backButton: { position: 'absolute', top: 8, left: 8, zIndex: 10, padding: 8 },
  content: { flexGrow: 1, paddingHorizontal: 24, paddingVertical: 24, justifyContent: 'center' },
  header: { alignItems: 'center', marginBottom: 28 },
  logoCircle: {
    width: 72,
    height: 72,
    borderRadius: 36,
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 16,
  },
  title: { fontSize: 20, fontWeight: '700', textAlign: 'center', marginBottom: 6 },
  subtitle: { fontSize: 13, textAlign: 'center' },
  form: { gap: 16 },
  infoBox: { padding: 12, borderRadius: 8, borderWidth: 1 },
  infoText: { fontSize: 12, textAlign: 'center' },
  errorBox: { padding: 12, borderRadius: 8, borderWidth: 1 },
  errorText: { fontSize: 12, fontWeight: '500', textAlign: 'center' },
  sentBox: { gap: 14, alignItems: 'stretch' },
  sentText: { fontSize: 14, fontWeight: '600', textAlign: 'center' },
  sentHint: { fontSize: 12, textAlign: 'center' },
});

export default ForgotPasswordScreen;
