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
 * SALARY & FORMULAS (Phase K):
 * Salary now comes from an APPROVED application-owned source (dbo.HR_SalaryMaster
 * / dbo.HR_SalaryElement, imported + validated by HR). Every settlement rule is
 * configurable server-side and is displayed as readable basis text next to each
 * amount. When salary is not imported for this employee the screen still shows
 * the truthful "not available" state - it invents no figure of any kind.
 *
 * The calculation area stays split into INPUTS / RULES / RESULTS. "Proposed
 * Leaving Date", "Notice Served Days" and "Notice Waived" are ESTIMATION INPUTS
 * only - they are sent to the server for the estimate and never saved anywhere.
 *
 * The result is ALWAYS labelled an estimate - never a final, legally approved
 * settlement.
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
import { getMyFullFinal } from '../../services/salary';

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

/** Configured rule basis text per component (Phase K). */
const RULE_TEXT = (rules, id) => {
  if (!rules) return '';
  switch (id) {
    case 'gratuity': return rules.gratuity?.basisText;
    case 'bonus': return rules.bonus?.basisText;
    case 'leaveEncashment': return rules.leaveEncashment?.basisText;
    case 'noticePay': return rules.notice?.basisText;
    case 'otherDues':
    case 'otherRecoveries': return 'HR-approved entries (Salary > Dues tab)';
    default: return '';
  }
};

const money = (v) => (v === null || v === undefined || v === '' || Number.isNaN(Number(v)))
  ? PENDING : `₹ ${Number(v).toLocaleString('en-IN', { maximumFractionDigits: 2 })}`;

