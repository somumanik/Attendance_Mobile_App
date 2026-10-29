// scripts/diag-whatsapp-v4.mjs — READ-ONLY WhatsApp V4 diagnostic.
// Purpose (never writes anything):
//  1. Inspect the SAVED WhatsApp template in dbo.HR_WhatsAppConfig: does it contain
//     literal U+FFFD replacement characters (the "diamond/question" glyph) or clean
//     emoji? -> answers where the received-message corruption comes from.
//  2. Trace Paycode 1109 (or DIAG_PAYCODE): employee row, assigned shift,
//     tblshiftmaster start time, and tbltimeregister rows -> so "Grace Used" can be
//     checked against the authoritative shift start instead of guessed.
import 'dotenv/config';
import sql from 'mssql';

const PAYCODE = String(process.env.DIAG_PAYCODE || '1109').trim();

function cps(s, n = 60) {
  return [...String(s || '').slice(0, n)].map((ch) => {
    const c = ch.codePointAt(0);
    return `U+${c.toString(16).toUpperCase().padStart(4, '0')}`;
  }).join(' ');
}

const pool = await sql.connect({
  server: process.env.DB_SERVER,
  port: Number(process.env.DB_PORT || 1433),
  database: process.env.DB_DATABASE,
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  options: { encrypt: String(process.env.DB_ENCRYPT || 'false').toLowerCase() === 'true', trustServerCertificate: String(process.env.DB_TRUST_CERT || 'true').toLowerCase() === 'true' },
  requestTimeout: 30000,
});

console.log('=== 1. SAVED WHATSAPP TEMPLATE (HR_WhatsAppConfig) — READ ONLY ===');
try {
  const r = await pool.request().query('SELECT TOP 1 templatebody, templatename, templatelanguage FROM dbo.HR_WhatsAppConfig ORDER BY id');
  const row = r.recordset[0];
  if (!row) { console.log('NO CONFIG ROW'); }
  else {
    const tb = String(row.templatebody || '');
    console.log('templatename:', row.templatename, '| length:', tb.length);
    console.log('contains U+FFFD:', tb.includes('\uFFFD'), '| count:', [...tb].filter((c) => c.codePointAt(0) === 0xFFFD).length);
    console.log('contains U+FE0F (variation selector):', tb.includes('\uFE0F'));
    console.log('code points of first 60 chars:\n ', cps(tb));
    console.log('--- template text ---\n' + tb + '\n--- end ---');
  }
} catch (e) { console.log('template read FAILED:', e.message); }

console.log(`\n=== 2. PAYCODE ${PAYCODE} TRACE — READ ONLY ===`);
try {
  const emp = await pool.request().input('paycode', sql.VarChar(50), PAYCODE)
    .query(`SELECT LTRIM(RTRIM(paycode)) AS paycode, LTRIM(RTRIM(empname)) AS empname, LTRIM(RTRIM(cat)) AS cat, LTRIM(RTRIM(companycode)) AS companycode, LTRIM(RTRIM(telephone1)) AS telephone1, active FROM dbo.tblemployee WHERE LTRIM(RTRIM(paycode)) = @paycode`);
  console.log('employee:', emp.recordset[0] || 'NOT FOUND');

  const sh = await pool.request().input('paycode', sql.VarChar(50), PAYCODE)
    .query(`SELECT LTRIM(RTRIM(shift)) AS shift FROM dbo.tblemployeeshiftmaster WHERE LTRIM(RTRIM(paycode)) = @paycode`);
  const shiftCode = String(sh.recordset?.[0]?.shift || '').trim();
  console.log('assigned shift code:', shiftCode || '(none)');

  if (shiftCode) {
    const sm = await pool.request().input('shift', sql.VarChar(20), shiftCode)
      .query(`SELECT LTRIM(RTRIM(shift)) AS shift, LTRIM(RTRIM(companycode)) AS companycode, starttime, endtime FROM dbo.tblshiftmaster WHERE LTRIM(RTRIM(shift)) = @shift`);
    for (const s of sm.recordset) console.log('shiftmaster row:', s.shift, '| company:', s.companycode, '| start:', s.starttime, '| end:', s.endtime);
  }

  const reg = await pool.request().input('paycode', sql.VarChar(50), PAYCODE)
    .query(`SELECT TOP 10 CONVERT(varchar(10), dateoffice, 23) AS dateoffice, LTRIM(RTRIM(shift)) AS shift, in1, in2, out1, out2, status, latearrival
            FROM dbo.tbltimeregister WHERE LTRIM(RTRIM(paycode)) = @paycode AND (in1 IS NOT NULL OR in2 IS NOT NULL)
            ORDER BY dateoffice DESC`);
  console.log('recent punch rows (latest 10 with IN):');
  for (const row of reg.recordset) {
    const inM = (v) => { if (!v) return null; const d = v instanceof Date ? v : new Date(v); return Number.isNaN(d.valueOf()) ? null : d.getUTCHours() * 60 + d.getUTCMinutes(); };
    const fmt = (m) => m === null ? '-' : `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
    console.log(`  ${row.dateoffice} shift=${row.shift || '-'} in=${fmt(inM(row.in1) ?? inM(row.in2))} out=${fmt(inM(row.out1) ?? inM(row.out2))} status=${row.status} latearrival=${row.latearrival}`);
  }

  // Rows where IN punch is around 10:05 AM (the screenshot case).
  const ten = await pool.request().input('paycode', sql.VarChar(50), PAYCODE)
    .query(`SELECT TOP 8 CONVERT(varchar(10), dateoffice, 23) AS dateoffice, LTRIM(RTRIM(shift)) AS shift, in1, in2, status, latearrival
            FROM dbo.tbltimeregister WHERE LTRIM(RTRIM(paycode)) = @paycode AND (
              (in1 IS NOT NULL AND DATEPART(HOUR, in1) = 10 AND DATEPART(MINUTE, in1) BETWEEN 0 AND 10) OR
              (in2 IS NOT NULL AND DATEPART(HOUR, in2) = 10 AND DATEPART(MINUTE, in2) BETWEEN 0 AND 10))
            ORDER BY dateoffice DESC`);
  console.log('rows with IN punch 10:00-10:10 (screenshot window):');
  for (const row of ten.recordset) console.log(' ', JSON.stringify(row));
} catch (e) { console.log('paycode trace FAILED:', e.message); }

await pool.close();
console.log('\nDIAG DONE (read-only).');