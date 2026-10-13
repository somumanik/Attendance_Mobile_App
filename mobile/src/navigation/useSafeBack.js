// ============================================================================
// FILE: mobile/src/navigation/useSafeBack.js
// PURPOSE: Root-safe Back helper (no blind goBack())
// ============================================================================

/**
 * `useSafeBack` explicitly checks whether the current navigator can actually go
 * back before doing so, then falls back gracefully.
 *
 * Why this exists:
 *   Calling `navigation.goBack()` blindly on a ROOT route (for example the
 *   first screen of a nested Stack, or the app's root dashboard) does nothing
 *   useful and, on Android, can behave unpredictably. This helper makes the
 *   decision explicit:
 *     1. stack CAN go back  -> goBack()  (normal nested-screen behaviour)
 *     2. it cannot          -> call the caller's `fallback` when supplied
 *     3. no fallback        -> hand control back to the OS (Android exits the
 *                              app / closes the activity, matching the platform
 *                              root-screen convention) and is a safe no-op on
 *                              web preview.
 *
 * It never logs the user out and never navigates to a protected screen.
 *
 * Usage:
 *   const goBack = useSafeBack();                 // nested screen
 *   const goBack = useSafeBack(() => nav.navigate('HRTabs')); // parent tab
 */
import { useCallback } from 'react';
import { BackHandler } from 'react-native';
import { useNavigation } from '@react-navigation/native';

export const canGoBackSafely = (navigation) => {
  try {
    return typeof navigation?.canGoBack === 'function' && navigation.canGoBack() === true;
  } catch {
    return false;
  }
};

export const useSafeBack = (fallback) => {
  const navigation = useNavigation();

  return useCallback(() => {
    if (canGoBackSafely(navigation)) {
      navigation.goBack();
      return;
    }
    if (typeof fallback === 'function') {
      fallback();
      return;
    }
    // Root screen on Android: default platform behaviour (exit / close).
    // On web this is a no-op, so the browser preview is unaffected.
    if (typeof BackHandler?.exitApp === 'function') {
      try { BackHandler.exitApp(); } catch { /* no-op */ }
    }
  }, [navigation, fallback]);
};

export default useSafeBack;