/** Real per-component amount + basis from the server estimate (Phase K). */
const COMPONENT_VALUE = (estimate, id) => {
  if (!estimate) return null;
  switch (id) {
    case 'gratuity': return { value: estimate.gratuity?.amount || 0, basis: estimate.gratuity?.basisText };
    case 'bonus': return { value: estimate.bonus?.amount || 0, basis: estimate.bonus?.basisText || estimate.bonus?.note };
    case 'leaveEncashment': return { value: estimate.leaveEncashment?.amount || 0, basis: estimate.leaveEncashment?.basisText };
    case 'noticePay': return { value: estimate.notice?.payAmount || 0, basis: estimate.notice?.basisText };
    case 'otherDues': return { value: estimate.otherDues?.total || 0, basis: 'approved dues' };
    case 'otherRecoveries': return { value: -(estimate.otherRecoveries?.total || 0), negative: true, basis: 'approved recoveries' };
    default: return null;
  }
};

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
  const [noticeServed, setNoticeServed] = useState('');
  const [noticeWaived, setNoticeWaived] = useState(false);
  const [result, setResult] = useState(null);
  const [calculating, setCalculating] = useState(false);

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

  /**
   * Runs the SERVER-side estimate with the estimation inputs. The server
   * resolves salary/rules and returns every component with its basis. Nothing
   * is persisted - the inputs stay in this screen's state.
   */
  const calculate = async () => {
    if (!emp || !partsOf(leavingDate)) return;
    setCalculating(true);
    try {
      const res = await getMyFullFinal({
        leavingdate: leavingDate,
        noticeServedDays: clean(noticeServed) || undefined,
        noticeWaived,
      });
      setData(res);
      const sp = res?.estimate?.servicePeriod || servicePeriod(emp.dateofjoin, leavingDate);
      setResult(sp ? { period: sp, leavingDate } : { period: null, leavingDate, invalid: true });
    } catch (e) {
      setResult({ period: null, leavingDate, invalid: true });
    } finally {
      setCalculating(false);
    }
  };

  const reset = () => { setResult(null); setLeavingDate(''); setNoticeServed(''); setNoticeWaived(false); };

  const estimate = data ? data.estimate : null;
  const rules = data ? data.rules : null;
  const period = estimate?.servicePeriod || (result ? result.period : null);
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
            <Text style={[styles.errorText, { color: theme.error }]}><Ionicons name="alert-circle" size={13} /> {error}</Text>
            <Button title="Retry" onPress={() => load(false)} variant="outline" size="small" style={{ marginTop: 12 }} />
          </Card>
        ) : null}

        {!isLoading && !error && emp ? (
          <>
            {/* ---------------- 1. INPUTS ---------------- */}
            <Text style={[styles.sectionTitle, { color: theme.textPrimary }]}>Full &amp; Final Estimate</Text>

            <Card style={styles.card}>
              <View style={styles.identityRow}>
                <Text style={[styles.identityName, { color: theme.textPrimary }]} numberOfLines={2}>{clean(emp.empname) || PLACEHOLDER}</Text>
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
                <Text style={[styles.rowValue, { color: theme.textPrimary }]}>
                  {clean(emp.departmentname || emp.departmentcode) || PLACEHOLDER}
                </Text>
              </View>
              <View style={[styles.staticRow, { borderColor: theme.border }]}>
                <Text style={[styles.rowLabel, { color: theme.textSecondary }]}>Designation</Text>
                <Text style={[styles.rowValue, { color: theme.textPrimary }]}>
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

              {/* Notice estimation inputs (Phase K) - also local-only. */}
              <Text style={[styles.inputLabel, { color: theme.textSecondary }]}>Notice Served Days (optional)</Text>
              <TextInput
                style={[styles.dateInput, { color: theme.textPrimary, borderColor: theme.border }]}
                value={noticeServed}
                onChangeText={setNoticeServed}
                placeholder="e.g. 30"
                placeholderTextColor={theme.textTertiary}
                keyboardType="number-pad"
              />
              <Text style={[styles.readOnlyHint, { color: theme.textTertiary }]}>
                Blank = notice calculation skip hoti hai. Company notice period rules section me dikhte hain.
              </Text>

              <TouchableOpacity
                style={{ flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 10 }}
                onPress={() => setNoticeWaived(!noticeWaived)}
              >
                <Ionicons name={noticeWaived ? 'checkbox' : 'square-outline'} size={18} color={noticeWaived ? theme.primary : theme.textTertiary} />
                <Text style={{ fontSize: 12, color: theme.textSecondary, flex: 1 }}>
                  Employer waived the unserved notice (payable instead of recovery)
                </Text>
              </TouchableOpacity>

              <Button
                title={calculating ? 'Calculating...' : 'Calculate Estimate'}
                onPress={calculate}
                disabled={!inputReady || calculating}
                size="small"
                style={{ marginTop: 12 }}
              />
              {result && result.invalid ? (
                <Text style={[styles.warnText, { color: theme.error }]}>
                  <Ionicons name="alert-circle" size={13} /> Proposed leaving date is before your joining date.
                </Text>
              ) : null}
            </Card>

            {/* ---------------- 2. RULES ---------------- */}
            <Text style={[styles.sectionTitle, { color: theme.textPrimary }]}>Calculation Rules</Text>
            <Card style={styles.card}>
              {!rules ? (
                <View style={[styles.pendingBanner, { backgroundColor: `${theme.warning}15`, borderColor: `${theme.warning}44` }]}>
                  <Ionicons name="information-circle" size={16} color={theme.warning} />
                  <Text style={[styles.pendingText, { color: theme.warning }]}>{pendingMessage}</Text>
                </View>
              ) : null}
              <View style={styles.ruleList}>
                {COMPONENTS.map((c) => (
                  // Stacked label / description layout: the label stays clearly
                  // readable on its own line and the rule text wraps naturally
                  // below it - long basis descriptions can never run into the
                  // label or clip on narrow screens (presentation only).
                  <View key={c.id} style={[styles.ruleRow, { borderColor: theme.border }]}>
                    <Text style={[styles.ruleLabel, { color: theme.textPrimary }]}>{c.label}</Text>
                    <Text style={[styles.ruleValue, { color: rules ? theme.textSecondary : theme.textTertiary }]}>
                      {rules ? (RULE_TEXT(rules, c.id) || c.rule) : `${c.rule} — not configured`}
                    </Text>
                  </View>
                ))}
                {rules ? (
                  <>
                    <View style={[styles.ruleRow, { borderColor: theme.border }]}>
                      <Text style={[styles.ruleLabel, { color: theme.textPrimary }]}>PF</Text>
                      <Text style={[styles.ruleValue, { color: theme.textSecondary }]}>{rules.pf?.basisText}</Text>
                    </View>
                    <View style={[styles.ruleRow, { borderColor: theme.border }]}>
                      <Text style={[styles.ruleLabel, { color: theme.textPrimary }]}>ESI</Text>
                      <Text style={[styles.ruleValue, { color: theme.textSecondary }]}>{rules.esi?.basisText}</Text>
                    </View>
                  </>
                ) : null}
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
            ) : (
              <View style={[styles.salaryNote, { backgroundColor: `${theme.primary}12`, borderColor: `${theme.primary}33` }]}>
                <Text style={[styles.salaryNoteText, { color: theme.primary }]}>
                  {`Salary used: Basic ${money(salary.basic)} · Gross ${money(salary.gross)} (effective ${longDate(salary.effectivefrom)})`}
                </Text>
              </View>
            )}

            <Card style={styles.card}>
              <Text style={[styles.cardHead, { color: theme.textPrimary }]}>Settlement Components</Text>
              {COMPONENTS.map((c) => {
                const line = COMPONENT_VALUE(estimate, c.id);
                return (
                  <View key={c.id} style={[styles.amountRow, { borderColor: theme.border }]}>
                    <View style={styles.amountLabelCol}>
                      <Text style={[styles.amountLabel, { color: theme.textSecondary }]}>{c.label}</Text>
                      {line && line.basis ? (
                        <Text style={[styles.amountBasis, { color: theme.textTertiary }]}>{line.basis}</Text>
                      ) : null}
                    </View>
                    <Text style={[styles.amountValue, { color: line ? (line.negative ? theme.error : theme.textPrimary) : theme.textTertiary }]}>
                      {line ? money(line.value) : PENDING}
                    </Text>
                  </View>
                );
              })}
              {estimate ? (
                <>
                  <View style={[styles.amountRow, { borderColor: theme.border }]}>
                    <View style={styles.amountLabelCol}>
                      <Text style={[styles.amountLabel, { color: theme.textSecondary }]}>Employee Deductions</Text>
                      <Text style={[styles.amountBasis, { color: theme.textTertiary }]}>pay elements + employee PF/ESI</Text>
                    </View>
                    <Text style={[styles.amountValue, { color: theme.error }]}>{money(-(estimate.employeeDeductions?.total || 0))}</Text>
                  </View>
                  <View style={[styles.amountRow, { borderColor: theme.border }]}>
                    <View style={styles.amountLabelCol}>
                      <Text style={[styles.amountLabel, { color: theme.textSecondary }]}>Employer Contributions (info only)</Text>
                      <Text style={[styles.amountBasis, { color: theme.textTertiary }]}>NOT part of the payable estimate</Text>
                    </View>
                    <Text style={[styles.amountValue, { color: theme.textSecondary }]}>{money(estimate.employerContributions?.total || 0)}</Text>
                  </View>
                </>
              ) : null}
            </Card>

            <Card style={[styles.card, { borderColor: `${theme.primary}44` }]}>
              <View style={styles.totalRow}>
                <Text style={[styles.totalLabel, { color: theme.textPrimary }]}>Estimated Full &amp; Final</Text>
                <Text style={[styles.totalValue, { color: estimate ? theme.primary : theme.textTertiary }]}>
                  {estimate ? money(estimate.estimatedTotal) : PENDING}
                </Text>
              </View>
              <Text style={[styles.totalNote, { color: theme.textTertiary }]}>
                {estimate ? estimate.formula : pendingMessage}
              </Text>
              {estimate ? (
                <Text style={[styles.totalNote, { color: theme.textTertiary }]}>{estimate.disclaimer}</Text>
              ) : null}
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
  // Bottom padding clears the bottom navigation / gesture bar on every device,
  // so "Estimated Full & Final" and the footnote can always be scrolled to.
  scroll: { padding: 12, paddingBottom: 36 },
  stateBox: { paddingVertical: 40, alignItems: 'center', gap: 10 },
  stateText: { fontSize: 13 },
  errorText: { fontSize: 13 },
  card: { borderRadius: 14, padding: 14, marginBottom: 12, borderWidth: 1, borderColor: '#E2E8F0' },
  sectionTitle: { fontSize: 15, fontWeight: '800', marginBottom: 8, marginTop: 4 },
  cardHead: { fontSize: 13.5, fontWeight: '800', marginBottom: 8 },

  identityRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8, marginBottom: 10 },
  identityName: { flex: 1, minWidth: 0, fontSize: 15.5, fontWeight: '800', lineHeight: 20 },
  paycodeChip: { paddingHorizontal: 10, paddingVertical: 3, borderRadius: 999, borderWidth: 1 },
  paycodeText: { fontSize: 11.5, fontWeight: '800' },

  staticRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingVertical: 8, borderTopWidth: 1, borderTopColor: '#EEE', gap: 10 },
  rowLabel: { fontSize: 12.5, flexShrink: 0 },
  // Values wrap across lines (never clipped/truncated) and stay right-aligned.
  rowValue: { fontSize: 12.5, fontWeight: '700', flex: 1, minWidth: 0, textAlign: 'right' },
  readOnlyHint: { fontSize: 10.5, marginTop: 3 },
  inputLabel: { fontSize: 12.5, fontWeight: '700', marginTop: 12 },
  dateInput: {
    borderWidth: 1, borderRadius: 10, paddingHorizontal: 12, paddingVertical: 9,
    fontSize: 13.5, marginTop: 4,
  },
  warnText: { fontSize: 11, marginTop: 6 },

  pendingBanner: { flexDirection: 'row', alignItems: 'center', gap: 8, padding: 10, borderRadius: 10, borderWidth: 1 },
  pendingText: { flex: 1, fontSize: 11.5, fontWeight: '700', lineHeight: 16 },
  // Calculation Rules: stacked label / description rows with divider lines.
  // The description gets the full row width and wraps across as many lines as
  // it needs - no fixed heights, no truncation, no horizontal overflow.
  ruleList: { marginTop: 4 },
  ruleRow: { paddingVertical: 10, borderTopWidth: 1, gap: 3 },
  ruleLabel: { fontSize: 12.5, fontWeight: '700', lineHeight: 17 },
  ruleValue: { fontSize: 11, lineHeight: 16, flexShrink: 1 },

  periodRow: { flexDirection: 'row', gap: 8 },
  periodBox: { flex: 1, alignItems: 'center', paddingVertical: 10, borderRadius: 10, borderWidth: 1 },
  periodValue: { fontSize: 20, fontWeight: '800' },
  periodLabel: { fontSize: 10.5, marginTop: 2, fontWeight: '600' },
  pendingLine: { fontSize: 11.5 },

  salaryNote: { padding: 10, borderRadius: 10, borderWidth: 1, marginBottom: 12 },
  salaryNoteText: { fontSize: 11.5, fontWeight: '700' },

  amountRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingVertical: 10, borderTopWidth: 1, gap: 10 },
  amountLabelCol: { flex: 1, minWidth: 0 },
  amountLabel: { fontSize: 12.5, fontWeight: '600', lineHeight: 17 },
  // Monetary values stay right-aligned and on one line; the label column
  // (flex: 1 in the JSX) absorbs wrapping so amounts never get pushed off.
  amountValue: { fontSize: 13, fontWeight: '800', flexShrink: 0, textAlign: 'right' },
  amountBasis: { fontSize: 10, marginTop: 2, lineHeight: 14, flexShrink: 1 },

  totalRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 10 },
  totalLabel: { fontSize: 13.5, fontWeight: '800', flexShrink: 1 },
  totalValue: { fontSize: 17, fontWeight: '800', flexShrink: 0, textAlign: 'right' },
  totalNote: { fontSize: 10.5, marginTop: 8, lineHeight: 15 },

  footnote: { fontSize: 10.5, textAlign: 'center', marginTop: 12, lineHeight: 15 },
});

export default EmployeeGratuityScreen;