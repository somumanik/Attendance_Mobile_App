import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import jwt from 'jsonwebtoken';
import nodemailer from 'nodemailer';
import path from 'path';
import { fileURLToPath } from 'url';
import { getDbConfigStatus, getPool, sql } from './db.js';
// Email credentials + transport live in ONE isolated module (see the header of
// server/email-provider.js). Everything email-related must go through it, so
// future feature work can never break the email configuration.
import {
  ENV_KEYS as EMAIL_ENV_KEYS,
  ensureProviderColumns,
  getProviderSettings,
  publicProviderStatus,
  saveProviderSettings,
  sendEmail as sendEmailViaProvider
} from './email-provider.js';

const app = express();
const PORT = process.env.PORT || process.env.API_PORT || 4000;
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const distDir = path.join(__dirname, '..', 'dist');
const marriageTable = process.env.HR_MARRIAGE_TABLE || 'dbo.HR_MarriageAnniversary';
const jwtSecret = process.env.JWT_SECRET;
const hrUsername = process.env.HR_USERNAME;
const hrPassword = process.env.HR_PASSWORD;
const devEmployeeAuthEnabled = String(process.env.DEV_EMPLOYEE_AUTH_ENABLED).toLowerCase() === 'true';
const devEmployeePaycode = process.env.DEV_EMPLOYEE_PAYCODE;
const devEmployeePassword = process.env.DEV_EMPLOYEE_PASSWORD;

app.use(cors({ origin: process.env.FRONTEND_ORIGIN?.split(',').filter(Boolean) || true }));
app.use(express.json({ limit: '2mb' }));

function isValidIsoDate(value) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(value || ''))) return false;
  const date = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(date.valueOf()) && date.toISOString().slice(0, 10) === value;
}

function isoDate(date) { return date.toISOString().slice(0, 10); }

function parseDateRange(query, defaultDays = 31) {
  if (query.date) {
    return isValidIsoDate(query.date) ? { fromDate: query.date, toDate: query.date } : { error: 'Invalid date. Use YYYY-MM-DD.' };
  }
  if (query.month) {
    if (!/^\d{4}-\d{2}$/.test(query.month)) return { error: 'Invalid month. Use YYYY-MM.' };
    const [year, month] = query.month.split('-').map(Number);
    const start = new Date(Date.UTC(year, month - 1, 1));
    const end = new Date(Date.UTC(year, month, 0));
    if (start.getUTCFullYear() !== year || start.getUTCMonth() !== month - 1) return { error: 'Invalid month.' };
    return { fromDate: isoDate(start), toDate: isoDate(end) };
  }
  if (query.fromDate || query.toDate) {
    if (!isValidIsoDate(query.fromDate) || !isValidIsoDate(query.toDate) || query.fromDate > query.toDate) {
      return { error: 'fromDate and toDate must be valid and ordered.' };
    }
    return { fromDate: query.fromDate, toDate: query.toDate };
  }
  const days = Number(query.days || defaultDays);
  if (!Number.isInteger(days) || days < 1 || days > 366) return { error: 'days must be an integer from 1 to 366.' };
  const end = new Date();
  const start = new Date(end);
  start.setHours(0, 0, 0, 0);
  start.setDate(start.getDate() - days + 1);
  return { fromDate: isoDate(start), toDate: isoDate(end) };
}

function parseWeekRange(query) {
  if (query.fromDate || query.toDate) return parseDateRange(query, 7);
  if (query.week && /^\d{4}-W\d{2}$/.test(query.week)) {
    const [yearText, weekText] = query.week.split('-W');
    const year = Number(yearText), week = Number(weekText);
    if (week < 1 || week > 53) return { error: 'Invalid week.' };
    const jan4 = new Date(Date.UTC(year, 0, 4));
    const monday = new Date(jan4);
    monday.setUTCDate(jan4.getUTCDate() - ((jan4.getUTCDay() + 6) % 7) + (week - 1) * 7);
    const sunday = new Date(monday);
    sunday.setUTCDate(monday.getUTCDate() + 6);
    return { fromDate: isoDate(monday), toDate: isoDate(sunday) };
  }
  return parseDateRange(query, 7);
}

// Current India calendar week (Monday 00:00 IST ... Sunday 23:59 IST).
function indiaWeekRange() {
  const today = indiaTodayISO();
  const p = today.split('-').map(Number);
  const dow = (new Date(Date.UTC(p[0], p[1] - 1, p[2])).getUTCDay() + 6) % 7; // 0=Mon..6=Sun
  const monday = new Date(Date.UTC(p[0], p[1] - 1, p[2] - dow));
  const sunday = new Date(Date.UTC(monday.getUTCFullYear(), monday.getUTCMonth(), monday.getUTCDate() + 6));
  return { fromDate: isoDate(monday), toDate: isoDate(sunday) };
}

function requireDbConfig(_req, res, next) {
  if (!process.env.DB_SERVER || !process.env.DB_DATABASE || !process.env.DB_USER || !process.env.DB_PASSWORD) {
    return res.status(503).json({ success: false, message: 'Database connection unavailable.' });
  }
  next();
}

function databaseErrorMessage(error) {
  const code = String(error?.code || error?.originalError?.code || '').toUpperCase();
  if (code.includes('LOGIN') || code === 'ELOGIN' || code === 'EINVALID') return 'Database credentials are invalid.';
  if (code.includes('TABLE') || code.includes('INVALIDOBJECT')) return 'Required database table was not found.';
  return 'Database connection unavailable.';
}

function sendDbError(res, error) {
  console.error('[DB_ERROR]', error && (error.message || error).toString().slice(0, 500));
  return res.status(503).json({ success: false, message: databaseErrorMessage(error) });
}

function signUser(user) {
  if (!jwtSecret) throw new Error('JWT_SECRET is not configured.');
  return jwt.sign({ sub: user.id, role: user.role.toUpperCase(), paycode: user.paycode || null, devEmployee: user.devEmployee === true }, jwtSecret, { expiresIn: '8h' });
}

function authenticate(req, res, next) {
  const token = req.headers.authorization?.startsWith('Bearer ') ? req.headers.authorization.slice(7) : null;
  if (!token || !jwtSecret) return res.status(401).json({ success: false, message: 'Authentication required.' });
  try { req.user = jwt.verify(token, jwtSecret); next(); }
  catch { res.status(401).json({ success: false, message: 'Invalid or expired session.' }); }
}

function requireRole(...roles) {
  return (req, res, next) => roles.includes(req.user?.role) ? next() : res.status(403).json({ success: false, message: 'Forbidden.' });
}

function requireConfiguredAuth(_req, res, next) {
  if (!jwtSecret) return res.status(503).json({ success: false, message: 'Authentication is not configured on the server.' });
  next();
}

function validateRange(res, range) {
  if (!range.error) return true;
  res.status(400).json({ success: false, message: range.error });
  return false;
}

const attendanceFields = 'paycode, dateoffice, shift, in1, in2, out1, out2, hoursworked, otduration, latearrival, status, reason';

// Savior biometric register uses short codes (CHAR-padded): P=Present, A/ABS=Absent,
// MIS=Miss punch, HLF=Half day present, SRT=Short leave present, POW=Present on week-off,
// WO=Week off. Normalize once so backend + frontend agree.
function attendanceCode(status) {
  return String(status || '').trim().toUpperCase();
}

function attendanceStatus(code) {
  const c = attendanceCode(code);
  if (c === 'P' || c === 'PRESENT') return 'Present';
  if (c === 'A' || c === 'ABS' || c === 'ABSENT') return 'Absent';
  if (c === 'MIS' || c === 'MISS PUNCH' || c === 'MISS' || c === 'MISPUNCH') return 'Miss Punch';
  if (c === 'WO' || c === 'WEEK OFF' || c === 'WEEKOFF') return 'Week Off';
  if (c === 'HLF' || c === 'HALF' || c === 'HALF DAY') return 'Half Day';
  if (c === 'SRT' || c === 'SHORT') return 'Short Leave';
  if (c === 'POW' || c === 'PRESENT ON WEEK OFF') return 'Present (Week Off)';
  // LATE is reported as a normalised label. It stays a Present bucket in
  // classifyRow (see below) and is only ever a flag beside the status.
  if (c === 'LATE') return 'Late';
  return c ? code : null;
}

function isPresentCode(code) {
  return ['P', 'HLF', 'SRT', 'POW'].includes(attendanceCode(code));
}

function isAbsentCode(code) {
  return ['A', 'ABS'].includes(attendanceCode(code));
}

function isMissCode(code) {
  return attendanceCode(code) === 'MIS';
}

/* ---- LATE / GRACE COMPUTATION ----
   Universal 5-minute grace from shift start time for ALL employees.
   STAFF-only monthly grace allowances (reset each calendar month):
   - 30-minute grace: 2 times/month
   - 1-hour grace: 1 time/month
   - 2-hour grace: 1 time/month
   5-minute grace does NOT consume monthly staff grace.
   Monthly staff grace only applies when late exceeds 5-minute grace. */
function getShiftStartMinutes(shiftMap, shift, companycode) {
  if (!shiftMap || !shift) return null;
  const entry = shiftMap.get(String(shift).trim());
  if (!entry) return null;
  const comp = String(companycode || '').trim();
  const chosen = comp ? entry.byCompany.get(comp) : null;
  return chosen ? chosen.start : entry.defaultStart;
}

function punchTimeToMinutes(punchValue) {
  if (!punchValue) return null;
  const d = punchValue instanceof Date ? punchValue : new Date(punchValue);
  if (Number.isNaN(d.valueOf())) return null;
  return d.getUTCHours() * 60 + d.getUTCMinutes();
}

function computeLateStatus(row, shiftMap, employeeCategory, companycode, paycode) {
  if (!row) return { isLate: false, lateMinutes: 0, graceUsed: null };
  
  // Check if status is explicitly LATE
  if (attendanceCode(row.status) === 'LATE' || attendanceCode(row.statusCode) === 'LATE') {
    return { isLate: true, lateMinutes: Number(row.latearrival || 0), graceUsed: null };
  }
  
  // Get punch-in time (first IN punch)
  const inTime = row.in1 || row.in2;
  const punchMinutes = punchTimeToMinutes(inTime);
  if (punchMinutes === null) return { isLate: false, lateMinutes: 0, graceUsed: null };
  
  // Get shift code - use row.shift or fallback to employee-shift mapping
  let shiftCode = row.shift;
  if (!shiftCode && paycode) {
    shiftCode = empShiftCache.get(String(paycode).trim());
  }
  
  // Get shift start time
  const shiftStartMinutes = getShiftStartMinutes(shiftMap, shiftCode, companycode);
  if (shiftStartMinutes === null) {
    // No shift info - fall back to database latearrival
    return { isLate: Number(row.latearrival || 0) > 0, lateMinutes: Number(row.latearrival || 0), graceUsed: null };
  }
  
  // Universal 5-minute grace for ALL employees
  const graceThreshold = shiftStartMinutes + 5;
  const lateMinutes = Math.max(0, punchMinutes - graceThreshold);
  
  if (lateMinutes <= 0) {
    // Within 5-minute grace - NOT late
    return { isLate: false, lateMinutes: 0, graceUsed: '5min' };
  }
  
  // Raw late after 5-minute grace - monthly grace consumption is handled by computeMonthlyLateForEmployee
  return { isLate: true, lateMinutes, graceUsed: null };
}

/**
 * Compute FINAL late status for an employee for a given calendar month.
 * Processes attendance chronologically and consumes monthly Staff grace allowances.
 * Returns { finalLateCount, lateDetails[] } where lateDetails includes grace consumption info.
 * 
 * Grace consumption strategy (deterministic, smallest applicable first):
 * - Process attendance chronologically by date
 * - For each raw late event: use smallest grace that can cover the lateness
 * - 30min grace (2/month) → 1hr grace (1/month) → 2hr grace (1/month)
 * - Once a grace is consumed, it's unavailable for subsequent late events in the same month
 */
function computeMonthlyLateForEmployee(rows, shiftMap, employeeCategory, companycode, paycode, year, month) {
  const isStaff = isStaffCategory(employeeCategory, categoryCache);
  
  // Initialize grace allowances for this employee/month
  let grace30minRemaining = isStaff ? 2 : 0;
  let grace1hrRemaining = isStaff ? 1 : 0;
  let grace2hrRemaining = isStaff ? 1 : 0;
  
  // Filter to only this month's records and sort chronologically
  const monthRows = (rows || [])
    .filter(r => {
      const d = r.dateoffice instanceof Date ? r.dateoffice : new Date(r.dateoffice);
      return d.getFullYear() === year && d.getMonth() === month - 1;
    })
    .filter(r => classifyRow({ ...r, statusCode: attendanceCode(r.status) }) !== 'Week Off')
    .sort((a, b) => {
      const da = a.dateoffice instanceof Date ? a.dateoffice : new Date(a.dateoffice);
      const db = b.dateoffice instanceof Date ? b.dateoffice : new Date(b.dateoffice);
      return da - db;
    });
  
  let finalLateCount = 0;
  const lateDetails = [];
  
  for (const row of monthRows) {
    const lateStatus = computeLateStatus(row, shiftMap, employeeCategory, companycode, paycode);
    
    if (!lateStatus.isLate) {
      continue;
    }
    
    // Raw late event - check if monthly grace can cover it
    let graceApplied = null;
    let coveredByGrace = false;
    
    if (isStaff) {
      // Apply smallest applicable grace first (deterministic)
      // 30min grace covers up to 30 minutes of lateness (after 5-min universal grace)
      if (lateStatus.lateMinutes <= 30 && grace30minRemaining > 0) {
        grace30minRemaining--;
        graceApplied = '30min';
        coveredByGrace = true;
      } else if (lateStatus.lateMinutes <= 60 && grace1hrRemaining > 0) {
        grace1hrRemaining--;
        graceApplied = '1hr';
        coveredByGrace = true;
      } else if (lateStatus.lateMinutes <= 120 && grace2hrRemaining > 0) {
        grace2hrRemaining--;
        graceApplied = '2hr';
        coveredByGrace = true;
      }
    }
    
    if (coveredByGrace) {
      // This late event is covered by monthly grace - NOT counted in final late
      lateDetails.push({
        date: row.dateoffice,
        inTime: row.in1 || row.in2,
        lateMinutes: lateStatus.lateMinutes,
        graceUsed: graceApplied,
        isFinalLate: false
      });
    } else {
      // No grace available or not staff - counts as FINAL late
      finalLateCount++;
      lateDetails.push({
        date: row.dateoffice,
        inTime: row.in1 || row.in2,
        lateMinutes: lateStatus.lateMinutes,
        graceUsed: graceApplied,
        isFinalLate: true
      });
    }
  }
  
  return { finalLateCount, lateDetails, graceRemaining: { grace30min: grace30minRemaining, grace1hr: grace1hrRemaining, grace2hr: grace2hrRemaining } };
}

// Backward compatibility - checks database latearrival field
function isLateRow(row) {
  if (!row) return false;
  if (attendanceCode(row.status) === 'LATE' || attendanceCode(row.statusCode) === 'LATE') return true;
  return Number(row.latearrival || 0) > 0;
}

// ---- ONE common attendance calculation (India local date is the truth) ----
// DB stores punch datetimes as local wall-clock (e.g. 10:02 IST stored as 10:02).
// The mssql driver serialises them as "...T10:02:00.000Z". So the UTC part of the
// ISO string IS the company-local wall time. Never apply a +5:30 shift on top,
// otherwise 10:57 AM becomes 04:27 PM. Display = UTC getters of the ISO value.
function indiaDateISO(date = new Date()) {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata', year: 'numeric', month: '2-digit', day: '2-digit' }).format(date);
}

function indiaTodayISO() {
  return indiaDateISO(new Date());
}

// Range resolver shared by summary + category: daily | weekly (Mon-Sun, India) | monthly.
function resolveAttendanceRange(query = {}) {
  const mode = String(query.mode || query.range || 'daily').toLowerCase();
  if (query.date && isValidIsoDate(query.date)) return { mode: 'daily', fromDate: query.date, toDate: query.date };
  if (query.fromDate && query.toDate) {
    const r = parseDateRange(query, 31);
    if (r.error) return r;
    return { mode: mode === 'weekly' ? 'weekly' : mode === 'monthly' ? 'monthly' : 'daily', fromDate: r.fromDate, toDate: r.toDate };
  }
  if (mode === 'weekly' || query.week) {
    const r = parseWeekRange(query);
    if (r.error) return r;
    // No explicit bounds => the current India Mon-Sun week (never a rolling 7 days).
    if (!query.week && !query.fromDate && !query.toDate) {
      const w = indiaWeekRange();
      return { mode: 'weekly', fromDate: w.fromDate, toDate: w.toDate };
    }
    return { mode: 'weekly', fromDate: r.fromDate, toDate: r.toDate };
  }
  if (mode === 'monthly' || query.month) {
    if (query.month && /^\d{4}-\d{2}$/.test(query.month)) {
      const r = parseDateRange(query, 31);
      if (r.error) return r;
      return { mode: 'monthly', fromDate: r.fromDate, toDate: r.toDate };
    }
    const today = indiaTodayISO();
    return { mode: 'monthly', fromDate: today.slice(0, 7) + '-01', toDate: today };
  }
  const today = indiaTodayISO();
  return { mode: 'daily', fromDate: query.date || today, toDate: query.date || today };
}

// Register rows that take part in the status + Late buckets. Week-off / holiday
// rows are excluded here ONCE, so the dashboard summary, the category analytics,
// the roster SQL and the Late detail list can never disagree about Late.
function usableRegisterRows(rows) {
  return (rows || []).filter(row => classifyRow({ ...row, statusCode: attendanceCode(row.status) }) !== 'Week Off');
}

