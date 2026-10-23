// ============================================================================
// FILE: mobile/src/store/authStore.js
// PURPOSE: Centralized authentication state, session restore and role state
// ============================================================================

/**
 * Ye file mobile app ka single authentication state store hai.
 * Isme token, current user, role, loading aur error state rehte hain.
 *
 * Data Flow:
 * App Start → restoreSession() → SecureStore token → GET /api/me → portal
 * Login Screen → loginHR/loginEmployee() → POST login API → token
 *                                             ↓
 *                                  GET /api/me role verification
 *                                             ↓
 *                                  Auth Store → Root Navigator
 * Logout / 401 → clearAuth() → token delete → Role Selection
 *
 * Employee password verification backend mein abhi production-secure nahi hai.
 * Mobile app use modify ya fake validate nahi karta.
 */

import { getItem, setItem, clearAuthData } from '../services/storage';
import {
  loginHR as loginHRApi,
  loginSuperAdmin as loginSuperAdminApi,
  loginEmployee as loginEmployeeApi,
  fetchCurrentUser,
} from '../services/auth';
import { setUnauthorizedHandler } from '../services/api';
import { STORAGE_KEYS, USER_ROLES } from '../utils/constants';

let state = {
  token: null,
  isAuthenticated: false,
  userRole: USER_ROLES.NONE,
  userData: null,
  isLoading: true,
  isBootstrapped: false,
  error: null,
  // Phase I: true jab employee ka password abhi set karna baaki hai (HR ne
  // temporary password diya ya force change lagaya hai). Is flag ke dauran app
  // Dashboard/Attendance/etc. kholne nahi deti, sirf "Set New Password".
  mustChangePassword: false,
  // Phase I section 2: true jab one-time 4-digit PIN setup abhi baaki hai.
  // Dashboard gate: sirf PinSetup screen dikhta hai, baaki tabs nahi.
  pinSetupRequired: false,
  // SuperAdmin console: HR Admin ke SAVED module/action permissions (UI filtering
  // ke liye; server har request par khud enforce karta hai).
  permissions: null,
};

const subscribers = new Set();

const setState = (partial) => {
  state = { ...state, ...partial };
  subscribers.forEach((callback) => callback(state));
};

export const subscribe = (callback) => {
  subscribers.add(callback);
  callback(state);
  return () => subscribers.delete(callback);
};

export const getState = () => state;

// HR and SuperAdmin accounts carry just a role; employees carry their record.
const userFromMe = (me) => (
  me?.role === USER_ROLES.HR || me?.role === USER_ROLES.SUPERADMIN
    ? { role: me.role, username: me.username || null, displayname: me.displayname || me.username || null }
    : me?.employee || null
);

const messageFrom = (error, fallback) =>
  (typeof error?.message === 'string' && error.message.trim()) || fallback;

/**
 * Auth state aur storage dono update karta hai.
 * Role verification ke baad hi is function ko call kiya jaata hai.
 */
export const setAuth = async (token, role, userData, options = {}) => {
  await setItem(STORAGE_KEYS.AUTH_TOKEN, token);
  await setItem(STORAGE_KEYS.USER_ROLE, role);
  await setItem(STORAGE_KEYS.USER_DATA, JSON.stringify(userData || null));

  setState({
    token,
    isAuthenticated: true,
    userRole: role,
    userData: userData || null,
    isLoading: false,
    error: null,
    // HR accounts never carry this flag.
    mustChangePassword: role === USER_ROLES.EMPLOYEE && options.mustChangePassword === true,
    // Phase I section 2: one-time PIN setup gate. Only while no PIN exists.
    pinSetupRequired: role === USER_ROLES.EMPLOYEE && options.pinSetupRequired === true,
    permissions: options.permissions || null,
  });
};

/**
 * Phase I: forced password setup complete hone par flag clear karta hai.
 * Iske baad hi employee Dashboard/Attendance tak pahunch sakta hai.
 */
