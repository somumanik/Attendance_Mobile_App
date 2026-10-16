// web-next/lib/excelImport.js — shared Excel/CSV import helpers (Salary + Leave parity).
//
// These helpers mirror the column contracts the MOBILE app already uses
// (mobile/src/services/leave.js / salary.js) and the parsing approach of the
// existing MarriageImportModal. NO validation is duplicated here: every rule
// (employee matching, leave-type existence, Y/N flags, number/date checks) is
// still enforced by the authoritative backend import endpoints. The client only
// maps spreadsheet columns to the canonical keys the backend expects.

export const SALARY_MASTER_COLUMNS = [
  { key: 'EmployeeCode', label: 'Employee Code', aliases: ['employeecode', 'employee_code', 'paycode', 'empcode', 'code'], type: 'string', required: true },
  { key: 'BiometricCode', label: 'Biometric Code', aliases: ['biometriccode', 'biometric_code', 'cardno', 'card'], type: 'string', required: false },
  { key: 'EmployeeName', label: 'Employee Name', aliases: ['employeename', 'employee_name', 'name'], type: 'string', required: false },
  { key: 'EffectiveFrom', label: 'Effective From', aliases: ['effectivefrom', 'effective_from', 'effectivedate'], type: 'date', required: true },
  { key: 'BasicSalary', label: 'Basic Salary', aliases: ['basicsalary', 'basic_salary', 'basic'], type: 'raw', required: true },
  { key: 'PFApplicable', label: 'PF Applicable', aliases: ['pfapplicable', 'pf_applicable', 'pf'], type: 'raw', required: true },
  { key: 'ESIApplicable', label: 'ESI Applicable', aliases: ['esiapplicable', 'esi_applicable', 'esi'], type: 'raw', required: true },
  { key: 'PFWage', label: 'PF Wage', aliases: ['pfwage', 'pf_wage'], type: 'raw', required: false },
  { key: 'ESIWage', label: 'ESI Wage', aliases: ['esiwage', 'esi_wage'], type: 'raw', required: false },
];

export const SALARY_ELEMENT_COLUMNS = [
  { key: 'EmployeeCode', label: 'Employee Code', aliases: ['employeecode', 'employee_code', 'paycode', 'empcode', 'code'], type: 'string', required: true },
  { key: 'PayElementCode', label: 'Pay Element Code', aliases: ['payelementcode', 'pay_element_code', 'elementcode'], type: 'string', required: true },
  { key: 'PayElementName', label: 'Pay Element Name', aliases: ['payelementname', 'pay_element_name', 'elementname'], type: 'string', required: true },
  { key: 'PayElementType', label: 'Pay Element Type', aliases: ['payelementtype', 'pay_element_type', 'elementtype'], type: 'string', required: true },
  { key: 'CalculationType', label: 'Calculation Type', aliases: ['calculationtype', 'calculation_type', 'calctype'], type: 'string', required: true },
  { key: 'Amount', label: 'Amount', aliases: ['amount'], type: 'raw', required: false },
  { key: 'Percentage', label: 'Percentage', aliases: ['percentage', 'percent'], type: 'raw', required: false },
  { key: 'PercentageBase', label: 'Percentage Base', aliases: ['percentagebase', 'percentage_base', 'base'], type: 'string', required: false },
  { key: 'EffectiveFrom', label: 'Effective From', aliases: ['effectivefrom', 'effective_from', 'effectivedate'], type: 'date', required: true },
];

export const LEAVE_COLUMNS = [
  { key: 'EmployeeCode', label: 'Employee Code', aliases: ['employeecode', 'employee_code', 'paycode', 'empcode', 'code'], type: 'string', required: true },
  { key: 'BiometricCode', label: 'Biometric Code', aliases: ['biometriccode', 'biometric_code', 'cardno', 'card'], type: 'string', required: false },
  { key: 'EmployeeName', label: 'Employee Name', aliases: ['employeename', 'employee_name', 'name'], type: 'string', required: false },
  { key: 'CompanyCode', label: 'Company Code', aliases: ['companycode', 'company_code', 'company'], type: 'string', required: false },
  { key: 'LeaveYear', label: 'Leave Year', aliases: ['leaveyear', 'leave_year', 'year'], type: 'raw', required: true },
  { key: 'LeaveType', label: 'Leave Type', aliases: ['leavetype', 'leave_type', 'type'], type: 'string', required: true },
  { key: 'OpeningBalance', label: 'Opening Balance', aliases: ['openingbalance', 'opening_balance', 'balance'], type: 'raw', required: true },
];

// ---------------------------------------------------------------------------
// Low-level parse helpers
// ---------------------------------------------------------------------------

function normalizeHeader(h) {
  return String(h ?? '').toLowerCase().replace(/[^a-z0-9]/g, '');
}

function validDate(year, month, day) {
  const d = new Date(year, month - 1, day);
  return d.getFullYear() === year && d.getMonth() === month - 1 && d.getDate() === day ? d : null;
}

