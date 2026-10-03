// ============================================================================
// FILE: mobile/src/screens/employee/EmployeeBdayAnniversaryScreen.jsx
// PURPOSE: Organisation-wide Birthday & Anniversary celebrations
// ============================================================================

/**
 * Ye screen poori organization ke celebrations dikhati hai - logged-in employee
 * ke apne celebration NAHI (server par hi exclude hote hain).
 *
 * Navigation Flow:
 * EmployeeNavigator (Bday Tab) -> EmployeeBdayAnniversaryScreen
 *
 * Data Flow:
 * Employee Login -> JWT -> GET /api/employee/celebrations
 *
 * Identity & exclusion:
 * The client NEVER sends a paycode. The backend resolves the employee from the
 * verified JWT and excludes them SERVER-SIDE (`paycode <> @self`), so an employee
 * can never appear in their own organisation list.
 *
 * Sources (all existing, read-only):
 *   Birthday          -> dbo.tblemployee.dateofbirth
 *   Work Anniversary  -> dbo.tblemployee.dateofjoin
 *   Marriage          -> dbo.HR_MarriageAnniversary (existing HR import)
 * No dummy celebrations are ever generated; empty buckets show an empty state.
 *
 * Privacy: only celebration-relevant fields arrive from the server (name,
 * department, designation and the event date/age/years). No salary, password,
 * PIN, attendance or other private HR data is requested or displayed.
 *
 * Dates arrive as plain 'YYYY-MM-DD' strings and are rendered with local
 * components only — never through UTC date parsing, so no day ever shifts.
 */

import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { View, Text, ScrollView, StyleSheet, TouchableOpacity, RefreshControl, ActivityIndicator } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useTheme } from '../../theme';
import { Card, Button, ScreenContainer } from '../../components';
import { api } from '../../services/api';
import { API_ENDPOINTS } from '../../utils/constants';

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const clean = (v) => String(v == null ? '' : v).trim();
const PLACEHOLDER = '—';

/** Plain 'YYYY-MM-DD' -> local parts, so a date can never shift a day. */
const partsOf = (v) => {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(clean(v));
  if (!m) return null;
  const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  if (d.getFullYear() !== Number(m[1]) || d.getMonth() !== Number(m[2]) - 1 || d.getDate() !== Number(m[3])) return null;
  return d;
};
/** "08 October" style, exactly like the card design. */
const longDate = (v) => {
  const d = partsOf(v);
  return d ? `${String(d.getDate()).padStart(2, '0')} ${MONTHS[d.getMonth()]}` : PLACEHOLDER;
};
const dayName = (v) => {
  const d = partsOf(v);
  return d ? WEEKDAYS[d.getDay()] : PLACEHOLDER;
};
const joinedLabel = (v) => {
  const d = partsOf(v);
  return d ? `Joined: ${String(d.getDate()).padStart(2, '0')} ${MONTHS[d.getMonth()]} ${d.getFullYear()}` : '';
};

/** Filter chips: Today / This Week / This Month / Upcoming */
const FILTERS = [
  { id: 'all', label: 'All' },
  { id: 'today', label: 'Today' },
  { id: 'thisWeek', label: 'This Week' },
  { id: 'thisMonth', label: 'This Month' },
  { id: 'upcoming', label: 'Upcoming' },
];

const SECTIONS = [
  {
    id: 'birthdays',
    title: 'Birthdays',
    icon: '🎂',
    accent: '#DB2777',
    empty: 'No birthdays found.',
    line: (it) => `Birthday · ${longDate(it.date)}`,
    sub: (it) => (it.age === null || it.age === undefined ? '' : `Turning ${Number(it.age) + 1}`),
  },
  {
    id: 'workAnniversaries',
    title: 'Work Anniversaries',
    icon: '🎉',
    accent: '#D97706',
    empty: 'No work anniversaries found.',
    line: (it) => `Work Anniversary · ${longDate(it.date)}`,
    sub: (it) => (it.years === null || it.years === undefined ? '' : `${Number(it.years) + 1} year(s) completed`),
  },
  {
    id: 'marriageAnniversaries',
    title: 'Marriage Anniversaries',
    icon: '💍',
    accent: '#E11D48',
    empty: 'Marriage anniversary data is currently unavailable.',
    line: (it) => `Marriage Anniversary · ${longDate(it.date)}`,
    sub: (it) => (it.years === null || it.years === undefined ? '' : `${Number(it.years) + 1} year(s) completed`),
  },
];

/**
 * Employee Birthday & Anniversary Screen Component
 */
