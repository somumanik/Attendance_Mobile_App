// ============================================================================
// FILE: mobile/src/services/api.js
// PURPOSE: Axios API client - connects mobile app to existing Node/Express backend
// ============================================================================

/**
 * Ye service mobile app ko existing Node/Express backend se connect karti hai.
 * 
 * Architecture:
 * Mobile App → API Service (Axios) → HTTPS → Node/Express Backend → Savior SQL Server
 * 
 * Mobile app SQL Server se DIRECT connect NAHI karti.
 * Saare database credentials (DB_SERVER, DB_DATABASE, DB_USER, DB_PASSWORD)
 * backend ke .env mein hain, mobile app mein NAHI hain.
 * 
 * JWT_SECRET, BREVO_API_KEY, SMTP_PASSWORD bhi mobile app mein NAHI hain.
 * Ye sab backend mein hi rehte hain.
 * 
 * Ye client support karta hai:
 * - GET, POST requests
 * - Bearer JWT token automatic attachment
 * - Request timeout
 * - Common error handling
 * - HTTP 401 handling foundation
 */

import axios from 'axios';
import { API_BASE_URL, REQUEST_TIMEOUT, API_ENDPOINTS, STORAGE_KEYS } from '../utils/constants';
import { getItem } from './storage';

// 401 par central auth store ko signal karne ke liye lightweight callback.
// Isse API client aur auth store ka direct circular import nahi banta.
let unauthorizedHandler = null;

/**
 * Auth store 401 handler register karta hai.
 * @param {Function|null} handler Callback invoked after a 401 response
 */
export const setUnauthorizedHandler = (handler) => {
  unauthorizedHandler = typeof handler === 'function' ? handler : null;
};

// Axios instance create karo with base configuration
const apiClient = axios.create({
  baseURL: API_BASE_URL,
  timeout: REQUEST_TIMEOUT,
  headers: {
    'Content-Type': 'application/json',
    'Accept': 'application/json',
  },
});

// Request Interceptor - JWT token automatically attach karta hai
apiClient.interceptors.request.use(
  async (config) => {
    // Token storage se retrieve karo
    const token = await getItem(STORAGE_KEYS.AUTH_TOKEN);
    if (token) {
      config.headers.Authorization = `Bearer ${token}`;
    }
    return config;
  },
  (error) => {
    return Promise.reject(error);
  }
);

// Response Interceptor - Common error handling aur 401 handling
apiClient.interceptors.response.use(
  (response) => response,
  async (error) => {
    const originalRequest = error.config;
    
    // Network/timeout errors
    if (!error.response) {
      if (error.code === 'ECONNABORTED') {
        error.message = 'Request timeout - server se connection nahi ban paya';
      } else if (error.message === 'Network Error') {
        error.message = 'Network error - backend server chal raha hai check karein';
      }
      return Promise.reject(error);
    }
    
    // HTTP Status Code handling
    const { status, data } = error.response;
    
    switch (status) {
      case 400:
        error.message = data?.message || 'Invalid request - inputs check karein';
        break;
      case 401:
        // 401 - Unauthorized: Token expired ya invalid
        // Auth store ko signal karke token clear karwaya jata hai.
        error.message = data?.message || 'Session expired - dobara login karein';
        // Login failure par user ko login screen par error dikhana hai; existing
        // session sirf protected API ke 401 par clear hota hai.
        const isLoginRequest = /\/auth\/(hr|employee)\/login/.test(originalRequest?.url || '');
        if (!isLoginRequest && unauthorizedHandler) unauthorizedHandler();
        break;
      case 403:
        error.message = data?.message || 'Access denied - permission nahi hai';
        break;
      case 404:
        error.message = data?.message || 'Resource not found';
        break;
      case 500:
        error.message = 'Server error - backend team se contact karein';
        break;
      case 503:
        error.message = data?.message || 'Service unavailable - database connection issue';
        break;
      default:
        error.message = data?.message || `Error ${status} - unknown error`;
    }
    
    return Promise.reject(error);
  }
);

// Convenience methods for common HTTP verbs
export const api = {
  /**
   * GET request
   * @param {string} endpoint - API endpoint (e.g., API_ENDPOINTS.HR_DASHBOARD)
   * @param {object} params - Query parameters
   * @returns {Promise} Response data
   */
  get: async (endpoint, params = {}) => {
    const response = await apiClient.get(endpoint, { params });
    return response.data;
  },

  /**
   * POST request
   * @param {string} endpoint - API endpoint
   * @param {object} data - Request body
   * @returns {Promise} Response data
   */
  post: async (endpoint, data = {}) => {
    const response = await apiClient.post(endpoint, data);
    return response.data;
  },

  /**
   * PUT request
   * @param {string} endpoint - API endpoint
   * @param {object} data - Request body
   * @returns {Promise} Response data
   */
  put: async (endpoint, data = {}) => {
    const response = await apiClient.put(endpoint, data);
    return response.data;
  },

  /**
   * DELETE request
   * @param {string} endpoint - API endpoint
   * @returns {Promise} Response data
   */
  delete: async (endpoint) => {
    const response = await apiClient.delete(endpoint);
    return response.data;
  },
};

// Health check function - backend connectivity test ke liye
export const checkBackendHealth = async () => {
  try {
    const response = await api.get(API_ENDPOINTS.HEALTH);
    return { success: true, data: response };
  } catch (error) {
    return { success: false, error: error.message };
  }
};

// Export the axios instance for advanced usage
export default apiClient;