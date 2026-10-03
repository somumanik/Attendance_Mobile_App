// ============================================================================
// FILE: mobile/src/config/index.js
// PURPOSE: Single centralized mobile runtime configuration
// ============================================================================

/**
 * Ye file mobile app ka single API configuration source hai.
 * Mobile screen/service har jagah same base URL use karega.
 * Sirf public API address yahan hai; DB credentials, JWT secret aur email keys nahi.
 *
 * Data Flow:
 * Login Screen → Auth Service → API Client → EXPO_PUBLIC_API_BASE_URL
 *                                            ↓
 *                              Existing Express Backend
 *
 * Expo Web local development ke liye default localhost:4000/api use hota hai.
 * Physical device ke liye env variable ko LAN IP par set kiya ja sakta hai.
 */

const DEFAULT_API_BASE_URL = 'http://localhost:4000/api';

const configuredUrl = process.env.EXPO_PUBLIC_API_BASE_URL || DEFAULT_API_BASE_URL;

// Trailing slash hata dete hain taaki endpoint concatenation consistent rahe.
export const API_BASE_URL = String(configuredUrl).replace(/\/+$/, '');

export const API_TIMEOUT_MS = 30000;

export default {
  API_BASE_URL,
  API_TIMEOUT_MS,
};
