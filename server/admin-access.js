/* ============================================================================
   ADMIN ACCESS CONTROL — isolated module (HR Admin accounts + permissions)
   ----------------------------------------------------------------------------
   WHY THIS FILE EXISTS:
   The SuperAdmin console must be able to configure, per HR Admin account,
   WHICH management modules and WHICH actions that account may use — and the
   SERVER must enforce it on every request (hiding a tab is not security).

   STORAGE: application-owned tables only, created with the SAME
   create-if-missing convention the project already uses for
   HR_EmployeeAuth / HR_Leave* / HR_Salary* (see leave-service.js,
   salary-service.js). The Savior biometric schema is NEVER touched.

     dbo.HR_AdminUser        one row per HR Admin account
     dbo.HR_AdminPermission  (username, module) -> action flags
     dbo.HR_SuperAdminUser   additional SuperAdmin accounts

   BOOTSTRAP / BACKWARD COMPATIBILITY:
   The credentials that already exist in .env stay the permanent bootstrap:
     - HR_USERNAME / HR_PASSWORD          -> HR Admin, FULL permissions
     - SUPERADMIN_USERNAME + hash/salt    -> SuperAdmin (env-managed)
   The env HR account can never be deleted or locked out, so a bad permission
   edit can never brick the HR portal. Env verification always runs FIRST and
   is completely unchanged, so existing logins keep working byte-for-byte.

   Passwords: scrypt-v1 (same parameters as employee-auth.js / superadmin-auth.js).
   Plaintext is never stored, never returned and never logged.
   ========================================================================== */

import crypto from 'node:crypto';
import util from 'node:util';
import { sql } from './db.js';

/* ------------------------------- hashing --------------------------------- */
const SCRYPT = { N: 16384, r: 8, p: 1, maxmem: 64 * 1024 * 1024 };
const KEY_LENGTH = 64;
const SALT_BYTES = 16;
const ALGO = 'scrypt-v1';
const scryptAsync = util.promisify(crypto.scrypt);

const derive = async (secret, salt) =>
  (await scryptAsync(String(secret), salt, KEY_LENGTH, SCRYPT)).toString('hex');

/** Hash a secret with a fresh random salt. */
export async function hashSecret(secret) {
  const salt = crypto.randomBytes(SALT_BYTES).toString('hex');
  return { hash: await derive(secret, salt), salt, algo: ALGO };
}

/** Constant-time verification. Fails closed on malformed/unknown input. */
export async function verifySecret(secret, hash, salt, algo) {
  if (!hash || !salt || !secret) return false;
  if (algo && String(algo) !== ALGO) return false;
  try {
    const a = Buffer.from(await derive(secret, salt), 'hex');
    const b = Buffer.from(String(hash), 'hex');
    if (a.length === 0 || a.length !== b.length) return false;
    return crypto.timingSafeEqual(a, b);
  } catch {
    return false;
  }
}

/* --------------------------- permission model ---------------------------- */

/** The management modules the console controls, in display order. */
export const MODULE_CATALOG = [
  /* Phase 4.4 — HR NAVIGATION SECTIONS. Each key mirrors a REAL tab/screen in
     mobile/src/navigation/HRNavigator.jsx (no invented, duplicate sections). These
     keys are ADDITIVE and backward compatible: a section with NO stored row for an
     account keeps its historical behaviour (visible + View allowed), so every
     existing HR account keeps exactly the access it has today. */
  { key: 'dashboard', label: 'Dashboard' },
  { key: 'audit', label: 'Attendance / Audit' },
  { key: 'analytics', label: 'Analytics / Charts' },
  { key: 'dailymaster', label: 'Daily Master' },
  /* Master Reports (route /hr/reports) — same additive, backward-compatible
     pattern as the Phase 4.4 section keys: the internal key stays `reports`
     (existing saved permissions keep working), and every existing key/row is
     untouched. Displayed as "Master Reports" in the HR Admin navigation and in
     the SuperAdmin permission screens; "Daily Master" above stays a separate,
     unchanged module. */
  { key: 'reports', label: 'Master Reports' },
  { key: 'celebrations', label: 'Celebrations' },
  { key: 'marriage', label: 'Marriage Anniversary' },
  /* Pre-existing module/action sections (Phase 3) — unchanged. */
  { key: 'credentials', label: 'Employee Credential Management' },
  { key: 'holidays', label: 'Holiday Management' },
  { key: 'leave', label: 'Leave Management' },
  { key: 'salary', label: 'Salary Management' },
  { key: 'fullfinal', label: 'Full & Final Management' },
  { key: 'employees', label: 'Employee Management' },
  { key: 'email', label: 'Email Management' },
  { key: 'whatsapp', label: 'WhatsApp Messaging' },
];

