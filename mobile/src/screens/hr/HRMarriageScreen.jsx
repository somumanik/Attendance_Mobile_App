// ============================================================================
// FILE: mobile/src/screens/hr/HRMarriageScreen.jsx
// PURPOSE: HR Marriage Anniversary register + Excel import workflow
// ============================================================================

/**
 * Mobile Marriage Anniversary — website-matched logic, phone-friendly UI.
 *
 * Navigation Flow:
 * HRNavigator (Marriage Tab) -> HRMarriageScreen
 *
 * Data Flow (existing endpoints only):
 * GET  /api/marriage-anniversary              -> real HR_MarriageAnniversary rows
 * POST /api/marriage-anniversary/validate     -> real employee match + existing date
 * POST /api/marriage-anniversary/import       -> real UPSERT into HR_MarriageAnniversary
 * GET  /api/employees?active=Y                -> real tblemployee master (for names/dept)
 * GET  /api/hr/filters                        -> real department name map
 *
 * Marriage anniversary is APPLICATION data in dbo.HR_MarriageAnniversary.
 * It is NOT a column on dbo.tblemployee and no Savior table is touched here.
 *
 * Employee matching (same as the website / validate endpoint):
 *   1) EmployeeCode  -> dbo.tblemployee.paycode      (primary)
 *   2) BiometricCode -> dbo.tblemployee.presentcardno (secondary)
 *   mc_no is NEVER used as employee identity.
 *
 * Import workflow mirrors the website (template -> select file -> parse ->
 * validate -> preview summary -> confirm -> import -> refresh) and adds the
 * MaritalStatus rules required for this phase:
 *   Unmarried + blank date  -> skipped, never imported (no anniversary record)
 *   blank status + blank date-> skipped, no data supplied
 *   Married   + valid date  -> READY (New or Update via backend UPSERT)
 *   Married   + blank date  -> INCOMPLETE, blocked
 *   Unmarried + a date      -> INVALID, blocked
 *   unparseable date         -> INVALID DATE, blocked
 *   no employee match        -> UNMATCHED, blocked
 *   repeated paycode in file -> DUPLICATE, only the first row is importable
 *
 * The backend import performs UPDATE-then-INSERT per paycode, so an existing
 * anniversary is updated rather than duplicated.
 */

import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { View, Text, ScrollView, StyleSheet, TouchableOpacity, RefreshControl, ActivityIndicator, Modal, Alert, Platform } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import * as DocumentPicker from 'expo-document-picker';
import * as FileSystem from 'expo-file-system';
import * as Sharing from 'expo-sharing';
import * as XLSX from 'xlsx';
import { COLORS, SPACING, SHADOWS } from '../../utils/colors';
import { ScreenContainer } from '../../components/ScreenContainer';
import { Button } from '../../components/Button';
import { api } from '../../services/api';

const UPCOMING_MARRIAGE_DAYS = 60; // website's marriageUpcoming(60)
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

const TEMPLATE_HEADERS = ['EmployeeCode', 'BiometricCode', 'EmployeeName', 'MaritalStatus', 'MarriageAnniversaryDate'];

const clean = (v) => String(v == null ? '' : v).trim();
const PLACEHOLDER = '—';
const ROSE = '#E11D48';
const TEAL = '#0D9488';

// The two values HR may pick in the MaritalStatus column. Used both for the
// Excel dropdown and for import validation.
const MARITAL_OPTIONS = ['Married', 'Unmarried'];

/** UTF-8 helpers — no Buffer/TextDecoder dependency (works in browser + Hermes). */
const bytesToUtf8 = (bytes) => {
  let out = '';
  for (let i = 0; i < bytes.length; i += 1) {
    const b = bytes[i];
    if (b < 0x80) { out += String.fromCharCode(b); continue; }
    if (b >= 0xc0 && b < 0xe0) {
      out += String.fromCharCode(((b & 0x1f) << 6) | (bytes[i + 1] & 0x3f));
      i += 1;
    } else if (b >= 0xe0 && b < 0xf0) {
      out += String.fromCharCode(((b & 0x0f) << 12) | ((bytes[i + 1] & 0x3f) << 6) | (bytes[i + 2] & 0x3f));
      i += 2;
    } else {
      const cp = (((b & 0x07) << 18) | ((bytes[i + 1] & 0x3f) << 12) | ((bytes[i + 2] & 0x3f) << 6) | (bytes[i + 3] & 0x3f));
      out += String.fromCodePoint(cp);
      i += 3;
    }
  }
  return out;
};

const utf8ToBytes = (str) => {
  const out = [];
  for (const ch of String(str)) {
    const cp = ch.codePointAt(0);
    if (cp < 0x80) out.push(cp);
    else if (cp < 0x800) out.push(0xc0 | (cp >> 6), 0x80 | (cp & 0x3f));
    else if (cp < 0x10000) out.push(0xe0 | (cp >> 12), 0x80 | ((cp >> 6) & 0x3f), 0x80 | (cp & 0x3f));
    else out.push(0xf0 | (cp >> 18), 0x80 | ((cp >> 12) & 0x3f), 0x80 | ((cp >> 6) & 0x3f), 0x80 | (cp & 0x3f));
  }
  return new Uint8Array(out);
};

/** Base64 -> bytes without Buffer/atob (works in Hermes and the browser). */
const base64ToBytes = (b64) => {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
  const s = String(b64 || '').replace(/[^A-Za-z0-9+/=]/g, '');
  const out = [];
  for (let i = 0; i < s.length; i += 4) {
    const e1 = chars.indexOf(s[i]);
    const e2 = chars.indexOf(s[i + 1]);
    const e3 = chars.indexOf(s[i + 2]);
    const e4 = chars.indexOf(s[i + 3]);
    const n = (e1 << 18) | (e2 << 12) | ((e3 < 0 ? 0 : e3) << 6) | (e4 < 0 ? 0 : e4);
    out.push((n >> 16) & 0xff);
    if (e3 >= 0) out.push((n >> 8) & 0xff);
    if (e4 >= 0) out.push(n & 0xff);
  }
  return new Uint8Array(out);
};

/**
 * Build the template workbook and return its bytes.
 *
 * SheetJS writes a genuine .xlsx but (community edition) does not emit data
 * validation, so the MaritalStatus cells get a real Excel dropdown by injecting
 * the standard <dataValidations> element into the worksheet part using SheetJS's
 * own bundled zip helpers — no new dependency, no library swap.
 *
 * If that injection is unavailable for any reason we still return the plain,
 * valid .xlsx, so a download is never blocked by the optional dropdown.
 */
