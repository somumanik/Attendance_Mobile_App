// ============================================================================
// FILE: mobile/src/components/Avatar.jsx
// PURPOSE: Reusable avatar component with image, initials, and status indicator
// ============================================================================

/**
 * Ye reusable avatar component hai.
 * Image, initials fallback, status indicator, size variants support karta hai.
 * Online/offline/busy status indicator support karta hai.
 * 
 * Usage:
 * <Avatar name="Rajesh Kumar" size="large" status="online" />
 * <Avatar imageUrl={user.photo} size="medium" />
 * <Avatar initials="RK" size="small" />
 * 
 * Data Flow:
 * Parent passes name/image/initials
 *   ↓
 * Avatar renders with theme-aware styling
 *   ↓
 * Displays image, initials, or placeholder
 */

import React from 'react';
import { View, Text, Image, StyleSheet } from 'react-native';
import { useTheme } from '../theme';

/**
 * Avatar Component
 * @param {string} name - User name (for initials)
 * @param {string} imageUrl - Image URL
 * @param {string} initials - Custom initials (fallback from name)
 * @param {string} size - 'xs' | 'small' | 'medium' | 'large' | 'xl'
 * @param {string} status - 'online' | 'offline' | 'busy' | 'away' | null
 * @param {boolean} showStatus - Show status indicator
 * @param {Object} style - Additional styles
 * @param {string} shape - 'circle' | 'square'
 */
export const Avatar = ({
  name,
  imageUrl,
  initials,
  size = 'medium',
  status,
  showStatus = true,
  style,
  shape = 'circle',
  testID,
}) => {
  const { theme } = useTheme();

  // Size configuration
  const getSizeConfig = () => {
    switch (size) {
      case 'xs':
        return { width: 24, height: 24, fontSize: 9, statusSize: 8, statusOffset: -2 };
      case 'small':
        return { width: 32, height: 32, fontSize: 11, statusSize: 10, statusOffset: -3 };
      case 'large':
        return { width: 56, height: 56, fontSize: 20, statusSize: 14, statusOffset: -5 };
      case 'xl':
        return { width: 80, height: 80, fontSize: 28, statusSize: 18, statusOffset: -7 };
      case 'medium':
      default:
        return { width: 40, height: 40, fontSize: 14, statusSize: 12, statusOffset: -4 };
    }
  };

  const sizeConfig = getSizeConfig();
  const borderRadius = shape === 'square' ? 8 : sizeConfig.width / 2;

  // Generate initials from name
  const getInitials = () => {
    if (initials) return initials;
    if (name) {
      const parts = name.trim().split(/\s+/);
      if (parts.length >= 2) {
        return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
      }
      return parts[0].substring(0, 2).toUpperCase();
    }
    return '?';
  };

  const avatarInitials = getInitials();

  // Status color
  const getStatusColor = () => {
    switch (status) {
      case 'online': return theme.success;
      case 'busy': return theme.error;
      case 'away': return theme.warning;
      case 'offline': return theme.textTertiary;
      default: return theme.primary;
    }
  };

  return (
    <View style={[styles.container, { width: sizeConfig.width, height: sizeConfig.height }, style]} testID={testID}>
      {imageUrl ? (
        <Image
          source={{ uri: imageUrl }}
          style={[
            styles.image,
            { width: sizeConfig.width, height: sizeConfig.height, borderRadius },
          ]}
          resizeMode="cover"
        />
      ) : (
        <View style={[
          styles.initialsContainer,
          { width: sizeConfig.width, height: sizeConfig.height, borderRadius },
        ]}>
          <Text style={[
            styles.initialsText,
            { fontSize: sizeConfig.fontSize, color: theme.textOnPrimary },
          ]}>
            {avatarInitials}
          </Text>
        </View>
      )}

      {showStatus && status && (
        <View style={[
          styles.statusIndicator,
          {
            width: sizeConfig.statusSize,
            height: sizeConfig.statusSize,
            borderRadius: sizeConfig.statusSize / 2,
            backgroundColor: getStatusColor(),
            bottom: sizeConfig.statusOffset,
            right: sizeConfig.statusOffset,
          },
        ]} />
      )}
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    position: 'relative',
    alignItems: 'center',
    justifyContent: 'center',
  },
  image: {
    borderRadius: 9999,
  },
  initialsContainer: {
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#2563EB', // Will be theme-aware in practice
  },
  initialsText: {
    fontWeight: '700',
  },
  statusIndicator: {
    position: 'absolute',
    borderWidth: 2,
    borderColor: '#FFFFFF', // Will be theme-aware in practice
  },
});

export default Avatar;