/**
 * SuperAdmin-only modules. An HR Admin can never be granted these, so an HR
 * Admin can never manage HR Admin accounts or SuperAdmin accounts.
 */
export const SUPERADMIN_ONLY_MODULES = ['hradmins', 'superadmins'];

/** Every module key (including SuperAdmin-only) — SuperAdmin holds all of them. */
export const ALL_MODULES = MODULE_CATALOG.map((m) => m.key).concat(SUPERADMIN_ONLY_MODULES);

/** Action flags stored per (username, module). */
export const ACTION_KEYS = ['view', 'create', 'edit', 'delete', 'import', 'export', 'approve', 'email'];

/** Full permission set for every module (SuperAdmin / bootstrap HR account). */
export const fullPermissionMap = () => {
  const map = {};
  for (const key of ALL_MODULES) {
    map[key] = {};
    for (const action of ACTION_KEYS) map[key][action] = true;
  }
  return map;
};

/** Empty permission set (nothing allowed). */
export const emptyPermissionMap = () => {
  const map = {};
  for (const key of ALL_MODULES) {
    map[key] = {};
    for (const action of ACTION_KEYS) map[key][action] = false;
  }
  return map;
};

/** Newly created HR admins start with VIEW on the HR modules, nothing else. */
export const defaultHrPermissionMap = () => {
  const map = emptyPermissionMap();
  for (const m of MODULE_CATALOG) map[m.key].view = true;
  return map;
};

/** Is this module key valid for an HR Admin (i.e. not SuperAdmin-only)? */
export const isHrAssignableModule = (key) => MODULE_CATALOG.some((m) => m.key === key);

/* ------------------------- schema (auto-ensure) --------------------------- */
/* Same create-if-missing, cached-per-process convention as the other
   application-owned stores. No Savior table is ever created or altered. */
let tableState = null;

export async function ensureAdminAccessTables(pool) {
  if (tableState === true) return;
  if (typeof tableState === 'string') throw new Error(tableState);
  try {
    await pool.request().batch(`
IF OBJECT_ID('dbo.HR_AdminUser','U') IS NULL
CREATE TABLE dbo.HR_AdminUser (
  username VARCHAR(50) NOT NULL CONSTRAINT PK_HR_AdminUser PRIMARY KEY,
  passwordhash NVARCHAR(200) NULL,
  passwordsalt NVARCHAR(100) NULL,
  passwordalgo VARCHAR(20) NULL,
  displayname NVARCHAR(120) NULL,
  isactive BIT NOT NULL CONSTRAINT DF_HR_AdminUser_Active DEFAULT(1),
  isbootstrap BIT NOT NULL CONSTRAINT DF_HR_AdminUser_Boot DEFAULT(0),
  lastloginat DATETIME2 NULL,
  createdat DATETIME2 NOT NULL CONSTRAINT DF_HR_AdminUser_Created DEFAULT SYSUTCDATETIME(),
  updatedat DATETIME2 NOT NULL CONSTRAINT DF_HR_AdminUser_Updated DEFAULT SYSUTCDATETIME(),
  updatedby VARCHAR(50) NULL
);

IF OBJECT_ID('dbo.HR_AdminPermission','U') IS NULL
CREATE TABLE dbo.HR_AdminPermission (
  username VARCHAR(50) NOT NULL,
  module VARCHAR(30) NOT NULL,
  canview BIT NOT NULL CONSTRAINT DF_HR_AdminPerm_V DEFAULT(0),
  cancreate BIT NOT NULL CONSTRAINT DF_HR_AdminPerm_C DEFAULT(0),
  canedit BIT NOT NULL CONSTRAINT DF_HR_AdminPerm_E DEFAULT(0),
  candelete BIT NOT NULL CONSTRAINT DF_HR_AdminPerm_D DEFAULT(0),
  canimport BIT NOT NULL CONSTRAINT DF_HR_AdminPerm_I DEFAULT(0),
  canexport BIT NOT NULL CONSTRAINT DF_HR_AdminPerm_X DEFAULT(0),
  canapprove BIT NOT NULL CONSTRAINT DF_HR_AdminPerm_A DEFAULT(0),
  canemail BIT NOT NULL CONSTRAINT DF_HR_AdminPerm_M DEFAULT(0),
  updatedat DATETIME2 NOT NULL CONSTRAINT DF_HR_AdminPerm_Updated DEFAULT SYSUTCDATETIME(),
  updatedby VARCHAR(50) NULL,
  CONSTRAINT PK_HR_AdminPermission PRIMARY KEY (username, module)
);

IF OBJECT_ID('dbo.HR_SuperAdminUser','U') IS NULL
CREATE TABLE dbo.HR_SuperAdminUser (
  username VARCHAR(50) NOT NULL CONSTRAINT PK_HR_SuperAdminUser PRIMARY KEY,
  passwordhash NVARCHAR(200) NOT NULL,
  passwordsalt NVARCHAR(100) NOT NULL,
  passwordalgo VARCHAR(20) NOT NULL,
  displayname NVARCHAR(120) NULL,
  isactive BIT NOT NULL CONSTRAINT DF_HR_SuperAdmin_Active DEFAULT(1),
  isbootstrap BIT NOT NULL CONSTRAINT DF_HR_SuperAdmin_Boot DEFAULT(0),
  lastloginat DATETIME2 NULL,
  createdat DATETIME2 NOT NULL CONSTRAINT DF_HR_SuperAdmin_Created DEFAULT SYSUTCDATETIME(),
  updatedat DATETIME2 NOT NULL CONSTRAINT DF_HR_SuperAdmin_Updated DEFAULT SYSUTCDATETIME(),
  updatedby VARCHAR(50) NULL
);

/* Additive layout column (Prompt 3): which navigation surface a permitted
   module appears on for that HR Admin — 'primary' (bottom bar) or 'more'
   (... More menu). NULL keeps the historical behaviour (primary), so existing
   rows and screens are unaffected. This is LAYOUT ONLY and grants nothing. */
IF COL_LENGTH('dbo.HR_AdminPermission','placement') IS NULL
ALTER TABLE dbo.HR_AdminPermission ADD placement VARCHAR(10) NULL;

/* Additive visibility column (Phase 4.4): Visible / Hidden per section for one HR
   Admin. NULL keeps the historical behaviour (VISIBLE), so existing rows and accounts
   are completely unaffected. A section set to Hidden is removed from BOTH navigation
   surfaces AND denied by the server (see moduleAllowed). App-owned table only. */
IF COL_LENGTH('dbo.HR_AdminPermission','visible') IS NULL
ALTER TABLE dbo.HR_AdminPermission ADD visible BIT NULL;

/* Company scope (Prompt 4): which company codes an HR Admin may see.
   App-owned table; company codes come from the REAL dbo.tblemployee.companycode
   values. The Savior schema is never altered. A table-based HR Admin with NO
   rows here is DENIED company-scoped data (fail closed) — never unrestricted. */
IF OBJECT_ID('dbo.HR_AdminCompany','U') IS NULL
CREATE TABLE dbo.HR_AdminCompany (
  username VARCHAR(50) NOT NULL,
  companycode VARCHAR(10) NOT NULL,
  createdat DATETIME2 NOT NULL CONSTRAINT DF_HR_AdminCompany_Created DEFAULT SYSUTCDATETIME(),
  createdby VARCHAR(50) NULL,
  CONSTRAINT PK_HR_AdminCompany PRIMARY KEY (username, companycode)
);`);
    tableState = true;
  } catch (error) {
    tableState = 'Admin access store unavailable. Detail: ' + String(error?.message || error).slice(0, 140);
    throw new Error(tableState);
  }
}

