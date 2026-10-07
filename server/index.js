import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import jwt from 'jsonwebtoken';
import nodemailer from 'nodemailer';
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
// Employee credentials (password hash storage + verification) live in ONE isolated
// module (server/employee-auth.js). Attendance tables and the HR login path never
// import it, so this hardening cannot change attendance or HR behaviour.
import {
  verifyEmployeeLogin,
  verifyEmployeePinLogin,
  isPasswordChangeRequired,
  changeEmployeePassword,
  firstTimeSetupState,
  completeFirstTimeSetup,
  getEmployeePinState,
  createEmployeePin,
  changeEmployeePin,
  createPasswordResetToken,
  findValidResetToken,
  consumeResetToken,
  resetThrottle,
  validatePasswordStrength,
  setEmployeePassword,
  getEmployeeCredentialStatus,
  hrResetEmployeePassword,
  hrResetEmployeePin,
  hrForcePasswordChange,
  hrSetEmployeeLoginEnabled,
} from './employee-auth.js';
// Employee Leave Management lives in ONE isolated module (server/leave-service.js)
// so the storage backend can be swapped later (Phase J section 7 keeps the seam
// ready for a future Navision integration - no Navision code exists here).
// Attendance, holiday and HR login paths do not import it.
import { ensureLeaveTables, getLeaveProvider } from './leave-service.js';

const app = express();
const port = Number(process.env.API_PORT || 4000);
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

/**
 * Phase I section 2 guard: an employee whose account is flagged
 * mustChangePassword may NOT read any employee data until they set a new one.
 *
 * Identity comes from the verified JWT (req.user.paycode) - a paycode in the
 * query or body is never read, so this cannot be bypassed or aimed at another
 * employee. The flag is read LIVE from the credential store rather than trusted
 * from the token, so an HR "force password change" takes effect immediately,
 * even for a session that is already open.
 *
 * The employee password-change endpoint is deliberately NOT wrapped in this
 * guard, otherwise the employee would have no way to satisfy it.
 */
