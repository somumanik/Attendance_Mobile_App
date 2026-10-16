// ============================================================================
// FILE: mobile/src/screens/superadmin/SuperAdminUsersScreen.jsx
// PURPOSE: SuperAdmin user management (list / create / enable / delete)
// ============================================================================

/**
 * SuperAdmin User Management.
 *
 * SECURITY: yahi screen aur iske pichhe ke endpoints sirf SUPERADMIN role ke liye
 * hain. Bootstrap (env) SuperAdmin protected hai — server use delete/disable
 * nahi hone deta, aur last active SuperAdmin bhi protect hota hai.
 * Password kabhi response mein nahi aata; sirf status/list dikhti hai.
 */

import React, { useCallback, useState } from 'react';
import { View, Text, ScrollView, StyleSheet, TouchableOpacity, TextInput, Alert, ActivityIndicator, RefreshControl } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useFocusEffect } from '@react-navigation/native';
import { ScreenContainer } from '../../components/ScreenContainer';
import { Button } from '../../components/Button';
import { COLORS, SPACING } from '../../utils/colors';
import { listSuperAdmins, createSuperAdmin, setSuperAdminActive, deleteSuperAdmin } from '../../services/adminAccess';

export const SuperAdminUsersScreen = () => {
  const [admins, setAdmins] = useState([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [msg, setMsg] = useState('');
  const [form, setForm] = useState({ username: '', password: '', displayname: '' });

  const load = useCallback(async () => {
    setError('');
    try {
      const res = await listSuperAdmins();
      setAdmins(Array.isArray(res?.admins) ? res.admins : []);
    } catch (e) {
      setError(e.message || 'SuperAdmin list load nahi ho payi.');
    } finally {
      setLoading(false);
    }
  }, []);

  useFocusEffect(useCallback(() => { load(); }, [load]));

  const submit = async () => {
    setMsg(''); setError('');
    if (!form.username.trim() || !form.password) { setError('Username aur password required hain.'); return; }
    setBusy(true);
    try {
      await createSuperAdmin(form);
      setForm({ username: '', password: '', displayname: '' });
      setMsg('SuperAdmin account ban gaya.');
      await load();
    } catch (e) { setError(e.message || 'Create failed.'); } finally { setBusy(false); }
  };

  const toggle = async (row) => {
    setError(''); setMsg('');
    try { await setSuperAdminActive(row.username, !row.isactive); await load(); }
    catch (e) { setError(e.message || 'Update failed.'); }
  };

  const remove = (row) => {
    Alert.alert('Delete SuperAdmin', `"${row.username}" ko delete karna hai?`, [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Delete',
        style: 'destructive',
        onPress: async () => {
          setError(''); setMsg('');
          try { await deleteSuperAdmin(row.username); await load(); }
          catch (e) { setError(e.message || 'Delete failed.'); }
        },
      },
    ]);
  };

  return (
    <ScreenContainer title="SuperAdmin Users" showHeader={true}>
      <ScrollView keyboardShouldPersistTaps="handled"
        contentContainerStyle={styles.scroll}
        refreshControl={<RefreshControl refreshing={false} onRefresh={load} />}
      >
        <Text style={styles.hint}>
          Bootstrap (server environment) SuperAdmin permanent hai — delete ya disable nahi ho sakta.
          Kam se kam ek active SuperAdmin hamesha bacha rahega.
        </Text>

        {error ? <Text style={styles.error}>{error}</Text> : null}
        {msg ? <Text style={styles.ok}>{msg}</Text> : null}
        {loading ? <ActivityIndicator color={COLORS.primary} style={{ marginVertical: 20 }} /> : null}

        {admins.map((row) => (
          <View key={row.username} style={styles.card}>
            <View style={styles.cardTop}>
              <View style={{ flex: 1, minWidth: 0 }}>
                <Text style={styles.username}>{row.username}{row.isbootstrap ? '  ' : ''}{row.isbootstrap ? <Ionicons name="lock-closed" size={12} color={COLORS.warning} /> : null}</Text>
                <Text style={styles.meta}>{row.displayname || '—'}</Text>
                <Text style={[styles.meta, { color: row.isactive ? COLORS.success : COLORS.error }]}>
                  {row.isactive ? 'Active' : 'Disabled'}{row.source === 'env' ? ' · env-managed' : ''}
                </Text>
              </View>
              {row.isbootstrap ? null : (
                <View style={styles.actions}>
                  <TouchableOpacity onPress={() => toggle(row)} style={styles.smallBtn}>
                    <Text style={styles.smallBtnText}>{row.isactive ? 'Disable' : 'Enable'}</Text>
                  </TouchableOpacity>
                  <TouchableOpacity onPress={() => remove(row)} style={[styles.smallBtn, styles.dangerBtn]}>
                    <Text style={[styles.smallBtnText, { color: COLORS.error }]}>Delete</Text>
                  </TouchableOpacity>
                </View>
              )}
            </View>
          </View>
        ))}

        <Text style={styles.sectionTitle}>Add a SuperAdmin</Text>
        <TextInput style={styles.input} placeholder="Username" placeholderTextColor={COLORS.textTertiary}
          autoCapitalize="none" value={form.username} onChangeText={(v) => setForm({ ...form, username: v })} />
        <TextInput style={styles.input} placeholder="Display name (optional)" placeholderTextColor={COLORS.textTertiary}
          value={form.displayname} onChangeText={(v) => setForm({ ...form, displayname: v })} />
        <TextInput style={styles.input} placeholder="Password (min 8, letters + numbers)" placeholderTextColor={COLORS.textTertiary}
          secureTextEntry value={form.password} onChangeText={(v) => setForm({ ...form, password: v })} />
        <Button title={busy ? 'Saving...' : 'Create SuperAdmin'} onPress={submit} disabled={busy} fullWidth />
      </ScrollView>
    </ScreenContainer>
  );
};

const styles = StyleSheet.create({
  scroll: { padding: SPACING.md, paddingBottom: SPACING.xl },
  hint: { fontSize: 11.5, color: COLORS.textSecondary, marginBottom: SPACING.md, lineHeight: 17 },
  error: { color: COLORS.error, fontSize: 12, marginBottom: SPACING.sm },
  ok: { color: COLORS.success, fontSize: 12, marginBottom: SPACING.sm },
  card: { backgroundColor: COLORS.surface, borderWidth: 1, borderColor: COLORS.border, borderRadius: 12, padding: SPACING.md, marginBottom: SPACING.sm },
  cardTop: { flexDirection: 'row', alignItems: 'center', gap: SPACING.sm },
  username: { fontSize: 14, fontWeight: '800', color: COLORS.textPrimary },
  meta: { fontSize: 11, color: COLORS.textSecondary, marginTop: 2 },
  actions: { flexDirection: 'row', gap: 6 },
  smallBtn: { paddingHorizontal: 10, paddingVertical: 5, borderRadius: 8, borderWidth: 1, borderColor: COLORS.border },
  dangerBtn: { borderColor: '#FECACA' },
  smallBtnText: { fontSize: 11, fontWeight: '700', color: COLORS.textSecondary },
  sectionTitle: { fontSize: 14, fontWeight: '800', color: COLORS.textPrimary, marginTop: SPACING.lg, marginBottom: SPACING.sm },
  input: { borderWidth: 1, borderColor: COLORS.border, borderRadius: 10, paddingHorizontal: SPACING.md, paddingVertical: 9, marginBottom: SPACING.sm, color: COLORS.textPrimary, backgroundColor: COLORS.surface },
});

export default SuperAdminUsersScreen;