const ACTION_COLUMN = {
  view: 'canview', create: 'cancreate', edit: 'canedit', delete: 'candelete',
  import: 'canimport', export: 'canexport', approve: 'canapprove', email: 'canemail',
};

/* ---------------------------- permissions -------------------------------- */

/** Reads the stored permission rows for one HR Admin. Returns {} when none. */
export async function readStoredPermissions(pool, username) {
  const result = await pool.request()
    .input('username', sql.VarChar(50), username)
    .query('SELECT module, canview, cancreate, canedit, candelete, canimport, canexport, canapprove, canemail, placement, visible FROM dbo.HR_AdminPermission WHERE username = @username');
  const map = {};
  for (const row of result.recordset) {
    map[String(row.module)] = {
      view: row.canview === true, create: row.cancreate === true, edit: row.canedit === true,
      delete: row.candelete === true, import: row.canimport === true, export: row.canexport === true,
      approve: row.canapprove === true, email: row.canemail === true,
      placement: row.placement || null,
      // Phase 4.4 — tri-state: null = historical default (VISIBLE).
      visible: row.visible === null || row.visible === undefined ? null : row.visible === true,
    };
  }
  return map;
}

/**
 * Effective permissions for an HR Admin.
 *   - explicit stored rows win;
 *   - otherwise the .env bootstrap HR account keeps FULL access, so an empty
 *     permission store can never lock the HR portal out;
 *   - otherwise a table account with no rows yet gets the safe default.
 */
export async function getEffectivePermissions(pool, username) {
  /* The .env bootstrap HR account ALWAYS keeps full access. It is the recovery
     path, so no stored row (or bad edit) can ever lock the HR portal out. */
  if (username && username === process.env.HR_USERNAME) return fullPermissionMap();
  const stored = await readStoredPermissions(pool, username);
  if (Object.keys(stored).length > 0) {
    const map = emptyPermissionMap();
    for (const [module, actions] of Object.entries(stored)) {
      if (!map[module]) map[module] = {};
      map[module] = { ...(map[module] || {}), ...actions };
    }
    return map;
  }
  return defaultHrPermissionMap();
}

