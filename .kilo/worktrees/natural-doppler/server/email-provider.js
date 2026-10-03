/* ============================================================================
   EMAIL PROVIDER CORE â€” the ONLY place email credentials + transport live.
   ----------------------------------------------------------------------------
   WHY THIS FILE EXISTS (protection rule):
   Email configuration must never be broken by future feature work. So all
   credential storage, provider detection, encryption and sending are kept in
   this single isolated module. Future code (new HR modules, new UI tabs, other
   endpoints) MUST call the exported functions below â€” never re-implement key
   handling, never write to the HR_EmailConfig provider columns directly.

   FROZEN PUBLIC API (keep backwards compatible):
     PROVIDER_TYPES                        -> ['brevo', 'smtp']
     ensureProviderColumns(pool, sql)      -> adds provider columns to HR_EmailConfig (idempotent)
     getProviderSettings(pool)             -> { provider, source, configured, hint, secrets... }
     publicProviderStatus(settings)        -> same object WITHOUT any secret (safe for res.json)
     saveProviderSettings(pool, sql, body, updatedBy) -> merge-safe save (blank never wipes)
     sendEmail(settings, from, message)    -> { messageId }

   STORAGE RULES:
     - Secrets are AES-256-GCM encrypted at rest in dbo.HR_EmailConfig.
     - Key source: EMAIL_CRED_KEY in server .env (auto-created in .env if absent),
       fallback JWT_SECRET-derived key. .env is gitignored -> never committed.
     - Nothing secret is ever returned by an HTTP endpoint (masked hint only).
     - Sweeping "save settings" calls can NEVER blank a stored secret: empty
       string means "leave as-is"; clearing needs explicit "<field>Clear": true.
   ========================================================================= */
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import nodemailer from 'nodemailer';

export const PROVIDER_TYPES = ['brevo', 'smtp'];
export const DEFAULT_CONFIG_TABLE = 'dbo.HR_EmailConfig';
export const ENV_KEYS = {
  brevoKey: 'BREVO_API_KEY',
  smtpHost: 'SMTP_HOST',
  smtpPort: 'SMTP_PORT',
  smtpSecure: 'SMTP_SECURE',
  smtpUser: 'SMTP_USER',
  smtpPassword: 'SMTP_PASSWORD'
};
const ENC_PREFIX = 'enc:v1:';
let columnsState = null; // null = unknown, true = ready, string = error message
let cachedKey = null; // AES-256 key cache (module scope)
/* ------------------------------- encryption ------------------------------- */
function sha256(text) { return crypto.createHash('sha256').update(String(text)).digest(); }

function persistEnvKey(secret) {
  // .env is gitignored, so the generated key stays on this machine only.
  try {
    const envPath = path.resolve(process.cwd(), '.env');
    if (!fs.existsSync(envPath)) return false;
    const current = fs.readFileSync(envPath, 'utf8');
    if (/^\s*EMAIL_CRED_KEY\s*=/m.test(current)) return false; // present in file but not loaded -> do not fight it
    const needsBreak = current.length > 0 && !current.endsWith('\n');
    fs.appendFileSync(envPath, `${needsBreak ? '\n' : ''}EMAIL_CRED_KEY=${secret}\n`, 'utf8');
    return true;
  } catch (_) { return false; }
}

function credentialKey() {
  if (cachedKey) return cachedKey;
  const fromEnv = String(process.env.EMAIL_CRED_KEY || '').trim();
  if (fromEnv) { cachedKey = sha256(fromEnv); return cachedKey; }
  const generated = crypto.randomBytes(32).toString('hex');
  if (persistEnvKey(generated)) { process.env.EMAIL_CRED_KEY = generated; cachedKey = sha256(generated); return cachedKey; }
  // No writable .env: fall back to a stable, already-secret value so restarts keep working.
  const fallback = String(process.env.JWT_SECRET || '').trim() || 'attendance-email-local-key';
  cachedKey = sha256(`email-cred-fallback|${fallback}`);
  return cachedKey;
}

export function encryptSecret(plain) {
  const text = String(plain == null ? '' : plain);
  if (!text) return null;
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', credentialKey(), iv);
  const body = Buffer.concat([cipher.update(text, 'utf8'), cipher.final()]);
  return `${ENC_PREFIX}${iv.toString('base64')}.${cipher.getAuthTag().toString('base64')}.${body.toString('base64')}`;
}

