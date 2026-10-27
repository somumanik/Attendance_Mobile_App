// ============================================================================
// FILE: mobile/src/screens/hr/HRSalaryManagementScreen.jsx
// PURPOSE: HR Admin Salary import + Full & Final rules/dues management (Phase K)
// ============================================================================

/**
 * Ye screen HR Admin ka Salary / Settlement management hai.
 *
 * Navigation Flow:
 * HRNavigator (Salary Tab) -> HRSalaryManagementScreen
 *
 * Data Flow (real backend data, no mock values):
 *   GET/POST /api/hr/salary/master (+ /import)   -> Dataset A salary rows
 *   GET/POST /api/hr/salary/elements (+ /import)  -> Dataset B pay elements
 *   GET/PUT  /api/hr/salary/config                -> settlement rules
 *   GET/POST /api/hr/salary/dues (+ /:id/decision)-> other dues / recoveries
 *   GET      /api/hr/salary/fullfinal/:paycode    -> admin estimate preview
 *
 * EXCEL IMPORT: the workbook is PARSED HERE but VALIDATED ON THE SERVER against
 * the real active roster. The summary always shows Imported / Updated / Skipped
 * / Failed with per-row error details - an invalid row is never silently dropped.
 *
 * SECURITY: every route requires the HR role server-side (requireRole('HR')).
 * STORAGE: all data is application-owned (dbo.HR_Salary*); no Savior table is
 * created, altered or written.
 */

import React, { useState, useEffect, useCallback } from 'react';
import {
  View, Text, ScrollView, StyleSheet, TouchableOpacity, TextInput, ActivityIndicator, RefreshControl, Platform,
} from 'react-native';
import * as DocumentPicker from 'expo-document-picker';
import * as FileSystem from 'expo-file-system';
import * as XLSX from 'xlsx';
import { Ionicons } from '@expo/vector-icons';
import { COLORS } from '../../utils/colors';
import { ScreenContainer } from '../../components/ScreenContainer';
import { Button } from '../../components/Button';
import { Can } from '../../components/Can';
import {
  getHrSalaryMaster, importHrSalaryMaster, getHrSalaryElements, importHrSalaryElements,
  getHrSalaryConfig, saveHrSalaryConfig, getHrSalaryDues, createHrSalaryDue, decideHrSalaryDue,
  getHrFullFinal, SALARY_MASTER_COLUMNS, SALARY_ELEMENT_COLUMNS,
  normaliseSalaryMasterRow, normaliseSalaryElementRow,
} from '../../services/salary';
import { HRSalaryStructureSection } from './HRSalaryStructureSection';

const clean = (v) => String(v == null ? '' : v).trim();
const PLACEHOLDER = '—';
const money = (v) => (v === null || v === undefined || v === '' || Number.isNaN(Number(v)))
  ? PLACEHOLDER : `Rs ${Number(v).toLocaleString('en-IN', { maximumFractionDigits: 2 })}`;

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

