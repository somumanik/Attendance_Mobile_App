-- ============================================================================
-- WhatsApp Attendance Messaging (V1) — APPLICATION tables ONLY, NOT Savior tables.
-- ----------------------------------------------------------------------------
-- Reference DDL (mirrors server/email-schema.sql). The running server also
-- auto-ensures these tables on first use (server/index.js ensureWhatsAppTables +
-- server/whatsapp-provider.js ensureWhatsAppProviderColumns).
--
-- dbo.tblemployee, dbo.tbltimeregister, dbo.machinerawpunch, dbo.tblcategory,
-- dbo.tblemployeeshiftmaster and every other Savior table are never created or
-- altered by this script. It only reads dbo.tblemployee.telephone1 (mobile
-- number), dbo.tblemployee.cat (category code) and the attendance tables.
--
-- REQUIRED SERVER .env (NOT committed; add manually to server/.env):
--   WHATSAPP_MODE=FREE_MANUAL            # FREE_MANUAL | CLOUD_API
--   WHATSAPP_ENABLED=false
--   WHATSAPP_SEND_TIME=21:00
--   WHATSAPP_TIMEZONE=Asia/Kolkata
--   WHATSAPP_ELIGIBLE_CATEGORY=          # empty = reuse staff (STAFF/STF) rule
--   WHATSAPP_DRY_RUN=true
--   WHATSAPP_ACCESS_TOKEN=               # Cloud API only (or save via HR UI)
--   WHATSAPP_PHONE_NUMBER_ID=
--   WHATSAPP_BUSINESS_ACCOUNT_ID=
--   WHATSAPP_API_VERSION=v21.0
--   WHATSAPP_APP_SECRET=                 # webhook HMAC verification
--   WHATSAPP_WEBHOOK_VERIFY_TOKEN=
--   WHATSAPP_CRED_KEY=                   # optional; else JWT_SECRET-derived
--   HR_WHATSAPP_CONFIG_TABLE=dbo.HR_WhatsAppConfig
--   HR_WHATSAPP_EMPLOYEE_TABLE=dbo.HR_EmployeeWhatsApp
--   HR_WHATSAPP_LOG_TABLE=dbo.HR_WhatsAppLog
--   HR_WHATSAPP_JOBRUN_TABLE=dbo.HR_WhatsAppJobRun
-- ============================================================================

-- WhatsApp feature configuration. One row only (id = 1). Provider/credential
-- columns are owned by server/whatsapp-provider.js (encrypted at rest).
IF OBJECT_ID('dbo.HR_WhatsAppConfig','U') IS NULL
CREATE TABLE dbo.HR_WhatsAppConfig (
  id INT IDENTITY(1,1) PRIMARY KEY,
  enabled BIT NOT NULL CONSTRAINT DF_WhatsAppCfg_Enabled DEFAULT(0),
  mode VARCHAR(20) NOT NULL CONSTRAINT DF_WhatsAppCfg_Mode DEFAULT('FREE_MANUAL'),
  sendtime VARCHAR(5) NOT NULL CONSTRAINT DF_WhatsAppCfg_Time DEFAULT('21:00'),
  timezone VARCHAR(64) NOT NULL CONSTRAINT DF_WhatsAppCfg_Tz DEFAULT('Asia/Kolkata'),
  eligiblecategory VARCHAR(50) NULL,
  dryrun BIT NOT NULL CONSTRAINT DF_WhatsAppCfg_Dry DEFAULT(1),
  sendername NVARCHAR(120) NULL,
  templatename VARCHAR(200) NULL,
  templatelanguage VARCHAR(20) NOT NULL CONSTRAINT DF_WhatsAppCfg_Lang DEFAULT('en'),
  templatebody NVARCHAR(MAX) NULL,
  approved BIT NOT NULL CONSTRAINT DF_WhatsAppCfg_Approved DEFAULT(0),
  updateddate DATETIME2 NOT NULL CONSTRAINT DF_WhatsAppCfg_Upd DEFAULT SYSUTCDATETIME(),
  updatedby VARCHAR(50) NULL
);

-- Provider/credential columns (managed by server/whatsapp-provider.js).
-- Secrets (accesstoken, appsecret) are AES-256-GCM encrypted before storage.
IF COL_LENGTH('dbo.HR_WhatsAppConfig','provider') IS NULL
ALTER TABLE dbo.HR_WhatsAppConfig ADD provider VARCHAR(20) NULL;
IF COL_LENGTH('dbo.HR_WhatsAppConfig','accesstoken') IS NULL
ALTER TABLE dbo.HR_WhatsAppConfig ADD accesstoken NVARCHAR(600) NULL;
IF COL_LENGTH('dbo.HR_WhatsAppConfig','appsecret') IS NULL
ALTER TABLE dbo.HR_WhatsAppConfig ADD appsecret NVARCHAR(600) NULL;
IF COL_LENGTH('dbo.HR_WhatsAppConfig','phonenumberid') IS NULL
ALTER TABLE dbo.HR_WhatsAppConfig ADD phonenumberid VARCHAR(60) NULL;
IF COL_LENGTH('dbo.HR_WhatsAppConfig','businessaccountid') IS NULL
ALTER TABLE dbo.HR_WhatsAppConfig ADD businessaccountid VARCHAR(60) NULL;
IF COL_LENGTH('dbo.HR_WhatsAppConfig','apiversion') IS NULL
ALTER TABLE dbo.HR_WhatsAppConfig ADD apiversion VARCHAR(20) NULL;
IF COL_LENGTH('dbo.HR_WhatsAppConfig','webhookverifytoken') IS NULL
ALTER TABLE dbo.HR_WhatsAppConfig ADD webhookverifytoken VARCHAR(200) NULL;
IF COL_LENGTH('dbo.HR_WhatsAppConfig','providerupdateddate') IS NULL
ALTER TABLE dbo.HR_WhatsAppConfig ADD providerupdateddate DATETIME2 NULL;
IF COL_LENGTH('dbo.HR_WhatsAppConfig','providerupdatedby') IS NULL
ALTER TABLE dbo.HR_WhatsAppConfig ADD providerupdatedby VARCHAR(50) NULL;