export function decryptSecret(stored) {
  const text = String(stored == null ? '' : stored).trim();
  if (!text) return '';
  if (!text.startsWith(ENC_PREFIX)) return text; // plaintext (manually seeded row) â€” accept as-is
  try {
    const [ivB64, tagB64, bodyB64] = text.slice(ENC_PREFIX.length).split('.');
    const decipher = crypto.createDecipheriv('aes-256-gcm', credentialKey(), Buffer.from(ivB64, 'base64'));
    decipher.setAuthTag(Buffer.from(tagB64, 'base64'));
    return Buffer.concat([decipher.update(Buffer.from(bodyB64, 'base64')), decipher.final()]).toString('utf8');
  } catch (_) { return ''; } // wrong/changed EMAIL_CRED_KEY -> reported to HR, never silently ignored
}

function looksEncrypted(value) { return String(value == null ? '' : value).trim().startsWith(ENC_PREFIX); }

/* --------------------------- schema (own table) --------------------------- */
export async function ensureProviderColumns(pool, sql) {
  if (columnsState === true) return;
  if (typeof columnsState === 'string') throw new Error(columnsState);
  const table = process.env.HR_EMAIL_CONFIG_TABLE || DEFAULT_CONFIG_TABLE;
  try {
    // Only this feature's own table is touched. Savior tables (dbo.tblemployee, ...)
    // are never altered by the email module.
    await pool.request().batch(`
IF OBJECT_ID('${table}','U') IS NOT NULL AND COL_LENGTH('${table}','emailprovider') IS NULL
ALTER TABLE ${table} ADD emailprovider VARCHAR(20) NULL;
IF OBJECT_ID('${table}','U') IS NOT NULL AND COL_LENGTH('${table}','brevoapikey') IS NULL
ALTER TABLE ${table} ADD brevoapikey NVARCHAR(600) NULL;
IF OBJECT_ID('${table}','U') IS NOT NULL AND COL_LENGTH('${table}','smtphost') IS NULL
ALTER TABLE ${table} ADD smtphost VARCHAR(150) NULL;
IF OBJECT_ID('${table}','U') IS NOT NULL AND COL_LENGTH('${table}','smtpport') IS NULL
ALTER TABLE ${table} ADD smtpport INT NULL;
IF OBJECT_ID('${table}','U') IS NOT NULL AND COL_LENGTH('${table}','smtpsecure') IS NULL
ALTER TABLE ${table} ADD smtpsecure BIT NULL;
IF OBJECT_ID('${table}','U') IS NOT NULL AND COL_LENGTH('${table}','smtpuser') IS NULL
ALTER TABLE ${table} ADD smtpuser VARCHAR(150) NULL;
IF OBJECT_ID('${table}','U') IS NOT NULL AND COL_LENGTH('${table}','smtppassword') IS NULL
ALTER TABLE ${table} ADD smtppassword NVARCHAR(600) NULL;
IF OBJECT_ID('${table}','U') IS NOT NULL AND COL_LENGTH('${table}','providerupdateddate') IS NULL
ALTER TABLE ${table} ADD providerupdateddate DATETIME2 NULL;
IF OBJECT_ID('${table}','U') IS NOT NULL AND COL_LENGTH('${table}','providerupdatedby') IS NULL
ALTER TABLE ${table} ADD providerupdatedby VARCHAR(50) NULL;`);
    columnsState = true;
  } catch (error) {
    columnsState = 'Email provider columns unavailable. Run server/email-schema.sql on the database (or keep BREVO_API_KEY in server .env). Detail: ' + (error && error.message || error).toString().slice(0, 140);
    throw new Error(columnsState);
  }
}

