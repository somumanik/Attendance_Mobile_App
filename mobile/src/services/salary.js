// ============================================================================
// FILE: mobile/src/services/salary.js
// PURPOSE: Phase K - Salary import + Full & Final estimation API service
// ============================================================================

/**
 * Ye service Salary / Full & Final ke backend APIs ko mobile se connect karti hai.
 *
 * EmployeeGratuityScreen (Full & Final tab)
 *   → GET  /api/employee/fullfinal           (self only; identity from JWT)
 *
 * HRSalaryManagementScreen
 *   → GET/POST /api/hr/salary/master|elements (+ /import)
 *   → GET/PUT  /api/hr/salary/config
 *   → GET/POST /api/hr/salary/dues (+ /:id/decision)
 *   → GET      /api/hr/salary/fullfinal/:paycode (admin estimate preview)
 *
 * IDENTITY: NO paycode is sent on the EMPLOYEE route - the backend takes the
 * employee from the verified JWT. Only HR routes carry a paycode. Imports are
 * validated on the SERVER against the real active roster; invalid rows are
 * always reported as Failed with a reason - never silently dropped.
 */

import { api } from './api';
import { API_ENDPOINTS } from '../utils/constants';

const clean = (v) => String(v == null ? '' : v).trim();

/* ============================ EMPLOYEE (self) ============================ */

/**
 * Full & Final estimate for the signed-in employee.
 * `leavingdate` is an ESTIMATION input (YYYY-MM-DD). `noticeServedDays` and
 * `noticeWaived` are optional estimation inputs for the notice calculation.
 */
export const getMyFullFinal = async ({ leavingdate, noticeServedDays, noticeWaived } = {}) => {
  const params = {};
  if (leavingdate) params.leavingdate = leavingdate;
  if (noticeServedDays !== undefined && noticeServedDays !== null && noticeServedDays !== '') {
    params.noticeServedDays = noticeServedDays;
  }
  if (noticeWaived) params.noticeWaived = 'true';
  return api.get(API_ENDPOINTS.EMPLOYEE_FULLFINAL, params);
};

/* ================================ HR ADMIN =============================== */

/** Imported salary master rows (Dataset A). */
export const getHrSalaryMaster = async ({ search, limit } = {}) => {
  const params = {};
  if (search) params.search = search;
  if (limit) params.limit = limit;
  const response = await api.get(API_ENDPOINTS.HR_SALARY_MASTER, params);
  return Array.isArray(response?.rows) ? response.rows : [];
};

/**
 * Imports Dataset A rows. The SERVER validates everything and returns
 * Imported / Updated / Skipped / Failed with per-row error details.
 */
export const importHrSalaryMaster = async (rows) => {
  const response = await api.post(`${API_ENDPOINTS.HR_SALARY_MASTER}/import`, { rows });
  return response?.summary || null;
};

/** Pay elements (Dataset B). */
export const getHrSalaryElements = async ({ paycode, search, limit } = {}) => {
  const params = {};
  if (paycode) params.paycode = paycode;
  if (search) params.search = search;
  if (limit) params.limit = limit;
  const response = await api.get(API_ENDPOINTS.HR_SALARY_ELEMENTS, params);
  return Array.isArray(response?.rows) ? response.rows : [];
};

/** Imports Dataset B rows. Same Imported / Updated / Skipped / Failed summary. */
export const importHrSalaryElements = async (rows) => {
  const response = await api.post(`${API_ENDPOINTS.HR_SALARY_ELEMENTS}/import`, { rows });
  return response?.summary || null;
};

/** Settlement rules (gratuity / bonus / encashment / notice / PF / ESI). */
export const getHrSalaryConfig = async () => {
  const response = await api.get(API_ENDPOINTS.HR_SALARY_CONFIG);
  return response?.config || null;
};

/** Saves a PATCH of settlement rules. Unknown keys are ignored server-side. */
export const saveHrSalaryConfig = async (patch) => {
  const response = await api.put(API_ENDPOINTS.HR_SALARY_CONFIG, patch);
  return response?.config || null;
};

/** Other dues / recoveries (HR-managed; approved rows enter the F&F). */
export const getHrSalaryDues = async ({ paycode, status, search, limit } = {}) => {
  const params = {};
  if (paycode) params.paycode = paycode;
  if (status) params.status = status;
  if (search) params.search = search;
  if (limit) params.limit = limit;
  const response = await api.get(API_ENDPOINTS.HR_SALARY_DUES, params);
  return Array.isArray(response?.rows) ? response.rows : [];
};

