// ============================================================================
// FILE: mobile/src/screens/hr/HRCelebrationsScreen.jsx
// PURPOSE: HR Birthdays & Anniversaries - real birthday + work-anniversary lists
// ============================================================================

/**
 * Mobile Birthdays & Anniversaries — website-matched logic, phone-friendly UI.
 *
 * Navigation Flow:
 * HRNavigator (Birthdays Tab) -> HRCelebrationsScreen
 *
 * Data Flow (existing endpoints only, no new business logic):
 * GET /api/employees?active=Y (paged)  -> real dbo.tblemployee employee master
 * GET /api/hr/filters                   -> dbo.tbldepartment code -> name map
 *
 * Data sources (exactly the website's):
 *   Birthday            -> dbo.tblemployee.dateofbirth
 *   Work Anniversary    -> dbo.tblemployee.dateofjoin
 *   Employee identity   -> dbo.tblemployee.paycode
 *
 * All date maths mirrors index.html so both surfaces always agree:
 *   daysUntilMonthDay() - next occurrence of a DAY+MONTH, rolling into next year
 *                         when the date has already passed (correct across Dec->Jan).
 *   ageFrom() / yearsCompleted() - whole years, decremented until the month+day
 *                                  has been reached.
 *   nextDateOf()        - the actual upcoming date for that DAY+MONTH.
 *
 * Windows are the website's, unchanged:
 *   Today's Birthdays   -> DAY(dateofbirth)  + MONTH(dateofbirth) == today
 *   Upcoming Birthdays  -> 0 < daysUntil(dateofbirth)  <= 30
 *   Today's Anniversary -> DAY(dateofjoin)   + MONTH(dateofjoin)  == today
 *   Upcoming Anniversary-> 0 < daysUntil(dateofjoin)   <= 45
 *
 * Birth year never affects birthday matching (day+month only), as required.
 * Employee population = active employees, the same /employees?active=Y roster the
 * Executive Overview and website celebrations widgets use.
 */

import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { View, Text, ScrollView, StyleSheet, TouchableOpacity, RefreshControl, ActivityIndicator } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { COLORS, SPACING, SHADOWS } from '../../utils/colors';
import { ScreenContainer } from '../../components/ScreenContainer';
import { Button } from '../../components/Button';
import { api } from '../../services/api';

// Website-equivalent windows (index.html renderCelebrationsPage).
const UPCOMING_BIRTHDAY_DAYS = 30;
const UPCOMING_ANNIVERSARY_DAYS = 45;

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

const clean = (v) => String(v == null ? '' : v).trim();
const PLACEHOLDER = '—';

const parseDateOnly = (v) => {
  const s = clean(v).slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return null;
  const d = new Date(`${s}T00:00:00`);
  return Number.isNaN(d.getTime()) ? null : d;
};

const startOfToday = () => {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d;
};

const iso = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

const pretty = (v) => {
  const d = parseDateOnly(v);
  return d ? `${String(d.getDate()).padStart(2, '0')}-${MONTHS[d.getMonth()]}-${d.getFullYear()}` : '—';
};

/**
 * Website port of index.html daysUntilMonthDay().
 * 0 when the DAY+MONTH is today; rolls to next year when already passed.
 */
const daysUntilMonthDay = (dateStr) => {
  const src = parseDateOnly(dateStr);
  if (!src) return null;
  const now = startOfToday();
  let next = new Date(now.getFullYear(), src.getMonth(), src.getDate());
  if (next < now) next = new Date(now.getFullYear() + 1, src.getMonth(), src.getDate());
  return Math.round((next - now) / 86400000);
};

/** Website port of index.html nextDateOf(). */
const nextDateOf = (dateStr) => {
  const src = parseDateOnly(dateStr);
  if (!src) return null;
  const now = startOfToday();
  let next = new Date(now.getFullYear(), src.getMonth(), src.getDate());
  if (next < now) next = new Date(now.getFullYear() + 1, src.getMonth(), src.getDate());
  return iso(next);
};

