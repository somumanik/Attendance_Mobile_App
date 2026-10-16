// ============================================================================
// FILE: mobile/src/navigation/HRNavigator.jsx
// PURPOSE: HR Admin navigation stack with bottom tabs
// ============================================================================

/**
 * Ye file HR Admin area ka navigation define karti hai.
 * Bottom tabs use karta hai for HR sections.
 * 
 * Navigation Flow:
 * RootNavigator (Role Decision)
 *   ↓
 * HRNavigator (Bottom Tabs)
 *   ├── Dashboard Tab → HRDashboardScreen
 *   ├── Employees Tab → HREmployeesScreen
 *   ├── Audit Tab → HRAuditScreen
 *   ├── Analytics Tab → HRAnalyticsScreen
 *   ├── Daily Master Tab → HRDailyMasterScreen
 *   ├── Celebrations Tab → HRCelebrationsScreen
 *   ├── Marriage Tab → HRMarriageScreen
 *   ├── Leave Mgmt Tab → HRLeaveManagementScreen
 *   └── Holidays Tab → HRHolidayManagementScreen
 * 
 * Email Configuration TAB NAHI HAI - mobile app se exclude kiya gaya hai.
 * Backend APIs: /api/hr/* (HR role required)
 */

import React from 'react';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { createStackNavigator } from '@react-navigation/stack';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { GradientIcon } from '../components/GradientIcon';
import { getNavIcon } from '../utils/navigationIcons';
import { useAuth } from '../hooks/useAuth';
import { HRMoreScreen } from '../screens/hr/HRMoreScreen';
import { HRDashboardScreen } from '../screens/hr/HRDashboardScreen';
import { HREmployeesScreen } from '../screens/hr/HREmployeesScreen';
import { HRAuditScreen } from '../screens/hr/HRAuditScreen';
import { HRAnalyticsScreen } from '../screens/hr/HRAnalyticsScreen';
import { HRDailyMasterScreen } from '../screens/hr/HRDailyMasterScreen';
import { HRCelebrationsScreen } from '../screens/hr/HRCelebrationsScreen';
import { HRMarriageScreen } from '../screens/hr/HRMarriageScreen';
import { HRLeaveManagementScreen } from '../screens/hr/HRLeaveManagementScreen';
import { HRSalaryManagementScreen } from '../screens/hr/HRSalaryManagementScreen';
import { HRHolidayManagementScreen } from '../screens/hr/HRHolidayManagementScreen';
import { HREmployeeCredentialsScreen } from '../screens/hr/HREmployeeCredentialsScreen';
import { COLORS } from '../utils/colors';

const Tab = createBottomTabNavigator();
// HR-only credential management screen (Phase 3A.10) ke liye inner stack.
const Stack = createStackNavigator();

/**
 * PHASE L - COLOURFUL GRADIENT ICON SYSTEM (presentation only).
 *
 * Per-tab gradient identity ab ek hi jagah (`utils/navigationIcons.js` ->
 * NAV_ICON_GRADIENTS) define hai, keyed by TAB ROUTE name. Har HR tab ek chhota
 * gradient "app icon" tile banata hai (GradientIcon) jiske upar white glyph hota
 * hai. Isse sirf ICON ka LOOK badalta hai:
 *   - koi route / screen / API / navigation behaviour nahi badla
 *   - tabBarLabel, size, touch area aur active/inactive state same
 *   - Phase G (Holiday) / Phase I (Credentials) / Phase J (Leave) /
 *     Phase K (Salary) ki logic bilkul untouched
 *
 * Active tab full-strength gradient + soft lift dikhata hai (filled glyph +
 * coloured bold label); inactive tab wahi tile thoda fade karke (55%) outline
 * glyph aur neutral label ke saath dikhata hai.
 */

/** Unselected tile opacity (kept readable, clearly secondary vs the active tab). */
const INACTIVE_TILE_OPACITY = 0.55;

