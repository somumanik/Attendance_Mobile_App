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