/** Website port of index.html ageFrom() / yearsCompleted() (identical formula). */
const yearsSince = (dateStr) => {
  const d = parseDateOnly(dateStr);
  if (!d) return null;
  const n = new Date();
  let y = n.getFullYear() - d.getFullYear();
  const m = n.getMonth() - d.getMonth();
  if (m < 0 || (m === 0 && n.getDate() < d.getDate())) y -= 1;
  return y;
};

/** DAY + MONTH match against today (year independent). */
const isTodayMonthDay = (dateStr) => {
  const d = parseDateOnly(dateStr);
  if (!d) return false;
  const n = new Date();
  return d.getDate() === n.getDate() && d.getMonth() === n.getMonth();
};

/**
 * HR Birthdays & Anniversaries Screen Component
 */
export const HRCelebrationsScreen = () => {
  const [employees, setEmployees] = useState([]);
  const [deptNames, setDeptNames] = useState({});
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState(null);

  // Real department name map — same /hr/filters lookup used elsewhere in the app.
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
      .catch(() => { /* falls back to code, same as the website */ });
    return () => { active = false; };
  }, []);

  const load = useCallback(async (isRefresh) => {
    if (isRefresh) setRefreshing(true); else setLoading(true);
    setError(null);
    try {
      // Same roster source + paging shape as All Employees / Executive Overview.
      const rows = [];
      for (let p = 1; p <= 20; p += 1) {
        const data = await api.get('/employees', { page: p, pageSize: 100, active: 'Y' });
        const batch = Array.isArray(data?.rows) ? data.rows : [];
        rows.push(...batch);
        if (batch.length < 100) break;
      }
      setEmployees(rows);
    } catch (err) {
      setEmployees([]);
      setError('Unable to load celebration data.');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => { load(false); }, [load]);

  const groups = useMemo(() => {
    const birthdaysToday = [];
    const birthdaysUpcoming = [];
    const annivToday = [];
    const annivUpcoming = [];

    employees.forEach((e) => {
      const dept = deptNames[clean(e.departmentcode)] || clean(e.departmentcode) || PLACEHOLDER;
      const base = {
        paycode: clean(e.paycode),
        name: clean(e.empname),
        dept,
        designation: clean(e.designation) || PLACEHOLDER,
      };
      if (!base.paycode || !base.name) return;

      if (clean(e.dateofbirth)) {
        const days = daysUntilMonthDay(e.dateofbirth);
        const item = { ...base, dob: clean(e.dateofbirth), age: yearsSince(e.dateofbirth), days, next: nextDateOf(e.dateofbirth) };
        if (isTodayMonthDay(e.dateofbirth)) birthdaysToday.push(item);
        else if (days !== null && days > 0 && days <= UPCOMING_BIRTHDAY_DAYS) birthdaysUpcoming.push(item);
      }

      if (clean(e.dateofjoin)) {
        const days = daysUntilMonthDay(e.dateofjoin);
        const item = { ...base, join: clean(e.dateofjoin), years: yearsSince(e.dateofjoin), days, next: nextDateOf(e.dateofjoin) };
        if (isTodayMonthDay(e.dateofjoin)) annivToday.push(item);
        else if (days !== null && days > 0 && days <= UPCOMING_ANNIVERSARY_DAYS) annivUpcoming.push(item);
      }
    });

    const byName = (a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: 'base' });
    const byDays = (a, b) => a.days - b.days || byName(a, b);
    return {
      birthdaysToday: birthdaysToday.sort(byName),
      birthdaysUpcoming: birthdaysUpcoming.sort(byDays),
      annivToday: annivToday.sort(byName),
      annivUpcoming: annivUpcoming.sort(byDays),
    };
  }, [employees, deptNames]);

  const Section = ({ title, icon, tone, tint, count, emptyText, children }) => (
    <View style={styles.section}>
      <View style={[styles.sectionHeader, { backgroundColor: `${tint}14`, borderColor: `${tint}33` }]}>
        <Text style={styles.sectionIcon}>{icon}</Text>
        <Text style={[styles.sectionTitle, { color: tone }]}>{title}</Text>
        <View style={[styles.sectionCount, { backgroundColor: tint }]}>
          <Text style={styles.sectionCountText}>{count}</Text>
        </View>
      </View>
      {children.length === 0
        ? <Text style={styles.emptyText}>{emptyText}</Text>
        : children}
    </View>
  );

  const PersonCard = ({ item, kind }) => {
    const tint = kind === 'birthday' ? '#DB2777' : '#D97706';
    const tone = kind === 'birthday' ? '#A855F7' : '#F59E0B';
    return (
      <View style={[styles.personCard, { borderLeftColor: tint }, SHADOWS.sm]}>
        <View style={styles.personTop}>
          <View style={styles.personIdWrap}>
            <Text style={styles.personId}>{item.paycode}</Text>
          </View>
          <Text style={styles.personName} numberOfLines={1}>{item.name}</Text>
        </View>
        <Text style={styles.personMeta} numberOfLines={1}>{item.dept}</Text>
        <Text style={styles.personMeta} numberOfLines={1}>{item.designation}</Text>

        <View style={styles.personStats}>
          {kind === 'birthday' ? (
            <>
              <View style={styles.stat}>
                <Text style={styles.statLabel}>DOB</Text>
                <Text style={[styles.statValue, { color: tint }]}>{pretty(item.dob)}</Text>
              </View>
              <View style={styles.stat}>
                <Text style={styles.statLabel}>AGE</Text>
                <Text style={[styles.statValue, { color: tone }]}>{item.age === null ? PLACEHOLDER : `${item.age} yrs`}</Text>
              </View>
            </>
          ) : (
            <>
              <View style={styles.stat}>
                <Text style={styles.statLabel}>JOINED</Text>
                <Text style={[styles.statValue, { color: tint }]}>{pretty(item.join)}</Text>
              </View>
              <View style={styles.stat}>
                <Text style={styles.statLabel}>YEARS</Text>
                <Text style={[styles.statValue, { color: tone }]}>{item.years === null ? PLACEHOLDER : `${item.years} yrs`}</Text>
              </View>
            </>
          )}
        </View>

        {item.next ? (
          <Text style={styles.personFoot}>
            Next: {pretty(item.next)} · in {item.days} day{item.days === 1 ? '' : 's'}
            {kind === 'birthday' && item.age !== null ? ` · turning ${item.age + 1}` : ''}
            {kind === 'anniversary' && item.years !== null ? ` · completing ${item.years + 1}` : ''}
          </Text>
        ) : null}
      </View>
    );
  };

  const loadingView = (
    <View style={styles.stateBox}>
      <ActivityIndicator size="large" color={COLORS.primary} />
      <Text style={styles.stateText}>Loading celebrations from Savior...</Text>
    </View>
  );

  return (
    <ScreenContainer title="Birthdays & Anniversaries" showHeader={true}>
      <ScrollView
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => load(true)} colors={[COLORS.primary]} />}
        contentContainerStyle={styles.scrollContent}
      >
        <Text style={styles.subtitle}>Real employee master data (dbo.tblemployee)</Text>

        {loading ? loadingView : null}

        {!loading && error ? (
          <View style={styles.errorBox}>
            <Text style={styles.errorText}>⚠️ {error}</Text>
            <Button title="Retry" onPress={() => load(false)} variant="outline" size="small" style={styles.retryButton} />
          </View>
        ) : null}

        {!loading && !error ? (
          <>
            <Section
              title="Today's Birthdays" icon="🎂" tone="#A855F7" tint="#DB2777"
              count={groups.birthdaysToday.length}
              emptyText="Aaj koi birthday nahi hai."
            >
              {groups.birthdaysToday.map((i) => <PersonCard key={i.paycode} item={i} kind="birthday" />)}
            </Section>

            <Section
              title={`Upcoming Birthdays (${UPCOMING_BIRTHDAY_DAYS} days)`} icon="🎉" tone="#A855F7" tint="#DB2777"
              count={groups.birthdaysUpcoming.length}
              emptyText={`Next ${UPCOMING_BIRTHDAY_DAYS} days me koi birthday nahi.`}
            >
              {groups.birthdaysUpcoming.map((i) => <PersonCard key={i.paycode} item={i} kind="birthday" />)}
            </Section>

            <Section
              title="Today's Work Anniversaries" icon="🏆" tone="#F59E0B" tint="#D97706"
              count={groups.annivToday.length}
              emptyText="Aaj koi work anniversary nahi hai."
            >
              {groups.annivToday.map((i) => <PersonCard key={i.paycode} item={i} kind="anniversary" />)}
            </Section>

            <Section
              title={`Upcoming Work Anniversaries (${UPCOMING_ANNIVERSARY_DAYS} days)`} icon="📅" tone="#F59E0B" tint="#D97706"
              count={groups.annivUpcoming.length}
              emptyText={`Next ${UPCOMING_ANNIVERSARY_DAYS} days me koi work anniversary nahi.`}
            >
              {groups.annivUpcoming.map((i) => <PersonCard key={i.paycode} item={i} kind="anniversary" />)}
            </Section>
          </>
        ) : null}
      </ScrollView>
    </ScreenContainer>
  );
};

