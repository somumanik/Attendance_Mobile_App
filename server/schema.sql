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

-- ============================================================================
-- Holiday Management (Phase G) — APPLICATION tables, NOT Savior tables.
-- dbo.tblemployee, dbo.tbltimeregister, dbo.machinerawpunch, dbo.tblcategory and
-- every other Savior table are never created or altered by these scripts.
-- The running server also auto-ensures these on first use.
-- ============================================================================

-- The holiday records. "category" is an HR-managed group name (see below), NOT a
-- Savior employee category, so additional groups need no code change.
CREATE TABLE dbo.HR_Holidays (
  id INT IDENTITY(1,1) PRIMARY KEY,
  holidaydate DATE NOT NULL,
  holidayname NVARCHAR(200) NOT NULL,
  category NVARCHAR(50) NOT NULL,
  description NVARCHAR(500) NULL,
  companycode VARCHAR(50) NULL, -- Optional company / location
  active BIT NOT NULL CONSTRAINT DF_HRHoliday_Active DEFAULT(1),
  createddate DATETIME2 NOT NULL CONSTRAINT DF_HRHoliday_Created DEFAULT SYSUTCDATETIME(),
  updateddate DATETIME2 NOT NULL CONSTRAINT DF_HRHoliday_Updated DEFAULT SYSUTCDATETIME(),
  createdby VARCHAR(50) NULL,
  -- Duplicate rule: the SAME date may repeat, but only for a DIFFERENT category.
  CONSTRAINT UQ_HRHoliday_DateCategory UNIQUE (holidaydate, category)
);

-- The category list. Seeded with the three groups Phase G requires; HR can add
-- more later without any code change.
CREATE TABLE dbo.HR_HolidayCategories (
  id INT IDENTITY(1,1) PRIMARY KEY,
  categoryname NVARCHAR(50) NOT NULL,
  sortorder INT NOT NULL CONSTRAINT DF_HRHolidayCat_Sort DEFAULT(0),
  active BIT NOT NULL CONSTRAINT DF_HRHolidayCat_Active DEFAULT(1),
  createddate DATETIME2 NOT NULL CONSTRAINT DF_HRHolidayCat_Created DEFAULT SYSUTCDATETIME(),
  CONSTRAINT UQ_HRHolidayCat_Name UNIQUE (categoryname)
);

INSERT INTO dbo.HR_HolidayCategories (categoryname, sortorder, active) VALUES
  ('All Employees', 1, 1),
  ('Factory Staff', 2, 1),
  ('Office Staff',  3, 1);

-- Which REAL Savior employee category code (dbo.tblemployee.cat) belongs to which
-- holiday group. Seeded automatically from real dbo.tblemployee / dbo.tblcategory
-- data using the project's existing STAFF/STF rule; HR may override any row.
CREATE TABLE dbo.HR_HolidayCategoryMap (
  id INT IDENTITY(1,1) PRIMARY KEY,
  categorycode VARCHAR(50) NOT NULL,
  holidaycategory NVARCHAR(50) NOT NULL,
  active BIT NOT NULL CONSTRAINT DF_HRHolidayCatMap_Active DEFAULT(1),
  updateddate DATETIME2 NOT NULL CONSTRAINT DF_HRHolidayCatMap_Updated DEFAULT SYSUTCDATETIME(),
  CONSTRAINT UQ_HRHolidayCatMap_Code UNIQUE (categorycode)
);

-- ============================================================================
-- Employee Leave Management (Phase J) — APPLICATION tables, NOT Savior tables.
-- dbo.tblemployee / dbo.tblemployeeshiftmaster / dbo.tbltimeregister are only
-- ever READ (identity + real week-off day). An APPROVED leave never changes a
-- Savior attendance record - it is an application-level overlay.
-- The running server auto-ensures these on first use (server/leave-service.js
-- ensureLeaveTables); this block is the documented mirror of that DDL.
-- ============================================================================

