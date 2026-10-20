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
import { View, Text, TouchableOpacity, StyleSheet, Keyboard, KeyboardAvoidingView, ScrollView, Platform } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useNavigation } from '@react-navigation/native';
import { useTheme } from '../../theme';
import { useAuth } from '../../hooks/useAuth';
import { Button, Input, Card, GradientIcon } from '../../components';
import { Ionicons } from '@expo/vector-icons';

/**
 * HR Login Screen Component
 */
export const HRLoginScreen = () => {
  const insets = useSafeAreaInsets();
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
    <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={[styles.container, { backgroundColor: theme.background, paddingTop: insets.top, paddingBottom: insets.bottom }]}>
      <TouchableOpacity style={[styles.backButton, { top: insets.top + 8 }]} onPress={handleBack} hitSlop={{ top: 20, left: 20, bottom: 20, right: 20 }}>
        <Ionicons name="arrow-back" size={24} color={theme.textPrimary} />
      </TouchableOpacity>

      <ScrollView contentContainerStyle={styles.contentContainer} keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}>
        {/* Header */}
        <View style={styles.header}>
          <GradientIcon from="#2563EB" to="#7C3AED" name="shield-checkmark" size={96} radius={28} glyphRatio={0.5} />
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