const styles = StyleSheet.create({
  scrollContent: { padding: SPACING.lg, paddingBottom: SPACING.xxl },
  subtitle: { fontSize: 12, color: COLORS.textTertiary, marginBottom: SPACING.md },
  stateBox: { paddingVertical: SPACING.xxl, alignItems: 'center', gap: SPACING.sm },
  stateText: { color: COLORS.textSecondary, fontSize: 13 },
  errorBox: {
    backgroundColor: `${COLORS.error}12`,
    borderWidth: 1,
    borderColor: `${COLORS.error}33`,
    borderRadius: 12,
    padding: SPACING.md,
    gap: SPACING.sm,
  },
  errorText: { color: COLORS.error, fontSize: 12 },
  retryButton: { alignSelf: 'flex-start' },
  section: { marginBottom: SPACING.lg },
  sectionHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: SPACING.sm,
    paddingHorizontal: SPACING.md,
    paddingVertical: SPACING.sm,
    borderRadius: 12,
    borderWidth: 1,
    marginBottom: SPACING.sm,
  },
  sectionIcon: { fontSize: 15 },
  sectionTitle: { flex: 1, fontSize: 12.5, fontWeight: '800' },
  sectionCount: {
    minWidth: 24,
    paddingHorizontal: 7,
    paddingVertical: 2,
    borderRadius: 999,
    alignItems: 'center',
  },
  sectionCountText: { color: '#FFFFFF', fontSize: 11, fontWeight: '800' },
  emptyText: {
    color: COLORS.textTertiary,
    fontSize: 12,
    paddingVertical: SPACING.md,
    textAlign: 'center',
  },
  personCard: {
    backgroundColor: COLORS.surface,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: COLORS.divider,
    borderLeftWidth: 4,
    padding: SPACING.md,
    marginBottom: SPACING.sm,
  },
  personTop: { flexDirection: 'row', alignItems: 'center', gap: SPACING.sm },
  personIdWrap: {
    backgroundColor: COLORS.surfaceVariant,
    paddingHorizontal: 7,
    paddingVertical: 2,
    borderRadius: 6,
  },
  personId: { fontSize: 10.5, fontWeight: '800', color: COLORS.textSecondary },
  personName: { flex: 1, fontSize: 13.5, fontWeight: '700', color: COLORS.textPrimary },
  personMeta: { fontSize: 11, color: COLORS.textTertiary, marginTop: 2 },
  personStats: { flexDirection: 'row', marginTop: SPACING.sm, gap: SPACING.lg },
  stat: {},
  statLabel: { fontSize: 9, fontWeight: '800', color: COLORS.textTertiary, letterSpacing: 0.5 },
  statValue: { fontSize: 12.5, fontWeight: '800', marginTop: 1 },
  personFoot: { fontSize: 10.5, color: COLORS.textSecondary, marginTop: SPACING.sm },
});
