-- ============================================================================
-- REFERENCE DDL — application-owned employee credential store
-- ----------------------------------------------------------------------------
-- This table belongs to the Attendance application. It is NOT a Savior table.
-- dbo.tblemployee and every attendance table stay untouched — only the
-- paycode is read from dbo.tblemployee as the employee identity.
--
-- The running server creates this table automatically (server/employee-auth.js
-- ensureEmployeeAuthTables) using the exact same DDL. This file exists only so
-- a DBA can provision it up-front with a login that has CREATE rights.
--
-- Passwords are stored ONLY as scrypt hashes + per-credential salt.
-- Plaintext passwords and PINs are never stored here.
-- ============================================================================

IF OBJECT_ID('dbo.HR_EmployeeAuth','U') IS NULL
CREATE TABLE dbo.HR_EmployeeAuth (
  paycode VARCHAR(50) NOT NULL CONSTRAINT UQ_HREmpAuth_Paycode UNIQUE,
  -- password credential
  passwordhash NVARCHAR(200) NULL,
  passwordsalt NVARCHAR(100) NULL,
  passwordalgo VARCHAR(20) NULL,
  passwordsetat DATETIME2 NULL,
  passwordupdatedat DATETIME2 NULL,
  mustchangepassword BIT NOT NULL CONSTRAINT DF_HREmpAuth_MustChange DEFAULT(0),
  -- 4-digit PIN credential (reserved for a later phase; NULL until provisioned)
  pinhash NVARCHAR(200) NULL,
  pinsalt NVARCHAR(100) NULL,
  pinalgo VARCHAR(20) NULL,
  pinsetat DATETIME2 NULL,
  pinupdatedat DATETIME2 NULL,
  -- account state
  isactive BIT NOT NULL CONSTRAINT DF_HREmpAuth_IsActive DEFAULT(1),
  failedattempts INT NOT NULL CONSTRAINT DF_HREmpAuth_Failed DEFAULT(0),
  lockeduntil DATETIME2 NULL,
  lastloginat DATETIME2 NULL,
  pwdversion INT NOT NULL CONSTRAINT DF_HREmpAuth_PwdVer DEFAULT(1),
  -- audit
  createdat DATETIME2 NOT NULL CONSTRAINT DF_HREmpAuth_Created DEFAULT SYSUTCDATETIME(),
  updatedat DATETIME2 NOT NULL CONSTRAINT DF_HREmpAuth_Updated DEFAULT SYSUTCDATETIME(),
  createdby VARCHAR(50) NULL,
  updatedby VARCHAR(50) NULL
);