/** Gradient tile renderer for a bottom-nav tab. */
const tabIcon = (name, focused, active, outline, size) => {
  const { from, to } = getNavIcon(name);
  return (
    <GradientIcon
      from={from}
      to={to}
      // Same glyph the app already used - only its presentation changed.
      name={focused ? active : outline}
      size={Math.round(size * 1.16)}
      active={focused}
      opacity={focused ? 1 : INACTIVE_TILE_OPACITY}
    />
  );
};

const HRTabs = () => {
  // Server-side authorization is authoritative; this only hides what is not
  // permitted so an HR Admin never sees a module they cannot use.
  const { can, modulePlacement, isVisible } = useAuth();
  /* Phase 4.4 — ONE rule for every section:
       showTab = Visible (not explicitly Hidden) AND View permitted;
       inBar   = shown here in the bottom bar (i.e. not placed in the More menu).
     A Hidden section is excluded from BOTH surfaces, and the server denies its data
     too, so it cannot be reached by entering its URL. */
  const showTab = (m) => can(m, 'view') && isVisible(m);
  const inBar = (m) => showTab(m) && modulePlacement(m) !== 'more';
  // Home-indicator / gesture-nav safe area: the bar's height and bottom padding
  // must include the inset or the last row of tabs is covered on notched devices.
  const insets = useSafeAreaInsets();
  return (
    <Tab.Navigator
      screenOptions={({ route }) => ({
        tabBarActiveTintColor: getNavIcon(route.name).tint,
        tabBarInactiveTintColor: COLORS.textTertiary,
        tabBarStyle: {
          backgroundColor: COLORS.surface,
          borderTopWidth: 1,
          borderTopColor: COLORS.divider,
          paddingTop: 6,
          paddingBottom: 8 + insets.bottom,
          height: 64 + insets.bottom,
          // Soft top lift keeps the bar premium without changing layout.
          shadowColor: COLORS.shadow,
          shadowOffset: { width: 0, height: -2 },
          shadowOpacity: 1,
          shadowRadius: 8,
          elevation: 8,
        },
        tabBarLabelStyle: {
          fontSize: 10,
          fontWeight: '600',
          letterSpacing: 0.1,
        },
        headerShown: false,
      })}
    >
      {inBar('dashboard') ? (
        <Tab.Screen
          name="Dashboard"
          component={HRDashboardScreen}
          options={{
            tabBarLabel: 'Dashboard',
            tabBarIcon: ({ focused, size }) => tabIcon('Dashboard', focused, 'speedometer', 'speedometer-outline', size),
          }}
        />
      ) : null}
      {/* Employee Management (module: employees) — hidden when not permitted, and
          moved into the More menu when the SuperAdmin placed it there. A module
          with no placement (NULL) keeps its historical spot in the bar. */}
      {inBar('employees') ? (
        <Tab.Screen
          name="Employees"
          component={HREmployeesScreen}
          options={{
            tabBarLabel: 'Employees',
            tabBarIcon: ({ focused, size }) => tabIcon('Employees', focused, 'people', 'people-outline', size),
          }}
        />
      ) : null}
      {inBar('audit') ? (
        <Tab.Screen
          name="Audit"
          component={HRAuditScreen}
          options={{
            tabBarLabel: 'Audit',
            tabBarIcon: ({ focused, size }) => tabIcon('Audit', focused, 'search', 'search-outline', size),
          }}
        />
      ) : null}
      {inBar('analytics') ? (
        <Tab.Screen
          name="Analytics"
          component={HRAnalyticsScreen}
          options={{
            tabBarLabel: 'Analytics',
            tabBarIcon: ({ focused, size }) => tabIcon('Analytics', focused, 'analytics', 'analytics-outline', size),
          }}
        />
      ) : null}
      {inBar('dailymaster') ? (
        <Tab.Screen
          name="DailyMaster"
          component={HRDailyMasterScreen}
          options={{
            tabBarLabel: 'Daily Master',
            tabBarIcon: ({ focused, size }) => tabIcon('DailyMaster', focused, 'document-text', 'document-text-outline', size),
          }}
        />
      ) : null}
      {inBar('celebrations') ? (
        <Tab.Screen
          name="Celebrations"
          component={HRCelebrationsScreen}
          options={{
            tabBarLabel: 'Celebrations',
            tabBarIcon: ({ focused, size }) => tabIcon('Celebrations', focused, 'gift', 'gift-outline', size),
          }}
        />
      ) : null}
      {inBar('marriage') ? (
        <Tab.Screen
          name="Marriage"
          component={HRMarriageScreen}
          options={{
            tabBarLabel: 'Marriage',
            tabBarIcon: ({ focused, size }) => tabIcon('Marriage', focused, 'heart', 'heart-outline', size),
          }}
        />
      ) : null}
      {/* Leave Management (Phase J): now backed by REAL application leave data, so
          this tab is registered again. It was hidden in Phase 6 only because leave
          was not implemented. Nothing else about the screen or its backend changed
          beyond Phase J. */}
      {/* Leave Management (module: leave) — hidden when not permitted / moved to More. */}
      {inBar('leave') ? (
        <Tab.Screen
          name="LeaveMgmt"
          component={HRLeaveManagementScreen}
          options={{
            tabBarLabel: 'Leave Mgmt',
            tabBarIcon: ({ focused, size }) => tabIcon('LeaveMgmt', focused, 'calendar', 'calendar-outline', size),
          }}
        />
      ) : null}
      {/* Salary / Settlement management (Phase K): app-owned HR_Salary* data. */}
      {/* Salary Management (module: salary) — hidden when not permitted / moved to More. */}
      {inBar('salary') ? (
        <Tab.Screen
          name="Salary"
          component={HRSalaryManagementScreen}
          options={{
            tabBarLabel: 'Salary',
            tabBarIcon: ({ focused, size }) => tabIcon('Salary', focused, 'cash', 'cash-outline', size),
          }}
        />
      ) : null}
      {/* Holiday Management (Phase G): the only NEW HR tab in this phase. */}
      {/* Holiday Management (module: holidays) — hidden when not permitted / moved to More. */}
      {inBar('holidays') ? (
        <Tab.Screen
          name="Holidays"
          component={HRHolidayManagementScreen}
          options={{
            tabBarLabel: 'Holidays',
            tabBarIcon: ({ focused, size }) => tabIcon('Holidays', focused, 'flag', 'flag-outline', size),
          }}
        />
      ) : null}
      {/* Prompt 3: overflow modules (placement = 'more'). Registered ONLY when at
          least one PERMITTED module is placed there, so an empty More tab is
          never created and a non-permitted module can never appear inside it. */}
      {['dashboard', 'employees', 'audit', 'analytics', 'dailymaster', 'celebrations', 'marriage', 'leave', 'salary', 'holidays']
        .some((m) => showTab(m) && modulePlacement(m) === 'more') ? (
        <Tab.Screen
          name="More"
          component={HRMoreScreen}
          options={{
            tabBarLabel: 'More',
            tabBarIcon: ({ focused, size }) => tabIcon('More', focused, 'ellipsis-horizontal', 'ellipsis-horizontal-outline', size),
          }}
        />
      ) : null}
    </Tab.Navigator>
  );
};

/**
 * HR Navigator — bottom tabs + HR-only credential management screen (Phase 3A.10).
 *
 * Navigation Flow:
 * RootNavigator (Role Decision = HR)
 *   ↓
 * HRNavigator
 *   ├── Tabs (8 existing HR sections, unchanged)
 *   └── HREmployeeCredentials (HR Dashboard se open hota hai)
 */
export const HRNavigator = () => {
  return (
    <Stack.Navigator screenOptions={{ headerShown: false }}>
      <Stack.Screen name="HRTabs" component={HRTabs} />
      <Stack.Screen name="HREmployeeCredentials" component={HREmployeeCredentialsScreen} />
    </Stack.Navigator>
  );
};
