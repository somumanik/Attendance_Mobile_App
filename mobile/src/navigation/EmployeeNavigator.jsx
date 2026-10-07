// ============================================================================
// FILE: mobile/src/navigation/EmployeeNavigator.jsx
// PURPOSE: Employee navigation stack with bottom tabs
// ============================================================================

/**
 * Ye file Employee area ka navigation define karti hai.
 * Bottom tabs use karta hai for main sections.
 *
 * Navigation Flow:
 * RootNavigator (Role Decision)
 *   ↓
 * EmployeeNavigator (Bottom Tabs)
 *   ├── Dashboard Tab → EmployeeDashboardScreen
 *   ├── Attendance Tab → EmployeeAttendanceScreen
 *   ├── Leave Tab → EmployeeLeaveScreen
 *   ├── Reports Tab → EmployeeReportsScreen
 *   ├── Celebrations Tab → EmployeeBdayAnniversaryScreen
 *   ├── Full & Final Tab → EmployeeGratuityScreen
 *   └── Profile Tab → EmployeeProfileScreen
 *
 * HR area se alag - Employee ko sirf apna data dikhta hai.
 * Backend APIs: /api/employee/* (role-based access)
 *
 * ---------------------------------------------------------------------------
 * TAB ICON COLOUR IDENTITY (Phase H - presentation only)
 * ---------------------------------------------------------------------------
 * Har employee tab ka apna ek professional colour identity hai, taaki 7 tabs
 * ek dusre se turant pehchane ja sakein. Yeh sirf ICON/LABEL COLOUR hai:
 *   - koi route, screen, component ya API nahi badla
 *   - attendance / leave / holiday / full & final / profile logic bilkul same
 *
 * Colour discipline (taaki active/inactive dono readable rahein):
 *   ACTIVE   : filled icon + full-saturation colour + label in the SAME colour,
 *              so the selected tab is unmistakable.
 *   INACTIVE : outline icon + the SAME hue at reduced opacity (NOT grey), so
 *              every tab keeps its identity and stays clearly visible.
 *   LABEL    : inactive labels use a readable neutral grey (a 65%-alpha
 *              coloured label would drop below comfortable contrast).
 *
 * Icon SIZE and the bar height are unchanged, so the existing responsive
 * layout and the 7-tab fit are exactly as before - only colour changed.
 */

import React from 'react';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { createStackNavigator } from '@react-navigation/stack';
import { Ionicons } from '@expo/vector-icons';
import { EmployeeDashboardScreen } from '../screens/employee/EmployeeDashboardScreen';
import { EmployeeAttendanceScreen } from '../screens/employee/EmployeeAttendanceScreen';
import { EmployeeLeaveScreen } from '../screens/employee/EmployeeLeaveScreen';
import { EmployeeReportsScreen } from '../screens/employee/EmployeeReportsScreen';
import { EmployeeBdayAnniversaryScreen } from '../screens/employee/EmployeeBdayAnniversaryScreen';
import { EmployeeGratuityScreen } from '../screens/employee/EmployeeGratuityScreen';
import { EmployeeProfileScreen } from '../screens/employee/EmployeeProfileScreen';
import { PinSetupScreen } from '../screens/employee/PinSetupScreen';
import { PinChangeScreen } from '../screens/employee/PinChangeScreen';
import { ChangePasswordScreen } from '../screens/auth/ChangePasswordScreen';
import { useAuth } from '../hooks/useAuth';
import { COLORS } from '../utils/colors';

const Tab = createBottomTabNavigator();
// PIN screens ke liye stack (Phase 3A.8). Tabs ka structure bilkul same rehta hai.
const Stack = createStackNavigator();

