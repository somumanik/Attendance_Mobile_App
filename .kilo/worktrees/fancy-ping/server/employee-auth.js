/* ============================================================================
   EMPLOYEE AUTHENTICATION FOUNDATION — isolated module
   ----------------------------------------------------------------------------
   WHY THIS FILE EXISTS (protection rule):
   Employee credentials must NEVER live in Savior attendance tables. This module
   owns 100% of the employee credential concern so future work (PIN, forgot
   password, HR reset) can never touch dbo.tblemployee or any attendance query.

   It provides:
     - application-owned credential storage  (dbo.HR_EmployeeAuth)
     - password hashing / verification     (node:crypto scrypt, no new package)
     - the single employee login verifier  used by server/index.js
     - first-time / HR reset primitives    (not exposed over HTTP yet)

   EMPLOYEE IDENTITY: dbo.tblemployee.paycode  (unchanged, read-only)
   ATTENDANCE DATA  : untouched — this module never queries attendance tables.
   ========================================================================== */

import crypto from 'node:crypto';
import util from 'node:util';
import { sql } from './db.js';

/* Application-owned table. It is NOT a Savior table and no Savior table is
   ever created, altered or dropped from here. Overridable for deployments that
   keep application tables in a separate schema. */
export const EMPLOYEE_AUTH_TABLE = process.env.HR_EMPLOYEE_AUTH_TABLE || 'dbo.HR_EmployeeAuth';

/* ------------------------------ hashing ---------------------------------- */
/* scrypt is memory-hard and ships with Node itself, so no new dependency and
   no custom crypto is introduced. Parameters are stored with the hash so a
   future parameter bump stays backwards compatible. */
const SCRYPT = { N: 16384, r: 8, p: 1, maxmem: 64 * 1024 * 1024 };
const KEY_LENGTH = 64;
const SALT_BYTES = 16;
const ALGO = 'scrypt-v1';
const scryptAsync = util.promisify(crypto.scrypt);

/* Brute-force protection. Deliberately simple: a short lockout, no framework. */
const MAX_FAILED_ATTEMPTS = 10;
const LOCK_MINUTES = 15;

let tableState = null; // null = unknown, true = ready, string = error message

async function deriveKey(secret, salt) {
  const derived = await scryptAsync(String(secret), String(salt), KEY_LENGTH, SCRYPT);
  return derived.toString('hex');
}

/**
 * Hashes a secret (password today, PIN later) with a fresh random salt.
 * Plaintext is never stored and never returned to any client.
 */
export async function hashSecret(secret) {
  const salt = crypto.randomBytes(SALT_BYTES).toString('hex');
  return { hash: await deriveKey(secret, salt), salt, algo: ALGO };
}

/**
 * Constant-time verification of a secret against a stored hash.
 * Unknown/legacy algorithms fail closed instead of throwing.
 */
export async function verifySecret(secret, hash, salt, algo) {
  if (!hash || !salt) return false;
  if (algo && String(algo) !== ALGO) return false;
  const candidate = await deriveKey(secret, salt);
  const a = Buffer.from(candidate, 'hex');
  const b = Buffer.from(String(hash), 'hex');
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}

/** Password policy for the upcoming first-time-setup / HR-reset phases. */
export function validatePasswordStrength(password) {
  const value = String(password || '');
  if (value.length < 8) return 'Password must be at least 8 characters long.';
  if (!/[A-Za-z]/.test(value) || !/[0-9]/.test(value)) {
    return 'Password must contain both letters and numbers.';
  }
  return null;
}

/* ------------------------------ PIN policy -------------------------------- */
/* Format is fixed by the project: exactly 4 numeric digits. Nothing else. */
const PIN_LENGTH = 4;
const PIN_MAX_ATTEMPTS = 5;
const PIN_LOCK_MINUTES = 15;

/** Validates the 4-digit PIN format. Returns an error string, or null when valid. */
export function validatePinFormat(pin) {
  const value = String(pin == null ? '' : pin);
  if (!value) return 'PIN is required.';
  if (!/^\d+$/.test(value)) return 'PIN must contain digits only.';
  if (value.length !== PIN_LENGTH) return `PIN must be exactly ${PIN_LENGTH} digits.`;
  return null;
}

/* ------------------------- schema (auto-ensure) --------------------------- */
/* Mirrors the existing ensureEmailTables() pattern in server/index.js:
   create-if-missing, cached per process, never touches a Savior table. */
