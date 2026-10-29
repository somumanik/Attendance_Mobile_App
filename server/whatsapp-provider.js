/* ============================================================================
   WHATSAPP PROVIDER CORE — the ONLY place WhatsApp Cloud API credentials + the
   Meta Graph API transport live (mirrors server/email-provider.js).
   ----------------------------------------------------------------------------
   WHY THIS FILE EXISTS (protection rule):
   WhatsApp configuration must never be broken by future feature work. All
   credential storage, provider detection, encryption, sending and webhook
   signature verification are kept in this single isolated module. Future code
   MUST call the exported functions below — never re-implement key handling,
   never write to the provider columns of dbo.HR_WhatsAppConfig directly.

   FROZEN PUBLIC API (keep backwards compatible):
     WHATSAPP_MODES                        -> ['FREE_MANUAL', 'CLOUD_API']
     ensureWhatsAppProviderColumns(pool,sql) -> adds provider columns (idempotent)
     getWhatsAppProviderSettings(pool)     -> { provider, source, configured, hint, ... }
     publicWhatsAppProviderStatus(settings)-> same object WITHOUT any secret (safe for res.json)
     saveWhatsAppProviderSettings(pool,sql,body,updatedBy) -> merge-safe save (blank never wipes)
     sendWhatsAppTemplate(settings, msg)   -> { messageId } (Cloud API only)
     verifyWhatsAppWebhookSignature(rawBody, signature, appSecret) -> boolean

   STORAGE RULES:
     - Secrets are AES-256-GCM encrypted at rest in dbo.HR_WhatsAppConfig.
     - Key source: WHATSAPP_CRED_KEY in server .env (fallback JWT_SECRET-derived).
       Unlike the email module, this module NEVER writes to .env automatically.
     - Nothing secret is ever returned by an HTTP endpoint (masked hint only).
     - Empty string on save means "leave as-is"; clearing needs explicit "*Clear".
   ========================================================================== */
import crypto from 'node:crypto';

export const WHATSAPP_MODES = ['FREE_MANUAL', 'CLOUD_API'];
export const DEFAULT_CONFIG_TABLE = 'dbo.HR_WhatsAppConfig';
export const ENV_KEYS = {
  accessToken: 'WHATSAPP_ACCESS_TOKEN',
  phoneNumberId: 'WHATSAPP_PHONE_NUMBER_ID',
  businessAccountId: 'WHATSAPP_BUSINESS_ACCOUNT_ID',
  apiVersion: 'WHATSAPP_API_VERSION',
  appSecret: 'WHATSAPP_APP_SECRET',
  webhookVerifyToken: 'WHATSAPP_WEBHOOK_VERIFY_TOKEN',
};

const ENC_PREFIX = 'enc:v1:';
let columnsState = null; // null = unknown, true = ready, string = error message
let cachedKey = null;

/* ------------------------------- encryption ------------------------------- */
function sha256(text) { return crypto.createHash('sha256').update(String(text)).digest(); }

function credentialKey() {
  if (cachedKey) return cachedKey;
  const fromEnv = String(process.env.WHATSAPP_CRED_KEY || '').trim();
  if (fromEnv) { cachedKey = sha256(fromEnv); return cachedKey; }
  // No WHATSAPP_CRED_KEY configured: derive a stable key from JWT_SECRET. This
  // intentionally does NOT write .env (the existing .env is never auto-modified).
  const fallback = String(process.env.JWT_SECRET || '').trim() || 'attendance-whatsapp-local-key';
  cachedKey = sha256(`whatsapp-cred-fallback|${fallback}`);
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
  if (!text.startsWith(ENC_PREFIX)) return text; // plaintext (manually seeded row) — accept as-is
  try {
    const [ivB64, tagB64, bodyB64] = text.slice(ENC_PREFIX.length).split('.');
    const decipher = crypto.createDecipheriv('aes-256-gcm', credentialKey(), Buffer.from(ivB64, 'base64'));
    decipher.setAuthTag(Buffer.from(tagB64, 'base64'));
    return Buffer.concat([decipher.update(Buffer.from(bodyB64, 'base64')), decipher.final()]).toString('utf8');
  } catch (_) { return ''; } // wrong/changed WHATSAPP_CRED_KEY -> reported to HR, never silently ignored
}

