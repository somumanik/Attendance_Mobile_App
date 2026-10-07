// ============================================================================
// FILE: mobile/src/screens/employee/EmployeeDashboardScreen.jsx
// PURPOSE: Employee Dashboard - personal (employee-wise) real attendance summary
// ============================================================================

/**
 * Ye screen EMPLOYEE ka dashboard hai - sirf logged-in employee ka real data.
 *
 * Navigation Flow:
 * EmployeeNavigator (Dashboard Tab) → EmployeeDashboardScreen
 *
 * Data Flow:
 * Employee Login → POST /api/auth/employee/login → JWT (paycode inside the token)
 *              → GET /api/me → authStore.userData (paycode, empname, ...)
 *              → Dashboard → GET /api/employee/dashboard
 *
 * Identity & security:
 * The paycode is NEVER taken from the UI, a route param or a hardcoded constant.
 * This screen never sends a paycode at all: the backend takes the employee from
 * the verified JWT (req.user.paycode) on every call, so employee 1053 always sees
 * 1053's data and can never request anyone else's.
 *
 * Data source (existing endpoint, no new API and no new attendance logic):
 * GET /api/employee/dashboard returns, for the logged-in employee and the same
 * period the website uses:
 *   { present, absent, miss, late, hours, attendancePercentage, records,
 *     today, attendance[], lateDetails[], graceRemaining }
 * present/absent/miss come from classifyRow(), late from
 * computeMonthlyLateForEmployee() (grace aware) and every row from
 * normalizeAttendance() - the SAME helpers HR Single Employee Audit
 * (/api/hr/audit/:paycode) uses, so both screens always agree.
 */

import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { View, Text, ScrollView, StyleSheet, RefreshControl, TouchableOpacity, ActivityIndicator } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useTheme } from '../../theme';
import { ScreenContainer } from '../../components';
import { StatCard, Button, Card, AttendanceBadge, MonthNavigator, currentMonthKey } from '../../components';
import { useAuth } from '../../hooks/useAuth';
import { api } from '../../services/api';
import { API_ENDPOINTS } from '../../utils/constants';
import { getStatusColor } from '../../utils/format';

const clean = (v) => String(v == null ? '' : v).trim();
const PLACEHOLDER = '—';

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

/** Calendar-date helpers: a date is a day, never shifted by a timezone. */
const partsOf = (v) => {
  const s = clean(v).slice(0, 10);
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s);
  if (!m) return null;
  const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  if (d.getFullYear() !== Number(m[1]) || d.getMonth() !== Number(m[2]) - 1 || d.getDate() !== Number(m[3])) return null;
  return d;
};
const shortDate = (v) => {
  const d = partsOf(v);
  return d ? `${String(d.getDate()).padStart(2, '0')}-${MONTHS[d.getMonth()]}-${d.getFullYear()}` : PLACEHOLDER;
};
const dayName = (v) => {
  const d = partsOf(v);
  return d ? WEEKDAYS[d.getDay()] : PLACEHOLDER;
};
/** hoursworked is stored in minutes; display it as hours, no business change. */
const hoursText = (minutes) => {
  const m = Number(minutes);
  if (!Number.isFinite(m) || m <= 0) return '0h';
  const h = Math.floor(m / 60);
  const rem = m % 60;
  return rem ? `${h}h ${String(rem).padStart(2, '0')}m` : `${h}h`;
};

const statusOf = (row) => clean(row?.computedStatus) || clean(row?.statusLabel) || PLACEHOLDER;

// Same colour language the rest of the app uses for these statuses.
const statusColor = (status) => {
  const s = clean(status).toLowerCase();
  if (s.includes('present')) return '#059669';
  if (s.includes('absent')) return '#DC2626';
  if (s.includes('miss')) return '#D97706';
  if (s.includes('week') || s.includes('holiday')) return '#0D9488';
  return '#94A3B8';
};

/**
 * Employee Dashboard Screen Component
 */
