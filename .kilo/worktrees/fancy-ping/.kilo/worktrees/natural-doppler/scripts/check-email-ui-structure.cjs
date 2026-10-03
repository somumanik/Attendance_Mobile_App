/* Ad-hoc structural check: duplicate DOM ids + handler/function resolution. */
const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');

const ids = [...html.matchAll(/\sid="([^"]+)"/g)].map((m) => m[1]);
const dupes = ids.filter((id, i) => ids.indexOf(id) !== i);
console.log('duplicate ids:', dupes.length ? [...new Set(dupes)].join(', ') : 'none');

const required = [
  'emProviderType', 'emBrevoKey', 'emBrevoFields', 'emSmtpFields', 'emSmtpHost', 'emSmtpPort',
  'emSmtpUser', 'emSmtpPassword', 'emSmtpSecure', 'emApiKeyStatus', 'emSaveBtn', 'emSenderName',
  'emSenderEmail', 'emTestTo', 'emTestBtn', 'emTestStatus', 'emailStatusRow', 'emSourceCounts',
  'emTab-provider', 'emTab-source', 'emTab-single', 'emTab-bulk', 'emTab-templates', 'emTab-logs'
];
const missing = required.filter((id) => !ids.includes(id));
console.log('missing required ids:', missing.length ? missing.join(', ') : 'none');

const handlers = [...html.matchAll(/on(?:click|change)="([A-Za-z_$][\w$]*)\(/g)].map((m) => m[1]);
const defined = new Set([...html.matchAll(/function\s+([A-Za-z_$][\w$]*)\s*\(/g)].map((m) => m[1]));
const skip = new Set(['if', 'for', 'while', 'switch', 'return', 'function', 'var', 'let', 'const']);
const dangling = [...new Set(handlers)].filter((h) => !defined.has(h) && !skip.has(h));
console.log('email handlers dangling:', dangling.length ? dangling.join(', ') : 'none');

process.exitCode = dupes.length || missing.length || dangling.length ? 1 : 0;
