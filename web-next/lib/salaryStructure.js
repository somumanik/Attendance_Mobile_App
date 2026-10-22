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
  ['Pre-filled data', 'The data sheets are pre-populated with the REAL saved records the signed-in HR Admin is authorized to see (read-only download). Edit rows as needed and import: unchanged rows import as Skipped (no duplicates are created), edited rows update the matching (Paycode + EffectiveFrom [+ Pay Element Code]) version, and historical versions are preserved.'],
  ['Examples', 'No illustrative/example rows are ever added. Every value comes from existing saved records; unavailable fields are left blank (a blank is never treated as zero unless zero is the stored value).'],
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

/* Row mappers: real backend rows -> template column order. Unavailable values
   stay BLANK (never fabricated); booleans export Y/N/blank (re-importable). */
const ynBlank = (v) => (v === null || v === undefined ? '' : v ? 'Y' : 'N');
const val = (v) => (v === null || v === undefined ? '' : v);

export function masterSheetRows(rows) {
  return (rows || []).map((r) => [
    val(r.employeecode), val(r.paycode), val(r.presentcardno), val(r.empname),
    val(r.companycode), val(r.locationcode), val(r.departmentcode), val(r.designation),
    val(r.effectivefrom), val(r.basicsalary),
    ynBlank(r.pfapplicable), ynBlank(r.esiapplicable),
    val(r.pfwage), val(r.esiwage), val(r.currency), val(r.remarks),
  ]);
}

export function elementSheetRows(rows) {
  // Legacy rows keep their classification in CalculationType / PayElementType /
  // PercentageBase - derive the canonical cells AND append those accepted legacy
  // columns so a re-import reproduces the exact same record (no data loss).
  const fp = (r) => val(r.fixedorpercent)
    || (r.calculationtype === 'FIXED' ? 'FIXED' : /^PERCENT/i.test(r.calculationtype || '') ? 'PERCENT' : '');
  const ad = (r) => (r.addordeduct
    ? (r.addordeduct === 'ADD' ? 'Addition' : r.addordeduct === 'DEDUCT' ? 'Deduction' : val(r.addordeduct))
    : r.payelementtype === 'EARNING' ? 'Addition' : r.payelementtype === 'DEDUCTION' ? 'Deduction' : '');
  return (rows || []).map((r) => [
    val(r.paycode), val(r.employeecode), val(r.empname), val(r.companycode), val(r.locationcode),
    val(r.effectivefrom), val(r.payelementcode), val(r.payelementname), fp(r),
    val(r.amount), val(r.percent), val(r.computationtype), ad(r),
    ynBlank(r.pfapplicable), ynBlank(r.ptapplicable), ynBlank(r.esiapplicability),
    ynBlank(r.applicableforot), ynBlank(r.applicableforc), val(r.paycadre),
    ynBlank(r.activepayelement), ynBlank(r.processed), val(r.payrollpostinggroup),
    ynBlank(r.leaveencashment), val(r.remarks),
    val(r.percentagebase), val(r.calculationtype), val(r.payelementtype),
  ]);
}

export function payElementMasterSheetRows(rows) {
  const ad = (v) => (v === 'ADD' ? 'Addition' : v === 'DEDUCT' ? 'Deduction' : val(v));
  return (rows || []).map((r) => [
    val(r.payelementcode), val(r.description), ad(r.addordeduct),
    ynBlank(r.applicableforot), ynBlank(r.esiapplicable), ynBlank(r.pfapplicable),
    ynBlank(r.leaveencashment), val(r.payrollpostinggroup), val(r.remarks), ynBlank(r.active),
  ]);
}

/**
 * Builds the 4-sheet workbook. With `data` the sheets are pre-populated with
 * the real saved records (safe edit + re-import round-trip); without it they
 * stay headers-only. Sheet names, column headers and the ReadMe are identical
 * either way, so the importer contract never changes.
 */
export async function buildStructureWorkbook(data = null) {
  const XLSX = await import('xlsx');
  const wb = XLSX.utils.book_new();
  const sheet = (cols, rows) => XLSX.utils.aoa_to_sheet([cols, ...(rows || [])]);
  // The element sheet also carries the ACCEPTED legacy classification columns
  // (PercentageBase / CalculationType / PayElementType) after the established
  // headers - existing columns/order are untouched and the importer accepts
  // these columns natively (ELEMENT_ACCEPTED_COLUMNS).
  const elementHeaders = [...STRUCTURE_ELEMENT_COLUMNS.map((c) => c.key), 'PercentageBase', 'CalculationType', 'PayElementType'];
  XLSX.utils.book_append_sheet(wb, sheet(STRUCTURE_MASTER_COLUMNS.map((c) => c.key), data ? masterSheetRows(data.master) : []), SHEET_NAMES.master);
  XLSX.utils.book_append_sheet(wb, sheet(elementHeaders, data ? elementSheetRows(data.elements) : []), SHEET_NAMES.elements);
  XLSX.utils.book_append_sheet(wb, sheet(PAY_ELEMENT_MASTER_COLS.map((c) => c.key), data ? payElementMasterSheetRows(data.payElementMaster) : []), SHEET_NAMES.payElementMaster);
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(READ_ME_ROWS), SHEET_NAMES.readme);
  return wb;
}

/** Builds and downloads the 4-sheet Salary Structure workbook. */
export async function downloadStructureTemplate(filename = 'salary-structure-template.xlsx', data = null) {
  const XLSX = await import('xlsx');
  const wb = await buildStructureWorkbook(data);
  const out = XLSX.write(wb, { type: 'array', bookType: 'xlsx' });
  triggerDownload(new Blob([out], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }), filename);
}

/** Rows -> XLSX (single sheet) for exports. sheetName optional — export
 *  workbooks use the dataset's real sheet name (EmployeeSalaryMaster /
 *  EmployeePayElements / PayElementMaster / ...); default stays 'Export'. */
export async function downloadRowsXlsx(filename, headerKeys, rows, sheetName = 'Export') {
  const XLSX = await import('xlsx');
  const ws = XLSX.utils.aoa_to_sheet([headerKeys, ...rows]);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, String(sheetName || 'Export').slice(0, 31));
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