// ONE attendance aggregation over an arbitrary [fromDate, toDate] (inclusive).
// Punched  = DISTINCT employees with >=1 real punch in range (IN-only counts).
// Complete = DISTINCT employees with >=1 complete (IN+OUT) row in range.
// Miss     = DISTINCT employees with >=1 incomplete row and zero complete rows.
// Absent   = staff - punched - weekoff-only (daily: staff with no punch row).
// Late     = DISTINCT employees with FINAL late (after monthly Staff grace consumption) in range.
async function aggregateAttendance(pool, fromDate, toDate, activeFilter = 'Y') {
  // Ongoing-shift context (tblshiftmaster): aaj ki incomplete shift Miss Punch nahi.
  const shiftMap = await loadShiftEndTimes(pool);
  const categoryMap = await loadCategoryNames(pool);
  const empShiftMap = await loadEmployeeShiftMap(pool);
  const nowMin = indiaNowMinutes(), todayIso = indiaTodayISO();
  let empQuery = 'SELECT paycode, LTRIM(RTRIM(cat)) AS cat, LTRIM(RTRIM(companycode)) AS companycode FROM dbo.tblemployee';
  if (activeFilter === 'Y') {
    empQuery += " WHERE LTRIM(RTRIM(active)) = 'Y'";
  } else if (activeFilter === 'N') {
    empQuery += " WHERE LTRIM(RTRIM(active)) = 'N'";
  }
  // activeFilter === null or 'ALL' -> no filter
  const [empResult, regResult, rawResult] = await Promise.all([
    pool.request().query(empQuery),
    pool.request().input('fromDate', sql.Date, fromDate).input('toDate', sql.Date, toDate).query(
      `SELECT ${attendanceFields} FROM dbo.tbltimeregister WHERE dateoffice >= @fromDate AND dateoffice < DATEADD(DAY, 1, @toDate)`),
    pool.request().input('fromDate', sql.Date, fromDate).input('toDate', sql.Date, toDate).query(
      `SELECT COUNT(1) AS rawPunchRecords FROM dbo.machinerawpunch WHERE CAST(officepunch AS date) >= @fromDate AND CAST(officepunch AS date) <= @toDate`)
  ]);
  const rowsByPay = new Map();
  for (const row of regResult.recordset) {
    const k = String(row.paycode).trim();
    if (!rowsByPay.has(k)) rowsByPay.set(k, []);
    rowsByPay.get(k).push(row);
  }
  // Build employee info map: paycode -> {cat, companycode}
  const empInfoMap = new Map();
  for (const emp of empResult.recordset) {
    empInfoMap.set(String(emp.paycode).trim(), { cat: emp.cat, companycode: emp.companycode });
  }
  let punched = 0, complete = 0, miss = 0, absent = 0, late = 0;
  for (const emp of empResult.recordset) {
    const paycode = String(emp.paycode).trim();
    const rows = rowsByPay.get(paycode) || [];
    const usable = usableRegisterRows(rows);
    const hasAnyPunch = usable.some(hasPunch);
    const hasComplete = usable.some(hasCompletePunch);
    const hasIncomplete = usable.some(r => hasPunch(r) && !hasCompletePunch(r) && !isOngoingShiftRow(r, shiftMap, nowMin, todayIso));
    if (hasAnyPunch) punched += 1;
    else absent += 1;
    if (hasComplete) complete += 1;
    else if (hasIncomplete) miss += 1;
    
    // Compute FINAL late count after monthly Staff grace consumption
    const empInfo = empInfoMap.get(paycode) || { cat: '', companycode: '' };
    // Group rows by calendar month and compute final late per month
    const rowsByMonth = new Map();
    for (const row of usable) {
      const d = row.dateoffice instanceof Date ? row.dateoffice : new Date(row.dateoffice);
      const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
      if (!rowsByMonth.has(key)) rowsByMonth.set(key, []);
      rowsByMonth.get(key).push(row);
    }
    let empFinalLate = 0;
    for (const [monthKey, monthRows] of rowsByMonth) {
      const [year, month] = monthKey.split('-').map(Number);
      const monthlyResult = computeMonthlyLateForEmployee(monthRows, shiftMap, empInfo.cat, empInfo.companycode, paycode, year, month);
      empFinalLate += monthlyResult.finalLateCount;
    }
    if (empFinalLate > 0) late += 1;
  }
  return {
    totalstaff: empResult.recordset.length,
    punched, complete, miss, absent, late,
    rawPunchRecords: Number(rawResult.recordset[0]?.rawPunchRecords || 0)
  };
}

function formatPunchTimeIST(value) {
  if (!value) return null;
  const d = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(d.valueOf())) return null;
  let h = d.getUTCHours();
  const m = d.getUTCMinutes();
  const ampm = h >= 12 ? 'PM' : 'AM';
  let h12 = h % 12;
  if (h12 === 0) h12 = 12;
  return `${String(h12).padStart(2, '0')}:${String(m).padStart(2, '0')} ${ampm}`;
}

function hasPunch(row) {
  return Boolean(row && (row.in1 || row.in2 || row.out1 || row.out2));
}

function hasCompletePunch(row) {
  if (!row) return false;
  const hasIn = Boolean(row.in1 || row.in2);
  const hasOut = Boolean(row.out1 || row.out2);
  return hasIn && hasOut;
}

/* ---- Shift completion (REAL system data: dbo.tblshiftmaster; koi invented timing nahi) ----
   Miss Punch tab hi ginā jātā hai jab attendance period/shift COMPLETE ho chuka ho.
   Aaj ki chalti hui shift (IN ho chuka, OUT pending, aur configured shift end time abhi
   nahi aaya) ko Miss Punch nahi ginā jātā — din/shift guzarne par existing rule apply
   hota hai. End time lookup: register row ka shiftendtime → tblshiftmaster (company
   match) → tblshiftmaster (same shift ka koi bhi row) → unknown shift = poora din
   "in progress" (day-granularity fallback, na ki banaya hua time). */
let shiftEndCache = null;           // Map shift -> { byCompany: Map(comp -> {start, end, cross}), defaultStart, defaultEnd, defaultCross }
let shiftEndLoadedAt = 0;
const SHIFT_END_TTL_MS = 10 * 60 * 1000;
function indiaNowMinutes() {
  const hm = new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Kolkata', hour: '2-digit', minute: '2-digit', hour12: false }).format(new Date());
  const [h, m] = String(hm).split(':');
  return (Number(h) % 24) * 60 + Number(m);
}
function shiftTimeToMinutes(v) {
  if (!v) return null;
  const d = v instanceof Date ? v : new Date(v);
  if (Number.isNaN(d.valueOf())) return null;
  return d.getUTCHours() * 60 + d.getUTCMinutes(); // 1900-01-01 base: UTC part hi wall time hai
}
async function loadShiftEndTimes(pool) {
  if (shiftEndCache && Date.now() - shiftEndLoadedAt < SHIFT_END_TTL_MS) return shiftEndCache;
  try {
    const r = await pool.request().query('SELECT LTRIM(RTRIM(shift)) AS shift, LTRIM(RTRIM(companycode)) AS companycode, starttime, endtime FROM dbo.tblshiftmaster');
    const map = new Map();
    for (const row of r.recordset) {
      const sh = String(row.shift || '').trim();
      const start = shiftTimeToMinutes(row.starttime);
      const end = shiftTimeToMinutes(row.endtime);
      if (!sh || start === null || end === null) continue;
      if (!map.has(sh)) map.set(sh, { byCompany: new Map(), defaultStart: start, defaultEnd: end, defaultCross: end <= start });
      const entry = map.get(sh);
      const comp = String(row.companycode || '').trim();
      if (comp) entry.byCompany.set(comp, { start, end, cross: end <= start });
    }
    shiftEndCache = map;
  } catch (_) { if (!shiftEndCache) shiftEndCache = new Map(); } // shiftmaster unavailable → day-granularity fallback
  shiftEndLoadedAt = Date.now();
  return shiftEndCache;
}

/* ---- CATEGORY NAME CACHE ----
   dbo.tblcategory maps category codes (e.g. "STF", "MGR") to names.
   tblemployee.cat stores the category CODE, not the name.
   Used to determine if employee is STAFF for monthly grace eligibility. */
let categoryCache = null;
let categoryLoadedAt = 0;
const CATEGORY_TTL_MS = 10 * 60 * 1000;
async function loadCategoryNames(pool) {
  if (categoryCache && Date.now() - categoryLoadedAt < CATEGORY_TTL_MS) return categoryCache;
  try {
    const r = await pool.request().query('SELECT * FROM dbo.tblcategory');
    const map = new Map();
    for (const row of r.recordset) {
      const keys = Object.keys(row);
      const codeKey = keys.find(k => /code/i.test(k)) || keys[0];
      const nameKey = keys.find(k => /name/i.test(k) && !/code/i.test(k));
      const code = String(row[codeKey] || '').trim();
      if (!code) continue;
      const name = nameKey ? String(row[nameKey] || '').trim().toUpperCase() : code.toUpperCase();
      map.set(code.toUpperCase(), name);
    }
    categoryCache = map;
  } catch (_) { if (!categoryCache) categoryCache = new Map(); }
  categoryLoadedAt = Date.now();
  return categoryCache;
}

/* ---- EMPLOYEE SHIFT ASSIGNMENT CACHE ----
   dbo.tblemployeeshiftmaster maps paycode → shift code (with optional effective dates).
   Used as fallback when tbltimeregister.shift is null/empty. */
let empShiftCache = null;
let empShiftLoadedAt = 0;
const EMP_SHIFT_TTL_MS = 10 * 60 * 1000;
async function loadEmployeeShiftMap(pool) {
  if (empShiftCache && Date.now() - empShiftLoadedAt < EMP_SHIFT_TTL_MS) return empShiftCache;
  try {
    const r = await pool.request().query('SELECT LTRIM(RTRIM(paycode)) AS paycode, LTRIM(RTRIM(shift)) AS shift FROM dbo.tblemployeeshiftmaster');
    const map = new Map();
    for (const row of r.recordset) {
      const pc = String(row.paycode || '').trim();
      const sh = String(row.shift || '').trim();
      if (!pc || !sh) continue;
      map.set(pc, sh);
    }
    empShiftCache = map;
  } catch (_) { if (!empShiftCache) empShiftCache = new Map(); }
  empShiftLoadedAt = Date.now();
  return empShiftCache;
}

/* Resolve the category NAME for an employee from the cat CODE.
   Returns the uppercased category name, or the code itself uppercased if not found. */
function resolveCategory(catCode, categoryMap) {
  if (!catCode) return '';
  const code = String(catCode).trim().toUpperCase();
  if (!categoryMap) return code;
  return categoryMap.get(code) || code;
}

/* Check if an employee category (code or name) qualifies as STAFF for monthly grace. */
function isStaffCategory(catCode, categoryMap) {
  const resolved = resolveCategory(catCode, categoryMap);
  return resolved === 'STAFF' || resolved === 'STF';
}

/* ---- STAFF MONTHLY GRACE TRACKING ----
   Only STAFF category employees get additional monthly grace allowances:
   - 30-minute grace: 2 times per month
   - 1-hour grace: 1 time per month
   - 2-hour grace: 1 time per month
   Resets at the beginning of each calendar month.
   Key format: "paycode-YYYY-MM" (e.g., "EMP001-2026-09")
   Value: { grace30min: count, grace1hr: count, grace2hr: count } */
const staffGraceCache = new Map();
function getStaffGraceKey(paycode, date) {
  const d = date instanceof Date ? date : new Date(date);
  const year = d.getFullYear();
  const month = String(d.getMonth() + 1).padStart(2, '0');
  return `${String(paycode).trim()}-${year}-${month}`;
}
function getStaffGraceUsage(paycode, date) {
  const key = getStaffGraceKey(paycode, date);
  return staffGraceCache.get(key) || { grace30min: 0, grace1hr: 0, grace2hr: 0 };
}
function useStaffGrace(paycode, date, graceType) {
  const key = getStaffGraceKey(paycode, date);
  const usage = staffGraceCache.get(key) || { grace30min: 0, grace1hr: 0, grace2hr: 0 };
  if (graceType === '30min' && usage.grace30min < 2) {
    usage.grace30min += 1;
    staffGraceCache.set(key, usage);
    return true;
  }
  if (graceType === '1hr' && usage.grace1hr < 1) {
    usage.grace1hr += 1;
    staffGraceCache.set(key, usage);
    return true;
  }
  if (graceType === '2hr' && usage.grace2hr < 1) {
    usage.grace2hr += 1;
    staffGraceCache.set(key, usage);
    return true;
  }
  return false;
}
function getAvailableStaffGrace(paycode, date) {
  const usage = getStaffGraceUsage(paycode, date);
  return {
    grace30min: Math.max(0, 2 - usage.grace30min),
    grace1hr: Math.max(0, 1 - usage.grace1hr),
    grace2hr: Math.max(0, 1 - usage.grace2hr)
  };
}

function rowDateIso(v) {
  if (v instanceof Date) return v.toISOString().slice(0, 10);
  const s = String(v == null ? '' : v);
  return /^\d{4}-\d{2}-\d{2}/.test(s) ? s.slice(0, 10) : null;
}
// TRUE = aaj ki date, IN punch ho chuka, OUT pending, aur configured shift end abhi baaki hai.
// Past/future dates par hamesha FALSE (wahan shift complete maani jaati hai → purana rule).
function isOngoingShiftRow(row, shiftMap, nowMin, todayIso) {
  if (!row || !todayIso || rowDateIso(row.dateoffice) !== todayIso) return false;
  if (row.out1 || row.out2) return false;           // OUT aa gaya → shift khatam, normal rule
  if (!(row.in1 || row.in2)) return false;          // koi IN punch nahi → Absent branch
  let endMin = shiftTimeToMinutes(row.shiftendtime); // register row ka apna shift end (jab populated ho)
  if (endMin === null) {
    const entry = shiftMap && shiftMap.get(String(row.shift || '').trim());
    if (!entry) return true;                        // shift config unknown → din bhar in-progress
    const chosen = entry.byCompany.get(String(row.companycode || '').trim()) || { end: entry.defaultEnd, cross: entry.defaultCross };
    if (chosen.cross) return true;                  // midnight-crossing shift aaj complete nahi hoti
    endMin = chosen.end;
  }
  return nowMin < endMin;                           // shift end time abhi nahi hua
}

// Single row classifier used by EVERY endpoint. Late is orthogonal (a flag),
// never a separate status bucket.
function classifyRow(row) {
  if (!row) return 'Absent';
  const code = attendanceCode(row.statusCode || row.status);
  // Aaj ki chalti hui shift (IN done, OUT pending, end time baaki) abhi Miss Punch nahi.
  const ongoing = isOngoingShiftRow(row, shiftEndCache, indiaNowMinutes(), indiaTodayISO());
  if (code === 'WO' || code === 'WEEK OFF' || code === 'WEEKOFF') return 'Week Off';
  if (code === 'HLF' || code === 'HALF' || code === 'HALF DAY') return 'Present';
  if (code === 'SRT' || code === 'SHORT') return 'Present';
  if (code === 'POW' || code === 'PRESENT ON WEEK OFF') return 'Present';
  if (code === 'P' || code === 'PRESENT') return 'Present';
  if (code === 'LATE') return 'Present';
  if (code === 'A' || code === 'ABS' || code === 'ABSENT') {
    // Real punch beats a stale Absent flag: IN without OUT = Miss Punch —
    // lekin sirf shift/din complete hone ke baad (ongoing shift = abhi Present-at-work).
    if (row.in1 || row.in2) return ongoing ? 'Present' : 'Miss Punch';
    return 'Absent';
  }
  if (code === 'MIS' || code === 'MISS' || code === 'MISS PUNCH' || code === 'MISPUNCH') return ongoing ? 'Present' : 'Miss Punch';
  if (code === 'H' || code === 'HOLIDAY') return 'Week Off';
  // NULL / unknown status: derive from punches so IN-only rows never vanish.
  if (row.in1 || row.in2) return hasCompletePunch(row) ? 'Present' : (ongoing ? 'Present' : 'Miss Punch');
  if (row.out1 || row.out2) return 'Miss Punch';
  return 'Absent';
}

function normalizeAttendance(row, shiftMap, employeeCategory, companycode) {
  const lateResult = shiftMap && employeeCategory !== undefined
    ? computeLateStatus(row, shiftMap, employeeCategory, companycode, row.paycode)
    : { isLate: isLateRow(row), lateMinutes: Number(row.latearrival || 0), graceUsed: null };
  
  const normalized = {
    paycode: row.paycode, date: row.dateoffice, dateoffice: row.dateoffice, shift: row.shift,
    in1: row.in1, in2: row.in2, out1: row.out1, out2: row.out2,
    hoursworked: row.hoursworked, otduration: row.otduration ?? null, latearrival: lateResult.lateMinutes,
    status: row.status, statusCode: attendanceCode(row.status),
    isLate: lateResult.isLate, reason: row.reason, graceUsed: lateResult.graceUsed
  };
  // DB datetime untouched; display-only IST wall-clock time (HH:MM AM/PM).
  normalized.inTime = formatPunchTimeIST(row.in1 || row.in2);
  normalized.outTime = formatPunchTimeIST(row.out1 || row.out2);
  normalized.statusLabel = attendanceStatus(row.status) || classifyRow(normalized);
  normalized.computedStatus = classifyRow({ ...normalized, status: normalized.status, statusCode: normalized.statusCode });
  normalized.punchedToday = hasPunch(normalized);
  return normalized;
}

function calculateStats(rows) {
  return rows.reduce((stats, row) => {
    const label = classifyRow({ ...row, status: row.statusCode || row.status, statusCode: row.statusCode || row.status });
    if (label === 'Week Off') return stats;
    if (label === 'Absent') stats.absent += 1;
    else if (label === 'Miss Punch') stats.miss += 1;
    else stats.present += 1;
    if (isLateRow(row)) stats.late += 1;
    stats.hours += Number(row.hoursworked || 0);
    return stats;
  }, { present: 0, absent: 0, miss: 0, late: 0, hours: 0 });
}

async function queryAttendance(pool, paycode, range) {
  const request = pool.request()
    .input('paycode', sql.VarChar(50), paycode || null)
    .input('fromDate', sql.Date, range.fromDate)
    .input('toDate', sql.Date, range.toDate);
  const result = await request.query(`
    SELECT ${attendanceFields}
    FROM dbo.tbltimeregister
    WHERE (@paycode IS NULL OR paycode = @paycode)
      AND dateoffice >= @fromDate
      AND dateoffice < DATEADD(DAY, 1, @toDate)
    ORDER BY dateoffice DESC`);
  return result.recordset;
}

app.get('/api/health', async (_req, res) => {
  try {
    const pool = await getPool();
    const result = await pool.request().query('SELECT DB_NAME() AS databaseName');
    res.json({ status: 'ok', source: 'Savior Biometric SQL Server', database: result.recordset[0]?.databaseName });
  } catch (error) { sendDbError(res, error); }
});

app.get('/api/diagnostics/db', async (_req, res) => {
  const config = getDbConfigStatus();
  if (!config.databaseConfigured || !config.userConfigured || !config.passwordConfigured) {
    return res.status(503).json({ success: false, status: 'not_configured', message: 'Database connection unavailable.', config });
  }
  try {
    const pool = await getPool();
    const result = await pool.request().query('SELECT DB_NAME() AS databaseName, 1 AS connectionCheck');
    res.json({ success: true, status: 'connected', database: result.recordset[0]?.databaseName, connectionCheck: result.recordset[0]?.connectionCheck, config });
  } catch (error) {
    res.status(503).json({ success: false, status: 'unavailable', message: databaseErrorMessage(error), config });
  }
});

