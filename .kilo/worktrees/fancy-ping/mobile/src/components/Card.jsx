// ============================================================================
// FILE: mobile/src/components/Card.jsx
// PURPOSE: Reusable card component with multiple elevation levels
// ============================================================================

/**
 * Ye reusable card component hai.
 * Multiple elevation levels support karta hai: flat, raised, elevated
 * Clickable variant support karta hai.
 * Header, content, footer slots support karta hai.
 * 
 * Usage:
 * <Card>
 *   <Card.Header title="Title" subtitle="Subtitle" action={<Button />} />
 *   <Card.Content>Content here</Card.Content>
 *   <Card.Footer>Footer actions</Card.Footer>
 * </Card>
 * 
 * Data Flow:
 * Parent passes content as children
 *   ↓
 * Card renders with theme-aware styling
 *   ↓
 * Clickable cards call onPress handler
 */

import React from 'react';
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import { useTheme } from '../theme';

/**
 * Main Card Component
 * @param {ReactNode} children - Card content
 * @param {string} elevation - 'flat' | 'raised' | 'elevated'
 * @param {boolean} clickable - Whether card is clickable
 * @param {Function} onPress - Click handler
 * @param {Object} style - Additional styles
 * @param {boolean} bordered - Show border
 */
export const Card = ({
  children,
  elevation = 'raised',
  clickable = false,
  onPress,
  style,
  bordered = true,
  testID,
}) => {
  const { theme } = useTheme();

  const getElevationStyles = () => {
    switch (elevation) {
      case 'flat':
        return {
          shadowOpacity: 0,
          elevation: 0,
          borderWidth: bordered ? 1 : 0,
          borderColor: theme.border,
        };
      case 'raised':
        return {
          shadowColor: theme.shadow,
          shadowOffset: { width: 0, height: 2 },
          shadowOpacity: 1,
          shadowRadius: 4,
          elevation: 2,
          borderWidth: bordered ? 1 : 0,
          borderColor: theme.border,
        };
      case 'elevated':
        return {
          shadowColor: theme.shadowMedium,
          shadowOffset: { width: 0, height: 4 },
          shadowOpacity: 1,
          shadowRadius: 8,
          elevation: 4,
          borderWidth: bordered ? 1 : 0,
          borderColor: theme.border,
        };
      default:
        return {};
    }
  };

  const elevationStyles = getElevationStyles();

  // Clickable Card ke liye actual React Native component use hota hai.
  // String host component use karne se web runtime par invalid DOM tag ban raha tha.
  const Component = clickable ? TouchableOpacity : View;

  return (
    <Component
      testID={testID}
      style={[
        styles.container,
        {
          backgroundColor: theme.surface,
          borderRadius: 16,
          borderWidth: elevationStyles.borderWidth || 0,
          borderColor: elevationStyles.borderColor,
        },
        elevationStyles,
        style,
      ]}
      onPress={onPress}
      activeOpacity={clickable ? 0.9 : 1}
    >
      {children}
    </Component>
  );
};

/**
 * Card Header - Optional header with title, subtitle, and action
 * @param {string} title - Header title
 * @param {string} subtitle - Optional subtitle
 * @param {ReactNode} action - Optional action element (e.g., Button, Icon)
 * @param {Object} style - Additional styles
 */
Card.Header = ({ title, subtitle, action, style }) => {
  const { theme } = useTheme();
  return (
    <View style={[styles.header, { borderBottomColor: theme.border }, style]}>
      <View style={styles.headerContent}>
        {title && <Text style={styles.headerTitle}>{title}</Text>}
        {subtitle && <Text style={styles.headerSubtitle}>{subtitle}</Text>}
      </View>
      {action && <View style={styles.headerAction}>{action}</View>}
    </View>
  );
};

/**
 * Card Content - Main content area
 * @param {ReactNode} children - Content
 * @param {Object} style - Additional styles
 */
Card.Content = ({ children, style }) => {
  return (
    <View style={[styles.content, style]}>
      {children}
    </View>
  );
};

/**
 * Card Footer - Footer with actions
 * @param {ReactNode} children - Footer content (usually buttons)
 * @param {Object} style - Additional styles
 */
Card.Footer = ({ children, style }) => {
  const { theme } = useTheme();
  return (
    <View style={[styles.footer, { borderTopColor: theme.border }, style]}>
      {children}
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    borderRadius: 16,
    overflow: 'hidden',
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderBottomWidth: 1,
  },
  headerContent: {
    flex: 1,
    gap: 2,
  },
  headerTitle: {
    fontSize: 16,
    fontWeight: '700',
  },
  headerSubtitle: {
    fontSize: 12,
  },
  headerAction: {
    marginLeft: 12,
  },
  content: {
    padding: 16,
  },
  footer: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'flex-end',
    gap: 8,
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderTopWidth: 1,
  },
});

export default Card;