/* ------------------------------ settings I/O ------------------------------ */
function normalizeDbRow(row) {
  const brevoApiKey = decryptSecret(row && row.brevoapikey);
  const smtpPassword = decryptSecret(row && row.smtppassword);
  return {
    provider: String((row && row.emailprovider) || '').trim().toLowerCase(),
    brevoApiKey,
    brevoKeyEncryptedBroken: looksEncrypted(row && row.brevoapikey) && !brevoApiKey,
    smtp: {
      host: String((row && row.smtphost) || '').trim(),
      port: Number(row && row.smtpport) || 0,
      secure: !!(row && row.smtpsecure),
      user: String((row && row.smtpuser) || '').trim(),
      password: smtpPassword,
      passwordEncryptedBroken: looksEncrypted(row && row.smtppassword) && !smtpPassword
    },
    changedAt: row && row.providerupdateddate ? new Date(row.providerupdateddate).toISOString() : null,
    changedBy: (row && row.providerupdatedby) || null
  };
}

function smtpFromEnv() {
  const host = String(process.env[ENV_KEYS.smtpHost] || '').trim();
  if (!host) return null;
  return {
    host,
    port: Number(process.env[ENV_KEYS.smtpPort] || 587) || 587,
    secure: String(process.env[ENV_KEYS.smtpSecure] || '').toLowerCase() === 'true',
    user: String(process.env[ENV_KEYS.smtpUser] || '').trim(),
    password: String(process.env[ENV_KEYS.smtpPassword] || '').trim(),
    passwordEncryptedBroken: false
  };
}

function readiness(provider, brevoApiKey, smtp) {
  const mail = smtp || {};
  if (provider === 'brevo') {
    return brevoApiKey
      ? { configured: true, hint: '' }
      : { configured: false, hint: 'Brevo API key missing â€” Provider Config tab me key save karo (ya .env me BREVO_API_KEY daalo) aur server restart karo.' };
  }
  if (provider === 'smtp') {
    if (!mail.host) return { configured: false, hint: 'SMTP host missing â€” Provider Config tab me SMTP settings save karo.' };
    // User/password optional: internal relay servers often accept mail without
    // authentication. If a username IS given, a password becomes mandatory.
    if (mail.user && !mail.password) return { configured: false, hint: 'SMTP username diya hai to password bhi save karo (Provider Config tab).' };
    return { configured: true, hint: '' };
  }
  return { configured: false, hint: 'Email provider configure nahi hai. Provider Config tab me Brevo API key ya SMTP credentials save karo (ya .env me BREVO_API_KEY / SMTP_* daalo).' };
}
export function maskSecret(value) {
  const text = String(value == null ? '' : value).trim();
  if (!text) return '';
  if (text.length <= 8) return 'â€¢â€¢â€¢â€¢â€¢â€¢â€¢â€¢';
  return `${text.slice(0, 4)}â€¢â€¢â€¢â€¢â€¢â€¢â€¢â€¢${text.slice(-4)}`;
}

/* Resolves the ACTIVE provider: database credentials first (set from the UI),
   then server .env (BREVO_API_KEY / SMTP_*), then "not configured". */
export async function getProviderSettings(pool) {
  let db = { provider: '', brevoApiKey: '', brevoKeyEncryptedBroken: false, smtp: {}, changedAt: null, changedBy: null };
  let dbError = '';
  try {
    await ensureProviderColumns(pool);
    const table = process.env.HR_EMAIL_CONFIG_TABLE || DEFAULT_CONFIG_TABLE;
    const result = await pool.request().query(`SELECT TOP 1 emailprovider, brevoapikey, smtphost, smtpport, smtpsecure, smtpuser, smtppassword, providerupdateddate, providerupdatedby FROM ${table} ORDER BY id`);
    db = normalizeDbRow(result.recordset[0]);
  } catch (error) {
    dbError = (error && error.message || error).toString().slice(0, 200);
  }
  const envBrevo = String(process.env[ENV_KEYS.brevoKey] || '').trim();
  const envSmtp = smtpFromEnv();
  const wanted = PROVIDER_TYPES.includes(db.provider) ? db.provider : '';
  const stamp = { changedAt: db.changedAt, changedBy: db.changedBy };

  if ((wanted === 'brevo' || !wanted) && db.brevoApiKey) {
    return { provider: 'brevo', source: 'database', brevoApiKey: db.brevoApiKey, smtp: db.smtp, ...stamp, ...readiness('brevo', db.brevoApiKey, db.smtp) };
  }
  if ((wanted === 'smtp' || !wanted) && db.smtp.host) {
    return { provider: 'smtp', source: 'database', brevoApiKey: '', smtp: db.smtp, ...stamp, ...readiness('smtp', '', db.smtp) };
  }
  if ((wanted === 'brevo' || !wanted) && envBrevo) {
    return { provider: 'brevo', source: 'env', brevoApiKey: envBrevo, smtp: db.smtp, ...stamp, ...readiness('brevo', envBrevo, db.smtp) };
  }
  if ((wanted === 'smtp' || !wanted) && envSmtp) {
    return { provider: 'smtp', source: 'env', brevoApiKey: '', smtp: envSmtp, ...stamp, ...readiness('smtp', '', envSmtp) };
  }
  const broken = db.brevoKeyEncryptedBroken || (db.smtp && db.smtp.passwordEncryptedBroken);
  const hint = broken
    ? 'Saved credentials decrypt nahi ho pa rahe (EMAIL_CRED_KEY badal gaya). Provider Config tab me credentials dobara save karo.'
    : (dbError || readiness(wanted, '', db.smtp).hint);
  return { provider: wanted || 'none', source: dbError ? 'error' : 'none', brevoApiKey: '', smtp: db.smtp || {}, ...stamp, configured: false, ready: false, hint };
}