app.get('/api/diagnostics/schema', authenticate, requireRole('HR'), requireDbConfig, async (_req, res) => {
  try {
    const pool = await getPool();
    const [result, indexes, foreignKeys] = await Promise.all([
      pool.request().query(`
      SELECT DB_NAME() AS databaseName, s.name AS schemaName, t.name AS tableName,
        c.name AS columnName, ty.name AS dataType, c.max_length AS maxLength, c.is_nullable AS isNullable
      FROM sys.tables t JOIN sys.schemas s ON s.schema_id = t.schema_id
      JOIN sys.columns c ON c.object_id = t.object_id JOIN sys.types ty ON ty.user_type_id = c.user_type_id
      WHERE s.name = 'dbo' AND t.name IN ('tblemployee', 'tbltimeregister', 'machinerawpunch')
      ORDER BY t.name, c.column_id`),
      pool.request().query(`
        SELECT OBJECT_SCHEMA_NAME(i.object_id) AS schemaName, OBJECT_NAME(i.object_id) AS tableName,
          i.name AS indexName, i.is_primary_key AS isPrimaryKey, i.is_unique AS isUnique
        FROM sys.indexes i
        WHERE OBJECT_SCHEMA_NAME(i.object_id) = 'dbo'
          AND OBJECT_NAME(i.object_id) IN ('tblemployee', 'tbltimeregister', 'machinerawpunch')
          AND i.name IS NOT NULL ORDER BY tableName, indexName`),
      pool.request().query(`
        SELECT OBJECT_SCHEMA_NAME(parent_object_id) AS parentSchema, OBJECT_NAME(parent_object_id) AS parentTable,
          name AS constraintName, OBJECT_SCHEMA_NAME(referenced_object_id) AS referencedSchema,
          OBJECT_NAME(referenced_object_id) AS referencedTable
        FROM sys.foreign_keys WHERE OBJECT_SCHEMA_NAME(parent_object_id) = 'dbo'
          AND (OBJECT_NAME(parent_object_id) IN ('tblemployee', 'tbltimeregister', 'machinerawpunch')
            OR OBJECT_NAME(referenced_object_id) IN ('tblemployee', 'tbltimeregister', 'machinerawpunch'))`)
    ]);
    const required = {
      tblemployee: ['paycode', 'empname', 'presentcardno', 'companycode'],
      tbltimeregister: ['paycode', 'dateoffice', 'shift', 'in1', 'in2', 'out1', 'out2', 'hoursworked', 'status', 'reason'],
      machinerawpunch: ['cardno', 'mc_no', 'officepunch', 'inout', 'ismanual']
    };
    const tables = Object.fromEntries(Object.entries(required).map(([table, columns]) => {
      const found = result.recordset.filter(row => row.tableName === table);
      const names = new Set(found.map(row => row.columnName.toLowerCase()));
      return [table, { present: found.length > 0, columns: found, missing: columns.filter(column => !names.has(column)) }];
    }));
    res.json({ database: result.recordset[0]?.databaseName || null, tables, indexes: indexes.recordset, foreignKeys: foreignKeys.recordset });
  } catch (error) { sendDbError(res, error); }
});

app.post('/api/auth/employee/login', requireConfiguredAuth, async (req, res) => {
  const paycode = String(req.body?.paycode || '').trim();
  const password = String(req.body?.password || '');
  if (!paycode || !password) return res.status(400).json({ success: false, message: 'Employee paycode and password are required.' });
  if (devEmployeeAuthEnabled && paycode === devEmployeePaycode) {
    if (password !== devEmployeePassword) return res.status(401).json({ success: false, message: 'Invalid employee credentials.' });
    return res.json({ success: true, token: signUser({ id: paycode, role: 'EMPLOYEE', paycode, devEmployee: true }), role: 'EMPLOYEE', employee: { paycode, empname: 'Development Employee', presentcardno: null, companycode: null } });
  }
  if (!process.env.DB_SERVER || !process.env.DB_DATABASE || !process.env.DB_USER || !process.env.DB_PASSWORD) return res.status(503).json({ success: false, message: 'Database connection unavailable.' });
  try {
    const pool = await getPool();
    const result = await pool.request().input('paycode', sql.VarChar(50), paycode).query('SELECT TOP 1 paycode, empname, presentcardno, companycode FROM dbo.tblemployee WHERE paycode = @paycode');
    const employee = result.recordset[0];
    if (!employee) return res.status(401).json({ success: false, message: 'Employee not found.' });
    res.json({ success: true, token: signUser({ id: employee.paycode, role: 'EMPLOYEE', paycode: employee.paycode }), role: 'EMPLOYEE', employee });
  } catch (error) { sendDbError(res, error); }
});

app.post('/api/auth/hr/login', requireConfiguredAuth, async (req, res) => {
  const username = String(req.body?.username || '').trim();
  const password = String(req.body?.password || '');
  if (!username || !password) return res.status(400).json({ success: false, message: 'HR username and password are required.' });
  if (!hrUsername || !hrPassword) return res.status(503).json({ success: false, message: 'HR authentication is not configured.' });
  if (username !== hrUsername || password !== hrPassword) return res.status(401).json({ success: false, message: 'Invalid HR credentials.' });
  res.json({ success: true, token: signUser({ id: username, role: 'HR' }), role: 'HR' });
});

app.get('/api/me', authenticate, async (req, res) => {
  if (req.user.role === 'HR') return res.json({ role: 'HR' });
  if (req.user.role === 'EMPLOYEE' && req.user.devEmployee === true && devEmployeeAuthEnabled && req.user.paycode === devEmployeePaycode) return res.json({ role: 'EMPLOYEE', employee: { paycode: devEmployeePaycode, empname: 'Development Employee', presentcardno: null, companycode: null } });
  if (!process.env.DB_SERVER || !process.env.DB_DATABASE || !process.env.DB_USER || !process.env.DB_PASSWORD) return res.status(503).json({ success: false, message: 'Database connection unavailable.' });
  try {
    const pool = await getPool();
    const result = await pool.request().input('paycode', sql.VarChar(50), req.user.paycode).query('SELECT TOP 1 paycode, empname, presentcardno, companycode FROM dbo.tblemployee WHERE paycode = @paycode');
    if (!result.recordset[0]) return res.status(404).json({ success: false, message: 'Employee not found.' });
    res.json({ role: 'EMPLOYEE', employee: result.recordset[0] });
  } catch (error) { sendDbError(res, error); }
});

async function employeeAttendance(req, res, parser = parseDateRange) {
  const range = parser(req.query);
  if (!validateRange(res, range)) return;
  try {
    const pool = await getPool();
    const shiftMap = await loadShiftEndTimes(pool);
    // Fetch employee category and company code
    const empResult = await pool.request().input('paycode', sql.VarChar(50), req.user.paycode).query(`
      SELECT LTRIM(RTRIM(cat)) AS cat, LTRIM(RTRIM(companycode)) AS companycode FROM dbo.tblemployee WHERE paycode = @paycode`);
    const empInfo = empResult.recordset[0] || { cat: '', companycode: '' };
    const rows = await queryAttendance(pool, req.user.paycode, range);
    res.json(rows.map(r => normalizeAttendance(r, shiftMap, empInfo.cat, empInfo.companycode)));
  } catch (error) { sendDbError(res, error); }
}

app.get('/api/employee/daily', authenticate, requireRole('EMPLOYEE'), requireDbConfig, (req, res) => employeeAttendance(req, res));
app.get('/api/employee/weekly', authenticate, requireRole('EMPLOYEE'), requireDbConfig, (req, res) => employeeAttendance(req, res, parseWeekRange));
app.get('/api/employee/monthly', authenticate, requireRole('EMPLOYEE'), requireDbConfig, (req, res) => employeeAttendance(req, res));

app.get('/api/employee/dashboard', authenticate, requireRole('EMPLOYEE'), requireDbConfig, async (req, res) => {
  const range = parseDateRange(req.query, 31);
  if (!validateRange(res, range)) return;
  try {
    const pool = await getPool();
    const shiftMap = await loadShiftEndTimes(pool);
    const categoryMap = await loadCategoryNames(pool);
    const empShiftMap = await loadEmployeeShiftMap(pool);
    // Fetch employee category and company code
    const empResult = await pool.request().input('paycode', sql.VarChar(50), req.user.paycode).query(`
      SELECT LTRIM(RTRIM(cat)) AS cat, LTRIM(RTRIM(companycode)) AS companycode FROM dbo.tblemployee WHERE paycode = @paycode`);
    const empInfo = empResult.recordset[0] || { cat: '', companycode: '' };
    const rows = await queryAttendance(pool, req.user.paycode, range);
    
    // Compute FINAL late count with monthly grace consumption (per calendar month)
    const rowsByMonth = new Map();
    for (const row of rows) {
      const d = row.dateoffice instanceof Date ? row.dateoffice : new Date(row.dateoffice);
      const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
      if (!rowsByMonth.has(key)) rowsByMonth.set(key, []);
      rowsByMonth.get(key).push(row);
    }
    
    let finalLateCount = 0;
    for (const [monthKey, monthRows] of rowsByMonth) {
      const [year, month] = monthKey.split('-').map(Number);
      const monthlyResult = computeMonthlyLateForEmployee(monthRows, shiftMap, empInfo.cat, empInfo.companycode, req.user.paycode, year, month);
      finalLateCount += monthlyResult.finalLateCount;
    }
    
    // Calculate stats with grace-aware late computation
    const stats = rows.reduce((s, row) => {
      const label = classifyRow({ ...row, status: row.statusCode || row.status, statusCode: row.statusCode || row.status });
      if (label === 'Week Off') return s;
      if (label === 'Absent') s.absent += 1;
      else if (label === 'Miss Punch') s.miss += 1;
      else s.present += 1;
      const lateResult = computeLateStatus(row, shiftMap, empInfo.cat, empInfo.companycode, req.user.paycode);
      if (lateResult.isLate) s.late += 1;  // Raw late count
      s.hours += Number(row.hoursworked || 0);
      return s;
    }, { present: 0, absent: 0, miss: 0, late: 0, hours: 0 });
    
    // Override late with FINAL late count after monthly grace consumption
    stats.late = finalLateCount;
    
    const total = stats.present + stats.absent + stats.miss;
    res.json({ ...stats, attendancePercentage: total ? Number((stats.present / total * 100).toFixed(1)) : 0, records: rows.length });
  } catch (error) { sendDbError(res, error); }
});

app.get('/api/attendance', authenticate, requireDbConfig, async (req, res) => {
  const range = parseDateRange(req.query, 31);
  if (!validateRange(res, range)) return;
  if (req.user.role === 'EMPLOYEE' && req.query.paycode && req.query.paycode !== req.user.paycode) return res.status(403).json({ success: false, message: 'Forbidden.' });
  try {
    const pool = await getPool();
    const shiftMap = await loadShiftEndTimes(pool);
    const paycode = req.user.role === 'EMPLOYEE' ? req.user.paycode : req.query.paycode || null;
    // Fetch employee category and company code
    const empResult = await pool.request().input('paycode', sql.VarChar(50), paycode).query(`
      SELECT LTRIM(RTRIM(cat)) AS cat, LTRIM(RTRIM(companycode)) AS companycode FROM dbo.tblemployee WHERE paycode = @paycode`);
    const empInfo = empResult.recordset[0] || { cat: '', companycode: '' };
    const rows = await queryAttendance(pool, paycode, range);
    res.json(rows.map(r => normalizeAttendance(r, shiftMap, empInfo.cat, empInfo.companycode)));
  } catch (error) { sendDbError(res, error); }
});

async function listEmployees(req, res) {
  const page = Math.max(Number(req.query.page || 1), 1);
  const pageSize = Math.min(Math.max(Number(req.query.pageSize || 25), 1), 100);
  const offset = (page - 1) * pageSize;
  const search = String(req.query.search || '').trim() || null;
  // All roster filters are applied SERVER-SIDE against real dbo.tblemployee values
  // (trim() on both sides because master columns are CHAR-padded, e.g. "EXECUTIVE   ").
  const companycode = String(req.query.companycode || '').trim() || null;
  const departmentcode = String(req.query.departmentcode || '').trim() || null;
  const sex = String(req.query.sex || '').trim() || null;
  const cat = String(req.query.cat || '').trim() || null;
  const designation = String(req.query.designation || '').trim() || null;
  const ismarried = String(req.query.ismarried || '').trim() || null;
  const activeParam = String(req.query.active || 'Y').trim().toUpperCase();
  // activeParam can be: 'Y' (active only, default), 'N' (inactive only), 'ALL' (no filter)
  const activeFilter = activeParam === 'ALL' ? null : activeParam; // null = no filter, 'Y' = active, 'N' = inactive
  const request = (await getPool()).request()
    .input('offset', sql.Int, offset).input('pageSize', sql.Int, pageSize)
    .input('search', sql.VarChar(100), search).input('companycode', sql.VarChar(50), companycode)
    .input('departmentcode', sql.VarChar(50), departmentcode).input('sex', sql.VarChar(50), sex)
    .input('cat', sql.VarChar(50), cat).input('designation', sql.VarChar(100), designation)
    .input('ismarried', sql.VarChar(50), ismarried).input('active', sql.VarChar(50), activeFilter);
  const result = await request.query(`
    SELECT COUNT(1) OVER() AS totalcount, LTRIM(RTRIM(e.paycode)) AS paycode, LTRIM(RTRIM(e.empname)) AS empname, LTRIM(RTRIM(e.presentcardno)) AS presentcardno,
      LTRIM(RTRIM(e.companycode)) AS companycode, LTRIM(RTRIM(e.departmentcode)) AS departmentcode,
      LTRIM(RTRIM(d.departmentname)) AS departmentname, LTRIM(RTRIM(c.companyname)) AS companyname, LTRIM(RTRIM(e.designation)) AS designation,
      e.dateofbirth, e.dateofjoin, LTRIM(RTRIM(e.sex)) AS sex, LTRIM(RTRIM(e.cat)) AS cat,
      LTRIM(RTRIM(e.ismarried)) AS ismarried, LTRIM(RTRIM(e.active)) AS active,
      COALESCE(a.presentCount, 0) AS presentCount, COALESCE(a.absentCount, 0) AS absentCount,
      COALESCE(a.missCount, 0) AS missCount, COALESCE(a.lateCount, 0) AS lateCount, COALESCE(a.totalHours, 0) AS totalHours
    FROM dbo.tblemployee e
    LEFT JOIN dbo.tbldepartment d ON LTRIM(RTRIM(d.departmentcode)) = LTRIM(RTRIM(e.departmentcode))
    LEFT JOIN dbo.tblcompany c ON LTRIM(RTRIM(c.companycode)) = LTRIM(RTRIM(e.companycode))
    OUTER APPLY (
      SELECT SUM(CASE WHEN LTRIM(RTRIM(tr.status)) IN ('P', 'HLF', 'SRT', 'POW', 'Present', 'Late') OR (tr.status IS NULL AND tr.in1 IS NOT NULL AND (tr.out1 IS NOT NULL OR tr.out2 IS NOT NULL)) THEN 1 ELSE 0 END) AS presentCount,
        SUM(CASE WHEN LTRIM(RTRIM(tr.status)) IN ('A', 'ABS', 'Absent') THEN 1 ELSE 0 END) AS absentCount,
        SUM(CASE WHEN (LTRIM(RTRIM(tr.status)) IN ('MIS', 'Miss Punch') OR (tr.status IS NULL AND tr.in1 IS NOT NULL AND tr.out1 IS NULL AND tr.out2 IS NULL))
          AND (tr.dateoffice <> CAST(GETDATE() AS DATE) OR tr.out1 IS NOT NULL OR tr.out2 IS NOT NULL
            OR CAST(GETDATE() AS time) >= COALESCE(CAST(tr.shiftendtime AS time), smx.endtime, '23:59:59'))
          THEN 1 ELSE 0 END) AS missCount,
        SUM(CASE WHEN (COALESCE(tr.latearrival, 0) > 0 OR LTRIM(RTRIM(tr.status)) = 'LATE')
          AND LTRIM(RTRIM(COALESCE(tr.status, ''))) NOT IN ('WO', 'WEEK OFF', 'WEEKOFF', 'H', 'HOLIDAY') THEN 1 ELSE 0 END) AS lateCount, SUM(COALESCE(tr.hoursworked, 0)) AS totalHours
      FROM dbo.tbltimeregister tr
        OUTER APPLY (
          SELECT TOP 1 CAST(sm.endtime AS time) AS endtime
          FROM dbo.tblshiftmaster sm
          WHERE LTRIM(RTRIM(sm.shift)) = LTRIM(RTRIM(tr.shift))
          ORDER BY CASE WHEN LTRIM(RTRIM(sm.companycode)) = LTRIM(RTRIM(e.companycode)) THEN 0 ELSE 1 END
        ) smx
      WHERE tr.paycode = e.paycode
        AND tr.dateoffice >= DATEFROMPARTS(YEAR(GETDATE()), MONTH(GETDATE()), 1)
        AND tr.dateoffice < DATEADD(MONTH, 1, DATEFROMPARTS(YEAR(GETDATE()), MONTH(GETDATE()), 1))
    ) a
    WHERE (@search IS NULL OR e.empname LIKE '%' + @search + '%' OR e.paycode LIKE '%' + @search + '%' OR e.presentcardno LIKE '%' + @search + '%')
      AND (@companycode IS NULL OR LTRIM(RTRIM(e.companycode)) = @companycode)
      AND (@departmentcode IS NULL OR LTRIM(RTRIM(e.departmentcode)) = @departmentcode)
      AND (@sex IS NULL OR LTRIM(RTRIM(e.sex)) = @sex)
      AND (@cat IS NULL OR LTRIM(RTRIM(e.cat)) = @cat)
      AND (@designation IS NULL OR LTRIM(RTRIM(e.designation)) = @designation)
      AND (@ismarried IS NULL OR LTRIM(RTRIM(e.ismarried)) = @ismarried)
      AND (@active IS NULL OR LTRIM(RTRIM(e.active)) = @active)
    ORDER BY e.empname OFFSET @offset ROWS FETCH NEXT @pageSize ROWS ONLY`);
  const rows = result.recordset.map(({ totalcount, ...row }) => ({ ...row, attendanceStats: { present: Number(row.presentCount), absent: Number(row.absentCount), miss: Number(row.missCount), late: Number(row.lateCount), hours: Number(row.totalHours) } }));
  res.json({ rows, page, pageSize, total: Number(result.recordset[0]?.totalcount || 0) });
}

app.get('/api/hr/employees', authenticate, requireRole('HR'), requireDbConfig, async (req, res) => { try { await listEmployees(req, res); } catch (error) { sendDbError(res, error); } });
app.get('/api/employees', authenticate, requireRole('HR'), requireDbConfig, async (req, res) => { try { await listEmployees(req, res); } catch (error) { sendDbError(res, error); } });

// CHAR-padded master columns (sex, designation, cat...) must be trimmed before
// they reach the UI; dates/numbers pass through untouched.
function trimEmployeeRow(row) {
  const out = {};
  for (const [k, v] of Object.entries(row || {})) out[k] = typeof v === 'string' ? v.trim() : v;
  return out;
}

async function getEmployee(req, res) {
  try {
    const result = await (await getPool()).request().input('paycode', sql.VarChar(50), req.params.paycode).query(`
      SELECT TOP 1 e.paycode, e.empname, e.presentcardno, e.companycode, e.departmentcode, e.designation,
        e.dateofbirth, e.dateofjoin, e.sex, e.cat, e.ismarried, e.active,
        COALESCE(LTRIM(RTRIM(d.departmentname)), '') AS departmentname
      FROM dbo.tblemployee e
      LEFT JOIN dbo.tbldepartment d ON LTRIM(RTRIM(d.departmentcode)) = LTRIM(RTRIM(e.departmentcode))
      WHERE e.paycode = @paycode`);
    if (!result.recordset[0]) return res.status(404).json({ success: false, message: 'Employee not found.' });
    res.json(trimEmployeeRow(result.recordset[0]));
  } catch (error) { sendDbError(res, error); }
}

app.get('/api/hr/employee/:paycode', authenticate, requireRole('HR'), requireDbConfig, getEmployee);
app.get('/api/employees/:paycode', authenticate, requireRole('HR'), requireDbConfig, getEmployee);

