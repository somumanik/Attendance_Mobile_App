// ============================================================================
// FILE: mobile/src/screens/hr/HRDashboardScreen.jsx
// PURPOSE: HR Dashboard - Executive overview with stats and charts
// ============================================================================

/**
 * Ye screen HR ka executive dashboard hai.
 * 
 * Navigation Flow:
 * HRNavigator (Dashboard Tab) → HRDashboardScreen
 * 
 * Data Flow:
 * Screen Mount → API Service (existing backend APIs) → Savior SQL Server
 *   ├── GET /api/hr/summary          → Total staff / punched / absent / miss / late
 *   ├── GET /api/employees          → real employee list (DOB/DOJ for celebrations)
 *   ├── GET /api/marriage-anniversary → marriage anniversaries
 *   ├── GET /api/attendance?days=1  → today's live biometric status
 *   └── GET /api/hr/dashboard-charts → real chart datasets
 *
 * NOTE: Same backend APIs jo desktop website (index.html) use karta hai —
 *       mobile sirf UI alag hai, data source bilkul same.
 * Koi bhi dummy/mock data nahi; API fail ho to loading/error state dikhta hai.
 */

import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { View, Text, ScrollView, StyleSheet, TouchableOpacity, RefreshControl, ActivityIndicator, TextInput } from 'react-native';
import { COLORS, TYPOGRAPHY, SPACING, SHADOWS } from '../../utils/colors';
import { ScreenContainer } from '../../components/ScreenContainer';
import { StatCard } from '../../components/StatCard';
import { PlaceholderCard } from '../../components/PlaceholderCard';
import { LogoutButton } from '../../components/LogoutButton';
import { Button } from '../../components/Button';
import { MonthNavigator, currentMonthKey } from '../../components/MonthNavigator';
import { getStatusColor } from '../../utils/format';
import { useNavigation } from '@react-navigation/native';
import { api } from '../../services/api';

/**
 * HR Dashboard Screen Component
 */
