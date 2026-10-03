// ============================================================================
// FILE: mobile/src/screens/hr/HRAnalyticsScreen.jsx
// PURPOSE: HR Category-wise Analytics - real daily / weekly / monthly attendance
//          categories + department-wise Present/Absent analysis
// ============================================================================

/**
 * Mobile equivalent of the desktop website's "Category-wise Analytics".
 *
 * Navigation Flow:
 * HRNavigator (Analytics Tab) -> HRAnalyticsScreen
 *
 * Data Flow (existing endpoints only, no new business logic):
 * GET /api/hr/category-analytics?mode=<daily|weekly|monthly>&fromDate=&toDate=
 *   -> { punched, complete, miss, absent, late, companies[], departments[] }
 * GET /api/hr/filters -> { departments:[{code,name}] }  (dbo.tbldepartment lookup)
 *
 * Every number, bucket and department name is rendered EXACTLY as the existing
 * backend returns it. The desktop website calls the same endpoint with the same
 * parameters for the same selected period (see index.html refreshCategoryBackend),
 * so both surfaces always agree. No frontend re-calculation of Present / Absent /
 * Miss Punch / Late happens here:
 *   - Punched / Absent / Miss Punch / Late  -> summary cards (b.punched / b.absent /
 *     b.miss / b.late), the four categories the desktop shows.
 *   - Category distribution (Complete Attendance / Absent / Miss Punch) -> the
 *     desktop donut, fed by b.complete / b.absent / b.miss.
 *   - Department chart Present / Absent -> b.departments[].complete / .absent, the
 *     same two datasets the desktop department chart plots.
 *
 * Date handling mirrors the desktop website:
 *   daily   -> the selected attendance date (from = to)
 *   weekly  -> Monday..Sunday week (startOfWeek in index.html / indiaWeekRange in
 *              the backend), week end auto-filled as start + 6 days
 *   monthly -> the selected calendar month, 1st to the month's last day
 */

import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { View, Text, ScrollView, StyleSheet, TouchableOpacity, RefreshControl, ActivityIndicator, Modal } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { COLORS, TYPOGRAPHY, SPACING, SHADOWS } from '../../utils/colors';
import { ScreenContainer } from '../../components/ScreenContainer';
import { StatCard } from '../../components/StatCard';
import { Button } from '../../components/Button';
import { api } from '../../services/api';

const clean = (v) => String(v == null ? '' : v).trim();
const num = (v) => {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
};

const MODES = [
  { id: 'daily', label: 'Daily' },
  { id: 'weekly', label: 'Weekly' },
  { id: 'monthly', label: 'Monthly' },
];

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

const isoOf = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const parseIso = (s) => new Date(`${clean(s).slice(0, 10)}T00:00:00`);

const addDays = (iso, n) => {
  const d = parseIso(iso);
  d.setDate(d.getDate() + n);
  return isoOf(d);
};

// Monday-start week — identical to the desktop startOfWeek() and the backend
// indiaWeekRange(), so the selected week means the same thing on both surfaces.
const mondayOf = (iso) => {
  const d = parseIso(iso);
  const dow = (d.getDay() + 6) % 7;
  d.setDate(d.getDate() - dow);
  return isoOf(d);
};

const indiaToday = () => isoOf(new Date());

const shortDate = (iso) => {
  const s = clean(iso);
  if (s.length < 10) return '—';
  const d = parseIso(s);
  if (Number.isNaN(d.getTime())) return s;
  return d.toLocaleDateString('en-IN', { day: '2-digit', month: 'short' });
};

/**
 * The one place the selected period is derived. Values match the desktop
 * website's categoryRange(): daily = one date, weekly = Mon..Sun, monthly = the
 * full calendar month.
 */
const rangeFor = (mode, anchor) => {
  if (mode === 'daily') return { from: anchor, to: anchor };
  if (mode === 'weekly') {
    const from = mondayOf(anchor);
    return { from, to: addDays(from, 6) };
  }
  const y = Number(clean(anchor).slice(0, 4));
  const m = Number(clean(anchor).slice(5, 7));
  return { from: `${clean(anchor).slice(0, 7)}-01`, to: isoOf(new Date(y, m, 0)) };
};

