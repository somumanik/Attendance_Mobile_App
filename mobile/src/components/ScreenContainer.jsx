// ============================================================================
// FILE: mobile/src/components/ScreenContainer.jsx
// PURPOSE: Reusable screen wrapper with header and consistent styling
// ============================================================================

/**
 * Ye component har screen ka wrapper hai - consistent header aur styling provide karta hai.
 * Theme-aware styling use karta hai.
 * 
 * Features:
 * - Title bar with optional back button
 * - Safe area handling
 * - Consistent background color
 * - Theme-aware styling
 * 
 * Usage:
 * <ScreenContainer title="Screen Title" showHeader={true} backAction={() => navigation.goBack()}>
 *   <ScreenContent />
 * </ScreenContainer>
 * 
 * Data Flow:
 * Parent passes title, backAction, children
 *   ↓
 * ScreenContainer renders with theme-aware styling
 *   ↓
 * Child content renders inside safe area
 */

import React from 'react';
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useTheme } from '../theme';
import { Ionicons } from '@expo/vector-icons';

/**
 * Screen Container Component
 * @param {string} title - Screen title
 * @param {boolean} showHeader - Whether to show header
 * @param {Function} backAction - Back button action
 * @param {ReactNode} children - Screen content
 * @param {ReactNode} rightAction - Optional right header action
 */
export const ScreenContainer = ({ 
  title, 
  showHeader = true, 
  backAction, 
  children, 
  rightAction 
}) => {
  const { theme } = useTheme();

  return (
    <SafeAreaView style={[styles.container, { backgroundColor: theme.background }]} edges={['top', 'left', 'right']}>
      {showHeader && (
        <View style={[styles.header, { backgroundColor: theme.background, borderBottomColor: theme.divider }]}>
          {backAction ? (
            <TouchableOpacity 
              style={styles.backButton}
              onPress={backAction}
              hitSlop={{ top: 20, left: 20, bottom: 20, right: 20 }}
            >
              <Ionicons name="chevron-back" size={28} color={theme.textPrimary} />
            </TouchableOpacity>
          ) : (
            // Keeps the title optically centred when only a right action exists.
            <View style={styles.sideSpacer} />
          )}
          <View style={styles.titleContainer}>
            <Text
              style={[styles.title, { color: theme.textPrimary }]}
              numberOfLines={1}
              adjustsFontSizeToFit
              minimumFontScale={0.75}
            >
              {title}
            </Text>
          </View>
          {rightAction ? (
            // Auto-width slot (no fixed 44px) so header buttons are never clipped;
            // minHeight keeps icon-only actions at a comfortable tap size.
            <View style={styles.rightAction}>
              {rightAction}
            </View>
          ) : (
            <View style={styles.sideSpacer} />
          )}
        </View>
      )}
      <View style={styles.content}>{children}</View>
    </SafeAreaView>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 12,
    paddingVertical: 8,
    gap: 8,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  backButton: {
    width: 44,
    height: 44,
    justifyContent: 'center',
    alignItems: 'center',
    flexShrink: 0,
  },
  sideSpacer: {
    width: 12,
    flexShrink: 0,
  },
  titleContainer: {
    flex: 1,
    minWidth: 0,
    alignItems: 'center',
    justifyContent: 'center',
  },
  title: {
    fontSize: 20,
    fontWeight: '700',
    letterSpacing: -0.3,
    textAlign: 'center',
  },
  rightAction: {
    flexShrink: 0,
    minHeight: 44,
    minWidth: 44,
    justifyContent: 'center',
    alignItems: 'flex-end',
  },
  content: {
    flex: 1,
  },
});

export default ScreenContainer;