export const HRDashboardScreen = () => {
  const navigation = useNavigation();

  const clean = (v) => String(v == null ? '' : v).trim();

// DISPLAY ORDER ONLY. /hr/audit returns the selected month newest-first (the
// order the desktop audit view expects, so the backend and website stay
// untouched). The Executive Overview audit modal shows the same month
// oldest -> newest. Rows themselves are untouched: status classification,
// In/Out times, hours, grace and current/future-day handling all stay exactly
// as the backend returned them, and same-day rows keep the SQL order.
const ascendingByDate = (list) => (Array.isArray(list) ? list : [])
  .map((row, index) => ({
    row,
    index,
    key: clean(row && (row.date || row.dateoffice)).slice(0, 10),
  }))
  .sort((a, b) => {
    if (a.key === b.key) return a.index - b.index;
    if (!a.key) return 1;
    if (!b.key) return -1;
    return a.key < b.key ? -1 : 1;
  })
  .map((entry) => entry.row);

  // Live Biometric IN/OUT colouring is presentation only: a missing punch keeps
  // the neutral placeholder instead of being painted as a real time.
  const hasPunchTime = (v) => {
    const s = clean(v);
    return s.length > 0 && s !== '—' && s !== '--' && s !== '-';
  };

  // Audit rows show the day name alongside the date.
  const dayName = (iso) => {
    const s = clean(iso);
    if (s.length < 10) return '';
    const d = new Date(`${s.slice(0, 10)}T00:00:00`);
    if (Number.isNaN(d.getTime())) return '';
    return d.toLocaleDateString('en-IN', { weekday: 'short' });
  };

  // Phase 3A.10: HR-only employee credential management (password / PIN reset).
  const openCredentialManagement = () => {
    navigation.navigate('HREmployeeCredentials');
  };
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  // Real Savior data — koi bhi hardcoded/demo value nahi.
  const [stats, setStats] = useState({
    totalStaff: 0,
    punchedToday: 0,
    presentToday: 0,
    absentToday: 0,
    missToday: 0,
    lateToday: 0,
  });
  const [celebrations, setCelebrations] = useState({ birthdays: [], workAnniversaries: [], marriageAnniversaries: [] });
  // Active employee master (real roster from /employees) — one row per employee.
  const [activeEmployees, setActiveEmployees] = useState([]);
  const [todayAttendance, setTodayAttendance] = useState([]);
  const [todayDate, setTodayDate] = useState('');
  // Live Biometric table paging — total hamesha poore real dataset se.
  const [bioPage, setBioPage] = useState(1);
  const [bioPageSize, setBioPageSize] = useState(50);
  const [bioSearch, setBioSearch] = useState('');
  const BIO_PAGE_SIZES = [50, 100, 150];

  // Live Biometric rows come from the real Savior attendance records
  // (GET /api/attendance?days=1), NOT from the employee roster.
  // That payload spans today + yesterday, so only today's record is kept for each
  // paycode — this is the same rule the desktop website uses (index.html:2896).
  // The count below is therefore a real attendance-record count.
  const bioFiltered = useMemo(() => {
    const term = clean(bioSearch).toLowerCase();
    const byPaycode = new Map();
    todayAttendance.forEach((r) => {
      const paycode = clean(r.paycode);
      if (!paycode) return;
      if (todayDate && clean(r.date).slice(0, 10) !== todayDate) return;
      // Keep the first record for this paycode (desktop `.find()` semantics).
      if (!byPaycode.has(paycode)) byPaycode.set(paycode, r);
    });

    return Array.from(byPaycode.values())
      .filter((r) => {
        if (!term) return true;
        const hay = [r.name, r.paycode, r.dept].map(clean).join(' ').toLowerCase();
        return hay.indexOf(term) >= 0;
      })
      .sort((a, b) => clean(a.name).localeCompare(clean(b.name), undefined, { sensitivity: 'base' }));
  }, [todayAttendance, todayDate, bioSearch]);

  const bioTotalRecords = todayAttendance.length;
  const bioTotal = bioFiltered.length;
  const bioTotalPages = Math.max(1, Math.ceil(bioTotal / bioPageSize));
  const bioSafePage = Math.min(bioPage, bioTotalPages);
  const bioVisible = bioFiltered.slice((bioSafePage - 1) * bioPageSize, bioSafePage * bioPageSize);
  // Live Biometric row -> real employee attendance audit (uses the row paycode identity)
  const [biDetail, setBiDetail] = useState(null);
  const [biDetailLoading, setBiDetailLoading] = useState(false);
  const [biDetailError, setBiDetailError] = useState(null);
  // Month-wise view of the same existing audit endpoint. Starts at the current
  // month; PHASE G.2 Prev/Next both work (Next capped at the current month so
  // a future month is never selectable) and the query always uses the
  // displayed month.
  const [biMonth, setBiMonth] = useState(currentMonthKey());

  // Reuse the existing employee attendance audit endpoint used by the desktop
  // website: GET /api/hr/audit/:paycode?month=YYYY-MM
  const loadBiAudit = useCallback(async (paycode, month) => {
    setBiDetailLoading(true);
    setBiDetailError(null);
    setBiDetail({ paycode });
    try {
      const data = await api.get(`/hr/audit/${encodeURIComponent(paycode)}`, { month });
      setBiDetail({ ...data, requestedPaycode: paycode });
    } catch (err) {
      setBiDetail(null);
      setBiDetailError(err?.response?.status === 404 ? 'Employee not found' : (err?.message || 'Attendance audit load nahi ho paya.'));
    } finally {
      setBiDetailLoading(false);
    }
  }, []);

  const openBiometricDetail = useCallback((employee) => {
    const paycode = clean(employee?.paycode);
    if (!paycode) return;
    loadBiAudit(paycode, biMonth);
  }, [loadBiAudit, biMonth]);

  // Month change keeps the same employee and reloads that month's real records.
  // PHASE G.2 root-cause fix: pass the NEW month explicitly so the request
  // uses it even though setBiMonth is async (no stale-month query).
  const changeBiMonth = useCallback((nextMonth) => {
    setBiMonth(nextMonth);
    const paycode = clean(biDetail?.requestedPaycode || biDetail?.paycode);
    if (paycode) loadBiAudit(paycode, nextMonth);
  }, [biDetail, loadBiAudit]);

  // PHASE G.2 — same application-level HOLIDAY overlay as Single Employee
  // Audit (display only): applicable ACTIVE holidays from `biDetail.holidays`
  // win over the Savior label; holiday purple (#7C3AED); half-day keeps the
  // Half Day language. Savior rows untouched.
  const HOLIDAY_PURPLE = '#7C3AED';
  const biHolidayByDate = useMemo(() => {
    const map = new Map();
    for (const h of (Array.isArray(biDetail?.holidays) ? biDetail.holidays : [])) {
      const key = clean(h?.holidaydate).slice(0, 10);
      if (!key) continue;
      const list = map.get(key) || [];
      list.push(h);
      map.set(key, list);
    }
    return map;
  }, [biDetail]);
  const biHolidayLabelFor = (iso) => {
    const list = biHolidayByDate.get(clean(iso).slice(0, 10)) || [];
    const active = list.filter((h) => h && h.active !== false);
    if (!active.length) return null;
    if (active.every((h) => h.isHalfDay === true)) return 'Half Day (Holiday)';
    return 'Holiday';
  };

  const [charts, setCharts] = useState(null);
  const [lastSync, setLastSync] = useState(null);

  // Late Today drill-down (real /api/hr/late-employees data)
  const [lateOpen, setLateOpen] = useState(false);
  const [lateLoading, setLateLoading] = useState(false);
  const [lateError, setLateError] = useState(null);
  const [lateData, setLateData] = useState({ late: 0, employees: [] });

  const openLateEmployees = useCallback(async () => {
    setLateOpen(true);
    setLateLoading(true);
    setLateError(null);
    try {
      // Reuse the existing late-employee endpoint (same one the desktop website uses).
      const summary = await api.get('/hr/summary');
      const from = summary?.fromDate || summary?.indiaToday;
      const to = summary?.toDate || summary?.indiaToday;
      const data = await api.get('/hr/late-employees', { fromDate: from, toDate: to });
      setLateData({ late: Number(data?.late || 0), employees: Array.isArray(data?.employees) ? data.employees : [] });
    } catch (err) {
      setLateError(err?.message || 'Late employees load nahi ho paye.');
      setLateData({ late: 0, employees: [] });
    } finally {
      setLateLoading(false);
    }
  }, []);

  // Today's date compare karne ke liye (MMDD format DOB/DOJ se match).
  const monthDay = (iso) => {
    const s = clean(iso);
    if (s.length < 10) return '';
    return s.slice(5, 10); // MM-DD
  };
  const todayMD = () => {
    const d = new Date();
    return String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
  };
  const yearsBetween = (iso) => {
    const s = clean(iso);
    if (s.length < 10) return 0;
    const start = new Date(s);
    if (Number.isNaN(start.getTime())) return 0;
    const now = new Date();
    let years = now.getFullYear() - start.getFullYear();
    const m = now.getMonth() - start.getMonth();
    if (m < 0 || (m === 0 && now.getDate() < start.getDate())) years -= 1;
    return years;
  };

  // Desktop website jaisa hi: /employees se poora active roster laate hain
  // (paginated), kyunki DOB/DOJ sirf wahi endpoint deta hai.
  const loadActiveEmployees = async () => {
    const all = [];
    const pageSize = 100;
    for (let page = 1; page <= 20; page += 1) {
      const data = await api.get('/employees', { page, pageSize, active: 'Y' });
      const rows = Array.isArray(data?.rows) ? data.rows : [];
      all.push(...rows);
      if (rows.length < pageSize) break;
    }
    return all;
  };

  const loadDashboard = useCallback(async (isRefresh) => {
    if (isRefresh) setIsRefreshing(true);
    setError(null);
    try {
      // Parallel: desktop ke same existing APIs.
      const [summary, employees, marriages, attendance, chartData] = await Promise.all([
        api.get('/hr/summary'),
        loadActiveEmployees(),
        api.get('/marriage-anniversary').catch(() => []),
        api.get('/attendance', { days: 1 }).catch(() => []),
        api.get('/hr/dashboard-charts').catch(() => null),
      ]);

      setStats({
        totalStaff: Number(summary?.totalstaff || 0),
        punchedToday: Number(summary?.punchedtoday ?? summary?.punched ?? 0),
        presentToday: Number(summary?.presenttoday ?? 0),
        absentToday: Number(summary?.absenttoday ?? summary?.absent ?? 0),
        missToday: Number(summary?.misstoday ?? summary?.miss ?? 0),
        lateToday: Number(summary?.latetoday ?? summary?.late ?? 0),
      });

      // Aaj ke birthdays / work anniversaries — real DOB/DOJ se.
      const md = todayMD();
      const birthdays = employees
        .filter((e) => monthDay(e.dateofbirth) === md)
        .map((e) => ({ empname: clean(e.empname), paycode: clean(e.paycode), departmentcode: clean(e.departmentcode) }));
      const workAnniversaries = employees
        .filter((e) => monthDay(e.dateofjoin) === md)
        .map((e) => ({ empname: clean(e.empname), paycode: clean(e.paycode), departmentcode: clean(e.departmentcode), years: yearsBetween(e.dateofjoin) }));
      const marriageAnniversaries = (Array.isArray(marriages) ? marriages : [])
        .filter((m) => monthDay(m.anniversarydate) === md)
        .map((m) => {
          const emp = employees.find((e) => clean(e.paycode) === clean(m.paycode));
          return { empname: clean(emp?.empname) || clean(m.paycode), paycode: clean(m.paycode), departmentcode: clean(emp?.departmentcode) };
        });
      setCelebrations({ birthdays, workAnniversaries, marriageAnniversaries });

      // Aaj ka live attendance (desktop 'Live biometric' view ka same source).
      // /attendance sirf paycode deta hai, isliye name/dept roster (/employees) se join hota hai.
      // Poora real dataset rakha jaata hai; paging screen par karti hai.
      // Live Biometric rows are EMPLOYEE rows. tbltimeregister.paycode is resolved
      // against dbo.tblemployee.paycode — the same identity join the All Employees
      // roster uses. A punch record is kept only when it maps to a real ACTIVE
      // employee master record with a real name, so unresolved / inactive punches
      // can never surface as a "row" whose paycode stands in for a missing name.
      const empByPaycode = new Map(employees.map((e) => [clean(e.paycode), e]));
      const rows = Array.isArray(attendance) ? attendance : [];
      setTodayAttendance(
        rows
          .filter((r) => {
            const emp = empByPaycode.get(clean(r.paycode));
            return Boolean(emp)
              && clean(emp.active).toUpperCase() === 'Y'
              && clean(emp.empname) !== '';
          })
          .map((r) => {
            const paycode = clean(r.paycode);
            const emp = empByPaycode.get(paycode);
            return {
              paycode,
              // date is required to select today's real biometric record.
              date: r.date || r.dateoffice || '',
              // Name always comes from the real Savior employee master.
              name: clean(emp.empname),
              dept: clean(emp.departmentcode),
              inTime: r.inTime || '—',
              outTime: r.outTime || '—',
              status: r.statusLabel || r.computedStatus || r.status || '',
              isLate: Boolean(r.isLate),
            };
          })
      );

      setCharts(chartData || null);
      setTodayDate(clean(summary?.indiaToday).slice(0, 10));
      setActiveEmployees(employees.filter((e) => clean(e.active).toUpperCase() === 'Y'));
      setBioPage(1);
      setLastSync(new Date());
    } catch (err) {
      // Koi fallback fake data nahi — sirf error state.
      setError(err?.message || 'HR dashboard data load nahi ho paya.');
    } finally {
      setLoading(false);
      if (isRefresh) setIsRefreshing(false);
    }
  }, []);

  useEffect(() => {
    loadDashboard(false);
  }, [loadDashboard]);

  const handleRefresh = () => loadDashboard(true);

  return (
    <ScreenContainer title="Executive Overview" showHeader={true} rightAction={<LogoutButton />}>
      <ScrollView
        refreshControl={
          <RefreshControl refreshing={isRefreshing} onRefresh={handleRefresh} colors={[COLORS.primary]} />
        }
        contentContainerStyle={styles.scrollContent}
      >
        {/* Loading state — koi fake number nahi */}
        {loading ? (
          <View style={styles.stateBox}>
            <ActivityIndicator size="large" color={COLORS.primary} />
            <Text style={styles.stateText}>Real Savior data load ho raha hai...</Text>
          </View>
        ) : null}

        {/* Error state — retry ke saath, fake fallback NAHI */}
        {!loading && error ? (
          <View style={styles.errorBox}>
            <Text style={styles.errorText}>⚠️ {error}</Text>
            <Button title="Retry" onPress={() => loadDashboard(false)} variant="outline" size="small" style={styles.retryButton} />
          </View>
        ) : null}

        {!loading && !error ? (
        <>
        {/* Notifications Bar - Today's Celebrations (real DOB/DOJ se) */}
        <View style={styles.notificationBar}>
          <View style={styles.notificationHeader}>
            <Text style={styles.notificationIcon}>🔔</Text>
            <Text style={styles.notificationTitle}>Today's Celebrations</Text>
            <TouchableOpacity style={styles.viewAllLink}>
              <Text style={styles.viewAllText}>View All →</Text>
            </TouchableOpacity>
          </View>
          
          <View style={styles.celebrationList}>
            {celebrations.birthdays.length === 0 && celebrations.workAnniversaries.length === 0 && celebrations.marriageAnniversaries.length === 0 ? (
              <Text style={styles.emptyText}>Aaj koi birthday ya work anniversary nahi hai.</Text>
            ) : null}
            {celebrations.birthdays.map((emp, i) => (
              <View key={`bday-${i}`} style={styles.celebrationItem}>
                <Text style={styles.celebrationIcon}>🎂</Text>
                <View>
                  <Text style={styles.celebrationName}>{emp.empname}</Text>
                  <Text style={styles.celebrationDept}>{emp.departmentcode || emp.paycode} • Birthday</Text>
                </View>
              </View>
            ))}
            {celebrations.workAnniversaries.map((emp, i) => (
              <View key={`wanniv-${i}`} style={styles.celebrationItem}>
                <Text style={styles.celebrationIcon}>🏆</Text>
                <View>
                  <Text style={styles.celebrationName}>{emp.empname}</Text>
                  <Text style={styles.celebrationDept}>
                    {emp.departmentcode || emp.paycode} • Work Anniversary{emp.years ? ` • ${emp.years} Years` : ''}
                  </Text>
                </View>
              </View>
            ))}
            {celebrations.marriageAnniversaries.map((emp, i) => (
              <View key={`manniv-${i}`} style={styles.celebrationItem}>
                <Text style={styles.celebrationIcon}>💍</Text>
                <View>
                  <Text style={styles.celebrationName}>{emp.empname}</Text>
                  <Text style={styles.celebrationDept}>{emp.departmentcode || emp.paycode} • Marriage Anniversary</Text>
                </View>
              </View>
            ))}
          </View>
        </View>

        {/* Key Stats Cards — real /hr/summary values */}
        <View style={styles.statsGrid}>
          <StatCard
            title="Total Staff"
            value={stats.totalStaff}
            subtitle="Active Employees"
            icon="👥"
            color={COLORS.primary}
          />
          <StatCard
            title="Punched Today"
            value={stats.punchedToday}
            subtitle={stats.totalStaff ? `${Math.round((stats.punchedToday / stats.totalStaff) * 100)}%` : '0%'}
            icon="👆"
            color={COLORS.success}
          />
          <StatCard
            title="Absent Today"
            value={stats.absentToday}
            subtitle={stats.totalStaff ? `${Math.round((stats.absentToday / stats.totalStaff) * 100)}%` : '0%'}
            icon="🚫"
            color={COLORS.error}
          />
          <StatCard
            title="Miss Punch"
            value={stats.missToday}
            subtitle="Needs Review"
            icon="⚠️"
            color={COLORS.warning}
          />
          <StatCard
            title="Late Today"
            value={stats.lateToday}
            subtitle="Tap to view"
            icon="⏰"
            color={COLORS.error}
            onPress={openLateEmployees}
          />
        </View>

        {/* Real chart data — /api/hr/dashboard-charts (mobile bar rendering) */}
        <View style={styles.chartsRow}>
          <View style={[styles.chartCard, SHADOWS.md]}>
            <View style={styles.chartHeader}>
              <Text style={styles.chartTitle}>Attendance Activity</Text>
              <Text style={styles.chartSubtitle}>On Time / Early / Late</Text>
            </View>
            {charts?.chart1?.labels ? (
              <View style={styles.barList}>
                {charts.chart1.labels.map((label, i) => {
                  const total = (charts.chart1.data || []).reduce((a, b) => a + Number(b || 0), 0) || 1;
                  const value = Number(charts.chart1.data[i] || 0);
                  return (
                    <View key={String(label) + i} style={styles.barRow}>
                      <Text style={styles.barLabel}>{String(label)}</Text>
                      <View style={styles.barTrack}>
                        <View style={[styles.barFill, { width: `${Math.max(2, (value / total) * 100)}%`, backgroundColor: charts.chart1.colors?.[i] || COLORS.primary }]} />
                      </View>
                      <Text style={styles.barValue}>{value}</Text>
                    </View>
                  );
                })}
              </View>
            ) : (
              <Text style={styles.emptyText}>Chart data unavailable.</Text>
            )}
          </View>

          <View style={[styles.chartCard, SHADOWS.md]}>
            <View style={styles.chartHeader}>
              <Text style={styles.chartTitle}>Currently Present by Company</Text>
              <Text style={styles.chartSubtitle}>Real-time status</Text>
            </View>
            {charts?.chart3?.labels ? (
              <View style={styles.barList}>
                {charts.chart3.labels.slice(0, 6).map((label, i) => {
                  const total = (charts.chart3.data || []).reduce((a, b) => a + Number(b || 0), 0) || 1;
                  const value = Number(charts.chart3.data[i] || 0);
                  return (
                    <View key={String(label) + i} style={styles.barRow}>
                      <Text style={styles.barLabel} numberOfLines={1}>{String(label)}</Text>
                      <View style={styles.barTrack}>
                        <View style={[styles.barFill, { width: `${Math.max(2, (value / total) * 100)}%`, backgroundColor: charts.chart3.backgroundColor?.[i] || COLORS.primary }]} />
                      </View>
                      <Text style={styles.barValue}>{value}</Text>
                    </View>
                  );
                })}
              </View>
            ) : (
              <Text style={styles.emptyText}>Chart data unavailable.</Text>
            )}
          </View>
        </View>

        {/* Yesterday's Attendance - real chart4 from /api/hr/dashboard-charts */}
        <View style={[styles.chartCard, SHADOWS.md, styles.yesterdayCard]}>
          <View style={styles.chartHeader}>
            <Text style={styles.chartTitle}>Yesterday's Attendance</Text>
            <Text style={styles.chartSubtitle}>Present vs Absent vs On Leave</Text>
          </View>
          {charts?.chart4?.labels ? (
            <View style={styles.yesterdayRow}>
              {charts.chart4.labels.map((label, i) => {
                const value = Number(charts.chart4.data?.[i] || 0);
                const max = Math.max(...(charts.chart4.data || []).map((v) => Number(v || 0)), 1);
                return (
                  <View key={String(label) + i} style={styles.yesterdayItem}>
                    <View style={styles.yesterdayBarTrack}>
                      <View style={[
                        styles.yesterdayBar,
                        { height: `${Math.max(4, (value / max) * 100)}%`, backgroundColor: charts.chart4.colors?.[i] || COLORS.primary },
                      ]} />
                    </View>
                    <Text style={styles.yesterdayValue}>{value}</Text>
                    <Text style={styles.yesterdayLabel}>{String(label)}</Text>
                  </View>
                );
              })}
            </View>
          ) : (
            <Text style={styles.emptyText}>No data for yesterday.</Text>
          )}
        </View>

        <Button
          title="Employee Credential Management"
          onPress={openCredentialManagement}
          variant="primary"
          size="medium"
          leftIcon={<Text style={styles.credentialIcon}>🔑</Text>}
          style={styles.credentialButton}
        />

        {/* Live Biometric Status — one row per active employee (today's record) */}
        <View style={[styles.sectionCard, SHADOWS.md]}>
          <View style={styles.sectionHeader}>
            <Text style={styles.sectionTitle}>Live Biometric Status</Text>
            <Text style={styles.sectionSubtitle}>Real-time from Savior hardware</Text>
          </View>

          <View style={styles.bioTotalBar}>
            <Text style={styles.bioTotalText}>Total records: {bioTotal}</Text>
            <View style={styles.pageSizeRow}>
              {BIO_PAGE_SIZES.map((size) => (
                <TouchableOpacity
                  key={size}
                  style={[styles.sizeChip, bioPageSize === size && styles.sizeChipActive]}
                  onPress={() => { setBioPageSize(size); setBioPage(1); }}
                >
                  <Text style={[styles.sizeChipText, bioPageSize === size && styles.sizeChipTextActive]}>{size}</Text>
                </TouchableOpacity>
              ))}
            </View>
          </View>

          <TextInput
            style={styles.bioSearchInput}
            placeholder="Search employee name, paycode or card..."
            placeholderTextColor={COLORS.textTertiary}
            value={bioSearch}
            onChangeText={(t) => { setBioSearch(t); setBioPage(1); }}
          />

          <View style={styles.bioList}>
            <View style={styles.bioHeaderRow}>
              <Text style={[styles.bioHeadCell, styles.bioColId]}>ID</Text>
              <Text style={[styles.bioHeadCell, styles.bioColName]}>Name</Text>
              <Text style={[styles.bioHeadCell, styles.bioColDept]}>Dept</Text>
              <Text style={[styles.bioHeadCell, styles.bioColTime]}>In</Text>
              <Text style={[styles.bioHeadCell, styles.bioColTime]}>Out</Text>
              <Text style={[styles.bioHeadCell, styles.bioColStatus]}>Status</Text>
              <Text style={[styles.bioHeadCell, styles.bioColAction]}>View</Text>
            </View>

            {bioVisible.length === 0 ? (
              <View style={styles.emptyRow}>
                <Text style={styles.emptyText}>No employee found.</Text>
              </View>
            ) : null}

            {bioVisible.map((emp, index) => (
              <View key={emp.paycode + index} style={styles.bioRow}>
                <View style={styles.bioTopLine}>
                  <Text style={[styles.bioCell, styles.bioColId]} numberOfLines={1}>{emp.paycode}</Text>
                  <Text style={[styles.bioCell, styles.bioColName]} numberOfLines={1}>{emp.name}</Text>
                  <View style={[styles.bioStatusChip, { backgroundColor: emp.isLate || emp.status === 'Absent' ? `${COLORS.error}18` : `${COLORS.success}18` }]}>
                    <Text style={[styles.bioStatusText, { color: emp.isLate || emp.status === 'Absent' ? COLORS.error : COLORS.success }]} numberOfLines={1}>
                      {emp.status}
                    </Text>
                  </View>
                  <TouchableOpacity style={styles.bioViewButton} onPress={() => openBiometricDetail(emp)}>
                    <Text style={styles.bioViewText}>View</Text>
                  </TouchableOpacity>
                </View>
                <View style={styles.bioBottomLine}>
                  <Text style={[styles.bioMetaCell, styles.bioColDept]} numberOfLines={1}>{emp.dept || '—'}</Text>
                  <Text style={[styles.bioMetaCell, styles.bioColTime, hasPunchTime(emp.inTime) ? styles.bioInText : styles.bioTimePlaceholder]}>In: {emp.inTime}</Text>
                  <Text style={[styles.bioMetaCell, styles.bioColTime, hasPunchTime(emp.outTime) ? styles.bioOutText : styles.bioTimePlaceholder]}>Out: {emp.outTime}</Text>
                </View>
              </View>
            ))}
          </View>

          <View style={styles.paginationBar}>
            <TouchableOpacity
              style={[styles.pageButton, bioSafePage === 1 && styles.pageButtonDisabled]}
              disabled={bioSafePage === 1}
              onPress={() => setBioPage((p) => Math.max(1, p - 1))}
            >
              <Text style={styles.pageButtonText}>Previous</Text>
            </TouchableOpacity>
            <Text style={styles.pageInfo}>Page {bioSafePage} of {bioTotalPages}</Text>
            <TouchableOpacity
              style={[styles.pageButton, bioSafePage === bioTotalPages && styles.pageButtonDisabled]}
              disabled={bioSafePage === bioTotalPages}
              onPress={() => setBioPage((p) => Math.min(bioTotalPages, p + 1))}
            >
              <Text style={styles.pageButtonText}>Next</Text>
            </TouchableOpacity>
          </View>
        </View>


        {lastSync ? (
          <Text style={styles.syncNote}>
            Last synced: {lastSync.toLocaleTimeString('en-IN')}
          </Text>
        ) : null}
        </>
        ) : null}
      </ScrollView>

      {/* Late Today drill-down - real employees from /api/hr/late-employees */}
      {lateOpen ? (
        <View style={styles.modalBackdrop}>
          <View style={styles.modalCard}>
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>Late Today ({lateData.late})</Text>
              <TouchableOpacity onPress={() => setLateOpen(false)} hitSlop={{ top: 12, left: 12, bottom: 12, right: 12 }}>
                <Text style={styles.modalClose}>✕</Text>
              </TouchableOpacity>
            </View>

            <ScrollView style={styles.modalBody}>
              {lateLoading ? (
                <View style={styles.modalState}>
                  <ActivityIndicator color={COLORS.primary} />
                  <Text style={styles.stateText}>Loading late employees...</Text>
                </View>
              ) : null}

              {!lateLoading && lateError ? (
                <View style={styles.errorBox}>
                  <Text style={styles.errorText}>⚠️ {lateError}</Text>
                </View>
              ) : null}

              {!lateLoading && !lateError && lateData.employees.length === 0 ? (
                <Text style={styles.emptyText}>Aaj koi late employee nahi hai.</Text>
              ) : null}

              {!lateLoading && lateData.employees.map((emp) => (
                <View key={clean(emp.paycode)} style={styles.lateRow}>
                  <View style={styles.lateLine1}>
                    <Text style={styles.latePaycode}>{clean(emp.paycode)}</Text>
                    <Text style={styles.lateName}>{clean(emp.empname)}</Text>
                  </View>
                  <View style={styles.lateLine2}>
                    <Text style={styles.lateMeta}>{clean(emp.departmentname || emp.departmentcode) || '—'}</Text>
                    <Text style={[styles.lateMeta, hasPunchTime(emp.inTime) ? styles.lateInTime : styles.lateTimePlaceholder]}>In: {emp.inTime || '—'}</Text>
                    <Text style={[styles.lateMeta, hasPunchTime(emp.outTime) ? styles.lateOutTime : styles.lateTimePlaceholder]}>Out: {emp.outTime || '—'}</Text>
                    <Text style={styles.lateBadge}>
                      {Number(emp.latearrival || 0) > 0 ? `Late ${emp.latearrival} min` : (emp.statusLabel || 'Late')}
                    </Text>
                  </View>
                </View>
              ))}
            </ScrollView>
          </View>
        </View>
      ) : null}

      {/* Live Biometric row -> real employee attendance audit (/api/hr/audit/:paycode) */}
      {biDetail || biDetailLoading || biDetailError ? (
        <View style={styles.modalBackdrop}>
          <View style={styles.modalCard}>
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>Employee Attendance Audit</Text>
              <TouchableOpacity onPress={() => { setBiDetail(null); setBiDetailError(null); }} hitSlop={{ top: 12, left: 12, bottom: 12, right: 12 }}>
                <Text style={styles.modalClose}>✕</Text>
              </TouchableOpacity>
            </View>
            {/* Month-wise historical attendance for the same employee. */}
            <View style={styles.modalMonthBar}>
              <MonthNavigator month={biMonth} onChange={changeBiMonth} />
            </View>
            <ScrollView style={styles.modalBody}>
              {biDetailLoading ? (
                <View style={styles.modalState}>
                  <ActivityIndicator color={COLORS.primary} />
                  <Text style={styles.stateText}>Loading attendance audit...</Text>
                </View>
              ) : null}
              {!biDetailLoading && biDetailError ? (
                <View style={styles.errorBox}>
                  <Text style={styles.errorText}>⚠️ {biDetailError}</Text>
                </View>
              ) : null}

              {!biDetailLoading && biDetail?.employee ? (
                <View>
                  {/* Oldest -> newest within the selected month (display order only). */}
                  {(() => {
                    const biAuditAsc = ascendingByDate(biDetail.attendance);
                    return (
                      <>
                  <Text style={styles.auditName}>{clean(biDetail.employee.empname)}</Text>
                  <Text style={styles.auditMeta}>
                    Paycode: {clean(biDetail.employee.paycode)} • Card: {clean(biDetail.employee.presentcardno)}
                  </Text>
                  <Text style={styles.auditMeta}>
                    {clean(biDetail.employee.departmentname || biDetail.employee.departmentcode)} • {clean(biDetail.employee.designation)}
                  </Text>
                  <Text style={styles.auditMeta}>Company: {clean(biDetail.employee.companyname || biDetail.employee.companycode)}</Text>

                  <View style={styles.auditStatsRow}>
                    {[
                      { label: 'Present', value: biDetail.stats?.present, color: COLORS.success },
                      { label: 'Absent', value: biDetail.stats?.absent, color: COLORS.error },
                      { label: 'Miss Punch', value: biDetail.stats?.miss, color: COLORS.warning },
                      { label: 'Late', value: biDetail.stats?.late, color: COLORS.error },
                      { label: 'Hours', value: biDetail.stats?.hours, color: COLORS.primary },
                    ].map((s) => (
                      <View key={s.label} style={styles.auditStat}>
                        <Text style={[styles.auditStatValue, { color: s.color }]}>{Number(s.value || 0)}</Text>
                        <Text style={styles.auditStatLabel}>{s.label}</Text>
                      </View>
                    ))}
                  </View>

                  {biDetail.graceRemaining ? (
                    <Text style={styles.auditMeta}>
                      Monthly grace — 30 min: {Number(biDetail.graceRemaining.grace30min || 0)} • 1 hr: {Number(biDetail.graceRemaining.grace1hr || 0)} • 2 hr: {Number(biDetail.graceRemaining.grace2hr || 0)}
                    </Text>
                  ) : null}

                  {Array.isArray(biDetail.lateDetails) && biDetail.lateDetails.length > 0 ? (
                    <Text style={styles.auditSectionTitle}>Late Arrival Details</Text>
                  ) : null}
                  {Array.isArray(biDetail.lateDetails) ? biDetail.lateDetails.map((l, i) => (
                    <Text key={`late-${i}`} style={styles.auditRow}>
                      {String(l.date || '').slice(0, 10)} • late {Number(l.lateMinutes || 0)} min{l.graceUsed ? ` • grace ${l.graceUsed} min` : ''}
                    </Text>
                  )) : null}

                  <Text style={styles.auditSectionTitle}>Attendance Details ({Array.isArray(biDetail.attendance) ? biDetail.attendance.length : 0} records)</Text>
                  {Array.isArray(biAuditAsc) ? biAuditAsc.map((a, i) => {
                    // PHASE G.2 overlay: applicable ACTIVE holiday wins for display.
                    const holLabel = biHolidayLabelFor(a.date);
                    const label = holLabel || a.statusLabel || a.computedStatus || '';
                    const holColor = holLabel ? HOLIDAY_PURPLE : null;
                    return (
                      <View key={`att-${i}`} style={styles.auditAttRow}>
                        <Text style={styles.auditAttDate}>{String(a.date || '').slice(0, 10)} {dayName(a.date)}</Text>
                        <Text style={[styles.auditAttCell, hasPunchTime(a.inTime) ? styles.auditAttIn : styles.auditAttTimeNone]}>In: {a.inTime || '—'}</Text>
                        <Text style={[styles.auditAttCell, hasPunchTime(a.outTime) ? styles.auditAttOut : styles.auditAttTimeNone]}>Out: {a.outTime || '—'}</Text>
                        <Text style={styles.auditAttCell}>Hrs: {Number(a.hoursworked || 0)}</Text>
                        <Text style={[styles.auditAttStatus, { color: holColor || getStatusColor(a.statusCode || label) }]}>
                          {label || '—'}
                        </Text>
                      </View>
                    );
                  }) : null}
                  {/* PHASE G.2: holiday dates with no Savior row still show Holiday. */}
                  {[...biHolidayByDate.entries()]
                    .filter(([key]) => !(Array.isArray(biAuditAsc) ? biAuditAsc : []).some((a) => clean(a.date || '').slice(0, 10) === key))
                    .sort(([a], [b]) => (a < b ? -1 : 1))
                    .map(([key]) => (
                      <View key={`hol-${key}`} style={styles.auditAttRow}>
                        <Text style={styles.auditAttDate}>{key} {dayName(key)}</Text>
                        <Text style={[styles.auditAttCell, styles.auditAttTimeNone]}>In: —</Text>
                        <Text style={[styles.auditAttCell, styles.auditAttTimeNone]}>Out: —</Text>
                        <Text style={styles.auditAttCell}>Hrs: 0</Text>
                        <Text style={[styles.auditAttStatus, { color: HOLIDAY_PURPLE }]}>
                          {biHolidayLabelFor(key) || 'Holiday'}
                        </Text>
                      </View>
                    ))}
                  {Array.isArray(biDetail.attendance) && biDetail.attendance.length === 0 ? (
                    <Text style={styles.auditRow}>No attendance records for this period.</Text>
                  ) : null}
                      </>
                    );
                  })()}
                </View>
              ) : null}
            </ScrollView>
          </View>
        </View>
      ) : null}
    </ScreenContainer>
  );
};

