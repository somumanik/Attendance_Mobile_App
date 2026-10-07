// ============================================================================
// FILE: mobile/src/services/leave.js
// PURPOSE: Leave Management API service (employee self-service + HR admin)
// ============================================================================

/**
 * Ye service Leave Management ke backend APIs ko mobile se connect karti hai.
 * Mobile app SQL Server se kabhi direct connect nahi karti.
 *
 * ---------------------------------------------------------------------------
 * DATA FLOW
 * ---------------------------------------------------------------------------
 * EmployeeLeaveScreen
 *   → GET  /api/employee/leave/types      (HR-managed, configurable)
 *   → GET  /api/employee/leave/balance    (Opening / Approved / Pending / Available)
 *   → GET  /api/employee/leave/requests   (own history + status)
 *   → POST /api/employee/leave/requests   (apply)
 *   → POST /api/employee/leave/requests/:id/cancel
 *   → GET  /api/employee/leave/calendar   (approved-leave overlay for attendance)
 *
 * HRLeaveManagementScreen
 *   → GET/POST /api/hr/leave/types        (add a new leave type)
 *   → GET/PUT  /api/hr/leave/config       (company switches)
 *   → GET      /api/hr/leave/balances     (bulk opening balances)
 *   → POST     /api/hr/leave/balances/import  (Excel -> validated rows)
 *   → GET      /api/hr/leave/requests     (review queue)
 *   → POST     /api/hr/leave/requests/:id/decision (approve / reject)
 *
 * ---------------------------------------------------------------------------
 * IDENTITY (Phase J section 8)
 * ---------------------------------------------------------------------------
 * NO paycode is ever sent from the client on an EMPLOYEE route. The backend takes
 * the employee from the verified JWT, so one employee physically cannot read or
 * change another employee's leave. Only HR routes carry a paycode, because HR is
 * allowed to manage anyone's leave.
 *
 * Leave balances are real application data. Nothing here fabricates a number:
 * if the backend returns no balance, the screen shows zero rather than a guess.
 */

import { api } from './api';
import { API_ENDPOINTS } from '../utils/constants';

const clean = (v) => String(v == null ? '' : v).trim();

/* ============================ EMPLOYEE (self) ============================ */

/** Configurable leave types (PL / SL / CL / OLA / OLB, plus anything HR adds). */
export const getLeaveTypes = async () => {
  const response = await api.get(API_ENDPOINTS.EMPLOYEE_LEAVE_TYPES);
  return Array.isArray(response?.types) ? response.types : [];
};

/**
 * Balance for the signed-in employee.
 * Returns one row per type: openingBalance, approvedUsed, pending, availableBalance.
 */
export const getMyLeaveBalance = async (leaveyear) => {
  const params = leaveyear ? { leaveyear } : undefined;
  const response = await api.get(API_ENDPOINTS.EMPLOYEE_LEAVE_BALANCE, params);
  return {
    leaveyear: response?.leaveyear,
    types: Array.isArray(response?.types) ? response.types : [],
  };
};

/** The signed-in employee's own requests, newest first. */
export const getMyLeaveRequests = async ({ leaveyear, status } = {}) => {
  const params = {};
  if (leaveyear) params.leaveyear = leaveyear;
  if (status) params.status = status;
  const response = await api.get(API_ENDPOINTS.EMPLOYEE_LEAVE_REQUESTS, params);
  return Array.isArray(response?.requests) ? response.requests : [];
};

/** Applies for leave. The server decides the day count, so none is sent. */
export const applyForLeave = async ({ leavetype, fromdate, todate, isHalfDay, halfdaypart, reason, attachmentName, attachmentData, contactdetails }) => {
  const response = await api.post(API_ENDPOINTS.EMPLOYEE_LEAVE_REQUESTS, {
    leavetype: clean(leavetype),
    fromdate: clean(fromdate),
    todate: clean(todate),
    isHalfDay: isHalfDay === true,
    halfdaypart: clean(halfdaypart),
    reason: clean(reason),
    attachmentName: clean(attachmentName),
    attachmentData: clean(attachmentData),
    contactdetails: clean(contactdetails),
  });
  return response?.request || null;
};

/** Cancels the employee's OWN pending request. */
export const cancelMyLeaveRequest = async (id) => {
  const response = await api.post(`${API_ENDPOINTS.EMPLOYEE_LEAVE_REQUESTS}/${id}/cancel`);
  return response;
};

/**
 * Approved-leave dates in a window, for the attendance calendar overlay.
 * The backend already expanded each approved request into individual dates.
 */