/* Never hand this object to res.json() â€” it is the secret-free mirror. */
export function publicProviderStatus(settings) {
  const s = settings || {};
  const smtp = s.smtp || {};
  return {
    provider: s.provider || 'none',
    providerLabel: s.provider === 'brevo' ? 'Brevo â€” HTTPS API (api.brevo.com)' : s.provider === 'smtp' ? 'SMTP (custom mail server)' : 'Not configured',
    source: s.source || 'none',
    configured: !!s.configured,
    ready: !!s.configured,
    hint: s.hint || '',
    brevoKeyHint: s.brevoApiKey ? maskSecret(s.brevoApiKey) : '',
    hasBrevoKey: !!s.brevoApiKey,
    smtp: {
      host: smtp.host || '',
      port: Number(smtp.port) || 0,
      secure: !!smtp.secure,
      user: smtp.user || '',
      hasPassword: !!smtp.password,
      passwordHint: smtp.password ? maskSecret(smtp.password) : ''
    },
    envFallback: { brevo: !!String(process.env[ENV_KEYS.brevoKey] || '').trim(), smtp: !!smtpFromEnv() },
    changedAt: s.changedAt || null,
    changedBy: s.changedBy || null
  };
}

function pickText(body, ...keys) {
  for (const key of keys) {
    if (body && body[key] !== undefined && body[key] !== null) return String(body[key]).trim();
  }
  return '';
}
/* Merge-safe save: only provided fields change; empty secret = keep existing. */
export async function saveProviderSettings(pool, sql, body, updatedBy) {
  const table = process.env.HR_EMAIL_CONFIG_TABLE || DEFAULT_CONFIG_TABLE;
  await ensureProviderColumns(pool);
  const b = body || {};
  const provider = pickText(b, 'provider', 'emailprovider').toLowerCase();
  if (provider && !PROVIDER_TYPES.includes(provider)) throw new Error(`Provider must be one of: ${PROVIDER_TYPES.join(', ')}.`);
  const request = pool.request();
  const sets = [];
  if (provider) { request.input('emailprovider', sql.VarChar(20), provider); sets.push('emailprovider = @emailprovider'); }

  const apiKey = pickText(b, 'brevoApiKey', 'brevoapikey', 'apiKey');
  if (b.brevoApiKeyClear === true || b.clearBrevoKey === true) { request.input('brevoapikey', sql.NVarChar(600), null); sets.push('brevoapikey = @brevoapikey'); }
  else if (apiKey) { request.input('brevoapikey', sql.NVarChar(600), encryptSecret(apiKey)); sets.push('brevoapikey = @brevoapikey'); }

  if (b.smtpHost !== undefined || b.smtphost !== undefined) { const v = pickText(b, 'smtpHost', 'smtphost'); request.input('smtphost', sql.VarChar(150), v || null); sets.push('smtphost = @smtphost'); }
  if (b.smtpPort !== undefined || b.smtpport !== undefined) { const p = Number(pickText(b, 'smtpPort', 'smtpport')) || null; request.input('smtpport', sql.Int, p); sets.push('smtpport = @smtpport'); }
  if (b.smtpSecure !== undefined || b.smtpsecure !== undefined) { const s = (b.smtpSecure === true || b.smtpsecure === true || String(b.smtpSecure || b.smtpsecure || '').toLowerCase() === 'true'); request.input('smtpsecure', sql.Bit, s ? 1 : 0); sets.push('smtpsecure = @smtpsecure'); }
  if (b.smtpUser !== undefined || b.smtpuser !== undefined) { const v = pickText(b, 'smtpUser', 'smtpuser'); request.input('smtpuser', sql.VarChar(150), v || null); sets.push('smtpuser = @smtpuser'); }
  const smtpPassword = pickText(b, 'smtpPassword', 'smtppassword');
  if (b.smtpPasswordClear === true || b.clearSmtpPassword === true) { request.input('smtppassword', sql.NVarChar(600), null); sets.push('smtppassword = @smtppassword'); }
  else if (smtpPassword) { request.input('smtppassword', sql.NVarChar(600), encryptSecret(smtpPassword)); sets.push('smtppassword = @smtppassword'); }

  if (!sets.length) throw new Error('No provider fields to update.');
  request.input('updatedby', sql.VarChar(50), String(updatedBy || 'HR').slice(0, 50));
  await request.query(`UPDATE ${table} SET ${sets.join(', ')}, providerupdateddate = SYSUTCDATETIME(), providerupdatedby = @updatedby WHERE id = (SELECT TOP 1 id FROM ${table} ORDER BY id)`);
  return { saved: true, provider, fields: sets.length };
}

