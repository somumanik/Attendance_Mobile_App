// ============================================================================
// FILE: mobile/src/screens/employee/EmployeeAttendanceScreen.jsx
// PURPOSE: Employee Attendance - real month-wise attendance, calendar, late & grace
// ============================================================================

/**
 * Ye screen EMPLOYEE ka apna attendance history dikhata hai.
 *
 * Navigation Flow:
 * EmployeeNavigator (Attendance Tab) -> EmployeeAttendanceScreen
 *
 * Data Flow:
 * Employee Login -> POST /api/auth/employee/login -> JWT (paycode inside the token)
 *              -> GET /api/me -> authStore.userData
 *              -> GET /api/employee/dashboard?month=YYYY-MM
 *
 * Identity & security:
 * The paycode is NEVER taken from the UI, a route param or a hardcoded constant.
 * The screen sends only `month`; the backend resolves the employee from the
 * verified JWT (req.user.paycode), so employee 1053 always sees 1053's records
 * and can never request another employee's attendance.
 *
 * Data source (the SAME verified logic as HR Admin -> Single Employee Audit):
 * GET /api/employee/dashboard returns, for the logged-in employee and month:
 *   { present, absent, miss, late, hours, weekOff, records, fromDate, toDate,
 *     attendance[], lateDetails[], graceRemaining }
 * present/absent/miss/weekOff come from classifyRow(), late from
 * computeMonthlyLateForEmployee() (grace aware) and every row from
 * normalizeAttendance() - identical helpers to /api/hr/audit/:paycode, so both
 * screens always show the same numbers for the same employee + month.
 *
 * hoursworked is stored in MINUTES and is converted for display only; no new
 * attendance rule is introduced anywhere in this file.
 */

import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { View, Text, ScrollView, StyleSheet, TouchableOpacity, Modal, RefreshControl, ActivityIndicator } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useTheme } from '../../theme';
import { Card, Button, ScreenContainer, currentMonthKey } from '../../components';
import { useAuth } from '../../hooks/useAuth';
import { api } from '../../services/api';
import { API_ENDPOINTS } from '../../utils/constants';

const clean = (v) => String(v == null ? '' : v).trim();
const PLACEHOLDER = '—';

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

/** Calendar dates only - a day is never shifted by a timezone. */
const partsOf = (v) => {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(clean(v));
  if (!m) return null;
  const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  if (d.getFullYear() !== Number(m[1]) || d.getMonth() !== Number(m[2]) - 1 || d.getDate() !== Number(m[3])) return null;
  return d;
};
const shortDate = (v) => {
  const d = partsOf(v);
  return d ? `${String(d.getDate()).padStart(2, '0')}-${MONTHS[d.getMonth()]}` : PLACEHOLDER;
};
const dayName = (v) => {
  const d = partsOf(v);
  return d ? WEEKDAYS[d.getDay()] : PLACEHOLDER;
};
const isoOf = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

// Month stepping is pure calendar arithmetic on the 'YYYY-MM' key - no dates are
// ever parsed through UTC, so an attendance date can never shift a day.
const monthKeyOf = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
const shiftMonthKey = (key, delta) => {
  const m = /^(\d{4})-(\d{2})$/.exec(clean(key));
  if (!m) return currentMonthKey();
  const d = new Date(Number(m[1]), Number(m[2]) - 1 + delta, 1);
  return monthKeyOf(d);
};
const previousMonthKey = (key) => shiftMonthKey(key, -1);
const nextMonthKey = (key) => shiftMonthKey(key, 1);

/** hoursworked is minutes; display-only conversion. */
const hoursText = (minutes) => {
  const m = Number(minutes);
  if (!Number.isFinite(m) || m <= 0) return '0h';
  const h = Math.floor(m / 60);
  const rem = m % 60;
  return rem ? `${h}h ${String(rem).padStart(2, '0')}m` : `${h}h`;
};

const statusOf = (row) => clean(row?.computedStatus) || clean(row?.statusLabel) || PLACEHOLDER;