export async function ensureEmployeeAuthTables(pool) {
  if (tableState === true) return;
  if (typeof tableState === 'string') throw new Error(tableState);
  try {
    await pool.request().batch(`
IF OBJECT_ID('${EMPLOYEE_AUTH_TABLE}','U') IS NULL
CREATE TABLE ${EMPLOYEE_AUTH_TABLE} (
  paycode VARCHAR(50) NOT NULL CONSTRAINT UQ_HREmpAuth_Paycode UNIQUE,
  passwordhash NVARCHAR(200) NULL,
  passwordsalt NVARCHAR(100) NULL,
  passwordalgo VARCHAR(20) NULL,
  passwordsetat DATETIME2 NULL,
  passwordupdatedat DATETIME2 NULL,
  mustchangepassword BIT NOT NULL CONSTRAINT DF_HREmpAuth_MustChange DEFAULT(0),
  isactive BIT NOT NULL CONSTRAINT DF_HREmpAuth_IsActive DEFAULT(1),
  failedattempts INT NOT NULL CONSTRAINT DF_HREmpAuth_Failed DEFAULT(0),
  lockeduntil DATETIME2 NULL,
  lastloginat DATETIME2 NULL,
  pwdversion INT NOT NULL CONSTRAINT DF_HREmpAuth_PwdVer DEFAULT(1),
  pinhash NVARCHAR(200) NULL,
  pinsalt NVARCHAR(100) NULL,
  pinalgo VARCHAR(20) NULL,
  pinsetat DATETIME2 NULL,
  pinupdatedat DATETIME2 NULL,
  createdat DATETIME2 NOT NULL CONSTRAINT DF_HREmpAuth_Created DEFAULT SYSUTCDATETIME(),
  updatedat DATETIME2 NOT NULL CONSTRAINT DF_HREmpAuth_Updated DEFAULT SYSUTCDATETIME(),
  createdby VARCHAR(50) NULL,
  updatedby VARCHAR(50) NULL
);`);
    tableState = true;
  } catch (error) {
    tableState = 'Employee credential store unavailable. Detail: '
      + String(error?.message || error).slice(0, 140);
    throw new Error(tableState);
  }
}

/* ------------------------------ data access ------------------------------ */

/** Identity lookup only. Same Savior columns the login response always sent. */
export async function findEmployeeByPaycode(pool, paycode) {
  const result = await pool.request()
    .input('paycode', sql.VarChar(50), paycode)
    .query('SELECT TOP 1 LTRIM(RTRIM(paycode)) AS paycode, empname, presentcardno, companycode, active FROM dbo.tblemployee WHERE LTRIM(RTRIM(paycode)) = @paycode');
  return result.recordset[0] || null;
}

/** Reads the application-owned credential row (hashes never leave the server). */
export async function getEmployeeCredential(pool, paycode) {
  const result = await pool.request()
    .input('paycode', sql.VarChar(50), paycode)
    .query(`SELECT TOP 1 paycode, passwordhash, passwordsalt, passwordalgo, mustchangepassword, isactive, failedattempts, lockeduntil, pwdversion, pinhash FROM ${EMPLOYEE_AUTH_TABLE} WHERE paycode = @paycode`);
  return result.recordset[0] || null;
}

/**
 * Creates or replaces the stored password for a real Savior paycode.
 * Used by the upcoming first-time-setup and HR-reset phases; intentionally not
 * exposed over HTTP yet, so no caller can set a password in this phase.
 */
export async function setEmployeePassword(pool, paycode, password, options = {}) {
  const strengthError = validatePasswordStrength(password);
  if (strengthError) throw new Error(strengthError);
  await ensureEmployeeAuthTables(pool);
  const { hash, salt, algo } = await hashSecret(password);
  const mustChange = options.mustChange === true ? 1 : 0;
  const updatedBy = String(options.updatedBy || 'system').slice(0, 50);
  await pool.request()
    .input('paycode', sql.VarChar(50), paycode)
    .input('passwordhash', sql.NVarChar(200), hash)
    .input('passwordsalt', sql.NVarChar(100), salt)
    .input('passwordalgo', sql.VarChar(20), algo)
    .input('mustchangepassword', sql.Bit, mustChange)
    .input('updatedby', sql.VarChar(50), updatedBy)
    .query(`
MERGE ${EMPLOYEE_AUTH_TABLE} AS target
USING (SELECT @paycode AS paycode) AS source ON target.paycode = source.paycode
WHEN MATCHED THEN UPDATE SET
  passwordhash = @passwordhash, passwordsalt = @passwordsalt, passwordalgo = @passwordalgo,
  passwordsetat = SYSUTCDATETIME(), passwordupdatedat = SYSUTCDATETIME(),
  mustchangepassword = @mustchangepassword, failedattempts = 0, lockeduntil = NULL,
  pwdversion = ISNULL(target.pwdversion, 0) + 1, updatedat = SYSUTCDATETIME(), updatedby = @updatedby
WHEN NOT MATCHED THEN INSERT (paycode, passwordhash, passwordsalt, passwordalgo, passwordsetat,
  passwordupdatedat, mustchangepassword, isactive, failedattempts, pwdversion, createdby, updatedby)
  VALUES (@paycode, @passwordhash, @passwordsalt, @passwordalgo, SYSUTCDATETIME(), SYSUTCDATETIME(),
    @mustchangepassword, 1, 0, 1, @updatedby, @updatedby);`);
  return true;
}

