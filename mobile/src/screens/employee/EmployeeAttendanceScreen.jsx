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

import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { View, Text, ScrollView, StyleSheet, TouchableOpacity, Modal, RefreshControl, ActivityIndicator } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useTheme } from '../../theme';
import { Card, Button, ScreenContainer } from '../../components';
import EmployeeMonthNav, { currentMonthKey, previousMonthKey, nextMonthKey } from '../../components/EmployeeMonthNav';
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

// Month stepping comes from the shared EmployeeMonthNav helpers (integer
// 'YYYY-MM' arithmetic - no date is ever parsed through UTC, so an attendance
// date can never shift a day).

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
  Leave: '#0891B2',     // cyan — distinct from all five states above (Phase J s6)
};
const HOLIDAY_COLOR = STATUS_COLORS.Holiday;      // PURPLE
const WEEK_OFF_COLOR = STATUS_COLORS['Week Off']; // YELLOW
const LEAVE_COLOR = STATUS_COLORS.Leave;          // CYAN
const dayColor = (row) => {
  if (!row) return null;                                   // no record -> neutral
  const code = clean(row.statusCode).toUpperCase();
  if (code === 'H' || code === 'HOLIDAY') return HOLIDAY_COLOR;
  const label = statusOf(row);
  if (label === 'Holiday') return HOLIDAY_COLOR;
  if (label === 'Week Off') return WEEK_OFF_COLOR;
  return STATUS_COLORS[label] || null;
};
/**
 * A day that the application marks as a holiday for this employee's own group.
 * This is a CALENDAR / STATUS OVERLAY only: the underlying Savior attendance row
 * is never changed, and the real row (if any) stays available in the day sheet.
 */