/**
 * Per-tab colour identity. Keyed by the TAB ROUTE name so a tab can never fall
 * back to a neighbour's colour. Seven visually distinct, professional hues:
 *   Dashboard Blue · Attendance Green · Leave Orange · Reports Purple
 *   Celebrations Pink · Full & Final Teal · Profile Indigo-Blue
 *
 * Every value is a 600/700-level shade chosen so the SAME colour serves both
 * jobs it has to do on a bottom tab:
 *   - as ICON it must stay >= 3:1 against the white bar even when dimmed
 *     (WCAG minimum for a graphic), and
 *   - as the tab's TEXT it must clear 4.5:1 (WCAG AA) at this small size.
 * Lighter 500/600 hues (e.g. a bright #10B981 green) look nicer on their own
 * but drop to ~2.7:1 once dimmed, which made the inactive tabs nearly invisible.
 *
 * Dashboard and Profile are both in the blue family by design, so they are kept
 * clearly separable: Dashboard is a vivid blue (#2563EB) and Profile a deeper
 * indigo-blue (#4F46E5).
 *
 * Measured contrast against the #FFFFFF bar:
 *   label/active-icon   5.2 · 5.0 · 5.2 · 5.7 · 4.6 · 5.5 · 6.3  (all >= 4.5 AA)
 *   dimmed/inactive     4.0 · 3.8 · 4.1 · 4.4 · 3.9 · 4.1 · 4.6  (all >= 3.0)
 */
const TAB_COLORS = {
  Dashboard: '#2563EB',      // Blue
  Attendance: '#15803D',     // Green
  Leave: '#C2410C',          // Orange
  Reports: '#7C3AED',        // Purple
  BdayAnniversary: '#DB2777', // Pink
  FullFinal: '#0F766E',      // Teal
  Profile: '#4F46E5',        // Indigo-Blue
};

/**
 * Inactive icon opacity (85%).
 *
 * Deliberately high: every unselected tab must stay clearly visible while still
 * reading as secondary. At 70% the paler hues washed out to ~1.05:1 against the
 * white bar and were effectively invisible. The ACTIVE tab is still unmistakable
 * because it swaps to the filled glyph, full-strength colour and a bold label.
 */
const INACTIVE_ALPHA = 'D9';

/** Append an alpha channel to a #RRGGBB hex so the hue survives when inactive. */
const withAlpha = (hex, alpha) => `${hex}${alpha}`;

/**
 * Neutral colour for an unselected tab's TEXT.
 *
 * textSecondary (#475569, 7.6:1 on white) is used deliberately instead of
 * textTertiary (#94A3B8, only 2.6:1) - the tertiary grey is a "disabled" tone
 * and is genuinely hard to read at this size. The tab ICONS keep their own
 * colours when inactive, so the bar still looks colourful while every label
 * stays comfortably legible.
 */
const INACTIVE_LABEL = COLORS.textSecondary;

/**
 * One shared renderer for all seven tabs.
 *
 * @param {string} name      Tab route name (key into TAB_COLORS)
 * @param {string} active    Filled Ionicons glyph, shown when the tab is selected
 * @param {string} outline   Outline Ionicons glyph, shown when it is not
 */
const tabIcon = (name, active, outline) => ({ focused, size }) => {
  const tint = TAB_COLORS[name] || COLORS.primary;
  return (
    <Ionicons
      name={focused ? active : outline}
      size={size}
      color={focused ? tint : withAlpha(tint, INACTIVE_ALPHA)}
    />
  );
};

/** Label follows the same identity: tab colour when active, neutral when not. */
const tabLabelStyle = (name) => ({ focused }) => ({
  fontSize: 10,
  fontWeight: focused ? '700' : '600',
  color: focused ? (TAB_COLORS[name] || COLORS.primary) : INACTIVE_LABEL,
});

