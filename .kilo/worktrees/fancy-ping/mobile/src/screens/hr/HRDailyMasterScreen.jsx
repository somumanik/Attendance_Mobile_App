// ============================================================================
// FILE: mobile/src/screens/hr/HRDailyMasterScreen.jsx
// PURPOSE: HR Daily Master Report - per-employee daily attendance for one date
// ============================================================================

/**
 * Mobile Daily Master Report — website-matched functionality, phone-friendly UI.
 *
 * Navigation Flow:
 * HRNavigator (Daily Master Tab) -> HRDailyMasterScreen
 *
 * Data Flow (existing endpoints only, no new business logic):
 * GET /api/hr/daily-master?fromDate=<date>&toDate=<date>
 *   -> [ { paycode, empname, departmentcode, date, inTime, outTime,
 *           hoursworked, latearrival, status, statusCode, statusLabel,
 *           computedStatus, isLate, reason, graceUsed } ]
 * GET /api/hr/filters -> { departments:[{code,name}] } (dbo.tbldepartment lookup)
 *
 * This is the SAME endpoint the desktop website calls (index.html -> /hr/daily)
 * with the SAME parameters, so both surfaces always show the same records.
 * Every value on screen is rendered exactly as the backend returns it:
 *   - IN / OUT      -> row.inTime / row.outTime (already formatted IST by backend)
 *   - Worked        -> row.hoursworked (minutes, as stored and as the website shows)
 *   - Status        -> row.computedStatus (Present / Absent / Miss Punch / Week Off
 *                      / Half Day / No Record ...), coloured via the shared
 *                      getStatusColor(statusCode) helper
 *   - Employee id   -> row.paycode (tblemployee.paycode identity, same as the
 *                      All Employees roster and Executive Overview)
 *   - Department    -> resolved from the real tbldepartment name via /hr/filters,
 *                      the same mapping the Analytics tab already uses
 *
 * Employee population: the backend's default `active=Y`, which is exactly what the
 * website Daily Master gets (it calls /hr/daily without an `active` param). No
 * frontend active/inactive filtering is applied here.
 *
 * One row per employee: the backend already returns exactly one record per
 * tblemployee row for the date (OUTER APPLY over tbltimeregister), so no duplicate
 * punch rows reach the UI and nothing is hidden here to fake it.
 *
 * Export mirrors the website's daily-master export: CSV with
 * Paycode, Name, Department, In, Out, Hours, Status and the file name
 * `daily-master-<selected date>`.
 */

import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { View, Text, ScrollView, StyleSheet, TouchableOpacity, TextInput, RefreshControl, ActivityIndicator } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { COLORS, TYPOGRAPHY, SPACING, SHADOWS } from '../../utils/colors';
import { getStatusColor } from '../../utils/format';
import { ScreenContainer } from '../../components/ScreenContainer';
import { Button } from '../../components/Button';
import { api } from '../../services/api';

const clean = (v) => String(v == null ? '' : v).trim();
const PLACEHOLDER = '—';

const PAGE_SIZE = 50;

const isoOf = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const indiaToday = () => isoOf(new Date());

const addDays = (iso, n) => {
  const d = new Date(`${clean(iso).slice(0, 10)}T00:00:00`);
  d.setDate(d.getDate() + n);
  return isoOf(d);
};

const isValidIso = (v) => /^\d{4}-\d{2}-\d{2}$/.test(clean(v));

// Fixed month/weekday tables so the displayed date is identical on every device
// (ICU builds differ: some render September as "Sept", others as "Sep").
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

const prettyDate = (iso) => {
  if (!isValidIso(iso)) return '—';
  const d = new Date(`${iso}T00:00:00`);
  if (Number.isNaN(d.getTime())) return iso;
  return `${String(d.getDate()).padStart(2, '0')}-${MONTHS[d.getMonth()]}-${d.getFullYear()}`;
};

const weekdayOf = (iso) => {
  if (!isValidIso(iso)) return '';
  const d = new Date(`${iso}T00:00:00`);
  return Number.isNaN(d.getTime()) ? '' : WEEKDAYS[d.getDay()];
};