async function hrSummary(req, res, includePercentage = false) {
  try {
    // ONE source of truth via aggregateAttendance; mode-aware (daily/weekly/monthly).
    const range = resolveAttendanceRange(req?.query || {});
    if (range.error) return res.status(400).json({ success: false, message: range.error });
    const pool = await getPool();
    // Default to active employees only; allow override via ?active=all, ?active=Y, ?active=N
    const activeParam = String(req.query.active || 'Y').trim().toUpperCase();
    // activeParam: 'Y' = active only, 'N' = inactive only, 'ALL' = no filter
    const activeFilter = activeParam === 'ALL' ? null : activeParam;
    const agg = await aggregateAttendance(pool, range.fromDate, range.toDate, activeFilter);
    const summary = {
      indiaToday: indiaTodayISO(),
      mode: range.mode, fromDate: range.fromDate, toDate: range.toDate,
      totalstaff: agg.totalstaff,
      punchedtoday: agg.punched,
      punched: agg.punched,
      presenttoday: agg.complete,
      complete: agg.complete,
      absenttoday: agg.absent,
      misstoday: agg.miss,
      latetoday: agg.late,
      rawPunchRecordsToday: agg.rawPunchRecords
    };
    if (includePercentage) {
      // Punched is the authoritative daily attendance metric (>=1 real punch).
      const total = Number(summary.totalstaff || 0);
      summary.attendancePercentage = total ? Number((Number(summary.punchedtoday || 0) / total * 100).toFixed(1)) : 0;
    }
    res.json(summary);
  } catch (error) { sendDbError(res, error); }
}

app.get('/api/hr/dashboard', authenticate, requireRole('HR'), requireDbConfig, (req, res) => hrSummary(req, res, true));
app.get('/api/hr/summary', authenticate, requireRole('HR'), requireDbConfig, (req, res) => hrSummary(req, res));

// Dashboard Charts API - Returns data for 4 charts in Executive Overview
app.get('/api/hr/dashboard-charts', authenticate, requireRole('HR'), requireDbConfig, async (req, res) => {
  try {
    const pool = await getPool();
    const today = indiaTodayISO();
    const yesterday = indiaDateISO(new Date(new Date(today).getTime() - 24 * 60 * 60 * 1000));
    
    // Default to active employees only; allow override via ?active=Y|N|ALL
    const activeParam = String(req.query.active || 'Y').trim().toUpperCase();
    const activeFilter = activeParam === 'ALL' ? null : activeParam;
    const activeCondition = activeFilter ? "LTRIM(RTRIM(e.active)) = @active" : '1=1';
    
    // Date range for Chart 1 (Attendance Activity) - default to this month
    const fromDate = req.query.fromDate || today.slice(0, 7) + '-01';
    const toDate = req.query.toDate || today;
    
    // Load shift timings from Savior tblshiftmaster
    const shiftMap = await loadShiftEndTimes(pool);
    const categoryMap = await loadCategoryNames(pool);
    const empShiftMap = await loadEmployeeShiftMap(pool);
    
    // Build employee info map
    let empQuery = 'SELECT LTRIM(RTRIM(e.paycode)) AS paycode, LTRIM(RTRIM(e.companycode)) AS companycode, LTRIM(RTRIM(e.cat)) AS cat, LTRIM(RTRIM(e.departmentcode)) AS departmentcode FROM dbo.tblemployee e';
    if (activeFilter) empQuery += ` WHERE ${activeCondition}`;
    const empResult = await pool.request()
      .input('active', sql.VarChar(50), activeFilter)
      .query(empQuery);
    
    const empInfoMap = new Map();
    for (const emp of empResult.recordset) {
      empInfoMap.set(String(emp.paycode).trim(), { cat: emp.cat, companycode: emp.companycode, departmentcode: emp.departmentcode });
    }
    
    // Get attendance register for the date range (Chart 1 & 2)
    const regResult = await pool.request()
      .input('fromDate', sql.Date, fromDate)
      .input('toDate', sql.Date, toDate)
      .query(`SELECT ${attendanceFields} FROM dbo.tbltimeregister WHERE dateoffice >= @fromDate AND dateoffice < DATEADD(DAY, 1, @toDate)`);
    
    const allRows = regResult.recordset;
    
    // ---- Chart 1: Attendance Activity (Pie) - On Time, Arrived Early, Arrived Late ----
    // Count UNIQUE ACTIVE EMPLOYEES per classification for the period
    // Classification priority (worst wins): Arrived Late > Arrived Early > On Time
    const empStatusMap = new Map(); // paycode -> 'late' | 'early' | 'ontime'
    const monthRowsMap = new Map(); // paycode -> rows for monthly grace
    
    // First pass: collect all rows with IN punch per employee
    for (const row of allRows) {
      const paycode = String(row.paycode || '').trim();
      const empInfo = empInfoMap.get(paycode) || { cat: '', companycode: '' };
      const lateStatus = computeLateStatus(row, shiftMap, empInfo.cat, empInfo.companycode, paycode);
      
      if (lateStatus.isLate) {
        // Raw late (after 5-min grace) - will be evaluated for monthly grace
        if (!monthRowsMap.has(paycode)) monthRowsMap.set(paycode, []);
        monthRowsMap.get(paycode).push({ ...row, empCat: empInfo.cat, empCompany: empInfo.companycode });
      } else if (lateStatus.lateMinutes === 0 && lateStatus.graceUsed === '5min') {
        // Within 5-min grace - mark as ontime if not already classified worse
        if (!empStatusMap.has(paycode)) empStatusMap.set(paycode, 'ontime');
      } else if (row.in1 || row.in2) {
        // Has IN punch but not late and not within 5-min grace = arrived early
        if (!empStatusMap.has(paycode) || empStatusMap.get(paycode) === 'ontime') {
          empStatusMap.set(paycode, 'early');
        }
      }
    }
    
    // Compute final late per employee per month using grace consumption
    // If any final late after grace, classify employee as 'late' (worst)
    for (const [paycode, rows] of monthRowsMap) {
      const empInfo = empInfoMap.get(paycode) || { cat: '', companycode: '' };
      // Group by month
      const rowsByMonth = new Map();
      for (const r of rows) {
        const d = r.dateoffice instanceof Date ? r.dateoffice : new Date(r.dateoffice);
        const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
        if (!rowsByMonth.has(key)) rowsByMonth.set(key, []);
        rowsByMonth.get(key).push(r);
      }
      let hasFinalLate = false;
      for (const [monthKey, monthRows] of rowsByMonth) {
        const [year, month] = monthKey.split('-').map(Number);
        const monthlyResult = computeMonthlyLateForEmployee(monthRows, shiftMap, empInfo.cat, empInfo.companycode, paycode, year, month);
        if (monthlyResult.finalLateCount > 0) {
          hasFinalLate = true;
          break;
        }
      }
      if (hasFinalLate) {
        empStatusMap.set(paycode, 'late');
      } else if (!empStatusMap.has(paycode)) {
        // Had raw late but all covered by grace
        empStatusMap.set(paycode, 'ontime');
      }
    }
    
    // Count unique employees per classification
    let onTime = 0, arrivedEarly = 0, arrivedLate = 0;
    for (const [paycode, status] of empStatusMap) {
      if (status === 'late') arrivedLate++;
      else if (status === 'early') arrivedEarly++;
      else onTime++;
    }
    
    // Also include active employees with NO attendance rows in the period as "Arrived Early" (not present)
    // This ensures all active employees are accounted for
    for (const [paycode, empInfo] of empInfoMap) {
      if (!empStatusMap.has(paycode)) {
        // No attendance rows at all in period - employee was absent entire period
        // Don't count in Activity chart (only employees with at least one punch)
        // Alternatively, could count as a separate "Not Present" category
        // For now, skip - chart shows only employees with attendance activity
      }
    }
    
    // ---- Chart 2: Last 10 COMPLETED Days Presence (Bar) ----
    // Last 10 days excluding today (incomplete)
    const tenDaysAgo = indiaDateISO(new Date(new Date(today).getTime() - 10 * 24 * 60 * 60 * 1000));
    const chart2RegResult = await pool.request()
      .input('tenDaysAgo', sql.Date, tenDaysAgo)
      .input('today', sql.Date, today)
      .query(`SELECT ${attendanceFields} FROM dbo.tbltimeregister WHERE dateoffice >= @tenDaysAgo AND dateoffice < @today`);
    
    const chart2Rows = chart2RegResult.recordset;
    const chart2Data = {};
    
    for (const row of chart2Rows) {
      const paycode = String(row.paycode || '').trim();
      const empInfo = empInfoMap.get(paycode) || { cat: '', companycode: '' };
      const dateStr = row.dateoffice instanceof Date ? indiaDateISO(row.dateoffice) : row.dateoffice;
      if (!chart2Data[dateStr]) chart2Data[dateStr] = { present: 0, missPunch: 0, absent: 0, late: 0 };
      
      const label = classifyRow({ ...row, statusCode: attendanceCode(row.status) });
      if (label === 'Present') {
        // Check if late using grace-aware logic
        const lateStatus = computeLateStatus(row, shiftMap, empInfo.cat, empInfo.companycode, paycode);
        if (lateStatus.isLate) {
          // Will be handled by monthly grace - for daily view show as present (grace applied later)
          chart2Data[dateStr].present++;
        } else {
          chart2Data[dateStr].present++;
        }
      } else if (label === 'Miss Punch') {
        chart2Data[dateStr].missPunch++;
      } else {
        chart2Data[dateStr].absent++;
      }
    }
    
    // Generate last 10 days labels (excluding today)
    const last10Labels = [];
    const last10Present = [];
    const last10MissPunch = [];
    const last10Absent = [];
    
    for (let i = 10; i >= 1; i--) {
      const d = new Date(today);
      d.setDate(d.getDate() - i);
      const dateStr = indiaDateISO(d);
      last10Labels.push(dateStr.slice(5)); // MM-DD
      const data = chart2Data[dateStr] || { present: 0, missPunch: 0, absent: 0 };
      last10Present.push(data.present);
      last10MissPunch.push(data.missPunch);
      last10Absent.push(data.absent);
    }
    
    // ---- Chart 3: Currently Present by Company ----
    // Employees with IN today, no OUT, and shift not yet ended
    const chart3RegResult = await pool.request()
      .input('today', sql.Date, today)
      .query(`SELECT ${attendanceFields} FROM dbo.tbltimeregister WHERE dateoffice = @today`);
    
    const todayRows = chart3RegResult.recordset;
    const companyPresentMap = new Map();
    
    for (const row of todayRows) {
      const paycode = String(row.paycode || '').trim();
      const hasIn = row.in1 || row.in2;
      const hasOut = row.out1 || row.out2;
      if (!hasIn || hasOut) continue; // Not currently present
      
      const empInfo = empInfoMap.get(paycode) || { cat: '', companycode: '' };
      // Check if shift is ongoing
      const ongoing = isOngoingShiftRow(row, shiftMap, indiaNowMinutes(), today);
      if (!ongoing) continue; // Shift already ended
      
      const compCode = String(empInfo.companycode || '—').trim() || '—';
      companyPresentMap.set(compCode, (companyPresentMap.get(compCode) || 0) + 1);
    }
    
    // Get company names
    const companyNames = new Map();
    for (const emp of empResult.recordset) {
      const comp = String(emp.companycode || '—').trim() || '—';
      if (!companyNames.has(comp)) companyNames.set(comp, comp); // fallback to code
    }
    // Try to get company names from tblcompany
    const compResult = await pool.request().query('SELECT LTRIM(RTRIM(companycode)) AS companycode, LTRIM(RTRIM(companyname)) AS companyname FROM dbo.tblcompany');
    for (const r of compResult.recordset) {
      companyNames.set(String(r.companycode || '').trim(), r.companyname || r.companycode);
    }
    
    const chart3Labels = [];
    const chart3Data = [];
    const chart3Colors = ['#6366f1', '#10b981', '#f59e0b', '#f43f5e', '#8b5cf6', '#ec4899', '#06b6d4', '#84cc16'];
    let idx = 0;
    for (const [compCode, count] of companyPresentMap) {
      chart3Labels.push(companyNames.get(compCode) || compCode);
      chart3Data.push(count);
      idx++;
    }
    
    // ---- Chart 4: Yesterday's Attendance (Bar) - Present, Absent, On Leave ----
    // Use grace-aware classification for yesterday
    const chart4RegResult = await pool.request()
      .input('yesterday', sql.Date, yesterday)
      .query(`SELECT ${attendanceFields} FROM dbo.tbltimeregister WHERE dateoffice = @yesterday`);
    
    const yesterdayRows = chart4RegResult.recordset;
    let yesterdayPresent = 0, yesterdayAbsent = 0, yesterdayOnLeave = 0;
    
    for (const row of yesterdayRows) {
      const paycode = String(row.paycode || '').trim();
      const empInfo = empInfoMap.get(paycode) || { cat: '', companycode: '' };
      const label = classifyRow({ ...row, statusCode: attendanceCode(row.status) });
      
      if (label === 'Present') {
        yesterdayPresent++;
      } else if (label === 'Absent') {
        yesterdayAbsent++;
      } else if (label === 'Miss Punch') {
        // Check if it's actually a short leave
        const lateStatus = computeLateStatus(row, shiftMap, empInfo.cat, empInfo.companycode, paycode);
        if (row.status && ['SRT', 'SHORT', 'HLF', 'HALF'].includes(attendanceCode(row.status))) {
          yesterdayOnLeave++;
        } else {
          // Miss punch treated as absent for yesterday if shift complete
          yesterdayAbsent++;
        }
      }
    }
    
    // Also include employees with no punch row for yesterday
    const yesterdayEmpWithRow = new Set(yesterdayRows.map(r => String(r.paycode || '').trim()));
    for (const [paycode, empInfo] of empInfoMap) {
      if (!yesterdayEmpWithRow.has(paycode)) {
        yesterdayAbsent++;
      }
    }
    
    // ---- Chart 5: Department-wise Attendance (Bar) - Present, Absent ----
    // Compute per-department unique employee counts for the period (fromDate to toDate)
    // Reuse the same logic as category-analytics: mutually exclusive Present/Absent per employee
    const deptMap = new Map(); // deptcode -> { present: 0, absent: 0 }
    
    // Group attendance rows by paycode for the period
    const regByPaycodeForDept = new Map();
    for (const row of allRows) {
      const paycode = String(row.paycode || '').trim();
      if (!regByPaycodeForDept.has(paycode)) regByPaycodeForDept.set(paycode, []);
      regByPaycodeForDept.get(paycode).push(row);
    }
    
    for (const emp of empResult.recordset) {
      const paycode = String(emp.paycode || '').trim();
      const deptCode = String(emp.departmentcode || '').trim() || '—';
      const rows = regByPaycodeForDept.get(paycode) || [];
      
      if (!deptMap.has(deptCode)) deptMap.set(deptCode, { departmentcode: deptCode, present: 0, absent: 0 });
      const dbucket = deptMap.get(deptCode);
      
      const hasAnyPunch = rows.some(r => r.in1 || r.in2 || r.out1 || r.out2);
      const hasComplete = rows.some(r => (r.in1 || r.in2) && (r.out1 || r.out2));
      
      if (hasAnyPunch) {
        // Employee had at least one punch in period
        if (hasComplete) {
          dbucket.present += 1;
        } else {
          // Incomplete punch (miss punch) - count as present for dept attendance
          dbucket.present += 1;
        }
      } else {
        // No punch at all in period
        dbucket.absent += 1;
      }
    }
    
    // Get department names
    const deptNames = new Map();
    const deptResult = await pool.request().query('SELECT LTRIM(RTRIM(departmentcode)) AS departmentcode, LTRIM(RTRIM(departmentname)) AS departmentname FROM dbo.tbldepartment');
    for (const r of deptResult.recordset) {
      deptNames.set(String(r.departmentcode || '').trim(), r.departmentname || r.departmentcode);
    }
    
    const chart5Labels = [];
    const chart5Present = [];
    const chart5Absent = [];
    const chart5Colors = ['#6366f1', '#10b981', '#f59e0b', '#f43f5e', '#8b5cf6', '#ec4899', '#06b6d4', '#84cc16', '#f97316', '#14b8a6'];
    let deptIdx = 0;
    for (const [deptCode, data] of deptMap) {
      chart5Labels.push(deptNames.get(deptCode) || deptCode);
      chart5Present.push(data.present);
      chart5Absent.push(data.absent);
      deptIdx++;
    }
    
    const request = pool.request()
      .input('fromDate', sql.Date, fromDate)
      .input('toDate', sql.Date, toDate)
      .input('tenDaysAgo', sql.Date, tenDaysAgo)
      .input('today', sql.Date, today)
      .input('yesterday', sql.Date, yesterday);
      
    if (activeFilter) {
      request.input('active', sql.VarChar(50), activeFilter);
    }
    
    res.json({
      success: true,
      chart1: {
        labels: ['On Time', 'Arrived Early', 'Arrived Late'],
        data: [onTime, arrivedEarly, arrivedLate],
        colors: ['#10b981', '#06b6d4', '#f43f5e']
      },
      chart2: {
        labels: last10Labels,
        datasets: [
          { label: 'Present', data: last10Present, backgroundColor: '#10b981' },
          { label: 'Miss Punch', data: last10MissPunch, backgroundColor: '#f59e0b' },
          { label: 'Absent', data: last10Absent, backgroundColor: '#f43f5e' }
        ]
      },
      chart3: {
        labels: chart3Labels,
        data: chart3Data,
        backgroundColor: chart3Labels.map((_, i) => chart3Colors[i % chart3Colors.length])
      },
      chart4: {
        labels: ['Present', 'Absent', 'On Leave'],
        data: [yesterdayPresent, yesterdayAbsent, yesterdayOnLeave],
        colors: ['#10b981', '#f43f5e', '#8b5cf6']
      },
      chart5: {
        labels: chart5Labels,
        datasets: [
          { label: 'Present', data: chart5Present, backgroundColor: '#10b981', borderRadius: 5 },
          { label: 'Absent', data: chart5Absent, backgroundColor: '#f43f5e', borderRadius: 5 }
        ]
      }
    });
  } catch (error) {
    sendDbError(res, error);
  }
});

