IF OBJECT_ID('dbo.HR_MarriageAnniversary','U') IS NULL
CREATE TABLE dbo.HR_MarriageAnniversary (
  id INT IDENTITY(1,1) PRIMARY KEY,
  paycode VARCHAR(50) NOT NULL,
  presentcardno VARCHAR(50) NULL,
  anniversarydate DATE NOT NULL,
  createddate DATETIME2 NOT NULL CONSTRAINT DF_HRMarriage_Created DEFAULT SYSUTCDATETIME(),
  updateddate DATETIME2 NOT NULL CONSTRAINT DF_HRMarriage_Updated DEFAULT SYSUTCDATETIME(),
  importedby VARCHAR(50) NULL,
  CONSTRAINT UQ_HRMarriage_Paycode UNIQUE (paycode)
);

CREATE TABLE dbo.HR_EmailConfig (
  id INT IDENTITY(1,1) PRIMARY KEY,
  sendername NVARCHAR(120) NULL, senderemail VARCHAR(150) NULL,
  birthdayenabled BIT NOT NULL CONSTRAINT DF_HREmailCfg_B DEFAULT(0),
  marriageenabled BIT NOT NULL CONSTRAINT DF_HREmailCfg_M DEFAULT(0),
  workanniversaryenabled BIT NOT NULL CONSTRAINT DF_HREmailCfg_W DEFAULT(0),
  birthdaysubject NVARCHAR(200) NULL, birthdaybody NVARCHAR(MAX) NULL,
  marriagesubject NVARCHAR(200) NULL, marriagebody NVARCHAR(MAX) NULL,
  workanniversarysubject NVARCHAR(200) NULL, workanniversarybody NVARCHAR(MAX) NULL,
  customsubject NVARCHAR(200) NULL, custombody NVARCHAR(MAX) NULL,
  updateddate DATETIME2 NOT NULL CONSTRAINT DF_HREmailCfg_U DEFAULT SYSUTCDATETIME(), updatedby VARCHAR(50) NULL
);

-- Provider + credentials (managed by server/email-provider.js).
-- Secrets are AES-256-GCM encrypted by the server before they reach these columns.
IF COL_LENGTH('dbo.HR_EmailConfig','emailprovider') IS NULL
ALTER TABLE dbo.HR_EmailConfig ADD emailprovider VARCHAR(20) NULL;
IF COL_LENGTH('dbo.HR_EmailConfig','brevoapikey') IS NULL
ALTER TABLE dbo.HR_EmailConfig ADD brevoapikey NVARCHAR(600) NULL;
IF COL_LENGTH('dbo.HR_EmailConfig','smtphost') IS NULL
ALTER TABLE dbo.HR_EmailConfig ADD smtphost VARCHAR(150) NULL;
IF COL_LENGTH('dbo.HR_EmailConfig','smtpport') IS NULL
ALTER TABLE dbo.HR_EmailConfig ADD smtpport INT NULL;
IF COL_LENGTH('dbo.HR_EmailConfig','smtpsecure') IS NULL
ALTER TABLE dbo.HR_EmailConfig ADD smtpsecure BIT NULL;
IF COL_LENGTH('dbo.HR_EmailConfig','smtpuser') IS NULL
ALTER TABLE dbo.HR_EmailConfig ADD smtpuser VARCHAR(150) NULL;
IF COL_LENGTH('dbo.HR_EmailConfig','smtppassword') IS NULL
ALTER TABLE dbo.HR_EmailConfig ADD smtppassword NVARCHAR(600) NULL;
IF COL_LENGTH('dbo.HR_EmailConfig','providerupdateddate') IS NULL
ALTER TABLE dbo.HR_EmailConfig ADD providerupdateddate DATETIME2 NULL;
IF COL_LENGTH('dbo.HR_EmailConfig','providerupdatedby') IS NULL
ALTER TABLE dbo.HR_EmailConfig ADD providerupdatedby VARCHAR(50) NULL;

CREATE TABLE dbo.HR_EmployeeEmails (
  id INT IDENTITY(1,1) PRIMARY KEY,
  paycode VARCHAR(50) NOT NULL CONSTRAINT UQ_HREmpEmail_P UNIQUE,
  email VARCHAR(150) NOT NULL, companycode VARCHAR(30) NULL, departmentcode VARCHAR(30) NULL, employeename NVARCHAR(120) NULL,
  createddate DATETIME2 NOT NULL CONSTRAINT DF_HREmpEmail_C DEFAULT SYSUTCDATETIME(),
  updateddate DATETIME2 NOT NULL CONSTRAINT DF_HREmpEmail_U DEFAULT SYSUTCDATETIME()
);

CREATE TABLE dbo.HR_EmailLog (
  id INT IDENTITY(1,1) PRIMARY KEY,
  paycode VARCHAR(50) NULL, employeename NVARCHAR(120) NULL, companycode VARCHAR(30) NULL, departmentcode VARCHAR(30) NULL,
  eventtype VARCHAR(30) NOT NULL, eventdate DATE NOT NULL, recipientemail VARCHAR(150) NULL,
  sentat DATETIME2 NOT NULL CONSTRAINT DF_HREmailLog_S DEFAULT SYSUTCDATETIME(),
  status VARCHAR(20) NOT NULL, providermessageid VARCHAR(150) NULL, errormessage NVARCHAR(500) NULL
);