export const getLeaveCalendarOverlay = async ({ from, to } = {}) => {
  const params = {};
  if (from) params.from = from;
  if (to) params.to = to;
  const response = await api.get(API_ENDPOINTS.EMPLOYEE_LEAVE_CALENDAR, params);
  return Array.isArray(response?.dates) ? response.dates : [];
};

/* ================================ HR ADMIN =============================== */

export const getHrLeaveTypes = async (includeInactive = false) => {
  const response = await api.get(API_ENDPOINTS.HR_LEAVE_TYPES, includeInactive ? { includeInactive: 'true' } : undefined);
  return Array.isArray(response?.types) ? response.types : [];
};

/** Adds a leave type so the list can grow without any code change. */
export const addHrLeaveType = async ({ leavetype, typename, sortorder }) => {
  const response = await api.post(API_ENDPOINTS.HR_LEAVE_TYPES, {
    leavetype: clean(leavetype),
    typename: clean(typename),
    sortorder,
  });
  return response?.leavetype || null;
};

export const getHrLeaveConfig = async () => {
  const response = await api.get(API_ENDPOINTS.HR_LEAVE_CONFIG);
  return response?.config || null;
};

export const saveHrLeaveConfig = async (config) => {
  const response = await api.put(API_ENDPOINTS.HR_LEAVE_CONFIG, config);
  return response?.config || null;
};

/** Bulk opening balances for employees that have them. */
export const getHrLeaveBalances = async ({ leaveyear, search, limit } = {}) => {
  const params = {};
  if (leaveyear) params.leaveyear = leaveyear;
  if (search) params.search = search;
  if (limit) params.limit = limit;
  const response = await api.get(API_ENDPOINTS.HR_LEAVE_BALANCES, params);
  return { leaveyear: response?.leaveyear, employees: Array.isArray(response?.employees) ? response.employees : [] };
};

/**
 * Imports opening balances from parsed Excel rows.
 *
 * Expected columns: EmployeeCode, BiometricCode, EmployeeName, LeaveYear,
 * LeaveType, OpeningBalance. The SERVER performs every validation, including
 * matching the employee against the real active roster, and returns a summary of
 * Imported / Updated / Skipped / Failed / Errors. An unmatched employee always
 * lands in `failed` - it is never silently dropped.
 */
export const importHrLeaveBalances = async (rows) => {
  const response = await api.post(`${API_ENDPOINTS.HR_LEAVE_BALANCES}/import`, { rows });
  return response?.summary || null;
};

/** The review queue, across all employees. */
export const getHrLeaveRequests = async ({ leaveyear, status, search, limit } = {}) => {
  const params = {};
  if (leaveyear) params.leaveyear = leaveyear;
  if (status) params.status = status;
  if (search) params.search = search;
  if (limit) params.limit = limit;
  const response = await api.get(API_ENDPOINTS.HR_LEAVE_REQUESTS, params);
  return { requests: Array.isArray(response?.requests) ? response.requests : [], counts: response?.counts || {} };
};

/** Approves or rejects. decision is 'Approved' | 'Rejected'. */
export const decideHrLeaveRequest = async (id, decision, note) => {
  const response = await api.post(`${API_ENDPOINTS.HR_LEAVE_REQUESTS}/${id}/decision`, { decision, note: clean(note) });
  return response?.request || null;
};

/* ============================== SHARED HELPERS ============================ */

/** Status → colour + label, kept in one place so both screens agree. */
export const LEAVE_STATUS_STYLE = {
  Pending: { color: '#D97706', bg: '#FEF3C7' },
  Approved: { color: '#059669', bg: '#D1FAE5' },
  Rejected: { color: '#DC2626', bg: '#FEE2E2' },
  Cancelled: { color: '#6B7280', bg: '#F1F5F9' },
};

/** The exact header row the Excel import expects, in order. */
export const LEAVE_IMPORT_COLUMNS = [
  'EmployeeCode',
  'BiometricCode',
  'EmployeeName',
  'LeaveYear',
  'LeaveType',
  'OpeningBalance',
];

/** Accepts both the PascalCase headers above and common variants. */
export const normaliseLeaveImportRow = (row) => {
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
    LeaveYear: pick('LeaveYear', 'leaveyear', 'leave_year', 'Year', 'year'),
    LeaveType: clean(pick('LeaveType', 'leavetype', 'leave_type', 'Type', 'type')),
    OpeningBalance: pick('OpeningBalance', 'openingbalance', 'opening_balance', 'Balance', 'balance'),
  };
};
