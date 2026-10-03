// ============================================================================
// FILE: mobile/src/screens/hr/HREmployeeCredentialsScreen.jsx
// PURPOSE: HR-controlled employee password / PIN reset (Phase 3A.10)
// ============================================================================

/**
 * Ye screen HR/Admin ko REAL employee ka password aur 4-digit PIN reset karne deti hai.
 *
 * Navigation Flow:
 * HR Portal → Employees → "Manage Credentials"
 *   ↓
// HREmployeeCredentialsScreen
//   ├── Search & select employee (existing HR employees API)
//   ├── Reset employee password
//   └── Reset employee 4-digit PIN
//
// Data Flow:
// Employee search → GET /api/hr/employees?search=... (EXISTING HR API, reuse)
//   ↓
// Password reset → POST /api/hr/employee/credentials/password
//   ↓
// Node/Express (authenticate + requireRole('HR'))
//   ↓
// dbo.HR_EmployeeAuth (scrypt hash — password columns only)
//
// PIN reset → POST /api/hr/employee/credentials/pin
//   ↓
// dbo.HR_EmployeeAuth (scrypt hash — PIN columns only)
//
// Security:
// - Sirf authenticated HR session hi ye screen/API use kar sakti hai.
//   Employee token backend par 403 se block hota hai.
// - Password/PIN masked inputs mein hote hain aur kabhi log/response mein nahi jaate.
// - Password reset se employee ka PIN NAHI badalta.
// - PIN reset se employee ka password NAHI badalta.
// - Employee identity hamesha real Savior SQL (dbo.tblemployee.paycode) se.
//
// NOTE: Ye sirf HR-controlled reset hai. Employee apna password khud
//       first-time setup (3A.7) ya Forgot Password (3A.9) se change karta hai.
 */

import React, { useState, useEffect, useCallback } from 'react';
import { View, Text, ScrollView, StyleSheet, TouchableOpacity, Alert } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { COLORS, TYPOGRAPHY, SPACING, SHADOWS } from '../../utils/colors';
import { api } from '../../services/api';
import {
  getHrEmployeeCredentials,
  hrResetEmployeePassword,
  hrResetEmployeePin,
} from '../../services/auth';
import { Button, Input, Card } from '../../components';