-- Configurable leave types (PL / SL / CL / OLA / OLB seeds + anything HR adds).
CREATE TABLE dbo.HR_LeaveTypes (
  id INT IDENTITY(1,1) PRIMARY KEY,
  leavetype NVARCHAR(10) NOT NULL,
  typename NVARCHAR(100) NOT NULL,
  sortorder INT NOT NULL CONSTRAINT DF_LeaveType_Sort DEFAULT(0),
  active BIT NOT NULL CONSTRAINT DF_LeaveType_Active DEFAULT(1),
  createddate DATETIME2 NOT NULL CONSTRAINT DF_LeaveType_Created DEFAULT SYSUTCDATETIME(),
  CONSTRAINT UQ_LeaveType_Code UNIQUE (leavetype)
);

-- Per employee + leave year + type opening balance (imported by HR from Excel).
CREATE TABLE dbo.HR_LeaveBalance (
  id INT IDENTITY(1,1) PRIMARY KEY,
  paycode NVARCHAR(50) NOT NULL,
  leaveyear INT NOT NULL,
  leavetype NVARCHAR(10) NOT NULL,
  openingbalance NUMERIC(9,2) NOT NULL CONSTRAINT DF_LeaveBal_Opening DEFAULT(0),
  createddate DATETIME2 NOT NULL CONSTRAINT DF_LeaveBal_Created DEFAULT SYSUTCDATETIME(),
  updateddate DATETIME2 NOT NULL CONSTRAINT DF_LeaveBal_Updated DEFAULT SYSUTCDATETIME(),
  updatedby NVARCHAR(50) NULL,
  CONSTRAINT UQ_LeaveBal UNIQUE (paycode, leaveyear, leavetype)
);

-- The leave requests themselves. Server owns the day count (week-offs and
-- holidays excluded); a pending request only encumbers the balance.
CREATE TABLE dbo.HR_LeaveRequest (
  id INT IDENTITY(1,1) PRIMARY KEY,
  paycode NVARCHAR(50) NOT NULL,
  leaveyear INT NOT NULL,
  leavetype NVARCHAR(10) NOT NULL,
  fromdate DATE NOT NULL,
  todate DATE NOT NULL,
  ishalfday BIT NOT NULL CONSTRAINT DF_LeaveReq_Half DEFAULT(0),
  halfdaypart NVARCHAR(10) NULL,
  days NUMERIC(9,2) NOT NULL CONSTRAINT DF_LeaveReq_Days DEFAULT(0),
  reason NVARCHAR(500) NULL,
  attachmentname NVARCHAR(200) NULL,
  attachmentdata NVARCHAR(MAX) NULL,
  contactdetails NVARCHAR(200) NULL,
  status NVARCHAR(20) NOT NULL CONSTRAINT DF_LeaveReq_Status DEFAULT('Pending'),
  appliedat DATETIME2 NOT NULL CONSTRAINT DF_LeaveReq_Applied DEFAULT SYSUTCDATETIME(),
  decidedby NVARCHAR(50) NULL,
  decidedat DATETIME2 NULL,
  decisionnote NVARCHAR(500) NULL,
  cancelledat DATETIME2 NULL,
  updatedat DATETIME2 NOT NULL CONSTRAINT DF_LeaveReq_Updated DEFAULT SYSUTCDATETIME(),
  CONSTRAINT CK_LeaveReq_Dates CHECK (todate >= fromdate)
);
CREATE INDEX IX_LeaveReq_Paycode ON dbo.HR_LeaveRequest (paycode, leaveyear, status);
CREATE INDEX IX_LeaveReq_Status ON dbo.HR_LeaveRequest (status, appliedat);

-- Company configuration switches (AllowNegativeBalance, MaxBackdateDays,
-- AttachmentRequiredAboveDays).
CREATE TABLE dbo.HR_LeaveConfig (
  id INT IDENTITY(1,1) PRIMARY KEY,
  configkey NVARCHAR(60) NOT NULL,
  configvalue NVARCHAR(200) NULL,
  updatedat DATETIME2 NOT NULL CONSTRAINT DF_LeaveCfg_Updated DEFAULT SYSUTCDATETIME(),
  updatedby NVARCHAR(50) NULL,
  CONSTRAINT UQ_LeaveCfg_Key UNIQUE (configkey)
);

-- ============================================================================
-- Salary Import + Full & Final Estimation (Phase K) - APPLICATION tables.
-- dbo.tblemployee / dbo.tblcategory are only READ (identity, DOJ, category).
-- The running server auto-ensures these on first use (server/salary-service.js
-- ensureSalaryTables); this block is the documented mirror of that DDL.
-- ============================================================================