async function dailyMaster(req, res) {
  const range = parseDateRange(req.query);
  if (!validateRange(res, range)) return;
  // Default to active employees only; allow override via ?active=Y|N|ALL
  const activeParam = String(req.query.active || 'Y').trim().toUpperCase();
  // Support department and company filters
  const departmentcode = String(req.query.departmentcode || '').trim() || null;
  const companycode = String(req.query.companycode || '').trim() || null;
  let query = `
    SELECT e.paycode, e.empname, e.companycode, e.departmentcode, LTRIM(RTRIM(e.cat)) AS cat, tr.dateoffice, tr.in1, tr.in2, tr.out1, tr.out2, tr.hoursworked, tr.latearrival, tr.status, tr.reason
    FROM dbo.tblemployee e OUTER APPLY (
      SELECT ${attendanceFields}
      FROM dbo.tbltimeregister tr WHERE tr.paycode = e.paycode AND tr.dateoffice >= @fromDate AND tr.dateoffice < DATEADD(DAY, 1, @toDate)
    ) tr`;
  const conditions = [];
  if (activeParam === 'Y') {
    conditions.push("LTRIM(RTRIM(e.active)) = 'Y'");
  } else if (activeParam === 'N') {
    conditions.push("LTRIM(RTRIM(e.active)) = 'N'");
  }
  if (departmentcode) {
    conditions.push("LTRIM(RTRIM(e.departmentcode)) = @departmentcode");
  }
  if (companycode) {
    conditions.push("LTRIM(RTRIM(e.companycode)) = @companycode");
  }
  if (conditions.length > 0) {
    query += ' WHERE ' + conditions.join(' AND ');
  }
  query += ' ORDER BY e.empname';
  try {
    const pool = await getPool();
    const shiftMap = await loadShiftEndTimes(pool);
    const request = pool.request()
      .input('fromDate', sql.Date, range.fromDate)
      .input('toDate', sql.Date, range.toDate);
    if (departmentcode) request.input('departmentcode', sql.VarChar(50), departmentcode);
    if (companycode) request.input('companycode', sql.VarChar(50), companycode);
    const result = await request.query(query);
    res.json(result.recordset.map(row => {
      const n = normalizeAttendance(row, shiftMap, row.cat, row.companycode);
      const computed = n.computedStatus || 'Absent';
      const hasRow = Boolean(row.dateoffice);
      return {
        paycode: row.paycode, empname: row.empname, companycode: row.companycode, departmentcode: row.departmentcode,
        date: row.dateoffice, in1: row.in1, in2: row.in2, out1: row.out1, out2: row.out2,
        hoursworked: row.hoursworked, latearrival: n.latearrival,
        status: row.status, statusCode: n.statusCode, statusLabel: hasRow ? computed : 'No Record',
        computedStatus: hasRow ? computed : 'No Record',
        inTime: n.inTime, outTime: n.outTime,
        isLate: n.isLate, reason: row.reason, graceUsed: n.graceUsed
      };
    }));
  } catch (error) { sendDbError(res, error); }
}

app.get('/api/hr/daily-master', authenticate, requireRole('HR'), requireDbConfig, dailyMaster);
app.get('/api/hr/daily', authenticate, requireRole('HR'), requireDbConfig, dailyMaster);

app.get('/api/hr/audit/:paycode', authenticate, requireRole('HR'), requireDbConfig, async (req, res) => {
  const range = parseDateRange(req.query, 31);
  if (!validateRange(res, range)) return;
  try {
    const pool = await getPool();
    const shiftMap = await loadShiftEndTimes(pool);
    const categoryMap = await loadCategoryNames(pool);
    const empShiftMap = await loadEmployeeShiftMap(pool);
    const employeeResult = await pool.request().input('paycode', sql.VarChar(50), req.params.paycode).query(`
      SELECT TOP 1 e.paycode, e.empname, e.presentcardno,
        LTRIM(RTRIM(e.companycode)) AS companycode, LTRIM(RTRIM(c.companyname)) AS companyname,
        LTRIM(RTRIM(e.departmentcode)) AS departmentcode, LTRIM(RTRIM(d.departmentname)) AS departmentname,
        LTRIM(RTRIM(e.designation)) AS designation, e.dateofbirth, e.dateofjoin,
        LTRIM(RTRIM(e.sex)) AS sex, LTRIM(RTRIM(e.cat)) AS cat,
        LTRIM(RTRIM(e.ismarried)) AS ismarried, LTRIM(RTRIM(e.active)) AS active
      FROM dbo.tblemployee e
      LEFT JOIN dbo.tbldepartment d ON LTRIM(RTRIM(d.departmentcode)) = LTRIM(RTRIM(e.departmentcode))
      LEFT JOIN dbo.tblcompany c ON LTRIM(RTRIM(c.companyname)) = LTRIM(RTRIM(e.companycode))
      WHERE e.paycode = @paycode`);
    if (!employeeResult.recordset[0]) return res.status(404).json({ success: false, message: 'Employee not found.' });
    const employee = employeeResult.recordset[0];
    const rows = await queryAttendance(pool, req.params.paycode, range);
    const empCat = employee.cat;
    const empCompany = employee.companycode;
    
    // Determine the month/year for the audit (use the range or current month)
    const auditYear = new Date(range.toDate).getFullYear();
    const auditMonth = new Date(range.toDate).getMonth() + 1;
    
    // Calculate FINAL late count with monthly grace consumption
    const monthlyLate = computeMonthlyLateForEmployee(rows, shiftMap, empCat, empCompany, employee.paycode, auditYear, auditMonth);
    
    // Calculate stats with grace-aware late computation
    const stats = rows.reduce((s, row) => {
      const label = classifyRow({ ...row, status: row.statusCode || row.status, statusCode: row.statusCode || row.status });
      if (label === 'Week Off') return s;
      if (label === 'Absent') s.absent += 1;
      else if (label === 'Miss Punch') s.miss += 1;
      else s.present += 1;
      const lateResult = computeLateStatus(row, shiftMap, empCat, empCompany, employee.paycode);
      if (lateResult.isLate) s.late += 1;  // Raw late count
      s.hours += Number(row.hoursworked || 0);
      return s;
    }, { present: 0, absent: 0, miss: 0, late: 0, hours: 0 });
    
    // Override late with FINAL late count after monthly grace consumption
    stats.late = monthlyLate.finalLateCount;
    
    const total = stats.present + stats.absent + stats.miss;
    res.json({ 
      employee, 
      stats: { ...stats, attendancePercentage: total ? Number((stats.present / total * 100).toFixed(1)) : 0 }, 
      attendance: rows.map(r => normalizeAttendance(r, shiftMap, empCat, empCompany)),
      lateDetails: monthlyLate.lateDetails,
      graceRemaining: monthlyLate.graceRemaining
    });
  } catch (error) { sendDbError(res, error); }
});

app.get('/api/hr/category-analytics', authenticate, requireRole('HR'), requireDbConfig, async (req, res) => {
  const range = resolveAttendanceRange({ ...(req.query || {}), days: undefined });
  if (range.error) return res.status(400).json({ success: false, message: range.error });
  // Weekly/monthly without explicit bounds still need a real range: resolveAttendanceRange handles it.
  const effective = (req.query?.fromDate && req.query?.toDate)
    ? { mode: range.mode, fromDate: range.fromDate, toDate: range.toDate }
    : range;
  try {
    const pool = await getPool();
    const shiftMap = await loadShiftEndTimes(pool);
    const categoryMap = await loadCategoryNames(pool);
    const empShiftMap = await loadEmployeeShiftMap(pool);
    const nowMin = indiaNowMinutes(), todayIso = indiaTodayISO();
    
    // Default to active employees only; allow override via ?active=Y|N|ALL
    const activeParam = String(req.query.active || 'Y').trim().toUpperCase();
    
    let empQuery = 'SELECT paycode, companycode, departmentcode, LTRIM(RTRIM(cat)) AS cat FROM dbo.tblemployee';
    if (activeParam === 'Y') {
      empQuery += " WHERE LTRIM(RTRIM(active)) = 'Y'";
    } else if (activeParam === 'N') {
      empQuery += " WHERE LTRIM(RTRIM(active)) = 'N'";
    }
    // 'ALL' = no filter
    const [empResult, regResult] = await Promise.all([
      pool.request().query(empQuery),
      pool.request().input('fromDate', sql.Date, effective.fromDate).input('toDate', sql.Date, effective.toDate).query(
        `SELECT ${attendanceFields} FROM dbo.tbltimeregister WHERE dateoffice >= @fromDate AND dateoffice < DATEADD(DAY, 1, @toDate)`)
    ]);
    // SAME aggregateAttendance definitions, split per company. Mutually exclusive
    // status buckets: complete / miss / absent. Punched is reported separately
    // (detection metric) and must NOT be a pie slice next to miss.
    const regByPaycode = new Map();
    for (const row of regResult.recordset) {
      const k = String(row.paycode).trim();
      if (!regByPaycode.has(k)) regByPaycode.set(k, []);
      regByPaycode.get(k).push(row);
    }
    const byCompany = new Map(), byDepartment = new Map();
    let punchedTotal = 0, completeTotal = 0, missTotal = 0, absentTotal = 0, lateTotal = 0;
    for (const emp of empResult.recordset) {
      const rows = usableRegisterRows(regByPaycode.get(String(emp.paycode).trim()) || []);
      const comp = String(emp.companycode || '—').trim() || '—';
      if (!byCompany.has(comp)) byCompany.set(comp, { companycode: comp, complete: 0, miss: 0, absent: 0, late: 0, punched: 0 });
      const bucket = byCompany.get(comp);
      const hasAnyPunch = rows.some(hasPunch);
      const hasComplete = rows.some(hasCompletePunch);
      // For overall totals: miss = IN-only where shift has ended (not ongoing)
      const hasIncomplete = rows.some(r => hasPunch(r) && !hasCompletePunch(r) && !isOngoingShiftRow(r, shiftMap, nowMin, todayIso));
      // For department graph: Present = employee showed up (has any punch), including ongoing shifts
      const deptPresent = hasAnyPunch;
      if (hasAnyPunch) { bucket.punched += 1; punchedTotal += 1; }
      else { bucket.absent += 1; absentTotal += 1; }
      if (hasComplete) { bucket.complete += 1; completeTotal += 1; }
      else if (hasIncomplete) { bucket.miss += 1; missTotal += 1; }
      
      // Compute FINAL late for this employee in the range (per calendar month)
      const empCat = emp.cat || '';
      const empCompany = emp.companycode || '';
      const paycode = emp.paycode;
      
      // Group rows by calendar month
      const rowsByMonth = new Map();
      for (const row of rows) {
        const d = row.dateoffice instanceof Date ? row.dateoffice : new Date(row.dateoffice);
        const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
        if (!rowsByMonth.has(key)) rowsByMonth.set(key, []);
        rowsByMonth.get(key).push(row);
      }
      
      let empFinalLate = 0;
      for (const [monthKey, monthRows] of rowsByMonth) {
        const [year, month] = monthKey.split('-').map(Number);
        const monthlyResult = computeMonthlyLateForEmployee(monthRows, shiftMap, empCat, empCompany, paycode, year, month);
        empFinalLate += monthlyResult.finalLateCount;
      }
      if (empFinalLate > 0) { bucket.late += 1; lateTotal += 1; }
      
      // SAME mutually exclusive status buckets, split per department (real master codes).
      // For department graph: Present = employee showed up (has any punch), including ongoing shifts
      // This ensures current-date department graph shows employees currently at work as Present
      const deptKey = String(emp.departmentcode || '').trim() || '—';
      if (!byDepartment.has(deptKey)) byDepartment.set(deptKey, { departmentcode: deptKey, complete: 0, miss: 0, absent: 0, late: 0, punched: 0 });
      const dbucket = byDepartment.get(deptKey);
      if (hasAnyPunch) dbucket.punched += 1;
      else dbucket.absent += 1;
      // Department "Present" = employee has any punch (includes ongoing shifts for current date)
      if (deptPresent) dbucket.complete += 1;
      else if (hasIncomplete) dbucket.miss += 1;
      if (empFinalLate > 0) dbucket.late += 1;
    }
    res.json({
      indiaToday: indiaTodayISO(), mode: effective.mode, fromDate: effective.fromDate, toDate: effective.toDate,
      punched: punchedTotal, complete: completeTotal, miss: missTotal, absent: absentTotal, late: lateTotal,
      punchedToday: punchedTotal,
      companies: [...byCompany.values()].sort((a, b) => String(a.companycode).localeCompare(String(b.companycode))),
      departments: [...byDepartment.values()].sort((a, b) => String(a.departmentcode).localeCompare(String(b.departmentcode)))
    });
  } catch (error) { sendDbError(res, error); }
});

// DISTINCT Late employees behind a Late number, for the exact [fromDate, toDate]
// range. This is a read-only projection of the ONE shared rule used by
// aggregateAttendance (/hr/summary) and /hr/category-analytics: the same
// dbo.tblemployee set, the same week-off exclusion and the same Late logic.
// Because the employee loop is identical, `late` here always equals the Late
// metric those endpoints report for the same range — the dashboard count and the
// detail list can never drift apart.
app.get('/api/hr/late-employees', authenticate, requireRole('HR'), requireDbConfig, async (req, res) => {
  const range = parseDateRange(req.query, 31);
  if (!validateRange(res, range)) return;
  // Default to active employees only; allow override via ?active=Y|N|ALL
  const activeParam = String(req.query.active || 'Y').trim().toUpperCase();
  try {
    const pool = await getPool();
    const shiftMap = await loadShiftEndTimes(pool);
    const categoryMap = await loadCategoryNames(pool);
    const empShiftMap = await loadEmployeeShiftMap(pool);
    let empQuery = `SELECT LTRIM(RTRIM(e.paycode)) AS paycode, LTRIM(RTRIM(e.empname)) AS empname,
          LTRIM(RTRIM(e.presentcardno)) AS presentcardno, LTRIM(RTRIM(e.companycode)) AS companycode,
          LTRIM(RTRIM(e.departmentcode)) AS departmentcode, LTRIM(RTRIM(d.departmentname)) AS departmentname,
          LTRIM(RTRIM(e.designation)) AS designation, LTRIM(RTRIM(e.cat)) AS cat
        FROM dbo.tblemployee e
        LEFT JOIN dbo.tbldepartment d ON LTRIM(RTRIM(d.departmentcode)) = LTRIM(RTRIM(e.departmentcode))`;
    if (activeParam === 'Y') {
      empQuery += " WHERE LTRIM(RTRIM(e.active)) = 'Y'";
    } else if (activeParam === 'N') {
      empQuery += " WHERE LTRIM(RTRIM(e.active)) = 'N'";
    }
    // 'ALL' = no filter
    const [empResult, regResult] = await Promise.all([
      pool.request().query(empQuery),
      pool.request().input('fromDate', sql.Date, range.fromDate).input('toDate', sql.Date, range.toDate).query(
        `SELECT ${attendanceFields} FROM dbo.tbltimeregister WHERE dateoffice >= @fromDate AND dateoffice < DATEADD(DAY, 1, @toDate)`)
    ]);
    const rowsByPay = new Map();
    for (const row of regResult.recordset) {
      const k = String(row.paycode).trim();
      if (!rowsByPay.has(k)) rowsByPay.set(k, []);
      rowsByPay.get(k).push(row);
    }
    const employees = [];
    for (const emp of empResult.recordset) {
      const empRows = usableRegisterRows(rowsByPay.get(String(emp.paycode).trim()) || []);
      // Compute FINAL late for this employee in the given range (per calendar month)
      const paycode = emp.paycode;
      const empCat = emp.cat || '';
      const empCompany = emp.companycode || '';
      
      // Group by calendar month
      const rowsByMonth = new Map();
      for (const row of empRows) {
        const d = row.dateoffice instanceof Date ? row.dateoffice : new Date(row.dateoffice);
        const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
        if (!rowsByMonth.has(key)) rowsByMonth.set(key, []);
        rowsByMonth.get(key).push(row);
      }
      
      let finalLateCount = 0;
      const allLateDetails = [];
      for (const [monthKey, monthRows] of rowsByMonth) {
        const [year, month] = monthKey.split('-').map(Number);
        const monthlyResult = computeMonthlyLateForEmployee(monthRows, shiftMap, empCat, empCompany, paycode, year, month);
        finalLateCount += monthlyResult.finalLateCount;
        allLateDetails.push(...monthlyResult.lateDetails);
      }
      
      if (finalLateCount === 0) continue;
      
      // Get the most recent FINAL late record for representative display
      const finalLateRecords = allLateDetails.filter(d => d.isFinalLate);
      const representativeRecord = finalLateRecords.length > 0
        ? finalLateRecords.sort((a, b) => new Date(b.date) - new Date(a.date))[0]
        : allLateDetails.sort((a, b) => new Date(b.date) - new Date(a.date))[0];
      
      // Find the original row for the representative date
      const originalRow = empRows.find(r => {
        const rd = r.dateoffice instanceof Date ? r.dateoffice : new Date(r.dateoffice);
        const repDate = representativeRecord.date instanceof Date ? representativeRecord.date : new Date(representativeRecord.date);
        return rd.getTime() === repDate.getTime();
      }) || empRows[0];
      
      const normalized = normalizeAttendance(originalRow, shiftMap, empCat, empCompany);
      employees.push({
        paycode: emp.paycode, empname: emp.empname, presentcardno: emp.presentcardno,
        companycode: emp.companycode, departmentcode: emp.departmentcode, departmentname: emp.departmentname,
        designation: emp.designation,
        date: originalRow.dateoffice, dateoffice: originalRow.dateoffice, shift: originalRow.shift,
        in1: originalRow.in1, in2: originalRow.in2, out1: originalRow.out1, out2: originalRow.out2,
        inTime: normalized.inTime, outTime: normalized.outTime,
        hoursworked: originalRow.hoursworked, otduration: originalRow.otduration ?? null,
        latearrival: normalized.latearrival, lateDays: finalLateCount,
        status: originalRow.status, statusCode: normalized.statusCode, statusLabel: normalized.statusLabel,
        isLate: true, reason: originalRow.reason, graceUsed: representativeRecord.graceUsed,
        lateDetails: allLateDetails
      });
    }
    employees.sort((a, b) => String(a.empname || '').localeCompare(String(b.empname || '')));
    res.json({
      indiaToday: indiaTodayISO(), mode: range.mode, fromDate: range.fromDate, toDate: range.toDate,
      late: employees.length, employees
    });
  } catch (error) { sendDbError(res, error); }
});

// DISTINCT master-data filter values straight from dbo.tblemployee (+ department /
// company / category name lookups). Read-only; no schema change, no invented values.
app.get('/api/hr/filters', authenticate, requireRole('HR'), requireDbConfig, async (req, res) => {
  try {
    const result = await (await getPool()).request().batch(`
      SELECT DISTINCT LTRIM(RTRIM(e.departmentcode)) AS code, LTRIM(RTRIM(d.departmentname)) AS name
      FROM dbo.tblemployee e
      LEFT JOIN dbo.tbldepartment d ON LTRIM(RTRIM(d.departmentcode)) = LTRIM(RTRIM(e.departmentcode))
      WHERE LTRIM(RTRIM(e.departmentcode)) <> ''
      ORDER BY code;
      SELECT DISTINCT LTRIM(RTRIM(e.companycode)) AS code, LTRIM(RTRIM(c.companyname)) AS name
      FROM dbo.tblemployee e
      LEFT JOIN dbo.tblcompany c ON LTRIM(RTRIM(c.companycode)) = LTRIM(RTRIM(e.companycode))
      WHERE LTRIM(RTRIM(e.companycode)) <> ''
      ORDER BY code;
      SELECT DISTINCT LTRIM(RTRIM(cat)) AS code FROM dbo.tblemployee WHERE LTRIM(RTRIM(cat)) <> '' ORDER BY code;
      SELECT * FROM dbo.tblcategory;
      SELECT DISTINCT LTRIM(RTRIM(sex)) AS sex FROM dbo.tblemployee WHERE LTRIM(RTRIM(sex)) <> '' ORDER BY sex;
      SELECT DISTINCT LTRIM(RTRIM(designation)) AS designation FROM dbo.tblemployee WHERE LTRIM(RTRIM(designation)) <> '' ORDER BY designation;
      SELECT DISTINCT LTRIM(RTRIM(ismarried)) AS ismarried FROM dbo.tblemployee WHERE LTRIM(RTRIM(ismarried)) <> '' ORDER BY ismarried;
      SELECT DISTINCT LTRIM(RTRIM(active)) AS active FROM dbo.tblemployee WHERE LTRIM(RTRIM(active)) <> '' ORDER BY active;`);
    const rs = result.recordsets || [];
    const clean = v => String(v == null ? '' : v).trim();
    // tblcategory column names are not assumed: pick the code/name keys generically.
    const categories = (rs[3] || []).map(row => {
      const keys = Object.keys(row);
      const codeKey = keys.find(k => /code/i.test(k)) || keys[0];
      const nameKey = keys.find(k => /name/i.test(k) && !/code/i.test(k));
      return { code: clean(row[codeKey]), name: nameKey ? clean(row[nameKey]) : '' };
    }).filter(c => c.code);
    res.json({
      departments: (rs[0] || []).map(r => ({ code: clean(r.code), name: clean(r.name) })),
      companies: (rs[1] || []).map(r => ({ code: clean(r.code), name: clean(r.name) })),
      categories,
      genders: (rs[4] || []).map(r => clean(r.sex)).filter(Boolean),
      designations: (rs[5] || []).map(r => clean(r.designation)).filter(Boolean),
      maritalStatuses: (rs[6] || []).map(r => clean(r.ismarried)).filter(Boolean),
      statuses: (rs[7] || []).map(r => clean(r.active)).filter(Boolean)
    });
  } catch (error) { sendDbError(res, error); }
});

