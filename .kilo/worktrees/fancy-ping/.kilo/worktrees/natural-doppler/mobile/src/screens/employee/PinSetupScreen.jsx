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
import { View, Text, StyleSheet, Alert, Keyboard } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { useTheme } from '../../theme';
import { setupPin } from '../../services/auth';
import { Button, Input, Card } from '../../components';

const PIN_LENGTH = 4;

export const PinSetupScreen = () => {
  const navigation = useNavigation();
  const { theme } = useTheme();

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
    <View style={[styles.container, { backgroundColor: theme.background }]}>
      <View style={styles.content}>
        <View style={styles.header}>
          <View style={[styles.iconCircle, { backgroundColor: theme.secondary }]}>
            <Text style={styles.icon}>🔐</Text>
          </View>
          <Text style={[styles.title, { color: theme.textPrimary }]}>Create 4-Digit PIN</Text>
          <Text style={[styles.subtitle, { color: theme.textSecondary }]}>
            PIN aapka additional security step hai
          </Text>
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
                <Text style={[styles.errorText, { color: theme.error }]}>⚠️ {error}</Text>
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
          </View>
        </Card>
      </View>
    </View>
  );
};

const styles = StyleSheet.create({
  container: { flex: 1 },
  content: { flex: 1, paddingHorizontal: 24, paddingVertical: 24, justifyContent: 'center' },
  header: { alignItems: 'center', marginBottom: 28 },
  iconCircle: {
    width: 72,
    height: 72,
    borderRadius: 36,
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 16,
  },
  icon: { fontSize: 32 },
  title: { fontSize: 20, fontWeight: '700', textAlign: 'center', marginBottom: 6 },
  subtitle: { fontSize: 13, textAlign: 'center' },
  form: { gap: 16 },
  noteBox: { padding: 12, borderRadius: 8, borderWidth: 1 },
  noteText: { fontSize: 12, textAlign: 'center' },
  errorBox: { padding: 12, borderRadius: 8, borderWidth: 1 },
  errorText: { fontSize: 12, fontWeight: '500', textAlign: 'center' },
});

export default PinSetupScreen;
