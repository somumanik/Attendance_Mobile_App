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
import { Text } from 'react-native';
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
const INACTIVE_TILE_OPACITY = 0.62;

/**
 * One consistent tile size for every tab on every device (presentation only) -
 * independent of the tab bar's font-scaled `size`, so glyphs stay identical on
 * Android phones with different densities or large system font settings.
 */
const TILE_SIZE = 26;

/**
 * Soft tinted "pill" background shown behind the SELECTED tab's tile (~15% of
 * the tab's identity colour). 8-digit hex alpha works on Android, iOS and web.
 * Inactive tabs get 'transparent' so active/inactive tiles share identical
 * geometry - only the tint differs.
 */
const activeHalo = (name) => `${getNavIcon(name).tint}26`;
const INACTIVE_HALO = 'transparent';

/**
 * Gradient tile renderer for a bottom-nav tab. Same glyphs as before - only
 * the presentation is premium-ised (consistent sizing + active tinted halo).
 */
const tabIcon = (name, focused, active, outline) => {
  const { from, to } = getNavIcon(name);
  return (
    <GradientIcon
      from={from}
      to={to}
      // Same glyph the app already used - only its presentation changed.
      name={focused ? active : outline}
      size={TILE_SIZE}
      active={focused}
      opacity={focused ? 1 : INACTIVE_TILE_OPACITY}
      haloColor={focused ? activeHalo(name) : INACTIVE_HALO}
    />
  );
};

/**
 * Label renderer - readable, never clipped on narrow screens.
 *
 * Rules (presentation only; tab names, order and behaviour unchanged):
 *   WRAP   : up to 2 lines with a real line height - multi-word names
 *            ("Daily Master", "Leave Mgmt") wrap instead of truncating.
 *   SHRINK : adjustsFontSizeToFit with a READABLE floor (0.8 ≈ 8px) for long
 *            single words - never the old 0.65 (6.5px) unreadable shrink.
 *   CUT    : ellipsizeMode "tail" only as a last resort on very narrow bars.
 *   WIDTH  : the label stretches across the tab column (minus a hair of
 *            breathing room) so every pixel of the column is usable text width.
 *   SCALE  : maxFontSizeMultiplier caps system font scaling so a large-font
 *            setting can push labels out of the bar.
 * `text` is the exact visible label the app already showed (a function
 * tabBarLabel would otherwise fall back to the raw route name).
 */
const tabLabel = (text) => ({ focused, color }) => (
  <Text
    numberOfLines={2}
    adjustsFontSizeToFit
    minimumFontScale={0.8}
    minFontSizeMultiplier={0.8}
    maxFontSizeMultiplier={1.2}
    ellipsizeMode="tail"
    style={{
      alignSelf: 'stretch',
      marginHorizontal: -3,
      paddingHorizontal: 1,
      marginTop: 1,
      minHeight: 24,
      fontSize: 10,
      lineHeight: 12,
      fontWeight: focused ? '700' : '600',
      letterSpacing: 0,
      color,
      textAlign: 'center',
      textAlignVertical: 'center',
    }}
  >
    {text}
  </Text>
);

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
        // Readable neutral for unselected labels (textSecondary, 7.6:1 on
        // white) - the previous textTertiary (2.6:1) was hard to read.
        tabBarInactiveTintColor: COLORS.textSecondary,
        tabBarStyle: {
          backgroundColor: COLORS.surface,
          borderTopWidth: 1,
          borderTopColor: COLORS.divider,
          paddingTop: 6,
          paddingBottom: 8 + insets.bottom,
          // minHeight (not height): a label that wraps to 2 lines on narrow
          // screens grows the bar instead of being clipped by a fixed height.
          // The bottom safe-area inset is still reserved via paddingBottom.
          minHeight: 64 + insets.bottom,
          // Soft top lift keeps the bar premium without changing layout.
          shadowColor: COLORS.shadow,
          shadowOffset: { width: 0, height: -2 },
          shadowOpacity: 1,
          shadowRadius: 8,
          elevation: 8,
        },
        // Labels auto-shrink (see tabLabel) so long names like "Daily Master"
        // never truncate on narrow screens; icon size is fixed (see TILE_SIZE).
        tabBarIconStyle: { marginTop: 2 },
        headerShown: false,
      })}
    >
      {inBar('dashboard') ? (
        <Tab.Screen
          name="Dashboard"
          component={HRDashboardScreen}
          options={{
            tabBarLabel: tabLabel('Dashboard'),
            tabBarIcon: ({ focused }) => tabIcon('Dashboard', focused, 'speedometer', 'speedometer-outline'),
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
            tabBarLabel: tabLabel('Employees'),
            tabBarIcon: ({ focused }) => tabIcon('Employees', focused, 'people', 'people-outline'),
          }}
        />
      ) : null}
      {inBar('audit') ? (
        <Tab.Screen
          name="Audit"
          component={HRAuditScreen}
          options={{
            tabBarLabel: tabLabel('Audit'),
            tabBarIcon: ({ focused }) => tabIcon('Audit', focused, 'search', 'search-outline'),
          }}
        />
      ) : null}
      {inBar('analytics') ? (
        <Tab.Screen
          name="Analytics"
          component={HRAnalyticsScreen}
          options={{
            tabBarLabel: tabLabel('Analytics'),
            tabBarIcon: ({ focused }) => tabIcon('Analytics', focused, 'analytics', 'analytics-outline'),
          }}
        />
      ) : null}
      {inBar('dailymaster') ? (
        <Tab.Screen
          name="DailyMaster"
          component={HRDailyMasterScreen}
          options={{
            tabBarLabel: tabLabel('Daily Master'),
            tabBarIcon: ({ focused }) => tabIcon('DailyMaster', focused, 'document-text', 'document-text-outline'),
          }}
        />
      ) : null}
      {inBar('celebrations') ? (
        <Tab.Screen
          name="Celebrations"
          component={HRCelebrationsScreen}
          options={{
            tabBarLabel: tabLabel('Celebrations'),
            tabBarIcon: ({ focused }) => tabIcon('Celebrations', focused, 'gift', 'gift-outline'),
          }}
        />
      ) : null}
      {inBar('marriage') ? (
        <Tab.Screen
          name="Marriage"
          component={HRMarriageScreen}
          options={{
            tabBarLabel: tabLabel('Marriage'),
            tabBarIcon: ({ focused }) => tabIcon('Marriage', focused, 'heart', 'heart-outline'),
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
            tabBarLabel: tabLabel('Leave Mgmt'),
            tabBarIcon: ({ focused }) => tabIcon('LeaveMgmt', focused, 'calendar', 'calendar-outline'),
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
            tabBarLabel: tabLabel('Salary'),
            tabBarIcon: ({ focused }) => tabIcon('Salary', focused, 'cash', 'cash-outline'),
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
            tabBarLabel: tabLabel('Holidays'),
            tabBarIcon: ({ focused }) => tabIcon('Holidays', focused, 'flag', 'flag-outline'),
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
            tabBarLabel: tabLabel('More'),
            tabBarIcon: ({ focused }) => tabIcon('More', focused, 'ellipsis-horizontal', 'ellipsis-horizontal-outline'),
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