/* ------------------------------- verifying ------------------------------- */

async function registerFailedAttempt(pool, paycode) {
  try {
    await pool.request()
      .input('paycode', sql.VarChar(50), paycode)
      .query(`UPDATE ${EMPLOYEE_AUTH_TABLE}
SET failedattempts = ISNULL(failedattempts, 0) + 1,
    lockeduntil = CASE WHEN ISNULL(failedattempts, 0) + 1 >= ${MAX_FAILED_ATTEMPTS}
      THEN DATEADD(MINUTE, ${LOCK_MINUTES}, SYSUTCDATETIME()) ELSE lockeduntil END,
    updatedat = SYSUTCDATETIME()
WHERE paycode = @paycode`);
  } catch (_error) {
    /* A failure counter that cannot be written must never block a login decision. */
  }
}

async function registerSuccessfulLogin(pool, paycode) {
  try {
    await pool.request()
      .input('paycode', sql.VarChar(50), paycode)
      .query(`UPDATE ${EMPLOYEE_AUTH_TABLE}
SET failedattempts = 0, lockeduntil = NULL, lastloginat = SYSUTCDATETIME(), updatedat = SYSUTCDATETIME()
WHERE paycode = @paycode`);
  } catch (_error) {
    /* Non-critical bookkeeping only. */
  }
}

/**
 * The single real employee login decision.
 *
 * Returns { ok: true, employee } on success, otherwise
 * { ok: false, status, message } ready to be sent to the client.
 * No password, hash or salt is ever included in the return value.
 */
export async function verifyEmployeeLogin(pool, paycode, password) {
  await ensureEmployeeAuthTables(pool);

  const employee = await findEmployeeByPaycode(pool, paycode);
  if (!employee) {
    return { ok: false, status: 401, message: 'Employee not found.' };
  }

  // Savior identity must be active. NULL is treated as active for safety.
  if (String(employee.active || 'Y').trim().toUpperCase() === 'N') {
    return { ok: false, status: 403, message: 'This employee account is inactive.' };
  }

  const credential = await getEmployeeCredential(pool, employee.paycode);

  // No credential row yet -> the first-time setup phase will own this state.
  if (!credential || !credential.passwordhash) {
    return {
      ok: false,
      status: 403,
      code: 'FIRST_TIME_SETUP_REQUIRED',
      message: 'Employee password is not set. Please create your password first.',
    };
  }

  if (credential.isactive === false || Number(credential.isactive) === 0) {
    return { ok: false, status: 403, message: 'This employee login is disabled. Please contact HR.' };
  }

  if (credential.lockeduntil && new Date(credential.lockeduntil) > new Date()) {
    return { ok: false, status: 423, message: 'Too many failed attempts. Try again later.' };
  }

  const valid = await verifySecret(password, credential.passwordhash, credential.passwordsalt, credential.passwordalgo);
  if (!valid) {
    await registerFailedAttempt(pool, employee.paycode);
    return { ok: false, status: 401, code: 'INVALID_CREDENTIALS', message: 'Invalid employee credentials.' };
  }

  await registerSuccessfulLogin(pool, employee.paycode);

  // Response shape is byte-for-byte what the existing clients already expect.
  return {
    ok: true,
    employee: {
      paycode: employee.paycode,
      empname: employee.empname,
      presentcardno: employee.presentcardno,
      companycode: employee.companycode,
    },
    mustChangePassword: Number(credential.mustchangepassword || 0) === 1,
    pwdVersion: Number(credential.pwdversion || 1),
  };
}

/* ------------------------- first-time password setup ---------------------- */
/* An employee signs in for the first time and creates their own password.
   Rules enforced here (never in the route):
     - the paycode must resolve to a real, active Savior employee
     - setup is allowed ONLY while no credential exists yet, so an already
       provisioned employee can never be overwritten from this public flow
     - a rate limit is applied because this runs before the employee is logged in
   HR-driven resets are a later phase and use their own guarded path. */

const SETUP_MAX_ATTEMPTS = 5;
const SETUP_WINDOW_MINUTES = 15;
const setupAttempts = new Map(); // key -> { count, firstAt }

/** Small in-process limiter: enough to blunt automated abuse without a new package. */
function setupThrottle(key) {
  const now = Date.now();
  const entry = setupAttempts.get(key);
  if (!entry || now - entry.firstAt > SETUP_WINDOW_MINUTES * 60_000) {
    setupAttempts.set(key, { count: 1, firstAt: now });
    return { blocked: false };
  }
  entry.count += 1;
  if (entry.count > SETUP_MAX_ATTEMPTS) {
    return { blocked: true, retryAfterMinutes: SETUP_WINDOW_MINUTES };
  }
  return { blocked: false };
}

