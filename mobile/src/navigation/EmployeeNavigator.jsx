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
import { Text } from 'react-native';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { createStackNavigator } from '@react-navigation/stack';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { GradientIcon } from '../components/GradientIcon';
import { getNavIcon } from '../utils/navigationIcons';
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
 * PHASE L - COLOURFUL GRADIENT ICON IDENTITY (presentation only).
 *
 * Har employee tab ka apna gradient identity hai, jo ek hi jagah
 * (`utils/navigationIcons.js` -> NAV_ICON_GRADIENTS) define hai, taaki 7 tabs
 * ek dusre se turant pehchane ja sakein. Yeh sirf ICON/LABEL ka LOOK hai:
 *   - koi route, screen, component ya API nahi badla
 *   - attendance / leave / holiday / full & final / profile logic bilkul same
 *   - tab ka naam, order, size, touch area aur active/inactive behaviour same
 *
 * Ab har tab ek chhota gradient "app icon" tile hai (GradientIcon) jiske upar
 * white glyph hota hai:
 *   ACTIVE   : full-strength gradient tile + soft lift/shadow + filled glyph +
 *              label tab ke identity colour me bold.
 *   INACTIVE : wahi tile thoda fade (55%) + outline glyph + label neutral grey.
 *
 * Gradient stops sab 600/700 level shades hain, isliye white glyph hamesha
 * readable rehta hai aur active label (tint) small text ke liye AA pass karta
 * hai - exactly jaise pehle tha.
 */

/**
 * Neutral colour for an unselected tab's TEXT.
 *
 * textSecondary (#475569, 7.6:1 on white) is used deliberately instead of
 * textTertiary (#94A3B8, only 2.6:1) - the tertiary grey is a "disabled" tone
 * and is genuinely hard to read at this size. The tab ICONS keep their own
 * gradient identity when inactive, so the bar still looks colourful while every
 * label stays comfortably legible.
 */
const INACTIVE_LABEL = COLORS.textSecondary;

/**
 * Unselected tile opacity. High enough that every inactive tab keeps its
 * colour identity, low enough that the selected tab is unmistakable (the
 * selected tab is additionally lifted with a tinted halo + shadow + filled
 * glyph + coloured bold label).
 */
const INACTIVE_TILE_OPACITY = 0.62;

/**
 * One consistent tile size for every tab on every device. The size no longer
 * derives from the tab bar's font-scaled `size`, so glyphs stay identical on
 * Android phones with different densities or large system font settings.
 */
const TILE_SIZE = 26;

/**
 * Soft tinted "pill" background shown behind the SELECTED tab's tile
 * (~15% of the tab's identity colour). The 8-digit hex alpha is supported by
 * React Native on Android, iOS and web. Inactive tabs get 'transparent' so
 * active/inactive tiles share identical geometry - only the tint differs.
 */
const activeHalo = (name) => `${getNavIcon(name).tint}26`;
const INACTIVE_HALO = 'transparent';

/**
 * One shared renderer for all seven tabs - a colourful gradient tile with a
 * subtle tinted halo behind the selected one.
 *
 * @param {string} name      Tab route name (key into NAV_ICON_GRADIENTS)
 * @param {string} active    Filled Ionicons glyph, shown when the tab is selected
 * @param {string} outline   Outline Ionicons glyph, shown when it is not
 */