export const clearMustChangePassword = () => setState({ mustChangePassword: false });

/**
 * Phase I section 2: one-time 4-digit PIN setup complete hone par flag clear
 * karta hai (PinSetup screen success par call karta hai).
 */
export const clearPinSetupRequired = () => setState({ pinSetupRequired: false });

/**
 * Logout: token, role and user state clear karta hai.
 * Theme preference is function se touch nahi hota.
 */
export const clearAuth = async () => {
  await clearAuthData();
  setState({
    token: null,
    isAuthenticated: false,
    userRole: USER_ROLES.NONE,
    userData: null,
    isLoading: false,
    error: null,
    mustChangePassword: false,
    pinSetupRequired: false,
    permissions: null,
  });
};

export const setLoading = (loading) => setState({ isLoading: loading });

export const setError = (error) => setState({ error: error || null });

/**
 * Login API response ke baad /api/me se role verify karta hai.
 * Expected role backend response se match nahi hua to session reject hota hai.
 *
 * Phase I: /api/me se bhi mustChangePassword aata hai, isliye HR ke force-change
 * karne ke baad bhi koi purana session turant "Set New Password" par redirect ho
 * jata hai - token par bharosa nahi kiya jaata.
 */
const completeLogin = async (loginRequest, expectedRole) => {
  setState({ isLoading: true, error: null });

  try {
    const loginResponse = await loginRequest();
    if (!loginResponse?.token) throw new Error('Login did not return a token.');

    // /api/me Bearer token read karta hai; isliye token pehle secure storage mein hai.
    await setItem(STORAGE_KEYS.AUTH_TOKEN, loginResponse.token);
    const me = await fetchCurrentUser();

    if (me.role !== expectedRole) {
      throw new Error('Authenticated role does not match the selected portal.');
    }

    // Live server state wins over whatever the login response claimed.
    // Order matters: forced password change outranks the PIN gate, so the
    // user sets the new password first and the PIN immediately after.
    const mustChangePassword = me.mustChangePassword === true || loginResponse.mustChangePassword === true;
    const pinSetupRequired =
      me.pinSetupRequired === true || loginResponse.pinSetupRequired === true;
    await setAuth(loginResponse.token, me.role, userFromMe(me), { mustChangePassword, pinSetupRequired, permissions: me.permissions || null });
    return getState();
  } catch (error) {
    await clearAuthData();
    const message = messageFrom(error, 'Login failed. Please try again.');
    setState({
      token: null,
      isAuthenticated: false,
      userRole: USER_ROLES.NONE,
      userData: null,
      isLoading: false,
      error: message,
      mustChangePassword: false,
      pinSetupRequired: false,
    });
    // First-time setup flag ko bachein, taaki login screen routing kar sake.
    const wrapped = new Error(message);
    wrapped.firstTimeSetupRequired = error?.firstTimeSetupRequired === true;
    throw wrapped;
  }
};

/**
 * HR Login Screen se call hota hai.
 * POST /api/auth/hr/login → token → GET /api/me → HR state.
 */
export const loginHR = (username, password) =>
  completeLogin(() => loginHRApi(username, password), USER_ROLES.HR);

/**
 * Employee Login Screen se call hota hai.
 * POST /api/auth/employee/login → token → GET /api/me → EMPLOYEE state.
 *
 * `pin` optional hai: diya jaye to PIN se sign-in hota hai, warna password se.
 * Password login hamesha available rehta hai (Phase I section 5).
 */
export const loginEmployee = (paycode, password, pin) =>
  completeLogin(
    () => loginEmployeeApi(paycode, password, pin, typeof pin === 'string' && pin.length > 0),
    USER_ROLES.EMPLOYEE,
  );

