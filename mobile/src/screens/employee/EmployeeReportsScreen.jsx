// ============================================================================
// FILE: mobile/src/screens/employee/EmployeeReportsScreen.jsx
// PURPOSE: Employee Reports - real employee-wise attendance reporting
// ============================================================================

/**
 * Ye screen EMPLOYEE ka apna attendance report dikhati hai - sirf usi ke
 * paycode ka data, hamesha.
 *
 * Navigation Flow:
 * EmployeeNavigator (Reports Tab) -> EmployeeReportsScreen
 *
 * Data Flow:
 * Employee Login -> JWT (paycode inside the token)
 *              -> GET /api/employee/dashboard?month=YYYY-MM
 *
 * Identity & security:
 * The client NEVER sends a paycode. The backend resolves the employee from the
 * verified JWT on every call (req.user.paycode), so one employee can never view
 * or export another employee's report by changing a URL, a query parameter or a
 * locally stored value.
 *
 * Data source (existing, unchanged attendance logic):
 * /api/employee/dashboard returns, for the logged-in employee and the selected
 * month: present / absent / miss / late / hours / weekOff counters, the per-day
 * `attendance[]` rows (In, Out, hours, status, statusCode, late minutes, shift,
 * grace), `lateDetails[]` and `graceRemaining`. Those rows come from
 * dbo.tbltimeregister through the SAME classifyRow() / normalizeAttendance() /
 * computeMonthlyLateForEmployee() helpers that HR Admin -> Single Employee Audit
 * uses, so this report and the HR audit always agree. No second attendance
 * calculation is introduced here.
 *
 * Holiday is read from the existing raw `statusCode` (H / HOLIDAY) which the
 * backend already classifies as a Week Off day for counting - so the totals here
 * stay identical to HR.
 */

import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { View, Text, ScrollView, StyleSheet, TouchableOpacity, Modal, RefreshControl, ActivityIndicator, Platform } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import * as FileSystem from 'expo-file-system';
import * as Sharing from 'expo-sharing';
import { useTheme } from '../../theme';
import { Card, Button, ScreenContainer, currentMonthKey } from '../../components';
import { api } from '../../services/api';
import { API_ENDPOINTS } from '../../utils/constants';

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const clean = (v) => String(v == null ? '' : v).trim();
const PLACEHOLDER = '—';

/** Calendar dates only - never parsed through UTC, so a date cannot shift a day. */
const partsOf = (v) => {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(clean(v));
  if (!m) return null;
  const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  if (d.getFullYear() !== Number(m[1]) || d.getMonth() !== Number(m[2]) - 1 || d.getDate() !== Number(m[3])) return null;
  return d;
};
const isoOf = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const shortDate = (v) => { const d = partsOf(v); return d ? `${String(d.getDate()).padStart(2, '0')} ${MONTHS[d.getMonth()]}` : PLACEHOLDER; };
const dayName = (v) => { const d = partsOf(v); return d ? WEEKDAYS[d.getDay()] : PLACEHOLDER; };
const monthLabel = (m) => `${MONTHS[Number(clean(m).slice(5, 7)) - 1] || ''} ${clean(m).slice(0, 4)}`;