/**
 * Calendar colour for a day, derived ONLY from the backend's existing
 * classification (computedStatus) and its raw statusCode:
 *   Present -> green, Absent -> red, Miss Punch -> orange,
 *   Holiday (statusCode H/HOLIDAY) -> purple, Week Off -> yellow.
 * A day that is not in the month, or has no attendance record yet (a future
 * date), stays neutral - a future date is NEVER treated as Absent.
 * Late never changes the day colour; the main status is always kept.
 */
const STATUS_COLORS = {
  Present: '#059669',   // green
  Absent: '#DC2626',    // red
  'Miss Punch': '#D97706', // orange
  Holiday: '#7C3AED',   // purple
  'Week Off': '#CA8A04',  // yellow
};
const dayColor = (row) => {
  if (!row) return null;                                   // no record -> neutral
  const code = clean(row.statusCode).toUpperCase();
  if (code === 'H' || code === 'HOLIDAY') return STATUS_COLORS.Holiday;
  const label = statusOf(row);
  if (label === 'Week Off' || label === 'Holiday') return STATUS_COLORS['Week Off'];
  return STATUS_COLORS[label] || null;
};
const isHolidayRow = (row) => {
  const code = clean(row?.statusCode).toUpperCase();
  return code === 'H' || code === 'HOLIDAY';
};
const LEGEND = [
  { label: 'Present', color: STATUS_COLORS.Present },
  { label: 'Absent', color: STATUS_COLORS.Absent },
  { label: 'Miss Punch', color: STATUS_COLORS['Miss Punch'] },
  { label: 'Holiday', color: STATUS_COLORS.Holiday },
  { label: 'Weekly Off', color: STATUS_COLORS['Week Off'] },
];

/**
 * Employee Attendance Screen Component
 */