const buildTemplateWorkbookBytes = (grid) => {
  const sheet = XLSX.utils.aoa_to_sheet(grid);
  const book = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(book, sheet, 'Marriage');

  let bytes = new Uint8Array(XLSX.write(book, { type: 'array', bookType: 'xlsx' }));
  try {
    const cfb = XLSX.CFB.read(bytes, { type: 'array' });
    const paths = (cfb && cfb.FullPaths) || [];
    const sheetIdx = paths.findIndex((p) => /worksheets\/sheet1\.xml$/.test(p));
    if (sheetIdx >= 0) {
      const lastRow = Math.max(2, grid.length);
      const dvXml = '<dataValidations count="1">'
        + `<dataValidation type="list" allowBlank="1" showInputMessage="1" showErrorMessage="1"`
        + ' errorTitle="Invalid Marital Status" error="Please select Married or Unmarried"'
        + ' promptTitle="Marital Status" prompt="Select Married or Unmarried"'
        + ` sqref="D2:D${lastRow}">`
        + `<formula1>"${MARITAL_OPTIONS.join(',')}"</formula1>`
        + '</dataValidation></dataValidations>';
      const xml = bytesToUtf8(cfb.FileIndex[sheetIdx].content).replace('</sheetData>', `</sheetData>${dvXml}`);
      XLSX.CFB.utils.cfb_add(cfb, `/${paths[sheetIdx].replace(/^[^/]*\//, '')}`, utf8ToBytes(xml));
      bytes = new Uint8Array(XLSX.CFB.write(cfb, { type: 'array', fileType: 'zip', compression: true }));
    }
  } catch (e) {
    // Optional enhancement only — fall back to the plain, valid workbook.
  }
  return bytes;
};

/**
 * Parse a plain calendar date (the API sends e.g. "2017-06-05T00:00:00.000Z").
 * The validity check compares LOCAL date parts on purpose: comparing a UTC
 * round-trip rejects every date in any timezone ahead of UTC (local midnight is
 * the previous UTC day), which made every anniversary render as "—".
 */
const parseDateOnly = (v) => {
  const s = clean(v).slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return null;
  const parts = s.split('-').map(Number);
  const d = new Date(parts[0], parts[1] - 1, parts[2]);
  if (Number.isNaN(d.getTime())) return null;
  // Rejects impossible dates such as 2017-02-31.
  if (d.getFullYear() !== parts[0] || d.getMonth() !== parts[1] - 1 || d.getDate() !== parts[2]) return null;
  return d;
};

const isoOf = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const pretty = (v) => {
  const d = parseDateOnly(v);
  return d ? `${String(d.getDate()).padStart(2, '0')}-${MONTHS[d.getMonth()]}-${d.getFullYear()}` : '—';
};

const daysUntilMonthDay = (dateStr) => {
  const src = parseDateOnly(dateStr);
  if (!src) return null;
  const now = new Date(); now.setHours(0, 0, 0, 0);
  let next = new Date(now.getFullYear(), src.getMonth(), src.getDate());
  if (next < now) next = new Date(now.getFullYear() + 1, src.getMonth(), src.getDate());
  return Math.round((next - now) / 86400000);
};

const nextDateOf = (dateStr) => {
  const src = parseDateOnly(dateStr);
  if (!src) return null;
  const now = new Date(); now.setHours(0, 0, 0, 0);
  let next = new Date(now.getFullYear(), src.getMonth(), src.getDate());
  if (next < now) next = new Date(now.getFullYear() + 1, src.getMonth(), src.getDate());
  return isoOf(next);
};

const yearsSince = (dateStr) => {
  const d = parseDateOnly(dateStr);
  if (!d) return null;
  const n = new Date();
  let y = n.getFullYear() - d.getFullYear();
  const m = n.getMonth() - d.getMonth();
  if (m < 0 || (m === 0 && n.getDate() < d.getDate())) y -= 1;
  return y;
};

const isTodayMonthDay = (dateStr) => {
  const d = parseDateOnly(dateStr);
  if (!d) return false;
  const n = new Date();
  return d.getDate() === n.getDate() && d.getMonth() === n.getMonth();
};

const normalizeStatus = (v) => clean(v).toLowerCase();

