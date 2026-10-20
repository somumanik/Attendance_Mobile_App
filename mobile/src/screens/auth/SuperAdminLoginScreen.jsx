// ============================================================================
// FILE: mobile/src/screens/auth/SuperAdminLoginScreen.jsx
// PURPOSE: SuperAdmin (management role) login - separate from HR/Employee login
// ============================================================================

/**
 * Ye screen SuperAdmin ke liye hai - HR Admin aur Employee login se bilkul
 * ALAG authentication path.
 *
 * Navigation Flow:
 * RoleSelectionScreen → SuperAdminLoginScreen
 *   ↓ (Login successful)
 * RootNavigator → SuperAdminNavigator (management console)
 *
 * Data Flow:
 * Form Input → useAuth.loginSuperAdmin → authStore
 *   → POST /api/auth/superadmin/login → Backend JWT (role: SUPERADMIN)
 *   → GET /api/me (role verify) → Auth Store → SuperAdmin console
 *
 * IMPORTANT:
 * - Koi SQL credentials yahan NAHI hain
 * - JWT_SECRET mobile app mein NAHI hai
 * - SuperAdmin password/hash mobile app mein NAHI hai; woh server ki
 *   configuration mein hashed form mein rehta hai
 * - Sirf username/password collect hote hain aur seedha backend par jaate hain
 */

import React, { useState } from 'react';
import { View, Text, TouchableOpacity, StyleSheet, Keyboard, KeyboardAvoidingView, ScrollView, Platform } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useNavigation } from '@react-navigation/native';
import { useTheme } from '../../theme';
import { useAuth } from '../../hooks/useAuth';
import { Button, Input, Card, GradientIcon } from '../../components';
import { Ionicons } from '@expo/vector-icons';

/** Distinct accent so the SuperAdmin portal is instantly recognisable. */
const SUPERADMIN_ACCENT = '#4F46E5';

/**
 * SuperAdmin Login Screen Component
 */
export const SuperAdminLoginScreen = () => {
  // Required by the layout below (paddingTop/Bottom + back-button offset).
  // This hook call was missing while the `insets.*` usages were added, which
  // threw "ReferenceError: insets is not defined" on render and crashed the
  // app the moment this screen opened. Same pattern as all sibling screens.
  const insets = useSafeAreaInsets();
  const navigation = useNavigation();
  const { theme } = useTheme();
  const { loginSuperAdmin } = useAuth();
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState('');

  const handleLogin = async () => {
    if (!username.trim() || !password.trim()) {
      setError('Username aur password required hain');
      return;
    }

    setIsLoading(true);
    setError('');

    try {
      // Credentials sirf backend par verify hote hain (hashed, constant-time).
      // Auth state update hone par RootNavigator automatically management
      // console khol deta hai.
      await loginSuperAdmin(username.trim(), password);
    } catch (err) {
      setError(err.message || 'Login failed. Please try again.');
    } finally {
      setIsLoading(false);
    }
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
          <GradientIcon from={SUPERADMIN_ACCENT} to="#9333EA" name="settings" size={96} radius={28} glyphRatio={0.5} />
          <Text style={[styles.title, { color: theme.textPrimary }]}>SuperAdmin Login</Text>
          <Text style={[styles.subtitle, { color: theme.textSecondary }]}>Management console access only</Text>
        </View>

        {/* Form */}
        <Card style={styles.formCard}>
          <View style={styles.formContainer}>
            <Input
              label="Admin Username"
              placeholder="superadmin"
              value={username}
              onChangeText={setUsername}
              autoCapitalize="none"
              autoComplete="username"
              returnKeyType="next"
              autoFocus={true}
            />

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

            {error ? (
              <View style={[styles.errorContainer, { backgroundColor: theme.errorContainer, borderColor: `${theme.error}40` }]}>
                <Ionicons name="alert-circle" size={16} color={theme.error} style={styles.inlineIcon} />
                <Text style={[styles.errorText, { color: theme.error }]}>{error}</Text>
              </View>
            ) : null}

            <View style={[styles.notice, { backgroundColor: theme.infoContainer, borderColor: `${theme.info}30` }]}>
              <Ionicons name="lock-closed" size={14} color={theme.textSecondary} style={styles.inlineIcon} />
              <Text style={[styles.noticeText, { color: theme.textSecondary }]}>Server-side hashed credential — no password is stored in the app.</Text>
            </View>

            <Button
              title={isLoading ? 'Signing in...' : 'Sign In'}
              onPress={handleLogin}
              loading={isLoading}
              disabled={isLoading}
              fullWidth
              variant="primary"
              size="large"
            />
          </View>
        </Card>
      </ScrollView>
    </KeyboardAvoidingView>
  );
};

const styles = StyleSheet.create({
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
  inlineIcon: {
    marginTop: 1,
  },
  errorText: {
    fontSize: 12,
    fontWeight: '600',
    textAlign: 'center',
    flexShrink: 1,
  },
  notice: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    padding: 12,
    borderRadius: 12,
    borderWidth: 1,
  },
  noticeText: {
    fontSize: 12,
    textAlign: 'center',
    flexShrink: 1,
  },
});

export default SuperAdminLoginScreen;