/** Date instance, Excel serial number, YYYY-MM-DD / DD-MM-YYYY, or Date(). */
export function parseFlexibleDate(v) {
  if (v == null || v === '') return null;
  if (v instanceof Date && !isNaN(v)) return new Date(v.getFullYear(), v.getMonth(), v.getDate());
  if (typeof v === 'number') {
    const d = new Date(Math.round((v - 25569) * 86400 * 1000));
    if (!isNaN(d)) return new Date(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());
    return null;
  }
  const s = String(v).trim();
  let m = s.match(/^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})/);
  if (m) return validDate(+m[1], +m[2], +m[3]);
  m = s.match(/^(\d{1,2})[-/.](\d{1,2})[-/.](\d{2,4})/);
  if (m) {
    let y = +m[3];
    if (y < 100) y += 2000;
    return validDate(y, +m[2], +m[1]);
  }
  const d = new Date(s);
  if (!isNaN(d)) return validDate(d.getFullYear(), d.getMonth() + 1, d.getDate());
  return null;
}

function isoDate(d) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

/** Spreadsheet value -> canonical value for the given column type. */
function normalizeValue(value, type) {
  if (type === 'string') return String(value ?? '').trim();
  if (type === 'date') {
    const d = parseFlexibleDate(value);
    return d ? isoDate(d) : String(value ?? '').trim();
  }
  return value === undefined || value === null ? '' : value; // raw (number/flag/string)
}

// ---------------------------------------------------------------------------
// File -> grid -> canonical rows
// ---------------------------------------------------------------------------

/** Reads a CSV or Excel file into a 2D grid (array of arrays). */
export async function readSheetGrid(file) {
  const isCSV = /\.csv$/i.test(file.name || '');
  if (isCSV) {
    const text = await file.text();
    return text.split(/\r?\n/).filter((l) => l.trim()).map((l) => l.split(/[,;\t]/));
  }
  const XLSX = await import('xlsx');
  const buf = await file.arrayBuffer();
  const wb = XLSX.read(new Uint8Array(buf), { type: 'array', cellDates: true });
  const ws = wb.Sheets[wb.SheetNames[0]];
  if (!ws) return [];
  return XLSX.utils.sheet_to_json(ws, { header: 1, raw: true, defval: '' });
}

/** Detects the header row index among the first `scan` rows. */
export function findHeaderRow(grid, scan = 5) {
  for (let i = 0; i < Math.min(grid.length, scan); i++) {
    const joined = grid[i].map(normalizeHeader).join('|');
    if (joined.includes('employeecode') || joined.includes('paycode') || joined.includes('empcode') || joined.includes('biometriccode')) return i;
  }
  return 0;
}

/**
 * Maps a header row to canonical column indexes using each column's key + aliases.
 * Returns { index, missing } where index is key->columnIdx and missing is the list
 * of REQUIRED canonical keys not present in the file.
 */
export function buildColumnIndex(headerCells, columns) {
  const norm = headerCells.map(normalizeHeader);
  const index = {};
  const missing = [];
  for (const col of columns) {
    const aliases = [col.key, ...(col.aliases || [])].map(normalizeHeader);
    const found = norm.findIndex((h) => h && aliases.some((a) => h === a || h.includes(a)));
    index[col.key] = found;
    if (col.required && found === -1) missing.push(col.key);
  }
  return { index, missing };
}

/**
 * Builds canonical import rows from a grid + column defs.
 * Returns { headerIdx, rows, missing } — rows are { line, values:{...} }.
 */
export function buildImportRows(grid, columns) {
  const headerIdx = findHeaderRow(grid);
  const headerCells = grid[headerIdx] || [];
  const { index, missing } = buildColumnIndex(headerCells, columns);
  const rows = [];
  for (let r = headerIdx + 1; r < grid.length; r += 1) {
    const row = grid[r];
    if (!row || row.join('').trim() === '') continue;
    const values = {};
    for (const col of columns) {
      const idx = index[col.key];
      values[col.key] = idx > -1 ? normalizeValue(row[idx], col.type) : '';
    }
    rows.push({ line: r + 1, values });
  }
  return { headerIdx, rows, missing };
}

/** Downloads a CSV file from an array of row arrays. */
export function downloadCsv(filename, rows) {
  const esc = (v) => {
    const s = String(v ?? '');
    return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const csv = '\uFEFF' + rows.map((r) => r.map(esc).join(',')).join('\r\n');
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

/** Downloads a spreadsheet (.xlsx) from an array of row arrays. All values are
    written as text cells, so leading-zero identifiers (paycode/cardno) are not
    corrupted when opened in Excel. */
export async function downloadXlsx(filename, rows) {
  const XLSX = await import('xlsx');
  const ws = XLSX.utils.aoa_to_sheet(rows);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'Template');
  const out = XLSX.write(wb, { type: 'array', bookType: 'xlsx' });
  const blob = new Blob([out], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}
