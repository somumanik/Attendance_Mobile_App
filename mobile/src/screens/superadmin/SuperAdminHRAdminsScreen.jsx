// ============================================================================
// FILE: mobile/src/screens/superadmin/SuperAdminHRAdminsScreen.jsx
// PURPOSE: HR Admin account + module/action permission management (SuperAdmin)
// ============================================================================

/**
 * HR Admin Account & Permission Management.
 *
 * SuperAdmin yahan har HR Admin account ke liye configure karta hai:
 *   - accounts: create, enable/disable, password reset, delete
 *   - permissions: per module (View / Add / Edit / Delete / Import / Export /
 *     Approve / Email)
 *
 * IMPORTANT: ye screen sirf UI convenience hai. Har save ke baad server par
 * permissions persist hoti hain aur har protected endpoint unhe LIVE enforce
 * karta hai — tab/button hide karna security nahi hai.
 * Bootstrap (env) HR account always-full aur protected hai.
 */

import React, { useCallback, useRef, useState } from 'react';
import { Ionicons } from '@expo/vector-icons';
import { View, Text, ScrollView, StyleSheet, TouchableOpacity, TextInput, ActivityIndicator, RefreshControl } from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import { ScreenContainer } from '../../components/ScreenContainer';
import { Button } from '../../components/Button';
import { COLORS, SPACING } from '../../utils/colors';
import {
  listHrAdmins, createHrAdmin, saveHrAdminPermissions,
  setHrAdminActive, setHrAdminPassword, deleteHrAdmin, setHrAdminCompanies,
} from '../../services/adminAccess';

const ACTION_LABELS = {
  view: 'View', create: 'Add', edit: 'Edit', delete: 'Delete',
  import: 'Import', export: 'Export', approve: 'Approve', email: 'Email',
};

/* Master Reports is configured with the EXISTING view/export actions; the chips
   are labelled with the permission names the console documents for it. */
const actionChipLabel = (moduleKey, action) => {
  if (moduleKey === 'reports' && action === 'view') return 'View Master Reports';
  if (moduleKey === 'reports' && action === 'export') return 'Export Master Reports';
  return ACTION_LABELS[action] || action;
};

