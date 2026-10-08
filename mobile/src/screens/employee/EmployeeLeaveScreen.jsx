// ============================================================================
// FILE: mobile/src/screens/employee/EmployeeLeaveScreen.jsx
// PURPOSE: Employee Leave - real balance, real request, real status
// ============================================================================

/**
 * Ye screen Employee ko apna REAL leave data dikhata hai aur leave apply karne
 * deti hai. Ye Phase 1 ka placeholder nahi hai - sab kuch backend se aata hai.
 *
 * Navigation Flow:
 * EmployeeNavigator (Leave Tab) → EmployeeLeaveScreen
 *
 * Data Flow (Phase J):
 *   GET  /api/employee/leave/types     → configurable leave types
 *   GET  /api/employee/leave/balance   → Opening / Approved / Pending / Available
 *   GET  /api/employee/leave/requests  → own history + status
 *   POST /api/employee/leave/requests  → apply (server calculates the days)
 *   POST /api/employee/leave/requests/:id/cancel → cancel own pending request
 *
 * Balance rule (Phase J section 3/5): server day-count hota hai aur available
 * balance se zyada request reject hoti hai, jab tak company config explicitly
 * allowNegativeBalance on na kare. Pending request balance ko permanently
 * deduct NAHI karta - sirf encumber karta hai, isliye reject/cancel hone par
 * wapas mil jaata hai.
 *
 * SECURITY: is screen se koi paycode nahi bheja jaata. Backend employee ko JWT
 * se leta hai, isliye doosre employee ka leave dekhna ya badalna possible nahi.
 *
 * Koi bhi number yahan invent nahi hota - backend jo deta hai wahi dikhaya jata
 * hai. Balance na ho to 0 dikhta hai, guess nahi.
 */

import React, { useState, useEffect, useCallback, useMemo } from 'react';
import {
  View, Text, ScrollView, StyleSheet, TouchableOpacity, TextInput,
  ActivityIndicator, RefreshControl, Alert, Platform,
} from 'react-native';
import { COLORS, SPACING } from '../../utils/colors';
import { ScreenContainer } from '../../components/ScreenContainer';
import { Button, Input } from '../../components';
import {
  getLeaveTypes, getMyLeaveBalance, getMyLeaveRequests, applyForLeave,
  cancelMyLeaveRequest, LEAVE_STATUS_STYLE,
} from '../../services/leave';

const clean = (v) => String(v == null ? '' : v).trim();

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const PLACEHOLDER = '—';

const todayISO = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};
const currentYear = () => Number(todayISO().slice(0, 4));

/** 'YYYY-MM-DD' -> 'DD Mon YYYY'. Calendar dates only, no UTC shifting. */
const formatDate = (iso) => {
  const s = clean(iso);
  if (!/^\d{4}-\d{2}-\d{2}/.test(s)) return PLACEHOLDER;
  const d = new Date(Number(s.slice(0, 4)), Number(s.slice(5, 7)) - 1, Number(s.slice(8, 10)));
  if (Number.isNaN(d.getTime())) return PLACEHOLDER;
  return `${String(d.getDate()).padStart(2, '0')} ${MONTHS[d.getMonth()]} ${d.getFullYear()}`;
};
const shortDate = (iso) => {
  const s = clean(iso);
  if (!/^\d{4}-\d{2}-\d{2}/.test(s)) return PLACEHOLDER;
  const d = new Date(Number(s.slice(0, 4)), Number(s.slice(5, 7)) - 1, Number(s.slice(8, 10)));
  return Number.isNaN(d.getTime()) ? PLACEHOLDER : `${String(d.getDate()).padStart(2, '0')} ${MONTHS[d.getMonth()]}`;
};
const daysLabel = (n) => {
  const v = Number(n) || 0;
  if (v === 0.5) return 'Half day';
  return `${v} day${v === 1 ? '' : 's'}`;
};

const statusStyle = (status) => LEAVE_STATUS_STYLE[clean(status)] || { color: COLORS.textSecondary, bg: COLORS.surfaceVariant };

