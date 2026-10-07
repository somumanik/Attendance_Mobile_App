// ============================================================================
// FILE: server/leave-service.js
// PURPOSE: Employee Leave Management — application-owned data + provider seam
// ============================================================================

/**
 * Ye module POORI leave application ka core hai: leave types, opening balances,
 * requests, approval aur day-counting. Ye mobile/website UI se aur HTTP routes
 * se alag hai, isliye Navision kabhi bhi yahan swap ho sakta hai bina routes
 * ya screens badle.
 *
 * ---------------------------------------------------------------------------
 * STORAGE DECISION (Phase J section 9)
 * ---------------------------------------------------------------------------
 * Leave data 100% APPLICATION tables mein hai:
 *   dbo.HR_LeaveTypes    - configurable leave types (PL / SL / CL / OLA / OLB)
 *   dbo.HR_LeaveBalance  - per employee + leave year + type opening balance
 *   dbo.HR_LeaveRequest  - the requests themselves
 *   dbo.HR_LeaveConfig   - company configuration switches
 *
 * dbo.tblemployee, dbo.tblemployeeshiftmaster, dbo.tbltimeregister aur
 * dbo.tblcategory SIRF READ hote hain (employee identity, week-off day).
 * Inme se koi bhi table kabhi create / alter / delete NAHI hoti, aur koi bhi
 * leave write inme nahi jaata. Leave ek application-level overlay hai - Savior
 * attendance records bilkul nahi badalte (Phase J section 6).
 *
 * ---------------------------------------------------------------------------
 * FUTURE NAVISION INTEGRATION (Phase J section 7)
 * ---------------------------------------------------------------------------
 * Abhi KOI Navision code nahi hai, aur jaan bujh kar nahi likha gaya.
 * Sirf ek seam (provider) tayaar hai:
 *
 *     const provider = await getLeaveProvider();
 *     const rows    = await provider.listRequests({ paycode, year });
 *
 * Aaj getLeaveProvider() hamesha applicationLeaveProvider deta hai (is file ka
 * neeche wala hissa). Kal Navision ka adapter implement karke registry mein
 * register karna hoga — routes, screens aur is file ke upar ka logic
 * bilkul nahi badlega. Isi liye NAVISION_ENABLED env flag rakha gaya hai:
 * default false, aur is file mein uska koi Navision branch nahi hai.
 */

import { sql } from './db.js';

const LEAVE_TYPES_TABLE = process.env.HR_LEAVE_TYPES_TABLE || 'dbo.HR_LeaveTypes';
const LEAVE_BALANCE_TABLE = process.env.HR_LEAVE_BALANCE_TABLE || 'dbo.HR_LeaveBalance';
const LEAVE_REQUEST_TABLE = process.env.HR_LEAVE_REQUEST_TABLE || 'dbo.HR_LeaveRequest';
const LEAVE_CONFIG_TABLE = process.env.HR_LEAVE_CONFIG_TABLE || 'dbo.HR_LeaveConfig';

export const LEAVE_STATUS = { PENDING: 'Pending', APPROVED: 'Approved', REJECTED: 'Rejected', CANCELLED: 'Cancelled' };
// Uppercase mirrors used for COMPARISON only. Status is normalised to upper case
// when it is read back from a request, so decisions are matched case-insensitively.
const STATUS_UPPER = { PENDING: 'PENDING', APPROVED: 'APPROVED', REJECTED: 'REJECTED', CANCELLED: 'CANCELLED' };
const OPEN_STATUSES = [LEAVE_STATUS.PENDING, LEAVE_STATUS.APPROVED];

// The five codes Phase J requires. These are SEED ROWS in HR_LeaveTypes, not a
// hardcoded allow-list: a new type is added by HR through the same table, so
// nothing here needs a code change to expand.
const SEED_LEAVE_TYPES = [
  ['PL', 'Paid Leave', 1],
  ['SL', 'Sick Leave', 2],
  ['CL', 'Casual Leave', 3],
  ['OLA', 'Optional Leave A', 4],
  ['OLB', 'Optional Leave B', 5],
];

const DEFAULT_CONFIG = {
  // Phase J section 3: a request may not exceed the available balance UNLESS the
  // company explicitly allows it. This switch is that explicit permission.
  AllowNegativeBalance: 'N',
  // A backdated request older than this many days is refused (0 = no limit).
  MaxBackdateDays: '30',
  // Requests longer than this many days need HR to see an attachment (0 = never).
  AttachmentRequiredAboveDays: '5',
};

let ensureState = null; // null = unknown, true = ready, string = error message

/* ------------------------------------------------------------------ */
/* Schema ensure — same "HR_ table" auto-create pattern as the rest of
   this project (HR_Holidays, HR_EmployeeAuth, ...).                     */
/* ------------------------------------------------------------------ */

