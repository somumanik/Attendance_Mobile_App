// ============================================================================
// FILE: mobile/src/screens/hr/HRAuditScreen.jsx
// PURPOSE: Single Employee Audit - real monthly attendance audit for one employee
// ============================================================================

/**
 * Mobile equivalent of the desktop "Single Employee Audit".
 *
 * Navigation Flow:
 * HRNavigator (Audit Tab) → HRAuditScreen
 *   → employee search (real roster)
 *   → select employee (paycode)
 *   → Employee Attendance Audit
 *
 * Data Flow (existing endpoints, no new business logic):
 * GET /api/employees?search=...        -> real employee search (same source as All Employees)
 * GET /api/hr/audit/:paycode?month=YYYY-MM -> existing audit endpoint used by the desktop
 *   -> { employee, stats, attendance[], lateDetails[], graceRemaining }
 *
 * Summary values, attendance classification, late/grace handling are rendered
 * exactly as the existing backend already returns them (no frontend calculations).
 */

import React, { useState, useEffect, useCallback, useRef } from 'react';
import { View, Text, ScrollView, StyleSheet, TextInput, TouchableOpacity, ActivityIndicator } from 'react-native';
import { COLORS, TYPOGRAPHY, SPACING, SHADOWS } from '../../utils/colors';
import { ScreenContainer } from '../../components/ScreenContainer';
import { api } from '../../services/api';

const clean = (v) => String(v == null ? '' : v).trim();

const currentMonth = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
};

const dayName = (iso) => {
  const s = clean(iso);
  if (s.length < 10) return '';
  const d = new Date(`${s.slice(0, 10)}T00:00:00`);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleDateString('en-IN', { weekday: 'short' });
};

const shortDate = (iso) => {
  const s = clean(iso);
  if (s.length < 10) return '—';
  const d = new Date(`${s.slice(0, 10)}T00:00:00`);
  if (Number.isNaN(d.getTime())) return s.slice(0, 10);
  return d.toLocaleDateString('en-IN', { day: '2-digit', month: 'short' });
};

// Grace labels mirror the existing desktop audit rendering.
const graceLabel = (d) => {
  if (d.isFinalLate) return d.graceUsed === null || d.graceUsed === undefined ? 'No grace — FINAL LATE' : '';
  if (d.graceUsed === '30min') return 'Covered by 30-min grace';
  if (d.graceUsed === '1hr') return 'Covered by 1-hr grace';
  if (d.graceUsed === '2hr') return 'Covered by 2-hr grace';
  return 'Grace applied';
};