/**
 * SuperAdmin Login Screen se call hota hai.
 * POST /api/auth/superadmin/login → token → GET /api/me → SUPERADMIN state.
 *
 * HR/Employee login se bilkul alag path hai; dono ke behaviour par koi asar
 * nahi padta. Forced-password/PIN gates sirf EMPLOYEE ke liye hain, isliye
 * SuperAdmin ke liye woh flags hamesha false rehte hain.
 */
export const loginSuperAdmin = (username, password) =>
  completeLogin(() => loginSuperAdminApi(username, password), USER_ROLES.SUPERADMIN);

/**
 * App start par stored session restore karta hai.
 * 401 par token delete karke Role Selection par wapas jaata hai.
 * Network failure par token ko silently production nahi samajhा jata; user ko
 * role selection dikhata hai aur next startup par dobara verify karta hai.
 */
export const restoreSession = async () => {
  setState({ isLoading: true, error: null });

  try {
    const token = await getItem(STORAGE_KEYS.AUTH_TOKEN);
    if (!token) {
      setState({
        token: null,
        isAuthenticated: false,
        userRole: USER_ROLES.NONE,
        userData: null,
        isLoading: false,
        error: null,
      });
      return;
    }

    const me = await fetchCurrentUser();
    if (![USER_ROLES.HR, USER_ROLES.EMPLOYEE, USER_ROLES.SUPERADMIN].includes(me.role)) {
      throw new Error('Session role is not supported.');
    }

    // A restored session re-reads the LIVE flag, so an HR forced password change
    // is honoured even for a token stored before it happened. The PIN gate is
    // re-read the same way.
    await setAuth(token, me.role, userFromMe(me), {
      mustChangePassword: me.mustChangePassword === true,
      pinSetupRequired: me.pinSetupRequired === true,
      permissions: me.permissions || null,
    });
  } catch (error) {
    if (error?.response?.status === 401 || error?.status === 401) {
      await clearAuthData();
      setState({
        token: null,
        isAuthenticated: false,
        userRole: USER_ROLES.NONE,
        userData: null,
        isLoading: false,
        error: null,
        mustChangePassword: false,
        pinSetupRequired: false,
      });
      return;
    }

    setState({
      token: null,
      isAuthenticated: false,
      userRole: USER_ROLES.NONE,
      userData: null,
      isLoading: false,
      error: messageFrom(error, 'Unable to verify the saved session.'),
      mustChangePassword: false,
      pinSetupRequired: false,
    });
  } finally {
    // Login ke dauran bhi AuthNavigator mounted rahe; sirf app startup loading
    // screen dikhata hai. Isliye bootstrap flag alag rakha gaya hai.
    setState({ isBootstrapped: true });
  }
};

// Purane Phase 1 callers ke liye naam backward compatible rakha gaya hai.
export const initializeAuth = restoreSession;

export const hasRole = (role) => state.isAuthenticated && state.userRole === role;
export const isHR = () => hasRole(USER_ROLES.HR);
export const isEmployee = () => hasRole(USER_ROLES.EMPLOYEE);
export const isSuperAdmin = () => hasRole(USER_ROLES.SUPERADMIN);

// API client ke 401 response par session state bhi clear karta hai.
setUnauthorizedHandler(() => {
  void clearAuth();
});

export const authStore = {
  getState,
  subscribe,
  setAuth,
  clearAuth,
  clearMustChangePassword,
  clearPinSetupRequired,
  setLoading,
  setError,
  initializeAuth,
  restoreSession,
  loginHR,
  loginSuperAdmin,
  loginEmployee,
  hasRole,
  isHR,
  isEmployee,
  isSuperAdmin,
  get token() { return state.token; },
  get isAuthenticated() { return state.isAuthenticated; },
  get userRole() { return state.userRole; },
  get userData() { return state.userData; },
  get isLoading() { return state.isLoading; },
  get error() { return state.error; },
  get mustChangePassword() { return state.mustChangePassword; },
  get pinSetupRequired() { return state.pinSetupRequired; },
  get permissions() { return state.permissions; },
};

export default authStore;
