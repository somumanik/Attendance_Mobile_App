// ============================================================================
// FILE: mobile/src/components/Button.jsx
// PURPOSE: Reusable button component with multiple variants
// ============================================================================

/**
 * Ye reusable button component hai.
 * Multiple variants support karta hai: primary, secondary, outline, ghost, danger
 * Loading state, disabled state, full width support karta hai.
 * 
 * Usage:
 * <Button title="Login" onPress={handleLogin} variant="primary" />
 * <Button title="Cancel" onPress={handleCancel} variant="outline" />
 * <Button title="Save" onPress={handleSave} loading={isSaving} />
 * 
 * Data Flow:
 * Parent component passes onPress handler
 *   ↓
 * Button handles press, shows loading state
 *   ↓
 * Calls onPress callback
 *   ↓
 * Parent handles navigation/API call
 */

import React from 'react';
import { View, Text, TouchableOpacity, StyleSheet, ActivityIndicator } from 'react-native';
import { useTheme } from '../theme';

/**
 * Button Component
 * @param {string} title - Button text
 * @param {Function} onPress - Press handler
 * @param {string} variant - 'primary' | 'secondary' | 'outline' | 'ghost' | 'danger'
 * @param {boolean} loading - Loading state
 * @param {boolean} disabled - Disabled state
 * @param {boolean} fullWidth - Full width button
 * @param {string} size - 'small' | 'medium' | 'large'
 * @param {ReactNode} leftIcon - Left icon
 * @param {ReactNode} rightIcon - Right icon
 * @param {Object} style - Additional styles
 */
export const Button = ({
  title,
  onPress,
  variant = 'primary',
  loading = false,
  disabled = false,
  fullWidth = false,
  size = 'medium',
  leftIcon,
  rightIcon,
  style,
  testID,
}) => {
  const { theme } = useTheme();

  const isDisabled = disabled || loading;

  // Variant-based styles
  const getVariantStyles = () => {
    switch (variant) {
      case 'primary':
        return {
          backgroundColor: theme.buttonPrimary,
          textColor: theme.buttonPrimaryText,
          borderColor: theme.buttonPrimary,
        };
      case 'secondary':
        return {
          backgroundColor: theme.buttonSecondary,
          textColor: theme.buttonSecondaryText,
          borderColor: theme.buttonSecondary,
        };
      case 'outline':
        return {
          backgroundColor: 'transparent',
          textColor: theme.buttonOutlineText,
          borderColor: theme.buttonOutline,
          borderWidth: 1.5,
        };
      case 'ghost':
        return {
          backgroundColor: 'transparent',
          textColor: theme.primary,
          borderColor: 'transparent',
        };
      case 'danger':
        return {
          backgroundColor: theme.error,
          textColor: '#FFFFFF',
          borderColor: theme.error,
        };
      default:
        return {
          backgroundColor: theme.buttonPrimary,
          textColor: theme.buttonPrimaryText,
          borderColor: theme.buttonPrimary,
        };
    }
  };

  const variantStyles = getVariantStyles();

  // Size-based styles
  const getSizeStyles = () => {
    switch (size) {
      case 'small':
        return {
          paddingVertical: 8,
          paddingHorizontal: 16,
          fontSize: 13,
          iconSize: 16,
        };
      case 'large':
        return {
          paddingVertical: 16,
          paddingHorizontal: 24,
          fontSize: 16,
          iconSize: 20,
        };
      case 'medium':
      default:
        return {
          paddingVertical: 12,
          paddingHorizontal: 20,
          fontSize: 15,
          iconSize: 18,
        };
    }
  };

  const sizeStyles = getSizeStyles();

  return (
    <TouchableOpacity
      testID={testID}
      style={[
        styles.container,
        {
          backgroundColor: isDisabled ? theme.buttonDisabled : variantStyles.backgroundColor,
          borderColor: variantStyles.borderColor,
          borderWidth: variantStyles.borderWidth || 0,
          paddingVertical: sizeStyles.paddingVertical,
          paddingHorizontal: sizeStyles.paddingHorizontal,
          width: fullWidth ? '100%' : undefined,
        },
        style,
      ]}
      onPress={onPress}
      disabled={isDisabled}
      activeOpacity={isDisabled ? 1 : 0.85}
    >
      {loading ? (
        <ActivityIndicator
          size="small"
          color={variant === 'primary' || variant === 'danger' ? theme.textOnPrimary : theme.primary}
        />
      ) : (
        <View style={styles.content}>
          {leftIcon && <View style={styles.iconLeft}>{leftIcon}</View>}
          <Text
            style={[
              styles.text,
              {
                color: isDisabled ? theme.buttonDisabledText : variantStyles.textColor,
                fontSize: sizeStyles.fontSize,
              },
            ]}
          >
            {title}
          </Text>
          {rightIcon && <View style={styles.iconRight}>{rightIcon}</View>}
        </View>
      )}
    </TouchableOpacity>
  );
};

const styles = StyleSheet.create({
  container: {
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
    flexDirection: 'row',
    minHeight: 48,
  },
  content: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
  },
  text: {
    fontWeight: '600',
    fontFamily: undefined, // System font
  },
  iconLeft: {
    marginRight: 4,
  },
  iconRight: {
    marginLeft: 4,
  },
});

export default Button;