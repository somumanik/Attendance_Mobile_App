// ============================================================================
// FILE: mobile/src/services/salaryStructure.js
// PURPOSE: SALARY STRUCTURE V1 - shared-backend API + template/export helpers.
// ============================================================================

/**
 * Mobile side of Salary Structure V1. Every call goes through the SAME common
 * backend (/api/hr/salary/structure/* + /api/hr/salary/payelement-master) that
 * the Next.js website uses - imported records are visible on both platforms and
 * nothing is stored in mobile-only local storage.
 *
 *   getHrStructureMaster / getHrStructureElements / getHrPayElementMaster
 *   importHrSalaryStructure   (4-sheet workbook: master + elements + codes)
 *   getHrSalaryStructureReport (dynamic pay-element report)
 *   downloadStructureTemplate / shareStructureExport (xlsx via expo-sharing)
 */

import * as FileSystem from 'expo-file-system';
import * as Sharing from 'expo-sharing';
import * as XLSX from 'xlsx';
import { Platform } from 'react-native';
import { api } from './api';

const ENDPOINTS = {
  STRUCTURE_IMPORT: '/hr/salary/structure/import',
  STRUCTURE_MASTER: '/hr/salary/structure/master',
  STRUCTURE_ELEMENTS: '/hr/salary/structure/elements',
  STRUCTURE_REPORT: '/hr/salary/structure/report',
  PAY_ELEMENT_MASTER: '/hr/salary/payelement-master',
};

const clean = (v) => String(v == null ? '' : v).trim();

/* ------------------------- column contracts ------------------------- */

