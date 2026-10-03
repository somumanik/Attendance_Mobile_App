// ============================================================================
// FILE: mobile/src/types/index.js
// PURPOSE: TypeScript/JSDoc type definitions for the mobile app
// ============================================================================

/**
 * Ye file TypeScript/JSDoc type definitions provide karta hai.
 * IDE support aur code quality ke liye.
 * 
 * JavaScript mein JSDoc comments use kiye gaye hain for type safety.
 */

/**
 * @typedef {Object} User
 * @property {string} paycode - Employee paycode
 * @property {string} empname - Employee name
 * @property {string} presentcardno - Biometric card number
 * @property {string} companycode - Company code
 * @property {string} departmentcode - Department code
 * @property {string} designation - Job designation
 * @property {string} dateofbirth - Date of birth (YYYY-MM-DD)
 * @property {string} dateofjoin - Date of joining (YYYY-MM-DD)
 * @property {string} sex - Gender (M/F)
 * @property {string} cat - Category code
 * @property {string} ismarried - Marital status (Y/N)
 * @property {string} active - Active status (Y/N)
 * @property {string} telephone1 - Phone number
 * @property {string} e_mail1 - Email address
 * @property {string} address1 - Address
 * @property {string} pincode1 - Postal code
 * @property {string} qualification - Qualification
 * @property {string} experience - Experience
 */

/**
 * @typedef {Object} AttendanceRecord
 * @property {string} paycode - Employee paycode
 * @property {string} date - Date (YYYY-MM-DD)
 * @property {string} day - Day name
 * @property {string} in1 - First in time
 * @property {string} in2 - Second in time
 * @property {string} out1 - First out time
 * @property {string} out2 - Second out time
 * @property {number} hoursworked - Hours worked
 * @property {number} latearrival - Late arrival minutes
 * @property {string} status - Status label
 * @property {string} statusCode - Status code
 * @property {string} statusLabel - Status label
 * @property {string} computedStatus - Computed status
 * @property {string} inTime - Formatted in time
 * @property {string} outTime - Formatted out time
 * @property {boolean} isLate - Is late flag
 * @property {string} reason - Reason
 * @property {string} graceUsed - Grace used
 */

/**
 * @typedef {Object} EmployeeStats
 * @property {number} present - Present days
 * @property {number} absent - Absent days
 * @property {number} miss - Miss punch days
 * @property {number} late - Late days
 * @property {number} hours - Total hours
 * @property {number} attendancePercentage - Attendance percentage
 */

/**
 * @typedef {Object} HRDashboardStats
 * @property {number} totalStaff - Total staff count
 * @property {number} punchedToday - Punched today
 * @property {number} presentToday - Present today
 * @property {number} absentToday - Absent today
 * @property {number} missToday - Miss punch today
 * @property {number} lateToday - Late today
 */

/**
 * @typedef {Object} LeaveRequest
 * @property {string} id - Leave request ID
 * @property {string} paycode - Employee paycode
 * @property {string} empname - Employee name
 * @property {string} departmentcode - Department
 * @property {string} type - Leave type
 * @property {string} fromDate - From date (YYYY-MM-DD)
 * @property {string} toDate - To date (YYYY-MM-DD)
 * @property {number} days - Number of days
 * @property {string} reason - Reason
 * @property {string} status - Status (Pending/Approved/Rejected)
 * @property {string} appliedOn - Applied date
 * @property {string} [approvedBy] - Approved by
 * @property {string} [approvedOn] - Approved date
 * @property {string} [rejectedBy] - Rejected by
 * @property {string} [rejectedOn] - Rejected date
 * @property {string} [rejectReason] - Rejection reason
 */

/**
 * @typedef {Object} MarriageAnniversary
 * @property {number} id - Record ID
 * @property {string} paycode - Employee paycode
 * @property {string} presentcardno - Biometric card
 * @property {string} anniversarydate - Anniversary date (YYYY-MM-DD)
 * @property {string} createddate - Created date
 * @property {string} updateddate - Updated date
 * @property {string} importedby - Imported by
 * @property {string} [empname] - Employee name (joined)
 * @property {string} [departmentcode] - Department (joined)
 */

/**
 * @typedef {Object} CelebrationData
 * @property {Object[]} employees - Employee list
 * @property {Object[]} marriages - Marriage anniversaries
 */

/**
 * @typedef {Object} APIResponse
 * @property {boolean} success - Success flag
 * @property {string} [message] - Message
 * @property {*} [data] - Response data
 * @property {number} [total] - Total count (for pagination)
 * @property {number} [page] - Current page
 * @property {number} [pageSize] - Page size
 */

/**
 * @typedef {Object} AuthTokens
 * @property {string} token - JWT token
 * @property {string} role - User role (HR/EMPLOYEE)
 * @property {Object} userData - User data
 * @property {string} [refreshToken] - Refresh token
 */

/**
 * @typedef {Object} AttendanceDailyResponse
 * @property {AttendanceRecord[]} records - Daily records
 */

/**
 * @typedef {Object} AttendanceWeeklyResponse
 * @property {AttendanceRecord[]} records - Weekly records
 */

/**
 * @typedef {Object} AttendanceMonthlyResponse
 * @property {AttendanceRecord[]} records - Monthly records
 */

/**
 * @typedef {Object} DashboardChartsResponse
 * @property {Object} chart1 - Attendance Activity (Pie)
 * @property {Object} chart2 - Last 10 Days Presence (Bar)
 * @property {Object} chart3 - Currently Present by Company (Horizontal Bar)
 * @property {Object} chart4 - Yesterday's Attendance (Bar)
 * @property {Object} chart5 - Department-wise Attendance (Bar)
 */