/** Sirf PIN screens wala inner stack — tabs iske andar hi rehte hain. */
const EmployeeTabs = () => (
    <Tab.Navigator
      screenOptions={({ route }) => ({
        // Per-tab active/inactive tints. The ICON and the LABEL share one identity
        // colour (see TAB_COLORS), so a tab always reads as a single colour pair.
        tabBarActiveTintColor: TAB_COLORS[route.name] || COLORS.primary,
        tabBarInactiveTintColor: INACTIVE_LABEL,
        tabBarStyle: {
          backgroundColor: COLORS.surface,
          borderTopWidth: 1,
          borderTopColor: COLORS.divider,
          paddingBottom: 8,
          height: 64,
        },
        // 7 tabs share the bar, so the label sits a touch tighter than before to
        // guarantee the longest label ("Full & Final") and the icon never collide.
        tabBarLabelStyle: tabLabelStyle(route.name),
        tabBarIconStyle: { marginTop: 2 },
        headerShown: false,
      })}
    >
      {/* Dashboard Tab — Blue */}
      <Tab.Screen
        name="Dashboard"
        component={EmployeeDashboardScreen}
        options={{
          tabBarLabel: 'Dashboard',
          tabBarIcon: tabIcon('Dashboard', 'home', 'home-outline'),
        }}
      />

      {/* Attendance Tab — Green */}
      <Tab.Screen
        name="Attendance"
        component={EmployeeAttendanceScreen}
        options={{
          tabBarLabel: 'Attendance',
          tabBarIcon: tabIcon('Attendance', 'calendar', 'calendar-outline'),
        }}
      />

      {/* Leave Tab — Orange */}
      <Tab.Screen
        name="Leave"
        component={EmployeeLeaveScreen}
        options={{
          tabBarLabel: 'Leave',
          tabBarIcon: tabIcon('Leave', 'briefcase', 'briefcase-outline'),
        }}
      />

      {/* Reports Tab — Purple */}
      <Tab.Screen
        name="Reports"
        component={EmployeeReportsScreen}
        options={{
          tabBarLabel: 'Reports',
          tabBarIcon: tabIcon('Reports', 'bar-chart', 'bar-chart-outline'),
        }}
      />

      {/* Birthday & Anniversary Tab — Pink */}
      <Tab.Screen
        name="BdayAnniversary"
        component={EmployeeBdayAnniversaryScreen}
        options={{
          tabBarLabel: 'Celebrations',
          tabBarIcon: tabIcon('BdayAnniversary', 'gift', 'gift-outline'),
        }}
      />

      {/* Full & Final / Gratuity Tab — Teal */}
      <Tab.Screen
        name="FullFinal"
        component={EmployeeGratuityScreen}
        options={{
          tabBarLabel: 'Full & Final',
          tabBarIcon: tabIcon('FullFinal', 'cash', 'cash-outline'),
        }}
      />

      {/* Profile Tab — Indigo-Blue */}
      <Tab.Screen
        name="Profile"
        component={EmployeeProfileScreen}
        options={{
          tabBarLabel: 'Profile',
          tabBarIcon: tabIcon('Profile', 'person', 'person-outline'),
        }}
      />
    </Tab.Navigator>
);

/**
 * Employee Navigator — bottom tabs + authenticated PIN/password screens.
 *
 * Phase I gate: jab tak employee ka naya password set nahi hota (HR ne temporary
 * password diya, ya force-change lagaya hai), TABHI ye navigator sirf
 * ChangePasswordScreen render karta hai. Isse employee Dashboard, Attendance,
 * Leave, Reports, Celebrations, Full & Final, Profile ya Holiday tak UI se
 * pahunch hi nahi sakta. Ye sirf UI gate hai - backend par bhi
 * requirePasswordChanged middleware lagaya hai jo unhi routes ko 403
 * PASSWORD_CHANGE_REQUIRED se rokta hai, to UI bypass karna bhi kuch nahi.
 *
 * Navigation Flow:
 * RootNavigator (Role Decision = EMPLOYEE)
 *   ↓
 * EmployeeNavigator
 *   ├── mustChangePassword === true  → ChangePasswordScreen (sirf yahi)
 *   ├── otherwise                    → Tabs (Dashboard / Attendance / Leave /
 *   │                                   Reports / Celebrations / Full & Final /
 *   │                                   Profile)
 *   └── PIN screens (Profile se khulti hain)
 *         ├── PinSetupScreen  (jab PIN set nahi hai)
 *         └── PinChangeScreen (jab PIN pehle se set hai)
 */
export const EmployeeNavigator = () => {
  const { mustChangePassword } = useAuth();

  // Forced password setup: koi tab, koi screen nahi — sirf password change.
  if (mustChangePassword) {
    return <ChangePasswordScreen />;
  }

  return (
    <Stack.Navigator screenOptions={{ headerShown: false }}>
      <Stack.Screen name="EmployeeTabs" component={EmployeeTabs} />
      <Stack.Screen name="PinSetup" component={PinSetupScreen} />
      <Stack.Screen name="PinChange" component={PinChangeScreen} />
      <Stack.Screen name="ChangePassword" component={ChangePasswordScreen} />
    </Stack.Navigator>
  );
};