/* -------------------------------- sending -------------------------------- */
async function loadNodemailer() {
  if (!nodemailer || typeof nodemailer.createTransport !== 'function') {
    throw new Error('SMTP sending needs the nodemailer package. Run: npm install nodemailer');
  }
  return nodemailer;
}

async function sendViaBrevo(settings, from, message) {
  const response = await fetch('https://api.brevo.com/v3/smtp/email', {
    method: 'POST',
    headers: { 'api-key': settings.brevoApiKey, 'content-type': 'application/json', accept: 'application/json' },
    body: JSON.stringify({
      sender: { name: from.name || 'HR Team', email: from.email },
      to: [{ email: message.to, name: message.toName || undefined }],
      subject: message.subject,
      textContent: message.text
    })
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    const detail = data && (data.message || (data.error && data.error.message));
    throw new Error(detail || `Brevo HTTP ${response.status}`);
  }
  return { messageId: data.messageId || null };
}
async function sendViaSmtp(settings, from, message) {
  const nodemailer = await loadNodemailer();
  const smtp = settings.smtp || {};
  const transport = nodemailer.createTransport({
    host: smtp.host,
    port: Number(smtp.port) || 587,
    secure: !!smtp.secure,
    auth: smtp.user ? { user: smtp.user, pass: smtp.password } : undefined,
    // Internal/in-house mail relays often use self-signed certificates. This
    // mirrors the project's existing SQL setting (trustServerCertificate: true).
    tls: { rejectUnauthorized: false },
    connectionTimeout: 15000,
    greetingTimeout: 15000,
    socketTimeout: 30000
  });
  try {
    const info = await transport.sendMail({
      from: `"${from.name || 'HR Team'}" <${from.email}>`,
      to: message.toName ? `"${message.toName}" <${message.to}>` : message.to,
      subject: message.subject,
      text: message.text
    });
    return { messageId: (info && info.messageId) || null };
  } finally {
    try { transport.close(); } catch (_) { /* transport already closed */ }
  }
}

/* Single entry point used by every email feature (test / single / bulk / scheduler). */
export async function sendEmail(settings, from, message) {
  const active = settings || {};
  if (!active.configured) throw new Error(active.hint || 'Email provider is not configured. Open HR â†’ Email Configuration â†’ Provider Config.');
  const senderEmail = String((from && from.email) || '').trim();
  if (!senderEmail) throw new Error('Sender email is not set. Save Sender Email in the Provider Config tab.');
  if (active.provider === 'brevo') return sendViaBrevo(active, from, message);
  if (active.provider === 'smtp') return sendViaSmtp(active, from, message);
  throw new Error(`Unsupported email provider "${active.provider}".`);
}