const isHolidayRow = (row) => {
  const code = clean(row?.statusCode).toUpperCase();
  return code === 'H' || code === 'HOLIDAY';
};
const LEGEND = [
  { label: 'Present', color: STATUS_COLORS.Present },
  { label: 'Absent', color: STATUS_COLORS.Absent },
  { label: 'Miss Punch', color: STATUS_COLORS['Miss Punch'] },
  { label: 'Holiday', color: HOLIDAY_COLOR },
  { label: 'Weekly Off', color: WEEK_OFF_COLOR },
  { label: 'Leave', color: LEAVE_COLOR },
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
  // Real holiday data for THIS employee's own group(s), for the selected month.
  // Loaded beside the attendance so both month views always stay in sync.
  const [holidays, setHolidays] = useState([]);
  // Real APPROVED leave for this employee in the displayed month (Phase J).
  const [leaveDates, setLeaveDates] = useState([]);
  // Tracks which month is currently being displayed so a slow response for an
  // older month can never overwrite the one the user is looking at.
  const shownMonth = useRef(currentMonthKey());

  const load = useCallback(async (isRefresh, targetMonth) => {
    if (isRefresh) setIsRefreshing(true); else setIsLoading(true);
    setError(null);
    // Clear the previous month's rows up-front when a DIFFERENT month is requested,
    // so the calendar, summary, late details and attendance list can never show one
    // month's data under another month's label while the request is in flight.
    shownMonth.current = clean(targetMonth);
    setData((prev) => (prev && clean(prev.month) === clean(targetMonth) ? prev : null));
    setHolidays([]);
    try {
      // Only the month is sent - the backend uses the authenticated identity.
      const res = await api.get(API_ENDPOINTS.EMPLOYEE_DASHBOARD, { month: targetMonth });
      // Drop the response if the user already moved on to another month.
      if (shownMonth.current === clean(targetMonth)) setData(res);
    } catch (e) {
      // Never substitute fake numbers - show a real error instead.
      if (shownMonth.current === clean(targetMonth)) {
        setData(null);
        setError('Unable to load your attendance data. Please try again.');
      }
    } finally {
      setIsLoading(false);
      setIsRefreshing(false);
    }
  }, []);

  // Holidays are loaded SEPARATELY and are never allowed to fail the attendance
  // screen: a holiday-service problem must not hide real attendance data.
  const loadHolidays = useCallback(async (targetMonth) => {
    try {
      const res = await api.get(API_ENDPOINTS.EMPLOYEE_HOLIDAYS, { month: targetMonth });
      if (shownMonth.current === clean(targetMonth)) {
        setHolidays(Array.isArray(res?.holidays) ? res.holidays : []);
      }
    } catch (_) {
      if (shownMonth.current === clean(targetMonth)) setHolidays([]);
    }
  }, []);

  // APPROVED leave for the displayed month (Phase J section 6). This is also an
  // application-level OVERLAY: no Savior attendance record is read differently or
  // written, a leave day is simply drawn as "Leave" on top of the real row.
  const loadLeave = useCallback(async (targetMonth) => {
    try {
      const [y, m] = clean(targetMonth).split('-');
      if (!y || !m) throw new Error('bad month');
      const lastDay = new Date(Date.UTC(Number(y), Number(m), 0)).getUTCDate();
      const res = await api.get(API_ENDPOINTS.EMPLOYEE_LEAVE_CALENDAR, {
        from: `${targetMonth}-01`,
        to: `${targetMonth}-${String(lastDay).padStart(2, '0')}`,
      });
      if (shownMonth.current === clean(targetMonth)) {
        setLeaveDates(Array.isArray(res?.dates) ? res.dates : []);
      }
    } catch (_) {
      // Leave overlay is optional: attendance must still render without it.
      if (shownMonth.current === clean(targetMonth)) setLeaveDates([]);
    }
  }, []);

  useEffect(() => { load(false, month); }, [month]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { loadHolidays(month); }, [month, loadHolidays]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { loadLeave(month); }, [month, loadLeave]); // eslint-disable-line react-hooks/exhaustive-deps

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
   * Real holidays applicable to this employee, keyed by calendar date.
   *
   * The backend already restricts the list to the signed-in employee's own group
   * plus "All Employees", so an employee can never see another group's holiday.
   * A day may hold more than one holiday (e.g. a Factory Staff holiday and an
   * All Employees holiday on the same date).
   */
  const holidayByDate = useMemo(() => {
    const m = new Map();
    holidays.forEach((h) => {
      const key = clean(h.holidaydate).slice(0, 10);
      if (!key) return;
      const list = m.get(key) || [];
      list.push(h);
      m.set(key, list);
    });
    return m;
  }, [holidays]);

  /** Holiday names for a day, comma separated (empty when the day is not one). */
  const holidayNames = useCallback(
    (key) => (holidayByDate.get(clean(key).slice(0, 10)) || []).map((h) => clean(h.holidayname)).filter(Boolean).join(', '),
    [holidayByDate],
  );

  /**
   * APPROVED leave keyed by calendar date (Phase J section 6).
   *
   * The server already restricted the list to this employee's own approved
   * requests and expanded each request into individual dates. A leave day is an
   * overlay: the real attendance row underneath is never modified.
   */
  const leaveByDate = useMemo(() => {
    const m = new Map();
    leaveDates.forEach((entry) => {
      const key = clean(entry?.date).slice(0, 10);
      if (!key) return;
      m.set(key, Array.isArray(entry?.leaves) ? entry.leaves : []);
    });
    return m;
  }, [leaveDates]);

  const isLeaveDay = useCallback((key) => leaveByDate.has(clean(key).slice(0, 10)), [leaveByDate]);

  const leaveLabel = useCallback((key) => {
    const list = leaveByDate.get(clean(key).slice(0, 10)) || [];
    const names = list.map((l) => clean(l.typename) || clean(l.leavetype)).filter(Boolean);
    if (!names.length) return '';
    // de-duplicate so one request does not repeat its type name.
    return [...new Set(names)].join(', ');
  }, [leaveByDate]);

  /**
   * Displayed status for a day, in priority order.
   *
   *   Holiday > Leave > Week Off > real attendance status
   *
   * A company holiday wins because nobody works on it; an APPROVED leave wins over
   * the attendance label because a leave day must never be shown as Present, Absent
   * or Miss Punch. A weekly off that is ALSO a leave shows as Leave, which keeps
   * the two visually distinct as required.
   */
  const displayStatus = useCallback((row, key) => {
    const k = clean(key).slice(0, 10);
    if (holidayByDate.has(k)) return 'Holiday';
    if (leaveByDate.has(k)) return 'Leave';
    if (isHolidayRow(row)) return 'Holiday';
    return statusOf(row);
  }, [holidayByDate, leaveByDate]);

  /**
   * Calendar colour for a day, honouring the overlays first so a holiday is always
   * PURPLE and an approved leave is always CYAN - each clearly distinct from
   * Present green, Absent red, Miss Punch orange and Weekly Off yellow.
   */
  const displayColor = useCallback((row, key) => {
    const k = clean(key).slice(0, 10);
    if (holidayByDate.has(k)) return HOLIDAY_COLOR;
    if (leaveByDate.has(k)) return LEAVE_COLOR;
    return dayColor(row);
  }, [holidayByDate, leaveByDate]);

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
      const holiday = holidayByDate.get(key) || [];
      const leave = leaveByDate.get(key) || [];
      cells.push({
        key,
        day: d.getDate(),
        inMonth: d.getMonth() === mon && d.getFullYear() === year,
        row: byDate.get(key) || null,
        // An application holiday or an approved leave makes the day tappable even
        // when Savior has no attendance row for it.
        holiday,
        leave,
        isHoliday: holiday.length > 0,
        isLeave: leave.length > 0,
      });
    }
    return cells;
  }, [month, byDate, holidayByDate, leaveByDate]);

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
    /**
   * Grace position AS OF the tapped date.
   *
   * `graceTimeline` comes from the backend and replays the SAME monthly grace
   * consumption the HR audit already reports (it is derived from that function's
   * own lateDetails, which stay untouched), giving the cumulative used/remaining
   * after every late day of the selected month. Taking the latest entry on or
   * before the tapped date means a later date correctly reflects the grace
   * already consumed on earlier dates - grace is never reset per date.
   */
  const graceAsOf = useCallback((dateIso) => {
    const timeline = Array.isArray(data?.graceTimeline) ? data.graceTimeline : [];
    const d = clean(dateIso).slice(0, 10);
    let hit = null;
    timeline.forEach((e) => {
      const ed = clean(e.date).slice(0, 10);
      if (ed && ed <= d) hit = e;
    });
    const g = data?.graceRemaining;
    if (!hit) {
      if (!g) return null;
      // No late event yet on this date: full allowance is still available.
      const totals = timeline.length ? timeline[0].total : null;
      return {
        total: totals || { grace30min: Number(g.grace30min || 0), grace1hr: Number(g.grace1hr || 0), grace2hr: Number(g.grace2hr || 0) },
        remaining: totals || { grace30min: Number(g.grace30min || 0), grace1hr: Number(g.grace1hr || 0), grace2hr: Number(g.grace2hr || 0) },
        used: { grace30min: 0, grace1hr: 0, grace2hr: 0 },
      };
    }
    return hit;
  }, [data]);

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
        <EmployeeMonthNav month={month} onChange={setMonth} theme={theme} />

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
                {/* Holidays are an overlay count, kept separate from the real
                    Present / Absent / Miss Punch totals above. */}
                {summaryCard('Holiday', holidays.length, HOLIDAY_COLOR)}
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
                    // Holiday overlay wins: a holiday day is always purple.
                    const color = c.inMonth ? displayColor(c.row, c.key) : null;
                    const label = displayStatus(c.row, c.key);
                    return (
                      <TouchableOpacity
                        key={c.key}
                        style={[styles.calCell, c.inMonth && (c.row || c.isHoliday || c.isLeave) && styles.calCellHas]}
                        activeOpacity={0.7}
                        disabled={!(c.row || c.isHoliday || c.isLeave)}
                        // Exposes the real day + its real status for accessibility.
                        accessibilityLabel={`${c.key} ${label}`}
                        onPress={() => (c.row || c.isHoliday || c.isLeave) && setPickedDay(c)}
                      >
                        <View style={[styles.calDot, { backgroundColor: color || 'transparent' }]} />
                        <Text
                          style={[
                            styles.calDay,
                            { color: c.inMonth ? (color || theme.textPrimary) : theme.textTertiary },
                            c.inMonth && !c.row && !c.isHoliday && !c.isLeave && styles.calDayNeutral,
                          ]}
                        >
                          {c.day}
                        </Text>
                        {/* Late is a flag beside the main status, never a replacement. */}
                        {c.inMonth && c.row && c.row.isLate && !c.isHoliday && !c.isLeave ? <Text style={styles.calLate}>L</Text> : null}
                        {c.inMonth && c.isHoliday ? <Text style={styles.calHol}>H</Text> : null}
                        {c.inMonth && c.isLeave && !c.isHoliday ? <Text style={styles.calLv}>LV</Text> : null}
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

            {/* ---------- Holidays applicable to this employee (real data) ---------- */}
            <Card style={styles.card}>
              <View style={styles.cardHeader}>
                <Text style={[styles.cardTitle, { color: theme.textPrimary }]}>Holidays</Text>
                <Text style={[styles.cardSub, { color: theme.textSecondary }]}>{`${holidays.length} in this month`}</Text>
              </View>
              {holidays.length ? (
                holidays
                  .slice()
                  .sort((a, b) => (clean(a.holidaydate) < clean(b.holidaydate) ? -1 : 1))
                  .map((h, i) => (
                    <TouchableOpacity
                      key={`hol-${h.id ?? i}`}
                      style={[styles.holidayRow, { borderColor: theme.border }]}
                      activeOpacity={0.7}
                      onPress={() => setPickedDay({
                        key: clean(h.holidaydate).slice(0, 10),
                        day: partsOf(h.holidaydate)?.getDate(),
                        row: byDate.get(clean(h.holidaydate).slice(0, 10)) || null,
                        holiday: [h],
                      })}
                    >
                      <View style={styles.holidayDotWrap}>
                        <View style={styles.holidayDot} />
                      </View>
                      <View style={styles.holidayInfo}>
                        <Text style={[styles.holidayName, { color: theme.textPrimary }]}>{clean(h.holidayname)}</Text>
                        <Text style={[styles.holidayMeta, { color: theme.textSecondary }]}>
                          {`${shortDate(h.holidaydate)} (${dayName(h.holidaydate)})`}
                          {clean(h.category) ? ` · ${clean(h.category)}` : ''}
                        </Text>
                        {clean(h.description) ? (
                          <Text style={[styles.holidayDesc, { color: theme.textTertiary }]}>{clean(h.description)}</Text>
                        ) : null}
                      </View>
                      {/* A weekly off on the same date stays visible as a separate fact. */}
                      {statusOf(byDate.get(clean(h.holidaydate).slice(0, 10))) === 'Week Off' ? (
                        <Text style={[styles.weekOffTag, { color: WEEK_OFF_COLOR }]}>WO</Text>
                      ) : null}
                    </TouchableOpacity>
                  ))
              ) : (
                <Text style={[styles.empty, { color: theme.textTertiary }]}>Is month me aapke group ka koi holiday nahi hai.</Text>
              )}
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
                const key = clean(r.date || r.dateoffice).slice(0, 10);
                // Same overlay order as the calendar: holiday > leave > real status,
                // each in its own colour so nothing is mislabelled.
                const isHol = holidayByDate.has(key) || isHolidayRow(r);
                const isLv = !isHol && leaveByDate.has(key);
                const label = isHol ? 'Holiday' : isLv ? 'Leave' : statusOf(r);
                const color = isHol ? HOLIDAY_COLOR : isLv ? LEAVE_COLOR : (dayColor(r) || theme.textPrimary);
                const inT = clean(r.inTime);
                const outT = clean(r.outTime);
                return (
                  <TouchableOpacity
                    key={`${clean(r.date)}-${i}`}
                    style={[styles.attRow, { borderColor: theme.border }]}
                    activeOpacity={0.7}
                    onPress={() => setPickedDay({ key, day: partsOf(r.date)?.getDate(), row: r, holiday: holidayByDate.get(key) || [], leave: leaveByDate.get(key) || [], isHoliday: isHol, isLeave: isLv })}
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
            {pickedDay && (() => {
              const r = pickedDay.row;
              // The holiday overlay wins for display; the real row (if any) is kept.
              const isHoliday = Boolean(pickedDay.isHoliday) || (pickedDay.holiday && pickedDay.holiday.length > 0);
              // Holiday wins over leave: nobody works on a company holiday.
              const isLeave = !isHoliday && (Boolean(pickedDay.isLeave) || (pickedDay.leave && pickedDay.leave.length > 0));
              const color = isHoliday
                ? HOLIDAY_COLOR
                : isLeave
                  ? LEAVE_COLOR
                  : (r ? dayColor(r) || theme.textPrimary : theme.textPrimary);
              const label = isHoliday ? 'Holiday' : isLeave ? 'Leave' : (r ? statusOf(r) : 'No Record');
              const holidayList = (pickedDay.holiday && pickedDay.holiday.length)
                ? pickedDay.holiday
                : (holidayByDate.get(pickedDay.key) || []);
              const leaveList = (pickedDay.leave && pickedDay.leave.length)
                ? pickedDay.leave
                : (leaveByDate.get(pickedDay.key) || []);
              const inT = clean(r?.inTime);
              const outT = clean(r?.outTime);
              const late = lateList.find((l) => l.key.startsWith(pickedDay.key));
              const rowGrace = r?.graceUsed ? ` (${clean(r.graceUsed)})` : '';
              // Cumulative grace position as of THIS date (earlier days included).
              const graceForDay = graceAsOf(pickedDay.key);
              const graceAllSpent = !!graceForDay
                && graceForDay.remaining.grace30min === 0
                && graceForDay.remaining.grace1hr === 0
                && graceForDay.remaining.grace2hr === 0;
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
                    <Text style={[styles.sheetBadgeText, { color }]}>{label}</Text>
                  </View>

                  {/* Holiday facts come first - this is the reason the day is shown. */}
                  {holidayList.map((h, i) => (
                    <View key={`sh-${h.id ?? i}`}>
                      <View style={styles.sheetRow}>
                        <Text style={[styles.sheetKey, { color: theme.textSecondary }]}>Holiday</Text>
                        <Text style={[styles.sheetVal, { color: HOLIDAY_COLOR }]}>{clean(h.holidayname)}</Text>
                      </View>
                      {clean(h.category) ? (
                        <View style={styles.sheetRow}>
                          <Text style={[styles.sheetKey, { color: theme.textSecondary }]}>Group</Text>
                          <Text style={[styles.sheetVal, { color: theme.textPrimary }]}>{clean(h.category)}</Text>
                        </View>
                      ) : null}
                      {clean(h.description) ? (
                        <View style={styles.sheetRow}>
                          <Text style={[styles.sheetKey, { color: theme.textSecondary }]}>Note</Text>
                          <Text style={[styles.sheetVal, { color: theme.textSecondary }]}>{clean(h.description)}</Text>
                        </View>
                      ) : null}
                    </View>
                  ))}

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
                    <Text style={[styles.sheetVal, { color: theme.primary }]}>{hoursText(r?.hoursworked)}</Text>
                  </View>
                  {r?.shift ? (
                    <View style={styles.sheetRow}>
                      <Text style={[styles.sheetKey, { color: theme.textSecondary }]}>Shift</Text>
                      <Text style={[styles.sheetVal, { color: theme.textPrimary }]}>{clean(r.shift)}</Text>
                    </View>
                  ) : null}
                  <View style={styles.sheetRow}>
                    <Text style={[styles.sheetKey, { color: theme.textSecondary }]}>Status</Text>
                    <Text style={[styles.sheetVal, { color }]}>{label}</Text>
                  </View>
                  {/* The untouched Savior label stays visible for full transparency. */}
                  {/* Approved leave detail (Phase J). Display-only overlay — the
                      untouched Savior label stays visible below for transparency. */}
                  {leaveList.map((l, i) => (
                    <View key={`sl-${l.id ?? i}`}>
                      <View style={styles.sheetRow}>
                        <Text style={[styles.sheetKey, { color: theme.textSecondary }]}>Leave Type</Text>
                        <Text style={[styles.sheetVal, { color: LEAVE_COLOR }]}>{clean(l.typename) || clean(l.leavetype)}</Text>
                      </View>
                      {l.isHalfDay ? (
                        <View style={styles.sheetRow}>
                          <Text style={[styles.sheetKey, { color: theme.textSecondary }]}>Duration</Text>
                          <Text style={[styles.sheetVal, { color: theme.textPrimary }]}>Half day</Text>
                        </View>
                      ) : null}
                      {clean(l.reason) ? (
                        <View style={styles.sheetRow}>
                          <Text style={[styles.sheetKey, { color: theme.textSecondary }]}>Leave Reason</Text>
                          <Text style={[styles.sheetVal, { color: theme.textSecondary }]}>{clean(l.reason)}</Text>
                        </View>
                      ) : null}
                    </View>
                  ))}
                  {(isHoliday || isLeave) && r ? (
                    <View style={styles.sheetRow}>
                      <Text style={[styles.sheetKey, { color: theme.textSecondary }]}>Recorded as</Text>
                      <Text style={[styles.sheetVal, { color: dayColor(r) || theme.textSecondary }]}>{statusOf(r)}</Text>
                    </View>
                  ) : null}
                  {late ? (
                    <View style={styles.sheetRow}>
                      <Text style={[styles.sheetKey, { color: theme.textSecondary }]}>Late</Text>
                      <Text style={[styles.sheetVal, { color: late.covered ? '#059669' : '#DC2626' }]}>
                        {`+${late.lateMinutes} min${late.covered ? ` · covered by ${late.graceUsed || 'grace'}` : ' · not covered'}`}
                      </Text>
                    </View>
                  ) : clean(r?.latearrival) > 0 ? (
                    <View style={styles.sheetRow}>
                      <Text style={[styles.sheetKey, { color: theme.textSecondary }]}>Late</Text>
                      <Text style={[styles.sheetVal, { color: '#DC2626' }]}>
                        {`+${Number(r.latearrival)} min${rowGrace}`}
                      </Text>
                    </View>
                  ) : null}
                  {graceForDay ? (
                    <View style={styles.sheetRow}>
                      <Text style={[styles.sheetKey, { color: theme.textSecondary }]}>Grace Used</Text>
                      <Text style={[styles.sheetVal, { color: theme.textPrimary }]}>
                        {`30-min ${graceForDay.used.grace30min}/${graceForDay.total.grace30min} · 1-hour ${graceForDay.used.grace1hr}/${graceForDay.total.grace1hr} · 2-hour ${graceForDay.used.grace2hr}/${graceForDay.total.grace2hr}`}
                      </Text>
                    </View>
                  ) : null}
                  {graceForDay ? (
                    <View style={styles.sheetRow}>
                      <Text style={[styles.sheetKey, { color: theme.textSecondary }]}>Grace Remaining</Text>
                      <Text style={[styles.sheetVal, { color: graceAllSpent ? theme.error : theme.textPrimary }]}>
                        {`30-min ${graceForDay.remaining.grace30min}/${graceForDay.total.grace30min} · 1-hour ${graceForDay.remaining.grace1hr}/${graceForDay.total.grace1hr} · 2-hour ${graceForDay.remaining.grace2hr}/${graceForDay.total.grace2hr}`}
                        {graceAllSpent ? '  (none left)' : ''}
                      </Text>
                    </View>
                  ) : null}
                </View>
              );
            })()}
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
  // A late PRESENT day keeps its green status; the small "L" marker is RED.
  calLate: { fontSize: 8, color: '#DC2626', fontWeight: '900', lineHeight: 10 },
  calHol: { fontSize: 7, color: HOLIDAY_COLOR, fontWeight: '900', lineHeight: 9 },
  // Approved leave marker (Phase J) — cyan, matching the Leave legend entry.
  calLv: { fontSize: 7, color: LEAVE_COLOR, fontWeight: '900', lineHeight: 9 },
  // Holidays applicable to this employee's own group (real backend data).
  holidayRow: { flexDirection: 'row', alignItems: 'center', gap: 8, borderTopWidth: 1, borderTopColor: '#EEE', paddingVertical: 9 },
  holidayDotWrap: { width: 14, alignItems: 'center' },
  holidayDot: { width: 10, height: 10, borderRadius: 5, backgroundColor: HOLIDAY_COLOR },
  holidayInfo: { flex: 1, gap: 2 },
  holidayName: { fontSize: 12.5, fontWeight: '700' },
  holidayMeta: { fontSize: 10.5 },
  holidayDesc: { fontSize: 10 },
  // A weekly off that falls on a holiday is tagged separately (YELLOW) so the
  // purple Holiday state and the yellow Weekly Off state stay distinguishable.
  weekOffTag: { fontSize: 10, fontWeight: '900' },
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