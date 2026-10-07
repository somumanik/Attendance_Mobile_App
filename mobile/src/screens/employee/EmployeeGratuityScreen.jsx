// ============================================================================
// FILE: mobile/src/screens/employee/EmployeeGratuityScreen.jsx
// PURPOSE: Full & Final / Gratuity ESTIMATION (self-service, rules pending)
// ============================================================================

/**
 * Ye screen EMPLOYEE ka apna Full & Final ESTIMATE dikhati hai.
 *
 * Navigation Flow:
 * EmployeeNavigator (Full & Final Tab) -> EmployeeGratuityScreen
 *
 * Data Flow:
 * Employee Login -> JWT -> GET /api/employee/fullfinal
 *
 * Identity & security:
 * The client NEVER sends a paycode. The backend resolves the employee from the
 * verified JWT (req.user.paycode), so an employee can only ever estimate their
 * own settlement - never another employee's.
 *
 * Joining Date is READ-ONLY and comes from the real employee master
 * (dbo.tblemployee.dateofjoin). It cannot be edited here.
 *
 * "Proposed Leaving Date" is an ESTIMATION INPUT typed by the employee. It is
 * deliberately labelled "Proposed" (never "Official") and is NEVER written to
 * dbo.tblemployee or anywhere else - it stays in this screen's state.
 *
 * SALARY & FORMULAS:
 * This application has no approved salary source (dbo.tblemployee has no
 * salary/basic/wage/CTC column and no salary API exists), and the company's
 * gratuity / bonus / leave-encashment / notice formulas are not finalised.
 * Therefore this screen:
 *   - shows "Salary information is not currently available for calculation."
 *   - computes ONLY the service period (pure calendar arithmetic - not a
 *     company rule),
 *   - shows every money component as "₹ ---" with
 *     "Calculation rules pending company configuration.",
 * and invents no figure of any kind. There is no demo/sample data anywhere in
 * this screen.
 *
 * The calculation area is deliberately split into INPUTS / RULES / RESULTS so the
 * approved company formulas can be added later in one place without touching
 * this screen's data flow.
 */

import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { View, Text, ScrollView, StyleSheet, TouchableOpacity, TextInput, RefreshControl, ActivityIndicator } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useTheme } from '../../theme';
import { Card, Button, ScreenContainer } from '../../components';
import { api } from '../../services/api';
import { API_ENDPOINTS } from '../../utils/constants';

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const clean = (v) => String(v == null ? '' : v).trim();
const PLACEHOLDER = '—';
const PENDING = '₹ ---';

/** Plain 'YYYY-MM-DD' -> local parts. No UTC parsing, so a date cannot shift. */
const partsOf = (v) => {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(clean(v));
  if (!m) return null;
  const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  if (d.getFullYear() !== Number(m[1]) || d.getMonth() !== Number(m[2]) - 1 || d.getDate() !== Number(m[3])) return null;
  return d;
};
const longDate = (v) => {
  const d = partsOf(v);
  return d ? `${String(d.getDate()).padStart(2, '0')} ${MONTHS[d.getMonth()]} ${d.getFullYear()}` : PLACEHOLDER;
};
const todayIso = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

/**
 * Service period between the real joining date and the proposed leaving date.
 * Pure calendar arithmetic (whole years, then months, then days) - this is NOT a
 * company settlement rule and is never used to derive any rupee amount.
 */
const servicePeriod = (joinIso, leaveIso) => {
  const j = partsOf(joinIso);
  const l = partsOf(leaveIso);
  if (!j || !l || l.getTime() < j.getTime()) return null;
  let years = l.getFullYear() - j.getFullYear();
  let months = l.getMonth() - j.getMonth();
  let days = l.getDate() - j.getDate();
  if (days < 0) {
    months -= 1;
    const prevMonthDay = new Date(l.getFullYear(), l.getMonth(), 0).getDate();
    days += prevMonthDay;
  }
  if (months < 0) { years -= 1; months += 12; }
  return { years, months, days };
};