export const HREmployeeCredentialsScreen = () => {
  const navigation = useNavigation();

  const [search, setSearch] = useState('');
  const [results, setResults] = useState([]);
  const [searching, setSearching] = useState(false);
  const [selected, setSelected] = useState(null);
  const [status, setStatus] = useState(null);

  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [pin, setPin] = useState('');
  const [confirmPin, setConfirmPin] = useState('');

  const [pwBusy, setPwBusy] = useState(false);
  const [pinBusy, setPinBusy] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');

  // Employee search — existing HR employees endpoint reuse hota hai.
  const runSearch = useCallback(async (term) => {
    if (!term || term.trim().length < 2) {
      setResults([]);
      return;
    }
    setSearching(true);
    try {
      const data = await api.get('/hr/employees', {
        search: term.trim(),
        page: 1,
        pageSize: 10,
        active: 'Y',
      });
      setResults(data?.rows || []);
    } catch (_error) {
      setResults([]);
    } finally {
      setSearching(false);
    }
  }, []);

  useEffect(() => {
    const timer = setTimeout(() => runSearch(search), 300);
    return () => clearTimeout(timer);
  }, [search, runSearch]);

  // Employee select karte hi credential status laate hain.
  const selectEmployee = async (employee) => {
    setSelected({ paycode: employee.paycode, empname: employee.empname });
    setError('');
    setSuccess('');
    setPassword('');
    setConfirmPassword('');
    setPin('');
    setConfirmPin('');
    try {
      const data = await getHrEmployeeCredentials(employee.paycode);
      setStatus(data);
    } catch (_error) {
      setStatus(null);
    }
  };

  const handlePasswordReset = async () => {
    if (!selected) return;
    if (password !== confirmPassword) {
      setError('Password aur confirmation match nahi kar rahe.');
      return;
    }
    setPwBusy(true);
    setError('');
    setSuccess('');
    try {
      const res = await hrResetEmployeePassword({
        paycode: selected.paycode,
        password,
        confirmPassword,
      });
      setSuccess(res?.message || 'Employee password updated.');
      setPassword('');
      setConfirmPassword('');
      setStatus((prev) => (prev ? { ...prev, passwordSet: true, locked: false } : prev));
    } catch (err) {
      setError(err.message || 'Password reset failed.');
    } finally {
      setPwBusy(false);
    }
  };

  const handlePinReset = async () => {
    if (!selected) return;
    if (pin !== confirmPin) {
      setError('PIN aur confirmation match nahi kar rahe.');
      return;
    }
    setPinBusy(true);
    setError('');
    setSuccess('');
    try {
      const res = await hrResetEmployeePin({
        paycode: selected.paycode,
        pin,
        confirmPin,
      });
      setSuccess(res?.message || 'Employee PIN updated.');
      setPin('');
      setConfirmPin('');
      setStatus((prev) => (prev ? { ...prev, pinSet: true } : prev));
    } catch (err) {
      setError(err.message || 'PIN reset failed.');
    } finally {
      setPinBusy(false);
    }
  };

  return (
    <View style={[styles.container, { backgroundColor: COLORS.background }]}>
      <View style={styles.headerBar}>
        <TouchableOpacity
          style={styles.backButton}
          onPress={() => navigation.goBack()}
          hitSlop={{ top: 20, left: 20, bottom: 20, right: 20 }}
        >
          <Text style={styles.backText}>←</Text>
        </TouchableOpacity>
        <Text style={[styles.headerTitle, { color: COLORS.textPrimary }]}>Employee Credential Management</Text>
      </View>

      <ScrollView contentContainerStyle={styles.scrollContent} keyboardShouldPersistTaps="handled">
        {/* Employee search */}
        <Card>
          <View style={styles.section}>
            <Text style={[styles.sectionTitle, TYPOGRAPHY.h4]}>Employee</Text>
            <Input
              label="Search by name or paycode"
              placeholder="e.g. Rajesh / 0002"
              value={search}
              onChangeText={setSearch}
              autoCapitalize="characters"
            />

            {searching && <Text style={styles.hint}>Searching...</Text>}

            {!searching && results.length > 0 && (
              <View style={styles.resultsList}>
                {results.map((emp) => (
                  <TouchableOpacity
                    key={emp.paycode}
                    style={[
                      styles.resultRow,
                      selected?.paycode === emp.paycode && styles.resultRowActive,
                    ]}
                    onPress={() => selectEmployee(emp)}
                    activeOpacity={0.85}
                  >
                    <View>
                      <Text style={styles.resultName}>{emp.empname}</Text>
                      <Text style={styles.resultMeta}>
                        {emp.paycode} • {emp.departmentcode || '—'} • {emp.designation || '—'}
                      </Text>
                    </View>
                    {selected?.paycode === emp.paycode && <Text style={styles.resultCheck}>✓</Text>}
                  </TouchableOpacity>
                ))}
              </View>
            )}

            {!searching && search.trim().length >= 2 && results.length === 0 && (
              <Text style={styles.hint}>Is search se koi employee nahi mila.</Text>
            )}
          </View>
        </Card>

        {/* Selected employee */}
        {selected && (
          <Card style={styles.cardSpacing}>
            <View style={styles.section}>
              <Text style={[styles.sectionTitle, TYPOGRAPHY.h4]}>Selected Employee</Text>
              <View style={styles.selectedBox}>
                <Text style={styles.selectedName}>{selected.empname}</Text>
                <Text style={styles.selectedPaycode}>{selected.paycode}</Text>
              </View>
              {status && (
                <View style={styles.badgeRow}>
                  <View style={[styles.badge, { backgroundColor: status.passwordSet ? `${COLORS.success}20` : `${COLORS.warning}20` }]}>
                    <Text style={[styles.badgeText, { color: status.passwordSet ? COLORS.success : COLORS.warning }]}>
                      Password: {status.passwordSet ? 'Set' : 'Not set'}
                    </Text>
                  </View>
                  <View style={[styles.badge, { backgroundColor: status.pinSet ? `${COLORS.success}20` : `${COLORS.warning}20` }]}>
                    <Text style={[styles.badgeText, { color: status.pinSet ? COLORS.success : COLORS.warning }]}>
                      PIN: {status.pinSet ? 'Set' : 'Not set'}
                    </Text>
                  </View>
                  {status.locked && (
                    <View style={[styles.badge, { backgroundColor: `${COLORS.error}20` }]}>
                      <Text style={[styles.badgeText, { color: COLORS.error }]}>Locked</Text>
                    </View>
                  )}
                </View>
              )}
            </View>
          </Card>
        )}

        {/* Password reset */}
        {selected && (
          <Card style={styles.cardSpacing}>
            <View style={styles.section}>
              <Text style={[styles.sectionTitle, TYPOGRAPHY.h4]}>Reset Password</Text>
              <Text style={styles.hint}>Employee ka PIN isse change NAHI hoga.</Text>
              <Input
                label="New Password"
                placeholder="••••••••"
                value={password}
                onChangeText={setPassword}
                type="password"
                autoComplete="new-password"
              />
              <Input
                label="Confirm Password"
                placeholder="••••••••"
                value={confirmPassword}
                onChangeText={setConfirmPassword}
                type="password"
                autoComplete="new-password"
              />
              <Button
                title={pwBusy ? 'Updating...' : 'Reset Password'}
                onPress={handlePasswordReset}
                loading={pwBusy}
                disabled={pwBusy}
                fullWidth
                size="medium"
              />
            </View>
          </Card>
        )}

        {/* PIN reset */}
        {selected && (
          <Card style={styles.cardSpacing}>
            <View style={styles.section}>
              <Text style={[styles.sectionTitle, TYPOGRAPHY.h4]}>Reset 4-Digit PIN</Text>
              <Text style={styles.hint}>Exactly 4 numbers. Employee ka password isse change NAHI hoga.</Text>
              <Input
                label="New 4-Digit PIN"
                placeholder="••••"
                value={pin}
                onChangeText={(text) => setPin(text.replace(/[^0-9]/g, '').slice(0, 4))}
                type="password"
                keyboardType="number-pad"
                maxLength={4}
              />
              <Input
                label="Confirm 4-Digit PIN"
                placeholder="••••"
                value={confirmPin}
                onChangeText={(text) => setConfirmPin(text.replace(/[^0-9]/g, '').slice(0, 4))}
                type="password"
                keyboardType="number-pad"
                maxLength={4}
              />
              <Button
                title={pinBusy ? 'Updating...' : 'Reset PIN'}
                onPress={handlePinReset}
                loading={pinBusy}
                disabled={pinBusy}
                fullWidth
                size="medium"
                variant="secondary"
              />
            </View>
          </Card>
        )}

        {error ? (
          <View style={styles.errorBox}>
            <Text style={styles.errorText}>⚠️ {error}</Text>
          </View>
        ) : null}
        {success ? (
          <View style={styles.successBox}>
            <Text style={styles.successText}>✅ {success}</Text>
          </View>
        ) : null}

        {!selected && (
          <View style={styles.placeholderBox}>
            <Text style={styles.placeholderText}>
              Employee select karein — phir uska password ya PIN reset kar sakte hain.
            </Text>
          </View>
        )}
      </ScrollView>
    </View>
  );
};

