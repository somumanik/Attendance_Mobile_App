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

