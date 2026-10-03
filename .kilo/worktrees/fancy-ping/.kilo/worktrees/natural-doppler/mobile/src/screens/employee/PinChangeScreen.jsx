// ============================================================================
// FILE: mobile/src/screens/employee/PinChangeScreen.jsx
// PURPOSE: Change an existing 4-digit PIN (Phase 3A.8)
// ============================================================================

/**
 * Ye screen employee ka EXISTING 4-digit PIN badalne ke liye hai.
 * Current PIN verify hona zaroori hai — bina current PIN ke PIN change nahi hota.
 *
 * Navigation Flow:
// Employee Portal → Profile → "Change 4-Digit PIN"
//   ↓
// PinChangeScreen
//   ↓ (current PIN verify hota hai, phir naya PIN set hota hai)
// Employee Profile
//
// Data Flow:
// PinChangeScreen
//   ↓
// auth service → POST /api/employee/pin/change
//   ↓
// Node/Express (req.user.paycode se identity — body se nahi)
//   ↓
// dbo.HR_EmployeeAuth (current PIN verify → naya scrypt hash store)
//   ↓
// JSON response (sirf success/failure; PIN kabhi nahi)
//
// Security:
// - Galat current PIN → change reject (401).
// - Employee sirf APNA PIN badal sakta hai.
// - Koi bhi PIN value log ya response mein nahi jaati.
 */

import React, { useState } from 'react';
import { View, Text, StyleSheet, Alert, Keyboard } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { useTheme } from '../../theme';
import { changePin } from '../../services/auth';
import { Button, Input, Card } from '../../components';

const PIN_LENGTH = 4;

export const PinChangeScreen = () => {
  const navigation = useNavigation();
  const { theme } = useTheme();

  const [currentPin, setCurrentPin] = useState('');
  const [newPin, setNewPin] = useState('');
  const [confirmPin, setConfirmPin] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState('');

  const validate = () => {
    if (!/^\d+$/.test(currentPin) || currentPin.length !== PIN_LENGTH) return 'Current PIN exactly 4 digits ka hona chahiye.';
    if (!/^\d+$/.test(newPin) || newPin.length !== PIN_LENGTH) return 'New PIN exactly 4 digits ka hona chahiye.';
    if (!/^\d+$/.test(confirmPin) || confirmPin.length !== PIN_LENGTH) return 'Confirmation PIN exactly 4 digits ka hona chahiye.';
    if (newPin !== confirmPin) return 'New PIN aur confirmation match nahi kar rahe.';
    if (currentPin === newPin) return 'New PIN current PIN se different hona chahiye.';
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
      // Backend current PIN verify karta hai; galat hua to 401 aata hai.
      await changePin({ currentPin, newPin, confirmPin });
      setCurrentPin('');
      setNewPin('');
      setConfirmPin('');
      Alert.alert('PIN updated', 'Aapka 4-digit PIN update ho gaya hai.', [
        { text: 'OK', onPress: () => navigation.goBack() },
      ]);
    } catch (err) {
      setError(err.message || 'PIN change failed. Please try again.');
    } finally {
      setIsLoading(false);
      Keyboard.dismiss();
    }
  };

  const digitsOnly = (text) => text.replace(/[^0-9]/g, '').slice(0, PIN_LENGTH);

  return (
    <View style={[styles.container, { backgroundColor: theme.background }]}>
      <View style={styles.content}>
        <View style={styles.header}>
          <View style={[styles.iconCircle, { backgroundColor: theme.primary }]}>
            <Text style={styles.icon}>🔑</Text>
          </View>
          <Text style={[styles.title, { color: theme.textPrimary }]}>Change 4-Digit PIN</Text>
          <Text style={[styles.subtitle, { color: theme.textSecondary }]}>
            Pehle current PIN verify karna hoga
          </Text>
        </View>

        <Card>
          <View style={styles.form}>
            <Input
              label="Current 4-Digit PIN"
              placeholder="••••"
              value={currentPin}
              onChangeText={(text) => setCurrentPin(digitsOnly(text))}
              type="password"
              keyboardType="number-pad"
              maxLength={PIN_LENGTH}
            />

            <Input
              label="New 4-Digit PIN"
              placeholder="••••"
              value={newPin}
              onChangeText={(text) => setNewPin(digitsOnly(text))}
              type="password"
              keyboardType="number-pad"
              maxLength={PIN_LENGTH}
            />

            <Input
              label="Confirm New 4-Digit PIN"
              placeholder="••••"
              value={confirmPin}
              onChangeText={(text) => setConfirmPin(digitsOnly(text))}
              type="password"
              keyboardType="number-pad"
              maxLength={PIN_LENGTH}
              returnKeyType="go"
              onSubmitEditing={handleSubmit}
            />

            {error ? (
              <View style={[styles.errorBox, { backgroundColor: `${theme.error}15`, borderColor: `${theme.error}30` }]}>
                <Text style={[styles.errorText, { color: theme.error }]}>⚠️ {error}</Text>
              </View>
            ) : null}

            <Button
              title={isLoading ? 'Updating PIN...' : 'Change PIN'}
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
  errorBox: { padding: 12, borderRadius: 8, borderWidth: 1 },
  errorText: { fontSize: 12, fontWeight: '500', textAlign: 'center' },
});

export default PinChangeScreen;
