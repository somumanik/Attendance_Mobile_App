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
import { View, Text, TouchableOpacity, StyleSheet, Keyboard } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { useTheme } from '../../theme';
import { useAuth } from '../../hooks/useAuth';
import { Button, Input, Card } from '../../components';

/** Distinct accent so the SuperAdmin portal is instantly recognisable. */
const SUPERADMIN_ACCENT = '#4F46E5';

/**
 * SuperAdmin Login Screen Component
 */
export const SuperAdminLoginScreen = () => {
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
    <View style={[styles.container, { backgroundColor: theme.background }]}>
      <TouchableOpacity style={styles.backButton} onPress={handleBack} hitSlop={{ top: 20, left: 20, bottom: 20, right: 20 }}>
        <Text style={styles.backText}>←</Text>
      </TouchableOpacity>

      <View style={styles.contentContainer}>
        {/* Header */}
        <View style={styles.header}>
          <View style={[styles.logoCircle, { backgroundColor: SUPERADMIN_ACCENT }]}>
            <Text style={styles.logoIcon}>⚙️</Text>
          </View>
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

            <View style={styles.notice}>
              <Text style={styles.noticeText}>🔐 Server-side hashed credential — no password is stored in the app.</Text>
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
      </View>
    </View>
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
  notice: {
    padding: 12,
    backgroundColor: '#EEF2FF',
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#C7D2FE',
  },
  noticeText: {
    fontSize: 12,
    textAlign: 'center',
  },
});

export default SuperAdminLoginScreen;