export const HRAuditScreen = ({ route }) => {
  const presetPaycode = clean(route?.params?.paycode);

  const [search, setSearch] = useState('');
  const [results, setResults] = useState([]);
  const [searching, setSearching] = useState(false);
  const [selected, setSelected] = useState(null);
  const [audit, setAudit] = useState(null);
  const [loadingAudit, setLoadingAudit] = useState(false);
  const [error, setError] = useState(null);
  const timer = useRef(null);
  // First active employee in A -> Z order (loaded from the real employee API).
  const defaultEmployee = useRef(null);

  // Load the existing audit endpoint for the selected employee.
  const loadAudit = useCallback(async (employee) => {
    setSelected(employee);
    setLoadingAudit(true);
    setError(null);
    try {
      const data = await api.get(`/hr/audit/${encodeURIComponent(clean(employee.paycode))}`, { month: currentMonth() });
      setAudit(data);
    } catch (err) {
      setAudit(null);
      setError(err?.message || 'Attendance audit load nahi ho paya.');
    } finally {
      setLoadingAudit(false);
    }
  }, []);

  // Load every active employee through the existing /api/employees endpoint
  // (same paging pattern as the All Employees screen) and keep the first one
  // in alphabetical order by real employee name. Inactive employees are excluded
  // by the existing active=Y rule already used by the rest of the app.
  const loadDefaultEmployee = useCallback(async () => {
    try {
      const all = [];
      for (let p = 1; p <= 50; p += 1) {
        const data = await api.get('/employees', { page: p, pageSize: 100, active: 'Y' });
        const batch = Array.isArray(data?.rows) ? data.rows : [];
        all.push(...batch);
        if (batch.length < 100) break;
      }
      const first = all
        .slice()
        .sort((a, b) => clean(a.empname).localeCompare(clean(b.empname), undefined, { sensitivity: 'base' }))[0];
      defaultEmployee.current = first || null;
      if (first) await loadAudit(first);
    } catch (err) {
      setError(err?.message || 'Employee list load nahi ho paya.');
    }
  }, [loadAudit]);

  // On tab open, show the first active employee's audit automatically.
  useEffect(() => {
    if (presetPaycode) return; // deep-linked employee wins
    loadDefaultEmployee();
  }, [presetPaycode, loadDefaultEmployee]);

  // Real employee search against the same /api/employees source used elsewhere.
  useEffect(() => {
    if (timer.current) clearTimeout(timer.current);
    const term = search.trim();
    if (term.length < 2) {
      setResults([]);
      setSearching(false);
      // Clearing the search returns to the first active employee (A -> Z).
      if (!term && defaultEmployee.current && clean(selected?.paycode) !== clean(defaultEmployee.current.paycode)) {
        loadDefaultEmployee();
      }
      return;
    }
    setSearching(true);
    timer.current = setTimeout(async () => {
      try {
        const data = await api.get('/employees', { search: term, page: 1, pageSize: 12, active: 'Y' });
        setResults(Array.isArray(data?.rows) ? data.rows : []);
        setError(null);
      } catch (err) {
        setResults([]);
        setError(err?.message || 'Employee search failed.');
      } finally {
        setSearching(false);
      }
    }, 300);
    return () => { if (timer.current) clearTimeout(timer.current); };
  }, [search, selected, loadDefaultEmployee]);

  // Deep link support: if the tab is opened with a paycode, load it directly.
  useEffect(() => {
    if (!presetPaycode || selected) return;
    loadAudit({ paycode: presetPaycode, empname: '' });
  }, [presetPaycode, selected, loadAudit]);

  const stats = audit?.stats || {};
  const attendance = Array.isArray(audit?.attendance) ? audit.attendance : [];
  const lateDetails = Array.isArray(audit?.lateDetails) ? audit.lateDetails : [];
  const grace = audit?.graceRemaining || {};
  const emp = audit?.employee || selected || {};

  return (
    <ScreenContainer title="Single Employee Audit" showHeader={true}>
      <ScrollView contentContainerStyle={styles.scrollContent} keyboardShouldPersistTaps="handled">
        {/* Employee search */}
        <View style={styles.searchCard}>
          <Text style={[styles.sectionTitle, TYPOGRAPHY.h4]}>Employee</Text>
          <TextInput
            style={styles.searchInput}
            placeholder="Search name, paycode or card no..."
            placeholderTextColor={COLORS.textTertiary}
            value={search}
            onChangeText={setSearch}
            autoCapitalize="characters"
          />
          {searching ? <Text style={styles.hint}>Searching...</Text> : null}
          {!searching && search.trim().length >= 2 && results.length === 0 ? (
            <Text style={styles.hint}>Koi employee nahi mila.</Text>
          ) : null}
          {results.map((e) => (
            <TouchableOpacity
              key={clean(e.paycode)}
              style={styles.resultRow}
              onPress={() => loadAudit(e)}
              activeOpacity={0.85}
            >
              <View style={styles.resultText}>
                <Text style={styles.resultName} numberOfLines={1}>{clean(e.empname)}</Text>
                <Text style={styles.resultMeta} numberOfLines={1}>
                  {clean(e.paycode)} • {clean(e.departmentname || e.departmentcode)} • {clean(e.designation)}
                </Text>
              </View>
              <Text style={styles.resultAction}>Audit</Text>
            </TouchableOpacity>
          ))}
        </View>

        {loadingAudit ? (
          <View style={styles.stateBox}>
            <ActivityIndicator size="large" color={COLORS.primary} />
            <Text style={styles.hint}>Loading attendance audit...</Text>
          </View>
        ) : null}

        {!loadingAudit && error ? (
          <View style={styles.errorBox}>
            <Text style={styles.errorText}>⚠️ {error}</Text>
          </View>
        ) : null}

        {!loadingAudit && audit?.employee ? (
          <View>
            {/* Employee summary */}
            <View style={styles.card}>
              <Text style={styles.name}>{clean(audit.employee.empname)}</Text>
              <Text style={styles.meta}>
                {clean(audit.employee.designation)} • {clean(audit.employee.departmentname || audit.employee.departmentcode)}
              </Text>
              <Text style={styles.meta}>
                Paycode {clean(audit.employee.paycode)} | Card {clean(audit.employee.presentcardno)} | Company {clean(audit.employee.companyname || audit.employee.companycode)}
              </Text>
            </View>

            {/* Attendance summary - values come from the existing backend stats */}
            <View style={styles.statsRow}>
              {[
                { label: 'Present', value: stats.present, color: COLORS.success },
                { label: 'Absent', value: stats.absent, color: COLORS.error },
                { label: 'Miss Punch', value: stats.miss, color: COLORS.warning },
                { label: 'Late Coming', value: stats.late, color: COLORS.primary },
                { label: 'Hours', value: stats.hours, color: COLORS.info },
              ].map((s) => (
                <View key={s.label} style={styles.statBox}>
                  <Text style={[styles.statValue, { color: s.color }]}>{Number(s.value || 0)}</Text>
                  <Text style={styles.statLabel}>{s.label}</Text>
                </View>
              ))}
            </View>

            {/* Late arrival details + monthly grace (existing audit data) */}
            {lateDetails.length > 0 || grace.grace30min !== undefined ? (
              <View style={styles.card}>
                <Text style={[styles.sectionTitle, TYPOGRAPHY.h4]}>Late Arrival Details (Monthly Grace Consumption)</Text>

                {lateDetails.length > 0 ? (
                  <View style={styles.lateList}>
                    {lateDetails.map((d, i) => (
                      <View
                        key={`late-${i}`}
                        style={[styles.lateRow, d.isFinalLate ? styles.lateRowFinal : styles.lateRowGrace]}
                      >
                        <Text style={styles.lateDate}>{shortDate(d.date)}</Text>
                        <Text style={styles.lateIn}>{clean(d.inTime).slice(11, 16) || '—'}</Text>
                        <Text style={[styles.lateLabel, d.isFinalLate ? styles.lateFinalText : styles.lateGraceText]}>
                          {graceLabel(d)}
                        </Text>
                        {Number(d.lateMinutes || 0) > 0 ? (
                          <Text style={styles.lateMinutes}>+{Number(d.lateMinutes)}m late</Text>
                        ) : null}
                      </View>
                    ))}
                  </View>
                ) : (
                  <Text style={styles.hint}>No late occurrences this month</Text>
                )}

                {grace.grace30min !== undefined ? (
                  <View style={styles.graceBox}>
                    <Text style={styles.graceTitle}>Monthly Staff Grace Used</Text>
                    <View style={styles.graceRow}>
                      <Text style={styles.graceLabel}>30-min grace (2 per month)</Text>
                      <Text style={styles.graceValue}>{2 - Number(grace.grace30min || 0)}/2</Text>
                    </View>
                    <View style={styles.graceRow}>
                      <Text style={styles.graceLabel}>1-hr grace (1 per month)</Text>
                      <Text style={styles.graceValue}>{1 - Number(grace.grace1hr || 0)}/1</Text>
                    </View>
                    <View style={styles.graceRow}>
                      <Text style={styles.graceLabel}>2-hr grace (1 per month)</Text>
                      <Text style={styles.graceValue}>{1 - Number(grace.grace2hr || 0)}/1</Text>
                    </View>
                  </View>
                ) : null}
              </View>
            ) : null}

            {/* Full current month attendance */}
            <View style={styles.card}>
              <Text style={[styles.sectionTitle, TYPOGRAPHY.h4]}>
                Attendance Details ({attendance.length} records)
              </Text>
              {attendance.length === 0 ? (
                <Text style={styles.hint}>No attendance records for this month.</Text>
              ) : null}
              {attendance.map((r, i) => {
                const status = r.statusLabel || r.computedStatus || r.status || '';
                const isBad = /absent|miss/i.test(status);
                return (
                  <View key={`att-${i}`} style={styles.attRow}>
                    <View style={styles.attLeft}>
                      <Text style={styles.attDate}>{shortDate(r.date || r.dateoffice)}</Text>
                      <Text style={styles.attDay}>{dayName(r.date || r.dateoffice)}</Text>
                    </View>
                    <View style={styles.attMid}>
                      <Text style={styles.attIn}>{r.inTime || r.in1 || '—'}</Text>
                      <Text style={styles.attOut}>{r.outTime || r.out1 || '—'}</Text>
                    </View>
                    <Text style={styles.attHrs}>{Number(r.hoursworked || 0)}h</Text>
                    <View style={[styles.attStatus, isBad ? styles.attStatusBad : styles.attStatusOk]}>
                      <Text style={[styles.attStatusText, { color: isBad ? COLORS.error : COLORS.success }]} numberOfLines={1}>
                        {status}
                      </Text>
                    </View>
                  </View>
                );
              })}
            </View>
          </View>
        ) : null}

        {!loadingAudit && !audit?.employee && !search.trim() ? (
          <Text style={styles.hintCenter}>Search an employee to view the monthly attendance audit.</Text>
        ) : null}
      </ScrollView>
    </ScreenContainer>
  );
};