// hoursworked is stored in minutes (the website renders the same raw value).
// This is a display-only conversion of that same number; no new attendance rule.
const formatWorked = (minutes) => {
  const m = Number(minutes);
  if (!Number.isFinite(m) || m <= 0) return PLACEHOLDER;
  const h = Math.floor(m / 60);
  const rem = m % 60;
  if (!h) return `${rem}m`;
  return rem ? `${h}h ${String(rem).padStart(2, '0')}m` : `${h}h`;
};

const statusLabelOf = (row) => clean(row.computedStatus) || clean(row.statusLabel) || 'No Record';

/**
 * HR Daily Master Report Screen Component
 */
export const HRDailyMasterScreen = () => {
  const [date, setDate] = useState(indiaToday());
  const [dateInput, setDateInput] = useState(indiaToday());
  const [rows, setRows] = useState([]);
  const [deptNames, setDeptNames] = useState({});
  const [loading, setLoading] = useState(false);
  const [loadedDate, setLoadedDate] = useState(null);
  const [error, setError] = useState(null);
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);
  const [exported, setExported] = useState(null);

  // Real department code -> name map, from the same /hr/filters lookup the
  // Analytics tab uses (dbo.tbldepartment). No new mapping table.
  useEffect(() => {
    let active = true;
    api.get('/hr/filters')
      .then((f) => {
        if (!active) return;
        const map = {};
        (Array.isArray(f?.departments) ? f.departments : []).forEach((d) => {
          const c = clean(d?.code);
          if (c) map[c] = clean(d?.name) || c;
        });
        setDeptNames(map);
      })
      .catch(() => { /* names fall back to the code, same as the website */ });
    return () => { active = false; };
  }, []);

  const fetchDb = useCallback(async (targetDate) => {
    const d = clean(targetDate);
    if (!isValidIso(d)) {
      setError('Please enter a valid date (YYYY-MM-DD).');
      return;
    }
    setLoading(true);
    setError(null);
    setExported(null);
    setRows([]);        // never keep showing the previous date's records
    setLoadedDate(null);
    try {
      // Exactly the request the desktop website makes for the selected date.
      const data = await api.get('/hr/daily-master', { fromDate: d, toDate: d });
      setRows(Array.isArray(data) ? data : []);
      setLoadedDate(d);
      setPage(1);
    } catch (err) {
      // Real failure surfaces as an error; no dummy fallback data.
      setError('Unable to load Daily Master data. Please try again.');
    } finally {
      setLoading(false);
    }
  }, []);

  // Default date is TODAY and the real report loads immediately on open.
  useEffect(() => { fetchDb(indiaToday()); }, [fetchDb]);

  const stepDate = (dir) => {
    const next = addDays(isValidIso(dateInput) ? dateInput : indiaToday(), dir);
    setDateInput(next);
    setDate(next);
  };

  const applyTypedDate = (text) => {
    setDateInput(text);
    if (isValidIso(text)) setDate(text);
  };

  const isToday = date === indiaToday();

  const records = useMemo(() => {
    const term = clean(search).toLowerCase();
    if (!term) return rows;
    return rows.filter((r) => `${clean(r.paycode)} ${clean(r.empname)}`.toLowerCase().indexOf(term) >= 0);
  }, [rows, search]);

  const totals = useMemo(() => {
    const t = { present: 0, absent: 0, miss: 0, weekOff: 0, late: 0, other: 0 };
    rows.forEach((r) => {
      const s = statusLabelOf(r);
      if (s === 'Present') t.present += 1;
      else if (s === 'Absent') t.absent += 1;
      else if (s === 'Miss Punch') t.miss += 1;
      else if (s === 'Week Off') t.weekOff += 1;
      else t.other += 1;
      if (r.isLate) t.late += 1;
    });
    return t;
  }, [rows]);

  const totalPages = Math.max(1, Math.ceil(records.length / PAGE_SIZE));
  const safePage = Math.min(page, totalPages);
  const start = (safePage - 1) * PAGE_SIZE;
  const visible = records.slice(start, start + PAGE_SIZE);

  // Export = the website's daily-master CSV built from the currently loaded real rows.
  const handleExport = () => {
    if (!rows.length) return;
    const header = ['Paycode', 'Name', 'Department', 'In', 'Out', 'Hours', 'Status'];
    const lines = [header.join(',')].concat(rows.map((r) => {
      const code = clean(r.paycode);
      const dept = deptNames[clean(r.departmentcode)] || clean(r.departmentcode) || PLACEHOLDER;
      return [
        code,
        clean(r.empname),
        dept,
        clean(r.inTime) || PLACEHOLDER,
        clean(r.outTime) || PLACEHOLDER,
        Number(r.hoursworked) || 0,
        statusLabelOf(r),
      ].map((v) => `"${String(v).replace(/"/g, '""')}"`).join(',');
    }));
    setExported({
      fileName: `daily-master-${loadedDate || date}.csv`,
      text: lines.join('\n'),
      count: rows.length,
    });
  };

  const showList = !loading && !error;

  return (
    <ScreenContainer title="Daily Master Report" showHeader={true}>
      <ScrollView
        refreshControl={<RefreshControl refreshing={false} onRefresh={() => fetchDb(date)} colors={[COLORS.primary]} />}
        contentContainerStyle={styles.scrollContent}
        keyboardShouldPersistTaps="handled"
      >
        <Text style={styles.subtitle}>Daily attendance / punching report</Text>

        {/* Date selector: any date can be typed, or stepped day by day */}
        <View style={[styles.dateCard, SHADOWS.sm]}>
          <View style={styles.dateHeaderRow}>
            <Text style={styles.dateHeading}>Attendance Date</Text>
            {!isToday ? (
              <TouchableOpacity style={styles.todayChip} onPress={() => { const t = indiaToday(); setDateInput(t); setDate(t); }} activeOpacity={0.8}>
                <Ionicons name="calendar" size={11} color={COLORS.primary} />
                <Text style={styles.todayChipText}>Today</Text>
              </TouchableOpacity>
            ) : null}
          </View>

          <View style={styles.dateRow}>
            <TouchableOpacity style={styles.dateArrow} onPress={() => stepDate(-1)} accessibilityLabel="Previous day" activeOpacity={0.7}>
              <Ionicons name="chevron-back" size={20} color={COLORS.primary} />
            </TouchableOpacity>
            <View style={styles.dateCenter}>
              <TextInput
                style={styles.dateInput}
                value={dateInput}
                onChangeText={applyTypedDate}
                placeholder="YYYY-MM-DD"
                placeholderTextColor={COLORS.textTertiary}
                autoCapitalize="none"
                autoCorrect={false}
                keyboardType="numbers-and-punctuation"
              />
              <Text style={styles.datePreview}>{prettyDate(date)} · {weekdayOf(date)}</Text>
            </View>
            <TouchableOpacity style={styles.dateArrow} onPress={() => stepDate(1)} accessibilityLabel="Next day" activeOpacity={0.7}>
              <Ionicons name="chevron-forward" size={20} color={COLORS.primary} />
            </TouchableOpacity>
          </View>
        </View>

        <View style={styles.actionRow}>
          <Button title="Fetch DB" onPress={() => fetchDb(date)} loading={loading} style={styles.actionButton} />
          <Button title="Export" onPress={handleExport} variant="secondary" disabled={!rows.length} style={styles.actionButton} />
        </View>

        {/* Export result */}
        {exported ? (
          <View style={styles.exportBox}>
            <View style={styles.exportHeaderRow}>
              <Text style={styles.exportFile} numberOfLines={1}>{exported.fileName}</Text>
              <TouchableOpacity onPress={() => setExported(null)} hitSlop={{ top: 10, left: 10, bottom: 10, right: 10 }}>
                <Text style={styles.exportClose}>✕</Text>
              </TouchableOpacity>
            </View>
            <Text style={styles.exportMeta}>{exported.count} employees · selected date {exported.fileName.replace('daily-master-', '').replace('.csv', '')}</Text>
            <ScrollView horizontal style={styles.exportScroll}>
              <Text style={styles.exportText}>{exported.text}</Text>
            </ScrollView>
          </View>
        ) : null}

        {/* Loading */}
        {loading ? (
          <View style={styles.stateBox}>
            <ActivityIndicator size="large" color={COLORS.primary} />
            <Text style={styles.stateText}>Loading {prettyDate(date)} from Savior...</Text>
          </View>
        ) : null}

        {/* Error */}
        {!loading && error ? (
          <View style={styles.errorBox}>
            <Text style={styles.errorText}>⚠️ {error}</Text>
            <Button title="Retry" onPress={() => fetchDb(date)} variant="outline" size="small" style={styles.retryButton} />
          </View>
        ) : null}

        {showList ? (
          <>
            {/* Report date + counts (all counts come from the loaded real rows) */}
            <View style={[styles.reportBar, SHADOWS.sm]}>
              <Text style={styles.reportDate}>{prettyDate(loadedDate || date)}, {weekdayOf(loadedDate || date)}</Text>
              <Text style={styles.reportCount}>{rows.length} employees</Text>
            </View>

            <View style={styles.summaryRow}>
              <View style={[styles.summaryChip, { borderColor: '#059669' }]}>
                <Text style={[styles.summaryValue, { color: '#059669' }]}>{totals.present}</Text>
                <Text style={styles.summaryLabel}>Present</Text>
              </View>
              <View style={[styles.summaryChip, { borderColor: '#DC2626' }]}>
                <Text style={[styles.summaryValue, { color: '#DC2626' }]}>{totals.absent}</Text>
                <Text style={styles.summaryLabel}>Absent</Text>
              </View>
              <View style={[styles.summaryChip, { borderColor: '#D97706' }]}>
                <Text style={[styles.summaryValue, { color: '#D97706' }]}>{totals.miss}</Text>
                <Text style={styles.summaryLabel}>Miss Punch</Text>
              </View>
              <View style={[styles.summaryChip, { borderColor: '#64748B' }]}>
                <Text style={[styles.summaryValue, { color: '#64748B' }]}>{totals.weekOff}</Text>
                <Text style={styles.summaryLabel}>Week Off</Text>
              </View>
            </View>

            {/* Simple name / paycode search */}
            <View style={styles.searchWrap}>
              <TextInput
                style={styles.searchInput}
                placeholder="Search name or paycode..."
                placeholderTextColor={COLORS.textTertiary}
                value={search}
                onChangeText={setSearch}
                autoCapitalize="none"
                autoCorrect={false}
              />
              {search ? (
                <TouchableOpacity style={styles.searchClear} onPress={() => setSearch('')} hitSlop={{ top: 10, left: 10, bottom: 10, right: 10 }}>
                  <Text style={styles.searchClearText}>✕</Text>
                </TouchableOpacity>
              ) : null}
            </View>

            {rows.length === 0 ? (
              <View style={styles.emptyBox}>
                <Text style={styles.emptyText}>No attendance records found for this date.</Text>
              </View>
            ) : records.length === 0 ? (
              <View style={styles.emptyBox}>
                <Text style={styles.emptyText}>No employee matches this search.</Text>
              </View>
            ) : (
              <>
                {visible.map((r, i) => {
                  const code = clean(r.paycode);
                  const dept = deptNames[clean(r.departmentcode)] || clean(r.departmentcode) || PLACEHOLDER;
                  const label = statusLabelOf(r);
                  const color = getStatusColor(r.statusCode || label);
                  const inT = clean(r.inTime);
                  const outT = clean(r.outTime);
                  return (
                    <View key={`${code}-${i}`} style={[styles.card, SHADOWS.sm]}>
                      <View style={styles.cardTop}>
                        <Text style={styles.cardPaycode}>{code}</Text>
                        <View style={[styles.statusBadge, { backgroundColor: `${color}18`, borderColor: color }]}>
                          <Text style={[styles.statusBadgeText, { color }]}>{label.toUpperCase()}</Text>
                        </View>
                      </View>
                      <Text style={styles.cardName} numberOfLines={1}>{clean(r.empname)}</Text>
                      <Text style={styles.cardDept} numberOfLines={1}>{dept}</Text>

                      <View style={styles.metricsRow}>
                        <View style={styles.metric}>
                          <Text style={styles.metricLabel}>IN</Text>
                          <Text style={[styles.metricValue, styles.metricIn]}>{inT || PLACEHOLDER}</Text>
                        </View>
                        <View style={styles.metric}>
                          <Text style={styles.metricLabel}>OUT</Text>
                          <Text style={[styles.metricValue, outT ? styles.metricOut : styles.metricNone]}>{outT || PLACEHOLDER}</Text>
                        </View>
                        <View style={styles.metric}>
                          <Text style={styles.metricLabel}>WORKED</Text>
                          <Text style={[styles.metricValue, styles.metricWorked]}>{formatWorked(r.hoursworked)}</Text>
                        </View>
                      </View>
                    </View>
                  );
                })}

                {/* Pagination, same page size as the website (50) */}
                <View style={styles.pagination}>
                  <TouchableOpacity
                    style={[styles.pageButton, safePage === 1 && styles.pageButtonDisabled]}
                    disabled={safePage === 1}
                    onPress={() => setPage((p) => Math.max(1, p - 1))}
                  >
                    <Text style={styles.pageButtonText}>Previous</Text>
                  </TouchableOpacity>
                  <Text style={styles.pageInfo}>Page {safePage} of {totalPages}</Text>
                  <TouchableOpacity
                    style={[styles.pageButton, safePage === totalPages && styles.pageButtonDisabled]}
                    disabled={safePage === totalPages}
                    onPress={() => setPage((p) => Math.min(totalPages, p + 1))}
                  >
                    <Text style={styles.pageButtonText}>Next</Text>
                  </TouchableOpacity>
                </View>
              </>
            )}
          </>
        ) : null}
      </ScrollView>
    </ScreenContainer>
  );
};

