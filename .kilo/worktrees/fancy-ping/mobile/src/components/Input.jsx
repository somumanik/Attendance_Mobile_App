// ============================================================================
// FILE: mobile/src/components/Input.jsx
// PURPOSE: Reusable input component with label, error, helper text
// ============================================================================

/**
 * Ye reusable input component hai.
 * Label, error message, helper text, leading/trailing icons support karta hai.
 * Multiple types: text, password, email, number, phone, date
 * Controlled component pattern.
 * 
 * Usage:
 * <Input
 *   label="Email"
 *   placeholder="Enter email"
 *   value={email}
 *   onChangeText={setEmail}
 *   error={emailError}
 *   helperText="We'll never share your email"
 *   leftIcon={<EmailIcon />}
 * />
 * 
 * Data Flow:
 * Parent manages value state
 *   ↓
 * Input renders with theme-aware styling
 *   ↓
 * onChangeText calls parent handler with new value
 *   ↓
 * Parent updates state
 */

import React, { forwardRef, useState } from 'react';
import { View, Text, TextInput, StyleSheet, TouchableOpacity } from 'react-native';
import { useTheme } from '../theme';

/**
 * Input Component
 * @param {string} label - Input label
 * @param {string} placeholder - Placeholder text
 * @param {string} value - Current value
 * @param {Function} onChangeText - Change handler
 * @param {string} error - Error message
 * @param {string} helperText - Helper text
 * @param {boolean} disabled - Disabled state
 * @param {boolean} required - Required field indicator
 * @param {string} type - Input type (text, password, email, number, phone, date)
 * @param {ReactNode} leftIcon - Leading icon
 * @param {ReactNode} rightIcon - Trailing icon (custom)
 * @param {string} autoCapitalize - 'none' | 'sentences' | 'words' | 'characters'
 * @param {string} autoComplete - Auto complete type
 * @param {string} returnKeyType - Return key type
 * @param {Function} onSubmitEditing - Submit handler
 * @param {Object} style - Additional styles
 * @param {Function} ref - Forwarded ref
 */
export const Input = forwardRef((
  {
    label,
    placeholder = '',
    value = '',
    onChangeText,
    error,
    helperText,
    disabled = false,
    required = false,
    type = 'text',
    leftIcon,
    rightIcon,
    autoCapitalize = 'none',
    autoComplete = 'off',
    returnKeyType = 'default',
    onSubmitEditing,
    style,
    testID,
  },
  ref
) => {
  const { theme } = useTheme();
  const [isFocused, setIsFocused] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const isPasswordType = type === 'password';

  const hasError = !!error;
  const isPasswordVisible = isPasswordType && !showPassword;

  const borderColor = hasError
    ? theme.error
    : isFocused
    ? theme.inputBorderFocus
    : disabled
    ? theme.border
    : theme.inputBorder;

  const backgroundColor = disabled ? theme.surfaceVariant : theme.inputBackground;

  const handleFocus = () => setIsFocused(true);
  const handleBlur = () => setIsFocused(false);

  const handleTextChange = (text) => {
    onChangeText?.(text);
  };

  const togglePasswordVisibility = () => {
    setShowPassword(!showPassword);
  };

  return (
    <View style={[styles.container, style]}>
      {label && (
        <View style={styles.labelContainer}>
          <Text style={styles.label}>
            {label}
            {required && <Text style={styles.requiredIndicator}>*</Text>}
          </Text>
        </View>
      )}

      <View style={styles.inputWrapper}>
        {leftIcon && (
          <View style={styles.iconLeft}>
            {leftIcon}
          </View>
        )}

        <TextInput
          ref={ref}
          testID={testID}
          style={[
            styles.input,
            {
              backgroundColor,
              borderColor,
              color: theme.textPrimary,
              placeholderTextColor: theme.inputPlaceholder,
            },
          ]}
          value={value}
          onChangeText={handleTextChange}
          onFocus={handleFocus}
          onBlur={handleBlur}
          placeholder={placeholder}
          disabled={disabled}
          editable={!disabled}
          secureTextEntry={isPasswordVisible}
          autoCapitalize={autoCapitalize}
          autoComplete={autoComplete}
          returnKeyType={returnKeyType}
          onSubmitEditing={onSubmitEditing}
          contextMenuHidden={isPasswordType}
          selectionColor={theme.primary}
        />

        {(isPasswordType || rightIcon) && (
          <View style={styles.iconRight}>
            {isPasswordType ? (
              <TouchableOpacity
                onPress={togglePasswordVisibility}
                hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                accessibilityLabel={showPassword ? 'Hide password' : 'Show password'}
              >
                {showPassword ? '👁️' : '🔒'}
              </TouchableOpacity>
            ) : (
              rightIcon
            )}
          </View>
        )}
      </View>

      {(error || helperText) && (
        <View style={styles.messageContainer}>
          {error && <Text style={styles.errorText}>{error}</Text>}
          {!error && helperText && <Text style={styles.helperText}>{helperText}</Text>}
        </View>
      )}
    </View>
  );
});

Input.displayName = 'Input';

const styles = StyleSheet.create({
  container: {
    gap: 6,
    width: '100%',
  },
  labelContainer: {
    gap: 4,
  },
  label: {
    fontSize: 13,
    fontWeight: '600',
  },
  requiredIndicator: {
    color: '#DC2626',
    marginLeft: 2,
  },
  inputWrapper: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'transparent',
    borderWidth: 1,
    borderRadius: 12,
    paddingHorizontal: 12,
  },
  iconLeft: {
    marginRight: 8,
    paddingLeft: 4,
  },
  iconRight: {
    marginLeft: 8,
    paddingRight: 4,
  },
  input: {
    flex: 1,
    paddingVertical: 12,
    paddingRight: 8,
    fontSize: 15,
    minHeight: 48,
  },
  messageContainer: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 4,
    paddingLeft: 4,
  },
  errorText: {
    fontSize: 11,
    fontWeight: '500',
  },
  helperText: {
    fontSize: 11,
  },
});

export default Input;