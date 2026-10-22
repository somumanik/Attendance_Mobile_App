// ============================================================================
// FILE: server/salary-structure-service.js
// PURPOSE: SALARY STRUCTURE V1 - dynamic pay elements + Excel import/export.
// ============================================================================

/**
 * Salary Structure V1 (shared by the mobile app AND the Next.js website through
 * the same common backend - there is NO platform-local salary storage):
 *
 *   dbo.HR_SalaryMaster   - Employee Salary Master versions (EffectiveFrom keyed)
 *                           + V1 columns (EmployeeCode/EmployeeNumber/LocationCode/
 *                           Currency/Remarks + extensible extrafields JSON)
 *   dbo.HR_SalaryElement  - Employee Pay Elements (row per paycode+element+
 *                           EffectiveFrom) + V1 Navision columns (FixedOrPercent,
 *                           ComputationType, AddOrDeduct, PF/PT/ESI flags, OT,
 *                           C-Off, PayCadre, ActivePayElement, Processed,
 *                           PayrollPostingGroup, LeaveEncashment, Remarks)
 *   dbo.HR_PayElementMaster - flexible pay-element code reference (codes are
 *                           ROWS: BASIC, HRA, ... any future real code imports
 *                           without a schema or frontend change)
 *
 * DESIGN NOTES (regression safety):
 *   - The existing tables are EXTENDED with ADDITIVE nullable columns only.
 *     Nothing is renamed/removed, so the existing Full & Final engine
 *     (salary-service.js computeFullFinal) and the legacy Dataset A/B imports
 *     keep working byte-for-byte.
 *   - V1 rows are mapped deterministically into the legacy columns the F&F
 *     engine reads: AddOrDeduct ADD/DEDUCT -> EARNING/DEDUCTION, FixedOrPercent
 *     FIXED/PERCENT -> FIXED/PERCENTAGE. V1-only fields never drive F&F logic.
 *   - Effective-date policy follows the existing convention exactly: the row
 *     key is (paycode, effectivefrom) / (paycode, payelementcode, effectivefrom).
 *     Re-importing the same key upserts that ONE version; older effective-dated
 *     versions are never deleted or overwritten by newer salaries.
 *   - Unknown imported columns are preserved per-row in `extrafields` (JSON)
 *     and reported as warnings - never silently discarded.
 *   - Employee identity is ALWAYS dbo.tblemployee.paycode (the real login
 *     mapping). Navision EmployeeCode/EmployeeNumber are stored separately and
 *     never conflated with Paycode (EmployeeCode mapping reuses the existing
 *     dbo.HR_EmployeeCodeMapping infrastructure from leave-service.js).
 */

import { sql } from './db.js';
import { upsertEmployeeCodeMapping } from './leave-service.js';

const SALARY_MASTER_TABLE = process.env.HR_SALARY_MASTER_TABLE || 'dbo.HR_SalaryMaster';
const SALARY_ELEMENT_TABLE = process.env.HR_SALARY_ELEMENT_TABLE || 'dbo.HR_SalaryElement';
const PAY_ELEMENT_MASTER_TABLE = process.env.HR_PAY_ELEMENT_MASTER_TABLE || 'dbo.HR_PayElementMaster';
const EMPLOYEE_CODE_MAPPING_TABLE = process.env.HR_EMPLOYEE_CODE_MAPPING_TABLE || 'dbo.HR_EmployeeCodeMapping';

/* Deterministic V1 -> legacy mapping (the existing F&F engine contract). */
const TYPE_BY_ADD_DEDUCT = { ADD: 'EARNING', DEDUCT: 'DEDUCTION' };
const CALC_BY_FIXED_PERCENT = { FIXED: 'FIXED', PERCENT: 'PERCENTAGE' };
export const PERCENT_BASES = ['BASIC', 'GROSS', 'PF_WAGE', 'ESI_WAGE'];
export const ADD_OR_DEDUCT_VALUES = ['ADD', 'DEDUCT'];
export const FIXED_OR_PERCENT_VALUES = ['FIXED', 'PERCENT'];

export const NOTICE = {
  DUPLICATE_POLICY:
    'Same paycode + EffectiveFrom (and pay element code) upserts that one version; '
    + 'older effective-dated versions are always preserved. Identical rows are Skipped, '
    + 'changed rows are Updated, in-file duplicates are detected and reported.',
  GROSS_RULE:
    'Gross Salary is shown ONLY from an explicit GROSS pay-element source value. '
    + 'No summing of positive amounts is performed and this is NOT a CTC figure.',
};

/* ------------------------------------------------------------------ */
/* Small helpers (same semantics as salary-service.js)                  */
/* ------------------------------------------------------------------ */

const clean = (v) => String(v == null ? '' : v).trim();
const upper = (v) => clean(v).toUpperCase();
const round2 = (n) => Math.round((Number(n) || 0) * 100) / 100;
const todayIso = () => new Date().toISOString().slice(0, 10);

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

/** Strict boolean parse: true/false, null for blank, or 'INVALID'. */
function boolOrNull(v) {
  const s = upper(v);
  if (!s) return null;
  if (['Y', 'YES', 'TRUE', '1', 'T'].includes(s)) return true;
  if (['N', 'NO', 'FALSE', '0', 'F'].includes(s)) return false;
  return 'INVALID';
}

/* PROMPT 4.2 company-scope helpers (identical semantics to salary-service.js:
   null/undefined = unrestricted; empty array = deny everything). */
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

/**
 * Real roster lookup with the V1 display columns. Same semantics as
 * leave-service findActiveEmployee (active employees only - an import must
 * never invent an employee) plus department/designation for the structure UI.
 */
async function findRosterEmployee(pool, paycode) {
  const r = await pool.request()
    .input('paycode', sql.NVarChar(50), clean(paycode))
    .query(`SELECT TOP 1 LTRIM(RTRIM(paycode)) AS paycode,
                    LTRIM(RTRIM(empname)) AS empname,
                    LTRIM(RTRIM(presentcardno)) AS presentcardno,
                    LTRIM(RTRIM(companycode)) AS companycode,
                    LTRIM(RTRIM(departmentcode)) AS departmentcode,
                    LTRIM(RTRIM(designation)) AS designation
             FROM dbo.tblemployee
             WHERE LTRIM(RTRIM(paycode)) = @paycode AND ISNULL(active, 'Y') <> 'N'`);
  return r.recordset?.[0] || null;
}

/* ------------------------------------------------------------------ */
/* Column contracts (template headers; aliases accepted on import)      */
/* ------------------------------------------------------------------ */

export const SALARY_STRUCTURE_MASTER_COLUMNS = [
  'EmployeeCode', 'Paycode', 'BiometricCode', 'EmployeeName', 'EmployeeNumber',
  'CompanyCode', 'LocationCode', 'Department', 'Designation', 'EffectiveFrom',
  'BasicSalary', 'PFApplicable', 'ESIApplicable', 'PFWage', 'ESIWage',
  'Currency', 'Remarks',
];

export const SALARY_STRUCTURE_ELEMENT_COLUMNS = [
  'Paycode', 'EmployeeCode', 'EmployeeName', 'CompanyCode', 'LocationCode',
  'EffectiveFrom', 'PayElementCode', 'PayElementName', 'FixedOrPercent', 'Amount',
  'Percent', 'ComputationType', 'AddOrDeduct', 'PFApplicable', 'PTApplicable',
  'ESIApplicability', 'ApplicableForOT', 'ApplicableForCOff', 'PayCadre',
  'ActivePayElement', 'Processed', 'PayrollPostingGroup', 'LeaveEncashment', 'Remarks',
];

/* Pay Element Master contract - matches the Navision "Pay Elements List"
   reference exactly (recommended template headers). Codes are ROWS, so future
   real codes import without any schema/frontend change. */
export const PAY_ELEMENT_MASTER_COLUMNS = [
  'PayElementCode', 'Description', 'AddDeduct', 'ApplicableForOT', 'ESIApplicable',
  'PFApplicable', 'LeaveEncashmentApplicable', 'PayrollPostingGroup', 'Remarks', 'Active',
];

/* The master import additionally accepts the legacy PayElementName header (same
   readable label meaning as Description) so older template files keep working. */
const PEM_ACCEPTED_COLUMNS = [
  ...PAY_ELEMENT_MASTER_COLUMNS, 'PayElementName',
];

/* The element import additionally accepts the legacy Dataset B columns
   (they map 1:1 onto the same records) so no real file column is rejected. */
const ELEMENT_ACCEPTED_COLUMNS = [
  ...SALARY_STRUCTURE_ELEMENT_COLUMNS, 'PercentageBase', 'CalculationType', 'PayElementType',
];

/* ------------------------------------------------------------------ */
/* Schema ensure - additive columns only (HR_ table auto-ensure pattern) */
/* ------------------------------------------------------------------ */

let ensureState = null; // null = unknown, true = ready, string = error

export async function ensureSalaryStructureTables(pool) {
  if (ensureState === true) return;
  if (typeof ensureState === 'string') throw new Error(ensureState);
  try {
    // 1) Pay Element Master (NEW application-owned table - codes are rows, so
    //    future pay element codes need no schema change).
    await pool.request().batch(`
IF OBJECT_ID('${PAY_ELEMENT_MASTER_TABLE}','U') IS NULL
CREATE TABLE ${PAY_ELEMENT_MASTER_TABLE} (
  id INT IDENTITY(1,1) PRIMARY KEY,
  payelementcode NVARCHAR(20) NOT NULL,
  payelementname NVARCHAR(100) NULL,
  description NVARCHAR(200) NULL,
  active BIT NOT NULL CONSTRAINT DF_PayElemMaster_Active DEFAULT(1),
  remarks NVARCHAR(200) NULL,
  extrafields NVARCHAR(MAX) NULL,
  createddate DATETIME2 NOT NULL CONSTRAINT DF_PayElemMaster_Created DEFAULT SYSUTCDATETIME(),
  updateddate DATETIME2 NOT NULL CONSTRAINT DF_PayElemMaster_Updated DEFAULT SYSUTCDATETIME(),
  updatedby NVARCHAR(50) NULL,
  CONSTRAINT UQ_PayElemMaster UNIQUE (payelementcode)
);`);

    // 2) Additive nullable columns on the existing tables (never altered in
    //    place: only missing columns are added, so legacy rows/imports stay
    //    byte-for-byte compatible and the F&F engine keeps working).
    const addIfMissing = async (table, col, ddl) => {
      await pool.request().batch(
        `IF COL_LENGTH('${table}', '${col}') IS NULL ALTER TABLE ${table} ADD ${ddl};`,
      );
    };

    for (const [col, ddl] of [
      ['employeecode', 'employeecode NVARCHAR(50) NULL'],
      ['employeenumber', 'employeenumber NVARCHAR(50) NULL'],
      ['locationcode', 'locationcode NVARCHAR(50) NULL'],
      ['currency', 'currency NVARCHAR(10) NULL'],
      ['remarks', 'remarks NVARCHAR(200) NULL'],
      ['extrafields', 'extrafields NVARCHAR(MAX) NULL'],
    ]) await addIfMissing(SALARY_MASTER_TABLE, col, ddl);

    for (const [col, ddl] of [
      ['employeecode', 'employeecode NVARCHAR(50) NULL'],
      ['locationcode', 'locationcode NVARCHAR(50) NULL'],
      ['fixedorpercent', 'fixedorpercent NVARCHAR(20) NULL'],
      ['computationtype', 'computationtype NVARCHAR(50) NULL'],
      ['addordeduct', 'addordeduct NVARCHAR(20) NULL'],
      ['pfapplicable', 'pfapplicable BIT NULL'],
      ['ptapplicable', 'ptapplicable BIT NULL'],
      ['esiapplicability', 'esiapplicability BIT NULL'],
      ['applicableforot', 'applicableforot BIT NULL'],
      ['applicableforc', 'applicableforc BIT NULL'],
      ['paycadre', 'paycadre NVARCHAR(50) NULL'],
      ['activepayelement', 'activepayelement BIT NULL'],
      ['processed', 'processed BIT NULL'],
      ['payrollpostinggroup', 'payrollpostinggroup NVARCHAR(50) NULL'],
      ['leaveencashment', 'leaveencashment BIT NULL'],
      ['remarks', 'remarks NVARCHAR(200) NULL'],
      ['extrafields', 'extrafields NVARCHAR(MAX) NULL'],
    ]) await addIfMissing(SALARY_ELEMENT_TABLE, col, ddl);

    // 3) Pay Element Master structured Navision fields (additive, nullable).
    //    Canonical names reuse the employee-element names for the same meanings
    //    (addordeduct / leaveencashment / payrollpostinggroup / applicableforot).
    for (const [col, ddl] of [
      ['addordeduct', 'addordeduct NVARCHAR(20) NULL'],
      ['applicableforot', 'applicableforot BIT NULL'],
      ['esiapplicable', 'esiapplicable BIT NULL'],
      ['pfapplicable', 'pfapplicable BIT NULL'],
      ['leaveencashment', 'leaveencashment BIT NULL'],
      ['payrollpostinggroup', 'payrollpostinggroup NVARCHAR(50) NULL'],
    ]) await addIfMissing(PAY_ELEMENT_MASTER_TABLE, col, ddl);

    // One-time, idempotent migration: legacy imports kept Add/Deduct (and any
    // other Navision master fields) inside extrafields JSON - move those values
    // into the structured columns without ever overwriting stored data.
    await migratePayElementMasterMetadata(pool);

    ensureState = true;
  } catch (error) {
    ensureState = `Salary structure tables unavailable: ${String(error?.message || error || '')}`;
    throw new Error(ensureState);
  }
}

/* ------------------------------------------------------------------ */
/* Row normalisation - aliases, unknown-column preservation             */
/* ------------------------------------------------------------------ */

function newSummary() {
  return { imported: 0, updated: 0, skipped: 0, failed: 0, errors: [], results: [], warnings: [] };
}

function warnOnce(summary, message) {
  if (!summary.warnings.includes(message)) summary.warnings.push(message);
}

const ALIASES = {
  EmployeeCode: ['employeecode', 'employee_code', 'navisioncode'],
  Paycode: ['paycode', 'pay_code', 'pay code'],
  BiometricCode: ['biometriccode', 'biometric_code', 'cardno', 'presentcardno', 'card'],
  EmployeeName: ['employeename', 'employee_name', 'name', 'empname'],
  EmployeeNumber: ['employeenumber', 'employee_number', 'empno', 'employeeno'],
  CompanyCode: ['companycode', 'company_code', 'company'],
  LocationCode: ['locationcode', 'location_code', 'location', 'sitecode'],
  Department: ['department', 'departmentcode', 'department_code', 'dept'],
  Designation: ['designation', 'design'],
  EffectiveFrom: ['effectivefrom', 'effective_from', 'effectivedate', 'effective_date', 'fromdate'],
  BasicSalary: ['basicsalary', 'basic_salary', 'basic', 'basicsal'],
  PFApplicable: ['pfapplicable', 'pf_applicable', 'pf'],
  ESIApplicable: ['esiapplicable', 'esi_applicable', 'esi', 'esiapplicability', 'esi_applicability', 'esiflag'],
  PFWage: ['pfwage', 'pf_wage'],
  ESIWage: ['esiwage', 'esi_wage'],
  Currency: ['currency', 'currencycode', 'curr'],
  Remarks: ['remarks', 'remark', 'comments', 'note', 'notes'],
  PayElementCode: ['payelementcode', 'pay_element_code', 'elementcode', 'element_code'],
  PayElementName: ['payelementname', 'pay_element_name', 'elementname', 'element_name', 'name'],
  AddDeduct: ['adddeduct', 'add_deduct', 'addordeduct', 'add_or_deduct', 'additiondeduction', 'addition_deduction', 'addeduct'],
  LeaveEncashmentApplicable: ['leaveencashmentapplicable', 'leave_encashment_applicable', 'leaveencashment', 'leave_encashment', 'leaveencash', 'encashment'],
  FixedOrPercent: ['fixedorpercent', 'fixed_or_percent', 'fixorpercent', 'fixedpercent'],
  Amount: ['amount', 'value', 'amt'],
  Percent: ['percent', 'percentage', 'pct'],
  PercentageBase: ['percentagebase', 'percentage_base', 'base', 'paybasis'],
  CalculationType: ['calculationtype', 'calculation_type', 'calctype'],
  PayElementType: ['payelementtype', 'pay_element_type', 'elementtype', 'earningdeduction'],
  ComputationType: ['computationtype', 'computation_type', 'computedon', 'computation'],
  AddOrDeduct: ['addordeduct', 'add_or_deduct', 'adddeduct', 'add_deduct'],
  PTApplicable: ['ptapplicable', 'pt_applicable', 'pt'],
  ESIApplicability: ['esiapplicability', 'esi_applicability', 'esiflag'],
  ApplicableForOT: ['applicableforot', 'applicable_for_ot', 'otapplicable', 'ot'],
  ApplicableForCOff: ['applicableforc', 'applicableforcoff', 'applicable_for_coff', 'coffapplicable', 'coff', 'c-off', 'applicableforc-off'],
  PayCadre: ['paycadre', 'pay_cadre', 'cadre'],
  ActivePayElement: ['activepayelement', 'active_pay_element', 'activeelement', 'active'],
  Processed: ['processed', 'process'],
  PayrollPostingGroup: ['payrollpostinggroup', 'payroll_posting_group', 'postinggroup', 'payrollprodpostinggroup', 'prodpostinggroup', 'ppg'],
  LeaveEncashment: ['leaveencashment', 'leave_encashment', 'encashment', 'leaveencash'],
  Description: ['description', 'desc'],
  Active: ['active', 'isactive'],
};

