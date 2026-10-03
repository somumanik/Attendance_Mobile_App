// ============================================================================
// FILE: mobile/src/components/Header.jsx
// PURPOSE: Reusable screen header with title, back action, and right actions
// ============================================================================

/**
 * Ye reusable screen header component hai.
 * Title, back button, right actions support karta hai.
 * Theme-aware styling.
 * 
 * Usage:
 * <Header title="Dashboard" backAction={() => navigation.goBack()} />
 * <Header title="Profile" rightAction={<Button />} />
 * 
 * Navigation Flow:
 * Screen renders Header
 *   ↓
 * User taps back → calls backAction (usually navigation.goBack())
 *   ↓
 * Screen navigates back
 * 
 * Data Flow:
 * Parent passes navigation actions
 *   ↓
 * Header renders with theme-aware styling
 *   ↓
 * User interactions call navigation callbacks
 */

import React from 'react';
import { View, Text, TouchableOpacity, StyleSheet, Platform } from 'react-native';
import { useTheme } from '../theme';
import { Ionicons } from '@expo/vector-icons';

/**
 * Header Component
 * @param {string} title - Screen title
 * @param {Function} backAction - Back button handler
 * @param {ReactNode} rightAction - Right side action element
 * @param {boolean} showBack - Show back button (default: true if backAction provided)
 * @param {string} titleAlign - 'center' | 'left' (default: center)
 * @param {Object} style - Additional styles
 */
export const Header = ({
  title,
  backAction,
  rightAction,
  showBack,
  titleAlign = 'center',
  style,
}) => {
  const { theme } = useTheme();
  const shouldShowBack = backAction && showBack !== false;

  return (
    <View style={[styles.container, { backgroundColor: theme.background }, style]}>
      <View style={styles.innerContainer}>
        {shouldShowBack && (
          <TouchableOpacity
            onPress={backAction}
            style={styles.backButton}
            hitSlop={{ top: 12, left: 12, bottom: 12, right: 12 }}
            activeOpacity={0.7}
            accessibilityLabel="Go back"
          >
            <Ionicons name="chevron-back" size={28} color={theme.textPrimary} />
          </TouchableOpacity>
        )}

        <View style={[styles.titleContainer, titleAlign === 'left' ? styles.titleLeft : {}]}>
          <Text style={[
            styles.title,
            { color: theme.textPrimary },
          ]}>
            {title}
          </Text>
        </View>

        <View style={styles.rightContainer}>
          {rightAction}
          {shouldShowBack && <View style={styles.backPlaceholder} />}
        </View>
      </View>

      <View style={[styles.divider, { backgroundColor: theme.divider }]} />
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    zIndex: 10,
  },
  innerContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingTop: Platform.OS === 'ios' ? 50 : 24,
    paddingBottom: 12,
    minHeight: Platform.OS === 'ios' ? 88 : 64,
  },
  backButton: {
    width: 44,
    height: 44,
    justifyContent: 'center',
    alignItems: 'center',
  },
  titleContainer: {
    flex: 1,
    alignItems: 'center',
    paddingHorizontal: 12,
  },
  titleLeft: {
    alignItems: 'flex-start',
  },
  title: {
    fontSize: 18,
    fontWeight: '700',
    maxWidth: '90%',
    textAlign: 'center',
  },
  rightContainer: {
    width: 44,
    alignItems: 'flex-end',
    justifyContent: 'center',
  },
  backPlaceholder: {
    width: 44,
  },
  divider: {
    height: StyleSheet.hairlineWidth,
  },
});

export default Header;