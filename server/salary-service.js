// ============================================================================
// FILE: server/salary-service.js
// PURPOSE: Phase K - Salary import + Full & Final estimation engine.
// ============================================================================

/**
 * Phase K: application-owned salary configuration, pay elements and the
 * transparent Full & Final ESTIMATION engine.
 *
 * STORAGE (100% APPLICATION tables - NOT Savior tables):
 *   dbo.HR_SalaryMaster   - Dataset A: basic salary + PF/ESI applicability/wages
 *   dbo.HR_SalaryElement  - Dataset B: earnings / deductions / employer contributions
 *   dbo.HR_SalaryConfig   - company settlement rules (gratuity, bonus, encashment,
 *                           notice, PF, ESI) - all configurable, nothing hardcoded
 *   dbo.HR_SalaryDues     - HR-approved other dues / recoveries
 *
 * dbo.tblemployee / dbo.tblcategory are only READ (identity, DOJ, leaving date,
 * category). No Savior table is created, altered or written.
 *
 * CALCULATION PRINCIPLE:
 *   Basic + Applicable Earnings = Gross.
 *   Employee deductions stay SEPARATE (never merged into gross).
 *   Employer contributions stay SEPARATE (never part of the F&F payable total).
 *   Every component returns its inputs + formula basis, so the estimate is
 *   fully auditable. The output is ALWAYS labelled an estimate - never a final,
 *   legally approved settlement.
 */

import { sql } from './db.js';
import { findActiveEmployee, getLeaveBalance, ensureLeaveTables } from './leave-service.js';
import { validatePayElementCode } from './salary-structure-service.js';

const SALARY_MASTER_TABLE = process.env.HR_SALARY_MASTER_TABLE || 'dbo.HR_SalaryMaster';
const SALARY_ELEMENT_TABLE = process.env.HR_SALARY_ELEMENT_TABLE || 'dbo.HR_SalaryElement';
const SALARY_CONFIG_TABLE = process.env.HR_SALARY_CONFIG_TABLE || 'dbo.HR_SalaryConfig';
const SALARY_DUES_TABLE = process.env.HR_SALARY_DUES_TABLE || 'dbo.HR_SalaryDues';
// Bonus settlement history (app-managed HR_ table, same auto-create migration
// pattern as the tables above; the Savior schema itself is never modified).
const SALARY_BONUS_SETTLEMENT_TABLE = process.env.HR_SALARY_BONUS_SETTLEMENT_TABLE || 'dbo.HR_SalaryBonusSettlement';

export const PAY_ELEMENT_TYPES = ['EARNING', 'DEDUCTION', 'EMPLOYER_CONTRIBUTION'];
export const CALC_TYPES = ['FIXED', 'PERCENTAGE'];
export const PCT_BASES = ['BASIC', 'GROSS', 'PF_WAGE', 'ESI_WAGE'];
export const DUES_CATEGORIES = ['DUE', 'RECOVERY'];
export const DUES_STATUS = { PENDING: 'Pending', APPROVED: 'Approved', REJECTED: 'Rejected' };

export const DISCLAIMER =
  'This is an ESTIMATE only, produced from the configured rules and imported salary data. ' +
  'It is NOT a final or legally approved settlement. Official settlement is calculated and approved by HR.';

/* ------------------------------------------------------------------ */
/* Small helpers (same semantics as leave-service.js)                   */
/* ------------------------------------------------------------------ */

const clean = (v) => String(v == null ? '' : v).trim();
const upper = (v) => clean(v).toUpperCase();
const round2 = (n) => Math.round((Number(n) || 0) * 100) / 100;

const todayIso = () => new Date().toISOString().slice(0, 10);

function addDays(iso, days) {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

function yearOf(iso) {
  return Number(String(iso).slice(0, 4));
}

function isValidIsoDate(v) {
  const s = clean(v);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
  const d = new Date(`${s}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s;
}

/** SQL DATE columns come back as local Dates - normalise without UTC shift. */
function toIsoDate(value) {
  if (value instanceof Date) {
    if (Number.isNaN(value.getTime())) return '';
    return `${value.getFullYear()}-${String(value.getMonth() + 1).padStart(2, '0')}-${String(value.getDate()).padStart(2, '0')}`;
  }
  const s = clean(value);
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(s);
  return m ? `${m[1]}-${m[2]}-${m[3]}` : s;
}

function daysBetweenInclusive(fromIso, toIso) {
  const a = Date.parse(`${fromIso}T00:00:00Z`);
  const b = Date.parse(`${toIso}T00:00:00Z`);
  return Math.floor((b - a) / 86400000) + 1;
}

/** Spreadsheet value -> number, or null when genuinely not numeric. */
const num = (v) => {
  if (v === null || v === undefined) return null;
  if (typeof v === 'number') return Number.isFinite(v) ? Math.round(v * 10000) / 10000 : null;
  const raw = String(v).trim();
  if (!raw) return null;
  const stripped = raw.replace(/,/g, '');
  if (!/^-?\d*\.?\d+$/.test(stripped)) return null;
  const n = Number(stripped);
  return Number.isFinite(n) ? Math.round(n * 10000) / 10000 : null;
};

/** 'Y'/'N'-style flag parse. Returns null for unrecognised input. */
const yesNo = (v) => {
  const s = upper(v);
  if (['Y', 'YES', 'TRUE', '1', 'T'].includes(s)) return true;
  if (['N', 'NO', 'FALSE', '0', 'F'].includes(s)) return false;
  return null;
};

/** Completed service years / months / days between DOJ and leaving date. */
function servicePeriod(joinIso, leaveIso) {
  if (!isValidIsoDate(joinIso) || !isValidIsoDate(leaveIso) || leaveIso < joinIso) return null;
  const [jy, jm, jd] = joinIso.split('-').map(Number);
  const [ly, lm, ld] = leaveIso.split('-').map(Number);
  let years = ly - jy;
  let months = lm - jm;
  let days = ld - jd;
  if (days < 0) {
    months -= 1;
    days += new Date(Date.UTC(ly, lm - 1, 0)).getUTCDate();
  }
  if (months < 0) { years -= 1; months += 12; }
  return { years, months, days };
}

/** Completed calendar months between two ISO dates (partial month not counted).
 *  2025-12-01 -> 2026-01-01 = 1; 2025-12-15 -> 2026-01-01 = 0. */
function completedMonthsBetween(fromIso, toIso) {
  if (!isValidIsoDate(fromIso) || !isValidIsoDate(toIso) || toIso < fromIso) return 0;
  let m = (yearOf(toIso) - yearOf(fromIso)) * 12 + (Number(toIso.slice(5, 7)) - Number(fromIso.slice(5, 7)));
  if (Number(toIso.slice(8, 10)) < Number(fromIso.slice(8, 10))) m -= 1;
  return Math.max(0, m);
}

/**
 * DOCUMENTED month/day proration (deterministic): an inclusive date range is
 * split into calendar-month segments; each segment contributes
 *   segmentDays / daysInThatCalendarMonth
 * of one month. Every calendar day is counted EXACTLY ONCE (adjacent segments
 * share no dates, so boundary dates can never double-count), leap-year February
 * contributes /29 automatically, and partial months prorate by their real
 * length. E.g. 01-Dec-2025..31-Oct-2026 = 11.0 months (11 full months + 0).
 */
function monthFractionOfRange(fromIso, toIso) {
  const segments = [];
  if (!isValidIsoDate(fromIso) || !isValidIsoDate(toIso) || toIso < fromIso) return { months: 0, segments };
  let cursor = fromIso;
  while (cursor <= toIso) {
    const y = yearOf(cursor);
    const m = Number(cursor.slice(5, 7));
    const daysInMonth = new Date(Date.UTC(y, m, 0)).getUTCDate();
    const monthEnd = `${y}-${String(m).padStart(2, '0')}-${String(daysInMonth).padStart(2, '0')}`;
    const segTo = monthEnd < toIso ? monthEnd : toIso;
    const segDays = daysBetweenInclusive(cursor, segTo);
    segments.push({ from: cursor, to: segTo, days: segDays, daysInMonth, fraction: segDays / daysInMonth });
    cursor = addDays(segTo, 1);
  }
  return { months: segments.reduce((s, x) => s + x.fraction, 0), segments };
}

/** Inclusive range minus already-settled ranges -> remaining (unsettled) ranges. */
function subtractRanges(fromIso, toIso, covered) {
  let gaps = [{ from: fromIso, to: toIso }];
  for (const c of covered || []) {
    const next = [];
    for (const g of gaps) {
      if (c.to < g.from || c.from > g.to) { next.push(g); continue; }
      if (c.from > g.from) next.push({ from: g.from, to: addDays(c.from, -1) });
      if (c.to < g.to) next.push({ from: addDays(c.to, 1), to: g.to });
    }
    gaps = next;
  }
  return gaps.filter((g) => g.from <= g.to);
}


/* ------------------------------------------------------------------ */
/* Company settlement configuration (ALL rules configurable)            */
/* ------------------------------------------------------------------ */

/**
 * Defaults are STATUTORY-STYLE starting points, clearly displayed as text in
 * the estimate. HR can change every one of them; nothing is hardcoded in the
 * calculation path.
 */
export const DEFAULT_CONFIG = {
  // Gratuity: "X days' basic wages per completed year, service >= Y years"
  GratuityEnabled: 'Y',
  GratuityDaysPerYear: '15',
  GratuityWageDivisor: '26',
  GratuityQualifyingYears: '5',
  GratuityWageBasis: 'BASIC',            // BASIC | GROSS
  // Bonus: period is HR-configured - NEVER a hardcoded month.
  BonusEnabled: 'N',
  BonusPeriodStart: '',                  // YYYY-MM-DD
  BonusPeriodEnd: '',                    // YYYY-MM-DD
  BonusRule: 'PERCENTAGE_BASIC',         // FIXED | PERCENTAGE_BASIC | PERCENTAGE_GROSS
  BonusRate: '0',                        // annual amount (FIXED) or percentage
  BonusEligibilityMinMonths: '0',        // min service months at leaving date
  BonusProrate: 'Y',                     // Y = month/day accrual (annual/12 per eligible month); N = full-eligibility rule
  // Leave encashment (types per staff group; OLA/OLB excluded by default)
  LeaveEncashmentEnabled: 'Y',
  LeaveEncashmentTypesFactory: 'PL,SL,CL',
  LeaveEncashmentTypesOffice: 'PL',
  LeaveEncashmentTypesDefault: 'PL',
  LeaveEncashmentBasis: 'BASIC',         // BASIC | GROSS
  LeaveEncashmentWageDivisor: '365',     // days per YEAR: daily salary = monthly basis x 12 / divisor
  LeaveEncashmentMaxDays: '0',           // 0 = no cap
  // Notice pay / recovery
  NoticePeriodDays: '30',
  NoticeSalaryBasis: 'GROSS',            // BASIC | GROSS
  NoticeWageDivisor: '30',
  // Statutory PF / ESI (applicability per employee comes from Dataset A)
  PFRateEmployee: '12',
  PFRateEmployer: '12',
  PFWageBasis: 'PF_WAGE',                // PF_WAGE | BASIC
  ESIRateEmployee: '0.75',
  ESIRateEmployer: '3.25',
  ESIWageBasis: 'ESI_WAGE',              // ESI_WAGE | BASIC
  ESIWageCeiling: '0',                   // 0 = no ceiling
};

const CONFIG_RULES = {
  GratuityEnabled: (v) => (yesNo(v) === null ? 'must be Y or N' : null),
  GratuityDaysPerYear: (v) => (num(v) === null || num(v) < 0 ? 'must be a number >= 0' : null),
  GratuityWageDivisor: (v) => (num(v) === null || num(v) <= 0 ? 'must be a number > 0' : null),
  GratuityQualifyingYears: (v) => (num(v) === null || num(v) < 0 ? 'must be a number >= 0' : null),
  GratuityWageBasis: (v) => (['BASIC', 'GROSS'].includes(upper(v)) ? null : 'must be BASIC or GROSS'),
  BonusEnabled: (v) => (yesNo(v) === null ? 'must be Y or N' : null),
  BonusPeriodStart: (v) => (!clean(v) || isValidIsoDate(v) ? null : 'must be YYYY-MM-DD or empty'),
  BonusPeriodEnd: (v) => (!clean(v) || isValidIsoDate(v) ? null : 'must be YYYY-MM-DD or empty'),
  BonusRule: (v) => (['FIXED', 'PERCENTAGE_BASIC', 'PERCENTAGE_GROSS'].includes(upper(v)) ? null : 'invalid bonus rule'),
  BonusRate: (v) => (num(v) === null || num(v) < 0 ? 'must be a number >= 0' : null),
  BonusEligibilityMinMonths: (v) => (num(v) === null || num(v) < 0 ? 'must be a number >= 0' : null),
  BonusProrate: (v) => (yesNo(v) === null ? 'must be Y or N' : null),
  LeaveEncashmentEnabled: (v) => (yesNo(v) === null ? 'must be Y or N' : null),
  LeaveEncashmentBasis: (v) => (['BASIC', 'GROSS'].includes(upper(v)) ? null : 'must be BASIC or GROSS'),
  LeaveEncashmentWageDivisor: (v) => (num(v) === null || num(v) <= 0 ? 'must be a number > 0' : null),
  LeaveEncashmentMaxDays: (v) => (num(v) === null || num(v) < 0 ? 'must be a number >= 0' : null),
  NoticePeriodDays: (v) => (num(v) === null || num(v) < 0 ? 'must be a number >= 0' : null),
  NoticeSalaryBasis: (v) => (['BASIC', 'GROSS'].includes(upper(v)) ? null : 'must be BASIC or GROSS'),
  NoticeWageDivisor: (v) => (num(v) === null || num(v) <= 0 ? 'must be a number > 0' : null),
  PFRateEmployee: (v) => (num(v) === null || num(v) < 0 ? 'must be a number >= 0' : null),
  PFRateEmployer: (v) => (num(v) === null || num(v) < 0 ? 'must be a number >= 0' : null),
  PFWageBasis: (v) => (['PF_WAGE', 'BASIC'].includes(upper(v)) ? null : 'must be PF_WAGE or BASIC'),
  ESIRateEmployee: (v) => (num(v) === null || num(v) < 0 ? 'must be a number >= 0' : null),
  ESIRateEmployer: (v) => (num(v) === null || num(v) < 0 ? 'must be a number >= 0' : null),
  ESIWageBasis: (v) => (['ESI_WAGE', 'BASIC'].includes(upper(v)) ? null : 'must be ESI_WAGE or BASIC'),
  ESIWageCeiling: (v) => (num(v) === null || num(v) < 0 ? 'must be a number >= 0' : null),
};


/* ------------------------------------------------------------------ */
/* Schema ensure - the project's "HR_ table" auto-create pattern.       */
/* ------------------------------------------------------------------ */

let ensureState = null; // null = unknown, true = ready, string = error

export async function ensureSalaryTables(pool) {
  if (ensureState === true) return;
  if (typeof ensureState === 'string') throw new Error(ensureState);
  try {
    await pool.request().batch(`
IF OBJECT_ID('${SALARY_MASTER_TABLE}','U') IS NULL
CREATE TABLE ${SALARY_MASTER_TABLE} (
  id INT IDENTITY(1,1) PRIMARY KEY,
  paycode NVARCHAR(50) NOT NULL,
  effectivefrom DATE NOT NULL,
  basicsalary NUMERIC(12,2) NOT NULL CONSTRAINT DF_SalMaster_Basic DEFAULT(0),
  pfapplicable BIT NOT NULL CONSTRAINT DF_SalMaster_Pf DEFAULT(0),
  esiapplicable BIT NOT NULL CONSTRAINT DF_SalMaster_Esi DEFAULT(0),
  pfwage NUMERIC(12,2) NOT NULL CONSTRAINT DF_SalMaster_PfWage DEFAULT(0),
  esiwage NUMERIC(12,2) NOT NULL CONSTRAINT DF_SalMaster_EsiWage DEFAULT(0),
  createddate DATETIME2 NOT NULL CONSTRAINT DF_SalMaster_Created DEFAULT SYSUTCDATETIME(),
  updateddate DATETIME2 NOT NULL CONSTRAINT DF_SalMaster_Updated DEFAULT SYSUTCDATETIME(),
  updatedby NVARCHAR(50) NULL,
  CONSTRAINT UQ_SalMaster UNIQUE (paycode, effectivefrom)
);

IF OBJECT_ID('${SALARY_ELEMENT_TABLE}','U') IS NULL
CREATE TABLE ${SALARY_ELEMENT_TABLE} (
  id INT IDENTITY(1,1) PRIMARY KEY,
  paycode NVARCHAR(50) NOT NULL,
  payelementcode NVARCHAR(20) NOT NULL,
  payelementname NVARCHAR(100) NOT NULL,
  payelementtype NVARCHAR(30) NOT NULL,
  calculationtype NVARCHAR(20) NOT NULL,
  amount NUMERIC(12,2) NULL,
  percentage NUMERIC(9,4) NULL,
  percentagebase NVARCHAR(20) NULL,
  effectivefrom DATE NOT NULL,
  createddate DATETIME2 NOT NULL CONSTRAINT DF_SalElem_Created DEFAULT SYSUTCDATETIME(),
  updateddate DATETIME2 NOT NULL CONSTRAINT DF_SalElem_Updated DEFAULT SYSUTCDATETIME(),
  updatedby NVARCHAR(50) NULL,
  CONSTRAINT UQ_SalElem UNIQUE (paycode, payelementcode, effectivefrom)
);

IF OBJECT_ID('${SALARY_CONFIG_TABLE}','U') IS NULL
CREATE TABLE ${SALARY_CONFIG_TABLE} (
  id INT IDENTITY(1,1) PRIMARY KEY,
  configkey NVARCHAR(60) NOT NULL,
  configvalue NVARCHAR(200) NULL,
  updatedat DATETIME2 NOT NULL CONSTRAINT DF_SalCfg_Updated DEFAULT SYSUTCDATETIME(),
  updatedby NVARCHAR(50) NULL,
  CONSTRAINT UQ_SalCfg_Key UNIQUE (configkey)
);

IF OBJECT_ID('${SALARY_DUES_TABLE}','U') IS NULL
CREATE TABLE ${SALARY_DUES_TABLE} (
  id INT IDENTITY(1,1) PRIMARY KEY,
  paycode NVARCHAR(50) NOT NULL,
  category NVARCHAR(20) NOT NULL,
  kind NVARCHAR(40) NOT NULL,
  description NVARCHAR(200) NULL,
  amount NUMERIC(12,2) NOT NULL,
  status NVARCHAR(20) NOT NULL CONSTRAINT DF_SalDues_Status DEFAULT('Pending'),
  applieddate DATETIME2 NOT NULL CONSTRAINT DF_SalDues_Applied DEFAULT SYSUTCDATETIME(),
  decidedby NVARCHAR(50) NULL,
  decidedat DATETIME2 NULL,
  decisionnote NVARCHAR(500) NULL,
  createdby NVARCHAR(50) NULL,
  updatedat DATETIME2 NOT NULL CONSTRAINT DF_SalDues_Updated DEFAULT SYSUTCDATETIME()
);

IF OBJECT_ID('${SALARY_BONUS_SETTLEMENT_TABLE}','U') IS NULL
CREATE TABLE ${SALARY_BONUS_SETTLEMENT_TABLE} (
  id INT IDENTITY(1,1) PRIMARY KEY,
  paycode NVARCHAR(50) NOT NULL,
  bonusperiodstart DATE NOT NULL,
  bonusperiodend DATE NOT NULL,
  servicestart DATE NOT NULL,
  serviceend DATE NOT NULL,
  amount NUMERIC(12,2) NOT NULL,
  status NVARCHAR(20) NOT NULL CONSTRAINT DF_SalBonusSettle_Status DEFAULT('Settled'),
  note NVARCHAR(500) NULL,
  createdat DATETIME2 NOT NULL CONSTRAINT DF_SalBonusSettle_Created DEFAULT SYSUTCDATETIME(),
  createdby NVARCHAR(50) NULL,
  CONSTRAINT UQ_SalBonusSettle UNIQUE (paycode, bonusperiodstart, bonusperiodend, servicestart, serviceend)
);`);

    // Seed config defaults ONCE (only when the table is empty) so an HR-managed
    // configuration is never overwritten on restart.
    const seeded = await pool.request().query(`SELECT COUNT(1) AS n FROM ${SALARY_CONFIG_TABLE}`);
    if (!Number(seeded.recordset?.[0]?.n)) {
      const rows = Object.entries(DEFAULT_CONFIG)
        .map(([k, v]) => `('${k}', '${String(v).replace(/'/g, "''")}')`)
        .join(',\n      ');
      await pool.request().query(`INSERT INTO ${SALARY_CONFIG_TABLE} (configkey, configvalue) VALUES\n      ${rows}`);
    }

    // One-time normalisation: the leave-encashment divisor changed MEANING from
    // "wage days per month" (daily = monthly / 26) to "days per year"
    // (daily = monthly x 12 / 365). The legacy stored '26' (the old default) is
    // migrated to '365' so the engine and the displayed config agree; any other
    // HR-set value is left untouched.
    await pool.request().query(`
      UPDATE ${SALARY_CONFIG_TABLE} SET configvalue = '365', updatedat = SYSUTCDATETIME()
      WHERE LTRIM(RTRIM(configkey)) = 'LeaveEncashmentWageDivisor'
        AND (configvalue IS NULL OR LTRIM(RTRIM(configvalue)) IN ('', '26'))`);
    ensureState = true;
  } catch (error) {
    ensureState = `Salary tables unavailable: ${String(error?.message || error || '')}`;
    throw new Error(ensureState);
  }
}

