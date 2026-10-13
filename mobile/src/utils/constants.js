// ============================================================================
// FILE: mobile/src/utils/constants.js
// PURPOSE: App-wide constants and configuration
// ============================================================================

/**
 * Ye file mobile app ke saare constants aur configuration define karti hai.
 * API base URL environment variable se aata hai, default localhost:4000 hai.
 * Koi bhi SQL credentials, JWT secrets, ya email credentials yahan NAHI hain.
 */

// API Base URL central config se aata hai; is file mein duplicate URL nahi hai.
export { API_BASE_URL } from '../config';

// App Info
export const APP_NAME = process.env.EXPO_PUBLIC_APP_NAME || 'Savior Attendance Mobile';
export const APP_VERSION = process.env.EXPO_PUBLIC_APP_VERSION || '1.0.0';

// Storage Keys - token aur user data store karne ke liye
export const STORAGE_KEYS = {
  AUTH_TOKEN: 'auth_token',
  USER_ROLE: 'user_role',
  USER_DATA: 'user_data',
  REFRESH_TOKEN: 'refresh_token',
};

// User Roles
// SUPERADMIN is a SEPARATE management role. It is intentionally kept out of the
// HR and Employee definitions so neither of those flows is affected by it.
export const USER_ROLES = {
  HR: 'HR',
  EMPLOYEE: 'EMPLOYEE',
  SUPERADMIN: 'SUPERADMIN',
  NONE: 'NONE',
};

// API Endpoints - ye backend ke API routes hain
export const API_ENDPOINTS = {
  // Authentication
  HR_LOGIN: '/auth/hr/login',
  SUPERADMIN_LOGIN: '/auth/superadmin/login',
  EMPLOYEE_LOGIN: '/auth/employee/login',
  EMPLOYEE_FIRST_TIME_SETUP_STATUS: '/auth/employee/first-time-setup/status',
  EMPLOYEE_FIRST_TIME_SETUP: '/auth/employee/first-time-setup',
  ME: '/me',

  // Employee 4-digit PIN (self only, session identity)
  EMPLOYEE_PIN_STATUS: '/employee/pin/status',
  EMPLOYEE_PIN_SETUP: '/employee/pin/setup',
  EMPLOYEE_PIN_CHANGE: '/employee/pin/change',
  // Employee changes OWN password (session identity; clears mustChangePassword)
  EMPLOYEE_PASSWORD_CHANGE: '/employee/password/change',
  EMPLOYEE_PASSWORD_STATUS: '/employee/password/status',

  // Employee profile (self only, session identity — no paycode is ever sent)
  EMPLOYEE_PROFILE: '/employee/profile',
  // Organisation celebrations (self excluded server-side)
  EMPLOYEE_CELEBRATIONS: '/employee/celebrations',
  // Full & Final / Gratuity ESTIMATION (self only, read-only inputs)
  EMPLOYEE_FULLFINAL: '/employee/fullfinal',
  // Holidays applicable to the signed-in employee only (read-only; HR writes them)
  EMPLOYEE_HOLIDAYS: '/employee/holidays',
  // Employee Leave Management (self only, session identity; HR approves)
  EMPLOYEE_LEAVE_TYPES: '/employee/leave/types',
  EMPLOYEE_LEAVE_BALANCE: '/employee/leave/balance',
  EMPLOYEE_LEAVE_REQUESTS: '/employee/leave/requests',
  EMPLOYEE_LEAVE_CALENDAR: '/employee/leave/calendar',
  HR_LEAVE_TYPES: '/hr/leave/types',
  HR_LEAVE_CONFIG: '/hr/leave/config',
  HR_LEAVE_BALANCES: '/hr/leave/balances',
  HR_LEAVE_REQUESTS: '/hr/leave/requests',
  // Salary / Full & Final (Phase K): self estimate + HR configuration/import
  HR_SALARY_MASTER: '/hr/salary/master',
  HR_SALARY_ELEMENTS: '/hr/salary/elements',
  HR_SALARY_CONFIG: '/hr/salary/config',
  HR_SALARY_DUES: '/hr/salary/dues',
  HR_SALARY_FULLFINAL: '/hr/salary/fullfinal',

  // Employee Forgot / Reset Password (self-service, token based)
  EMPLOYEE_FORGOT_PASSWORD: '/auth/employee/forgot-password',
  EMPLOYEE_RESET_PASSWORD: '/auth/employee/reset-password',

  // HR-controlled employee credential reset (HR role required)
  HR_EMPLOYEE_CREDENTIALS: '/hr/employee/credentials',
  HR_EMPLOYEE_CREDENTIALS_PASSWORD: '/hr/employee/credentials/password',
  HR_EMPLOYEE_CREDENTIALS_PIN: '/hr/employee/credentials/pin',
  HR_EMPLOYEE_REQUIRE_PIN_SETUP: '/hr/employee/credentials/require-pin-setup',
  HR_EMPLOYEE_FORCE_PASSWORD_CHANGE: '/hr/employee/credentials/force-password-change',
  HR_EMPLOYEE_LOGIN_ACCESS: '/hr/employee/credentials/access',
  
  // Employee APIs
  EMPLOYEE_DAILY: '/employee/daily',
  EMPLOYEE_WEEKLY: '/employee/weekly',
  EMPLOYEE_MONTHLY: '/employee/monthly',
  EMPLOYEE_DASHBOARD: '/employee/dashboard',
  // PHASE 6 — employee ki CURRENT authoritative Savior shift (code/name + timings).
  // Non-cached backend lookup, taaki Savior portal par shift badalne ke baad
  // app turant nayi shift dikhaye.
  EMPLOYEE_SHIFT: '/employee/shift',
  
  // HR APIs
  HR_DASHBOARD: '/hr/dashboard',
  HR_EMPLOYEES: '/hr/employees',
  HR_EMPLOYEE: '/hr/employee',
  HR_AUDIT: '/hr/audit',
  HR_CATEGORY_ANALYTICS: '/hr/category-analytics',
  HR_DAILY_MASTER: '/hr/daily-master',
  HR_CELEBRATIONS: '/hr/celebrations',
  HR_MARRIAGE_ANNIVERSARY: '/marriage-anniversary',
  HR_HOLIDAYS: '/hr/holidays',
  // Dynamic employee categories + REAL company/category pairs (real
  // dbo.tblemployee data). The old manual category list and category-map
  // management endpoints were removed in Phase G final.
  HR_HOLIDAY_CATEGORIES_FOR_COMPANIES: '/hr/holiday-categories',
  
  // Health Check
  HEALTH: '/health',

  // SuperAdmin console (SUPERADMIN role required; enforced server-side)
  SUPERADMIN_CATALOG: '/superadmin/catalog',
  SUPERADMIN_HR_ADMINS: '/superadmin/hr-admins',
  SUPERADMIN_USERS: '/superadmin/super-admins',

  // Email Management (SuperAdmin + permitted HR Admins)
  EMAIL_CONFIG: '/email/config',
  EMAIL_PROVIDER: '/email/provider',
  EMAIL_HEALTH: '/email/health',
  EMAIL_TEST: '/email/test',
};

// Default Request Timeout (milliseconds)
export const REQUEST_TIMEOUT = 30000;

// Pagination Defaults
export const DEFAULT_PAGE_SIZE = 25;
export const MAX_PAGE_SIZE = 100;