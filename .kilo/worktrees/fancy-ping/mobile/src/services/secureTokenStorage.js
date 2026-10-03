// ============================================================================
// FILE: mobile/src/services/secureTokenStorage.js
// PURPOSE: Secure JWT storage abstraction for native and Expo Web
// ============================================================================

/**
 * Ye file JWT token ko secure storage abstraction ke through save/read karti hai.
 *
 * Native Android/iOS:
 *   SecureStore → device keychain/keystore
 *
 * Expo Web development:
 *   sessionStorage → sirf current browser tab tak
 *   localStorage ya AsyncStorage primary mobile token mechanism nahi hai.
 *
 * Data Flow:
 * Login → secureTokenStorage.setItem() → SecureStore (native)
 * App Start → secureTokenStorage.getItem() → API Client Bearer header
 * Logout / 401 → secureTokenStorage.removeItem() → token delete
 */

import { Platform } from 'react-native';
import * as SecureStore from 'expo-secure-store';

// Web fallback memory storage tab band hone par token clear kar deta hai.
const memoryStorage = new Map();

const getWebSessionStorage = () => {
  if (Platform.OS !== 'web') return null;
  try {
    return typeof window !== 'undefined' ? window.sessionStorage : null;
  } catch (_error) {
    return null;
  }
};

/**
 * Native SecureStore supported hai ya nahi check karta hai.
 * Expo Web par SecureStore ka web implementation reliable nahi hai, isliye wahan
 * sessionStorage fallback use hota hai.
 */
const usesSecureStore = () => Platform.OS !== 'web' && typeof SecureStore?.setItemAsync === 'function';

/**
 * Secure token write karta hai.
 * @param {string} key Storage key
 * @param {string} value Token value
 */
export const setSecureItem = async (key, value) => {
  const stringValue = String(value);

  if (usesSecureStore()) {
    await SecureStore.setItemAsync(key, stringValue, {
      keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY,
    });
    return;
  }

  const webStorage = getWebSessionStorage();
  if (webStorage) {
    webStorage.setItem(key, stringValue);
    return;
  }

  memoryStorage.set(key, stringValue);
};

/**
 * Secure token read karta hai.
 * @param {string} key Storage key
 * @returns {Promise<string|null>}
 */
export const getSecureItem = async (key) => {
  if (usesSecureStore()) {
    return SecureStore.getItemAsync(key);
  }

  const webStorage = getWebSessionStorage();
  if (webStorage) {
    return webStorage.getItem(key);
  }

  return memoryStorage.get(key) || null;
};

/**
 * Secure token delete karta hai.
 * @param {string} key Storage key
 */
export const removeSecureItem = async (key) => {
  if (usesSecureStore()) {
    await SecureStore.deleteItemAsync(key);
    return;
  }

  const webStorage = getWebSessionStorage();
  if (webStorage) {
    webStorage.removeItem(key);
    return;
  }

  memoryStorage.delete(key);
};

export default {
  setSecureItem,
  getSecureItem,
  removeSecureItem,
};
