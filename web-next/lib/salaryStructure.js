// web-next/lib/salaryStructure.js — SALARY STRUCTURE V1 client helpers.
//
// Self-contained (the shared lib/excelImport.js stays untouched): column
// contracts mirroring the backend (server/salary-structure-service.js), the
// 4-sheet import template, workbook parsing with sheet detection, and export
// row builders for the dynamic pay-element report. All data flows through the
// SAME /api/hr/salary/structure/* endpoints the mobile app uses.

export const STRUCTURE_MASTER_COLUMNS = [
  { key: 'EmployeeCode', label: 'Employee Code', required: false },
  { key: 'Paycode', label: 'Paycode', required: true },
  { key: 'BiometricCode', label: 'Biometric Code', required: false },
  { key: 'EmployeeName', label: 'Employee Name', required: false },
  // EmployeeNumber removed from the template/export/UI (Navision traceability
  // only - no business use; the server importer still accepts legacy files).
  { key: 'CompanyCode', label: 'Company Code', required: false },
  { key: 'LocationCode', label: 'Location Code', required: false },
  { key: 'Department', label: 'Department', required: false },
  { key: 'Designation', label: 'Designation', required: false },
  { key: 'EffectiveFrom', label: 'Effective From', required: true },
  { key: 'BasicSalary', label: 'Basic Salary', required: false },
  { key: 'PFApplicable', label: 'PF Applicable', required: true },
  { key: 'ESIApplicable', label: 'ESI Applicable', required: true },
  { key: 'PFWage', label: 'PF Wage', required: false },
  { key: 'ESIWage', label: 'ESI Wage', required: false },
  { key: 'Currency', label: 'Currency', required: false },
  { key: 'Remarks', label: 'Remarks', required: false },
];

export const STRUCTURE_ELEMENT_COLUMNS = [
  { key: 'Paycode', label: 'Paycode', required: true },
  { key: 'EmployeeCode', label: 'Employee Code', required: false },
  { key: 'EmployeeName', label: 'Employee Name', required: false },
  { key: 'CompanyCode', label: 'Company Code', required: false },
  { key: 'LocationCode', label: 'Location Code', required: false },
  { key: 'EffectiveFrom', label: 'Effective From', required: true },
  { key: 'PayElementCode', label: 'Pay Element Code', required: true },
  { key: 'PayElementName', label: 'Pay Element Name', required: false },
  { key: 'FixedOrPercent', label: 'Fixed Or Percent', required: true },
  { key: 'Amount', label: 'Amount', required: false },
  { key: 'Percent', label: 'Percent', required: false },
  { key: 'ComputationType', label: 'Computation Type', required: false },
  { key: 'AddOrDeduct', label: 'Add Or Deduct', required: true },
  { key: 'PFApplicable', label: 'PF Applicable', required: false },
  { key: 'PTApplicable', label: 'PT Applicable', required: false },
  { key: 'ESIApplicability', label: 'ESI Applicability', required: false },
  { key: 'ApplicableForOT', label: 'Applicable For OT', required: false },
  { key: 'ApplicableForCOff', label: 'Applicable For C-Off', required: false },
  { key: 'PayCadre', label: 'Pay Cadre', required: false },
  { key: 'ActivePayElement', label: 'Active Pay Element', required: false },
  { key: 'Processed', label: 'Processed', required: false },
  { key: 'PayrollPostingGroup', label: 'Payroll Posting Group', required: false },
  { key: 'LeaveEncashment', label: 'Leave Encashment', required: false },
  { key: 'Remarks', label: 'Remarks', required: false },
];

/* Pay Element Master template = the Navision "Pay Elements List" reference
   columns (same headers the server parser accepts - do not rename). */
export const PAY_ELEMENT_MASTER_COLS = [
  { key: 'PayElementCode', label: 'Pay Element Code', required: true },
  { key: 'Description', label: 'Description', required: true },
  { key: 'AddDeduct', label: 'Add / Deduct', required: false },
  { key: 'ApplicableForOT', label: 'Applicable For OT', required: false },
  { key: 'ESIApplicable', label: 'ESI Applicable', required: false },
  { key: 'PFApplicable', label: 'PF Applicable', required: false },
  { key: 'LeaveEncashmentApplicable', label: 'Leave Encashment Applicable', required: false },
  { key: 'PayrollPostingGroup', label: 'Payroll Posting Group', required: false },
  { key: 'Remarks', label: 'Remarks', required: false },
  { key: 'Active', label: 'Active', required: false },
];

export const SHEET_NAMES = {
  master: 'EmployeeSalaryMaster',
  elements: 'EmployeePayElements',
  payElementMaster: 'PayElementMaster',
  readme: 'ReadMe',
};

