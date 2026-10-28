// ============================================================================
// FILE: mobile/src/screens/employee/EmployeeReportsScreen.jsx
// PURPOSE: Employee Reports - Personal Attendance Insights dashboard (mobile-first)
// ============================================================================

/**
 * "My Attendance Reports" — selected month ki attendance summary, compact
 * visualisations, factual insights aur date-wise daily timeline.
 *
 * Navigation Flow:
 * EmployeeNavigator (Reports Tab) -> EmployeeReportsScreen
 *
 * Data Flow (existing shared backend; identity hamesha JWT se):
 *   GET /api/employee/dashboard?month=YYYY-MM   (stats + attendance rows)
 *   GET /api/employee/holidays?month=YYYY-MM    (employee-specific holidays)
 *   GET /api/employee/leave/calendar            (APPROVED leave overlay only)
 * Sirf month bheja jaata hai — paycode kabhi nahi; backend logged-in employee
 * khud resolve karta hai, isliye koi doosra employee ka data access nahi ho sakta.
 *
 * Business rules REUSE hote hain (attendanceReport.js me, website Reports aur
 * HR audit ke same rules): per-row status backend ki classification se, day-level
 * precedence Holiday > Approved Leave > register status. Holiday/Weekly Off kabhi
 * Absent me count nahi hote. Late Arrivals = FINAL late (grace ke baad); raw late
 * aur grace-covered alag numbers hain. Hours sirf recorded hoursworked se.
 *
 * PDF/Excel download yahan nahi hain (mobile par on-screen viewing focus hai);
 * existing CSV export neeche retained hai.
 */

import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { View, Text, ScrollView, StyleSheet, TouchableOpacity, RefreshControl, ActivityIndicator, Platform } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import * as FileSystem from 'expo-file-system';
import * as Sharing from 'expo-sharing';
import { useTheme } from '../../theme';
import { Card, Button, ScreenContainer, currentMonthKey } from '../../components';
import { api } from '../../services/api';
import { API_ENDPOINTS } from '../../utils/constants';
import {
  clean, DASH, STATUS_META, STATUS_ORDER, fmtDate, shortDate, dayNameOf, monthLabel, shiftMonth,
  monthRange, hoursText, buildRegister, summariseRegister, buildWeeks,
  punctuality, hoursSeries, buildInsights,
} from '../../utils/attendanceReport';

const PLACEHOLDER = '—';

/** Established status colours (existing app conventions). */
const COLORS_BY_KEY = {
  present: '#059669',   // Green
  absent: '#DC2626',    // Red
  miss: '#D97706',      // Orange
  leave: '#0891B2',     // Teal (approved leave)
  holiday: '#7C3AED',   // Purple
  weekoff: '#CA8A04',   // Yellow
  noRecord: '#64748B',
  upcoming: '#94A3B8',
};
const LATE_COLOR = '#7C3AED'; // existing late-indicator behaviour

/** CSV export helpers (existing functionality, unchanged behaviour). */
const csvCell = (v) => {
  const s = String(v == null ? '' : v);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};
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

/**
 * Employee Reports Screen — My Attendance Reports dashboard.
 */
