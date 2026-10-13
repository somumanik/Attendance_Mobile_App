// ============================================================================
// FILE: mobile/src/navigation/SuperAdminNavigator.jsx
// PURPOSE: SuperAdmin Management Console navigation (dedicated dashboard + menu)
// ============================================================================

/**
 * SuperAdmin Management Console.
 *
 * Yeh ek DEDICATED console hai — Employee/HR tab bar yahan nahi dikhta. Stack ka
 * pehla screen console dashboard (menu) hai, jisse har management module khulta
 * hai. Screens reuse kiye gaye hain (koi duplicate business module nahi), aur
 * authorization server par role + saved permissions se enforce hoti hai.
 *
 * Navigation Flow:
 * RootNavigator (role = SUPERADMIN)
 *   ↓
 * SuperAdminNavigator (Stack)
 *   ├── SuperAdminHome        → console dashboard + menu (9 management areas)
 *   ├── SuperAdminCredentials → HREmployeeCredentialsScreen   (reused)
 *   ├── SuperAdminHolidays    → HRHolidayManagementScreen     (reused)
 *   ├── SuperAdminLeave       → HRLeaveManagementScreen       (reused)
 *   ├── SuperAdminSalary      → HRSalaryManagementScreen      (Salary + Full & Final, reused)
 *   ├── SuperAdminEmployees   → HREmployeesScreen             (reused)
 *   ├── SuperAdminEmail       → SuperAdminEmailScreen         (new)
 *   ├── SuperAdminHRAdmins    → SuperAdminHRAdminsScreen      (new)
 *   └── SuperAdminUsers       → SuperAdminUsersScreen         (new)
 *
 * IMPORTANT: HR Admin aur Employee navigators bilkul nahi badle hain.
 */

import React from 'react';
import { createStackNavigator } from '@react-navigation/stack';
import { SuperAdminHomeScreen } from '../screens/superadmin/SuperAdminHomeScreen';
import { SuperAdminEmailScreen } from '../screens/superadmin/SuperAdminEmailScreen';
import { SuperAdminHRAdminsScreen } from '../screens/superadmin/SuperAdminHRAdminsScreen';
import { SuperAdminUsersScreen } from '../screens/superadmin/SuperAdminUsersScreen';
import { HRLeaveManagementScreen } from '../screens/hr/HRLeaveManagementScreen';
import { HRHolidayManagementScreen } from '../screens/hr/HRHolidayManagementScreen';
import { HRSalaryManagementScreen } from '../screens/hr/HRSalaryManagementScreen';
import { HREmployeeCredentialsScreen } from '../screens/hr/HREmployeeCredentialsScreen';
import { HREmployeesScreen } from '../screens/hr/HREmployeesScreen';

const Stack = createStackNavigator();

export const SuperAdminNavigator = () => (
  <Stack.Navigator screenOptions={{ headerShown: false }}>
    <Stack.Screen name="SuperAdminHome" component={SuperAdminHomeScreen} />
    {/* Reused HR management screens — same components, same endpoints. */}
    <Stack.Screen name="SuperAdminCredentials" component={HREmployeeCredentialsScreen} />
    <Stack.Screen name="SuperAdminHolidays" component={HRHolidayManagementScreen} />
    <Stack.Screen name="SuperAdminLeave" component={HRLeaveManagementScreen} />
    <Stack.Screen name="SuperAdminSalary" component={HRSalaryManagementScreen} />
    {/* Distinct Full & Final console entry. It renders the SAME reused screen
        (identical APIs + calculation) so there is NO second source of truth —
        only a separate, directly reachable menu entry. */}
    <Stack.Screen name="SuperAdminFullFinal" component={HRSalaryManagementScreen} />
    <Stack.Screen name="SuperAdminEmployees" component={HREmployeesScreen} />
    {/* Console-only screens. */}
    <Stack.Screen name="SuperAdminEmail" component={SuperAdminEmailScreen} />
    <Stack.Screen name="SuperAdminHRAdmins" component={SuperAdminHRAdminsScreen} />
    <Stack.Screen name="SuperAdminUsers" component={SuperAdminUsersScreen} />
  </Stack.Navigator>
);

export default SuperAdminNavigator;