export const EmployeeLeaveScreen = () => {
  const [activeTab, setActiveTab] = useState('balance');

  const [isRefreshing, setIsRefreshing] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  const [types, setTypes] = useState([]);
  const [balance, setBalance] = useState({ leaveyear: currentYear(), types: [] });
  const [requests, setRequests] = useState([]);
  const [statusFilter, setStatusFilter] = useState('');

  // ---- apply form ----
  const [form, setForm] = useState({
    leavetype: '',
    fromdate: todayISO(),
    todate: todayISO(),
    isHalfDay: false,
    halfdaypart: 'FN',
    reason: '',
    contactdetails: '',
    attachmentName: '',
  });
  const [formError, setFormError] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const load = useCallback(async (isRefresh) => {
    if (isRefresh) setIsRefreshing(true);
    setError(null);
    try {
      // Year = the year of the chosen from-date, so a request spanning a new year
      // still shows the balance it will actually be checked against.
      const year = Number(form.fromdate.slice(0, 4)) || currentYear();
      const [typeList, bal, reqs] = await Promise.all([
        getLeaveTypes().catch(() => []),
        getMyLeaveBalance(year).catch(() => ({ leaveyear: year, types: [] })),
        getMyLeaveRequests({ leaveyear: year, status: statusFilter || undefined }).catch(() => []),
      ]);
      setTypes(typeList);
      setBalance(bal);
      setRequests(reqs);
      setForm((prev) => (prev.leavetype ? prev : { ...prev, leavetype: clean(typeList[0]?.leavetype) }));
    } catch (err) {
      setError(err?.response?.data?.message || err?.message || 'Leave data load nahi ho paya.');
    } finally {
      setLoading(false);
      setIsRefreshing(false);
    }
  }, [form.fromdate, statusFilter]);

  useEffect(() => { load(false); }, [load]);

  const activeBalance = useMemo(
    () => balance.types.find((t) => t.leavetype === clean(form.leavetype)) || null,
    [balance.types, form.leavetype],
  );

  const resetForm = () => {
    setForm({
      leavetype: clean(types[0]?.leavetype),
      fromdate: todayISO(),
      todate: todayISO(),
      isHalfDay: false,
      halfdaypart: 'FN',
      reason: '',
      contactdetails: '',
      attachmentName: '',
    });
    setFormError('');
  };

  const handleApply = async () => {
    const type = clean(form.leavetype);
    if (!type) { setFormError('Leave type select karein.'); return; }
    if (!/^\d{4}-\d{2}-\d{2}$/.test(form.fromdate)) { setFormError('From date YYYY-MM-DD format mein daalein.'); return; }
    if (!/^\d{4}-\d{2}-\d{2}$/.test(form.todate)) { setFormError('To date YYYY-MM-DD format mein daalein.'); return; }
    if (form.todate < form.fromdate) { setFormError('To date from date se pehle nahi ho sakti.'); return; }
    if (clean(form.reason).length < 3) { setFormError('Please leave ka reason likhein.'); return; }

    setSubmitting(true);
    setFormError('');
    try {
      const created = await applyForLeave({
        leavetype: type,
        fromdate: form.fromdate,
        todate: form.todate,
        isHalfDay: form.isHalfDay,
        halfdaypart: form.halfdaypart,
        reason: form.reason,
        contactdetails: form.contactdetails,
        attachmentName: form.attachmentName,
      });
      Alert.alert(
        'Leave applied',
        `${daysLabel(created?.days)} ${created?.typename || type} leave apply ho gayi. Status: ${clean(created?.status) || 'Pending'}.`,
        [{ text: 'OK', onPress: () => { resetForm(); load(false); } }],
      );
    } catch (err) {
      // Balance / overlap / backdate errors come back with an explanatory message.
      setFormError(err?.response?.data?.message || err?.message || 'Leave apply nahi ho payi.');
    } finally {
      setSubmitting(false);
    }
  };

  const handleCancel = (request) => {
    Alert.alert(
      'Cancel leave request',
      `${clean(request.leavetype)} · ${shortDate(request.fromdate)} – ${shortDate(request.todate)} cancel karein?`,
      [
        { text: 'No', style: 'cancel' },
        {
          text: 'Yes, cancel',
          style: 'destructive',
          onPress: async () => {
            try {
              await cancelMyLeaveRequest(request.id);
              load(false);
            } catch (err) {
              Alert.alert('Could not cancel', err?.response?.data?.message || err?.message || 'Please try again.');
            }
          },
        },
      ],
    );
  };

  const totalAvailable = useMemo(
    () => balance.types.filter((t) => t.active !== false).reduce((sum, t) => sum + (Number(t.availableBalance) || 0), 0),
    [balance.types],
  );

  const TABS = [
    { key: 'balance', label: 'Balance' },
    { key: 'apply', label: 'Apply' },
    { key: 'history', label: 'My Requests' },
  ];

  return (
    <ScreenContainer title="Leave" showHeader={true}>
      <View style={styles.tabRow}>
        {TABS.map((t) => (
          <TouchableOpacity
            key={t.key}
            style={[styles.tab, activeTab === t.key && styles.tabActive]}
            onPress={() => setActiveTab(t.key)}
          >
            <Text style={[styles.tabText, activeTab === t.key && styles.tabTextActive]}>{t.label}</Text>
          </TouchableOpacity>
        ))}
      </View>

      <ScrollView
        refreshControl={<RefreshControl refreshing={isRefreshing} onRefresh={() => load(true)} colors={[COLORS.primary]} />}
        contentContainerStyle={styles.scroll}
        showsVerticalScrollIndicator={false}
      >
        {loading ? (
          <View style={styles.stateBox}>
            <ActivityIndicator size="large" color={COLORS.primary} />
            <Text style={styles.stateText}>Loading leave data...</Text>
          </View>
        ) : null}

        {!loading && error ? (
          <View style={styles.errorBox}>
            <Text style={styles.errorText}>⚠️ {error}</Text>
            <Button title="Retry" onPress={() => load(false)} variant="outline" size="small" />
          </View>
        ) : null}

        {/* ============================ BALANCE ============================ */}
        {!loading && !error && activeTab === 'balance' ? (
          <>
            <View style={styles.summaryCard}>
              <Text style={styles.summaryLabel}>{`Total available (${balance.leaveyear || currentYear()})`}</Text>
              <Text style={styles.summaryValue}>{totalAvailable}</Text>
              <Text style={styles.summaryHint}>Opening balance HR ke Excel import se aata hai.</Text>
            </View>

            {balance.types.length ? balance.types.filter((t) => t.active !== false).map((t) => (
              <View key={t.leavetype} style={styles.balanceCard}>
                <View style={styles.balanceTop}>
                  <View style={styles.flex}>
                    <Text style={styles.balanceType}>{clean(t.leavetype)}</Text>
                    <Text style={styles.balanceName}>{clean(t.typename)}</Text>
                  </View>
                  <View style={styles.availableBox}>
                    <Text style={styles.availableValue}>{Number(t.availableBalance) || 0}</Text>
                    <Text style={styles.availableLabel}>Available</Text>
                  </View>
                </View>
                <View style={styles.balanceStats}>
                  <View style={styles.statCell}>
                    <Text style={styles.statValue}>{Number(t.openingBalance) || 0}</Text>
                    <Text style={styles.statLabel}>Opening</Text>
                  </View>
                  <View style={styles.statCell}>
                    <Text style={[styles.statValue, { color: '#059669' }]}>{Number(t.approvedUsed) || 0}</Text>
                    <Text style={styles.statLabel}>Approved Used</Text>
                  </View>
                  <View style={styles.statCell}>
                    <Text style={[styles.statValue, { color: '#D97706' }]}>{Number(t.pending) || 0}</Text>
                    <Text style={styles.statLabel}>Pending</Text>
                  </View>
                </View>
              </View>
            )) : (
              <View style={styles.card}>
                <Text style={styles.emptyTitle}>Is saal ka koi leave balance nahi hai</Text>
                <Text style={styles.emptyText}>HR Admin ne abhi opening balance import nahi kiya. Apply tab se request kar sakte hain.</Text>
              </View>
            )}
          </>
        ) : null}

        {/* ============================= APPLY ============================= */}
        {!loading && !error && activeTab === 'apply' ? (
          <View style={styles.card}>
            <Text style={styles.cardTitle}>Apply for Leave</Text>

            <Text style={styles.label}>Leave Type<Text style={styles.req}> *</Text></Text>
            <View style={styles.typeRow}>
              {types.map((t) => {
                const selected = clean(form.leavetype) === clean(t.leavetype);
                return (
                  <TouchableOpacity
                    key={t.leavetype}
                    style={[styles.typeChip, selected && styles.typeChipActive]}
                    onPress={() => setForm({ ...form, leavetype: t.leavetype })}
                  >
                    <Text style={[styles.typeChipText, selected && styles.typeChipTextActive]}>{clean(t.leavetype)}</Text>
                    <Text style={[styles.typeChipName, selected && styles.typeChipNameActive]}>{clean(t.typename)}</Text>
                  </TouchableOpacity>
                );
              })}
            </View>

            {/* Live balance for the chosen type, so the employee sees the cap. */}
            {activeBalance ? (
              <View style={styles.hintBox}>
                <Text style={styles.hintText}>
                  {`Available: ${Number(activeBalance.availableBalance) || 0} ${clean(activeBalance.leavetype)} · Opening ${Number(activeBalance.openingBalance) || 0} · Pending ${Number(activeBalance.pending) || 0}`}
                </Text>
              </View>
            ) : null}

            <Text style={styles.label}>From Date<Text style={styles.req}> *</Text></Text>
            <TextInput
              style={styles.input}
              value={form.fromdate}
              onChangeText={(v) => setForm({ ...form, fromdate: v, ...(v > form.todate ? { todate: v } : {}) })}
              placeholder="YYYY-MM-DD"
              keyboardType="numbers-and-punctuation"
            />

            <Text style={styles.label}>To Date<Text style={styles.req}> *</Text></Text>
            <TextInput
              style={[styles.input, form.isHalfDay && styles.inputDisabled]}
              value={form.todate}
              onChangeText={(v) => setForm({ ...form, todate: v })}
              editable={!form.isHalfDay}
              placeholder="YYYY-MM-DD"
              keyboardType="numbers-and-punctuation"
            />

            {/* Full / Half day */}
            <Text style={styles.label}>Full / Half Day</Text>
            <View style={styles.typeRow}>
              <TouchableOpacity
                style={[styles.smallChip, !form.isHalfDay && styles.smallChipActive]}
                onPress={() => setForm({ ...form, isHalfDay: false })}
              >
                <Text style={[styles.smallChipText, !form.isHalfDay && styles.smallChipTextActive]}>Full Day</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.smallChip, form.isHalfDay && styles.smallChipActive]}
                onPress={() => setForm({ ...form, isHalfDay: true, todate: form.fromdate })}
              >
                <Text style={[styles.smallChipText, form.isHalfDay && styles.smallChipTextActive]}>Half Day</Text>
              </TouchableOpacity>
              {form.isHalfDay ? (
                <>
                  <TouchableOpacity
                    style={[styles.smallChip, form.halfdaypart === 'FN' && styles.smallChipActive]}
                    onPress={() => setForm({ ...form, halfdaypart: 'FN' })}
                  >
                    <Text style={[styles.smallChipText, form.halfdaypart === 'FN' && styles.smallChipTextActive]}>First Half</Text>
                  </TouchableOpacity>
                  <TouchableOpacity
                    style={[styles.smallChip, form.halfdaypart === 'AN' && styles.smallChipActive]}
                    onPress={() => setForm({ ...form, halfdaypart: 'AN' })}
                  >
                    <Text style={[styles.smallChipText, form.halfdaypart === 'AN' && styles.smallChipTextActive]}>Second Half</Text>
                  </TouchableOpacity>
                </>
              ) : null}
            </View>
            <Text style={styles.hintText}>
              Day count server calculate karta hai — weekly off aur holiday automatically exclude hote hain.
            </Text>

            <Text style={styles.label}>Reason<Text style={styles.req}> *</Text></Text>
            <TextInput
              style={[styles.input, styles.inputMulti]}
              value={form.reason}
              onChangeText={(v) => setForm({ ...form, reason: v })}
              placeholder="Leave ka reason..."
              multiline
              maxLength={500}
            />

            <Text style={styles.label}>Contact Details (optional)</Text>
            <TextInput
              style={styles.input}
              value={form.contactdetails}
              onChangeText={(v) => setForm({ ...form, contactdetails: v })}
              placeholder="Reach on: ..."
              maxLength={200}
            />

            <Text style={styles.label}>Attachment (optional)</Text>
            <TextInput
              style={styles.input}
              value={form.attachmentName}
              onChangeText={(v) => setForm({ ...form, attachmentName: v })}
              placeholder="File name, e.g. medical-note.pdf"
              maxLength={200}
            />
            <Text style={styles.hintText}>Attachment ka naam save hota hai; file bytes nahi bheji jaati.</Text>

            {formError ? (
              <View style={styles.errorBox}>
                <Text style={styles.errorText}>⚠️ {formError}</Text>
              </View>
            ) : null}

            <Button
              title={submitting ? 'Submitting...' : 'Apply for Leave'}
              onPress={handleApply}
              variant="primary"
              size="medium"
              disabled={submitting || !types.length}
              style={styles.submitBtn}
            />
            {!types.length ? <Text style={styles.hintText}>Pehle HR Admin se leave types add karwayein.</Text> : null}
          </View>
        ) : null}

        {/* ============================ HISTORY ============================ */}
        {!loading && !error && activeTab === 'history' ? (
          <>
            <View style={styles.filterRow}>
              {['', 'Pending', 'Approved', 'Rejected', 'Cancelled'].map((s) => (
                <TouchableOpacity
                  key={s || 'all'}
                  style={[styles.filterChip, statusFilter === s && styles.filterChipActive]}
                  onPress={() => setStatusFilter(s)}
                >
                  <Text style={[styles.filterText, statusFilter === s && styles.filterTextActive]}>{s || 'All'}</Text>
                </TouchableOpacity>
              ))}
            </View>

            {requests.length ? requests.map((r) => {
              const st = statusStyle(r.status);
              return (
                <View key={r.id} style={styles.card}>
                  <View style={styles.reqTop}>
                    <View style={styles.flex}>
                      <Text style={styles.reqType}>{clean(r.typename) || clean(r.leavetype)}</Text>
                      <Text style={styles.reqDates}>
                        {`${formatDate(r.fromdate)}${r.fromdate === r.todate ? '' : ` – ${formatDate(r.todate)}`}`}
                      </Text>
                    </View>
                    <View style={[styles.statusBadge, { backgroundColor: st.bg }]}>
                      <Text style={[styles.statusText, { color: st.color }]}>{clean(r.status)}</Text>
                    </View>
                  </View>

                  <View style={styles.reqMetaRow}>
                    <Text style={styles.reqMeta}>{`${clean(r.leavetype)} · ${daysLabel(r.days)}`}</Text>
                    {r.isHalfDay ? <Text style={styles.reqMeta}>{` · ${clean(r.halfdaypart) === 'AN' ? 'Second Half' : 'First Half'}`}</Text> : null}
                    {r.hasAttachment ? <Text style={styles.reqMeta}>{` · 📎 ${clean(r.attachmentname)}`}</Text> : null}
                  </View>

                  {clean(r.reason) ? <Text style={styles.reqReason}>{clean(r.reason)}</Text> : null}
                  {clean(r.contactdetails) ? <Text style={styles.reqContact}>{`Contact: ${clean(r.contactdetails)}`}</Text> : null}
                  {clean(r.decisionnote) ? <Text style={styles.reqDecision}>{`HR: ${clean(r.decisionnote)}`}</Text> : null}

                  <View style={styles.reqFooter}>
                    <Text style={styles.reqApplied}>{`Applied ${formatDate(String(r.appliedat || '').slice(0, 10))}`}</Text>
                    {/* Only a PENDING request can be withdrawn, and only by its owner. */}
                    {clean(r.status) === 'Pending' ? (
                      <TouchableOpacity style={styles.cancelBtn} onPress={() => handleCancel(r)}>
                        <Text style={styles.cancelBtnText}>Cancel</Text>
                      </TouchableOpacity>
                    ) : null}
                  </View>
                </View>
              );
            }) : (
              <View style={styles.card}>
                <Text style={styles.emptyTitle}>Koi leave request nahi hai</Text>
                <Text style={styles.emptyText}>Apply tab se apni pehli leave apply karein.</Text>
              </View>
            )}
          </>
        ) : null}
      </ScrollView>
    </ScreenContainer>
  );
};