export const EmployeeDashboardScreen = () => {
  const { theme } = useTheme();
  // Identity comes from the authenticated session only.
  const { userData } = useAuth();
  const employeeName = clean(userData?.empname) || 'Employee';
  const paycode = clean(userData?.paycode);

  const [data, setData] = useState(null);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState(null);
  // Reporting month: current calendar month by default (exactly the window HR
  // Single Employee Audit uses for that month). Only earlier months can be
  // selected, so a future month is never shown.
  const [month, setMonth] = useState(currentMonthKey());

  const load = useCallback(async (isRefresh, targetMonth) => {
    if (isRefresh) setIsRefreshing(true); else setIsLoading(true);
    setError(null);
    try {
      // No paycode is passed: the backend resolves identity from the JWT.
      const m = targetMonth || month;
      const res = await api.get(API_ENDPOINTS.EMPLOYEE_DASHBOARD, { month: m });
      setData(res);
    } catch (e) {
      // Never fall back to fake numbers - show a real error instead.
      setData(null);
      setError('Unable to load your attendance data. Please try again.');
    } finally {
      setIsLoading(false);
      setIsRefreshing(false);
    }
  }, [month]);

  useEffect(() => { load(false, month); }, [month]); // eslint-disable-line react-hooks/exhaustive-deps

  // Rows come newest-first from the API (same order the website/HR audit use).
  const rows = useMemo(() => (Array.isArray(data?.attendance) ? data.attendance : []), [data]);

  const todayRow = useMemo(() => {
    const today = clean(data?.today);
    if (!today) return null;
    return rows.find((r) => clean(r.date || r.dateoffice).slice(0, 10) === today) || null;
  }, [rows, data]);

  const recent = useMemo(() => rows.slice(0, 5), [rows]);

  const stats = useMemo(() => ({
    present: Number(data?.present || 0),
    absent: Number(data?.absent || 0),
    miss: Number(data?.miss || 0),
    late: Number(data?.late || 0),
    hours: Number(data?.hours || 0),
    percentage: Number(data?.attendancePercentage || 0),
  }), [data]);

  // Late Arrival Details: `lateDetails` carries date / lateMinutes / graceUsed /
  // isFinalLate from the existing backend late logic. Shift and the formatted
  // In time come from the SAME attendance rows (normalizeAttendance exposes both),
  // joined on the date - no new calculation and no invented shift-start value.
  const lateDetails = useMemo(() => {
    const list = Array.isArray(data?.lateDetails) ? data.lateDetails : [];
    return list.slice(0, 5).map((l) => {
      const d = clean(l.date).slice(0, 10);
      const row = rows.find((r) => clean(r.date || r.dateoffice).slice(0, 10) === d);
      return {
        date: l.date,
        shift: clean(row?.shift),
        inTime: clean(row?.inTime),
        lateMinutes: Number(l.lateMinutes || 0),
        graceUsed: clean(l.graceUsed),
        isFinalLate: l.isFinalLate !== false,
      };
    });
  }, [data, rows]);

  const grace = data?.graceRemaining;
  const graceTotal = grace ? (Number(grace.grace30min || 0) + Number(grace.grace1hr || 0) + Number(grace.grace2hr || 0)) : null;
  const graceLeft = grace ? (Number(grace.grace30min || 0) + Number(grace.grace1hr || 0) + Number(grace.grace2hr || 0)) : null;

  // Aggregates cover exactly the window the backend reports, so the label can
  // never disagree with the numbers (the backend never counts a future date).
  const window_ = useMemo(() => ({
    from: clean(data?.fromDate) || '',
    to: clean(data?.toDate) || clean(data?.today),
  }), [data]);
  const periodLabel = useMemo(() => {
    if (!data) return '';
    const sameMonth = window_.from && window_.to && window_.from.slice(0, 7) === window_.to.slice(0, 7);
    if (sameMonth) return `This Month (${shortDate(window_.from)} - ${shortDate(window_.to)})`;
    return `${shortDate(window_.from)} - ${shortDate(window_.to)}`;
  }, [data, window_]);

  // Attendance distribution for the real reporting window.
  const distribution = useMemo(() => ([
    { key: 'present', label: 'Present', value: stats.present, color: '#059669' },
    { key: 'absent', label: 'Absent', value: stats.absent, color: '#DC2626' },
    { key: 'miss', label: 'Miss Punch', value: stats.miss, color: '#D97706' },
    { key: 'weekOff', label: 'Week Off', value: Number(data?.weekOff || 0), color: '#0D9488' },
  ]), [stats, data]);
  const distributionTotal = distribution.reduce((a, d) => a + d.value, 0);

  // Last 30 completed/relevant days, real status per date (oldest -> newest).
  const trend = useMemo(() => (Array.isArray(data?.trend) ? data.trend : []), [data]);
  const maxHours = useMemo(() => Math.max(1, ...trend.map((t) => Number(t.hoursworked || 0))), [trend]);

  const todayStatus = todayRow ? statusOf(todayRow) : (rows.length ? PLACEHOLDER : 'No record');

  return (
    <ScreenContainer title="" showHeader={false}>
      <ScrollView
        refreshControl={
          <RefreshControl refreshing={isRefreshing} onRefresh={() => load(true)} colors={[theme.primary]} progressViewOffset={60} />
        }
        contentContainerStyle={styles.scrollContent}
        showsVerticalScrollIndicator={false}
      >
        {/* Greeting Header — real employee name + today's real status */}
        <View style={styles.greetingHeader}>
          <View style={styles.greetingContent}>
            <Text style={[styles.greetingTitle, { color: theme.textPrimary }]}>Welcome</Text>
            <Text style={[styles.greetingName, { color: theme.textPrimary }]} numberOfLines={1}>{employeeName}</Text>
            <Text style={[styles.greetingMeta, { color: theme.textTertiary }]}>Paycode: {paycode || PLACEHOLDER}</Text>
          </View>
          <View style={[styles.todayStatusCard, { backgroundColor: theme.primary }]}>
            <Text style={[styles.todayStatusLabel, { color: 'rgba(255,255,255,0.9)' }]}>Today's Status</Text>
            <Text style={[styles.todayStatusValue, { color: theme.textOnPrimary }]} numberOfLines={1}>{todayStatus}</Text>
            <Text style={[styles.todayStatusTime, { color: 'rgba(255,255,255,0.85)' }]}>
              {`In: ${clean(todayRow?.inTime) || PLACEHOLDER}`}
            </Text>
            <Text style={[styles.todayStatusTime, { color: 'rgba(255,255,255,0.85)' }]}>
              {`Out: ${clean(todayRow?.outTime) || PLACEHOLDER}`}
            </Text>
          </View>
        </View>

        {isLoading ? (
          <View style={styles.stateBox}>
            <ActivityIndicator size="large" color={theme.primary} />
            <Text style={[styles.stateText, { color: theme.textSecondary }]}>Loading your attendance...</Text>
          </View>
        ) : null}

        {!isLoading && error ? (
          <Card style={styles.sectionCard}>
            <Text style={[styles.errorText, { color: theme.error }]}>⚠️ {error}</Text>
            <Button title="Retry" onPress={() => load(false)} variant="outline" size="small" style={{ marginTop: 12 }} />
          </Card>
        ) : null}

        {!isLoading && !error && data ? (
          <>
            {/* Month navigation — same control the HR month views use, forward disabled
            at the current month so a future month is never selected */}
            <MonthNavigator month={month} onChange={setMonth} />

            {/* Period label comes from the window the backend actually aggregated */}
            <Text style={[styles.periodLabel, { color: theme.textTertiary }]}>{periodLabel}</Text>

            {/* Stats Grid */}
            <View style={styles.statsGrid}>
              <StatCard
                title="Present Days"
                value={stats.present}
                subtitle={`${stats.percentage}%`}
                icon="✅"
                color={theme.success}
              />
              <StatCard
                title="Absent Days"
                value={stats.absent}
                subtitle="This Month"
                icon="❌"
                color={theme.error}
              />
              <StatCard
                title="Miss Punch"
                value={stats.miss}
                subtitle="Pending Review"
                icon="⚠️"
                color={theme.warning}
              />
              <StatCard
                title="Late Arrivals"
                value={stats.late}
                subtitle={graceLeft !== null ? `${graceLeft} grace left` : 'This Month'}
                icon="⏰"
                color={theme.error}
              />
            </View>

            {/* Work Hours Card */}
            <Card style={styles.sectionCard} elevation="raised">
              <View style={styles.sectionHeader}>
                <Text style={[styles.sectionTitle, { color: theme.textPrimary }]}>Work Hours</Text>
                <Text style={[styles.sectionSubtitle, { color: theme.textSecondary }]}>This Month</Text>
              </View>
              <View style={styles.hoursDisplay}>
                <Text style={[styles.hoursValue, { color: theme.primary, fontSize: 48, fontWeight: '700' }]}>
                  {hoursText(stats.hours)}
                </Text>
                <Text style={[styles.hoursLabel, { color: theme.textSecondary }]}>Total Worked Hours</Text>
              </View>
            </Card>

            {/* Attendance Overview Card */}
            <Card style={styles.sectionCard} elevation="raised">
              <View style={styles.sectionHeader}>
                <Text style={[styles.sectionTitle, { color: theme.textPrimary }]}>Attendance Overview</Text>
                <Text style={[styles.sectionSubtitle, { color: theme.textSecondary }]}>Current Month Summary</Text>
              </View>

              <View style={styles.overviewGrid}>
                {[
                  { k: 'Present', v: stats.present, c: theme.success, d: 'Days Present' },
                  { k: 'Absent', v: stats.absent, c: theme.error, d: 'Days Absent' },
                  { k: 'Miss Punch', v: stats.miss, c: theme.warning, d: 'Incomplete Records' },
                  { k: 'Late', v: stats.late, c: theme.error, d: 'Late Arrivals' },
                ].map((o) => (
                  <View key={o.k} style={[styles.overviewBox, { borderColor: `${o.c}33` }]}>
                    <Text style={[styles.overviewValue, { color: o.c }]}>{o.v}</Text>
                    <Text style={[styles.overviewLabel, { color: theme.textPrimary }]}>{o.k}</Text>
                    <Text style={[styles.overviewDesc, { color: theme.textTertiary }]}>{o.d}</Text>
                  </View>
                ))}
              </View>
            </Card>

            {/* Late Arrival details — values straight from the existing backend late logic */}
            <Card style={styles.sectionCard} elevation="raised">
              <View style={styles.sectionHeader}>
                <Text style={[styles.sectionTitle, { color: theme.textPrimary }]}>Late Arrival Details</Text>
                <Text style={[styles.sectionSubtitle, { color: theme.textSecondary }]}>
                  {graceTotal !== null ? `Grace left: ${graceLeft} of ${graceTotal}` : 'This Month'}
                </Text>
              </View>

              {lateDetails.length ? (
                <View style={styles.lateList}>
                  {lateDetails.map((l, i) => (
                    <View key={`${shortDate(l.date)}-${i}`} style={[styles.lateRow, { borderColor: theme.border }]}>
                      <View style={styles.lateRowTop}>
                        <Text style={[styles.lateDate, { color: theme.textPrimary }]}>{shortDate(l.date)}</Text>
                        <Text style={[styles.lateBadge, { color: l.isFinalLate ? theme.error : theme.success }]}>
                          {`Late ${l.lateMinutes} min`}
                        </Text>
                      </View>
                      <Text style={[styles.lateMeta, { color: theme.textSecondary }]}>
                        {`Shift: ${l.shift || PLACEHOLDER}`}
                      </Text>
                      <Text style={[styles.lateMeta, { color: theme.textSecondary }]}>
                        {`Actual In: ${l.inTime || PLACEHOLDER}`}
                      </Text>
                      <Text style={[styles.lateMeta, { color: theme.textTertiary }]}>
                        {`Status: ${l.isFinalLate ? 'Late (final)' : `Covered by ${l.graceUsed || 'grace'}`}`}
                      </Text>
                    </View>
                  ))}
                </View>
              ) : (
                <Text style={[styles.emptyText, { color: theme.textTertiary }]}>
                  This month koi late arrival record nahi hai.
                </Text>
              )}
            </Card>

            {/* Attendance Distribution — real counts from the reporting window */}
            <Card style={styles.sectionCard} elevation="raised">
              <View style={styles.sectionHeader}>
                <Text style={[styles.sectionTitle, { color: theme.textPrimary }]}>Attendance Distribution</Text>
                <Text style={[styles.sectionSubtitle, { color: theme.textSecondary }]}>
                  {distributionTotal} days
                </Text>
              </View>

              {distributionTotal > 0 ? (
                <>
                  <View style={[styles.distTrack, { backgroundColor: theme.surfaceVariant || '#F1F5F9' }]}>
                    {distribution.filter((d) => d.value > 0).map((d) => (
                      <View key={d.key} style={{ flex: d.value, backgroundColor: d.color, height: '100%' }} />
                    ))}
                  </View>
                  <View style={styles.distLegend}>
                    {distribution.map((d) => (
                      <View key={d.key} style={styles.distLegendItem}>
                        <View style={[styles.distDot, { backgroundColor: d.color }]} />
                        <Text style={[styles.distLegendText, { color: theme.textSecondary }]}>{d.label}</Text>
                        <Text style={[styles.distLegendValue, { color: d.color }]}>{d.value}</Text>
                      </View>
                    ))}
                  </View>
                </>
              ) : (
                <Text style={[styles.emptyText, { color: theme.textTertiary }]}>
                  Is window me koi attendance record nahi hai.
                </Text>
              )}
            </Card>

            {/* Attendance Trend — real status for each of the last 30 days */}
            <Card style={styles.sectionCard} elevation="raised">
              <View style={styles.sectionHeader}>
                <Text style={[styles.sectionTitle, { color: theme.textPrimary }]}>Attendance Trend</Text>
                <Text style={[styles.sectionSubtitle, { color: theme.textSecondary }]}>
                  {`${clean(data.trendFrom) ? shortDate(data.trendFrom) : PLACEHOLDER} - ${clean(data.trendTo) ? shortDate(data.trendTo) : PLACEHOLDER}`}
                </Text>
              </View>

              {trend.length ? (
                <View style={styles.trendWrap}>
                  <View style={styles.trendStrip}>
                    {trend.map((t) => (
                      <View key={t.date} style={styles.trendCol}>
                        <View style={[styles.trendBar, { backgroundColor: statusColor(t.status), height: `${Math.max(8, Math.min(100, (Number(t.hoursworked || 0) / maxHours) * 100))}%` }]} />
                      </View>
                    ))}
                  </View>
                  <View style={styles.trendAxis}>
                    <Text style={[styles.trendAxisText, { color: theme.textTertiary }]}>{shortDate(trend[0].date)}</Text>
                    <Text style={[styles.trendAxisText, { color: theme.textTertiary }]}>
                      {trend.length} days
                    </Text>
                    <Text style={[styles.trendAxisText, { color: theme.textTertiary }]}>{shortDate(trend[trend.length - 1].date)}</Text>
                  </View>
                  <View style={styles.trendLegend}>
                    {['Present', 'Absent', 'Miss Punch', 'Week Off'].map((s) => (
                      <View key={s} style={styles.distLegendItem}>
                        <View style={[styles.distDot, { backgroundColor: statusColor(s) }]} />
                        <Text style={[styles.distLegendText, { color: theme.textSecondary }]}>{s}</Text>
                      </View>
                    ))}
                  </View>
                </View>
              ) : (
                <Text style={[styles.emptyText, { color: theme.textTertiary }]}>Trend data nahi hai.</Text>
              )}
            </Card>

            {/* Working Hours Trend — hoursworked is stored in MINUTES and converted */}
            <Card style={styles.sectionCard} elevation="raised">
              <View style={styles.sectionHeader}>
                <Text style={[styles.sectionTitle, { color: theme.textPrimary }]}>Working Hours Trend</Text>
                <Text style={[styles.sectionSubtitle, { color: theme.textSecondary }]}>Last {trend.length} days</Text>
              </View>

              {trend.length ? (
                <View style={styles.trendWrap}>
                  <View style={styles.trendStrip}>
                    {trend.map((t) => (
                      <View key={t.date} style={styles.trendCol}>
                        <View style={[styles.trendBar, { backgroundColor: '#4338CA', height: `${Math.max(6, Math.min(100, (Number(t.hoursworked || 0) / maxHours) * 100))}%` }]} />
                      </View>
                    ))}
                  </View>
                  <View style={styles.trendAxis}>
                    <Text style={[styles.trendAxisText, { color: theme.textTertiary }]}>Peak {hoursText(maxHours)}</Text>
                    <Text style={[styles.trendAxisText, { color: theme.textTertiary }]}>0h</Text>
                    <Text style={[styles.trendAxisText, { color: theme.textTertiary }]}>Total {hoursText(stats.hours)}</Text>
                  </View>
                </View>
              ) : (
                <Text style={[styles.emptyText, { color: theme.textTertiary }]}>Hours data nahi hai.</Text>
              )}
            </Card>

            {/* Recent Attendance Preview — real rows */}
            <Card style={styles.sectionCard} elevation="raised">
              <View style={styles.sectionHeader}>
                <Text style={[styles.sectionTitle, { color: theme.textPrimary }]}>Recent Attendance</Text>
                <Text style={[styles.sectionSubtitle, { color: theme.textSecondary }]}>Last 5 Records</Text>
              </View>

              {recent.length ? (
                <View style={styles.recentList}>
                  {recent.map((r, index) => {
                    const label = statusOf(r);
                    return (
                      <View key={`${clean(r.date)}-${index}`} style={[styles.recentItem, { borderColor: theme.border }]}>
                        <View style={styles.recentDate}>
                          <Text style={[styles.recentDay, { color: theme.textPrimary }]}>{dayName(r.date)}</Text>
                          <Text style={[styles.recentDateText, { color: theme.textTertiary }]}>{shortDate(r.date)}</Text>
                        </View>
                        <View style={styles.recentDetails}>
                          <View style={styles.recentStatus}>
                            <AttendanceBadge status={label.toLowerCase().replace(' ', '')} size="small" />
                            <Text style={[styles.recentStatusText, { color: theme.textPrimary }]}>{label}</Text>
                          </View>
                          <View style={styles.recentTimes}>
                            <Text style={[styles.recentTimeLabel, { color: theme.textSecondary }]}>
                              {`In: ${clean(r.inTime) || PLACEHOLDER}`}
                            </Text>
                            <Text style={[styles.recentTimeLabel, { color: theme.textSecondary }]}>
                              {`Out: ${clean(r.outTime) || PLACEHOLDER}`}
                            </Text>
                          </View>
                        </View>
                        <View style={styles.recentHours}>
                          <Text style={[styles.recentHoursText, { color: theme.primary }]}>{hoursText(r.hoursworked)}</Text>
                        </View>
                      </View>
                    );
                  })}
                </View>
              ) : (
                <Text style={[styles.emptyText, { color: theme.textTertiary }]}>
                  Is period me koi attendance record nahi hai.
                </Text>
              )}
            </Card>
          </>
        ) : null}
      </ScrollView>
    </ScreenContainer>
  );
};