export const EmployeeAttendanceScreen = () => {
  const { theme } = useTheme();
  const { userData } = useAuth();
  const employeeName = clean(userData?.empname) || 'Employee';
  const paycode = clean(userData?.paycode);

  const [month, setMonth] = useState(currentMonthKey());
  const [data, setData] = useState(null);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState(null);
  const [pickedDay, setPickedDay] = useState(null);

  const load = useCallback(async (isRefresh, targetMonth) => {
    if (isRefresh) setIsRefreshing(true); else setIsLoading(true);
    setError(null);
    try {
      // Only the month is sent - the backend uses the authenticated identity.
      const res = await api.get(API_ENDPOINTS.EMPLOYEE_DASHBOARD, { month: targetMonth });
      setData(res);
    } catch (e) {
      // Never substitute fake numbers - show a real error instead.
      setData(null);
      setError('Unable to load your attendance data. Please try again.');
    } finally {
      setIsLoading(false);
      setIsRefreshing(false);
    }
  }, []);

  useEffect(() => { load(false, month); }, [month]); // eslint-disable-line react-hooks/exhaustive-deps

  // Rows oldest -> newest (the attendance tab is always ascending).
  const rows = useMemo(() => {
    const list = Array.isArray(data?.attendance) ? data.attendance.slice() : [];
    return list
      .map((r, i) => ({ r, i, key: clean(r.date || r.dateoffice).slice(0, 10) }))
      .sort((a, b) => (a.key < b.key ? -1 : a.key > b.key ? 1 : a.i - b.i))
      .map((x) => x.r);
  }, [data]);

  const byDate = useMemo(() => {
    const m = new Map();
    rows.forEach((r) => m.set(clean(r.date || r.dateoffice).slice(0, 10), r));
    return m;
  }, [rows]);

  /**
   * Google-style month grid for the SELECTED month: Monday-first, correct
   * weekday alignment computed from the real calendar (no hardcoded dates),
   * leading/trailing days from the neighbouring months, leap years handled by
   * the Date object. Only the day-number layout is computed here - the status
   * for each day always comes from the real attendance rows.
   */
  const calendarCells = useMemo(() => {
    const m = /^(\d{4})-(\d{2})$/.exec(clean(month));
    if (!m) return [];
    const year = Number(m[1]);
    const mon = Number(m[2]) - 1;
    const first = new Date(year, mon, 1);
    // JS getDay(): 0 = Sunday. Monday-first offset.
    const lead = (first.getDay() + 6) % 7;
    const gridStart = new Date(year, mon, 1 - lead);
    const cells = [];
    for (let i = 0; i < 42; i += 1) {
      const d = new Date(gridStart.getFullYear(), gridStart.getMonth(), gridStart.getDate() + i);
      const key = isoOf(d);
      cells.push({
        key,
        day: d.getDate(),
        inMonth: d.getMonth() === mon && d.getFullYear() === year,
        row: byDate.get(key) || null,
      });
    }
    return cells;
  }, [month, byDate]);

  // Weekday header, Monday first (matching the grid).
  const WEEK_HEADER = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

  // Late records joined with the attendance row for shift / formatted In time.
  const lateList = useMemo(() => {
    const list = Array.isArray(data?.lateDetails) ? data.lateDetails : [];
    return list
      .map((l, i) => {
        const key = clean(l.date).slice(0, 10);
        const row = byDate.get(key);
        return {
          key: `${key}-${i}`,
          date: l.date,
          inTime: clean(row?.inTime) || PLACEHOLDER,
          shift: clean(row?.shift) || PLACEHOLDER,
          lateMinutes: Number(l.lateMinutes || 0),
          graceUsed: clean(l.graceUsed),
          covered: l.isFinalLate === false,
        };
      })
      .sort((a, b) => (a.key < b.key ? -1 : a.key > b.key ? 1 : 0));
  }, [data, byDate]);

  // Grace consumption: derived arithmetically from the backend's own remaining
  // values (quota per tier is the same constant the server uses).
  const grace = useMemo(() => {
    const g = data?.graceRemaining;
    if (!g) return null;
    const tiers = [
      { name: '30-min', total: 2, left: Number(g.grace30min || 0) },
      { name: '1-hour', total: 1, left: Number(g.grace1hr || 0) },
      { name: '2-hour', total: 1, left: Number(g.grace2hr || 0) },
    ];
    return {
      tiers: tiers.map((t) => ({ ...t, used: Math.max(0, t.total - t.left) })),
      used: tiers.reduce((a, t) => a + Math.max(0, t.total - t.left), 0),
      total: tiers.reduce((a, t) => a + t.total, 0),
    };
  }, [data]);

  const summary = useMemo(() => ({
    present: Number(data?.present || 0),
    absent: Number(data?.absent || 0),
    miss: Number(data?.miss || 0),
    late: Number(data?.late || 0),
    hours: Number(data?.hours || 0),
    weekOff: Number(data?.weekOff || 0),
  }), [data]);

  const summaryCard = (label, value, color, sub) => (
    <View style={[styles.sumBox, { borderColor: `${color}44` }]}>
      <Text style={[styles.sumValue, { color }]}>{value}</Text>
      <Text style={[styles.sumLabel, { color: theme.textSecondary }]}>{label}</Text>
      {sub ? <Text style={[styles.sumSub, { color: theme.textTertiary }]}>{sub}</Text> : null}
    </View>
  );

  return (
    <ScreenContainer title="My Attendance" showHeader={true}>
      <ScrollView
        refreshControl={<RefreshControl refreshing={isRefreshing} onRefresh={() => load(true, month)} colors={[theme.primary]} />}
        contentContainerStyle={styles.scroll}
        showsVerticalScrollIndicator={false}
      >
        <Text style={[styles.who, { color: theme.textTertiary }]}>
          {`${employeeName} · Paycode ${paycode || PLACEHOLDER}`}
        </Text>

        {/* ---------- Month navigation (calendar + details stay in sync) ---------- */}
        <View style={[styles.navBar, { borderColor: theme.border, backgroundColor: theme.surface || '#FFFFFF' }]}>
          <TouchableOpacity
            style={styles.navArrow}
            accessibilityLabel="Previous month"
            activeOpacity={0.7}
            onPress={() => setMonth(previousMonthKey(month))}
          >
            <Ionicons name="chevron-back" size={20} color={theme.primary} />
          </TouchableOpacity>
          <Text style={[styles.navLabel, { color: theme.textPrimary }]}>
            {`${MONTHS[Number(clean(month).slice(5, 7)) - 1] || ''} ${clean(month).slice(0, 4)}`}
          </Text>
          <TouchableOpacity
            style={styles.navArrow}
            accessibilityLabel="Next month"
            activeOpacity={0.7}
            onPress={() => setMonth(nextMonthKey(month))}
          >
            <Ionicons name="chevron-forward" size={20} color={theme.primary} />
          </TouchableOpacity>
          {month !== currentMonthKey() ? (
            <TouchableOpacity
              style={[styles.navCurrent, { backgroundColor: `${theme.primary}15`, borderColor: `${theme.primary}40` }]}
              accessibilityLabel="Current month"
              activeOpacity={0.8}
              onPress={() => setMonth(currentMonthKey())}
            >
              <Text style={[styles.navCurrentText, { color: theme.primary }]}>Current</Text>
            </TouchableOpacity>
          ) : null}
        </View>

        {isLoading ? (
          <View style={styles.stateBox}>
            <ActivityIndicator size="large" color={theme.primary} />
            <Text style={[styles.stateText, { color: theme.textSecondary }]}>Loading attendance...</Text>
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
            {/* ---------- Monthly summary ---------- */}
            <Card style={styles.card}>
              <View style={styles.cardHeader}>
                <Text style={[styles.cardTitle, { color: theme.textPrimary }]}>Monthly Summary</Text>
                <Text style={[styles.cardSub, { color: theme.textSecondary }]}>
                  {`${shortDate(data.fromDate)} - ${shortDate(data.toDate)}`}
                </Text>
              </View>
              <View style={styles.sumGrid}>
                {summaryCard('Present', summary.present, '#059669')}
                {summaryCard('Absent', summary.absent, '#DC2626')}
                {summaryCard('Miss Punch', summary.miss, '#D97706')}
                {summaryCard('Late', summary.late, '#7C3AED')}
              </View>
              <View style={styles.hoursRow}>
                <Text style={[styles.hoursLabel, { color: theme.textSecondary }]}>Total Working Hours</Text>
                <Text style={[styles.hoursValue, { color: theme.primary }]}>{hoursText(summary.hours)}</Text>
              </View>
              <Text style={[styles.cardFoot, { color: theme.textTertiary }]}>
                {`${data.records} attendance record(s) · ${summary.weekOff} Week Off`}
              </Text>
            </Card>

            {/* ---------- Google-style monthly attendance calendar ---------- */}
            <Card style={styles.card}>
              <View style={styles.cardHeader}>
                <Text style={[styles.cardTitle, { color: theme.textPrimary }]}>Attendance Calendar</Text>
                <Text style={[styles.cardSub, { color: theme.textSecondary }]}>Tap a date for details</Text>
              </View>

              {/* Weekday header, Monday first (matches the grid) */}
              <View style={styles.calWeekRow}>
                {WEEK_HEADER.map((w) => (
                  <Text key={w} style={[styles.calWeekHead, { color: theme.textTertiary }]}>{w}</Text>
                ))}
              </View>

              {calendarCells.length ? (
                <View style={styles.calGrid}>
                  {calendarCells.map((c) => {
                    const color = c.inMonth ? dayColor(c.row) : null;
                    return (
                      <TouchableOpacity
                        key={c.key}
                        style={[styles.calCell, c.inMonth && c.row && styles.calCellHas]}
                        activeOpacity={0.7}
                        disabled={!c.row}
                        onPress={() => c.row && setPickedDay(c)}
                      >
                        <View style={[styles.calDot, { backgroundColor: color || 'transparent' }]} />
                        <Text
                          style={[
                            styles.calDay,
                            { color: c.inMonth ? (color || theme.textPrimary) : theme.textTertiary },
                            c.inMonth && !c.row && styles.calDayNeutral,
                          ]}
                        >
                          {c.day}
                        </Text>
                        {c.inMonth && c.row && c.row.isLate ? <Text style={styles.calLate}>L</Text> : null}
                        {c.inMonth && c.row && isHolidayRow(c.row) ? <Text style={styles.calHol}>H</Text> : null}
                      </TouchableOpacity>
                    );
                  })}
                </View>
              ) : (
                <Text style={[styles.empty, { color: theme.textTertiary }]}>Calendar nahi bana paaya.</Text>
              )}

              <View style={styles.legend}>
                {LEGEND.map((l) => (
                  <View key={l.label} style={styles.legendItem}>
                    <View style={[styles.legendDot, { backgroundColor: l.color }]} />
                    <Text style={[styles.legendText, { color: theme.textSecondary }]}>{l.label}</Text>
                  </View>
                ))}
              </View>
            </Card>

            {/* ---------- Late arrival details ---------- */}
            <Card style={styles.card}>
              <View style={styles.cardHeader}>
                <Text style={[styles.cardTitle, { color: theme.textPrimary }]}>Late Arrival Details</Text>
                <Text style={[styles.cardSub, { color: theme.textSecondary }]}>{lateList.length} record(s)</Text>
              </View>

              {lateList.length ? lateList.map((l) => (
                <View key={l.key} style={[styles.lateRow, { borderColor: theme.border }]}>
                  <View style={styles.lateRowTop}>
                    <Text style={[styles.lateDate, { color: theme.textPrimary }]}>
                      {`${shortDate(l.date)} (${dayName(l.date)})`}
                    </Text>
                    <Text style={[styles.lateBadge, { color: l.covered ? '#059669' : '#DC2626' }]}>
                      {`Late +${l.lateMinutes} min`}
                    </Text>
                  </View>
                  <Text style={[styles.lateMeta, { color: theme.textSecondary }]}>
                    {`In: ${l.inTime}${l.shift !== PLACEHOLDER ? ` · Shift: ${l.shift}` : ''}`}
                  </Text>
                  <Text style={[styles.lateMeta, { color: theme.textTertiary }]}>
                    {l.covered ? `Covered by ${l.graceUsed || 'grace'}` : 'Not covered by grace'}
                  </Text>
                </View>
              )) : (
                <Text style={[styles.empty, { color: theme.textTertiary }]}>Is month me koi late arrival record nahi hai.</Text>
              )}
            </Card>

            {/* ---------- Grace consumption ---------- */}
            {grace ? (
              <Card style={styles.card}>
                <View style={styles.cardHeader}>
                  <Text style={[styles.cardTitle, { color: theme.textPrimary }]}>Grace Consumption</Text>
                  <Text style={[styles.cardSub, { color: theme.textSecondary }]}>{`${grace.used} of ${grace.total} used`}</Text>
                </View>
                {grace.tiers.map((t) => (
                  <View key={t.name} style={styles.graceRow}>
                    <Text style={[styles.graceName, { color: theme.textPrimary }]}>{`${t.name} grace`}</Text>
                    <View style={styles.graceBarTrack}>
                      {Array.from({ length: t.total }).map((_, i) => (
                        <View key={i} style={[styles.gracePip, { backgroundColor: i < t.used ? theme.primary : theme.border }]} />
                      ))}
                    </View>
                    <Text style={[styles.graceText, { color: theme.textSecondary }]}>{`${t.used}/${t.total} used`}</Text>
                  </View>
                ))}
              </Card>
            ) : null}

            {/* ---------- Attendance details (ascending) ---------- */}
            <Card style={styles.card}>
              <View style={styles.cardHeader}>
                <Text style={[styles.cardTitle, { color: theme.textPrimary }]}>Attendance Details</Text>
                <Text style={[styles.cardSub, { color: theme.textSecondary }]}>{`${rows.length} day(s)`}</Text>
              </View>

              {rows.length ? rows.map((r, i) => {
                const label = isHolidayRow(r) ? 'Holiday' : statusOf(r);
                const color = dayColor(r) || theme.textPrimary;
                const inT = clean(r.inTime);
                const outT = clean(r.outTime);
                return (
                  <TouchableOpacity
                    key={`${clean(r.date)}-${i}`}
                    style={[styles.attRow, { borderColor: theme.border }]}
                    activeOpacity={0.7}
                    onPress={() => setPickedDay({ key: clean(r.date).slice(0, 10), day: partsOf(r.date)?.getDate(), row: r })}
                  >
                    <View style={styles.attDateCol}>
                      <Text style={[styles.attDay, { color: theme.textPrimary }]}>{dayName(r.date)}</Text>
                      <Text style={[styles.attDate, { color: theme.textTertiary }]}>{shortDate(r.date)}</Text>
                    </View>
                    <View style={styles.attPunchCol}>
                      <Text style={[styles.attPunch, { color: inT ? '#166534' : theme.textTertiary }]}>{`In ${inT || PLACEHOLDER}`}</Text>
                      <Text style={[styles.attPunch, { color: outT ? '#991B1B' : theme.textTertiary }]}>{`Out ${outT || PLACEHOLDER}`}</Text>
                    </View>
                    <View style={styles.attRightCol}>
                      <Text style={[styles.attHours, { color: theme.primary }]}>{hoursText(r.hoursworked)}</Text>
                      <View style={[styles.attBadge, { backgroundColor: `${color}18`, borderColor: color }]}>
                        <Text style={[styles.attBadgeText, { color }]}>{label}</Text>
                      </View>
                    </View>
                  </TouchableOpacity>
                );
              }) : (
                <Text style={[styles.empty, { color: theme.textTertiary }]}>Is month me koi attendance record nahi hai.</Text>
              )}
            </Card>
          </>
        ) : null}
      </ScrollView>

      {/* ---------- Day detail ---------- */}
      <Modal visible={!!pickedDay} transparent animationType="slide" onRequestClose={() => setPickedDay(null)}>
        <View style={styles.sheetBackdrop}>
          <TouchableOpacity style={styles.sheetDismiss} activeOpacity={1} onPress={() => setPickedDay(null)} />
          <View style={styles.sheet}>
            {pickedDay && pickedDay.row ? (() => {
              const r = pickedDay.row;
              const color = dayColor(r) || theme.textPrimary;
              const inT = clean(r.inTime);
              const outT = clean(r.outTime);
              const late = lateList.find((l) => l.key.startsWith(pickedDay.key));
              const rowGrace = r.graceUsed ? ` (${clean(r.graceUsed)})` : '';
              return (
                <View>
                  <View style={styles.sheetHeader}>
                    <Text style={[styles.sheetTitle, { color: theme.textPrimary }]}>
                      {`${shortDate(pickedDay.key)} (${dayName(pickedDay.key)})`}
                    </Text>
                    <TouchableOpacity onPress={() => setPickedDay(null)} hitSlop={{ top: 12, left: 12, bottom: 12, right: 12 }}>
                      <Text style={[styles.sheetClose, { color: theme.textSecondary }]}>✕</Text>
                    </TouchableOpacity>
                  </View>
                  <View style={[styles.sheetBadge, { backgroundColor: `${color}18`, borderColor: color }]}>
                    <Text style={[styles.sheetBadgeText, { color }]}>
                      {isHolidayRow(r) ? 'Holiday' : statusOf(r)}
                    </Text>
                  </View>
                  <View style={styles.sheetRow}>
                    <Text style={[styles.sheetKey, { color: theme.textSecondary }]}>In</Text>
                    <Text style={[styles.sheetVal, { color: inT ? '#166534' : theme.textTertiary }]}>{inT || PLACEHOLDER}</Text>
                  </View>
                  <View style={styles.sheetRow}>
                    <Text style={[styles.sheetKey, { color: theme.textSecondary }]}>Out</Text>
                    <Text style={[styles.sheetVal, { color: outT ? '#991B1B' : theme.textTertiary }]}>{outT || PLACEHOLDER}</Text>
                  </View>
                  <View style={styles.sheetRow}>
                    <Text style={[styles.sheetKey, { color: theme.textSecondary }]}>Hours</Text>
                    <Text style={[styles.sheetVal, { color: theme.primary }]}>{hoursText(r.hoursworked)}</Text>
                  </View>
                  {r.shift ? (
                    <View style={styles.sheetRow}>
                      <Text style={[styles.sheetKey, { color: theme.textSecondary }]}>Shift</Text>
                      <Text style={[styles.sheetVal, { color: theme.textPrimary }]}>{clean(r.shift)}</Text>
                    </View>
                  ) : null}
                  <View style={styles.sheetRow}>
                    <Text style={[styles.sheetKey, { color: theme.textSecondary }]}>Status</Text>
                    <Text style={[styles.sheetVal, { color }]}>{isHolidayRow(r) ? 'Holiday' : statusOf(r)}</Text>
                  </View>
                  {late ? (
                    <View style={styles.sheetRow}>
                      <Text style={[styles.sheetKey, { color: theme.textSecondary }]}>Late</Text>
                      <Text style={[styles.sheetVal, { color: late.covered ? '#059669' : '#DC2626' }]}>
                        {`+${late.lateMinutes} min${late.covered ? ` · covered by ${late.graceUsed || 'grace'}` : ' · not covered'}`}
                      </Text>
                    </View>
                  ) : clean(r.latearrival) > 0 ? (
                    <View style={styles.sheetRow}>
                      <Text style={[styles.sheetKey, { color: theme.textSecondary }]}>Late</Text>
                      <Text style={[styles.sheetVal, { color: '#DC2626' }]}>
                        {`+${Number(r.latearrival)} min${rowGrace}`}
                      </Text>
                    </View>
                  ) : null}
                  {grace ? (
                    <View style={styles.sheetRow}>
                      <Text style={[styles.sheetKey, { color: theme.textSecondary }]}>Grace left</Text>
                      <Text style={[styles.sheetVal, { color: theme.textPrimary }]}>
                        {`${grace.tiers.map((t) => `${t.name} ${t.left}/${t.total}`).join(' · ')}`}
                      </Text>
                    </View>
                  ) : null}
                </View>
              );
            })() : null}
          </View>
        </View>
      </Modal>
    </ScreenContainer>
  );
};