/** One-shot check used by the request middleware (reads LIVE from the store). */
export async function hasPermission(pool, username, module, action = 'view') {
  if (!module) return true;
  const perms = await getEffectivePermissions(pool, username);
  return perms[module] ? perms[module][action] === true : false;
}

/**
 * Phase 4.4.1/4.4.2 — gate used by the HR module rules.
 *
 * `legacyAllow`: a section with NO stored row for this account is treated as the
 * historical default (ALLOWED) instead of denied, so the six navigation sections added
 * in 4.4 never lock an existing account out.
 *
 * Visible / Hidden is deliberately NOT enforced here. Hidden is a NAVIGATION control
 * (HRNavigator / HRMoreScreen read `isVisible`), while VIEW is the data gate — exactly
 * as configured in the SuperAdmin console legend. Enforcing Hidden as a data denial
 * produced a real, reproducible defect: an account with `employees.view = true` AND
 * `employees.visible = false` (hidden tab, view still granted) was refused the data and
 * told "not permitted to view the employees module", which broke the HR dashboard even
 * though the View permission was granted.
 */
export async function moduleAllowed(pool, username, module, action = 'view', legacyAllow = false) {
  if (!module) return true;
  /* Bootstrap HR account always keeps full access (recovery path). */
  if (isBootstrapHr(username)) return true;
  /* Read the RAW stored rows (not the filled-in effective map) so a section with
     NO explicit row is distinguishable from a section with an explicit row.
     `legacy: true` sections (dashboard / audit / analytics / dailymaster / reports /
     celebrations / marriage) keep the historical ALLOW when no row exists; the
     pre-existing module rules keep their strict deny behaviour. A brand-new account
     with zero rows keeps the safe default (VIEW allowed). */
  const stored = await readStoredPermissions(pool, username);
  const mod = stored[module];
  if (!mod) {
    if (Object.keys(stored).length === 0) return action === 'view';
    return legacyAllow === true;
  }
  return mod[action] === true;
}

/** Shared password policy for admin accounts. */
export const validateAdminPassword = (password) => {
  const value = String(password || '');
  if (value.length < 8) return 'Password must be at least 8 characters long.';
  if (!/[A-Za-z]/.test(value) || !/[0-9]/.test(value)) return 'Password must contain both letters and numbers.';
  return null;
};

/** The .env bootstrap rows are permanent and can never be removed or disabled. */
export const isBootstrapHr = (username) => !!username && username === process.env.HR_USERNAME;
export const isBootstrapSuperAdmin = (username) => !!username && username === process.env.SUPERADMIN_USERNAME;

/* --------------------------- HR Admin accounts ---------------------------- */

/** All HR Admin accounts, newest first, including the env bootstrap account. */
export async function listHrAdmins(pool) {
  const result = await pool.request().query(
    "SELECT username, LTRIM(RTRIM(ISNULL(displayname, ''))) AS displayname, isactive, isbootstrap, lastloginat, createdat FROM dbo.HR_AdminUser ORDER BY createdat DESC",
  );
  return result.recordset.map((row) => ({
    username: String(row.username),
    displayname: row.displayname || '',
    isactive: row.isactive === true,
    isbootstrap: row.isbootstrap === true || isBootstrapHr(row.username),
    lastloginat: row.lastloginat || null,
    createdat: row.createdat || null,
  }));
}

/** Verifies a table-based HR Admin account (additive to the .env account). */
export async function verifyHrAdminAccount(pool, username, password) {
  const result = await pool.request()
    .input('username', sql.VarChar(50), username)
    .query('SELECT TOP 1 username, passwordhash, passwordsalt, passwordalgo, isactive FROM dbo.HR_AdminUser WHERE username = @username');
  const row = result.recordset[0];
  if (!row) return { ok: false, status: 401, message: 'Invalid HR credentials.' };
  if (row.isactive !== true) return { ok: false, status: 403, message: 'This HR Admin account is disabled.' };
  const valid = await verifySecret(password, row.passwordhash, row.passwordsalt, row.passwordalgo);
  if (!valid) return { ok: false, status: 401, message: 'Invalid HR credentials.' };
  await pool.request().input('username', sql.VarChar(50), username)
    .query('UPDATE dbo.HR_AdminUser SET lastloginat = SYSUTCDATETIME() WHERE username = @username');
  return { ok: true, status: 200, username: String(row.username) };
}