function looksEncrypted(value) { return String(value == null ? '' : value).trim().startsWith(ENC_PREFIX); }

export function maskSecret(value) {
  const text = String(value == null ? '' : value).trim();
  if (!text) return '';
  if (text.length <= 8) return '••••••••';
  return `${text.slice(0, 4)}••••••••${text.slice(-4)}`;
}

/* --------------------------- schema (own table) --------------------------- */
export async function ensureWhatsAppProviderColumns(pool, sql) {
  if (columnsState === true) return;
  if (typeof columnsState === 'string') throw new Error(columnsState);
  const table = process.env.HR_WHATSAPP_CONFIG_TABLE || DEFAULT_CONFIG_TABLE;
  try {
    // Only this feature's own table is touched. Savior tables are never altered.
    await pool.request().batch(`
IF OBJECT_ID('${table}','U') IS NOT NULL AND COL_LENGTH('${table}','provider') IS NULL
ALTER TABLE ${table} ADD provider VARCHAR(20) NULL;
IF OBJECT_ID('${table}','U') IS NOT NULL AND COL_LENGTH('${table}','accesstoken') IS NULL
ALTER TABLE ${table} ADD accesstoken NVARCHAR(600) NULL;
IF OBJECT_ID('${table}','U') IS NOT NULL AND COL_LENGTH('${table}','appsecret') IS NULL
ALTER TABLE ${table} ADD appsecret NVARCHAR(600) NULL;
IF OBJECT_ID('${table}','U') IS NOT NULL AND COL_LENGTH('${table}','phonenumberid') IS NULL
ALTER TABLE ${table} ADD phonenumberid VARCHAR(60) NULL;
IF OBJECT_ID('${table}','U') IS NOT NULL AND COL_LENGTH('${table}','businessaccountid') IS NULL
ALTER TABLE ${table} ADD businessaccountid VARCHAR(60) NULL;
IF OBJECT_ID('${table}','U') IS NOT NULL AND COL_LENGTH('${table}','apiversion') IS NULL
ALTER TABLE ${table} ADD apiversion VARCHAR(20) NULL;
IF OBJECT_ID('${table}','U') IS NOT NULL AND COL_LENGTH('${table}','webhookverifytoken') IS NULL
ALTER TABLE ${table} ADD webhookverifytoken VARCHAR(200) NULL;
IF OBJECT_ID('${table}','U') IS NOT NULL AND COL_LENGTH('${table}','providerupdateddate') IS NULL
ALTER TABLE ${table} ADD providerupdateddate DATETIME2 NULL;
IF OBJECT_ID('${table}','U') IS NOT NULL AND COL_LENGTH('${table}','providerupdatedby') IS NULL
ALTER TABLE ${table} ADD providerupdatedby VARCHAR(50) NULL;`);
    columnsState = true;
  } catch (error) {
    columnsState = 'WhatsApp provider columns unavailable. Run server/whatsapp-schema.sql on the database (or set WHATSAPP_ACCESS_TOKEN in server .env). Detail: ' + (error && error.message || error).toString().slice(0, 140);
    throw new Error(columnsState);
  }
}

/* ------------------------------ settings I/O ------------------------------ */
function normalizeDbRow(row) {
  const accessToken = decryptSecret(row && row.accesstoken);
  const appSecret = decryptSecret(row && row.appsecret);
  return {
    provider: String((row && row.provider) || '').trim().toLowerCase(),
    accessToken,
    accessTokenEncryptedBroken: looksEncrypted(row && row.accesstoken) && !accessToken,
    appSecret,
    appSecretEncryptedBroken: looksEncrypted(row && row.appsecret) && !appSecret,
    phoneNumberId: String((row && row.phonenumberid) || '').trim(),
    businessAccountId: String((row && row.businessaccountid) || '').trim(),
    apiVersion: String((row && row.apiversion) || '').trim(),
    webhookVerifyToken: String((row && row.webhookverifytoken) || '').trim(),
    changedAt: row && row.providerupdateddate ? new Date(row.providerupdateddate).toISOString() : null,
    changedBy: (row && row.providerupdatedby) || null,
  };
}

