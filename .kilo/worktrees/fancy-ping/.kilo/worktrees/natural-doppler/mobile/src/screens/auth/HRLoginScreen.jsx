// ============================================================================
// FILE: mobile/src/screens/auth/HRLoginScreen.jsx
// PURPOSE: HR Admin login screen - placeholder for Phase 2
// ============================================================================

/**
 * Ye screen HR Admin login ke liye hai.
 * 
 * Phase 1: Placeholder UI only - actual login Phase 2 mein implement hoga.
 * Backend API: POST /api/auth/hr/login (already exists)
 * 
 * Navigation Flow:
 * RoleSelectionScreen → HRLoginScreen
 *   ↓ (Login successful - Phase 2)
 * RootNavigator → HRNavigator
 * 
 * Data Flow (Phase 2):
 * Form Input → Auth Service (loginHR) → API Service → Backend
 * Backend → JWT Token → Storage → Auth Store (setAuth) → Navigation
 * 
 * IMPORTANT:
 * - Koi SQL credentials yahan NAHI hain
 * - JWT_SECRET mobile app mein NAHI hai
 * - Sirf username/password collect karta hai
 */

import React, { useState } from 'react';
import { View, Text, TouchableOpacity, StyleSheet, Keyboard } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { useTheme } from '../../theme';
import { useAuth } from '../../hooks/useAuth';
import { Button, Input, Card } from '../../components';

/**
 * HR Login Screen Component
 */
export const HRLoginScreen = () => {
  const navigation = useNavigation();
  const { theme } = useTheme();
  const { loginHR } = useAuth();
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
      // HR credentials existing backend API par jaate hain.
      // Backend JWT return karega, phir /api/me se HR role verify hoga.
      // Auth state update hone par RootNavigator automatically HR portal kholta hai.
      await loginHR(username.trim(), password);
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
          <View style={[styles.logoCircle, { backgroundColor: theme.primary }]}>
            <Text style={styles.logoIcon}>🛡️</Text>
          </View>
          <Text style={[styles.title, { color: theme.textPrimary }]}>HR Admin Login</Text>
          <Text style={[styles.subtitle, { color: theme.textSecondary }]}>Enter your credentials to access admin portal</Text>
        </View>

        {/* Form */}
        <Card style={styles.formCard}>
          <View style={styles.formContainer}>
            <Input
              label="Username"
              placeholder="HR001"
              value={username}
              onChangeText={setUsername}
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
    backgroundColor: '#FEE2E2', // Will be theme-aware
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#FECACA',
  },
  errorText: {
    fontSize: 12,
    fontWeight: '500',
    textAlign: 'center',
  },
  phaseNotice: {
    padding: 12,
    backgroundColor: '#E0F2FE', // Will be theme-aware
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#BAE6FD',
  },
  phaseNoticeText: {
    fontSize: 12,
    textAlign: 'center',
  },
});