const periodLabel = (mode, range) => {
  if (mode === 'daily') return shortDate(range.from);
  if (mode === 'weekly') return `${shortDate(range.from)} – ${shortDate(range.to)}`;
  const m = Number(range.from.slice(5, 7));
  return `${MONTHS[m - 1]} ${range.from.slice(0, 4)}`;
};

/**
 * HR Category Analytics Screen Component
 */
export const HRAnalyticsScreen = () => {
  const [mode, setMode] = useState('daily');
  const [anchor, setAnchor] = useState(indiaToday());
  const [data, setData] = useState(null);
  const [deptNames, setDeptNames] = useState({});
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState(null);

  // Late drill-down. Reuses the EXISTING /hr/late-employees endpoint, which the
  // backend documents as a read-only projection of the SAME late rule used by
  // /hr/summary and /hr/category-analytics — so the detail list count always
  // equals the "Late" card for the same period. No new late calculation here.
  const [lateOpen, setLateOpen] = useState(false);
  const [lateLoading, setLateLoading] = useState(false);
  const [lateError, setLateError] = useState(null);
  const [lateData, setLateData] = useState({ late: 0, employees: [] });

  const openLateDetails = useCallback(async () => {
    setLateOpen(true);
    setLateLoading(true);
    setLateError(null);
    const range = rangeFor(mode, anchor);
    try {
      // Same period as the category-analytics request above.
      const res = await api.get('/hr/late-employees', {
        fromDate: range.from,
        toDate: range.to,
        active: 'Y',
      });
      setLateData({ late: num(res?.late), employees: Array.isArray(res?.employees) ? res.employees : [] });
    } catch (err) {
      setLateData({ late: 0, employees: [] });
      setLateError('Unable to load late employee details.');
    } finally {
      setLateLoading(false);
    }
  }, [mode, anchor]);

  const closeLateDetails = () => {
    setLateOpen(false);
    setLateError(null);
  };

  // A missing punch keeps the neutral placeholder instead of a coloured time.
  const hasPunchTime = (v) => {
    const s = clean(v);
    return s.length > 0 && s !== '—' && s !== '--' && s !== '-';
  };

  // Real department code -> department name map. Same master lookup the desktop
  // website builds from /hr/filters (dbo.tbldepartment); no new mapping table.
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
      .catch(() => { /* names fall back to codes, exactly like the desktop */ });
    return () => { active = false; };
  }, []);

  const load = useCallback(async (isRefresh) => {
    if (isRefresh) setRefreshing(true);
    else setLoading(true);
    setError(null);
    const range = rangeFor(mode, anchor);
    try {
      // Byte-for-byte the request the desktop website makes for this period.
      const res = await api.get('/hr/category-analytics', {
        mode,
        fromDate: range.from,
        toDate: range.to,
      });
      setData(res);
    } catch (err) {
      // Koi fallback fake data nahi — sirf error state.
      setData(null);
      setError(err?.message || 'Category analytics load nahi ho paya.');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [mode, anchor]);

  useEffect(() => { load(false); }, [load]);

  const range = useMemo(() => rangeFor(mode, anchor), [mode, anchor]);
  const today = indiaToday();

  const step = (dir) => {
    if (mode === 'daily') { setAnchor(addDays(anchor, dir)); return; }
    if (mode === 'weekly') { setAnchor(addDays(anchor, dir * 7)); return; }
    const d = parseIso(anchor);
    d.setMonth(d.getMonth() + dir, 1);
    setAnchor(isoOf(d));
  };

  const resetToCurrent = () => setAnchor(today);

  const isCurrentPeriod =
    mode === 'daily' ? range.from === today
      : mode === 'weekly' ? mondayOf(today) === mondayOf(range.from)
        : range.from.slice(0, 7) === today.slice(0, 7);

  // Everything below is rendered straight from the backend response — no
  // frontend attendance calculation.
  const punched = num(data?.punched);
  const absent = num(data?.absent);
  const miss = num(data?.miss);
  const late = num(data?.late);
  const complete = num(data?.complete);

  const categories = useMemo(() => ([
    { key: 'complete', label: 'Complete Attendance', value: complete, color: COLORS.present },
    { key: 'absent', label: 'Absent', value: absent, color: COLORS.absent },
    { key: 'miss', label: 'Miss Punch', value: miss, color: COLORS.missPunch },
  ]), [complete, absent, miss]);
  const categoryTotal = categories.reduce((a, c) => a + c.value, 0);

  const departments = useMemo(() => {
    const rows = Array.isArray(data?.departments) ? data.departments : [];
    return rows.map((d) => ({
      code: clean(d?.departmentcode),
      name: deptNames[clean(d?.departmentcode)] || clean(d?.departmentcode) || '—',
      // Desktop department chart datasets: Present = complete, Absent = absent.
      present: num(d?.complete),
      absent: num(d?.absent),
    }));
  }, [data, deptNames]);

  const deptScale = useMemo(() => {
    const all = departments.flatMap((d) => [d.present, d.absent]);
    return Math.max(1, ...all);
  }, [departments]);

  return (
    <ScreenContainer title="Category Analytics" showHeader={true}>
      <ScrollView
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={() => load(true)} colors={[COLORS.primary]} />
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
            <Button title="Retry" onPress={() => load(false)} variant="outline" size="small" style={styles.retryButton} />
          </View>
        ) : null}

        {!loading && !error ? (
          <>
            {/* Period selector — Daily / Weekly / Monthly */}
            <View style={styles.segmentRow}>
              {MODES.map((m) => (
                <TouchableOpacity
                  key={m.id}
                  style={[styles.segment, mode === m.id && styles.segmentActive]}
                  onPress={() => setMode(m.id)}
                  activeOpacity={0.85}
                >
                  <Text style={[styles.segmentText, mode === m.id && styles.segmentTextActive]}>{m.label}</Text>
                </TouchableOpacity>
              ))}
            </View>

            {/* Period control — one date / Mon-Sun week / calendar month */}
            <View style={[styles.periodCard, SHADOWS.sm]}>
              <TouchableOpacity
                style={styles.periodArrow}
                onPress={() => step(-1)}
                accessibilityLabel="Previous period"
                activeOpacity={0.7}
              >
                <Ionicons name="chevron-back" size={20} color={COLORS.primary} />
              </TouchableOpacity>
              <View style={styles.periodTextBox}>
                <Text style={styles.periodLabel}>{periodLabel(mode, range)}</Text>
                <Text style={styles.periodSub}>
                  {clean(data?.fromDate) || range.from} → {clean(data?.toDate) || range.to}
                </Text>
              </View>
              <TouchableOpacity
                style={styles.periodArrow}
                onPress={() => step(1)}
                accessibilityLabel="Next period"
                activeOpacity={0.7}
              >
                <Ionicons name="chevron-forward" size={20} color={COLORS.primary} />
              </TouchableOpacity>
            </View>

            {!isCurrentPeriod ? (
              <TouchableOpacity style={styles.resetChip} onPress={resetToCurrent} activeOpacity={0.8}>
                <Ionicons name="refresh" size={12} color={COLORS.primary} />
                <Text style={styles.resetChipText}>
                  {mode === 'daily' ? 'Back to Today' : mode === 'weekly' ? 'Back to This Week' : 'Back to This Month'}
                </Text>
              </TouchableOpacity>
            ) : null}

            {/* Daily / Weekly / Monthly summary — the four website categories */}
            <View style={styles.summaryGrid}>
              <StatCard title="Punched" value={punched} icon="👆" color={COLORS.info} subtitle="Distinct employees" />
              <StatCard title="Absent" value={absent} icon="🚫" color={COLORS.absent} subtitle="No punch in range" />
              <StatCard title="Miss Punch" value={miss} icon="⏱️" color={COLORS.missPunch} subtitle="IN-only, shift ended" />
              <StatCard title="Late" value={late} icon="🕐" color={COLORS.late} subtitle="Tap to view late employees" onPress={openLateDetails} />
            </View>

            {/* Category distribution — same buckets as the website donut */}
            <View style={[styles.card, SHADOWS.md]}>
              <Text style={[styles.cardTitle, TYPOGRAPHY.h4]}>Category Distribution</Text>
              <Text style={styles.cardSubtitle}>Complete Attendance vs Absent vs Miss Punch</Text>

              {categoryTotal > 0 ? (
                <>
                  <View style={styles.stackTrack}>
                    {categories.map((c) => (
                      <View
                        key={c.key}
                        style={{
                          flex: c.value,
                          backgroundColor: c.color,
                          height: '100%',
                        }}
                      />
                    ))}
                  </View>
                  <View style={styles.legendRow}>
                    {categories.map((c) => (
                      <View key={`lg-${c.key}`} style={styles.legendItem}>
                        <View style={[styles.legendDot, { backgroundColor: c.color }]} />
                        <Text style={styles.legendText}>{c.label}</Text>
                        <Text style={styles.legendValue}>{c.value}</Text>
                      </View>
                    ))}
                  </View>
                </>
              ) : (
                <Text style={styles.emptyText}>Is period mein koi attendance data nahi hai.</Text>
              )}
            </View>

            {/* Department-wise Present / Absent — the website department chart */}
            <View style={[styles.card, SHADOWS.md]}>
              <Text style={[styles.cardTitle, TYPOGRAPHY.h4]}>Department-wise Attendance</Text>
              <Text style={styles.cardSubtitle}>Present vs Absent employees per department</Text>

              <View style={styles.legendRow}>
                <View style={styles.legendItem}>
                  <View style={[styles.legendDot, { backgroundColor: COLORS.present }]} />
                  <Text style={styles.legendText}>Present</Text>
                </View>
                <View style={styles.legendItem}>
                  <View style={[styles.legendDot, { backgroundColor: COLORS.absent }]} />
                  <Text style={styles.legendText}>Absent</Text>
                </View>
              </View>

              {departments.length === 0 ? (
                <Text style={styles.emptyText}>Department data load nahi hua.</Text>
              ) : (
                departments.map((d, i) => (
                  <View key={`${d.code}-${i}`} style={styles.deptRow}>
                    <View style={styles.deptHeaderRow}>
                      <Text style={styles.deptName} numberOfLines={1}>{d.name}</Text>
                      <View style={styles.deptCounts}>
                        <Text style={[styles.deptCount, { color: COLORS.present }]}>{d.present}</Text>
                        <Text style={styles.deptSlash}>/</Text>
                        <Text style={[styles.deptCount, { color: COLORS.absent }]}>{d.absent}</Text>
                      </View>
                    </View>
                    <View style={styles.deptBars}>
                      <View style={[styles.deptBar, { width: `${(d.present / deptScale) * 100}%`, backgroundColor: COLORS.present }]} />
                      <View style={[styles.deptBar, { width: `${(d.absent / deptScale) * 100}%`, backgroundColor: COLORS.absent }]} />
                    </View>
                  </View>
                ))
              )}
            </View>
          </>
        ) : null}
      </ScrollView>

      {/* Late details — real employees behind the Late count for the selected period */}
      <Modal visible={lateOpen} transparent animationType="slide" onRequestClose={closeLateDetails}>
        <View style={styles.modalBackdrop}>
          <TouchableOpacity style={styles.modalDismiss} activeOpacity={1} onPress={closeLateDetails} />
          <View style={styles.modalCard}>
            <View style={styles.modalHeader}>
              <View style={styles.modalHeaderText}>
                <Text style={styles.modalTitle}>Late Employees ({lateData.late})</Text>
                <Text style={styles.modalSubtitle}>
                  {rangeFor(mode, anchor).from} → {rangeFor(mode, anchor).to}
                </Text>
              </View>
              <TouchableOpacity onPress={closeLateDetails} hitSlop={{ top: 12, left: 12, bottom: 12, right: 12 }}>
                <Text style={styles.modalClose}>✕</Text>
              </TouchableOpacity>
            </View>

            <ScrollView style={styles.modalBody}>
              {lateLoading ? (
                <View style={styles.stateBox}>
                  <ActivityIndicator color={COLORS.primary} />
                  <Text style={styles.stateText}>Loading late employees...</Text>
                </View>
              ) : null}

              {!lateLoading && lateError ? (
                <View style={styles.errorBox}>
                  <Text style={styles.errorText}>⚠️ {lateError}</Text>
                  <Button title="Retry" onPress={openLateDetails} variant="outline" size="small" style={styles.retryButton} />
                </View>
              ) : null}

              {!lateLoading && !lateError && lateData.employees.length === 0 ? (
                <Text style={styles.emptyText}>Is period mein koi late employee nahi hai.</Text>
              ) : null}

              {!lateLoading && !lateError && lateData.employees.map((emp, i) => {
                const dept = clean(emp.departmentname)
                  || deptNames[clean(emp.departmentcode)]
                  || clean(emp.departmentcode)
                  || '—';
                return (
                  <View key={`${clean(emp.paycode)}-${i}`} style={styles.lateRow}>
                    <View style={styles.lateRowTop}>
                      <Text style={styles.latePaycode}>{clean(emp.paycode)}</Text>
                      <Text style={styles.lateName} numberOfLines={1}>{clean(emp.empname)}</Text>
                    </View>
                    <Text style={styles.lateDept} numberOfLines={1}>{dept}</Text>
                    <View style={styles.lateRowMeta}>
                      <Text style={[styles.lateMetaText, hasPunchTime(emp.inTime) ? styles.lateInTime : styles.lateTimePlaceholder]}>
                        In: {clean(emp.inTime) || '—'}
                      </Text>
                      <Text style={[styles.lateMetaText, hasPunchTime(emp.outTime) ? styles.lateOutTime : styles.lateTimePlaceholder]}>
                        Out: {clean(emp.outTime) || '—'}
                      </Text>
                      <Text style={styles.lateBadge}>
                        {num(emp.latearrival) > 0 ? `Late ${num(emp.latearrival)} min` : 'Late'}
                      </Text>
                    </View>
                  </View>
                );
              })}
            </ScrollView>
          </View>
        </View>
      </Modal>
    </ScreenContainer>
  );
};