function envFromSettings() {
  const accessToken = String(process.env[ENV_KEYS.accessToken] || '').trim();
  const phoneNumberId = String(process.env[ENV_KEYS.phoneNumberId] || '').trim();
  if (!accessToken && !phoneNumberId) return null;
  return {
    accessToken,
    appSecret: String(process.env[ENV_KEYS.appSecret] || '').trim(),
    phoneNumberId,
    businessAccountId: String(process.env[ENV_KEYS.businessAccountId] || '').trim(),
    apiVersion: String(process.env[ENV_KEYS.apiVersion] || '').trim(),
    webhookVerifyToken: String(process.env[ENV_KEYS.webhookVerifyToken] || '').trim(),
  };
}

function readiness(settings) {
  const accessToken = settings.accessToken;
  const phoneNumberId = settings.phoneNumberId;
  if (accessToken && phoneNumberId) return { configured: true, hint: '' };
  if (!accessToken && !phoneNumberId) return { configured: false, hint: 'WhatsApp Cloud API configure nahi hai — Provider Config tab me Access Token aur Phone Number ID save karo (ya .env me WHATSAPP_ACCESS_TOKEN / WHATSAPP_PHONE_NUMBER_ID daalo).' };
  if (!accessToken) return { configured: false, hint: 'WhatsApp Access Token missing — Provider Config tab me save karo.' };
  return { configured: false, hint: 'WhatsApp Phone Number ID missing — Provider Config tab me save karo.' };
}

/* Resolves the ACTIVE provider: database credentials first (set from the UI),
   then server .env (WHATSAPP_ACCESS_TOKEN / WHATSAPP_PHONE_NUMBER_ID), then
   "not configured". */
export async function getWhatsAppProviderSettings(pool) {
  let db = { provider: '', accessToken: '', appSecret: '', phoneNumberId: '', businessAccountId: '', apiVersion: '', webhookVerifyToken: '', changedAt: null, changedBy: null };
  let dbError = '';
  try {
    await ensureWhatsAppProviderColumns(pool);
    const table = process.env.HR_WHATSAPP_CONFIG_TABLE || DEFAULT_CONFIG_TABLE;
    const result = await pool.request().query(`SELECT TOP 1 provider, accesstoken, appsecret, phonenumberid, businessaccountid, apiversion, webhookverifytoken, providerupdateddate, providerupdatedby FROM ${table} ORDER BY id`);
    db = normalizeDbRow(result.recordset[0]);
  } catch (error) {
    dbError = (error && error.message || error).toString().slice(0, 200);
  }
  const env = envFromSettings();
  const broken = db.accessTokenEncryptedBroken || db.appSecretEncryptedBroken;
  const fromDb = db.accessToken && db.phoneNumberId;

  if (fromDb) {
    return { provider: 'cloudapi', source: 'database', ...db, ...readiness({ accessToken: db.accessToken, phoneNumberId: db.phoneNumberId }) };
  }
  if (env && env.accessToken && env.phoneNumberId) {
    return { provider: 'cloudapi', source: 'env', ...db, ...env, ...readiness({ accessToken: env.accessToken, phoneNumberId: env.phoneNumberId }) };
  }
  const hint = broken
    ? 'Saved WhatsApp credentials decrypt nahi ho pa rahe (WHATSAPP_CRED_KEY badal gaya). Provider Config tab me credentials dobara save karo.'
    : (dbError || readiness({ accessToken: '', phoneNumberId: '' }).hint);
  return { provider: 'cloudapi', source: dbError ? 'error' : 'none', ...db, configured: false, ready: false, hint };
}

/* Never hand this object to res.json() — it is the secret-free mirror. */
export function publicWhatsAppProviderStatus(settings) {
  const s = settings || {};
  return {
    provider: s.provider || 'cloudapi',
    source: s.source || 'none',
    configured: !!s.configured,
    ready: !!s.configured,
    hint: s.hint || '',
    accessTokenHint: s.accessToken ? maskSecret(s.accessToken) : '',
    hasAccessToken: !!s.accessToken,
    appSecretHint: s.appSecret ? maskSecret(s.appSecret) : '',
    hasAppSecret: !!s.appSecret,
    phoneNumberId: s.phoneNumberId || '',
    businessAccountId: s.businessAccountId || '',
    apiVersion: s.apiVersion || 'v21.0',
    webhookVerifyTokenHint: s.webhookVerifyToken ? maskSecret(s.webhookVerifyToken) : '',
    hasWebhookVerifyToken: !!s.webhookVerifyToken,
    envFallback: { accessToken: !!String(process.env[ENV_KEYS.accessToken] || '').trim(), phoneNumberId: !!String(process.env[ENV_KEYS.phoneNumberId] || '').trim() },
    changedAt: s.changedAt || null,
    changedBy: s.changedBy || null,
  };
}