/** Settlement components shown while the company rules are still pending. */
const COMPONENTS = [
  { id: 'gratuity', label: 'Gratuity', rule: 'Gratuity rule' },
  { id: 'bonus', label: 'Bonus', rule: 'Bonus rule' },
  { id: 'leaveEncashment', label: 'Leave Encashment', rule: 'Leave encashment rule' },
  { id: 'noticePay', label: 'Notice Pay', rule: 'Notice period rule' },
  { id: 'otherDues', label: 'Other Dues', rule: 'Other dues rule' },
  { id: 'otherRecoveries', label: 'Other Recoveries', rule: 'Other recoveries rule' },
];

/**
 * Employee Gratuity / Full & Final Screen Component
 */
export const EmployeeGratuityScreen = () => {
  const { theme } = useTheme();
  const [data, setData] = useState(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [error, setError] = useState(null);

  // Estimation inputs (local only - nothing is persisted).
  const [leavingDate, setLeavingDate] = useState('');
  const [result, setResult] = useState(null);

  const load = useCallback(async (isRefresh) => {
    if (isRefresh) setIsRefreshing(true); else setIsLoading(true);
    setError(null);
    try {
      const res = await api.get(API_ENDPOINTS.EMPLOYEE_FULLFINAL);
      setData(res);
    } catch (e) {
      setData(null);
      setError('Unable to load your full & final details. Please try again.');
    } finally {
      setIsLoading(false);
      setIsRefreshing(false);
    }
  }, []);

  useEffect(() => { load(false); }, [load]);

  const emp = data ? data.employee : null;
  const salary = data ? data.salary : null;
  const rulesConfigured = data ? data.rulesConfigured === true : false;
  const pendingMessage = clean(data && data.rulesPendingMessage) || 'Calculation rules pending company configuration.';

  const calculate = () => {
    if (!emp) return;
    const sp = servicePeriod(emp.dateofjoin, leavingDate);
    setResult(sp ? { period: sp, leavingDate } : { period: null, leavingDate, invalid: true });
  };

  const reset = () => { setResult(null); setLeavingDate(''); };

  const period = result ? result.period : null;
  const inputReady = !!emp && !!partsOf(leavingDate);

  return (
    <ScreenContainer title="Full & Final Estimate" showHeader={true}>
      <ScrollView
        refreshControl={<RefreshControl refreshing={isRefreshing} onRefresh={() => load(true)} colors={[theme.primary]} />}
        contentContainerStyle={styles.scroll}
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
      >
        {isLoading ? (
          <View style={styles.stateBox}>
            <ActivityIndicator size="large" color={theme.primary} />
            <Text style={[styles.stateText, { color: theme.textSecondary }]}>Loading your details...</Text>
          </View>
        ) : null}

        {!isLoading && error ? (
          <Card style={styles.card}>
            <Text style={[styles.errorText, { color: theme.error }]}>⚠️ {error}</Text>
            <Button title="Retry" onPress={() => load(false)} variant="outline" size="small" style={{ marginTop: 12 }} />
          </Card>
        ) : null}

        {!isLoading && !error && emp ? (
          <>
            {/* ---------------- 1. INPUTS ---------------- */}
            <Text style={[styles.sectionTitle, { color: theme.textPrimary }]}>Full &amp; Final Estimate</Text>

            <Card style={styles.card}>
              <View style={styles.identityRow}>
                <Text style={[styles.identityName, { color: theme.textPrimary }]} numberOfLines={1}>{clean(emp.empname) || PLACEHOLDER}</Text>
                <View style={[styles.paycodeChip, { backgroundColor: `${theme.primary}15`, borderColor: `${theme.primary}44` }]}>
                  <Text style={[styles.paycodeText, { color: theme.primary }]}>{clean(emp.paycode)}</Text>
                </View>
              </View>

              <View style={[styles.staticRow, { borderColor: theme.border }]}>
                <Text style={[styles.rowLabel, { color: theme.textSecondary }]}>Date of Joining</Text>
                <Text style={[styles.rowValue, { color: theme.textPrimary }]}>{longDate(emp.dateofjoin)}</Text>
              </View>
              <Text style={[styles.readOnlyHint, { color: theme.textTertiary }]}>
                Joining date comes from your employee record and cannot be edited here.
              </Text>

              <View style={[styles.staticRow, { borderColor: theme.border }]}>
                <Text style={[styles.rowLabel, { color: theme.textSecondary }]}>Department</Text>
                <Text style={[styles.rowValue, { color: theme.textPrimary }]} numberOfLines={1}>
                  {clean(emp.departmentname || emp.departmentcode) || PLACEHOLDER}
                </Text>
              </View>
              <View style={[styles.staticRow, { borderColor: theme.border }]}>
                <Text style={[styles.rowLabel, { color: theme.textSecondary }]}>Designation</Text>
                <Text style={[styles.rowValue, { color: theme.textPrimary }]} numberOfLines={1}>
                  {clean(emp.designation) || PLACEHOLDER}
                </Text>
              </View>

              {/* Estimation-only input */}
              <Text style={[styles.inputLabel, { color: theme.textSecondary }]}>Proposed Leaving Date</Text>
              <TextInput
                style={[styles.dateInput, { color: theme.textPrimary, borderColor: theme.border }]}
                value={leavingDate}
                onChangeText={setLeavingDate}
                placeholder={todayIso()}
                placeholderTextColor={theme.textTertiary}
                autoCapitalize="none"
                autoCorrect={false}
                keyboardType="numbers-and-punctuation"
              />
              <Text style={[styles.readOnlyHint, { color: theme.textTertiary }]}>
                Estimation input only (YYYY-MM-DD). This is NOT the official leaving date and is not saved anywhere.
              </Text>

              <Button
                title="Calculate Estimate"
                onPress={calculate}
                disabled={!inputReady}
                size="small"
                style={{ marginTop: 12 }}
              />
              {result && result.invalid ? (
                <Text style={[styles.warnText, { color: theme.error }]}>
                  ⚠️ Proposed leaving date is before your joining date.
                </Text>
              ) : null}
            </Card>

            {/* ---------------- 2. RULES ---------------- */}
            <Text style={[styles.sectionTitle, { color: theme.textPrimary }]}>Calculation Rules</Text>
            <Card style={styles.card}>
              <View style={[styles.pendingBanner, { backgroundColor: `${theme.warning}15`, borderColor: `${theme.warning}44` }]}>
                <Ionicons name="information-circle" size={16} color={theme.warning} />
                <Text style={[styles.pendingText, { color: theme.warning }]}>{pendingMessage}</Text>
              </View>
              <View style={styles.ruleList}>
                {COMPONENTS.map((c) => (
                  <View key={c.id} style={styles.ruleRow}>
                    <Text style={[styles.ruleLabel, { color: theme.textSecondary }]}>{c.label}</Text>
                    <Text style={[styles.ruleValue, { color: theme.textTertiary }]}>{c.rule} — not configured</Text>
                  </View>
                ))}
              </View>
            </Card>

            {/* ---------------- 3. RESULTS ---------------- */}
            <Text style={[styles.sectionTitle, { color: theme.textPrimary }]}>Estimated Settlement</Text>

            <Card style={styles.card}>
              <Text style={[styles.cardHead, { color: theme.textPrimary }]}>Service Period</Text>
              {period ? (
                <View style={styles.periodRow}>
                  {[['Years', period.years], ['Months', period.months], ['Days', period.days]].map(([l, v]) => (
                    <View key={l} style={[styles.periodBox, { borderColor: theme.border }]}>
                      <Text style={[styles.periodValue, { color: theme.primary }]}>{v}</Text>
                      <Text style={[styles.periodLabel, { color: theme.textSecondary }]}>{l}</Text>
                    </View>
                  ))}
                </View>
              ) : (
                <Text style={[styles.pendingLine, { color: theme.textTertiary }]}>
                  {result && result.invalid ? 'Invalid date' : 'Select a proposed leaving date and tap Calculate Estimate.'}
                </Text>
              )}
            </Card>

            {/* Salary availability is stated truthfully - never a fabricated number */}
            {!salary || salary.available !== true ? (
              <View style={[styles.salaryNote, { backgroundColor: `${theme.error}12`, borderColor: `${theme.error}33` }]}>
                <Text style={[styles.salaryNoteText, { color: theme.error }]}>
                  {clean(salary && salary.reason) || 'Salary information is not currently available for calculation.'}
                </Text>
              </View>
            ) : null}

            <Card style={styles.card}>
              <Text style={[styles.cardHead, { color: theme.textPrimary }]}>Settlement Components</Text>
              {COMPONENTS.map((c) => (
                <View key={c.id} style={[styles.amountRow, { borderColor: theme.border }]}>
                  <Text style={[styles.amountLabel, { color: theme.textSecondary }]}>{c.label}</Text>
                  <Text style={[styles.amountValue, { color: theme.textTertiary }]}>{PENDING}</Text>
                </View>
              ))}
            </Card>

            <Card style={[styles.card, { borderColor: `${theme.primary}44` }]}>
              <View style={styles.totalRow}>
                <Text style={[styles.totalLabel, { color: theme.textPrimary }]}>Estimated Full &amp; Final</Text>
                <Text style={[styles.totalValue, { color: theme.textTertiary }]}>{PENDING}</Text>
              </View>
              <Text style={[styles.totalNote, { color: theme.textTertiary }]}>{pendingMessage}</Text>
            </Card>

            {result ? (
              <Button title="Clear Estimate" onPress={reset} variant="outline" size="small" />
            ) : null}

            <Text style={[styles.footnote, { color: theme.textTertiary }]}>
              This is a self-service estimate only. Official settlement is calculated by HR using the approved company rules.
            </Text>
          </>
        ) : null}
      </ScrollView>
    </ScreenContainer>
  );
};

const styles = StyleSheet.create({
  scroll: { padding: 12, paddingBottom: 28 },
  stateBox: { paddingVertical: 40, alignItems: 'center', gap: 10 },
  stateText: { fontSize: 13 },
  errorText: { fontSize: 13 },
  card: { borderRadius: 14, padding: 14, marginBottom: 12, borderWidth: 1, borderColor: '#E2E8F0' },
  sectionTitle: { fontSize: 15, fontWeight: '800', marginBottom: 8, marginTop: 4 },
  cardHead: { fontSize: 13.5, fontWeight: '800', marginBottom: 8 },

  identityRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8, marginBottom: 10 },
  identityName: { flex: 1, fontSize: 15.5, fontWeight: '800' },
  paycodeChip: { paddingHorizontal: 10, paddingVertical: 3, borderRadius: 999, borderWidth: 1 },
  paycodeText: { fontSize: 11.5, fontWeight: '800' },

  staticRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingVertical: 8, borderTopWidth: 1, borderTopColor: '#EEE', gap: 10 },
  rowLabel: { fontSize: 12.5 },
  rowValue: { fontSize: 12.5, fontWeight: '700', flex: 1, textAlign: 'right' },
  readOnlyHint: { fontSize: 10.5, marginTop: 3 },
  inputLabel: { fontSize: 12.5, fontWeight: '700', marginTop: 12 },
  dateInput: {
    borderWidth: 1, borderRadius: 10, paddingHorizontal: 12, paddingVertical: 9,
    fontSize: 13.5, marginTop: 4,
  },
  warnText: { fontSize: 11, marginTop: 6 },

  pendingBanner: { flexDirection: 'row', alignItems: 'center', gap: 8, padding: 10, borderRadius: 10, borderWidth: 1 },
  pendingText: { flex: 1, fontSize: 11.5, fontWeight: '700' },
  ruleList: { marginTop: 10, gap: 6 },
  ruleRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8 },
  ruleLabel: { fontSize: 12 },
  ruleValue: { fontSize: 10.5 },

  periodRow: { flexDirection: 'row', gap: 8 },
  periodBox: { flex: 1, alignItems: 'center', paddingVertical: 10, borderRadius: 10, borderWidth: 1 },
  periodValue: { fontSize: 20, fontWeight: '800' },
  periodLabel: { fontSize: 10.5, marginTop: 2, fontWeight: '600' },
  pendingLine: { fontSize: 11.5 },

  salaryNote: { padding: 10, borderRadius: 10, borderWidth: 1, marginBottom: 12 },
  salaryNoteText: { fontSize: 11.5, fontWeight: '700' },

  amountRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingVertical: 8, borderTopWidth: 1, borderTopColor: '#EEE' },
  amountLabel: { fontSize: 12.5 },
  amountValue: { fontSize: 13, fontWeight: '800' },

  totalRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  totalLabel: { fontSize: 13.5, fontWeight: '800' },
  totalValue: { fontSize: 17, fontWeight: '800' },
  totalNote: { fontSize: 10.5, marginTop: 6 },

  footnote: { fontSize: 10.5, textAlign: 'center', marginTop: 10 },
});

export default EmployeeGratuityScreen;