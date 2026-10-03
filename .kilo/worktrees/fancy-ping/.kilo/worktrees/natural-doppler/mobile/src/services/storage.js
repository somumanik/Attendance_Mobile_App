// ============================================================================
// FILE: mobile/src/services/storage.js
// PURPOSE: Auth storage abstraction backed by SecureStore on native devices
// ============================================================================

/**
 * Ye file auth token aur user data ko storage abstraction se save/read karti hai.
 * Native par Expo SecureStore use hota hai; Expo Web development par
 * secureTokenStorage ka sessionStorage fallback use hota hai.
 *
 * Data Flow:
 * Auth Store → storage abstraction → SecureStore (native) / sessionStorage (web)
 * API Client → storage abstraction → Bearer JWT read
 * Logout / 401 → storage abstraction → token delete
 *
 * Theme AsyncStorage mein separately rehta hai; logout theme preference delete nahi karta.
 */

import { STORAGE_KEYS } from '../utils/constants';
import {
  setSecureItem,
  getSecureItem,
  removeSecureItem,
} from './secureTokenStorage';

/**
 * Value store karta hai.
 * @param {string} key Storage key
 * @param {string} value Value to store
 */
export const setItem = async (key, value) => setSecureItem(key, value);

/**
 * Value retrieve karta hai.
 * @param {string} key Storage key
 * @returns {Promise<string|null>} Stored value ya null
 */
export const getItem = async (key) => getSecureItem(key);

/**
 * Item delete karta hai.
 * @param {string} key Storage key
 */
export const removeItem = async (key) => removeSecureItem(key);

/**
 * Logout ya invalid session par auth data clear karta hai.
 * Theme preference is list mein nahi hai, isliye theme survive karta hai.
 */
export const clearAuthData = async () => {
  await removeItem(STORAGE_KEYS.AUTH_TOKEN);
  await removeItem(STORAGE_KEYS.USER_ROLE);
  await removeItem(STORAGE_KEYS.USER_DATA);
  await removeItem(STORAGE_KEYS.REFRESH_TOKEN);
};

/**
 * Check karta hai ki token exist karta hai ya nahi.
 * @returns {Promise<boolean>}
 */
export const hasToken = async () => !!(await getItem(STORAGE_KEYS.AUTH_TOKEN));