-- HR-managed WhatsApp consent + normalized number. A number on file does NOT
-- imply consent: consentstatus must be 'Granted' for the employee to be eligible.
IF OBJECT_ID('dbo.HR_EmployeeWhatsApp','U') IS NULL
CREATE TABLE dbo.HR_EmployeeWhatsApp (
  id INT IDENTITY(1,1) PRIMARY KEY,
  paycode VARCHAR(50) NOT NULL CONSTRAINT UQ_WhatsAppEmp_Paycode UNIQUE,
  whatsappnumber VARCHAR(20) NOT NULL,
  consentstatus VARCHAR(20) NOT NULL CONSTRAINT DF_WhatsAppEmp_Consent DEFAULT('None'),
  consentat DATETIME2 NULL,
  consentsource VARCHAR(50) NULL,
  optedoutat DATETIME2 NULL,
  companycode VARCHAR(30) NULL,
  departmentcode VARCHAR(30) NULL,
  employeename NVARCHAR(120) NULL,
  createddate DATETIME2 NOT NULL CONSTRAINT DF_WhatsAppEmp_Created DEFAULT SYSUTCDATETIME(),
  updateddate DATETIME2 NOT NULL CONSTRAINT DF_WhatsAppEmp_Updated DEFAULT SYSUTCDATETIME()
);

-- Message log (durable). idempotencykey is unique for SUCCESSFUL sends only, so
-- retries of a Failed message remain possible while duplicate sends are blocked.
IF OBJECT_ID('dbo.HR_WhatsAppLog','U') IS NULL
CREATE TABLE dbo.HR_WhatsAppLog (
  id INT IDENTITY(1,1) PRIMARY KEY,
  paycode VARCHAR(50) NULL,
  employeename NVARCHAR(120) NULL,
  companycode VARCHAR(30) NULL,
  departmentcode VARCHAR(30) NULL,
  messagetype VARCHAR(30) NOT NULL CONSTRAINT DF_WhatsAppLog_Type DEFAULT('Attendance'),
  attendancedate DATE NULL,
  recipientnumber VARCHAR(20) NULL,
  status VARCHAR(20) NOT NULL,
  providermessageid VARCHAR(150) NULL,
  attemptcount INT NOT NULL CONSTRAINT DF_WhatsAppLog_Attempt DEFAULT(0),
  idempotencykey VARCHAR(120) NULL,
  errormessage NVARCHAR(500) NULL,
  createdat DATETIME2 NOT NULL CONSTRAINT DF_WhatsAppLog_Created DEFAULT SYSUTCDATETIME(),
  sentat DATETIME2 NULL,
  updatedat DATETIME2 NOT NULL CONSTRAINT DF_WhatsAppLog_Updated DEFAULT SYSUTCDATETIME()
);
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'UQ_WhatsAppLog_Idem' AND object_id = OBJECT_ID('dbo.HR_WhatsAppLog'))
CREATE UNIQUE INDEX UQ_WhatsAppLog_Idem ON dbo.HR_WhatsAppLog(idempotencykey) WHERE idempotencykey IS NOT NULL;

-- Durable job-run bookkeeping (idempotency + audit for the 21:00 IST scheduler).
IF OBJECT_ID('dbo.HR_WhatsAppJobRun','U') IS NULL
CREATE TABLE dbo.HR_WhatsAppJobRun (
  id INT IDENTITY(1,1) PRIMARY KEY,
  rundate DATE NOT NULL,
  messagetype VARCHAR(30) NOT NULL CONSTRAINT DF_WhatsAppJobRun_Type DEFAULT('Attendance'),
  mode VARCHAR(20) NULL,
  status VARCHAR(20) NOT NULL,
  startedat DATETIME2 NOT NULL CONSTRAINT DF_WhatsAppJobRun_Started DEFAULT SYSUTCDATETIME(),
  finishedat DATETIME2 NULL,
  total INT NOT NULL CONSTRAINT DF_WhatsAppJobRun_Total DEFAULT(0),
  sent INT NOT NULL CONSTRAINT DF_WhatsAppJobRun_Sent DEFAULT(0),
  failed INT NOT NULL CONSTRAINT DF_WhatsAppJobRun_Failed DEFAULT(0),
  skipped INT NOT NULL CONSTRAINT DF_WhatsAppJobRun_Skipped DEFAULT(0),
  note NVARCHAR(500) NULL
);

