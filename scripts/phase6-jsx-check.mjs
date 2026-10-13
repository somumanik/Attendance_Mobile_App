// PHASE 6 — JSX/JS syntax validation for the mobile files touched (esbuild parser).
import fs from 'node:fs';
import { transformSync } from 'esbuild';

const files = [
  'mobile/src/screens/employee/EmployeeAttendanceScreen.jsx',
  'mobile/src/screens/employee/EmployeeDashboardScreen.jsx',
  'mobile/src/screens/hr/HREmployeesScreen.jsx',
  'mobile/src/utils/constants.js',
];

let ok = true;
for (const f of files) {
  try {
    transformSync(fs.readFileSync(f, 'utf8'), {
      loader: f.endsWith('.jsx') ? 'jsx' : 'js',
      jsx: 'automatic',
      sourcefile: f,
    });
    console.log('OK   ' + f);
  } catch (e) {
    ok = false;
    console.log('FAIL ' + f + ' :: ' + (e && e.message ? e.message : e));
  }
}
process.exitCode = ok ? 0 : 1;