const CONFIG_FIELDS = [
  ['GratuityEnabled', 'Gratuity enabled (Y/N)'],
  ['GratuityDaysPerYear', 'Gratuity days per year'],
  ['GratuityWageDivisor', 'Gratuity wage divisor'],
  ['GratuityQualifyingYears', 'Gratuity qualifying years'],
  ['GratuityWageBasis', 'Gratuity wage basis (BASIC/GROSS)'],
  ['BonusEnabled', 'Bonus enabled (Y/N)'],
  ['BonusPeriodStart', 'Bonus period start (YYYY-MM-DD)'],
  ['BonusPeriodEnd', 'Bonus period end (YYYY-MM-DD)'],
  ['BonusRule', 'Bonus rule (FIXED/PERCENTAGE_BASIC/PERCENTAGE_GROSS)'],
  ['BonusRate', 'Bonus rate / amount'],
  ['BonusEligibilityMinMonths', 'Bonus min service months'],
  ['BonusProrate', 'Bonus prorate (Y/N)'],
  ['LeaveEncashmentEnabled', 'Leave encashment enabled (Y/N)'],
  ['LeaveEncashmentTypesFactory', 'Encash types - Factory Staff (CSV)'],
  ['LeaveEncashmentTypesOffice', 'Encash types - Office Staff (CSV)'],
  ['LeaveEncashmentTypesDefault', 'Encash types - Default (CSV)'],
  ['LeaveEncashmentBasis', 'Encashment salary basis (BASIC/GROSS)'],
  ['LeaveEncashmentWageDivisor', 'Encashment wage divisor'],
  ['LeaveEncashmentMaxDays', 'Encashment max days (0 = no cap)'],
  ['NoticePeriodDays', 'Notice period (days)'],
  ['NoticeSalaryBasis', 'Notice salary basis (BASIC/GROSS)'],
  ['NoticeWageDivisor', 'Notice wage divisor'],
  ['PFRateEmployee', 'PF rate employee (%)'],
  ['PFRateEmployer', 'PF rate employer (%)'],
  ['PFWageBasis', 'PF wage basis (PF_WAGE/BASIC)'],
  ['ESIRateEmployee', 'ESI rate employee (%)'],
  ['ESIRateEmployer', 'ESI rate employer (%)'],
  ['ESIWageBasis', 'ESI wage basis (ESI_WAGE/BASIC)'],
  ['ESIWageCeiling', 'ESI wage ceiling (0 = none)'],
];