export const createHrSalaryDue = async ({ paycode, category, kind, description, amount }) => {
  const response = await api.post(API_ENDPOINTS.HR_SALARY_DUES, {
    paycode: clean(paycode), category: clean(category), kind: clean(kind),
    description: clean(description), amount,
  });
  return response?.due || null;
};

/** Approves or rejects. decision is 'Approved' | 'Rejected'. */
export const decideHrSalaryDue = async (id, decision, note) => {
  const response = await api.post(`${API_ENDPOINTS.HR_SALARY_DUES}/${id}/decision`, {
    decision, note: clean(note),
  });
  return response?.due || null;
};

/** Admin Full & Final preview for any employee (HR only). */
export const getHrFullFinal = async (paycode, { leavingdate, noticeServedDays, noticeWaived } = {}) => {
  const params = {};
  if (leavingdate) params.leavingdate = leavingdate;
  if (noticeServedDays !== undefined && noticeServedDays !== null && noticeServedDays !== '') {
    params.noticeServedDays = noticeServedDays;
  }
  if (noticeWaived) params.noticeWaived = 'true';
  return api.get(`${API_ENDPOINTS.HR_SALARY_FULLFINAL}/${encodeURIComponent(clean(paycode))}`, params);
};

  const response = await api.post(`${API_ENDPOINTS.HR_SALARY_ELEMENTS}/import`, { rows });

/* ============================== SHARED HELPERS =========================== */

/** The exact header rows the Excel imports expect, in order. */
export const SALARY_MASTER_COLUMNS = [
  'EmployeeCode', 'BiometricCode', 'EmployeeName', 'EffectiveFrom',
  'BasicSalary', 'PFApplicable', 'ESIApplicable', 'PFWage', 'ESIWage',
];
export const SALARY_ELEMENT_COLUMNS = [
  'EmployeeCode', 'PayElementCode', 'PayElementName', 'PayElementType',
  'CalculationType', 'Amount', 'Percentage', 'PercentageBase', 'EffectiveFrom',
];

/** Accepts both the PascalCase headers above and common variants. */
export const normaliseSalaryMasterRow = (row) => {
  const pick = (...keys) => {
    for (const key of keys) {
      const value = row?.[key];
      if (value !== undefined && value !== null && clean(value) !== '') return value;
    }
    return '';
  };
  return {
    EmployeeCode: clean(pick('EmployeeCode', 'employeecode', 'employee_code', 'PayCode', 'paycode')),
    BiometricCode: clean(pick('BiometricCode', 'biometriccode', 'biometric_code', 'CardNo', 'cardno')),
    EmployeeName: clean(pick('EmployeeName', 'employeename', 'employee_name', 'Name', 'name')),
    EffectiveFrom: pick('EffectiveFrom', 'effectivefrom', 'effective_from', 'EffectiveDate', 'effectivedate'),
    BasicSalary: pick('BasicSalary', 'basicsalary', 'basic_salary', 'Basic', 'basic'),
    PFApplicable: pick('PFApplicable', 'pfapplicable', 'pf_applicable', 'PF', 'pf'),
    ESIApplicable: pick('ESIApplicable', 'esiapplicable', 'esi_applicable', 'ESI', 'esi'),
    PFWage: pick('PFWage', 'pfwage', 'pf_wage'),
    ESIWage: pick('ESIWage', 'esiwage', 'esi_wage'),
  };
};

export const normaliseSalaryElementRow = (row) => {
  const pick = (...keys) => {
    for (const key of keys) {
      const value = row?.[key];
      if (value !== undefined && value !== null && clean(value) !== '') return value;
    }
    return '';
  };
  return {
    EmployeeCode: clean(pick('EmployeeCode', 'employeecode', 'employee_code', 'PayCode', 'paycode')),
    PayElementCode: clean(pick('PayElementCode', 'payelementcode', 'pay_element_code', 'ElementCode', 'elementcode')),
    PayElementName: clean(pick('PayElementName', 'payelementname', 'pay_element_name', 'ElementName', 'elementname')),
    PayElementType: clean(pick('PayElementType', 'payelementtype', 'pay_element_type', 'ElementType', 'elementtype')),
    CalculationType: clean(pick('CalculationType', 'calculationtype', 'calculation_type', 'CalcType', 'calctype')),
    Amount: pick('Amount', 'amount'),
    Percentage: pick('Percentage', 'percentage', 'Percent', 'percent'),
    PercentageBase: clean(pick('PercentageBase', 'percentagebase', 'percentage_base', 'Base', 'base')),
    EffectiveFrom: pick('EffectiveFrom', 'effectivefrom', 'effective_from', 'EffectiveDate', 'effectivedate'),
  };
};