export async function ensureLeaveTables(pool) {
  if (ensureState === true) return;
  if (typeof ensureState === 'string') throw new Error(ensureState);
  try {
    await pool.request().batch(`
IF OBJECT_ID('${LEAVE_TYPES_TABLE}','U') IS NULL
CREATE TABLE ${LEAVE_TYPES_TABLE} (
  id INT IDENTITY(1,1) PRIMARY KEY,
  leavetype NVARCHAR(10) NOT NULL,
  typename NVARCHAR(100) NOT NULL,
  sortorder INT NOT NULL CONSTRAINT DF_LeaveType_Sort DEFAULT(0),
  active BIT NOT NULL CONSTRAINT DF_LeaveType_Active DEFAULT(1),
  createddate DATETIME2 NOT NULL CONSTRAINT DF_LeaveType_Created DEFAULT SYSUTCDATETIME(),
  CONSTRAINT UQ_LeaveType_Code UNIQUE (leavetype)
);

IF OBJECT_ID('${LEAVE_BALANCE_TABLE}','U') IS NULL
CREATE TABLE ${LEAVE_BALANCE_TABLE} (
  id INT IDENTITY(1,1) PRIMARY KEY,
  paycode NVARCHAR(50) NOT NULL,
  leaveyear INT NOT NULL,
  leavetype NVARCHAR(10) NOT NULL,
  openingbalance NUMERIC(9,2) NOT NULL CONSTRAINT DF_LeaveBal_Opening DEFAULT(0),
  createddate DATETIME2 NOT NULL CONSTRAINT DF_LeaveBal_Created DEFAULT SYSUTCDATETIME(),
  updateddate DATETIME2 NOT NULL CONSTRAINT DF_LeaveBal_Updated DEFAULT SYSUTCDATETIME(),
  updatedby NVARCHAR(50) NULL,
  CONSTRAINT UQ_LeaveBal UNIQUE (paycode, leaveyear, leavetype)
);

IF OBJECT_ID('${LEAVE_REQUEST_TABLE}','U') IS NULL
CREATE TABLE ${LEAVE_REQUEST_TABLE} (
  id INT IDENTITY(1,1) PRIMARY KEY,
  paycode NVARCHAR(50) NOT NULL,
  leaveyear INT NOT NULL,
  leavetype NVARCHAR(10) NOT NULL,
  fromdate DATE NOT NULL,
  todate DATE NOT NULL,
  ishalfday BIT NOT NULL CONSTRAINT DF_LeaveReq_Half DEFAULT(0),
  halfdaypart NVARCHAR(10) NULL,
  days NUMERIC(9,2) NOT NULL CONSTRAINT DF_LeaveReq_Days DEFAULT(0),
  reason NVARCHAR(500) NULL,
  attachmentname NVARCHAR(200) NULL,
  attachmentdata NVARCHAR(MAX) NULL,
  contactdetails NVARCHAR(200) NULL,
  status NVARCHAR(20) NOT NULL CONSTRAINT DF_LeaveReq_Status DEFAULT('Pending'),
  appliedat DATETIME2 NOT NULL CONSTRAINT DF_LeaveReq_Applied DEFAULT SYSUTCDATETIME(),
  decidedby NVARCHAR(50) NULL,
  decidedat DATETIME2 NULL,
  decisionnote NVARCHAR(500) NULL,
  cancelledat DATETIME2 NULL,
  updatedat DATETIME2 NOT NULL CONSTRAINT DF_LeaveReq_Updated DEFAULT SYSUTCDATETIME(),
  -- One live request cannot cover the same day twice for the same type.
  CONSTRAINT CK_LeaveReq_Dates CHECK (todate >= fromdate)
);
-- Indexes are created ONLY when missing. A bare CREATE INDEX would fail with
-- "already exists" on every restart once this batch re-runs, which would poison
-- the module and turn every leave request into a 503.
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_LeaveReq_Paycode' AND object_id = OBJECT_ID('${LEAVE_REQUEST_TABLE}', 'U'))
  CREATE INDEX IX_LeaveReq_Paycode ON ${LEAVE_REQUEST_TABLE} (paycode, leaveyear, status);
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_LeaveReq_Status' AND object_id = OBJECT_ID('${LEAVE_REQUEST_TABLE}', 'U'))
  CREATE INDEX IX_LeaveReq_Status ON ${LEAVE_REQUEST_TABLE} (status, appliedat);

IF OBJECT_ID('${LEAVE_CONFIG_TABLE}','U') IS NULL
CREATE TABLE ${LEAVE_CONFIG_TABLE} (
  id INT IDENTITY(1,1) PRIMARY KEY,
  configkey NVARCHAR(60) NOT NULL,
  configvalue NVARCHAR(200) NULL,
  updatedat DATETIME2 NOT NULL CONSTRAINT DF_LeaveCfg_Updated DEFAULT SYSUTCDATETIME(),
  updatedby NVARCHAR(50) NULL,
  CONSTRAINT UQ_LeaveCfg_Key UNIQUE (configkey)
);`);

    // Seed the required leave types ONCE (empty table only, so an HR-managed
    // list is never overwritten).
    const seeded = await pool.request().query(`SELECT COUNT(1) AS n FROM ${LEAVE_TYPES_TABLE}`);
    if (Number(seeded.recordset?.[0]?.n || 0) === 0) {
      for (const [code, name, order] of SEED_LEAVE_TYPES) {
        await pool.request()
          .input('code', sql.NVarChar(10), code)
          .input('name', sql.NVarChar(100), name)
          .input('order', sql.Int, order)
          .query(`INSERT INTO ${LEAVE_TYPES_TABLE} (leavetype, typename, sortorder, active)
                  SELECT @code, @name, @order, 1
                  WHERE NOT EXISTS (SELECT 1 FROM ${LEAVE_TYPES_TABLE} WHERE LTRIM(RTRIM(leavetype)) = @code)`);
      }
    }

    // Seed company config defaults once.
    for (const [key, value] of Object.entries(DEFAULT_CONFIG)) {
      await pool.request()
        .input('key', sql.NVarChar(60), key)
        .input('value', sql.NVarChar(200), value)
        .query(`INSERT INTO ${LEAVE_CONFIG_TABLE} (configkey, configvalue)
                SELECT @key, @value
                WHERE NOT EXISTS (SELECT 1 FROM ${LEAVE_CONFIG_TABLE} WHERE LTRIM(RTRIM(configkey)) = @key)`);
    }

    ensureState = true;
  } catch (error) {
    const msg = String(error?.message || error || '');
    // A concurrent first request can win the race and create the same object.
    // That is success, not failure, so the module must still become ready.
    const benign = /already exists/i.test(msg) && /(index|constraint|table|object)/i.test(msg);
    if (benign) {
      ensureState = true;
      return;
    }
    ensureState = `Leave tables unavailable: ${msg}`;
    throw new Error(ensureState);
  }
}

/* ------------------------------------------------------------------ */
/* Small helpers                                                       */
/* ------------------------------------------------------------------ */

const clean = (v) => String(v == null ? '' : v).trim();
const upper = (v) => clean(v).toUpperCase();

export function isValidIsoDate(value) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(clean(value))) return false;
  const d = new Date(`${clean(value)}T00:00:00Z`);
  return !Number.isNaN(d.valueOf()) && d.toISOString().slice(0, 10) === clean(value);
}

function todayIso() {
  return new Date().toISOString().slice(0, 10);
}