export const SuperAdminHRAdminsScreen = () => {
  const [admins, setAdmins] = useState([]);
  const [modules, setModules] = useState([]);
  const [actions, setActions] = useState([]);
  const [selected, setSelected] = useState(null);
  const [draft, setDraft] = useState({});
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [msg, setMsg] = useState('');
  const [form, setForm] = useState({ username: '', password: '', displayname: '' });
  const [pwFor, setPwFor] = useState(null);
  const [newPw, setNewPw] = useState('');
  /* Phase 4.4 — company codes come from the server's authoritative catalogue
     (real dbo.tblemployee.companycode values); nothing is hard-coded here. */
  const [availableCompanies, setAvailableCompanies] = useState([]);
  const [newCompanies, setNewCompanies] = useState([]);      // create form selection
  const [editCompanies, setEditCompanies] = useState({});    // username -> [codes]
  const [confirmDelete, setConfirmDelete] = useState(null);  // username awaiting confirmation
  /* Phase 4.4.1 — explicit save lifecycle so the UI can never claim a save that the
     backend did not confirm, and two saves can never overlap. */
  const [saveState, setSaveState] = useState(null);          // 'saving' | 'saved' | 'error'
  const savingRef = useRef(false);

  const load = useCallback(async () => {
    setError('');
    try {
      const res = await listHrAdmins();
      setAdmins(Array.isArray(res?.admins) ? res.admins : []);
      setModules(Array.isArray(res?.modules) ? res.modules : []);
      setActions(Array.isArray(res?.actions) ? res.actions : []);
      setAvailableCompanies(Array.isArray(res?.availableCompanies) ? res.availableCompanies : []);
    } catch (e) {
      setError(e.message || 'HR Admin list load nahi ho payi.');
    } finally {
      setLoading(false);
    }
  }, []);

  useFocusEffect(useCallback(() => { load(); }, [load]));

  const openEditor = (row) => {
    setMsg(''); setError('');
    setSelected(row.username);
    setPwFor(null);
    setDraft(JSON.parse(JSON.stringify(row.permissions || {})));
    // Phase 4.4 — preload the account's REAL assignments so they can be inspected and
    // updated without recreating the account.
    setEditCompanies((prev) => ({
      ...prev,
      [row.username]: Array.isArray(row.companies) ? [...row.companies] : [],
    }));
    setConfirmDelete(null);
  };

  const toggleAction = (moduleKey, action) => {
    setDraft((prev) => ({
      ...prev,
      [moduleKey]: { ...(prev[moduleKey] || {}), [action]: !(prev[moduleKey] || {})[action] },
    }));
  };

  /**
   * Prompt 3: navigation placement for one module — 'primary' | 'more'.
   * Tapping the active choice again clears it back to NULL, which restores the
   * historical/default placement (no silent moves of existing modules).
   * LAYOUT ONLY: this never grants or removes a permission.
   */
  const setPlacement = (moduleKey, placement) => {
    setDraft((prev) => {
      const current = (prev[moduleKey] || {}).placement;
      const next = current === placement ? null : placement;
      return { ...prev, [moduleKey]: { ...(prev[moduleKey] || {}), placement: next } };
    });
  };

  /**
   * Phase 4.4.1 — compares one module's settings. `undefined` is treated as "off"/unset
   * so a section the user never touched is never reported as a mismatch.
   */
  const sameModule = (a, b) => {
    const A = a || {}; const B = b || {};
    for (const f of ['view', 'create', 'edit', 'delete', 'import', 'export', 'approve', 'email']) {
      if (Boolean(A[f]) !== Boolean(B[f])) return false;
    }
    const vis = (m) => (m.visible === false ? false : (m.visible === true ? true : null));
    if (vis(A) !== vis(B)) return false;
    if ((A.placement || null) !== (B.placement || null)) return false;
    return true;
  };

  /** True when the form holds selections that are not persisted yet. */
  const dirtyFor = (username) => {
    if (username !== selected) return false;
    const row = admins.find((a) => a.username === username);
    const persisted = row?.permissions || {};
    const keys = [...new Set([...Object.keys(persisted), ...Object.keys(draft || {})])];
    return keys.some((k) => !sameModule(persisted[k], (draft || {})[k]));
  };

  /**
   * Phase 4.4.1 — SAVE + CONFIRM.
   *  - only one save can be in flight (an overlapping save can no longer silently
   *    overwrite newer selections);
   *  - explicit saving → saved/failed state;
   *  - the success message is shown ONLY when the backend responded AND the permissions
   *    it reports back match what was sent;
   *  - the draft is re-synced from the SERVER payload, so stale frontend state can never
   *    keep showing an unsaved/partially-saved selection as if it were persisted.
   */
  const saveDraft = async () => {
    if (!selected) return;
    if (savingRef.current) return;                 // never overlap two saves
    savingRef.current = true;
    const username = selected;
    const sent = JSON.parse(JSON.stringify(draft || {}));
    setBusy(true); setError(''); setMsg(''); setSaveState('saving');
    try {
      const res = await saveHrAdminPermissions(username, sent);
      const persisted = res?.permissions || null;
      await load();                                // reload persisted state from the backend
      let mismatched;
      if (persisted) {
        const keys = [...new Set([...Object.keys(persisted), ...Object.keys(sent)])];
        mismatched = keys.filter((k) => !sameModule(persisted[k], sent[k]));
        setDraft(JSON.parse(JSON.stringify(persisted)));   // form now reflects the server
      } else {
        mismatched = ['(no confirmation payload returned by the server)'];
      }
      if (mismatched.length) {
        setSaveState('error');
        setError(`Not confirmed by the server for: ${mismatched.join(', ')}. Reload and check before relying on it.`);
      } else {
        setSaveState('saved');
        setMsg(`Permissions saved successfully for ${username}.`);
      }
    } catch (e) {
      setSaveState('error');
      setError(e.message || 'Save failed.');
    } finally {
      savingRef.current = false;
      setBusy(false);
    }
  };

  /**
   * Phase 4.4 — Visible / Hidden for one section.
   * Stored as an explicit boolean (NULL is only "not configured"). Independent of the
   * action permissions and of navigation placement: hiding never grants or revokes a
   * permission, and the server additionally denies a hidden section's data.
   * Contradiction guard: a Hidden section cannot be placed in a menu.
   */
  const setVisibility = (moduleKey, visible) => {
    setDraft((prev) => ({
      ...prev,
      [moduleKey]: {
        ...(prev[moduleKey] || {}),
        visible,
        placement: visible ? (prev[moduleKey] || {}).placement : null,
      },
    }));
  };

  /** Toggle one company code inside an array of codes. */
  const toggleCode = (list, code) => (list.includes(code) ? list.filter((c) => c !== code) : [...list, code]);

  /** Phase 4.4 — persist this account's company assignments (server validates codes). */
  const saveCompanies = async (username) => {
    setBusy(true); setError(''); setMsg('');
    try {
      const codes = editCompanies[username] || [];
      if (!codes.length) { setError('Select at least one company for this account.'); return; }
      const res = await setHrAdminCompanies(username, codes);
      setMsg(`Companies saved for ${username}: ${(res?.companies || codes).join(', ')}`);
      await load();
    } catch (e) { setError(e.message || 'Company assignment save failed.'); } finally { setBusy(false); }
  };

  const addAdmin = async () => {
    setError(''); setMsg('');
    if (!form.username.trim() || !form.password) { setError('Username aur password required hain.'); return; }
    // A normal newly created HR Admin must get at least one valid company assignment.
    if (!newCompanies.length) { setError('Select at least one company for this HR Admin.'); return; }
    setBusy(true);
    try {
      await createHrAdmin({ ...form, companies: newCompanies });
      setForm({ username: '', password: '', displayname: '' });
      setNewCompanies([]);
      setMsg('HR Admin account ban gaya.');
      await load();
    } catch (e) { setError(e.message || 'Create failed.'); } finally { setBusy(false); }
  };

  const toggleActive = async (row) => {
    setError(''); setMsg('');
    try { await setHrAdminActive(row.username, !row.isactive); await load(); }
    catch (e) { setError(e.message || 'Update failed.'); }
  };

  const resetPassword = async () => {
    if (!pwFor || !newPw) return;
    setError(''); setMsg('');
    try {
      await setHrAdminPassword(pwFor, newPw);
      setMsg(`Password updated for ${pwFor}.`);
      setPwFor(null); setNewPw('');
    } catch (e) { setError(e.message || 'Password update failed.'); }
  };

  /**
   * Phase 4.4 — DELETE FIX (root cause)
   * The previous implementation confirmed with Alert.alert(), which is a NO-OP on
   * react-native-web — and this app runs with `expo start --web` (mobile/package.json
   * declares "web": "expo start --web" and react-native-web is a dependency). The
   * confirmation dialog therefore never rendered, so the API was never called and
   * Delete appeared to do nothing. Disable and Reset password have no confirmation
   * step, which is exactly why they kept working.
   * The confirmation is now an in-app panel (works on web AND native), names the
   * account, and calls the API only after an explicit Confirm delete.
   */
  const doDelete = async (username) => {
    setError(''); setMsg('');
    try {
      await deleteHrAdmin(username);
      if (selected === username) setSelected(null);
      setConfirmDelete(null);
      setMsg(`Deleted ${username}.`);
      await load();
    } catch (e) { setError(e.message || 'Delete failed.'); }
  };

  return (
    <ScreenContainer title="HR Admin Accounts" showHeader={true}>
      <ScrollView contentContainerStyle={styles.scroll} keyboardShouldPersistTaps="handled" refreshControl={<RefreshControl refreshing={false} onRefresh={load} />}>
        <Text style={styles.hint}>
          Permissions server par save hoti hain aur har API request par enforce hoti hain —
          revoked permission turant lagu hoti hai, chahe purana screen khula ho.
          <Ionicons name="lock-closed" size={11} color={COLORS.warning} /> = bootstrap account (always full access).
        </Text>
        {error ? <Text style={styles.error}>{error}</Text> : null}
        {msg ? <Text style={styles.ok}>{msg}</Text> : null}
        {loading ? <ActivityIndicator color={COLORS.primary} style={{ marginVertical: 20 }} /> : null}

        {admins.map((row) => (
          <View key={row.username} style={styles.card}>
            <TouchableOpacity onPress={() => (selected === row.username ? setSelected(null) : openEditor(row))} activeOpacity={0.8}>
              <View style={styles.cardTop}>
                <View style={{ flex: 1, minWidth: 0 }}>
                  <Text style={styles.username}>{row.username}{row.isbootstrap ? '  ' : ''}{row.isbootstrap ? <Ionicons name="lock-closed" size={12} color={COLORS.warning} /> : null}</Text>
                  <Text style={styles.meta}>{row.displayname || '—'}</Text>
                  <Text style={[styles.meta, { color: row.isactive ? COLORS.success : COLORS.error }]}>
                    {row.isactive ? 'Active' : 'Disabled'}
                  </Text>
                </View>
                <Ionicons name={selected === row.username ? 'chevron-up' : 'chevron-down'} size={18} color={COLORS.textSecondary} />
              </View>
            </TouchableOpacity>

            {selected === row.username ? (
              <View style={styles.editor}>
                {!row.isbootstrap ? (
                  <View style={styles.rowActions}>
                    <TouchableOpacity onPress={() => toggleActive(row)} style={styles.smallBtn}>
                      <Text style={styles.smallBtnText}>{row.isactive ? 'Disable' : 'Enable'}</Text>
                    </TouchableOpacity>
                    <TouchableOpacity onPress={() => { setPwFor(pwFor === row.username ? null : row.username); setNewPw(''); }} style={styles.smallBtn}>
                      <Text style={styles.smallBtnText}>Reset password</Text>
                    </TouchableOpacity>
                    <TouchableOpacity onPress={() => { setConfirmDelete(confirmDelete === row.username ? null : row.username); setError(''); }} style={[styles.smallBtn, styles.dangerBtn]}>
                      <Text style={[styles.smallBtnText, { color: COLORS.error }]}>Delete</Text>
                    </TouchableOpacity>
                  </View>
                ) : null}

                {pwFor === row.username ? (
                  <View style={styles.rowActions}>
                    <TextInput style={[styles.input, { flex: 1, marginBottom: 0 }]} placeholder="New password" placeholderTextColor={COLORS.textTertiary}
                      secureTextEntry value={newPw} onChangeText={setNewPw} />
                    <TouchableOpacity onPress={resetPassword} style={styles.smallBtn}><Text style={styles.smallBtnText}>Save</Text></TouchableOpacity>
                  </View>
                ) : null}

                {/* Phase 4.4 — company assignments: inspect AND update an existing
                    account without recreating it. Codes come from the server's real
                    catalogue; an account with no assignment is denied company data. */}
                {!row.isbootstrap ? (
                  <View style={styles.moduleRow}>
                    <Text style={styles.moduleLabel}>Company codes</Text>
                    {Array.isArray(row.companies) && row.companies.length ? (
                      <Text style={styles.meta}>Currently assigned: {row.companies.join(', ')}</Text>
                    ) : (
                      <Text style={[styles.meta, { color: COLORS.error }]}>
                        No company assigned — this account is denied company data until one is set.
                      </Text>
                    )}
                    <View style={styles.chips}>
                      {availableCompanies.map((code) => {
                        const list = editCompanies[row.username] || [];
                        const on = list.includes(code);
                        return (
                          <TouchableOpacity key={code}
                            onPress={() => setEditCompanies((prev) => ({ ...prev, [row.username]: toggleCode(prev[row.username] || [], code) }))}
                            style={[styles.chip, on && styles.chipOn]}>
                            <Text style={[styles.chipText, on && styles.chipTextOn]}>{code}</Text>
                          </TouchableOpacity>
                        );
                      })}
                    </View>
                    <Button title={busy ? 'Saving...' : 'Save companies'} onPress={() => saveCompanies(row.username)} disabled={busy} fullWidth />
                  </View>
                ) : null}

                {/* Phase 4.4 — in-app delete confirmation (names the account; works on
                    web and native). The API is called only on Confirm delete. */}
                {!row.isbootstrap && confirmDelete === row.username ? (
                  <View style={styles.confirmBox}>
                    <Text style={styles.confirmText}>
                      Delete HR Admin "{row.username}"? This removes the account, its permissions and its
                      company assignments. This cannot be undone.
                    </Text>
                    <View style={styles.rowActions}>
                      <TouchableOpacity onPress={() => setConfirmDelete(null)} style={styles.smallBtn}>
                        <Text style={styles.smallBtnText}>Cancel</Text>
                      </TouchableOpacity>
                      <TouchableOpacity onPress={() => doDelete(row.username)} style={[styles.smallBtn, styles.dangerBtn]}>
                        <Text style={[styles.smallBtnText, { color: COLORS.error }]}>Confirm delete</Text>
                      </TouchableOpacity>
                    </View>
                  </View>
                ) : null}

                {modules.map((mod) => (
                  <View key={mod.key} style={styles.moduleRow}>
                    <Text style={styles.moduleLabel}>{mod.label}</Text>
{mod.key === 'reports' ? (
<Text style={styles.meta}>
View Master Reports — access to the Master Reports page and its permitted data.
Export Master Reports — Excel export (requires View; company scope always applies).
</Text>
) : null}
                    {/* Phase 4.4 — Visible / Hidden is INDEPENDENT of the action
                        permissions below and of the Primary tab / More menu placement:
                        it only controls whether the section appears at all. Hidden also
                        denies the section's data on the server. */}
                    <View style={styles.chips}>
                      {[['visible', 'Visible'], ['hidden', 'Hidden']].map(([mode, label]) => {
                        const cur = (draft[mod.key] || {}).visible;
                        const on = mode === 'visible' ? cur !== false : cur === false;
                        return (
                          <TouchableOpacity key={mode} onPress={() => setVisibility(mod.key, mode === 'visible')}
                            style={[styles.chip, on && styles.chipOn]}>
                            <Text style={[styles.chipText, on && styles.chipTextOn]}>{label}</Text>
                          </TouchableOpacity>
                        );
                      })}
                    </View>
                    <View style={styles.chips}>
                      {actions.map((action) => {
                        const on = (draft[mod.key] || {})[action] === true;
                        return (
                          <TouchableOpacity key={action} onPress={() => toggleAction(mod.key, action)} style={[styles.chip, on && styles.chipOn]}>
                            <Text style={[styles.chipText, on && styles.chipTextOn]}>{actionChipLabel(mod.key, action)}</Text>
                          </TouchableOpacity>
                        );
                      })}
                    </View>
                    {/* Prompt 3: navigation placement. Only shown for a module the
                        HR Admin can actually VIEW — placement is layout only and
                        never grants access. Tapping the active choice clears it
                        back to the historical default. */}
                    {(draft[mod.key] || {}).view === true ? (
                      <View style={styles.chips}>
                        {['primary', 'more'].map((pl) => {
                          const on = (draft[mod.key] || {}).placement === pl;
                          return (
                            <TouchableOpacity key={pl} onPress={() => setPlacement(mod.key, pl)} style={[styles.chip, on && styles.chipOn]}>
                              <Text style={[styles.chipText, on && styles.chipTextOn]}>
                                {pl === 'primary' ? 'Primary tab' : 'More menu'}
                              </Text>
                            </TouchableOpacity>
                          );
                        })}
                      </View>
                    ) : null}
                  </View>
                ))}

                {row.isbootstrap ? (
                  <Text style={styles.meta}>Bootstrap account always keeps full permissions.</Text>
                ) : (
                  <>
                    {dirtyFor(row.username) ? (
                      <Text style={styles.dirty}>Unsaved changes — not saved yet.</Text>
                    ) : (
                      <Text style={styles.meta}>No unsaved changes.</Text>
                    )}
                    {saveState === 'saving' ? <Text style={styles.meta}>Saving permissions...</Text> : null}
                    {saveState === 'saved' ? <Text style={styles.ok}>Permissions saved successfully.</Text> : null}
                    <Button title={busy ? 'Saving...' : 'Save permissions'} onPress={saveDraft} disabled={busy} fullWidth />
                  </>
                )}
              </View>
            ) : null}
          </View>
        ))}

        <Text style={styles.sectionTitle}>Add an HR Admin</Text>
        <TextInput style={styles.input} placeholder="Username" placeholderTextColor={COLORS.textTertiary}
          autoCapitalize="none" value={form.username} onChangeText={(v) => setForm({ ...form, username: v })} />
        <TextInput style={styles.input} placeholder="Display name (optional)" placeholderTextColor={COLORS.textTertiary}
          value={form.displayname} onChangeText={(v) => setForm({ ...form, displayname: v })} />
        <TextInput style={styles.input} placeholder="Password (min 8, letters + numbers)" placeholderTextColor={COLORS.textTertiary}
          secureTextEntry value={form.password} onChangeText={(v) => setForm({ ...form, password: v })} />
        <Text style={styles.moduleLabel}>Company codes (select at least one)</Text>
        {availableCompanies.length ? (
          <View style={styles.chips}>
            {availableCompanies.map((code) => {
              const on = newCompanies.includes(code);
              return (
                <TouchableOpacity key={code} onPress={() => setNewCompanies((prev) => toggleCode(prev, code))}
                  style={[styles.chip, on && styles.chipOn]}>
                  <Text style={[styles.chipText, on && styles.chipTextOn]}>{code}</Text>
                </TouchableOpacity>
              );
            })}
          </View>
        ) : (
          <Text style={styles.meta}>No company codes were found in the employee master.</Text>
        )}
        <Button title="Create HR Admin" onPress={addAdmin} disabled={busy} fullWidth />
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
  editor: { marginTop: SPACING.sm, borderTopWidth: 1, borderTopColor: COLORS.divider, paddingTop: SPACING.sm, gap: SPACING.sm },
  rowActions: { flexDirection: 'row', gap: 6, alignItems: 'center', flexWrap: 'wrap' },
  smallBtn: { paddingHorizontal: 10, paddingVertical: 5, borderRadius: 8, borderWidth: 1, borderColor: COLORS.border },
  dangerBtn: { borderColor: '#FECACA' },
  smallBtnText: { fontSize: 11, fontWeight: '700', color: COLORS.textSecondary },
  moduleRow: { gap: 5 },
  moduleLabel: { fontSize: 12, fontWeight: '700', color: COLORS.textPrimary },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 5 },
  chip: { paddingHorizontal: 8, paddingVertical: 4, borderRadius: 999, borderWidth: 1, borderColor: COLORS.border, backgroundColor: COLORS.surfaceVariant },
  chipOn: { backgroundColor: COLORS.primary, borderColor: COLORS.primary },
  chipText: { fontSize: 10.5, fontWeight: '700', color: COLORS.textSecondary },
  chipTextOn: { color: COLORS.textOnPrimary },
  sectionTitle: { fontSize: 14, fontWeight: '800', color: COLORS.textPrimary, marginTop: SPACING.lg, marginBottom: SPACING.sm },
  input: { borderWidth: 1, borderColor: COLORS.border, borderRadius: 10, paddingHorizontal: SPACING.md, paddingVertical: 9, marginBottom: SPACING.sm, color: COLORS.textPrimary, backgroundColor: COLORS.surface },
  confirmBox: { borderWidth: 1, borderColor: COLORS.error, borderRadius: 10, padding: SPACING.sm, marginTop: SPACING.sm, backgroundColor: COLORS.surfaceVariant, gap: 6 },
  confirmText: { fontSize: 11.5, color: COLORS.textPrimary, lineHeight: 17 },
  dirty: { fontSize: 11.5, color: COLORS.warning || COLORS.textSecondary, marginBottom: 4, fontWeight: '700' },
});

export default SuperAdminHRAdminsScreen;
