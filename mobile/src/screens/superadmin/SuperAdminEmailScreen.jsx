// ============================================================================
// FILE: mobile/src/screens/superadmin/SuperAdminEmailScreen.jsx
// PURPOSE: Email Management (status / configuration / health)
// ============================================================================

/**
 * Email Management.
 *
 * Existing email APIs ko reuse karta hai (koi duplicate API nahi):
 *   GET  /api/email/config    -> sender name/email, enabled notification types
 *   POST /api/email/config    -> PARTIAL update (sirf bheje gaye fields)
 *   GET  /api/email/health    -> provider/transport health
 *
 * SECURITY: SMTP password / API key kabhi UI mein nahi dikhaye jaate. Provider
 * credentials server par encrypted rehte hain aur responses masked hote hain.
 */

import React, { useCallback, useState } from 'react';
import { View, Text, ScrollView, StyleSheet, Switch, TextInput, ActivityIndicator } from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import { ScreenContainer } from '../../components/ScreenContainer';
import { Button } from '../../components/Button';
import { COLORS, SPACING } from '../../utils/colors';
import { api } from '../../services/api';
import { API_ENDPOINTS } from '../../utils/constants';

export const SuperAdminEmailScreen = () => {
  const [config, setConfig] = useState(null);
  const [health, setHealth] = useState(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [msg, setMsg] = useState('');

  const load = useCallback(async () => {
    setError('');
    try {
      const cfg = await api.get(API_ENDPOINTS.EMAIL_CONFIG).catch(() => null);
      setConfig(cfg?.config || cfg || null);
      const h = await api.get(API_ENDPOINTS.EMAIL_HEALTH).catch(() => null);
      setHealth(h || null);
    } catch (e) {
      setError(e.message || 'Email configuration load nahi ho payi.');
    } finally {
      setLoading(false);
    }
  }, []);

  useFocusEffect(useCallback(() => { load(); }, [load]));

  const patch = (partial) => setConfig((prev) => ({ ...(prev || {}), ...partial }));

  const save = async () => {
    setBusy(true); setError(''); setMsg('');
    try {
      // Only send fields that were actually loaded, so a field the API did not
      // return can never be blanked out on the server.
      const body = {};
      ['sendername', 'senderemail', 'birthdaysubject', 'marriagesubject', 'workanniversarysubject', 'customsubject'].forEach((k) => {
        if (config && config[k] !== undefined && config[k] !== null) body[k] = String(config[k]);
      });
      ['birthdayenabled', 'marriageenabled', 'workanniversaryenabled'].forEach((k) => {
        if (config && typeof config[k] === 'boolean') body[k] = config[k];
      });
      if (!Object.keys(body).length) { setError('Nothing to save.'); setBusy(false); return; }
      await api.post(API_ENDPOINTS.EMAIL_CONFIG, body);
      setMsg('Email configuration saved.');
      await load();
    } catch (e) { setError(e.message || 'Save failed.'); } finally { setBusy(false); }
  };

  const providerLabel = health?.provider || health?.transport || '—';
  const healthOk = health?.ok === true || health?.status === 'ok' || health?.connected === true;

  return (
    <ScreenContainer title="Email Management" showHeader={true}>
      <ScrollView contentContainerStyle={styles.scroll} keyboardShouldPersistTaps="handled">
        <Text style={styles.hint}>
          Provider credentials (SMTP password / API key) server par encrypted rehte hain aur UI mein
          kabhi expose nahi hote — yahan sirf non-sensitive settings edit hoti hain.
        </Text>
        {error ? <Text style={styles.error}>{error}</Text> : null}
        {msg ? <Text style={styles.ok}>{msg}</Text> : null}
        {loading ? <ActivityIndicator color={COLORS.primary} style={{ marginVertical: 20 }} /> : null}

        <View style={styles.card}>
          <Text style={styles.cardTitle}>Transport health</Text>
          <Text style={styles.meta}>Provider: {String(providerLabel)}</Text>
          <Text style={[styles.meta, { color: healthOk ? COLORS.success : COLORS.warning }]}>
            {healthOk ? 'Reachable' : 'Status unavailable'}
          </Text>
        </View>

        {config ? (
          <View style={styles.card}>
            <Text style={styles.cardTitle}>Sender & notifications</Text>
            <Text style={styles.label}>Sender name</Text>
            <TextInput style={styles.input} value={String(config.sendername || '')} placeholderTextColor={COLORS.textTertiary}
              onChangeText={(v) => patch({ sendername: v })} />
            <Text style={styles.label}>Sender email</Text>
            <TextInput style={styles.input} value={String(config.senderemail || '')} placeholderTextColor={COLORS.textTertiary}
              autoCapitalize="none" keyboardType="email-address" onChangeText={(v) => patch({ senderemail: v })} />

            <View style={styles.switchRow}>
              <Text style={styles.label}>Birthday emails</Text>
              <Switch value={config.birthdayenabled === true} onValueChange={(v) => patch({ birthdayenabled: v })} />
            </View>
            <View style={styles.switchRow}>
              <Text style={styles.label}>Marriage anniversary emails</Text>
              <Switch value={config.marriageenabled === true} onValueChange={(v) => patch({ marriageenabled: v })} />
            </View>
            <View style={styles.switchRow}>
              <Text style={styles.label}>Work anniversary emails</Text>
              <Switch value={config.workanniversaryenabled === true} onValueChange={(v) => patch({ workanniversaryenabled: v })} />
            </View>

            <Text style={styles.label}>Email templates (subject lines)</Text>
            <TextInput style={styles.input} placeholder="Birthday subject" placeholderTextColor={COLORS.textTertiary}
              value={String(config.birthdaysubject || '')} onChangeText={(v) => patch({ birthdaysubject: v })} />
            <TextInput style={styles.input} placeholder="Marriage anniversary subject" placeholderTextColor={COLORS.textTertiary}
              value={String(config.marriagesubject || '')} onChangeText={(v) => patch({ marriagesubject: v })} />
            <TextInput style={styles.input} placeholder="Work anniversary subject" placeholderTextColor={COLORS.textTertiary}
              value={String(config.workanniversarysubject || '')} onChangeText={(v) => patch({ workanniversarysubject: v })} />
            <TextInput style={styles.input} placeholder="Custom / general subject" placeholderTextColor={COLORS.textTertiary}
              value={String(config.customsubject || '')} onChangeText={(v) => patch({ customsubject: v })} />

            <Button title={busy ? 'Saving...' : 'Save email settings'} onPress={save} disabled={busy} fullWidth />
          </View>
        ) : null}
      </ScrollView>
    </ScreenContainer>
  );
};

const styles = StyleSheet.create({
  scroll: { padding: SPACING.md, paddingBottom: SPACING.xl },
  hint: { fontSize: 11.5, color: COLORS.textSecondary, marginBottom: SPACING.md, lineHeight: 17 },
  error: { color: COLORS.error, fontSize: 12, marginBottom: SPACING.sm },
  ok: { color: COLORS.success, fontSize: 12, marginBottom: SPACING.sm },
  card: { backgroundColor: COLORS.surface, borderWidth: 1, borderColor: COLORS.border, borderRadius: 12, padding: SPACING.md, marginBottom: SPACING.md },
  cardTitle: { fontSize: 14, fontWeight: '800', color: COLORS.textPrimary, marginBottom: SPACING.sm },
  meta: { fontSize: 11.5, color: COLORS.textSecondary, marginTop: 2 },
  label: { fontSize: 12, fontWeight: '700', color: COLORS.textPrimary, marginTop: SPACING.sm },
  input: { borderWidth: 1, borderColor: COLORS.border, borderRadius: 10, paddingHorizontal: SPACING.md, paddingVertical: 9, marginTop: 4, color: COLORS.textPrimary, backgroundColor: COLORS.surface },
  switchRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: SPACING.sm },
});

export default SuperAdminEmailScreen;