const normHeader = (h) => String(h ?? '').toLowerCase().replace(/[^a-z0-9]/g, '');

/**
 * Build a canonical row from a raw sheet row. Known columns are picked via the
 * alias table; every OTHER raw column is preserved in `extra` (and reported as
 * a warning) so imported columns are NEVER silently discarded.
 */
function normaliseRow(raw, knownColumns) {
  const out = {};
  const extra = {};
  const usedRawKeys = new Set();
  for (const col of knownColumns) {
    const aliases = [col, ...(ALIASES[col] || [])].map(normHeader);
    for (const key of Object.keys(raw || {})) {
      if (usedRawKeys.has(key)) continue;
      const nk = normHeader(key);
      if (aliases.includes(nk) || aliases.some((a) => a && nk === a)) {
        out[col] = raw[key];
        usedRawKeys.add(key);
        break;
      }
    }
    if (!(col in out)) out[col] = '';
  }
  for (const key of Object.keys(raw || {})) {
    // Internal bookkeeping keys (e.g. __row from the workbook parser) are NOT
    // user columns - never report them as unsupported metadata.
    if (key.startsWith('__')) continue;
    if (!usedRawKeys.has(key) && clean(key) !== '') extra[clean(key)] = raw[key];
  }
  return { row: out, extra };
}

/* ------------------------------------------------------------------ */
/* PAY ELEMENT MASTER - flexible code reference (codes are ROWS)        */
/* ------------------------------------------------------------------ */

/** Map Add/Deduct input values to the application's canonical ADD / DEDUCT
 *  (same canonical values as the employee pay-element `addordeduct` field). */
function mapAddDeductValue(v) {
  const s = upper(v).replace(/[\s_-]/g, '');
  if (['ADD', 'ADDITION', 'EARNING', '+'].includes(s)) return 'ADD';
  if (['DEDUCT', 'DEDUCTION', 'DED', '-'].includes(s)) return 'DEDUCT';
  return null;
}

let migrateState = null; // null = unknown, object = report, string = error

/**
 * Idempotent application-level migration (runs once per process, after the
 * additive columns exist). Legacy imports stored Navision master fields
 * (Add/Deduct etc.) inside `extrafields` JSON - those values are MOVED into the
 * structured columns now. Rules:
 *   - structured columns are only filled when currently empty (never overwrite),
 *   - unparseable values are KEPT in the JSON (never lost) and counted,
 *   - internal `__row`-style keys are dropped (parser bookkeeping, not data),
 *   - a blank Description mirrors the existing label (PayElementName) - the
 *     same real value, no invented content.
 */
export async function migratePayElementMasterMetadata(pool) {
  if (migrateState && typeof migrateState === 'object') return migrateState;
  const out = { scanned: 0, rowsTouched: 0, fieldsMoved: 0, labelsMirrored: 0, unmappedKept: 0 };
  try {
    const r = await pool.request().query(`
      SELECT id, payelementname, description, addordeduct, applicableforot, esiapplicable,
             pfapplicable, leaveencashment, payrollpostinggroup, extrafields
      FROM ${PAY_ELEMENT_MASTER_TABLE}
      WHERE extrafields IS NOT NULL AND LTRIM(RTRIM(extrafields)) <> ''`);
    for (const db of r.recordset || []) {
      out.scanned += 1;
      let meta = null;
      try { meta = JSON.parse(db.extrafields); } catch { continue; }
      if (!meta || typeof meta !== 'object' || Array.isArray(meta)) continue;

      const { row, extra } = normaliseRow(meta, PEM_ACCEPTED_COLUMNS);
      const keep = { ...extra };
      const sets = [];

      if (clean(row.AddDeduct)) {
        const mapped = mapAddDeductValue(row.AddDeduct);
        if (!mapped) { keep.AddDeduct = row.AddDeduct; out.unmappedKept += 1; }
        else if (db.addordeduct === null || db.addordeduct === undefined) {
          sets.push(['addordeduct', mapped]); out.fieldsMoved += 1;
        }
      }
      for (const [col, key] of [
        ['applicableforot', 'ApplicableForOT'], ['esiapplicable', 'ESIApplicable'],
        ['pfapplicable', 'PFApplicable'], ['leaveencashment', 'LeaveEncashmentApplicable'],
      ]) {
        if (clean(row[key])) {
          const b = boolOrNull(row[key]);
          if (b === 'INVALID') { keep[key] = row[key]; out.unmappedKept += 1; }
          else if (b !== null && (db[col] === null || db[col] === undefined)) {
            sets.push([col, b ? 1 : 0]); out.fieldsMoved += 1;
          }
        }
      }
      if (clean(row.PayrollPostingGroup) && (db.payrollpostinggroup === null || db.payrollpostinggroup === undefined)) {
        sets.push(['payrollpostinggroup', clean(row.PayrollPostingGroup).slice(0, 50)]);
        out.fieldsMoved += 1;
      }
      if (!clean(db.description) && clean(db.payelementname)) {
        sets.push(['description', clean(db.payelementname).slice(0, 200)]);
        out.labelsMirrored += 1;
      }

      const extraJson = Object.keys(keep).length ? JSON.stringify(keep) : null;
      if (sets.length || extraJson !== (db.extrafields ?? null)) {
        const req = pool.request().input('id', sql.Int, db.id)
          .input('extra', sql.NVarChar(sql.MAX), extraJson);
        const assigns = ['extrafields = @extra'];
        for (const [col, val] of sets) {
          if (col === 'addordeduct') assigns.push('addordeduct = @addordeduct');
          else if (col === 'payrollpostinggroup') assigns.push('payrollpostinggroup = @payrollpostinggroup');
          else if (col === 'description') assigns.push('description = @description');
          else assigns.push(`${col} = @${col}`);
          req.input(col, col === 'addordeduct' || col === 'payrollpostinggroup' || col === 'description'
            ? sql.NVarChar(col === 'addordeduct' ? 20 : col === 'payrollpostinggroup' ? 50 : 200) : sql.Bit, val);
        }
        await req.query(`UPDATE ${PAY_ELEMENT_MASTER_TABLE} SET ${assigns.join(', ')} WHERE id = @id`);
        out.rowsTouched += 1;
      }
    }
    migrateState = out;
    console.log(`[PAYELEM_MIGRATE] scanned=${out.scanned} rowsTouched=${out.rowsTouched} fieldsMoved=${out.fieldsMoved} labelsMirrored=${out.labelsMirrored} unmappedKept=${out.unmappedKept}`);
    return out;
  } catch (error) {
    migrateState = `Pay element master migration unavailable: ${String(error?.message || error || '')}`;
    throw new Error(migrateState);
  }
}

/**
 * Upsert pay element master rows by code. Unknown NEW codes are legitimate and
 * imported freely (no allowed-code list exists). Identical rows are Skipped;
 * changed rows for an existing code are Updated (reported per row - never a
 * silent overwrite). Mandatory: PayElementCode + Description (PayElementName is
 * accepted as the same readable label for legacy files).
 */
export async function importPayElementMasterRows(pool, { rows, actor, summary }) {
  const seen = new Map(); // in-file duplicate detection
  for (let index = 0; index < (rows || []).length; index += 1) {
    const raw = rows[index] || {};
    const excelRow = raw.__row || index + 2;
    const { row, extra } = normaliseRow(raw, PEM_ACCEPTED_COLUMNS);
    const code = upper(row.PayElementCode);
    // Description is the canonical readable label; PayElementName is its legacy
    // alias. When only one is supplied it is mirrored into both columns so no
    // consumer (element name fallback, export) sees a blank label.
    const description = clean(row.Description) || clean(row.PayElementName);
    const name = clean(row.PayElementName) || clean(row.Description);
    const remarks = clean(row.Remarks);
    const activeFlag = boolOrNull(row.Active);
    const addDeductRaw = clean(row.AddDeduct);
    const addDeduct = addDeductRaw ? mapAddDeductValue(addDeductRaw) : null;
    const flagPairs = [
      ['ApplicableForOT', 'applicableforot'], ['ESIApplicable', 'esiapplicable'],
      ['PFApplicable', 'pfapplicable'], ['LeaveEncashmentApplicable', 'leaveencashment'],
    ];
    const flags = {};
    let badField = null;
    for (const [key, col] of flagPairs) {
      const b = boolOrNull(row[key]);
      if (b === 'INVALID') { badField = { field: key, message: `${key} "${row[key]}" must be a documented boolean (Y/N or TRUE/FALSE).` }; break; }
      flags[col] = b;
    }
    const postingGroup = clean(row.PayrollPostingGroup).slice(0, 50);

    const fail = (message, field) => {
      summary.failed += 1;
      summary.errors.push({ row: excelRow, employeeCode: code, field: field || '', message });
      summary.results.push({ row: excelRow, employeeCode: code, payelementcode: code, status: 'Failed', message });
    };

    if (!code) { fail('PayElementCode is empty.', 'PayElementCode'); continue; }
    if (code.length > 20) { fail(`PayElementCode "${code}" is longer than 20 characters.`, 'PayElementCode'); continue; }
    if (!description) { fail('Description is required (the readable component label).', 'Description'); continue; }
    if (addDeductRaw && !addDeduct) { fail(`AddDeduct "${addDeductRaw}" must be Addition or Deduction.`, 'AddDeduct'); continue; }
    if (badField) { fail(badField.message, badField.field); continue; }
    if (!addDeductRaw) {
      warnOnce(summary, `Row ${excelRow}: AddDeduct not specified for "${code}" - component classification left empty (no value invented).`);
    }

    const key = code;
    const sig = JSON.stringify([name, description, addDeduct, flags, postingGroup, remarks, activeFlag]);
    if (seen.has(key)) {
      const prev = seen.get(key);
      if (prev.sig === sig) {
        summary.skipped += 1;
        summary.results.push({ row: excelRow, employeeCode: code, payelementcode: code, status: 'Skipped', message: `Duplicate of row ${prev.row} in file (same code and values).` });
      } else {
        fail(`Conflicts with row ${prev.row} in file for the same PayElementCode "${code}" (different values) - fix the file and re-import.`, 'PayElementCode');
      }
      continue;
    }
    seen.set(key, { row: excelRow, sig });

    if (Object.keys(extra).length) {
      warnOnce(summary, `PayElementMaster: column(s) ${Object.keys(extra).join(', ')} are not supported fields - preserved in the row's extra fields metadata.`);
    }

    const extraJson = Object.keys(extra).length ? JSON.stringify(extra) : null;
    const existing = await pool.request()
      .input('code', sql.NVarChar(20), code)
      .query(`SELECT TOP 1 id, payelementname, description, addordeduct, applicableforot, esiapplicable,
                     pfapplicable, leaveencashment, payrollpostinggroup, active, remarks, extrafields
              FROM ${PAY_ELEMENT_MASTER_TABLE} WHERE LTRIM(RTRIM(payelementcode)) = @code`);
    const by = clean(actor).slice(0, 50);

    if (existing.recordset?.[0]) {
      const db = existing.recordset[0];
      const dbBool = (v) => (v === null || v === undefined ? null : Boolean(v));
      const same = clean(db.payelementname) === name
        && clean(db.description) === description
        && (addDeduct === null || upper(db.addordeduct || '') === addDeduct)
        && flagPairs.every(([, col]) => flags[col] === null || dbBool(db[col]) === flags[col])
        && (!postingGroup || clean(db.payrollpostinggroup) === postingGroup)
        && (!remarks || clean(db.remarks) === remarks)
        && (activeFlag === null || dbBool(db.active) === activeFlag)
        && (db.extrafields ?? null) === (extraJson ?? null);
      if (same) {
        summary.skipped += 1;
        summary.results.push({ row: excelRow, employeeCode: code, payelementcode: code, status: 'Skipped', message: 'Pay element master row is unchanged.' });
        continue;
      }
      // SAFE UPDATE: only explicitly supplied values are written; a blank cell
      // keeps the stored value (never a silent overwrite / null-out).
      const req = pool.request()
        .input('id', sql.Int, db.id)
        .input('name', sql.NVarChar(100), name || null)
        .input('desc', sql.NVarChar(200), description || null)
        .input('by', sql.NVarChar(50), by)
        .input('extra', sql.NVarChar(sql.MAX), extraJson ?? db.extrafields ?? null);
      const assigns = ['payelementname = @name', 'description = @desc', 'extrafields = @extra'];
      if (addDeduct !== null) { req.input('addordeduct', sql.NVarChar(20), addDeduct); assigns.push('addordeduct = @addordeduct'); }
      for (const [, col] of flagPairs) {
        if (flags[col] !== null) { req.input(col, sql.Bit, flags[col] ? 1 : 0); assigns.push(`${col} = @${col}`); }
      }
      if (postingGroup) { req.input('payrollpostinggroup', sql.NVarChar(50), postingGroup); assigns.push('payrollpostinggroup = @payrollpostinggroup'); }
      if (remarks) { req.input('remarks', sql.NVarChar(200), remarks); assigns.push('remarks = @remarks'); }
      if (activeFlag !== null) { req.input('active', sql.Bit, activeFlag ? 1 : 0); assigns.push('active = @active'); }
      await req.query(`UPDATE ${PAY_ELEMENT_MASTER_TABLE}
              SET ${assigns.join(', ')}, updateddate = SYSUTCDATETIME(), updatedby = @by
              WHERE id = @id`);
      summary.updated += 1;
      summary.results.push({ row: excelRow, employeeCode: code, payelementcode: code, status: 'Updated' });
    } else {
      await pool.request()
        .input('code', sql.NVarChar(20), code)
        .input('name', sql.NVarChar(100), name || null)
        .input('desc', sql.NVarChar(200), description || null)
        .input('addordeduct', sql.NVarChar(20), addDeduct)
        .input('applicableforot', sql.Bit, flags.applicableforot === null ? null : (flags.applicableforot ? 1 : 0))
        .input('esiapplicable', sql.Bit, flags.esiapplicable === null ? null : (flags.esiapplicable ? 1 : 0))
        .input('pfapplicable', sql.Bit, flags.pfapplicable === null ? null : (flags.pfapplicable ? 1 : 0))
        .input('leaveencashment', sql.Bit, flags.leaveencashment === null ? null : (flags.leaveencashment ? 1 : 0))
        .input('payrollpostinggroup', sql.NVarChar(50), postingGroup || null)
        .input('active', sql.Bit, activeFlag === null ? 1 : (activeFlag ? 1 : 0))
        .input('remarks', sql.NVarChar(200), remarks || null)
        .input('extra', sql.NVarChar(sql.MAX), extraJson)
        .input('by', sql.NVarChar(50), by)
        .query(`INSERT INTO ${PAY_ELEMENT_MASTER_TABLE}
                  (payelementcode, payelementname, description, addordeduct, applicableforot,
                   esiapplicable, pfapplicable, leaveencashment, payrollpostinggroup,
                   active, remarks, extrafields, updatedby)
                VALUES (@code, @name, @desc, @addordeduct, @applicableforot,
                        @esiapplicable, @pfapplicable, @leaveencashment, @payrollpostinggroup,
                        @active, @remarks, @extra, @by)`);
      summary.imported += 1;
      summary.results.push({ row: excelRow, employeeCode: code, payelementcode: code, status: 'Imported' });
    }
  }
  return summary;
}

