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
import { View, Text, TouchableOpacity, StyleSheet, SafeAreaView } from 'react-native';
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
    <SafeAreaView style={[styles.container, { backgroundColor: theme.background }]}>
      {showHeader && (
        <View style={[styles.header, { backgroundColor: theme.background, borderBottomColor: theme.divider }]}>
          {backAction && (
            <TouchableOpacity 
              style={styles.backButton}
              onPress={backAction}
              hitSlop={{ top: 20, left: 20, bottom: 20, right: 20 }}
            >
              <Ionicons name="chevron-back" size={28} color={theme.textPrimary} />
            </TouchableOpacity>
          )}
          <View style={styles.titleContainer}>
            <Text style={[styles.title, { color: theme.textPrimary, fontSize: 20 }]}>{title}</Text>
          </View>
          {rightAction && (
            <View style={styles.rightAction}>
              {rightAction}
            </View>
          )}
          {!backAction && !rightAction && <View style={styles.spacer} />}
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
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
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
  },
  title: {
    fontWeight: '700',
  },
  rightAction: {
    width: 44,
    height: 44,
    justifyContent: 'center',
    alignItems: 'center',
  },
  spacer: {
    width: 44,
  },
  content: {
    flex: 1,
  },
});

export default ScreenContainer;