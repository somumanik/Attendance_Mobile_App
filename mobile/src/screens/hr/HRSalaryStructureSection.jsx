// ============================================================================
// FILE: mobile/src/screens/hr/HRSalaryStructureSection.jsx
// PURPOSE: SALARY STRUCTURE V1 mobile UI (template/import/data/export).
// ============================================================================

/**
 * Rendered as the "Structure" tab of HRSalaryManagementScreen. All data flows
 * through the SAME shared backend as the Next.js website (see
 * services/salaryStructure.js): imports here are visible on the website and
 * vice versa. Import shows a preview before commit and only reports what the
 * server actually confirmed (Imported / Updated / Skipped / Failed).
 */

import React, { useState, useEffect, useCallback } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, TextInput, ActivityIndicator, Platform } from 'react-native';
import * as DocumentPicker from 'expo-document-picker';
import * as FileSystem from 'expo-file-system';
import * as XLSX from 'xlsx';
import { Ionicons } from '@expo/vector-icons';
import { COLORS } from '../../utils/colors';
import { Button } from '../../components/Button';
import { Can } from '../../components/Can';
import {
  getHrStructureMaster, getHrStructureElements, getHrPayElementMaster,
  importHrSalaryStructure, getHrSalaryStructureReport,
  downloadStructureTemplate, shareStructureExport,
  SALARY_STRUCTURE_MASTER_COLUMNS, SALARY_STRUCTURE_ELEMENT_COLUMNS, PAY_ELEMENT_MASTER_COLUMNS,
} from '../../services/salaryStructure';

const clean = (v) => String(v == null ? '' : v).trim();
const normHeader = (h) => String(h ?? '').toLowerCase().replace(/[^a-z0-9]/g, '');
const yn = (v) => (v === null || v === undefined ? '—' : (v ? 'Y' : 'N'));

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

async function readPickedBytes(asset) {
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
}

/** Multi-sheet parse mirroring the web workbook parser (sheet names + fallback). */
function parseStructureWorkbook(wb) {
  const out = { master: [], elements: [], payElementMaster: [], sheetWarnings: [] };
  const seen = new Set();
  for (const name of wb.SheetNames) {
    const ws = wb.Sheets[name];
    if (!ws) continue;
    const grid = XLSX.utils.sheet_to_json(ws, { header: 1, raw: true, defval: '' });
    if (!grid.length) continue;
    const lower = normHeader(name);
    let dataset = null;
    if (lower.includes('employeesalarymaster') || lower === 'master') dataset = 'master';
    else if (lower.includes('employeepayelements') || lower.includes('payelements')) dataset = 'elements';
    else if (lower.includes('payelementmaster')) dataset = 'payElementMaster';
    else if (lower.includes('readme') || lower.includes('instruction')) dataset = 'readme';
    if (dataset === 'readme') continue;
    if (!dataset) {
      const header = (grid[0] || []).map(normHeader);
      if (header.includes('payelementcode') && !header.includes('effectivefrom')) dataset = 'payElementMaster';
      else if (header.includes('payelementcode')) dataset = 'elements';
      else if (header.includes('paycode') || header.includes('employeecode')) dataset = 'master';
      else {
        out.sheetWarnings.push(`Sheet "${name}" unknown hai - skip kiya gaya (baaki sheets import hongi).`);
        continue;
      }
    }
    if (seen.has(dataset)) {
      out.sheetWarnings.push(`Sheet "${name}": ${dataset} pehle se aa chuka hai - skip.`);
      continue;
    }
    seen.add(dataset);
    let headerIdx = 0;
    for (let i = 0; i < Math.min(grid.length, 5); i += 1) {
      const joined = (grid[i] || []).map(normHeader).join('|');
      if (joined.includes('paycode') || joined.includes('employeecode') || joined.includes('payelementcode')) { headerIdx = i; break; }
    }
    const headerCells = grid[headerIdx] || [];
    for (let r = headerIdx + 1; r < grid.length; r += 1) {
      const row = grid[r];
      if (!row || row.join('').trim() === '') continue;
      const obj = { __row: r + 1 };
      headerCells.forEach((h, idx) => {
        const key = String(h ?? '').trim();
        if (key) obj[key] = row[idx];
      });
      out[dataset].push(obj);
    }
  }
  return out;
}