/**
 * Pay Element Master lookup (READ-ONLY). The master is a manually maintained
 * reference list - importers NEVER fabricate master definitions.
 */
export async function getPayElementMasterEntry(pool, code) {
  const r = await pool.request()
    .input('code', sql.NVarChar(20), code)
    .query(`SELECT TOP 1 id, LTRIM(RTRIM(payelementcode)) AS payelementcode, payelementname, description,
            LTRIM(RTRIM(addordeduct)) AS addordeduct, applicableforot, esiapplicable, pfapplicable,
            leaveencashment, payrollpostinggroup, active
            FROM ${PAY_ELEMENT_MASTER_TABLE} WHERE LTRIM(RTRIM(payelementcode)) = @code`);
  const row = r.recordset?.[0];
  if (!row) return null;
  return {
    id: row.id,
    payelementcode: clean(row.payelementcode),
    payelementname: clean(row.payelementname),
    description: clean(row.description),
    addordeduct: clean(row.addordeduct),
    applicableforot: boolFromDb(row.applicableforot),
    esiapplicable: boolFromDb(row.esiapplicable),
    pfapplicable: boolFromDb(row.pfapplicable),
    leaveencashment: boolFromDb(row.leaveencashment),
    payrollpostinggroup: clean(row.payrollpostinggroup),
    active: boolFromDb(row.active),
  };
}

/**
 * Validate a PayElementCode against the application Pay Element Master.
 *   - Unknown codes are REPORTED clearly and the row still imports with its
 *     supplied code/name (never silently discarded, never auto-registered).
 *   - Known codes: name differences and inactive master entries are reported;
 *     the row keeps its supplied PayElementName (the original is always stored).
 * Returns { known, name } (name falls back to the master name when blank).
 */
export async function validatePayElementCode(pool, { code, name, excelRow, summary }) {
  const entry = await getPayElementMasterEntry(pool, code);
  const supplied = clean(name);
  if (!entry) {
    warnOnce(summary, `Row ${excelRow}: PayElementCode "${code}" is not in the Pay Element Master - the row is imported with the supplied code/name and NO master definition was created.`);
    return { known: false, name: supplied };
  }
  const masterLabel = entry.payelementname || entry.description;
  if (supplied && masterLabel && supplied.toUpperCase() !== masterLabel.toUpperCase()) {
    warnOnce(summary, `Row ${excelRow}: PayElementName "${supplied}" differs from the Pay Element Master label "${masterLabel}" for code "${code}". The imported row keeps the supplied name.`);
  }
  if (entry.active === false) {
    warnOnce(summary, `Row ${excelRow}: PayElementCode "${code}" is marked INACTIVE in the Pay Element Master.`);
  }
  return { known: true, name: supplied || masterLabel };
}


/* ------------------------------------------------------------------ */
/* MANUAL CRUD - Add / Edit / Delete Selected (HR portal tables).      */
/* Same business rules as the Excel importers (shared validators, same */
/* messages). Every write is parameterized. Deletes are reference-safe:*/
/* processed payroll rows, approved dues and referenced pay element    */
/* master codes are NEVER silently hard-deleted - they are reported.   */
/* ------------------------------------------------------------------ */

const SALARY_DUES_REF_TABLE = process.env.HR_SALARY_DUES_TABLE || 'dbo.HR_SalaryDues';

const crudErr = (field, message) => ({ field, message });

function crudFlag(value, field, errors) {
  const b = boolOrNull(value);
  if (b === 'INVALID') {
    errors.push(crudErr(field, `${field} "${value}" must be Y or N (or TRUE/FALSE).`));
    return null;
  }
  return b;
}

function crudNumField(value, field, errors) {
  const raw = clean(value);
  if (!raw) return null;
  const n = num(value);
  if (n === null || n < 0) {
    errors.push(crudErr(field, `${field} "${value}" must be a number >= 0.`));
    return null;
  }
  return n;
}

/** True when payroll was processed for this salary version, or an approved
 *  dues/settlement decision may have been calculated from it. */
async function salaryVersionReferences(pool, paycode, effIso) {
  const r = await pool.request()
    .input('paycode', sql.NVarChar(50), paycode)
    .input('from', sql.Date, effIso)
    .query(`
      SELECT
        (SELECT COUNT(*) FROM ${SALARY_ELEMENT_TABLE} e
          WHERE LTRIM(RTRIM(e.paycode)) = @paycode AND e.effectivefrom = @from AND e.processed = 1) AS processedElements,
        (SELECT COUNT(*) FROM ${SALARY_DUES_REF_TABLE} d
          WHERE LTRIM(RTRIM(d.paycode)) = @paycode AND UPPER(LTRIM(RTRIM(d.status))) = 'APPROVED'
            AND (d.decidedat IS NULL OR CAST(d.decidedat AS date) >= @from)) AS approvedDues`);
  const x = r.recordset?.[0] || {};
  return { processedElements: Number(x.processedElements || 0), approvedDues: Number(x.approvedDues || 0) };
}

export async function createSalaryMasterVersion(pool, { input = {}, actor, companyScope }) {
  await ensureSalaryStructureTables(pool);
  const errors = [];
  const warnings = [];
  const paycode = upper(clean(input.paycode));
  const effective = toIsoDate(input.effectivefrom);

  if (!paycode) {
    errors.push(crudErr('paycode', 'Paycode is required.'));
  } else {
    const employee = await findRosterEmployee(pool, paycode);
    if (!employee) {
      errors.push(crudErr('paycode', `Paycode "${paycode}" was not found among active employees.`));
    } else {
      const scope = await paycodeCompanyAllowed(pool, employee.paycode, companyScope);
      if (!scope.allowed) errors.push(crudErr('paycode', `Paycode "${paycode}" belongs to a company outside your access.`));
    }
  }
  if (!isValidIsoDate(effective)) {
    errors.push(crudErr('effectivefrom', 'EffectiveFrom is required and must be a valid date (YYYY-MM-DD).'));
  }

  const basic = crudNumField(input.basicsalary, 'basicsalary', errors);
  const pfW = crudNumField(input.pfwage, 'pfwage', errors);
  const esiW = crudNumField(input.esiwage, 'esiwage', errors);
  const pfB = crudFlag(input.pfapplicable, 'pfapplicable', errors);
  const esiB = crudFlag(input.esiapplicable, 'esiapplicable', errors);
  if (errors.length) return { success: false, errors, warnings };

  if (basic === null) {
    warnings.push('BasicSalary not supplied - stored 0 for this version (same rule as the import).');
  }
  const dup = await pool.request()
    .input('paycode', sql.NVarChar(50), paycode)
    .input('from', sql.Date, effective)
    .query(`SELECT TOP 1 id FROM ${SALARY_MASTER_TABLE} WHERE LTRIM(RTRIM(paycode)) = @paycode AND effectivefrom = @from`);
  if (dup.recordset?.[0]) {
    return {
      success: false,
      errors: [crudErr('effectivefrom', `A salary version already exists for ${paycode} at ${effective} - use Edit to update that version.`)],
      warnings,
    };
  }

  await pool.request()
    .input('paycode', sql.NVarChar(50), paycode)
    .input('from', sql.Date, effective)
    .input('basic', sql.Decimal(12, 2), basic === null ? 0 : round2(basic))
    .input('pf', sql.Bit, pfB ? 1 : 0)
    .input('esi', sql.Bit, esiB ? 1 : 0)
    .input('pfwage', sql.Decimal(12, 2), pfW === null ? 0 : round2(pfW))
    .input('esiwage', sql.Decimal(12, 2), esiW === null ? 0 : round2(esiW))
    .input('employeecode', sql.NVarChar(50), clean(input.employeecode).slice(0, 50) || null)
    .input('locationcode', sql.NVarChar(50), clean(input.locationcode).slice(0, 50) || null)
    .input('currency', sql.NVarChar(20), clean(input.currency).slice(0, 20) || null)
    .input('remarks', sql.NVarChar(200), clean(input.remarks).slice(0, 200) || null)
    .input('by', sql.NVarChar(50), clean(actor).slice(0, 50))
    .query(`INSERT INTO ${SALARY_MASTER_TABLE}
              (paycode, effectivefrom, basicsalary, pfapplicable, esiapplicable, pfwage, esiwage,
               employeecode, locationcode, currency, remarks, updatedby)
            VALUES (@paycode, @from, @basic, @pf, @esi, @pfwage, @esiwage,
                    @employeecode, @locationcode, @currency, @remarks, @by)`);

  const created = await pool.request()
    .input('paycode', sql.NVarChar(50), paycode)
    .input('from', sql.Date, effective)
    .query(`SELECT TOP 1 id FROM ${SALARY_MASTER_TABLE} WHERE LTRIM(RTRIM(paycode)) = @paycode AND effectivefrom = @from`);
  return { success: true, id: created.recordset?.[0]?.id ?? null, warnings, message: 'Salary version created.' };
}

export async function updateSalaryMasterVersion(pool, { id, input = {}, actor, companyScope }) {
  await ensureSalaryStructureTables(pool);
  const errors = [];
  const warnings = [];
  const row = await pool.request()
    .input('id', sql.Int, Number(id))
    .query(`SELECT TOP 1 id, LTRIM(RTRIM(paycode)) AS paycode, effectivefrom FROM ${SALARY_MASTER_TABLE} WHERE id = @id`);
  const db = row.recordset?.[0];
  if (!db) return { success: false, errors: [crudErr('id', 'Salary version not found.')], warnings };

  const paycode = clean(db.paycode);
  const scope = await paycodeCompanyAllowed(pool, paycode, companyScope);
  if (!scope.allowed) return { success: false, errors: [crudErr('paycode', `Paycode "${paycode}" belongs to a company outside your access.`)], warnings };

  // Paycode is the employee identity - never re-attach a salary version to a
  // different employee.
  if (clean(input.paycode) && upper(clean(input.paycode)) !== paycode) {
    errors.push(crudErr('paycode', 'Paycode cannot be changed on an existing salary version. Delete the version and add a new one instead.'));
  }
  const effective = input.effectivefrom === undefined ? toIsoDate(db.effectivefrom) : toIsoDate(input.effectivefrom);
  if (!isValidIsoDate(effective)) {
    errors.push(crudErr('effectivefrom', 'EffectiveFrom is required and must be a valid date (YYYY-MM-DD).'));
  } else {
    const dup = await pool.request()
      .input('paycode', sql.NVarChar(50), paycode)
      .input('from', sql.Date, effective)
      .input('id', sql.Int, Number(id))
      .query(`SELECT TOP 1 id FROM ${SALARY_MASTER_TABLE} WHERE LTRIM(RTRIM(paycode)) = @paycode AND effectivefrom = @from AND id <> @id`);
    if (dup.recordset?.[0]) {
      errors.push(crudErr('effectivefrom', `Another salary version already exists for ${paycode} at ${effective}.`));
    }
  }

  const basic = crudNumField(input.basicsalary, 'basicsalary', errors);
  const pfW = crudNumField(input.pfwage, 'pfwage', errors);
  const esiW = crudNumField(input.esiwage, 'esiwage', errors);
  const pfB = crudFlag(input.pfapplicable, 'pfapplicable', errors);
  const esiB = crudFlag(input.esiapplicable, 'esiapplicable', errors);
  if (errors.length) return { success: false, errors, warnings };

  await pool.request()
    .input('id', sql.Int, Number(id))
    .input('from', sql.Date, effective)
    .input('basic', sql.Decimal(12, 2), basic === null ? 0 : round2(basic))
    .input('pf', sql.Bit, pfB ? 1 : 0)
    .input('esi', sql.Bit, esiB ? 1 : 0)
    .input('pfwage', sql.Decimal(12, 2), pfW === null ? 0 : round2(pfW))
    .input('esiwage', sql.Decimal(12, 2), esiW === null ? 0 : round2(esiW))
    .input('employeecode', sql.NVarChar(50), clean(input.employeecode).slice(0, 50) || null)
    .input('locationcode', sql.NVarChar(50), clean(input.locationcode).slice(0, 50) || null)
    .input('currency', sql.NVarChar(20), clean(input.currency).slice(0, 20) || null)
    .input('remarks', sql.NVarChar(200), clean(input.remarks).slice(0, 200) || null)
    .input('by', sql.NVarChar(50), clean(actor).slice(0, 50))
    .query(`UPDATE ${SALARY_MASTER_TABLE}
            SET effectivefrom = @from, basicsalary = @basic, pfapplicable = @pf, esiapplicable = @esi,
                pfwage = @pfwage, esiwage = @esiwage, employeecode = @employeecode,
                locationcode = @locationcode, currency = @currency, remarks = @remarks,
                updateddate = SYSUTCDATETIME(), updatedby = @by
            WHERE id = @id`);
  return { success: true, id: Number(id), warnings, message: 'Salary version updated.' };
}

export async function deleteSalaryMasterRows(pool, { ids = [], actor, companyScope }) {
  await ensureSalaryStructureTables(pool);
  const results = [];
  let deleted = 0;
  for (const rawId of ids) {
    const id = Number(rawId);
    if (!Number.isInteger(id)) { results.push({ id: rawId, status: 'Failed', message: 'Invalid row id.' }); continue; }
    const r = await pool.request()
      .input('id', sql.Int, id)
      .query(`SELECT TOP 1 id, LTRIM(RTRIM(paycode)) AS paycode, effectivefrom FROM ${SALARY_MASTER_TABLE} WHERE id = @id`);
    const db = r.recordset?.[0];
    if (!db) { results.push({ id, status: 'Failed', message: 'Salary version not found.' }); continue; }
    const scope = await paycodeCompanyAllowed(pool, clean(db.paycode), companyScope);
    if (!scope.allowed) { results.push({ id, status: 'Failed', message: `Paycode "${clean(db.paycode)}" belongs to a company outside your access.` }); continue; }

    const refs = await salaryVersionReferences(pool, clean(db.paycode), toIsoDate(db.effectivefrom));
    if (refs.processedElements > 0) {
      results.push({ id, status: 'Kept', message: `Referenced by processed payroll (${refs.processedElements} processed pay element row(s)) - kept for history.` });
      continue;
    }
    if (refs.approvedDues > 0) {
      results.push({ id, status: 'Kept', message: `Referenced by ${refs.approvedDues} approved dues/settlement record(s) - kept for history.` });
      continue;
    }
    await pool.request().input('id', sql.Int, id).query(`DELETE FROM ${SALARY_MASTER_TABLE} WHERE id = @id`);
    deleted += 1;
    results.push({ id, status: 'Deleted', message: 'Salary version deleted.' });
  }
  return { success: true, deleted, results };
}

