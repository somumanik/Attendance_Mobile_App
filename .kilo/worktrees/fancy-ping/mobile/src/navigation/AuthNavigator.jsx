// ============================================================================
// FILE: mobile/src/navigation/AuthNavigator.jsx
// PURPOSE: Authentication stack - Role selection, HR Login, Employee Login
// ============================================================================

/**
 * Ye file authentication navigation stack define karti hai.
 * 
 * Navigation Flow:
 * App Start
 *   ↓
 * AuthNavigator (initial route: RoleSelection)
 *   ↓
 * RoleSelectionScreen → User selects HR / Employee
 *   ↓
 * HRLoginScreen (agar HR selected)
 *   OR
 * EmployeeLoginScreen (agar Employee selected)
 *   ↓
 * Login Successful → RootNavigator switches to HRNavigator / EmployeeNavigator
 * 
 * Screens:
 * - RoleSelectionScreen: HR ya Employee choose karo
 * - HRLoginScreen: HR credentials enter karo (Phase 2 mein implement hoga)
 * - EmployeeLoginScreen: Employee paycode/password enter karo (Phase 2 mein implement hoga)
 */

import React from 'react';
import { createStackNavigator } from '@react-navigation/stack';
import { RoleSelectionScreen } from '../screens/auth/RoleSelectionScreen';
import { HRLoginScreen } from '../screens/auth/HRLoginScreen';
import { EmployeeLoginScreen } from '../screens/auth/EmployeeLoginScreen';
import { FirstTimeSetupScreen } from '../screens/auth/FirstTimeSetupScreen';
import { ForgotPasswordScreen } from '../screens/auth/ForgotPasswordScreen';
import { ResetPasswordScreen } from '../screens/auth/ResetPasswordScreen';

const Stack = createStackNavigator();

/**
 * Auth Stack Navigator
 * Header hide kiya hai - custom UI use karenge
 */
export const AuthNavigator = () => {
  return (
    <Stack.Navigator
      screenOptions={{
        headerShown: false,
        gestureEnabled: false, // Login flow mein back gesture disable
      }}
    >
      {/* Role Selection - Pehla screen */}
      <Stack.Screen
        name="RoleSelection"
        component={RoleSelectionScreen}
        options={{ title: 'Login' }}
      />
      
      {/* HR Login Screen */}
      <Stack.Screen
        name="HRLogin"
        component={HRLoginScreen}
        options={{ title: 'HR Admin Login' }}
      />
      
      {/* Employee Login Screen */}
      <Stack.Screen
        name="EmployeeLogin"
        component={EmployeeLoginScreen}
        options={{ title: 'Employee Login' }}
      />

      {/* First-time password setup - sirf tab jab employee ka password set nahi hai */}
      <Stack.Screen
        name="FirstTimeSetup"
        component={FirstTimeSetupScreen}
        options={{ title: 'Create Password' }}
      />

      {/* Forgot Password + Reset Password (Phase 3A.9) */}
      <Stack.Screen
        name="ForgotPassword"
        component={ForgotPasswordScreen}
        options={{ title: 'Forgot Password' }}
      />
      <Stack.Screen
        name="ResetPassword"
        component={ResetPasswordScreen}
        options={{ title: 'Reset Password' }}
      />
    </Stack.Navigator>
  );
};