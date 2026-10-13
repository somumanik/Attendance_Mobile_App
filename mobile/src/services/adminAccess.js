// ============================================================================
// FILE: mobile/src/services/adminAccess.js
// PURPOSE: SuperAdmin console APIs (HR Admin accounts, permissions, SuperAdmins)
// ============================================================================

/**
 * Ye service SuperAdmin console ke management APIs ko mobile se connect karti hai.
 * Saari authorization SERVER par hoti hai — yahan sirf calls hain.
 *
 * Access: in sab endpoints ke liye SUPERADMIN role chahiye (server par enforce).
 * Koi password/hash response mein nahi aata; sirf masked/summary data.
 */

import { api } from './api';
import { API_ENDPOINTS } from '../utils/constants';

/** Module + action catalog (HR-assignable modules come from the server). */
export const getPermissionCatalog = async () => api.get(API_ENDPOINTS.SUPERADMIN_CATALOG);

/** All HR Admin accounts with their effective permissions. */
export const listHrAdmins = async () => api.get(API_ENDPOINTS.SUPERADMIN_HR_ADMINS);

/** Create an HR Admin account (server seeds the safe default permissions). */
export const createHrAdmin = async ({ username, password, displayname, companies }) =>
  api.post(API_ENDPOINTS.SUPERADMIN_HR_ADMINS, {
    username: String(username || '').trim(),
    password: String(password || ''),
    displayname: String(displayname || '').trim(),
    // Phase 4.4 — optional company assignment at creation time. Omitted entirely when
    // the caller supplies none, so the previous request body is preserved exactly.
    ...(Array.isArray(companies) ? { companies } : {}),
  });

/**
 * Phase 4.4 — replace an HR Admin's company assignments.
 * The server validates every code against the REAL company catalogue
 * (dbo.tblemployee.companycode) and rejects unknown codes.
 */
export const setHrAdminCompanies = async (username, companies) =>
  api.put(`${API_ENDPOINTS.SUPERADMIN_HR_ADMINS}/${encodeURIComponent(username)}/companies`, {
    companies: Array.isArray(companies) ? companies.map((c) => String(c).trim()).filter(Boolean) : [],
  });

/** Replace an HR Admin's module/action permissions. */
export const saveHrAdminPermissions = async (username, permissions) =>
  api.put(`${API_ENDPOINTS.SUPERADMIN_HR_ADMINS}/${encodeURIComponent(username)}`, { permissions });

/** Enable / disable an HR Admin account. */
export const setHrAdminActive = async (username, isactive) =>
  api.put(`${API_ENDPOINTS.SUPERADMIN_HR_ADMINS}/${encodeURIComponent(username)}`, { isactive: isactive === true });

/** Reset an HR Admin password. */
export const setHrAdminPassword = async (username, password) =>
  api.post(`${API_ENDPOINTS.SUPERADMIN_HR_ADMINS}/${encodeURIComponent(username)}/password`, {
    password: String(password || ''),
  });

/** Delete an HR Admin account (bootstrap account is protected server-side). */
export const deleteHrAdmin = async (username) =>
  api.delete(`${API_ENDPOINTS.SUPERADMIN_HR_ADMINS}/${encodeURIComponent(username)}`);

/** All SuperAdmin accounts (the env bootstrap appears as protected). */
export const listSuperAdmins = async () => api.get(API_ENDPOINTS.SUPERADMIN_USERS);

/** Create an additional SuperAdmin account. */
export const createSuperAdmin = async ({ username, password, displayname }) =>
  api.post(API_ENDPOINTS.SUPERADMIN_USERS, {
    username: String(username || '').trim(),
    password: String(password || ''),
    displayname: String(displayname || '').trim(),
  });

/** Enable / disable a SuperAdmin account (last active one is protected). */
export const setSuperAdminActive = async (username, isactive) =>
  api.put(`${API_ENDPOINTS.SUPERADMIN_USERS}/${encodeURIComponent(username)}`, { isactive: isactive === true });

/** Reset a SuperAdmin password. */
export const setSuperAdminPassword = async (username, password) =>
  api.post(`${API_ENDPOINTS.SUPERADMIN_USERS}/${encodeURIComponent(username)}/password`, {
    password: String(password || ''),
  });

/** Delete a SuperAdmin account (bootstrap + last active are protected). */
export const deleteSuperAdmin = async (username) =>
  api.delete(`${API_ENDPOINTS.SUPERADMIN_USERS}/${encodeURIComponent(username)}`);
