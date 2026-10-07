// ============================================================================
// FILE: mobile/src/screens/hr/HRLeaveManagementScreen.jsx
// PURPOSE: HR Admin Leave Management - balances, Excel import, approvals
// ============================================================================

/**
 * Ye screen HR Admin ka Leave Management hai.
 *
 * Navigation Flow:
 * HRNavigator (Leave Mgmt Tab) â†’ HRLeaveManagementScreen
 *
 * Data Flow (real backend data, no mock values):
 *   GET  /api/hr/leave/types               â†’ leave types (configurable)
 *   POST /api/hr/leave/types               â†’ add a new type
 *   GET/PUT /api/hr/leave/config           â†’ company switches
 *   GET  /api/hr/leave/balances            â†’ bulk opening balances
 *   POST /api/hr/leave/balances/import     â†’ Excel import with a full summary
 *   GET  /api/hr/leave/requests            â†’ review queue
 *   POST /api/hr/leave/requests/:id/decision â†’ approve / reject
 *
 * ---------------------------------------------------------------------------
 * EXCEL IMPORT (Phase J section 2)
 * ---------------------------------------------------------------------------
 * Expected columns, in any order / casing:
 *   EmployeeCode | BiometricCode | EmployeeName | LeaveYear | LeaveType | OpeningBalance
 *
 * The workbook is PARSED HERE but VALIDATED ON THE SERVER, because only the
 * server can match an employee against the real active roster. The result is a
 * summary of Imported / Updated / Skipped / Failed / Errors, and an unmatched
 * employee is ALWAYS reported as Failed - never silently dropped or guessed.
 *
 * ---------------------------------------------------------------------------
 * SECURITY
 * Every route used here requires an HR role server-side (requireRole('HR')), so
 * an EMPLOYEE token receives 403. This screen is only reachable from the HR tab.
 *
 * ---------------------------------------------------------------------------
 * STORAGE
 * All leave data is application-owned (dbo.HR_Leave*). No Savior table is
 * created, altered or written, and no Navision connection exists.
 */

import React, { useState, useEffect, useCallback, useMemo } from 'react';
import {
  View, Text, ScrollView, StyleSheet, TouchableOpacity, TextInput, Modal,
  ActivityIndicator, RefreshControl, Alert, Platform,
} from 'react-native';
import * as DocumentPicker from 'expo-document-picker';
import * as FileSystem from 'expo-file-system';
import * as XLSX from 'xlsx';
import { Ionicons } from '@expo/vector-icons';
import { COLORS, SPACING } from '../../utils/colors';
import { ScreenContainer } from '../../components/ScreenContainer';
import { Button } from '../../components/Button';
import {
  getHrLeaveTypes, addHrLeaveType, getHrLeaveConfig, saveHrLeaveConfig,
  getHrLeaveBalances, importHrLeaveBalances, getHrLeaveRequests, decideHrLeaveRequest,
  normaliseLeaveImportRow, LEAVE_STATUS_STYLE, LEAVE_IMPORT_COLUMNS,
} from '../../services/leave';

const clean = (v) => String(v == null ? '' : v).trim();
const PLACEHOLDER = 'â€”';

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const todayISO = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};
const currentYear = () => Number(todayISO().slice(0, 4));
const shiftYear = (year, delta) => `${Number(year) + delta}`;

const formatDate = (iso) => {
  const s = clean(iso);
  if (!/^\d{4}-\d{2}-\d{2}/.test(s)) return PLACEHOLDER;
  const d = new Date(Number(s.slice(0, 4)), Number(s.slice(5, 7)) - 1, Number(s.slice(8, 10)));
  return Number.isNaN(d.getTime()) ? PLACEHOLDER : `${String(d.getDate()).padStart(2, '0')} ${MONTHS[d.getMonth()]} ${d.getFullYear()}`;
};
const daysLabel = (n) => {
  const v = Number(n) || 0;
  return v === 0.5 ? 'Half day' : `${v} day${v === 1 ? '' : 's'}`;
};
const statusStyle = (status) => LEAVE_STATUS_STYLE[clean(status)] || { color: COLORS.textSecondary, bg: COLORS.surfaceVariant };

