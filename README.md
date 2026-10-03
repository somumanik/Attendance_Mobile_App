<<<<<<< HEAD
# Savior Attendance Portal

The existing Employee and HR screens keep their current dark/purple and red/purple visual structure. Attendance data is served only through the Node/Express API and is read from Savior Biometric SQL Server.

## Setup

1. Copy `.env.example` to `.env` and fill in the server-only SQL credentials.
2. Run `server/schema.sql` once on the application database to create the separate HR marriage-anniversary table.
3. Install dependencies with `npm install`.
4. Start the API with `npm run server`.
5. Start Vite with `npm run dev`.

The browser calls `/api`; it never receives SQL credentials. The API reads only confirmed fields from `dbo.tblemployee`, `dbo.tbltimeregister`, and `dbo.machinerawpunch`. Marriage anniversaries are stored separately in `dbo.HR_MarriageAnniversary` and imported only after employee matching and date validation.

Authentication endpoints are `POST /api/auth/employee/login` with `{ "paycode": "actual-paycode", "password": "..." }` and `POST /api/auth/hr/login` with `{ "username": "HR001", "password": "..." }`. Employee tokens are restricted to the paycode in the token; HR tokens use the `HR` role and can access HR APIs. Protected requests use `Authorization: Bearer <token>`.

Attendance APIs include `/api/employee/daily`, `/api/employee/weekly`, `/api/employee/monthly`, `/api/employee/dashboard`, `/api/hr/dashboard`, `/api/hr/employees`, `/api/hr/employee/:paycode`, `/api/hr/audit/:paycode`, `/api/hr/category-analytics`, and `/api/hr/daily-master`. Date filters use `date`, `fromDate`, `toDate`, or `month` as documented by their route behavior. `/api/diagnostics/schema` and `npm run inspect-schema` report required tables, columns, indexes, and foreign keys without exposing credentials.

For temporary UI development only, set `DEV_EMPLOYEE_AUTH_ENABLED=true` and configure `DEV_EMPLOYEE_PAYCODE` / `DEV_EMPLOYEE_PASSWORD`. This fallback returns a development-only `EMPLOYEE` JWT and no attendance records; set it to `false` before production deployment.

Employee authentication uses the actual `dbo.tblemployee.paycode`; no password column is assumed or added to the Savior tables. HR authentication uses the backend-only `HR_USERNAME` and `HR_PASSWORD` environment variables. Set a strong `JWT_SECRET`, and keep the SQL login read-only except for the separate HR application table required for imports.
=======
# Attendance_Perfect_Light
>>>>>>> 7362d31f4c49996ef22c2a904604a17bd7cd8782