/** Replaces ALL permission rows for one HR Admin. SuperAdmin-only modules are ignored. */
export async function savePermissions(pool, username, permissions, updatedBy) {
  if (isBootstrapHr(username)) {
    return { ok: false, status: 400, message: 'The bootstrap HR account always keeps full permissions.' };
  }
  const rows = [];
  for (const [module, actions] of Object.entries(permissions || {})) {
    if (!isHrAssignableModule(module)) continue; // never store HR/SuperAdmin admin modules
    rows.push({ module, actions: actions || {} });
  }
  const tx = pool.transaction();
  await tx.begin();
  try {
    await tx.request().input('username', sql.VarChar(50), username)
      .query('DELETE FROM dbo.HR_AdminPermission WHERE username = @username');
    for (const { module, actions } of rows) {
      const req = tx.request()
        .input('username', sql.VarChar(50), username)
        .input('module', sql.VarChar(30), module)
        .input('by', sql.VarChar(50), updatedBy || null);
      // Layout only ('primary' | 'more'). NULL is stored when unset so an
      // existing row keeps the safe historical default (primary tab).
      const placement = actions.placement === 'more'
        ? 'more'
        : (actions.placement === 'primary' ? 'primary' : null);
      if (placement) req.input('placement', sql.VarChar(10), placement);
      let columns = 'username, module, updatedby';
      let values = '@username, @module, @by';
      if (placement) { columns += ', placement'; values += ', @placement'; }
      // Visible / Hidden (Phase 4.4). Tri-state: `undefined` writes NULL, which keeps
      // the historical behaviour (VISIBLE). An explicit value is stored so Hidden can
      // also block the data server-side (moduleAllowed), not just the tab.
      const visibleValue = actions.visible === true ? 1 : (actions.visible === false ? 0 : null);
      if (visibleValue !== null) {
        req.input('visible', sql.Bit, visibleValue);
        columns += ', visible';
        values += ', @visible';
      }
      for (const action of ACTION_KEYS) {
        req.input(action, sql.Bit, actions[action] === true ? 1 : 0);
        columns += `, ${ACTION_COLUMN[action]}`;
        values += `, @${action}`;
      }
      await req.query(`INSERT INTO dbo.HR_AdminPermission (${columns}) VALUES (${values})`);
    }
    await tx.commit();
  } catch (error) {
    await tx.rollback();
    throw error;
  }
}

/** Creates an HR Admin account seeded with the safe default (view) permissions. */
export async function createHrAdmin(pool, { username, password, displayname, companies }, by) {
  const name = String(username || '').trim();
  if (!name) return { ok: false, status: 400, message: 'Username is required.' };
  if (name.toUpperCase() === String(process.env.HR_USERNAME || '').toUpperCase()) {
    return { ok: false, status: 409, message: 'That username is reserved for the bootstrap HR account.' };
  }
  const weak = validateAdminPassword(password);
  if (weak) return { ok: false, status: 400, message: weak };
  const existing = await pool.request().input('username', sql.VarChar(50), name)
    .query('SELECT TOP 1 username FROM dbo.HR_AdminUser WHERE username = @username');
  if (existing.recordset[0]) return { ok: false, status: 409, message: 'An HR Admin with that username already exists.' };
  const { hash, salt, algo } = await hashSecret(password);
  await pool.request()
    .input('username', sql.VarChar(50), name)
    .input('hash', sql.NVarChar(200), hash)
    .input('salt', sql.NVarChar(100), salt)
    .input('algo', sql.VarChar(20), algo)
    .input('displayname', sql.NVarChar(120), String(displayname || '').trim() || null)
    .input('by', sql.VarChar(50), by || null)
    .query(`INSERT INTO dbo.HR_AdminUser (username, passwordhash, passwordsalt, passwordalgo, displayname, isactive, isbootstrap, updatedby)
            VALUES (@username, @hash, @salt, @algo, @displayname, 1, 0, @by)`);
  await savePermissions(pool, name, defaultHrPermissionMap(), by);
  /* Phase 4.4 — optional company assignment at creation time. Validated against the
     REAL company catalogue by setCompanyScope (unknown codes are rejected). If the
     assignment cannot be saved the account is rolled back, so a half-created account
     with no scope can never be left behind, and the caller is told explicitly. */
  let assigned = [];
  if (companies !== undefined) {
    const scopeOutcome = await setCompanyScope(pool, name, companies, by);
    if (!scopeOutcome.ok) {
      await pool.request().input('username', sql.VarChar(50), name)
        .query('DELETE FROM dbo.HR_AdminPermission WHERE username = @username');
      await pool.request().input('username', sql.VarChar(50), name)
        .query('DELETE FROM dbo.HR_AdminUser WHERE username = @username');
      return { ok: false, status: scopeOutcome.status, message: scopeOutcome.message };
    }
    assigned = scopeOutcome.companies;
  }
  return { ok: true, status: 201, username: name, companies: assigned };
}