function pickText(body, ...keys) {
  for (const key of keys) {
    if (body && body[key] !== undefined && body[key] !== null) return String(body[key]).trim();
  }
  return '';
}

/* Merge-safe save: only provided fields change; empty secret = keep existing.
   Non-secret provider fields (Phone Number ID, Business Account ID, API version,
   webhook verify token) follow the same documented rule: empty/absent = leave
   as-is, so a blank form can NEVER wipe the saved production configuration.
   An explicit removal needs the '*Clear' sentinel or a boolean <field>Clear flag. */
const PROVIDER_CLEAR_SENTINEL = '*clear';
function isClearRequest(value) { return String(value == null ? '' : value).trim().toLowerCase() === PROVIDER_CLEAR_SENTINEL; }

export async function saveWhatsAppProviderSettings(pool, sql, body, updatedBy) {
  const table = process.env.HR_WHATSAPP_CONFIG_TABLE || DEFAULT_CONFIG_TABLE;
  await ensureWhatsAppProviderColumns(pool);
  const b = body || {};

  const plainFields = [
    { keys: ['phoneNumberId', 'phonenumberid'], clearFlags: ['phoneNumberIdClear', 'clearPhoneNumberId'], input: 'phonenumberid', type: () => sql.VarChar(60) },
    { keys: ['businessAccountId', 'businessaccountid'], clearFlags: ['businessAccountIdClear', 'clearBusinessAccountId'], input: 'businessaccountid', type: () => sql.VarChar(60) },
    { keys: ['apiVersion', 'apiversion'], clearFlags: ['apiVersionClear', 'clearApiVersion'], input: 'apiversion', type: () => sql.VarChar(20) },
    { keys: ['webhookVerifyToken', 'webhookverifytoken'], clearFlags: ['webhookVerifyTokenClear', 'clearWebhookVerifyToken'], input: 'webhookverifytoken', type: () => sql.VarChar(200) },
  ];
  const clearing = (f) => f.clearFlags.some((k) => b[k] === true) || f.keys.some((k) => isClearRequest(b[k]));

  // Server-side format validation (safety rule): reject malformed provider
  // identifiers before anything is persisted. Real tokens/secrets are never
  // validated against Meta here — no network call is made.
  const apiVersionRaw = pickText(b, 'apiVersion', 'apiversion');
  if (apiVersionRaw && !isClearRequest(apiVersionRaw) && !/^v\d+(\.\d+)*$/i.test(apiVersionRaw)) {
    throw new Error('WhatsApp API version must look like "v21.0".');
  }
  const businessAccountIdRaw = pickText(b, 'businessAccountId', 'businessaccountid');
  if (businessAccountIdRaw && !isClearRequest(businessAccountIdRaw) && !/^\d+$/.test(businessAccountIdRaw)) {
    throw new Error('Business Account ID must be numeric (a Meta business account id — never a login username).');
  }
  const phoneNumberIdRaw = pickText(b, 'phoneNumberId', 'phonenumberid');
  if (phoneNumberIdRaw && !isClearRequest(phoneNumberIdRaw) && !/^\d+$/.test(phoneNumberIdRaw)) {
    throw new Error('Phone Number ID must be numeric.');
  }

  const request = pool.request();
  const sets = [];

  const accessToken = pickText(b, 'accessToken', 'accesstoken');
  if (b.accessTokenClear === true || b.clearAccessToken === true) { request.input('accesstoken', sql.NVarChar(600), null); sets.push('accesstoken = @accesstoken'); }
  else if (accessToken) { request.input('accesstoken', sql.NVarChar(600), encryptSecret(accessToken)); sets.push('accesstoken = @accesstoken'); }

  const appSecret = pickText(b, 'appSecret', 'appsecret');
  if (b.appSecretClear === true || b.clearAppSecret === true) { request.input('appsecret', sql.NVarChar(600), null); sets.push('appsecret = @appsecret'); }
  else if (appSecret) { request.input('appsecret', sql.NVarChar(600), encryptSecret(appSecret)); sets.push('appsecret = @appsecret'); }

  for (const f of plainFields) {
    const v = pickText(b, ...f.keys);
    if (clearing(f)) { request.input(f.input, f.type(), null); sets.push(`${f.input} = @${f.input}`); }
    else if (v) { request.input(f.input, f.type(), v); sets.push(`${f.input} = @${f.input}`); }
    // empty/absent -> leave the saved value as-is (never silently wipe).
  }

  if (!sets.length) throw new Error('No provider fields to update.');
  request.input('provider', sql.VarChar(20), 'cloudapi');
  sets.push('provider = @provider');
  request.input('updatedby', sql.VarChar(50), String(updatedBy || 'HR').slice(0, 50));
  await request.query(`UPDATE ${table} SET ${sets.join(', ')}, providerupdateddate = SYSUTCDATETIME(), providerupdatedby = @updatedby WHERE id = (SELECT TOP 1 id FROM ${table} ORDER BY id)`);
  return { saved: true, provider: 'cloudapi', fields: sets.length };
}

