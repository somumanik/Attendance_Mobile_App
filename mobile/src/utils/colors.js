// ============================================================================
// FILE: mobile/src/utils/colors.js
// PURPOSE: Mobile app color theme - modern, clean, different from desktop
// ============================================================================

/**
 * Ye file mobile app ka color theme define karti hai.
 * Desktop website (dark purple theme) se alag modern light theme hai.
 * Mobile-first design ke liye clean, accessible colors use kiye gaye hain.
 */

export const COLORS = {
  // Primary Brand Colors
  primary: '#2563EB',      // Blue-600 - main brand color
  primaryLight: '#3B82F6', // Blue-500
  primaryDark: '#1D4ED8',  // Blue-700
  
  // Secondary Colors
  secondary: '#0D9488',    // Teal-600
  secondaryLight: '#14B8A6', // Teal-500
  
  // Semantic Colors
  success: '#059669',      // Emerald-600
  warning: '#D97706',      // Amber-600
  error: '#DC2626',        // Red-600
  info: '#0284C7',         // Sky-600
  
  // Neutral Colors
  background: '#F8FAFC',   // Slate-50 - main background
  surface: '#FFFFFF',      // White - card/screen background
  surfaceVariant: '#F1F5F9', // Slate-100
  
  // Text Colors
  textPrimary: '#0F172A',  // Slate-900 - primary text
  textSecondary: '#475569', // Slate-600 - secondary text
  textTertiary: '#94A3B8', // Slate-400 - tertiary/disabled text
  textOnPrimary: '#FFFFFF', // White - text on primary background
  
  // Border & Divider
  border: '#E2E8F0',       // Slate-200
  divider: '#F1F5F9',      // Slate-100
  
  // Status Colors (Attendance specific)
  present: '#059669',      // Green - Present
  absent: '#DC2626',       // Red - Absent
  missPunch: '#D97706',    // Amber - Miss Punch
  late: '#DC2626',         // Red - Late
  weekOff: '#64748B',      // Slate-500 - Week Off
  
  // Overlay & Shadow
  overlay: 'rgba(15, 23, 42, 0.5)', // Slate-900 with opacity
  shadow: 'rgba(15, 23, 42, 0.1)',
};

// Spacing Scale
export const SPACING = {
  xs: 4,
  sm: 8,
  md: 16,
  lg: 24,
  xl: 32,
  xxl: 48,
};

// Border Radius
export const BORDER_RADIUS = {
  sm: 4,
  md: 8,
  lg: 12,
  xl: 16,
  full: 9999,
};

// Typography Scale
export const TYPOGRAPHY = {
  h1: { fontSize: 32, fontWeight: '700', lineHeight: 40 },
  h2: { fontSize: 24, fontWeight: '600', lineHeight: 32 },
  h3: { fontSize: 20, fontWeight: '600', lineHeight: 28 },
  h4: { fontSize: 18, fontWeight: '600', lineHeight: 24 },
  body: { fontSize: 16, fontWeight: '400', lineHeight: 24 },
  bodySmall: { fontSize: 14, fontWeight: '400', lineHeight: 20 },
  caption: { fontSize: 12, fontWeight: '400', lineHeight: 16 },
  button: { fontSize: 16, fontWeight: '600', lineHeight: 24 },
};

// Shadow Presets
export const SHADOWS = {
  sm: {
    shadowColor: COLORS.shadow,
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 1,
    shadowRadius: 2,
    elevation: 1,
  },
  md: {
    shadowColor: COLORS.shadow,
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 1,
    shadowRadius: 8,
    elevation: 3,
  },
  lg: {
    shadowColor: COLORS.shadow,
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 1,
    shadowRadius: 16,
    elevation: 5,
  },
};