/** Enables / disables a table-based HR Admin account. */
export async function setHrAdminActive(pool, username, active, by) {
  const name = String(username || '').trim();
  if (isBootstrapHr(name)) return { ok: false, status: 400, message: 'The bootstrap HR account is always enabled.' };
  const result = await pool.request()
    .input('username', sql.VarChar(50), name)
    .input('active', sql.Bit, active === true ? 1 : 0)
    .input('by', sql.VarChar(50), by || null)
    .query('UPDATE dbo.HR_AdminUser SET isactive = @active, updatedat = SYSUTCDATETIME(), updatedby = @by WHERE username = @username');
  if (result.rowsAffected[0] === 0) return { ok: false, status: 404, message: 'HR Admin not found.' };
  return { ok: true, status: 200, username: name, isactive: active === true };
}

/** Resets a table-based HR Admin password. */
export async function setHrAdminPassword(pool, username, password, by) {
  const name = String(username || '').trim();
  if (isBootstrapHr(name)) return { ok: false, status: 400, message: 'The bootstrap HR password is managed through the server environment.' };
  const weak = validateAdminPassword(password);
  if (weak) return { ok: false, status: 400, message: weak };
  const { hash, salt, algo } = await hashSecret(password);
  const result = await pool.request()
    .input('username', sql.VarChar(50), name)
    .input('hash', sql.NVarChar(200), hash)
    .input('salt', sql.NVarChar(100), salt)
    .input('algo', sql.VarChar(20), algo)
    .input('by', sql.VarChar(50), by || null)
    .query('UPDATE dbo.HR_AdminUser SET passwordhash = @hash, passwordsalt = @salt, passwordalgo = @algo, updatedat = SYSUTCDATETIME(), updatedby = @by WHERE username = @username');
  if (result.rowsAffected[0] === 0) return { ok: false, status: 404, message: 'HR Admin not found.' };
  return { ok: true, status: 200, username: name };
}

/** Deletes a table-based HR Admin account (and its permission rows). */
export async function deleteHrAdmin(pool, username) {
  const name = String(username || '').trim();
  if (isBootstrapHr(name)) return { ok: false, status: 400, message: 'The bootstrap HR account cannot be deleted.' };
  const result = await pool.request().input('username', sql.VarChar(50), name)
    .query('DELETE FROM dbo.HR_AdminUser WHERE username = @username');
  if (result.rowsAffected[0] === 0) return { ok: false, status: 404, message: 'HR Admin not found.' };
  await pool.request().input('username', sql.VarChar(50), name)
    .query('DELETE FROM dbo.HR_AdminPermission WHERE username = @username');
  /* Phase 4.4 — also remove the company assignments, so deleting an account can never
     leave orphaned scope rows behind for a future account with the same username. */
  await pool.request().input('username', sql.VarChar(50), name)
    .query('DELETE FROM dbo.HR_AdminCompany WHERE username = @username');
  return { ok: true, status: 200, username: name };
}

/* ------------------------- SuperAdmin accounts ---------------------------- */

/** Active SuperAdmin count: the .env bootstrap always counts as one. */
export async function countActiveSuperAdmins(pool) {
  const result = await pool.request().query('SELECT COUNT(*) AS total FROM dbo.HR_SuperAdminUser WHERE isactive = 1');
  const tableActive = Number(result.recordset[0]?.total || 0);
  return tableActive + (process.env.SUPERADMIN_USERNAME && process.env.SUPERADMIN_PASSWORD_HASH ? 1 : 0);
}

/** All SuperAdmin accounts, including a synthesised row for the env bootstrap. */
export async function listSuperAdmins(pool) {
  const result = await pool.request().query(
    "SELECT username, LTRIM(RTRIM(ISNULL(displayname, ''))) AS displayname, isactive, isbootstrap, lastloginat, createdat FROM dbo.HR_SuperAdminUser ORDER BY createdat DESC",
  );
  const rows = result.recordset.map((row) => ({
    username: String(row.username),
    displayname: row.displayname || '',
    isactive: row.isactive === true,
    isbootstrap: row.isbootstrap === true || isBootstrapSuperAdmin(row.username),
    lastloginat: row.lastloginat || null,
    createdat: row.createdat || null,
    source: 'table',
  }));
  const envUser = String(process.env.SUPERADMIN_USERNAME || '').trim();
  if (envUser && !rows.some((r) => r.username === envUser)) {
    rows.unshift({
      username: envUser,
      displayname: 'Bootstrap (server environment)',
      isactive: true,
      isbootstrap: true,
      lastloginat: null,
      createdat: null,
      source: 'env',
    });
  }
  return rows;
}

