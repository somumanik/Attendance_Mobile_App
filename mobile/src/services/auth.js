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
 * Employee login. Password is the primary credential; a 4-digit PIN may be used
 * instead (Phase I section 5) and password login stays available as a fallback.
 *
 * Backend contract: POST /api/auth/employee/login
 *   { paycode, password }              -> password sign-in
 *   { paycode, pin, credential:'pin' } -> PIN sign-in
 *
 * @param {string} paycode Employee paycode
 * @param {string} password Employee password (ignored when using a PIN)
 * @param {string} [pin] Optional 4-digit PIN
 * @param {boolean} [usePin] Send the PIN instead of the password
 * @returns {Promise<object>} Backend response (token, role, employee, mustChangePassword)
 */
export const loginEmployee = async (paycode, password, pin, usePin = false) => {
  try {
    const body = { paycode: String(paycode || '').trim() };
    if (usePin) {
      body.credential = 'pin';
      body.pin = String(pin || '');
    } else {
      body.password = String(password || '');
    }
    const response = await api.post(API_ENDPOINTS.EMPLOYEE_LOGIN, body);

    if (!response?.success || !response?.token) {
      throw new Error('Employee login response did not include a valid session.');
    }

    return response;
  } catch (error) {
    // firstTimeSetupRequired ko preserve karta hai, taaki Employee Login screen
    // user ko first-time password setup flow mein bhej sake.
    const wrapped = new Error(safeErrorMessage(error, 'Employee login failed. Please try again.'));
    wrapped.firstTimeSetupRequired = error?.response?.data?.firstTimeSetupRequired === true;
    wrapped.mustChangePassword = error?.response?.data?.mustChangePassword === true;
    wrapped.code = error?.response?.data?.code;
    throw wrapped;
  }
};

/* --------------- employee sets / changes OWN password (Phase I) -------------
   Backend har call par authenticated session se identity leta hai, isliye mobile
   se paycode kabhi nahi bheja jaata - koi doosre employee ka password change
   hi nahi kar sakta. */

/**
 * Signed-in employee apna password badalta hai.
 * Ye wahi endpoint hai jo forced password setup (mustChangePassword) clear karta hai.
 * Backend: POST /api/employee/password/change { currentPassword, newPassword, confirmPassword }
 * @param {Object} payload Password values
 * @returns {Promise<object>} Server confirmation (no password, no hash)
 */
export const changeMyPassword = async ({ currentPassword, newPassword, confirmPassword }) => {
  const response = await api.post(API_ENDPOINTS.EMPLOYEE_PASSWORD_CHANGE, {
    currentPassword: String(currentPassword || ''),
    newPassword: String(newPassword || ''),
    confirmPassword: String(confirmPassword || ''),
  });
  return response;
};

/**
 * Batata hai ki employee par forced password change pending hai ya nahi.
 * @returns {Promise<{ mustChangePassword: boolean }>}
 */
export const getMyPasswordStatus = async () => {
  const response = await api.get(API_ENDPOINTS.EMPLOYEE_PASSWORD_STATUS);
  return { mustChangePassword: response?.mustChangePassword === true };
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
 *
 * Phase I section 2: mustChange=true ko temporary password ki tarah store karta
 * hai, jisse employee ko next login par naya password set karna hi padega.
 * Password API response mein kabhi return nahi hota.
 *
 * @param {Object} payload Paycode + new password (+ mustChange flag)
 * @returns {Promise<object>} Server confirmation
 */
export const hrResetEmployeePassword = async ({ paycode, password, confirmPassword, mustChange = false }) => {
  const response = await api.post(API_ENDPOINTS.HR_EMPLOYEE_CREDENTIALS_PASSWORD, {
    paycode: String(paycode || '').trim(),
    password: String(password || ''),
    confirmPassword: String(confirmPassword || ''),
    mustChange: mustChange === true,
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
 * HR employee ko force karta hai ki next login par naya password set kare
 * (current password badalta NAHI).
 * @param {string} paycode Employee paycode
 * @returns {Promise<object>} Server confirmation
 */
export const hrForcePasswordChange = async (paycode) => {
  const response = await api.post(API_ENDPOINTS.HR_EMPLOYEE_FORCE_PASSWORD_CHANGE, {
    paycode: String(paycode || '').trim(),
  });
  return response;
};

/**
 * HR employee ka login enable / disable karta hai.
 * Ye sirf application credential flag badalta hai - Savior data kabhi nahi badalta.
 * @param {string} paycode Employee paycode
 * @param {boolean} enabled true = allow login, false = block login
 * @returns {Promise<object>} Server confirmation
 */
export const hrSetEmployeeLoginEnabled = async (paycode, enabled) => {
  const response = await api.post(API_ENDPOINTS.HR_EMPLOYEE_LOGIN_ACCESS, {
    paycode: String(paycode || '').trim(),
    enabled: enabled === true,
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
// ---------------------------------------------------------------------------
// Employee Profile (self-service)
// The employee is resolved from the authenticated session on the server; no
// paycode is ever sent from the client.
// ---------------------------------------------------------------------------

/**
 * Load the logged-in employee's own profile (master + self-service fields).
 * @returns {Promise<object>}
 */
export const getMyProfile = async () => {
  const response = await api.get(API_ENDPOINTS.EMPLOYEE_PROFILE);
  return response?.profile || null;
};

/**
 * Save ONLY the self-service fields of the logged-in employee.
 * Master fields (name, paycode, department, company, dates, ...) are rejected by
 * the server, so they can never be overwritten from here.
 * @param {{mobile?:string,email?:string,address?:string,pincode?:string,
 *          emergencyName?:string,emergencyNumber?:string}} fields
 * @returns {Promise<{profile: object}>}
 */
export const saveMyProfile = async (fields) => {
  const response = await api.put(API_ENDPOINTS.EMPLOYEE_PROFILE, {
    mobile: fields.mobile || '',
    email: fields.email || '',
    address: fields.address || '',
    pincode: fields.pincode || '',
    emergencyName: fields.emergencyName || '',
    emergencyNumber: fields.emergencyNumber || '',
  });
  return response;
};