export const HRSalaryManagementScreen = () => {
  const [activeTab, setActiveTab] = useState('import');
  const [loading, setLoading] = useState(true);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [error, setError] = useState(null);

  const [master, setMaster] = useState([]);
  const [elements, setElements] = useState([]);
  const [config, setConfig] = useState(null);
  const [configDraft, setConfigDraft] = useState({});
  const [savingConfig, setSavingConfig] = useState(false);
  const [configMsg, setConfigMsg] = useState('');

  const [dues, setDues] = useState([]);
  const [dueForm, setDueForm] = useState({ paycode: '', category: 'DUE', kind: '', description: '', amount: '' });
  const [dueError, setDueError] = useState('');

  const [importing, setImporting] = useState(null); // 'master' | 'elements'
  const [importSummary, setImportSummary] = useState(null);
  const [importError, setImportError] = useState(null);

  const [estimatePaycode, setEstimatePaycode] = useState('');
  const [estimateLeaving, setEstimateLeaving] = useState('');
  const [estimateNotice, setEstimateNotice] = useState('');
  const [estimate, setEstimate] = useState(null);
  const [estimateError, setEstimateError] = useState(null);
  const [estimating, setEstimating] = useState(false);

  const load = useCallback(async (isRefresh) => {
    if (isRefresh) setIsRefreshing(true);
    setError(null);
    try {
      const [m, e, cfg, d] = await Promise.all([
        getHrSalaryMaster({ limit: 300 }).catch(() => []),
        getHrSalaryElements({ limit: 500 }).catch(() => []),
        getHrSalaryConfig().catch(() => null),
        getHrSalaryDues({ limit: 300 }).catch(() => []),
      ]);
      setMaster(m);
      setElements(e);
      setConfig(cfg);
      setConfigDraft(cfg || {});
      setDues(d);
    } catch (err) {
      setError(err?.response?.data?.message || err?.message || 'Salary data load nahi ho paya.');
    } finally {
      setLoading(false);
      setIsRefreshing(false);
    }
  }, []);

  useEffect(() => { load(false); }, [load]);

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
    if (typeof fetch === 'function') {
      const res = await fetch(asset.uri);
      return new Uint8Array(await res.arrayBuffer());
    }
    const b64 = await FileSystem.readAsStringAsync(asset.uri, { encoding: FileSystem.EncodingType.Base64 });
    return base64ToBytes(String(b64 || ''));
  };

  const handlePickAndImport = async (kind) => {
    if (importing) return;
    setImporting(kind);
    setImportError(null);
    setImportSummary(null);
    try {
      const picked = await DocumentPicker.getDocumentAsync({
        type: ['application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
          'application/vnd.ms-excel', 'application/octet-stream', 'text/csv', '*/*'],
        copyToCacheDirectory: true,
        multiple: false,
      });
      if (picked?.canceled) return;
      const asset = picked?.assets?.[0];
      if (!asset) throw new Error('No file selected.');

      const bytes = await readPickedBytes(asset);
      const wb = XLSX.read(bytes, { type: 'array', cellDates: false });
      const sheet = wb.Sheets[wb.SheetNames[0]];
      if (!sheet) throw new Error('Workbook me koi sheet nahi mili.');
      const raw = XLSX.utils.sheet_to_json(sheet, { defval: '', raw: true });
      if (!Array.isArray(raw) || !raw.length) throw new Error('Sheet khaali hai - koi row nahi mili.');

      // Normalise headers here; all VALUE validation happens on the server.
      const rows = raw.map(kind === 'master' ? normaliseSalaryMasterRow : normaliseSalaryElementRow);
      const summary = kind === 'master'
        ? await importHrSalaryMaster(rows)
        : await importHrSalaryElements(rows);
      setImportSummary(summary);
      load(false);
    } catch (err) {
      setImportError(err?.response?.data?.message || err?.message || 'File read/import nahi ho paya.');
    } finally {
      setImporting(null);
    }
  };

  /* ------------------------- rules config ------------------------- */

  const saveConfig = async () => {
    if (savingConfig) return;
    setSavingConfig(true);
    setConfigMsg('');
    try {
      const patch = {};
      for (const [key] of CONFIG_FIELDS) patch[key] = clean(configDraft[key]);
      const saved = await saveHrSalaryConfig(patch);
      setConfig(saved);
      setConfigDraft(saved || {});
      setConfigMsg('Rules saved.');
    } catch (err) {
      setConfigMsg(err?.response?.data?.message || err?.message || 'Rules save nahi ho paye.');
    } finally {
      setSavingConfig(false);
    }
  };

  /* ---------------------------- dues ------------------------------ */

  const addDue = async () => {
    setDueError('');
    try {
      await createHrSalaryDue({ ...dueForm, amount: Number(dueForm.amount) });
      setDueForm({ paycode: '', category: 'DUE', kind: '', description: '', amount: '' });
      load(false);
    } catch (err) {
      setDueError(err?.response?.data?.message || err?.message || 'Entry add nahi ho payi.');
    }
  };

  const decideDue = async (row, decision) => {
    try {
      await decideHrSalaryDue(row.id, decision, '');
      load(false);
    } catch (err) {
      setDueError(err?.response?.data?.message || err?.message || 'Decision fail ho gaya.');
    }
  };

  /* -------------------------- estimate ---------------------------- */

  const runEstimate = async () => {
    if (!clean(estimatePaycode)) return;
    setEstimating(true);
    setEstimateError(null);
    setEstimate(null);
    try {
      const res = await getHrFullFinal(estimatePaycode, {
        leavingdate: clean(estimateLeaving) || undefined,
        noticeServedDays: clean(estimateNotice) || undefined,
      });
      setEstimate(res);
    } catch (err) {
      setEstimateError(err?.response?.data?.message || err?.message || 'Estimate load nahi ho paya.');
    } finally {
      setEstimating(false);
    }
  };

  const TABS = [
    ['import', 'Import', 'cloud-upload'],
    ['master', 'Salary Data', 'server'],
    ['rules', 'Rules', 'options'],
    ['dues', 'Dues', 'swap-horizontal'],
    ['estimate', 'Estimate', 'calculator'],
    ['structure', 'Structure', 'layers'],
  ];

  const renderImportSummary = () => {
    if (!importSummary) return null;
    const s = importSummary;
    return (
      <View style={styles.card}>
        <Text style={styles.cardTitle}>Import Summary</Text>
        <View style={styles.sumGrid}>
          {[
            ['Imported', s.imported, '#059669'],
            ['Updated', s.updated, '#2563EB'],
            ['Skipped', s.skipped, '#D97706'],
            ['Failed', s.failed, '#DC2626'],
          ].map(([label, value, color]) => (
            <View key={label} style={styles.sumCell}>
              <Text style={[styles.sumValue, { color }]}>{value || 0}</Text>
              <Text style={styles.sumLabel}>{label}</Text>
            </View>
          ))}
        </View>
        {(s.warnings || []).length ? (
          <Text style={styles.hint}>{`Warning (${s.warnings.length}): ${s.warnings.slice(0, 2).join(' | ')}${s.warnings.length > 2 ? ' ...' : ''}`}</Text>
        ) : null}
        {Array.isArray(s.results) && s.results.length ? (
          <Text style={styles.hint}>{s.results.length} row(s) processed. Details:</Text>
        ) : null}
        {(s.results || []).slice(0, 30).map((r, i) => (
          <View key={`${r.row}-${i}`} style={styles.errRow}>
            <Text style={styles.errRowText}>
              {`Row ${r.row}: ${clean(r.employeeCode) || PLACEHOLDER} - ${r.status}`}
              {r.status === 'Failed' ? ` - ${clean(r.message)}` : ''}
              {r.payelementcode ? ` (${clean(r.payelementcode)})` : ''}
            </Text>
          </View>
        ))}
        {(s.errors || []).length > 30 ? (
          <Text style={styles.hint}>{`... aur ${s.errors.length - 30} error(s).`}</Text>
        ) : null}
      </View>
    );
  };

  return (
    <ScreenContainer title="Salary & Settlement" showHeader={true}>
      <View style={styles.tabRow}>
        {TABS.map(([id, label, icon]) => {
          const active = activeTab === id;
          return (
            <TouchableOpacity key={id} style={[styles.tab, active && styles.tabActive]} onPress={() => setActiveTab(id)}>
              <Ionicons name={icon} size={14} color={active ? '#FFFFFF' : COLORS.textSecondary} />
              <Text style={[styles.tabText, active && styles.tabTextActive]}>{label}</Text>
            </TouchableOpacity>
          );
        })}
      </View>

      <ScrollView
        refreshControl={<RefreshControl refreshing={isRefreshing} onRefresh={() => load(true)} colors={[COLORS.primary]} />}
        contentContainerStyle={styles.scroll}
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
      >
        {loading && activeTab !== 'structure' ? (
          <View style={styles.stateBox}>
            <ActivityIndicator size="large" color={COLORS.primary} />
            <Text style={styles.stateText}>Loading salary data...</Text>
          </View>
        ) : null}

        {!loading && error && activeTab !== 'structure' ? (
          <View style={styles.errorBox}>
            <Text style={styles.errorText}><Ionicons name="alert-circle" size={13} /> {error}</Text>
            <Button title="Retry" onPress={() => load(false)} variant="outline" size="small" />
          </View>
        ) : null}

        {/* =========================== STRUCTURE (V1) =========================== */}
        {activeTab === 'structure' ? <HRSalaryStructureSection /> : null}

        {/* ============================ IMPORT ============================ */}
        {!loading && !error && activeTab === 'import' ? (
          <>
            <View style={styles.card}>
              <Text style={styles.cardTitle}>Dataset A - Salary Master</Text>
              <Text style={styles.hint}>Expected columns (order/casing koi bhi chalega):</Text>
              <View style={styles.colWrap}>
                {SALARY_MASTER_COLUMNS.map((c) => (
                  <View key={c} style={styles.colChip}><Text style={styles.colChipText}>{c}</Text></View>
                ))}
              </View>
              <Can module="salary" action="import">
                <Button
                  title={importing === 'master' ? 'Reading file...' : 'Import Salary Master'}
                  onPress={() => handlePickAndImport('master')}
                  variant="primary"
                  size="small"
                  disabled={!!importing}
                  leftIcon={<Ionicons name="document-text" size={14} color="#FFFFFF" />}
                  style={styles.importBtn}
                />
              </Can>
            </View>

            <View style={styles.card}>
              <Text style={styles.cardTitle}>Dataset B - Pay Elements</Text>
              <Text style={styles.hint}>Expected columns:</Text>
              <View style={styles.colWrap}>
                {SALARY_ELEMENT_COLUMNS.map((c) => (
                  <View key={c} style={styles.colChip}><Text style={styles.colChipText}>{c}</Text></View>
                ))}
              </View>
              <Can module="salary" action="import">
                <Button
                  title={importing === 'elements' ? 'Reading file...' : 'Import Pay Elements'}
                  onPress={() => handlePickAndImport('elements')}
                  variant="primary"
                  size="small"
                  disabled={!!importing}
                  leftIcon={<Ionicons name="document-text" size={14} color="#FFFFFF" />}
                  style={styles.importBtn}
                />
              </Can>
            </View>

            {importError ? (
              <View style={styles.errorBox}><Text style={styles.errorText}><Ionicons name="alert-circle" size={13} /> {importError}</Text></View>
            ) : null}
            {renderImportSummary()}
          </>
        ) : null}

        {/* ========================= SALARY DATA ========================= */}
        {!loading && !error && activeTab === 'master' ? (
          <>
            <Text style={styles.sectionHint}>{`${master.length} salary row(s), ${elements.length} pay element(s) loaded.`}</Text>
            {master.length ? master.map((m) => (
              <View key={`${m.paycode}-${m.effectivefrom}`} style={styles.card}>
                <View style={styles.rowTop}>
                  <View style={styles.flex}>
                    <Text style={styles.empName}>{clean(m.empname) || clean(m.paycode)}</Text>
                    <Text style={styles.empMeta}>{`${clean(m.paycode)} · from ${clean(m.effectivefrom)}`}</Text>
                  </View>
                  <Text style={styles.basicValue}>{money(m.basicsalary)}</Text>
                </View>
                <Text style={styles.empMeta}>
                  {`PF: ${m.pfapplicable ? `Y (wage ${money(m.pfwage)})` : 'N'} · ESI: ${m.esiapplicable ? `Y (wage ${money(m.esiwage)})` : 'N'}`}
                </Text>
                {elements.filter((e) => e.paycode === m.paycode).map((e) => (
                  <View key={`${e.payelementcode}-${e.effectivefrom}`} style={styles.elemRow}>
                    <Text style={styles.elemName}>{`${clean(e.payelementcode)} · ${clean(e.payelementname)}`}</Text>
                    <Text style={styles.elemMeta}>
                      {`${clean(e.payelementtype)} · ${clean(e.calculationtype)}${e.calculationtype === 'FIXED' ? ` ${money(e.amount)}` : ` ${e.percentage}% of ${clean(e.percentagebase)}`} · from ${clean(e.effectivefrom)}`}
                    </Text>
                  </View>
                ))}
              </View>
            )) : (
              <View style={styles.card}>
                <Text style={styles.emptyTitle}>Koi salary row nahi hai</Text>
                <Text style={styles.emptyText}>Import tab se Dataset A / B import karein.</Text>
              </View>
            )}
          </>
        ) : null}

        {/* ============================ RULES ============================= */}
        {!loading && !error && activeTab === 'rules' ? (
          <View style={styles.card}>
            <Text style={styles.cardTitle}>Settlement Rules (configurable)</Text>
            <Text style={styles.hint}>
              Gratuity, bonus period, encashment, notice, PF aur ESI ke rules yahan configure hote hain.
              Koi month ya formula hardcoded nahi hai.
            </Text>
            {CONFIG_FIELDS.map(([key, label]) => (
              <View key={key}>
                <Text style={styles.label}>{label}</Text>
                <TextInput
                  style={styles.input}
                  value={clean(configDraft[key])}
                  onChangeText={(v) => setConfigDraft({ ...configDraft, [key]: v })}
                  placeholder={clean(config && config[key]) || ''}
                  autoCapitalize="characters"
                  autoCorrect={false}
                />
              </View>
            ))}
            {configMsg ? <Text style={styles.configMsg}>{configMsg}</Text> : null}
            <Can module="salary" action="edit">
              <Button
                title={savingConfig ? 'Saving...' : 'Save Rules'}
                onPress={saveConfig}
                variant="primary"
                size="medium"
                disabled={savingConfig}
                style={styles.importBtn}
              />
            </Can>
          </View>
        ) : null}


        {/* ============================= DUES ============================= */}
        {!loading && !error && activeTab === 'dues' ? (
          <>
            <View style={styles.card}>
              <Text style={styles.cardTitle}>Add Other Dues / Recovery</Text>
              <Text style={styles.label}>Employee Code</Text>
              <TextInput style={styles.input} value={dueForm.paycode} onChangeText={(v) => setDueForm({ ...dueForm, paycode: v })} placeholder="e.g. 0002" autoCapitalize="none" />
              <Text style={styles.label}>Category</Text>
              <View style={styles.chipRow}>
                {['DUE', 'RECOVERY'].map((c) => (
                  <TouchableOpacity key={c} style={[styles.chip, dueForm.category === c && styles.chipActive]} onPress={() => setDueForm({ ...dueForm, category: c })}>
                    <Text style={[styles.chipText, dueForm.category === c && styles.chipTextActive]}>{c}</Text>
                  </TouchableOpacity>
                ))}
              </View>
              <Text style={styles.label}>Kind (arrears, incentive, loan, asset recovery...)</Text>
              <TextInput style={styles.input} value={dueForm.kind} onChangeText={(v) => setDueForm({ ...dueForm, kind: v })} placeholder="e.g. arrears" />
              <Text style={styles.label}>Description</Text>
              <TextInput style={styles.input} value={dueForm.description} onChangeText={(v) => setDueForm({ ...dueForm, description: v })} placeholder="Details..." />
              <Text style={styles.label}>Amount</Text>
              <TextInput style={styles.input} value={dueForm.amount} onChangeText={(v) => setDueForm({ ...dueForm, amount: v })} placeholder="0.00" keyboardType="decimal-pad" />
              {dueError ? <Text style={styles.configMsg}><Ionicons name="alert-circle" size={13} /> {dueError}</Text> : null}
              <Can module="salary" action="create">
                <Button title="Add Entry" onPress={addDue} variant="primary" size="small" style={styles.importBtn} />
              </Can>
            </View>

            {dues.length ? dues.map((d) => (
              <View key={d.id} style={styles.card}>
                <View style={styles.rowTop}>
                  <View style={styles.flex}>
                    <Text style={styles.empName}>{`${clean(d.empname) || clean(d.paycode)} · ${clean(d.kind)}`}</Text>
                    <Text style={styles.empMeta}>{`${clean(d.paycode)} · ${clean(d.category)} · ${clean(d.status)}`}</Text>
                  </View>
                  <Text style={styles.basicValue}>{money(d.amount)}</Text>
                </View>
                {clean(d.description) ? <Text style={styles.empMeta}>{clean(d.description)}</Text> : null}
                {clean(d.status) === 'Pending' ? (
                  <View style={styles.chipRow}>
                    <Can module="salary" action="approve">
                      <Button title="Approve" onPress={() => decideDue(d, 'Approved')} variant="primary" size="small" style={styles.flexBtn} />
                      <Button title="Reject" onPress={() => decideDue(d, 'Rejected')} variant="outline" size="small" style={styles.flexBtn} />
                    </Can>
                  </View>
                ) : null}
              </View>
            )) : (
              <View style={styles.card}>
                <Text style={styles.emptyTitle}>Koi dues/recovery entry nahi hai</Text>
              </View>
            )}
          </>
        ) : null}


        {/* =========================== ESTIMATE =========================== */}
        {!loading && !error && activeTab === 'estimate' ? (
          <>
            <View style={styles.card}>
              <Text style={styles.cardTitle}>Full &amp; Final Estimate Preview</Text>
              <Text style={styles.label}>Employee Code</Text>
              <TextInput style={styles.input} value={estimatePaycode} onChangeText={setEstimatePaycode} placeholder="e.g. 0002" autoCapitalize="none" />
              <Text style={styles.label}>Leaving Date (optional, YYYY-MM-DD)</Text>
              <TextInput style={styles.input} value={estimateLeaving} onChangeText={setEstimateLeaving} placeholder="2026-12-31" />
              <Text style={styles.label}>Notice Served Days (optional)</Text>
              <TextInput style={styles.input} value={estimateNotice} onChangeText={setEstimateNotice} placeholder="e.g. 30" keyboardType="number-pad" />
              <Can module="fullfinal" action="view">
                <Button title={estimating ? 'Calculating...' : 'Run Estimate'} onPress={runEstimate} variant="primary" size="small" disabled={estimating || !clean(estimatePaycode)} style={styles.importBtn} />
              </Can>
              {estimateError ? <Text style={styles.configMsg}><Ionicons name="alert-circle" size={13} /> {estimateError}</Text> : null}
            </View>

            {estimate ? (
              <View style={styles.card}>
                <Text style={styles.cardTitle}>
                  {`${clean(estimate.employee?.empname) || clean(estimate.employee?.paycode)} - Estimate`}
                </Text>
                {!estimate.salary?.available ? (
                  <Text style={styles.configMsg}>{clean(estimate.salary?.reason)}</Text>
                ) : (
                  <>
                    <Text style={styles.empMeta}>
                      {`Basic ${money(estimate.salary.basic)} · Gross ${money(estimate.salary.gross)} · salary from ${clean(estimate.salary.effectivefrom)}`}
                    </Text>
                    {[
                      ['Gratuity', estimate.estimate?.gratuity?.amount, estimate.estimate?.gratuity?.basisText],
                      ['Bonus', estimate.estimate?.bonus?.amount, estimate.estimate?.bonus?.basisText],
                      ['Leave Encashment', estimate.estimate?.leaveEncashment?.amount, estimate.estimate?.leaveEncashment?.basisText],
                      ['Notice Pay', estimate.estimate?.notice?.payAmount, estimate.estimate?.notice?.basisText],
                      ['Other Dues', estimate.estimate?.otherDues?.total, 'approved dues'],
                      ['Notice Recovery', -(Number(estimate.estimate?.notice?.recoveryAmount) || 0), estimate.estimate?.notice?.basisText],
                      ['Other Recoveries', -(Number(estimate.estimate?.otherRecoveries?.total) || 0), 'approved recoveries'],
                      ['Employee Deductions', -(Number(estimate.estimate?.employeeDeductions?.total) || 0), 'pay elements + employee PF/ESI'],
                    ].map(([label, value, basis]) => (
                      <View key={label} style={styles.amountRow}>
                        <View style={styles.flex}>
                          <Text style={styles.amountLabel}>{label}</Text>
                          {basis ? <Text style={styles.amountBasis}>{basis}</Text> : null}
                        </View>
                        <Text style={styles.amountValue}>{money(value)}</Text>
                      </View>
                    ))}
                    <View style={styles.totalRow}>
                      <Text style={styles.totalLabel}>Estimated Full &amp; Final</Text>
                      <Text style={styles.totalValue}>{money(estimate.estimate?.estimatedTotal)}</Text>
                    </View>
                    <Text style={styles.hint}>{estimate.estimate?.formula}</Text>
                    <Text style={styles.hint}>{estimate.estimate?.disclaimer}</Text>
                  </>
                )}
              </View>
            ) : null}
          </>
        ) : null}
      </ScrollView>
    </ScreenContainer>
  );
};

