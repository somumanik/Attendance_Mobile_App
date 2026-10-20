// One-off validation helper (not part of the app bundle).
// Parses the modified JSX files with the project's own @babel/parser to prove
// every edit is syntactically valid. Usage: node scripts/check-syntax.cjs
const fs = require('fs');
const path = require('path');
const parser = require(path.join(__dirname, '..', 'node_modules', '@babel', 'parser'));

const ROOT = path.join(__dirname, '..');
const FILES = [
  'src/components/GradientIcon.jsx',
  'src/navigation/EmployeeNavigator.jsx',
  'src/navigation/HRNavigator.jsx',
  'src/screens/auth/HRLoginScreen.jsx',
  'src/screens/auth/EmployeeLoginScreen.jsx',
  'src/screens/auth/SuperAdminLoginScreen.jsx',
  'src/screens/employee/EmployeeAttendanceScreen.jsx',
  'src/screens/employee/EmployeeGratuityScreen.jsx',
  'src/screens/hr/HRDashboardScreen.jsx',
  'src/screens/hr/HREmployeesScreen.jsx',
  'src/screens/hr/HRAnalyticsScreen.jsx',
  'src/screens/hr/HRHolidayManagementScreen.jsx',
  'src/screens/hr/HRMoreScreen.jsx',
  'src/screens/superadmin/SuperAdminHomeScreen.jsx',
];

let failed = 0;
for (const rel of FILES) {
  const file = path.join(ROOT, rel);
  const code = fs.readFileSync(file, 'utf8');
  try {
    parser.parse(code, {
      sourceType: 'module',
      plugins: ['jsx', 'classProperties', 'optionalChaining', 'nullishCoalescingOperator'],
    });
    console.log(`OK    ${rel}`);
  } catch (e) {
    failed += 1;
    console.log(`FAIL  ${rel}\n      ${e.message}`);
  }
}
console.log(failed ? `\n${failed} file(s) failed.` : '\nAll files parsed successfully.');
process.exit(failed ? 1 : 0);