function clearSetupThrottle(key) {
  setupAttempts.delete(key);
}

/**
 * Tells the client whether this real employee still has to create a password.
 * Returns { ok, required, status, code, message }. Never exposes hashes.
 */
export async function firstTimeSetupState(pool, paycode) {
  await ensureEmployeeAuthTables(pool);
  const cleanPaycode = String(paycode || '').trim();
  if (!cleanPaycode) {
    return { ok: false, required: false, status: 400, message: 'Paycode is required.' };
  }
  const employee = await findEmployeeByPaycode(pool, cleanPaycode);
  if (!employee) {
    return { ok: false, required: false, status: 404, message: 'Employee not found.' };
  }
  if (String(employee.active || 'Y').trim().toUpperCase() === 'N') {
    return { ok: false, required: false, status: 403, message: 'This employee account is inactive.' };
  }
  const credential = await getEmployeeCredential(pool, employee.paycode);
  const required = !credential || !credential.passwordhash;
  return {
    ok: true,
    required,
    employee: { paycode: employee.paycode, empname: employee.empname },
  };
}

/**
 * Creates the employee's own password for the very first time.
 * Never overwrites an existing credential, so this public flow cannot be used
 * to take over an account that already has a password.
 */
export async function completeFirstTimeSetup(pool, { paycode, password, confirmPassword }) {
  await ensureEmployeeAuthTables(pool);

  const cleanPaycode = String(paycode || '').trim();
  const newPassword = String(password || '');
  const confirm = String(confirmPassword || '');

  if (!cleanPaycode) return { ok: false, status: 400, message: 'Paycode is required.' };
  if (!newPassword) return { ok: false, status: 400, message: 'Password is required.' };
  if (newPassword !== confirm) {
    return { ok: false, status: 400, code: 'PASSWORD_MISMATCH', message: 'Password and confirmation do not match.' };
  }

  const throttle = setupThrottle(`setup:${cleanPaycode.toLowerCase()}`);
  if (throttle.blocked) {
    return {
      ok: false,
      status: 429,
      message: `Too many attempts. Please try again in ${throttle.retryAfterMinutes} minutes.`,
    };
  }

  const employee = await findEmployeeByPaycode(pool, cleanPaycode);
  if (!employee) return { ok: false, status: 404, message: 'Employee not found.' };
  if (String(employee.active || 'Y').trim().toUpperCase() === 'N') {
    return { ok: false, status: 403, message: 'This employee account is inactive.' };
  }

  // Refuse to touch an account that already has a password.
  const existing = await getEmployeeCredential(pool, employee.paycode);
  if (existing && existing.passwordhash) {
    return {
      ok: false,
      status: 409,
      code: 'ALREADY_PROVISIONED',
      message: 'A password is already set for this employee. Use the normal login or contact HR.',
    };
  }

  const strengthError = validatePasswordStrength(newPassword);
  if (strengthError) return { ok: false, status: 400, code: 'WEAK_PASSWORD', message: strengthError };

  await setEmployeePassword(pool, employee.paycode, newPassword, { mustChange: false, updatedBy: 'first-time-setup' });
  clearSetupThrottle(`setup:${cleanPaycode.toLowerCase()}`);

  // Only the fact that setup succeeded leaves the server. No hash, no password.
  return { ok: true, employee: { paycode: employee.paycode, empname: employee.empname } };
}

/* ------------------------- 4-digit employee PIN -------------------------- */
/* The PIN is an ADDITIONAL credential of the already-authenticated employee.
   It never replaces the password, is never accepted as a login credential,
   and is never placed in the JWT. Ownership is always taken from the
   authenticated session by the caller - never from a request body. */

let pinColumnsState = null;

/** Idempotent column ensure, mirroring ensureProviderColumns() in email-provider.js. */
export async function ensureEmployeePinColumns(pool) {
  if (pinColumnsState === true) return;
  if (typeof pinColumnsState === 'string') throw new Error(pinColumnsState);
  try {
    await ensureEmployeeAuthTables(pool);
    await pool.request().batch(`
IF COL_LENGTH('${EMPLOYEE_AUTH_TABLE}','pinfailedattempts') IS NULL
ALTER TABLE ${EMPLOYEE_AUTH_TABLE} ADD pinfailedattempts INT NOT NULL CONSTRAINT DF_HREmpAuth_PinFailed DEFAULT(0);
IF COL_LENGTH('${EMPLOYEE_AUTH_TABLE}','pinlockeduntil') IS NULL
ALTER TABLE ${EMPLOYEE_AUTH_TABLE} ADD pinlockeduntil DATETIME2 NULL;`);
    pinColumnsState = true;
  } catch (error) {
    pinColumnsState = 'PIN storage unavailable. Detail: ' + String(error?.message || error).slice(0, 140);
    throw new Error(pinColumnsState);
  }
}