export async function createElementAssignment(pool, { input = {}, actor, companyScope }) {
  await ensureSalaryStructureTables(pool);
  const errors = [];
  const warnings = [];
  const paycode = upper(clean(input.paycode));
  const elemCode = upper(clean(input.payelementcode));
  const effective = toIsoDate(input.effectivefrom);

  if (!paycode) {
    errors.push(crudErr('paycode', 'Paycode is required.'));
  } else {
    const employee = await findRosterEmployee(pool, paycode);
    if (!employee) {
      errors.push(crudErr('paycode', `Paycode "${paycode}" was not found among active employees.`));
    } else {
      const scope = await paycodeCompanyAllowed(pool, employee.paycode, companyScope);
      if (!scope.allowed) errors.push(crudErr('paycode', `Paycode "${paycode}" belongs to a company outside your access.`));
    }
  }
  if (!elemCode) errors.push(crudErr('payelementcode', 'PayElementCode is required.'));
  else if (elemCode.length > 20) errors.push(crudErr('payelementcode', `PayElementCode "${elemCode}" is longer than 20 characters.`));
  if (!isValidIsoDate(effective)) {
    errors.push(crudErr('effectivefrom', 'EffectiveFrom is required and must be a valid date (YYYY-MM-DD).'));
  }

  const fp = upper(clean(input.fixedorpercent)).replace(/[\s_-]/g, '');
  const fixedOrPercent = ['FIXED', 'FIX', 'F'].includes(fp) ? 'FIXED'
    : ['PERCENT', 'PERCENTAGE', 'PCT', 'P'].includes(fp) ? 'PERCENT' : null;
  if (!fixedOrPercent) errors.push(crudErr('fixedorpercent', 'FixedOrPercent must be FIXED or PERCENT.'));
  const ad = upper(clean(input.addordeduct)).replace(/[\s_-]/g, '');
  const addOrDeduct = ['ADD', 'ADDITION', 'EARNING', '+'].includes(ad) ? 'ADD'
    : ['DEDUCT', 'DEDUCTION', 'DED', '-'].includes(ad) ? 'DEDUCT' : null;
  if (!addOrDeduct) errors.push(crudErr('addordeduct', 'AddOrDeduct must be ADD or DEDUCT.'));

  const amount = num(input.amount);
  const percent = num(input.percent);
  if (fixedOrPercent === 'FIXED' && (amount === null || amount < 0)) {
    errors.push(crudErr('amount', `Amount "${clean(input.amount)}" must be a number >= 0 for FIXED elements.`));
  }
  if (fixedOrPercent === 'PERCENT' && (percent === null || percent < 0)) {
    errors.push(crudErr('percent', `Percent "${clean(input.percent)}" must be a number >= 0 for PERCENT elements.`));
  }

  const flagInputs = [
    ['pfapplicable', input.pfapplicable], ['ptapplicable', input.ptapplicable],
    ['esiapplicability', input.esiapplicability], ['applicableforot', input.applicableforot],
    ['applicableforc', input.applicableforc], ['activepayelement', input.activepayelement],
    ['processed', input.processed], ['leaveencashment', input.leaveencashment],
  ];
  const flags = {};
  for (const [f, v] of flagInputs) flags[f] = crudFlag(v, f, errors);
  if (errors.length) return { success: false, errors, warnings };

  const computationType = clean(input.computationtype);
  const explicitBase = upper(clean(input.percentagebase));
  let percentBase = PERCENT_BASES.includes(explicitBase) ? explicitBase : null;
  if (!percentBase && fixedOrPercent === 'PERCENT') {
    const ct = upper(computationType).replace(/[\s-]/g, '_');
    if (PERCENT_BASES.includes(ct)) percentBase = ct;
  }
  if (fixedOrPercent === 'PERCENT' && !percentBase) {
    warnings.push(`ComputationType "${computationType}" is not a known wage base (${PERCENT_BASES.join('/')}) and no PercentageBase was supplied - the percent amount will not be computable until a base is provided.`);
  }

  // PayElementCode validated against the master exactly like the import:
  // unknown codes are reported, never auto-registered into the master.
  const nameSummary = { warnings: [] };
  let elemName = clean(input.payelementname);
  const pem = await validatePayElementCode(pool, { code: elemCode, name: elemName, excelRow: 'manual', summary: nameSummary });
  if (!elemName && pem.name) elemName = pem.name;
  warnings.push(...nameSummary.warnings);
  if (!elemName) {
    errors.push(crudErr('payelementname', `PayElementName is required for the pay element code "${elemCode}" (the code is not in the Pay Element Master, so the name cannot be resolved).`));
    return { success: false, errors, warnings };
  }

  const dup = await pool.request()
    .input('paycode', sql.NVarChar(50), paycode)
    .input('code', sql.NVarChar(20), elemCode)
    .input('from', sql.Date, effective)
    .query(`SELECT TOP 1 id FROM ${SALARY_ELEMENT_TABLE}
            WHERE LTRIM(RTRIM(paycode)) = @paycode AND LTRIM(RTRIM(payelementcode)) = @code AND effectivefrom = @from`);
  if (dup.recordset?.[0]) {
    return {
      success: false,
      errors: [crudErr('effectivefrom', `A pay element "${elemCode}" already exists for ${paycode} at ${effective} - use Edit to update that row.`)],
      warnings,
    };
  }
  return createElementRowInsert(pool, {
    paycode, elemCode, elemName, fixedOrPercent, addOrDeduct, amount, percent, percentBase,
    effective, input, flags, computationType, actor, warnings,
  });
}

async function createElementRowInsert(pool, ctx) {
  const {
    paycode, elemCode, elemName, fixedOrPercent, addOrDeduct, amount, percent, percentBase,
    effective, input, flags, computationType, actor, warnings,
  } = ctx;
  await pool.request()
    .input('paycode', sql.NVarChar(50), paycode)
    .input('code', sql.NVarChar(20), elemCode)
    .input('name', sql.NVarChar(100), elemName)
    .input('type', sql.NVarChar(30), TYPE_BY_ADD_DEDUCT[addOrDeduct])
    .input('calc', sql.NVarChar(20), CALC_BY_FIXED_PERCENT[fixedOrPercent])
    .input('amount', sql.Decimal(12, 2), amount === null ? null : round2(amount))
    .input('pct', sql.Decimal(9, 4), percent)
    .input('base', sql.NVarChar(20), percentBase)
    .input('from', sql.Date, effective)
    .input('ecode', sql.NVarChar(50), clean(input.employeecode).slice(0, 50) || null)
    .input('loc', sql.NVarChar(50), clean(input.locationcode).slice(0, 50) || null)
    .input('forp', sql.NVarChar(20), fixedOrPercent)
    .input('comp', sql.NVarChar(50), computationType || null)
    .input('aod', sql.NVarChar(20), addOrDeduct)
    .input('pf', sql.Bit, flags.pfapplicable === null ? null : (flags.pfapplicable ? 1 : 0))
    .input('pt', sql.Bit, flags.ptapplicable === null ? null : (flags.ptapplicable ? 1 : 0))
    .input('esi', sql.Bit, flags.esiapplicability === null ? null : (flags.esiapplicability ? 1 : 0))
    .input('ot', sql.Bit, flags.applicableforot === null ? null : (flags.applicableforot ? 1 : 0))
    .input('coff', sql.Bit, flags.applicableforc === null ? null : (flags.applicableforc ? 1 : 0))
    .input('cadre', sql.NVarChar(50), clean(input.paycadre).slice(0, 50) || null)
    .input('active', sql.Bit, flags.activepayelement === null ? null : (flags.activepayelement ? 1 : 0))
    .input('proc', sql.Bit, flags.processed === null ? null : (flags.processed ? 1 : 0))
    .input('ppg', sql.NVarChar(50), clean(input.payrollpostinggroup).slice(0, 50) || null)
    .input('encash', sql.Bit, flags.leaveencashment === null ? null : (flags.leaveencashment ? 1 : 0))
    .input('rem', sql.NVarChar(200), clean(input.remarks).slice(0, 200) || null)
    .input('by', sql.NVarChar(50), clean(actor).slice(0, 50))
    .query(`INSERT INTO ${SALARY_ELEMENT_TABLE}
              (paycode, payelementcode, payelementname, payelementtype, calculationtype,
               amount, percentage, percentagebase, effectivefrom,
               employeecode, locationcode, fixedorpercent, computationtype, addordeduct,
               pfapplicable, ptapplicable, esiapplicability, applicableforot, applicableforc,
               paycadre, activepayelement, processed, payrollpostinggroup, leaveencashment,
               remarks, updatedby)
            VALUES (@paycode, @code, @name, @type, @calc, @amount, @pct, @base, @from,
                    @ecode, @loc, @forp, @comp, @aod, @pf, @pt, @esi, @ot, @coff,
                    @cadre, @active, @proc, @ppg, @encash, @rem, @by)`);

  const created = await pool.request()
    .input('paycode', sql.NVarChar(50), paycode)
    .input('code', sql.NVarChar(20), elemCode)
    .input('from', sql.Date, effective)
    .query(`SELECT TOP 1 id FROM ${SALARY_ELEMENT_TABLE}
            WHERE LTRIM(RTRIM(paycode)) = @paycode AND LTRIM(RTRIM(payelementcode)) = @code AND effectivefrom = @from`);
  return { success: true, id: created.recordset?.[0]?.id ?? null, warnings, message: 'Pay element assignment created.' };
}

/* CRUD_ELEMENTS_UPDATE_HERE */

export async function updateElementAssignment(pool, { id, input = {}, actor, companyScope }) {
  await ensureSalaryStructureTables(pool);
  const errors = [];
  const warnings = [];
  const rowRes = await pool.request()
    .input('id', sql.Int, Number(id))
    .query(`SELECT TOP 1 id, LTRIM(RTRIM(paycode)) AS paycode, LTRIM(RTRIM(payelementcode)) AS payelementcode,
            effectivefrom, processed FROM ${SALARY_ELEMENT_TABLE} WHERE id = @id`);
  const dbRow = rowRes.recordset?.[0];
  if (!dbRow) return { success: false, errors: [crudErr('id', 'Pay element row not found.')], warnings };

  const dbPaycode = clean(dbRow.paycode);
  const scope = await paycodeCompanyAllowed(pool, dbPaycode, companyScope);
  if (!scope.allowed) return { success: false, errors: [crudErr('paycode', `Paycode "${dbPaycode}" belongs to a company outside your access.`)], warnings };

  const processedRow = dbRow.processed === true;
  const paycode = upper(clean(input.paycode)) || dbPaycode;
  const elemCode = upper(clean(input.payelementcode)) || clean(dbRow.payelementcode);
  const effective = input.effectivefrom === undefined ? toIsoDate(dbRow.effectivefrom) : toIsoDate(input.effectivefrom);

  // Processed payroll rows keep their identity (employee / element / effective
  // date) for history; only value fields can be corrected.
  if (processedRow && (paycode !== dbPaycode || elemCode !== clean(dbRow.payelementcode)
    || effective !== toIsoDate(dbRow.effectivefrom))) {
    errors.push(crudErr('payelementcode', 'Processed payroll row - employee, pay element and effective date are preserved for history and cannot be changed.'));
  } else {
    if (paycode !== dbPaycode) {
      const employee = await findRosterEmployee(pool, paycode);
      if (!employee) errors.push(crudErr('paycode', `Paycode "${paycode}" was not found among active employees.`));
    }
    if (!isValidIsoDate(effective)) {
      errors.push(crudErr('effectivefrom', 'EffectiveFrom is required and must be a valid date (YYYY-MM-DD).'));
    } else {
      const dup = await pool.request()
        .input('paycode', sql.NVarChar(50), paycode)
        .input('code', sql.NVarChar(20), elemCode)
        .input('from', sql.Date, effective)
        .input('id', sql.Int, Number(id))
        .query(`SELECT TOP 1 id FROM ${SALARY_ELEMENT_TABLE}
                WHERE LTRIM(RTRIM(paycode)) = @paycode AND LTRIM(RTRIM(payelementcode)) = @code AND effectivefrom = @from AND id <> @id`);
      if (dup.recordset?.[0]) {
        errors.push(crudErr('effectivefrom', `Another pay element "${elemCode}" already exists for ${paycode} at ${effective}.`));
      }
    }
  }

  const fp = upper(clean(input.fixedorpercent)).replace(/[\s_-]/g, '');
  const fixedOrPercent = ['FIXED', 'FIX', 'F'].includes(fp) ? 'FIXED'
    : ['PERCENT', 'PERCENTAGE', 'PCT', 'P'].includes(fp) ? 'PERCENT' : null;
  if (!fixedOrPercent) errors.push(crudErr('fixedorpercent', 'FixedOrPercent must be FIXED or PERCENT.'));
  const ad = upper(clean(input.addordeduct)).replace(/[\s_-]/g, '');
  const addOrDeduct = ['ADD', 'ADDITION', 'EARNING', '+'].includes(ad) ? 'ADD'
    : ['DEDUCT', 'DEDUCTION', 'DED', '-'].includes(ad) ? 'DEDUCT' : null;
  if (!addOrDeduct) errors.push(crudErr('addordeduct', 'AddOrDeduct must be ADD or DEDUCT.'));

  const amount = num(input.amount);
  const percent = num(input.percent);
  if (fixedOrPercent === 'FIXED' && (amount === null || amount < 0)) {
    errors.push(crudErr('amount', `Amount "${clean(input.amount)}" must be a number >= 0 for FIXED elements.`));
  }
  if (fixedOrPercent === 'PERCENT' && (percent === null || percent < 0)) {
    errors.push(crudErr('percent', `Percent "${clean(input.percent)}" must be a number >= 0 for PERCENT elements.`));
  }
  const flagInputs = [
    ['pfapplicable', input.pfapplicable], ['ptapplicable', input.ptapplicable],
    ['esiapplicability', input.esiapplicability], ['applicableforot', input.applicableforot],
    ['applicableforc', input.applicableforc], ['activepayelement', input.activepayelement],
    ['processed', input.processed], ['leaveencashment', input.leaveencashment],
  ];
  const flags = {};
  for (const [f, v] of flagInputs) flags[f] = crudFlag(v, f, errors);
  if (errors.length) return { success: false, errors, warnings };

  const computationType = clean(input.computationtype);
  const explicitBase = upper(clean(input.percentagebase));
  let percentBase = PERCENT_BASES.includes(explicitBase) ? explicitBase : null;
  if (!percentBase && fixedOrPercent === 'PERCENT') {
    const ct = upper(computationType).replace(/[\s-]/g, '_');
    if (PERCENT_BASES.includes(ct)) percentBase = ct;
  }
  if (fixedOrPercent === 'PERCENT' && !percentBase) {
    warnings.push(`ComputationType "${computationType}" is not a known wage base (${PERCENT_BASES.join('/')}) and no PercentageBase was supplied - the percent amount will not be computable until a base is provided.`);
  }

  const nameSummary = { warnings: [] };
  let elemName = clean(input.payelementname);
  const pem = await validatePayElementCode(pool, { code: elemCode, name: elemName, excelRow: 'manual', summary: nameSummary });
  if (!elemName && pem.name) elemName = pem.name;
  warnings.push(...nameSummary.warnings);
  if (!elemName) {
    errors.push(crudErr('payelementname', `PayElementName is required for the pay element code "${elemCode}" (the code is not in the Pay Element Master, so the name cannot be resolved).`));
    return { success: false, errors, warnings };
  }
  if (processedRow) {
    warnings.push('Processed payroll row updated - historical figures changed.');
  }

  return updateElementRowWrite(pool, {
    id: Number(id), paycode, elemCode, elemName, fixedOrPercent, addOrDeduct, amount, percent,
    percentBase, effective, input, flags, computationType, actor, warnings,
  });
}