export const SALARY_STRUCTURE_MASTER_COLUMNS = [
  // 'EmployeeNumber' removed (Navision traceability only - no business use;
  // Paycode is the identity). The server still accepts legacy files.
  'EmployeeCode', 'Paycode', 'BiometricCode', 'EmployeeName',
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

export const PAY_ELEMENT_MASTER_COLUMNS = [
  'PayElementCode', 'Description', 'AddDeduct', 'ApplicableForOT', 'ESIApplicable',
  'PFApplicable', 'LeaveEncashmentApplicable', 'PayrollPostingGroup', 'Remarks', 'Active',
];

export const STRUCTURE_SHEET_NAMES = {
  master: 'EmployeeSalaryMaster',
  elements: 'EmployeePayElements',
  payElementMaster: 'PayElementMaster',
  readme: 'ReadMe',
};

export const READ_ME_ROWS = [
  ['Topic', 'Details'],
  ['Purpose', 'Salary Structure V1 workbook: employee salary master versions, employee pay elements and the pay element code master.'],
  ['Sheets', 'EmployeeSalaryMaster, EmployeePayElements, PayElementMaster (ReadMe is not imported).'],
  ['Identity', 'Paycode is the authoritative employee key (dbo.tblemployee.paycode). EmployeeCode / EmployeeNumber stay separate from Paycode.'],
  ['Effective dates', 'Every row carries EffectiveFrom (YYYY-MM-DD). Older versions are always preserved - only the matching version is updated.'],
  ['Duplicates', 'Identical duplicates are Skipped; conflicting duplicates are Failed; changed values for an existing version are Updated.'],
  ['FixedOrPercent', 'FIXED (Amount required) or PERCENT (Percent required). Legacy CalculationType also accepted.'],
  ['AddOrDeduct', 'ADD (earning) or DEDUCT (deduction). Legacy PayElementType also accepted.'],
  ['Booleans', 'Y/N flags (blank = not specified): PFApplicable, PTApplicable, ESIApplicability, ApplicableForOT, ApplicableForCOff, ActivePayElement, Processed, LeaveEncashment, Active.'],
  ['PayElementCode', 'Any real code is valid. Element rows with unknown codes import with a clear warning and are NEVER auto-created in the master - the PayElementMaster sheet defines codes.'],
  ['PayElementMaster', 'Mandatory: PayElementCode + Description. AddDeduct accepts Addition/Deduction (stored as ADD/DEDUCT). Flags (Y/N or TRUE/FALSE): ApplicableForOT, ESIApplicable, PFApplicable, LeaveEncashmentApplicable. PayrollPostingGroup and Remarks are optional text.'],
  ['Gross Salary', 'Reported only from an explicit GROSS pay element source. Never a sum of positives; NOT a CTC figure.'],
  ['Examples', 'No example employee rows are included - illustrative values must never be imported as real data.'],
];


/* ----------------------------- API calls ----------------------------- */

export const getHrStructureMaster = async ({ paycode, search, from, to, limit } = {}) => {
  const params = {};
  if (paycode) params.paycode = clean(paycode);
  if (search) params.search = clean(search);
  if (from) params.from = clean(from);
  if (to) params.to = clean(to);
  params.limit = limit || 500;
  const response = await api.get(ENDPOINTS.STRUCTURE_MASTER, params);
  return Array.isArray(response?.rows) ? response.rows : [];
};

export const getHrStructureElements = async ({ paycode, search, from, to, limit } = {}) => {
  const params = {};
  if (paycode) params.paycode = clean(paycode);
  if (search) params.search = clean(search);
  if (from) params.from = clean(from);
  if (to) params.to = clean(to);
  params.limit = limit || 1000;
  const response = await api.get(ENDPOINTS.STRUCTURE_ELEMENTS, params);
  return Array.isArray(response?.rows) ? response.rows : [];
};

export const getHrPayElementMaster = async () => {
  const response = await api.get(ENDPOINTS.PAY_ELEMENT_MASTER, { limit: 1000 });
  return Array.isArray(response?.rows) ? response.rows : [];
};

/** 4-sheet workbook import. Response: per-dataset server-confirmed summaries. */
export const importHrSalaryStructure = async ({ master, elements, payElementMaster }) => {
  const response = await api.post(ENDPOINTS.STRUCTURE_IMPORT, {
    master: master || [], elements: elements || [], payElementMaster: payElementMaster || [],
  });
  return response?.summaries || null;
};

export const getHrSalaryStructureReport = async ({ paycode, search, asOf } = {}) => {
  const params = {};
  if (paycode) params.paycode = clean(paycode);
  if (search) params.search = clean(search);
  if (asOf) params.asOf = clean(asOf);
  return api.get(ENDPOINTS.STRUCTURE_REPORT, params);
};

/* ----------------------- template + export files --------------------- */

async function shareBytes(bytes, filename, mimeType) {
  if (Platform.OS === 'web') {
    throw new Error('File download native mobile app par available hai. Website se template/export download karein.');
  }
  const uri = `${FileSystem.cacheDirectory}${filename}`;
  await FileSystem.writeAsStringAsync(uri, bytes, { encoding: FileSystem.EncodingType.Base64 });
  const can = await Sharing.isAvailableAsync();
  if (!can) throw new Error('Sharing is device par available nahi hai.');
  await Sharing.shareAsync(uri, { mimeType, dialogTitle: filename });
  return uri;
}

/** Generates + shares the 4-sheet Salary Structure template workbook. */
export const downloadStructureTemplate = async () => {
  const wb = XLSX.utils.book_new();
  const sheet = (cols) => XLSX.utils.aoa_to_sheet([cols]);
  XLSX.utils.book_append_sheet(wb, sheet(SALARY_STRUCTURE_MASTER_COLUMNS), STRUCTURE_SHEET_NAMES.master);
  XLSX.utils.book_append_sheet(wb, sheet(SALARY_STRUCTURE_ELEMENT_COLUMNS), STRUCTURE_SHEET_NAMES.elements);
  XLSX.utils.book_append_sheet(wb, sheet(PAY_ELEMENT_MASTER_COLUMNS), STRUCTURE_SHEET_NAMES.payElementMaster);
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(READ_ME_ROWS), STRUCTURE_SHEET_NAMES.readme);
  const base64 = XLSX.write(wb, { type: 'base64', bookType: 'xlsx' });
  return shareBytes(base64, 'salary-structure-template.xlsx',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
};

/** Generates + shares a single-sheet export workbook from header+rows arrays. */
export const shareStructureExport = async (filename, headerKeys, rows) => {
  const ws = XLSX.utils.aoa_to_sheet([headerKeys, ...rows]);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'Export');
  const base64 = XLSX.write(wb, { type: 'base64', bookType: 'xlsx' });
  return shareBytes(base64, filename,
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
};

