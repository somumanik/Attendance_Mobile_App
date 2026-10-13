/* ============================================================================
   SUPERADMIN AUTHENTICATION — isolated module
   ----------------------------------------------------------------------------
   WHY THIS FILE EXISTS:
   SuperAdmin is a SEPARATE MANAGEMENT ROLE. It must never be wired into the HR
   Admin credential path or the employee credential store, so this module owns
   100% of the SuperAdmin secret concern and nothing else imports it except the
   one login route in server/index.js.

   SECURITY RULES HONOURED HERE:
     - No username/password is hard-coded anywhere. Ever.
     - No default/fallback production password is assumed. If the environment is
       not configured, login fails closed with 503.
     - The password is NEVER stored or compared in plaintext. Only a scrypt
       HASH + salt are read from configuration, so the server never holds the
       admin password at all.
     - Comparison is constant-time (crypto.timingSafeEqual).
     - The same scrypt-v1 parameters used by server/employee-auth.js are reused,
       so the app has ONE hashing scheme. No new dependency is introduced
       (node:crypto ships with Node).
     - Nothing here touches dbo.tblemployee, the HR_EmployeeAuth table or ANY
       Savior table. There is no database access in this file at all.

   CONFIGURATION (.env — server side only, never the mobile app):
     SUPERADMIN_USERNAME        required
     SUPERADMIN_PASSWORD_HASH   required  (scrypt-v1 hex digest)
     SUPERADMIN_PASSWORD_SALT   required  (hex salt paired with the hash)
     SUPERADMIN_PASSWORD_ALGO   optional  (defaults to scrypt-v1)
   Generate the hash/salt with:  node server/generate-superadmin-hash.js "<password>"
   ========================================================================== */

import crypto from 'node:crypto';
import util from 'node:util';

/* Identical parameters to server/employee-auth.js so there is one scheme. */
const SCRYPT = { N: 16384, r: 8, p: 1, maxmem: 64 * 1024 * 1024 };
const KEY_LENGTH = 64;
const SALT_BYTES = 16;
const ALGO = 'scrypt-v1';
const scryptAsync = util.promisify(crypto.scrypt);

/** Reads the SuperAdmin configuration. Values are trimmed; none are defaulted. */
const readConfig = () => ({
  username: String(process.env.SUPERADMIN_USERNAME || '').trim(),
  hash: String(process.env.SUPERADMIN_PASSWORD_HASH || '').trim(),
  salt: String(process.env.SUPERADMIN_PASSWORD_SALT || '').trim(),
  algo: String(process.env.SUPERADMIN_PASSWORD_ALGO || ALGO).trim(),
});

/** True only when a username AND a hash/salt pair are configured. */
export function isSuperAdminConfigured() {
  const c = readConfig();
  return Boolean(c.username && c.hash && c.salt && c.algo === ALGO);
}

const derive = async (secret, salt) =>
  (await scryptAsync(String(secret), salt, KEY_LENGTH, SCRYPT)).toString('hex');

/**
 * Hashes a password with a fresh random salt.
 * Used ONLY by the offline hash generator; the running server never needs it
 * (it reads the hash from configuration).
 */
export async function hashSuperAdminPassword(secret) {
  const salt = crypto.randomBytes(SALT_BYTES).toString('hex');
  return { hash: await derive(secret, salt), salt, algo: ALGO };
}

/** Constant-time hex digest comparison. Fails closed on any malformed input. */
const digestsMatch = (a, b) => {
  try {
    const x = Buffer.from(String(a), 'hex');
    const y = Buffer.from(String(b), 'hex');
    if (x.length === 0 || x.length !== y.length) return false;
    return crypto.timingSafeEqual(x, y);
  } catch {
    return false;
  }
};

/** Constant-time string comparison (length is compared first; that is unavoidable). */
const stringsMatch = (a, b) => {
  const x = Buffer.from(String(a), 'utf8');
  const y = Buffer.from(String(b), 'utf8');
  if (x.length !== y.length || x.length === 0) return false;
  return crypto.timingSafeEqual(x, y);
};

/**
 * Verifies a SuperAdmin sign-in attempt.
 *
 * The username AND the password are always evaluated before returning, and the
 * failure message is identical for both, so a caller cannot use the response to
 * discover which half was wrong.
 *
 * @returns {Promise<{ok:boolean,status:number,message?:string,username?:string}>}
 */
export async function verifySuperAdminLogin(username, password) {
  if (!isSuperAdminConfigured()) {
    /* Fail closed. Never invent a default admin. */
    return { ok: false, status: 503, message: 'SuperAdmin authentication is not configured.' };
  }

  const c = readConfig();
  const givenUser = String(username || '').trim();
  const givenPass = String(password || '');

  const userOk = stringsMatch(givenUser, c.username);

  let passOk = false;
  if (givenPass) {
    const candidate = await derive(givenPass, c.salt);
    passOk = digestsMatch(candidate, c.hash);
  }

  if (!userOk || !passOk) {
    return { ok: false, status: 401, message: 'Invalid SuperAdmin credentials.' };
  }
  return { ok: true, status: 200, username: c.username };
}

export default { isSuperAdminConfigured, hashSuperAdminPassword, verifySuperAdminLogin };