async function updateElementRowWrite(pool, ctx) {
  const {
    id, paycode, elemCode, elemName, fixedOrPercent, addOrDeduct, amount, percent, percentBase,
    effective, input, flags, computationType, actor, warnings,
  } = ctx;
  await pool.request()
    .input('id', sql.Int, id)
    .input('paycode', sql.NVarChar(50), paycode)
    .input('code', sql.NVarChar(20), elemCode)
    .input('name', sql.NVarChar(100), elemName)
    .input('type', sql.NVarChar(30), TYPE_BY_ADD_DEDUCT[addOrDeduct])
    .input('calc', sql.NVarChar(20), CALC_BY_FIXED_PERCENT[fixedOrPercent])
    .input('amount', sql.Decimal(12, 2), amount === null ? null : round2(amount))
    .input('pct', sql.Decimal(9, 4), percent)
    .input('base', sql.NVarChar(20), percentBase)
    .input('from', sql.Date, effective)
    .input('ecode', sql.NVarChar(50), clean(input.employeecode).slice(0, 50) || null)
    .input('loc', sql.NVarChar(50), clean(input.locationcode).slice(0, 50) || null)
    .input('forp', sql.NVarChar(20), fixedOrPercent)
    .input('comp', sql.NVarChar(50), computationType || null)
    .input('aod', sql.NVarChar(20), addOrDeduct)
    .input('pf', sql.Bit, flags.pfapplicable === null ? null : (flags.pfapplicable ? 1 : 0))
    .input('pt', sql.Bit, flags.ptapplicable === null ? null : (flags.ptapplicable ? 1 : 0))
    .input('esi', sql.Bit, flags.esiapplicability === null ? null : (flags.esiapplicability ? 1 : 0))
    .input('ot', sql.Bit, flags.applicableforot === null ? null : (flags.applicableforot ? 1 : 0))
    .input('coff', sql.Bit, flags.applicableforc === null ? null : (flags.applicableforc ? 1 : 0))
    .input('cadre', sql.NVarChar(50), clean(input.paycadre).slice(0, 50) || null)
    .input('active', sql.Bit, flags.activepayelement === null ? null : (flags.activepayelement ? 1 : 0))
    .input('proc', sql.Bit, flags.processed === null ? null : (flags.processed ? 1 : 0))
    .input('ppg', sql.NVarChar(50), clean(input.payrollpostinggroup).slice(0, 50) || null)
    .input('encash', sql.Bit, flags.leaveencashment === null ? null : (flags.leaveencashment ? 1 : 0))
    .input('rem', sql.NVarChar(200), clean(input.remarks).slice(0, 200) || null)
    .input('by', sql.NVarChar(50), clean(actor).slice(0, 50))
    .query(`UPDATE ${SALARY_ELEMENT_TABLE}
            SET paycode = @paycode, payelementcode = @code, payelementname = @name,
                payelementtype = @type, calculationtype = @calc,
                amount = @amount, percentage = @pct, percentagebase = @base,
                effectivefrom = @from, employeecode = @ecode, locationcode = @loc,
                fixedorpercent = @forp, computationtype = @comp, addordeduct = @aod,
                pfapplicable = @pf, ptapplicable = @pt, esiapplicability = @esi,
                applicableforot = @ot, applicableforc = @coff, paycadre = @cadre,
                activepayelement = @active, processed = @proc, payrollpostinggroup = @ppg,
                leaveencashment = @encash, remarks = @rem,
                updateddate = SYSUTCDATETIME(), updatedby = @by
            WHERE id = @id`);
  return { success: true, id, warnings, message: 'Pay element row updated.' };
}

export async function deleteElementAssignments(pool, { ids = [], actor, companyScope }) {
  await ensureSalaryStructureTables(pool);
  const results = [];
  let deleted = 0;
  for (const rawId of ids) {
    const id = Number(rawId);
    if (!Number.isInteger(id)) { results.push({ id: rawId, status: 'Failed', message: 'Invalid row id.' }); continue; }
    const r = await pool.request()
      .input('id', sql.Int, id)
      .query(`SELECT TOP 1 id, LTRIM(RTRIM(paycode)) AS paycode, effectivefrom, processed
              FROM ${SALARY_ELEMENT_TABLE} WHERE id = @id`);
    const db = r.recordset?.[0];
    if (!db) { results.push({ id, status: 'Failed', message: 'Pay element row not found.' }); continue; }
    const scope = await paycodeCompanyAllowed(pool, clean(db.paycode), companyScope);
    if (!scope.allowed) { results.push({ id, status: 'Failed', message: `Paycode "${clean(db.paycode)}" belongs to a company outside your access.` }); continue; }

    if (db.processed === true) {
      results.push({ id, status: 'Kept', message: 'Processed payroll record - kept for history (use Edit to deactivate it instead of deleting).' });
      continue;
    }
    const refs = await salaryVersionReferences(pool, clean(db.paycode), toIsoDate(db.effectivefrom));
    if (refs.approvedDues > 0) {
      results.push({ id, status: 'Kept', message: `Referenced by ${refs.approvedDues} approved dues/settlement record(s) - kept for history.` });
      continue;
    }
    await pool.request().input('id', sql.Int, id).query(`DELETE FROM ${SALARY_ELEMENT_TABLE} WHERE id = @id`);
    deleted += 1;
    results.push({ id, status: 'Deleted', message: 'Pay element row deleted.' });
  }
  return { success: true, deleted, results };
}

export async function createPayElementMasterRecord(pool, { input = {}, actor }) {
  await ensureSalaryStructureTables(pool);
  const errors = [];
  const warnings = [];
  const code = upper(clean(input.payelementcode));
  const name = clean(input.payelementname) || clean(input.description);
  const description = clean(input.description) || clean(input.payelementname);
  const addDeductRaw = clean(input.addordeduct);
  const addDeduct = addDeductRaw ? mapAddDeductValue(addDeductRaw) : null;

  if (!code) errors.push(crudErr('payelementcode', 'PayElementCode is required.'));
  else if (code.length > 20) errors.push(crudErr('payelementcode', `PayElementCode "${code}" is longer than 20 characters.`));
  if (!name) errors.push(crudErr('payelementname', 'Name is required.'));
  if (!addDeductRaw) errors.push(crudErr('addordeduct', 'Add/Deduct is required (Addition or Deduction).'));
  else if (!addDeduct) errors.push(crudErr('addordeduct', `AddDeduct "${addDeductRaw}" must be Addition or Deduction.`));

  const flagPairs = [
    ['applicableforot', input.applicableforot], ['esiapplicable', input.esiapplicable],
    ['pfapplicable', input.pfapplicable], ['leaveencashment', input.leaveencashment],
    ['active', input.active === undefined || clean(input.active) === '' ? 'Y' : input.active],
  ];
  const flags = {};
  for (const [f, v] of flagPairs) flags[f] = crudFlag(v, f, errors);
  const postingGroup = clean(input.payrollpostinggroup).slice(0, 50);
  const remarks = clean(input.remarks).slice(0, 200);
  if (errors.length) return { success: false, errors, warnings };

  const dup = await pool.request()
    .input('code', sql.NVarChar(20), code)
    .query(`SELECT TOP 1 id FROM ${PAY_ELEMENT_MASTER_TABLE} WHERE LTRIM(RTRIM(payelementcode)) = @code`);
  if (dup.recordset?.[0]) {
    return { success: false, errors: [crudErr('payelementcode', `PayElementCode "${code}" already exists - codes must be unique.`)], warnings };
  }

  await pool.request()
    .input('code', sql.NVarChar(20), code)
    .input('name', sql.NVarChar(100), name || null)
    .input('desc', sql.NVarChar(200), description || null)
    .input('addordeduct', sql.NVarChar(20), addDeduct)
    .input('applicableforot', sql.Bit, flags.applicableforot === null ? null : (flags.applicableforot ? 1 : 0))
    .input('esiapplicable', sql.Bit, flags.esiapplicable === null ? null : (flags.esiapplicable ? 1 : 0))
    .input('pfapplicable', sql.Bit, flags.pfapplicable === null ? null : (flags.pfapplicable ? 1 : 0))
    .input('leaveencashment', sql.Bit, flags.leaveencashment === null ? null : (flags.leaveencashment ? 1 : 0))
    .input('payrollpostinggroup', sql.NVarChar(50), postingGroup || null)
    .input('active', sql.Bit, flags.active ? 1 : 0)
    .input('remarks', sql.NVarChar(200), remarks || null)
    .input('by', sql.NVarChar(50), clean(actor).slice(0, 50))
    .query(`INSERT INTO ${PAY_ELEMENT_MASTER_TABLE}
              (payelementcode, payelementname, description, addordeduct, applicableforot,
               esiapplicable, pfapplicable, leaveencashment, payrollpostinggroup,
               active, remarks, updatedby)
            VALUES (@code, @name, @desc, @addordeduct, @applicableforot,
                    @esiapplicable, @pfapplicable, @leaveencashment, @payrollpostinggroup,
                    @active, @remarks, @by)`);
  return { success: true, code, warnings, message: 'Pay element master record created.' };
}

export async function updatePayElementMasterRecord(pool, { id, input = {}, actor }) {
  await ensureSalaryStructureTables(pool);
  const errors = [];
  const warnings = [];
  const r = await pool.request()
    .input('id', sql.Int, Number(id))
    .query(`SELECT TOP 1 id, LTRIM(RTRIM(payelementcode)) AS payelementcode, payelementname, description,
            addordeduct, applicableforot, esiapplicable, pfapplicable, leaveencashment,
            payrollpostinggroup, active, remarks
            FROM ${PAY_ELEMENT_MASTER_TABLE} WHERE id = @id`);
  const db = r.recordset?.[0];
  if (!db) return { success: false, errors: [crudErr('id', 'Pay element master record not found.')], warnings };

  const oldCode = clean(db.payelementcode);
  const code = upper(clean(input.payelementcode)) || oldCode;
  const name = clean(input.payelementname) || clean(input.description) || clean(db.payelementname);
  const description = clean(input.description) || clean(input.payelementname) || clean(db.description);
  const addDeductRaw = clean(input.addordeduct);
  const addDeduct = addDeductRaw ? mapAddDeductValue(addDeductRaw) : null;

  if (!code) errors.push(crudErr('payelementcode', 'PayElementCode is required.'));
  else if (code.length > 20) errors.push(crudErr('payelementcode', `PayElementCode "${code}" is longer than 20 characters.`));
  if (!name) errors.push(crudErr('payelementname', 'Name is required.'));
  if (!addDeductRaw) errors.push(crudErr('addordeduct', 'Add/Deduct is required (Addition or Deduction).'));
  else if (!addDeduct) errors.push(crudErr('addordeduct', `AddDeduct "${addDeductRaw}" must be Addition or Deduction.`));

  const flagPairs = [
    ['applicableforot', input.applicableforot], ['esiapplicable', input.esiapplicable],
    ['pfapplicable', input.pfapplicable], ['leaveencashment', input.leaveencashment],
  ];
  const flags = {};
  for (const [f, v] of flagPairs) flags[f] = crudFlag(v, f, errors);
  const activeFlag = crudFlag(input.active, 'active', errors);
  const postingGroup = input.payrollpostinggroup === undefined ? clean(db.payrollpostinggroup) : clean(input.payrollpostinggroup).slice(0, 50);
  const remarks = input.remarks === undefined ? clean(db.remarks) : clean(input.remarks).slice(0, 200);
  if (errors.length) return { success: false, errors, warnings };

  if (code !== oldCode) {
    // Renaming a referenced code would break employee pay element references.
    const refs = await pool.request()
      .input('code', sql.NVarChar(20), oldCode)
      .query(`SELECT COUNT(*) AS n FROM ${SALARY_ELEMENT_TABLE} WHERE LTRIM(RTRIM(payelementcode)) = @code`);
    const n = Number(refs.recordset?.[0]?.n || 0);
    if (n > 0) {
      return {
        success: false,
        errors: [crudErr('payelementcode', `Code rename blocked - "${oldCode}" is referenced by ${n} employee pay element row(s). Use Edit to mark the record Inactive instead.`)],
        warnings,
      };
    }
    const dup = await pool.request()
      .input('code', sql.NVarChar(20), code)
      .input('id', sql.Int, Number(id))
      .query(`SELECT TOP 1 id FROM ${PAY_ELEMENT_MASTER_TABLE} WHERE LTRIM(RTRIM(payelementcode)) = @code AND id <> @id`);
    if (dup.recordset?.[0]) {
      return { success: false, errors: [crudErr('payelementcode', `PayElementCode "${code}" already exists - codes must be unique.`)], warnings };
    }
  }

  const req = pool.request()
    .input('id', sql.Int, Number(id))
    .input('code', sql.NVarChar(20), code)
    .input('name', sql.NVarChar(100), name || null)
    .input('desc', sql.NVarChar(200), description || null)
    .input('addordeduct', sql.NVarChar(20), addDeduct)
    .input('payrollpostinggroup', sql.NVarChar(50), postingGroup || null)
    .input('remarks', sql.NVarChar(200), remarks || null)
    .input('by', sql.NVarChar(50), clean(actor).slice(0, 50));
  const assigns = [
    'payelementcode = @code', 'payelementname = @name', 'description = @desc',
    'addordeduct = @addordeduct', 'payrollpostinggroup = @payrollpostinggroup', 'remarks = @remarks',
  ];
  for (const [f] of flagPairs) {
    if (flags[f] !== null) { req.input(f, sql.Bit, flags[f] ? 1 : 0); assigns.push(`${f} = @${f}`); }
  }
  if (activeFlag !== null) { req.input('active', sql.Bit, activeFlag ? 1 : 0); assigns.push('active = @active'); }
  await req.query(`UPDATE ${PAY_ELEMENT_MASTER_TABLE}
          SET ${assigns.join(', ')}, updateddate = SYSUTCDATETIME(), updatedby = @by
          WHERE id = @id`);
  return { success: true, id: Number(id), code, warnings, message: 'Pay element master record updated.' };
}

export async function deletePayElementMasterRecords(pool, { ids = [] }) {
  await ensureSalaryStructureTables(pool);
  const results = [];
  let deleted = 0;
  for (const rawId of ids) {
    const id = Number(rawId);
    if (!Number.isInteger(id)) { results.push({ id: rawId, status: 'Failed', message: 'Invalid row id.' }); continue; }
    const r = await pool.request()
      .input('id', sql.Int, id)
      .query(`SELECT TOP 1 id, LTRIM(RTRIM(payelementcode)) AS payelementcode FROM ${PAY_ELEMENT_MASTER_TABLE} WHERE id = @id`);
    const db = r.recordset?.[0];
    if (!db) { results.push({ id, status: 'Failed', message: 'Pay element master record not found.' }); continue; }

    const refs = await pool.request()
      .input('code', sql.NVarChar(20), clean(db.payelementcode))
      .query(`SELECT COUNT(*) AS n FROM ${SALARY_ELEMENT_TABLE} WHERE LTRIM(RTRIM(payelementcode)) = @code`);
    const n = Number(refs.recordset?.[0]?.n || 0);
    if (n > 0) {
      results.push({ id, status: 'Kept', message: `Referenced by ${n} employee pay element row(s) - kept (use Edit to mark Inactive instead of deleting).` });
      continue;
    }
    await pool.request().input('id', sql.Int, id).query(`DELETE FROM ${PAY_ELEMENT_MASTER_TABLE} WHERE id = @id`);
    deleted += 1;
    results.push({ id, status: 'Deleted', message: 'Pay element master record deleted.' });
  }
  return { success: true, deleted, results };
}

/* ------------------------------------------------------------------ */

/* ------------------------------------------------------------------ */
/* EMPLOYEE SALARY MASTER import (V1 sheet - also accepts legacy rows)  */
/* ------------------------------------------------------------------ */

/**
 * Row key: (paycode, effectivefrom) - the existing UNIQUE constraint.
 * A newer EffectiveFrom INSERTs a new version; older versions are preserved.
 * Identity is validated against the REAL active roster (never invented):
 * Paycode is authoritative; BiometricCode/EmployeeName/CompanyCode are
 * verified when provided; Department/Designation mismatches are warnings only
 * (formats may differ - the roster is used at read time).
 */
