// ============================================================================
// FILE: mobile/src/services/auth.js
// PURPOSE: Existing backend authentication API service
// ============================================================================

/**
 * Ye service existing Node/Express authentication APIs ko mobile se connect karti hai.
 * Mobile app SQL Server se direct connect nahi karti.
 *
 * Data Flow:
 * HR/Employee Login Screen
 *   ↓
 * auth.js → API Client → POST /api/auth/hr/login or /api/auth/employee/login
 *   ↓
 * Backend JWT response
 *   ↓
 * Auth Store → SecureStore (native) / sessionStorage (Expo Web)
 *   ↓
 * GET /api/me → role verification → correct mobile portal
 *
 * Employee password verification ka backend hardening abhi bhi separate task hai.
 * Is mobile service mein koi fake password validation nahi hai.
 */

import { api } from './api';
import { getItem, clearAuthData } from './storage';
import { API_ENDPOINTS, STORAGE_KEYS, USER_ROLES } from '../utils/constants';

/**
 * Backend error se user-safe message nikaalta hai.
 * Raw stack trace mobile UI mein expose nahi hota.
 */
const safeErrorMessage = (error, fallback) => {
  const message = error?.response?.data?.message || error?.message;
  return typeof message === 'string' && message.trim() ? message : fallback;
};

/**
 * Existing HR login API call karta hai.
 * Backend contract: POST /api/auth/hr/login { username, password }
 * @param {string} username HR username
 * @param {string} password HR password
 * @returns {Promise<object>} Backend response containing token and role
 */
export const loginHR = async (username, password) => {
  try {
    const response = await api.post(API_ENDPOINTS.HR_LOGIN, {
      username: String(username || '').trim(),
      password: String(password || ''),
    });

    if (!response?.success || !response?.token) {
      throw new Error('HR login response did not include a valid session.');
    }

    return response;
  } catch (error) {
    throw new Error(safeErrorMessage(error, 'HR login failed. Please try again.'));
  }
};

/**
 * Existing employee login API call karta hai.
 * Backend contract: POST /api/auth/employee/login { paycode, password }
 * @param {string} paycode Employee paycode
 * @param {string} password Employee password
 * @returns {Promise<object>} Backend response containing token, role and employee
 */
export const loginEmployee = async (paycode, password) => {
  try {
    const response = await api.post(API_ENDPOINTS.EMPLOYEE_LOGIN, {
      paycode: String(paycode || '').trim(),
      password: String(password || ''),
    });

    if (!response?.success || !response?.token) {
      throw new Error('Employee login response did not include a valid session.');
    }

    return response;
  } catch (error) {
    // firstTimeSetupRequired ko preserve karta hai, taaki Employee Login screen
    // user ko first-time password setup flow mein bhej sake.
    const wrapped = new Error(safeErrorMessage(error, 'Employee login failed. Please try again.'));
    wrapped.firstTimeSetupRequired = error?.response?.data?.firstTimeSetupRequired === true;
    throw wrapped;
  }
};

/**
 * Employee ka first-time password setup pending hai ya nahi — ye check karta hai.
 * Backend: GET /api/auth/employee/first-time-setup/status?paycode=
 * @param {string} paycode Employee paycode
 * @returns {Promise<{ required: boolean, employee: object }>}
 */
export const checkFirstTimeSetup = async (paycode) => {
  const response = await api.get(API_ENDPOINTS.EMPLOYEE_FIRST_TIME_SETUP_STATUS, { paycode });
  return { required: response?.firstTimeSetupRequired === true, employee: response?.employee || null };
};

/**
 * Employee apna pehla password khud banata hai.
 * Password kabhi plaintext store ya return nahi hota — sirf scrypt hash save hota hai.
 * Backend: POST /api/auth/employee/first-time-setup { paycode, password, confirmPassword }
 * @param {Object} payload Setup payload
 * @returns {Promise<object>} Backend confirmation (no token)
 */
export const completeFirstTimeSetup = async ({ paycode, password, confirmPassword }) => {
  const response = await api.post(API_ENDPOINTS.EMPLOYEE_FIRST_TIME_SETUP, {
    paycode: String(paycode || '').trim(),
    password: String(password || ''),
    confirmPassword: String(confirmPassword || ''),
  });
  return response;
};

/* ------------------------- 4-digit PIN (Phase 3A.8) -------------------------
   Ye employee ka APNA PIN hai. Backend har call par authenticated session se
   employee identity leta hai; mobile se paycode bheja hi nahi jata.
   PIN password ka replacement nahi hai — sirf additional credential hai. */

/**
 * Check karta hai ki employee ka PIN pehle se set hai ya nahi.
 * Backend: GET /api/employee/pin/status
 * @returns {Promise<{ pinConfigured: boolean, locked: boolean }>}
 */
export const getPinStatus = async () => {
  const response = await api.get(API_ENDPOINTS.EMPLOYEE_PIN_STATUS);
  return {
    pinConfigured: response?.pinConfigured === true,
    locked: response?.locked === true,
  };
};

/**
 * Pehli baar 4-digit PIN banata hai (sirf tab jab PIN set nahi hai).
 * Backend: POST /api/employee/pin/setup { pin, confirmPin }
 * @param {Object} payload PIN values
 * @returns {Promise<object>} Server confirmation (PIN/hash kabhi nahi)
 */