const styles = StyleSheet.create({
  container: { flex: 1 },
  headerBar: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingTop: 48,
    paddingBottom: 12,
  },
  backButton: { padding: 8 },
  backText: { fontSize: 28, fontWeight: '600', color: COLORS.textPrimary },
  headerTitle: { fontSize: 17, fontWeight: '700', marginLeft: 8, flex: 1 },
  scrollContent: { paddingHorizontal: 16, paddingBottom: 32 },
  cardSpacing: { marginTop: 12 },
  section: { gap: 12 },
  sectionTitle: { color: COLORS.textPrimary },
  hint: { fontSize: 12, color: COLORS.textTertiary },
  resultsList: { gap: 8 },
  resultRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: 12,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: COLORS.border,
    backgroundColor: COLORS.surfaceVariant,
  },
  resultRowActive: { borderColor: COLORS.primary, backgroundColor: `${COLORS.primary}12` },
  resultName: { fontWeight: '600', color: COLORS.textPrimary, fontSize: 14 },
  resultMeta: { fontSize: 11, color: COLORS.textTertiary },
  resultCheck: { color: COLORS.primary, fontSize: 18, fontWeight: '700' },
  selectedBox: {
    padding: 14,
    borderRadius: 12,
    backgroundColor: COLORS.primary + '12',
    borderWidth: 1,
    borderColor: COLORS.primary + '33',
  },
  selectedName: { fontSize: 18, fontWeight: '700', color: COLORS.textPrimary },
  selectedPaycode: { fontSize: 13, color: COLORS.textSecondary, marginTop: 2 },
  badgeRow: { flexDirection: 'row', gap: 8, flexWrap: 'wrap' },
  badge: { paddingHorizontal: 10, paddingVertical: 4, borderRadius: 20 },
  badgeText: { fontSize: 11, fontWeight: '700' },
  errorBox: {
    marginTop: 12,
    padding: 12,
    borderRadius: 8,
    borderWidth: 1,
    backgroundColor: `${COLORS.error}15`,
    borderColor: `${COLORS.error}30`,
  },
  errorText: { fontSize: 12, fontWeight: '500', color: COLORS.error, textAlign: 'center' },
  successBox: {
    marginTop: 12,
    padding: 12,
    borderRadius: 8,
    borderWidth: 1,
    backgroundColor: `${COLORS.success}15`,
    borderColor: `${COLORS.success}30`,
  },
  successText: { fontSize: 12, fontWeight: '500', color: COLORS.success, textAlign: 'center' },
  placeholderBox: { marginTop: 24, alignItems: 'center' },
  placeholderText: { fontSize: 13, color: COLORS.textTertiary, textAlign: 'center' },
});

export default HREmployeeCredentialsScreen;