function requirePasswordChanged(req, res, next) {
  if (req.user?.role !== 'EMPLOYEE') return next();
  if (req.user?.devEmployee === true) return next(); // dev bypass has no credential row
  getPool()
    .then((pool) => isPasswordChangeRequired(pool, req.user.paycode))
    .then((required) => {
      if (required) {
        return res.status(403).json({
          success: false,
          code: 'PASSWORD_CHANGE_REQUIRED',
          message: 'Please set your new password before continuing.',
          mustChangePassword: true,
        });
      }
      return next();
    })
    .catch(() => sendDbError(res, new Error('Credential store unavailable.')));
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
 * - 30min grace (2/month) ? 1hr grace (1/month) ? 2hr grace (1/month)
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

// Current India calendar month as 'YYYY-MM' (same month HR audit treats as current).
function currentMonthKey() {
  return indiaTodayISO().slice(0, 7);
}

// First..last day of a 'YYYY-MM' month, calendar dates only (no timezone steps).
function monthRange(monthKey) {
  const s = String(monthKey || '').slice(0, 7);
  if (!/^\d{4}-\d{2}$/.test(s)) return null;
  const [year, month] = s.split('-').map(Number);
  const last = new Date(Date.UTC(year, month, 0));
  if (last.getUTCFullYear() !== year || last.getUTCMonth() !== month - 1) return null;
  return { fromDate: `${s}-01`, toDate: isoDate(last) };
}

// Last N days ending on the India-local today (inclusive).
function rollingDaysRange(days) {
  const end = indiaTodayISO();
  const [y, m, d] = end.split('-').map(Number);
  const startDate = new Date(Date.UTC(y, m - 1, d));
  startDate.setUTCDate(startDate.getUTCDate() - (days - 1));
  return { fromDate: isoDate(startDate), toDate: end };
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
   Miss Punch tab hi gina jata hai jab attendance period/shift COMPLETE ho chuka ho.
   Aaj ki chalti hui shift (IN ho chuka, OUT pending, aur configured shift end time abhi
   nahi aaya) ko Miss Punch nahi gina jata — din/shift guzarne par existing rule apply
   hota hai. End time lookup: register row ka shiftendtime ? tblshiftmaster (company
   match) ? tblshiftmaster (same shift ka koi bhi row) ? unknown shift = poora din
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
  } catch (_) { if (!shiftEndCache) shiftEndCache = new Map(); } // shiftmaster unavailable ? day-granularity fallback
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
   dbo.tblemployeeshiftmaster maps paycode ? shift code (with optional effective dates).
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
// Past/future dates par hamesha FALSE (wahan shift complete maani jaati hai ? purana rule).
function isOngoingShiftRow(row, shiftMap, nowMin, todayIso) {
  if (!row || !todayIso || rowDateIso(row.dateoffice) !== todayIso) return false;
  if (row.out1 || row.out2) return false;           // OUT aa gaya ? shift khatam, normal rule
  if (!(row.in1 || row.in2)) return false;          // koi IN punch nahi ? Absent branch
  let endMin = shiftTimeToMinutes(row.shiftendtime); // register row ka apna shift end (jab populated ho)
  if (endMin === null) {
    const entry = shiftMap && shiftMap.get(String(row.shift || '').trim());
    if (!entry) return true;                        // shift config unknown ? din bhar in-progress
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

// Employee sign-in. Two credentials are accepted (Phase I section 5):
//   { paycode, password }  - the primary credential, unchanged from before
//   { paycode, pin }       - the 4-digit PIN, as an ALTERNATIVE
// Password login is never removed and remains the fallback. `credential: 'pin'`
// selects the PIN explicitly; otherwise a supplied `pin` is used.
app.post('/api/auth/employee/login', requireConfiguredAuth, async (req, res) => {
  const paycode = String(req.body?.paycode || '').trim();
  const password = String(req.body?.password || '');
  const pin = String(req.body?.pin || '');
  const usePin = String(req.body?.credential || '').trim().toLowerCase() === 'pin' || (!password && !!pin);
  if (!paycode) return res.status(400).json({ success: false, message: 'Employee paycode is required.' });
  if (usePin ? !pin : !password) {
    return res.status(400).json({ success: false, message: usePin ? 'Employee PIN is required.' : 'Employee paycode and password are required.' });
  }
  if (devEmployeeAuthEnabled && paycode === devEmployeePaycode) {
    if (password !== devEmployeePassword) return res.status(401).json({ success: false, message: 'Invalid employee credentials.' });
    return res.json({ success: true, token: signUser({ id: paycode, role: 'EMPLOYEE', paycode, devEmployee: true }), role: 'EMPLOYEE', employee: { paycode, empname: 'Development Employee', presentcardno: null, companycode: null }, mustChangePassword: false });
  }
  if (!process.env.DB_SERVER || !process.env.DB_DATABASE || !process.env.DB_USER || !process.env.DB_PASSWORD) return res.status(503).json({ success: false, message: 'Database connection unavailable.' });
  try {
    const pool = await getPool();
    // Real employee authentication: identity comes from dbo.tblemployee.paycode and
    // the secret is verified against the application-owned credential store.
    // A wrong or missing secret is rejected; no JWT is issued.
    const outcome = usePin
      ? await verifyEmployeePinLogin(pool, paycode, pin)
      : await verifyEmployeeLogin(pool, paycode, password);
    if (!outcome.ok) {
      // firstTimeSetupRequired lets the mobile app route an employee who has not
      // created a password yet. Additive field: existing clients keep working.
      return res.status(outcome.status).json({
        success: false,
        message: outcome.message,
        code: outcome.code || 'LOGIN_FAILED',
        firstTimeSetupRequired: outcome.code === 'FIRST_TIME_SETUP_REQUIRED',
        // mustChangePassword is advisory on a FAILED login (nothing is being
        // unlocked), but it tells the client which screen to show next.
        mustChangePassword: false,
      });
    }
    // Additive response fields only - existing clients ignore unknown keys.
    res.json({
      success: true,
      token: signUser({ id: outcome.employee.paycode, role: 'EMPLOYEE', paycode: outcome.employee.paycode }),
      role: 'EMPLOYEE',
      employee: outcome.employee,
      mustChangePassword: outcome.mustChangePassword === true,
    });
  } catch (error) { sendDbError(res, error); }
});

// ---- Employee first-time password setup (Phase 3A.7) ----
// Runs BEFORE the employee is logged in, so it is deliberately narrow:
// it only creates a password for a real, active Savior employee that has no
// credential yet. It can never overwrite an existing password, and it never
// returns or stores anything in plaintext. HR-driven resets are a later phase.
app.get('/api/auth/employee/first-time-setup/status', requireConfiguredAuth, async (req, res) => {
  if (!process.env.DB_SERVER || !process.env.DB_DATABASE || !process.env.DB_USER || !process.env.DB_PASSWORD) return res.status(503).json({ success: false, message: 'Database connection unavailable.' });
  try {
    const pool = await getPool();
    const outcome = await firstTimeSetupState(pool, req.query?.paycode);
    if (!outcome.ok) return res.status(outcome.status).json({ success: false, message: outcome.message });
    res.json({ success: true, firstTimeSetupRequired: outcome.required, employee: outcome.employee });
  } catch (error) { sendDbError(res, error); }
});

app.post('/api/auth/employee/first-time-setup', requireConfiguredAuth, async (req, res) => {
  if (!process.env.DB_SERVER || !process.env.DB_DATABASE || !process.env.DB_USER || !process.env.DB_PASSWORD) return res.status(503).json({ success: false, message: 'Database connection unavailable.' });
  try {
    const pool = await getPool();
    const outcome = await completeFirstTimeSetup(pool, {
      paycode: req.body?.paycode,
      password: req.body?.password,
      confirmPassword: req.body?.confirmPassword,
    });
    if (!outcome.ok) {
      return res.status(outcome.status).json({ success: false, message: outcome.message, code: outcome.code || 'SETUP_FAILED' });
    }
    // Deliberately no token here: the employee logs in normally afterwards.
    res.json({ success: true, message: 'Password created. Please sign in.', employee: outcome.employee });
  } catch (error) { sendDbError(res, error); }
});

// ============================================================================
// EMPLOYEE LEAVE MANAGEMENT (Phase J)
// ============================================================================
// Storage is 100% application-owned (dbo.HR_Leave*). dbo.tblemployee,
// dbo.tblemployeeshiftmaster, dbo.tbltimeregister and dbo.tblcategory are only
// ever READ (identity + real week-off day). No Savior table is created, altered
// or written, and an APPROVED leave never changes a Savior attendance record —
// it is an application-level overlay shown in the attendance calendar.
//
// IDENTITY RULE (Phase J section 8): every EMPLOYEE leave route takes the
// paycode from the verified JWT (req.user.paycode). A paycode in the query or
// body is ignored, so one employee can never read or touch another's leave.
//
// All business logic lives behind getLeaveProvider() so a future Navision
// adapter can replace the storage without changing any route below.
// ============================================================================

/**
 * Shared guard: leave tables must exist before any leave call.
 *
 * Deliberately NOT an async function — Express needs the middleware
 * synchronously, so this must return the handler, not a promise of it.
 */
function withLeaveProvider(handler) {
  return async (req, res) => {
    if (!process.env.DB_SERVER || !process.env.DB_DATABASE || !process.env.DB_USER || !process.env.DB_PASSWORD) {
      return res.status(503).json({ success: false, message: 'Database connection unavailable.' });
    }
    try {
      const pool = await getPool();
      await ensureLeaveTables(pool);
      const provider = await getLeaveProvider();
      await handler({ req, res, pool, provider });
    } catch (error) { sendDbError(res, error); }
  };
}

// ---- Leave types (employee read-only, HR read/write) ----
app.get('/api/employee/leave/types', authenticate, requireRole('EMPLOYEE'), requirePasswordChanged, requireDbConfig,
  withLeaveProvider(async ({ res, pool, provider }) => {
    res.json({ success: true, types: await provider.listTypes(pool) });
  }));

app.get('/api/employee/leave/balance', authenticate, requireRole('EMPLOYEE'), requirePasswordChanged, requireDbConfig,
  withLeaveProvider(async ({ req, res, pool, provider }) => {
    // Paycode is ALWAYS the session identity; req.query.paycode is never read.
    res.json({ success: true, ...(await provider.getBalance(pool, { paycode: req.user.paycode, leaveyear: req.query?.leaveyear })) });
  }));

app.get('/api/employee/leave/requests', authenticate, requireRole('EMPLOYEE'), requirePasswordChanged, requireDbConfig,
  withLeaveProvider(async ({ req, res, pool, provider }) => {
    const requests = await provider.listRequests(pool, {
      paycode: req.user.paycode,
      leaveyear: req.query?.leaveyear,
      status: req.query?.status,
    });
    res.json({ success: true, requests });
  }));

// Employee creates a request for THEMSELVES.
app.post('/api/employee/leave/requests', authenticate, requireRole('EMPLOYEE'), requirePasswordChanged, requireDbConfig,
  withLeaveProvider(async ({ req, res, pool, provider }) => {
    const outcome = await provider.createRequest(pool, {
      paycode: req.user.paycode,
      leavetype: req.body?.leavetype,
      fromdate: req.body?.fromdate,
      todate: req.body?.todate,
      isHalfDay: req.body?.isHalfDay === true,
      halfdaypart: req.body?.halfdaypart,
      reason: req.body?.reason,
      // Optional attachment is carried as a name (+ optional small data payload).
      attachmentName: req.body?.attachmentName,
      attachmentData: req.body?.attachmentData,
      contactdetails: req.body?.contactdetails,
    });
    if (!outcome.ok) {
      return res.status(outcome.status).json({ success: false, message: outcome.message, code: outcome.code });
    }
    res.status(201).json({ success: true, request: outcome.request });
  }));

// Employee cancels their OWN pending request.
app.post('/api/employee/leave/requests/:id/cancel', authenticate, requireRole('EMPLOYEE'), requirePasswordChanged, requireDbConfig,
  withLeaveProvider(async ({ req, res, pool, provider }) => {
    const outcome = await provider.cancelRequest(pool, { paycode: req.user.paycode, id: req.params?.id });
    if (!outcome.ok) return res.status(outcome.status).json({ success: false, message: outcome.message, code: outcome.code });
    res.json({ success: true, message: 'Leave request cancelled.' });
  }));

/**
 * Calendar overlay: approved leave dates for the signed-in employee.
 * Read-only and identity-bound; the attendance calendar calls this per month.
 */
app.get('/api/employee/leave/calendar', authenticate, requireRole('EMPLOYEE'), requirePasswordChanged, requireDbConfig,
  withLeaveProvider(async ({ req, res, pool, provider }) => {
    const from = isValidIsoDate(req.query?.from) ? req.query.from : isoDate(new Date());
    const to = isValidIsoDate(req.query?.to) ? req.query.to : from;
    const overlay = await provider.calendarOverlay(pool, { paycode: req.user.paycode, fromdate: from, todate: to });
    res.json({ success: true, ...overlay });
  }));

// ---- HR leave administration (HR role required on every route) ----
app.get('/api/hr/leave/types', authenticate, requireRole('HR'), requireDbConfig,
  withLeaveProvider(async ({ req, res, pool, provider }) => {
    res.json({ success: true, types: await provider.listTypes(pool, { includeInactive: req.query?.includeInactive === 'true' }) });
  }));

app.post('/api/hr/leave/types', authenticate, requireRole('HR'), requireDbConfig,
  withLeaveProvider(async ({ req, res, pool, provider }) => {
    const outcome = await provider.addType(pool, { leavetype: req.body?.leavetype, typename: req.body?.typename, sortorder: req.body?.sortorder, actor: req.user?.sub });
    if (!outcome.ok) return res.status(outcome.status).json({ success: false, message: outcome.message, code: outcome.code });
    res.status(201).json({ success: true, leavetype: outcome.leavetype });
  }));

app.get('/api/hr/leave/config', authenticate, requireRole('HR'), requireDbConfig,
  withLeaveProvider(async ({ res, pool, provider }) => {
    res.json({ success: true, config: await provider.getConfig(pool) });
  }));

app.put('/api/hr/leave/config', authenticate, requireRole('HR'), requireDbConfig,
  withLeaveProvider(async ({ req, res, pool, provider }) => {
    const patch = {};
    if (req.body?.allowNegativeBalance !== undefined) patch.AllowNegativeBalance = req.body.allowNegativeBalance ? 'Y' : 'N';
    if (req.body?.maxBackdateDays !== undefined) patch.MaxBackdateDays = String(req.body.maxBackdateDays);
    if (req.body?.attachmentRequiredAboveDays !== undefined) patch.AttachmentRequiredAboveDays = String(req.body.attachmentRequiredAboveDays);
    const outcome = await provider.setConfig(pool, patch, req.user?.sub);
    res.json({ success: true, applied: outcome.applied, config: outcome.config });
  }));

app.get('/api/hr/leave/balances', authenticate, requireRole('HR'), requireDbConfig,
  withLeaveProvider(async ({ req, res, pool, provider }) => {
    res.json({ success: true, ...(await provider.listBalances(pool, { leaveyear: req.query?.leaveyear, search: req.query?.search, limit: req.query?.limit })) });
  }));

app.get('/api/hr/leave/requests', authenticate, requireRole('HR'), requireDbConfig,
  withLeaveProvider(async ({ req, res, pool, provider }) => {
    const requests = await provider.listAllRequests(pool, {
      leaveyear: req.query?.leaveyear,
      status: req.query?.status,
      search: req.query?.search,
      limit: req.query?.limit,
    });
    const pending = requests.filter((r) => r.status === 'Pending').length;
    res.json({ success: true, requests, counts: { total: requests.length, pending } });
  }));

app.post('/api/hr/leave/requests/:id/decision', authenticate, requireRole('HR'), requireDbConfig,
  withLeaveProvider(async ({ req, res, pool, provider }) => {
    const outcome = await provider.decideRequest(pool, { id: req.params?.id, decision: req.body?.decision, note: req.body?.note, actor: req.user?.sub });
    if (!outcome.ok) return res.status(outcome.status).json({ success: false, message: outcome.message, code: outcome.code });
    res.json({ success: true, request: outcome.request });
  }));

/**
 * HR Excel import of opening balances.
 * The client parses the workbook and posts plain row objects; this endpoint owns
 * ALL validation, including identity matching against the real active roster, so
 * an unmatched employee is reported as Failed rather than silently imported.
 */
app.post('/api/hr/leave/balances/import', authenticate, requireRole('HR'), requireDbConfig,
  withLeaveProvider(async ({ req, res, pool, provider }) => {
    const rows = Array.isArray(req.body?.rows) ? req.body.rows : [];
    if (!rows.length) return res.status(400).json({ success: false, message: 'No rows to import.', code: 'NO_ROWS' });
    if (rows.length > 5000) return res.status(400).json({ success: false, message: 'Please import at most 5000 rows at a time.', code: 'TOO_MANY_ROWS' });
    const summary = await provider.importBalances(pool, { rows, actor: req.user?.sub });
    res.json({ success: true, summary });
  }));

// ---- Employee 4-digit PIN (Phase 3A.8) ----
// The employee is taken from the verified JWT (req.user.paycode) on EVERY call.
// A paycode in the request body is never read, so one employee can never touch
// another employee's PIN. The PIN is additional: it never replaces the password
// and is never accepted as a login credential.
// ---- Employee Profile (self-service) ----
// The employee is ALWAYS taken from the verified JWT (req.user.paycode). A paycode
// in the query or body is never read, so one employee can never read or update
// another employee's profile.
//
// Read-only master columns (name, paycode, card, designation, department, company,
// date of joining / birth, gender, marital status, category, qualification,
// experience, blood group, active) are SELECTed but can never be written by this
// API - the UPDATE below is a fixed column whitelist.
//
// Self-service values are stored in the EXISTING dbo.tblemployee columns that
// Savior already keeps for exactly these details, so no schema change is needed:
//   telephone1  -> mobile number
//   e_mail1     -> personal email
//   address1    -> address            pincode1 -> pin code
//   guardianname-> emergency contact name
//   telephone2  -> emergency contact number
// dbo.tblemployee.relationship is char(1) and cannot hold a relation value, so
// it is deliberately NOT part of the editable set.
const EMPLOYEE_SELF_SERVICE_FIELDS = Object.freeze({
  mobile: 'telephone1',
  email: 'e_mail1',
  address: 'address1',
  pincode: 'pincode1',
  emergencyName: 'guardianname',
  emergencyNumber: 'telephone2',
});

function validateSelfService(values, current = {}) {
  const out = {};
  const str = (v) => String(v == null ? '' : v).trim();
  const same = (key) => str(values[key]) === str(current[key]);

  // A field the employee did not actually change is kept as-is and NOT
  // re-validated: existing master rows can legitimately hold masked/legacy
  // values (e.g. "XXXXXX9155") that must survive an unrelated save.
  const mobile = str(values.mobile);
  const email = str(values.email);
  const address = str(values.address);
  const pincode = str(values.pincode);
  const emergencyName = str(values.emergencyName);
  const emergencyNumber = str(values.emergencyNumber);

  // Alphanumeric + separators, 6-16 chars. Deliberately NOT digits-only: existing
  // Savior rows can hold masked/legacy values (e.g. "XXXXXX9155"), and an employee
  // must not be locked out of editing an unrelated field because of them.
  // Punctuation/email characters are still rejected ("abc!!", "not-an-email").
  if (!same('mobile') && mobile && !/^[A-Za-z0-9+\-\s]{6,16}$/.test(mobile)) {
    return { ok: false, message: 'Mobile number sahi nahi hai (6-16 characters, letters/digits/+/- only).' };
  }
  if (!same('email') && email && !/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email)) {
    return { ok: false, message: 'Email sahi nahi hai.' };
  }
  if (!same('address') && address.length > 80) return { ok: false, message: 'Address 80 characters se chhota hona chahiye.' };
  if (!same('pincode') && pincode && !/^[0-9A-Za-z\- ]{1,8}$/.test(pincode)) {
    return { ok: false, message: 'PIN code sahi nahi hai.' };
  }
  if (!same('emergencyName') && emergencyName.length > 25) return { ok: false, message: 'Emergency contact name 25 characters se chhota hona chahiye.' };
  if (!same('emergencyNumber') && emergencyNumber && !/^[A-Za-z0-9+\-\s]{6,16}$/.test(emergencyNumber)) {
    return { ok: false, message: 'Emergency contact number sahi nahi hai.' };
  }
  return {
    ok: true,
    values: { mobile, email, address, pincode, emergencyName, emergencyNumber },
  };
}

async function readEmployeeProfile(pool, paycode) {
  const result = await pool.request().input('paycode', sql.VarChar(50), paycode).query(`
    SELECT LTRIM(RTRIM(e.paycode)) AS paycode,
           LTRIM(RTRIM(e.empname)) AS empname,
           LTRIM(RTRIM(e.presentcardno)) AS presentcardno,
           LTRIM(RTRIM(e.designation)) AS designation,
           LTRIM(RTRIM(e.departmentcode)) AS departmentcode,
           LTRIM(RTRIM(d.departmentname)) AS departmentname,
           LTRIM(RTRIM(e.companycode)) AS companycode,
           LTRIM(RTRIM(c.companyname)) AS companyname,
           e.dateofbirth, e.dateofjoin,
           LTRIM(RTRIM(e.sex)) AS sex,
           LTRIM(RTRIM(e.ismarried)) AS ismarried,
           LTRIM(RTRIM(e.cat)) AS cat,
           LTRIM(RTRIM(e.qualification)) AS qualification,
           LTRIM(RTRIM(e.experience)) AS experience,
           LTRIM(RTRIM(e.bloodgroup)) AS bloodgroup,
           LTRIM(RTRIM(e.telephone1)) AS mobile,
           LTRIM(RTRIM(e.e_mail1)) AS email,
           LTRIM(RTRIM(e.address1)) AS address,
           LTRIM(RTRIM(e.pincode1)) AS pincode,
           LTRIM(RTRIM(e.guardianname)) AS emergencyName,
           LTRIM(RTRIM(e.telephone2)) AS emergencyNumber,
           LTRIM(RTRIM(e.active)) AS active
    FROM dbo.tblemployee e
    LEFT JOIN dbo.tbldepartment d ON LTRIM(RTRIM(d.departmentcode)) = LTRIM(RTRIM(e.departmentcode))
    LEFT JOIN dbo.tblcompany c ON LTRIM(RTRIM(c.companycode)) = LTRIM(RTRIM(e.companycode))
    WHERE e.paycode = @paycode`);
  if (!result.recordset[0]) return null;
  const e = result.recordset[0];
  const dateOnly = (v) => (v instanceof Date ? v.toISOString().slice(0, 10) : (v ? String(v).slice(0, 10) : ''));
  return {
    paycode: e.paycode,
    empname: e.empname,
    presentcardno: e.presentcardno,
    designation: e.designation,
    departmentcode: e.departmentcode,
    departmentname: e.departmentname || e.departmentcode,
    companycode: e.companycode,
    companyname: e.companyname || e.companycode,
    dateofbirth: dateOnly(e.dateofbirth),
    dateofjoin: dateOnly(e.dateofjoin),
    sex: e.sex,
    ismarried: e.ismarried,
    cat: e.cat,
    qualification: e.qualification,
    experience: e.experience,
    bloodgroup: e.bloodgroup,
    active: e.active,
    mobile: e.mobile,
    email: e.email,
    address: e.address,
    pincode: e.pincode,
    emergencyName: e.emergencyName,
    emergencyNumber: e.emergencyNumber,
    // Master fields the employee may never change through this API.
    editableFields: Object.keys(EMPLOYEE_SELF_SERVICE_FIELDS),
  };
}

// ---- Employee-side cumulative grace timeline (presentation only) ----
// computeMonthlyLateForEmployee() above is SHARED with HR Single Employee Audit and
// is deliberately left untouched. It already returns the month's remaining grace at
// the END of the month plus the chronological list of late events with the grace each
// one consumed. That is enough to replay the SAME consumption sequence and expose
// the grace position as of EACH late date, without re-deciding a single rule and
// without changing any HR response.
// initial allowance is derived from (final remaining + how many times each grace was used).
function buildGraceTimeline(lateDetails, graceRemaining) {
  const list = [...(lateDetails || [])].sort((a, b) => {
    const da = new Date(a.date);
    const db = new Date(b.date);
    return da - db;
  });
  const used30 = list.filter((d) => d.graceUsed === '30min').length;
  const used1hr = list.filter((d) => d.graceUsed === '1hr').length;
  const used2hr = list.filter((d) => d.graceUsed === '2hr').length;
  const init30 = Number(graceRemaining?.grace30min || 0) + used30;
  const init1hr = Number(graceRemaining?.grace1hr || 0) + used1hr;
  const init2hr = Number(graceRemaining?.grace2hr || 0) + used2hr;

  let left30 = init30;
  let left1hr = init1hr;
  let left2hr = init2hr;
  return list.map((d) => {
    if (d.graceUsed === '30min') left30 = Math.max(0, left30 - 1);
    else if (d.graceUsed === '1hr') left1hr = Math.max(0, left1hr - 1);
    else if (d.graceUsed === '2hr') left2hr = Math.max(0, left2hr - 1);
    return {
      date: rowDateIso(d.date),
      graceUsed: d.graceUsed,
      lateMinutes: Number(d.lateMinutes || 0),
      isFinalLate: d.isFinalLate !== false,
      total: { grace30min: init30, grace1hr: init1hr, grace2hr: init2hr },
      used: { grace30min: init30 - left30, grace1hr: init1hr - left1hr, grace2hr: init2hr - left2hr },
      remaining: { grace30min: left30, grace1hr: left1hr, grace2hr: left2hr },
    };
  });
}

app.get('/api/employee/profile', authenticate, requireRole('EMPLOYEE'), requirePasswordChanged, requireDbConfig, async (req, res) => {
  try {
    const pool = await getPool();
    const profile = await readEmployeeProfile(pool, req.user.paycode);
    if (!profile) return res.status(404).json({ success: false, message: 'Employee not found.' });
    res.json({ success: true, profile });
  } catch (error) { sendDbError(res, error); }
});

app.put('/api/employee/profile', authenticate, requireRole('EMPLOYEE'), requirePasswordChanged, requireDbConfig, async (req, res) => {
  try {
    const pool = await getPool();
    const before = await readEmployeeProfile(pool, req.user.paycode);
    if (!before) return res.status(404).json({ success: false, message: 'Employee not found.' });
    const checked = validateSelfService(req.body || {}, before);
    if (!checked.ok) return res.status(400).json({ success: false, message: checked.message });
    const v = checked.values;
    await pool.request()
      .input('paycode', sql.VarChar(50), req.user.paycode)
      .input('telephone1', sql.VarChar(16), v.mobile)
      .input('e_mail1', sql.VarChar(50), v.email)
      .input('address1', sql.VarChar(80), v.address)
      .input('pincode1', sql.VarChar(8), v.pincode)
      .input('guardianname', sql.VarChar(25), v.emergencyName)
      .input('telephone2', sql.VarChar(16), v.emergencyNumber)
      .query(`UPDATE dbo.tblemployee
                 SET telephone1 = @telephone1, e_mail1 = @e_mail1, address1 = @address1,
                     pincode1 = @pincode1, guardianname = @guardianname, telephone2 = @telephone2
               WHERE paycode = @paycode`);
    const profile = await readEmployeeProfile(pool, req.user.paycode);
    if (!profile) return res.status(404).json({ success: false, message: 'Employee not found.' });
    res.json({ success: true, message: 'Profile updated.', profile });
  } catch (error) { sendDbError(res, error); }
});

// ---- Employee changes their OWN password (Phase I sections 2 & 4) ----
// This is the ONE employee route that is deliberately NOT wrapped in
// requirePasswordChanged: it is how an employee satisfies that requirement.
// Identity comes from the verified JWT, never from the request body, so one
// employee can never change another employee's password.
app.post('/api/employee/password/change', authenticate, requireRole('EMPLOYEE'), requireDbConfig, async (req, res) => {
  try {
    const pool = await getPool();
    const outcome = await changeEmployeePassword(pool, {
      paycode: req.user.paycode,
      currentPassword: req.body?.currentPassword,
      newPassword: req.body?.newPassword,
      confirmPassword: req.body?.confirmPassword,
    });
    if (!outcome.ok) {
      return res.status(outcome.status).json({
        success: false,
        message: outcome.message,
        code: outcome.code || 'PASSWORD_CHANGE_FAILED',
        mustChangePassword: true,
      });
    }
    // No password, hash or salt is ever included in the response.
    res.json({ success: true, message: 'Password updated.', mustChangePassword: false, employee: outcome.employee });
  } catch (error) { sendDbError(res, error); }
});

// Tells the signed-in employee whether a forced password change is outstanding,
// so the app can gate the Dashboard before the user taps into a 403.
app.get('/api/employee/password/status', authenticate, requireRole('EMPLOYEE'), requireDbConfig, async (req, res) => {
  try {
    const pool = await getPool();
    const required = await isPasswordChangeRequired(pool, req.user.paycode);
    res.json({ success: true, mustChangePassword: required });
  } catch (error) { sendDbError(res, error); }
});

app.get('/api/employee/pin/status', authenticate, requireRole('EMPLOYEE'), requireDbConfig, async (req, res) => {
  try {
    const pool = await getPool();
    const state = await getEmployeePinState(pool, req.user.paycode);
    res.json({ success: true, pinConfigured: state.configured, locked: state.locked });
  } catch (error) { sendDbError(res, error); }
});

app.post('/api/employee/pin/setup', authenticate, requireRole('EMPLOYEE'), requirePasswordChanged, requireDbConfig, async (req, res) => {
  try {
    const pool = await getPool();
    const outcome = await createEmployeePin(pool, {
      paycode: req.user.paycode,
      pin: req.body?.pin,
      confirmPin: req.body?.confirmPin,
    });
    if (!outcome.ok) {
      return res.status(outcome.status).json({ success: false, message: outcome.message, code: outcome.code || 'PIN_SETUP_FAILED' });
    }
    // Only the fact that the PIN exists leaves the server. Never the PIN/hash.
    res.json({ success: true, pinConfigured: true });
  } catch (error) { sendDbError(res, error); }
});

app.post('/api/employee/pin/change', authenticate, requireRole('EMPLOYEE'), requirePasswordChanged, requireDbConfig, async (req, res) => {
  try {
    const pool = await getPool();
    const outcome = await changeEmployeePin(pool, {
      paycode: req.user.paycode,
      currentPin: req.body?.currentPin,
      newPin: req.body?.newPin,
      confirmPin: req.body?.confirmPin,
    });
    if (!outcome.ok) {
      return res.status(outcome.status).json({ success: false, message: outcome.message, code: outcome.code || 'PIN_CHANGE_FAILED' });
    }
    res.json({ success: true, pinConfigured: true });
  } catch (error) { sendDbError(res, error); }
});

// ---- Employee Forgot / Reset Password (Phase 3A.9) ----
// The response is intentionally IDENTICAL whether or not the paycode exists,
// active, provisioned or has an email — this prevents account enumeration.
// Authorisation to reset depends only on the emailed single-use token.
app.post('/api/auth/employee/forgot-password', requireConfiguredAuth, async (req, res) => {
  const generic = { success: true, message: 'If the account is eligible for password recovery, reset instructions have been sent.' };
  const paycode = String(req.body?.paycode || '').trim();
  const clientIp = String(req.ip || req.socket?.remoteAddress || '').slice(0, 64);

  if (!paycode) return res.status(200).json(generic);

  // Rate limit per paycode AND per client IP.
  if (resetThrottle(`pw:${paycode.toLowerCase()}`).blocked || resetThrottle(`ip:${clientIp}`).blocked) {
    return res.status(200).json(generic);
  }

  if (!process.env.DB_SERVER || !process.env.DB_DATABASE || !process.env.DB_USER || !process.env.DB_PASSWORD) {
    return res.status(200).json(generic);
  }

  try {
    const pool = await getPool();
    const issued = await createPasswordResetToken(pool, paycode, { ip: clientIp });
    if (!issued.ok) return res.status(200).json(generic);

    // Registered email comes from the EXISTING project source order:
    // Savior e_mail1 -> HR_EmployeeEmails mapping fallback.
    const empResult = await pool.request()
      .input('paycode', sql.VarChar(50), issued.employee.paycode)
      .query('SELECT TOP 1 LTRIM(RTRIM(paycode)) AS paycode, LTRIM(RTRIM(empname)) AS empname, LTRIM(RTRIM(companycode)) AS companycode, e_mail1 FROM dbo.tblemployee WHERE LTRIM(RTRIM(paycode)) = @paycode');
    const emp = empResult.recordset[0];
    const mapRow = (await pool.request()
      .input('pc', sql.VarChar(50), issued.employee.paycode)
      .query(`SELECT TOP 1 email FROM ${emailMapTable} WHERE paycode = @pc`)).recordset[0];
    const { email } = resolveEmail(emp, mapRow);

    if (!email) {
      await logEmail(pool, { paycode: issued.employee.paycode, employeename: issued.employee.empname, companycode: emp?.companycode, departmentcode: null, eventtype: 'Password Reset', eventdate: localToday(), recipientemail: null, status: 'No Email', errormessage: 'No registered email in SQL e_mail1 or HR mapping' });
      return res.status(200).json(generic);
    }

    const cfg = await getEmailConfig(pool);
    const provider = publicProviderStatus(await emailProviderSettings(pool));
    if (!provider.configured || !String(cfg.senderemail || '').trim()) {
      await logEmail(pool, { paycode: issued.employee.paycode, employeename: issued.employee.empname, companycode: emp?.companycode, departmentcode: null, eventtype: 'Password Reset', eventdate: localToday(), recipientemail: email, status: 'Failed', errormessage: 'Email provider not configured' });
      return res.status(200).json(generic);
    }

    // Security guidance only — no employee data, no paycode details.
    const subject = 'Password Reset Request';
    const text = [
      'A password reset was requested for your Attendance Portal account.',
      '',
      'Use this one-time code in the app on the "Reset Password" screen:',
      '',
      issued.token,
      '',
      `This code expires in ${issued.expiresInMinutes} minutes and can be used only once.`,
      'If you did not request this, you can safely ignore this email — your password stays unchanged.',
      '',
      'Never share this code with anyone.',
    ].join('\n');

    try {
      const messageId = await sendEmailNow(provider, cfg, subject, text, email, issued.employee.empname);
      await logEmail(pool, { paycode: issued.employee.paycode, employeename: issued.employee.empname, companycode: emp?.companycode, departmentcode: null, eventtype: 'Password Reset', eventdate: localToday(), recipientemail: email, status: 'Sent', providermessageid: messageId || null });
    } catch (mailError) {
      await logEmail(pool, { paycode: issued.employee.paycode, employeename: issued.employee.empname, companycode: emp?.companycode, departmentcode: null, eventtype: 'Password Reset', eventdate: localToday(), recipientemail: email, status: 'Failed', errormessage: (mailError && mailError.message || mailError).toString().slice(0, 480) });
    }
    return res.status(200).json(generic);
  } catch (_error) {
    // Never leak the reason a reset could not be sent.
    return res.status(200).json(generic);
  }
});

app.post('/api/auth/employee/reset-password', requireConfiguredAuth, async (req, res) => {
  if (!process.env.DB_SERVER || !process.env.DB_DATABASE || !process.env.DB_USER || !process.env.DB_PASSWORD) return res.status(503).json({ success: false, message: 'Database connection unavailable.' });
  try {
    const pool = await getPool();
    const token = String(req.body?.token || '').trim();
    const newPassword = String(req.body?.password || '');
    const confirmPassword = String(req.body?.confirmPassword || '');

    if (!token) return res.status(400).json({ success: false, message: 'Reset code is required.', code: 'TOKEN_REQUIRED' });
    if (!newPassword) return res.status(400).json({ success: false, message: 'Password is required.', code: 'PASSWORD_REQUIRED' });
    if (newPassword !== confirmPassword) {
      return res.status(400).json({ success: false, message: 'Password and confirmation do not match.', code: 'PASSWORD_MISMATCH' });
    }

    // Token is the ONLY authorisation — a paycode is never accepted here.
    const tokenCheck = await findValidResetToken(pool, token);
    if (!tokenCheck.ok) {
      return res.status(tokenCheck.status).json({ success: false, message: tokenCheck.message, code: tokenCheck.code });
    }

    // Same policy as Phase 3A.7 — not weakened.
    const strengthError = validatePasswordStrength(newPassword);
    if (strengthError) return res.status(400).json({ success: false, message: strengthError, code: 'WEAK_PASSWORD' });

    await setEmployeePassword(pool, tokenCheck.paycode, newPassword, { mustChange: false, updatedBy: 'password-reset' });
    await consumeResetToken(pool, token, { ip: String(req.ip || req.socket?.remoteAddress || '').slice(0, 64) });

    // PIN is deliberately NOT touched by a password reset.
    res.json({ success: true, message: 'Password updated. Please sign in with your new password.' });
  } catch (error) { sendDbError(res, error); }
});

// ---- HR-controlled employee credential reset (Phase 3A.10) ----
// authenticate + requireRole('HR') is enforced on EVERY route below, so an
// EMPLOYEE token is rejected with 403 and can never reset another employee.
// Password reset changes password columns only; PIN reset changes PIN columns
// only. No hash, password or PIN is ever returned or logged.
app.get('/api/hr/employee/credentials', authenticate, requireRole('HR'), requireDbConfig, async (req, res) => {
  try {
    const pool = await getPool();
    const outcome = await getEmployeeCredentialStatus(pool, req.query?.paycode);
    if (!outcome.ok) return res.status(outcome.status).json({ success: false, message: outcome.message, code: outcome.code || 'NOT_FOUND' });
    res.json({
      success: true,
      employee: outcome.employee,
      passwordSet: outcome.passwordSet,
      pinSet: outcome.pinSet,
      accountActive: outcome.accountActive,
      loginEnabled: outcome.loginEnabled,
      mustChangePassword: outcome.mustChangePassword,
      locked: outcome.locked,
      pinLocked: outcome.pinLocked,
    });
  } catch (error) { sendDbError(res, error); }
});

app.post('/api/hr/employee/credentials/password', authenticate, requireRole('HR'), requireDbConfig, async (req, res) => {
  try {
    const pool = await getPool();
    // mustChange:true stores the password as a TEMPORARY one and forces the
    // employee to replace it at next sign-in (Phase I section 2). The password
    // itself is never echoed back - HR supplies it and shares it out of band.
    const outcome = await hrResetEmployeePassword(pool, {
      paycode: req.body?.paycode,
      password: req.body?.password,
      confirmPassword: req.body?.confirmPassword,
      actor: req.user?.sub,
      mustChange: req.body?.mustChange === true,
    });
    if (!outcome.ok) {
      return res.status(outcome.status).json({ success: false, message: outcome.message, code: outcome.code || 'RESET_FAILED' });
    }
    res.json({
      success: true,
      message: outcome.mustChangePassword
        ? 'Temporary password set. The employee must set a new password at next login.'
        : 'Employee password updated.',
      mustChangePassword: outcome.mustChangePassword,
      employee: outcome.employee,
    });
  } catch (error) { sendDbError(res, error); }
});

// HR forces a password change WITHOUT replacing the password (Phase I section 7).
app.post('/api/hr/employee/credentials/force-password-change', authenticate, requireRole('HR'), requireDbConfig, async (req, res) => {
  try {
    const pool = await getPool();
    const outcome = await hrForcePasswordChange(pool, { paycode: req.body?.paycode, actor: req.user?.sub });
    if (!outcome.ok) {
      return res.status(outcome.status).json({ success: false, message: outcome.message, code: outcome.code || 'FORCE_FAILED' });
    }
    res.json({ success: true, message: 'Employee must set a new password at next login.', mustChangePassword: true, employee: outcome.employee });
  } catch (error) { sendDbError(res, error); }
});

// HR enables / disables an employee's login (Phase I section 7).
// Flips dbo.HR_EmployeeAuth.isactive only - no Savior row is ever touched.
app.post('/api/hr/employee/credentials/access', authenticate, requireRole('HR'), requireDbConfig, async (req, res) => {
  try {
    const pool = await getPool();
    const outcome = await hrSetEmployeeLoginEnabled(pool, {
      paycode: req.body?.paycode,
      enabled: req.body?.enabled,
      actor: req.user?.sub,
    });
    if (!outcome.ok) {
      return res.status(outcome.status).json({ success: false, message: outcome.message, code: outcome.code || 'ACCESS_FAILED' });
    }
    res.json({
      success: true,
      message: outcome.loginEnabled ? 'Employee login enabled.' : 'Employee login disabled.',
      loginEnabled: outcome.loginEnabled,
      employee: outcome.employee,
    });
  } catch (error) { sendDbError(res, error); }
});

app.post('/api/hr/employee/credentials/pin', authenticate, requireRole('HR'), requireDbConfig, async (req, res) => {
  try {
    const pool = await getPool();
    const outcome = await hrResetEmployeePin(pool, {
      paycode: req.body?.paycode,
      pin: req.body?.pin,
      confirmPin: req.body?.confirmPin,
      actor: req.user?.sub,
    });
    if (!outcome.ok) {
      return res.status(outcome.status).json({ success: false, message: outcome.message, code: outcome.code || 'RESET_FAILED' });
    }
    res.json({ success: true, message: 'Employee PIN updated.', employee: outcome.employee });
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
  if (req.user.role === 'EMPLOYEE' && req.user.devEmployee === true && devEmployeeAuthEnabled && req.user.paycode === devEmployeePaycode) return res.json({ role: 'EMPLOYEE', employee: { paycode: devEmployeePaycode, empname: 'Development Employee', presentcardno: null, companycode: null }, mustChangePassword: false });
  if (!process.env.DB_SERVER || !process.env.DB_DATABASE || !process.env.DB_USER || !process.env.DB_PASSWORD) return res.status(503).json({ success: false, message: 'Database connection unavailable.' });
  try {
    const pool = await getPool();
    // dbo.tblemployee.paycode / empname are fixed-width CHAR columns, so a raw
    // SELECT returns them space-padded ("0328        "). They are trimmed here so
    // the identity this endpoint reports matches the one the JWT carries and the
    // one every other employee route returns.
    const result = await pool.request().input('paycode', sql.VarChar(50), req.user.paycode).query('SELECT TOP 1 LTRIM(RTRIM(paycode)) AS paycode, LTRIM(RTRIM(empname)) AS empname, LTRIM(RTRIM(presentcardno)) AS presentcardno, LTRIM(RTRIM(companycode)) AS companycode FROM dbo.tblemployee WHERE paycode = @paycode');
    if (!result.recordset[0]) return res.status(404).json({ success: false, message: 'Employee not found.' });
    // mustChangePassword is additive and read LIVE, so a session restored after
    // an HR forced change is still sent to the "set new password" screen.
    const mustChangePassword = await isPasswordChangeRequired(pool, req.user.paycode);
    res.json({ role: 'EMPLOYEE', employee: result.recordset[0], mustChangePassword });
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

app.get('/api/employee/daily', authenticate, requireRole('EMPLOYEE'), requirePasswordChanged, requireDbConfig, (req, res) => employeeAttendance(req, res));
app.get('/api/employee/weekly', authenticate, requireRole('EMPLOYEE'), requirePasswordChanged, requireDbConfig, (req, res) => employeeAttendance(req, res, parseWeekRange));
app.get('/api/employee/monthly', authenticate, requireRole('EMPLOYEE'), requirePasswordChanged, requireDbConfig, (req, res) => employeeAttendance(req, res));

app.get('/api/employee/dashboard', authenticate, requireRole('EMPLOYEE'), requirePasswordChanged, requireDbConfig, async (req, res) => {
  // Identity is ALWAYS req.user.paycode (from the verified JWT). A paycode in the
  // query is never read, so one employee can never load another employee's data.
  // With no explicit window the dashboard shows the CURRENT CALENDAR MONTH, which
  // is exactly the window HR Single Employee Audit uses for that month. Callers
  // that pass date/month/fromDate/toDate/days keep their own window unchanged
  // (the website still calls ?days=31 and is unaffected).
  const q = req.query || {};
  const monthParam = String(q.month || '').trim() || currentMonthKey();
  const range = (q.date || q.month || q.fromDate || q.toDate || q.days)
    ? parseDateRange(q, 31)
    : (monthRange(monthParam) || parseDateRange(q, 31));
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

    // Never report a date that has not happened yet: the India-local "today" is the
    // hard ceiling for every aggregate on this dashboard.
    const todayIso = indiaTodayISO();
    // A month that has not started yet has no reportable data; clamp cleanly
    // instead of producing an inverted window.
    const rangeIsUsable = range.fromDate <= todayIso;
    const effectiveRange = rangeIsUsable
      ? (range.toDate > todayIso ? { ...range, toDate: todayIso } : range)
      : { fromDate: todayIso, toDate: todayIso };
    const eligibleRows = (range.toDate !== effectiveRange.toDate || !rangeIsUsable)
      ? rows.filter((row) => rowDateIso(row.dateoffice) <= todayIso && rowDateIso(row.dateoffice) >= effectiveRange.fromDate)
      : rows.filter((row) => rowDateIso(row.dateoffice) <= todayIso);
    
    // Compute FINAL late count with monthly grace consumption (per calendar month)
    const rowsByMonth = new Map();
    for (const row of eligibleRows) {
      const d = row.dateoffice instanceof Date ? row.dateoffice : new Date(row.dateoffice);
      const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
      if (!rowsByMonth.has(key)) rowsByMonth.set(key, []);
      rowsByMonth.get(key).push(row);
    }
    
    let finalLateCount = 0;
    let lateDetails = [];
    let graceRemaining = null;
    for (const [monthKey, monthRows] of rowsByMonth) {
      const [year, month] = monthKey.split('-').map(Number);
      const monthlyResult = computeMonthlyLateForEmployee(monthRows, shiftMap, empInfo.cat, empInfo.companycode, req.user.paycode, year, month);
      finalLateCount += monthlyResult.finalLateCount;
      // Same computation the HR audit already exposes; surfaced here for the
      // employee's own dashboard instead of being recalculated anywhere.
      if (Array.isArray(monthlyResult.lateDetails)) lateDetails = lateDetails.concat(monthlyResult.lateDetails);
      if (monthlyResult.graceRemaining) graceRemaining = monthlyResult.graceRemaining;
    }
    
    // Calculate stats with grace-aware late computation.
    // Week Off is counted (not skipped) so the dashboard can chart the real
    // Present / Absent / Miss Punch / Week Off split of the same rows.
    const stats = eligibleRows.reduce((s, row) => {
      const label = classifyRow({ ...row, status: row.statusCode || row.status, statusCode: row.statusCode || row.status });
      if (label === 'Week Off') { s.weekOff += 1; return s; }
      if (label === 'Absent') s.absent += 1;
      else if (label === 'Miss Punch') s.miss += 1;
      else s.present += 1;
      const lateResult = computeLateStatus(row, shiftMap, empInfo.cat, empInfo.companycode, req.user.paycode);
      if (lateResult.isLate) s.late += 1;  // Raw late count
      s.hours += Number(row.hoursworked || 0);
      return s;
    }, { present: 0, absent: 0, miss: 0, late: 0, hours: 0, weekOff: 0 });
    
    // Override late with FINAL late count after monthly grace consumption
    stats.late = finalLateCount;
    
    // Trend window: the last 30 completed/recent India-local days, for the real
    // attendance and working-hours trend charts. Same helper, same classification.
    const trendRange = rollingDaysRange(30);
    const trendRows = await queryAttendance(pool, req.user.paycode, trendRange);
    const trend = trendRows
      .filter((row) => rowDateIso(row.dateoffice) <= todayIso)
      .map((row) => {
        const n = normalizeAttendance(row, shiftMap, empInfo.cat, empInfo.companycode);
        return {
          date: rowDateIso(row.dateoffice),
          status: n.computedStatus || n.statusLabel,
          inTime: n.inTime || null,
          outTime: n.outTime || null,
          hoursworked: Number(row.hoursworked || 0),
          isLate: Boolean(n.isLate),
          lateMinutes: Number(n.latearrival || 0),
        };
      })
      .sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));

    const total = stats.present + stats.absent + stats.miss;
    // Purely additive fields for the mobile employee dashboard. The identity is
    // ALWAYS req.user.paycode (taken from the verified JWT) - no paycode is read
    // from the request, so one employee can never load another employee's data.
    // `attendance` reuses the rows already fetched above through the same
    // normalizeAttendance() helper every other attendance endpoint uses, so the
    // numbers cannot diverge from HR Single Employee Audit.
    res.json({
      ...stats,
      attendancePercentage: total ? Number((stats.present / total * 100).toFixed(1)) : 0,
      records: eligibleRows.length,
      today: todayIso,
      // The window the aggregates above are actually computed over, so the UI can
      // label it truthfully instead of guessing.
      fromDate: effectiveRange.fromDate,
      toDate: effectiveRange.toDate,
      month: effectiveRange.fromDate.slice(0, 7),
      attendance: eligibleRows.map((r) => normalizeAttendance(r, shiftMap, empInfo.cat, empInfo.companycode)),
      trend,
      trendFrom: trendRange.fromDate,
      trendTo: trendRange.toDate,
      lateDetails,
      graceRemaining,
      // Cumulative grace position as of each late date (see buildGraceTimeline).
      graceTimeline: buildGraceTimeline(lateDetails, graceRemaining),
    });
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
      -- P/A/M/L follow the SAME per-row decision as classifyRow() (the classifier used by
      -- /hr/daily-master, /hr/audit, /hr/summary and /hr/category-analytics). Previously this
      -- block matched only the raw tbltimeregister.status text, so a day that is still in
      -- progress (IN punched, OUT pending, shift end not reached) was left out of Present and
      -- showed up as Present = 0 / Absent = all, until the machine overwrote status later.
      -- "ONGOING" below is that exact existing rule, reused verbatim:
      --   IN done, OUT pending, row is today, and the shift end time has not passed yet.
      -- P: real Present codes, a completed punch on a blank status, OR an ongoing shift.
      SELECT SUM(CASE WHEN LTRIM(RTRIM(tr.status)) IN ('P', 'HLF', 'SRT', 'POW', 'Present', 'Late')
          OR (NULLIF(LTRIM(RTRIM(tr.status)), '') IS NULL AND tr.in1 IS NOT NULL AND (tr.out1 IS NOT NULL OR tr.out2 IS NOT NULL))
          OR ((tr.in1 IS NOT NULL OR tr.in2 IS NOT NULL) AND tr.out1 IS NULL AND tr.out2 IS NULL
              AND tr.dateoffice = CAST(GETDATE() AS DATE)
              AND CAST(GETDATE() AS time) < COALESCE(CAST(tr.shiftendtime AS time), smx.endtime, '23:59:59'))
          THEN 1 ELSE 0 END) AS presentCount,
        -- A only means Absent when there is no punch at all; a punched row is Present or Miss Punch.
        SUM(CASE WHEN LTRIM(RTRIM(tr.status)) IN ('A', 'ABS', 'Absent')
          AND tr.in1 IS NULL AND tr.in2 IS NULL THEN 1 ELSE 0 END) AS absentCount,
        SUM(CASE WHEN (LTRIM(RTRIM(tr.status)) IN ('MIS', 'Miss Punch', 'A', 'ABS', 'Absent')
            OR NULLIF(LTRIM(RTRIM(tr.status)), '') IS NULL)
          AND (tr.in1 IS NOT NULL OR tr.in2 IS NOT NULL)
          AND tr.out1 IS NULL AND tr.out2 IS NULL
          AND NOT (tr.dateoffice = CAST(GETDATE() AS DATE)
              AND CAST(GETDATE() AS time) < COALESCE(CAST(tr.shiftendtime AS time), smx.endtime, '23:59:59'))
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
    const empCat = String(employee.cat || '').trim();
    const empCompany = String(employee.companycode || '').trim();

    // PHASE G.2 — application-level holiday overlay (display classification only).
    // Savior rows above are untouched; if this lookup fails we still return the
    // real Savior attendance with holidays: [] (never hide attendance).
    let holidays = [];
    try {
      const monthQ = String(req.query?.month || '').slice(0, 7);
      if (/^\d{4}-\d{2}$/.test(monthQ)) {
        holidays = await getApplicableHolidaysForEmployee(pool, empCompany, empCat, { month: monthQ });
      } else {
        holidays = await getApplicableHolidaysForEmployee(pool, empCompany, empCat, { fromDate: range.fromDate, toDate: range.toDate });
      }
    } catch { holidays = []; }
    
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
      // PHASE G.2 — ACTIVE holidays applicable to THIS employee (real company +
      // real category) for the requested window. Display overlay only: the
      // `attendance` Savior rows above are unchanged.
      holidays,
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
      const mp = await getPool();
      await ensureMarriageTable(mp);
      marriages = await mp.request().query(`SELECT id, paycode, presentcardno, anniversarydate, createddate, updateddate, importedby FROM ${marriageTable}`);
    } catch (e) {
      const msg = String(e?.message || e || '').toUpperCase();
      if (!msg.includes('INVALID OBJECT NAME') && !msg.includes('TABLE') && !msg.includes('NOT FOUND')) throw e;
    }
    res.json({ employees: employees.recordset, marriages: marriages.recordset });
  } catch (error) { sendDbError(res, error); }
});

// ---------------------------------------------------------------------------
// Employee celebrations (Birthday / Work Anniversary / Marriage Anniversary)
// Employee-scoped: the employee is ALWAYS req.user.paycode from the verified JWT.
// The logged-in employee is excluded SERVER-SIDE (paycode <> @self), so their own
// celebrations can never appear in the organisation list.
//
// Sources (all existing, read-only):
//   Birthday / Work Anniversary -> dbo.tblemployee.dateofbirth / .dateofjoin
//   Marriage Anniversary        -> dbo.HR_MarriageAnniversary (existing HR import)
//
// Privacy: only celebration-relevant fields are returned - name, department,
// designation and the event dates. No salary, password, PIN, attendance or any
// other HR field is included.
// ---------------------------------------------------------------------------
const ymdToDateUTC = (y, m, d) => new Date(Date.UTC(y, m - 1, d));
const dateToIsoUTC = (dt) => dt.toISOString().slice(0, 10);

/**
 * SQL date/datetime -> 'YYYY-MM-DD'.
 * mssql hands datetime back as a JS Date serialised at the stored wall-clock
 * value (the same convention normalizeAttendance uses), so the UTC date part IS
 * the company-local calendar day. Taking toISOString() keeps the day intact and
 * never shifts it.
 */
const sqlDateToIso = (v) => {
  if (v == null) return '';
  if (v instanceof Date) return Number.isNaN(v.getTime()) ? '' : v.toISOString().slice(0, 10);
  return String(v).slice(0, 10);
};

/**
 * Next occurrence (on or after today) of a MONTH+DAY taken from `srcIso`.
 * Returns { iso, years } where `years` is the completed years for that
 * occurrence - so a work/ marriage anniversary is only counted once its actual
 * anniversary date has actually arrived (never a naive year subtraction).
 * Missing days (e.g. 31st in a 30-day month) roll forward to the next month that
 * has the day.
 */
function nextMonthDayOccurrence(todayIso, srcIso) {
  const sm = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(srcIso || '').slice(0, 10));
  const tm = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(todayIso || '').slice(0, 10));
  if (!sm || !tm) return null;
  const srcY = Number(sm[1]); const srcM = Number(sm[2]); const srcD = Number(sm[3]);
  const ty = Number(tm[1]); const tmo = Number(tm[2]); const td = Number(tm[3]);
  if (srcM < 1 || srcM > 12 || srcD < 1 || srcD > 31) return null;
  const todayMs = ymdToDateUTC(ty, tmo, td).getTime();
  const daysInMonth = (y, mo) => ymdToDateUTC(y, mo, 1).getUTCMonth() === mo - 1 ? new Date(Date.UTC(y, mo, 0)).getUTCDate() : 0;

  // Only the SOURCE month is ever considered (this year, then next year), so a
  // birthday on 01-Jul is never reported as 01-Oct. If the day does not exist in
  // that month (e.g. the 31st, or 29-Feb in a common year) it rolls to the 1st of
  // the following month.
  for (let k = 0; k <= 1; k += 1) {
    let y = ty + k;
    let mo = srcM;
    let d = srcD;
    const dim = daysInMonth(y, mo);
    if (dim && d > dim) {
      mo += 1; d = 1;
      if (mo > 12) { mo = 1; y += 1; }
    }
    const occ = ymdToDateUTC(y, mo, d);
    if (occ.getTime() >= todayMs) {
      return { iso: dateToIsoUTC(occ), years: y - srcY, y, m: mo };
    }
  }
  return null;
}

function bucketCelebration(occurrence, todayIso, weekEndIso) {
  const days = Math.round(
    (ymdToDateUTC(occurrence.y, occurrence.m, Number(occurrence.iso.slice(8, 10))).getTime()
      - ymdToDateUTC(Number(todayIso.slice(0, 4)), Number(todayIso.slice(5, 7)), Number(todayIso.slice(8, 10))).getTime())
    / 86400000,
  );
  if (days <= 0) return { bucket: 'today', days: 0 };
  if (occurrence.iso <= weekEndIso) return { bucket: 'thisWeek', days };
  if (occurrence.iso.slice(0, 7) === todayIso.slice(0, 7)) return { bucket: 'thisMonth', days };
  return { bucket: 'upcoming', days };
}

app.get('/api/employee/celebrations', authenticate, requireRole('EMPLOYEE'), requirePasswordChanged, requireDbConfig, async (req, res) => {
  try {
    const pool = await getPool();
    const todayIso = indiaTodayISO();
    const weekEndIso = indiaWeekRange().toDate;      // Sunday of the current India week

    // Organisation celebrations, the logged-in employee excluded in SQL.
    const employees = await pool.request()
      .input('self', sql.VarChar(50), req.user.paycode)
      .query(`
        SELECT LTRIM(RTRIM(e.empname)) AS empname,
               LTRIM(RTRIM(e.departmentcode)) AS departmentcode,
               LTRIM(RTRIM(d.departmentname)) AS departmentname,
               LTRIM(RTRIM(e.designation)) AS designation,
               e.dateofbirth, e.dateofjoin
        FROM dbo.tblemployee e
        LEFT JOIN dbo.tbldepartment d ON LTRIM(RTRIM(d.departmentcode)) = LTRIM(RTRIM(e.departmentcode))
        WHERE LTRIM(RTRIM(e.active)) = 'Y'
          AND e.paycode <> @self
          AND (e.dateofbirth IS NOT NULL OR e.dateofjoin IS NOT NULL)`);

    const emptyGroups = () => ({ today: [], thisWeek: [], thisMonth: [], upcoming: [] });
    const birthdays = emptyGroups();
    const workAnniversaries = emptyGroups();
    const marriageAnniversaries = emptyGroups();
    let marriageAvailable = false;

    const push = (group, item) => {
      if (item.bucket === 'today') group.today.push(item);
      else if (item.bucket === 'thisWeek') group.thisWeek.push(item);
      else if (item.bucket === 'thisMonth') group.thisMonth.push(item);
      else group.upcoming.push(item);
    };

    for (const e of employees.recordset || []) {
      const base = {
        name: e.empname,
        department: e.departmentname || e.departmentcode || '',
        designation: e.designation || '',
      };
      if (e.dateofbirth) {
        const occ = nextMonthDayOccurrence(todayIso, sqlDateToIso(e.dateofbirth));
        if (occ) {
          const b = bucketCelebration(occ, todayIso, weekEndIso);
          push(birthdays, { ...base, date: occ.iso, age: occ.years, daysUntil: b.days, bucket: b.bucket });
        }
      }
      if (e.dateofjoin) {
        const occ = nextMonthDayOccurrence(todayIso, sqlDateToIso(e.dateofjoin));
        if (occ) {
          const b = bucketCelebration(occ, todayIso, weekEndIso);
          push(workAnniversaries, {
            ...base,
            date: occ.iso,
            years: occ.years,
            joinedOn: sqlDateToIso(e.dateofjoin),
            daysUntil: b.days,
            bucket: b.bucket,
          });
        }
      }
    }

    // Marriage anniversaries: the EXISTING HR-imported dataset only. Never invented.
    try {
      await ensureMarriageTable(pool);
      const mar = await pool.request()
        .input('self', sql.VarChar(50), req.user.paycode)
        .query(`
          SELECT LTRIM(RTRIM(e.empname)) AS empname,
                 LTRIM(RTRIM(e.departmentcode)) AS departmentcode,
                 LTRIM(RTRIM(d.departmentname)) AS departmentname,
                 LTRIM(RTRIM(e.designation)) AS designation,
                 m.anniversarydate
          FROM ${marriageTable} m
          JOIN dbo.tblemployee e ON e.paycode = m.paycode
          LEFT JOIN dbo.tbldepartment d ON LTRIM(RTRIM(d.departmentcode)) = LTRIM(RTRIM(e.departmentcode))
          WHERE e.paycode <> @self`);
      const rowsM = mar.recordset || [];
      marriageAvailable = rowsM.length > 0;
      for (const m of rowsM) {
        const occ = nextMonthDayOccurrence(todayIso, sqlDateToIso(m.anniversarydate));
        if (!occ) continue;
        const b = bucketCelebration(occ, todayIso, weekEndIso);
        push(marriageAnniversaries, {
          name: m.empname,
          department: m.departmentname || m.departmentcode || '',
          designation: m.designation || '',
          date: occ.iso,
          years: occ.years,
          daysUntil: b.days,
          bucket: b.bucket,
        });
      }
    } catch (e) {
      const msg = String(e?.message || e || '').toUpperCase();
      if (!msg.includes('INVALID OBJECT NAME') && !msg.includes('TABLE') && !msg.includes('NOT FOUND')) throw e;
      marriageAvailable = false;
    }

    const sortItems = (g) => {
      ['today', 'thisWeek', 'thisMonth', 'upcoming'].forEach((k) => {
        g[k].sort((a, b) => a.daysUntil - b.daysUntil || a.name.localeCompare(b.name));
      });
    };
    sortItems(birthdays); sortItems(workAnniversaries); sortItems(marriageAnniversaries);

    res.json({
      today: todayIso,
      weekEnd: weekEndIso,
      birthdays,
      workAnniversaries,
      marriageAnniversaries,
      marriageAvailable,
    });
  } catch (error) { sendDbError(res, error); }
});

// ---------------------------------------------------------------------------
// Employee Full & Final / Gratuity ESTIMATION (self-service)
// Employee-scoped: identity is ALWAYS req.user.paycode from the verified JWT.
//
// SALARY: this application has NO approved salary source. dbo.tblemployee
// carries no salary/basic/wage/CTC column and no salary API exists, so the
// endpoint deliberately reports salary as unavailable instead of inventing a
// figure. No settlement amount is produced here.
//
// RULES: the company's gratuity / bonus / leave-encashment / notice formulas are
// NOT finalised, so no amount is calculated server-side. Only real inputs
// (identity + joining date) are returned; the UI shows a pending state until the
// approved rules are supplied.
//
// This endpoint never writes anything - the proposed leaving date stays in the
// browser and is never stored in dbo.tblemployee.
// ---------------------------------------------------------------------------
app.get('/api/employee/fullfinal', authenticate, requireRole('EMPLOYEE'), requirePasswordChanged, requireDbConfig, async (req, res) => {
  try {
    const pool = await getPool();
    const result = await pool.request().input('paycode', sql.VarChar(50), req.user.paycode).query(`
      SELECT LTRIM(RTRIM(e.paycode)) AS paycode,
             LTRIM(RTRIM(e.empname)) AS empname,
             LTRIM(RTRIM(e.designation)) AS designation,
             LTRIM(RTRIM(e.departmentcode)) AS departmentcode,
             LTRIM(RTRIM(d.departmentname)) AS departmentname,
             LTRIM(RTRIM(e.companycode)) AS companycode,
             e.dateofjoin, e.dateofbirth,
             LTRIM(RTRIM(e.active)) AS active,
             LTRIM(RTRIM(e.leavingdate)) AS leavingdate
      FROM dbo.tblemployee e
      LEFT JOIN dbo.tbldepartment d ON LTRIM(RTRIM(d.departmentcode)) = LTRIM(RTRIM(e.departmentcode))
      WHERE e.paycode = @paycode`);
    const e = (result.recordset || [])[0];
    if (!e) return res.status(404).json({ success: false, message: 'Employee not found.' });

    const dateOnly = (v) => (v instanceof Date ? v.toISOString().slice(0, 10) : (v ? String(v).slice(0, 10) : ''));
    res.json({
      success: true,
      employee: {
        paycode: e.paycode,
        empname: e.empname,
        designation: e.designation,
        departmentcode: e.departmentcode,
        departmentname: e.departmentname || e.departmentcode,
        companycode: e.companycode,
        dateofjoin: dateOnly(e.dateofjoin),
        dateofbirth: dateOnly(e.dateofbirth),
        active: e.active,
        leavingdate: dateOnly(e.leavingdate),
      },
      // No approved salary source exists in this application - stated explicitly
      // so the UI can show a truthful "not available" state instead of a number.
      salary: { available: false, basic: null, reason: 'Salary information is not currently available for calculation.' },
      // Company settlement formulas are not configured yet, so nothing is computed.
      rulesConfigured: false,
      rulesPendingMessage: 'Calculation rules pending company configuration.',
    });
  } catch (error) { sendDbError(res, error); }
});

// ---------------------------------------------------------------------------
// Marriage anniversary application table (NOT a Savior table).
// dbo.HR_MarriageAnniversary holds HR-imported anniversary dates; its reference
// DDL lives in server/schema.sql + server/email-schema.sql. It is created on first
// use with the project's existing "HR_ table auto-ensure" pattern (same approach
// as HR_EmployeeAuth / HR_EmailConfig / HR_EmployeeEmails / HR_EmailLog).
// dbo.tblemployee, dbo.tbltimeregister, dbo.machinerawpunch and every other
// Savior table are NEVER created or altered here.
// ---------------------------------------------------------------------------
let marriageTableState = null; // null = unknown, true = ready, string = error message
async function ensureMarriageTable(pool) {
  if (marriageTableState === true) return;
  if (typeof marriageTableState === 'string') throw new Error(marriageTableState);
  try {
    await pool.request().batch(`
IF OBJECT_ID('${marriageTable}','U') IS NULL
CREATE TABLE ${marriageTable} (
  id INT IDENTITY(1,1) PRIMARY KEY,
  paycode VARCHAR(50) NOT NULL,
  presentcardno VARCHAR(50) NULL,
  anniversarydate DATE NOT NULL,
  createddate DATETIME2 NOT NULL CONSTRAINT DF_HRMarriage_Created DEFAULT SYSUTCDATETIME(),
  updateddate DATETIME2 NOT NULL CONSTRAINT DF_HRMarriage_Updated DEFAULT SYSUTCDATETIME(),
  importedby VARCHAR(50) NULL,
  CONSTRAINT UQ_HRMarriage_Paycode UNIQUE (paycode)
);`);
    marriageTableState = true;
  } catch (error) {
    const msg = String(error?.message || error || '');
    if (msg.includes('UQ_HRMarriage_Paycode') && msg.toUpperCase().includes('EXISTS')) {
      marriageTableState = true; // table already present with the unique constraint
      return;
    }
    marriageTableState = `Marriage anniversary table unavailable: ${msg}`;
    throw new Error(marriageTableState);
  }
}

app.get('/api/marriage-anniversary', requireDbConfig, authenticate, requireRole('HR', 'EMPLOYEE'), async (req, res) => {
  try {
    const pool = await getPool();
    await ensureMarriageTable(pool);
    const request = pool.request().input('paycode', sql.VarChar(50), req.user.role === 'EMPLOYEE' ? req.user.paycode : null);
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

// Remove ONE marriage-anniversary application record by employee paycode.
// Additive endpoint (mobile Phase 6) — the website performed this removal only in
// the browser, so it never persisted. Only dbo.HR_MarriageAnniversary is touched;
// no Savior table (tblemployee / tbltimeregister / machinerawpunch) is modified and
// the employee record itself is never deleted.
app.delete('/api/marriage-anniversary/:paycode', authenticate, requireRole('HR'), requireDbConfig, async (req, res) => {
  const paycode = String(req.params.paycode || '').trim();
  if (!paycode) return res.status(400).json({ success: false, message: 'paycode is required.' });
  try {
    const pool = await getPool();
    await ensureMarriageTable(pool);
    const result = await pool.request()
      .input('paycode', sql.VarChar(50), paycode)
      .query(`DELETE FROM ${marriageTable} WHERE paycode = @paycode`);
    res.json({ success: true, deleted: Number(result.rowsAffected?.[0] || 0) });
  } catch (error) { sendDbError(res, error); }
});

// ---------------------------------------------------------------------------
// Holiday Management application tables (NOT Savior tables).
//
// dbo.HR_Holidays          - the holiday records themselves
// dbo.HR_HolidayCategories - the category list, so HR can add more groups later
// dbo.HR_HolidayCategoryMap- which REAL Savior category code belongs to which
//                            holiday group (no code -> name mapping is invented)
//
// Auto-ensured with the project's existing "HR_ table" pattern (same approach as
// HR_EmployeeAuth / HR_EmailConfig / HR_MarriageAnniversary). Reference DDL lives
// in server/schema.sql. dbo.tblemployee, dbo.tbltimeregister, dbo.machinerawpunch,
// dbo.tblcategory and every other Savior table are NEVER created or altered here.
// ---------------------------------------------------------------------------
const holidayTable = process.env.HR_HOLIDAY_TABLE || 'dbo.HR_Holidays';
const holidayCategoryTable = process.env.HR_HOLIDAY_CATEGORY_TABLE || 'dbo.HR_HolidayCategories';
const holidayCategoryMapTable = process.env.HR_HOLIDAY_CATEGORY_MAP_TABLE || 'dbo.HR_HolidayCategoryMap';
// The category that applies to EVERY employee group. Seeded once; a holiday in
// this group is always shown to every employee.
const HOLIDAY_ALL_GROUP = 'All Employees';
let holidayTableState = null; // null = unknown, true = ready, string = error message
let holidayMigrateState = null; // null = not migrated yet (or retryable failure), true = done

async function ensureHolidayTable(pool) {
  if (holidayTableState === true) return;
  if (typeof holidayTableState === 'string') throw new Error(holidayTableState);
  try {
    await pool.request().batch(`
IF OBJECT_ID('${holidayTable}','U') IS NULL
CREATE TABLE ${holidayTable} (
  id INT IDENTITY(1,1) PRIMARY KEY,
  holidaydate DATE NOT NULL,
  holidayname NVARCHAR(200) NOT NULL,
  category NVARCHAR(50) NOT NULL,
  description NVARCHAR(500) NULL,
  companycode VARCHAR(50) NULL,
  active BIT NOT NULL CONSTRAINT DF_HRHoliday_Active DEFAULT(1),
  createddate DATETIME2 NOT NULL CONSTRAINT DF_HRHoliday_Created DEFAULT SYSUTCDATETIME(),
  updateddate DATETIME2 NOT NULL CONSTRAINT DF_HRHoliday_Updated DEFAULT SYSUTCDATETIME(),
  createdby VARCHAR(50) NULL,
  -- Duplicate rule: the SAME date may repeat, but only for a DIFFERENT category.
  CONSTRAINT UQ_HRHoliday_DateCategory UNIQUE (holidaydate, category)
);
IF OBJECT_ID('${holidayCategoryTable}','U') IS NULL
CREATE TABLE ${holidayCategoryTable} (
  id INT IDENTITY(1,1) PRIMARY KEY,
  categoryname NVARCHAR(50) NOT NULL,
  sortorder INT NOT NULL CONSTRAINT DF_HRHolidayCat_Sort DEFAULT(0),
  active BIT NOT NULL CONSTRAINT DF_HRHolidayCat_Active DEFAULT(1),
  createddate DATETIME2 NOT NULL CONSTRAINT DF_HRHolidayCat_Created DEFAULT SYSUTCDATETIME(),
  CONSTRAINT UQ_HRHolidayCat_Name UNIQUE (categoryname)
);
IF OBJECT_ID('${holidayCategoryMapTable}','U') IS NULL
CREATE TABLE ${holidayCategoryMapTable} (
  id INT IDENTITY(1,1) PRIMARY KEY,
  categorycode VARCHAR(50) NOT NULL,
  holidaycategory NVARCHAR(50) NOT NULL,
  active BIT NOT NULL CONSTRAINT DF_HRHolidayCatMap_Active DEFAULT(1),
  updateddate DATETIME2 NOT NULL CONSTRAINT DF_HRHolidayCatMap_Updated DEFAULT SYSUTCDATETIME(),
  CONSTRAINT UQ_HRHolidayCatMap_Code UNIQUE (categorycode)
);
-- The three groups the Phase G scope requires. Additional groups are added by HR
-- through the same table later, so no code change is needed to extend this.
IF NOT EXISTS (SELECT 1 FROM ${holidayCategoryTable})
INSERT INTO ${holidayCategoryTable} (categoryname, sortorder, active) VALUES
  ('${HOLIDAY_ALL_GROUP}', 1, 1),
  ('Factory Staff', 2, 1),
  ('Office Staff', 3, 1);`);
    holidayTableState = true;
  } catch (error) {
    const msg = String(error?.message || error || '');
    if (msg.includes('UQ_HRHoliday_DateCategory') && msg.toUpperCase().includes('EXISTS')) {
      holidayTableState = true; // table already present with the unique constraint
      return;
    }
    holidayTableState = `Holiday table unavailable: ${msg}`;
    throw new Error(holidayTableState);
  }
}

/**
 * Seed the category-code -> holiday-group mapping from REAL Savior data.
 *
 * dbo.tblemployee stores a category CODE (this dataset uses "001".."004") and the
 * human name lives in dbo.tblcategory. Only the ONE mapping this project can
 * already prove is seeded: a category that resolves to STAFF through the existing
 * isStaffCategory() rule (the same rule that drives monthly grace) is a FACTORY
 * group. Every other real category is deliberately LEFT UNMAPPED rather than
 * guessed - an unmapped employee simply receives no group-specific holiday (only
 * the "All Employees" group). This table exists purely to keep LEGACY holiday
 * rows resolvable; new holidays store REAL company+category pairs directly and
 * the manual "Group Mapping" management screen/endpoints were removed in the
 * Phase G final revision.
 *
 * Only MISSING rows are added, so an HR override is never overwritten.
 */
async function ensureHolidayCategoryMap(pool) {
  await ensureHolidayTable(pool);
  const seeds = await pool.request().query(
    `SELECT TOP 1 categoryname FROM ${holidayCategoryTable} WHERE LTRIM(RTRIM(categoryname)) = 'Factory Staff'`);
  if (!seeds.recordset[0]) return; // an HR-managed category list replaced the seeds
  const empCats = await pool.request().query(
    `SELECT DISTINCT LTRIM(RTRIM(cat)) AS cat FROM dbo.tblemployee WHERE LTRIM(RTRIM(cat)) <> ''`);
  const categoryMap = await loadCategoryNames(pool);
  for (const row of empCats.recordset || []) {
    const code = String(row.cat || '').trim();
    // Only STAFF-resolving categories are pre-assigned; nothing is invented.
    if (!code || !isStaffCategory(code, categoryMap)) continue;
    await pool.request()
      .input('code', sql.VarChar(50), code)
      .input('group', sql.NVarChar(50), 'Factory Staff')
      .query(`INSERT INTO ${holidayCategoryMapTable} (categorycode, holidaycategory, active)
              SELECT @code, @group, 1
              WHERE NOT EXISTS (SELECT 1 FROM ${holidayCategoryMapTable} WHERE LTRIM(RTRIM(categorycode)) = LTRIM(RTRIM(@code)));`);
  }
}

const holidayCompaniesTable = process.env.HR_HOLIDAY_COMPANIES_TABLE || 'dbo.HR_HolidayCompanies';
const holidayCategoryEntriesTable = process.env.HR_HOLIDAY_CATEGORY_ENTRIES_TABLE || 'dbo.HR_HolidayCategoryEntries';
const holidayCompanyCategoryTable = process.env.HR_HOLIDAY_COMPANY_CATEGORY_TABLE || 'dbo.HR_HolidayCompanyCategory';

async function ensureHolidayCompaniesTable(pool) {
  await pool.request().batch(`
IF OBJECT_ID('${holidayCompaniesTable}','U') IS NULL
CREATE TABLE ${holidayCompaniesTable} (
  id INT IDENTITY(1,1) PRIMARY KEY,
  holiday_id INT NOT NULL,
  companycode VARCHAR(50) NOT NULL
);`);
}

async function ensureHolidayCategoryEntriesTable(pool) {
  await pool.request().batch(`
IF OBJECT_ID('${holidayCategoryEntriesTable}','U') IS NULL
CREATE TABLE ${holidayCategoryEntriesTable} (
  id INT IDENTITY(1,1) PRIMARY KEY,
  holiday_id INT NOT NULL,
  categorycode VARCHAR(50) NOT NULL
);`);
}

async function ensureHolidayCompanyCategoryTable(pool) {
  await pool.request().batch(`
IF OBJECT_ID('${holidayCompanyCategoryTable}','U') IS NULL
CREATE TABLE ${holidayCompanyCategoryTable} (
  id INT IDENTITY(1,1) PRIMARY KEY,
  holiday_id INT NOT NULL,
  companycode VARCHAR(50) NOT NULL,
  categorycode VARCHAR(50) NOT NULL
);`);
}

/**
 * One-time structural migration + legacy backfill for the Holiday tables.
 *
 * ROOT-CAUSE FIX (Phase G final): the old backfill iterated `pairRows.pairs`
 * while getCompanyCategoryPairsForCompanies() returns a plain ARRAY, so every
 * call threw `TypeError: pairRows.pairs is not iterable`. Because POST/PUT/
 * DELETE /api/hr/holidays, /api/hr/holiday-categories and /api/employee/holidays
 * all call this function, that one bug emptied the Category list, broke Delete,
 * broke Edit and made the employee calendar neutral (sendDbError turned the
 * TypeError into a generic 503).
 *
 * Backfill is now PER HOLIDAY and idempotent: a holiday is only backfilled while
 * it still has ZERO applicability rows in any of the three child tables, so
 * existing records (Independence Day, VishKarma Puja, ...) are preserved exactly
 * once and never duplicated. Application schema only - Savior tables are only
 * ever read here, never altered.
 */
async function migrateHolidayStructure(pool) {
  if (holidayMigrateState === true) return;
  try {
    await ensureHolidayTable(pool);
    await ensureHolidayCompaniesTable(pool);
    await ensureHolidayCategoryEntriesTable(pool);
    await ensureHolidayCompanyCategoryTable(pool);

    const cols = await pool.request().query(`
      SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS
      WHERE TABLE_NAME = 'HR_Holidays' AND TABLE_SCHEMA = 'dbo'
        AND COLUMN_NAME IN ('isHalfDay','halfdaypart')`);

    const existing = new Set((cols.recordset || []).map(r => r.COLUMN_NAME));
    if (!existing.has('isHalfDay')) {
      await pool.request().query(`ALTER TABLE ${holidayTable} ADD isHalfDay BIT NOT NULL CONSTRAINT DF_HRHoliday_Half DEFAULT(0)`);
    }
    if (!existing.has('halfdaypart')) {
      await pool.request().query(`ALTER TABLE ${holidayTable} ADD halfdaypart NVARCHAR(10) NULL`);
    }

    // The legacy group -> real category-code mapping must exist before backfill,
    // otherwise a "Factory Staff" holiday could never resolve its employees.
    await ensureHolidayCategoryMap(pool);

    const holidays = await pool.request().query(`SELECT id, companycode, category FROM ${holidayTable}`);
    for (const h of holidays.recordset || []) {
      const hid = h.id;
      // Already has applicability rows (written by POST/PUT or a previous
      // backfill) -> never touch it again.
      const seen = await pool.request().input('hid', sql.Int, hid).query(
        `SELECT CASE WHEN EXISTS (SELECT 1 FROM ${holidayCompaniesTable} WHERE holiday_id = @hid)
                    OR EXISTS (SELECT 1 FROM ${holidayCategoryEntriesTable} WHERE holiday_id = @hid)
                    OR EXISTS (SELECT 1 FROM ${holidayCompanyCategoryTable} WHERE holiday_id = @hid)
               THEN 1 ELSE 0 END AS hasRows`);
      if (Number(seen.recordset?.[0]?.hasRows || 0) === 1) continue;

      const cc = String(h.companycode || '').trim();
      const cat = String(h.category || '').trim();

      if (cc) {
        await pool.request().input('hid', sql.Int, hid).input('code', sql.VarChar(50), cc)
          .query(`INSERT INTO ${holidayCompaniesTable} (holiday_id, companycode) VALUES (@hid, @code)`);
      }

      // Real employee category codes this legacy group label applies to.
      const entryCodes = [];
      if (cat === HOLIDAY_ALL_GROUP) {
        const allCats = await pool.request().query(
          `SELECT DISTINCT LTRIM(RTRIM(cat)) AS cat FROM dbo.tblemployee WHERE LTRIM(RTRIM(cat)) <> ''`);
        for (const r of allCats.recordset || []) entryCodes.push(String(r.cat || '').trim());
      } else if (cat) {
        const mapped = await pool.request().input('group', sql.NVarChar(50), cat).query(
          `SELECT DISTINCT LTRIM(RTRIM(categorycode)) AS categorycode FROM ${holidayCategoryMapTable}
            WHERE LTRIM(RTRIM(holidaycategory)) = @group AND active = 1`);
        for (const r of mapped.recordset || []) entryCodes.push(String(r.categorycode || '').trim());
      }
      const seenCode = new Set();
      for (const code of entryCodes) {
        if (!code || seenCode.has(code)) continue;
        seenCode.add(code);
        await pool.request().input('hid', sql.Int, hid).input('code', sql.VarChar(50), code)
          .query(`INSERT INTO ${holidayCategoryEntriesTable} (holiday_id, categorycode) VALUES (@hid, @code)`);
      }

      // Pairs: ONLY real (company, category) combinations from dbo.tblemployee
      // that the legacy group label allows. Nothing is invented.
      if (cc && seenCode.size > 0) {
        const realPairs = await getCompanyCategoryPairsForCompanies(pool, [cc]);
        for (const p of realPairs) {
          if (!seenCode.has(p.categorycode)) continue;
          await pool.request()
            .input('hid', sql.Int, hid)
            .input('code', sql.VarChar(50), p.companycode)
            .input('cat', sql.VarChar(50), p.categorycode)
            .query(`INSERT INTO ${holidayCompanyCategoryTable} (holiday_id, companycode, categorycode) VALUES (@hid, @code, @cat)`);
        }
      }
    }
    holidayMigrateState = true;
  } catch (error) {
    holidayMigrateState = null; // transient failure -> allow a clean retry next call
    throw error;
  }
}

/**
 * Real category master for display: code -> category name.
 * The name is resolved with the SAME cached helper the attendance code already
 * uses (loadCategoryNames), so no dbo.tblcategory column name is ever assumed.
 */
async function readCategoryMaster(pool) {
  const categoryMap = await loadCategoryNames(pool);
  return categoryMap || new Map();
}

// ---- Holiday Company + Category helpers ----

async function readHolidayCompanies(pool, holidayId) {
  const r = await pool.request().input('hid', sql.Int, holidayId).query(
    `SELECT LTRIM(RTRIM(companycode)) AS companycode FROM ${holidayCompaniesTable} WHERE holiday_id = @hid ORDER BY id`);
  return (r.recordset || []).map(x => String(x.companycode || '').trim()).filter(Boolean);
}

async function readHolidayCategoryEntries(pool, holidayId) {
  const r = await pool.request().input('hid', sql.Int, holidayId).query(
    `SELECT LTRIM(RTRIM(categorycode)) AS categorycode FROM ${holidayCategoryEntriesTable} WHERE holiday_id = @hid ORDER BY id`);
  return (r.recordset || []).map(x => String(x.categorycode || '').trim()).filter(Boolean);
}

async function readHolidayCompanyCategoryPairs(pool, holidayId) {
  const r = await pool.request().input('hid', sql.Int, holidayId).query(
    `SELECT LTRIM(RTRIM(companycode)) AS companycode, LTRIM(RTRIM(categorycode)) AS categorycode
     FROM ${holidayCompanyCategoryTable} WHERE holiday_id = @hid ORDER BY companycode, categorycode`);
  return (r.recordset || []).map(x => ({
    companycode: String(x.companycode || '').trim(),
    categorycode: String(x.categorycode || '').trim(),
  })).filter(x => x.companycode && x.categorycode);
}

/**
 * PHASE G.2 shared predicate — THE single holiday-applicability rule.
 *
 * Identity is ALWAYS real company + real category (never category alone):
 *   pairs (real company+category rows)  -> exact pair match
 *   legacy "All Employees" group        -> every employee
 *   companies x categories              -> both sides must match
 *   companies only / categories only    -> that side must match
 *   legacy group label only             -> resolve via HR_HolidayCategoryMap
 *
 * Pure (no DB): callers load companies/catEntries/pairs with the readers above,
 * then call this. Used by /api/employee/holidays AND /api/hr/audit/:paycode so
 * both screens can never disagree about who a holiday applies to.
 */
function doesHolidayApplyToEmployee(h, companies, catEntries, pairs, empCompany, empCat) {
  const list = Array.isArray(companies) ? companies : [];
  const cats = Array.isArray(catEntries) ? catEntries : [];
  const prs = Array.isArray(pairs) ? pairs : [];
  if (prs.length > 0) {
    return prs.some(p => p.companycode === empCompany && p.categorycode === empCat);
  }
  if (String(h?.category || '').trim() === HOLIDAY_ALL_GROUP) return true;
  if (list.length > 0 && cats.length > 0) {
    return list.some(c => c === empCompany) && cats.some(c => c === empCat);
  }
  if (list.length > 0) return list.some(c => c === empCompany);
  if (cats.length > 0) return cats.some(c => c === empCat);
  return false; // legacy group-only rows resolve via map in the caller
}

/**
 * PHASE G.2 shared loader — ACTIVE holidays applicable to ONE employee in a
 * window. Savior tables are only READ (tblemployee for identity); the holiday
 * application tables are only READ. Never writes, never alters Savior data.
 * A failure here must never hide Savior attendance — callers catch and fall
 * back to holidays: [].
 */
async function getApplicableHolidaysForEmployee(pool, empCompany, empCat, { month = null, fromDate = null, toDate = null } = {}) {
  const company = String(empCompany || '').trim();
  const cat = String(empCat || '').trim();
  const conditions = ['h.active = 1'];
  const inputs = [];
  if (month && /^\d{4}-\d{2}$/.test(month)) {
    const [y, m] = month.split('-').map(Number);
    conditions.push('h.holidaydate >= @monthStart AND h.holidaydate <= @monthEnd');
    inputs.push(['monthStart', sql.Date, `${month}-01`]);
    inputs.push(['monthEnd', sql.Date, isoDate(new Date(Date.UTC(y, m, 0)))]);
  } else if (fromDate && toDate) {
    conditions.push('h.holidaydate >= @fromDate AND h.holidaydate <= @toDate');
    inputs.push(['fromDate', sql.Date, fromDate]);
    inputs.push(['toDate', sql.Date, toDate]);
  }
  await migrateHolidayStructure(pool);
  const request = pool.request();
  inputs.forEach(([name, type, value]) => request.input(name, type, value));
  const raw = await request.query(`
      SELECT h.id, h.holidaydate, h.holidayname, h.category, h.description, h.companycode, h.active, h.isHalfDay, h.halfdaypart
      FROM ${holidayTable} h
      WHERE ${conditions.join(' AND ')}
      ORDER BY h.holidaydate, h.category`);
  const holidays = [];
  for (const h of raw.recordset || []) {
    const hid = h.id;
    const companies = await readHolidayCompanies(pool, hid);
    const catEntries = await readHolidayCategoryEntries(pool, hid);
    const pairs = await readHolidayCompanyCategoryPairs(pool, hid);
    let match = doesHolidayApplyToEmployee(h, companies, catEntries, pairs, company, cat);
    if (!match && companies.length === 0 && catEntries.length === 0 && pairs.length === 0) {
      await ensureHolidayCategoryMap(pool);
      const mapped = await pool.request().input('code', sql.VarChar(50), cat).query(
        `SELECT TOP 1 holidaycategory FROM ${holidayCategoryMapTable} WHERE LTRIM(RTRIM(categorycode)) = @code AND active = 1`);
      match = String(mapped.recordset?.[0]?.holidaycategory || '').trim() === String(h.category || '').trim();
    }
    if (!match) continue;
    holidays.push({
      ...h,
      // Plain 'YYYY-MM-DD' — calendar keys are exact date strings, never drift.
      holidaydate: rowDateIso(h.holidaydate),
      active: Boolean(h.active),
      isHalfDay: Boolean(h.isHalfDay),
      companies,
      categories: catEntries,
      companyCategoryPairs: pairs,
    });
  }
  return holidays;
}

async function writeHolidayCompanies(pool, holidayId, companies) {
  const list = (Array.isArray(companies) ? companies : []).map(c => String(c || '').trim()).filter(Boolean);
  await pool.request().input('hid', sql.Int, holidayId).query(`DELETE FROM ${holidayCompaniesTable} WHERE holiday_id = @hid`);
  for (const code of list) {
    await pool.request()
      .input('hid', sql.Int, holidayId)
      .input('code', sql.VarChar(50), code)
      .query(`INSERT INTO ${holidayCompaniesTable} (holiday_id, companycode) VALUES (@hid, @code)`);
  }
}

async function writeHolidayCategoryEntries(pool, holidayId, categories) {
  const list = (Array.isArray(categories) ? categories : []).map(c => String(c || '').trim()).filter(Boolean);
  await pool.request().input('hid', sql.Int, holidayId).query(`DELETE FROM ${holidayCategoryEntriesTable} WHERE holiday_id = @hid`);
  for (const code of list) {
    await pool.request()
      .input('hid', sql.Int, holidayId)
      .input('code', sql.VarChar(50), code)
      .query(`INSERT INTO ${holidayCategoryEntriesTable} (holiday_id, categorycode) VALUES (@hid, @code)`);
  }
}

async function writeHolidayCompanyCategoryPairs(pool, holidayId, pairs) {
  const list = (Array.isArray(pairs) ? pairs : [])
    .map(p => ({ companycode: String(p?.companycode || '').trim(), categorycode: String(p?.categorycode || '').trim() }))
    .filter(p => p.companycode && p.categorycode);
  await pool.request().input('hid', sql.Int, holidayId).query(`DELETE FROM ${holidayCompanyCategoryTable} WHERE holiday_id = @hid`);
  for (const p of list) {
    await pool.request()
      .input('hid', sql.Int, holidayId)
      .input('code', sql.VarChar(50), p.companycode)
      .input('cat', sql.VarChar(50), p.categorycode)
      .query(`INSERT INTO ${holidayCompanyCategoryTable} (holiday_id, companycode, categorycode) VALUES (@hid, @code, @cat)`);
  }
}

async function getCompanyCategoryPairsForCompanies(pool, companyCodes) {
  const list = (Array.isArray(companyCodes) ? companyCodes : []).map(c => String(c || '').trim()).filter(Boolean);
  if (!list.length) return [];
  const params = list.map((_, i) => `@c${i}`).join(', ');
  const inputs = list.map((c, i) => [`c${i}`, sql.VarChar(50), c]);
  const request = pool.request();
  inputs.forEach(([name, type, value]) => request.input(name, type, value));
  const r = await request.query(
    `SELECT DISTINCT LTRIM(RTRIM(companycode)) AS companycode, LTRIM(RTRIM(cat)) AS categorycode
     FROM dbo.tblemployee
     WHERE LTRIM(RTRIM(cat)) <> '' AND LTRIM(RTRIM(companycode)) IN (${params})
     ORDER BY companycode, categorycode`);
  return (r.recordset || []).map(x => ({
    companycode: String(x.companycode || '').trim(),
    categorycode: String(x.categorycode || '').trim(),
  })).filter(x => x.companycode && x.categorycode);
}

/**
 * REAL category union + REAL company/category pairs for the selected companies.
 * One DISTINCT query over dbo.tblemployee; the category list is simply the
 * union of the pair's category codes (no duplicates, no hard-coded values).
 * This is what powers the dynamic Category multi-select after company selection.
 */
async function getCategoriesForCompaniesWithPairs(pool, companyCodes) {
  const list = (Array.isArray(companyCodes) ? companyCodes : []).map(c => String(c || '').trim()).filter(Boolean);
  if (!list.length) return { categories: [], pairs: [] };
  const params = list.map((_, i) => `@c${i}`).join(', ');
  const request = pool.request();
  list.forEach((c, i) => request.input(`c${i}`, sql.VarChar(50), c));
  const rp = await request.query(
    `SELECT DISTINCT LTRIM(RTRIM(companycode)) AS companycode, LTRIM(RTRIM(cat)) AS categorycode
     FROM dbo.tblemployee
     WHERE LTRIM(RTRIM(cat)) <> '' AND LTRIM(RTRIM(companycode)) IN (${params})
     ORDER BY companycode, categorycode`);
  const pairs = (rp.recordset || []).map(x => ({
    companycode: String(x.companycode || '').trim(),
    categorycode: String(x.categorycode || '').trim(),
  })).filter(x => x.companycode && x.categorycode);
  const categories = [...new Set(pairs.map(p => p.categorycode))].sort();
  return { categories, pairs };
}

// ---- Holiday API Endpoints ----

/** Shared read: every holiday row, optionally filtered. Never writes. */
async function readHolidays(pool, { where = '1=1', inputs = [] } = {}) {
  const request = pool.request();
  inputs.forEach(([name, type, value]) => request.input(name, type, value));
  const result = await request.query(`
    SELECT id, holidaydate, holidayname, category, description, companycode, active,
           isHalfDay, halfdaypart,
           createddate, updateddate, createdby
    FROM ${holidayTable}
    WHERE ${where}
    ORDER BY holidaydate, category`);
  const rows = (result.recordset || []).map((row) => ({
    ...row,
    // Always hand the client a plain 'YYYY-MM-DD' so calendar date matching can
    // never drift by timezone (17-Sep-2026 stays 17-Sep-2026 everywhere).
    holidaydate: rowDateIso(row.holidaydate),
    active: Boolean(row.active),
    isHalfDay: Boolean(row.isHalfDay),
  }));
  for (const row of rows) {
    row.companies = await readHolidayCompanies(pool, row.id);
    row.categories = await readHolidayCategoryEntries(pool, row.id);
    row.companyCategoryPairs = await readHolidayCompanyCategoryPairs(pool, row.id);
  }
  return rows;
}

/**
 * Resolve the holiday group(s) that apply to ONE employee.
 *
 * Identity is ALWAYS req.user.paycode from the verified JWT. The employee's real
 * category code comes from dbo.tblemployee and is translated through
 * dbo.HR_HolidayCategoryMap (seeded from real dbo.tblcategory data), so an employee
 * only ever receives holidays for their own group plus the "All Employees" group.
 */
async function employeeHolidayCategories(pool, paycode) {
  const emp = await pool.request().input('paycode', sql.VarChar(50), paycode).query(
    `SELECT TOP 1 LTRIM(RTRIM(cat)) AS cat FROM dbo.tblemployee WHERE LTRIM(RTRIM(paycode)) = @paycode`);
  const catCode = String(emp.recordset?.[0]?.cat || '').trim();
  if (!catCode) return { catCode: '', groups: [] };
  await ensureHolidayCategoryMap(pool);
  const mapped = await pool.request().input('code', sql.VarChar(50), catCode).query(
    `SELECT TOP 1 holidaycategory FROM ${holidayCategoryMapTable}
      WHERE LTRIM(RTRIM(categorycode)) = @code AND active = 1`);
  const group = String(mapped.recordset?.[0]?.holidaycategory || '').trim();
  return { catCode, groups: [group, HOLIDAY_ALL_GROUP].filter(Boolean) };
}

// GET /api/hr/holiday-categories - distinct employee categories (and the REAL
// company+category pairs) for the selected companies, straight from
// dbo.tblemployee. Read-only; it never touches the holiday tables, so the
// category list can never be taken down by holiday-schema migration.
// Response shape: { success, categories:[{code,name}], pairs:[{companycode,categorycode}] }
app.get('/api/hr/holiday-categories', authenticate, requireRole('HR'), requireDbConfig, async (req, res) => {
  try {
    const pool = await getPool();
    const companies = String(req.query.companies || '').split(',').map(c => c.trim()).filter(Boolean);
    const { categories, pairs } = await getCategoriesForCompaniesWithPairs(pool, companies);
    const master = await readCategoryMaster(pool);
    const rows = categories.map(code => ({
      code,
      name: master.get(code.toUpperCase()) || code,
    }));
    res.json({ success: true, categories: rows, pairs });
  } catch (error) { sendDbError(res, error); }
});

// GET /api/hr/holidays - HR Admin list. Supports search + category + month/year
// + active filters so HR can find and manage holidays. HR role required.
app.get('/api/hr/holidays', authenticate, requireRole('HR'), requireDbConfig, async (req, res) => {
  try {
    const pool = await getPool();
    // Guarantee the application schema (incl. isHalfDay/halfdaypart + child
    // tables) before reading, so a fresh install never fails on missing columns.
    await migrateHolidayStructure(pool);
    const q = req.query || {};
    const conditions = ['1=1'];
    const inputs = [];
    const search = String(q.search || '').trim();
    const category = String(q.category || '').trim();
    const activeParam = String(q.active ?? '').trim().toUpperCase();
    if (search) {
      conditions.push('(holidayname LIKE @search OR description LIKE @search OR category LIKE @search OR companycode LIKE @search)');
      inputs.push(['search', sql.NVarChar(100), `%${search}%`]);
    }
    if (category) { conditions.push('category = @category'); inputs.push(['category', sql.NVarChar(50), category]); }
    if (activeParam === 'Y') conditions.push('active = 1');
    else if (activeParam === 'N') conditions.push('active = 0');
    // Month / year navigation is data-driven: no holiday date is ever hardcoded.
    if (q.month) {
      if (!/^\d{4}-\d{2}$/.test(q.month)) return res.status(400).json({ success: false, message: 'Invalid month. Use YYYY-MM.' });
      const [y, m] = q.month.split('-').map(Number);
      conditions.push('holidaydate >= @monthStart AND holidaydate <= @monthEnd');
      inputs.push(['monthStart', sql.Date, `${q.month}-01`]);
      inputs.push(['monthEnd', sql.Date, isoDate(new Date(Date.UTC(y, m, 0)))]);
    } else if (q.year) {
      if (!/^\d{4}$/.test(q.year)) return res.status(400).json({ success: false, message: 'Invalid year. Use YYYY.' });
      conditions.push('YEAR(holidaydate) = @year');
      inputs.push(['year', sql.Int, Number(q.year)]);
    }
    res.json({ success: true, holidays: await readHolidays(pool, { where: conditions.join(' AND '), inputs }) });
  } catch (error) { sendDbError(res, error); }
});

// Phase G final: the manual "Holiday Categories" management endpoints
// (GET/POST /api/hr/holidays/categories) were REMOVED - HR no longer creates
// holiday categories by hand. Categories now come DYNAMICALLY from real
// dbo.tblemployee data via GET /api/hr/holiday-categories. The
// dbo.HR_HolidayCategories table itself is kept untouched so legacy holiday
// rows (Independence Day, VishKarma Puja, ...) still validate and display.

// Phase G final: the manual "Group Mapping" management endpoints
// (GET/PUT /api/hr/holidays/category-map) were REMOVED - HR no longer maps
// category codes to holiday groups by hand. The REAL company+category
// relationship comes straight from dbo.tblemployee. The internal
// dbo.HR_HolidayCategoryMap table is kept (and still seeded internally) so
// legacy holiday rows keep resolving their employees exactly as before.

// GET /api/employee/holidays - EMPLOYEE VIEW ONLY (read).
//
// The employee is ALWAYS req.user.paycode from the verified JWT; a paycode in the
// query is never read. Only ACTIVE holidays of the employee's own group plus the
// "All Employees" group are returned, so one employee can never see another
// group's holiday. An employee token can never write holiday data.
app.get('/api/employee/holidays', authenticate, requireRole('EMPLOYEE'), requirePasswordChanged, requireDbConfig, async (req, res) => {
  try {
    const pool = await getPool();
    const emp = await pool.request().input('paycode', sql.VarChar(50), req.user.paycode).query(
      `SELECT TOP 1 LTRIM(RTRIM(companycode)) AS companycode, LTRIM(RTRIM(cat)) AS cat FROM dbo.tblemployee WHERE LTRIM(RTRIM(paycode)) = @paycode`);
    const empCompany = String(emp.recordset?.[0]?.companycode || '').trim();
    const empCat = String(emp.recordset?.[0]?.cat || '').trim();
    const q = req.query || {};
    const conditions = ['h.active = 1'];
    const inputs = [];
    // Month navigation is data-driven (YYYY-MM); no holiday date is hardcoded.
    if (q.month) {
      if (!/^\d{4}-\d{2}$/.test(q.month)) return res.status(400).json({ success: false, message: 'Invalid month. Use YYYY-MM.' });
      const [y, m] = q.month.split('-').map(Number);
      conditions.push('h.holidaydate >= @monthStart AND h.holidaydate <= @monthEnd');
      inputs.push(['monthStart', sql.Date, `${q.month}-01`]);
      inputs.push(['monthEnd', sql.Date, isoDate(new Date(Date.UTC(y, m, 0)))]);
    } else if (q.fromDate || q.toDate) {
      if (!isValidIsoDate(q.fromDate) || !isValidIsoDate(q.toDate) || q.fromDate > q.toDate) {
        return res.status(400).json({ success: false, message: 'fromDate and toDate must be valid and ordered.' });
      }
      conditions.push('h.holidaydate >= @fromDate AND h.holidaydate <= @toDate');
      inputs.push(['fromDate', sql.Date, q.fromDate]);
      inputs.push(['toDate', sql.Date, q.toDate]);
    }
    await migrateHolidayStructure(pool);
    const request = pool.request();
    inputs.forEach(([name, type, value]) => request.input(name, type, value));
    const raw = await request.query(`
      SELECT h.id, h.holidaydate, h.holidayname, h.category, h.description, h.companycode, h.active, h.isHalfDay, h.halfdaypart
      FROM ${holidayTable} h
      WHERE ${conditions.join(' AND ')}
      ORDER BY h.holidaydate, h.category`);
    const holidays = [];
    for (const h of raw.recordset || []) {
      const hid = h.id;
      const companies = await readHolidayCompanies(pool, hid);
      const catEntries = await readHolidayCategoryEntries(pool, hid);
      const pairs = await readHolidayCompanyCategoryPairs(pool, hid);
      // PHASE G.2 — shared predicate: real company + real category (never
      // category alone), so this can never disagree with the audit overlay.
      let match = doesHolidayApplyToEmployee(h, companies, catEntries, pairs, empCompany, empCat);
      if (!match && companies.length === 0 && catEntries.length === 0 && pairs.length === 0) {
        await ensureHolidayCategoryMap(pool);
        const mapped = await pool.request().input('code', sql.VarChar(50), empCat).query(
          `SELECT TOP 1 holidaycategory FROM ${holidayCategoryMapTable} WHERE LTRIM(RTRIM(categorycode)) = @code AND active = 1`);
        match = String(mapped.recordset?.[0]?.holidaycategory || '').trim() === String(h.category || '').trim();
      }
      if (!match) continue;
      holidays.push({
        ...h,
        // Plain 'YYYY-MM-DD' - the employee calendar keys are exact date strings.
        holidaydate: rowDateIso(h.holidaydate),
        active: Boolean(h.active),
        companies,
        categories: catEntries,
        companyCategoryPairs: pairs,
      });
    }
    res.json({ success: true, categoryCode: empCat, categories: [], holidays });
  } catch (error) { sendDbError(res, error); }
});

/**
 * Confirm a holiday category really exists in dbo.HR_HolidayCategories.
 * Categories are DATA (HR can add more later), so nothing is validated against a
 * hardcoded list - a bad category is rejected against the real table instead.
 */
async function holidayCategoryExists(pool, category) {
  const row = await pool.request().input('category', sql.NVarChar(50), String(category || '').trim())
    .query(`SELECT TOP 1 categoryname FROM ${holidayCategoryTable}
             WHERE LTRIM(RTRIM(categoryname)) = @category AND active = 1`);
  return Boolean(row.recordset[0]);
}

/**
 * Duplicate rule (Phase G section 4): a holiday is a duplicate ONLY when the same
 * date already exists for the same category. The same date for a DIFFERENT
 * category is valid, so 26-Jan + Factory Staff and 26-Jan + Office Staff coexist.
 * `excludeId` lets an edit keep its own row without tripping the check.
 */
async function findHolidayDuplicate(pool, holidaydate, category, excludeId = null) {
  const row = await pool.request()
    .input('holidaydate', sql.Date, holidaydate)
    .input('category', sql.NVarChar(50), String(category || '').trim())
    .input('excludeId', sql.Int, excludeId)
    .query(`SELECT TOP 1 id, holidayname, category FROM ${holidayTable}
             WHERE holidaydate = @holidaydate AND LTRIM(RTRIM(category)) = @category
               AND (@excludeId IS NULL OR id <> @excludeId)`);
  return row.recordset[0] || null;
}

/** Unique, trimmed string array from a request payload. */
function cleanCodeList(value) {
  return [...new Set((Array.isArray(value) ? value : []).map(c => String(c || '').trim()).filter(Boolean))];
}

/**
 * THE core applicability rule of Phase G final:
 *
 *   saved pairs = REAL employee pairs (dbo.tblemployee)
 *                 INTERSECT (selected companies x selected categories)
 *
 * This is what prevents an impossible combination (e.g. OFFICE + WORKER when no
 * OFFICE employee is a WORKER) from ever being stored, while still allowing the
 * valid union (B-36 + STAFF, B-36 + WORKER, ...) for a multi-company selection.
 * Returns { ok, pairs } or { ok:false, message, code } for a 400 response.
 */
async function validateHolidayApplicability(pool, { companies, categories }) {
  if (!companies.length) {
    return { ok: false, message: 'At least one company is required.', code: 'COMPANY_REQUIRED' };
  }
  if (!categories.length) {
    return { ok: false, message: 'At least one employee category is required.', code: 'CATEGORY_REQUIRED' };
  }
  const realPairs = await getCompanyCategoryPairsForCompanies(pool, companies);
  const cset = new Set(companies);
  const kset = new Set(categories);
  const pairs = realPairs.filter(p => cset.has(p.companycode) && kset.has(p.categorycode));
  if (!pairs.length) {
    return {
      ok: false,
      message: 'Selected company/category combinations do not exist in employee data.',
      code: 'NO_VALID_PAIRS',
    };
  }
  const emptyCompany = companies.find(c => !pairs.some(p => p.companycode === c));
  if (emptyCompany) {
    return {
      ok: false,
      message: `Selected categories do not exist in company "${emptyCompany}". Pick at least one category that company actually has.`,
      code: 'NO_VALID_PAIRS',
    };
  }
  const emptyCategory = categories.find(c => !pairs.some(p => p.categorycode === c));
  if (emptyCategory) {
    return {
      ok: false,
      message: `Selected category "${emptyCategory}" does not exist in any selected company.`,
      code: 'NO_VALID_PAIRS',
    };
  }
  return { ok: true, pairs };
}

/**
 * Legacy `category` column label for a new-style holiday, derived from the REAL
 * dbo.tblcategory names of the selected category codes (sorted, max 50 chars -
 * the column width). Keeps the (holidaydate, category) duplicate rule working.
 */
async function deriveHolidayCategoryLabel(pool, categories) {
  const master = await readCategoryMaster(pool);
  const names = categories.map(code => master.get(String(code).toUpperCase()) || String(code));
  names.sort();
  return names.join(', ').slice(0, 50);
}

// POST /api/hr/holidays - Add new holiday (HR Admin only)
//
// Two payload shapes are accepted, so older clients keep working unchanged:
//   NEW (mobile Add Holiday form):
//     { holidaydate, holidayname, companies[], categories[], isHalfDay,
//       halfdaypart, description, active }
//   LEGACY: an explicit `category` group label from the old management UI.
//
// For the NEW shape the stored applicability is ALWAYS
//   REAL employee pairs (dbo.tblemployee) INTERSECT (companies x categories),
// so an impossible pair (e.g. OFFICE + WORKER) can never be saved.
app.post('/api/hr/holidays', authenticate, requireRole('HR'), requireDbConfig, async (req, res) => {
  try {
    const { holidaydate, holidayname, category, description, companycode, companies, categories, isHalfDay, halfdaypart } = req.body || {};
    const cleanName = String(holidayname || '').trim();
    const legacyCategory = String(category || '').trim();
    const companiesList = cleanCodeList(companies);
    const categoriesList = cleanCodeList(categories);

    if (!isValidIsoDate(holidaydate)) {
      return res.status(400).json({ success: false, message: 'Valid holiday date (YYYY-MM-DD) is required.', code: 'INVALID_DATE' });
    }
    if (!cleanName) {
      return res.status(400).json({ success: false, message: 'Holiday name is required.', code: 'NAME_REQUIRED' });
    }
    if (cleanName.length > 200) {
      return res.status(400).json({ success: false, message: 'Holiday name must be 200 characters or fewer.', code: 'NAME_TOO_LONG' });
    }

    const pool = await getPool();
    await migrateHolidayStructure(pool);

    let finalCategory = legacyCategory;
    let selectedPairs = [];
    if (legacyCategory) {
      // Legacy client: the explicit group must really exist (old manual list).
      if (!(await holidayCategoryExists(pool, legacyCategory))) {
        return res.status(400).json({ success: false, message: 'Select a valid holiday category.', code: 'INVALID_CATEGORY' });
      }
      if (companiesList.length && categoriesList.length) {
        const v = await validateHolidayApplicability(pool, { companies: companiesList, categories: categoriesList });
        if (!v.ok) return res.status(400).json({ success: false, message: v.message, code: v.code });
        selectedPairs = v.pairs;
      }
    } else {
      // New flow: category is the EMPLOYEE category of the selected companies.
      const v = await validateHolidayApplicability(pool, { companies: companiesList, categories: categoriesList });
      if (!v.ok) return res.status(400).json({ success: false, message: v.message, code: v.code });
      selectedPairs = v.pairs;
      finalCategory = await deriveHolidayCategoryLabel(pool, categoriesList);
    }

    // Clear duplicate message BEFORE insert, so a genuine race still 409s.
    const duplicate = await findHolidayDuplicate(pool, holidaydate, finalCategory);
    if (duplicate) {
      return res.status(409).json({
        success: false,
        code: 'DUPLICATE_HOLIDAY',
        message: `A holiday for ${holidaydate} already exists in "${finalCategory}". The same date can be used for a different category.`,
      });
    }

    const storedCompany = String(companycode || '').trim() || companiesList[0] || null;
    const storedHalfPart = isHalfDay ? (String(halfdaypart || '').trim() || 'FN') : null;
    const result = await pool.request()
      .input('holidaydate', sql.Date, holidaydate)
      .input('holidayname', sql.NVarChar(200), cleanName)
      .input('category', sql.NVarChar(50), finalCategory)
      .input('description', sql.NVarChar(500), String(description || '').trim() || null)
      .input('companycode', sql.VarChar(50), storedCompany)
      .input('isHalfDay', sql.Bit, isHalfDay ? 1 : 0)
      .input('halfdaypart', sql.NVarChar(10), storedHalfPart)
      .input('createdby', sql.VarChar(50), String(req.user?.sub || 'HR').slice(0, 50))
      .query(`
        INSERT INTO ${holidayTable} (holidaydate, holidayname, category, description, companycode, active, isHalfDay, halfdaypart, createdby)
        OUTPUT INSERTED.id, INSERTED.holidaydate, INSERTED.holidayname, INSERTED.category, INSERTED.description,
               INSERTED.companycode, INSERTED.active, INSERTED.isHalfDay, INSERTED.halfdaypart, INSERTED.createddate, INSERTED.updateddate, INSERTED.createdby
        VALUES (@holidaydate, @holidayname, @category, @description, @companycode, 1, @isHalfDay, @halfdaypart, @createdby)`);

    const newId = result.recordset[0].id;
    await writeHolidayCompanies(pool, newId, companiesList);
    await writeHolidayCategoryEntries(pool, newId, categoriesList);
    await writeHolidayCompanyCategoryPairs(pool, newId, selectedPairs);

    const saved = {
      ...result.recordset[0],
      active: Boolean(result.recordset[0].active),
      isHalfDay: Boolean(result.recordset[0].isHalfDay),
      companies: companiesList,
      categories: categoriesList,
      companyCategoryPairs: selectedPairs,
    };
    res.status(201).json({ success: true, holiday: saved });
  } catch (error) {
    const msg = String(error?.message || error || '');
    if (msg.includes('UQ_HRHoliday_DateCategory') && msg.toUpperCase().includes('EXISTS')) {
      return res.status(409).json({ success: false, code: 'DUPLICATE_HOLIDAY', message: 'A holiday already exists for this date and category.' });
    }
    sendDbError(res, error);
  }
});

// PUT /api/hr/holidays/:id - Update / activate / deactivate holiday (HR Admin only)
app.put('/api/hr/holidays/:id', authenticate, requireRole('HR'), requireDbConfig, async (req, res) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isInteger(id) || id <= 0) {
      return res.status(400).json({ success: false, message: 'Valid holiday ID is required.', code: 'INVALID_ID' });
    }
    const body = req.body || {};
    const { holidaydate, holidayname, category, description, companycode, active, companies, categories, isHalfDay, halfdaypart } = body;
    const pool = await getPool();
    await migrateHolidayStructure(pool);

    const current = await pool.request().input('id', sql.Int, id).query(
      `SELECT TOP 1 id, holidaydate, holidayname, category, description, companycode, active, isHalfDay, halfdaypart FROM ${holidayTable} WHERE id = @id`);
    if (!current.recordset[0]) {
      return res.status(404).json({ success: false, message: 'Holiday not found.', code: 'NOT_FOUND' });
    }
    const before = current.recordset[0];

    // Applicability is recomputed EXACTLY like POST:
    //   REAL employee pairs INTERSECT (companies x categories).
    // Only runs when the body carries companies/categories, so a pure
    // activate/deactivate toggle never touches applicability.
    const hasApplicability = companies !== undefined || categories !== undefined;
    const strictApplicability = companies !== undefined && categories !== undefined;
    let effCompanies = [];
    let effCategories = [];
    let effPairs = [];
    if (hasApplicability) {
      effCompanies = companies !== undefined ? cleanCodeList(companies) : await readHolidayCompanies(pool, id);
      effCategories = categories !== undefined ? cleanCodeList(categories) : await readHolidayCategoryEntries(pool, id);
      if (strictApplicability) {
        const v = await validateHolidayApplicability(pool, { companies: effCompanies, categories: effCategories });
        if (!v.ok) return res.status(400).json({ success: false, message: v.message, code: v.code });
        effPairs = v.pairs;
      } else if (effCompanies.length && effCategories.length) {
        // Partial (legacy) update: intersect leniently, never widen applicability.
        const real = await getCompanyCategoryPairsForCompanies(pool, effCompanies);
        const cset = new Set(effCompanies);
        const kset = new Set(effCategories);
        effPairs = real.filter(p => cset.has(p.companycode) && kset.has(p.categorycode));
      } else if (effCompanies.length) {
        effPairs = await getCompanyCategoryPairsForCompanies(pool, effCompanies);
      }
    }

    // Only the fields actually present in the body are changed; an omitted field
    // keeps its stored value, so a partial update can never blank a column.
    const updates = [];
    const request = pool.request().input('id', sql.Int, id);

    const nextDate = holidaydate === undefined ? before.holidaydate : holidaydate;
    const nextCategory = category === undefined ? before.category : String(category || '').trim();
    const nextName = holidayname === undefined ? before.holidayname : String(holidayname || '').trim();

    if (holidaydate !== undefined) {
      if (!isValidIsoDate(holidaydate)) {
        return res.status(400).json({ success: false, message: 'Valid holiday date (YYYY-MM-DD) is required.', code: 'INVALID_DATE' });
      }
      updates.push('holidaydate = @holidaydate');
      request.input('holidaydate', sql.Date, holidaydate);
    }
    if (holidayname !== undefined) {
      if (!nextName) {
        return res.status(400).json({ success: false, message: 'Holiday name cannot be empty.', code: 'NAME_REQUIRED' });
      }
      if (nextName.length > 200) {
        return res.status(400).json({ success: false, message: 'Holiday name must be 200 characters or fewer.', code: 'NAME_TOO_LONG' });
      }
      updates.push('holidayname = @holidayname');
      request.input('holidayname', sql.NVarChar(200), nextName);
    }
    if (category !== undefined) {
      if (!nextCategory) {
        return res.status(400).json({ success: false, message: 'Holiday category is required.', code: 'CATEGORY_REQUIRED' });
      }
      if (!(await holidayCategoryExists(pool, nextCategory))) {
        return res.status(400).json({ success: false, message: 'Select a valid holiday category.', code: 'INVALID_CATEGORY' });
      }
      updates.push('category = @category');
      request.input('category', sql.NVarChar(50), nextCategory);
    }
    if (description !== undefined) {
      updates.push('description = @description');
      request.input('description', sql.NVarChar(500), String(description || '').trim() || null);
    }
    if (companycode !== undefined) {
      updates.push('companycode = @companycode');
      request.input('companycode', sql.VarChar(50), String(companycode || '').trim() || null);
    }
    if (active !== undefined) {
      updates.push('active = @active');
      request.input('active', sql.Bit, active ? 1 : 0);
    }
    if (isHalfDay !== undefined) {
      updates.push('isHalfDay = @isHalfDay');
      request.input('isHalfDay', sql.Bit, isHalfDay ? 1 : 0);
    }
    if (halfdaypart !== undefined) {
      updates.push('halfdaypart = @halfdaypart');
      // Effective duration: an explicit body value wins, otherwise keep stored.
      const effectiveHalfDay = isHalfDay === undefined ? Boolean(before.isHalfDay) : Boolean(isHalfDay);
      request.input('halfdaypart', sql.NVarChar(10), effectiveHalfDay ? String(halfdaypart || '').trim() || 'FN' : null);
    }
    if (!updates.length && !hasApplicability) {
      return res.status(400).json({ success: false, message: 'No fields to update.', code: 'NO_CHANGES' });
    }

    // Re-check the duplicate rule against the row's EFFECTIVE date + category.
    const effectiveDate = typeof nextDate === 'string' ? nextDate : rowDateIso(nextDate);
    const duplicate = await findHolidayDuplicate(pool, effectiveDate, nextCategory, id);
    if (duplicate) {
      return res.status(409).json({
        success: false,
        code: 'DUPLICATE_HOLIDAY',
        message: `Another holiday for ${effectiveDate} already exists in "${nextCategory}". The same date can be used for a different category.`,
      });
    }

    updates.push('updateddate = SYSUTCDATETIME()');
    await request.query(`UPDATE ${holidayTable} SET ${updates.join(', ')} WHERE id = @id;`);
    const updated = await pool.request().input('id', sql.Int, id).query(
      `SELECT TOP 1 id, holidaydate, holidayname, category, description, companycode, active, isHalfDay, halfdaypart, createddate, updateddate, createdby
       FROM ${holidayTable} WHERE id = @id`);
    const updatedRow = {
      ...updated.recordset[0],
      active: Boolean(updated.recordset[0].active),
      isHalfDay: Boolean(updated.recordset[0].isHalfDay),
    };
    if (hasApplicability) {
      await writeHolidayCompanies(pool, id, effCompanies);
      await writeHolidayCategoryEntries(pool, id, effCategories);
      await writeHolidayCompanyCategoryPairs(pool, id, effPairs);
    }
    updatedRow.companies = await readHolidayCompanies(pool, id);
    updatedRow.categories = await readHolidayCategoryEntries(pool, id);
    updatedRow.companyCategoryPairs = await readHolidayCompanyCategoryPairs(pool, id);
    res.json({ success: true, holiday: updatedRow });
  } catch (error) {
    const msg = String(error?.message || error || '');
    if (msg.includes('UQ_HRHoliday_DateCategory') && msg.toUpperCase().includes('EXISTS')) {
      return res.status(409).json({ success: false, code: 'DUPLICATE_HOLIDAY', message: 'A holiday already exists for this date and category.' });
    }
    sendDbError(res, error);
  }
});

// DELETE /api/hr/holidays/:id - Delete holiday (HR Admin only)
app.delete('/api/hr/holidays/:id', authenticate, requireRole('HR'), requireDbConfig, async (req, res) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isInteger(id) || id <= 0) {
      return res.status(400).json({ success: false, message: 'Valid holiday ID is required.' });
    }
    
    const pool = await getPool();
    await migrateHolidayStructure(pool);
    
    await pool.request().input('id', sql.Int, id).query(`DELETE FROM ${holidayCompaniesTable} WHERE holiday_id = @id`);
    await pool.request().input('id', sql.Int, id).query(`DELETE FROM ${holidayCategoryEntriesTable} WHERE holiday_id = @id`);
    await pool.request().input('id', sql.Int, id).query(`DELETE FROM ${holidayCompanyCategoryTable} WHERE holiday_id = @id`);
    
    const result = await pool.request()
      .input('id', sql.Int, id)
      .query(`DELETE FROM ${holidayTable} WHERE id = @id`);
    
    if (result.rowsAffected[0] === 0) {
      return res.status(404).json({ success: false, message: 'Holiday not found.' });
    }
    
    res.json({ success: true, deleted: 1 });
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
    await ensureMarriageTable(pool);
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
    const pool = await getPool();
    await ensureMarriageTable(pool);
    const transaction = new sql.Transaction(pool);
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
     Key/credentials DB me encrypted save hoti hain (HR ? Email Configuration ?
     Provider Config). Server .env (BREVO_API_KEY / SMTP_*) sirf fallback hai.
   - Dedicated HR_ tables (auto-ensure); dbo.tblemployee me koi change nahi.
   - Recipient: Savior SQL e_mail1 ? fallback HR_EmployeeEmails (Excel import).
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
   DB credentials (saved from the UI) ? server .env fallback ? clear error. */
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
//   Birthday ? dbo.tblemployee.dateofbirth | Work Anniversary ? dbo.tblemployee.dateofjoin
//   Marriage Anniversary ? HR_MarriageAnniversary.anniversarydate (existing import table)
function matchesEventDate(employee, eventType, eventDate) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(eventDate || ''))) return false;
  const [, mm, dd] = eventDate.split('-');
  let field = null;
  if (eventType === 'Birthday') field = employee.dateofbirth;
  else if (eventType === 'Work Anniversary') field = employee.dateofjoin;
  else if (eventType === 'Marriage Anniversary') field = employee.anniversarydate;
  if (!field) return false;
  // Date objects are formatted with LOCAL components (toISOString would shift the
  // calendar day in timezones ahead of UTC — e.g. IST midnight ? previous day).
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
  if (!String(cfg.senderemail || '').trim()) return { ...out, skippedReason: 'Sender email is not configured — HR ? Email Configuration ? Provider Config tab me save karo.' };
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
      { key: 'provider', label: 'Email Provider', ok: provider.configured, value: provider.configured ? `${provider.providerLabel} ?` : 'Not configured', needs: provider.hint || '' },
      { key: 'database', label: 'SQL Database', ok: !!process.env.DB_SERVER, value: process.env.DB_SERVER ? 'Connected ?' : 'Not configured', needs: process.env.DB_SERVER ? '' : 'Server .env me DB_SERVER set karo.' },
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
/* ---- Single Email: resolve a REAL employee (SQL e_mail1 first ? HR mapping fallback) ---- */
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
// EADDRINUSE ko crash ki jagah clear message banao: user ko exact fix command batao.
// (npm run server dobara chalane se pehle purana node process band karna hota hai.)
const server = app.listen(port, () => console.log(`Attendance API listening on port ${port}`));
server.on('error', (error) => {
  if (error?.code === 'EADDRINUSE') {
    console.error(`Port ${port} already in use. Stop the old server first, then retry:`);
    console.error(`  npx kill-port ${port}   (or: Get-Process node | Stop-Process -Force)`);
    console.error(`  npm run server`);
    process.exitCode = 1;
    return;
  }
  throw error;
});