/** Whether the employee already has a PIN. Never returns any hash. */
export async function getEmployeePinState(pool, paycode) {
  await ensureEmployeePinColumns(pool);
  const result = await pool.request()
    .input('paycode', sql.VarChar(50), paycode)
    .query(`SELECT TOP 1 pinhash, pinlockeduntil FROM ${EMPLOYEE_AUTH_TABLE} WHERE paycode = @paycode`);
  const row = result.recordset[0];
  const configured = !!(row && row.pinhash);
  const locked = !!(row && row.pinlockeduntil && new Date(row.pinlockeduntil) > new Date());
  return { configured, locked };
}

async function registerPinFailure(pool, paycode) {
  try {
    await pool.request()
      .input('paycode', sql.VarChar(50), paycode)
      .query(`UPDATE ${EMPLOYEE_AUTH_TABLE}
SET pinfailedattempts = ISNULL(pinfailedattempts, 0) + 1,
    pinlockeduntil = CASE WHEN ISNULL(pinfailedattempts, 0) + 1 >= ${PIN_MAX_ATTEMPTS}
      THEN DATEADD(MINUTE, ${PIN_LOCK_MINUTES}, SYSUTCDATETIME()) ELSE pinlockeduntil END,
    updatedat = SYSUTCDATETIME()
WHERE paycode = @paycode`);
  } catch (_error) {
    /* Bookkeeping must never change the decision. */
  }
}

async function clearPinFailures(pool, paycode) {
  try {
    await pool.request()
      .input('paycode', sql.VarChar(50), paycode)
      .query(`UPDATE ${EMPLOYEE_AUTH_TABLE} SET pinfailedattempts = 0, pinlockeduntil = NULL WHERE paycode = @paycode`);
  } catch (_error) {
    /* Non-critical. */
  }
}

/**
 * First-time PIN setup for an already-authenticated employee.
 * `paycode` MUST be the session identity supplied by the route, not the body.
 */
export async function createEmployeePin(pool, { paycode, pin, confirmPin }) {
  await ensureEmployeePinColumns(pool);

  const formatError = validatePinFormat(pin) || validatePinFormat(confirmPin);
  if (formatError) return { ok: false, status: 400, code: 'INVALID_PIN', message: formatError };
  if (String(pin) !== String(confirmPin)) {
    return { ok: false, status: 400, code: 'PIN_MISMATCH', message: 'PIN and confirmation do not match.' };
  }

  const employee = await findEmployeeByPaycode(pool, paycode);
  if (!employee) return { ok: false, status: 404, message: 'Employee not found.' };
  if (String(employee.active || 'Y').trim().toUpperCase() === 'N') {
    return { ok: false, status: 403, message: 'This employee account is inactive.' };
  }

  const state = await getEmployeePinState(pool, employee.paycode);
  if (state.configured) {
    return { ok: false, status: 409, code: 'PIN_ALREADY_SET', message: 'A PIN is already set. Use Change PIN instead.' };
  }

  const { hash, salt, algo } = await hashSecret(String(pin));
  await pool.request()
    .input('paycode', sql.VarChar(50), employee.paycode)
    .input('pinhash', sql.NVarChar(200), hash)
    .input('pinsalt', sql.NVarChar(100), salt)
    .input('pinalgo', sql.VarChar(20), algo)
    .query(`UPDATE ${EMPLOYEE_AUTH_TABLE}
SET pinhash = @pinhash, pinsalt = @pinsalt, pinalgo = @pinalgo,
    pinsetat = SYSUTCDATETIME(), pinupdatedat = SYSUTCDATETIME(),
    pinfailedattempts = 0, pinlockeduntil = NULL, updatedat = SYSUTCDATETIME()
WHERE paycode = @paycode`);

  return { ok: true, configured: true };
}

/**
 * Changes an existing PIN after verifying the current one.
 * `paycode` MUST be the session identity supplied by the route, not the body.
 */