const styles = StyleSheet.create({
  scrollContent: { padding: SPACING.lg, paddingBottom: SPACING.xxl },
  subtitle: { fontSize: 12, color: COLORS.textTertiary, marginBottom: SPACING.md },
  dateCard: {
    backgroundColor: COLORS.surface,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: COLORS.divider,
    padding: SPACING.md,
  },
  dateHeaderRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: SPACING.sm },
  dateHeading: { fontSize: 12, fontWeight: '700', color: COLORS.textSecondary },
  todayChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 9,
    paddingVertical: 4,
    borderRadius: 999,
    backgroundColor: `${COLORS.primary}12`,
    borderWidth: 1,
    borderColor: `${COLORS.primary}30`,
  },
  todayChipText: { fontSize: 11, fontWeight: '700', color: COLORS.primary },
  dateRow: { flexDirection: 'row', alignItems: 'center' },
  dateArrow: { width: 44, paddingVertical: SPACING.sm, alignItems: 'center' },
  dateCenter: { flex: 1, alignItems: 'center' },
  dateInput: {
    width: 148,
    textAlign: 'center',
    fontSize: 17,
    fontWeight: '800',
    color: COLORS.textPrimary,
    borderBottomWidth: 1,
    borderBottomColor: COLORS.border,
    paddingVertical: 3,
  },
  datePreview: { fontSize: 11, color: COLORS.textTertiary, marginTop: 3 },
  actionRow: { flexDirection: 'row', gap: SPACING.md, marginTop: SPACING.md },
  actionButton: { flex: 1 },
  exportBox: {
    marginTop: SPACING.md,
    padding: SPACING.md,
    borderRadius: 12,
    backgroundColor: `${COLORS.success}12`,
    borderWidth: 1,
    borderColor: `${COLORS.success}33`,
    gap: 4,
  },
  exportHeaderRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: SPACING.sm },
  exportFile: { flex: 1, fontSize: 12, fontWeight: '800', color: COLORS.success },
  exportClose: { fontSize: 14, color: COLORS.success, fontWeight: '700' },
  exportMeta: { fontSize: 11, color: COLORS.textSecondary },
  exportScroll: { marginTop: 6, maxHeight: 130 },
  exportText: { fontSize: 10, color: COLORS.textSecondary },
  stateBox: { paddingVertical: SPACING.xxl, alignItems: 'center', gap: SPACING.sm },
  stateText: { color: COLORS.textSecondary, fontSize: 13 },
  errorBox: {
    marginTop: SPACING.md,
    backgroundColor: `${COLORS.error}12`,
    borderWidth: 1,
    borderColor: `${COLORS.error}33`,
    borderRadius: 12,
    padding: SPACING.md,
    gap: SPACING.sm,
  },
  errorText: { color: COLORS.error, fontSize: 12 },
  retryButton: { alignSelf: 'flex-start' },
  reportBar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginTop: SPACING.lg,
    backgroundColor: COLORS.surface,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: COLORS.divider,
    paddingHorizontal: SPACING.md,
    paddingVertical: SPACING.sm,
  },
  reportDate: { fontSize: 13, fontWeight: '800', color: COLORS.textPrimary },
  reportCount: { fontSize: 12, fontWeight: '700', color: COLORS.primary },
  summaryRow: { flexDirection: 'row', flexWrap: 'wrap', gap: SPACING.sm, marginTop: SPACING.md },
  summaryChip: {
    flexGrow: 1,
    minWidth: 74,
    alignItems: 'center',
    paddingVertical: SPACING.sm,
    borderRadius: 12,
    borderWidth: 1,
    backgroundColor: COLORS.surface,
  },
  summaryValue: { fontSize: 17, fontWeight: '800' },
  summaryLabel: { fontSize: 10, color: COLORS.textSecondary, marginTop: 2, fontWeight: '600' },
  searchWrap: { marginTop: SPACING.md, justifyContent: 'center' },
  searchInput: {
    backgroundColor: COLORS.surface,
    borderWidth: 1,
    borderColor: COLORS.border,
    borderRadius: 10,
    paddingHorizontal: SPACING.md,
    paddingVertical: SPACING.sm,
    paddingRight: 34,
    color: COLORS.textPrimary,
    fontSize: 13,
  },
  searchClear: { position: 'absolute', right: 10 },
  searchClearText: { fontSize: 13, color: COLORS.textTertiary, fontWeight: '700' },
  emptyBox: {
    marginTop: SPACING.lg,
    padding: SPACING.lg,
    borderRadius: 14,
    backgroundColor: COLORS.surface,
    borderWidth: 1,
    borderColor: COLORS.divider,
    alignItems: 'center',
  },
  emptyText: { color: COLORS.textTertiary, fontSize: 12.5, textAlign: 'center' },
  card: {
    marginTop: SPACING.md,
    backgroundColor: COLORS.surface,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: COLORS.divider,
    padding: SPACING.md,
  },
  cardTop: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: SPACING.sm },
  cardPaycode: { fontSize: 11, fontWeight: '800', color: COLORS.textSecondary },
  statusBadge: { paddingHorizontal: 8, paddingVertical: 3, borderRadius: 999, borderWidth: 1 },
  statusBadgeText: { fontSize: 9.5, fontWeight: '800' },
  cardName: { fontSize: 14.5, fontWeight: '700', color: COLORS.textPrimary, marginTop: 3 },
  cardDept: { fontSize: 11.5, color: COLORS.textTertiary, marginTop: 1 },
  metricsRow: { flexDirection: 'row', marginTop: SPACING.sm, gap: SPACING.md },
  metric: { flex: 1 },
  metricLabel: { fontSize: 9.5, fontWeight: '800', color: COLORS.textTertiary, letterSpacing: 0.5 },
  metricValue: { fontSize: 13, fontWeight: '800', marginTop: 1 },
  metricIn: { color: '#166534' },
  metricOut: { color: '#991B1B' },
  metricWorked: { color: '#4338CA' },
  metricNone: { color: COLORS.textTertiary, fontWeight: '600' },
  pagination: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginTop: SPACING.lg,
    padding: SPACING.sm,
    borderRadius: 12,
    backgroundColor: COLORS.surface,
    borderWidth: 1,
    borderColor: COLORS.divider,
  },
  pageButton: { paddingHorizontal: SPACING.md, paddingVertical: 6, backgroundColor: COLORS.primary, borderRadius: 8 },
  pageButtonDisabled: { backgroundColor: COLORS.border },
  pageButtonText: { color: '#FFFFFF', fontSize: 12, fontWeight: '600' },
  pageInfo: { color: COLORS.textPrimary, fontSize: 12, fontWeight: '600' },
});
