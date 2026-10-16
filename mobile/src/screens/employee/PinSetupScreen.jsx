// ============================================================================
// FILE: mobile/src/screens/employee/PinSetupScreen.jsx
// PURPOSE: First-time 4-digit PIN creation (Phase 3A.8)
// ============================================================================

/**
 * Ye screen employee ka PEHLI BAAR ka 4-digit PIN banane ke liye hai.
 * Sirf tab khulti hai jab employee authenticated hai aur uska PIN set nahi hai.
 *
 * Navigation Flow:
 * Employee Portal → Profile → "Create 4-Digit PIN"
 *   ↓
 * PinSetupScreen
 *   ↓ (PIN set hota hai)
 * Employee Profile
 *
 * Data Flow:
 * PinSetupScreen
 *   ↓
// auth service → POST /api/employee/pin/setup
//   ↓
// Node/Express (req.user.paycode se identity — body se nahi)
//   ↓
// dbo.HR_EmployeeAuth (scrypt hash store — app-owned table)
//   ↓
// JSON response (sirf success/failure; PIN kabhi nahi)
//
// Security:
// - PIN hamesha 4 numeric digits hona chahiye.
// - PIN kabhi store, log ya response mein nahi jaata.
// - Employee sirf APNA PIN set kar sakta hai.
 */

import React, { useState } from 'react';
import { Ionicons } from '@expo/vector-icons';
import { View, Text, StyleSheet, Alert, Keyboard, TouchableOpacity, KeyboardAvoidingView, ScrollView, Platform } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useNavigation, useRoute } from '@react-navigation/native';
import { useTheme } from '../../theme';
import { useAuth } from '../../hooks/useAuth';
import { setupPin } from '../../services/auth';
import { Button, Input, Card } from '../../components';

const PIN_LENGTH = 4;