app.get('/api/hr/celebrations', authenticate, requireRole('HR'), requireDbConfig, async (req, res) => {
  try {
    const pool = await getPool();
    // Default to active employees only; allow override via ?active=Y|N|ALL
    const activeParam = String(req.query.active || 'Y').trim().toUpperCase();
    let empQuery = 'SELECT paycode, empname, presentcardno, companycode FROM dbo.tblemployee';
    if (activeParam === 'Y') {
      empQuery += " WHERE LTRIM(RTRIM(active)) = 'Y'";
    } else if (activeParam === 'N') {
      empQuery += " WHERE LTRIM(RTRIM(active)) = 'N'";
    }
    // 'ALL' = no filter
    empQuery += ' ORDER BY empname';
    const employees = await pool.request().query(empQuery);
    let marriages = { recordset: [] };
    try {
      marriages = await pool.request().query(`SELECT id, paycode, presentcardno, anniversarydate, createddate, updateddate, importedby FROM ${marriageTable}`);
    } catch (e) {
      const msg = String(e?.message || e || '').toUpperCase();
      if (!msg.includes('INVALID OBJECT NAME') && !msg.includes('TABLE') && !msg.includes('NOT FOUND')) throw e;
    }
    res.json({ employees: employees.recordset, marriages: marriages.recordset });
  } catch (error) { sendDbError(res, error); }
});

app.get('/api/marriage-anniversary', requireDbConfig, authenticate, requireRole('HR', 'EMPLOYEE'), async (req, res) => {
  try {
    const request = (await getPool()).request().input('paycode', sql.VarChar(50), req.user.role === 'EMPLOYEE' ? req.user.paycode : null);
    let result = { recordset: [] };
    try {
      result = await request.query(`SELECT id, paycode, presentcardno, anniversarydate, createddate, updateddate, importedby FROM ${marriageTable} WHERE (@paycode IS NULL OR paycode = @paycode) ORDER BY anniversarydate`);
    } catch (e) {
      const msg = String(e?.message || e || '').toUpperCase();
      if (!msg.includes('INVALID OBJECT NAME') && !msg.includes('TABLE') && !msg.includes('NOT FOUND')) throw e;
    }
    res.json(result.recordset);
  } catch (error) { sendDbError(res, error); }
});

app.get('/api/raw-punches', requireDbConfig, authenticate, async (req, res) => {
  const range = parseDateRange(req.query, 7);
  if (!validateRange(res, range)) return;
  try {
    const request = (await getPool()).request().input('fromDate', sql.Date, range.fromDate).input('toDate', sql.Date, range.toDate);
    let filter = '';
    if (req.user.role === 'EMPLOYEE' || req.query.paycode) {
      request.input('paycode', sql.VarChar(50), req.user.role === 'EMPLOYEE' ? req.user.paycode : String(req.query.paycode));
      filter = 'AND e.paycode = @paycode';
    }
    const result = await request.query(`SELECT p.cardno, p.mc_no, p.officepunch, p.inout, p.ismanual FROM dbo.machinerawpunch p JOIN dbo.tblemployee e ON e.presentcardno = p.cardno WHERE p.officepunch >= @fromDate AND p.officepunch < DATEADD(DAY, 1, @toDate) ${filter} ORDER BY p.officepunch DESC`);
    res.json(result.recordset);
  } catch (error) { sendDbError(res, error); }
});

app.post('/api/marriage-anniversary/validate', authenticate, requireRole('HR'), requireDbConfig, async (req, res) => {
  try {
    const rows = Array.isArray(req.body?.rows) ? req.body.rows : [], pool = await getPool(), validated = [];
    for (const row of rows) {
      const result = await pool.request().input('employeeCode', sql.VarChar(50), String(row.employeeCode || '').trim() || null).input('biometricCode', sql.VarChar(50), String(row.biometricCode || '').trim() || null).query(`SELECT TOP 1 e.paycode, e.presentcardno, e.empname, e.companycode, m.anniversarydate AS existingDate FROM dbo.tblemployee e LEFT JOIN ${marriageTable} m ON m.paycode = e.paycode WHERE (@employeeCode IS NOT NULL AND e.paycode = @employeeCode) OR (@biometricCode IS NOT NULL AND e.presentcardno = @biometricCode)`);
      validated.push({ ...row, employee: result.recordset[0] || null });
    }
    res.json({ rows: validated });
  } catch (error) { sendDbError(res, error); }
});

app.post('/api/marriage-anniversary/import', authenticate, requireRole('HR'), requireDbConfig, async (req, res) => {
  const rows = Array.isArray(req.body?.rows) ? req.body.rows : [];
  try {
    const transaction = new sql.Transaction(await getPool());
    await transaction.begin();
    try {
      for (const row of rows) {
        if (!row.employee || !isValidIsoDate(row.anniversaryDate)) continue;
        const request = new sql.Request(transaction);
        request.input('paycode', sql.VarChar(50), row.employee.paycode).input('presentcardno', sql.VarChar(50), row.employee.presentcardno || null).input('anniversarydate', sql.Date, row.anniversaryDate).input('importedby', sql.VarChar(50), String(req.user?.sub || 'HR').slice(0, 50));
        await request.query(`UPDATE ${marriageTable} SET presentcardno = @presentcardno, anniversarydate = @anniversarydate, updateddate = GETDATE(), importedby = @importedby WHERE paycode = @paycode; IF @@ROWCOUNT = 0 INSERT INTO ${marriageTable} (paycode, presentcardno, anniversarydate, createddate, updateddate, importedby) VALUES (@paycode, @presentcardno, @anniversarydate, GETDATE(), GETDATE(), @importedby);`);
      }
      await transaction.commit();
    } catch (error) { await transaction.rollback(); throw error; }
    res.json({ imported: rows.filter(row => row.employee && isValidIsoDate(row.anniversaryDate)).length });
  } catch (error) { sendDbError(res, error); }
});

app.use((error, _req, res, _next) => {
  if (res.headersSent) return;
  res.status(error.statusCode === 400 ? 400 : 500).json({ success: false, message: error.statusCode === 400 ? 'Invalid JSON request.' : 'Server error.' });
});

/* =========================================================================
   EMAIL GREETINGS — HR-controlled Birthday / Work / Marriage Anniversary
   - Provider + credentials: server/email-provider.js (isolated module).
     Key/credentials DB me encrypted save hoti hain (HR → Email Configuration →
     Provider Config). Server .env (BREVO_API_KEY / SMTP_*) sirf fallback hai.
   - Dedicated HR_ tables (auto-ensure); dbo.tblemployee me koi change nahi.
   - Recipient: Savior SQL e_mail1 → fallback HR_EmployeeEmails (Excel import).
   - Idempotent: same paycode+event+date par duplicate send nahi hota.
   ========================================================================= */
const emailConfigTable = process.env.HR_EMAIL_CONFIG_TABLE || 'dbo.HR_EmailConfig';
const emailMapTable = process.env.HR_EMPLOYEE_EMAIL_TABLE || 'dbo.HR_EmployeeEmails';
const emailLogTable = process.env.HR_EMAIL_LOG_TABLE || 'dbo.HR_EmailLog';
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
const EMAIL_DEFAULTS = {
  sendername: 'HR Team',
  birthdaysubject: 'Happy Birthday {{EmployeeName}}!',
  birthdaybody: 'Dear {{EmployeeName}},\n\nWishing you a very Happy Birthday!\n\nMay your special day be filled with happiness, success and wonderful moments.\n\nRegards,\nHR Department',
  workanniversarysubject: 'Happy Work Anniversary {{EmployeeName}}!',
  workanniversarybody: 'Dear {{EmployeeName}},\n\nCongratulations on your Work Anniversary!\n\nThank you for your dedication and valuable contribution to the team.\n\nRegards,\nHR Department',
  marriagesubject: 'Happy Marriage Anniversary {{EmployeeName}}!',
  marriagebody: 'Dear {{EmployeeName}},\n\nWishing you a very Happy Marriage Anniversary!\n\nMay your bond of love grow stronger with every passing year.\n\nRegards,\nHR Department',
  customsubject: 'Message from HR Department',
  custombody: 'Dear {{EmployeeName}},\n\n\n\nRegards,\nHR Department'
};
// Subject/body pairs one per event type — used to backfill blank templates.
const EMAIL_TEMPLATE_PAIRS = [
  ['birthdaysubject', 'birthdaybody'],
  ['workanniversarysubject', 'workanniversarybody'],
  ['marriagesubject', 'marriagebody'],
  ['customsubject', 'custombody']
];
const EMAIL_EVENT_TYPES = ['Birthday', 'Work Anniversary', 'Marriage Anniversary', 'Custom'];
function normalizeEmailEventType(v) { const t = String(v || '').trim(); return EMAIL_EVENT_TYPES.includes(t) ? t : 'Birthday'; }
let emailTablesState = null; // null = unknown, true = ready, string = error message
let emailSchedulerBusy = false;

function localToday() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
// Case-insensitive placeholders: {{EmployeeName}} / {{name}}, {{Paycode}}, {{Department}},
// {{CompanyCode}}, {{Designation}} — unknown placeholders are left untouched.
function renderEmailTemplate(tpl, vars) {
  const map = {};
  Object.entries(vars || {}).forEach(([k, v]) => { map[String(k).toLowerCase()] = (v === undefined || v === null) ? '' : String(v); });
  return String(tpl || '').replace(/\{\{(\w+)\}\}/g, (m, k) => (k.toLowerCase() in map) ? map[k.toLowerCase()] : m);
}
function emailErrorResponse(res, error) {
  console.error('[EMAIL_ERROR]', (error && error.message || error).toString().slice(0, 300));
  return res.status(503).json({ success: false, message: typeof emailTablesState === 'string' ? emailTablesState : (error && error.message || 'Email service unavailable.') });
}
async function ensureEmailTables(pool) {
  if (emailTablesState === true) return;
  if (typeof emailTablesState === 'string') throw new Error(emailTablesState);
  try {
    await pool.request().batch(`
IF OBJECT_ID('${emailConfigTable}','U') IS NULL
CREATE TABLE ${emailConfigTable} (
  id INT IDENTITY(1,1) PRIMARY KEY,
  sendername NVARCHAR(120) NULL, senderemail VARCHAR(150) NULL,
  birthdayenabled BIT NOT NULL CONSTRAINT DF_HREmailCfg_B DEFAULT(0),
  marriageenabled BIT NOT NULL CONSTRAINT DF_HREmailCfg_M DEFAULT(0),
  workanniversaryenabled BIT NOT NULL CONSTRAINT DF_HREmailCfg_W DEFAULT(0),
  birthdaysubject NVARCHAR(200) NULL, birthdaybody NVARCHAR(MAX) NULL,
  marriagesubject NVARCHAR(200) NULL, marriagebody NVARCHAR(MAX) NULL,
  workanniversarysubject NVARCHAR(200) NULL, workanniversarybody NVARCHAR(MAX) NULL,
  customsubject NVARCHAR(200) NULL, custombody NVARCHAR(MAX) NULL,
  updateddate DATETIME2 NOT NULL CONSTRAINT DF_HREmailCfg_U DEFAULT SYSUTCDATETIME(), updatedby VARCHAR(50) NULL
);
-- HR_EmailConfig is this feature's own table (NOT a Savior table): add the newer
-- template columns safely if the table already exists. dbo.tblemployee and all other
-- Savior tables are never altered.
IF OBJECT_ID('${emailConfigTable}','U') IS NOT NULL AND COL_LENGTH('${emailConfigTable}','workanniversaryenabled') IS NULL
ALTER TABLE ${emailConfigTable} ADD workanniversaryenabled BIT NOT NULL CONSTRAINT DF_HREmailCfg_W DEFAULT(0);
IF OBJECT_ID('${emailConfigTable}','U') IS NOT NULL AND COL_LENGTH('${emailConfigTable}','workanniversarysubject') IS NULL
ALTER TABLE ${emailConfigTable} ADD workanniversarysubject NVARCHAR(200) NULL;
IF OBJECT_ID('${emailConfigTable}','U') IS NOT NULL AND COL_LENGTH('${emailConfigTable}','workanniversarybody') IS NULL
ALTER TABLE ${emailConfigTable} ADD workanniversarybody NVARCHAR(MAX) NULL;
IF OBJECT_ID('${emailConfigTable}','U') IS NOT NULL AND COL_LENGTH('${emailConfigTable}','customsubject') IS NULL
ALTER TABLE ${emailConfigTable} ADD customsubject NVARCHAR(200) NULL;
IF OBJECT_ID('${emailConfigTable}','U') IS NOT NULL AND COL_LENGTH('${emailConfigTable}','custombody') IS NULL
ALTER TABLE ${emailConfigTable} ADD custombody NVARCHAR(MAX) NULL;
IF OBJECT_ID('${emailMapTable}','U') IS NULL
CREATE TABLE ${emailMapTable} (
  id INT IDENTITY(1,1) PRIMARY KEY,
  paycode VARCHAR(50) NOT NULL CONSTRAINT UQ_HREmpEmail_P UNIQUE,
  email VARCHAR(150) NOT NULL, companycode VARCHAR(30) NULL, departmentcode VARCHAR(30) NULL, employeename NVARCHAR(120) NULL,
  createddate DATETIME2 NOT NULL CONSTRAINT DF_HREmpEmail_C DEFAULT SYSUTCDATETIME(),
  updateddate DATETIME2 NOT NULL CONSTRAINT DF_HREmpEmail_U DEFAULT SYSUTCDATETIME()
);
IF OBJECT_ID('${emailLogTable}','U') IS NULL
CREATE TABLE ${emailLogTable} (
  id INT IDENTITY(1,1) PRIMARY KEY,
  paycode VARCHAR(50) NULL, employeename NVARCHAR(120) NULL, companycode VARCHAR(30) NULL, departmentcode VARCHAR(30) NULL,
  eventtype VARCHAR(30) NOT NULL, eventdate DATE NOT NULL, recipientemail VARCHAR(150) NULL,
  sentat DATETIME2 NOT NULL CONSTRAINT DF_HREmailLog_S DEFAULT SYSUTCDATETIME(),
  status VARCHAR(20) NOT NULL, providermessageid VARCHAR(150) NULL, errormessage NVARCHAR(500) NULL
);`);
    // Provider/credential columns (emailprovider, brevoapikey, smtp*) are owned by
    // the isolated email-provider module — this file never writes them directly.
    await ensureProviderColumns(pool, sql);
    emailTablesState = true;
  } catch (error) {
    emailTablesState = 'Email tables unavailable. Run server/email-schema.sql on the database (SQL login needs CREATE rights on HR_ tables). Detail: ' + (error && error.message || error).toString().slice(0, 140);
    throw new Error(emailTablesState);
  }
}
async function getEmailConfig(pool) {
  await ensureEmailTables(pool);
  const existing = await pool.request().query(`SELECT TOP 1 * FROM ${emailConfigTable} ORDER BY id`);
  if (existing.recordset[0]) return existing.recordset[0];
  const inserted = await pool.request()
    .input('sendername', sql.NVarChar(120), EMAIL_DEFAULTS.sendername)
    .input('birthdaysubject', sql.NVarChar(200), EMAIL_DEFAULTS.birthdaysubject)
    .input('birthdaybody', sql.NVarChar(sql.MAX), EMAIL_DEFAULTS.birthdaybody)
    .input('marriagesubject', sql.NVarChar(200), EMAIL_DEFAULTS.marriagesubject)
    .input('marriagebody', sql.NVarChar(sql.MAX), EMAIL_DEFAULTS.marriagebody)
    .input('workanniversarysubject', sql.NVarChar(200), EMAIL_DEFAULTS.workanniversarysubject)
    .input('workanniversarybody', sql.NVarChar(sql.MAX), EMAIL_DEFAULTS.workanniversarybody)
    .input('customsubject', sql.NVarChar(200), EMAIL_DEFAULTS.customsubject)
    .input('custombody', sql.NVarChar(sql.MAX), EMAIL_DEFAULTS.custombody)
    .query(`INSERT INTO ${emailConfigTable} (sendername, birthdayenabled, marriageenabled, workanniversaryenabled, birthdaysubject, birthdaybody, marriagesubject, marriagebody, workanniversarysubject, workanniversarybody, customsubject, custombody)
OUTPUT INSERTED.*
VALUES (@sendername, 0, 0, 0, @birthdaysubject, @birthdaybody, @marriagesubject, @marriagebody, @workanniversarysubject, @workanniversarybody, @customsubject, @custombody);`);
  return inserted.recordset[0];
}
/* ---- Email resolution priority (task rule):
   1. Real Savior SQL e_mail1 column on dbo.tblemployee (never modified)
   2. HR_EmployeeEmails mapping table (Excel import) as fallback ---- */
