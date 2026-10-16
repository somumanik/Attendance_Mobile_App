// ============================================================================
// FILE: mobile/src/components/TintIcon.jsx
// PURPOSE: Reusable colourful icon tile (Ionicons glyph on a soft tinted square)
// ============================================================================

/**
 * PREMIUM UI - TINTED ICON TILE (presentation only).
 *
 * Ek chhota rounded-square tile jo soft tinted background ke upar ek consistent
 * filled Ionicons glyph dikhata hai. Yeh app ke "colourful duotone" icon language
 * ka building block hai:
 *   - Glyph hamesha @expo/vector-icons Ionicons (free, already installed).
 *   - Background = accent colour ka soft tint (~12-15% alpha), text = accent colour.
 *   - Koi navigation, onPress, API, auth ya business logic nahi - pure visual.
 *
 * Usage:
 * <TintIcon name="people" color={theme.accentTeal} />
 * <TintIcon name="gift" color="#F43F5E" size={48} iconSize={26} radius={14} />
 */

import React from 'react';
import { View, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';

/**
 * TintIcon Component
 * @param {string} name - Ionicons glyph name (filled style recommended)
 * @param {string} color - Accent colour for glyph + tint background
 * @param {number} size - Tile side length (default 40)
 * @param {number} iconSize - Glyph size (default ~55% of tile)
 * @param {number} radius - Corner radius (default ~30% of tile)
 * @param {string} tint - Optional explicit tint background colour (overrides alpha tint)
 * @param {object} style - Extra style for the tile wrapper
 */
export const TintIcon = ({
  name = 'apps',
  color = '#2563EB',
  size = 40,
  iconSize,
  radius,
  tint,
  style,
}) => {
  const corner = radius != null ? radius : Math.round(size * 0.3);
  const glyph = iconSize != null ? iconSize : Math.max(12, Math.round(size * 0.55));
  const tintBackground = tint || `${color}1F`; // ~12% alpha tint

  return (
    <View
      style={[
        styles.tile,
        {
          width: size,
          height: size,
          borderRadius: corner,
          backgroundColor: tintBackground,
        },
        style,
      ]}
    >
      <Ionicons name={name} size={glyph} color={color} />
    </View>
  );
};

const styles = StyleSheet.create({
  tile: {
    alignItems: 'center',
    justifyContent: 'center',
  },
});

export default TintIcon;