const styles = StyleSheet.create({
  flex: { flex: 1 },
  scroll: { padding: 12, paddingBottom: 28 },
  tabRow: { flexDirection: 'row', gap: 8, paddingHorizontal: 12, paddingTop: 10 },
  tab: { flex: 1, alignItems: 'center', paddingVertical: 9, borderRadius: 10, borderWidth: 1, borderColor: COLORS.border },
  tabActive: { backgroundColor: COLORS.primary, borderColor: COLORS.primary },
  tabText: { fontSize: 12, fontWeight: '600', color: COLORS.textSecondary },
  tabTextActive: { color: '#FFFFFF' },
  stateBox: { paddingVertical: 36, alignItems: 'center', gap: 10 },
  stateText: { fontSize: 13, color: COLORS.textSecondary },
  errorBox: { padding: 12, borderRadius: 12, backgroundColor: `${COLORS.error}15`, borderWidth: 1, borderColor: `${COLORS.error}30`, marginBottom: 12, gap: 8 },
  errorText: { fontSize: 12, color: COLORS.error, textAlign: 'center' },
  card: { backgroundColor: COLORS.surface, borderRadius: 14, padding: 14, marginBottom: 12, borderWidth: 1, borderColor: COLORS.border },
  cardTitle: { fontSize: 15, fontWeight: '800', color: COLORS.textPrimary, marginBottom: 6 },
  summaryCard: { backgroundColor: COLORS.primary, borderRadius: 14, padding: 16, marginBottom: 12, alignItems: 'center' },
  summaryLabel: { fontSize: 12, color: '#DBEAFE', fontWeight: '600' },
  summaryValue: { fontSize: 34, fontWeight: '800', color: '#FFFFFF', marginVertical: 2 },
  summaryHint: { fontSize: 10.5, color: '#BFDBFE', textAlign: 'center' },
  balanceCard: { backgroundColor: COLORS.surface, borderRadius: 14, padding: 14, marginBottom: 12, borderWidth: 1, borderColor: COLORS.border },
  balanceTop: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  balanceType: { fontSize: 15, fontWeight: '800', color: COLORS.textPrimary },
  balanceName: { fontSize: 12, color: COLORS.textSecondary },
  availableBox: { alignItems: 'center', paddingHorizontal: 12, paddingVertical: 6, borderRadius: 10, backgroundColor: `${COLORS.success}15` },
  availableValue: { fontSize: 20, fontWeight: '800', color: COLORS.success },
  availableLabel: { fontSize: 9.5, color: COLORS.textSecondary },
  balanceStats: { flexDirection: 'row', marginTop: 12, paddingTop: 10, borderTopWidth: 1, borderTopColor: COLORS.divider },
  statCell: { flex: 1, alignItems: 'center' },
  statValue: { fontSize: 15, fontWeight: '800', color: COLORS.textPrimary },
  statLabel: { fontSize: 10, color: COLORS.textSecondary, marginTop: 1 },
  emptyTitle: { fontSize: 13.5, fontWeight: '700', color: COLORS.textPrimary, textAlign: 'center', marginBottom: 4 },
  emptyText: { fontSize: 12, color: COLORS.textSecondary, textAlign: 'center' },
  label: { fontSize: 12, fontWeight: '700', color: COLORS.textPrimary, marginBottom: 6, marginTop: 14 },
  req: { color: COLORS.error },
  input: {
    backgroundColor: COLORS.surfaceVariant, borderWidth: 1, borderColor: COLORS.border, borderRadius: 10,
    paddingHorizontal: 12, paddingVertical: 10, fontSize: 13.5, color: COLORS.textPrimary,
    ...(Platform.OS === 'web' ? { outlineStyle: 'none' } : null),
  },
  inputMulti: { minHeight: 72, textAlignVertical: 'top' },
  inputDisabled: { opacity: 0.5 },
  typeRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  typeChip: { paddingHorizontal: 12, paddingVertical: 8, borderRadius: 10, borderWidth: 1, borderColor: COLORS.border, backgroundColor: COLORS.surfaceVariant },
  typeChipActive: { backgroundColor: COLORS.primary, borderColor: COLORS.primary },
  typeChipText: { fontSize: 12, fontWeight: '800', color: COLORS.textPrimary },
  typeChipTextActive: { color: '#FFFFFF' },
  typeChipName: { fontSize: 10, color: COLORS.textSecondary },
  typeChipNameActive: { color: '#DBEAFE' },
  smallChip: { paddingHorizontal: 12, paddingVertical: 8, borderRadius: 999, borderWidth: 1, borderColor: COLORS.border },
  smallChipActive: { backgroundColor: COLORS.primary, borderColor: COLORS.primary },
  smallChipText: { fontSize: 11.5, fontWeight: '600', color: COLORS.textSecondary },
  smallChipTextActive: { color: '#FFFFFF' },
  hintBox: { marginTop: 10, padding: 10, borderRadius: 10, backgroundColor: COLORS.surfaceVariant },
  hintText: { fontSize: 10.5, color: COLORS.textSecondary, marginTop: 6 },
  submitBtn: { marginTop: 18 },
  filterRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginBottom: 12 },
  filterChip: { paddingHorizontal: 11, paddingVertical: 6, borderRadius: 999, borderWidth: 1, borderColor: COLORS.border },
  filterChipActive: { backgroundColor: COLORS.primary, borderColor: COLORS.primary },
  filterText: { fontSize: 11, fontWeight: '600', color: COLORS.textSecondary },
  filterTextActive: { color: '#FFFFFF' },
  reqTop: { flexDirection: 'row', alignItems: 'flex-start', gap: 10 },
  reqType: { fontSize: 14.5, fontWeight: '700', color: COLORS.textPrimary },
  reqDates: { fontSize: 12, color: COLORS.textSecondary, marginTop: 2 },
  statusBadge: { paddingHorizontal: 10, paddingVertical: 4, borderRadius: 999 },
  statusText: { fontSize: 11, fontWeight: '800' },
  reqMetaRow: { flexDirection: 'row', flexWrap: 'wrap', marginTop: 8 },
  reqMeta: { fontSize: 11, color: COLORS.textSecondary, marginRight: 6 },
  reqReason: { fontSize: 12.5, color: COLORS.textPrimary, marginTop: 8 },
  reqContact: { fontSize: 11, color: COLORS.textTertiary, marginTop: 4 },
  reqDecision: { fontSize: 11.5, color: COLORS.info || '#0284C7', marginTop: 6, fontStyle: 'italic' },
  reqFooter: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: 12, paddingTop: 10, borderTopWidth: 1, borderTopColor: COLORS.divider },
  reqApplied: { fontSize: 10.5, color: COLORS.textTertiary },
  cancelBtn: { paddingHorizontal: 12, paddingVertical: 6, borderRadius: 8, borderWidth: 1, borderColor: COLORS.error },
  cancelBtnText: { fontSize: 11.5, fontWeight: '700', color: COLORS.error },
});

export default EmployeeLeaveScreen;