const styles = StyleSheet.create({
  // Executive Overview employee list
  empListCard: { marginTop: SPACING.md },
  empSearchInput: {
    backgroundColor: COLORS.surfaceVariant,
    borderWidth: 1,
    borderColor: COLORS.border,
    borderRadius: 10,
    paddingHorizontal: SPACING.md,
    paddingVertical: SPACING.sm,
    color: COLORS.textPrimary,
    marginBottom: SPACING.sm,
  },
  empRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: SPACING.sm,
    paddingVertical: SPACING.sm,
    borderBottomWidth: 1,
    borderBottomColor: COLORS.divider,
  },
  empRowText: { flex: 1, minWidth: 0 },
  empName: { fontSize: 13, fontWeight: '600', color: COLORS.textPrimary },
  empMeta: { fontSize: 10, color: COLORS.textSecondary },
  empViewButton: {
    paddingHorizontal: 12,
    paddingVertical: 4,
    borderRadius: 12,
    backgroundColor: COLORS.primary + '15',
  },
  empViewText: { fontSize: 11, fontWeight: '700', color: COLORS.primary },
  empMoreText: { fontSize: 10, color: COLORS.textTertiary, marginTop: 8, textAlign: 'center' },

  // Yesterday's Attendance chart
  yesterdayCard: { marginTop: SPACING.md, marginBottom: SPACING.xs },
  yesterdayRow: { flexDirection: 'row', alignItems: 'flex-end', height: 132, gap: SPACING.md },
  yesterdayItem: { flex: 1, alignItems: 'center', justifyContent: 'flex-end', height: '100%' },
  yesterdayBarTrack: { flex: 1, width: '60%', justifyContent: 'flex-end', backgroundColor: COLORS.surfaceVariant, borderRadius: 6, overflow: 'hidden' },
  yesterdayBar: { width: '100%', borderRadius: 6 },
  yesterdayValue: { fontSize: 13, fontWeight: '700', color: COLORS.textPrimary, marginTop: 6 },
  yesterdayLabel: { fontSize: 10, color: COLORS.textSecondary, marginTop: 2, textAlign: 'center' },

  // Employee detail modal
  detailGrid: { gap: 6 },
  detailLine: { fontSize: 12, color: COLORS.textSecondary },

  // Employee attendance audit modal
  auditName: { fontSize: 15, fontWeight: '700', color: COLORS.textPrimary, marginBottom: 2 },
  auditMeta: { fontSize: 11, color: COLORS.textSecondary, marginBottom: 2 },
  auditStatsRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginVertical: 10 },
  auditStat: { minWidth: 56, alignItems: 'center', paddingVertical: 6, paddingHorizontal: 8, borderRadius: 8, backgroundColor: COLORS.surfaceVariant },
  auditStatValue: { fontSize: 14, fontWeight: '700' },
  auditStatLabel: { fontSize: 9, color: COLORS.textSecondary },
  auditSectionTitle: { fontSize: 12, fontWeight: '700', color: COLORS.textPrimary, marginTop: 10, marginBottom: 4 },
  auditRow: { fontSize: 11, color: COLORS.textSecondary, paddingVertical: 2 },
  auditAttRow: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingVertical: 3, borderBottomWidth: 1, borderBottomColor: COLORS.divider },
  auditAttDate: { width: 74, fontSize: 10, color: COLORS.textSecondary },
  auditAttCell: { fontSize: 10, color: COLORS.textPrimary },
  // IN dark green, OUT dark red; a missing punch stays neutral.
  auditAttIn: { color: '#166534', fontWeight: '700' },
  auditAttOut: { color: '#991B1B', fontWeight: '700' },
  auditAttTimeNone: { color: COLORS.textTertiary },
  modalMonthBar: { paddingHorizontal: SPACING.md, paddingTop: SPACING.sm },
  auditAttStatus: { fontSize: 10, fontWeight: '700', marginLeft: 'auto' },

  // Late Today modal
  modalBackdrop: {
    position: 'absolute',
    top: 0, left: 0, right: 0, bottom: 0,
    backgroundColor: COLORS.overlay,
    justifyContent: 'center',
    padding: SPACING.lg,
  },
  modalCard: {
    backgroundColor: COLORS.surface,
    borderRadius: 16,
    maxHeight: '80%',
    overflow: 'hidden',
  },
  modalHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: SPACING.md,
    borderBottomWidth: 1,
    borderBottomColor: COLORS.border,
  },
  modalTitle: { fontSize: 15, fontWeight: '700', color: COLORS.textPrimary },
  modalClose: { fontSize: 18, color: COLORS.textSecondary, fontWeight: '700' },
  modalBody: { padding: SPACING.md, maxHeight: 420 },
  modalState: { alignItems: 'center', paddingVertical: SPACING.lg, gap: 8 },
  lateRow: {
    paddingVertical: SPACING.sm,
    borderBottomWidth: 1,
    borderBottomColor: COLORS.divider,
    gap: 2,
  },
  lateLine1: { flexDirection: 'row', alignItems: 'center', gap: SPACING.sm },
  latePaycode: { fontSize: 12, fontWeight: '700', color: COLORS.textPrimary, width: 64 },
  lateName: { flex: 1, fontSize: 13, fontWeight: '600', color: COLORS.textPrimary },
  lateLine2: { flexDirection: 'row', alignItems: 'center', gap: SPACING.sm, paddingLeft: 72 },
  lateMeta: { fontSize: 11, color: COLORS.textSecondary },
  // Late Today drill-down: IN dark green, OUT dark red (a missing punch stays neutral).
  lateInTime: { color: '#166534', fontWeight: '700' },
  lateOutTime: { color: '#991B1B', fontWeight: '700' },
  lateTimePlaceholder: { color: COLORS.textTertiary },
  lateBadge: { marginLeft: 'auto', fontSize: 10, fontWeight: '700', color: COLORS.error },

  // Live biometric table (two-line rows for narrow screens)
  bioList: { gap: 6 },
  bioHeaderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 4,
    paddingBottom: 4,
  },
  bioHeadCell: { fontSize: 10, fontWeight: '700', color: COLORS.textSecondary, textTransform: 'uppercase' },
  bioColId: { width: 62 },
  bioColName: { flex: 1 },
  bioColDept: { width: 74 },
  bioColTime: { width: 78 },
  bioColStatus: { width: 86 },
  bioColAction: { width: 46, textAlign: 'right' },
  bioRow: {
    borderWidth: 1,
    borderColor: COLORS.border,
    borderRadius: 10,
    paddingHorizontal: SPACING.sm,
    paddingVertical: SPACING.sm,
    backgroundColor: COLORS.surface,
    gap: 4,
  },
  bioTopLine: { flexDirection: 'row', alignItems: 'center', gap: SPACING.sm },
  bioBottomLine: { flexDirection: 'row', alignItems: 'center', gap: SPACING.sm, paddingLeft: 62 },
  bioCell: { fontSize: 12, color: COLORS.textPrimary },
  bioMetaCell: { fontSize: 11, color: COLORS.textSecondary },
  // IN = dark green, OUT = dark red; a missing punch stays neutral.
  bioInText: { color: '#166534', fontWeight: '700' },
  bioOutText: { color: '#991B1B', fontWeight: '700' },
  bioTimePlaceholder: { color: COLORS.textTertiary, fontWeight: '400' },
  bioStatusChip: { paddingHorizontal: 8, paddingVertical: 3, borderRadius: 10, maxWidth: 86 },
  bioStatusText: { fontSize: 10, fontWeight: '700' },
  bioViewButton: {
    width: 46,
    alignItems: 'flex-end',
    paddingVertical: 3,
    paddingHorizontal: 8,
    borderRadius: 10,
    backgroundColor: COLORS.primary + '15',
  },
  bioViewText: { fontSize: 10, fontWeight: '700', color: COLORS.primary },
  bioTotalBar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 10,
  },
  bioTotalText: { fontSize: 12, fontWeight: '700', color: COLORS.textPrimary },
  bioSearchInput: {
    backgroundColor: COLORS.surfaceVariant,
    borderWidth: 1,
    borderColor: COLORS.border,
    borderRadius: 10,
    paddingHorizontal: SPACING.md,
    paddingVertical: SPACING.sm,
    color: COLORS.textPrimary,
    marginBottom: 8,
  },
  pageSizeRow: { flexDirection: 'row', gap: 6 },
  sizeChip: {
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: COLORS.border,
    backgroundColor: COLORS.surfaceVariant,
  },
  sizeChipActive: { backgroundColor: COLORS.primary, borderColor: COLORS.primary },
  sizeChipText: { fontSize: 11, color: COLORS.textSecondary, fontWeight: '600' },
  sizeChipTextActive: { color: '#FFFFFF' },
  paginationBar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginTop: 10,
  },
  pageButton: {
    paddingHorizontal: 14,
    paddingVertical: 6,
    backgroundColor: COLORS.primary,
    borderRadius: 8,
  },
  pageButtonDisabled: { backgroundColor: COLORS.border },
  pageButtonText: { color: '#FFFFFF', fontSize: 12, fontWeight: '600' },
  pageInfo: { fontSize: 12, fontWeight: '600', color: COLORS.textPrimary },
  stateBox: {
    alignItems: 'center',
    paddingVertical: 40,
    gap: 12,
  },
  stateText: {
    color: COLORS.textSecondary,
    fontSize: 13,
  },
  errorBox: {
    backgroundColor: COLORS.error + '15',
    borderWidth: 1,
    borderColor: COLORS.error + '30',
    borderRadius: 12,
    padding: SPACING.lg,
    alignItems: 'center',
    marginBottom: SPACING.lg,
  },
  errorText: {
    color: COLORS.error,
    fontSize: 12,
    textAlign: 'center',
    marginBottom: 10,
  },
  retryButton: {
    alignSelf: 'center',
  },
  emptyText: {
    color: COLORS.textTertiary,
    fontSize: 12,
    paddingVertical: 8,
  },
  emptyRow: {
    padding: SPACING.md,
  },
  barList: {
    gap: 6,
  },
  barRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  barLabel: {
    width: 70,
    fontSize: 10,
    color: COLORS.textSecondary,
  },
  barTrack: {
    flex: 1,
    height: 8,
    borderRadius: 4,
    backgroundColor: COLORS.surfaceVariant,
    overflow: 'hidden',
  },
  barFill: {
    height: '100%',
    borderRadius: 4,
  },
  barValue: {
    width: 28,
    textAlign: 'right',
    fontSize: 10,
    fontWeight: '700',
    color: COLORS.textPrimary,
  },
  syncNote: {
    textAlign: 'center',
    fontSize: 10,
    color: COLORS.textTertiary,
    marginTop: 8,
  },
  credentialButton: {
    alignSelf: 'stretch',
    marginTop: SPACING.md,
    marginBottom: SPACING.md,
    borderRadius: 14,
  },
  credentialIcon: {
    fontSize: 15,
  },
  scrollContent: {
    paddingHorizontal: SPACING.lg,
    paddingBottom: SPACING.xxl,
  },
  notificationBar: {
    backgroundColor: COLORS.primary + '10',
    borderWidth: 1,
    borderColor: COLORS.primary + '30',
    borderRadius: 16,
    padding: SPACING.lg,
    marginBottom: SPACING.lg,
    ...SHADOWS.sm,
  },
  notificationHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: SPACING.md,
  },
  notificationIcon: {
    fontSize: 20,
    marginRight: SPACING.sm,
  },
  notificationTitle: {
    fontWeight: '700',
    fontSize: 16,
    color: COLORS.textPrimary,
  },
  viewAllLink: {
    paddingHorizontal: SPACING.md,
    paddingVertical: SPACING.xs,
    backgroundColor: COLORS.primary + '15',
    borderRadius: 20,
  },
  viewAllText: {
    color: COLORS.primary,
    fontWeight: '600',
    fontSize: 12,
  },
  celebrationList: {
    gap: SPACING.sm,
  },
  celebrationItem: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: SPACING.sm,
    paddingHorizontal: SPACING.md,
    backgroundColor: COLORS.surface,
    borderRadius: 8,
  },
  celebrationIcon: {
    fontSize: 20,
    marginRight: SPACING.md,
  },
  celebrationName: {
    fontWeight: '600',
    color: COLORS.textPrimary,
  },
  celebrationDept: {
    fontSize: 12,
    color: COLORS.textTertiary,
  },
  statsGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'space-between',
    marginBottom: SPACING.lg,
    gap: SPACING.md,
  },
  chartsRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'space-between',
    marginBottom: SPACING.lg,
    gap: SPACING.md,
  },
  chartCard: {
    flex: 1,
    minWidth: '48%',
    backgroundColor: COLORS.surface,
    borderRadius: 16,
    padding: SPACING.lg,
    borderWidth: 1,
    borderColor: COLORS.divider,
  },
  chartHeader: {
    marginBottom: SPACING.lg,
  },
  chartTitle: {
    fontWeight: '600',
    color: COLORS.textPrimary,
    marginBottom: SPACING.xs,
  },
  chartSubtitle: {
    fontSize: 12,
    color: COLORS.textTertiary,
  },
  chartPlaceholder: {
    aspectRatio: 1,
    backgroundColor: COLORS.surfaceVariant,
    borderRadius: 12,
    justifyContent: 'center',
    alignItems: 'center',
  },
  chartPlaceholderText: {
    fontSize: 24,
    marginBottom: SPACING.xs,
  },
  chartPlaceholderSub: {
    fontSize: 11,
    color: COLORS.textTertiary,
    textAlign: 'center',
  },
  sectionCard: {
    backgroundColor: COLORS.surface,
    borderRadius: 16,
    padding: SPACING.lg,
    marginBottom: SPACING.lg,
    borderWidth: 1,
    borderColor: COLORS.divider,
    ...SHADOWS.sm,
  },
  sectionHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-end',
    marginBottom: SPACING.lg,
  },
  sectionTitle: {
    fontWeight: '600',
    color: COLORS.textPrimary,
  },
  sectionSubtitle: {
    fontSize: 12,
    color: COLORS.textTertiary,
  },
  tableContainer: {
    borderRadius: 12,
    overflow: 'hidden',
    borderWidth: 1,
    borderColor: COLORS.divider,
  },
  tableHeader: {
    flexDirection: 'row',
    backgroundColor: COLORS.surfaceVariant,
    paddingVertical: SPACING.md,
    paddingHorizontal: SPACING.md,
  },
  tableRow: {
    flexDirection: 'row',
    backgroundColor: COLORS.surface,
    paddingVertical: SPACING.md,
    paddingHorizontal: SPACING.md,
    borderBottomWidth: 1,
    borderBottomColor: COLORS.divider,
  },
  tableCell: {
    flex: 1,
    fontSize: 12,
    color: COLORS.textPrimary,
  },
  auditButton: {
    paddingHorizontal: SPACING.md,
    paddingVertical: SPACING.xs,
    backgroundColor: COLORS.primary + '15',
    borderRadius: 20,
  },
  auditButtonText: {
    color: COLORS.primary,
    fontWeight: '600',
    fontSize: 11,
  },
  phaseNotice: {
    backgroundColor: COLORS.info + '15',
    borderWidth: 1,
    borderColor: COLORS.info + '30',
    borderRadius: 12,
    padding: SPACING.md,
    marginTop: SPACING.lg,
  },
  phaseNoticeText: {
    color: COLORS.info,
    textAlign: 'center',
  },
});