/** Verifies a table-based SuperAdmin account (additive; the env account runs first). */
export async function verifySuperAdminAccount(pool, username, password) {
  const result = await pool.request()
    .input('username', sql.VarChar(50), username)
    .query('SELECT TOP 1 username, passwordhash, passwordsalt, passwordalgo, isactive FROM dbo.HR_SuperAdminUser WHERE username = @username');
  const row = result.recordset[0];
  if (!row) return { ok: false, status: 401, message: 'Invalid SuperAdmin credentials.' };
  if (row.isactive !== true) return { ok: false, status: 403, message: 'This SuperAdmin account is disabled.' };
  const valid = await verifySecret(password, row.passwordhash, row.passwordsalt, row.passwordalgo);
  if (!valid) return { ok: false, status: 401, message: 'Invalid SuperAdmin credentials.' };
  await pool.request().input('username', sql.VarChar(50), username)
    .query('UPDATE dbo.HR_SuperAdminUser SET lastloginat = SYSUTCDATETIME() WHERE username = @username');
  return { ok: true, status: 200, username: String(row.username) };
}

export async function createSuperAdmin(pool, { username, password, displayname }, by) {
  const name = String(username || '').trim();
  if (!name) return { ok: false, status: 400, message: 'Username is required.' };
  if (name.toUpperCase() === String(process.env.SUPERADMIN_USERNAME || '').toUpperCase()) {
    return { ok: false, status: 409, message: 'That username is reserved for the bootstrap SuperAdmin.' };
  }
  const weak = validateAdminPassword(password);
  if (weak) return { ok: false, status: 400, message: weak };
  const existing = await pool.request().input('username', sql.VarChar(50), name)
    .query('SELECT TOP 1 username FROM dbo.HR_SuperAdminUser WHERE username = @username');
  if (existing.recordset[0]) return { ok: false, status: 409, message: 'A SuperAdmin with that username already exists.' };
  const { hash, salt, algo } = await hashSecret(password);
  await pool.request()
    .input('username', sql.VarChar(50), name)
    .input('hash', sql.NVarChar(200), hash)
    .input('salt', sql.NVarChar(100), salt)
    .input('algo', sql.VarChar(20), algo)
    .input('displayname', sql.NVarChar(120), String(displayname || '').trim() || null)
    .input('by', sql.VarChar(50), by || null)
    .query(`INSERT INTO dbo.HR_SuperAdminUser (username, passwordhash, passwordsalt, passwordalgo, displayname, isactive, isbootstrap, updatedby)
            VALUES (@username, @hash, @salt, @algo, @displayname, 1, 0, @by)`);
  return { ok: true, status: 201, username: name };
}

/** Enables / disables a table-based SuperAdmin. Never removes the last active one. */
export async function setSuperAdminActive(pool, username, active, by) {
  const name = String(username || '').trim();
  if (isBootstrapSuperAdmin(name)) return { ok: false, status: 400, message: 'The bootstrap SuperAdmin is always enabled.' };
  const current = await pool.request().input('username', sql.VarChar(50), name)
    .query('SELECT TOP 1 isactive FROM dbo.HR_SuperAdminUser WHERE username = @username');
  if (!current.recordset[0]) return { ok: false, status: 404, message: 'SuperAdmin not found.' };
  if (active !== true && current.recordset[0].isactive === true) {
    const remaining = await countActiveSuperAdmins(pool);
    if (remaining - 1 < 1) return { ok: false, status: 400, message: 'At least one active SuperAdmin must remain.' };
  }
  await pool.request()
    .input('username', sql.VarChar(50), name)
    .input('active', sql.Bit, active === true ? 1 : 0)
    .input('by', sql.VarChar(50), by || null)
    .query('UPDATE dbo.HR_SuperAdminUser SET isactive = @active, updatedat = SYSUTCDATETIME(), updatedby = @by WHERE username = @username');
  return { ok: true, status: 200, username: name, isactive: active === true };
}

export async function setSuperAdminPassword(pool, username, password, by) {
  const name = String(username || '').trim();
  if (isBootstrapSuperAdmin(name)) return { ok: false, status: 400, message: 'The bootstrap SuperAdmin password is managed through the server environment.' };
  const weak = validateAdminPassword(password);
  if (weak) return { ok: false, status: 400, message: weak };
  const { hash, salt, algo } = await hashSecret(password);
  const result = await pool.request()
    .input('username', sql.VarChar(50), name)
    .input('hash', sql.NVarChar(200), hash)
    .input('salt', sql.NVarChar(100), salt)
    .input('algo', sql.VarChar(20), algo)
    .input('by', sql.VarChar(50), by || null)
    .query('UPDATE dbo.HR_SuperAdminUser SET passwordhash = @hash, passwordsalt = @salt, passwordalgo = @algo, updatedat = SYSUTCDATETIME(), updatedby = @by WHERE username = @username');
  if (result.rowsAffected[0] === 0) return { ok: false, status: 404, message: 'SuperAdmin not found.' };
  return { ok: true, status: 200, username: name };
}