const styles = StyleSheet.create({
  scrollContent: { paddingHorizontal: 16, paddingBottom: 32 },
  greetingHeader: { marginBottom: 16, flexDirection: 'row', alignItems: 'center', gap: 12 },
  greetingContent: { flex: 1 },
  greetingTitle: { fontSize: 20, fontWeight: '700' },
  greetingName: { fontSize: 26, fontWeight: '700', marginTop: 2 },
  greetingMeta: { fontSize: 12, marginTop: 2 },
  todayStatusCard: { width: 160, borderRadius: 16, padding: 16, alignItems: 'center', justifyContent: 'center' },
  todayStatusLabel: { fontSize: 11, fontWeight: '600', textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 4 },
  todayStatusValue: { fontSize: 16, fontWeight: '700' },
  todayStatusTime: { fontSize: 11, marginTop: 3 },
  periodLabel: { fontSize: 12, marginBottom: 10 },
  stateBox: { paddingVertical: 40, alignItems: 'center', gap: 10 },
  stateText: { fontSize: 13 },
  errorText: { fontSize: 13 },
  statsGrid: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'space-between', marginBottom: 16, gap: 12 },
  sectionCard: { borderRadius: 16, padding: 16, marginBottom: 16 },
  sectionHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-end', marginBottom: 16 },
  sectionTitle: { fontSize: 18, fontWeight: '700' },
  sectionSubtitle: { fontSize: 12 },
  hoursDisplay: { alignItems: 'center', paddingVertical: 8 },
  hoursValue: { fontSize: 48, fontWeight: '700' },
  hoursLabel: { marginTop: 4 },
  overviewGrid: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'space-between', gap: 12 },
  overviewBox: { flexGrow: 1, minWidth: 140, borderWidth: 1, borderRadius: 12, padding: 12, alignItems: 'center' },
  overviewValue: { fontSize: 22, fontWeight: '800' },
  overviewLabel: { fontSize: 12, fontWeight: '700', marginTop: 2 },
  overviewDesc: { fontSize: 10, marginTop: 1 },
  lateList: { gap: 10 },
  lateRow: { paddingVertical: 8, paddingHorizontal: 12, borderRadius: 10, borderWidth: 1 },
  lateRowTop: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 4 },
  lateDate: { fontSize: 12.5, fontWeight: '700' },
  lateBadge: { fontSize: 11, fontWeight: '800' },
  lateMeta: { fontSize: 11 },
  recentList: { gap: 12, marginBottom: 12 },
  recentItem: { flexDirection: 'row', alignItems: 'center', paddingVertical: 12, paddingHorizontal: 16, borderRadius: 12, borderWidth: StyleSheet.hairlineWidth },
  recentDate: { width: 74, alignItems: 'center' },
  recentDay: { fontWeight: '700' },
  recentDateText: { fontSize: 11 },
  recentDetails: { flex: 1, gap: 4 },
  recentStatus: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  recentStatusText: { fontWeight: '600', fontSize: 12 },
  recentTimes: { flexDirection: 'row', gap: 16 },
  recentTimeLabel: { fontSize: 11 },
  recentHours: { alignItems: 'flex-end', minWidth: 60 },
  recentHoursText: { fontWeight: '600' },
  emptyText: { fontSize: 12, textAlign: 'center', paddingVertical: 12 },
  // Attendance distribution (real counts)
  distTrack: { flexDirection: 'row', height: 16, borderRadius: 999, overflow: 'hidden' },
  distLegend: { flexDirection: 'row', flexWrap: 'wrap', gap: 12, marginTop: 10 },
  distLegendItem: { flexDirection: 'row', alignItems: 'center', gap: 5 },
  distDot: { width: 9, height: 9, borderRadius: 3 },
  distLegendText: { fontSize: 11 },
  distLegendValue: { fontSize: 11, fontWeight: '800' },
  // Attendance / working-hours trend (real daily data)
  trendWrap: { gap: 6 },
  trendStrip: { flexDirection: 'row', alignItems: 'flex-end', height: 84, gap: 2 },
  trendCol: { flex: 1, height: '100%', justifyContent: 'flex-end' },
  trendBar: { width: '100%', borderRadius: 2, minHeight: 6 },
  trendAxis: { flexDirection: 'row', justifyContent: 'space-between' },
  trendAxisText: { fontSize: 9.5 },
  trendLegend: { flexDirection: 'row', flexWrap: 'wrap', gap: 10, marginTop: 4 },
});

export default EmployeeDashboardScreen;