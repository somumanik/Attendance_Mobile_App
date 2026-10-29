/* ============================================================================
   WHATSAPP RECIPIENT STORAGE — the ONLY place dbo.HR_EmployeeWhatsApp rows are
   written (managed recipient number + consent), mirroring whatsapp-provider.js.
   ----------------------------------------------------------------------------
   WHY THIS FILE EXISTS (protection rule):
   The HR-managed WhatsApp destination number and consent records must never be
   broken by future feature work, and Savior's dbo.tblemployee is NEVER written.
   All writes to the WhatsApp-specific recipient table live here so the focused
   tests (scripts/verify-whatsapp-v3.mjs) exercise the exact production code.

   FROZEN PUBLIC API (keep backwards compatible):
     getWhatsAppRecipientRow(pool, sql, paycode)     -> row | null (read-only)
     setWhatsAppRecipientNumber(pool, sql, opts)     -> number-only write
     upsertWhatsAppConsent(pool, sql, entry)         -> consent write (merge-safe)

   SAFETY RULES:
     - setWhatsAppRecipientNumber NEVER touches consentstatus / consentat /
       consentsource / optedoutat: saving a number never grants consent and
       never opts anyone in or out.
     - upsertWhatsAppConsent never wipes a saved managed number (empty incoming
       number keeps the stored one).
     - Both are durable SQL Server writes (no in-memory-only storage).
   ========================================================================== */

const RECIPIENT_TABLE = process.env.HR_WHATSAPP_EMPLOYEE_TABLE || 'dbo.HR_EmployeeWhatsApp';

export async function getWhatsAppRecipientRow(pool, sql, paycode) {
  const r = await pool.request()
    .input('paycode', sql.VarChar(50), String(paycode || ''))
    .query(`SELECT TOP 1 paycode, whatsappnumber, consentstatus, optedoutat FROM ${RECIPIENT_TABLE} WHERE paycode = @paycode`);
  return r.recordset[0] || null;
}

/* Save/update ONLY the WhatsApp destination number (E.164-normalised by the
   caller) for a Paycode. Consent columns are never written. */
export async function setWhatsAppRecipientNumber(pool, sql, opts) {
  await pool.request()
    .input('paycode', sql.VarChar(50), opts.paycode)
    .input('whatsappnumber', sql.VarChar(20), opts.whatsappnumber)
    .input('companycode', sql.VarChar(30), opts.companycode || null)
    .input('departmentcode', sql.VarChar(30), opts.departmentcode || null)
    .input('employeename', sql.NVarChar(120), opts.employeename || null)
    .query(`IF EXISTS (SELECT 1 FROM ${RECIPIENT_TABLE} WHERE paycode = @paycode)
UPDATE ${RECIPIENT_TABLE} SET whatsappnumber = @whatsappnumber, companycode = COALESCE(@companycode, companycode), departmentcode = COALESCE(@departmentcode, departmentcode), employeename = COALESCE(@employeename, employeename), updateddate = SYSUTCDATETIME() WHERE paycode = @paycode
ELSE
INSERT INTO ${RECIPIENT_TABLE} (paycode, whatsappnumber, consentstatus, companycode, departmentcode, employeename) VALUES (@paycode, @whatsappnumber, 'None', @companycode, @departmentcode, @employeename);`);
  return { paycode: opts.paycode, whatsappnumber: opts.whatsappnumber };
}

export async function upsertWhatsAppConsent(pool, sql, entry) {
  await pool.request()
    .input('paycode', sql.VarChar(50), entry.paycode)
    .input('whatsappnumber', sql.VarChar(20), entry.whatsappnumber || '')
    .input('consentstatus', sql.VarChar(20), entry.consentstatus)
    .input('consentat', sql.DateTime2, entry.consentat || null)
    .input('consentsource', sql.VarChar(50), entry.consentsource || null)
    .input('optedoutat', sql.DateTime2, entry.optedoutat || null)
    .input('companycode', sql.VarChar(30), entry.companycode || null)
    .input('departmentcode', sql.VarChar(30), entry.departmentcode || null)
    .input('employeename', sql.NVarChar(120), entry.employeename || null)
    .query(`MERGE ${RECIPIENT_TABLE} WITH (HOLDLOCK) AS t USING (SELECT @paycode AS paycode) AS s ON t.paycode = s.paycode
WHEN MATCHED THEN UPDATE SET whatsappnumber = COALESCE(NULLIF(@whatsappnumber, ''), t.whatsappnumber), consentstatus = @consentstatus, consentat = COALESCE(@consentat, t.consentat), consentsource = COALESCE(@consentsource, t.consentsource), optedoutat = @optedoutat, companycode = COALESCE(@companycode, t.companycode), departmentcode = COALESCE(@departmentcode, t.departmentcode), employeename = COALESCE(@employeename, t.employeename), updateddate = SYSUTCDATETIME()
WHEN NOT MATCHED THEN INSERT (paycode, whatsappnumber, consentstatus, consentat, consentsource, optedoutat, companycode, departmentcode, employeename) VALUES (@paycode, @whatsappnumber, @consentstatus, @consentat, @consentsource, @optedoutat, @companycode, @departmentcode, @employeename)
OUTPUT $action;`);
}

export default { getWhatsAppRecipientRow, setWhatsAppRecipientNumber, upsertWhatsAppConsent };