export async function changeEmployeePin(pool, { paycode, currentPin, newPin, confirmPin }) {  await ensureEmployeePinColumns(pool);

  const formatError = validatePinFormat(newPin) || validatePinFormat(confirmPin);
  if (formatError) return { ok: false, status: 400, code: 'INVALID_PIN', message: formatError };
  if (String(newPin) !== String(confirmPin)) {
    return { ok: false, status: 400, code: 'PIN_MISMATCH', message: 'New PIN and confirmation do not match.' };
  }
  const currentFormatError = validatePinFormat(currentPin);
  if (currentFormatError) return { ok: false, status: 400, code: 'INVALID_PIN', message: currentFormatError };

  const employee = await findEmployeeByPaycode(pool, paycode);
  if (!employee) return { ok: false, status: 404, message: 'Employee not found.' };

  const result = await pool.request()
    .input('paycode', sql.VarChar(50), employee.paycode)
    .query(`SELECT TOP 1 pinhash, pinsalt, pinalgo, pinlockeduntil FROM ${EMPLOYEE_AUTH_TABLE} WHERE paycode = @paycode`);
  const row = result.recordset[0];
  if (!row || !row.pinhash) {
    return { ok: false, status: 409, code: 'PIN_NOT_SET', message: 'No PIN is set yet. Create your PIN first.' };
  }
  if (row.pinlockeduntil && new Date(row.pinlockeduntil) > new Date()) {
    return { ok: false, status: 423, code: 'PIN_LOCKED', message: 'Too many failed attempts. Try again later.' };
  }

  const currentValid = await verifySecret(currentPin, row.pinhash, row.pinsalt, row.pinalgo);
  if (!currentValid) {
    await registerPinFailure(pool, employee.paycode);
    return { ok: false, status: 401, code: 'INVALID_CURRENT_PIN', message: 'Current PIN is incorrect.' };
  }

  const { hash, salt, algo } = await hashSecret(String(newPin));
  await pool.request()
    .input('paycode', sql.VarChar(50), employee.paycode)
    .input('pinhash', sql.NVarChar(200), hash)
    .input('pinsalt', sql.NVarChar(100), salt)
    .input('pinalgo', sql.VarChar(20), algo)
    .query(`UPDATE ${EMPLOYEE_AUTH_TABLE}
SET pinhash = @pinhash, pinsalt = @pinsalt, pinalgo = @pinalgo,
    pinupdatedat = SYSUTCDATETIME(), pinfailedattempts = 0, pinlockeduntil = NULL,
    updatedat = SYSUTCDATETIME()
WHERE paycode = @paycode`);
  await clearPinFailures(pool, employee.paycode);

  return { ok: true, configured: true };
}

/* ------------------- forgot / reset password (Phase 3A.9) ------------------- */
/* A reset is authorised ONLY by a single-use, time-limited token that is sent
   to the employee's registered email. A paycode alone can never reset a
   password. The token itself is never stored - only its SHA-256 digest is.
   PIN columns are deliberately untouched by a password reset. */

const RESET_TOKEN_TTL_MINUTES = 15;
const RESET_MAX_REQUESTS = 3;
const RESET_WINDOW_MINUTES = 30;
const RESET_TOKEN_TABLE = process.env.HR_EMPLOYEE_RESET_TABLE || 'dbo.HR_EmployeePasswordReset';

let resetTableState = null;
const resetRequests = new Map(); // key -> { count, firstAt }

function hashResetToken(token) {
  return crypto.createHash('sha256').update(String(token)).digest('hex');
}

/** In-process limiter for reset requests, keyed by paycode and by IP. */
function resetThrottle(key) {
  const now = Date.now();
  const entry = resetRequests.get(key);
  if (!entry || now - entry.firstAt > RESET_WINDOW_MINUTES * 60_000) {
    resetRequests.set(key, { count: 1, firstAt: now });
    return { blocked: false };
  }
  entry.count += 1;
  if (entry.count > RESET_MAX_REQUESTS) {
    return { blocked: true, retryAfterMinutes: RESET_WINDOW_MINUTES };
  }
  return { blocked: false };
}

export async function ensurePasswordResetTable(pool) {
  if (resetTableState === true) return;
  if (typeof resetTableState === 'string') throw new Error(resetTableState);
  try {
    await pool.request().batch(`
IF OBJECT_ID('${RESET_TOKEN_TABLE}','U') IS NULL
CREATE TABLE ${RESET_TOKEN_TABLE} (
  id INT IDENTITY(1,1) PRIMARY KEY,
  paycode VARCHAR(50) NOT NULL,
  tokenhash NVARCHAR(80) NOT NULL CONSTRAINT UQ_HREmpReset_Token UNIQUE,
  purpose VARCHAR(20) NULL CONSTRAINT DF_HREmpReset_Purpose DEFAULT('PASSWORD'),
  expiresat DATETIME2 NOT NULL,
  usedat DATETIME2 NULL,
  usedip VARCHAR(64) NULL,
  createdat DATETIME2 NOT NULL CONSTRAINT DF_HREmpReset_Created DEFAULT SYSUTCDATETIME(),
  createdip VARCHAR(64) NULL
);`);
    resetTableState = true;
  } catch (error) {
    resetTableState = 'Password reset unavailable. Detail: ' + String(error?.message || error).slice(0, 140);
    throw new Error(resetTableState);
  }
}

/**
 * Issues a reset token for an already-provisioned employee.
 * Returns the PLAINTEXT token exactly once (for the email body) - the database
 * only ever receives the SHA-256 digest.
 */