// Month stepping is plain 'YYYY-MM' arithmetic - no date parsing at all.
const shiftMonth = (key, delta) => {
  const m = /^(\d{4})-(\d{2})$/.exec(clean(key));
  if (!m) return currentMonthKey();
  const d = new Date(Number(m[1]), Number(m[2]) - 1 + delta, 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
};

/** hoursworked is stored in MINUTES; display-only conversion. */
const hoursText = (minutes) => {
  const m = Number(minutes);
  if (!Number.isFinite(m) || m <= 0) return '0h';
  const h = Math.floor(m / 60);
  const rem = m % 60;
  return rem ? `${h}h ${String(rem).padStart(2, '0')}m` : `${h}h`;
};

const isHolidayRow = (row) => {
  const c = clean(row?.statusCode).toUpperCase();
  return c === 'H' || c === 'HOLIDAY';
};
/** Display label only - mirrors what the backend already classified. */
const statusLabel = (row) => (isHolidayRow(row) ? 'Holiday' : (clean(row?.computedStatus) || clean(row?.statusLabel) || PLACEHOLDER));
const statusKey = (row) => {
  const l = statusLabel(row).toLowerCase();
  if (l.includes('present')) return 'present';
  if (l.includes('absent')) return 'absent';
  if (l.includes('miss')) return 'miss';
  if (l.includes('holiday')) return 'holiday';
  if (l.includes('week') || l.includes('holiday')) return 'weekoff';
  return 'other';
};
const COLORS_BY_KEY = {
  present: '#059669',
  absent: '#DC2626',
  miss: '#D97706',
  holiday: '#7C3AED',
  weekoff: '#CA8A04',
  other: '#94A3B8',
};

/**
 * Trigger a real download.
 * Web: a Blob + <a download> click (the browser saves the file).
 * Native: write to the cache dir and open the share sheet.
 * Same approach the Marriage template download already uses - no new framework.
 */
const downloadCsv = async (fileName, csv) => {
  if (Platform.OS === 'web') {
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = fileName;
    a.rel = 'noopener';
    a.style.display = 'none';
    document.body.appendChild(a);
    a.click();
    setTimeout(() => {
      if (a.parentNode) a.parentNode.removeChild(a);
      URL.revokeObjectURL(url);
    }, 0);
    return;
  }
  const dir = FileSystem.cacheDirectory || FileSystem.documentDirectory;
  if (!dir) throw new Error('No writable directory');
  const uri = `${dir}${fileName}`;
  await FileSystem.writeAsStringAsync(uri, csv, { encoding: FileSystem.EncodingType.UTF8 });
  if (await Sharing.isAvailableAsync()) {
    await Sharing.shareAsync(uri, { mimeType: 'text/csv', dialogTitle: fileName, UTI: 'public.comma-separated-values-text' });
  }
};

const csvCell = (v) => {
  const s = String(v == null ? '' : v);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

/**
 * Employee Reports Screen Component
 */
export const EmployeeReportsScreen = () => {
  const { theme } = useTheme();
  const [month, setMonth] = useState(currentMonthKey());
  const [data, setData] = useState(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [error, setError] = useState(null);
  const [exportMsg, setExportMsg] = useState(null);
  const [exporting, setExporting] = useState(false);

  const load = useCallback(async (isRefresh, targetMonth) => {
    if (isRefresh) setIsRefreshing(true); else setIsLoading(true);
    setError(null);
    try {
      // Only the month is sent - the backend uses the authenticated identity.
      const res = await api.get(API_ENDPOINTS.EMPLOYEE_DASHBOARD, { month: targetMonth });
      setData(res);
    } catch (e) {
      setData(null);
      setError('Unable to load your report. Please try again.');
    } finally {
      setIsLoading(false);
      setIsRefreshing(false);
    }
  }, []);

  useEffect(() => { load(false, month); }, [month]); // eslint-disable-line react-hooks/exhaustive-deps

  // Per-day rows for the SELECTED month, ascending (oldest -> newest).
  const rows = useMemo(() => {
    const list = Array.isArray(data?.attendance) ? data.attendance.slice() : [];
    return list
      .map((r, i) => ({ r, i, key: clean(r.date || r.dateoffice).slice(0, 10) }))
      .sort((a, b) => (a.key < b.key ? -1 : a.key > b.key ? 1 : a.i - b.i))
      .map((x) => x.r);
  }, [data]);

  // Attendance trend: one bar per day of the selected month, coloured by status.
  const trend = useMemo(() => rows.map((r) => {
    const key = statusKey(r);
    return {
      key: clean(r.date || r.dateoffice).slice(0, 10),
      day: partsOf(r.date || r.dateoffice)?.getDate() || 0,
      status: statusLabel(r),
      color: COLORS_BY_KEY[key] || COLORS_BY_KEY.other,
      isLate: Boolean(r.isLate),
      hours: Number(r.hoursworked || 0),
    };
  }), [rows]);

  // Working-hours trend from the same real rows.
  const maxDayHours = useMemo(() => Math.max(1, ...trend.map((t) => t.hours)), [trend]);
  const hoursTrend = useMemo(() => trend.map((t) => ({ ...t, label: hoursText(t.hours) })), [trend]);

  // Totals for the selected month. Present/Absent/Miss/Late/Hours/WeekOff are the
  // backend's own counters; Holiday is read from the same rows (raw statusCode).
  const totals = useMemo(() => {
    const holiday = rows.filter((r) => isHolidayRow(r)).length;
    return {
      present: Number(data?.present || 0),
      absent: Number(data?.absent || 0),
      miss: Number(data?.miss || 0),
      late: Number(data?.late || 0),
      weekOff: Number(data?.weekOff || 0),
      holiday,
      hours: Number(data?.hours || 0),
      days: rows.length,
    };
  }, [data, rows]);

  const grace = data?.graceRemaining;

  const handleExport = async () => {
    if (exporting || !rows.length) return;         // guard duplicate taps
    setExporting(true);
    setExportMsg(null);
    try {
      const header = ['Date', 'Day', 'In Time', 'Out Time', 'Worked Hours', 'Status', 'Late (min)', 'Shift'];
      const lines = [header.join(',')];
      rows.forEach((r) => {
        const mins = Number(r.latearrival || 0);
        lines.push([
          clean(r.date || r.dateoffice).slice(0, 10),
          dayName(r.date || r.dateoffice),
          clean(r.inTime),
          clean(r.outTime),
          (Number(r.hoursworked || 0) / 60).toFixed(2),
          statusLabel(r),
          mins > 0 ? mins : '',
          clean(r.shift),
        ].map(csvCell).join(','));
      });
      // Totals of the SAME selected month, for the same employee.
      lines.push('');
      lines.push(['Summary', '', '', '', '', '', '', ''].join(','));
      lines.push(['Total Present', totals.present].join(','));
      lines.push(['Total Absent', totals.absent].join(','));
      lines.push(['Total Miss Punch', totals.miss].join(','));
      lines.push(['Total Late', totals.late].join(','));
      lines.push(['Total Weekly Off', totals.weekOff].join(','));
      lines.push(['Total Holiday', totals.holiday].join(','));
      lines.push(['Total Worked Hours (h)', (totals.hours / 60).toFixed(2)].join(','));

      await downloadCsv(`employee-attendance-report-${clean(month)}.csv`, lines.join('\n'));
      setExportMsg({ kind: 'ok', text: `Report exported for ${monthLabel(month)} (${rows.length} days).` });
    } catch (e) {
      setExportMsg({ kind: 'error', text: 'Unable to export the report. Please try again.' });
    } finally {
      setExporting(false);
    }
  };

  const summaryCard = (label, value, color) => (
    <View style={[styles.sumBox, { borderColor: `${color}44` }]}>
      <Text style={[styles.sumValue, { color }]}>{value}</Text>
      <Text style={[styles.sumLabel, { color: theme.textSecondary }]}>{label}</Text>
    </View>
  );

  return (
    <ScreenContainer title="My Reports" showHeader={true}>
      <ScrollView
        refreshControl={<RefreshControl refreshing={isRefreshing} onRefresh={() => load(true, month)} colors={[theme.primary]} />}
        contentContainerStyle={styles.scroll}
        showsVerticalScrollIndicator={false}
      >
        {/* ---------- Report period ---------- */}
        <View style={[styles.navBar, { borderColor: theme.border, backgroundColor: theme.surface || '#FFFFFF' }]}>
          <TouchableOpacity style={styles.navArrow} accessibilityLabel="Previous month" activeOpacity={0.7}
            onPress={() => setMonth(shiftMonth(month, -1))}>
            <Ionicons name="chevron-back" size={20} color={theme.primary} />
          </TouchableOpacity>
          <View style={styles.navCenter}>
            <Text style={[styles.navTitle, { color: theme.textPrimary }]}>{monthLabel(month)}</Text>
            <Text style={[styles.navSub, { color: theme.textTertiary }]}>Attendance Report</Text>
          </View>
          <TouchableOpacity style={styles.navArrow} accessibilityLabel="Next month" activeOpacity={0.7}
            onPress={() => setMonth(shiftMonth(month, 1))}>
            <Ionicons name="chevron-forward" size={20} color={theme.primary} />
          </TouchableOpacity>
        </View>
        {month !== currentMonthKey() ? (
          <TouchableOpacity style={[styles.currentChip, { backgroundColor: `${theme.primary}15`, borderColor: `${theme.primary}40` }]}
            accessibilityLabel="Current month" activeOpacity={0.8} onPress={() => setMonth(currentMonthKey())}>
            <Text style={[styles.currentChipText, { color: theme.primary }]}>Current Month</Text>
          </TouchableOpacity>
        ) : null}

        {isLoading ? (
          <View style={styles.stateBox}>
            <ActivityIndicator size="large" color={theme.primary} />
            <Text style={[styles.stateText, { color: theme.textSecondary }]}>Loading your report...</Text>
          </View>
        ) : null}

        {!isLoading && error ? (
          <Card style={styles.card}>
            <Text style={[styles.errorText, { color: theme.error }]}>⚠️ {error}</Text>
            <Button title="Retry" onPress={() => load(false, month)} variant="outline" size="small" style={{ marginTop: 12 }} />
          </Card>
        ) : null}

        {!isLoading && !error && data ? (
          <>
            {/* ---------- Attendance summary ---------- */}
            <Card style={styles.card}>
              <Text style={[styles.cardTitle, { color: theme.textPrimary }]}>Attendance Summary</Text>
              <Text style={[styles.cardSub, { color: theme.textSecondary }]}>{`${monthLabel(month)} · ${totals.days} attendance record(s)`}</Text>
              <View style={styles.sumGrid}>
                {summaryCard('Present', totals.present, COLORS_BY_KEY.present)}
                {summaryCard('Absent', totals.absent, COLORS_BY_KEY.absent)}
                {summaryCard('Miss Punch', totals.miss, COLORS_BY_KEY.miss)}
                {summaryCard('Late', totals.late, '#7C3AED')}
                {summaryCard('Weekly Off', totals.weekOff, COLORS_BY_KEY.weekoff)}
                {summaryCard('Holiday', totals.holiday, COLORS_BY_KEY.holiday)}
              </View>
              <View style={styles.hoursRow}>
                <Text style={[styles.hoursLabel, { color: theme.textSecondary }]}>Total Working Hours</Text>
                <Text style={[styles.hoursValue, { color: theme.primary }]}>{hoursText(totals.hours)}</Text>
              </View>
            </Card>

            {/* ---------- Attendance trend ---------- */}
            <Card style={styles.card}>
              <Text style={[styles.cardTitle, { color: theme.textPrimary }]}>Attendance Trend</Text>
              <Text style={[styles.cardSub, { color: theme.textSecondary }]}>Each bar is one day of {monthLabel(month)}</Text>
              {trend.length ? (
                <>
                  <View style={styles.trendStrip}>
                    {trend.map((t) => (
                      <View key={t.key} style={styles.trendCol}>
                        <View style={[styles.trendBar, { backgroundColor: t.color, height: `${Math.max(10, Math.min(100, (t.hours / maxDayHours) * 100))}%` }]} />
                      </View>
                    ))}
                  </View>
                  <View style={styles.trendAxis}>
                    <Text style={[styles.axisText, { color: theme.textTertiary }]}>{shortDate(trend[0].key)}</Text>
                    <Text style={[styles.axisText, { color: theme.textTertiary }]}>L = Late</Text>
                    <Text style={[styles.axisText, { color: theme.textTertiary }]}>{shortDate(trend[trend.length - 1].key)}</Text>
                  </View>
                  <View style={styles.legend}>
                    {[['Present', 'present'], ['Absent', 'absent'], ['Miss Punch', 'miss'], ['Weekly Off', 'weekoff'], ['Holiday', 'holiday']].map(([l, k]) => (
                      <View key={k} style={styles.legendItem}>
                        <View style={[styles.legendDot, { backgroundColor: COLORS_BY_KEY[k] }]} />
                        <Text style={[styles.legendText, { color: theme.textSecondary }]}>{l}</Text>
                      </View>
                    ))}
                  </View>
                </>
              ) : (
                <Text style={[styles.empty, { color: theme.textTertiary }]}>Is month me koi attendance record nahi hai.</Text>
              )}
            </Card>

            {/* ---------- Working hours trend ---------- */}
            <Card style={styles.card}>
              <Text style={[styles.cardTitle, { color: theme.textPrimary }]}>Working Hours Trend</Text>
              <Text style={[styles.cardSub, { color: theme.textSecondary }]}>Actual worked hours per day</Text>
              {hoursTrend.length ? (
                <>
                  <View style={styles.trendStrip}>
                    {hoursTrend.map((t) => (
                      <View key={t.key} style={styles.trendCol}>
                        <View style={[styles.trendBar, { backgroundColor: '#4338CA', height: `${Math.max(6, Math.min(100, (t.hours / maxDayHours) * 100))}%` }]} />
                      </View>
                    ))}
                  </View>
                  <View style={styles.trendAxis}>
                    <Text style={[styles.axisText, { color: theme.textTertiary }]}>{hoursTrend[0].label}</Text>
                    <Text style={[styles.axisText, { color: theme.textTertiary }]}>peak {hoursText(maxDayHours)}</Text>
                    <Text style={[styles.axisText, { color: theme.textTertiary }]}>{hoursTrend[hoursTrend.length - 1].label}</Text>
                  </View>
                </>
              ) : (
                <Text style={[styles.empty, { color: theme.textTertiary }]}>Is month me koi worked hours nahi hain.</Text>
              )}
            </Card>

            {/* ---------- Late information (existing grace logic) ---------- */}
            <Card style={styles.card}>
              <Text style={[styles.cardTitle, { color: theme.textPrimary }]}>Late Information</Text>
              <Text style={[styles.cardSub, { color: theme.textSecondary }]}>
                {grace ? `Grace left - 30min ${grace.grace30min}/2 · 1hr ${grace.grace1hr}/1 · 2hr ${grace.grace2hr}/1` : 'Grace usage for this month'}
              </Text>
              {Array.isArray(data.lateDetails) && data.lateDetails.length ? (
                <View style={{ gap: 8 }}>
                  {data.lateDetails.slice(0, 6).map((l, i) => {
                    const row = rows.find((r) => clean(r.date || r.dateoffice).slice(0, 10) === clean(l.date).slice(0, 10));
                    const covered = l.isFinalLate === false;
                    return (
                      <View key={`${clean(l.date)}-${i}`} style={[styles.lateRow, { borderColor: theme.border }]}>
                        <View style={styles.lateRowTop}>
                          <Text style={[styles.lateDate, { color: theme.textPrimary }]}>{`${shortDate(l.date)} (${dayName(l.date)})`}</Text>
                          <Text style={[styles.lateBadge, { color: covered ? '#059669' : '#DC2626' }]}>
                            {`Late +${Number(l.lateMinutes || 0)} min`}
                          </Text>
                        </View>
                        <Text style={[styles.lateMeta, { color: theme.textSecondary }]}>
                          {`In: ${clean(row?.inTime) || PLACEHOLDER}${clean(row?.shift) ? ` · Shift: ${clean(row.shift)}` : ''}`}
                        </Text>
                        <Text style={[styles.lateMeta, { color: theme.textTertiary }]}>
                          {covered ? `Covered by ${clean(l.graceUsed) || 'grace'}` : 'Not covered by grace'}
                        </Text>
                      </View>
                    );
                  })}
                </View>
              ) : (
                <Text style={[styles.empty, { color: theme.textTertiary }]}>Is month me koi late arrival nahi hai.</Text>
              )}
            </Card>

            {/* ---------- Detailed monthly attendance ---------- */}
            <Card style={styles.card}>
              <Text style={[styles.cardTitle, { color: theme.textPrimary }]}>Detailed Attendance</Text>
              <Text style={[styles.cardSub, { color: theme.textSecondary }]}>{`${rows.length} day(s) · oldest first`}</Text>
              {rows.length ? rows.map((r, i) => {
                const label = statusLabel(r);
                const key = statusKey(r);
                const mins = Number(r.latearrival || 0);
                return (
                  <View key={`${clean(r.date)}-${i}`} style={[styles.detRow, { borderColor: theme.border }]}>
                    <View style={styles.detDateCol}>
                      <Text style={[styles.detDate, { color: theme.textPrimary }]}>{shortDate(r.date)}</Text>
                      <Text style={[styles.detDay, { color: theme.textTertiary }]}>{dayName(r.date)}</Text>
                    </View>
                    <View style={styles.detMid}>
                      <Text style={[styles.detPunch, { color: clean(r.inTime) ? '#166534' : theme.textTertiary }]}>
                        {`In ${clean(r.inTime) || PLACEHOLDER}`}
                      </Text>
                      <Text style={[styles.detPunch, { color: clean(r.outTime) ? '#991B1B' : theme.textTertiary }]}>
                        {`Out ${clean(r.outTime) || PLACEHOLDER}`}
                      </Text>
                    </View>
                    <View style={styles.detRight}>
                      <Text style={[styles.detHours, { color: theme.primary }]}>{hoursText(r.hoursworked)}</Text>
                      <Text style={[styles.detLate, { color: mins > 0 ? '#7C3AED' : theme.textTertiary }]}>
                        {mins > 0 ? `+${mins} min` : '-'}
                      </Text>
                    </View>
                    <View style={[styles.detBadge, { backgroundColor: `${COLORS_BY_KEY[key]}18`, borderColor: COLORS_BY_KEY[key] }]}>
                      <Text style={[styles.detBadgeText, { color: COLORS_BY_KEY[key] }]} numberOfLines={1}>{label}</Text>
                    </View>
                  </View>
                );
              }) : (
                <Text style={[styles.empty, { color: theme.textTertiary }]}>Is month me koi attendance record nahi hai.</Text>
              )}
            </Card>

            {/* ---------- Monthly totals ---------- */}
            <Card style={styles.card}>
              <Text style={[styles.cardTitle, { color: theme.textPrimary }]}>Monthly Totals</Text>
              <Text style={[styles.cardSub, { color: theme.textSecondary }]}>{monthLabel(month)}</Text>
              <View style={styles.totalsList}>
                {[
                  ['Total Present', totals.present], ['Total Absent', totals.absent],
                  ['Total Miss Punch', totals.miss], ['Total Late', totals.late],
                  ['Total Weekly Off', totals.weekOff], ['Total Holiday', totals.holiday],
                ].map(([l, v]) => (
                  <View key={l} style={styles.totalRow}>
                    <Text style={[styles.totalLabel, { color: theme.textSecondary }]}>{l}</Text>
                    <Text style={[styles.totalValue, { color: theme.textPrimary }]}>{v}</Text>
                  </View>
                ))}
                <View style={styles.totalRow}>
                  <Text style={[styles.totalLabel, { color: theme.textSecondary }]}>Total Worked Hours</Text>
                  <Text style={[styles.totalValue, { color: theme.primary }]}>{hoursText(totals.hours)}</Text>
                </View>
              </View>
            </Card>

            {/* ---------- Export ---------- */}
            <Card style={styles.card}>
              <Text style={[styles.cardTitle, { color: theme.textPrimary }]}>Export Report</Text>
              <Text style={[styles.cardSub, { color: theme.textSecondary }]}>
                {`CSV for ${monthLabel(month)} - only your own attendance`}
              </Text>
              <Button
                title={exporting ? 'Preparing Export...' : 'Export Report'}
                onPress={handleExport}
                loading={exporting}
                disabled={exporting || !rows.length}
                size="small"
              />
              {exportMsg ? (
                <View style={[
                  styles.exportMsg,
                  exportMsg.kind === 'ok' ? { backgroundColor: `${theme.success || COLORS.success}18`, borderColor: `${theme.success || COLORS.success}44` }
                    : { backgroundColor: `${theme.error}18`, borderColor: `${theme.error}44` },
                ]}>
                  <Text style={[styles.exportMsgText, { color: exportMsg.kind === 'ok' ? (theme.success || COLORS.success) : theme.error }]}>
                    {exportMsg.kind === 'ok' ? '✅' : '⚠️'} {exportMsg.text}
                  </Text>
                </View>
              ) : null}
            </Card>
          </>
        ) : null}
      </ScrollView>
    </ScreenContainer>
  );
};

const styles = StyleSheet.create({
  scroll: { padding: 12, paddingBottom: 28 },
  navBar: {
    flexDirection: 'row', alignItems: 'center',
    borderRadius: 12, borderWidth: 1, paddingHorizontal: 4, paddingVertical: 6, marginBottom: 8,
  },
  navArrow: { width: 40, paddingVertical: 6, alignItems: 'center', justifyContent: 'center' },
  navCenter: { flex: 1, alignItems: 'center' },
  navTitle: { fontSize: 15, fontWeight: '800' },
  navSub: { fontSize: 10.5, marginTop: 1 },
  currentChip: { alignSelf: 'flex-start', paddingHorizontal: 10, paddingVertical: 5, borderRadius: 999, borderWidth: 1, marginBottom: 10 },
  currentChipText: { fontSize: 11, fontWeight: '800' },

  stateBox: { paddingVertical: 40, alignItems: 'center', gap: 10 },
  stateText: { fontSize: 13 },
  errorText: { fontSize: 13 },
  card: { borderRadius: 14, padding: 14, marginBottom: 12 },
  cardTitle: { fontSize: 14.5, fontWeight: '800' },
  cardSub: { fontSize: 11, marginTop: 2, marginBottom: 10 },

  sumGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  sumBox: { flexGrow: 1, minWidth: 68, alignItems: 'center', paddingVertical: 8, borderRadius: 10, borderWidth: 1 },
  sumValue: { fontSize: 18, fontWeight: '800' },
  sumLabel: { fontSize: 10, marginTop: 2, fontWeight: '600' },
  hoursRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: 12 },
  hoursLabel: { fontSize: 12 },
  hoursValue: { fontSize: 16, fontWeight: '800' },

  trendStrip: { flexDirection: 'row', alignItems: 'flex-end', height: 86, gap: 1 },
  trendCol: { flex: 1, height: '100%', justifyContent: 'flex-end' },
  trendBar: { width: '100%', borderRadius: 2, minHeight: 5 },
  trendAxis: { flexDirection: 'row', justifyContent: 'space-between', marginTop: 6 },
  axisText: { fontSize: 9.5 },
  legend: { flexDirection: 'row', flexWrap: 'wrap', gap: 10, marginTop: 8 },
  legendItem: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  legendDot: { width: 8, height: 8, borderRadius: 3 },
  legendText: { fontSize: 10 },

  lateRow: { borderTopWidth: 1, borderTopColor: '#EEE', paddingVertical: 8 },
  lateRowTop: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  lateDate: { fontSize: 12, fontWeight: '700' },
  lateBadge: { fontSize: 11, fontWeight: '800' },
  lateMeta: { fontSize: 10.5, marginTop: 2 },

  detRow: { flexDirection: 'row', alignItems: 'center', borderTopWidth: 1, borderTopColor: '#EEE', paddingVertical: 8, gap: 8, flexWrap: 'wrap' },
  detDateCol: { width: 58 },
  detDate: { fontSize: 11.5, fontWeight: '700' },
  detDay: { fontSize: 10 },
  detMid: { flex: 1, gap: 1 },
  detPunch: { fontSize: 10.5, fontWeight: '700' },
  detRight: { alignItems: 'flex-end', width: 54 },
  detHours: { fontSize: 11, fontWeight: '800' },
  detLate: { fontSize: 10 },
  detBadge: { paddingHorizontal: 7, paddingVertical: 2, borderRadius: 999, borderWidth: 1 },
  detBadgeText: { fontSize: 9, fontWeight: '800' },

  totalsList: { gap: 6 },
  totalRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  totalLabel: { fontSize: 12 },
  totalValue: { fontSize: 12.5, fontWeight: '800' },

  exportMsg: { marginTop: 10, padding: 10, borderRadius: 10, borderWidth: 1 },
  exportMsgText: { fontSize: 11.5, fontWeight: '600' },

  empty: { fontSize: 12, textAlign: 'center', paddingVertical: 14 },
});

export default EmployeeReportsScreen;