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
 *   └── Profile Tab → EmployeeProfileScreen
 * 
 * HR area se alag - Employee ko sirf apna data dikhta hai.
 * Backend APIs: /api/employee/* (role-based access)
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
import { EmployeeProfileScreen } from '../screens/employee/EmployeeProfileScreen';
import { PinSetupScreen } from '../screens/employee/PinSetupScreen';
import { PinChangeScreen } from '../screens/employee/PinChangeScreen';
import { COLORS } from '../utils/colors';

const Tab = createBottomTabNavigator();
// PIN screens ke liye stack (Phase 3A.8). Tabs ka structure bilkul same rehta hai.
const Stack = createStackNavigator();

/** Sirf PIN screens wala inner stack — tabs iske andar hi rehte hain. */
const EmployeeTabs = () => (
    <Tab.Navigator
      screenOptions={({ route }) => ({
        tabBarActiveTintColor: COLORS.primary,
        tabBarInactiveTintColor: COLORS.textTertiary,
        tabBarStyle: {
          backgroundColor: COLORS.surface,
          borderTopWidth: 1,
          borderTopColor: COLORS.divider,
          paddingBottom: 8,
          height: 64,
        },
        tabBarLabelStyle: {
          fontSize: 11,
          fontWeight: '600',
        },
        headerShown: false,
      })}
    >
      {/* Dashboard Tab */}
      <Tab.Screen
        name="Dashboard"
        component={EmployeeDashboardScreen}
        options={{
          tabBarLabel: 'Dashboard',
          tabBarIcon: ({ focused, color, size }) => (
            <Ionicons
              name={focused ? 'home' : 'home-outline'}
              size={size}
              color={color}
            />
          ),
        }}
      />
      
      {/* Attendance Tab */}
      <Tab.Screen
        name="Attendance"
        component={EmployeeAttendanceScreen}
        options={{
          tabBarLabel: 'Attendance',
          tabBarIcon: ({ focused, color, size }) => (
            <Ionicons
              name={focused ? 'calendar' : 'calendar-outline'}
              size={size}
              color={color}
            />
          ),
        }}
      />
      
      {/* Leave Tab */}
      <Tab.Screen
        name="Leave"
        component={EmployeeLeaveScreen}
        options={{
          tabBarLabel: 'Leave',
          tabBarIcon: ({ focused, color, size }) => (
            <Ionicons
              name={focused ? 'briefcase' : 'briefcase-outline'}
              size={size}
              color={color}
            />
          ),
        }}
      />
      
      {/* Reports Tab */}
      <Tab.Screen
        name="Reports"
        component={EmployeeReportsScreen}
        options={{
          tabBarLabel: 'Reports',
          tabBarIcon: ({ focused, color, size }) => (
            <Ionicons
              name={focused ? 'bar-chart' : 'bar-chart-outline'}
              size={size}
              color={color}
            />
          ),
        }}
      />
      
      {/* Birthday & Anniversary Tab */}
      <Tab.Screen
        name="BdayAnniversary"
        component={EmployeeBdayAnniversaryScreen}
        options={{
          tabBarLabel: 'Celebrations',
          tabBarIcon: ({ focused, color, size }) => (
            <Ionicons
              name={focused ? 'gift' : 'gift-outline'}
              size={size}
              color={color}
            />
          ),
        }}
      />

      {/* Profile Tab */}
      <Tab.Screen
        name="Profile"
        component={EmployeeProfileScreen}
        options={{
          tabBarLabel: 'Profile',
          tabBarIcon: ({ focused, color, size }) => (
            <Ionicons
              name={focused ? 'person' : 'person-outline'}
              size={size}
              color={color}
            />
          ),
        }}
      />
    </Tab.Navigator>
);

/**
 * Employee Navigator — bottom tabs + authenticated PIN screens (Phase 3A.8).
 *
 * Navigation Flow:
 * RootNavigator (Role Decision = EMPLOYEE)
 *   ↓
 * EmployeeNavigator
 *   ├── Tabs (Dashboard / Attendance / Leave / Reports / Profile)
 *   └── PIN screens (Profile se khulti hain)
 *         ├── PinSetupScreen  (jab PIN set nahi hai)
 *         └── PinChangeScreen (jab PIN pehle se set hai)
 */
export const EmployeeNavigator = () => {
  return (
    <Stack.Navigator screenOptions={{ headerShown: false }}>
      <Stack.Screen name="EmployeeTabs" component={EmployeeTabs} />
      <Stack.Screen name="PinSetup" component={PinSetupScreen} />
      <Stack.Screen name="PinChange" component={PinChangeScreen} />
    </Stack.Navigator>
  );
};