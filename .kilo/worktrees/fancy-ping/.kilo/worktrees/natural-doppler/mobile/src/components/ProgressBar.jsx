// ============================================================================
// FILE: mobile/src/components/ProgressBar.jsx
// PURPOSE: Reusable progress bar component for attendance percentages, etc.
// ============================================================================

/**
 * Ye reusable progress bar component hai.
 * Linear, circular, and segmented variants support karta hai.
 * Animated progress, custom colors, labels support karta hai.
 * 
 * Usage:
 * <ProgressBar progress={0.75} label="75% Complete" />
 * <ProgressBar variant="circular" progress={0.6} size={60} strokeWidth={6} />
 * <ProgressBar variant="segmented" segments={[{progress: 0.5, color: '#2563EB'}, {progress: 0.3, color: '#059669'}]} />
 * 
 * Data Flow:
 * Parent passes progress value
 *   ↓
 * ProgressBar renders with theme-aware styling
 *   ↓
 * Animated progress updates
 */

import React, { useEffect, useRef } from 'react';
import { View, Text, StyleSheet, Animated, Easing } from 'react-native';
import { useTheme } from '../theme';

/**
 * ProgressBar Component
 * @param {number} progress - Progress value (0 to 1)
 * @param {string} variant - 'linear' | 'circular' | 'segmented'
 * @param {string} label - Optional label
 * @param {string} labelPosition - 'top' | 'bottom' | 'inline'
 * @param {boolean} animated - Animate progress changes
 * @param {number} duration - Animation duration (ms)
 * @param {number} height - Bar height (linear)
 * @param {number} size - Size (circular)
 * @param {number} strokeWidth - Stroke width (circular)
 * @param {string} color - Progress color
 * @param {string} trackColor - Track color
 * @param {boolean} showLabel - Show percentage label
 * @param {Object} style - Additional styles
 */
export const ProgressBar = ({
  progress = 0,
  variant = 'linear',
  label,
  labelPosition = 'top',
  animated = true,
  duration = 500,
  height = 8,
  size = 60,
  strokeWidth = 6,
  color,
  trackColor,
  showLabel = true,
  style,
  testID,
}) => {
  const { theme } = useTheme();

  const progressColor = color || theme.primary;
  const trackBgColor = trackColor || theme.surfaceVariant;

  // Clamp progress between 0 and 1
  const clampedProgress = Math.max(0, Math.min(1, progress));
  const percentage = Math.round(clampedProgress * 100);

  const animatedProgress = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    if (animated) {
      Animated.timing(animatedProgress, {
        toValue: clampedProgress,
        duration,
        easing: Easing.out(Easing.cubic),
        useNativeDriver: false,
      }).start();
    } else {
      animatedProgress.setValue(clampedProgress);
    }
  }, [clampedProgress, animated, duration]);

  if (variant === 'circular') {
    const circumference = 2 * Math.PI * ((size - strokeWidth) / 2);
    const strokeDashoffset = circumference * (1 - animatedProgress._value);

    return (
      <View style={[styles.circularContainer, style]} testID={testID}>
        <View style={styles.circularWrapper}>
          <Animated.View style={[
            styles.circularTrack,
            { width: size, height: size },
          ]}>
            <Animated.View style={[
              styles.circularProgress,
              {
                width: size,
                height: size,
                borderWidth: strokeWidth,
                borderColor: progressColor,
                transform: [{ rotate: '-90deg' }],
                strokeDasharray: circumference,
                strokeDashoffset,
              },
            ]} />
          </Animated.View>
          {showLabel && (
            <Text style={[styles.circularLabel, { color: theme.textPrimary }]}>
              {percentage}%
            </Text>
          )}
        </View>
        {label && labelPosition !== 'inline' && (
          <Text style={[
            styles.circularLabel,
            { color: theme.textSecondary, marginTop: 8 },
          ]}>
            {label}
          </Text>
        )}
      </View>
    );
  }

  if (variant === 'segmented') {
    // For segmented, progress should be an array of { progress, color }
    const segments = progress || [];
    const totalProgress = segments.reduce((sum, s) => sum + (s.progress || 0), 0);

    return (
      <View style={[styles.linearContainer, style]} testID={testID}>
        {label && labelPosition === 'top' && (
          <View style={styles.labelRow}>
            <Text style={[styles.label, { color: theme.textPrimary }]}>{label}</Text>
            {showLabel && (
              <Text style={[styles.labelValue, { color: theme.textSecondary }]}>
                {Math.round(totalProgress * 100)}%
              </Text>
            )}
          </View>
        )}
        <View style={[styles.linearTrack, { height, backgroundColor: trackBgColor }]}>
          <View style={styles.linearSegments}>
            {segments.map((segment, index) => (
              <Animated.View
                key={index}
                style={[
                  styles.linearSegment,
                  {
                    width: `${(segment.progress || 0) * 100}%`,
                    backgroundColor: segment.color || theme.primary,
                  },
                ]}
              />
            ))}
          </View>
        </View>
        {label && labelPosition === 'bottom' && (
          <Text style={[styles.label, { color: theme.textSecondary, marginTop: 4 }]}>{label}</Text>
        )}
      </View>
    );
  }

  // Linear variant (default)
  return (
    <View style={[styles.linearContainer, style]} testID={testID}>
      {label && labelPosition === 'top' && (
        <View style={styles.labelRow}>
          <Text style={[styles.label, { color: theme.textPrimary }]}>{label}</Text>
          {showLabel && (
            <Animated.Text style={[styles.labelValue, { color: theme.textSecondary }]}>
              {animatedProgress._value.interpolate({
                inputRange: [0, 1],
                outputRange: ['0%', '100%'],
              })}
            </Animated.Text>
          )}
        </View>
      )}

      <View style={[
        styles.linearTrack,
        { height, backgroundColor: trackBgColor },
      ]}>
        <Animated.View style={[
          styles.linearProgress,
          {
            height: '100%',
            backgroundColor: progressColor,
          },
        ]}>
          {animatedProgress.interpolate({
            inputRange: [0, 1],
            outputRange: ['0%', '100%'],
          })}
        </Animated.View>
      </View>

      {label && labelPosition === 'bottom' && (
        <Text style={[styles.label, { color: theme.textSecondary, marginTop: 4 }]}>{label}</Text>
      )}
    </View>
  );
};

const styles = StyleSheet.create({
  linearContainer: {
    gap: 8,
  },
  linearTrack: {
    borderRadius: 9999,
    overflow: 'hidden',
  },
  linearProgress: {
    height: '100%',
    borderRadius: 9999,
  },
  linearSegments: {
    flexDirection: 'row',
    height: '100%',
  },
  linearSegment: {
    height: '100%',
  },
  circularContainer: {
    alignItems: 'center',
  },
  circularWrapper: {
    position: 'relative',
    alignItems: 'center',
    justifyContent: 'center',
  },
  circularTrack: {
    borderRadius: 9999,
  },
  circularProgress: {
    position: 'absolute',
    top: 0,
    left: 0,
    borderRadius: 9999,
  },
  circularLabel: {
    fontSize: 16,
    fontWeight: '700',
    marginTop: 8,
  },
  labelRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  label: {
    fontSize: 14,
    fontWeight: '600',
  },
  labelValue: {
    fontSize: 14,
    fontWeight: '600',
  },
});

export default ProgressBar;