/* ---------- byte helpers (same approach as the HR marriage Excel import) ---------- */
const utf8ToBytes = (str) => {
  const out = [];
  for (let i = 0; i < str.length; i += 1) {
    const c = str.charCodeAt(i);
    if (c < 128) out.push(c);
    else if (c < 2048) out.push(192 | (c >> 6), 128 | (c & 63));
    else out.push(224 | (c >> 12), 128 | ((c >> 6) & 63), 128 | (c & 63));
  }
  return new Uint8Array(out);
};
const base64ToBytes = (b64) => {
  const bin = typeof atob === 'function' ? atob(b64) : Buffer.from(b64, 'base64').toString('binary');
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i += 1) out[i] = bin.charCodeAt(i);
  return out;
};

export const HRLeaveManagementScreen = () => {
  const [activeTab, setActiveTab] = useState('requests');

  const [isRefreshing, setIsRefreshing] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  const [year, setYear] = useState(currentYear());
  const [types, setTypes] = useState([]);
  const [config, setConfig] = useState(null);

  // ---- approvals ----
  const [requests, setRequests] = useState([]);
  const [statusFilter, setStatusFilter] = useState('Pending');
  const [search, setSearch] = useState('');
  const [searchDraft, setSearchDraft] = useState('');
  const [decidingId, setDecidingId] = useState(null);

  // ---- balances ----
  const [balances, setBalances] = useState([]);
  const [balanceSearch, setBalanceSearch] = useState('');

  // ---- excel import ----
  const [importing, setImporting] = useState(false);
  const [importSummary, setImportSummary] = useState(null);
  const [importError, setImportError] = useState(null);

  // ---- add leave type ----
  const [showTypeModal, setShowTypeModal] = useState(false);
  const [newType, setNewType] = useState({ leavetype: '', typename: '' });
  const [typeError, setTypeError] = useState('');

  const load = useCallback(async (isRefresh) => {
    if (isRefresh) setIsRefreshing(true);
    setError(null);
    try {
      const [typeList, cfg, reqs, bal] = await Promise.all([
        getHrLeaveTypes(true),
        getHrLeaveConfig().catch(() => null),
        getHrLeaveRequests({ leaveyear: year, status: statusFilter || undefined, search: search || undefined }).catch(() => ({ requests: [], counts: {} })),
        getHrLeaveBalances({ leaveyear: year, search: balanceSearch || undefined }).catch(() => ({ employees: [] })),
      ]);
      setTypes(typeList);
      setConfig(cfg);
      setRequests(reqs.requests || []);
      setBalances(bal.employees || []);
    } catch (err) {
      setError(err?.response?.data?.message || err?.message || 'Leave data load nahi ho paya.');
    } finally {
      setLoading(false);
      setIsRefreshing(false);
    }
  }, [year, statusFilter, search, balanceSearch]);

  useEffect(() => { load(false); }, [load]);

  /* ------------------------- approvals ------------------------- */

  const decide = (request, decision) => {
    const verb = decision === 'Approved' ? 'approve' : 'reject';
    Alert.alert(
      `${decision} leave`,
      `${clean(request.empname) || clean(request.paycode)} Â· ${clean(request.leavetype)} Â· ${daysLabel(request.days)}\n\nKya aap is request ko ${verb} karna chahte hain?`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: decision,
          style: decision === 'Approved' ? 'default' : 'destructive',
          onPress: async () => {
            setDecidingId(request.id);
            try {
              await decideHrLeaveRequest(request.id, decision, '');
              load(false);
            } catch (err) {
              // e.g. balance no longer available at decision time.
              Alert.alert(`Could not ${verb}`, err?.response?.data?.message || err?.message || 'Please try again.');
            } finally {
              setDecidingId(null);
            }
          },
        },
      ],
    );
  };

  /* ------------------------- excel import ------------------------- */

  const readPickedBytes = async (asset) => {
    if (asset?.file && typeof asset.file.arrayBuffer === 'function') {
      return new Uint8Array(await asset.file.arrayBuffer());
    }
    if (typeof asset?.uri === 'string' && asset.uri.indexOf('data:') === 0) {
      const comma = asset.uri.indexOf(',');
      const meta = asset.uri.slice(5, comma);
      const payload = asset.uri.slice(comma + 1);
      if (/;base64/i.test(meta)) return base64ToBytes(payload);
      return utf8ToBytes(decodeURIComponent(payload));
    }
    if (Platform.OS === 'web' && typeof fetch === 'function') {
      const res = await fetch(asset.uri);
      return new Uint8Array(await res.arrayBuffer());
    }
    const b64 = await FileSystem.readAsStringAsync(asset.uri, { encoding: FileSystem.EncodingType.Base64 });
    return base64ToBytes(String(b64 || ''));
  };

  const handlePickAndImport = async () => {
    if (importing) return;
    setImporting(true);
    setImportError(null);
    setImportSummary(null);
    try {
      const picked = await DocumentPicker.getDocumentAsync({
        type: ['application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
          'application/vnd.ms-excel', 'application/octet-stream', 'text/csv', 'text/comma-separated-values', '*/*'],
        copyToCacheDirectory: true,
        multiple: false,
      });
      if (picked?.canceled) return;
      const asset = picked?.assets?.[0];
      if (!asset) throw new Error('No file selected.');

      const bytes = await readPickedBytes(asset);
      // cellDates:false keeps Excel serials as numbers, so a LeaveYear of 2027 is
      // read as 2027 rather than being shifted by a timezone.
      const wb = XLSX.read(bytes, { type: 'array', cellDates: false });
      const sheet = wb.Sheets[wb.SheetNames[0]];
      if (!sheet) throw new Error('Workbook me koi sheet nahi mili.');

      const raw = XLSX.utils.sheet_to_json(sheet, { defval: '', raw: true });
      if (!Array.isArray(raw) || !raw.length) throw new Error('Sheet khaali hai â€” koi row nahi mili.');

      // Normalise headers here; all VALUE validation happens on the server.
      const rows = raw.map(normaliseLeaveImportRow);
      const summary = await importHrLeaveBalances(rows);
      setImportSummary(summary);
      load(false);
    } catch (err) {
      setImportError(err?.response?.data?.message || err?.message || 'File read/import nahi ho paya.');
    } finally {
      setImporting(false);
    }
  };

  /* ------------------------- leave types ------------------------- */

  const submitNewType = async () => {
    const code = clean(newType.leavetype).toUpperCase();
    const name = clean(newType.typename);
    if (!code) { setTypeError('Type code required hai (e.g. ML).'); return; }
    if (!name) { setTypeError('Type name required hai.'); return; }
    try {
      await addHrLeaveType({ leavetype: code, typename: name });
      setShowTypeModal(false);
      setNewType({ leavetype: '', typename: '' });
      setTypeError('');
      load(false);
    } catch (err) {
      setTypeError(err?.response?.data?.message || err?.message || 'Type add nahi hua.');
    }
  };

  const toggleNegative = async () => {
    if (!config) return;
    try {
      const updated = await saveHrLeaveConfig({ allowNegativeBalance: !config.allowNegativeBalance });
      setConfig(updated);
    } catch (err) {
      Alert.alert('Could not save config', err?.response?.data?.message || err?.message || 'Please try again.');
    }
  };

  const pendingCount = useMemo(() => requests.filter((r) => r.status === 'Pending').length, [requests]);
  const withBalanceCount = useMemo(() => balances.length, [balances]);

  const TABS = [
    { key: 'requests', label: 'Requests', badge: pendingCount },
    { key: 'balances', label: 'Balances', badge: withBalanceCount },
    { key: 'import', label: 'Excel Import' },
    { key: 'settings', label: 'Types & Rules' },
  ];

  return (
    <ScreenContainer title="Leave Management" showHeader={true}>
      {/* Year navigation â€” nothing about a leave year is hardcoded. */}
      <View style={styles.yearBar}>
        <TouchableOpacity onPress={() => setYear((y) => shiftYear(y, -1))} accessibilityLabel="Previous leave year">
          <Ionicons name="chevron-back" size={18} color={COLORS.primary} />
        </TouchableOpacity>
        <Text style={styles.yearLabel}>{`Leave Year ${year}`}</Text>
        <TouchableOpacity onPress={() => setYear((y) => shiftYear(y, 1))} accessibilityLabel="Next leave year">
          <Ionicons name="chevron-forward" size={18} color={COLORS.primary} />
        </TouchableOpacity>
      </View>

      <View style={styles.tabRow}>
        {TABS.map((t) => (
          <TouchableOpacity
            key={t.key}
            style={[styles.tab, activeTab === t.key && styles.tabActive]}
            onPress={() => setActiveTab(t.key)}
          >
            <Text style={[styles.tabText, activeTab === t.key && styles.tabTextActive]}>{t.label}</Text>
            {t.badge ? (
              <View style={[styles.badge, activeTab === t.key && styles.badgeActive]}>
                <Text style={[styles.badgeText, activeTab === t.key && styles.badgeTextActive]}>{t.badge}</Text>
              </View>
            ) : null}
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
            <Text style={styles.errorText}>âš ï¸ {error}</Text>
            <Button title="Retry" onPress={() => load(false)} variant="outline" size="small" />
          </View>
        ) : null}

        {/* ========================= REQUESTS ========================= */}
        {!loading && !error && activeTab === 'requests' ? (
          <>
            <View style={styles.filterRow}>
              {['Pending', 'Approved', 'Rejected', 'Cancelled', ''].map((s) => (
                <TouchableOpacity
                  key={s || 'all'}
                  style={[styles.chip, statusFilter === s && styles.chipActive]}
                  onPress={() => setStatusFilter(s)}
                >
                  <Text style={[styles.chipText, statusFilter === s && styles.chipTextActive]}>{s || 'All'}</Text>
                </TouchableOpacity>
              ))}
            </View>

            <View style={styles.searchRow}>
              <TextInput
                style={styles.searchInput}
                value={searchDraft}
                onChangeText={setSearchDraft}
                onSubmitEditing={() => setSearch(searchDraft.trim())}
                placeholder="Search paycode, name or reason..."
                placeholderTextColor={COLORS.textTertiary}
                returnKeyType="search"
              />
              <TouchableOpacity style={styles.searchBtn} onPress={() => setSearch(searchDraft.trim())}>
                <Ionicons name="search" size={18} color={COLORS.primary} />
              </TouchableOpacity>
            </View>

            {requests.length ? requests.map((r) => {
              const st = statusStyle(r.status);
              return (
                <View key={r.id} style={styles.card}>
                  <View style={styles.rowTop}>
                    <View style={styles.flex}>
                      <Text style={styles.empName}>{clean(r.empname) || clean(r.paycode)}</Text>
                      <Text style={styles.empMeta}>{`${clean(r.paycode)} Â· ${clean(r.leavetype)} Â· ${daysLabel(r.days)}`}</Text>
                    </View>
                    <View style={[styles.statusBadge, { backgroundColor: st.bg }]}>
                      <Text style={[styles.statusText, { color: st.color }]}>{clean(r.status)}</Text>
                    </View>
                  </View>

                  <Text style={styles.reqDates}>
                    {`${formatDate(r.fromdate)}${r.fromdate === r.todate ? '' : ` â€“ ${formatDate(r.todate)}`}`}
                    {r.isHalfDay ? ` Â· ${clean(r.halfdaypart) === 'AN' ? 'Second Half' : 'First Half'}` : ''}
                  </Text>
                  {clean(r.reason) ? <Text style={styles.reason}>{clean(r.reason)}</Text> : null}
                  <Text style={styles.applied}>{`Applied ${formatDate(String(r.appliedat || '').slice(0, 10))}`}</Text>
                  {clean(r.decisionnote) ? <Text style={styles.decisionNote}>{`HR note: ${clean(r.decisionnote)}`}</Text> : null}

                  {/* Only a PENDING request can be decided. */}
                  {clean(r.status) === 'Pending' ? (
                    <View style={styles.actionRow}>
                      <Button
                        title="Approve"
                        onPress={() => decide(r, 'Approved')}
                        variant="primary"
                        size="small"
                        disabled={decidingId === r.id}
                        style={styles.flexBtn}
                      />
                      <Button
                        title="Reject"
                        onPress={() => decide(r, 'Rejected')}
                        variant="outline"
                        size="small"
                        disabled={decidingId === r.id}
                        style={styles.flexBtn}
                      />
                    </View>
                  ) : null}
                </View>
              );
            }) : (
              <View style={styles.card}>
                <Text style={styles.emptyTitle}>Koi request nahi hai</Text>
                <Text style={styles.emptyText}>Is filter me koi leave request nahi mila.</Text>
              </View>
            )}
          </>
        ) : null}

        {/* ========================= BALANCES ========================= */}
        {!loading && !error && activeTab === 'balances' ? (
          <>
            <Text style={styles.sectionHint}>{`${balances.length} employee(s) ka ${year} opening balance loaded hai.`}</Text>
            {balances.length ? balances.map((e) => (
              <View key={e.paycode} style={styles.card}>
                <View style={styles.rowTop}>
                  <View style={styles.flex}>
                    <Text style={styles.empName}>{clean(e.empname) || clean(e.paycode)}</Text>
                    <Text style={styles.empMeta}>{`${clean(e.paycode)}${clean(e.companycode) ? ` Â· ${clean(e.companycode)}` : ''}`}</Text>
                  </View>
                </View>
                <View style={styles.balGrid}>
                  {e.types.map((t) => (
                    <View key={t.leavetype} style={styles.balCell}>
                      <Text style={styles.balType}>{clean(t.leavetype)}</Text>
                      <Text style={styles.balValue}>{Number(t.openingBalance) || 0}</Text>
                    </View>
                  ))}
                </View>
              </View>
            )) : (
              <View style={styles.card}>
                <Text style={styles.emptyTitle}>Koi opening balance nahi</Text>
                <Text style={styles.emptyText}>Excel Import tab se balances import karein.</Text>
              </View>
            )}
          </>
        ) : null}

        {/* ======================= EXCEL IMPORT ======================= */}
        {!loading && !error && activeTab === 'import' ? (
          <>
            <View style={styles.card}>
              <Text style={styles.cardTitle}>Import Opening Balances</Text>
              <Text style={styles.hint}>
                Excel mein ye columns hone chahiye (order/casing koi bhi chalega):
              </Text>
              <View style={styles.colWrap}>
                {LEAVE_IMPORT_COLUMNS.map((c) => (
                  <View key={c} style={styles.colChip}><Text style={styles.colChipText}>{c}</Text></View>
                ))}
              </View>
              <Text style={styles.hint}>
                Har row ka employee code REAL active roster se match hota hai. Jo match nahi hota
                use Failed me dikhaya jata hai â€” koi row chupke se skip nahi hoti.
              </Text>

              <Button
                title={importing ? 'Reading file...' : 'Choose Excel File'}
                onPress={handlePickAndImport}
                variant="primary"
                size="medium"
                disabled={importing}
                leftIcon={<Ionicons name="document-text" size={16} color="#FFFFFF" />}
                style={styles.importBtn}
              />
              {importError ? (
                <View style={styles.errorBox}>
                  <Text style={styles.errorText}>âš ï¸ {importError}</Text>
                </View>
              ) : null}
            </View>

            {/* Summary: Imported / Updated / Skipped / Failed / Errors */}
            {importSummary ? (
              <View style={styles.card}>
                <Text style={styles.cardTitle}>Import Summary</Text>
                <View style={styles.sumGrid}>
                  {[
                    ['Imported', importSummary.imported, COLORS.success],
                    ['Updated', importSummary.updated, COLORS.primary],
                    ['Skipped', importSummary.skipped, COLORS.textTertiary],
                    ['Failed', importSummary.failed, COLORS.error],
                  ].map(([label, value, color]) => (
                    <View key={label} style={styles.sumCell}>
                      <Text style={[styles.sumValue, { color }]}>{value ?? 0}</Text>
                      <Text style={styles.sumLabel}>{label}</Text>
                    </View>
                  ))}
                </View>

                {(importSummary.errors || []).length ? (
                  <>
                    <Text style={styles.errTitle}>{`Errors (${importSummary.errors.length})`}</Text>
                    {importSummary.errors.slice(0, 40).map((e, i) => (
                      <View key={`err-${i}`} style={styles.errRow}>
                        <Text style={styles.errRowText}>{`Row ${e.row}${e.employeeCode ? ` Â· ${clean(e.employeeCode)}` : ''}: ${e.message}`}</Text>
                      </View>
                    ))}
                    {importSummary.errors.length > 40 ? (
                      <Text style={styles.hint}>{`â€¦aur ${importSummary.errors.length - 40} errors.`}</Text>
                    ) : null}
                  </>
                ) : (
                  <Text style={styles.okText}>âœ… Koi error nahi â€” sab rows process hue.</Text>
                )}
              </View>
            ) : null}
          </>
        ) : null}

        {/* ==================== TYPES & COMPANY RULES ==================== */}
        {!loading && !error && activeTab === 'settings' ? (
          <>
            <View style={styles.card}>
              <View style={styles.rowTop}>
                <Text style={[styles.cardTitle, styles.flex]}>Leave Types</Text>
                <TouchableOpacity style={styles.addBtn} onPress={() => setShowTypeModal(true)}>
                  <Ionicons name="add" size={16} color="#FFFFFF" />
                  <Text style={styles.addBtnText}>Add</Text>
                </TouchableOpacity>
              </View>
              {types.map((t) => (
                <View key={t.leavetype} style={styles.typeRow}>
                  <View style={[styles.typeDot, { backgroundColor: t.active === false ? COLORS.textTertiary : COLORS.primary }]} />
                  <Text style={styles.typeCode}>{clean(t.leavetype)}</Text>
                  <Text style={[styles.typeName, styles.flex]}>{clean(t.typename)}</Text>
                  {t.active === false ? <Text style={styles.typeInactive}>inactive</Text> : null}
                </View>
              ))}
              <Text style={styles.hint}>Naya type yahin se add ho jaata hai â€” koi code change nahi chahiye.</Text>
            </View>

            <View style={styles.card}>
              <Text style={styles.cardTitle}>Company Rules</Text>
              <TouchableOpacity style={styles.toggleRow} onPress={toggleNegative}>
                <View style={[styles.toggleTrack, config?.allowNegativeBalance && { backgroundColor: COLORS.warning }]}>
                  <View style={[styles.toggleThumb, config?.allowNegativeBalance && styles.toggleThumbOn]} />
                </View>
                <View style={styles.flex}>
                  <Text style={styles.toggleTitle}>Allow requests beyond available balance</Text>
                  <Text style={styles.hint}>
                    {config?.allowNegativeBalance
                      ? 'ON â€” employee available balance se zyada leave request kar sakta hai.'
                      : 'OFF â€” available balance se zyada request reject ho jaati hai.'}
                  </Text>
                </View>
              </TouchableOpacity>
              {config ? (
                <Text style={styles.hint}>
                  {`Max backdate: ${config.maxBackdateDays || 'no limit'} day(s) Â· Attachment required above: ${config.attachmentRequiredAboveDays || 'never'} day(s)`}
                </Text>
              ) : null}
            </View>
          </>
        ) : null}
      </ScrollView>

      {/* --------------------- Add leave type modal --------------------- */}
      <Modal visible={showTypeModal} transparent animationType="slide" onRequestClose={() => setShowTypeModal(false)}>
        <View style={styles.modalBackdrop}>
          <TouchableOpacity style={styles.flex} activeOpacity={1} onPress={() => setShowTypeModal(false)} />
          <View style={styles.sheet}>
            <View style={styles.sheetHeader}>
              <Text style={styles.sheetTitle}>Add Leave Type</Text>
              <TouchableOpacity onPress={() => setShowTypeModal(false)} hitSlop={{ top: 12, left: 12, bottom: 12, right: 12 }}>
                <Ionicons name="close" size={20} color={COLORS.textSecondary} />
              </TouchableOpacity>
            </View>
            <View style={styles.sheetBody}>
              <Text style={styles.label}>Type Code<Text style={styles.req}> *</Text></Text>
              <TextInput
                style={styles.input}
                value={newType.leavetype}
                onChangeText={(v) => { setNewType({ ...newType, leavetype: v.toUpperCase() }); setTypeError(''); }}
                placeholder="e.g. ML"
                maxLength={10}
                autoCapitalize="characters"
              />
              <Text style={styles.label}>Type Name<Text style={styles.req}> *</Text></Text>
              <TextInput
                style={styles.input}
                value={newType.typename}
                onChangeText={(v) => { setNewType({ ...newType, typename: v }); setTypeError(''); }}
                placeholder="e.g. Maternity Leave"
                maxLength={100}
              />
              {typeError ? <Text style={styles.errInline}>{typeError}</Text> : null}
              <View style={styles.sheetFooter}>
                <Button title="Cancel" onPress={() => setShowTypeModal(false)} variant="outline" size="medium" style={styles.flexBtn} />
                <Button title="Add Type" onPress={submitNewType} variant="primary" size="medium" style={styles.flexBtn} />
              </View>
            </View>
          </View>
        </View>
      </Modal>
    </ScreenContainer>
  );
};