export async function importSalaryStructureMasterRows(pool, { rows, actor, companyScope, summary }) {
  const seen = new Map();
  for (let index = 0; index < (rows || []).length; index += 1) {
    const raw = rows[index] || {};
    const excelRow = raw.__row || index + 2;
    const { row, extra } = normaliseRow(raw, SALARY_STRUCTURE_MASTER_COLUMNS);

    // Paycode is authoritative. Legacy Dataset A rows carry the paycode in
    // EmployeeCode and have no Paycode column - keep that convention working.
    const hasPaycodeCol = clean(raw.Paycode ?? raw.paycode ?? '') !== '' || Object.keys(raw).some((k) => normHeader(k) === 'paycode');
    let paycode = clean(row.Paycode);
    let employeeCode = clean(row.EmployeeCode);
    if (!hasPaycodeCol && !paycode) {
      paycode = employeeCode;
      employeeCode = '';
    }

    const employeeNumber = clean(row.EmployeeNumber);
    const biometric = clean(row.BiometricCode);
    const nameInFile = clean(row.EmployeeName);
    const companyInFile = clean(row.CompanyCode);
    const deptInFile = clean(row.Department);
    const desigInFile = clean(row.Designation);
    const locationCode = clean(row.LocationCode);
    const currency = clean(row.Currency);
    const remarks = clean(row.Remarks);
    const effectiveRaw = row.EffectiveFrom;
    const effective = toIsoDate(effectiveRaw);
    const basic = num(row.BasicSalary);
    const pfFlag = boolOrNull(row.PFApplicable);
    const esiFlag = boolOrNull(row.ESIApplicable);
    const pfWage = num(row.PFWage);
    const esiWage = num(row.ESIWage);

    const fail = (message) => {
      summary.failed += 1;
      summary.errors.push({ row: excelRow, employeeCode: paycode, message });
      summary.results.push({ row: excelRow, employeeCode: paycode, status: 'Failed', message });
    };

    if (!paycode) { fail('Paycode (or legacy EmployeeCode) is empty.'); continue; }
    if (!isValidIsoDate(effective)) { fail(`EffectiveFrom "${effectiveRaw ?? ''}" is not a valid date (YYYY-MM-DD).`); continue; }
    if (pfFlag === 'INVALID') { fail(`PFApplicable "${row.PFApplicable ?? ''}" must be Y or N.`); continue; }
    if (esiFlag === 'INVALID') { fail(`ESIApplicable "${row.ESIApplicable ?? ''}" must be Y or N.`); continue; }
    if (row.BasicSalary !== '' && row.BasicSalary !== undefined && (basic === null || basic < 0)) {
      fail(`BasicSalary "${row.BasicSalary}" is not a number >= 0.`); continue;
    }
    if (row.PFWage !== '' && row.PFWage !== undefined && (pfWage === null || pfWage < 0)) { fail(`PFWage "${row.PFWage}" is not a number >= 0.`); continue; }
    if (row.ESIWage !== '' && row.ESIWage !== undefined && (esiWage === null || esiWage < 0)) { fail(`ESIWage "${row.ESIWage}" is not a number >= 0.`); continue; }

    const employee = await findRosterEmployee(pool, paycode);
    if (!employee) {
      fail(`Paycode "${paycode}" was not found among active employees. Nothing was imported for this row.`);
      continue;
    }
    const scope = await paycodeCompanyAllowed(pool, employee.paycode, companyScope);
    if (!scope.allowed) { fail(`Paycode "${paycode}" belongs to a company outside your access.`); continue; }

    if (biometric && employee.presentcardno && biometric.toUpperCase() !== clean(employee.presentcardno).toUpperCase()) {
      fail(`BiometricCode "${biometric}" does not match the saved code "${clean(employee.presentcardno)}" for employee ${paycode}.`);
      continue;
    }
    if (nameInFile && employee.empname && nameInFile.toUpperCase() !== clean(employee.empname).toUpperCase()) {
      fail(`EmployeeName "${nameInFile}" does not match "${clean(employee.empname)}" for employee ${paycode}.`);
      continue;
    }
    if (companyInFile && employee.companycode && companyInFile.toUpperCase() !== clean(employee.companycode).toUpperCase()) {
      fail(`CompanyCode "${companyInFile}" does not match "${clean(employee.companycode)}" for employee ${paycode}.`);
      continue;
    }
    // Department/Designation may be names or codes - warn only, roster wins at read time.
    if (deptInFile && deptInFile.toUpperCase() !== clean(employee.departmentcode).toUpperCase()) {
      warnOnce(summary, `Row ${excelRow}: Department "${deptInFile}" differs from the employee master ("${clean(employee.departmentcode)}"). The employee master value is used for display.`);
    }


    const key = `${upper(paycode)}|${effective}`;
    if (seen.has(key)) {
      const prev = seen.get(key);
      fail(`Duplicate of row ${prev} in file for the same Paycode + EffectiveFrom - fix the file and re-import.`);
      continue;
    }
    seen.set(key, excelRow);

    if (Object.keys(extra).length) {
      warnOnce(summary, `EmployeeSalaryMaster: column(s) ${Object.keys(extra).join(', ')} are not supported fields - preserved in the row's extra fields metadata.`);
    }

    // Legacy F&F contract columns (salary-service.js reads exactly these):
    // basicsalary defaults to 0 when the V1 sheet omits BasicSalary.
    const pfB = pfFlag === null ? false : pfFlag;
    const esiB = esiFlag === null ? false : esiFlag;
    const basicV = basic === null ? 0 : round2(basic);
    const pfW = pfWage === null ? 0 : round2(pfWage);
    const esiW = esiWage === null ? 0 : round2(esiWage);
    if (basic === null) {
      warnOnce(summary, `Row ${excelRow}: BasicSalary not supplied - stored 0 for this version. Include the BasicSalary column when available so Full & Final estimates stay accurate.`);
    }

    const extraJson = Object.keys(extra).length ? JSON.stringify(extra) : null;
    const record = {
      row: excelRow, employeeCode: employee.paycode, paycode: employee.paycode,
      empname: employee.empname, employeecode: employeeCode, employeenumber: employeeNumber,
      locationcode: locationCode, currency: currency || null, remarks: remarks || null,
      effectivefrom: effective, status: '', message: '',
    };

    const existing = await pool.request()
      .input('paycode', sql.NVarChar(50), employee.paycode)
      .input('from', sql.Date, effective)
      .query(`SELECT TOP 1 id, basicsalary, pfapplicable, esiapplicable, pfwage, esiwage,
                     employeecode, employeenumber, locationcode, currency, remarks
              FROM ${SALARY_MASTER_TABLE}
              WHERE LTRIM(RTRIM(paycode)) = @paycode AND effectivefrom = @from`);

    const sameValues = (db) => round2(db.basicsalary) === basicV
      && Boolean(db.pfapplicable) === pfB && Boolean(db.esiapplicable) === esiB
      && round2(db.pfwage) === pfW && round2(db.esiwage) === esiW
      && clean(db.employeecode) === employeeCode
      // EmployeeNumber is Navision traceability only - NOT part of the V1
      // template/export any more, so a blank value means "not specified"
      // (never a change, never a wipe) exactly like the pay-element importer.
      && (employeeNumber === '' || clean(db.employeenumber) === employeeNumber)
      && clean(db.locationcode) === locationCode && clean(db.currency) === (currency || '')
      && clean(db.remarks) === remarks;

    const by = clean(actor).slice(0, 50);
    const params = (r) => r
      .input('basic', sql.Decimal(12, 2), basicV)
      .input('pf', sql.Bit, pfB ? 1 : 0)
      .input('esi', sql.Bit, esiB ? 1 : 0)
      .input('pfw', sql.Decimal(12, 2), pfW)
      .input('esiw', sql.Decimal(12, 2), esiW)
      .input('ecode', sql.NVarChar(50), employeeCode || null)
      .input('enum', sql.NVarChar(50), employeeNumber || null)
      .input('loc', sql.NVarChar(50), locationCode || null)
      .input('cur', sql.NVarChar(10), currency || null)
      .input('rem', sql.NVarChar(200), remarks || null)
      .input('extra', sql.NVarChar(sql.MAX), extraJson)
      .input('by', sql.NVarChar(50), by);

    if (existing.recordset?.[0]) {
      if (sameValues(existing.recordset[0]) && !extraJson) {
        summary.skipped += 1;
        summary.results.push({ ...record, status: 'Skipped', message: 'Salary row is unchanged.' });
        continue;
      }
      await params(pool.request()).input('id', sql.Int, existing.recordset[0].id).query(`
        UPDATE ${SALARY_MASTER_TABLE}
        SET basicsalary = @basic, pfapplicable = @pf, esiapplicable = @esi, pfwage = @pfw, esiwage = @esiw,
            employeecode = @ecode,
            employeenumber = COALESCE(@enum, employeenumber),
            locationcode = @loc, currency = @cur, remarks = @rem,
            extrafields = COALESCE(@extra, extrafields), updateddate = SYSUTCDATETIME(), updatedby = @by
        WHERE id = @id`);
      summary.updated += 1;
      summary.results.push({ ...record, status: 'Updated' });
    } else {
      await params(pool.request())
        .input('paycode', sql.NVarChar(50), employee.paycode)
        .input('from', sql.Date, effective)
        .query(`
        INSERT INTO ${SALARY_MASTER_TABLE}
          (paycode, effectivefrom, basicsalary, pfapplicable, esiapplicable, pfwage, esiwage,
           employeecode, employeenumber, locationcode, currency, remarks, extrafields, updatedby)
        VALUES (@paycode, @from, @basic, @pf, @esi, @pfw, @esiw, @ecode, @enum, @loc, @cur, @rem, @extra, @by)`);
      summary.imported += 1;
      summary.results.push({ ...record, status: 'Imported' });
    }

    // Navision EmployeeCode stays SEPARATE from paycode - persisted into the
    // existing shared mapping table (conflicts are reported, never guessed).
    if (employeeCode) {
      const map = await upsertEmployeeCodeMapping(pool, { paycode: employee.paycode, employeecode: employeeCode, actor });
      if (!map.ok) {
        warnOnce(summary, `Row ${excelRow}: EmployeeCode mapping not saved - ${map.message}`);
      }
    }
  }
  return summary;
}


/* ------------------------------------------------------------------ */
/* EMPLOYEE PAY ELEMENTS import (V1 sheet - also accepts legacy rows)   */
/* ------------------------------------------------------------------ */

/**
 * Row key: (paycode, payelementcode, effectivefrom) - the existing UNIQUE
 * constraint. Pay elements may carry DIFFERENT effective dates per row - they
 * are never forced to share one date. Unknown pay element codes are legitimate
 * and auto-registered in the master (warning only - never rejected).
 */
