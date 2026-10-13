/* ============================================================================
   SuperAdmin password hash generator (offline helper)
   ----------------------------------------------------------------------------
   Run this ONCE on the server/developer machine to create the hashed credential
   that goes into .env. The plaintext password is never written to disk by this
   script and is never stored in source code.

   Usage:
     node server/generate-superadmin-hash.js "<your-password>"

   Then copy the printed SUPERADMIN_* lines into the server .env file.
   ========================================================================== */

import { hashSuperAdminPassword } from './superadmin-auth.js';

const password = process.argv[2];

if (!password || password.length < 8) {
  console.error('Usage: node server/generate-superadmin-hash.js "<password of at least 8 characters>"');
  process.exit(1);
}

const { hash, salt, algo } = await hashSuperAdminPassword(password);

console.log('');
console.log('Add these lines to the SERVER .env file (never commit the values):');
console.log('');
console.log('SUPERADMIN_USERNAME=<choose-an-admin-username>');
console.log(`SUPERADMIN_PASSWORD_HASH=${hash}`);
console.log(`SUPERADMIN_PASSWORD_SALT=${salt}`);
console.log(`SUPERADMIN_PASSWORD_ALGO=${algo}`);
console.log('');
console.log('Keep .env out of version control. Rotate by re-running this script.');
console.log('');