export const PinSetupScreen = ({ forced = false }) => {
  const navigation = useNavigation();
  const route = useRoute();
  const { theme } = useTheme();
  const { clearPinSetupRequired, logout } = useAuth();
  // Registered as a Stack.Screen the component receives navigation/route
  // PROPS only - the `forced` flag therefore also travels via route params
  // (initialParams), so the gate screen keeps its forced behaviour.
  const isForced = forced === true || route?.params?.forced === true;

  const [pin, setPin] = useState('');
  const [confirmPin, setConfirmPin] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState('');

  // Same 4-digit rule jo backend use karta hai (client-side convenience only).
  const validate = () => {
    if (!/^\d+$/.test(pin) || pin.length !== PIN_LENGTH) return 'PIN exactly 4 digits ka hona chahiye.';
    if (!/^\d+$/.test(confirmPin) || confirmPin.length !== PIN_LENGTH) return 'Confirmation PIN exactly 4 digits ka hona chahiye.';
    if (pin !== confirmPin) return 'PIN aur confirmation match nahi kar rahe.';
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
      // PIN backend ko jaata hai; backend use hash karke store karta hai.
      // Backend identity JWT se leta hai — mobile paycode nahi bhejta.
      await setupPin({ pin, confirmPin });
      setPin('');
      setConfirmPin('');
      // Forced gate (Phase I section 2): EmployeeNavigator pinSetupRequired
      // dekh raha hai, isliye success par flag clear karna zaroori hai.
      // Voluntary flow (Profile se) mein clearPinSetupRequired harmless hai.
      clearPinSetupRequired();
      if (isForced) return; // navigator khud tabs par switch karega
      Alert.alert('PIN created', 'Aapka 4-digit PIN set ho gaya hai.', [
        { text: 'OK', onPress: () => navigation.goBack() },
      ]);
    } catch (err) {
      setError(err.message || 'PIN setup failed. Please try again.');
    } finally {
      setIsLoading(false);
      Keyboard.dismiss();
    }
  };

  return (
    <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={[styles.container, { backgroundColor: theme.background, paddingTop: insets.top, paddingBottom: insets.bottom }]}>
      <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}>
        <View style={styles.header}>
          <View style={[styles.iconCircle, { backgroundColor: theme.secondary }]}>
            <Ionicons name="lock-closed" size={32} color="#FFFFFF" />
          </View>
          <Text style={[styles.title, { color: theme.textPrimary }]}>Create 4-Digit PIN</Text>
          <Text style={[styles.subtitle, { color: theme.textSecondary }]}>
            PIN aapka additional security step hai
          </Text>
          {isForced ? (
            <View style={[styles.forcedBox, { backgroundColor: `${theme.warning || '#F59E0B'}15`, borderColor: `${theme.warning || '#F59E0B'}30` }]}>
              <Text style={[styles.forcedText, { color: theme.warning || '#B45309' }]}>
                Dashboard kholne se pehle apna 4-digit PIN banana zaroori hai.
              </Text>
            </View>
          ) : null}
        </View>

        <Card>
          <View style={styles.form}>
            <Input
              label="Create 4-Digit PIN"
              placeholder="••••"
              value={pin}
              onChangeText={(text) => setPin(text.replace(/[^0-9]/g, '').slice(0, PIN_LENGTH))}
              type="password"
              keyboardType="number-pad"
              maxLength={PIN_LENGTH}
            />

            <Input
              label="Confirm 4-Digit PIN"
              placeholder="••••"
              value={confirmPin}
              onChangeText={(text) => setConfirmPin(text.replace(/[^0-9]/g, '').slice(0, PIN_LENGTH))}
              type="password"
              keyboardType="number-pad"
              maxLength={PIN_LENGTH}
              returnKeyType="go"
              onSubmitEditing={handleSubmit}
            />

            <View style={[styles.noteBox, { backgroundColor: `${theme.info}15`, borderColor: `${theme.info}30` }]}>
              <Text style={[styles.noteText, { color: theme.info }]}>
                PIN exactly 4 numbers ka hona chahiye. Ye aapke password ka replacement nahi hai.
              </Text>
            </View>

            {error ? (
              <View style={[styles.errorBox, { backgroundColor: `${theme.error}15`, borderColor: `${theme.error}30` }]}>
                <Text style={[styles.errorText, { color: theme.error }]}><Ionicons name="alert-circle" size={13} /> {error}</Text>
              </View>
            ) : null}

            <Button
              title={isLoading ? 'Saving PIN...' : 'Create PIN'}
              onPress={handleSubmit}
              loading={isLoading}
              disabled={isLoading}
              fullWidth
              size="large"
            />

            {isForced ? (
              <TouchableOpacity
                style={styles.logoutLink}
                onPress={() => { void logout(); }}
                hitSlop={{ top: 10, left: 10, bottom: 10, right: 10 }}
              >
                <Text style={[styles.logoutText, { color: theme.textSecondary }]}>Logout</Text>
              </TouchableOpacity>
            ) : null}
          </View>
        </Card>
      </ScrollView>
    </KeyboardAvoidingView>
  );
};

const styles = StyleSheet.create({
  container: { flex: 1 },
  content: { flexGrow: 1, paddingHorizontal: 24, paddingVertical: 24, justifyContent: 'center' },
  header: { alignItems: 'center', marginBottom: 28 },
  iconCircle: {
    width: 72,
    height: 72,
    borderRadius: 36,
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 16,
  },
  title: { fontSize: 20, fontWeight: '700', textAlign: 'center', marginBottom: 6 },
  subtitle: { fontSize: 13, textAlign: 'center' },
  forcedBox: { marginTop: 12, padding: 12, borderRadius: 8, borderWidth: 1 },
  forcedText: { fontSize: 12, fontWeight: '600', textAlign: 'center' },
  form: { gap: 16 },
  noteBox: { padding: 12, borderRadius: 8, borderWidth: 1 },
  noteText: { fontSize: 12, textAlign: 'center' },
  errorBox: { padding: 12, borderRadius: 8, borderWidth: 1 },
  errorText: { fontSize: 12, fontWeight: '500', textAlign: 'center' },
  logoutLink: { alignItems: 'center', paddingVertical: 4 },
  logoutText: { fontSize: 13, fontWeight: '600' },
});

export default PinSetupScreen;