export default HRSalaryManagementScreen;


const styles = StyleSheet.create({
  flex: { flex: 1 },
  tabRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, paddingHorizontal: 12, paddingTop: 10 },
  tab: { flexDirection: 'row', alignItems: 'center', gap: 4, paddingHorizontal: 10, paddingVertical: 7, borderRadius: 999, borderWidth: 1, borderColor: COLORS.border },
  tabActive: { backgroundColor: COLORS.primary, borderColor: COLORS.primary },
  tabText: { fontSize: 11, fontWeight: '700', color: COLORS.textSecondary },
  tabTextActive: { color: '#FFFFFF' },
  scroll: { padding: 12, paddingBottom: 28 },
  stateBox: { paddingVertical: 40, alignItems: 'center', gap: 10 },
  stateText: { fontSize: 13, color: COLORS.textSecondary },
  card: { borderRadius: 12, borderWidth: 1, borderColor: COLORS.border, backgroundColor: COLORS.surface, padding: 14, marginBottom: 12 },
  cardTitle: { fontSize: 13.5, fontWeight: '800', color: COLORS.textPrimary, marginBottom: 8 },
  hint: { fontSize: 10.5, color: COLORS.textSecondary, marginTop: 6 },
  sectionHint: { fontSize: 11, color: COLORS.textSecondary, marginBottom: 8 },
  errorBox: { borderRadius: 10, borderWidth: 1, borderColor: COLORS.error, padding: 12, gap: 8, marginBottom: 12 },
  errorText: { fontSize: 12, color: COLORS.error },
  colWrap: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginTop: 8 },
  colChip: { paddingHorizontal: 8, paddingVertical: 4, borderRadius: 6, backgroundColor: COLORS.primary + '18', borderWidth: 1, borderColor: COLORS.primary + '44' },
  colChipText: { fontSize: 10, fontWeight: '700', color: COLORS.primary },
  importBtn: { marginTop: 12 },
  sumGrid: { flexDirection: 'row', marginTop: 10 },
  sumCell: { flex: 1, alignItems: 'center' },
  sumValue: { fontSize: 20, fontWeight: '800' },
  sumLabel: { fontSize: 10.5, color: COLORS.textSecondary },
  errRow: { paddingVertical: 5, paddingHorizontal: 8, borderRadius: 6, backgroundColor: COLORS.surfaceVariant, marginTop: 4 },
  errRowText: { fontSize: 10.5, color: COLORS.textSecondary },
  rowTop: { flexDirection: 'row', alignItems: 'flex-start', gap: 10 },
  empName: { fontSize: 13, fontWeight: '700', color: COLORS.textPrimary },
  empMeta: { fontSize: 10.5, color: COLORS.textSecondary, marginTop: 2 },
  basicValue: { fontSize: 13, fontWeight: '800', color: COLORS.textPrimary },
  elemRow: { marginTop: 6, paddingTop: 6, borderTopWidth: 1, borderTopColor: COLORS.divider },
  elemName: { fontSize: 11, fontWeight: '700', color: COLORS.textPrimary },
  elemMeta: { fontSize: 10, color: COLORS.textSecondary, marginTop: 1 },
  label: { fontSize: 11.5, fontWeight: '700', color: COLORS.textPrimary, marginTop: 10, marginBottom: 4 },
  input: {
    backgroundColor: COLORS.surfaceVariant, borderWidth: 1, borderColor: COLORS.border, borderRadius: 8,
    paddingHorizontal: 10, paddingVertical: 8, fontSize: 12.5, color: COLORS.textPrimary,
    ...(Platform.OS === 'web' ? { outlineStyle: 'none' } : null),
  },
  configMsg: { fontSize: 11, color: COLORS.error, marginTop: 8 },
  chipRow: { flexDirection: 'row', gap: 8, marginTop: 4 },
  chip: { paddingHorizontal: 12, paddingVertical: 6, borderRadius: 999, borderWidth: 1, borderColor: COLORS.border },
  chipActive: { backgroundColor: COLORS.primary, borderColor: COLORS.primary },
  chipText: { fontSize: 11, fontWeight: '700', color: COLORS.textSecondary },
  chipTextActive: { color: '#FFFFFF' },
  flexBtn: { flex: 1 },
  amountRow: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingVertical: 7, borderTopWidth: 1, borderTopColor: COLORS.divider },
  amountLabel: { fontSize: 12, fontWeight: '600', color: COLORS.textPrimary },
  amountBasis: { fontSize: 9.5, color: COLORS.textTertiary, marginTop: 1 },
  amountValue: { fontSize: 12, fontWeight: '800', color: COLORS.textPrimary },
  totalRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginTop: 10, paddingTop: 10, borderTopWidth: 1, borderTopColor: COLORS.border },
  totalLabel: { fontSize: 13, fontWeight: '800', color: COLORS.textPrimary },
  totalValue: { fontSize: 16, fontWeight: '800', color: COLORS.primary },
  emptyTitle: { fontSize: 12.5, fontWeight: '700', color: COLORS.textPrimary, textAlign: 'center', marginBottom: 4 },
  emptyText: { fontSize: 11, color: COLORS.textSecondary, textAlign: 'center' },
});