export async function importSalaryStructureElementRows(pool, { rows, actor, companyScope, summary }) {
  const seen = new Map();
  for (let index = 0; index < (rows || []).length; index += 1) {
    const raw = rows[index] || {};
    const excelRow = raw.__row || index + 2;
    const { row, extra } = normaliseRow(raw, ELEMENT_ACCEPTED_COLUMNS);

    const hasPaycodeCol = clean(raw.Paycode ?? raw.paycode ?? '') !== '' || Object.keys(raw).some((k) => normHeader(k) === 'paycode');
    let paycode = clean(row.Paycode);
    let employeeCode = clean(row.EmployeeCode);
    if (!hasPaycodeCol && !paycode) {
      paycode = employeeCode;
      employeeCode = '';
    }
    const locationCode = clean(row.LocationCode);
    const elemCode = upper(row.PayElementCode);
    let elemName = clean(row.PayElementName);
    const fixedOrPercentRaw = clean(row.FixedOrPercent);
    const addOrDeductRaw = clean(row.AddOrDeduct);
    const amount = num(row.Amount);
    const percent = num(row.Percent);
    const computationType = clean(row.ComputationType);
    const effectiveRaw = row.EffectiveFrom;
    const effective = toIsoDate(effectiveRaw);
    const remarks = clean(row.Remarks);

    const fail = (message) => {
      summary.failed += 1;
      summary.errors.push({ row: excelRow, employeeCode: paycode, message });
      summary.results.push({ row: excelRow, employeeCode: paycode, payelementcode: elemCode, status: 'Failed', message });
    };

    if (!paycode) { fail('Paycode is empty.'); continue; }
    if (!elemCode) { fail('PayElementCode is empty.'); continue; }
    if (elemCode.length > 20) { fail(`PayElementCode "${elemCode}" is longer than 20 characters.`); continue; }
    if (!isValidIsoDate(effective)) { fail(`EffectiveFrom "${effectiveRaw ?? ''}" is not a valid date (YYYY-MM-DD).`); continue; }

    // FixedOrPercent / AddOrDeduct: strict enums. Legacy Dataset B row shapes
    // (CalculationType / PayElementType) are accepted and mapped equivalently.
    const fp = upper(fixedOrPercentRaw).replace(/[\s_-]/g, '');
    const legacyCalc = upper(row.CalculationType).replace(/[\s_-]/g, '');
    const fixedOrPercent = ['FIXED', 'FIX', 'F'].includes(fp) ? 'FIXED'
      : ['PERCENT', 'PERCENTAGE', 'PCT', 'P'].includes(fp) ? 'PERCENT'
        : ['FIXED', 'FIX'].includes(legacyCalc) ? 'FIXED'
          : ['PERCENTAGE', 'PERCENT', 'PCT'].includes(legacyCalc) ? 'PERCENT' : null;
    if (!fixedOrPercent) {
      fail(`FixedOrPercent "${fixedOrPercentRaw ?? ''}" must be FIXED or PERCENT (legacy CalculationType also accepted).`); continue;
    }
    const ad = upper(addOrDeductRaw).replace(/[\s_-]/g, '');
    const legacyType = upper(row.PayElementType);
    let addOrDeduct = ['ADD', 'ADDITION', 'EARNING', '+'].includes(ad) ? 'ADD'
      : ['DEDUCT', 'DEDUCTION', 'DED', '-'].includes(ad) ? 'DEDUCT' : null;
    let legacyElementType = null;
    if (!addOrDeduct) {
      if (legacyType === 'EARNING') addOrDeduct = 'ADD';
      else if (legacyType === 'DEDUCTION') addOrDeduct = 'DEDUCT';
      else if (legacyType === 'EMPLOYER_CONTRIBUTION') legacyElementType = 'EMPLOYER_CONTRIBUTION';
    }
    if (!addOrDeduct && !legacyElementType) {
      fail(`AddOrDeduct "${addOrDeductRaw ?? ''}" must be ADD or DEDUCT (legacy PayElementType also accepted).`); continue;
    }

    if (fixedOrPercent === 'FIXED') {
      if (amount === null || amount < 0) { fail(`Amount "${row.Amount ?? ''}" must be a number >= 0 for FIXED elements.`); continue; }
    } else if (percent === null || percent < 0) {
      fail(`Percent "${row.Percent ?? ''}" must be a number >= 0 for PERCENT elements.`); continue;
    }

    // Strict booleans (blank = not specified = NULL; invalid values fail the row).
    const boolFields = [
      ['PFApplicable', row.PFApplicable], ['PTApplicable', row.PTApplicable],
      ['ESIApplicability', row.ESIApplicability], ['ApplicableForOT', row.ApplicableForOT],
      ['ApplicableForCOff', row.ApplicableForCOff], ['ActivePayElement', row.ActivePayElement],
      ['Processed', row.Processed], ['LeaveEncashment', row.LeaveEncashment],
    ];
    const flags = {};
    let badBool = null;
    for (const [name, value] of boolFields) {
      const parsed = boolOrNull(value);
      if (parsed === 'INVALID') { badBool = `${name} "${value}" must be Y or N.`; break; }
      flags[name] = parsed;
    }
    if (badBool) { fail(badBool); continue; }

    // Percentage base: explicit column wins; ComputationType is used when it is
    // a known base. Unknown computation values are stored as-is (no guessing).
    const explicitBase = upper(row.PercentageBase ?? '');
    let percentBase = PERCENT_BASES.includes(explicitBase) ? explicitBase : null;
    if (!percentBase && fixedOrPercent === 'PERCENT') {
      const ct = upper(computationType).replace(/[\s-]/g, '_');
      if (PERCENT_BASES.includes(ct)) percentBase = ct;
    }


    // Employee identity: paycode against the REAL active roster (never invented).
    const employee = await findRosterEmployee(pool, paycode);
    if (!employee) {
      fail(`Paycode "${paycode}" was not found among active employees. Nothing was imported for this row.`);
      continue;
    }
    const scope = await paycodeCompanyAllowed(pool, employee.paycode, companyScope);
    if (!scope.allowed) { fail(`Paycode "${paycode}" belongs to a company outside your access.`); continue; }

    // PayElementCode is validated against the application Pay Element Master.
    // Unknown codes are REPORTED clearly and imported as supplied - never
    // silently discarded and never fabricated into the master.
    const pem = await validatePayElementCode(pool, { code: elemCode, name: elemName, excelRow, summary });
    if (!elemName && pem.name) elemName = pem.name;
    if (!elemName) {
      fail(`PayElementName is required for the pay element code "${elemCode}" (the code is not in the Pay Element Master, so the name cannot be resolved).`);
      continue;
    }

    const key = `${upper(employee.paycode)}|${elemCode}|${effective}`;
    const sig = JSON.stringify([elemName, fixedOrPercent, addOrDeduct, amount, percent, computationType, flags, remarks, locationCode, employeeCode]);
    if (seen.has(key)) {
      const prev = seen.get(key);
      if (prev.sig === sig) {
        summary.skipped += 1;
        summary.results.push({ row: excelRow, employeeCode: employee.paycode, payelementcode: elemCode, status: 'Skipped', message: `Duplicate of row ${prev.row} in file (same employee + element + effective date).` });
      } else {
        fail(`Conflicts with row ${prev.row} in file for the same employee + pay element + effective date - fix the file and re-import.`);
      }
      continue;
    }
    seen.set(key, { row: excelRow, sig });

    if (Object.keys(extra).length) {
      warnOnce(summary, `EmployeePayElements: column(s) ${Object.keys(extra).join(', ')} are not supported fields - preserved in the row's extra fields metadata.`);
    }
    if (fixedOrPercent === 'PERCENT' && !percentBase) {
      warnOnce(summary, `Row ${excelRow}: ComputationType "${computationType}" is not a known wage base (${PERCENT_BASES.join('/')}) and no PercentageBase column was supplied - the percent amount will not be computable until a base is provided.`);
    }

    // Legacy F&F contract columns (salary-service.js reads exactly these).
    const legacyTypeFinal = legacyElementType || TYPE_BY_ADD_DEDUCT[addOrDeduct];
    const legacyCalcFinal = CALC_BY_FIXED_PERCENT[fixedOrPercent];
    const extraJson = Object.keys(extra).length ? JSON.stringify(extra) : null;

    const record = {
      row: excelRow, employeeCode: employee.paycode, paycode: employee.paycode,
      payelementcode: elemCode, payelementname: elemName,
      fixedorpercent: fixedOrPercent, addordeduct: addOrDeduct,
      amount: amount === null ? null : round2(amount), percent,
      computationtype: computationType || null, effectivefrom: effective,
    };

    const existing = await pool.request()
      .input('paycode', sql.NVarChar(50), employee.paycode)
      .input('code', sql.NVarChar(20), elemCode)
      .input('from', sql.Date, effective)
      .query(`SELECT TOP 1 id, payelementname, payelementtype, calculationtype, amount, percentage, percentagebase,
                     employeecode, locationcode, fixedorpercent, computationtype, addordeduct,
                     pfapplicable, ptapplicable, esiapplicability, applicableforot, applicableforc,
                     paycadre, activepayelement, processed, payrollpostinggroup, leaveencashment, remarks
              FROM ${SALARY_ELEMENT_TABLE}
              WHERE LTRIM(RTRIM(paycode)) = @paycode AND LTRIM(RTRIM(payelementcode)) = @code AND effectivefrom = @from`);

    const sameValues = (db) => clean(db.payelementname) === elemName
      && upper(db.payelementtype) === legacyTypeFinal
      && upper(db.calculationtype) === legacyCalcFinal
      && (db.amount === null ? null : round2(db.amount)) === (amount === null ? null : round2(amount))
      && (db.percentage === null ? null : Number(db.percentage)) === percent
      && (upper(db.percentagebase) || null) === percentBase
      && clean(db.employeecode) === employeeCode && clean(db.locationcode) === locationCode
      // Legacy rows keep their classification in CalculationType / PayElementType
      // only - the file then expresses the SAME record via the accepted legacy
      // columns, so an unchanged export never rewrites or loses that data.
      && (upper(db.fixedorpercent) === fixedOrPercent
        || (!upper(db.fixedorpercent) && upper(db.calculationtype) === legacyCalcFinal))
      && (upper(db.addordeduct) === addOrDeduct
        || (!upper(db.addordeduct) && upper(db.payelementtype) === legacyTypeFinal))
      && clean(db.computationtype) === computationType
      && (db.pfapplicable === null || db.pfapplicable === undefined ? null : Boolean(db.pfapplicable)) === flags.PFApplicable
      && (db.ptapplicable === null || db.ptapplicable === undefined ? null : Boolean(db.ptapplicable)) === flags.PTApplicable
      && (db.esiapplicability === null || db.esiapplicability === undefined ? null : Boolean(db.esiapplicability)) === flags.ESIApplicability
      && (db.applicableforot === null || db.applicableforot === undefined ? null : Boolean(db.applicableforot)) === flags.ApplicableForOT
      && (db.applicableforc === null || db.applicableforc === undefined ? null : Boolean(db.applicableforc)) === flags.ApplicableForCOff
      && (db.activepayelement === null || db.activepayelement === undefined ? null : Boolean(db.activepayelement)) === flags.ActivePayElement
      && (db.processed === null || db.processed === undefined ? null : Boolean(db.processed)) === flags.Processed
      && (db.leaveencashment === null || db.leaveencashment === undefined ? null : Boolean(db.leaveencashment)) === flags.LeaveEncashment
      && clean(db.paycadre) === clean(row.PayCadre) && clean(db.payrollpostinggroup) === clean(row.PayrollPostingGroup)
      && clean(db.remarks) === remarks;


    const by = clean(actor).slice(0, 50);
    const params = (r) => r
      .input('name', sql.NVarChar(100), elemName)
      .input('type', sql.NVarChar(30), legacyTypeFinal)
      .input('calc', sql.NVarChar(20), legacyCalcFinal)
      .input('amount', sql.Decimal(12, 2), amount === null ? null : round2(amount))
      .input('pct', sql.Decimal(9, 4), percent)
      .input('base', sql.NVarChar(20), percentBase)
      .input('ecode', sql.NVarChar(50), employeeCode || null)
      .input('loc', sql.NVarChar(50), locationCode || null)
      .input('forp', sql.NVarChar(20), fixedOrPercent)
      .input('comp', sql.NVarChar(50), computationType || null)
      .input('aod', sql.NVarChar(20), addOrDeduct)
      .input('pf', sql.Bit, flags.PFApplicable === null ? null : (flags.PFApplicable ? 1 : 0))
      .input('pt', sql.Bit, flags.PTApplicable === null ? null : (flags.PTApplicable ? 1 : 0))
      .input('esi', sql.Bit, flags.ESIApplicability === null ? null : (flags.ESIApplicability ? 1 : 0))
      .input('ot', sql.Bit, flags.ApplicableForOT === null ? null : (flags.ApplicableForOT ? 1 : 0))
      .input('coff', sql.Bit, flags.ApplicableForCOff === null ? null : (flags.ApplicableForCOff ? 1 : 0))
      .input('cadre', sql.NVarChar(50), clean(row.PayCadre) || null)
      .input('active', sql.Bit, flags.ActivePayElement === null ? null : (flags.ActivePayElement ? 1 : 0))
      .input('proc', sql.Bit, flags.Processed === null ? null : (flags.Processed ? 1 : 0))
      .input('ppg', sql.NVarChar(50), clean(row.PayrollPostingGroup) || null)
      .input('encash', sql.Bit, flags.LeaveEncashment === null ? null : (flags.LeaveEncashment ? 1 : 0))
      .input('rem', sql.NVarChar(200), remarks || null)
      .input('extra', sql.NVarChar(sql.MAX), extraJson)
      .input('from', sql.Date, effective)
      .input('by', sql.NVarChar(50), by);

    if (existing.recordset?.[0]) {
      if (sameValues(existing.recordset[0]) && !extraJson) {
        summary.skipped += 1;
        summary.results.push({ ...record, status: 'Skipped', message: 'Pay element is unchanged.' });
        continue;
      }
      await params(pool.request()).input('id', sql.Int, existing.recordset[0].id).query(`
        UPDATE ${SALARY_ELEMENT_TABLE}
        SET payelementname = @name, payelementtype = @type, calculationtype = @calc,
            amount = @amount, percentage = @pct, percentagebase = @base,
            employeecode = @ecode, locationcode = @loc, fixedorpercent = @forp,
            computationtype = @comp, addordeduct = @aod, pfapplicable = @pf, ptapplicable = @pt,
            esiapplicability = @esi, applicableforot = @ot, applicableforc = @coff,
            paycadre = @cadre, activepayelement = @active, processed = @proc,
            payrollpostinggroup = @ppg, leaveencashment = @encash, remarks = @rem,
            extrafields = COALESCE(@extra, extrafields), updateddate = SYSUTCDATETIME(), updatedby = @by
        WHERE id = @id`);
      summary.updated += 1;
      summary.results.push({ ...record, status: 'Updated' });
    } else {
      await params(pool.request())
        .input('paycode', sql.NVarChar(50), employee.paycode)
        .input('code', sql.NVarChar(20), elemCode)
        .query(`
        INSERT INTO ${SALARY_ELEMENT_TABLE}
          (paycode, payelementcode, payelementname, payelementtype, calculationtype,
           amount, percentage, percentagebase, effectivefrom,
           employeecode, locationcode, fixedorpercent, computationtype, addordeduct,
           pfapplicable, ptapplicable, esiapplicability, applicableforot, applicableforc,
           paycadre, activepayelement, processed, payrollpostinggroup, leaveencashment,
           remarks, extrafields, updatedby)
        VALUES (@paycode, @code, @name, @type, @calc, @amount, @pct, @base, @from,
                @ecode, @loc, @forp, @comp, @aod, @pf, @pt, @esi, @ot, @coff,
                @cadre, @active, @proc, @ppg, @encash, @rem, @extra, @by)`);
      summary.imported += 1;
      summary.results.push({ ...record, status: 'Imported' });
    }
  }
  return summary;
}


/* ------------------------------------------------------------------ */
/* Combined V1 workbook import (PayElementMaster -> Master -> Elements) */
/* ------------------------------------------------------------------ */

/**
 * Imports the three V1 datasets in dependency order so new pay element codes
 * exist before element rows reference them. Each dataset reports its own
 * Imported / Updated / Skipped / Failed summary with per-row errors. Nothing is
 * ever deleted and no historical effective-dated version is overwritten by a
 * newer one - the existing safe per-row upsert pattern is used throughout.
 */
export async function importSalaryStructure(pool, { master, elements, payElementMaster, actor, companyScope }) {
  await ensureSalaryStructureTables(pool);
  const summaries = {
    payElementMaster: newSummary(),
    master: newSummary(),
    elements: newSummary(),
  };
  if (Array.isArray(payElementMaster) && payElementMaster.length) {
    await importPayElementMasterRows(pool, { rows: payElementMaster, actor, summary: summaries.payElementMaster });
  }
  if (Array.isArray(master) && master.length) {
    await importSalaryStructureMasterRows(pool, { rows: master, actor, companyScope, summary: summaries.master });
  }
  if (Array.isArray(elements) && elements.length) {
    await importSalaryStructureElementRows(pool, { rows: elements, actor, companyScope, summary: summaries.elements });
  }
  return summaries;
}

/* ------------------------------------------------------------------ */
/* SOURCE-FIRST TEMPLATE PREFILL (read-only Savior SQL Server export)   */
/* ------------------------------------------------------------------ */

/**
 * Pre-fill source for the Download Template workbook. READ-ONLY.
 *
 * Source-to-template mapping (verified against the real SAVIOR921 schema):
 *   EmployeeSalaryMaster sheet
 *     EmployeeCode  <- HR_EmployeeCodeMapping.employeecode (by paycode; the
 *                      ESTABLISHED identity mapping - dbo.tblemployee has no
 *                      employee-code column). Blank when no mapping exists.
 *     Paycode       <- dbo.tblemployee.paycode (authoritative identity)
 *     BiometricCode <- dbo.tblemployee.presentcardno
 *     EmployeeName  <- dbo.tblemployee.empname
 *     CompanyCode   <- dbo.tblemployee.companycode
 *     LocationCode  <- dbo.tblemployee.LocationName (Savior stores the location
 *                      as a name - direct source value)
 *     Department    <- dbo.tblemployee.departmentcode
 *     Designation   <- dbo.tblemployee.designation
 *     EffectiveFrom / BasicSalary / PFApplicable / PFWage / ESIApplicable /
 *     ESIWage / Currency / Remarks
 *                   <- UNAVAILABLE: Savior has no employee-wise salary master
 *                      source (payrollinterface / tblpayoutinterface are
 *                      attendance-day interfaces without salary amounts and
 *                      contain 0 rows). Left BLANK - never zero, never 'N',
 *                      never taken from the application HR_Salary* tables.
 *   EmployeePayElements / PayElementMaster sheets
 *                   <- UNAVAILABLE: no genuine employee-wise pay-element or
 *                      pay-element-master source exists in Savior. Exported
 *                      EMPTY (headers only) - rows are never manufactured.
 *
 * This function NEVER reads the application salary tables (HR_SalaryMaster /
 * HR_SalaryElement / HR_PayElementMaster) and NEVER writes to the database.
 */
export async function exportSaviorTemplateSource(pool, { companyScope } = {}) {
  const scope = companyScopeFragment('e', companyScope);
  if (scope.denied) return { ok: false, status: 403, message: 'No company access assigned.' };

  // Established identity relationship: paycode -> Navision EmployeeCode.
  const codeMap = new Map();
  try {
    const mapR = await pool.request().query(
      `SELECT LTRIM(RTRIM(paycode)) AS paycode, LTRIM(RTRIM(employeecode)) AS employeecode
       FROM ${EMPLOYEE_CODE_MAPPING_TABLE}`,
    );
    for (const m of mapR.recordset || []) codeMap.set(clean(m.paycode), clean(m.employeecode));
  } catch (_e) { /* mapping unavailable -> EmployeeCode stays blank */ }

  const r = await pool.request().query(`
    SELECT LTRIM(RTRIM(e.paycode)) AS paycode,
           LTRIM(RTRIM(e.empname)) AS empname,
           LTRIM(RTRIM(e.presentcardno)) AS presentcardno,
           LTRIM(RTRIM(e.companycode)) AS companycode,
           LTRIM(RTRIM(e.departmentcode)) AS departmentcode,
           LTRIM(RTRIM(e.designation)) AS designation,
           LTRIM(RTRIM(e.LocationName)) AS locationname
    FROM dbo.tblemployee e
    WHERE ISNULL(LTRIM(RTRIM(e.active)), 'Y') <> 'N'${scope.fragment}
    ORDER BY LTRIM(RTRIM(e.paycode))`);

  const master = (r.recordset || []).map((row) => {
    const paycode = clean(row.paycode);
    return {
      employeecode: codeMap.get(paycode) || '',
      paycode,
      presentcardno: clean(row.presentcardno),
      empname: clean(row.empname),
      companycode: clean(row.companycode),
      locationcode: clean(row.locationname),
      departmentcode: clean(row.departmentcode),
      designation: clean(row.designation),
      // No Savior salary source -> blank (never fabricated).
      effectivefrom: '', basicsalary: '', pfapplicable: null, esiapplicable: null,
      pfwage: '', esiwage: '', currency: '', remarks: '',
    };
  });

  return {
    ok: true,
    master,
    elements: [],
    payElementMaster: [],
    report: {
      source: 'Savior SQL Server - dbo.tblemployee roster (EmployeeCode via the established paycode identity mapping)',
      employees: master.length,
      populatedSheets: ['EmployeeSalaryMaster (identity fields only)'],
      blankSheets: ['EmployeePayElements', 'PayElementMaster'],
      unavailableFields: ['EffectiveFrom', 'BasicSalary', 'PFApplicable', 'PFWage', 'ESIApplicable', 'ESIWage', 'Currency', 'Remarks'],
      unavailableReason: 'Savior SQL Server has no employee-wise salary master or pay-element tables (payrollinterface and tblpayoutinterface are attendance-day interfaces and contain 0 rows). These fields must be entered manually or obtained from an authoritative payroll source. The application HR_Salary* tables were NOT used as a fallback.',
      inspectedTables: ['tblemployee', 'tblDesignation', 'tblcategory', 'tblcompany', 'tbldepartment', 'tbldivision', 'tblgrade', 'payrollinterface', 'tblpayoutinterface', 'tblOTslab', 'tblcanteen', 'tblleaveencashment', 'tblleaveledger', 'tblleavemaster', 'tblleavepolicy'],
    },
  };
}