const styles = StyleSheet.create({
  flex: { flex: 1 },
  flexBtn: { flex: 1 },
  scroll: { padding: 12, paddingBottom: 28 },
  yearBar: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 16, paddingVertical: 8 },
  yearLabel: { fontSize: 14, fontWeight: '800', color: COLORS.textPrimary },
  tabRow: { flexDirection: 'row', gap: 6, paddingHorizontal: 12, paddingBottom: 8 },
  tab: { flex: 1, alignItems: 'center', paddingVertical: 8, borderRadius: 10, borderWidth: 1, borderColor: COLORS.border },
  tabActive: { backgroundColor: COLORS.primary, borderColor: COLORS.primary },
  tabText: { fontSize: 10.5, fontWeight: '600', color: COLORS.textSecondary },
  tabTextActive: { color: '#FFFFFF' },
  badge: { position: 'absolute', top: -4, right: -4, minWidth: 16, height: 16, borderRadius: 8, paddingHorizontal: 4, backgroundColor: COLORS.error, alignItems: 'center', justifyContent: 'center' },
  badgeActive: { backgroundColor: '#FFFFFF' },
  badgeText: { fontSize: 9.5, fontWeight: '800', color: '#FFFFFF' },
  badgeTextActive: { color: COLORS.primary },
  stateBox: { paddingVertical: 36, alignItems: 'center', gap: 10 },
  stateText: { fontSize: 13, color: COLORS.textSecondary },
  errorBox: { padding: 12, borderRadius: 12, backgroundColor: `${COLORS.error}15`, borderWidth: 1, borderColor: `${COLORS.error}30`, marginTop: 10 },
  errorText: { fontSize: 12, color: COLORS.error, textAlign: 'center' },
  card: { backgroundColor: COLORS.surface, borderRadius: 14, padding: 14, marginBottom: 12, borderWidth: 1, borderColor: COLORS.border },
  cardTitle: { fontSize: 15, fontWeight: '800', color: COLORS.textPrimary, marginBottom: 6 },
  sectionHint: { fontSize: 12, color: COLORS.textSecondary, marginBottom: 10 },
  hint: { fontSize: 11, color: COLORS.textTertiary, marginTop: 8, lineHeight: 16 },
  rowTop: { flexDirection: 'row', alignItems: 'flex-start', gap: 10 },
  empName: { fontSize: 14.5, fontWeight: '700', color: COLORS.textPrimary },
  empMeta: { fontSize: 11.5, color: COLORS.textSecondary, marginTop: 2 },
  statusBadge: { paddingHorizontal: 10, paddingVertical: 4, borderRadius: 999 },
  statusText: { fontSize: 11, fontWeight: '800' },
  reqDates: { fontSize: 12.5, color: COLORS.textPrimary, marginTop: 8, fontWeight: '600' },
  reason: { fontSize: 12, color: COLORS.textSecondary, marginTop: 6 },
  applied: { fontSize: 10.5, color: COLORS.textTertiary, marginTop: 6 },
  decisionNote: { fontSize: 11.5, color: COLORS.textSecondary, marginTop: 4, fontStyle: 'italic' },
  actionRow: { flexDirection: 'row', gap: 10, marginTop: 12, paddingTop: 10, borderTopWidth: 1, borderTopColor: COLORS.divider },
  emptyTitle: { fontSize: 13.5, fontWeight: '700', color: COLORS.textPrimary, textAlign: 'center', marginBottom: 4 },
  emptyText: { fontSize: 12, color: COLORS.textSecondary, textAlign: 'center' },
  filterRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginBottom: 10 },
  chip: { paddingHorizontal: 11, paddingVertical: 6, borderRadius: 999, borderWidth: 1, borderColor: COLORS.border },
  chipActive: { backgroundColor: COLORS.primary, borderColor: COLORS.primary },
  chipText: { fontSize: 11, fontWeight: '600', color: COLORS.textSecondary },
  chipTextActive: { color: '#FFFFFF' },
  searchRow: { flexDirection: 'row', gap: 8, marginBottom: 12 },
  searchInput: {
    flex: 1, backgroundColor: COLORS.surfaceVariant, borderWidth: 1, borderColor: COLORS.border,
    borderRadius: 10, paddingHorizontal: 12, paddingVertical: 9, fontSize: 13, color: COLORS.textPrimary,
    ...(Platform.OS === 'web' ? { outlineStyle: 'none' } : null),
  },
  searchBtn: { width: 40, alignItems: 'center', justifyContent: 'center', borderRadius: 10, borderWidth: 1, borderColor: COLORS.border, backgroundColor: COLORS.surfaceVariant },
  balGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 12 },
  balCell: { minWidth: 62, alignItems: 'center', paddingVertical: 8, borderRadius: 10, backgroundColor: COLORS.surfaceVariant, borderWidth: 1, borderColor: COLORS.border },
  balType: { fontSize: 10.5, fontWeight: '800', color: COLORS.textSecondary },
  balValue: { fontSize: 15, fontWeight: '800', color: COLORS.textPrimary },
  colWrap: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginTop: 8 },
  colChip: { paddingHorizontal: 9, paddingVertical: 5, borderRadius: 7, backgroundColor: COLORS.primary + '18', borderWidth: 1, borderColor: COLORS.primary + '44' },
  colChipText: { fontSize: 10.5, fontWeight: '700', color: COLORS.primary },
  importBtn: { marginTop: 16 },
  sumGrid: { flexDirection: 'row', marginTop: 10 },
  sumCell: { flex: 1, alignItems: 'center' },
  sumValue: { fontSize: 20, fontWeight: '800' },
  sumLabel: { fontSize: 10.5, color: COLORS.textSecondary },
  errTitle: { fontSize: 12.5, fontWeight: '800', color: COLORS.error, marginTop: 14, marginBottom: 6 },
  errRow: { paddingVertical: 6, paddingHorizontal: 8, borderRadius: 8, backgroundColor: `${COLORS.error}0D`, marginBottom: 4 },
  errRowText: { fontSize: 11, color: COLORS.textSecondary },
  okText: { fontSize: 12, color: COLORS.success, marginTop: 12 },
  addBtn: { flexDirection: 'row', alignItems: 'center', gap: 4, paddingHorizontal: 12, paddingVertical: 7, borderRadius: 9, backgroundColor: COLORS.primary },
  addBtnText: { fontSize: 12, fontWeight: '700', color: '#FFFFFF' },
  typeRow: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingVertical: 9, borderBottomWidth: 1, borderBottomColor: COLORS.divider },
  typeDot: { width: 8, height: 8, borderRadius: 4 },
  typeCode: { fontSize: 13, fontWeight: '800', color: COLORS.textPrimary, minWidth: 36 },
  typeName: { fontSize: 12.5, color: COLORS.textSecondary },
  typeInactive: { fontSize: 10, color: COLORS.textTertiary },
  toggleRow: { flexDirection: 'row', alignItems: 'center', gap: 12, marginTop: 8 },
  toggleTrack: { width: 44, height: 24, borderRadius: 12, backgroundColor: COLORS.border, justifyContent: 'center', padding: 2 },
  toggleThumb: { width: 20, height: 20, borderRadius: 10, backgroundColor: '#FFFFFF' },
  toggleThumbOn: { marginLeft: 20 },
  toggleTitle: { fontSize: 13, fontWeight: '700', color: COLORS.textPrimary },
  modalBackdrop: { flex: 1, backgroundColor: 'rgba(15,23,42,0.45)', justifyContent: 'flex-end' },
  sheet: { backgroundColor: COLORS.surface, borderTopLeftRadius: 18, borderTopRightRadius: 18, paddingBottom: 10 },
  sheetHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', padding: 16, borderBottomWidth: 1, borderBottomColor: COLORS.border },
  sheetTitle: { fontSize: 15.5, fontWeight: '800', color: COLORS.textPrimary },
  sheetBody: { padding: 16 },
  sheetFooter: { flexDirection: 'row', gap: 10, marginTop: 18 },
  label: { fontSize: 12, fontWeight: '700', color: COLORS.textPrimary, marginBottom: 6, marginTop: 12 },
  req: { color: COLORS.error },
  input: {
    backgroundColor: COLORS.surfaceVariant, borderWidth: 1, borderColor: COLORS.border, borderRadius: 10,
    paddingHorizontal: 12, paddingVertical: 10, fontSize: 13.5, color: COLORS.textPrimary,
    ...(Platform.OS === 'web' ? { outlineStyle: 'none' } : null),
  },
  errInline: { fontSize: 11.5, color: COLORS.error, marginTop: 8 },
});

export default HRLeaveManagementScreen;
