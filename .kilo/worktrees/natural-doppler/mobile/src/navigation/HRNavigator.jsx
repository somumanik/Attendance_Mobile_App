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
 *   └── Leave Mgmt Tab → HRLeaveManagementScreen
 * 
 * Email Configuration TAB NAHI HAI - mobile app se exclude kiya gaya hai.
 * Backend APIs: /api/hr/* (HR role required)
 */

import React from 'react';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { createStackNavigator } from '@react-navigation/stack';
import { Ionicons } from '@expo/vector-icons';
import { HRDashboardScreen } from '../screens/hr/HRDashboardScreen';
import { HREmployeesScreen } from '../screens/hr/HREmployeesScreen';
import { HRAuditScreen } from '../screens/hr/HRAuditScreen';
import { HRAnalyticsScreen } from '../screens/hr/HRAnalyticsScreen';
import { HRDailyMasterScreen } from '../screens/hr/HRDailyMasterScreen';
import { HRCelebrationsScreen } from '../screens/hr/HRCelebrationsScreen';
import { HRMarriageScreen } from '../screens/hr/HRMarriageScreen';
import { HRLeaveManagementScreen } from '../screens/hr/HRLeaveManagementScreen';
import { HREmployeeCredentialsScreen } from '../screens/hr/HREmployeeCredentialsScreen';
import { COLORS } from '../utils/colors';

const Tab = createBottomTabNavigator();
// HR-only credential management screen (Phase 3A.10) ke liye inner stack.
const Stack = createStackNavigator();

/** Per-tab accent colors so each bottom-nav icon is visually distinct. */
const TAB_ICON_COLORS = {
  Dashboard: '#2563EB',
  Employees: '#0D9488',
  Audit: '#7C3AED',
  Analytics: '#DB2777',
  DailyMaster: '#EA580C',
  Celebrations: '#CA8A04',
  Marriage: '#DC2626',
  LeaveMgmt: '#059669',
};

/** Selected icons use the full color; unselected icons use a muted version. */
const muted = (hex) => hex + '99';

const tabIcon = (name, focused, active, outline, size) => (
  <Ionicons name={focused ? active : outline} size={size} color={focused ? TAB_ICON_COLORS[name] : muted(TAB_ICON_COLORS[name])} />
);

const HRTabs = () => (
    <Tab.Navigator
      screenOptions={({ route }) => ({
        tabBarActiveTintColor: TAB_ICON_COLORS[route.name] || COLORS.primary,
        tabBarInactiveTintColor: COLORS.textTertiary,
        tabBarStyle: {
          backgroundColor: COLORS.surface,
          borderTopWidth: 1,
          borderTopColor: COLORS.divider,
          paddingBottom: 8,
          height: 64,
        },
        tabBarLabelStyle: {
          fontSize: 10,
          fontWeight: '600',
        },
        headerShown: false,
      })}
    >
      <Tab.Screen
        name="Dashboard"
        component={HRDashboardScreen}
        options={{
          tabBarLabel: 'Dashboard',
          tabBarIcon: ({ focused, size }) => tabIcon('Dashboard', focused, 'speedometer', 'speedometer-outline', size),
        }}
      />
      <Tab.Screen
        name="Employees"
        component={HREmployeesScreen}
        options={{
          tabBarLabel: 'Employees',
          tabBarIcon: ({ focused, size }) => tabIcon('Employees', focused, 'people', 'people-outline', size),
        }}
      />
      <Tab.Screen
        name="Audit"
        component={HRAuditScreen}
        options={{
          tabBarLabel: 'Audit',
          tabBarIcon: ({ focused, size }) => tabIcon('Audit', focused, 'person-search', 'person-search-outline', size),
        }}
      />
      <Tab.Screen
        name="Analytics"
        component={HRAnalyticsScreen}
        options={{
          tabBarLabel: 'Analytics',
          tabBarIcon: ({ focused, size }) => tabIcon('Analytics', focused, 'analytics', 'analytics-outline', size),
        }}
      />
      <Tab.Screen
        name="DailyMaster"
        component={HRDailyMasterScreen}
        options={{
          tabBarLabel: 'Daily Master',
          tabBarIcon: ({ focused, size }) => tabIcon('DailyMaster', focused, 'document-text', 'document-text-outline', size),
        }}
      />
      <Tab.Screen
        name="Celebrations"
        component={HRCelebrationsScreen}
        options={{
          tabBarLabel: 'Celebrations',
          tabBarIcon: ({ focused, size }) => tabIcon('Celebrations', focused, 'gift', 'gift-outline', size),
        }}
      />
      <Tab.Screen
        name="Marriage"
        component={HRMarriageScreen}
        options={{
          tabBarLabel: 'Marriage',
          tabBarIcon: ({ focused, size }) => tabIcon('Marriage', focused, 'heart', 'heart-outline', size),
        }}
      />
      <Tab.Screen
        name="LeaveMgmt"
        component={HRLeaveManagementScreen}
        options={{
          tabBarLabel: 'Leave Mgmt',
          tabBarIcon: ({ focused, size }) => tabIcon('LeaveMgmt', focused, 'calendar', 'calendar-outline', size),
        }}
      />
    </Tab.Navigator>
);

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