export async function createPasswordResetToken(pool, paycode, meta = {}) {
  await ensurePasswordResetTable(pool);
  const employee = await findEmployeeByPaycode(pool, paycode);
  if (!employee) return { ok: false, status: 404, code: 'EMPLOYEE_NOT_FOUND', message: 'Employee not found.' };
  if (String(employee.active || 'Y').trim().toUpperCase() === 'N') {
    return { ok: false, status: 403, code: 'ACCOUNT_INACTIVE', message: 'This employee account is inactive.' };
  }
  const credential = await getEmployeeCredential(pool, employee.paycode);
  if (!credential || !credential.passwordhash) {
    return { ok: false, status: 403, code: 'NOT_PROVISIONED', message: 'No password is set yet for this employee.' };
  }

  const token = crypto.randomBytes(32).toString('base64url');
  const tokenHash = hashResetToken(token);

  // Only one live token per employee: older unused tokens stop working.
  await pool.request()
    .input('paycode', sql.VarChar(50), employee.paycode)
    .query(`UPDATE ${RESET_TOKEN_TABLE}
SET usedat = SYSUTCDATETIME()
WHERE paycode = @paycode AND usedat IS NULL`);

  await pool.request()
    .input('paycode', sql.VarChar(50), employee.paycode)
    .input('tokenhash', sql.NVarChar(80), tokenHash)
    .input('expiresat', sql.DateTime2, new Date(Date.now() + RESET_TOKEN_TTL_MINUTES * 60_000))
    .input('createdip', sql.VarChar(64), String(meta.ip || '').slice(0, 64) || null)
    .query(`INSERT INTO ${RESET_TOKEN_TABLE} (paycode, tokenhash, purpose, expiresat, createdip)
VALUES (@paycode, @tokenhash, 'PASSWORD', @expiresat, @createdip)`);

  return {
    ok: true,
    token,
    expiresInMinutes: RESET_TOKEN_TTL_MINUTES,
    employee: { paycode: employee.paycode, empname: String(employee.empname || '').trim() },
  };
}

/** Looks up a token by its digest. Expired or already-used tokens return null. */
export async function findValidResetToken(pool, token) {
  await ensurePasswordResetTable(pool);
  const tokenHash = hashResetToken(token);
  const result = await pool.request()
    .input('tokenhash', sql.NVarChar(80), tokenHash)
    .query(`SELECT TOP 1 paycode, expiresat, usedat FROM ${RESET_TOKEN_TABLE} WHERE tokenhash = @tokenhash`);
  const row = result.recordset[0];
  if (!row) return { ok: false, status: 400, code: 'INVALID_TOKEN', message: 'This reset link is invalid.' };
  if (row.usedat) return { ok: false, status: 400, code: 'TOKEN_USED', message: 'This reset link has already been used.' };
  if (new Date(row.expiresat) <= new Date()) {
    return { ok: false, status: 400, code: 'TOKEN_EXPIRED', message: 'This reset link has expired. Please request a new one.' };
  }
  return { ok: true, paycode: row.paycode };
}

/** Marks a token used so it can never be replayed. */
export async function consumeResetToken(pool, token, meta = {}) {
  await ensurePasswordResetTable(pool);
  await pool.request()
    .input('tokenhash', sql.NVarChar(80), hashResetToken(token))
    .input('usedip', sql.VarChar(64), String(meta.ip || '').slice(0, 64) || null)
    .query(`UPDATE ${RESET_TOKEN_TABLE} SET usedat = SYSUTCDATETIME(), usedip = @usedip
WHERE tokenhash = @tokenhash AND usedat IS NULL`);
}

export { RESET_TOKEN_TTL_MINUTES, resetThrottle };

/* ---------------- HR-controlled credential reset (Phase 3A.10) ----------------
   Used ONLY behind an authenticated HR session. It is the counterpart of the
   employee self-service flows:
     - password reset touches password columns ONLY (PIN is never changed)
     - PIN reset touches PIN columns ONLY (password is never changed)
   It reuses the same hashing, policy and storage as 3A.7 / 3A.8.            */

/** Credential status for HR view. Returns booleans only - never any hash. */
export async function getEmployeeCredentialStatus(pool, paycode) {
  await ensureEmployeePinColumns(pool);
  const cleanPaycode = String(paycode || '').trim();
  if (!cleanPaycode) return { ok: false, status: 400, message: 'Paycode is required.' };

  const employee = await findEmployeeByPaycode(pool, cleanPaycode);
  if (!employee) return { ok: false, status: 404, message: 'Employee not found.' };

  const credential = await getEmployeeCredential(pool, employee.paycode);
  const now = new Date();
  return {
    ok: true,
    employee: { paycode: employee.paycode, empname: String(employee.empname || '').trim() },
    passwordSet: !!(credential && credential.passwordhash),
    pinSet: !!(credential && credential.pinhash),
    accountActive: String(employee.active || 'Y').trim().toUpperCase() !== 'N',
    locked: !!(credential && credential.lockeduntil && new Date(credential.lockeduntil) > now),
  };
}