const styles = StyleSheet.create({
  scrollContent: { paddingHorizontal: SPACING.lg, paddingBottom: SPACING.xxl, gap: SPACING.md },
  searchCard: {
    backgroundColor: COLORS.surface,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: COLORS.border,
    padding: SPACING.md,
    gap: SPACING.sm,
  },
  searchInput: {
    backgroundColor: COLORS.surfaceVariant,
    borderWidth: 1,
    borderColor: COLORS.border,
    borderRadius: 10,
    paddingHorizontal: SPACING.md,
    paddingVertical: SPACING.sm,
    color: COLORS.textPrimary,
  },
  hint: { fontSize: 12, color: COLORS.textSecondary },
  hintCenter: { fontSize: 13, color: COLORS.textTertiary, textAlign: 'center', marginTop: SPACING.lg },
  resultRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: SPACING.sm,
    paddingVertical: SPACING.sm,
    borderTopWidth: 1,
    borderTopColor: COLORS.divider,
  },
  resultText: { flex: 1, minWidth: 0 },
  resultName: { fontSize: 14, fontWeight: '600', color: COLORS.textPrimary },
  resultMeta: { fontSize: 11, color: COLORS.textSecondary },
  resultAction: { fontSize: 12, fontWeight: '700', color: COLORS.primary },
  stateBox: { alignItems: 'center', paddingVertical: SPACING.xl, gap: SPACING.sm },
  errorBox: {
    backgroundColor: `${COLORS.error}15`,
    borderWidth: 1,
    borderColor: `${COLORS.error}30`,
    borderRadius: 10,
    padding: SPACING.md,
  },
  errorText: { fontSize: 12, color: COLORS.error, textAlign: 'center' },
  card: {
    backgroundColor: COLORS.surface,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: COLORS.border,
    padding: SPACING.md,
    gap: SPACING.xs,
  },
  name: { fontSize: 18, fontWeight: '700', color: COLORS.textPrimary },
  meta: { fontSize: 11, color: COLORS.textSecondary },
  statsRow: { flexDirection: 'row', flexWrap: 'wrap', gap: SPACING.sm },
  statBox: {
    flexGrow: 1,
    minWidth: 64,
    alignItems: 'center',
    paddingVertical: SPACING.sm,
    paddingHorizontal: SPACING.sm,
    borderRadius: 10,
    backgroundColor: COLORS.surfaceVariant,
  },
  statValue: { fontSize: 18, fontWeight: '700' },
  statLabel: { fontSize: 10, color: COLORS.textSecondary, textTransform: 'uppercase' },
  sectionTitle: { color: COLORS.textPrimary, marginBottom: SPACING.xs },
  lateList: { gap: 4 },
  lateRow: { flexDirection: 'row', alignItems: 'center', gap: SPACING.sm, padding: 6, borderRadius: 8, borderWidth: 1 },
  lateRowFinal: { backgroundColor: `${COLORS.error}12`, borderColor: `${COLORS.error}33` },
  lateRowGrace: { backgroundColor: `${COLORS.success}12`, borderColor: `${COLORS.success}33` },
  lateDate: { width: 52, fontSize: 11, color: COLORS.textPrimary },
  lateIn: { width: 44, fontSize: 11, color: COLORS.textSecondary },
  lateLabel: { flex: 1, fontSize: 10, fontWeight: '700' },
  lateFinalText: { color: COLORS.error },
  lateGraceText: { color: COLORS.success },
  lateMinutes: { fontSize: 10, color: COLORS.error },
  graceBox: { marginTop: SPACING.sm, gap: 4 },
  graceTitle: { fontSize: 11, fontWeight: '700', color: COLORS.warning },
  graceRow: { flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 4, paddingHorizontal: 6, borderRadius: 6, backgroundColor: COLORS.surfaceVariant },
  graceLabel: { fontSize: 11, color: COLORS.textSecondary },
  graceValue: { fontSize: 11, fontWeight: '700', color: COLORS.textPrimary },
  attRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: SPACING.sm,
    paddingVertical: 7,
    borderTopWidth: 1,
    borderTopColor: COLORS.divider,
  },
  attLeft: { width: 76 },
  attDate: { fontSize: 11, color: COLORS.textPrimary, fontWeight: '600' },
  attDay: { fontSize: 10, color: COLORS.textTertiary },
  attMid: { flex: 1, flexDirection: 'row', gap: SPACING.sm },
  attIn: { fontSize: 11, color: COLORS.success },
  attOut: { fontSize: 11, color: COLORS.error },
  attHrs: { fontSize: 11, color: COLORS.textPrimary, fontWeight: '600', width: 40, textAlign: 'right' },
  attStatus: { paddingHorizontal: 8, paddingVertical: 3, borderRadius: 10, maxWidth: 84 },
  attStatusOk: { backgroundColor: `${COLORS.success}18` },
  attStatusBad: { backgroundColor: `${COLORS.error}18` },
  attStatusText: { fontSize: 10, fontWeight: '700' },
});

export default HRAuditScreen;