const styles = StyleSheet.create({
  scroll: { padding: 12, paddingBottom: 28 },
  who: { fontSize: 12, marginBottom: 8, textAlign: 'center' },
  stateBox: { paddingVertical: 40, alignItems: 'center', gap: 10 },
  stateText: { fontSize: 13 },
  errorText: { fontSize: 13 },
  card: { borderRadius: 14, padding: 14, marginBottom: 12 },
  cardHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 },
  cardTitle: { fontSize: 14.5, fontWeight: '800' },
  cardSub: { fontSize: 11 },
  cardFoot: { fontSize: 10.5, marginTop: 8 },
  sumGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  sumBox: { flexGrow: 1, minWidth: 68, alignItems: 'center', paddingVertical: 8, borderRadius: 10, borderWidth: 1 },
  sumValue: { fontSize: 18, fontWeight: '800' },
  sumLabel: { fontSize: 10, marginTop: 2, fontWeight: '600' },
  sumSub: { fontSize: 9 },
  hoursRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: 10 },
  hoursLabel: { fontSize: 12 },
  hoursValue: { fontSize: 16, fontWeight: '800' },
  calWeekRow: { flexDirection: 'row', marginBottom: 4 },
  calWeekHead: { flex: 1, textAlign: 'center', fontSize: 9.5, fontWeight: '700' },
  calGrid: { flexDirection: 'row', flexWrap: 'wrap' },
  calCell: { width: `${100 / 7}%`, alignItems: 'center', paddingVertical: 4, borderRadius: 8 },
  calCellHas: {},
  calDot: { width: 14, height: 4, borderRadius: 2, marginBottom: 2 },
  calDay: { fontSize: 12.5, fontWeight: '700' },
  calDayNeutral: { fontWeight: '500' },
  calLate: { fontSize: 7, color: '#7C3AED', fontWeight: '900', lineHeight: 9 },
  calHol: { fontSize: 7, color: '#7C3AED', fontWeight: '900', lineHeight: 9 },
  navBar: {
    flexDirection: 'row',
    alignItems: 'center',
    borderRadius: 12,
    borderWidth: 1,
    paddingHorizontal: 4,
    paddingVertical: 4,
    marginBottom: 12,
  },
  navArrow: { width: 38, paddingVertical: 6, alignItems: 'center', justifyContent: 'center' },
  navLabel: { flex: 1, textAlign: 'center', fontSize: 15, fontWeight: '800' },
  navCurrent: {
    position: 'absolute',
    right: 6,
    paddingHorizontal: 9,
    paddingVertical: 4,
    borderRadius: 999,
    borderWidth: 1,
  },
  navCurrentText: { fontSize: 10.5, fontWeight: '800' },
  legend: { flexDirection: 'row', flexWrap: 'wrap', gap: 10, marginTop: 10 },
  legendItem: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  legendDot: { width: 8, height: 8, borderRadius: 3 },
  legendText: { fontSize: 10 },
  lateRow: { borderTopWidth: 1, borderTopColor: '#EEE', paddingVertical: 8 },
  lateRowTop: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  lateDate: { fontSize: 12, fontWeight: '700' },
  lateBadge: { fontSize: 11, fontWeight: '800' },
  lateMeta: { fontSize: 10.5, marginTop: 2 },
  graceRow: { flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 8 },
  graceName: { fontSize: 11.5, width: 92, fontWeight: '600' },
  graceBarTrack: { flexDirection: 'row', gap: 4, flex: 1 },
  gracePip: { width: 18, height: 8, borderRadius: 4 },
  graceText: { fontSize: 10.5, width: 74, textAlign: 'right' },
  attRow: { flexDirection: 'row', alignItems: 'center', borderTopWidth: 1, borderTopColor: '#EEE', paddingVertical: 8, gap: 8 },
  attDateCol: { width: 58 },
  attDay: { fontSize: 11, fontWeight: '700' },
  attDate: { fontSize: 10 },
  attPunchCol: { flex: 1, gap: 1 },
  attPunch: { fontSize: 10.5, fontWeight: '700' },
  attRightCol: { alignItems: 'flex-end', gap: 3 },
  attHours: { fontSize: 11, fontWeight: '800' },
  attBadge: { paddingHorizontal: 7, paddingVertical: 2, borderRadius: 999, borderWidth: 1 },
  attBadgeText: { fontSize: 9, fontWeight: '800' },
  empty: { fontSize: 12, textAlign: 'center', paddingVertical: 14 },
  sheetBackdrop: { flex: 1, backgroundColor: 'rgba(15,23,42,0.45)', justifyContent: 'flex-end' },
  sheetDismiss: { flex: 1 },
  sheet: { backgroundColor: '#FFFFFF', borderTopLeftRadius: 18, borderTopRightRadius: 18, padding: 16, gap: 8 },
  sheetHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  sheetTitle: { fontSize: 15, fontWeight: '800' },
  sheetClose: { fontSize: 15, fontWeight: '700' },
  sheetBadge: { alignSelf: 'flex-start', paddingHorizontal: 10, paddingVertical: 3, borderRadius: 999, borderWidth: 1, marginBottom: 4 },
  sheetBadgeText: { fontSize: 10.5, fontWeight: '800' },
  sheetRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingVertical: 4 },
  sheetKey: { fontSize: 12 },
  sheetVal: { fontSize: 12.5, fontWeight: '700' },
});

export default EmployeeAttendanceScreen;