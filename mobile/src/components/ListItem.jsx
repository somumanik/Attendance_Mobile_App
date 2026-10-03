// ============================================================================
// FILE: mobile/src/components/ListItem.jsx
// PURPOSE: Reusable list item component for employee lists, attendance rows, etc.
// ============================================================================

/**
 * Ye reusable list item component hai.
 * Left content (avatar/icon), center content (title, subtitle, meta), right content (action, badge, chevron)
 * Clickable, selectable, swipeable variants support karta hai.
 * 
 * Usage:
 * <ListItem
 *   left={<Avatar name="Rajesh" />}
 *   title="Rajesh Kumar"
 *   subtitle="Software Engineer"
 *   meta="IT Department"
 *   right={<Badge text="Present" status="present" />}
 *   onPress={handlePress}
 * />
 * 
 * Data Flow:
 * Parent passes content and handlers
 *   ↓
 * ListItem renders with theme-aware styling
 *   ↓
 * User interactions call navigation/API handlers
 */

import React from 'react';
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import { useTheme } from '../theme';

/**
 * ListItem Component
 * @param {ReactNode} left - Left content (Avatar, Icon)
 * @param {string} title - Main title
 * @param {string} subtitle - Subtitle
 * @param {string} meta - Meta info (department, date, etc.)
 * @param {ReactNode} right - Right content (Badge, Icon, Chevron)
 * @param {Function} onPress - Press handler
 * @param {boolean} selectable - Show selection checkbox
 * @param {boolean} selected - Selected state
 * @param {Function} onSelect - Selection handler
 * @param {boolean} swipeable - Enable swipe actions
 * @param {ReactNode} swipeLeft - Left swipe actions
 * @param {ReactNode} swipeRight - Right swipe actions
 * @param {boolean} bordered - Show bottom border
 * @param {Object} style - Additional styles
 */
export const ListItem = ({
  left,
  title,
  subtitle,
  meta,
  right,
  onPress,
  selectable = false,
  selected = false,
  onSelect,
  swipeable = false,
  swipeLeft,
  swipeRight,
  bordered = true,
  style,
  testID,
}) => {
  const { theme } = useTheme();

  const handlePress = () => {
    if (onPress) onPress();
  };

  const handleSelect = () => {
    if (onSelect) onSelect(!selected);
  };

  return (
    <TouchableOpacity
      testID={testID}
      style={[
        styles.container,
        {
          backgroundColor: selected ? theme.primaryContainer : theme.surface,
          borderBottomWidth: bordered ? StyleSheet.hairlineWidth : 0,
          borderBottomColor: theme.divider,
        },
        style,
      ]}
      onPress={handlePress}
      activeOpacity={onPress ? 0.85 : 1}
    >
      {selectable && (
        <TouchableOpacity
          style={styles.checkboxWrapper}
          onPress={handleSelect}
          hitSlop={{ top: 12, left: 12, bottom: 12, right: 12 }}
        >
          <View style={[
            styles.checkbox,
            {
              backgroundColor: selected ? theme.primary : 'transparent',
              borderColor: selected ? theme.primary : theme.border,
            },
          ]}>
            {selected && <Text style={styles.checkmark}>✓</Text>}
          </View>
        </TouchableOpacity>
      )}

      <View style={styles.contentWrapper}>
        {left && (
          <View style={styles.leftContent}>
            {left}
          </View>
        )}

        <View style={styles.centerContent}>
          {title && <Text style={styles.title} numberOfLines={1}>{title}</Text>}
          {subtitle && <Text style={styles.subtitle} numberOfLines={1}>{subtitle}</Text>}
          {meta && <Text style={styles.meta} numberOfLines={1}>{meta}</Text>}
        </View>

        {right && (
          <View style={styles.rightContent}>
            {right}
          </View>
        )}
      </View>
    </TouchableOpacity>
  );
};

const styles = StyleSheet.create({
  container: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 12,
    minHeight: 60,
  },
  checkboxWrapper: {
    marginRight: 12,
  },
  checkbox: {
    width: 22,
    height: 22,
    borderRadius: 6,
    borderWidth: 2,
    alignItems: 'center',
    justifyContent: 'center',
  },
  checkmark: {
    color: '#FFFFFF',
    fontSize: 14,
    fontWeight: '700',
  },
  contentWrapper: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    minWidth: 0,
  },
  leftContent: {
    flexShrink: 0,
  },
  centerContent: {
    flex: 1,
    minWidth: 0,
    gap: 2,
  },
  rightContent: {
    flexShrink: 0,
    alignItems: 'flex-end',
  },
  title: {
    fontSize: 15,
    fontWeight: '600',
    color: '#0F172A', // Will be theme-aware
  },
  subtitle: {
    fontSize: 13,
    fontWeight: '400',
  },
  meta: {
    fontSize: 11,
    fontWeight: '400',
  },
});

export default ListItem;