/** 'YYYY-MM-DD' -> 'YYYY-MM-DD' after adding days, using UTC to avoid drift. */
function addDays(iso, days) {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

function yearOf(iso) {
  return Number(String(iso).slice(0, 4));
}

/**
 * Normalise a DATE column to 'YYYY-MM-DD'.
 *
 * mssql hands a SQL DATE back as a JS Date in the LOCAL timezone, so
 * `String(value).slice(0, 10)` would produce "Mon May 01" instead of a date. The
 * local calendar components are therefore used (never toISOString(), which would
 * shift the day across the UTC boundary).
 */
function toIsoDate(value) {
  if (value instanceof Date) {
    if (Number.isNaN(value.getTime())) return '';
    return `${value.getFullYear()}-${String(value.getMonth() + 1).padStart(2, '0')}-${String(value.getDate()).padStart(2, '0')}`;
  }
  const s = clean(value);
  if (!s) return '';
  // Already an ISO string (this is what SQL Server returns for a plain VARCHAR).
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(s);
  return m ? `${m[1]}-${m[2]}-${m[3]}` : s;
}

/** 0 = Sunday .. 6 = Saturday (matches the database's SUN/MON/... day codes). */
function jsDayToCode(iso) {
  const d = new Date(`${iso}T00:00:00Z`).getUTCDay();
  return ['SUN', 'MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT'][d];
}

function daysBetweenInclusive(fromIso, toIso) {
  const a = Date.parse(`${fromIso}T00:00:00Z`);
  const b = Date.parse(`${toIso}T00:00:00Z`);
  return Math.floor((b - a) / 86400000) + 1;
}

/**
 * The employee's REAL week-off days.
 *
 * Read live from dbo.tblemployeeshiftmaster.firstoffday / secondoffday (read
 * ONLY - that Savior table is never written). When no row exists we fall back to
 * Sunday, which is what this workforce actually has, and never to a hardcoded
 * "Saturday off" assumption.
 */
export async function loadEmployeeWeekOffs(pool, paycode) {
  try {
    const r = await pool.request()
      .input('paycode', sql.NVarChar(50), clean(paycode))
      .query(`SELECT TOP 1 LTRIM(RTRIM(firstoffday)) AS firstoffday, LTRIM(RTRIM(secondoffday)) AS secondoffday
              FROM dbo.tblemployeeshiftmaster WHERE LTRIM(RTRIM(paycode)) = @paycode`);
    const row = r.recordset?.[0];
    const days = new Set();
    for (const value of [row?.firstoffday, row?.secondoffday]) {
      const code = upper(value);
      if (/^(SUN|MON|TUE|WED|THU|FRI|SAT)$/.test(code)) days.add(code);
    }
    if (!days.size) days.add('SUN');
    return days;
  } catch (_error) {
    return new Set(['SUN']);
  }
}

/* ------------------------------------------------------------------ */
/* Leave types                                                         */
/* ------------------------------------------------------------------ */

export async function listLeaveTypes(pool, { includeInactive = false } = {}) {
  await ensureLeaveTables(pool);
  const r = await pool.request().query(`
    SELECT id, LTRIM(RTRIM(leavetype)) AS leavetype, typename, sortorder, active
    FROM ${LEAVE_TYPES_TABLE}
    ${includeInactive ? '' : 'WHERE active = 1'}
    ORDER BY sortorder, leavetype`);
  return (r.recordset || []).map((x) => ({ ...x, active: Boolean(x.active) }));
}

export async function leaveTypeExists(pool, code) {
  await ensureLeaveTables(pool);
  const r = await pool.request()
    .input('code', sql.NVarChar(10), clean(code))
    .query(`SELECT TOP 1 leavetype FROM ${LEAVE_TYPES_TABLE} WHERE LTRIM(RTRIM(leavetype)) = @code AND active = 1`);
  return Boolean(r.recordset?.[0]);
}

export async function addLeaveType(pool, { leavetype, typename, sortorder, actor }) {
  await ensureLeaveTables(pool);
  const code = clean(leavetype);
  const name = clean(typename);
  if (!code) return { ok: false, status: 400, code: 'TYPE_REQUIRED', message: 'Leave type code is required.' };
  if (!name) return { ok: false, status: 400, code: 'NAME_REQUIRED', message: 'Leave type name is required.' };
  const existing = await pool.request().input('code', sql.NVarChar(10), code)
    .query(`SELECT TOP 1 id FROM ${LEAVE_TYPES_TABLE} WHERE LTRIM(RTRIM(leavetype)) = @code`);
  if (existing.recordset?.[0]) {
    return { ok: false, status: 409, code: 'TYPE_EXISTS', message: `Leave type "${code}" already exists.` };
  }
  const r = await pool.request()
    .input('code', sql.NVarChar(10), code)
    .input('name', sql.NVarChar(100), name)
    .input('order', sql.Int, Number(sortorder) || 99)
    .query(`INSERT INTO ${LEAVE_TYPES_TABLE} (leavetype, typename, sortorder, active)
            OUTPUT INSERTED.id, INSERTED.leavetype, INSERTED.typename, INSERTED.sortorder, INSERTED.active
            VALUES (@code, @name, @order, 1)`);
  return { ok: true, leavetype: { ...r.recordset[0], active: true } };
}

/* ------------------------------------------------------------------ */
/* Company configuration                                               */
/* ------------------------------------------------------------------ */

export async function getLeaveConfig(pool) {
  await ensureLeaveTables(pool);
  const r = await pool.request().query(`SELECT LTRIM(RTRIM(configkey)) AS configkey, configvalue FROM ${LEAVE_CONFIG_TABLE}`);
  const map = { ...DEFAULT_CONFIG };
  for (const row of r.recordset || []) map[clean(row.configkey)] = clean(row.configvalue);
  return {
    allowNegativeBalance: upper(map.AllowNegativeBalance) === 'Y',
    maxBackdateDays: Number(map.MaxBackdateDays) || 0,
    attachmentRequiredAboveDays: Number(map.AttachmentRequiredAboveDays) || 0,
  };
}

export async function setLeaveConfig(pool, patch, actor) {
  await ensureLeaveTables(pool);
  const allowed = new Set(Object.keys(DEFAULT_CONFIG));
  const applied = [];
  for (const [key, value] of Object.entries(patch || {})) {
    if (!allowed.has(key)) continue;
    await pool.request()
      .input('key', sql.NVarChar(60), key)
      .input('value', sql.NVarChar(200), clean(value))
      .input('by', sql.NVarChar(50), clean(actor).slice(0, 50))
      .query(`MERGE ${LEAVE_CONFIG_TABLE} AS t
              USING (SELECT @key AS configkey) AS s ON t.configkey = s.configkey
              WHEN MATCHED THEN UPDATE SET configvalue = @value, updatedat = SYSUTCDATETIME(), updatedby = @by
              WHEN NOT MATCHED THEN INSERT (configkey, configvalue, updatedat, updatedby)
                VALUES (@key, @value, SYSUTCDATETIME(), @by);`);
    applied.push(key);
  }
  return { ok: true, applied, config: await getLeaveConfig(pool) };
}

/* ------------------------------------------------------------------ */
/* Identity (read-only against Savior)                                 */
/* ------------------------------------------------------------------ */

/**
 * Real employee lookup, used by the Excel import to validate identity.
 * Returns null when the paycode is not an ACTIVE Savior employee - the import
 * must never invent an employee.
 */
export async function findActiveEmployee(pool, paycode) {
  const r = await pool.request()
    .input('paycode', sql.NVarChar(50), clean(paycode))
    .query(`SELECT TOP 1 LTRIM(RTRIM(paycode)) AS paycode,
                    LTRIM(RTRIM(empname)) AS empname,
                    LTRIM(RTRIM(presentcardno)) AS presentcardno
             FROM dbo.tblemployee
             WHERE LTRIM(RTRIM(paycode)) = @paycode AND ISNULL(active, 'Y') <> 'N'`);
  return r.recordset?.[0] || null;
}

/* ------------------------------------------------------------------ */
/* Day counting                                                        */
/* ------------------------------------------------------------------ */

/**
 * Working days for a leave request (Phase J section 3).
 *
 * Counts fromdate..todate inclusive and SKIPS non-working days:
 *   - the employee's real week-off day(s) from tblemployeeshiftmaster
 *   - active application holidays from dbo.HR_Holidays
 *
 * A half day is always 0.5. A range that contains no working day is an error,
 * because a request of 0 days would silently create a useless record.
 */
export async function calculateLeaveDays(pool, { paycode, fromdate, todate, isHalfDay }) {
  if (!isValidIsoDate(fromdate) || !isValidIsoDate(todate)) {
    return { ok: false, status: 400, code: 'INVALID_DATE', message: 'Valid from/to dates (YYYY-MM-DD) are required.' };
  }
  if (todate < fromdate) {
    return { ok: false, status: 400, code: 'DATE_ORDER', message: 'To date cannot be before from date.' };
  }
  if (isHalfDay && fromdate !== todate) {
    return { ok: false, status: 400, code: 'HALFDAY_RANGE', message: 'A half-day request must be a single day.' };
  }

  const weekOffs = await loadEmployeeWeekOffs(pool, paycode);

  // Active holiday dates (application table; read only).
  let holidays = new Set();
  try {
    const h = await pool.request()
      .input('from', sql.Date, fromdate)
      .input('to', sql.Date, todate)
      .query(`SELECT LTRIM(RTRIM(holidaydate)) AS holidaydate FROM dbo.HR_Holidays
              WHERE active = 1 AND holidaydate >= @from AND holidaydate <= @to`);
    holidays = new Set((h.recordset || []).map((x) => toIsoDate(x.holidaydate)));
  } catch (_error) {
    /* Holiday table absent/unavailable: fall back to week-offs only. */
  }

  const skipped = [];
  let working = 0;
  const total = daysBetweenInclusive(fromdate, todate);
  for (let i = 0; i < total; i += 1) {
    const iso = addDays(fromdate, i);
    if (weekOffs.has(jsDayToCode(iso))) { skipped.push({ date: iso, reason: 'Weekly Off' }); continue; }
    if (holidays.has(iso)) { skipped.push({ date: iso, reason: 'Holiday' }); continue; }
    working += 1;
  }

  if (working === 0) {
    return {
      ok: false,
      status: 400,
      code: 'NO_WORKING_DAY',
      message: 'The selected range contains only weekly offs or holidays, so no leave day would be deducted.',
      skipped,
    };
  }

  const days = isHalfDay ? 0.5 : working;
  return { ok: true, days, workingDays: working, totalCalendarDays: total, skipped };
}

/* ------------------------------------------------------------------ */
/* Balances                                                            */
/* ------------------------------------------------------------------ */

/**
 * Per-type balance for one employee + year (Phase J section 5).
 *
 *   Opening       = HR_LeaveBalance.openingbalance (imported by HR)
 *   Approved Used = days of APPROVED requests
 *   Pending       = days of PENDING requests
 *   Available     = Opening - Approved - Pending
 *
 * Pending is NOT deducted permanently: it is only encumbered so the same balance
 * cannot be spent twice. Rejecting or cancelling a request frees it again.
 */
export async function getLeaveBalance(pool, { paycode, leaveyear }) {
  await ensureLeaveTables(pool);
  const year = Number(leaveyear) || yearOf(todayIso());
  const types = await listLeaveTypes(pool, { includeInactive: true });
  const codes = types.map((t) => t.leavetype);
  if (!codes.length) return { leaveyear: year, types: [] };

  // Codes and statuses are inlined from values that came out of our own tables
  // (NVARCHAR columns, not user input), which keeps the query to one round trip
  // per lookup instead of building a parameter list per type.
  const typeList = codes.map((c) => `'${String(c).replace(/'/g, "''")}'`).join(', ');
  const statusList = OPEN_STATUSES.map((s) => `'${s}'`).join(', ');

  const opening = await pool.request()
    .input('paycode', sql.NVarChar(50), clean(paycode))
    .input('year', sql.Int, year)
    .query(`
      SELECT LTRIM(RTRIM(leavetype)) AS leavetype, openingbalance
      FROM ${LEAVE_BALANCE_TABLE}
      WHERE LTRIM(RTRIM(paycode)) = @paycode AND leaveyear = @year
        AND LTRIM(RTRIM(leavetype)) IN (${typeList})`);

  const used = await pool.request()
    .input('paycode', sql.NVarChar(50), clean(paycode))
    .input('year', sql.Int, year)
    .query(`
      SELECT LTRIM(RTRIM(leavetype)) AS leavetype, LTRIM(RTRIM(status)) AS status, SUM(days) AS days
      FROM ${LEAVE_REQUEST_TABLE}
      WHERE LTRIM(RTRIM(paycode)) = @paycode AND leaveyear = @year
        AND LTRIM(RTRIM(status)) IN (${statusList})
        AND LTRIM(RTRIM(leavetype)) IN (${typeList})
      GROUP BY LTRIM(RTRIM(leavetype)), LTRIM(RTRIM(status))`);

  const openMap = new Map((opening.recordset || []).map((r) => [clean(r.leavetype), Number(r.openingbalance) || 0]));
  const usedMap = new Map();
  for (const r of used.recordset || []) {
    usedMap.set(`${clean(r.leavetype)}|${clean(r.status)}`, Number(r.days) || 0);
  }

  return {
    leaveyear: year,
    types: types.map((t) => {
      const openingBal = openMap.get(t.leavetype) || 0;
      const approved = usedMap.get(`${t.leavetype}|${LEAVE_STATUS.APPROVED}`) || 0;
      const pending = usedMap.get(`${t.leavetype}|${LEAVE_STATUS.PENDING}`) || 0;
      return {
        leavetype: t.leavetype,
        typename: t.typename,
        active: t.active,
        openingBalance: round2(openingBal),
        approvedUsed: round2(approved),
        pending: round2(pending),
        availableBalance: round2(openingBal - approved - pending),
      };
    }),
  };
}

const round2 = (n) => Math.round((Number(n) || 0) * 100) / 100;

/** HR view: balances for many employees at once (used by the HR leave screen). */
export async function listEmployeeBalances(pool, { leaveyear, search, limit = 100 }) {
  await ensureLeaveTables(pool);
  const year = Number(leaveyear) || yearOf(todayIso());
  const like = clean(search);
  const request = pool.request()
    .input('year', sql.Int, year)
    .input('limit', sql.Int, Math.min(Number(limit) || 100, 500));
  let where = `WHERE ISNULL(e.active, 'Y') <> 'N' AND b.leaveyear = @year`;
  if (like) {
    where += ` AND (e.paycode LIKE @like OR e.empname LIKE @like)`;
    request.input('like', sql.NVarChar(60), `%${like}%`);
  }
  const r = await request.query(`
    SELECT TOP (@limit) LTRIM(RTRIM(e.paycode)) AS paycode, LTRIM(RTRIM(e.empname)) AS empname,
           LTRIM(RTRIM(e.companycode)) AS companycode,
           LTRIM(RTRIM(b.leavetype)) AS leavetype, b.openingbalance
    FROM dbo.tblemployee e
    JOIN ${LEAVE_BALANCE_TABLE} b ON LTRIM(RTRIM(b.paycode)) = LTRIM(RTRIM(e.paycode))
    ${where}
    ORDER BY e.paycode, b.leavetype`);

  const grouped = new Map();
  for (const row of r.recordset || []) {
    const key = clean(row.paycode);
    if (!grouped.has(key)) {
      grouped.set(key, { paycode: key, empname: clean(row.empname), companycode: clean(row.companycode), types: [] });
    }
    grouped.get(key).types.push({ leavetype: clean(row.leavetype), openingBalance: round2(row.openingbalance) });
  }
  return { leaveyear: year, employees: [...grouped.values()] };
}

/* ------------------------------------------------------------------ */
/* Requests                                                            */
/* ------------------------------------------------------------------ */

function mapRequest(row) {
  return {
    id: row.id,
    paycode: clean(row.paycode),
    empname: clean(row.empname) || '',
    leaveyear: Number(row.leaveyear),
    leavetype: clean(row.leavetype),
    typename: clean(row.typename) || '',
    fromdate: toIsoDate(row.fromdate),
    todate: toIsoDate(row.todate),
    isHalfDay: Boolean(row.ishalfday),
    halfdaypart: clean(row.halfdaypart),
    days: round2(row.days),
    reason: clean(row.reason),
    attachmentname: clean(row.attachmentname),
    hasAttachment: Boolean(clean(row.attachmentname)),
    contactdetails: clean(row.contactdetails),
    status: clean(row.status),
    appliedat: row.appliedat,
    decidedby: clean(row.decidedby),
    decidedat: row.decidedat,
    decisionnote: clean(row.decisionnote),
    cancelledat: row.cancelledat,
  };
}

const REQUEST_SELECT = `
  SELECT r.id, LTRIM(RTRIM(r.paycode)) AS paycode, LTRIM(RTRIM(e.empname)) AS empname,
         r.leaveyear, LTRIM(RTRIM(r.leavetype)) AS leavetype, LTRIM(RTRIM(t.typename)) AS typename,
         r.fromdate, r.todate, r.ishalfday, r.halfdaypart, r.days, r.reason,
         r.attachmentname, r.contactdetails, LTRIM(RTRIM(r.status)) AS status,
         r.appliedat, r.decidedby, r.decidedat, r.decisionnote, r.cancelledat
  FROM ${LEAVE_REQUEST_TABLE} r
  LEFT JOIN dbo.tblemployee e ON LTRIM(RTRIM(e.paycode)) = LTRIM(RTRIM(r.paycode))
  LEFT JOIN ${LEAVE_TYPES_TABLE} t ON LTRIM(RTRIM(t.leavetype)) = LTRIM(RTRIM(r.leavetype))`;

/** Employee's own requests. `paycode` here is always the session identity. */
export async function listLeaveRequests(pool, { paycode, leaveyear, status }) {
  await ensureLeaveTables(pool);
  const request = pool.request()
    .input('paycode', sql.NVarChar(50), clean(paycode));
  let where = `WHERE LTRIM(RTRIM(r.paycode)) = @paycode`;
  if (leaveyear) {
    where += ` AND r.leaveyear = @year`;
    request.input('year', sql.Int, Number(leaveyear));
  }
  if (status) {
    where += ` AND LTRIM(RTRIM(r.status)) = @status`;
    request.input('status', sql.NVarChar(20), clean(status));
  }
  const r = await request.query(`${REQUEST_SELECT} ${where} ORDER BY r.appliedat DESC, r.id DESC`);
  return (r.recordset || []).map(mapRequest);
}

/** HR view across employees, with the same filters plus search. */
export async function listAllLeaveRequests(pool, { leaveyear, status, search, limit = 200 }) {
  await ensureLeaveTables(pool);
  const request = pool.request().input('limit', sql.Int, Math.min(Number(limit) || 200, 1000));
  let where = 'WHERE 1 = 1';
  if (leaveyear) { where += ` AND r.leaveyear = @year`; request.input('year', sql.Int, Number(leaveyear)); }
  if (status) { where += ` AND LTRIM(RTRIM(r.status)) = @status`; request.input('status', sql.NVarChar(20), clean(status)); }
  if (clean(search)) {
    where += ` AND (e.paycode LIKE @like OR e.empname LIKE @like OR r.reason LIKE @like)`;
    request.input('like', sql.NVarChar(60), `%${clean(search)}%`);
  }
  const r = await request.query(`${REQUEST_SELECT} ${where} ORDER BY r.appliedat DESC, r.id DESC`);
  return (r.recordset || []).map(mapRequest);
}

/**
 * Employee creates a leave request (Phase J section 3).
 *
 * Balance rule: the request may not exceed the AVAILABLE balance, unless the
 * company has explicitly enabled AllowNegativeBalance.
 */
export async function createLeaveRequest(pool, { paycode, leavetype, fromdate, todate, isHalfDay, halfdaypart, reason, attachmentName, attachmentData, contactdetails }) {
  await ensureLeaveTables(pool);
  const cleanPaycode = clean(paycode);
  if (!cleanPaycode) return { ok: false, status: 400, code: 'PAYCODE_REQUIRED', message: 'Paycode is required.' };
  if (!reason || clean(reason).length < 3) {
    return { ok: false, status: 400, code: 'REASON_REQUIRED', message: 'Please give a reason for the leave.' };
  }
  if (!(await leaveTypeExists(pool, leavetype))) {
    return { ok: false, status: 400, code: 'INVALID_LEAVE_TYPE', message: 'Select a valid leave type.' };
  }

  const employee = await findActiveEmployee(pool, cleanPaycode);
  if (!employee) return { ok: false, status: 404, code: 'EMPLOYEE_NOT_FOUND', message: 'Employee not found.' };

  const config = await getLeaveConfig(pool);
  if (config.maxBackdateDays > 0) {
    const earliest = addDays(todayIso(), -config.maxBackdateDays);
    if (clean(fromdate) < earliest) {
      return { ok: false, status: 400, code: 'BACKDATE_LIMIT', message: `Leave cannot be applied for a date older than ${config.maxBackdateDays} days.` };
    }
  }

  const count = await calculateLeaveDays(pool, { paycode: cleanPaycode, fromdate, todate, isHalfDay });
  if (!count.ok) return count;

  if (config.attachmentRequiredAboveDays > 0 && count.days > config.attachmentRequiredAboveDays && !clean(attachmentName)) {
    return { ok: false, status: 400, code: 'ATTACHMENT_REQUIRED', message: `An attachment is required for leave longer than ${config.attachmentRequiredAboveDays} days.` };
  }

  const balance = await getLeaveBalance(pool, { paycode: cleanPaycode, leaveyear: yearOf(fromdate) });
  const typeRow = balance.types.find((t) => t.leavetype === clean(leavetype));
  const available = typeRow ? typeRow.availableBalance : 0;
  if (!config.allowNegativeBalance && count.days > available) {
    return {
      ok: false,
      status: 400,
      code: 'INSUFFICIENT_BALANCE',
      message: `You have ${available} ${clean(leavetype)} day(s) available but requested ${count.days}.`,
      availableBalance: available,
      requestedDays: count.days,
    };
  }

  // Reject an overlapping live request for the same type.
  const overlap = await pool.request()
    .input('paycode', sql.NVarChar(50), cleanPaycode)
    .input('type', sql.NVarChar(10), clean(leavetype))
    .input('from', sql.Date, clean(fromdate))
    .input('to', sql.Date, clean(todate))
    .query(`SELECT TOP 1 id, fromdate, todate FROM ${LEAVE_REQUEST_TABLE}
            WHERE LTRIM(RTRIM(paycode)) = @paycode AND LTRIM(RTRIM(leavetype)) = @type
              AND LTRIM(RTRIM(status)) IN ('${LEAVE_STATUS.PENDING}', '${LEAVE_STATUS.APPROVED}')
              AND NOT (todate < @from OR fromdate > @to)`);
  if (overlap.recordset?.[0]) {
    return { ok: false, status: 409, code: 'OVERLAPPING_REQUEST', message: 'You already have a pending or approved request covering some of these dates.' };
  }

  const r = await pool.request()
    .input('paycode', sql.NVarChar(50), cleanPaycode)
    .input('year', sql.Int, yearOf(fromdate))
    .input('type', sql.NVarChar(10), clean(leavetype))
    .input('from', sql.Date, clean(fromdate))
    .input('to', sql.Date, clean(todate))
    .input('half', sql.Bit, isHalfDay ? 1 : 0)
    .input('halfpart', sql.NVarChar(10), isHalfDay ? clean(halfdaypart) || null : null)
    .input('days', sql.Decimal(9, 2), count.days)
    .input('reason', sql.NVarChar(500), clean(reason))
    .input('attname', sql.NVarChar(200), clean(attachmentName) || null)
    .input('attdata', sql.NVarChar('max'), clean(attachmentData) || null)
    .input('contact', sql.NVarChar(200), clean(contactdetails) || null)
    .query(`INSERT INTO ${LEAVE_REQUEST_TABLE}
              (paycode, leaveyear, leavetype, fromdate, todate, ishalfday, halfdaypart, days,
               reason, attachmentname, attachmentdata, contactdetails, status)
            OUTPUT INSERTED.id
            VALUES (@paycode, @year, @type, @from, @to, @half, @halfpart, @days,
                    @reason, @attname, @attdata, @contact, '${LEAVE_STATUS.PENDING}')`);

  const created = await pool.request()
    .input('id', sql.Int, r.recordset[0].id)
    .query(`${REQUEST_SELECT} WHERE r.id = @id`);
  return { ok: true, request: mapRequest(created.recordset[0]) };
}

/** Employee cancels their own PENDING request (Approved can only be changed by HR). */
export async function cancelLeaveRequest(pool, { paycode, id }) {
  await ensureLeaveTables(pool);
  // T-SQL requires OUTPUT immediately after SET, before the WHERE clause.
  const r = await pool.request()
    .input('id', sql.Int, Number(id))
    .input('paycode', sql.NVarChar(50), clean(paycode))
    .query(`UPDATE ${LEAVE_REQUEST_TABLE}
            SET status = '${LEAVE_STATUS.CANCELLED}', cancelledat = SYSUTCDATETIME(), updatedat = SYSUTCDATETIME()
            OUTPUT INSERTED.id
            WHERE id = @id AND LTRIM(RTRIM(paycode)) = @paycode AND LTRIM(RTRIM(status)) = '${LEAVE_STATUS.PENDING}'`);
  if (!r.recordset?.[0]) {
    return { ok: false, status: 404, code: 'NOT_CANCELLABLE', message: 'Only your own pending request can be cancelled.' };
  }
  return { ok: true };
}

/**
 * HR approves or rejects a request (Phase J section 4).
 *
 * Approving re-checks the balance at decision time, so two HR users approving
 * concurrently can never over-commit the same balance.
 */
export async function decideLeaveRequest(pool, { id, decision, note, actor }) {
  await ensureLeaveTables(pool);
  // Compare against the UPPERCASE mirror: a caller may send "approved",
  // "Approved" or "APPROVED" and all must behave identically.
  const target = upper(decision);
  if (target !== STATUS_UPPER.APPROVED && target !== STATUS_UPPER.REJECTED) {
    return { ok: false, status: 400, code: 'INVALID_DECISION', message: 'Decision must be Approved or Rejected.' };
  }
  const row = await pool.request().input('id', sql.Int, Number(id))
    .query(`SELECT TOP 1 id, LTRIM(RTRIM(paycode)) AS paycode, leaveyear, LTRIM(RTRIM(leavetype)) AS leavetype,
                   fromdate, todate, days, LTRIM(RTRIM(status)) AS status
            FROM ${LEAVE_REQUEST_TABLE} WHERE id = @id`);
  const current = row.recordset?.[0];
  if (!current) return { ok: false, status: 404, code: 'NOT_FOUND', message: 'Leave request not found.' };
  if (clean(current.status) !== LEAVE_STATUS.PENDING) {
    return { ok: false, status: 409, code: 'ALREADY_DECIDED', message: `This request is already ${clean(current.status)}.` };
  }

  // NOTE: compare against the UPPERCASE mirror. `target` is normalised to upper
  // case, so matching it against the mixed-case LEAVE_STATUS.APPROVED would never
  // be true and the over-approval guard below would silently never run.
  if (target === STATUS_UPPER.APPROVED) {
    const config = await getLeaveConfig(pool);
    if (!config.allowNegativeBalance) {
      const balance = await getLeaveBalance(pool, { paycode: current.paycode, leaveyear: current.leaveyear });
      const typeRow = balance.types.find((t) => t.leavetype === clean(current.leavetype));
      const available = typeRow ? typeRow.availableBalance : 0;
      if (round2(current.days) > available) {
        return {
          ok: false,
          status: 409,
          code: 'INSUFFICIENT_BALANCE',
          message: `Cannot approve: only ${available} ${clean(current.leavetype)} day(s) available but this request needs ${round2(current.days)}.`,
          availableBalance: available,
        };
      }
    }
  }

  await pool.request()
    .input('id', sql.Int, Number(id))
    .input('status', sql.NVarChar(20), target === STATUS_UPPER.APPROVED ? LEAVE_STATUS.APPROVED : LEAVE_STATUS.REJECTED)
    .input('note', sql.NVarChar(500), clean(note) || null)
    .input('by', sql.NVarChar(50), clean(actor).slice(0, 50))
    .query(`UPDATE ${LEAVE_REQUEST_TABLE}
            SET status = @status, decidedby = @by, decidedat = SYSUTCDATETIME(),
                decisionnote = @note, updatedat = SYSUTCDATETIME()
            WHERE id = @id AND LTRIM(RTRIM(status)) = '${LEAVE_STATUS.PENDING}'`);

  const after = await pool.request().input('id', sql.Int, Number(id)).query(`${REQUEST_SELECT} WHERE r.id = @id`);
  return { ok: true, request: mapRequest(after.recordset[0]) };
}

/* ------------------------------------------------------------------ */
/* Calendar overlay (Phase J section 6)                                 */
/* ------------------------------------------------------------------ */

/**
 * APPROVED leave dates for an employee in a window.
 *
 * This is what the attendance calendar overlays. It NEVER writes to
 * dbo.tbltimeregister - a leave day is an application-level marker on top of
 * the real attendance record, exactly like a holiday.
 */
export async function listApprovedLeaveDates(pool, { paycode, fromdate, todate }) {
  await ensureLeaveTables(pool);
  const r = await pool.request()
    .input('paycode', sql.NVarChar(50), clean(paycode))
    .input('from', sql.Date, clean(fromdate))
    .input('to', sql.Date, clean(todate))
    .query(`SELECT id, LTRIM(RTRIM(leavetype)) AS leavetype, LTRIM(RTRIM(reason)) AS reason,
                   fromdate, todate, days, ishalfday, halfdaypart
            FROM ${LEAVE_REQUEST_TABLE}
            WHERE LTRIM(RTRIM(paycode)) = @paycode AND LTRIM(RTRIM(status)) = '${LEAVE_STATUS.APPROVED}'
              AND todate >= @from AND fromdate <= @to
            ORDER BY fromdate`);
  return (r.recordset || []).map(mapRequest);
}

/**
 * Expand approved requests into individual calendar dates, so the calendar can
 * colour each day without re-implementing range logic on the client.
 */
export async function getLeaveCalendarOverlay(pool, { paycode, fromdate, todate }) {
  const requests = await listApprovedLeaveDates(pool, { paycode, fromdate, todate });
  const byDate = new Map();
  for (const req of requests) {
    const total = daysBetweenInclusive(req.fromdate, req.todate);
    for (let i = 0; i < total; i += 1) {
      const iso = addDays(req.fromdate, i);
      const list = byDate.get(iso) || [];
      list.push({ id: req.id, leavetype: req.leavetype, typename: req.typename, reason: req.reason, isHalfDay: req.isHalfDay });
      byDate.set(iso, list);
    }
  }
  return {
    fromdate: clean(fromdate),
    todate: clean(todate),
    dates: [...byDate.entries()].map(([date, list]) => ({ date, leaves: list })),
  };
}

/* ------------------------------------------------------------------ */
/* Excel import (Phase J section 2)                                    */
/* ------------------------------------------------------------------ */

/**
 * Parse a spreadsheet value as a number.
 *
 * Returns null for anything that is not genuinely numeric. Text such as "ten"
 * must NOT become 0, because a row like that has to fail loudly in the import
 * summary rather than silently overwrite a real balance with zero.
 */
const num = (v) => {
  if (v === null || v === undefined) return null;
  if (typeof v === 'number') return Number.isFinite(v) ? Math.round(v * 100) / 100 : null;
  const raw = String(v).trim();
  if (!raw) return null;
  // Strip thousands separators and a trailing "%" is NOT accepted.
  const stripped = raw.replace(/,/g, '');
  if (!/^-?\d*\.?\d+$/.test(stripped)) return null;
  const n = Number(stripped);
  return Number.isFinite(n) ? Math.round(n * 100) / 100 : null;
};

/**
 * Import opening balances from parsed Excel rows.
 *
 * Expected columns: EmployeeCode, BiometricCode, EmployeeName, LeaveYear,
 * LeaveType, OpeningBalance.
 *
 * Identity is VALIDATED against the real active roster. A row whose employee
 * cannot be matched is never silently dropped and never guessed - it lands in
 * `failed` with a reason, so the summary is trustworthy.
 *
 * Returns { imported, updated, skipped, failed, errors[], rows[] }.
 */
export async function importLeaveBalances(pool, { rows, actor }) {
  await ensureLeaveTables(pool);
  const summary = { imported: 0, updated: 0, skipped: 0, failed: 0, errors: [], results: [] };
  const list = Array.isArray(rows) ? rows : [];

  if (!list.length) {
    summary.errors.push('No rows found in the file.');
    return summary;
  }

  for (let index = 0; index < list.length; index += 1) {
    const row = list[index] || {};
    const excelRow = index + 2; // row 1 is the header
    const code = clean(row.EmployeeCode ?? row.employeeCode);
    const biometric = clean(row.BiometricCode ?? row.biometricCode);
    const nameInFile = clean(row.EmployeeName ?? row.employeeName);
    const year = num(row.LeaveYear ?? row.leaveYear);
    const type = upper(row.LeaveType ?? row.leaveType);
    const opening = num(row.OpeningBalance ?? row.openingBalance);

    const fail = (message) => {
      summary.failed += 1;
      summary.errors.push({ row: excelRow, employeeCode: code, message });
      summary.results.push({ row: excelRow, employeeCode: code, status: 'Failed', message });
    };

    if (!code) { fail('EmployeeCode is empty.'); continue; }
    if (!year || year < 2000 || year > 2200) { fail(`LeaveYear "${row.LeaveYear ?? ''}" is not a valid year.`); continue; }
    if (!type) { fail('LeaveType is empty.'); continue; }
    if (opening === null) { fail(`OpeningBalance "${row.OpeningBalance ?? ''}" is not a number.`); continue; }
    if (opening < 0) { fail('OpeningBalance cannot be negative.'); continue; }

    if (!(await leaveTypeExists(pool, type))) {
      fail(`LeaveType "${type}" does not exist. Add it first in Leave Types.`);
      continue;
    }

    // ---- identity validation against the real roster ----
    const employee = await findActiveEmployee(pool, code);
    if (!employee) {
      fail(`EmployeeCode "${code}" was not found among active employees. Nothing was imported for this row.`);
      continue;
    }
    if (biometric && employee.presentcardno && clean(biometric).toUpperCase() !== clean(employee.presentcardno).toUpperCase()) {
      fail(`BiometricCode "${biometric}" does not match the saved code "${clean(employee.presentcardno)}" for employee ${code}.`);
      continue;
    }
    if (nameInFile && employee.empname && clean(nameInFile).toUpperCase() !== clean(employee.empname).toUpperCase()) {
      fail(`EmployeeName "${nameInFile}" does not match "${clean(employee.empname)}" for employee ${code}.`);
      continue;
    }

    // ---- upsert opening balance ----
    const existing = await pool.request()
      .input('paycode', sql.NVarChar(50), employee.paycode)
      .input('year', sql.Int, year)
      .input('type', sql.NVarChar(10), type)
      .query(`SELECT TOP 1 id, openingbalance FROM ${LEAVE_BALANCE_TABLE}
              WHERE LTRIM(RTRIM(paycode)) = @paycode AND leaveyear = @year AND LTRIM(RTRIM(leavetype)) = @type`);

    if (existing.recordset?.[0]) {
      if (round2(existing.recordset[0].openingbalance) === opening) {
        summary.skipped += 1;
        summary.results.push({ row: excelRow, employeeCode: employee.paycode, leaveyear: year, leavetype: type, status: 'Skipped', message: 'Opening balance is unchanged.' });
        continue;
      }
      await pool.request()
        .input('id', sql.Int, existing.recordset[0].id)
        .input('opening', sql.Decimal(9, 2), opening)
        .input('by', sql.NVarChar(50), clean(actor).slice(0, 50))
        .query(`UPDATE ${LEAVE_BALANCE_TABLE}
                SET openingbalance = @opening, updateddate = SYSUTCDATETIME(), updatedby = @by
                WHERE id = @id`);
      summary.updated += 1;
      summary.results.push({ row: excelRow, employeeCode: employee.paycode, empname: employee.empname, leaveyear: year, leavetype: type, openingBalance: opening, status: 'Updated' });
    } else {
      await pool.request()
        .input('paycode', sql.NVarChar(50), employee.paycode)
        .input('year', sql.Int, year)
        .input('type', sql.NVarChar(10), type)
        .input('opening', sql.Decimal(9, 2), opening)
        .input('by', sql.NVarChar(50), clean(actor).slice(0, 50))
        .query(`INSERT INTO ${LEAVE_BALANCE_TABLE} (paycode, leaveyear, leavetype, openingbalance, updatedby)
                VALUES (@paycode, @year, @type, @opening, @by)`);
      summary.imported += 1;
      summary.results.push({ row: excelRow, employeeCode: employee.paycode, empname: employee.empname, leaveyear: year, leavetype: type, openingBalance: opening, status: 'Imported' });
    }
  }

  return summary;
}

/** A ready-to-fill template so HR imports the exact expected columns. */
export function leaveImportTemplateRows() {
  return [[
    'EmployeeCode', 'BiometricCode', 'EmployeeName',
    'LeaveYear', 'LeaveType', 'OpeningBalance',
  ]];
}

/* ------------------------------------------------------------------ */
/* PROVIDER SEAM (Phase J section 7) — no Navision code here           */
/* ------------------------------------------------------------------ */

/**
 * The application provider. Routes and screens only ever talk to whatever
 * getLeaveProvider() returns, so the storage backend can be replaced later
 * without touching a single route or screen.
 */
const applicationLeaveProvider = {
  name: 'application',
  isNavision: false,
  listTypes: (pool, opts) => listLeaveTypes(pool, opts),
  addType: (pool, p) => addLeaveType(pool, p),
  getConfig: (pool) => getLeaveConfig(pool),
  setConfig: (pool, patch, actor) => setLeaveConfig(pool, patch, actor),
  getBalance: (pool, p) => getLeaveBalance(pool, p),
  listBalances: (pool, p) => listEmployeeBalances(pool, p),
  listRequests: (pool, p) => listLeaveRequests(pool, p),
  listAllRequests: (pool, p) => listAllLeaveRequests(pool, p),
  createRequest: (pool, p) => createLeaveRequest(pool, p),
  cancelRequest: (pool, p) => cancelLeaveRequest(pool, p),
  decideRequest: (pool, p) => decideLeaveRequest(pool, p),
  importBalances: (pool, p) => importLeaveBalances(pool, p),
  calendarOverlay: (pool, p) => getLeaveCalendarOverlay(pool, p),
};

/**
 * Resolve the active leave provider.
 *
 * Today this always returns the application provider. A future Navision
 * integration registers its adapter here and NOTHING else changes. The
 * NAVISION_ENABLED flag is read but deliberately not acted on here: no Navision
 * client exists in this phase, by design.
 */
const PROVIDERS = new Map([['application', applicationLeaveProvider]]);

export async function getLeaveProvider(name = 'application') {
  await Promise.resolve();
  const provider = PROVIDERS.get(name);
  if (!provider) throw new Error(`Unknown leave provider "${name}".`);
  return provider;
}

export const leaveTables = {
  types: LEAVE_TYPES_TABLE,
  balance: LEAVE_BALANCE_TABLE,
  request: LEAVE_REQUEST_TABLE,
  config: LEAVE_CONFIG_TABLE,
};