-- Dataset A: salary master, one row per employee + EffectiveFrom.
CREATE TABLE dbo.HR_SalaryMaster (
  id INT IDENTITY(1,1) PRIMARY KEY,
  paycode NVARCHAR(50) NOT NULL,
  effectivefrom DATE NOT NULL,
  basicsalary NUMERIC(12,2) NOT NULL CONSTRAINT DF_SalMaster_Basic DEFAULT(0),
  pfapplicable BIT NOT NULL CONSTRAINT DF_SalMaster_Pf DEFAULT(0),
  esiapplicable BIT NOT NULL CONSTRAINT DF_SalMaster_Esi DEFAULT(0),
  pfwage NUMERIC(12,2) NOT NULL CONSTRAINT DF_SalMaster_PfWage DEFAULT(0),
  esiwage NUMERIC(12,2) NOT NULL CONSTRAINT DF_SalMaster_EsiWage DEFAULT(0),
  createddate DATETIME2 NOT NULL CONSTRAINT DF_SalMaster_Created DEFAULT SYSUTCDATETIME(),
  updateddate DATETIME2 NOT NULL CONSTRAINT DF_SalMaster_Updated DEFAULT SYSUTCDATETIME(),
  updatedby NVARCHAR(50) NULL,
  CONSTRAINT UQ_SalMaster UNIQUE (paycode, effectivefrom)
);

-- Dataset B: pay elements (EARNING / DEDUCTION / EMPLOYER_CONTRIBUTION).
CREATE TABLE dbo.HR_SalaryElement (
  id INT IDENTITY(1,1) PRIMARY KEY,
  paycode NVARCHAR(50) NOT NULL,
  payelementcode NVARCHAR(20) NOT NULL,
  payelementname NVARCHAR(100) NOT NULL,
  payelementtype NVARCHAR(30) NOT NULL,
  calculationtype NVARCHAR(20) NOT NULL,
  amount NUMERIC(12,2) NULL,
  percentage NUMERIC(9,4) NULL,
  percentagebase NVARCHAR(20) NULL,
  effectivefrom DATE NOT NULL,
  createddate DATETIME2 NOT NULL CONSTRAINT DF_SalElem_Created DEFAULT SYSUTCDATETIME(),
  updateddate DATETIME2 NOT NULL CONSTRAINT DF_SalElem_Updated DEFAULT SYSUTCDATETIME(),
  updatedby NVARCHAR(50) NULL,
  CONSTRAINT UQ_SalElem UNIQUE (paycode, payelementcode, effectivefrom)
);

-- Company settlement rules (gratuity / bonus / encashment / notice / PF / ESI).
CREATE TABLE dbo.HR_SalaryConfig (
  id INT IDENTITY(1,1) PRIMARY KEY,
  configkey NVARCHAR(60) NOT NULL,
  configvalue NVARCHAR(200) NULL,
  updatedat DATETIME2 NOT NULL CONSTRAINT DF_SalCfg_Updated DEFAULT SYSUTCDATETIME(),
  updatedby NVARCHAR(50) NULL,
  CONSTRAINT UQ_SalCfg_Key UNIQUE (configkey)
);

-- HR-approved other dues / recoveries (arrears, incentives, loans, ...).
CREATE TABLE dbo.HR_SalaryDues (
  id INT IDENTITY(1,1) PRIMARY KEY,
  paycode NVARCHAR(50) NOT NULL,
  category NVARCHAR(20) NOT NULL,
  kind NVARCHAR(40) NOT NULL,
  description NVARCHAR(200) NULL,
  amount NUMERIC(12,2) NOT NULL,
  status NVARCHAR(20) NOT NULL CONSTRAINT DF_SalDues_Status DEFAULT('Pending'),
  applieddate DATETIME2 NOT NULL CONSTRAINT DF_SalDues_Applied DEFAULT SYSUTCDATETIME(),
  decidedby NVARCHAR(50) NULL,
  decidedat DATETIME2 NULL,
  decisionnote NVARCHAR(500) NULL,
  createdby NVARCHAR(50) NULL,
  updatedat DATETIME2 NOT NULL CONSTRAINT DF_SalDues_Updated DEFAULT SYSUTCDATETIME()
);