/* ------------------------------------------------------------------ */
/* Lists (shared read model for BOTH platforms and every export)        */
/* ------------------------------------------------------------------ */

export async function listSalaryStructureMaster(pool, { paycode, search, from, to, limit = 500, companyScope } = {}) {
  await ensureSalaryStructureTables(pool);
  const scope = companyScopeFragment('e', companyScope);
  if (scope.denied) return [];
  const request = pool.request().input('limit', sql.Int, Math.min(Number(limit) || 500, 5000));
  let where = 'WHERE 1 = 1';
  where += scope.fragment;
  if (clean(paycode)) {
    where += ' AND LTRIM(RTRIM(m.paycode)) = @paycode';
    request.input('paycode', sql.NVarChar(50), clean(paycode));
  }
  if (clean(search)) {
    where += ' AND (m.paycode LIKE @like OR e.empname LIKE @like OR m.employeecode LIKE @like)';
    request.input('like', sql.NVarChar(60), `%${clean(search)}%`);
  }
  if (isValidIsoDate(from)) { where += ' AND m.effectivefrom >= @from'; request.input('from', sql.Date, from); }
  if (isValidIsoDate(to)) { where += ' AND m.effectivefrom <= @to'; request.input('to', sql.Date, to); }
  const r = await request.query(`
    SELECT TOP (@limit) m.id, LTRIM(RTRIM(m.paycode)) AS paycode, LTRIM(RTRIM(e.empname)) AS empname,
           LTRIM(RTRIM(e.presentcardno)) AS presentcardno, LTRIM(RTRIM(e.companycode)) AS companycode,
           LTRIM(RTRIM(e.departmentcode)) AS departmentcode, LTRIM(RTRIM(e.designation)) AS designation,
           LTRIM(RTRIM(m.employeecode)) AS employeecode, LTRIM(RTRIM(m.employeenumber)) AS employeenumber,
           LTRIM(RTRIM(m.locationcode)) AS locationcode,
           m.effectivefrom, m.basicsalary, m.pfapplicable, m.esiapplicable, m.pfwage, m.esiwage,
           LTRIM(RTRIM(m.currency)) AS currency, m.remarks, m.extrafields, m.updateddate, m.updatedby
    FROM ${SALARY_MASTER_TABLE} m
    LEFT JOIN dbo.tblemployee e ON LTRIM(RTRIM(e.paycode)) = LTRIM(RTRIM(m.paycode))
    ${where}
    ORDER BY m.paycode, m.effectivefrom DESC`);
  return (r.recordset || []).map((x) => ({
    id: x.id, paycode: clean(x.paycode), empname: clean(x.empname),
    presentcardno: clean(x.presentcardno), companycode: clean(x.companycode),
    departmentcode: clean(x.departmentcode), designation: clean(x.designation),
    employeecode: clean(x.employeecode), employeenumber: clean(x.employeenumber),
    locationcode: clean(x.locationcode),
    effectivefrom: toIsoDate(x.effectivefrom), basicsalary: round2(x.basicsalary),
    pfapplicable: Boolean(x.pfapplicable), esiapplicable: Boolean(x.esiapplicable),
    pfwage: round2(x.pfwage), esiwage: round2(x.esiwage),
    currency: clean(x.currency), remarks: clean(x.remarks),
    extrafields: parseExtra(x.extrafields),
    updateddate: x.updateddate, updatedby: clean(x.updatedby),
  }));
}

function parseExtra(value) {
  const s = clean(value);
  if (!s) return null;
  try { return JSON.parse(s); } catch { return s; }
}


export async function listSalaryStructureElements(pool, { paycode, search, from, to, limit = 1000, companyScope } = {}) {
  await ensureSalaryStructureTables(pool);
  const scope = companyScopeFragment('e', companyScope);
  if (scope.denied) return [];
  const request = pool.request().input('limit', sql.Int, Math.min(Number(limit) || 1000, 5000));
  let where = 'WHERE 1 = 1';
  where += scope.fragment;
  if (clean(paycode)) {
    where += ' AND LTRIM(RTRIM(x.paycode)) = @paycode';
    request.input('paycode', sql.NVarChar(50), clean(paycode));
  }
  if (clean(search)) {
    where += ' AND (x.paycode LIKE @like OR e.empname LIKE @like OR x.payelementname LIKE @like OR x.payelementcode LIKE @like)';
    request.input('like', sql.NVarChar(60), `%${clean(search)}%`);
  }
  if (isValidIsoDate(from)) { where += ' AND x.effectivefrom >= @from'; request.input('from', sql.Date, from); }
  if (isValidIsoDate(to)) { where += ' AND x.effectivefrom <= @to'; request.input('to', sql.Date, to); }
  const r = await request.query(`
    SELECT TOP (@limit) x.id, LTRIM(RTRIM(x.paycode)) AS paycode, LTRIM(RTRIM(e.empname)) AS empname,
           LTRIM(RTRIM(e.presentcardno)) AS presentcardno, LTRIM(RTRIM(e.companycode)) AS companycode,
           LTRIM(RTRIM(e.departmentcode)) AS departmentcode, LTRIM(RTRIM(e.designation)) AS designation,
           LTRIM(RTRIM(x.employeecode)) AS employeecode, LTRIM(RTRIM(x.locationcode)) AS locationcode,
           x.effectivefrom, LTRIM(RTRIM(x.payelementcode)) AS payelementcode, x.payelementname,
           LTRIM(RTRIM(x.fixedorpercent)) AS fixedorpercent, x.amount, x.percentage AS [percent],
           LTRIM(RTRIM(x.computationtype)) AS computationtype, LTRIM(RTRIM(x.addordeduct)) AS addordeduct,
           x.pfapplicable, x.ptapplicable, x.esiapplicability, x.applicableforot, x.applicableforc,
           LTRIM(RTRIM(x.paycadre)) AS paycadre, x.activepayelement, x.processed,
           LTRIM(RTRIM(x.payrollpostinggroup)) AS payrollpostinggroup, x.leaveencashment,
           x.remarks, x.extrafields,
           LTRIM(RTRIM(x.payelementtype)) AS payelementtype, LTRIM(RTRIM(x.calculationtype)) AS calculationtype,
           x.percentage, LTRIM(RTRIM(x.percentagebase)) AS percentagebase,
           x.updateddate, x.updatedby
    FROM ${SALARY_ELEMENT_TABLE} x
    LEFT JOIN dbo.tblemployee e ON LTRIM(RTRIM(e.paycode)) = LTRIM(RTRIM(x.paycode))
    ${where}
    ORDER BY x.paycode, x.payelementcode, x.effectivefrom DESC`);
  return (r.recordset || []).map((x) => ({
    id: x.id, paycode: clean(x.paycode), empname: clean(x.empname),
    presentcardno: clean(x.presentcardno), companycode: clean(x.companycode),
    departmentcode: clean(x.departmentcode), designation: clean(x.designation),
    employeecode: clean(x.employeecode), locationcode: clean(x.locationcode),
    effectivefrom: toIsoDate(x.effectivefrom), payelementcode: clean(x.payelementcode),
    payelementname: clean(x.payelementname), fixedorpercent: clean(x.fixedorpercent),
    amount: x.amount === null ? null : round2(x.amount),
    percent: x.percent === null ? null : Number(x.percent),
    computationtype: clean(x.computationtype), addordeduct: clean(x.addordeduct),
    pfapplicable: boolFromDb(x.pfapplicable), ptapplicable: boolFromDb(x.ptapplicable),
    esiapplicability: boolFromDb(x.esiapplicability), applicableforot: boolFromDb(x.applicableforot),
    applicableforc: boolFromDb(x.applicableforc), paycadre: clean(x.paycadre),
    activepayelement: boolFromDb(x.activepayelement), processed: boolFromDb(x.processed),
    payrollpostinggroup: clean(x.payrollpostinggroup), leaveencashment: boolFromDb(x.leaveencashment),
    remarks: clean(x.remarks), extrafields: parseExtra(x.extrafields),
    // legacy columns (kept so older consumers and F&F keep working)
    payelementtype: clean(x.payelementtype), calculationtype: clean(x.calculationtype),
    percentage: x.percentage === null ? null : Number(x.percentage),
    percentagebase: clean(x.percentagebase) || null,
    updateddate: x.updateddate, updatedby: clean(x.updatedby),
  }));
}

function boolFromDb(v) {
  return v === null || v === undefined ? null : Boolean(v);
}

export async function listPayElementMaster(pool, { search, limit = 1000 } = {}) {
  await ensureSalaryStructureTables(pool);
  const request = pool.request().input('limit', sql.Int, Math.min(Number(limit) || 1000, 5000));
  let where = 'WHERE 1 = 1';
  if (clean(search)) {
    where += ' AND (payelementcode LIKE @like OR payelementname LIKE @like OR description LIKE @like)';
    request.input('like', sql.NVarChar(60), `%${clean(search)}%`);
  }
  const r = await request.query(`
    SELECT TOP (@limit) id, LTRIM(RTRIM(payelementcode)) AS payelementcode, payelementname,
           description, LTRIM(RTRIM(addordeduct)) AS addordeduct, applicableforot, esiapplicable,
           pfapplicable, leaveencashment, payrollpostinggroup, active, remarks, extrafields,
           updateddate, updatedby
    FROM ${PAY_ELEMENT_MASTER_TABLE} ${where}
    ORDER BY payelementcode`);
  return (r.recordset || []).map((x) => ({
    id: x.id, payelementcode: clean(x.payelementcode), payelementname: clean(x.payelementname),
    description: clean(x.description), addordeduct: clean(x.addordeduct),
    applicableforot: boolFromDb(x.applicableforot), esiapplicable: boolFromDb(x.esiapplicable),
    pfapplicable: boolFromDb(x.pfapplicable), leaveencashment: boolFromDb(x.leaveencashment),
    payrollpostinggroup: clean(x.payrollpostinggroup),
    active: boolFromDb(x.active), remarks: clean(x.remarks),
    extrafields: parseExtra(x.extrafields), updateddate: x.updateddate, updatedby: clean(x.updatedby),
  }));
}


/* ------------------------------------------------------------------ */
/* Dynamic report (Navision "Employee CTC Master" style)                */
/* ------------------------------------------------------------------ */

/**
 * One row per employee with the LATEST applicable version as of `asOf`
 * (same effective-date resolution as the F&F snapshot: newest effectivefrom
 * that is <= asOf). The pay element columns are the UNION of the codes
 * actually present in the filtered data - never a hardcoded list - so
 * location-specific element sets export without losing or misplacing amounts.
 *
 * Gross Salary is included ONLY when an explicit GROSS pay element provides the
 * source value. It is never computed by summing positive amounts and it is
 * explicitly NOT a CTC figure (out of scope for this phase).
 */
export async function buildSalaryStructureReport(pool, { paycode, search, asOf, companyScope, limit = 2000 } = {}) {
  await ensureSalaryStructureTables(pool);
  const asOfIso = isValidIsoDate(asOf) ? clean(asOf) : todayIso();

  const [masters, elements] = await Promise.all([
    listSalaryStructureMaster(pool, { paycode, search, from: undefined, to: asOfIso, limit, companyScope }),
    listSalaryStructureElements(pool, { paycode, search, from: undefined, to: asOfIso, limit: limit * 5, companyScope }),
  ]);

  // Latest master version per employee (list is ordered effectivefrom DESC).
  const masterByPaycode = new Map();
  for (const m of masters) {
    if (!masterByPaycode.has(m.paycode)) masterByPaycode.set(m.paycode, m);
  }

  // Latest version per (paycode, element code).
  const latestByCode = new Map(); // paycode -> Map(code -> row)
  const codeSet = new Set();
  for (const el of elements) {
    if (!latestByCode.has(el.paycode)) latestByCode.set(el.paycode, new Map());
    const byCode = latestByCode.get(el.paycode);
    if (!byCode.has(el.payelementcode)) {
      byCode.set(el.payelementcode, el);
      codeSet.add(el.payelementcode);
    }
  }

  const paycodes = [...new Set([...masterByPaycode.keys(), ...latestByCode.keys()])];
  const rows = [];
  let grossColumnAvailable = false;

  for (const pc of paycodes) {
    const m = masterByPaycode.get(pc) || {};
    const byCode = latestByCode.get(pc) || new Map();
    const cells = {};
    let gross = null;
    let grossSource = null;
    for (const code of codeSet) {
      const el = byCode.get(code);
      if (!el) { cells[code] = null; continue; }
      if (el.fixedorpercent === 'PERCENT' || el.calculationtype === 'PERCENTAGE') {
        const pct = el.percent ?? el.percentage ?? null;
        const base = el.computationtype || el.percentagebase || '';
        cells[code] = pct === null ? '' : `${pct}%${base ? ` of ${base}` : ''}`;
      } else {
        cells[code] = el.amount === null ? '' : el.amount;
      }
      if (code === 'GROSS') {
        grossColumnAvailable = true;
        if (el.fixedorpercent !== 'PERCENT' && el.calculationtype !== 'PERCENTAGE' && el.amount !== null) {
          gross = el.amount;
          grossSource = 'GROSS pay element (source value)';
        }
      }
    }
    rows.push({
      paycode: m.paycode || pc,
      employeecode: m.employeecode || (byCode.values().next().value?.employeecode ?? ''),
      empname: m.empname || (byCode.values().next().value?.empname ?? ''),
      presentcardno: m.presentcardno || '',
      companycode: m.companycode || '',
      departmentcode: m.departmentcode || '',
      designation: m.designation || '',
      effectivefrom: m.effectivefrom || (byCode.values().next().value?.effectivefrom ?? ''),
      currency: m.currency || '',
      pfapplicable: m.pfapplicable ?? null,
      esiapplicable: m.esiapplicable ?? null,
      cells,
      gross,
      grosssource: grossSource,
    });
  }

  rows.sort((a, b) => String(a.empname || a.paycode).localeCompare(String(b.empname || b.paycode)));

  // EmployeeCode falls back to the existing shared mapping table (never invented).
  try {
    const mapR = await pool.request().query(
      `SELECT LTRIM(RTRIM(paycode)) AS paycode, LTRIM(RTRIM(employeecode)) AS employeecode FROM ${EMPLOYEE_CODE_MAPPING_TABLE}`,
    );
    const mapByPaycode = new Map((mapR.recordset || []).map((m) => [clean(m.paycode).toUpperCase(), clean(m.employeecode)]));
    for (const row of rows) {
      if (!row.employeecode) row.employeecode = mapByPaycode.get(clean(row.paycode).toUpperCase()) || '';
    }
  } catch { /* mapping table not provisioned -> EmployeeCode stays blank */ }

  return {
    asOf: asOfIso,
    elementCodes: [...codeSet].sort(),
    rows,
    grossColumnAvailable,
    grossRule: NOTICE.GROSS_RULE,
    note: 'Values are the latest applicable pay-element versions as of the selected date. '
      + 'Percent-based elements show their percent + computation base because no payroll '
      + 'calculation runs in Salary Structure V1. This report is NOT a CTC statement.',
  };
}