/* ----------------------------- Cloud API sending -------------------------- */
/**
 * Send a Meta WhatsApp Cloud API template message.
 * `msg` = { to, templateName, languageCode, bodyText } or
 *         { to, templateName, languageCode, components } (advanced templates).
 * Real sending is only ever invoked when mode=CLOUD_API + enabled + configured +
 * dry-run=false + HR-approved (enforced by the caller in server/index.js).
 */
export async function sendWhatsAppTemplate(settings, msg) {
  const active = settings || {};
  if (!active.configured) throw new Error(active.hint || 'WhatsApp Cloud API is not configured.');
  const phoneNumberId = String(active.phoneNumberId || '').trim();
  const accessToken = String(active.accessToken || '').trim();
  const apiVersion = String(active.apiVersion || 'v21.0').trim() || 'v21.0';
  if (!phoneNumberId || !accessToken) throw new Error('WhatsApp Phone Number ID / Access Token missing.');

  const template = {
    name: String(msg.templateName || 'attendance_update'),
    language: { code: String(msg.languageCode || 'en') },
  };
  if (Array.isArray(msg.components) && msg.components.length) {
    template.components = msg.components;
  } else if (msg.bodyText) {
    template.components = [{ type: 'body', parameters: [{ type: 'text', text: String(msg.bodyText) }] }];
  }

  const response = await fetch(`https://graph.facebook.com/${apiVersion}/${phoneNumberId}/messages`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      messaging_product: 'whatsapp',
      recipient_type: 'individual',
      to: String(msg.to),
      type: 'template',
      template,
    }),
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    const detail = (data && (data.error && data.error.message)) || (data && data.message) || `Cloud API HTTP ${response.status}`;
    throw new Error(detail);
  }
  return { messageId: (data && data.messages && data.messages[0] && data.messages[0].id) || null };
}

/* --------------------------- webhook signature ---------------------------- */
/** Verify Meta's X-Hub-Signature-256 (HMAC-SHA256) over the RAW request body. */
export function verifyWhatsAppWebhookSignature(rawBody, signature, appSecret) {
  if (!signature || !appSecret) return false;
  if (!String(signature).startsWith('sha256=')) return false;
  const expected = 'sha256=' + crypto.createHmac('sha256', String(appSecret)).update(rawBody).digest('hex');
  try {
    return crypto.timingSafeEqual(Buffer.from(String(signature)), Buffer.from(expected));
  } catch (_) { return false; }
}

export default {
  WHATSAPP_MODES, ENV_KEYS, DEFAULT_CONFIG_TABLE,
  ensureWhatsAppProviderColumns, getWhatsAppProviderSettings, publicWhatsAppProviderStatus,
  saveWhatsAppProviderSettings, sendWhatsAppTemplate, verifyWhatsAppWebhookSignature,
};