function resolveEmail(emp, mapRow) {
  const master = String((emp && emp.e_mail1) || '').trim();
  if (master && EMAIL_RE.test(master)) return { email: master, source: 'SQL (e_mail1)' };
  const mapped = String((mapRow && mapRow.email) || '').trim();
  if (mapped && EMAIL_RE.test(mapped)) return { email: mapped, source: 'HR Mapping (Import)' };
  return { email: '', source: '' };
}
async function loadEmailRecipients(pool) {
  await ensureEmailTables(pool);
  const empResult = await pool.request().query(`SELECT TOP 2000 LTRIM(RTRIM(paycode)) AS paycode, LTRIM(RTRIM(empname)) AS empname, LTRIM(RTRIM(companycode)) AS companycode, LTRIM(RTRIM(departmentcode)) AS departmentcode, e_mail1 FROM dbo.tblemployee ORDER BY paycode`);
  const mapResult = await pool.request().query(`SELECT TOP 2000 paycode, email, companycode, departmentcode, employeename FROM ${emailMapTable}`);
  const byPaycode = new Map();
  for (const e of empResult.recordset) {
    const key = String(e.paycode || '').trim();
    if (!key) continue;
    const r = resolveEmail(e, null);
    byPaycode.set(key, { paycode: key, empname: e.empname || '', companycode: e.companycode || '', departmentcode: e.departmentcode || '', email: r.email, emailSource: r.email ? r.source : '' });
  }
  for (const m of mapResult.recordset) {
    const key = String(m.paycode || '').trim();
    if (!key || !String(m.email || '').trim()) continue;
    const cur = byPaycode.get(key);
    if (cur && cur.email) continue; // valid SQL email already resolved — mapping stays as documented fallback
    const r = resolveEmail(null, m);
    byPaycode.set(key, { paycode: key, empname: (cur && cur.empname) || m.employeename || '', companycode: (cur && cur.companycode) || m.companycode || '', departmentcode: (cur && cur.departmentcode) || m.departmentcode || '', email: r.email, emailSource: r.source });
  }
  return [...byPaycode.values()];
}
/* Paycodes already successfully emailed for this event+date (duplicate protection). */
async function loadSentPaycodes(pool, eventType, eventDate) {
  const r = await pool.request()
    .input('eventtype', sql.VarChar(30), eventType).input('eventdate', sql.Date, eventDate)
    .query(`SELECT paycode FROM ${emailLogTable} WHERE eventtype = @eventtype AND eventdate = @eventdate AND status IN ('Sent','Already Sent')`);
  return new Set((r.recordset || []).map(x => String(x.paycode || '').trim()));
}
async function alreadySentToday(pool, paycode, eventType, eventDate) {
  const check = await pool.request()
    .input('paycode', sql.VarChar(50), paycode).input('eventtype', sql.VarChar(30), eventType).input('eventdate', sql.Date, eventDate)
    .query(`SELECT TOP 1 status FROM ${emailLogTable} WHERE paycode = @paycode AND eventtype = @eventtype AND eventdate = @eventdate AND status IN ('Sent','Already Sent')`);
  return !!check.recordset[0];
}
async function logEmail(pool, entry) {
  await pool.request()
    .input('paycode', sql.VarChar(50), entry.paycode || null)
    .input('employeename', sql.NVarChar(120), entry.employeename || null)
    .input('companycode', sql.VarChar(30), entry.companycode || null)
    .input('departmentcode', sql.VarChar(30), entry.departmentcode || null)
    .input('eventtype', sql.VarChar(30), entry.eventtype)
    .input('eventdate', sql.Date, entry.eventdate)
    .input('recipientemail', sql.VarChar(150), entry.recipientemail || null)
    .input('status', sql.VarChar(20), entry.status)
    .input('providermessageid', sql.VarChar(150), entry.providermessageid || null)
    .input('errormessage', sql.NVarChar(500), entry.errormessage || null)
    .query(`INSERT INTO ${emailLogTable} (paycode, employeename, companycode, departmentcode, eventtype, eventdate, recipientemail, status, providermessageid, errormessage)
VALUES (@paycode, @employeename, @companycode, @departmentcode, @eventtype, @eventdate, @recipientemail, @status, @providermessageid, @errormessage);`);
}
/* Provider settings are resolved fresh on every send:
   DB credentials (saved from the UI) → server .env fallback → clear error. */
async function emailProviderSettings(pool) { return getProviderSettings(pool); }
async function sendEmailNow(provider, cfg, subject, text, toEmail, toName) {
  const { messageId } = await sendEmailViaProvider(
    provider,
    { name: cfg.sendername || 'HR Team', email: cfg.senderemail },
    { to: toEmail, toName, subject, text }
  );
  return messageId;
}
function applyEmailFilters(list, filters) {
  return list.filter(e =>
    (!filters.companycode || String(e.companycode || '').trim() === filters.companycode) &&
    (!filters.departmentcode || String(e.departmentcode || '').trim() === filters.departmentcode) &&
    (!filters.paycode || String(e.paycode || '').trim() === filters.paycode));
}
// DAY+MONTH matching on REAL Savior data:
//   Birthday → dbo.tblemployee.dateofbirth | Work Anniversary → dbo.tblemployee.dateofjoin
//   Marriage Anniversary → HR_MarriageAnniversary.anniversarydate (existing import table)
function matchesEventDate(employee, eventType, eventDate) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(eventDate || ''))) return false;
  const [, mm, dd] = eventDate.split('-');
  let field = null;
  if (eventType === 'Birthday') field = employee.dateofbirth;
  else if (eventType === 'Work Anniversary') field = employee.dateofjoin;
  else if (eventType === 'Marriage Anniversary') field = employee.anniversarydate;
  if (!field) return false;
  // Date objects are formatted with LOCAL components (toISOString would shift the
  // calendar day in timezones ahead of UTC — e.g. IST midnight → previous day).
  const text = field instanceof Date
    ? `${field.getFullYear()}-${String(field.getMonth() + 1).padStart(2, '0')}-${String(field.getDate()).padStart(2, '0')}`
    : String(field).trim();
  const m = text.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!m) return false;
  return m[2] === mm && m[3] === dd; // DAY + MONTH only — year match nahi hota
}
function emailBodyFor(cfg, eventType, emp, overrides) {
  const vars = {
    name: emp.empname || emp.paycode || '',
    EmployeeName: emp.empname || emp.paycode || '',
    Paycode: emp.paycode || '',
    Department: emp.departmentcode || '',
    CompanyCode: emp.companycode || '',
    Designation: emp.designation || '',
    company: emp.companycode || '',
    department: emp.departmentcode || '',
    paycode: emp.paycode || '',
    designation: emp.designation || ''
  };
  let subject, text;
  if (eventType === 'Birthday') { subject = cfg.birthdaysubject; text = cfg.birthdaybody; }
  else if (eventType === 'Work Anniversary') { subject = cfg.workanniversarysubject; text = cfg.workanniversarybody; }
  else if (eventType === 'Marriage Anniversary') { subject = cfg.marriagesubject; text = cfg.marriagebody; }
  else { subject = cfg.customsubject; text = cfg.custombody; }
  if (overrides && overrides.subject) subject = overrides.subject;
  if (overrides && overrides.body) text = overrides.body;
  return { subject: renderEmailTemplate(subject || EMAIL_DEFAULTS.customsubject, vars), text: renderEmailTemplate(text || EMAIL_DEFAULTS.custombody, vars) };
}
/* ---- Target loading: REAL Savior SQL data only. No hardcoded employees/departments. ---- */
async function loadEmailTargets(pool, eventType, eventDate) {
  // LTRIM/RTRIM: master columns are CHAR-padded (e.g. "EXECUTIVE   ") — same treatment
  // as listEmployees() so names/codes render and filter cleanly.
  // Default to active employees for birthday/work anniversary emails
  let empQuery = `SELECT TOP 2000 LTRIM(RTRIM(paycode)) AS paycode, LTRIM(RTRIM(empname)) AS empname, LTRIM(RTRIM(companycode)) AS companycode, LTRIM(RTRIM(departmentcode)) AS departmentcode, LTRIM(RTRIM(designation)) AS designation, e_mail1, dateofbirth, dateofjoin FROM dbo.tblemployee`;
  if (eventType === 'Birthday' || eventType === 'Work Anniversary') {
    empQuery += " WHERE LTRIM(RTRIM(active)) = 'Y'";
  }
  const employeesResult = await pool.request().query(empQuery);
  const employees = employeesResult.recordset || [];
  if (eventType === 'Marriage Anniversary') {
    let marriageDates = [];
    try { marriageDates = (await pool.request().query(`SELECT LTRIM(RTRIM(paycode)) AS paycode, anniversarydate FROM ${marriageTable}`)).recordset || []; } catch (_) { marriageDates = []; }
    const targets = marriageDates.filter(m => matchesEventDate(m, eventType, eventDate)).map(m => {
      const paycode = String(m.paycode || '').trim();
      const emp = employees.find(e => String(e.paycode || '').trim() === paycode) || {};
      return { ...emp, paycode, anniversarydate: m.anniversarydate };
    });
    return { employees, targets };
  }
  if (eventType === 'Custom') return { employees, targets: employees.slice() };
  return { employees, targets: employees.filter(e => matchesEventDate(e, eventType, eventDate)) };
}
/* Sends ONE event type to filtered employees. options: { autoOnly, resend, date, subject, body } */
async function runEmailEvent(pool, eventType, filters, options) {
  const opts = options || {};
  const cfg = await getEmailConfig(pool);
  const eventDate = /^\d{4}-\d{2}-\d{2}$/.test(String(opts.date || '')) ? String(opts.date) : localToday();
  const stat = { sent: 0, skipped: 0, failed: 0, alreadySent: 0, noEmail: 0 };
  const out = { eventType, eventDate, ...stat };
  if (opts.autoOnly) {
    const enabled = eventType === 'Birthday' ? cfg.birthdayenabled
      : eventType === 'Work Anniversary' ? cfg.workanniversaryenabled
      : eventType === 'Marriage Anniversary' ? cfg.marriageenabled : false;
    if (!enabled) return { ...out, skippedReason: eventType + ' auto-send is disabled in configuration' };
  }
  const provider = await emailProviderSettings(pool);
  if (!provider.configured) return { ...out, skippedReason: provider.hint || 'Email provider is not configured.' };
  if (!String(cfg.senderemail || '').trim()) return { ...out, skippedReason: 'Sender email is not configured — HR → Email Configuration → Provider Config tab me save karo.' };
  const { employees, targets } = await loadEmailTargets(pool, eventType, eventDate);
  const filtered = applyEmailFilters(targets, filters || {});
  const mapResult = await pool.request().query(`SELECT TOP 2000 paycode, email FROM ${emailMapTable}`);
  const mapRows = new Map((mapResult.recordset || []).map(m => [String(m.paycode || '').trim(), m]));
  const sentSet = await loadSentPaycodes(pool, eventType, eventDate);
  for (const target of filtered) {
    const paycode = String(target.paycode || '').trim();
    const emp = employees.find(e => String(e.paycode || '').trim() === paycode) || target;
    const { email } = resolveEmail(emp, mapRows.get(paycode));
    if (!email) {
      stat.noEmail++;
      await logEmail(pool, { paycode, employeename: emp.empname, companycode: emp.companycode, departmentcode: emp.departmentcode, eventtype: eventType, eventdate: eventDate, recipientemail: null, status: 'Invalid Email', errormessage: 'No valid email in SQL e_mail1 or HR mapping' });
      continue;
    }
    if (!opts.resend && sentSet.has(paycode)) { stat.alreadySent++; stat.skipped++; continue; }
    try {
      const { subject, text } = emailBodyFor(cfg, eventType, emp, opts);
      const messageId = await sendEmailNow(provider, cfg, subject, text, email, emp.empname);
      stat.sent++;
      await logEmail(pool, { paycode, employeename: emp.empname, companycode: emp.companycode, departmentcode: emp.departmentcode, eventtype: eventType, eventdate: eventDate, recipientemail: email, status: 'Sent', providermessageid: messageId });
    } catch (error) {
      stat.failed++;
      await logEmail(pool, { paycode, employeename: emp.empname, companycode: emp.companycode, departmentcode: emp.departmentcode, eventtype: eventType, eventdate: eventDate, recipientemail: email, status: 'Failed', errormessage: (error && error.message || error).toString().slice(0, 480) });
    }
  }
  return { ...out, ...stat };
}
function startEmailScheduler() {
  if (!process.env.DB_SERVER) return;
  const tick = async () => {
    if (emailSchedulerBusy) return;
    emailSchedulerBusy = true;
    try {
      const pool = await getPool();
      for (const eventType of ['Birthday', 'Work Anniversary', 'Marriage Anniversary']) {
        await runEmailEvent(pool, eventType, {}, { autoOnly: true });
      }
    }
    catch (error) { console.error('[EMAIL_SCHEDULER]', (error && error.message || error).toString().slice(0, 200)); }
    finally { emailSchedulerBusy = false; }
  };
  // Run daily at 07:00 AM Asia/Kolkata (IST)
  // Calculate ms until next 07:00 AM IST
  function msUntilNext7AMIST() {
    const now = new Date();
    // Convert to IST
    const istOffset = 5.5 * 60 * 60 * 1000; // UTC+5:30
    const istNow = new Date(now.getTime() + istOffset);
    const next = new Date(istNow);
    next.setUTCHours(7, 0, 0, 0); // 07:00 AM IST
    if (next <= istNow) next.setUTCDate(next.getUTCDate() + 1);
    return next.getTime() - istNow.getTime();
  }
  const initialDelay = msUntilNext7AMIST();
  console.log(`[EMAIL_SCHEDULER] First run in ${Math.round(initialDelay / 60000)} minutes (at next 07:00 AM IST)`);
  setTimeout(() => {
    tick();
    // Then repeat every 24 hours
    setInterval(tick, 24 * 60 * 60 * 1000).unref();
  }, initialDelay).unref();
}
startEmailScheduler();
/* ---- Email endpoints (HR-only) ---- */
app.get('/api/email/config', requireDbConfig, authenticate, requireRole('HR'), async (req, res) => {
  try {
    const pool = await getPool();
    const cfg = await getEmailConfig(pool);
    const recipients = await loadEmailRecipients(pool);
    const providerStatus = publicProviderStatus(await getProviderSettings(pool));
    return res.json({ success: true, config: {
      sendername: cfg.sendername || '', senderemail: cfg.senderemail || '',
      birthdayenabled: !!cfg.birthdayenabled, marriageenabled: !!cfg.marriageenabled, workanniversaryenabled: !!cfg.workanniversaryenabled,
      birthdaysubject: cfg.birthdaysubject || '', birthdaybody: cfg.birthdaybody || '',
      marriagesubject: cfg.marriagesubject || '', marriagebody: cfg.marriagebody || '',
      workanniversarysubject: cfg.workanniversarysubject || '', workanniversarybody: cfg.workanniversarybody || '',
      customsubject: cfg.customsubject || '', custombody: cfg.custombody || ''
    }, provider: { brevo: providerStatus.provider === 'brevo', smtp: providerStatus.provider === 'smtp', db: !!process.env.DB_SERVER, configured: providerStatus.configured, label: providerStatus.providerLabel, source: providerStatus.source, hint: providerStatus.hint },
      providerStatus,
      emailProvider: providerStatus,
      sqlEmailField: 'e_mail1',
      sourcePriority: ['SQL e_mail1 (Savior tblemployee)', 'HR_EmployeeEmails (Excel import fallback)'],
      masterEmailCount: recipients.filter(r => r.emailSource === 'SQL (e_mail1)').length,
      mappingCount: recipients.filter(r => r.emailSource === 'HR Mapping (Import)').length,
      noEmailCount: recipients.filter(r => !r.email).length,
      recipientCount: recipients.length });
  } catch (error) { return emailErrorResponse(res, error); }
});
app.post('/api/email/config', requireDbConfig, authenticate, requireRole('HR'), async (req, res) => {
  try {
    const pool = await getPool();
    await getEmailConfig(pool);
    const b = req.body || {};
    const updates = [];
    const reqQ = pool.request();
    if (b.sendername !== undefined) { reqQ.input('sendername', sql.NVarChar(120), String(b.sendername || '').slice(0, 120)); updates.push('sendername = @sendername'); }
    if (b.senderemail !== undefined) { const se = String(b.senderemail || '').trim(); if (se && !EMAIL_RE.test(se)) return res.status(400).json({ success: false, message: 'Invalid sender email.' }); reqQ.input('senderemail', sql.VarChar(150), se); updates.push('senderemail = @senderemail'); }
    if (b.birthdayenabled !== undefined) { reqQ.input('ben', sql.Bit, b.birthdayenabled ? 1 : 0); updates.push('birthdayenabled = @ben'); }
    if (b.marriageenabled !== undefined) { reqQ.input('men', sql.Bit, b.marriageenabled ? 1 : 0); updates.push('marriageenabled = @men'); }
    if (b.birthdaysubject !== undefined) { reqQ.input('bs', sql.NVarChar(200), String(b.birthdaysubject || '').slice(0, 200)); updates.push('birthdaysubject = @bs'); }
    if (b.birthdaybody !== undefined) { reqQ.input('bb', sql.NVarChar(sql.MAX), String(b.birthdaybody || '')); updates.push('birthdaybody = @bb'); }
    if (b.marriagesubject !== undefined) { reqQ.input('ms', sql.NVarChar(200), String(b.marriagesubject || '').slice(0, 200)); updates.push('marriagesubject = @ms'); }
    if (b.marriagebody !== undefined) { reqQ.input('mb', sql.NVarChar(sql.MAX), String(b.marriagebody || '')); updates.push('marriagebody = @mb'); }
    if (b.workanniversaryenabled !== undefined) { reqQ.input('wen', sql.Bit, b.workanniversaryenabled ? 1 : 0); updates.push('workanniversaryenabled = @wen'); }
    if (b.workanniversarysubject !== undefined) { reqQ.input('was', sql.NVarChar(200), String(b.workanniversarysubject || '').slice(0, 200)); updates.push('workanniversarysubject = @was'); }
    if (b.workanniversarybody !== undefined) { reqQ.input('wab', sql.NVarChar(sql.MAX), String(b.workanniversarybody || '')); updates.push('workanniversarybody = @wab'); }
    if (b.customsubject !== undefined) { reqQ.input('cs', sql.NVarChar(200), String(b.customsubject || '').slice(0, 200)); updates.push('customsubject = @cs'); }
    if (b.custombody !== undefined) { reqQ.input('cb', sql.NVarChar(sql.MAX), String(b.custombody || '')); updates.push('custombody = @cb'); }
    if (!updates.length) return res.status(400).json({ success: false, message: 'No fields to update.' });
    reqQ.input('updatedby', sql.VarChar(50), req.user.paycode || req.user.username || 'HR');
    await reqQ.query(`UPDATE ${emailConfigTable} SET ${updates.join(', ')}, updateddate = SYSUTCDATETIME(), updatedby = @updatedby WHERE id = (SELECT TOP 1 id FROM ${emailConfigTable} ORDER BY id)`);
    return res.json({ success: true });
  } catch (error) { return emailErrorResponse(res, error); }
});
/* ---- Provider credentials (DB-backed, encrypted) — HR-only ----
   These endpoints are the ONLY way the UI reads/writes credentials.
   Secrets go in, never out: responses carry masked hints only. */