/** Build 'YYYY-MM-DD' straight from numeric calendar parts — no timezone step. */
const isoFromParts = (y, m, d) => `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;

/**
 * Excel serial numbers and real date cells both denote a CALENDAR DAY anchored at
 * UTC midnight (SheetJS builds them as `(serial - 25569) * 86400000`).
 *
 * Reading their day back with LOCAL getters (getDate/getMonth/getFullYear) is the
 * source of the one-day shift: in any timezone behind UTC that instant is still the
 * previous local day, so "05-06-2017" typed as a date cell became "04 June 2017".
 * Reading the UTC components returns the same calendar day in every timezone.
 */
const isoFromExcelDay = (d) => isoFromParts(d.getUTCFullYear(), d.getUTCMonth() + 1, d.getUTCDate());

/**
 * Accepts an Excel serial, a real Excel date cell, or a typed date string
 * (YYYY-MM-DD / DD-MM-YYYY / YYYY.MM.DD / DD/MM/YYYY). Returns 'YYYY-MM-DD' or
 * null when the value is not a real date. A calendar date is never converted to a
 * timestamp and no day is added or subtracted.
 */
const parseFlexibleDate = (v) => {
  if (v == null || v === '') return null;
  if (v instanceof Date && !Number.isNaN(v.getTime())) {
    return isoFromExcelDay(v);
  }
  if (typeof v === 'number' && Number.isFinite(v)) {
    const d = new Date(Math.round((v - 25569) * 86400000));
    if (Number.isNaN(d.getTime())) return null;
    return isoFromExcelDay(d);
  }
  const valid = (y, m, dd) => {
    // Text dates are calendar dates: build them in local time and read the same
    // local parts back, so the day is preserved in every timezone.
    const d = new Date(y, m - 1, dd);
    return d.getFullYear() === y && d.getMonth() === m - 1 && d.getDate() === dd ? isoFromParts(y, m, dd) : null;
  };
  const s = clean(v);
  let m = s.match(/^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})/);
  if (m) return valid(+m[1], +m[2], +m[3]);
  m = s.match(/^(\d{1,2})[-/.](\d{1,2})[-/.](\d{2,4})/);
  if (m) {
    let y = +m[3];
    if (y < 100) y += 2000;
    return valid(y, +m[2], +m[1]);
  }
  const d = new Date(s);
  if (!Number.isNaN(d.getTime())) return valid(d.getFullYear(), d.getMonth() + 1, d.getDate());
  return null;
};

/**
 * Grid -> rows. Header detection and column mapping follow the website, extended
 * with the MaritalStatus column required for this phase.
 */
const gridToRows = (grid) => {
  if (!Array.isArray(grid) || !grid.length) return { error: 'File empty hai.' };
  let headerIdx = -1;
  for (let i = 0; i < Math.min(grid.length, 5); i += 1) {
    const joined = grid[i].join('|').toLowerCase();
    if (joined.includes('employee') || joined.includes('biometric') || joined.includes('marriage') || joined.includes('anniversary')) {
      headerIdx = i;
      break;
    }
  }
  if (headerIdx < 0) return { error: 'Header row nahi mila (EmployeeCode / MarriageAnniversaryDate expected).' };

  // Header matching tolerates case, surrounding whitespace and inner spaces
  // ("EmployeeCode", " employeecode ", "Employee Code"), but ONLY maps columns we
  // actually know: an unknown/random header is never treated as a marriage field.
  const header = grid[headerIdx].map((h) => clean(h).toLowerCase().replace(/[^a-z]/g, ''));
  const idx = {
    code: header.findIndex((h) => h.includes('employeecode') || h === 'paycode' || h === 'empcode' || h === 'code' || h === 'employeeid'),
    bio: header.findIndex((h) => h.includes('biometric') || h.includes('cardno') || h === 'card' || h === 'presentcardno' || h === 'presentcardnumber'),
    name: header.findIndex((h) => h.includes('name')),
    status: header.findIndex((h) => h.includes('marital') || h.includes('status') || h === 'maritalstatus'),
    date: header.findIndex((h) => h.includes('anniversary') || h.includes('marriage') || h.includes('date')),
  };
  if (idx.code === -1 && idx.bio === -1) return { error: 'EmployeeCode ya BiometricCode column nahi mila.' };
  if (idx.date === -1) return { error: 'MarriageAnniversaryDate column nahi mila.' };

  const rows = [];
  for (let r = headerIdx + 1; r < grid.length; r += 1) {
    const row = grid[r] || [];
    if (row.join('').trim() === '') continue;
    const codeRaw = idx.code > -1 ? clean(row[idx.code]) : '';
    const bioRaw = idx.bio > -1 ? clean(row[idx.bio]) : '';
    const nameRaw = idx.name > -1 ? clean(row[idx.name]) : '';
    const statusRaw = idx.status > -1 ? clean(row[idx.status]) : '';
    const dateRaw = row[idx.date];
    rows.push({
      line: r + 1,
      codeRaw,
      bioRaw,
      nameRaw,
      statusRaw,
      // Real Excel date cells are UTC-midnight days: show the same day the parser uses.
      dateRaw: dateRaw instanceof Date ? isoFromExcelDay(dateRaw) : clean(dateRaw),
      parsed: parseFlexibleDate(dateRaw),
    });
  }
  if (!rows.length) return { error: 'Koi data row nahi mili.' };
  return { rows };
};

/**
 * Classification of one parsed row, before and after the server employee match.
 * Returns one of: valid | unmarried | nodata | incomplete | invalidUnmarried | invalidDate | unmatched | duplicate
 *
 * Rules (case-insensitive, so Married / married / MARRIED all behave the same):
 *   Unmarried + blank date   -> 'unmarried'  (row is fine; NO record is created)
 *   blank status + blank date-> 'nodata'     (no marriage information supplied; skipped,
 *                                               never fails the import and never deletes anything)
 *   Married + valid date     -> 'valid'      (imported / updated)
 *   Married + blank date     -> 'incomplete' (validation error)
 *   Unmarried + a date       -> 'invalidUnmarried' (validation error)
 *   unparseable date         -> 'invalidDate' (validation error)
 *   no employee match        -> 'unmatched'  (validation error)
 */
const classify = (row, employee) => {
  const st = normalizeStatus(row.statusRaw);
  const hasRawDate = clean(row.dateRaw) !== '';
  // "unmarried" must be tested before "married" because it contains "married".
  const isUnmarried = st.includes('unmarried') || st === 'u' || st === 'single';
  const isMarried = !isUnmarried && (st.includes('married') || st === 'm' || st === 'yes' || st === 'y');
  const NO_DATA = 'No marriage information supplied';

  // Nothing supplied for this employee -> skip quietly, do not fail the import.
  if (!st && !row.parsed) {
    return { state: 'nodata', reason: NO_DATA };
  }
  // Unmarried with a date is an invalid combination.
  if (isUnmarried && row.parsed) {
    return { state: 'invalidUnmarried', reason: 'Unmarried employee cannot have a marriage anniversary date.' };
  }
  // Unmarried with a blank date is accepted; NO anniversary record is created.
  if (isUnmarried && !row.parsed) {
    return { state: 'unmarried', reason: 'Unmarried / No Anniversary (date blank)' };
  }
  // A date was supplied but cannot be parsed.
  if (hasRawDate && !row.parsed) {
    return { state: 'invalidDate', reason: 'Invalid anniversary date' };
  }
  // Married without a date is a validation error.
  if (isMarried && !row.parsed) {
    return { state: 'incomplete', reason: 'Married employee ke liye Marriage Anniversary Date required hai.' };
  }
  if (!employee) {
    return { state: 'unmatched', reason: 'Employee not found in dbo.tblemployee' };
  }
  if (!row.parsed) {
    return { state: 'nodata', reason: NO_DATA };
  }
  return { state: 'valid', reason: 'Ready to import' };
};

const STATE_META = {
  valid: { label: 'Ready', bg: '#05966918', border: '#059669', text: '#059669' },
  unmarried: { label: 'Unmarried', bg: '#64748B18', border: '#64748B', text: '#475569' },
  nodata: { label: 'No Data', bg: '#64748B18', border: '#64748B', text: '#475569' },
  incomplete: { label: 'Incomplete', bg: '#D9770618', border: '#D97706', text: '#B45309' },
  invalidUnmarried: { label: 'Invalid', bg: '#DC262618', border: '#DC2626', text: '#B91C1C' },
  invalidDate: { label: 'Invalid Date', bg: '#DC262618', border: '#DC2626', text: '#B91C1C' },
  unmatched: { label: 'Unmatched', bg: '#CA8A0418', border: '#CA8A04', text: '#A16207' },
  duplicate: { label: 'Duplicate', bg: '#EA580C18', border: '#EA580C', text: '#C2410C' },
};

/**
 * HR Marriage Anniversary Screen Component
 */
export const HRMarriageScreen = () => {
  const [records, setRecords] = useState([]);
  const [empByPay, setEmpByPay] = useState({});
  const [deptNames, setDeptNames] = useState({});
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState(null);

  // Import workflow state
  const [step, setStep] = useState(1); // 1 template/file, 2 preview, 3 summary
  const [rows, setRows] = useState([]);
  const [fileError, setFileError] = useState(null);
  const [importing, setImporting] = useState(false);
  const [importSummary, setImportSummary] = useState(null);
  const [confirmRemove, setConfirmRemove] = useState(null);
  // Download Template: real user-triggered .xlsx download
  const [preparingTemplate, setPreparingTemplate] = useState(false);
  const [templateMsg, setTemplateMsg] = useState(null); // { kind: 'ok' | 'error', text }
  // Synchronous guard so rapid repeat taps can't queue several downloads
  // before React re-renders with preparingTemplate = true.
  const templateBusy = useRef(false);

  const loadAll = useCallback(async (isRefresh) => {
    if (isRefresh) setRefreshing(true); else setLoading(true);
    setError(null);
    try {
      const [mar, emps, filters] = await Promise.all([
        api.get('/marriage-anniversary'),
        (async () => {
          const all = [];
          for (let p = 1; p <= 20; p += 1) {
            const d = await api.get('/employees', { page: p, pageSize: 100, active: 'Y' });
            const b = Array.isArray(d?.rows) ? d.rows : [];
            all.push(...b);
            if (b.length < 100) break;
          }
          return all;
        })(),
        api.get('/hr/filters'),
      ]);

      setRecords(Array.isArray(mar) ? mar : []);
      const byPay = {};
      emps.forEach((e) => { byPay[clean(e.paycode)] = e; });
      setEmpByPay(byPay);
      const dmap = {};
      (Array.isArray(filters?.departments) ? filters.departments : []).forEach((d) => {
        const c = clean(d?.code);
        if (c) dmap[c] = clean(d?.name) || c;
      });
      setDeptNames(dmap);
    } catch (err) {
      setRecords([]);
      setError('Unable to load marriage anniversary data.');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => { loadAll(false); }, [loadAll]);

  const view = useMemo(() => {
    const rowsOut = records.map((m) => {
      const pay = clean(m.paycode);
      const e = empByPay[pay];
      const deptCode = clean(e?.departmentcode);
      return {
        id: m.id,
        paycode: pay,
        presentcardno: clean(m.presentcardno) || PLACEHOLDER,
        name: clean(e?.empname) || pay || PLACEHOLDER,
        dept: deptNames[deptCode] || deptCode || PLACEHOLDER,
        anniversarydate: clean(m.anniversarydate),
        years: yearsSince(m.anniversarydate),
        days: daysUntilMonthDay(m.anniversarydate),
        importedby: clean(m.importedby) || PLACEHOLDER,
        updated: clean(m.updateddate) || clean(m.createddate),
      };
    });
    return {
      all: rowsOut,
      today: rowsOut.filter((r) => isTodayMonthDay(r.anniversarydate)),
      upcoming: rowsOut
        .filter((r) => r.days !== null && r.days > 0 && r.days <= UPCOMING_MARRIAGE_DAYS)
        .sort((a, b) => a.days - b.days),
    };
  }, [records, empByPay, deptNames]);

  const summary = useMemo(() => {
    const s = { total: rows.length, valid: 0, unmarried: 0, nodata: 0, incomplete: 0, invalid: 0, unmatched: 0, duplicate: 0, existing: 0 };
    rows.forEach((r) => {
      if (r.state === 'valid') { s.valid += 1; if (r.existingDate) s.existing += 1; return; }
      if (r.state === 'unmarried') { s.unmarried += 1; return; }
      if (r.state === 'nodata') { s.nodata += 1; return; }
      if (r.state === 'incomplete') { s.incomplete += 1; return; }
      if (r.state === 'invalidUnmarried' || r.state === 'invalidDate') { s.invalid += 1; return; }
      if (r.state === 'unmatched') { s.unmatched += 1; return; }
      if (r.state === 'duplicate') { s.duplicate += 1; }
    });
    // Rolled-up counters shown in the import feedback.
    //   Validation errors = rows HR must fix before they can be imported.
    //   Skipped           = rows deliberately not imported (Unmarried / no info / duplicate).
    s.errors = s.incomplete + s.invalid + s.unmatched;
    s.skipped = s.unmarried + s.nodata + s.duplicate;
    return s;
  }, [rows]);

  // ---------------- Template / Sample ----------------

  /**
   * Build the real template rows from the employee master that is ALREADY
   * loaded on this screen (/employees, paged) — no extra SQL query.
   *
   * Auto-filled from real dbo.tblemployee data:
   *   EmployeeCode   -> real paycode        (primary match key)
   *   BiometricCode  -> real presentcardno  (secondary match key)
   *   EmployeeName   -> real empname        (readability only)
   *
   * Left BLANK on purpose — HR fills these two after downloading:
   *   MaritalStatus           (Married / Unmarried)
   *   MarriageAnniversaryDate (date for Married, blank for Unmarried)
   *
   * Column names and order are exactly what the existing import workflow reads.
   */
  const buildTemplateGrid = () => [TEMPLATE_HEADERS].concat(
    Object.values(empByPay)
      .filter((e) => clean(e?.paycode) && clean(e?.empname))
      .sort((a, b) => clean(a.paycode).localeCompare(clean(b.paycode)))
      .map((e) => [
        clean(e.paycode),
        clean(e.presentcardno),
        clean(e.empname),
        '',   // MaritalStatus           -> HR fills
        '',   // MarriageAnniversaryDate -> HR fills
      ]),
  );

  /**
   * Real, user-triggered download.
   *
   * Web (Expo Web): builds a genuine .xlsx in memory, wraps it in a Blob and
   * clicks a real <a download="..."> element, so the browser actually saves the
   * file. Native: writes the same .xlsx to the cache dir and opens the share
   * sheet. Both produce a real .xlsx — no CSV, no in-memory-only object.
   */
  const downloadTemplate = async () => {
    if (templateBusy.current) return;          // block duplicate clicks immediately
    templateBusy.current = true;
    setPreparingTemplate(true);
    setTemplateMsg(null);
    // Yield once so the button actually paints its "Preparing Excel..." state
    // before the (synchronous) workbook build runs. This also keeps the
    // duplicate-click guard armed while the download is being prepared.
    await new Promise((resolve) => setTimeout(resolve, 0));
    try {
      const grid = buildTemplateGrid();
      if (grid.length < 2) {
        setTemplateMsg({ kind: 'error', text: 'Unable to prepare Excel template. Please try again.' });
        return;
      }

      const fileName = 'Marriage_Anniversary_Template.xlsx';
      // Real XLSX bytes (zip container) with the MaritalStatus dropdown injected.
      const bytes = buildTemplateWorkbookBytes(grid);
      const rowCount = grid.length - 1;

      if (Platform.OS === 'web') {
        const blob = new Blob([bytes], {
          type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        });
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
      } else {
        const dir = FileSystem.cacheDirectory || FileSystem.documentDirectory;
        if (!dir) throw new Error('No writable directory available');
        const uri = `${dir}${fileName}`;
        // Same bytes as the web path, base64-encoded for FileSystem.
        let bin = '';
        for (let i = 0; i < bytes.length; i += 1) bin += String.fromCharCode(bytes[i]);
        await FileSystem.writeAsStringAsync(uri, btoa(bin), {
          encoding: FileSystem.EncodingType.Base64,
        });
        const can = await Sharing.isAvailableAsync();
        if (can) {
          await Sharing.shareAsync(uri, {
            mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
            dialogTitle: fileName,
            UTI: 'org.openxmlformats.spreadsheetml.sheet',
          });
        }
      }

      const text = `Marriage Anniversary Excel template downloaded successfully (${fileName}, ${rowCount} employees).`;
      setTemplateMsg({ kind: 'ok', text });
      Alert.alert('Downloaded', text);
    } catch (e) {
      setTemplateMsg({ kind: 'error', text: 'Excel download failed. Please try again.' });
    } finally {
      setPreparingTemplate(false);
      templateBusy.current = false;
    }
  };

  // Sample rows are ONLY a preview aid and are never imported automatically.
  const loadSample = () => {
    const picks = Object.values(empByPay).slice(0, 4);
    const d0 = new Date(); d0.setDate(d0.getDate());
    const d1 = new Date(); d1.setDate(d1.getDate() + 3);
    const grid = [TEMPLATE_HEADERS];
    grid.push([clean(picks[0]?.paycode), clean(picks[0]?.presentcardno), clean(picks[0]?.empname), 'Married', '15-02-2018']);
    grid.push([clean(picks[1]?.paycode), clean(picks[1]?.presentcardno), clean(picks[1]?.empname), 'Married', '2018-09-04']);
    grid.push([clean(picks[2]?.paycode), clean(picks[2]?.presentcardno), clean(picks[2]?.empname), 'Unmarried', '']);
    grid.push([clean(picks[3]?.paycode), clean(picks[3]?.presentcardno), clean(picks[3]?.empname), 'Married', '']);
    grid.push([clean(picks[1]?.paycode), clean(picks[1]?.presentcardno), 'SAMPLE UNMARRIED WITH DATE', 'Unmarried', '10-05-2019']);
    grid.push([clean(picks[2]?.paycode), clean(picks[2]?.presentcardno), 'SAMPLE INVALID DATE', 'Married', '32-13-2018']);
    grid.push(['EMP999', '999999', 'SAMPLE UNKNOWN PERSON', 'Married', '15-02-2015']);
    setFileError(null);
    processGrid(grid, `${clean(picks[0]?.paycode) || 'SAMPLE'} sample`);
  };

  /**
   * Read a picked document into bytes, working on BOTH platforms.
   *
   * expo-file-system's web build (ExpoFileSystemShim) is an empty stub: it has no
   * readAsStringAsync and its cacheDirectory is null, so reading through it fails on
   * Expo Web and the import silently aborts at this step. expo-document-picker on web
   * hands back the real File object (and a data: URL as .uri), so prefer those
   * standard browser paths first and keep expo-file-system only as the native fallback.
   */
  const readPickedBytes = async (asset) => {
    // 1. Web: the picker exposes the actual File.
    if (asset?.file && typeof asset.file.arrayBuffer === 'function') {
      return new Uint8Array(await asset.file.arrayBuffer());
    }
    // 2. Web: picker returned a data: URL.
    if (typeof asset?.uri === 'string' && asset.uri.indexOf('data:') === 0) {
      const comma = asset.uri.indexOf(',');
      const meta = asset.uri.slice(5, comma);
      const payload = asset.uri.slice(comma + 1);
      if (/;base64/i.test(meta)) return base64ToBytes(payload);
      return utf8ToBytes(decodeURIComponent(payload));
    }
    // 3. Web/any: fetch the URI directly.
    if (Platform.OS === 'web' && typeof fetch === 'function') {
      const res = await fetch(asset.uri);
      return new Uint8Array(await res.arrayBuffer());
    }
    // 4. Native: expo-file-system (the only real implementation).
    const b64 = await FileSystem.readAsStringAsync(asset.uri, { encoding: FileSystem.EncodingType.Base64 });
    return base64ToBytes(String(b64 || ''));
  };

  const pickFile = async () => {
    if (importing)              return;              // guard against duplicate picks while importing
    setImporting(true);
    setFileError(null);
    try {
      const res = await DocumentPicker.getDocumentAsync({
        type: ['application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
          'application/vnd.ms-excel', 'application/octet-stream', 'text/csv', 'text/comma-separated-values', '*/*'],
        copyToCacheDirectory: true,
        multiple: false,
      });
      if (res.canceled || !res.assets || !res.assets.length) { setImporting(false); return; }
      const asset = res.assets[0];
      const bytes = await readPickedBytes(asset);
      const name = asset.name || '';
      let grid = [];
      if (/\.csv$/i.test(name)) {
        grid = bytesToUtf8(bytes).split(/\r?\n/).filter((l) => l.trim()).map((l) => l.split(/[,;\t]/));
      } else {
        // Excel (.xlsx / .xls). Date cells are read as Excel serial NUMBERS
        // (cellDates left off on purpose): a serial is a UTC-anchored calendar day,
        // so parseFlexibleDate can return the exact intended date in every timezone,
        // while a JS Date from cellDates is anchored to whichever midnight the local
        // timezone produced.
        const wb = XLSX.read(bytes, { type: 'array' });
        const ws = wb.Sheets[wb.SheetNames[0]];
        grid = XLSX.utils.sheet_to_json(ws, { header: 1, raw: true, defval: '' });
      }
      setFileError(null);
      await processGrid(grid, asset.name);
    } catch (e) {
      const why = e && e.message ? e.message : String(e);
      setFileError(`File read nahi ho payi (${why}). Valid .xlsx / .xls / .csv select karein.`);
    } finally {
      setImporting(false);
    }
  };

  /** Parse -> server-side employee validation -> duplicate detection -> preview. */
  const processGrid = async (grid, sourceName) => {
    const parsed = gridToRows(grid);
    if (parsed.error) { setFileError(parsed.error); setRows([]); return; }

    let withEmp = parsed.rows;
    try {
      const res = await api.post('/marriage-anniversary/validate', {
        rows: parsed.rows.map((r) => ({ employeeCode: r.codeRaw, biometricCode: r.bioRaw, anniversaryDate: r.parsed })),
      });
      const validated = Array.isArray(res?.rows) ? res.rows : [];
      withEmp = parsed.rows.map((r, i) => ({ ...r, employee: validated[i]?.employee || null }));
    } catch (e) {
      setFileError('Server employee validation unavailable.');
      return;
    }

    const seen = new Set();
    const classified = withEmp.map((r) => {
      const c = classify(r, r.employee);
      let state = c.state;
      let reason = c.reason;
      if (state === 'valid') {
        const key = clean(r.employee?.paycode || r.codeRaw).toLowerCase();
        if (key && seen.has(key)) { state = 'duplicate'; reason = 'Duplicate Paycode in file (first occurrence will be imported)'; }
        else if (key) seen.add(key);
      }
      return { ...r, state, reason, existingDate: r.employee?.existingDate || null };
    });

    setRows(classified);
    setStep(2);
    setSource(sourceName);
  };
  const [source, setSource] = useState('');

  const resetImport = () => {
    setStep(1);
    setRows([]);
    setFileError(null);
    setImportSummary(null);
  };

  /** Confirm -> re-validate -> import only New/Changed -> refresh register + widgets. */
  const confirmImport = async () => {
    const matched = rows.filter((r) => r.state === 'valid' && r.employee);
    if (!matched.length) return;
    setImporting(true);
    try {
      const validation = await api.post('/marriage-anniversary/validate', {
        rows: matched.map((r) => ({ employeeCode: r.codeRaw, biometricCode: r.bioRaw, anniversaryDate: r.parsed })),
      });
      const validRows = (Array.isArray(validation?.rows) ? validation.rows : []).filter((r) => r.employee);
      const isNew = (r) => !r.employee.existingDate;
      const isChanged = (r) => r.employee.existingDate
        && clean(r.employee.existingDate).slice(0, 10) !== clean(r.anniversaryDate).slice(0, 10);
      const toImport = validRows.filter((r) => isNew(r) || isChanged(r));

      let importedCount = 0;
      if (toImport.length) {
        const res = await api.post('/marriage-anniversary/import', { rows: toImport });
        importedCount = Number(res?.imported) || 0;
      }

      setImportSummary({
        total: rows.length,
        imported: importedCount,
        fresh: validRows.filter(isNew).length,
        updated: validRows.filter(isChanged).length,
        unchanged: validRows.length - toImport.length,
        skipped: summary.skipped,
        errors: summary.errors,
        // Employee-wise reasons for every row that still needs HR attention.
        errorRows: rows
          .filter((r) => r.state === 'incomplete' || r.state === 'invalidUnmarried'
            || r.state === 'invalidDate' || r.state === 'unmatched' || r.state === 'duplicate')
          .map((r) => `${clean(r.codeRaw) || clean(r.bioRaw) || `Row ${r.line}`} — ${r.reason}`),
      });
      setStep(3);
      await loadAll(false);   // register + celebration widgets refresh immediately
    } catch (e) {
      setFileError('Server validation/import unavailable. Records were not imported.');
    } finally {
      setImporting(false);
    }
  };

  const removeRecord = (row) => {
    setConfirmRemove(null);
    api.delete(`/marriage-anniversary/${encodeURIComponent(row.paycode)}`)
      .then(() => loadAll(false))
      .catch(() => setError('Unable to remove the record. Please try again.'));
  };

  const chip = (state) => {
    const m = STATE_META[state] || STATE_META.nodata;
    return (
      <View style={[styles.stateChip, { backgroundColor: m.bg, borderColor: m.border }]}>
        <Text style={[styles.stateChipText, { color: m.text }]}>{m.label}</Text>
      </View>
    );
  };

  const StatBox = ({ label, value, color }) => (
    <View style={[styles.statBox, { borderColor: color }]}>
      <Text style={[styles.statValue, { color }]}>{value}</Text>
      <Text style={styles.statLabel}>{label}</Text>
    </View>
  );

  return (
    <ScreenContainer title="Marriage Anniversary" showHeader={true}>
      <ScrollView
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => loadAll(true)} colors={[COLORS.primary]} />}
        contentContainerStyle={styles.scrollContent}
      >
        <Text style={styles.subtitle}>HR_MarriageAnniversary register · Excel import</Text>

        {loading ? (
          <View style={styles.stateBox}>
            <ActivityIndicator size="large" color={COLORS.primary} />
            <Text style={styles.stateText}>Loading marriage anniversary data...</Text>
          </View>
        ) : null}

        {!loading && error ? (
          <View style={styles.errorBox}>
            <Text style={styles.errorText}>⚠️ {error}</Text>
            <Button title="Retry" onPress={() => loadAll(false)} variant="outline" size="small" style={styles.retryButton} />
          </View>
        ) : null}

        {!loading && !error ? (
          <>
            {/* ---------- Today's anniversaries ---------- */}
            <View style={styles.sectionHeader}>
              <Text style={styles.sectionIcon}>💍</Text>
              <Text style={[styles.sectionTitle, { color: ROSE }]}>Today's Marriage Anniversaries</Text>
              <View style={[styles.sectionCount, { backgroundColor: ROSE }]}>
                <Text style={styles.sectionCountText}>{view.today.length}</Text>
              </View>
            </View>
            {view.today.length === 0
              ? <Text style={styles.emptyText}>Aaj koi marriage anniversary nahi hai (ya data import nahi hua).</Text>
              : view.today.map((r) => (
                <View key={`t-${r.id || r.paycode}`} style={[styles.personCard, { borderLeftColor: ROSE }, SHADOWS.sm]}>
                  <View style={styles.personTop}>
                    <Text style={styles.personId}>{r.paycode}</Text>
                    <Text style={styles.personName} numberOfLines={1}>{r.name}</Text>
                  </View>
                  <Text style={styles.personMeta} numberOfLines={1}>{r.dept}</Text>
                  <Text style={styles.personFoot}>
                    {pretty(r.anniversarydate)} · {r.years === null ? PLACEHOLDER : `${r.years} years`}
                  </Text>
                </View>
              ))}

            {/* ---------- Upcoming anniversaries ---------- */}
            <View style={styles.sectionHeader}>
              <Text style={styles.sectionIcon}>📆</Text>
              <Text style={[styles.sectionTitle, { color: TEAL }]}>Upcoming Marriage Anniversaries ({UPCOMING_MARRIAGE_DAYS} days)</Text>
              <View style={[styles.sectionCount, { backgroundColor: TEAL }]}>
                <Text style={styles.sectionCountText}>{view.upcoming.length}</Text>
              </View>
            </View>
            {view.upcoming.length === 0
              ? <Text style={styles.emptyText}>Next {UPCOMING_MARRIAGE_DAYS} days me koi marriage anniversary nahi.</Text>
              : view.upcoming.map((r) => (
                <View key={`u-${r.id || r.paycode}`} style={[styles.personCard, { borderLeftColor: TEAL }, SHADOWS.sm]}>
                  <View style={styles.personTop}>
                    <Text style={styles.personId}>{r.paycode}</Text>
                    <Text style={styles.personName} numberOfLines={1}>{r.name}</Text>
                  </View>
                  <Text style={styles.personMeta} numberOfLines={1}>{r.dept}</Text>
                  <Text style={styles.personFoot}>
                    On {pretty(nextDateOf(r.anniversarydate))} · in {r.days} day{r.days === 1 ? '' : 's'} · {r.years === null ? PLACEHOLDER : `${r.years + 1} years`}
                  </Text>
                </View>
              ))}

            {/* ---------- Register ---------- */}
            <View style={styles.sectionHeader}>
              <Text style={styles.sectionIcon}>🗂️</Text>
              <Text style={[styles.sectionTitle, { color: COLORS.textPrimary }]}>Marriage Anniversary Register</Text>
              <View style={[styles.sectionCount, { backgroundColor: COLORS.primary }]}>
                <Text style={styles.sectionCountText}>{view.all.length}</Text>
              </View>
            </View>
            {view.all.length === 0
              ? <Text style={styles.emptyText}>Koi marriage anniversary record nahi hai. "Sample Sheet" ya Excel upload se HR data add karein.</Text>
              : view.all.map((r) => (
                <View key={`r-${r.id || r.paycode}`} style={[styles.personCard, { borderLeftColor: ROSE }, SHADOWS.sm]}>
                  <View style={styles.personTop}>
                    <Text style={styles.personId}>{r.paycode}</Text>
                    <Text style={styles.personName} numberOfLines={1}>{r.name}</Text>
                  </View>
                  <Text style={styles.personMeta} numberOfLines={1}>Card: {r.presentcardno}</Text>
                  <Text style={styles.personMeta} numberOfLines={1}>{r.dept}</Text>
                  <View style={styles.personStats}>
                    <View style={styles.stat}>
                      <Text style={styles.statLabel}>ANNIVERSARY</Text>
                      <Text style={[styles.statValue, { color: ROSE }]}>{pretty(r.anniversarydate)}</Text>
                    </View>
                    <View style={styles.stat}>
                      <Text style={styles.statLabel}>YEARS</Text>
                      <Text style={[styles.statValue, { color: TEAL }]}>{r.years === null ? PLACEHOLDER : `${r.years}`}</Text>
                    </View>
                  </View>
                  <View style={styles.registerFoot}>
                    <Text style={styles.personMeta}>by {r.importedby}{r.updated ? ` · ${pretty(r.updated)}` : ''}</Text>
                    <TouchableOpacity style={styles.removeBtn} onPress={() => setConfirmRemove(r)}>
                      <Ionicons name="trash-outline" size={12} color="#E11D48" />
                      <Text style={styles.removeBtnText}>Remove</Text>
                    </TouchableOpacity>
                  </View>
                </View>
              ))}

            {/* ---------- Import workflow ---------- */}
            <View style={styles.importBox}>
              <Text style={styles.importTitle}>Excel Import</Text>
              <Text style={styles.importStep}>Step {step} of 3</Text>

              {step === 1 ? (
                <>
                  <Text style={styles.importHint}>
                    Template columns: {TEMPLATE_HEADERS.join(' · ')}. EmployeeCode (paycode) ya
                    BiometricCode (presentcardno) se employee match hota hai — name sirf verification ke liye.
                  </Text>
                  <View style={styles.importActions}>
                    <Button
                      title={preparingTemplate ? 'Preparing Excel...' : 'Download Template'}
                      onPress={downloadTemplate}
                      loading={preparingTemplate}
                      disabled={preparingTemplate}
                      variant="secondary"
                      size="small"
                      style={styles.importBtn}
                    />
                    <Button title="Sample Sheet" onPress={loadSample} variant="outline" size="small" style={styles.importBtn} />
                    <Button
                      title={importing ? 'Processing Excel...' : 'Select Excel / CSV'}
                      onPress={pickFile}
                      loading={importing}
                      disabled={importing}
                      size="small"
                      style={styles.importBtn}
                    />
                  </View>
                  {templateMsg ? (
                    <View style={[
                      styles.templateMsgBox,
                      templateMsg.kind === 'ok' ? styles.templateMsgOk : styles.templateMsgErr,
                    ]}>
                      <Text style={[
                        styles.templateMsgText,
                        { color: templateMsg.kind === 'ok' ? COLORS.success : COLORS.error },
                      ]}>
                        {templateMsg.kind === 'ok' ? '✅' : '⚠️'} {templateMsg.text}
                      </Text>
                    </View>
                  ) : null}
                  <Text style={styles.importNote}>
                    Sample Sheet sirf workflow preview hai — koi sample row kabhi automatically insert nahi hota.
                  </Text>
                </>
              ) : null}

              {fileError ? <Text style={styles.fileError}>⚠️ {fileError}</Text> : null}

              {step === 2 ? (
                <>
                  <Text style={styles.importHint}>Preview · source: {source || 'file'}</Text>
                  <View style={styles.statGrid}>
                    <StatBox label="Total Rows" value={summary.total} color={COLORS.textPrimary} />
                    <StatBox label="Valid / Ready" value={summary.valid} color="#059669" />
                    <StatBox label="Existing (Update)" value={summary.existing} color="#0EA5E9" />
                    <StatBox label="Unmarried" value={summary.unmarried} color="#64748B" />
                    <StatBox label="No Data" value={summary.nodata} color="#94A3B8" />
                    <StatBox label="Skipped (total)" value={summary.skipped} color="#64748B" />
                    <StatBox label="Validation Errors" value={summary.errors} color="#DC2626" />
                    <StatBox label="Incomplete" value={summary.incomplete} color="#D97706" />
                    <StatBox label="Invalid" value={summary.invalid} color="#DC2626" />
                    <StatBox label="Unmatched" value={summary.unmatched} color="#CA8A04" />
                    <StatBox label="Duplicate" value={summary.duplicate} color="#EA580C" />
                  </View>

                  {rows.map((r) => (
                    <View key={`p-${r.line}`} style={styles.previewRow}>
                      <View style={styles.previewHead}>
                        <Text style={styles.previewLine}>L{r.line}</Text>
                        {chip(r.state)}
                      </View>
                      <Text style={styles.previewText}>
                        {clean(r.codeRaw) || PLACEHOLDER} · {clean(r.bioRaw) || PLACEHOLDER} · {clean(r.dateRaw) || PLACEHOLDER}
                      </Text>
                      <Text style={styles.previewText}>
                        {clean(r.nameRaw) || PLACEHOLDER}{r.statusRaw ? ` · ${r.statusRaw}` : ''}
                        {r.employee ? ` → ${clean(r.employee.empname)} (${clean(r.employee.paycode)})` : ''}
                      </Text>
                      <Text style={[styles.previewReason, { color: (STATE_META[r.state] || STATE_META.nodata).text }]}>{r.reason}</Text>
                      {r.state === 'valid' && r.existingDate ? (
                        <Text style={styles.previewExisting}>Existing: {pretty(r.existingDate)} (will be updated)</Text>
                      ) : null}
                    </View>
                  ))}

                  <View style={styles.importActions}>
                    <Button title="Back" onPress={resetImport} variant="outline" size="small" style={styles.importBtn} />
                    <Button
                      title="Confirm Import"
                      onPress={confirmImport}
                      loading={importing}
                      disabled={summary.valid === 0}
                      size="small"
                      style={styles.importBtn}
                    />
                  </View>
                </>
              ) : null}

              {step === 3 && importSummary ? (
                <>
                  <View style={styles.statGrid}>
                    <StatBox label="Total Rows" value={importSummary.total} color={COLORS.textPrimary} />
                    <StatBox label="Imported / Updated" value={importSummary.imported} color="#059669" />
                    <StatBox label="New" value={importSummary.fresh} color="#10B981" />
                    <StatBox label="Updated" value={importSummary.updated} color="#0EA5E9" />
                    <StatBox label="Unchanged" value={importSummary.unchanged} color="#64748B" />
                    <StatBox label="Skipped" value={importSummary.skipped} color="#64748B" />
                    <StatBox label="Validation Errors" value={importSummary.errors} color="#DC2626" />
                  </View>
                  {importSummary.errorRows && importSummary.errorRows.length ? (
                    <View style={styles.importReasonBox}>
                      <Text style={styles.importReasonTitle}>Validation errors — fix these and re-upload:</Text>
                      {importSummary.errorRows.map((r) => (
                        <Text key={`err-${r}`} style={styles.importReasonLine}>• {r}</Text>
                      ))}
                    </View>
                  ) : null}
                  <Button title="Done" onPress={resetImport} size="small" style={styles.importBtn} />
                </>
              ) : null}
            </View>
          </>
        ) : null}
      </ScrollView>

      {/* Remove confirmation */}
      <Modal visible={!!confirmRemove} transparent animationType="fade" onRequestClose={() => setConfirmRemove(null)}>
        <View style={styles.modalBackdrop}>
          <TouchableOpacity style={styles.modalDismiss} activeOpacity={1} onPress={() => setConfirmRemove(null)} />
          <View style={styles.modalCard}>
            <Text style={styles.modalTitle}>Remove marriage anniversary?</Text>
            <Text style={styles.modalText}>
              {confirmRemove ? `Remove marriage anniversary record for ${confirmRemove.name}?` : ''}
            </Text>
            <Text style={styles.modalNote}>Sirf anniversary record remove hoga. Employee data delete nahi hoga.</Text>
            <View style={styles.modalActions}>
              <Button title="Cancel" onPress={() => setConfirmRemove(null)} variant="outline" size="small" style={styles.importBtn} />
              <Button title="Remove" onPress={() => confirmRemove && removeRecord(confirmRemove)} variant="danger" size="small" style={styles.importBtn} />
            </View>
          </View>
        </View>
      </Modal>
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
  sectionHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: SPACING.sm,
    paddingHorizontal: SPACING.md,
    paddingVertical: SPACING.sm,
    borderRadius: 12,
    backgroundColor: COLORS.surfaceVariant,
    borderWidth: 1,
    borderColor: COLORS.divider,
    marginTop: SPACING.md,
    marginBottom: SPACING.sm,
  },
  sectionIcon: { fontSize: 15 },
  sectionTitle: { flex: 1, fontSize: 12.5, fontWeight: '800' },
  sectionCount: { minWidth: 24, paddingHorizontal: 7, paddingVertical: 2, borderRadius: 999, alignItems: 'center' },
  sectionCountText: { color: '#FFFFFF', fontSize: 11, fontWeight: '800' },
  emptyText: { color: COLORS.textTertiary, fontSize: 12, paddingVertical: SPACING.md, textAlign: 'center' },
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
  personId: { fontSize: 10.5, fontWeight: '800', color: COLORS.textSecondary },
  personName: { flex: 1, fontSize: 13.5, fontWeight: '700', color: COLORS.textPrimary },
  personMeta: { fontSize: 11, color: COLORS.textTertiary, marginTop: 2 },
  personFoot: { fontSize: 11, color: COLORS.textSecondary, marginTop: SPACING.sm },
  personStats: { flexDirection: 'row', marginTop: SPACING.sm, gap: SPACING.lg },
  stat: {},
  statLabel: { fontSize: 9, fontWeight: '800', color: COLORS.textTertiary, letterSpacing: 0.5 },
  statValue: { fontSize: 12.5, fontWeight: '800', marginTop: 1 },
  registerFoot: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: SPACING.sm },
  removeBtn: { flexDirection: 'row', alignItems: 'center', gap: 4, paddingHorizontal: 9, paddingVertical: 5, borderRadius: 8, backgroundColor: `${ROSE}15`, borderWidth: 1, borderColor: `${ROSE}33` },
  removeBtnText: { fontSize: 10.5, fontWeight: '800', color: ROSE },
  importBox: {
    marginTop: SPACING.lg,
    padding: SPACING.md,
    borderRadius: 14,
    backgroundColor: COLORS.surface,
    borderWidth: 1,
    borderColor: COLORS.divider,
    gap: SPACING.sm,
  },
  importTitle: { fontSize: 14, fontWeight: '800', color: COLORS.textPrimary },
  importStep: { fontSize: 11, color: COLORS.textTertiary },
  importHint: { fontSize: 11, color: COLORS.textSecondary, lineHeight: 16 },
  importNote: { fontSize: 10.5, color: COLORS.textTertiary, lineHeight: 15 },
  importActions: { flexDirection: 'row', flexWrap: 'wrap', gap: SPACING.sm, marginTop: SPACING.xs },
  importBtn: { flexGrow: 1, minWidth: 110 },
  fileError: { color: COLORS.error, fontSize: 11.5 },
  templateMsgBox: { marginTop: SPACING.xs, padding: SPACING.sm, borderRadius: 10, borderWidth: 1 },
  templateMsgOk: { backgroundColor: `${COLORS.success}12`, borderColor: `${COLORS.success}33` },
  templateMsgErr: { backgroundColor: `${COLORS.error}12`, borderColor: `${COLORS.error}33` },
  templateMsgText: { fontSize: 11, fontWeight: '600' },
  importReasonBox: {
    marginTop: SPACING.xs,
    padding: SPACING.sm,
    borderRadius: 10,
    backgroundColor: `${COLORS.error}0F`,
    borderWidth: 1,
    borderColor: `${COLORS.error}30`,
  },
  importReasonTitle: { fontSize: 11, fontWeight: '800', color: COLORS.error, marginBottom: 3 },
  importReasonLine: { fontSize: 10.5, color: COLORS.textSecondary },
  statGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: SPACING.sm, marginVertical: SPACING.sm },
  statBox: {
    flexGrow: 1,
    minWidth: 72,
    alignItems: 'center',
    paddingVertical: SPACING.sm,
    borderRadius: 10,
    borderWidth: 1,
    backgroundColor: COLORS.surfaceVariant,
  },
  statValue: { fontSize: 16, fontWeight: '800' },
  statLabel: { fontSize: 9.5, color: COLORS.textSecondary, marginTop: 2, fontWeight: '700', textAlign: 'center' },
  previewRow: {
    paddingVertical: SPACING.sm,
    borderTopWidth: 1,
    borderTopColor: COLORS.divider,
    gap: 2,
  },
  previewHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  previewLine: { fontSize: 10, fontWeight: '800', color: COLORS.textTertiary },
  previewText: { fontSize: 11, color: COLORS.textSecondary },
  previewReason: { fontSize: 10.5, fontWeight: '600' },
  previewExisting: { fontSize: 10, color: '#0EA5E9' },
  stateChip: { paddingHorizontal: 8, paddingVertical: 2, borderRadius: 999, borderWidth: 1 },
  stateChipText: { fontSize: 9.5, fontWeight: '800' },
  modalBackdrop: { flex: 1, backgroundColor: COLORS.overlay, justifyContent: 'center', padding: SPACING.lg },
  modalDismiss: { flex: 1 },
  modalCard: { backgroundColor: COLORS.surface, borderRadius: 16, padding: SPACING.lg, gap: SPACING.sm, ...SHADOWS.lg },
  modalTitle: { fontSize: 15, fontWeight: '800', color: COLORS.textPrimary },
  modalText: { fontSize: 12.5, color: COLORS.textSecondary },
  modalNote: { fontSize: 11, color: COLORS.textTertiary },
  modalActions: { flexDirection: 'row', gap: SPACING.sm, marginTop: SPACING.sm },
});
