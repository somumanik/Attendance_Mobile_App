// ============================================================================
// FILE: mobile/src/screens/hr/HRMasterReportsScreen.jsx
// PURPOSE: HR Admin Master Reports — REUSES the existing Next.js website Master
//          Reports section via WebView/iframe. One UI implementation, one common backend.
//          No attendance logic lives in the mobile app for reports.
// ============================================================================

import React, { useState, useCallback, useRef, useEffect } from 'react';
import { View, Text, StyleSheet, ActivityIndicator, TouchableOpacity, Platform } from 'react-native';
import { WebView } from 'react-native-webview';
import { Ionicons } from '@expo/vector-icons';
import { useTheme } from '../../theme';
import { ScreenContainer } from '../../components/ScreenContainer';
import { useAuth } from '../../hooks/useAuth';
import { API_BASE_URL, WEB_BASE_URL } from '../../config';

export const HRMasterReportsScreen = () => {
  const { theme } = useTheme();
  const { token } = useAuth();
  const [handoffCode, setHandoffCode] = useState(null);
  const [fetching, setFetching] = useState(false);
  const [fetchError, setFetchError] = useState(null);
  const [webViewError, setWebViewError] = useState(false);
  const [reloadKey, setReloadKey] = useState(0);
  const webRef = useRef(null);

  const fetchHandoffCode = useCallback(async () => {
    if (!token) return;
    setFetching(true);
    setFetchError(null);
    setWebViewError(false);
    try {
      const res = await fetch(`${API_BASE_URL}/auth/handoff`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
      });
      const data = await res.json().catch(() => null);
      if (!res.ok || !data?.code) {
        throw new Error((data && data.message) || 'Handoff code issue nahi hua.');
      }
      setHandoffCode(data.code);
    } catch (e) {
      setFetchError(e && e.message ? e.message : 'Handoff failed.');
      setHandoffCode(null);
    } finally {
      setFetching(false);
    }
  }, [token]);

  useEffect(() => {
    fetchHandoffCode();
  }, [fetchHandoffCode, reloadKey]);

  const uri = handoffCode
    ? `${WEB_BASE_URL}/api/auth/webbridge?code=${encodeURIComponent(handoffCode)}`
    : null;

  const onError = useCallback(() => setWebViewError(true), []);
  const onLoadStart = useCallback(() => setWebViewError(false), []);

  const retry = useCallback(() => {
    setHandoffCode(null);
    setReloadKey((k) => k + 1);
  }, []);

  const isWeb = Platform.OS === 'web';

  return (
    <ScreenContainer title="Master Reports" showHeader>
      <View style={[styles.wrap, { backgroundColor: theme.background }]}>
        {fetching && !uri ? (
          <View style={styles.loadingWrap}>
            <ActivityIndicator size="large" color={theme.primary} />
            <Text style={[styles.statusText, { color: theme.textSecondary }]}>Session tayyar ho raha hai…</Text>
          </View>
        ) : fetchError ? (
          <View style={styles.errorWrap}>
            <Ionicons name="cloud-offline-outline" size={44} color={theme.textTertiary} />
            <Text style={[styles.errorText, { color: theme.textSecondary }]}>{fetchError}</Text>
            <TouchableOpacity onPress={retry} style={[styles.retryBtn, { borderColor: theme.primary }]}>
              <Text style={[styles.retryText, { color: theme.primary }]}>Retry</Text>
            </TouchableOpacity>
          </View>
        ) : uri ? (
          webViewError ? (
            <View style={styles.errorWrap}>
              <Ionicons name="cloud-offline-outline" size={44} color={theme.textTertiary} />
              <Text style={[styles.errorText, { color: theme.textSecondary }]}>
                Master Reports load nahi ho paya.{'\n'}Website server chal raha hai, check karein.
              </Text>
              <TouchableOpacity onPress={retry} style={[styles.retryBtn, { borderColor: theme.primary }]}>
                <Text style={[styles.retryText, { color: theme.primary }]}>Retry</Text>
              </TouchableOpacity>
            </View>
          ) : isWeb ? (
            <iframe
              key={reloadKey}
              src={uri}
              title="Master Reports"
              style={styles.iframe}
              onLoad={onLoadStart}
              onError={onError}
            />
          ) : (
            <WebView
              key={reloadKey}
              ref={webRef}
              source={{ uri }}
              onLoadStart={onLoadStart}
              onError={onError}
              onHttpError={(e) => {
                if (e?.nativeEvent?.statusCode === 401 || e?.nativeEvent?.statusCode === 403) {
                  setWebViewError(true);
                }
              }}
              startInLoadingState
              renderLoading={() => (
                <View style={styles.loadingWrap}>
                  <ActivityIndicator size="large" color={theme.primary} />
                </View>
              )}
              javaScriptEnabled
              domStorageEnabled
              setSupportMultipleWindows={false}
              allowsBackForwardNavigationGestures
              style={styles.web}
            />
          )
        ) : (
          <View style={styles.loadingWrap}>
            <ActivityIndicator size="large" color={theme.primary} />
          </View>
        )}
      </View>
    </ScreenContainer>
  );
};

const styles = StyleSheet.create({
  wrap: { flex: 1 },
  web: { flex: 1, backgroundColor: 'transparent' },
  iframe: { width: '100%', height: '100%', border: 'none', flex: 1 },
  loadingWrap: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 8 },
  statusText: { fontSize: 13, fontWeight: '600' },
  errorWrap: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 24, gap: 10 },
  errorText: { fontSize: 14, fontWeight: '600', textAlign: 'center', lineHeight: 20 },
  retryBtn: { marginTop: 6, borderWidth: 1, borderRadius: 20, paddingHorizontal: 22, paddingVertical: 10 },
  retryText: { fontSize: 13, fontWeight: '700' },
});

export default HRMasterReportsScreen;