export const EmployeeBdayAnniversaryScreen = () => {
  const { theme } = useTheme();
  const [data, setData] = useState(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [error, setError] = useState(null);
  const [filter, setFilter] = useState('today');

  const load = useCallback(async (isRefresh) => {
    if (isRefresh) setIsRefreshing(true); else setIsLoading(true);
    setError(null);
    try {
      const res = await api.get(API_ENDPOINTS.EMPLOYEE_CELEBRATIONS);
      setData(res);
    } catch (e) {
      setData(null);
      setError('Unable to load celebrations. Please try again.');
    } finally {
      setIsLoading(false);
      setIsRefreshing(false);
    }
  }, []);

  useEffect(() => { load(false); }, [load]);

  // Total counts per section, for the section header chips.
  const totals = useMemo(() => {
    const out = {};
    SECTIONS.forEach((s) => {
      const g = data ? data[s.id] : null;
      out[s.id] = g ? ['today', 'thisWeek', 'thisMonth', 'upcoming'].reduce((a, k) => a + (Array.isArray(g[k]) ? g[k].length : 0), 0) : 0;
    });
    return out;
  }, [data]);

  const itemsFor = useCallback((sectionId) => {
    const g = data ? data[sectionId] : null;
    if (!g) return [];
    if (filter === 'all') {
      return ['today', 'thisWeek', 'thisMonth', 'upcoming'].flatMap((k) => (Array.isArray(g[k]) ? g[k] : []));
    }
    return Array.isArray(g[filter]) ? g[filter] : [];
  }, [data, filter]);

  const marriageUnavailable = data ? data.marriageAvailable === false : false;

  const renderCard = (section, it, key) => (
    <View key={key} style={[styles.card, { backgroundColor: theme.surface || '#FFFFFF', borderColor: theme.border }]}>
      <View style={[styles.cardIcon, { backgroundColor: `${section.accent}18` }]}>
        <Text style={styles.cardIconText}>{section.icon}</Text>
      </View>
      <View style={styles.cardBody}>
        <Text style={[styles.cardName, { color: theme.textPrimary }]} numberOfLines={1}>{clean(it.name) || PLACEHOLDER}</Text>
        <Text style={[styles.cardRole, { color: theme.textSecondary }]} numberOfLines={1}>
          {[clean(it.designation), clean(it.department)].filter(Boolean).join(' · ') || PLACEHOLDER}
        </Text>
        <View style={styles.cardFoot}>
          <View style={[styles.chip, { backgroundColor: `${section.accent}14`, borderColor: `${section.accent}44` }]}>
            <Text style={[styles.chipText, { color: section.accent }]}>{section.line(it)}</Text>
          </View>
          {section.sub(it) ? <Text style={[styles.cardSub, { color: theme.textTertiary }]}>{section.sub(it)}</Text> : null}
          {section.id === 'workAnniversaries' && it.joinedOn ? (
            <Text style={[styles.cardSub, { color: theme.textTertiary }]}>{joinedLabel(it.joinedOn)}</Text>
          ) : null}
        </View>
      </View>
      <View style={styles.cardRight}>
        <Text style={[styles.cardDay, { color: theme.textTertiary }]}>{dayName(it.date)}</Text>
        {it.daysUntil === 0 ? (
          <View style={[styles.todayBadge, { backgroundColor: section.accent }]}>
            <Text style={styles.todayBadgeText}>TODAY</Text>
          </View>
        ) : (
          <Text style={[styles.cardIn, { color: theme.textTertiary }]}>{`in ${it.daysUntil}d`}</Text>
        )}
      </View>
    </View>
  );

  return (
    <ScreenContainer title="Birthday & Anniversary" showHeader={true}>
      <ScrollView
        refreshControl={<RefreshControl refreshing={isRefreshing} onRefresh={() => load(true)} colors={[theme.primary]} />}
        contentContainerStyle={styles.scroll}
        showsVerticalScrollIndicator={false}
      >
        {isLoading ? (
          <View style={styles.stateBox}>
            <ActivityIndicator size="large" color={theme.primary} />
            <Text style={[styles.stateText, { color: theme.textSecondary }]}>Loading celebrations...</Text>
          </View>
        ) : null}

        {!isLoading && error ? (
          <Card style={styles.card}>
            <Text style={[styles.errorText, { color: theme.error }]}>⚠️ {error}</Text>
            <Button title="Retry" onPress={() => load(false)} variant="outline" size="small" style={{ marginTop: 12 }} />
          </Card>
        ) : null}

        {!isLoading && !error && data ? (
          <>
            {/* Date filter */}
            <View style={styles.filterRow}>
              {FILTERS.map((f) => (
                <TouchableOpacity
                  key={f.id}
                  style={[
                    styles.filterChip,
                    filter === f.id && { backgroundColor: theme.primary, borderColor: theme.primary },
                  ]}
                  onPress={() => setFilter(f.id)}
                  activeOpacity={0.8}
                >
                  <Text style={[styles.filterText, filter === f.id && { color: theme.textOnPrimary || '#FFFFFF' }]}>
                    {f.label}
                  </Text>
                </TouchableOpacity>
              ))}
            </View>

            {SECTIONS.map((section) => {
              const items = itemsFor(section.id);
              const unavailable = section.id === 'marriageAnniversaries' && marriageUnavailable;
              return (
                <View key={section.id} style={styles.section}>
                  <View style={styles.sectionHeader}>
                    <Text style={styles.sectionIcon}>{section.icon}</Text>
                    <Text style={[styles.sectionTitle, { color: theme.textPrimary }]}>{section.title}</Text>
                    <View style={[styles.sectionCount, { backgroundColor: `${section.accent}18` }]}>
                      <Text style={[styles.sectionCountText, { color: section.accent }]}>{totals[section.id]}</Text>
                    </View>
                  </View>

                  {items.length ? items.map((it, i) => renderCard(section, it, `${section.id}-${it.date}-${i}`)) : (
                    <View style={[styles.empty, { borderColor: theme.border }]}>
                      <Text style={[styles.emptyText, { color: theme.textTertiary }]}>
                        {unavailable ? 'Marriage anniversary data is currently unavailable.' : section.empty}
                      </Text>
                    </View>
                  )}
                </View>
              );
            })}

            <Text style={[styles.footnote, { color: theme.textTertiary }]}>
              {`Organisation celebrations · your own events are excluded · ${clean(data.today)}`}
            </Text>
          </>
        ) : null}
      </ScrollView>
    </ScreenContainer>
  );
};

const styles = StyleSheet.create({
  scroll: { padding: 12, paddingBottom: 28 },
  stateBox: { paddingVertical: 40, alignItems: 'center', gap: 10 },
  stateText: { fontSize: 13 },
  errorText: { fontSize: 13 },

  filterRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginBottom: 14 },
  filterChip: {
    paddingHorizontal: 12, paddingVertical: 6, borderRadius: 999,
    borderWidth: 1, borderColor: '#E2E8F0', backgroundColor: '#FFFFFF',
  },
  filterText: { fontSize: 11.5, fontWeight: '700', color: '#64748B' },

  section: { marginBottom: 18 },
  sectionHeader: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 10 },
  sectionIcon: { fontSize: 16 },
  sectionTitle: { flex: 1, fontSize: 14.5, fontWeight: '800' },
  sectionCount: { paddingHorizontal: 9, paddingVertical: 2, borderRadius: 999, minWidth: 28, alignItems: 'center' },
  sectionCountText: { fontSize: 11, fontWeight: '800' },

  card: {
    flexDirection: 'row', alignItems: 'flex-start',
    borderRadius: 14, borderWidth: 1, padding: 12, marginBottom: 8, gap: 10,
  },
  cardIcon: { width: 40, height: 40, borderRadius: 20, alignItems: 'center', justifyContent: 'center' },
  cardIconText: { fontSize: 18 },
  cardBody: { flex: 1, gap: 2 },
  cardName: { fontSize: 13.5, fontWeight: '700' },
  cardRole: { fontSize: 11 },
  cardFoot: { flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', gap: 6, marginTop: 5 },
  chip: { paddingHorizontal: 8, paddingVertical: 2, borderRadius: 999, borderWidth: 1 },
  chipText: { fontSize: 10.5, fontWeight: '800' },
  cardSub: { fontSize: 10.5 },
  cardRight: { alignItems: 'flex-end', gap: 4, minWidth: 46 },
  cardDay: { fontSize: 10.5, fontWeight: '700' },
  cardIn: { fontSize: 10 },
  todayBadge: { paddingHorizontal: 6, paddingVertical: 2, borderRadius: 999 },
  todayBadgeText: { color: '#FFFFFF', fontSize: 8.5, fontWeight: '900' },

  empty: { padding: 16, alignItems: 'center', borderRadius: 12, borderWidth: 1, borderStyle: 'dashed' },
  emptyText: { fontSize: 12, textAlign: 'center' },
  footnote: { fontSize: 10.5, textAlign: 'center', marginTop: 4 },
});

export default EmployeeBdayAnniversaryScreen;