export const READ_ME_ROWS = [
  ['Topic', 'Details'],
  ['Purpose', 'Salary Structure V1 workbook: employee salary master versions, employee pay elements and the pay element code master.'],
  ['Sheets', 'EmployeeSalaryMaster, EmployeePayElements, PayElementMaster (this ReadMe sheet is not imported).'],
  ['Identity', 'Paycode is the authoritative employee key (dbo.tblemployee.paycode login mapping). Navision EmployeeCode / EmployeeNumber are stored separately and are never used as the login mapping.'],
  ['Effective dates', 'Every row carries EffectiveFrom (YYYY-MM-DD). Older effective-dated versions are always preserved - re-importing updates only the matching (Paycode + EffectiveFrom + Pay Element Code) version.'],
  ['Duplicates', 'Identical duplicate rows are Skipped; conflicting duplicates are reported as Failed; changed values for an existing version are Updated.'],
  ['FixedOrPercent', 'FIXED (Amount required) or PERCENT (Percent required). Legacy CalculationType values are also accepted.'],
  ['AddOrDeduct', 'ADD (earning) or DEDUCT (deduction). Legacy PayElementType values are also accepted.'],
  ['ComputationType', 'Free text; when it equals a known wage base (BASIC / GROSS / PF_WAGE / ESI_WAGE) it is used as the percent base.'],
  ['Booleans', 'Y/N or TRUE/FALSE (blank = not specified): PFApplicable, PTApplicable, ESIApplicability, ApplicableForOT, ApplicableForCOff, ActivePayElement, Processed, LeaveEncashment(, Applicable), Active.'],
  ['PayElementCode', 'Any real code is valid (BASIC, HRA, TA, DA, ...). Employee pay element rows with unknown codes import with a clear warning and are NEVER auto-created in the master - the PayElementMaster sheet defines codes.'],
  ['PayElementMaster', 'Mandatory: PayElementCode + Description. AddDeduct accepts Addition/Deduction (stored canonically as ADD/DEDUCT). Flags: ApplicableForOT, ESIApplicable, PFApplicable, LeaveEncashmentApplicable (Y/N or TRUE/FALSE). PayrollPostingGroup and Remarks are optional text.'],
  ['BasicSalary', 'Optional on EmployeeSalaryMaster (kept for Full & Final accuracy). When blank, 0 is stored for that version and the import reports a warning.'],
  ['Gross Salary', 'Shown in the dynamic report only when an explicit GROSS pay element provides the source value. Never computed by summing positive amounts; NOT a CTC figure.'],
  ['Unknown columns', 'Any column not listed here is preserved in the row extra-fields metadata and reported as a warning - never silently discarded.'],
  ['Examples', 'This template intentionally contains NO example employee rows. Illustrative values must never be imported as real employee data.'],
];

function triggerDownload(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

/** Builds and downloads the 4-sheet Salary Structure template workbook. */
export async function downloadStructureTemplate(filename = 'salary-structure-template.xlsx') {
  const XLSX = await import('xlsx');
  const wb = XLSX.utils.book_new();
  const sheet = (cols) => XLSX.utils.aoa_to_sheet([cols.map((c) => c.key)]);
  XLSX.utils.book_append_sheet(wb, sheet(STRUCTURE_MASTER_COLUMNS), SHEET_NAMES.master);
  XLSX.utils.book_append_sheet(wb, sheet(STRUCTURE_ELEMENT_COLUMNS), SHEET_NAMES.elements);
  XLSX.utils.book_append_sheet(wb, sheet(PAY_ELEMENT_MASTER_COLS), SHEET_NAMES.payElementMaster);
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(READ_ME_ROWS), SHEET_NAMES.readme);
  const out = XLSX.write(wb, { type: 'array', bookType: 'xlsx' });
  triggerDownload(new Blob([out], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }), filename);
}

/** Rows -> XLSX (single sheet) for exports. */
export async function downloadRowsXlsx(filename, headerKeys, rows) {
  const XLSX = await import('xlsx');
  const ws = XLSX.utils.aoa_to_sheet([headerKeys, ...rows]);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'Export');
  const out = XLSX.write(wb, { type: 'array', bookType: 'xlsx' });
  triggerDownload(new Blob([out], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }), filename);
}


const normHeader = (h) => String(h ?? '').toLowerCase().replace(/[^a-z0-9]/g, '');

/**
 * Parses the V1 workbook (or a single-sheet file). Sheets are matched by name
 * (case-insensitive) with a header-signature fallback so slightly renamed
 * sheets still import. Returns per-dataset raw rows (with __row numbers);
 * nothing is validated here - the backend remains authoritative.
 */
export async function parseStructureWorkbook(file) {
  const XLSX = await import('xlsx');
  const buf = await file.arrayBuffer();
  const wb = XLSX.read(new Uint8Array(buf), { type: 'array', cellDates: true });
  const out = { master: [], elements: [], payElementMaster: [], sheetWarnings: [] };
  const seenDatasets = new Set();

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
        out.sheetWarnings.push(`Sheet "${name}" koi known dataset nahi hai - use skip kiya gaya (file ki baaki sheets import hongi, koi row silently discard nahi hui).`);
        continue;
      }
    }
    if (seenDatasets.has(dataset)) {
      out.sheetWarnings.push(`Sheet "${name}" me ${dataset} data pehle se aa chuka hai - is sheet ko skip kiya gaya.`);
      continue;
    }
    seenDatasets.add(dataset);

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