app.get('/api/email/provider', requireDbConfig, authenticate, requireRole('HR'), async (req, res) => {
  try {
    const pool = await getPool();
    const provider = publicProviderStatus(await getProviderSettings(pool));
    return res.json({ success: true, provider, providerTypes: ['brevo', 'smtp'], envKeys: Object.values(EMAIL_ENV_KEYS) });
  } catch (error) { return emailErrorResponse(res, error); }
});
app.post('/api/email/provider', requireDbConfig, authenticate, requireRole('HR'), async (req, res) => {
  try {
    const pool = await getPool();
    await getEmailConfig(pool); // guarantees the config row (+ provider columns) exists
    const body = req.body || {};
    const apiKey = String(body.brevoApiKey || '').trim();
    if (apiKey && apiKey.length < 10) return res.status(400).json({ success: false, message: 'Brevo API key looks too short — paste the full xkeysib-... key.' });
    if (body.smtpPort !== undefined && body.smtpPort !== '' && body.smtpPort !== null && !Number.isFinite(Number(body.smtpPort))) return res.status(400).json({ success: false, message: 'SMTP port must be a number (e.g. 587 or 465).' });
    const senderEmail = String(body.senderemail || '').trim();
    if (senderEmail && !EMAIL_RE.test(senderEmail)) return res.status(400).json({ success: false, message: 'Invalid sender email.' });
    if (senderEmail) {
      await pool.request().input('senderemail', sql.VarChar(150), senderEmail)
        .input('sendername', sql.NVarChar(120), String(body.sendername || 'HR Team').slice(0, 120))
        .input('updatedby', sql.VarChar(50), String(req.user.paycode || req.user.username || 'HR').slice(0, 50))
        .query(`UPDATE ${emailConfigTable} SET senderemail = @senderemail, sendername = @sendername, updateddate = SYSUTCDATETIME(), updatedby = @updatedby WHERE id = (SELECT TOP 1 id FROM ${emailConfigTable} ORDER BY id)`);
    }
    const saved = await saveProviderSettings(pool, sql, body, req.user.paycode || req.user.username || 'HR');
    const provider = publicProviderStatus(await getProviderSettings(pool));
    return res.json({ success: true, saved: saved.fields, provider });
  } catch (error) {
    console.error('[EMAIL_PROVIDER_SAVE]', (error && error.message || error).toString().slice(0, 300));
    return res.status(400).json({ success: false, message: (error && error.message || 'Could not save provider settings.').toString().slice(0, 300) });
  }
});
/* Health check for the status cards + the "what is needed" hints. */
app.get('/api/email/health', requireDbConfig, authenticate, requireRole('HR'), async (req, res) => {
  try {
    const pool = await getPool();
    const cfg = await getEmailConfig(pool);
    const provider = publicProviderStatus(await getProviderSettings(pool));
    const recipients = await loadEmailRecipients(pool);
    const masterEmailCount = recipients.filter(r => r.emailSource === 'SQL (e_mail1)').length;
    const mappingCount = recipients.filter(r => r.emailSource === 'HR Mapping (Import)').length;
    const noEmailCount = recipients.filter(r => !r.email).length;
    const senderEmail = String(cfg.senderemail || '').trim();
    const checks = [
      { key: 'provider', label: 'Email Provider', ok: provider.configured, value: provider.configured ? `${provider.providerLabel} ✓` : 'Not configured', needs: provider.hint || '' },
      { key: 'database', label: 'SQL Database', ok: !!process.env.DB_SERVER, value: process.env.DB_SERVER ? 'Connected ✓' : 'Not configured', needs: process.env.DB_SERVER ? '' : 'Server .env me DB_SERVER set karo.' },
      { key: 'sender', label: 'Sender Email', ok: !!senderEmail, value: senderEmail || 'Not set', needs: senderEmail ? '' : 'Company ka HR sender email save karo (Provider Config tab) — Brevo me verified sender hona chahiye.' },
      { key: 'recipients', label: 'Employee Emails', ok: noEmailCount === 0 && recipients.length > 0, value: `${masterEmailCount} SQL e_mail1 • ${mappingCount} HR mapping • ${noEmailCount} missing`, needs: noEmailCount > 0 ? `${noEmailCount} employees ka koi email nahi mila — "Export Missing Emails" se CSV nikaal ke Email Source tab se import karo.` : '' }
    ];
    return res.json({ success: true, ready: provider.configured && !!senderEmail && !!process.env.DB_SERVER, provider, checks, masterEmailCount, mappingCount, noEmailCount, recipientCount: recipients.length, senderEmail, senderName: String(cfg.sendername || '').trim() });
  } catch (error) { return emailErrorResponse(res, error); }
});
/* Read-only list of employees with NO resolvable email (the "import needed" item). */
app.get('/api/email/missing', requireDbConfig, authenticate, requireRole('HR'), async (req, res) => {
  try {
    const pool = await getPool();
    const recipients = await loadEmailRecipients(pool);
    const filters = { companycode: (req.query.companycode || '').trim(), departmentcode: (req.query.departmentcode || '').trim() };
    const rows = applyEmailFilters(recipients.filter(r => !r.email), filters)
      .map(r => ({ paycode: r.paycode, employeename: r.empname, companycode: r.companycode, departmentcode: r.departmentcode, email: '' }));
    return res.json({ success: true, count: rows.length, rows });
  } catch (error) { return emailErrorResponse(res, error); }
});
/* ---- Test Email: sends a fixed test message (no employee data) ---- */
app.post('/api/email/test', requireDbConfig, authenticate, requireRole('HR'), async (req, res) => {
  try {
    const to = String(req.body?.to || '').trim();
    if (!EMAIL_RE.test(to)) return res.status(400).json({ success: false, message: 'Invalid test email address.' });
    const pool = await getPool();
    const cfg = await getEmailConfig(pool);
    const provider = await getProviderSettings(pool);
    if (!provider.configured) return res.status(400).json({ success: false, message: provider.hint || 'Email provider is not configured. Open the Provider Config tab.' });
    if (!String(cfg.senderemail || '').trim()) return res.status(400).json({ success: false, message: 'Sender email not set — save Sender Email in the Provider Config tab first.' });
    const messageId = await sendEmailNow(provider, cfg, 'Test Email — Attendance HR Portal', 'This is a test email from the Attendance HR Portal email configuration. Employee greeting data is NOT included.', to, 'HR Admin');
    await logEmail(pool, { eventtype: 'Test', eventdate: localToday(), recipientemail: to, status: 'Sent', providermessageid: messageId });
    return res.json({ success: true, messageId });
  } catch (error) {
    try { const pool = await getPool(); await logEmail(pool, { eventtype: 'Test', eventdate: localToday(), recipientemail: String(req.body?.to || ''), status: 'Failed', errormessage: (error && error.message || error).toString().slice(0, 480) }); } catch (_) {}
    return emailErrorResponse(res, error);
  }
});
/* ---- Single Email: resolve a REAL employee (SQL e_mail1 first → HR mapping fallback) ---- */
app.get('/api/email/resolve', requireDbConfig, authenticate, requireRole('HR'), async (req, res) => {
  try {
    const paycode = String(req.query.paycode || '').trim();
    if (!paycode) return res.status(400).json({ success: false, message: 'Paycode is required.' });
    const pool = await getPool();
    await ensureEmailTables(pool);
    const empResult = await pool.request().input('paycode', sql.VarChar(50), paycode).query(`SELECT TOP 1 LTRIM(RTRIM(paycode)) AS paycode, LTRIM(RTRIM(empname)) AS empname, LTRIM(RTRIM(companycode)) AS companycode, LTRIM(RTRIM(departmentcode)) AS departmentcode, LTRIM(RTRIM(designation)) AS designation, e_mail1, CONVERT(varchar(10), dateofbirth, 23) AS dateofbirth, CONVERT(varchar(10), dateofjoin, 23) AS dateofjoin FROM dbo.tblemployee WHERE LTRIM(RTRIM(paycode)) = @paycode`);
    const emp = empResult.recordset[0];
    if (!emp) return res.status(404).json({ success: false, message: `Paycode ${paycode} not found in Savior SQL employee master.` });
    const mapRow = (await pool.request().input('pc', sql.VarChar(50), paycode).query(`SELECT TOP 1 email FROM ${emailMapTable} WHERE paycode = @pc`)).recordset[0];
    const { email, source } = resolveEmail(emp, mapRow);
    return res.json({ success: true, employee: emp, email, emailSource: email ? source : 'No email found — import mapping required', hasEmail: !!email });
  } catch (error) { return emailErrorResponse(res, error); }
});
/* ---- Single Email send (backend-authorized; browser never sends arbitrary emails) ---- */
app.post('/api/email/send-single', requireDbConfig, authenticate, requireRole('HR'), async (req, res) => {
  let pool, emp, resolved, cfg, eventDate, eventType, paycode, provider;
  try {
    const b = req.body || {};
    paycode = String(b.paycode || '').trim();
    if (!paycode) return res.status(400).json({ success: false, message: 'Paycode is required.' });
    eventType = normalizeEmailEventType(b.eventType);
    pool = await getPool();
    provider = await getProviderSettings(pool);
    if (!provider.configured) return res.status(400).json({ success: false, message: provider.hint || 'Email provider is not configured. Open the Provider Config tab.' });
    cfg = await getEmailConfig(pool);
    const empResult = await pool.request().input('paycode', sql.VarChar(50), paycode).query(`SELECT TOP 1 LTRIM(RTRIM(paycode)) AS paycode, LTRIM(RTRIM(empname)) AS empname, LTRIM(RTRIM(companycode)) AS companycode, LTRIM(RTRIM(departmentcode)) AS departmentcode, LTRIM(RTRIM(designation)) AS designation, e_mail1, CONVERT(varchar(10), dateofbirth, 23) AS dateofbirth, CONVERT(varchar(10), dateofjoin, 23) AS dateofjoin FROM dbo.tblemployee WHERE LTRIM(RTRIM(paycode)) = @paycode`);
    emp = empResult.recordset[0];
    if (!emp) return res.status(404).json({ success: false, message: `Paycode ${paycode} not found in Savior SQL employee master.` });
    const mapRow = (await pool.request().input('pc', sql.VarChar(50), paycode).query(`SELECT TOP 1 email FROM ${emailMapTable} WHERE paycode = @pc`)).recordset[0];
    resolved = resolveEmail(emp, mapRow);
    if (!resolved.email) return res.status(400).json({ success: false, message: `No valid email for ${paycode} — SQL e_mail1 is empty and no HR mapping exists. Import the email first.` });
    if (!String(cfg.senderemail || '').trim()) return res.status(400).json({ success: false, message: 'Sender email not set — save Sender Email in the Provider Config tab first.' });
    eventDate = /^\d{4}-\d{2}-\d{2}$/.test(String(b.date || '')) ? String(b.date) : localToday();
    if (!b.resend && await alreadySentToday(pool, paycode, eventType, eventDate)) {
      return res.status(409).json({ success: false, alreadySent: true, message: `A ${eventType} email was already sent to ${paycode} for ${eventDate}. Tick 'Resend (ignore duplicate protection)' to send again.` });
    }
  } catch (error) { return emailErrorResponse(res, error); }
  try {
    const { subject, text } = emailBodyFor(cfg, eventType, emp, { subject: (req.body || {}).subject, body: (req.body || {}).body });
    const messageId = await sendEmailNow(provider, cfg, subject, text, resolved.email, emp.empname);
    await logEmail(pool, { paycode, employeename: emp.empname, companycode: emp.companycode, departmentcode: emp.departmentcode, eventtype: eventType, eventdate: eventDate, recipientemail: resolved.email, status: 'Sent', providermessageid: messageId });
    return res.json({ success: true, messageId, email: resolved.email, emailSource: resolved.source, subject, eventDate });
  } catch (error) {
    try { await logEmail(pool, { paycode, employeename: emp.empname, companycode: emp.companycode, departmentcode: emp.departmentcode, eventtype: eventType, eventdate: eventDate, recipientemail: resolved.email, status: 'Failed', errormessage: (error && error.message || error).toString().slice(0, 480) }); } catch (_) {}
    return emailErrorResponse(res, error);
  }
});
app.get('/api/email/preview', requireDbConfig, authenticate, requireRole('HR'), async (req, res) => {
  try {
    const pool = await getPool();
    const cfg = await getEmailConfig(pool);
    const provider = publicProviderStatus(await getProviderSettings(pool));
    const eventType = normalizeEmailEventType(req.query.eventType);
    const eventDate = /^\d{4}-\d{2}-\d{2}$/.test(String(req.query.date || '')) ? String(req.query.date) : localToday();
    const filters = { companycode: (req.query.companycode || '').trim(), departmentcode: (req.query.departmentcode || '').trim(), paycode: (req.query.paycode || '').trim() };
    const { employees, targets } = await loadEmailTargets(pool, eventType, eventDate);
    const filtered = applyEmailFilters(targets, filters);
    const mapResult = await pool.request().query(`SELECT TOP 2000 paycode, email FROM ${emailMapTable}`);
    const mapRows = new Map((mapResult.recordset || []).map(m => [String(m.paycode || '').trim(), m]));
    const sentSet = await loadSentPaycodes(pool, eventType, eventDate);
    let validEmails = 0, missingEmails = 0, alreadySent = 0;
    const rows = [];
    for (const t of filtered) {
      const paycode = String(t.paycode || '').trim();
      const emp = employees.find(e => String(e.paycode || '').trim() === paycode) || t;
      const { email, source } = resolveEmail(emp, mapRows.get(paycode));
      if (email) validEmails++; else missingEmails++;
      const sent = sentSet.has(paycode);
      if (sent) alreadySent++;
      rows.push({ employeename: emp.empname || '', paycode, companycode: emp.companycode || '', departmentcode: emp.departmentcode || '', email: email || '', emailSource: email ? source : 'Missing', mailType: eventType, alreadySent: sent });
    }
    const willSend = rows.filter(r => r.email && !r.alreadySent).length;
    const firstEmp = rows[0] ? (employees.find(e => String(e.paycode || '').trim() === rows[0].paycode) || {}) : null;
    const sample = firstEmp ? { paycode: firstEmp.paycode, empname: firstEmp.empname, ...emailBodyFor(cfg, eventType, firstEmp, { subject: req.query.subject, body: req.query.body }) } : null;
    return res.json({ success: true, eventType, eventDate, total: rows.length, validEmails, missingEmails, alreadySent, willSend, providerReady: provider.configured, provider, senderEmail: String(cfg.senderemail || '').trim(), enabled: eventType === 'Birthday' ? !!cfg.birthdayenabled : eventType === 'Work Anniversary' ? !!cfg.workanniversaryenabled : eventType === 'Marriage Anniversary' ? !!cfg.marriageenabled : null, sample, rows: rows.slice(0, 500) });
  } catch (error) { return emailErrorResponse(res, error); }
});
app.post('/api/email/send', requireDbConfig, authenticate, requireRole('HR'), async (req, res) => {
  try {
    const b = req.body || {};
    const eventType = normalizeEmailEventType(b.eventType);
    const pool = await getPool();
    const provider = await getProviderSettings(pool);
    if (!provider.configured) return res.status(400).json({ success: false, message: provider.hint || 'Email provider is not configured. Open the Provider Config tab.' });
    const result = await runEmailEvent(pool, eventType, {
      companycode: String(b.companycode || '').trim(),
      departmentcode: String(b.departmentcode || '').trim(),
      paycode: String(b.paycode || '').trim()
    }, {
      date: /^\d{4}-\d{2}-\d{2}$/.test(String(b.date || '')) ? String(b.date) : undefined,
      subject: b.subject, body: b.body, resend: !!b.resend
    });
    return res.json({ success: true, ...result });
  } catch (error) { return emailErrorResponse(res, error); }
});
app.post('/api/email/import', requireDbConfig, authenticate, requireRole('HR'), async (req, res) => {
  try {
    const rows = Array.isArray(req.body?.rows) ? req.body.rows : [];
    if (!rows.length) return res.status(400).json({ success: false, message: 'No rows received.' });
    const pool = await getPool();
    await ensureEmailTables(pool);
    const employeesResult = await pool.request().query(`SELECT TOP 2000 paycode, empname, companycode, departmentcode FROM dbo.tblemployee`);
    const known = new Map(employeesResult.recordset.map(e => [String(e.paycode || '').trim(), e]));
    let inserted = 0, updated = 0, invalid = 0, notFound = 0;
    const invalidRows = [];
    const seen = new Set();
    for (const row of rows) {
      const paycode = String(row.paycode || '').trim();
      const email = String(row.email || '').trim();
      if (!paycode || !email || !EMAIL_RE.test(email)) { invalid++; if (invalidRows.length < 20) invalidRows.push({ paycode: paycode || '(blank)', reason: !paycode ? 'Paycode missing' : 'Invalid/missing email' }); continue; }
      if (seen.has(paycode)) { invalid++; if (invalidRows.length < 20) invalidRows.push({ paycode, reason: 'Duplicate paycode in file' }); continue; }
      seen.add(paycode);
      const emp = known.get(paycode);
      if (!emp) notFound++;
      const up = await pool.request()
        .input('paycode', sql.VarChar(50), paycode).input('email', sql.VarChar(150), email)
        .input('companycode', sql.VarChar(30), String(row.companycode || (emp && emp.companycode) || '').trim() || null)
        .input('departmentcode', sql.VarChar(30), String(row.departmentcode || (emp && emp.departmentcode) || '').trim() || null)
        .input('employeename', sql.NVarChar(120), String(row.employeename || (emp && emp.empname) || '').trim() || null)
        .query(`MERGE ${emailMapTable} WITH (HOLDLOCK) AS t USING (SELECT @paycode AS paycode) AS s ON t.paycode = s.paycode
WHEN MATCHED THEN UPDATE SET email = @email, companycode = COALESCE(@companycode, t.companycode), departmentcode = COALESCE(@departmentcode, t.departmentcode), employeename = COALESCE(@employeename, t.employeename), updateddate = SYSUTCDATETIME()
WHEN NOT MATCHED THEN INSERT (paycode, email, companycode, departmentcode, employeename) VALUES (@paycode, @email, @companycode, @departmentcode, @employeename)
OUTPUT $action;`);
      if (up.recordset[0] && up.recordset[0].$action === 'UPDATE') updated++; else inserted++;
    }
    return res.json({ success: true, total: rows.length, inserted, updated, invalid, notFound, invalidRows });
  } catch (error) { return emailErrorResponse(res, error); }
});
app.get('/api/email/log', requireDbConfig, authenticate, requireRole('HR'), async (req, res) => {
  try {
    const pool = await getPool();
    await ensureEmailTables(pool);
    const limit = Math.min(Number(req.query.limit || 100), 500);
    const result = await pool.request().query(`SELECT TOP ${limit} id, paycode, employeename, companycode, departmentcode, eventtype, CONVERT(varchar(10), eventdate, 23) AS eventdate, recipientemail, status, providermessageid, errormessage, CONVERT(varchar(19), sentat, 120) AS sentat FROM ${emailLogTable} ORDER BY sentat DESC, id DESC`);
    return res.json({ success: true, rows: result.recordset });
  } catch (error) { return emailErrorResponse(res, error); }
});
// Serve Vite production frontend from dist, then SPA fallback for non-API routes
app.use(express.static(distDir));
app.get('*', (req, res, next) => {
  if (req.path === '/api' || req.path.startsWith('/api/')) return next();
  res.sendFile(path.join(distDir, 'index.html'));
});

// EADDRINUSE ko crash ki jagah clear message banao: user ko exact fix command batao.
// (npm run server dobara chalane se pehle purana node process band karna hota hai.)
const server = app.listen(PORT, '0.0.0.0', () => console.log(`Attendance API listening on port ${PORT}`));
server.on('error', (error) => {
  if (error?.code === 'EADDRINUSE') {
    console.error(`Port ${PORT} already in use. Stop the old server first, then retry:`);
    console.error(`  npx kill-port ${PORT}   (or: Get-Process node | Stop-Process -Force)`);
    console.error(`  npm run server`);
    process.exitCode = 1;
    return;
  }
  throw error;
});
