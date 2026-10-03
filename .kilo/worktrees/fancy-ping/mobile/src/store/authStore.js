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

const userFromMe = (me) => (me?.role === USER_ROLES.HR ? { role: me.role } : me?.employee || null);

const messageFrom = (error, fallback) =>
  (typeof error?.message === 'string' && error.message.trim()) || fallback;

/**
 * Auth state aur storage dono update karta hai.
 * Role verification ke baad hi is function ko call kiya jaata hai.
 */
export const setAuth = async (token, role, userData) => {
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
  });
};

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
  });
};

export const setLoading = (loading) => setState({ isLoading: loading });

export const setError = (error) => setState({ error: error || null });

/**
 * Login API response ke baad /api/me se role verify karta hai.
 * Expected role backend response se match nahi hua to session reject hota hai.
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

    await setAuth(loginResponse.token, me.role, userFromMe(me));
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
 */
export const loginEmployee = (paycode, password) =>
  completeLogin(() => loginEmployeeApi(paycode, password), USER_ROLES.EMPLOYEE);

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
    if (![USER_ROLES.HR, USER_ROLES.EMPLOYEE].includes(me.role)) {
      throw new Error('Session role is not supported.');
    }

    await setAuth(token, me.role, userFromMe(me));
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

// API client ke 401 response par session state bhi clear karta hai.
setUnauthorizedHandler(() => {
  void clearAuth();
});

export const authStore = {
  getState,
  subscribe,
  setAuth,
  clearAuth,
  setLoading,
  setError,
  initializeAuth,
  restoreSession,
  loginHR,
  loginEmployee,
  hasRole,
  isHR,
  isEmployee,
  get token() { return state.token; },
  get isAuthenticated() { return state.isAuthenticated; },
  get userRole() { return state.userRole; },
  get userData() { return state.userData; },
  get isLoading() { return state.isLoading; },
  get error() { return state.error; },
};

export default authStore;
