// ============================================================================
// FILE: mobile/src/components/Badge.jsx
// PURPOSE: Reusable badge/status chip component
// ============================================================================

/**
 * Ye reusable badge/chip component hai.
 * Multiple variants support karta hai: default, status, attendance, dot
 * Size variants: small, medium, large
 * Clickable variant support karta hai.
 * 
 * Usage:
 * <Badge text="Present" variant="attendance" status="present" />
 * <Badge text="HR" variant="default" />
 * <Badge text="5" variant="dot" />
 * <Badge text="Late" variant="status" status="late" />
 * 
 * Data Flow:
 * Parent passes text/status
 *   ↓
 * Badge renders with theme-aware colors
 *   ↓
 * Clickable badges call onPress handler
 */

import React from 'react';
import { View, Text, StyleSheet, TouchableOpacity } from 'react-native';
import { useTheme } from '../theme';

/**
 * Badge Component
 * @param {string} text - Badge text
 * @param {string} variant - 'default' | 'status' | 'attendance' | 'dot' | 'outline'
 * @param {string} status - Status for attendance/status variants
 * @param {string} size - 'small' | 'medium' | 'large'
 * @param {boolean} clickable - Whether badge is clickable
 * @param {Function} onPress - Click handler
 * @param {ReactNode} leftIcon - Left icon
 * @param {ReactNode} rightIcon - Right icon
 * @param {Object} style - Additional styles
 */
export const Badge = ({
  text,
  variant = 'default',
  status,
  size = 'medium',
  clickable = false,
  onPress,
  leftIcon,
  rightIcon,
  style,
  testID,
}) => {
  const { theme } = useTheme();

  // Get variant styles
  const getVariantStyles = () => {
    // For attendance/status variants, use status color
    if ((variant === 'attendance' || variant === 'status') && status) {
      const statusColor = theme.status[status] || theme.primary;
      return {
        backgroundColor: `${statusColor}15`, // 10% opacity
        textColor: statusColor,
        borderColor: `${statusColor}40`, // 25% opacity
      };
    }

    switch (variant) {
      case 'outline':
        return {
          backgroundColor: 'transparent',
          textColor: theme.primary,
          borderColor: theme.primary,
          borderWidth: 1,
        };
      case 'dot':
        return {
          backgroundColor: theme.primaryContainer,
          textColor: theme.primary,
          borderColor: 'transparent',
        };
      case 'secondary':
        return {
          backgroundColor: theme.secondaryContainer,
          textColor: theme.secondary,
          borderColor: 'transparent',
        };
      case 'success':
        return {
          backgroundColor: theme.successContainer,
          textColor: theme.success,
          borderColor: 'transparent',
        };
      case 'warning':
        return {
          backgroundColor: theme.warningContainer,
          textColor: theme.warning,
          borderColor: 'transparent',
        };
      case 'error':
        return {
          backgroundColor: theme.errorContainer,
          textColor: theme.error,
          borderColor: 'transparent',
        };
      case 'default':
      default:
        return {
          backgroundColor: theme.primaryContainer,
          textColor: theme.primary,
          borderColor: 'transparent',
        };
    }
  };

  const variantStyles = getVariantStyles();

  // Size styles
  const getSizeStyles = () => {
    switch (size) {
      case 'small':
        return {
          paddingHorizontal: 8,
          paddingVertical: 2,
          fontSize: 10,
          borderRadius: 8,
          iconSize: 10,
          gap: 3,
        };
      case 'large':
        return {
          paddingHorizontal: 14,
          paddingVertical: 6,
          fontSize: 13,
          borderRadius: 24,
          iconSize: 16,
          gap: 6,
        };
      case 'medium':
      default:
        return {
          paddingHorizontal: 10,
          paddingVertical: 4,
          fontSize: 11,
          borderRadius: 16,
          iconSize: 12,
          gap: 4,
        };
    }
  };

  const sizeStyles = getSizeStyles();

  const Component = onPress ? TouchableOpacity : View;

  return (
    <Component
      testID={testID}
      style={[
        styles.container,
        {
          backgroundColor: variantStyles.backgroundColor,
          borderColor: variantStyles.borderColor,
          borderWidth: variantStyles.borderWidth || 0,
          paddingHorizontal: sizeStyles.paddingHorizontal,
          paddingVertical: sizeStyles.paddingVertical,
          borderRadius: sizeStyles.borderRadius,
          gap: sizeStyles.gap,
        },
        style,
      ]}
      onPress={onPress}
      activeOpacity={onPress ? 0.85 : 1}
    >
      <View style={styles.content}>
        {leftIcon && <View style={styles.iconLeft}>{leftIcon}</View>}
        {text && (
          <Text
            style={[
              styles.text,
              {
                color: variantStyles.textColor,
                fontSize: sizeStyles.fontSize,
              },
            ]}
          >
            {text}
          </Text>
        )}
        {rightIcon && <View style={styles.iconRight}>{rightIcon}</View>}
      </View>
    </Component>
  );
};

// Predefined status badges for attendance
export const AttendanceBadge = ({ status, size = 'medium', style }) => {
  const labels = {
    present: 'Present',
    absent: 'Absent',
    missPunch: 'Miss Punch',
    late: 'Late',
    weekOff: 'Week Off',
    halfDay: 'Half Day',
    shortLeave: 'Short Leave',
    pow: 'Present (WO)',
  };

  return (
    <Badge
      text={labels[status] || status}
      variant="attendance"
      status={status}
      size={size}
      style={style}
    />
  );
};

export const StatusBadge = ({ status, size = 'medium', style }) => {
  return (
    <Badge
      text={status}
      variant="status"
      status={status.toLowerCase()}
      size={size}
      style={style}
    />
  );
};

const styles = StyleSheet.create({
  container: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  content: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  iconLeft: {
    marginRight: 2,
  },
  iconRight: {
    marginLeft: 2,
  },
  text: {
    fontWeight: '700',
    lineHeight: 1,
  },
});

export default Badge;