const styles = StyleSheet.create({
  scrollContent: {
    padding: SPACING.lg,
    paddingBottom: SPACING.xxl,
  },
  stateBox: {
    paddingVertical: SPACING.xxl,
    alignItems: 'center',
    gap: SPACING.sm,
  },
  stateText: {
    color: COLORS.textSecondary,
    fontSize: 13,
  },
  errorBox: {
    backgroundColor: `${COLORS.error}12`,
    borderWidth: 1,
    borderColor: `${COLORS.error}33`,
    borderRadius: 12,
    padding: SPACING.md,
    gap: SPACING.sm,
  },
  errorText: {
    color: COLORS.error,
    fontSize: 12,
  },
  retryButton: {
    alignSelf: 'flex-start',
  },
  segmentRow: {
    flexDirection: 'row',
    backgroundColor: COLORS.surfaceVariant,
    borderRadius: 12,
    padding: 4,
    marginBottom: SPACING.md,
  },
  segment: {
    flex: 1,
    paddingVertical: 10,
    borderRadius: 9,
    alignItems: 'center',
  },
  segmentActive: {
    backgroundColor: COLORS.primary,
  },
  segmentText: {
    fontSize: 13,
    fontWeight: '700',
    color: COLORS.textSecondary,
  },
  segmentTextActive: {
    color: COLORS.textOnPrimary,
  },
  periodCard: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: COLORS.surface,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: COLORS.divider,
    paddingVertical: SPACING.sm,
  },
  periodArrow: {
    width: 46,
    paddingVertical: SPACING.sm,
    alignItems: 'center',
  },
  periodTextBox: {
    flex: 1,
    alignItems: 'center',
  },
  periodLabel: {
    fontSize: 15,
    fontWeight: '700',
    color: COLORS.textPrimary,
  },
  periodSub: {
    fontSize: 11,
    color: COLORS.textTertiary,
    marginTop: 2,
  },
  resetChip: {
    flexDirection: 'row',
    alignItems: 'center',
    alignSelf: 'flex-start',
    gap: 5,
    marginTop: SPACING.sm,
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 999,
    backgroundColor: `${COLORS.primary}12`,
    borderWidth: 1,
    borderColor: `${COLORS.primary}30`,
  },
  resetChipText: {
    fontSize: 11,
    fontWeight: '700',
    color: COLORS.primary,
  },
  summaryGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: SPACING.md,
    marginTop: SPACING.lg,
    marginBottom: SPACING.md,
  },
  card: {
    backgroundColor: COLORS.surface,
    borderRadius: 16,
    padding: SPACING.lg,
    borderWidth: 1,
    borderColor: COLORS.divider,
    marginBottom: SPACING.md,
  },
  cardTitle: {
    color: COLORS.textPrimary,
  },
  cardSubtitle: {
    fontSize: 12,
    color: COLORS.textTertiary,
    marginTop: 2,
    marginBottom: SPACING.md,
  },
  stackTrack: {
    flexDirection: 'row',
    height: 14,
    borderRadius: 999,
    overflow: 'hidden',
    backgroundColor: COLORS.surfaceVariant,
  },
  legendRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: SPACING.md,
    marginTop: SPACING.md,
  },
  legendItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  legendDot: {
    width: 10,
    height: 10,
    borderRadius: 3,
  },
  legendText: {
    fontSize: 11,
    color: COLORS.textSecondary,
  },
  legendValue: {
    fontSize: 12,
    fontWeight: '800',
    color: COLORS.textPrimary,
  },
  emptyText: {
    fontSize: 12,
    color: COLORS.textTertiary,
    textAlign: 'center',
    paddingVertical: SPACING.md,
  },
  deptRow: {
    marginTop: SPACING.md,
  },
  deptHeaderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 5,
    gap: SPACING.sm,
  },
  deptName: {
    flex: 1,
    fontSize: 12.5,
    fontWeight: '700',
    color: COLORS.textPrimary,
  },
  deptCounts: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
  },
  deptCount: {
    fontSize: 12.5,
    fontWeight: '800',
    minWidth: 22,
    textAlign: 'right',
  },
  deptSlash: {
    fontSize: 11,
    color: COLORS.textTertiary,
  },
  deptBars: {
    flexDirection: 'row',
    height: 8,
    borderRadius: 999,
    backgroundColor: COLORS.surfaceVariant,
    overflow: 'hidden',
  },
  deptBar: {
    height: '100%',
  },
  // Late details modal
  modalBackdrop: { flex: 1, backgroundColor: COLORS.overlay, justifyContent: 'flex-end' },
  modalDismiss: { flex: 1 },
  modalCard: {
    backgroundColor: COLORS.surface,
    borderTopLeftRadius: 18,
    borderTopRightRadius: 18,
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
  modalHeaderText: { flex: 1 },
  modalTitle: { fontSize: 15, fontWeight: '800', color: COLORS.textPrimary },
  modalSubtitle: { fontSize: 11, color: COLORS.textTertiary, marginTop: 2 },
  modalClose: { fontSize: 15, color: COLORS.textSecondary, fontWeight: '700' },
  modalBody: { maxHeight: 460, padding: SPACING.md },
  lateRow: {
    paddingVertical: SPACING.sm,
    borderBottomWidth: 1,
    borderBottomColor: COLORS.divider,
  },
  lateRowTop: { flexDirection: 'row', alignItems: 'center', gap: SPACING.sm },
  latePaycode: {
    fontSize: 10.5,
    fontWeight: '800',
    color: COLORS.textSecondary,
    backgroundColor: COLORS.surfaceVariant,
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 6,
    overflow: 'hidden',
  },
  lateName: { flex: 1, fontSize: 13, fontWeight: '700', color: COLORS.textPrimary },
  lateDept: { fontSize: 11, color: COLORS.textTertiary, marginTop: 2 },
  lateRowMeta: { flexDirection: 'row', alignItems: 'center', gap: SPACING.md, marginTop: 3 },
  lateMetaText: { fontSize: 11.5, fontWeight: '700' },
  // IN dark green, OUT dark red; a missing punch stays neutral.
  lateInTime: { color: '#166534' },
  lateOutTime: { color: '#991B1B' },
  lateTimePlaceholder: { color: COLORS.textTertiary, fontWeight: '400' },
  lateBadge: { marginLeft: 'auto', fontSize: 11, fontWeight: '800', color: COLORS.late },
});