/** Config values with defaults applied and typed accessors. */
export async function getSalaryConfig(pool) {
  await ensureSalaryTables(pool);
  const r = await pool.request().query(`SELECT LTRIM(RTRIM(configkey)) AS configkey, configvalue FROM ${SALARY_CONFIG_TABLE}`);
  const raw = { ...DEFAULT_CONFIG };
  for (const row of r.recordset || []) raw[clean(row.configkey)] = clean(row.configvalue);
  return {
    raw,
    flag: (k) => yesNo(raw[k]) === true,
    n: (k) => num(raw[k]) ?? 0,
    s: (k) => clean(raw[k]),
  };
}

/** HR updates settlement rules. Unknown keys and invalid values are rejected. */

/* ------------------------------------------------------------------ */
/* DATASET A - salary master import                                     */
/* ------------------------------------------------------------------ */

/**
 * Import / upsert salary master rows (one row per employee + EffectiveFrom).
 * Identity is validated against the REAL active roster. Every invalid row is
 * reported as Failed with a reason - never silently dropped.
 */
export async function importSalaryMaster(pool, { rows, actor, companyScope }) {
  await ensureSalaryTables(pool);
  const summary = { imported: 0, updated: 0, skipped: 0, failed: 0, errors: [], results: [], warnings: [] };
  const list = Array.isArray(rows) ? rows : [];
  if (!list.length) {
    summary.errors.push('No rows found in the file.');
    return summary;
  }
  const seen = new Map(); // in-file duplicate detection (same key twice in one file)

  for (let index = 0; index < list.length; index += 1) {
    const row = list[index] || {};
    const excelRow = index + 2; // row 1 is the header
    const code = clean(row.EmployeeCode ?? row.employeeCode);
    const biometric = clean(row.BiometricCode ?? row.biometricCode);
    const nameInFile = clean(row.EmployeeName ?? row.employeeName);
    const effectiveRaw = row.EffectiveFrom ?? row.effectiveFrom;
    const effective = toIsoDate(effectiveRaw);
    const basic = num(row.BasicSalary ?? row.basicSalary);
    const pfFlag = yesNo(row.PFApplicable ?? row.pfApplicable);
    const esiFlag = yesNo(row.ESIApplicable ?? row.esiApplicable);
    const pfWage = num(row.PFWage ?? row.pfWage);
    const esiWage = num(row.ESIWage ?? row.esiWage);

    const fail = (message) => {
      summary.failed += 1;
      summary.errors.push({ row: excelRow, employeeCode: code, message });
      summary.results.push({ row: excelRow, employeeCode: code, status: 'Failed', message });
    };

    if (!code) { fail('EmployeeCode is empty.'); continue; }
    if (!isValidIsoDate(effective)) { fail(`EffectiveFrom "${effectiveRaw ?? ''}" is not a valid date (YYYY-MM-DD).`); continue; }
    if (basic === null || basic < 0) { fail(`BasicSalary "${row.BasicSalary ?? ''}" is not a number >= 0.`); continue; }
    if (pfFlag === null) { fail(`PFApplicable "${row.PFApplicable ?? ''}" must be Y or N.`); continue; }
    if (esiFlag === null) { fail(`ESIApplicable "${row.ESIApplicable ?? ''}" must be Y or N.`); continue; }
    if (pfFlag && (pfWage === null || pfWage < 0)) { fail('PFWage is required (number >= 0) when PFApplicable is Y.'); continue; }
    if (esiFlag && (esiWage === null || esiWage < 0)) { fail('ESIWage is required (number >= 0) when ESIApplicable is Y.'); continue; }

    const employee = await findActiveEmployee(pool, code);
    if (!employee) {
      fail(`EmployeeCode "${code}" was not found among active employees. Nothing was imported for this row.`);
      continue;
    }
    /* PROMPT 4.2 — the row's employee must belong to a company assigned to this HR
       Admin, otherwise the row is reported Failed and nothing is written. */
    const masterScope = await paycodeCompanyAllowed(pool, employee.paycode, companyScope);
    if (!masterScope.allowed) {
      fail(`EmployeeCode "${code}" belongs to a company outside your access.`);
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

    const pfW = pfWage === null ? 0 : pfWage;
    const esiW = esiWage === null ? 0 : esiWage;
    const record = {
      row: excelRow, employeeCode: employee.paycode, empname: employee.empname,
      effectivefrom: effective, basicsalary: round2(basic), pfapplicable: pfFlag,
      esiapplicable: esiFlag, pfwage: round2(pfW), esiwage: round2(esiW),
    };

    // In-file duplicates for the same EmployeeCode + EffectiveFrom: identical
    // rows are reported as duplicates of the first row; conflicting values are
    // reported and NOT applied (no silent last-wins overwrite).
    const dupKey = `${upper(employee.paycode)}|${effective}`;
    const dupSig = JSON.stringify([round2(basic), pfFlag, esiFlag, round2(pfW), round2(esiW)]);
    if (seen.has(dupKey)) {
      const prev = seen.get(dupKey);
      if (prev.sig === dupSig) {
        summary.skipped += 1;
        summary.results.push({ ...record, status: 'Skipped', message: `Duplicate of row ${prev.row} in file (same EmployeeCode + EffectiveFrom and values).` });
      } else {
        fail(`Conflicts with row ${prev.row} in file for the same EmployeeCode + EffectiveFrom (different salary values) - fix the file and re-import.`);
      }
      continue;
    }
    seen.set(dupKey, { row: excelRow, sig: dupSig });

    await upsertMasterRow(pool, summary, record, { basic, pfFlag, esiFlag, pfW, esiW, actor });
  }
  return summary;
}

export async function setSalaryConfig(pool, patch, actor) {
  await ensureSalaryTables(pool);
  const applied = [];
  for (const [key, value] of Object.entries(patch || {})) {
    if (!(key in DEFAULT_CONFIG)) continue; // unknown key: ignore, never write
    const str = value === null || value === undefined ? '' : String(value).trim();
    const rule = CONFIG_RULES[key];
    if (rule) {
      const problem = rule(str);
      if (problem) return { ok: false, status: 400, code: 'INVALID_CONFIG', message: `${key} ${problem}.` };
    }
    await pool.request()
      .input('key', sql.NVarChar(60), key)
      .input('value', sql.NVarChar(200), str)
      .input('by', sql.NVarChar(50), clean(actor).slice(0, 50))
      .query(`UPDATE ${SALARY_CONFIG_TABLE} SET configvalue = @value, updatedat = SYSUTCDATETIME(), updatedby = @by
              WHERE configkey = @key`);
    applied.push(key);
  }
  return { ok: true, applied };
}

async function upsertMasterRow(pool, summary, record, v) {
  const existing = await pool.request()
    .input('paycode', sql.NVarChar(50), record.employeeCode)
    .input('from', sql.Date, record.effectivefrom)
    .query(`SELECT TOP 1 id, basicsalary, pfapplicable, esiapplicable, pfwage, esiwage
            FROM ${SALARY_MASTER_TABLE}
            WHERE LTRIM(RTRIM(paycode)) = @paycode AND effectivefrom = @from`);
  const sameValues = (db) => round2(db.basicsalary) === round2(v.basic)
    && Boolean(db.pfapplicable) === v.pfFlag && Boolean(db.esiapplicable) === v.esiFlag
    && round2(db.pfwage) === round2(v.pfW) && round2(db.esiwage) === round2(v.esiW);

  if (existing.recordset?.[0]) {
    if (sameValues(existing.recordset[0])) {
      summary.skipped += 1;
      summary.results.push({ ...record, status: 'Skipped', message: 'Salary row is unchanged.' });
      return;
    }
    await pool.request()
      .input('id', sql.Int, existing.recordset[0].id)
      .input('basic', sql.Decimal(12, 2), v.basic)
      .input('pf', sql.Bit, v.pfFlag ? 1 : 0)
      .input('esi', sql.Bit, v.esiFlag ? 1 : 0)
      .input('pfw', sql.Decimal(12, 2), v.pfW)
      .input('esiw', sql.Decimal(12, 2), v.esiW)
      .input('by', sql.NVarChar(50), clean(v.actor).slice(0, 50))
      .query(`UPDATE ${SALARY_MASTER_TABLE}
              SET basicsalary = @basic, pfapplicable = @pf, esiapplicable = @esi,
                  pfwage = @pfw, esiwage = @esiw, updateddate = SYSUTCDATETIME(), updatedby = @by
              WHERE id = @id`);
    summary.updated += 1;
    summary.results.push({ ...record, status: 'Updated' });
  } else {
    await pool.request()
      .input('paycode', sql.NVarChar(50), record.employeeCode)
      .input('from', sql.Date, record.effectivefrom)
      .input('basic', sql.Decimal(12, 2), v.basic)
      .input('pf', sql.Bit, v.pfFlag ? 1 : 0)
      .input('esi', sql.Bit, v.esiFlag ? 1 : 0)
      .input('pfw', sql.Decimal(12, 2), v.pfW)
      .input('esiw', sql.Decimal(12, 2), v.esiW)
      .input('by', sql.NVarChar(50), clean(v.actor).slice(0, 50))
      .query(`INSERT INTO ${SALARY_MASTER_TABLE}
                (paycode, effectivefrom, basicsalary, pfapplicable, esiapplicable, pfwage, esiwage, updatedby)
              VALUES (@paycode, @from, @basic, @pf, @esi, @pfw, @esiw, @by)`);
    summary.imported += 1;
    summary.results.push({ ...record, status: 'Imported' });
  }
}


/* ------------------------------------------------------------------ */
/* DATASET B - pay elements import                                      */
/* ------------------------------------------------------------------ */

/**
 * Import / upsert pay elements (earnings / deductions / employer
 * contributions). Each row is validated in full: element type, calculation
 * type, amount/percentage and percentage base must all agree. Invalid rows are
 * reported as Failed - never silently dropped.
 */
export async function importSalaryElements(pool, { rows, actor, companyScope }) {
  await ensureSalaryTables(pool);
  const summary = { imported: 0, updated: 0, skipped: 0, failed: 0, errors: [], results: [], warnings: [] };
  const list = Array.isArray(rows) ? rows : [];
  if (!list.length) {
    summary.errors.push('No rows found in the file.');
    return summary;
  }
  const seen = new Map(); // in-file duplicate detection (same key twice in one file)

  for (let index = 0; index < list.length; index += 1) {
    const row = list[index] || {};
    const excelRow = index + 2;
    const code = clean(row.EmployeeCode ?? row.employeeCode);
    const elemCode = upper(row.PayElementCode ?? row.payElementCode);
    const elemName = clean(row.PayElementName ?? row.payElementName);
    const elemType = upper(row.PayElementType ?? row.payElementType);
    const calcType = upper(row.CalculationType ?? row.calculationType);
    const amount = num(row.Amount ?? row.amount);
    const percentage = num(row.Percentage ?? row.percentage);
    const pctBase = upper(row.PercentageBase ?? row.percentageBase);
    const effectiveRaw = row.EffectiveFrom ?? row.effectiveFrom;
    const effective = toIsoDate(effectiveRaw);

    const fail = (message) => {
      summary.failed += 1;
      summary.errors.push({ row: excelRow, employeeCode: code, message });
      summary.results.push({ row: excelRow, employeeCode: code, status: 'Failed', message });
    };

    if (!code) { fail('EmployeeCode is empty.'); continue; }
    if (!elemCode) { fail('PayElementCode is empty.'); continue; }
    if (!elemName) { fail('PayElementName is empty.'); continue; }
    if (!PAY_ELEMENT_TYPES.includes(elemType)) {
      fail(`PayElementType "${row.PayElementType ?? ''}" must be one of ${PAY_ELEMENT_TYPES.join(', ')}.`); continue;
    }
    if (!CALC_TYPES.includes(calcType)) {
      fail(`CalculationType "${row.CalculationType ?? ''}" must be one of ${CALC_TYPES.join(', ')}.`); continue;
    }
    if (!isValidIsoDate(effective)) { fail(`EffectiveFrom "${effectiveRaw ?? ''}" is not a valid date (YYYY-MM-DD).`); continue; }
    if (calcType === 'FIXED') {
      if (amount === null || amount < 0) { fail(`Amount "${row.Amount ?? ''}" must be a number >= 0 for FIXED elements.`); continue; }
    } else {
      if (percentage === null || percentage < 0) { fail(`Percentage "${row.Percentage ?? ''}" must be a number >= 0 for PERCENTAGE elements.`); continue; }
      if (!PCT_BASES.includes(pctBase)) {
        fail(`PercentageBase "${row.PercentageBase ?? ''}" must be one of ${PCT_BASES.join(', ')}.`); continue;
      }
    }

    const employee = await findActiveEmployee(pool, code);
    if (!employee) {
      fail(`EmployeeCode "${code}" was not found among active employees. Nothing was imported for this row.`);
      continue;
    }

    /* PROMPT 4.2 — the row's employee must belong to a company assigned to this HR
       Admin. Runs AFTER the existing validation chain (so genuine data errors keep their
       own message) and BEFORE any insert/update, so an out-of-scope row writes nothing. */
    const elementScope = await paycodeCompanyAllowed(pool, employee.paycode, companyScope);
    if (!elementScope.allowed) {
      fail(`EmployeeCode "${code}" belongs to a company outside your access.`);
      continue;
    }

    // Validate PayElementCode against the application Pay Element Master when a
    // master entry exists. Unknown codes are REPORTED clearly (warnings) and the
    // row imports with its ORIGINAL code/name - never silently discarded and
    // never fabricated into the master.
    await validatePayElementCode(pool, { code: elemCode, name: elemName, excelRow, summary });

    const record = {
      row: excelRow, employeeCode: employee.paycode, empname: employee.empname,
      payelementcode: elemCode, payelementname: elemName, payelementtype: elemType,
      calculationtype: calcType, amount: amount === null ? null : round2(amount),
      percentage, percentagebase: calcType === 'PERCENTAGE' ? pctBase : null,
      effectivefrom: effective,
    };

    // In-file duplicates for the same employee + pay element + effective date:
    // identical rows are reported as duplicates of the first row; conflicting
    // values are reported and NOT applied (no silent last-wins overwrite).
    const dupKey = `${upper(employee.paycode)}|${elemCode}|${effective}`;
    const dupSig = JSON.stringify([elemName, elemType, calcType, amount === null ? null : round2(amount), percentage, calcType === 'PERCENTAGE' ? pctBase : null]);
    if (seen.has(dupKey)) {
      const prev = seen.get(dupKey);
      if (prev.sig === dupSig) {
        summary.skipped += 1;
        summary.results.push({ ...record, status: 'Skipped', message: `Duplicate of row ${prev.row} in file (same employee + pay element + effective date and values).` });
      } else {
        fail(`Conflicts with row ${prev.row} in file for the same employee + pay element + effective date (different values) - fix the file and re-import.`);
      }
      continue;
    }
    seen.set(dupKey, { row: excelRow, sig: dupSig });

    await upsertElementRow(pool, summary, record, { actor });
  }
  return summary;
}


async function upsertElementRow(pool, summary, record, { actor }) {
  const existing = await pool.request()
    .input('paycode', sql.NVarChar(50), record.employeeCode)
    .input('code', sql.NVarChar(20), record.payelementcode)
    .input('from', sql.Date, record.effectivefrom)
    .query(`SELECT TOP 1 id, payelementname, payelementtype, calculationtype, amount, percentage, percentagebase
            FROM ${SALARY_ELEMENT_TABLE}
            WHERE LTRIM(RTRIM(paycode)) = @paycode AND LTRIM(RTRIM(payelementcode)) = @code AND effectivefrom = @from`);
  const sameValues = (db) => clean(db.payelementname) === record.payelementname
    && upper(db.payelementtype) === record.payelementtype
    && upper(db.calculationtype) === record.calculationtype
    && (db.amount === null ? null : round2(db.amount)) === record.amount
    && (db.percentage === null ? null : Number(db.percentage)) === (record.percentage === null ? null : Number(record.percentage))
    && (upper(db.percentagebase) || null) === record.percentagebase;

  const params = (r) => r
    .input('paycode', sql.NVarChar(50), record.employeeCode)
    .input('code', sql.NVarChar(20), record.payelementcode)
    .input('name', sql.NVarChar(100), record.payelementname)
    .input('type', sql.NVarChar(30), record.payelementtype)
    .input('calc', sql.NVarChar(20), record.calculationtype)
    .input('amount', sql.Decimal(12, 2), record.amount)
    .input('pct', sql.Decimal(9, 4), record.percentage)
    .input('base', sql.NVarChar(20), record.percentagebase)
    .input('from', sql.Date, record.effectivefrom)
    .input('by', sql.NVarChar(50), clean(actor).slice(0, 50));

  if (existing.recordset?.[0]) {
    if (sameValues(existing.recordset[0])) {
      summary.skipped += 1;
      summary.results.push({ ...record, status: 'Skipped', message: 'Pay element is unchanged.' });
      return;
    }
    await params(pool.request()).input('id', sql.Int, existing.recordset[0].id).query(`
      UPDATE ${SALARY_ELEMENT_TABLE}
      SET payelementname = @name, payelementtype = @type, calculationtype = @calc,
          amount = @amount, percentage = @pct, percentagebase = @base,
          updateddate = SYSUTCDATETIME(), updatedby = @by
      WHERE id = @id`);
    summary.updated += 1;
    summary.results.push({ ...record, status: 'Updated' });
  } else {
    await params(pool.request()).query(`
      INSERT INTO ${SALARY_ELEMENT_TABLE}
        (paycode, payelementcode, payelementname, payelementtype, calculationtype,
         amount, percentage, percentagebase, effectivefrom, updatedby)
      VALUES (@paycode, @code, @name, @type, @calc, @amount, @pct, @base, @from, @by)`);
    summary.imported += 1;
    summary.results.push({ ...record, status: 'Imported' });
  }
}

/** HR list of salary master rows (latest effective date per employee first). */
/**
 * PROMPT 4.2 — COMPANY ISOLATION helpers for the salary service.
 *
 * `companyScopeFragment` builds a " AND LTRIM(RTRIM(<alias>.companycode)) IN ('001')"
 * fragment for list queries that already join dbo.tblemployee. `paycodeCompanyAllowed`
 * is the paycode-keyed equivalent for single-employee operations.
 *
 * Semantics (identical to leave-service): null/undefined scope => unrestricted (the
 * bootstrap HR account and the SuperAdmin console path, unchanged); an EMPTY array
 * means "no company assigned" and DENIES everything (fail closed).
 */
function companyScopeFragment(alias, scope) {
  if (scope === null || scope === undefined) return { fragment: '', denied: false };
  const list = (Array.isArray(scope) ? scope : []).map((c) => String(c || '').trim()).filter(Boolean);
  if (!list.length) return { fragment: '', denied: true };
  const inList = list.map((c) => `'${c.replace(/'/g, "''")}'`).join(', ');
  return { fragment: ` AND LTRIM(RTRIM(${alias}.companycode)) IN (${inList})`, denied: false };
}

async function paycodeCompanyAllowed(pool, paycode, scope) {
  if (scope === null || scope === undefined) return { allowed: true, companycode: '' };
  const list = (Array.isArray(scope) ? scope : []).map((c) => String(c || '').trim().toUpperCase()).filter(Boolean);
  if (!list.length) return { allowed: false, companycode: '' };
  const r = await pool.request().input('paycode', sql.NVarChar(50), clean(paycode))
    .query('SELECT TOP 1 LTRIM(RTRIM(companycode)) AS companycode FROM dbo.tblemployee WHERE LTRIM(RTRIM(paycode)) = @paycode');
  const comp = String(r.recordset?.[0]?.companycode || '').trim().toUpperCase();
  return { allowed: Boolean(comp) && list.includes(comp), companycode: comp };
}

export async function listSalaryMaster(pool, { search, limit = 200, companyScope } = {}) {
  await ensureSalaryTables(pool);
  const like = clean(search);
  /* PROMPT 4.2 — salary master rows are company data (the query already joins
     dbo.tblemployee as `e`). */
  const scope = companyScopeFragment('e', companyScope);
  if (scope.denied) return [];
  const request = pool.request().input('limit', sql.Int, Math.min(Number(limit) || 200, 1000));
  let where = 'WHERE 1 = 1';
  where += scope.fragment;
  if (like) {
    where += ' AND (m.paycode LIKE @like OR e.empname LIKE @like)';
    request.input('like', sql.NVarChar(60), `%${like}%`);
  }
  const r = await request.query(`
    SELECT TOP (@limit) m.id, LTRIM(RTRIM(m.paycode)) AS paycode, LTRIM(RTRIM(e.empname)) AS empname,
           LTRIM(RTRIM(e.presentcardno)) AS presentcardno, LTRIM(RTRIM(e.companycode)) AS companycode,
           m.effectivefrom, m.basicsalary, m.pfapplicable, m.esiapplicable, m.pfwage, m.esiwage,
           m.updateddate, m.updatedby
    FROM ${SALARY_MASTER_TABLE} m
    LEFT JOIN dbo.tblemployee e ON LTRIM(RTRIM(e.paycode)) = LTRIM(RTRIM(m.paycode))
    ${where}
    ORDER BY m.paycode, m.effectivefrom DESC`);
  return (r.recordset || []).map((x) => ({
    id: x.id, paycode: clean(x.paycode), empname: clean(x.empname),
    presentcardno: clean(x.presentcardno), companycode: clean(x.companycode),
    effectivefrom: toIsoDate(x.effectivefrom), basicsalary: round2(x.basicsalary),
    pfapplicable: Boolean(x.pfapplicable), esiapplicable: Boolean(x.esiapplicable),
    pfwage: round2(x.pfwage), esiwage: round2(x.esiwage),
    updateddate: x.updateddate, updatedby: clean(x.updatedby),
  }));
}


/** HR list of pay elements. */
export async function listSalaryElements(pool, { paycode, search, limit = 300, companyScope } = {}) {
  await ensureSalaryTables(pool);
  const like = clean(search);
  /* PROMPT 4.2 — pay-element rows are company data (joins dbo.tblemployee as `e`). */
  const scope = companyScopeFragment('e', companyScope);
  if (scope.denied) return [];
  const request = pool.request().input('limit', sql.Int, Math.min(Number(limit) || 300, 1000));
  let where = 'WHERE 1 = 1';
  where += scope.fragment;
  if (clean(paycode)) {
    where += ' AND LTRIM(RTRIM(x.paycode)) = @paycode';
    request.input('paycode', sql.NVarChar(50), clean(paycode));
  }
  if (like) {
    where += ' AND (x.paycode LIKE @like OR e.empname LIKE @like OR x.payelementname LIKE @like OR x.payelementcode LIKE @like)';
    request.input('like', sql.NVarChar(60), `%${like}%`);
  }
  const r = await request.query(`
    SELECT TOP (@limit) x.id, LTRIM(RTRIM(x.paycode)) AS paycode, LTRIM(RTRIM(e.empname)) AS empname,
           LTRIM(RTRIM(e.presentcardno)) AS presentcardno, LTRIM(RTRIM(e.companycode)) AS companycode,
           LTRIM(RTRIM(x.payelementcode)) AS payelementcode, x.payelementname,
           LTRIM(RTRIM(x.payelementtype)) AS payelementtype, LTRIM(RTRIM(x.calculationtype)) AS calculationtype,
           x.amount, x.percentage, x.percentagebase, x.effectivefrom
    FROM ${SALARY_ELEMENT_TABLE} x
    LEFT JOIN dbo.tblemployee e ON LTRIM(RTRIM(e.paycode)) = LTRIM(RTRIM(x.paycode))
    ${where}
    ORDER BY x.paycode, x.payelementcode, x.effectivefrom DESC`);
  return (r.recordset || []).map((x) => ({
    id: x.id, paycode: clean(x.paycode), empname: clean(x.empname),
    presentcardno: clean(x.presentcardno), companycode: clean(x.companycode),
    payelementcode: clean(x.payelementcode), payelementname: clean(x.payelementname),
    payelementtype: clean(x.payelementtype), calculationtype: clean(x.calculationtype),
    amount: x.amount === null ? null : round2(x.amount),
    percentage: x.percentage === null ? null : Number(x.percentage),
    percentagebase: clean(x.percentagebase) || null,
    effectivefrom: toIsoDate(x.effectivefrom),
  }));
}


/* ------------------------------------------------------------------ */
/* Other dues / recoveries (HR-managed, APPROVED rows enter the F&F)    */
/* ------------------------------------------------------------------ */

function mapDue(row) {
  return {
    id: row.id, paycode: clean(row.paycode), category: clean(row.category),
    kind: clean(row.kind), description: clean(row.description), amount: round2(row.amount),
    status: clean(row.status), applieddate: row.applieddate, decidedby: clean(row.decidedby),
    decidedat: row.decidedat, decisionnote: clean(row.decisionnote),
  };
}

const DUE_SELECT = `SELECT d.id, LTRIM(RTRIM(d.paycode)) AS paycode, LTRIM(RTRIM(e.empname)) AS empname,
       LTRIM(RTRIM(d.category)) AS category, LTRIM(RTRIM(d.kind)) AS kind, d.description,
       d.amount, LTRIM(RTRIM(d.status)) AS status, d.applieddate, d.decidedby, d.decidedat, d.decisionnote
FROM ${SALARY_DUES_TABLE} d
LEFT JOIN dbo.tblemployee e ON LTRIM(RTRIM(e.paycode)) = LTRIM(RTRIM(d.paycode))`;

export async function listSalaryDues(pool, { paycode, status, search, limit = 200, companyScope } = {}) {
  await ensureSalaryTables(pool);
  /* PROMPT 4.2 — dues/recoveries are company data (DUE_SELECT joins tblemployee as `e`). */
  const scope = companyScopeFragment('e', companyScope);
  if (scope.denied) return [];
  const request = pool.request().input('limit', sql.Int, Math.min(Number(limit) || 200, 1000));
  let where = 'WHERE 1 = 1';
  where += scope.fragment;
  if (clean(paycode)) { where += ' AND LTRIM(RTRIM(d.paycode)) = @paycode'; request.input('paycode', sql.NVarChar(50), clean(paycode)); }
  if (clean(status)) { where += ' AND LTRIM(RTRIM(d.status)) = @status'; request.input('status', sql.NVarChar(20), clean(status)); }
  if (clean(search)) {
    where += ' AND (d.paycode LIKE @like OR e.empname LIKE @like OR d.description LIKE @like OR d.kind LIKE @like)';
    request.input('like', sql.NVarChar(60), `%${clean(search)}%`);
  }
  const r = await request.query(`${DUE_SELECT} ${where} ORDER BY d.applieddate DESC, d.id DESC`);
  return (r.recordset || []).map((x) => ({ ...mapDue(x), empname: clean(x.empname) }));
}

export async function createSalaryDue(pool, { paycode, category, kind, description, amount, actor, companyScope }) {
  await ensureSalaryTables(pool);
  const code = clean(paycode);
  const cat = upper(category);
  const kindClean = clean(kind);
  const amt = num(amount);
  if (!code) return { ok: false, status: 400, code: 'PAYCODE_REQUIRED', message: 'EmployeeCode is required.' };
  if (!DUES_CATEGORIES.includes(cat)) return { ok: false, status: 400, code: 'INVALID_CATEGORY', message: `Category must be one of ${DUES_CATEGORIES.join(', ')}.` };
  if (!kindClean) return { ok: false, status: 400, code: 'KIND_REQUIRED', message: 'Kind is required (e.g. arrears, incentive, loan, asset recovery).' };
  if (amt === null || amt <= 0) return { ok: false, status: 400, code: 'INVALID_AMOUNT', message: 'Amount must be a number > 0.' };
  const employee = await findActiveEmployee(pool, code);
  if (!employee) return { ok: false, status: 404, code: 'EMPLOYEE_NOT_FOUND', message: 'Employee not found among active employees.' };

  const r = await pool.request()
    .input('paycode', sql.NVarChar(50), employee.paycode)
    .input('category', sql.NVarChar(20), cat)
    .input('kind', sql.NVarChar(40), kindClean.slice(0, 40))
    .input('description', sql.NVarChar(200), clean(description).slice(0, 200) || null)
    .input('amount', sql.Decimal(12, 2), amt)
    .input('by', sql.NVarChar(50), clean(actor).slice(0, 50))
    .query(`INSERT INTO ${SALARY_DUES_TABLE} (paycode, category, kind, description, amount, createdby)
            OUTPUT INSERTED.id
            VALUES (@paycode, @category, @kind, @description, @amount, @by)`);
  const created = await pool.request().input('id', sql.Int, r.recordset[0].id).query(`${DUE_SELECT} WHERE d.id = @id`);
  return { ok: true, due: mapDue(created.recordset[0]) };
}

export async function decideSalaryDue(pool, { id, decision, note, actor, companyScope }) {
  await ensureSalaryTables(pool);
  const status = upper(decision) === 'APPROVED' ? DUES_STATUS.APPROVED
    : upper(decision) === 'REJECTED' ? DUES_STATUS.REJECTED : null;
  if (!status) return { ok: false, status: 400, code: 'INVALID_DECISION', message: 'Decision must be Approved or Rejected.' };

  const current = await pool.request().input('id', sql.Int, Number(id))
    .query(`SELECT TOP 1 LTRIM(RTRIM(status)) AS status, LTRIM(RTRIM(paycode)) AS paycode FROM ${SALARY_DUES_TABLE} WHERE id = @id`);
  if (!current.recordset?.[0]) return { ok: false, status: 404, code: 'NOT_FOUND', message: 'Dues entry not found.' };
  /* PROMPT 4.2 — COMPANY ISOLATION: runs BEFORE the UPDATE, so a company-scoped HR
     Admin can never change another company's dues entry. Empty scope ⇒ deny. */
  const verdict = await paycodeCompanyAllowed(pool, current.recordset[0].paycode, companyScope);
  if (!verdict.allowed) {
    return { ok: false, status: 403, code: 'COMPANY_FORBIDDEN', message: 'This dues entry belongs to a company outside your access.' };
  }
  if (clean(current.recordset[0].status) !== DUES_STATUS.PENDING) {
    return { ok: false, status: 409, code: 'ALREADY_DECIDED', message: `This entry is already ${clean(current.recordset[0].status)}.` };
  }

  await pool.request()
    .input('id', sql.Int, Number(id))
    .input('status', sql.NVarChar(20), status)
    .input('by', sql.NVarChar(50), clean(actor).slice(0, 50))
    .input('note', sql.NVarChar(500), clean(note).slice(0, 500) || null)
    .query(`UPDATE ${SALARY_DUES_TABLE}
            SET status = @status, decidedby = @by, decidedat = SYSUTCDATETIME(),
                decisionnote = @note, updatedat = SYSUTCDATETIME()
            WHERE id = @id`);
  const updated = await pool.request().input('id', sql.Int, Number(id)).query(`${DUE_SELECT} WHERE d.id = @id`);
  return { ok: true, due: mapDue(updated.recordset[0]) };
}

/* ------------------------------------------------------------------ */
/* Bonus settlement history (a bonus is NEVER assumed paid without a    */
/* recorded settlement; estimates never write anything here).           */
/* ------------------------------------------------------------------ */

function mapBonusSettlement(row) {
  return {
    id: row.id, paycode: clean(row.paycode),
    bonusperiodstart: toIsoDate(row.bonusperiodstart), bonusperiodend: toIsoDate(row.bonusperiodend),
    servicestart: toIsoDate(row.servicestart), serviceend: toIsoDate(row.serviceend),
    amount: round2(row.amount), status: clean(row.status), note: clean(row.note),
    createdat: row.createdat, createdby: clean(row.createdby),
  };
}

/** Settlement records for one employee (optionally scoped to a bonus period). */
export async function listBonusSettlements(pool, { paycode, periodStart, periodEnd } = {}) {
  await ensureSalaryTables(pool);
  const request = pool.request().input('paycode', sql.NVarChar(50), clean(paycode));
  let where = 'WHERE LTRIM(RTRIM(paycode)) = @paycode';
  if (isValidIsoDate(periodStart)) { where += ' AND bonusperiodstart = @pstart'; request.input('pstart', sql.Date, periodStart); }
  if (isValidIsoDate(periodEnd)) { where += ' AND bonusperiodend = @pend'; request.input('pend', sql.Date, periodEnd); }
  const r = await request.query(`SELECT id, paycode, bonusperiodstart, bonusperiodend,
    servicestart, serviceend, amount, status, note, createdat, createdby
    FROM ${SALARY_BONUS_SETTLEMENT_TABLE} ${where}
    ORDER BY servicestart, id`);
  return (r.recordset || []).map(mapBonusSettlement);
}

/**
 * Record one explicit bonus settlement. Duplicate/overlapping service ranges
 * for the same employee + bonus period are REJECTED (the same service period
 * can never be settled twice).
 */
export async function recordBonusSettlement(pool, { input = {}, actor, companyScope }) {
  await ensureSalaryTables(pool);
  const paycode = clean(input.paycode);
  const pStart = clean(input.bonusperiodstart);
  const pEnd = clean(input.bonusperiodend);
  const sStart = clean(input.servicestart);
  const sEnd = clean(input.serviceend);
  const amount = num(input.amount);
  const fail = (message, code, status = 400) => ({ ok: false, status, code, message });
  if (!paycode) return fail('Paycode is required.', 'PAYCODE_REQUIRED');
  if (!isValidIsoDate(pStart) || !isValidIsoDate(pEnd) || pEnd < pStart) return fail('Bonus period start/end must be valid dates (YYYY-MM-DD) with end >= start.', 'INVALID_BONUS_PERIOD');
  if (!isValidIsoDate(sStart) || !isValidIsoDate(sEnd) || sEnd < sStart) return fail('Covered service start/end must be valid dates (YYYY-MM-DD) with end >= start.', 'INVALID_SERVICE_RANGE');
  if (sStart < pStart || sEnd > pEnd) return fail('Covered service range must stay inside the bonus period.', 'SERVICE_OUTSIDE_PERIOD');
  if (amount === null || amount < 0) return fail('Settlement amount must be a number >= 0.', 'INVALID_AMOUNT');

  const er = await pool.request().input('paycode', sql.NVarChar(50), paycode)
    .query(`SELECT TOP 1 LTRIM(RTRIM(paycode)) AS paycode FROM dbo.tblemployee WHERE LTRIM(RTRIM(paycode)) = @paycode`);
  if (!er.recordset?.[0]) return fail('Employee not found.', 'EMPLOYEE_NOT_FOUND', 404);
  const scopeVerdict = await paycodeCompanyAllowed(pool, paycode, companyScope);
  if (!scopeVerdict.allowed) return fail('Employee belongs to a company outside your access.', 'COMPANY_FORBIDDEN', 403);

  const overlap = await pool.request()
    .input('paycode', sql.NVarChar(50), paycode)
    .input('pstart', sql.Date, pStart).input('pend', sql.Date, pEnd)
    .input('sstart', sql.Date, sStart).input('send', sql.Date, sEnd)
    .query(`SELECT id, servicestart, serviceend, amount FROM ${SALARY_BONUS_SETTLEMENT_TABLE}
            WHERE LTRIM(RTRIM(paycode)) = @paycode AND bonusperiodstart = @pstart AND bonusperiodend = @pend
              AND NOT (serviceend < @sstart OR servicestart > @send)`);
  if ((overlap.recordset || []).length) {
    const hit = overlap.recordset[0];
    return fail(
      `Bonus service ${toIsoDate(hit.servicestart)}..${toIsoDate(hit.serviceend)} is already settled (record #${hit.id}, Rs ${round2(hit.amount)}) - the same service period cannot be settled twice.`,
      'BONUS_ALREADY_SETTLED', 409,
    );
  }

  try {
    const ins = await pool.request()
      .input('paycode', sql.NVarChar(50), paycode)
      .input('pstart', sql.Date, pStart).input('pend', sql.Date, pEnd)
      .input('sstart', sql.Date, sStart).input('send', sql.Date, sEnd)
      .input('amount', sql.Numeric(12, 2), round2(amount))
      .input('note', sql.NVarChar(500), clean(input.note).slice(0, 500) || null)
      .input('by', sql.NVarChar(50), clean(actor).slice(0, 50) || null)
      .query(`INSERT INTO ${SALARY_BONUS_SETTLEMENT_TABLE}
                (paycode, bonusperiodstart, bonusperiodend, servicestart, serviceend, amount, note, createdby)
              OUTPUT INSERTED.id
              VALUES (@paycode, @pstart, @pend, @sstart, @send, @amount, @note, @by)`);
    const id = ins.recordset?.[0]?.id;
    const got = await pool.request().input('id', sql.Int, Number(id))
      .query(`SELECT id, paycode, bonusperiodstart, bonusperiodend, servicestart, serviceend, amount, status, note, createdat, createdby
              FROM ${SALARY_BONUS_SETTLEMENT_TABLE} WHERE id = @id`);
    return { ok: true, settlement: mapBonusSettlement(got.recordset[0]) };
  } catch (error) {
    if (['2627', '2601'].includes(String(error?.number || ''))) {
      return fail('This bonus period/service range is already settled - duplicate settlement prevented.', 'BONUS_ALREADY_SETTLED', 409);
    }
    throw error;
  }
}

/** HR correction path: remove wrongly recorded settlements (by id). */
export async function deleteBonusSettlements(pool, { ids = [], companyScope }) {
  await ensureSalaryTables(pool);
  const list = (Array.isArray(ids) ? ids : []).map(Number).filter((n) => Number.isInteger(n) && n > 0);
  if (!list.length) return { ok: false, status: 400, code: 'IDS_REQUIRED', message: 'No settlement ids supplied.', results: [] };
  const results = [];
  let deleted = 0;
  for (const id of list) {
    const got = await pool.request().input('id', sql.Int, id)
      .query(`SELECT id, paycode FROM ${SALARY_BONUS_SETTLEMENT_TABLE} WHERE id = @id`);
    const row = got.recordset?.[0];
    if (!row) { results.push({ id, status: 'Missing', message: 'Settlement record not found.' }); continue; }
    const scopeVerdict = await paycodeCompanyAllowed(pool, clean(row.paycode), companyScope);
    if (!scopeVerdict.allowed) { results.push({ id, status: 'Kept', message: 'Employee belongs to a company outside your access.' }); continue; }
    await pool.request().input('id', sql.Int, id).query(`DELETE FROM ${SALARY_BONUS_SETTLEMENT_TABLE} WHERE id = @id`);
    deleted += 1;
    results.push({ id, status: 'Deleted', message: 'Settlement record removed.' });
  }
  return { ok: true, deleted, results };
}

/* ------------------------------------------------------------------ */
/* Effective-dated salary resolution                                    */
/* ------------------------------------------------------------------ */

/**
 * The salary picture AS OF a date: the LATEST master row and the LATEST row of
 * each pay element with effectivefrom <= asOf. "Last applicable Basic Salary"
 * for gratuity is exactly this resolved basic.
 */
async function getSalarySnapshot(pool, paycode, asOf) {
  const master = await pool.request()
    .input('paycode', sql.NVarChar(50), clean(paycode))
    .input('asof', sql.Date, asOf)
    .query(`SELECT TOP 1 id, effectivefrom, basicsalary, pfapplicable, esiapplicable, pfwage, esiwage
            FROM ${SALARY_MASTER_TABLE}
            WHERE LTRIM(RTRIM(paycode)) = @paycode AND effectivefrom <= @asof
            ORDER BY effectivefrom DESC, id DESC`);
  const m = master.recordset?.[0];
  if (!m) {
    return {
      available: false,
      reason: 'Salary information is not currently available for calculation.',
    };
  }

  // The shared element table also carries the structure model's ActivePayElement
  // flag. It is read defensively (older schemas may not have the column yet):
  // only an EXPLICITLY inactive latest version excludes the element.
  const elemSelect = `SELECT id, LTRIM(RTRIM(payelementcode)) AS payelementcode, payelementname,
                   LTRIM(RTRIM(payelementtype)) AS payelementtype, LTRIM(RTRIM(calculationtype)) AS calculationtype,
                   amount, percentage, percentagebase, effectivefrom`;
  const elemTail = `FROM ${SALARY_ELEMENT_TABLE}
            WHERE LTRIM(RTRIM(paycode)) = @paycode AND effectivefrom <= @asof
            ORDER BY payelementcode, effectivefrom DESC, id DESC`;
  let elemRows;
  try {
    elemRows = await pool.request()
      .input('paycode', sql.NVarChar(50), clean(paycode))
      .input('asof', sql.Date, asOf)
      .query(`${elemSelect}, activepayelement ${elemTail}`);
  } catch (_e) {
    elemRows = await pool.request()
      .input('paycode', sql.NVarChar(50), clean(paycode))
      .input('asof', sql.Date, asOf)
      .query(`${elemSelect} ${elemTail}`);
  }
  const latestByCode = new Map();
  for (const row of elemRows.recordset || []) {
    const code = clean(row.payelementcode);
    if (!latestByCode.has(code)) latestByCode.set(code, row); // first = latest effective
  }
  // Inactive elements (latest applicable version explicitly marked inactive)
  // are excluded from every calculation - and reported, never silently mixed in.
  const inactiveSkipped = [];
  for (const [code, row] of [...latestByCode.entries()]) {
    if (row.activepayelement === false || row.activepayelement === 0) {
      inactiveSkipped.push(code);
      latestByCode.delete(code);
    }
  }

  return {
    available: true,
    masterId: m.id,
    effectivefrom: toIsoDate(m.effectivefrom),
    basic: round2(m.basicsalary),
    pfapplicable: Boolean(m.pfapplicable),
    esiapplicable: Boolean(m.esiapplicable),
    pfwage: round2(m.pfwage),
    esiwage: round2(m.esiwage),
    inactiveSkipped,
    elements: [...latestByCode.values()].map((row) => ({
      id: row.id,
      payelementcode: clean(row.payelementcode),
      payelementname: clean(row.payelementname),
      payelementtype: clean(row.payelementtype),
      calculationtype: clean(row.calculationtype),
      amount: row.amount === null ? null : round2(row.amount),
      percentage: row.percentage === null ? null : Number(row.percentage),
      percentagebase: clean(row.percentagebase) || null,
      effectivefrom: toIsoDate(row.effectivefrom),
    })),
  };
}

/**
 * Element value maths. FIXED -> amount. PERCENTAGE -> pct x base.
 * A PERCENTAGE-of-GROSS element is computed on "Gross before gross-based
 * elements" (basic + fixed + percentage-of-BASIC/PF_WAGE/ESI_WAGE earnings),
 * which keeps the calculation deterministic and auditable.
 */
function valueOf(el, grossBase, wages) {
  if (el.calculationtype === 'FIXED') return round2(el.amount || 0);
  const base = el.percentagebase === 'GROSS' ? grossBase
    : el.percentagebase === 'PF_WAGE' ? wages.pfWage
    : el.percentagebase === 'ESI_WAGE' ? wages.esiWage
    : wages.basic;
  return round2((Number(el.percentage) || 0) / 100 * base);
}

/**
 * Pay elements that ARE the employee's basic salary. When one is present among
 * the earnings, EmployeeSalaryMaster.BasicSalary must NOT be added to the gross
 * total again (basic is counted exactly once - via the pay element).
 */
const BASIC_ELEMENT_CODE_RE = /^(BASIC|BASICSALARY|BASIC_SALARY|BS)$/i;
const BASIC_ELEMENT_NAME_RE = /^(BASIC|BASIC SALARY)$/i;
function isBasicElement(el) {
  return BASIC_ELEMENT_CODE_RE.test(String(el.payelementcode || '').trim())
    || BASIC_ELEMENT_NAME_RE.test(String(el.payelementname || '').trim());
}

function computeElementLists(elements, wages) {
  const earnings = elements.filter((e) => e.payelementtype === 'EARNING');
  const nonGross = earnings.filter((e) => !(e.calculationtype === 'PERCENTAGE' && e.percentagebase === 'GROSS'));
  const grossBased = earnings.filter((e) => e.calculationtype === 'PERCENTAGE' && e.percentagebase === 'GROSS');
  // Basic counted ONCE: if a BASIC earning element exists it already carries the
  // basic salary inside the element sum - the master BasicSalary is then not
  // added again (that addition was the gross double-count).
  const basicElement = earnings.find((e) => isBasicElement(e)) || null;
  const implicitBasic = basicElement ? 0 : wages.basic;
  const grossBase = round2(implicitBasic + nonGross.reduce((s, e) => s + valueOf(e, 0, wages), 0));

  const line = (el, val) => ({
    payelementcode: el.payelementcode, payelementname: el.payelementname,
    calculationtype: el.calculationtype, amount: el.amount, percentage: el.percentage,
    percentagebase: el.percentagebase, effectivefrom: el.effectivefrom, value: val,
    formula: el.calculationtype === 'FIXED' ? `Fixed ${el.amount}`
      : `${el.percentage}% of ${el.percentagebase}${el.percentagebase === 'GROSS' ? ` (${grossBase})` : ''}`,
  });

  const earningsLines = [
    ...nonGross.map((el) => line(el, valueOf(el, grossBase, wages))),
    ...grossBased.map((el) => line(el, valueOf(el, grossBase, wages))),
  ];
  const earningsTotal = round2(earningsLines.reduce((s, l) => s + l.value, 0));
  const gross = round2(implicitBasic + earningsTotal);

  // Missing / inconsistent data is REPORTED - never papered over with an
  // invented amount and never fixed by changing stored salary records.
  const warnings = [];
  if (basicElement) {
    const basicVal = earningsLines.find((l) => isBasicElement(l))?.value ?? 0;
    if (round2(wages.basic) !== round2(basicVal)) {
      warnings.push(`Inconsistent data: master BasicSalary (${wages.basic}) differs from the BASIC pay element (${basicVal}). Gross counts the BASIC pay element once and does not add the master value again.`);
    }
  } else if (!wages.basic) {
    warnings.push('Missing data: no Basic Salary in the salary master and no BASIC pay element - Gross = earning pay elements only.');
  }

  const deductionLines = elements.filter((e) => e.payelementtype === 'DEDUCTION')
    .map((el) => line(el, valueOf(el, gross, wages)));
  const employerLines = elements.filter((e) => e.payelementtype === 'EMPLOYER_CONTRIBUTION')
    .map((el) => line(el, valueOf(el, gross, wages)));

  return {
    earnings: earningsLines, earningsTotal, gross,
    basicElementIncluded: !!basicElement,
    implicitBasic,
    warnings,
    deductions: deductionLines, deductionsTotal: round2(deductionLines.reduce((s, l) => s + l.value, 0)),
    employer: employerLines, employerTotal: round2(employerLines.reduce((s, l) => s + l.value, 0)),
  };
}

/* ------------------------------------------------------------------ */
/* Staff group (for leave-encashment type configuration)                */
/* ------------------------------------------------------------------ */

async function resolveStaffGroup(pool, catCode) {
  const code = upper(catCode);
  if (!code) return { group: 'DEFAULT', source: 'no employee category - default encashment types' };
  try {
    const r = await pool.request().input('code', sql.NVarChar(50), code)
      .query(`SELECT TOP 1 LTRIM(RTRIM(holidaycategory)) AS holidaycategory
              FROM dbo.HR_HolidayCategoryMap
              WHERE LTRIM(RTRIM(categorycode)) = @code AND active = 1`);
    const name = upper(r.recordset?.[0]?.holidaycategory);
    if (name.includes('FACTORY')) return { group: 'FACTORY', source: `holiday group "${name}" (category ${code})` };
    if (name.includes('OFFICE')) return { group: 'OFFICE', source: `holiday group "${name}" (category ${code})` };
  } catch (_e) { /* map table absent: fall through */ }
  try {
    const r = await pool.request().query('SELECT * FROM dbo.tblcategory');
    const keys = r.recordset?.length ? Object.keys(r.recordset[0]) : [];
    const codeKey = keys.find((k) => /code/i.test(k)) || keys[0];
    const nameKey = keys.find((k) => /name/i.test(k) && !/code/i.test(k));
    const row = (r.recordset || []).find((x) => upper(x[codeKey]) === code);
    const name = row && nameKey ? upper(row[nameKey]) : '';
    if (/STAFF|STF|MGR|OFFICE|EXEC/.test(name)) return { group: 'OFFICE', source: `category ${code} "${name}"` };
    if (/WORKER|FACTORY|OPERATOR|LABOUR|LABOR|HELPER/.test(name)) return { group: 'FACTORY', source: `category ${code} "${name}"` };
  } catch (_e) { /* category master unreadable: fall through */ }
  return { group: 'DEFAULT', source: `category ${code} has no factory/office mapping - default encashment types` };
}

/* ------------------------------------------------------------------ */
/* Full & Final estimation engine                                       */
/* ------------------------------------------------------------------ */

/** Human-readable rule descriptions - shown to the user next to every amount. */
function buildRules(cfg) {
  const gBasis = upper(cfg.s('GratuityWageBasis')) === 'GROSS' ? 'GROSS' : 'BASIC';
  const eBasis = upper(cfg.s('LeaveEncashmentBasis')) === 'GROSS' ? 'GROSS' : 'BASIC';
  const nBasis = upper(cfg.s('NoticeSalaryBasis')) === 'BASIC' ? 'BASIC' : 'GROSS';
  return {
    gratuity: {
      enabled: cfg.flag('GratuityEnabled'),
      daysPerYear: cfg.n('GratuityDaysPerYear'), wageDivisor: cfg.n('GratuityWageDivisor'),
      qualifyingYears: cfg.n('GratuityQualifyingYears'), wageBasis: gBasis,
      basisText: `${cfg.n('GratuityDaysPerYear')} days' ${gBasis} wages per completed year (divisor ${cfg.n('GratuityWageDivisor')}); qualifying service >= ${cfg.n('GratuityQualifyingYears')} completed year(s)`,
    },
    bonus: {
      enabled: cfg.flag('BonusEnabled'),
      periodStart: cfg.s('BonusPeriodStart'), periodEnd: cfg.s('BonusPeriodEnd'),
      rule: upper(cfg.s('BonusRule')), rate: cfg.n('BonusRate'),
      eligibilityMinMonths: cfg.n('BonusEligibilityMinMonths'), prorate: cfg.flag('BonusProrate'),
      basisText: cfg.flag('BonusEnabled')
        ? `${upper(cfg.s('BonusRule'))} @ ${cfg.n('BonusRate')} for period ${cfg.s('BonusPeriodStart') || '(not set)'} to ${cfg.s('BonusPeriodEnd') || '(not set)'}; min service ${cfg.n('BonusEligibilityMinMonths')} month(s) at leaving date; ${cfg.flag('BonusProrate') ? 'prorated by eligible months (month/day accrual: annual / 12 per eligible month, minus previously settled service)' : 'no proration (full amount for eligible service, minus previously settled)'}`
        : 'Bonus is disabled in the configuration',
    },
    leaveEncashment: {
      enabled: cfg.flag('LeaveEncashmentEnabled'),
      typesFactory: cfg.s('LeaveEncashmentTypesFactory'), typesOffice: cfg.s('LeaveEncashmentTypesOffice'),
      typesDefault: cfg.s('LeaveEncashmentTypesDefault'),
      basis: eBasis, wageDivisor: cfg.n('LeaveEncashmentWageDivisor'), maxDays: cfg.n('LeaveEncashmentMaxDays'),
      basisText: `Encashable leave types per staff group; daily salary = ${eBasis} monthly x 12 / ${cfg.n('LeaveEncashmentWageDivisor')} per day${cfg.n('LeaveEncashmentMaxDays') > 0 ? `; capped at ${cfg.n('LeaveEncashmentMaxDays')} day(s)` : ' (0 = no cap)'}`,
    },
    notice: {
      noticePeriodDays: cfg.n('NoticePeriodDays'), salaryBasis: nBasis, wageDivisor: cfg.n('NoticeWageDivisor'),
      basisText: `Notice period ${cfg.n('NoticePeriodDays')} day(s); ${nBasis} / ${cfg.n('NoticeWageDivisor')} per day`,
    },
    pf: {
      rateEmployee: cfg.n('PFRateEmployee'), rateEmployer: cfg.n('PFRateEmployer'),
      wageBasis: upper(cfg.s('PFWageBasis')), basisText: `Employee ${cfg.n('PFRateEmployee')}% / Employer ${cfg.n('PFRateEmployer')}% of ${upper(cfg.s('PFWageBasis'))} wage`,
    },
    esi: {
      rateEmployee: cfg.n('ESIRateEmployee'), rateEmployer: cfg.n('ESIRateEmployer'),
      wageBasis: upper(cfg.s('ESIWageBasis')), wageCeiling: cfg.n('ESIWageCeiling'),
      basisText: `Employee ${cfg.n('ESIRateEmployee')}% / Employer ${cfg.n('ESIRateEmployer')}% of ${upper(cfg.s('ESIWageBasis'))} wage${cfg.n('ESIWageCeiling') > 0 ? `; applicable up to wage ceiling ${cfg.n('ESIWageCeiling')}` : ''}`,
    },
  };
}

export async function computeFullFinal(pool, { paycode, leavingdate, noticeServedDays, noticeWaived, companyScope }) {
  await ensureLeaveTables(pool); // leave encashment reads real leave balances

  const er = await pool.request().input('paycode', sql.NVarChar(50), clean(paycode)).query(`
    SELECT TOP 1 LTRIM(RTRIM(paycode)) AS paycode, LTRIM(RTRIM(empname)) AS empname,
           LTRIM(RTRIM(designation)) AS designation, LTRIM(RTRIM(departmentcode)) AS departmentcode,
           LTRIM(RTRIM(companycode)) AS companycode, LTRIM(RTRIM(cat)) AS cat,
           dateofjoin, dateofbirth, LTRIM(RTRIM(active)) AS active, leavingdate
    FROM dbo.tblemployee WHERE LTRIM(RTRIM(paycode)) = @paycode`);
  const e = er.recordset?.[0];
  if (!e) return { ok: false, status: 404, code: 'EMPLOYEE_NOT_FOUND', message: 'Employee not found.' };
  /* PROMPT 4.2 — COMPANY ISOLATION: Full & Final exposes the WHOLE salary picture
     (master, elements, dues, gratuity, leave encashment) for one paycode, so a scoped
     HR Admin must only be able to compute it for its own companies. */
  {
    const verdict = await paycodeCompanyAllowed(pool, e.paycode, companyScope);
    if (!verdict.allowed) {
      return { ok: false, status: 403, code: 'COMPANY_FORBIDDEN', message: 'Employee belongs to a company outside your access.' };
    }
  }

  const dateofjoin = toIsoDate(e.dateofjoin);
  const officialLeaving = toIsoDate(e.leavingdate);
  const cfg = await getSalaryConfig(pool);
  const rules = buildRules(cfg);
  const employee = {
    paycode: clean(e.paycode), empname: clean(e.empname), designation: clean(e.designation),
    departmentcode: clean(e.departmentcode), companycode: clean(e.companycode),
    categorycode: clean(e.cat), dateofjoin, dateofbirth: toIsoDate(e.dateofbirth),
    active: clean(e.active), leavingdate: officialLeaving,
  };

  // Estimation input: a proposed leaving date. The REAL leaving date on the
  // employee record is used when present; nothing is ever written back.
  const leaveIso = isValidIsoDate(leavingdate) ? clean(leavingdate) : officialLeaving;
  if (!leaveIso) {
    return {
      ok: true, employee, rules, estimate: null, disclaimer: DISCLAIMER,
      salary: { available: false, reason: 'No leaving date: supply a proposed leaving date to run the estimate.' },
    };
  }
  if (dateofjoin && leaveIso < dateofjoin) {
    return { ok: false, status: 400, code: 'LEAVING_BEFORE_JOIN', message: 'Leaving date cannot be before the joining date.' };
  }

  const period = servicePeriod(dateofjoin, leaveIso);
  const snapshot = await getSalarySnapshot(pool, employee.paycode, leaveIso);
  if (!snapshot.available) {
    return {
      ok: true, employee, rules, estimate: null, disclaimer: DISCLAIMER,
      salary: { available: false, reason: snapshot.reason },
    };
  }

  const wages = { basic: snapshot.basic, pfWage: snapshot.pfwage, esiWage: snapshot.esiwage };
  const lists = computeElementLists(snapshot.elements, wages);
  const salaryWarnings = [...lists.warnings];
  if ((snapshot.inactiveSkipped || []).length) {
    salaryWarnings.push(`Inactive pay element(s) excluded from the calculation: ${snapshot.inactiveSkipped.join(', ')} (latest applicable version is marked inactive).`);
  }
  const salary = {
    available: true,
    basic: snapshot.basic,
    gross: lists.gross,
    effectivefrom: snapshot.effectivefrom,
    pfapplicable: snapshot.pfapplicable,
    esiapplicable: snapshot.esiapplicable,
    pfwage: snapshot.pfwage,
    esiwage: snapshot.esiwage,
    warnings: salaryWarnings,
    breakdown: {
      earnings: lists.earnings, earningsTotal: lists.earningsTotal,
      deductions: lists.deductions, deductionsTotal: lists.deductionsTotal,
      employerContributions: lists.employer, employerTotal: lists.employerTotal,
      basicElementIncluded: lists.basicElementIncluded,
      gross: lists.gross,
      warnings: salaryWarnings,
    },
  };

  const estimate = await buildEstimate(pool, {
    employee, period, snapshot, lists, cfg, leaveIso,
    noticeServedDays, noticeWaived, dateofjoin,
  });
  return { ok: true, employee, salary, rules, estimate, disclaimer: DISCLAIMER };
}

/** The component-by-component estimate. Every component carries its inputs. */
async function buildEstimate(pool, ctx) {
  const { employee, period, snapshot, lists, cfg, leaveIso, noticeServedDays, noticeWaived, dateofjoin } = ctx;
  const basicUsed = snapshot.basic;
  const gross = lists.gross;

  /* ---- Gratuity ---- */
  const gEnabled = cfg.flag('GratuityEnabled');
  const gDaysPerYear = cfg.n('GratuityDaysPerYear');
  const gDivisor = cfg.n('GratuityWageDivisor') || 26;
  const gQualYears = cfg.n('GratuityQualifyingYears');
  const gWageBasis = upper(cfg.s('GratuityWageBasis')) === 'GROSS' ? 'GROSS' : 'BASIC';
  const gWageValue = gWageBasis === 'GROSS' ? gross : basicUsed;
  const completedYears = period ? period.years : 0;
  const gratuityEligible = gEnabled && completedYears >= gQualYears && gDivisor > 0;
  const gratuityAmount = gratuityEligible ? round2((gWageValue / gDivisor) * gDaysPerYear * completedYears) : 0;
  const gratuity = {
    enabled: gEnabled,
    eligible: gratuityEligible,
    servicePeriod: period,
    completedYears,
    basicUsed,
    wageBasis: gWageBasis,
    wageValue: gWageValue,
    daysPerYear: gDaysPerYear,
    wageDivisor: gDivisor,
    qualifyingYears: gQualYears,
    basisText: `(${gWageValue} / ${gDivisor}) x ${gDaysPerYear} days x ${completedYears} completed year(s)`,
    ruleText: `${gDaysPerYear} days' ${gWageBasis} wages per completed year; qualifying service >= ${gQualYears} year(s)`,
    amount: gratuityAmount,
    note: !gEnabled ? 'Gratuity is disabled in the configuration.'
      : gratuityEligible ? '' : `Not eligible: ${completedYears} completed year(s) < required ${gQualYears}.`,
  };

  /* ---- Bonus (HR-configured period; documented month/day proration) ---- */
  const bEnabled = cfg.flag('BonusEnabled');
  const bStart = cfg.s('BonusPeriodStart');
  const bEnd = cfg.s('BonusPeriodEnd');
  const bRule = upper(cfg.s('BonusRule')) || 'PERCENTAGE_BASIC';
  const bRate = cfg.n('BonusRate');
  const bMinMonths = cfg.n('BonusEligibilityMinMonths');
  const bProrate = cfg.flag('BonusProrate');
  const bonus = {
    enabled: bEnabled, periodStart: bStart, periodEnd: bEnd, rule: bRule, rate: bRate,
    annualAmount: bRule === 'FIXED' ? bRate : 0,
    eligibilityMinMonths: bMinMonths, prorate: bProrate,
    serviceAtLeavingMonths: 0, minServiceMet: false,
    eligible: false, eligibleServiceFrom: '', eligibleServiceTo: '',
    eligibleMonths: 0, eligibleDays: 0, serviceMonths: 0,
    monthlyAccrual: 0, prorateFactor: 1,
    unsettledRanges: [], unsettledMonths: 0,
    settledRanges: [], previouslySettledAmount: 0, previouslySettledCount: 0,
    amount: 0, basisText: '', prorationText: '', note: '', issues: [],
  };
  if (!bEnabled) {
    bonus.note = 'Bonus is disabled in the configuration.';
  } else if (!isValidIsoDate(bStart) || !isValidIsoDate(bEnd) || bEnd < bStart) {
    bonus.note = 'Bonus period is not configured by HR yet - no bonus is estimated.';
  } else if (!isValidIsoDate(dateofjoin)) {
    bonus.issues.push('Date of Joining is missing on the employee record - eligible service cannot be determined; no bonus is estimated.');
    bonus.note = 'Missing Date of Joining - bonus cannot be prorated without it.';
  } else {
    // Eligibility uses TOTAL service at the leaving date, so the earlier
    // unpaid eligible portion is never discarded after the employee crosses
    // the minimum-service mark (joined mid-period, completes one year later).
    const serviceAtLeavingMonths = completedMonthsBetween(dateofjoin, leaveIso);
    const minServiceMet = serviceAtLeavingMonths >= bMinMonths;
    // Eligible service = employment INSIDE the configured period only - the
    // period boundaries are never extended or shortened.
    const overlapFrom = dateofjoin > bStart ? dateofjoin : bStart;
    const overlapTo = leaveIso < bEnd ? leaveIso : bEnd;
    const eligibleRange = overlapTo >= overlapFrom ? { from: overlapFrom, to: overlapTo } : null;
    const fullRange = monthFractionOfRange(bStart, bEnd);
    const eligibleMonths = eligibleRange ? monthFractionOfRange(overlapFrom, overlapTo).months : 0;
    const eligibleDays = eligibleRange ? daysBetweenInclusive(overlapFrom, overlapTo) : 0;

    // Previously settled service - RECORDED settlements only; a bonus is never
    // assumed paid without a corresponding record.
    let settled = [];
    try {
      settled = await listBonusSettlements(pool, { paycode: employee.paycode, periodStart: bStart, periodEnd: bEnd });
    } catch (_e) {
      bonus.issues.push('Bonus settlement history could not be read - previously settled is shown as unverified (0).');
    }
    const settledRanges = settled.map((s) => ({ from: s.servicestart, to: s.serviceend, amount: s.amount, id: s.id }));
    const unsettledRanges = eligibleRange ? subtractRanges(eligibleRange.from, eligibleRange.to, settledRanges) : [];
    const unsettledMonths = unsettledRanges.reduce((s, r) => s + monthFractionOfRange(r.from, r.to).months, 0);
    const settledAmount = round2(settled.reduce((s, x) => s + x.amount, 0));

    const baseValue = bRule === 'FIXED' ? bRate
      : bRule === 'PERCENTAGE_GROSS' ? round2(bRate / 100 * gross)
      : round2(bRate / 100 * basicUsed);
    const monthlyAccrual = Math.round((baseValue / 12) * 10000) / 10000; // e.g. 13850 / 12 = 1154.1667
    const eligible = !!eligibleRange && eligibleMonths > 0 && minServiceMet;

    bonus.serviceAtLeavingMonths = serviceAtLeavingMonths;
    bonus.minServiceMet = minServiceMet;
    bonus.eligible = eligible;
    bonus.eligibleServiceFrom = eligibleRange ? eligibleRange.from : '';
    bonus.eligibleServiceTo = eligibleRange ? eligibleRange.to : '';
    bonus.eligibleMonths = Math.round(eligibleMonths * 10000) / 10000;
    bonus.eligibleDays = eligibleDays;
    bonus.serviceMonths = serviceAtLeavingMonths;
    bonus.monthlyAccrual = monthlyAccrual;
    bonus.unsettledRanges = unsettledRanges.map((r) => ({ from: r.from, to: r.to, months: Math.round(monthFractionOfRange(r.from, r.to).months * 10000) / 10000 }));
    bonus.unsettledMonths = Math.round(unsettledMonths * 10000) / 10000;
    bonus.settledRanges = settledRanges;
    bonus.previouslySettledAmount = settledAmount;
    bonus.previouslySettledCount = settled.length;

    if (!eligible) {
      bonus.amount = 0;
      bonus.prorateFactor = 0;
      bonus.note = !eligibleRange ? 'Not employed during the bonus period.'
        : !minServiceMet ? `Not eligible: service ${serviceAtLeavingMonths} month(s) at leaving < required ${bMinMonths} month(s).`
        : 'No eligible service months inside the bonus period.';
    } else if (!bProrate) {
      // Prorate = N: the configured FULL-eligibility rule - the full amount is
      // awarded to eligible employees; only the already-settled part is
      // deducted so the same service is never paid twice.
      bonus.prorateFactor = 1;
      bonus.amount = round2(Math.max(0, baseValue - settledAmount));
      bonus.prorationText = `Prorate = N (full-eligibility rule): full ${baseValue}${settledAmount ? ` minus previously settled ${settledAmount}` : ''}`;
    } else {
      // Prorate = Y: month/day accrual - baseValue / 12 per eligible month,
      // charged ONLY on service that has not already been settled.
      bonus.prorateFactor = fullRange.months > 0 ? Math.round((eligibleMonths / fullRange.months) * 10000) / 10000 : 1;
      bonus.amount = round2(monthlyAccrual * unsettledMonths);
      bonus.prorationText = `Prorate = Y (month/day accrual): ${baseValue} / 12 = ${monthlyAccrual} per eligible month x ${bonus.unsettledMonths} unsettled eligible month(s)`;
    }
    bonus.basisText = `${bRule} @ ${bRate}${bRule !== 'FIXED' ? '%' : ''} = ${baseValue} per year; period ${bStart}..${bEnd}; eligible service ${bonus.eligibleServiceFrom || '(none)'}..${bonus.eligibleServiceTo || '(none)'} = ${bonus.eligibleMonths} month(s); min service ${bMinMonths} month(s) ${minServiceMet ? 'MET' : 'NOT met'} (${serviceAtLeavingMonths} at leaving); previously settled Rs ${settledAmount} (${settled.length} record(s)); unsettled ${bonus.unsettledMonths} month(s); ${bonus.prorationText}`;
  }


  /* ---- Leave encashment (configurable types per staff group) ---- */
  const eEnabled = cfg.flag('LeaveEncashmentEnabled');
  const groupInfo = await resolveStaffGroup(pool, employee.categorycode);
  const typesKey = groupInfo.group === 'FACTORY' ? 'LeaveEncashmentTypesFactory'
    : groupInfo.group === 'OFFICE' ? 'LeaveEncashmentTypesOffice'
    : 'LeaveEncashmentTypesDefault';
  const encTypes = upper(cfg.s(typesKey)).split(',').map((t) => t.trim()).filter(Boolean);
  const encYear = yearOf(leaveIso);
  let encashmentDaysByType = [];
  let encashDays = 0;
  let encBalanceAvailable = false;
  const encIssues = [];
  if (eEnabled && encTypes.length) {
    try {
      const balance = await getLeaveBalance(pool, { paycode: employee.paycode, leaveyear: encYear });
      encBalanceAvailable = true;
      if (!(balance.types || []).length) {
        encIssues.push('No leave types are configured - eligible unused leave cannot be determined.');
      }
      encashmentDaysByType = encTypes.map((t) => {
        const row = (balance.types || []).find((x) => upper(x.leavetype) === t);
        const days = row ? Math.max(0, Number(row.availableBalance) || 0) : 0;
        return { leavetype: t, days: round2(days), balanceFound: !!row };
      });
      encashDays = round2(encashmentDaysByType.reduce((s, x) => s + x.days, 0));
    } catch (_e) {
      encIssues.push('Leave balance could not be read - no encashment is estimated and no balance is invented.');
    }
  }
  const encMaxDays = cfg.n('LeaveEncashmentMaxDays');
  const encAppliedDays = encMaxDays > 0 ? Math.min(encashDays, encMaxDays) : encashDays;
  const encBasis = upper(cfg.s('LeaveEncashmentBasis')) === 'GROSS' ? 'GROSS' : 'BASIC';
  const encDivisor = cfg.n('LeaveEncashmentWageDivisor') || 365;
  const encBasisValue = encBasis === 'GROSS' ? gross : basicUsed;
  // Company rule: Daily salary = Monthly basis x 12 / wage divisor (365-day
  // year), Encashment = Daily salary x eligible unused encashable days. The
  // daily rate is currency-rounded (2dp) before multiplying so the displayed
  // values reproduce exactly (40832 x 12 / 365 = 1342.42/day; x 18 = 24163.56).
  const encAnnual = round2(encBasisValue * 12);
  const encDaily = round2((encBasisValue * 12) / encDivisor);
  const encashment = {
    enabled: eEnabled,
    staffGroup: groupInfo.group,
    staffGroupSource: groupInfo.source,
    leaveYear: encYear,
    types: encashmentDaysByType,
    eligibleTypes: encTypes,
    balanceAvailable: encBalanceAvailable,
    days: encAppliedDays,
    daysBeforeCap: encashDays,
    maxDays: encMaxDays,
    capApplied: encMaxDays > 0 && encashDays > encMaxDays,
    basis: encBasis,
    monthlyBasisValue: encBasisValue,
    annualBasisValue: encAnnual,
    basisValue: encBasisValue,
    wageDivisor: encDivisor,
    dailySalary: encDaily,
    formulaText: `Daily salary = ${encBasis} monthly ${encBasisValue} x 12 / ${encDivisor} = ${encDaily}; encashment = ${encDaily} x ${encAppliedDays} eligible unused day(s)`,
    basisText: `${encAppliedDays} eligible unused day(s) x ${encDaily} daily (${encBasis} monthly ${encBasisValue} x 12 / ${encDivisor})`,
    amount: round2(encDaily * encAppliedDays),
    issues: encIssues,
    note: eEnabled
      ? (encBalanceAvailable ? (encAppliedDays ? '' : 'No encashable leave balance available.') : 'Leave balance unavailable - encashment is not estimated.')
      : 'Leave encashment is disabled in the configuration.',
  };

  /* ---- Notice pay / recovery ---- */
  const nPeriod = cfg.n('NoticePeriodDays');
  const nBasis = upper(cfg.s('NoticeSalaryBasis')) === 'BASIC' ? 'BASIC' : 'GROSS';
  const nDivisor = cfg.n('NoticeWageDivisor') || 30;
  const nBasisValue = nBasis === 'BASIC' ? basicUsed : gross;
  const nDaily = round2(nBasisValue / nDivisor);
  const servedNum = noticeServedDays === null || noticeServedDays === undefined || noticeServedDays === '' ? null : num(noticeServedDays);
  const waived = noticeWaived === true || upper(noticeWaived) === 'Y' || noticeWaived === 1;
  const unservedDays = servedNum === null ? 0 : Math.max(0, nPeriod - Math.max(0, servedNum));
  const noticePayAmount = servedNum !== null && waived && unservedDays > 0 ? round2(unservedDays * nDaily) : 0;
  const noticeRecoveryAmount = servedNum !== null && !waived && unservedDays > 0 ? round2(unservedDays * nDaily) : 0;
  const notice = {
    provided: servedNum !== null,
    noticePeriodDays: nPeriod,
    noticeServedDays: servedNum === null ? null : Math.max(0, servedNum),
    unservedDays,
    waivedByEmployer: waived,
    salaryBasis: nBasis,
    basisValue: nBasisValue,
    wageDivisor: nDivisor,
    dailyRate: nDaily,
    basisText: `${unservedDays} unserved day(s) x ${nDaily} (${nBasis} ${nBasisValue} / ${nDivisor})`,
    payAmount: noticePayAmount,
    recoveryAmount: noticeRecoveryAmount,
    note: servedNum === null ? 'Enter "notice served days" to calculate notice pay / recovery.'
      : unservedDays === 0 ? 'Notice fully served - nothing payable or recoverable.'
      : waived ? 'Employer waived the unserved notice - payable to employee.'
      : 'Unserved notice - recoverable from the settlement.',
  };


  /* ---- Statutory PF / ESI (employee + employer, all configurable) ---- */
  const pfWageBase = upper(cfg.s('PFWageBasis')) === 'BASIC' ? basicUsed : snapshot.pfwage;
  const esiWageBase = upper(cfg.s('ESIWageBasis')) === 'BASIC' ? basicUsed : snapshot.esiwage;
  const esiCeiling = cfg.n('ESIWageCeiling');
  // Imported pay elements that ALREADY represent PF/ESI suppress the statutory
  // line so nothing is ever double counted (visible in `notes`).
  const hasCode = (re, lines) => lines.some((l) => re.test(l.payelementcode));
  const pfInDeduction = hasCode(/^(PF|EPF|FPF|PROVIDENT)$/i, lists.deductions);
  const pfInEmployerElem = hasCode(/^(PF|EPF|FPF|ERPF|PROVIDENT)$/i, lists.employer);
  const esiInDeduction = hasCode(/^(ESI|ESIC)$/i, lists.deductions);
  const esiInEmployerElem = hasCode(/^(ESI|ESIC|ERESI)$/i, lists.employer);
  const esiWithinCeiling = esiCeiling <= 0 || esiWageBase <= esiCeiling;

  const pfNotes = [];
  const employeePf = snapshot.pfapplicable && !pfInDeduction && pfWageBase > 0
    ? round2(cfg.n('PFRateEmployee') / 100 * pfWageBase) : 0;
  if (!snapshot.pfapplicable) pfNotes.push('PF not applicable for this employee (imported setting).');
  if (pfInDeduction) pfNotes.push('Statutory employee PF suppressed: a PF deduction pay element already exists.');
  const employerPf = snapshot.pfapplicable && !pfInEmployerElem && pfWageBase > 0
    ? round2(cfg.n('PFRateEmployer') / 100 * pfWageBase) : 0;
  if (pfInEmployerElem) pfNotes.push('Statutory employer PF suppressed: an employer PF element already exists.');

  const esiNotes = [];
  const employeeEsi = snapshot.esiapplicable && esiWithinCeiling && !esiInDeduction && esiWageBase > 0
    ? round2(cfg.n('ESIRateEmployee') / 100 * esiWageBase) : 0;
  if (!snapshot.esiapplicable) esiNotes.push('ESI not applicable for this employee (imported setting).');
  if (snapshot.esiapplicable && !esiWithinCeiling) esiNotes.push(`ESI wage ${esiWageBase} is above the configured ceiling ${esiCeiling}.`);
  if (esiInDeduction) esiNotes.push('Statutory employee ESI suppressed: an ESI deduction pay element already exists.');
  const employerEsi = snapshot.esiapplicable && esiWithinCeiling && !esiInEmployerElem && esiWageBase > 0
    ? round2(cfg.n('ESIRateEmployer') / 100 * esiWageBase) : 0;
  if (esiInEmployerElem) esiNotes.push('Statutory employer ESI suppressed: an employer ESI element already exists.');

  /* ---- Approved other dues / recoveries ---- */
  const dueRows = await listSalaryDues(pool, { paycode: employee.paycode, status: DUES_STATUS.APPROVED });
  const duesItems = dueRows.filter((d) => d.category === 'DUE')
    .map((d) => ({ id: d.id, kind: d.kind, description: d.description, amount: d.amount }));
  const recoveryItems = dueRows.filter((d) => d.category === 'RECOVERY')
    .map((d) => ({ id: d.id, kind: d.kind, description: d.description, amount: d.amount }));
  const duesTotal = round2(duesItems.reduce((s, x) => s + x.amount, 0));
  const recoveriesTotal = round2(recoveryItems.reduce((s, x) => s + x.amount, 0));

  /* ---- Employee deductions (pay elements + employee PF/ESI) ---- */
  const employeeDeductionItems = lists.deductions.map((l) => ({
    kind: 'PAY_ELEMENT', code: l.payelementcode, name: l.payelementname, amount: l.value, formula: l.formula,
  }));
  if (employeePf > 0) employeeDeductionItems.push({ kind: 'STATUTORY', code: 'PF', name: 'Employee Provident Fund', amount: employeePf, formula: `${cfg.n('PFRateEmployee')}% of ${upper(cfg.s('PFWageBasis'))} wage (${pfWageBase})` });
  if (employeeEsi > 0) employeeDeductionItems.push({ kind: 'STATUTORY', code: 'ESI', name: 'Employee ESI', amount: employeeEsi, formula: `${cfg.n('ESIRateEmployee')}% of ${upper(cfg.s('ESIWageBasis'))} wage (${esiWageBase})` });
  const employeeDeductionsTotal = round2(employeeDeductionItems.reduce((s, x) => s + x.amount, 0));

  /* ---- Employer contributions (informational, NEVER part of payable total) ---- */
  const employerItems = lists.employer.map((l) => ({
    kind: 'PAY_ELEMENT', code: l.payelementcode, name: l.payelementname, amount: l.value, formula: l.formula,
  }));
  if (employerPf > 0) employerItems.push({ kind: 'STATUTORY', code: 'ER_PF', name: 'Employer Provident Fund', amount: employerPf, formula: `${cfg.n('PFRateEmployer')}% of ${upper(cfg.s('PFWageBasis'))} wage (${pfWageBase})` });
  if (employerEsi > 0) employerItems.push({ kind: 'STATUTORY', code: 'ER_ESI', name: 'Employer ESI', amount: employerEsi, formula: `${cfg.n('ESIRateEmployer')}% of ${upper(cfg.s('ESIWageBasis'))} wage (${esiWageBase})` });
  const employerTotal = round2(employerItems.reduce((s, x) => s + x.amount, 0));

  /* ---- Transparent totals ---- */
  const additionsTotal = round2(gratuityAmount + bonus.amount + encashment.amount + noticePayAmount + duesTotal);
  const subtractionsTotal = round2(noticeRecoveryAmount + recoveriesTotal + employeeDeductionsTotal);
  const estimatedTotal = round2(additionsTotal - subtractionsTotal);

  return {
    leavingdate: leaveIso,
    leavingdateSource: employee.leavingdate && employee.leavingdate === leaveIso ? 'employee-record' : 'estimation-input',
    servicePeriod: period,
    salaryUsed: { basic: basicUsed, gross, effectivefrom: snapshot.effectivefrom },
    gratuity,
    bonus,
    leaveEncashment: encashment,
    notice,
    otherDues: { items: duesItems, total: duesTotal },
    otherRecoveries: { items: recoveryItems, total: recoveriesTotal },
    employeeDeductions: { items: employeeDeductionItems, total: employeeDeductionsTotal, notes: [...pfNotes, ...esiNotes] },
    employerContributions: { items: employerItems, total: employerTotal, note: 'Employer contributions are shown for information only - they are NOT part of the payable estimate.' },
    additionsTotal,
    subtractionsTotal,
    estimatedTotal,
    formula: 'Gratuity + Bonus + Leave Encashment + Notice Pay + Other Dues - Notice Recovery - Other Recoveries - Employee Deductions = Estimated Full & Final',
    disclaimer: DISCLAIMER,
  };
}