/** Deletes a table-based SuperAdmin. The last active SuperAdmin can never be removed. */
export async function deleteSuperAdmin(pool, username) {
  const name = String(username || '').trim();
  if (isBootstrapSuperAdmin(name)) return { ok: false, status: 400, message: 'The bootstrap SuperAdmin cannot be deleted.' };
  const current = await pool.request().input('username', sql.VarChar(50), name)
    .query('SELECT TOP 1 isactive FROM dbo.HR_SuperAdminUser WHERE username = @username');
  if (!current.recordset[0]) return { ok: false, status: 404, message: 'SuperAdmin not found.' };
  if (current.recordset[0].isactive === true) {
    const remaining = await countActiveSuperAdmins(pool);
    if (remaining - 1 < 1) return { ok: false, status: 400, message: 'At least one active SuperAdmin must remain.' };
  }
  await pool.request().input('username', sql.VarChar(50), name)
    .query('DELETE FROM dbo.HR_SuperAdminUser WHERE username = @username');
  return { ok: true, status: 200, username: name };
}

/* ------------------------ company scope (Prompt 4) ------------------------ */

/** The .env bootstrap HR account is unrestricted (recovery path, never locked). */
export const scopeIsUnrestricted = (username) => isBootstrapHr(username);

/** Real company codes from the authoritative Savior employee master (no fake data). */
export async function listCompanyCodes(pool) {
  const result = await pool.request().query(
    "SELECT DISTINCT LTRIM(RTRIM(companycode)) AS companycode FROM dbo.tblemployee WHERE companycode IS NOT NULL AND LTRIM(RTRIM(companycode)) <> ''",
  );
  return result.recordset.map((r) => String(r.companycode)).sort();
}

/**
 * The company codes assigned to one HR Admin.
 * Returns `null` for the unrestricted bootstrap account, otherwise the assigned
 * list — an EMPTY array means "deny", never "allow everything".
 */
export async function getCompanyScope(pool, username) {
  if (scopeIsUnrestricted(username)) return null;
  const result = await pool.request()
    .input('username', sql.VarChar(50), username)
    .query('SELECT companycode FROM dbo.HR_AdminCompany WHERE username = @username');
  return result.recordset.map((r) => String(r.companycode).trim());
}

/** Replaces the assigned company codes for one HR Admin (SuperAdmin-only caller). */
export async function setCompanyScope(pool, username, codes, by) {
  if (isBootstrapHr(username)) {
    return { ok: false, status: 400, message: 'The bootstrap HR account always has access to every company.' };
  }
  const valid = await listCompanyCodes(pool);
  const wantedRaw = Array.from(new Set((Array.isArray(codes) ? codes : []).map((c) => String(c || '').trim()).filter(Boolean)));
  const canonical = [];
  const invalid = [];
  for (const w of wantedRaw) {
    const hit = valid.find((v) => v.toLowerCase() === w.toLowerCase());
    if (hit) canonical.push(hit); else invalid.push(w);
  }
  if (invalid.length) return { ok: false, status: 400, message: 'Unknown company code(s): ' + invalid.join(', ') };
  const tx = pool.transaction();
  await tx.begin();
  try {
    await tx.request().input('username', sql.VarChar(50), username)
      .query('DELETE FROM dbo.HR_AdminCompany WHERE username = @username');
    for (const code of canonical) {
      await tx.request()
        .input('username', sql.VarChar(50), username)
        .input('code', sql.VarChar(10), code)
        .input('by', sql.VarChar(50), by || null)
        .query('INSERT INTO dbo.HR_AdminCompany (username, companycode, createdby) VALUES (@username, @code, @by)');
    }
    await tx.commit();
  } catch (error) { await tx.rollback(); throw error; }
  return { ok: true, status: 200, username, companies: canonical };
}

/** Authoritative company of one employee. `null` when it cannot be determined. */
export async function employeeCompany(pool, paycode) {
  const code = String(paycode || '').trim();
  if (!code) return null;
  const result = await pool.request()
    .input('paycode', sql.VarChar(50), code)
    .query('SELECT TOP 1 LTRIM(RTRIM(companycode)) AS companycode FROM dbo.tblemployee WHERE LTRIM(RTRIM(paycode)) = @paycode');
  const row = result.recordset[0];
  return row && row.companycode ? String(row.companycode).trim() : null;
}

/** True when a company code is inside the resolved scope (null = unrestricted). */
export const companyInScope = (scope, code) => {
  if (scope === null) return true;
  if (!Array.isArray(scope) || scope.length === 0) return false;
  return scope.includes(String(code || '').trim());
};

export default {
  ensureAdminAccessTables, MODULE_CATALOG, SUPERADMIN_ONLY_MODULES, ALL_MODULES, ACTION_KEYS,
  getEffectivePermissions, savePermissions, hasPermission, moduleAllowed, fullPermissionMap, emptyPermissionMap,
  listCompanyCodes, getCompanyScope, setCompanyScope, employeeCompany, companyInScope,
};