export const EmployeeReportsScreen = () => {
  const { theme } = useTheme();
  const [month, setMonth] = useState(currentMonthKey());
  const [data, setData] = useState(null);
  const [holidays, setHolidays] = useState([]);
  const [leaveDates, setLeaveDates] = useState([]);
  const [prev, setPrev] = useState(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [error, setError] = useState(null);
  const [expandedDate, setExpandedDate] = useState(null);
  // Tapped summary card ('absent' | 'miss' | 'late' | null) — in-screen drill-down.
  const [openDetail, setOpenDetail] = useState(null);
  const [exportMsg, setExportMsg] = useState(null);
  const [exporting, setExporting] = useState(false);
  // Stale-response guard: month change ke baad purana response kabhi paint nahi hota.
  const seqRef = useRef(0);

  const load = useCallback(async (isRefresh, targetMonth) => {
    const seq = ++seqRef.current;
    if (isRefresh) setIsRefreshing(true); else setIsLoading(true);
    setError(null);
    setExpandedDate(null);
    setOpenDetail(null);
    setPrev(null);
    const range = monthRange(targetMonth) || { from: `${targetMonth}-01`, to: `${targetMonth}-28` };
    try {
      // Only the month is sent - the backend uses the authenticated identity.
      const res = await api.get(API_ENDPOINTS.EMPLOYEE_DASHBOARD, { month: targetMonth });
      if (seq !== seqRef.current) return;
      setData(res);
    } catch (e) {
      if (seq !== seqRef.current) return;
      setData(null);
      setError('Unable to load your report. Please try again.');
      setIsLoading(false);
      setIsRefreshing(false);
      return;
    }
    api.get(API_ENDPOINTS.EMPLOYEE_HOLIDAYS, { month: targetMonth })
      .then((h) => { if (seq === seqRef.current) setHolidays(Array.isArray(h?.holidays) ? h.holidays : []); })
      .catch(() => { if (seq === seqRef.current) setHolidays([]); });
    api.get(API_ENDPOINTS.EMPLOYEE_LEAVE_CALENDAR, { from: range.from, to: range.to })
      .then((l) => { if (seq === seqRef.current) setLeaveDates(Array.isArray(l?.dates) ? l.dates : []); })
      .catch(() => { if (seq === seqRef.current) setLeaveDates([]); });
    setIsLoading(false);
    setIsRefreshing(false);
  }, []);

  useEffect(() => { load(false, month); }, [month]); // eslint-disable-line react-hooks/exhaustive-deps

  // Previous-month snapshot (same endpoints, same rules) — sirf comparisons ke liye.
  useEffect(() => {
    if (!data) return;
    const seq = seqRef.current;
    const prevMonth = shiftMonth(month, -1);
    const range = monthRange(prevMonth) || { from: `${prevMonth}-01`, to: `${prevMonth}-28` };
    (async () => {
      try {
        const dash = await api.get(API_ENDPOINTS.EMPLOYEE_DASHBOARD, { month: prevMonth });
        const hols = await api.get(API_ENDPOINTS.EMPLOYEE_HOLIDAYS, { month: prevMonth }).catch(() => ({ holidays: [] }));
        const lv = await api.get(API_ENDPOINTS.EMPLOYEE_LEAVE_CALENDAR, { from: range.from, to: range.to }).catch(() => ({ dates: [] }));
        if (seq !== seqRef.current) return;
        const prevRegister = buildRegister({
          month: prevMonth,
          attendance: dash?.attendance || [],
          holidays: hols?.holidays || [],
          leaveDates: lv?.dates || [],
          todayIso: dash?.today || undefined,
        });
        setPrev({ label: monthLabel(prevMonth), summary: summariseRegister(prevRegister, dash) });
      } catch { /* previous month unavailable — comparisons stay hidden */ }
    })();
  }, [data, month]);

  // ---------- derived data (established rules, attendanceReport.js) ----------
  const todayIso = clean(data?.today) || undefined;
  const register = useMemo(
    () => buildRegister({ month, attendance: data?.attendance, holidays, leaveDates, todayIso }),
    [month, data, holidays, leaveDates, todayIso],
  );
  const summary = useMemo(() => summariseRegister(register, data), [register, data]);
  const weeks = useMemo(() => buildWeeks(register), [register]);
  const punct = useMemo(() => punctuality(register, data), [register, data]);
  // Configured grace allowance (real per-tier limits from the shared backend).
  const graceLimits = useMemo(() => {
    const elig = data?.graceEligibility;
    if (elig && elig.isStaff && elig.limits) return elig.limits;
    return { grace30min: 0, grace1hr: 0, grace2hr: 0 };
  }, [data]);
  const isStaffGrace = Boolean(data?.graceEligibility?.isStaff);
  // Per-bucket grace utilisation: used = limit − remaining. This is the authoritative
  // inverse of the backend's `graceRemaining` (computeMonthlyLateForEmployee starts at
  // the limit and decrements per covered event), so it is NOT a second engine.
  const graceBuckets = useMemo(() => {
    const rem = punct.graceRemaining;
    if (!rem) return null;
    const mk = (label, remaining, limit) => {
      const lim = Math.max(0, Number(limit) || 0);
      const remN = Math.min(lim, Math.max(0, Number(remaining) || 0));
      return { label, limit: lim, remaining: remN, used: lim - remN };
    };
    return [
      mk('30 min', rem.grace30min, graceLimits.grace30min),
      mk('1 hour', rem.grace1hr, graceLimits.grace1hr),
      mk('2 hour', rem.grace2hr, graceLimits.grace2hr),
    ];
  }, [punct.graceRemaining, graceLimits]);
  // Drill-down lists for the tappable summary cards (only this employee's data).
  const absentRows = useMemo(() => register.filter((r) => r.kind === 'absent'), [register]);
  const missRows = useMemo(() => register.filter((r) => r.kind === 'miss'), [register]);
  const lateRows = useMemo(() => {
    const details = Array.isArray(data?.lateDetails) ? data.lateDetails : [];
    const att = Array.isArray(data?.attendance) ? data.attendance : [];
    return details.map((l) => {
      const d = clean(l.date).slice(0, 10);
      const row = att.find((r) => clean(r.date || r.dateoffice).slice(0, 10) === d);
      return {
        date: d,
        inTime: clean(row?.inTime),
        shift: clean(data?.shift?.shiftName || data?.shift?.shiftCode || ''),
        shiftStart: clean(data?.shift?.startTime || ''),
        lateMinutes: Number(l.lateMinutes || 0),
        graceUsed: clean(l.graceUsed),
        isFinalLate: l.isFinalLate !== false,
      };
    });
  }, [data]);
  const hours = useMemo(() => hoursSeries(register), [register]);
  const insights = useMemo(
    () => buildInsights({ register, weeks, summary, month, prev }),
    [register, weeks, summary, month, prev],
  );

  const inProgress = month === currentMonthKey();
  const canGoNext = month < currentMonthKey();
  const maxDayMinutes = useMemo(() => Math.max(60, ...hours.map((h) => h.minutes)), [hours]);

  const handleExport = useCallback(async () => {
    if (exporting || !register.length) return;
    setExporting(true);
    setExportMsg(null);
    try {
      const header = ['Date', 'Day', 'In Time', 'Out Time', 'Worked Hours', 'Status', 'Late (min)', 'Remark'];
      const lines = [header.join(',')];
      register.forEach((r) => {
        lines.push([
          r.date, r.dayName, csvCell(r.inTime || ''), csvCell(r.outTime || ''),
          r.hasRow ? (Number(r.hoursMin || 0) / 60).toFixed(2) : '',
          csvCell(r.status),
          r.hasRow && r.lateMin > 0 ? String(r.lateMin) : '',
          csvCell(r.remark || ''),
        ].join(','));
      });
      lines.push('');
      lines.push(['Total Present', summary.present].join(','));
      lines.push(['Total Absent', summary.absent].join(','));
      lines.push(['Total Miss Punch', summary.miss].join(','));
      lines.push(['Total Late (final)', summary.lateFinal].join(','));
      lines.push(['Total Weekly Off', summary.weekoff].join(','));
      lines.push(['Total Holiday', summary.holiday].join(','));
      await downloadCsv(`attendance-report-${month}.csv`, lines.join('\n'));
      setExportMsg({ kind: 'ok', text: `Report exported for ${monthLabel(month)} (${register.length} days).` });
    } catch {
      setExportMsg({ kind: 'error', text: 'Unable to export the report. Please try again.' });
    } finally {
      setExporting(false);
    }
  }, [exporting, register, summary, month]);

  // ---------- small render helpers ----------
  const summaryCard = (label, value, color, sub, onPress, active) => {
    const iconName = label === 'Present Days' ? 'checkmark-circle' : label === 'Absent Days' ? 'close-circle' : label === 'Miss Punch' ? 'alert-circle' : label === 'Late Arrivals' ? 'time' : label === 'Attendance %' ? 'stats-chart' : 'hourglass';
    const content = (
      <>
        <View style={[styles.sumIcon, { backgroundColor: `${color}18` }]}>
          <Ionicons name={iconName} size={14} color={color} />
        </View>
        <Text style={[styles.sumValue, { color }]} numberOfLines={1} adjustsFontSizeToFit>{value}</Text>
        <Text style={[styles.sumLabel, { color: theme.textSecondary }]} numberOfLines={1}>{label}</Text>
        {sub ? <Text style={[styles.sumSub, { color: theme.textTertiary }]} numberOfLines={2}>{sub}</Text> : null}
        {onPress ? <Ionicons name="chevron-forward" size={12} color={active ? color : theme.textTertiary} style={styles.sumChevron} /> : null}
      </>
    );
    if (onPress) {
      return (
        <TouchableOpacity
          key={label}
          accessibilityRole="button"
          accessibilityLabel={`Show ${label} details`}
          activeOpacity={0.75}
          onPress={onPress}
          style={[styles.sumBox, { borderColor: active ? color : `${color}44` }, active ? { backgroundColor: `${color}14` } : null]}
        >
          {content}
        </TouchableOpacity>
      );
    }
    return <View style={[styles.sumBox, { borderColor: `${color}44` }]} key={label}>{content}</View>;
  };

  const toggleDetail = (type) => setOpenDetail((cur) => (cur === type ? null : type));

  const sectionTitle = (title, sub) => (
    <View style={styles.sectionHead}>
      <Text style={[styles.cardTitle, { color: theme.textPrimary }]}>{title}</Text>
      {sub ? <Text style={[styles.cardSub, { color: theme.textSecondary }]}>{sub}</Text> : null}
    </View>
  );

  return (
    <ScreenContainer title="My Attendance Reports" showHeader={true}>
      <ScrollView
        refreshControl={<RefreshControl refreshing={isRefreshing} onRefresh={() => load(true, month)} colors={[theme.primary]} />}
        contentContainerStyle={styles.scroll}
        showsVerticalScrollIndicator={false}
      >
        {/* ---------- Report period / month selector ---------- */}
        <View style={[styles.navBar, { borderColor: theme.border, backgroundColor: theme.surface || '#FFFFFF' }]}>
          <TouchableOpacity style={styles.navArrow} accessibilityLabel="Previous month" activeOpacity={0.7}
            onPress={() => setMonth(shiftMonth(month, -1))}>
            <Ionicons name="chevron-back" size={20} color={theme.primary} />
          </TouchableOpacity>
          <View style={styles.navCenter}>
            <Text style={[styles.navTitle, { color: theme.textPrimary }]}>{monthLabel(month)}</Text>
            <Text style={[styles.navSub, { color: theme.textTertiary }]}>
              {inProgress ? 'Month in progress' : 'Attendance Report'}
            </Text>
          </View>
          <TouchableOpacity style={[styles.navArrow, !canGoNext && styles.navArrowDisabled]} accessibilityLabel="Next month"
            activeOpacity={0.7} disabled={!canGoNext} onPress={() => canGoNext && setMonth(shiftMonth(month, 1))}>
            <Ionicons name="chevron-forward" size={20} color={canGoNext ? theme.primary : theme.textTertiary} />
          </TouchableOpacity>
        </View>
        {month !== currentMonthKey() ? (
          <TouchableOpacity style={[styles.currentChip, { backgroundColor: `${theme.primary}15`, borderColor: `${theme.primary}40` }]}
            accessibilityLabel="Current month" activeOpacity={0.8} onPress={() => setMonth(currentMonthKey())}>
            <Ionicons name="calendar" size={12} color={theme.primary} />
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
            <Text style={[styles.errorText, { color: theme.error }]}><Ionicons name="alert-circle" size={13} /> {error}</Text>
            <Button title="Retry" onPress={() => load(false, month)} variant="outline" size="small" style={{ marginTop: 12 }} />
          </Card>
        ) : null}

        {!isLoading && !error && data ? (
          <>
            {/* ---------- Monthly summary cards ---------- */}
            <Card style={styles.card}>
              {sectionTitle('Monthly Summary', `${monthLabel(month)} · ${summary.totalDays} calendar days`)}
              <View style={styles.sumGrid}>
                {summaryCard('Present Days', summary.present, COLORS_BY_KEY.present, '')}
                {summaryCard('Absent Days', summary.absent, COLORS_BY_KEY.absent, 'Excl. leave / holiday / week off', () => toggleDetail('absent'), openDetail === 'absent')}
                {summaryCard('Miss Punch', summary.miss, COLORS_BY_KEY.miss, 'Incomplete punches', () => toggleDetail('miss'), openDetail === 'miss')}
                {summaryCard('Late Arrivals', summary.lateFinal, LATE_COLOR, `final after grace · ${summary.lateRaw} raw late`, () => toggleDetail('late'), openDetail === 'late')}
                {summaryCard('Attendance %', summary.attendancePct === null ? DASH : `${summary.attendancePct}%`, '#2563EB', 'Present ÷ (P+A+Miss)')}
                {summaryCard('Recorded Hours', summary.recordedDays > 0 ? hoursText(summary.hoursMin) : DASH, '#0891B2', summary.recordedDays > 0 ? `${summary.recordedDays} recorded day(s)` : 'No recorded hours')}
              </View>
            </Card>

            {/* ---------- Card drill-down (Absent / Miss Punch / Late) ---------- */}
            {openDetail ? (() => {
              const detailMeta = {
                absent: { title: 'Absent Days', rows: absentRows, color: COLORS_BY_KEY.absent },
                miss: { title: 'Miss Punch', rows: missRows, color: COLORS_BY_KEY.miss },
                late: { title: 'Late Arrivals', rows: lateRows, color: LATE_COLOR },
              }[openDetail];
              const list = detailMeta.rows;
              return (
                <Card style={styles.card}>
                  <View style={styles.detailHead}>
                    {sectionTitle(detailMeta.title, `${monthLabel(month)} · ${list.length} record${list.length === 1 ? '' : 's'}`)}
                    <TouchableOpacity style={[styles.detailClose, { borderColor: theme.border }]} onPress={() => setOpenDetail(null)} accessibilityLabel="Close details" activeOpacity={0.7}>
                      <Ionicons name="close" size={16} color={theme.textSecondary} />
                    </TouchableOpacity>
                  </View>
                  {list.length ? (
                    <View style={styles.detailList}>
                      {list.map((r) => (
                        <View key={r.date} style={[styles.detailRow, { borderColor: theme.border }]}>
                          <View style={styles.detailTop}>
                            <View style={styles.detailDateCol}>
                              <Text style={[styles.detailDate, { color: theme.textPrimary }]}>{fmtDate(r.date)}</Text>
                              <Text style={[styles.detailDay, { color: theme.textTertiary }]}>{dayNameOf(r.date)}</Text>
                            </View>
                            {openDetail === 'late' ? (
                              <View style={[styles.detailBadge, { backgroundColor: r.isFinalLate ? `${COLORS_BY_KEY.absent}22` : `${COLORS_BY_KEY.leave}22`, borderColor: r.isFinalLate ? COLORS_BY_KEY.absent : COLORS_BY_KEY.leave }]}>
                                <Text style={[styles.detailBadgeText, { color: r.isFinalLate ? COLORS_BY_KEY.absent : COLORS_BY_KEY.leave }]}>{r.isFinalLate ? 'Final late' : `Covered by ${r.graceUsed || 'grace'}`}</Text>
                              </View>
                            ) : (
                              <View style={[styles.detailBadge, { backgroundColor: `${detailMeta.color}22`, borderColor: detailMeta.color }]}>
                                <Text style={[styles.detailBadgeText, { color: detailMeta.color }]}>{openDetail === 'absent' ? 'Absent' : 'Miss Punch'}</Text>
                              </View>
                            )}
                          </View>
                          <View style={styles.detailMeta}>
                            {openDetail === 'absent' ? (
                              <Text style={[styles.detailMetaText, { color: theme.textSecondary }]}>{r.remark || 'No reason recorded'}</Text>
                            ) : null}
                            {openDetail === 'miss' ? (
                              <>
                                <Text style={[styles.detailMetaText, { color: theme.textSecondary }]}>In: {r.inTime || PLACEHOLDER} · Out: {r.outTime || PLACEHOLDER}</Text>
                                <Text style={[styles.detailMetaText, { color: theme.textTertiary }]}>Incomplete punch record</Text>
                              </>
                            ) : null}
                            {openDetail === 'late' ? (
                              <>
                                <Text style={[styles.detailMetaText, { color: theme.textSecondary }]}>In: {r.inTime || PLACEHOLDER}{r.shift ? ` · Shift: ${r.shift}` : ''}{r.shiftStart ? ` (${r.shiftStart})` : ''}</Text>
                                <Text style={[styles.detailMetaText, { color: theme.textTertiary }]}>Late by {r.lateMinutes > 0 ? `+${r.lateMinutes} min` : PLACEHOLDER}{r.isFinalLate ? ' · not covered by grace' : ` · covered by ${r.graceUsed || 'grace'}`}</Text>
                              </>
                            ) : null}
                          </View>
                        </View>
                      ))}
                    </View>
                  ) : (
                    <Text style={[styles.empty, { color: theme.textTertiary }]}>No {detailMeta.title.toLowerCase()} for {monthLabel(month)}.</Text>
                  )}
                </Card>
              );
            })() : null}

            {/* ---------- Attendance distribution (compact stacked viz) ---------- */}
            <Card style={styles.card}>
              {sectionTitle('Attendance Distribution', 'Holiday and Weekly Off are never inside Absent')}
              {(() => {
                const parts = STATUS_ORDER
                  .map((k) => ({ k, n: summary[k] || 0 }))
                  .filter((p) => p.n > 0);
                const total = parts.reduce((a, p) => a + p.n, 0);
                if (!total) return <Text style={[styles.empty, { color: theme.textTertiary }]}>Is month me koi distribution data nahi hai.</Text>;
                return (
                  <>
                    <View style={styles.distBar}>
                      {parts.map((p) => (
                        <View key={p.k} style={{ flex: p.n, backgroundColor: (STATUS_META[p.k] || STATUS_META.noRecord).color }} />
                      ))}
                    </View>
                    <View style={styles.distLegend}>
                      {parts.map((p) => (
                        <View key={p.k} style={styles.distItem}>
                          <View style={[styles.legendDot, { backgroundColor: (STATUS_META[p.k] || STATUS_META.noRecord).color }]} />
                          <Text style={[styles.distLabel, { color: theme.textSecondary }]} numberOfLines={1}>
                            {(STATUS_META[p.k] || STATUS_META.noRecord).label}
                          </Text>
                          <Text style={[styles.distValue, { color: theme.textPrimary }]}>
                            {p.n} · {Math.round((p.n / total) * 100)}%
                          </Text>
                        </View>
                      ))}
                    </View>
                  </>
                );
              })()}
            </Card>

            {/* ---------- Weekly attendance trend (Mon-Sun calendar weeks) ---------- */}
            <Card style={styles.card}>
              {sectionTitle('Weekly Attendance Trend', 'Calendar weeks (Mon–Sun), actual recorded statuses')}
              {weeks.length ? (
                <>
                  <View style={styles.weekRow}>
                    {weeks.map((w) => {
                      const total = w.present + w.absent + w.miss + w.leave || 1;
                      return (
                        <View key={w.label} style={styles.weekCol}>
                          <View style={styles.weekStack}>
                            {['leave', 'miss', 'absent', 'present'].map((k) => (
                              w[k] > 0 ? (
                                <View key={k} style={{ height: `${(w[k] / total) * 100}%`, backgroundColor: STATUS_META[k].color, width: '100%' }} />
                              ) : null
                            ))}
                          </View>
                          <Text style={[styles.weekLabel, { color: theme.textTertiary }]} numberOfLines={1}>{w.label.replace('Week ', 'W')}</Text>
                          <Text style={[styles.weekSub, { color: theme.textTertiary }]} numberOfLines={1}>{shortDate(w.from)}</Text>
                        </View>
                      );
                    })}
                  </View>
                  <View style={styles.legend}>
                    {[['Present', 'present'], ['Absent', 'absent'], ['Miss Punch', 'miss'], ['Approved Leave', 'leave']].map(([l, k]) => (
                      <View key={k} style={styles.legendItem}>
                        <View style={[styles.legendDot, { backgroundColor: STATUS_META[k].color }]} />
                        <Text style={[styles.legendText, { color: theme.textSecondary }]}>{l}</Text>
                      </View>
                    ))}
                  </View>
                </>
              ) : (
                <Text style={[styles.empty, { color: theme.textTertiary }]}>Is month me koi weekly data nahi hai.</Text>
              )}
            </Card>

            {/* ---------- Punctuality (raw late / grace-covered / final late ALAG) ---------- */}
            <Card style={styles.card}>
              {sectionTitle('Punctuality', 'Raw late, grace-covered aur final late — alag numbers')}
              <View style={styles.punctRow}>
                {[
                  ['On Time', punct.onTime, COLORS_BY_KEY.present],
                  ['Late (raw)', punct.lateDays, LATE_COLOR],
                  ['Grace-covered', punct.lateCovered, '#0891B2'],
                  ['Final Late', punct.lateFinal, COLORS_BY_KEY.absent],
                ].map(([l, v, c]) => (
                  <View key={l} style={[styles.punctBox, { borderColor: `${c}44` }]}>
                    <Text style={[styles.punctValue, { color: c }]}>{v}</Text>
                    <Text style={[styles.punctLabel, { color: theme.textSecondary }]} numberOfLines={1}>{l}</Text>
                  </View>
                ))}
              </View>
              {!isStaffGrace ? (
                <Text style={[styles.graceLine, { color: theme.textTertiary }]}>
                  Monthly staff grace is not applicable for your category.
                </Text>
              ) : graceBuckets ? (
                <View style={styles.graceGrid}>
                  {graceBuckets.map((g) => {
                    const usedColor = g.used > 0 ? COLORS_BY_KEY.absent : theme.textTertiary;
                    const leftColor = g.remaining > 0 ? COLORS_BY_KEY.present : theme.textTertiary;
                    return (
                      <View key={g.label} style={[styles.graceBucket, { borderColor: `${g.used > 0 ? COLORS_BY_KEY.absent : COLORS_BY_KEY.present}33` }]}>
                        <Text style={[styles.graceBucketLabel, { color: theme.textSecondary }]} numberOfLines={1}>{g.label}</Text>
                        <Text style={[styles.graceUsedText, { color: usedColor }]} numberOfLines={1}>Used {g.used}/{g.limit}</Text>
                        <Text style={[styles.graceLeftText, { color: leftColor }]} numberOfLines={1}>Left {g.remaining}</Text>
                      </View>
                    );
                  })}
                </View>
              ) : (
                <Text style={[styles.graceLine, { color: theme.textTertiary }]}>
                  Grace information unavailable for this month.
                </Text>
              )}
            </Card>

            {/* ---------- Working hours trend (recorded values only) ---------- */}
            <Card style={styles.card}>
              {sectionTitle('Working Hours Trend', 'Recorded working hours per day')}
              {hours.length ? (
                <>
                  <View style={styles.hoursRow}>
                    {hours.map((h) => (
                      <View key={h.date} style={styles.hoursCol}>
                        <View style={[styles.hoursBar, { height: `${Math.max(6, (h.minutes / maxDayMinutes) * 100)}%` }]} />
                      </View>
                    ))}
                  </View>
                  <View style={styles.trendAxis}>
                    <Text style={[styles.axisText, { color: theme.textTertiary }]}>{shortDate(hours[0].date)}</Text>
                    <Text style={[styles.axisText, { color: theme.textTertiary }]}>peak {hoursText(maxDayMinutes)}</Text>
                    <Text style={[styles.axisText, { color: theme.textTertiary }]}>{shortDate(hours[hours.length - 1].date)}</Text>
                  </View>
                </>
              ) : (
                <Text style={[styles.empty, { color: theme.textTertiary }]}>Is month me recorded working hours nahi hain.</Text>
              )}
            </Card>

            {/* ---------- My Progress / Personal Insights ---------- */}
            <Card style={styles.card}>
              {sectionTitle('My Progress', 'Factual insights from your own recorded data — koi score/ranking nahi')}
              {insights.length ? (
                <View style={styles.insightList}>
                  {insights.map((it) => (
                    <View key={it.id} style={[styles.insightRow, { borderColor: theme.border }]}>
                      <View style={styles.insightText}>
                        <Text style={[styles.insightTitle, { color: theme.textSecondary }]}>{it.title}</Text>
                        <Text style={[styles.insightValue, { color: theme.textPrimary }]}>{it.value}</Text>
                        <Text style={[styles.insightNote, { color: theme.textTertiary }]}>{it.note}</Text>
                      </View>
                    </View>
                  ))}
                </View>
              ) : (
                <Text style={[styles.empty, { color: theme.textTertiary }]}>Insights ke liye is month parayapt recorded data nahi hai.</Text>
              )}
            </Card>

            {/* ---------- Daily attendance timeline (expandable date cards) ---------- */}
            <Card style={styles.card}>
              {sectionTitle('Daily Attendance Timeline', `Every date of ${monthLabel(month)}${inProgress ? ' · month in progress' : ''}`)}
              <View style={styles.legend}>
                {Object.entries(STATUS_META).map(([k, m]) => (
                  <View key={k} style={styles.legendItem}>
                    <View style={[styles.legendDot, { backgroundColor: m.color }]} />
                    <Text style={[styles.legendText, { color: theme.textSecondary }]}>{m.label}</Text>
                  </View>
                ))}
              </View>
              <View style={styles.timeline}>
                {register.map((r) => {
                  const meta = STATUS_META[r.kind] || STATUS_META.noRecord;
                  const open = expandedDate === r.date;
                  return (
                    <TouchableOpacity
                      key={r.date}
                      style={[styles.dateRow, { borderColor: open ? `${meta.color}66` : theme.border }]}
                      activeOpacity={0.8}
                      accessibilityLabel={`${fmtDate(r.date)} ${r.status}`}
                      onPress={() => setExpandedDate(open ? null : r.date)}
                    >
                      <View style={styles.dateRowTop}>
                        <View style={styles.dateCol}>
                          <Text style={[styles.dateText, { color: theme.textPrimary }]}>{shortDate(r.date)}</Text>
                          <Text style={[styles.dayText, { color: theme.textTertiary }]}>{r.dayName}</Text>
                        </View>
                        <View style={[styles.statusBadge, { backgroundColor: `${meta.color}18`, borderColor: `${meta.color}55` }]}>
                          <Text style={[styles.statusText, { color: meta.color }]} numberOfLines={1}>{r.status}</Text>
                        </View>
                        <View style={styles.dateRight}>
                          <Text style={[styles.dateHours, { color: theme.textPrimary }]}>{r.hasRow ? r.hoursText : DASH}</Text>
                          {r.lateText ? <Text style={[styles.dateLate, { color: LATE_COLOR }]}>{r.lateText}</Text> : null}
                        </View>
                        <Ionicons name={open ? 'chevron-up' : 'chevron-down'} size={14} color={theme.textTertiary} />
                      </View>
                      {open ? (
                        <View style={[styles.dateDetail, { borderTopColor: theme.border }]}>
                          {[['In Time', r.inTime || PLACEHOLDER], ['Out Time', r.outTime || PLACEHOLDER],
                            ['Worked Hours', r.hasRow ? r.hoursText : PLACEHOLDER],
                            ['Late Duration', r.lateText ? (r.graceUsed ? `${r.lateText} (covered by ${r.graceUsed})` : r.lateText) : PLACEHOLDER],
                            ['Remark', r.remark || PLACEHOLDER]].map(([l, v]) => (
                            <View key={l} style={styles.detailRow}>
                              <Text style={[styles.detailLabel, { color: theme.textSecondary }]}>{l}</Text>
                              <Text style={[styles.detailValue, { color: theme.textSecondary }]}>{v}</Text>
                            </View>
                          ))}
                        </View>
                      ) : null}
                    </TouchableOpacity>
                  );
                })}
              </View>
            </Card>

            {/* ---------- CSV export (existing functionality retained) ---------- */}
            <Card style={styles.card}>
              {sectionTitle('Export', `${monthLabel(month)} · CSV`)}
              {exportMsg ? (
                <View style={[styles.formMsg, exportMsg.kind === 'ok'
                  ? { backgroundColor: `${COLORS_BY_KEY.present}15`, borderColor: `${COLORS_BY_KEY.present}33` }
                  : { backgroundColor: `${COLORS_BY_KEY.absent}12`, borderColor: `${COLORS_BY_KEY.absent}33` }]}>
                  <Text style={[styles.formMsgText, { color: exportMsg.kind === 'ok' ? COLORS_BY_KEY.present : COLORS_BY_KEY.absent }]}>
                    {exportMsg.text}
                  </Text>
                </View>
              ) : null}
              <Button
                title={exporting ? 'Exporting...' : 'Export CSV'}
                onPress={handleExport}
                loading={exporting}
                disabled={exporting}
                size="small"
              />
            </Card>
          </>
        ) : null}
      </ScrollView>
    </ScreenContainer>
  );
};

const styles = StyleSheet.create({
  scroll: { padding: 12, paddingBottom: 32 },
  stateBox: { paddingVertical: 40, alignItems: 'center', gap: 10 },
  stateText: { fontSize: 13 },
  errorText: { fontSize: 13 },

  // Month selector
  navBar: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    borderRadius: 14, borderWidth: 1, paddingHorizontal: 8, paddingVertical: 10,
  },
  navArrow: { width: 36, height: 36, borderRadius: 18, alignItems: 'center', justifyContent: 'center' },
  navArrowDisabled: { opacity: 0.4 },
  navCenter: { flex: 1, alignItems: 'center' },
  navTitle: { fontSize: 15, fontWeight: '800' },
  navSub: { fontSize: 10, marginTop: 1 },
  currentChip: {
    alignSelf: 'center', flexDirection: 'row', alignItems: 'center', gap: 5,
    paddingHorizontal: 12, paddingVertical: 5, borderRadius: 999, borderWidth: 1, marginTop: 8,
  },
  currentChipText: { fontSize: 11, fontWeight: '800' },

  // Cards + section heads
  card: { marginTop: 12 },
  sectionHead: { marginBottom: 8 },
  cardTitle: { fontSize: 14, fontWeight: '800' },
  cardSub: { fontSize: 10.5, marginTop: 2 },
  empty: { fontSize: 11.5, textAlign: 'center', paddingVertical: 12 },

  // Summary cards
  sumGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  sumBox: {
    flexGrow: 1, flexBasis: '30%', minWidth: 100,
    borderRadius: 12, borderWidth: 1, padding: 10, alignItems: 'center',
  },
  sumIcon: { width: 26, height: 26, borderRadius: 13, alignItems: 'center', justifyContent: 'center', marginBottom: 4 },
  sumValue: { fontSize: 18, fontWeight: '800' },
  sumLabel: { fontSize: 9.5, fontWeight: '700', textTransform: 'uppercase', letterSpacing: 0.3, marginTop: 2, textAlign: 'center' },
  sumSub: { fontSize: 8.5, marginTop: 2, textAlign: 'center' },
  sumChevron: { position: 'absolute', top: 6, right: 6 },

  // Card drill-down detail
  detailHead: { flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between' },
  detailClose: { width: 26, height: 26, borderRadius: 13, borderWidth: 1, alignItems: 'center', justifyContent: 'center', marginTop: 2 },
  detailList: { gap: 8, marginTop: 4 },
  detailRow: { borderRadius: 12, borderWidth: 1, padding: 10 },
  detailTop: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8 },
  detailDateCol: { flexDirection: 'row', alignItems: 'baseline', gap: 8 },
  detailDate: { fontSize: 12.5, fontWeight: '800' },
  detailDay: { fontSize: 9.5 },
  detailBadge: { paddingHorizontal: 8, paddingVertical: 3, borderRadius: 999, borderWidth: 1 },
  detailBadgeText: { fontSize: 9.5, fontWeight: '800' },
  detailMeta: { marginTop: 6, gap: 3 },
  detailMetaText: { fontSize: 10.5 },

  // Distribution
  distBar: { flexDirection: 'row', height: 14, borderRadius: 7, overflow: 'hidden', marginTop: 4 },
  distLegend: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 10 },
  distItem: { flexDirection: 'row', alignItems: 'center', gap: 5, flexGrow: 1, flexBasis: '45%' },
  distLabel: { fontSize: 10, flexShrink: 1 },
  distValue: { fontSize: 10, fontWeight: '800', marginLeft: 'auto' },

  // Weekly trend
  weekRow: { flexDirection: 'row', alignItems: 'flex-end', gap: 6, marginTop: 4 },
  weekCol: { flex: 1, alignItems: 'center' },
  weekStack: { width: '70%', height: 96, borderRadius: 6, overflow: 'hidden', justifyContent: 'flex-end', backgroundColor: '#F1F5F9' },
  weekLabel: { fontSize: 9, fontWeight: '700', marginTop: 4 },
  weekSub: { fontSize: 8 },
  legend: { flexDirection: 'row', flexWrap: 'wrap', gap: 10, marginTop: 10 },
  legendItem: { flexDirection: 'row', alignItems: 'center', gap: 5 },
  legendDot: { width: 8, height: 8, borderRadius: 4 },
  legendText: { fontSize: 10 },

  // Punctuality
  punctRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  punctBox: { flexGrow: 1, flexBasis: '22%', minWidth: 72, borderRadius: 12, borderWidth: 1, paddingVertical: 8, alignItems: 'center' },
  punctValue: { fontSize: 17, fontWeight: '800' },
  punctLabel: { fontSize: 9, fontWeight: '700', textTransform: 'uppercase', letterSpacing: 0.2, marginTop: 2 },
  graceLine: { fontSize: 10, marginTop: 10, textAlign: 'center' },
  // Per-bucket grace utilisation (Used / Left) — compact, colour-coded rows.
  graceGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 10 },
  graceBucket: {
    flexGrow: 1, flexBasis: '30%', minWidth: 96, borderRadius: 12, borderWidth: 1,
    paddingVertical: 8, paddingHorizontal: 6, alignItems: 'center', gap: 2,
  },
  graceBucketLabel: { fontSize: 9.5, fontWeight: '700', textTransform: 'uppercase', letterSpacing: 0.2 },
  graceUsedText: { fontSize: 11.5, fontWeight: '800' },
  graceLeftText: { fontSize: 11.5, fontWeight: '800' },

  // Working hours trend
  hoursRow: { flexDirection: 'row', alignItems: 'flex-end', gap: 3, height: 96, marginTop: 4 },
  hoursCol: { flex: 1, height: '100%', justifyContent: 'flex-end' },
  hoursBar: { width: '100%', backgroundColor: '#2563EB', borderRadius: 3, opacity: 0.75 },
  trendAxis: { flexDirection: 'row', justifyContent: 'space-between', marginTop: 6 },
  axisText: { fontSize: 9 },

  // Insights
  insightList: { gap: 8 },
  insightRow: { borderRadius: 12, borderWidth: 1, padding: 10 },
  insightText: { gap: 2 },
  insightTitle: { fontSize: 9.5, fontWeight: '700', textTransform: 'uppercase', letterSpacing: 0.3 },
  insightValue: { fontSize: 13.5, fontWeight: '800' },
  insightNote: { fontSize: 9.5 },

  // Daily timeline
  timeline: { gap: 8, marginTop: 10 },
  dateRow: { borderRadius: 12, borderWidth: 1, padding: 10 },
  dateRowTop: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  dateCol: { width: 58 },
  dateText: { fontSize: 11.5, fontWeight: '800' },
  dayText: { fontSize: 9 },
  statusBadge: { paddingHorizontal: 8, paddingVertical: 3, borderRadius: 999, borderWidth: 1, maxWidth: 120 },
  statusText: { fontSize: 9.5, fontWeight: '800' },
  dateRight: { marginLeft: 'auto', alignItems: 'flex-end' },
  dateHours: { fontSize: 11, fontWeight: '700' },
  dateLate: { fontSize: 9, fontWeight: '700' },
  dateDetail: { marginTop: 8, paddingTop: 8, borderTopWidth: 1, gap: 4 },
  detailRow: { flexDirection: 'row', justifyContent: 'space-between', gap: 10 },
  detailLabel: { fontSize: 10 },
  detailValue: { fontSize: 10.5, fontWeight: '600', flexShrink: 1, textAlign: 'right' },

  // Export
  formMsg: { padding: 10, borderRadius: 10, borderWidth: 1, marginBottom: 10 },
  formMsgText: { fontSize: 11, fontWeight: '600' },
});

export default EmployeeReportsScreen;