const tabIcon = (name, active, outline) => ({ focused }) => {
  const { from, to } = getNavIcon(name);
  return (
    <GradientIcon
      from={from}
      to={to}
      // Same glyph the app already used for this tab - only its presentation
      // changed (white glyph on a gradient tile instead of a tinted glyph).
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
 *            ("Full & Final", "Daily Master") wrap instead of truncating.
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

/** Sirf PIN screens wala inner stack — tabs iske andar hi rehte hain. */
const EmployeeTabs = () => {
  // Home-indicator / gesture-nav safe area: the bar's height and bottom padding
  // must include the inset or the last row of tabs is covered on notched devices.
  const insets = useSafeAreaInsets();
  return (
    <Tab.Navigator
      screenOptions={({ route }) => ({
        // Per-tab active/inactive tints. The ICON (gradient tile) and the LABEL
        // share one identity colour (see NAV_ICON_GRADIENTS), so a tab always
        // reads as a single colour pair.
        tabBarActiveTintColor: getNavIcon(route.name).tint,
        tabBarInactiveTintColor: INACTIVE_LABEL,
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
        // 7 tabs share the bar, so the label auto-shrinks (see tabLabel) to
        // guarantee the longest label ("Full & Final") and the icon never collide.
        tabBarIconStyle: { marginTop: 2 },
        headerShown: false,
      })}
    >
      {/* Dashboard Tab — Blue */}
      <Tab.Screen
        name="Dashboard"
        component={EmployeeDashboardScreen}
        options={{
          tabBarLabel: tabLabel('Dashboard'),
          tabBarIcon: tabIcon('Dashboard', 'home', 'home-outline'),
        }}
      />

      {/* Attendance Tab — Green */}
      <Tab.Screen
        name="Attendance"
        component={EmployeeAttendanceScreen}
        options={{
          tabBarLabel: tabLabel('Attendance'),
          tabBarIcon: tabIcon('Attendance', 'calendar', 'calendar-outline'),
        }}
      />

      {/* Leave Tab — Orange */}
      <Tab.Screen
        name="Leave"
        component={EmployeeLeaveScreen}
        options={{
          tabBarLabel: tabLabel('Leave'),
          tabBarIcon: tabIcon('Leave', 'briefcase', 'briefcase-outline'),
        }}
      />

      {/* Reports Tab — Purple */}
      <Tab.Screen
        name="Reports"
        component={EmployeeReportsScreen}
        options={{
          tabBarLabel: tabLabel('Reports'),
          tabBarIcon: tabIcon('Reports', 'bar-chart', 'bar-chart-outline'),
        }}
      />

      {/* Birthday & Anniversary Tab — Pink */}
      <Tab.Screen
        name="BdayAnniversary"
        component={EmployeeBdayAnniversaryScreen}
        options={{
          tabBarLabel: tabLabel('Celebrations'),
          tabBarIcon: tabIcon('BdayAnniversary', 'gift', 'gift-outline'),
        }}
      />

      {/* Full & Final / Gratuity Tab — Teal */}
      <Tab.Screen
        name="FullFinal"
        component={EmployeeGratuityScreen}
        options={{
          tabBarLabel: tabLabel('Full & Final'),
          tabBarIcon: tabIcon('FullFinal', 'cash', 'cash-outline'),
        }}
      />

      {/* Profile Tab — Indigo-Blue */}
      <Tab.Screen
        name="Profile"
        component={EmployeeProfileScreen}
        options={{
          tabBarLabel: tabLabel('Profile'),
          tabBarIcon: tabIcon('Profile', 'person', 'person-outline'),
        }}
      />
    </Tab.Navigator>
  );
};

/**
 * Employee Navigator — bottom tabs + authenticated PIN/password screens.
 *
 * Phase I gate (order matters):
 *   1. mustChangePassword === true  → ChangePasswordScreen (sirf yahi)
 *   2. pinSetupRequired === true    → PinSetupScreen (sirf yahi; one-time
 *      4-digit PIN setup, dashboard tab tak pahunch nahi sakte)
 *   3. otherwise                    → Tabs (Dashboard / Attendance / Leave /
 *      Reports / Celebrations / Full & Final / Profile)
 * Backend par bhi requirePasswordChanged + requirePinSetupDone (dashboard)
 * middleware lage hain, to UI bypass karna bhi kuch nahi deta.
 *
 * Navigation Flow:
 * RootNavigator (Role Decision = EMPLOYEE)
 *   ↓
 * EmployeeNavigator
 *   ├── mustChangePassword === true  → ChangePasswordScreen (sirf yahi)
 *   ├── pinSetupRequired === true    → PinSetupScreen (sirf yahi)
 *   ├── otherwise                    → Tabs (Dashboard / Attendance / Leave /
 *   │                                   Reports / Celebrations / Full & Final /
 *   │                                   Profile)
 *   └── PIN screens (Profile se khulti hain)
 *         ├── PinSetupScreen  (jab PIN set nahi hai)
 *         └── PinChangeScreen (jab PIN pehle se set hai)
 */
export const EmployeeNavigator = () => {
  const { mustChangePassword, pinSetupRequired } = useAuth();

  // Forced gates stay INSIDE this Stack (never `return <Screen/>` directly):
  // a bare screen has no route object, so useNavigation()/useRoute() throws
  // "Couldn't find a route object" on web and blanks the portal.
  // initialRouteName picks the registered gate; the gate list contains ONLY
  // the gate screen, so no tab/dashboard can mount until the flag clears.
  if (mustChangePassword) {
    return (
      <Stack.Navigator key="emp-gate-password" screenOptions={{ headerShown: false }} initialRouteName="ForcedPasswordGate">
        <Stack.Screen
          name="ForcedPasswordGate"
          component={ChangePasswordScreen}
          initialParams={{ mustChange: true }}
        />
      </Stack.Navigator>
    );
  }

  // Phase I section 2: forced one-time PIN setup. Password gate ke baad aata
  // hai, isliye temporary password pehle badalta hai, phir PIN banta hai.
  if (pinSetupRequired) {
    return (
      <Stack.Navigator key="emp-gate-pin" screenOptions={{ headerShown: false }} initialRouteName="ForcedPinGate">
        <Stack.Screen
          name="ForcedPinGate"
          component={PinSetupScreen}
          initialParams={{ forced: true }}
        />
      </Stack.Navigator>
    );
  }

  return (
    <Stack.Navigator key="emp-portal" screenOptions={{ headerShown: false }}>
      <Stack.Screen name="EmployeeTabs" component={EmployeeTabs} />
      <Stack.Screen name="PinSetup" component={PinSetupScreen} />
      <Stack.Screen name="PinChange" component={PinChangeScreen} />
      <Stack.Screen name="ChangePassword" component={ChangePasswordScreen} />
    </Stack.Navigator>
  );
};