export const setupPin = async ({ pin, confirmPin }) => {
  const response = await api.post(API_ENDPOINTS.EMPLOYEE_PIN_SETUP, {
    pin: String(pin || ''),
    confirmPin: String(confirmPin || ''),
  });
  return response;
};

/**
 * Existing PIN badalta hai — current PIN verify karna zaroori hai.
 * Backend: POST /api/employee/pin/change { currentPin, newPin, confirmPin }
 * @param {Object} payload PIN values
 * @returns {Promise<object>} Server confirmation (PIN/hash kabhi nahi)
 */
export const changePin = async ({ currentPin, newPin, confirmPin }) => {
  const response = await api.post(API_ENDPOINTS.EMPLOYEE_PIN_CHANGE, {
    currentPin: String(currentPin || ''),
    newPin: String(newPin || ''),
    confirmPin: String(confirmPin || ''),
  });
  return response;
};

/* -------------------- forgot / reset password (Phase 3A.9) -----------------
   Reset ke liye paycode KABHI kaafi nahi — sirf email se aaya single-use
   token hi password reset karne ki permission deta hai. */

/**
 * Forgot-password request bhejta hai.
 * Backend hamesha generic message deta hai, chahe paycode exist kare ya na kare.
 * @param {string} paycode Employee paycode
 * @returns {Promise<object>} Generic response
 */
export const requestPasswordReset = async (paycode) => {
  const response = await api.post(API_ENDPOINTS.EMPLOYEE_FORGOT_PASSWORD, {
    paycode: String(paycode || '').trim(),
  });
  return response;
};

/**
 * Naya password set karta hai — sirf valid reset token ke saath.
 * @param {Object} payload Reset payload
 * @returns {Promise<object>} Server confirmation
 */
export const resetPassword = async ({ token, password, confirmPassword }) => {
  const response = await api.post(API_ENDPOINTS.EMPLOYEE_RESET_PASSWORD, {
    token: String(token || '').trim(),
    password: String(password || ''),
    confirmPassword: String(confirmPassword || ''),
  });
  return response;
};

/* ------------------- HR-controlled employee credentials (Phase 3A.10) -------
   Ye sirf authenticated HR session se call hoti hain. Backend par
   authenticate + requireRole('HR') lagi hai, isliye employee token se
   ye endpoints 403 dete hain. Response mein kabhi hash nahi aata. */

/**
 * HR ke liye employee credential status (password/PIN set hai ya nahi).
 * @param {string} paycode Employee paycode
 * @returns {Promise<object>} Status (booleans only)
 */
export const getHrEmployeeCredentials = async (paycode) => {
  const response = await api.get(API_ENDPOINTS.HR_EMPLOYEE_CREDENTIALS, { paycode });
  return response;
};

/**
 * HR employee ka password reset karta hai (PIN change NAHI hota).
 * @param {Object} payload Paycode + new password
 * @returns {Promise<object>} Server confirmation
 */
export const hrResetEmployeePassword = async ({ paycode, password, confirmPassword }) => {
  const response = await api.post(API_ENDPOINTS.HR_EMPLOYEE_CREDENTIALS_PASSWORD, {
    paycode: String(paycode || '').trim(),
    password: String(password || ''),
    confirmPassword: String(confirmPassword || ''),
  });
  return response;
};

/**
 * HR employee ka 4-digit PIN reset karta hai (password change NAHI hota).
 * @param {Object} payload Paycode + new PIN
 * @returns {Promise<object>} Server confirmation
 */
export const hrResetEmployeePin = async ({ paycode, pin, confirmPin }) => {
  const response = await api.post(API_ENDPOINTS.HR_EMPLOYEE_CREDENTIALS_PIN, {
    paycode: String(paycode || '').trim(),
    pin: String(pin || ''),
    confirmPin: String(confirmPin || ''),
  });
  return response;
};

/**
 * Bearer token se current user verify karta hai.
 * Backend contract: GET /api/me
 * @returns {Promise<object>} { role, employee? }
 */
export const fetchCurrentUser = async () => {
  const response = await api.get(API_ENDPOINTS.ME);

  if (!response?.role) {
    throw new Error('Current user response did not include a role.');
  }

  return response;
};

/**
 * Logout storage abstraction se auth data clear karta hai.
 * Theme preference delete nahi hota.
 */
export const logout = async () => {
  await clearAuthData();
};

/**
 * Stored token existence check.
 * @returns {Promise<boolean>}
 */
export const isAuthenticated = async () => !!(await getItem(STORAGE_KEYS.AUTH_TOKEN));

/**
 * Stored role read karta hai.
 * @returns {Promise<string>}
 */
export const getCurrentUserRole = async () =>
  (await getItem(STORAGE_KEYS.USER_ROLE)) || USER_ROLES.NONE;

/**
 * Stored user metadata read karta hai.
 * @returns {Promise<object|null>}
 */
export const getCurrentUserData = async () => {
  const data = await getItem(STORAGE_KEYS.USER_DATA);
  return data ? JSON.parse(data) : null;
};