/** HR sets an employee's password. PIN columns are never touched here. */
export async function hrResetEmployeePassword(pool, { paycode, password, confirmPassword, actor }) {
  await ensureEmployeeAuthTables(pool);
  const cleanPaycode = String(paycode || '').trim();
  const newPassword = String(password || '');
  const confirm = String(confirmPassword || '');

  if (!cleanPaycode) return { ok: false, status: 400, code: 'PAYCODE_REQUIRED', message: 'Paycode is required.' };
  if (!newPassword) return { ok: false, status: 400, code: 'PASSWORD_REQUIRED', message: 'Password is required.' };
  if (newPassword !== confirm) {
    return { ok: false, status: 400, code: 'PASSWORD_MISMATCH', message: 'Password and confirmation do not match.' };
  }
  // Same policy as Phase 3A.7 - not weakened.
  const strengthError = validatePasswordStrength(newPassword);
  if (strengthError) return { ok: false, status: 400, code: 'WEAK_PASSWORD', message: strengthError };

  const employee = await findEmployeeByPaycode(pool, cleanPaycode);
  if (!employee) return { ok: false, status: 404, code: 'EMPLOYEE_NOT_FOUND', message: 'Employee not found.' };
  if (String(employee.active || 'Y').trim().toUpperCase() === 'N') {
    return { ok: false, status: 403, code: 'ACCOUNT_INACTIVE', message: 'This employee account is inactive.' };
  }

  // Reuses the 3A.7 writer: scrypt hash, pwdversion bump, lockout cleared.
  // Password columns only - the employee keeps their own PIN.
  await setEmployeePassword(pool, employee.paycode, newPassword, {
    mustChange: false,
    updatedBy: String(actor || 'HR').slice(0, 50),
  });

  // Any self-service reset link issued earlier must stop working.
  try {
    await ensurePasswordResetTable(pool);
    await pool.request()
      .input('paycode', sql.VarChar(50), employee.paycode)
      .query(`UPDATE ${RESET_TOKEN_TABLE} SET usedat = SYSUTCDATETIME() WHERE paycode = @paycode AND usedat IS NULL`);
  } catch (_error) {
    /* Reset-link invalidation is best effort and must not fail the reset. */
  }

  return { ok: true, employee: { paycode: employee.paycode, empname: String(employee.empname || '').trim() } };
}

/** HR sets an employee's 4-digit PIN. Password columns are never touched here. */
export async function hrResetEmployeePin(pool, { paycode, pin, confirmPin, actor }) {
  await ensureEmployeePinColumns(pool);
  const cleanPaycode = String(paycode || '').trim();
  const newPin = String(pin == null ? '' : pin);
  const confirm = String(confirmPin == null ? '' : confirmPin);

  if (!cleanPaycode) return { ok: false, status: 400, code: 'PAYCODE_REQUIRED', message: 'Paycode is required.' };
  // Exactly 4 numeric digits - same rule as Phase 3A.8.
  const formatError = validatePinFormat(newPin) || validatePinFormat(confirm);
  if (formatError) return { ok: false, status: 400, code: 'INVALID_PIN', message: formatError };
  if (newPin !== confirm) {
    return { ok: false, status: 400, code: 'PIN_MISMATCH', message: 'PIN and confirmation do not match.' };
  }

  const employee = await findEmployeeByPaycode(pool, cleanPaycode);
  if (!employee) return { ok: false, status: 404, code: 'EMPLOYEE_NOT_FOUND', message: 'Employee not found.' };
  if (String(employee.active || 'Y').trim().toUpperCase() === 'N') {
    return { ok: false, status: 403, code: 'ACCOUNT_INACTIVE', message: 'This employee account is inactive.' };
  }

  // PIN columns only - the employee keeps their own password.
  const { hash, salt, algo } = await hashSecret(newPin);
  await pool.request()
    .input('paycode', sql.VarChar(50), employee.paycode)
    .input('pinhash', sql.NVarChar(200), hash)
    .input('pinsalt', sql.NVarChar(100), salt)
    .input('pinalgo', sql.VarChar(20), algo)
    .input('updatedby', sql.VarChar(50), String(actor || 'HR').slice(0, 50))
    .query(`UPDATE ${EMPLOYEE_AUTH_TABLE}
SET pinhash = @pinhash, pinsalt = @pinsalt, pinalgo = @pinalgo,
    pinupdatedat = SYSUTCDATETIME(),
    pinfailedattempts = 0, pinlockeduntil = NULL,
    updatedat = SYSUTCDATETIME(), updatedby = @updatedby
WHERE paycode = @paycode`);

  return { ok: true, employee: { paycode: employee.paycode, empname: String(employee.empname || '').trim() } };
}