export const HRSalaryStructureSection = () => {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [master, setMaster] = useState([]);
  const [elements, setElements] = useState([]);
  const [codeMaster, setCodeMaster] = useState([]);
  const [search, setSearch] = useState('');

  const [parsed, setParsed] = useState(null);
  const [importing, setImporting] = useState(false);
  const [summaries, setSummaries] = useState(null);
  const [importError, setImportError] = useState('');
  const [busy, setBusy] = useState(''); // 'template' | 'exp-master' | 'exp-elements' | 'exp-codes' | 'exp-report'

  const load = useCallback(async () => {
    setError(null);
    try {
      const [m, e, c] = await Promise.all([
        getHrStructureMaster({ limit: 300 }).catch(() => []),
        getHrStructureElements({ limit: 500 }).catch(() => []),
        getHrPayElementMaster().catch(() => []),
      ]);
      setMaster(m);
      setElements(e);
      setCodeMaster(c);
    } catch (err) {
      setError(err?.message || 'Salary structure load nahi ho paya.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  /* ------------------------------ import ------------------------------ */

  const handlePick = async () => {
    if (importing) return;
    setImportError('');
    setSummaries(null);
    setParsed(null);
    try {
      const picked = await DocumentPicker.getDocumentAsync({
        type: ['application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
          'application/vnd.ms-excel', 'text/csv', '*/*'],
        copyToCacheDirectory: true,
        multiple: false,
      });
      if (picked?.canceled) return;
      const asset = picked?.assets?.[0];
      if (!asset) throw new Error('No file selected.');
      const bytes = await readPickedBytes(asset);
      const wb = XLSX.read(bytes, { type: 'array', cellDates: true });
      const result = parseStructureWorkbook(wb);
      const total = result.master.length + result.elements.length + result.payElementMaster.length;
      if (!total) {
        setImportError('Workbook me koi data row nahi mili.');
        return;
      }
      setParsed(result);
    } catch (err) {
      setImportError(err?.message || 'File read nahi ho payi.');
    }
  };

  const confirmImport = async () => {
    if (!parsed || importing) return;
    setImporting(true);
    setImportError('');
    try {
      const result = await importHrSalaryStructure(parsed);
      setSummaries(result);
      setParsed(null);
      load();
    } catch (err) {
      setImportError(err?.message || 'Import fail hua - koi data save nahi hua.');
    } finally {
      setImporting(false);
    }
  };

  /* ----------------------------- exports ------------------------------ */

  const runExport = async (kind) => {
    if (busy) return;
    setBusy(kind);
    setImportError('');
    try {
      if (kind === 'template') {
        await downloadStructureTemplate();
      } else if (kind === 'exp-master') {
        await shareStructureExport('employee-salary-master.xlsx',
          ['EmployeeCode', 'Paycode', 'BiometricCode', 'EmployeeName', 'CompanyCode', 'LocationCode', 'Department', 'Designation', 'EffectiveFrom', 'BasicSalary', 'PFApplicable', 'ESIApplicable', 'PFWage', 'ESIWage', 'Currency', 'Remarks'],
          master.map((r) => [r.employeecode, r.paycode, r.presentcardno, r.empname, r.companycode, r.locationcode, r.departmentcode, r.designation, r.effectivefrom, r.basicsalary, yn(r.pfapplicable), yn(r.esiapplicable), r.pfwage, r.esiwage, r.currency, r.remarks]));
      } else if (kind === 'exp-elements') {
        await shareStructureExport('employee-pay-elements.xlsx',
          ['Paycode', 'EmployeeCode', 'EmployeeName', 'CompanyCode', 'LocationCode', 'EffectiveFrom', 'PayElementCode', 'PayElementName', 'FixedOrPercent', 'Amount', 'Percent', 'ComputationType', 'AddOrDeduct', 'PFApplicable', 'PTApplicable', 'ESIApplicability', 'ApplicableForOT', 'ApplicableForCOff', 'PayCadre', 'ActivePayElement', 'Processed', 'PayrollPostingGroup', 'LeaveEncashment', 'Remarks'],
          elements.map((r) => [r.paycode, r.employeecode, r.empname, r.companycode, r.locationcode, r.effectivefrom, r.payelementcode, r.payelementname, r.fixedorpercent, r.amount, r.percent, r.computationtype, r.addordeduct, yn(r.pfapplicable), yn(r.ptapplicable), yn(r.esiapplicability), yn(r.applicableforot), yn(r.applicableforc), r.paycadre, yn(r.activepayelement), yn(r.processed), r.payrollpostinggroup, yn(r.leaveencashment), r.remarks]));
      } else if (kind === 'exp-codes') {
        const ynb = (v) => (v === null || v === undefined ? '' : v ? 'Y' : 'N');
        const ad = (v) => (v === 'ADD' ? 'Addition' : v === 'DEDUCT' ? 'Deduction' : (v || ''));
        await shareStructureExport('pay-element-master.xlsx',
          ['PayElementCode', 'Description', 'PayElementName', 'AddDeduct', 'ApplicableForOT', 'ESIApplicable', 'PFApplicable', 'LeaveEncashmentApplicable', 'PayrollPostingGroup', 'Remarks', 'Active'],
          codeMaster.map((r) => [r.payelementcode, r.description, r.payelementname, ad(r.addordeduct),
            ynb(r.applicableforot), ynb(r.esiapplicable), ynb(r.pfapplicable), ynb(r.leaveencashment),
            r.payrollpostinggroup, r.remarks, ynb(r.active)]));
      } else if (kind === 'exp-report') {
        const rep = await getHrSalaryStructureReport({});
        const codes = rep?.elementCodes || [];
        const rows = rep?.rows || [];
        const grossCol = rep?.grossColumnAvailable ? ['Gross Salary'] : [];
        await shareStructureExport('salary-structure-report.xlsx',
          ['Paycode', 'EmployeeCode', 'EmployeeName', 'CompanyCode', 'EffectiveFrom', 'Currency', ...codes, ...grossCol],
          rows.map((r) => [r.paycode, r.employeecode, r.empname, r.companycode, r.effectivefrom, r.currency,
            ...codes.map((c) => (r.cells && r.cells[c] != null ? r.cells[c] : '')),
            ...(grossCol.length ? [r.gross != null ? r.gross : ''] : [])]));
      }
    } catch (err) {
      setImportError(err?.message || 'Export fail ho gaya.');
    } finally {
      setBusy('');
    }
  };


  const filterNow = (list) => {
    const q = clean(search).toLowerCase();
    if (!q) return list;
    return list.filter((r) => [r.paycode, r.empname, r.payelementcode, r.payelementname, r.employeecode]
      .some((v) => clean(v).toLowerCase().includes(q)));
  };

  return (
    <View>
      {/* ---- Template + import ---- */}
      <View style={styles.card}>
        <Text style={styles.cardTitle}>Salary Structure — Template &amp; Import</Text>
        <Text style={styles.hint}>
          4-sheet template: EmployeeSalaryMaster, EmployeePayElements, PayElementMaster, ReadMe.
          Import se pehle preview; validation SERVER par (real roster ke against); counts backend
          ke actual response se. Template me koi example employee row nahi hai.
        </Text>
        <Can module="salary" action="import">
          <View style={styles.btnRow}>
            <Button
              title={busy === 'template' ? 'Preparing...' : 'Download Template'}
              onPress={() => runExport('template')}
              variant="outline"
              size="small"
              disabled={!!busy}
              leftIcon={<Ionicons name="download" size={14} color={COLORS.primary} />}
              style={styles.flexBtn}
            />
            <Button
              title={importing ? 'Importing...' : 'Import Workbook'}
              onPress={handlePick}
              variant="primary"
              size="small"
              disabled={!!importing}
              leftIcon={<Ionicons name="cloud-upload" size={14} color="#FFFFFF" />}
              style={styles.flexBtn}
            />
          </View>
        </Can>

        {importError ? (
          <View style={styles.errorBox}><Text style={styles.errorText}>{importError}</Text></View>
        ) : null}

        {parsed ? (
          <View style={styles.previewBox}>
            <Text style={styles.previewTitle}>Preview — Confirm se pehle</Text>
            <Text style={styles.hint}>
              {`EmployeeSalaryMaster: ${parsed.master.length} row(s) · EmployeePayElements: ${parsed.elements.length} row(s) · PayElementMaster: ${parsed.payElementMaster.length} row(s)`}
            </Text>
            {parsed.sheetWarnings.map((w, i) => (
              <Text key={i} style={styles.warnText}>{w}</Text>
            ))}
            <View style={styles.btnRow}>
              <Button title="Cancel" onPress={() => setParsed(null)} variant="outline" size="small" style={styles.flexBtn} />
              <Button
                title={importing ? 'Importing...' : `Confirm Import (${parsed.master.length + parsed.elements.length + parsed.payElementMaster.length})`}
                onPress={confirmImport}
                variant="primary"
                size="small"
                disabled={!!importing}
                style={styles.flexBtn}
              />
            </View>
          </View>
        ) : null}

        {summaries ? (
          <View style={styles.previewBox}>
            <Text style={styles.previewTitle}>Import Summary (server-confirmed)</Text>
            {[['EmployeeSalaryMaster', summaries.master], ['EmployeePayElements', summaries.elements], ['PayElementMaster', summaries.payElementMaster]].map(([label, s]) => (s ? (
              <View key={label} style={styles.sumBlock}>
                <Text style={styles.sumLabel}>{label}</Text>
                <View style={styles.sumGrid}>
                  {[['Imported', s.imported], ['Updated', s.updated], ['Skipped', s.skipped], ['Failed', s.failed]].map(([l, v]) => (
                    <View key={l} style={styles.sumCell}>
                      <Text style={styles.sumValue}>{v || 0}</Text>
                      <Text style={styles.sumCaption}>{l}</Text>
                    </View>
                  ))}
                </View>
                {(s.warnings || []).map((w, i) => (
                  <Text key={`w${i}`} style={styles.warnText}>{w}</Text>
                ))}
                {(s.errors || []).slice(0, 20).map((e, i) => (
                  <Text key={`e${i}`} style={styles.errorText}>
                    {`Row ${e.row ?? '—'}: ${clean(e.employeeCode) || '—'} — ${clean(e.message)}`}
                  </Text>
                ))}
              </View>
            ) : null))}
          </View>
        ) : null}
      </View>


      {/* ---- Saved data (shared records) ---- */}
      <View style={styles.card}>
        <Text style={styles.cardTitle}>Saved Salary Structure</Text>
        <TextInput
          style={styles.input}
          value={search}
          onChangeText={setSearch}
          placeholder="Search paycode / name / element..."
          autoCapitalize="none"
        />
        <Text style={styles.hint}>
          {`${master.length} salary version(s) · ${elements.length} pay element(s) · ${codeMaster.length} code(s). Website se import kiya data yahan (aur vice versa) dikhta hai.`}
        </Text>
        {loading ? <ActivityIndicator size="small" color={COLORS.primary} style={{ marginTop: 10 }} /> : null}
        {!loading && error ? <View style={styles.errorBox}><Text style={styles.errorText}>{error}</Text></View> : null}
        {!loading && !error ? (
          <>
            {filterNow(master).slice(0, 25).map((m, i) => (
              <View key={`m-${m.paycode}-${m.effectivefrom}-${i}`} style={styles.rowBox}>
                <Text style={styles.rowTitle}>{`${clean(m.empname) || clean(m.paycode)} · ${clean(m.paycode)}`}</Text>
                <Text style={styles.rowMeta}>
                  {`from ${clean(m.effectivefrom)} · Basic ${m.basicsalary ?? '—'} · PF ${yn(m.pfapplicable)} · ESI ${yn(m.esiapplicable)}${m.currency ? ` · ${clean(m.currency)}` : ''}${m.locationcode ? ` · loc ${clean(m.locationcode)}` : ''}`}
                </Text>
              </View>
            ))}
            {filterNow(elements).slice(0, 25).map((e, i) => (
              <View key={`e-${e.paycode}-${e.payelementcode}-${e.effectivefrom}-${i}`} style={styles.rowBox}>
                <Text style={styles.rowTitle}>{`${clean(e.paycode)} · ${clean(e.payelementcode)}${e.payelementname ? ` (${clean(e.payelementname)})` : ''}`}</Text>
                <Text style={styles.rowMeta}>
                  {`${clean(e.fixedorpercent) || '—'} · ${clean(e.addordeduct) || '—'} · ${e.amount !== null && e.amount !== undefined ? `Rs ${e.amount}` : ''}${e.percent !== null && e.percent !== undefined ? ` ${e.percent}% of ${clean(e.computationtype) || '?'}` : ''} · from ${clean(e.effectivefrom)}`}
                </Text>
              </View>
            ))}
            {!master.length && !elements.length ? (
              <Text style={styles.hint}>Koi saved record nahi — template download karke import karein.</Text>
            ) : null}
          </>
        ) : null}
      </View>

      {/* ---- Exports ---- */}
      <View style={styles.card}>
        <Text style={styles.cardTitle}>Exports (shared backend records)</Text>
        <Text style={styles.hint}>
          Dynamic report me pay element columns selected data ke actual codes ke union hote hain.
          Gross Salary sirf explicit GROSS source element par — positive amounts ka sum nahi, aur CTC nahi.
        </Text>
        <View style={styles.btnRow}>
          <Button title="Salary Master" onPress={() => runExport('exp-master')} variant="outline" size="small" disabled={!!busy || !master.length} style={styles.flexBtn} />
          <Button title="Pay Elements" onPress={() => runExport('exp-elements')} variant="outline" size="small" disabled={!!busy || !elements.length} style={styles.flexBtn} />
        </View>
        <View style={styles.btnRow}>
          <Button title="Element Master" onPress={() => runExport('exp-codes')} variant="outline" size="small" disabled={!!busy || !codeMaster.length} style={styles.flexBtn} />
          <Button title="Dynamic Report" onPress={() => runExport('exp-report')} variant="primary" size="small" disabled={!!busy} style={styles.flexBtn} />
        </View>
      </View>
    </View>
  );
};

export default HRSalaryStructureSection;

const styles = StyleSheet.create({
  card: { borderRadius: 12, borderWidth: 1, borderColor: COLORS.border, backgroundColor: COLORS.surface, padding: 14, marginBottom: 12 },
  cardTitle: { fontSize: 13.5, fontWeight: '800', color: COLORS.textPrimary, marginBottom: 8 },
  hint: { fontSize: 10.5, color: COLORS.textSecondary, marginTop: 6, lineHeight: 16 },
  input: {
    backgroundColor: COLORS.surfaceVariant, borderWidth: 1, borderColor: COLORS.border, borderRadius: 8,
    paddingHorizontal: 10, paddingVertical: 8, fontSize: 12.5, color: COLORS.textPrimary,
    ...(Platform.OS === 'web' ? { outlineStyle: 'none' } : null),
  },
  btnRow: { flexDirection: 'row', gap: 8, marginTop: 10 },
  flexBtn: { flex: 1 },
  errorBox: { borderRadius: 10, borderWidth: 1, borderColor: COLORS.error, padding: 10, marginTop: 10 },
  errorText: { fontSize: 11, color: COLORS.error },
  warnText: { fontSize: 10.5, color: COLORS.warning, marginTop: 4, lineHeight: 15 },
  previewBox: { borderRadius: 10, borderWidth: 1, borderColor: COLORS.border, backgroundColor: COLORS.surfaceVariant, padding: 12, marginTop: 12 },
  previewTitle: { fontSize: 12, fontWeight: '800', color: COLORS.textPrimary, marginBottom: 6 },
  sumBlock: { marginTop: 10, paddingTop: 8, borderTopWidth: 1, borderTopColor: COLORS.border },
  sumLabel: { fontSize: 11, fontWeight: '800', color: COLORS.textPrimary },
  sumGrid: { flexDirection: 'row', marginTop: 6 },
  sumCell: { flex: 1, alignItems: 'center' },
  sumValue: { fontSize: 17, fontWeight: '800', color: COLORS.textPrimary },
  sumCaption: { fontSize: 9.5, color: COLORS.textSecondary },
  rowBox: { paddingVertical: 7, borderTopWidth: 1, borderTopColor: COLORS.border, marginTop: 4 },
  rowTitle: { fontSize: 11.5, fontWeight: '700', color: COLORS.textPrimary },
  rowMeta: { fontSize: 10, color: COLORS.textSecondary, marginTop: 2, lineHeight: 14 },
});

