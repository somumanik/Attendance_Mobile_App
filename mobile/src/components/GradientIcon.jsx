// ============================================================================
// FILE: mobile/src/components/GradientIcon.jsx
// PURPOSE: Phase L - reusable colourful gradient icon tile (pure React Native)
// ============================================================================

/**
 * PHASE L - COLOURFUL GRADIENT ICON SYSTEM (presentation only).
 *
 * Ek chhota modern "app icon" tile banata hai: rounded-square ke andar ek smooth
 * two-colour gradient, upar ek soft gloss, aur beech me ek white vector glyph
 * (@expo/vector-icons Ionicons). Yeh Flaticon-style gradient app icons ka look
 * deta hai jo user ki reference screenshot me tha.
 *
 * Kyun apna gradient (koi library nahi):
 *   - is project me expo-linear-gradient / react-native-svg / masked-view
 *     INSTALLED NAHI hain, aur Phase L ka rule hai "do not add a dependency only
 *     for a handful of icons" + "app must keep working offline".
 *   - Isliye gradient ko pure React Native views se banaya gaya hai: tile ko
 *     chhoti chhoti horizontal slices (BANDS) me todkar har slice ka colour
 *     do stops ke beech interpolate kiya jata hai -> aankh ko smooth gradient
 *     dikhta hai. Yeh native (Android/iOS) aur react-native-web dono par
 *     identical render hota hai, koi browser-only CSS use nahi hua.
 *
 * IMPORTANT: Yeh component sirf VISUAL hai. Isme koi navigation, onPress,
 * route, API, auth ya business logic nahi hai. Ise jahan lagayenge wahan ke
 * touch area / accessibility / active state waise hi kaam karte rahenge,
 * kyunki parent (tab button) hi sab kuch handle karta hai.
 */

import React from 'react';
import { View, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';

/** Vertical slices used to fake a smooth linear gradient. */
const BANDS = 14;
/** Slices of the soft white gloss at the top (adds the modern "glass" depth). */
const SHEEN_BANDS = 5;

/** #RGB / #RRGGBB -> [r, g, b]. Invalid values fall back to blue-600. */
const toRgb = (value) => {
  const raw = String(value == null ? '' : value).replace('#', '').trim();
  const full = raw.length === 3 ? raw.split('').map((c) => c + c).join('') : raw;
  const int = parseInt(full.slice(0, 6), 16);
  if (!Number.isFinite(int)) return [37, 99, 235];
  return [(int >> 16) & 255, (int >> 8) & 255, int & 255];
};

const byte = (n) => Math.max(0, Math.min(255, Math.round(n))).toString(16).padStart(2, '0');

/**
 * Linear interpolation between two hex colours.
 * @param {string} a start colour (#RRGGBB)
 * @param {string} b end colour   (#RRGGBB)
 * @param {number} t 0 -> a, 1 -> b
 */
export const mixGradientColor = (a, b, t) => {
  const A = toRgb(a);
  const B = toRgb(b);
  const k = Math.max(0, Math.min(1, t));
  return `#${byte(A[0] + (B[0] - A[0]) * k)}${byte(A[1] + (B[1] - A[1]) * k)}${byte(A[2] + (B[2] - A[2]) * k)}`;
};

/**
 * Colourful gradient icon tile.
 *
 * @param {string}  from       gradient start colour (top)   - default brand blue
 * @param {string}  to         gradient end colour   (bottom)
 * @param {string}  name       Ionicons glyph name (filled glyph recommended)
 * @param {number}  size       tile side length in px (square)
 * @param {number}  radius     corner radius (default ~30% of size = squircle)
 * @param {string}  glyphColor glyph colour (white by default - sits on gradient)
 * @param {number}  glyphRatio glyph size relative to the tile
 * @param {number}  opacity    whole-tile opacity (used for active vs inactive)
 * @param {boolean} active     active tile -> slight lift/shadow, full colour
 * @param {string}  haloColor  optional soft tinted background visible as a
 *                             ring around the tile (premium tab treatment).
 *                             Pass 'transparent' for the same geometry without
 *                             a tint. Omitted -> tile fills the whole wrapper
 *                             exactly as before, so every existing usage is
 *                             pixel-identical.
 * @param {number}  haloRadius optional wrapper corner radius override
 * @param {object}  style      extra style for the tile wrapper
 */
export const GradientIcon = ({
  from = '#2563EB',
  to = '#7C3AED',
  name = 'apps',
  size = 28,
  radius,
  glyphColor = '#FFFFFF',
  glyphRatio = 0.58,
  opacity = 1,
  active = false,
  haloColor,
  haloRadius,
  style,
}) => {
  // The wrapper always keeps the exact `size` footprint (it sits inside the
  // tab bar's fixed icon box, which may clip on Android), so the tinted halo
  // is drawn as a full-wrapper background with the tile inset - never larger
  // than the icon box. With no halo the tile fills the wrapper as before.
  const haloPad = haloColor ? Math.max(2, Math.round(size * 0.13)) : 0;
  const tileSize = size - haloPad * 2;
  const corner = radius != null ? radius : Math.round(size * 0.3);
  const tileCorner = radius != null ? radius : Math.round(tileSize * 0.3);

  // Base vertical gradient -> one slice per band (this is the "gradient").
  const bands = [];
  for (let i = 0; i < BANDS; i += 1) {
    bands.push(
      <View
        key={`band-${i}`}
        style={{ flex: 1, backgroundColor: mixGradientColor(from, to, i / (BANDS - 1)) }}
      />,
    );
  }

  // Soft gloss on the top half -> fades from light to transparent.
  const sheen = [];
  for (let i = 0; i < SHEEN_BANDS; i += 1) {
    const alpha = (0.2 * (1 - i / SHEEN_BANDS)).toFixed(3);
    sheen.push(
      <View key={`sheen-${i}`} style={{ flex: 1, backgroundColor: `rgba(255,255,255,${alpha})` }} />,
    );
  }

  return (
    <View
      style={[
        styles.wrap,
        { width: size, height: size, borderRadius: haloRadius != null ? haloRadius : corner, opacity },
        haloColor ? { backgroundColor: haloColor } : null,
        active && styles.activeWrap,
        style,
      ]}
    >
      <View style={[styles.tile, { width: tileSize, height: tileSize, borderRadius: tileCorner }]}>
        <View style={StyleSheet.absoluteFill}>{bands}</View>
        <View pointerEvents="none" style={styles.sheen}>{sheen}</View>
        <View pointerEvents="none" style={styles.glyphWrap}>
          <Ionicons
            name={name}
            size={Math.max(10, Math.round(tileSize * glyphRatio))}
            color={glyphColor}
          />
        </View>
      </View>
    </View>
  );
};

const styles = StyleSheet.create({
  // Outer wrapper carries the shadow and (optionally) the tinted halo; the
  // inner tile keeps its own size and clips its gradient.
  wrap: { backgroundColor: 'transparent', alignItems: 'center', justifyContent: 'center' },
  activeWrap: {
    elevation: 3,
    shadowColor: '#0F172A',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.3,
    shadowRadius: 3,
  },
  tile: {
    overflow: 'hidden',
    alignItems: 'center',
    justifyContent: 'center',
  },
  sheen: { position: 'absolute', top: 0, left: 0, right: 0, height: '48%' },
  glyphWrap: {
    ...StyleSheet.absoluteFillObject,
    alignItems: 'center',
    justifyContent: 'center',
  },
});

export default GradientIcon;
