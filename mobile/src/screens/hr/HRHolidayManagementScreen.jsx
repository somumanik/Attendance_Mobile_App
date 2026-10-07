// ============================================================================
// FILE: mobile/src/screens/hr/HRHolidayManagementScreen.jsx
// PURPOSE: HR Admin Holiday Management - view / add / edit / delete / calendar
// ============================================================================

/**
 * Ye screen HR Admin ke liye Holiday Management hai.
 *
 * Navigation Flow:
 * HRNavigator (Holidays Tab) -> HRHolidayManagementScreen
 *
 * Data Flow (real backend data, no mock values):
 *   GET    /api/hr/holidays               -> list (search / year / active filters)
 *   GET    /api/hr/filters                -> REAL companies (+ real category name master)
 *   GET    /api/hr/holiday-categories     -> REAL dynamic categories + company/category
 *                                            pairs for the selected companies
 *   POST   /api/hr/holidays               -> add holiday
 *   PUT    /api/hr/holidays/:id           -> edit / activate / deactivate
 *   DELETE /api/hr/holidays/:id           -> delete
 *
 * Applicability (Phase G final):
 *   Companies = REAL company master (dbo.tblemployee + dbo.tblcompany).
 *   Categories = REAL employee categories that exist under the SELECTED
 *   companies only (loaded after company selection; union, no duplicates).
 *   Saved applicability = real (company, category) pairs INTERSECT selection,
 *   so an impossible pair (e.g. OFFICE + WORKER when no OFFICE employee is a
 *   WORKER) can never be stored. NO manual "Holiday Category" master and NO
 *   manual "Group Mapping" - both were removed in this revision.
 *
 * Security:
 * Every write endpoint requires an HR role server-side (requireRole('HR')), so an
 * EMPLOYEE token gets 403. This screen is only reachable from the HR tab stack.
 *
 * Duplicate rule (enforced twice: readable message here, and the real unique index
 * on (holidaydate, category) in the database):
 *   same date + same category  -> rejected
 *   same date + other category -> allowed
 */

import React, { useState, useEffect, useCallback, useMemo } from 'react';
import {
  View, Text, ScrollView, StyleSheet, TouchableOpacity, Modal, TextInput,
  ActivityIndicator, RefreshControl, Alert, Platform,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { COLORS, SPACING } from '../../utils/colors';
import { ScreenContainer } from '../../components/ScreenContainer';
import { Button } from '../../components/Button';
import { api } from '../../services/api';
import { API_ENDPOINTS } from '../../utils/constants';

const clean = (v) => String(v == null ? '' : v).trim();
const PLACEHOLDER = '—';

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const WEEK_HEADER = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

/** Holiday colour is PURPLE everywhere, matching the employee calendar legend. */
const HOLIDAY_PURPLE = '#7C3AED';

const isoOf = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const currentMonthKey = () => isoOf(new Date()).slice(0, 7);
const shiftMonthKey = (key, delta) => {
  const m = /^(\d{4})-(\d{2})$/.exec(clean(key).slice(0, 7));
  if (!m) return currentMonthKey();
  const total = (Number(m[2]) - 1) + delta;
  const year = Number(m[1]) + Math.floor(total / 12);
  const month = (((total % 12) + 12) % 12) + 1;
  return `${year}-${String(month).padStart(2, '0')}`;
};
const formatMonthKey = (key) => {
  const m = /^(\d{4})-(\d{2})$/.exec(clean(key).slice(0, 7));
  return m ? `${MONTHS[Number(m[2]) - 1]} ${m[1]}` : PLACEHOLDER;
};
/** 'YYYY-MM-DD' / Date -> 'DD Mon YYYY'. Calendar dates only, never UTC-shifted. */
const formatDate = (v) => {
  if (v instanceof Date) {
    return Number.isNaN(v.getTime()) ? PLACEHOLDER : `${String(v.getDate()).padStart(2, '0')} ${MONTHS[v.getMonth()]} ${v.getFullYear()}`;
  }
  const s = clean(v);
  if (!/^\d{4}-\d{2}-\d{2}/.test(s)) return PLACEHOLDER;
  const d = new Date(Number(s.slice(0, 4)), Number(s.slice(5, 7)) - 1, Number(s.slice(8, 10)));
  return `${String(d.getDate()).padStart(2, '0')} ${MONTHS[d.getMonth()]} ${d.getFullYear()}`;
};
const todayISO = () => isoOf(new Date());

/** Distinct, stable colour per category so HR can scan groups at a glance. */
const CATEGORY_COLORS = {
  'All Employees': '#0891B2',
  'Factory Staff': '#2563EB',
  'Office Staff': '#059669',
};
const categoryColor = (name) => CATEGORY_COLORS[clean(name)] || '#9333EA';

/**
 * Alert jo react-native-web par bhi kaam kare - wahan Alert.alert no-op hai.
 * Delete confirm web par window.confirm se hota hai (neeche remove() me).
 */
const notify = (title, message = '') => {
  if (Platform.OS === 'web') {
    window.alert(message ? `${title}\n${message}` : title);
    return;
  }
  Alert.alert(title, message);
};

const Chip = ({ label, selected, onPress, tint }) => {
  const color = tint || COLORS.primary;
  return (
    <TouchableOpacity
      onPress={onPress}
      style={[styles.catPick, { borderColor: color }, selected && { backgroundColor: `${color}1F` }]}
    >
      <Text style={[styles.catPickText, { color: color }, selected && styles.catPickTextSelected]}>{label}</Text>
    </TouchableOpacity>
  );
};

export const HRHolidayManagementScreen = () => {
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [holidays, setHolidays] = useState([]);

  // Filters (search / filter holidays)
  const [search, setSearch] = useState('');
  const [searchDraft, setSearchDraft] = useState('');
  const [activeFilter, setActiveFilter] = useState('ALL'); // ALL | Y | N

  // Company / category options
  const [filterOptions, setFilterOptions] = useState({ companies: [], categories: [] });
  const [selectedCompanies, setSelectedCompanies] = useState([]);
  const [availableCategories, setAvailableCategories] = useState([]);
  const [selectedCategories, setSelectedCategories] = useState([]);
  const [loadingCategories, setLoadingCategories] = useState(false);
  const [companyCategoryPairs, setCompanyCategoryPairs] = useState([]);

  // Add / edit modal
  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState(null);
  const [viewing, setViewing] = useState(null); // read-only View modal
  const [form, setForm] = useState({ holidaydate: '', holidayname: '', description: '', companycode: '', active: true, isHalfDay: false, halfdaypart: '' });
  const [formErrors, setFormErrors] = useState({});
  const [saving, setSaving] = useState(false);

  // Month grid (holiday calendar)
  const [calMonth, setCalMonth] = useState(currentMonthKey());

  const load = useCallback(async (isRefresh) => {
    if (isRefresh) setIsRefreshing(true);
    setError(null);
    try {
      const params = {};
      if (search) params.search = search;
      if (activeFilter !== 'ALL') params.active = activeFilter;
      // PHASE G.2: the list stays the FULL managed set (View/Edit/Delete
      // regression-safe). The calendar below derives its purple markers from
      // this same list by exact date key, so markers always follow the
      // displayed month with no hard-coded dates and no stale UI.
      const list = await api.get(API_ENDPOINTS.HR_HOLIDAYS, params);
      setHolidays(Array.isArray(list?.holidays) ? list.holidays : []);
    } catch (err) {
      setError(err?.response?.data?.message || err?.message || 'Holidays load nahi ho paye.');
    } finally {
      setLoading(false);
      setIsRefreshing(false);
    }
  }, [search, activeFilter]);

  useEffect(() => { load(false); }, [load]);

  // Load filter options (companies)
  useEffect(() => {
    let active = true;
    api.get('/hr/filters')
      .then((data) => {
        if (!active) return;
        setFilterOptions({
          companies: Array.isArray(data?.companies) ? data.companies : [],
          categories: Array.isArray(data?.categories) ? data.categories : [],
        });
      })
      .catch(() => { /* filters stay empty */ });
    return () => { active = false; };
  }, []);

  // Load categories for selected companies
  useEffect(() => {
    let active = true;
    const fetchCategories = async () => {
      if (!selectedCompanies.length) {
        if (active) { setAvailableCategories([]); setCompanyCategoryPairs([]); }
        return;
      }
      setLoadingCategories(true);
      try {
        const res = await api.get(API_ENDPOINTS.HR_HOLIDAY_CATEGORIES_FOR_COMPANIES, { companies: selectedCompanies.join(',') });
        if (!active) return;
        const cats = Array.isArray(res?.categories) ? res.categories : [];
        const pairs = Array.isArray(res?.pairs) ? res.pairs : [];
        setAvailableCategories(cats);
        setCompanyCategoryPairs(pairs);
        // If current selected categories are no longer valid, clear them
        const validCodes = new Set(cats.map(c => c.code));
        setSelectedCategories(prev => prev.filter(c => validCodes.has(c)));
      } catch {
        if (active) { setAvailableCategories([]); setCompanyCategoryPairs([]); }
      } finally {
        if (active) setLoadingCategories(false);
      }
    };
    fetchCategories();
    return () => { active = false; };
  }, [selectedCompanies]);

  const applySearch = () => { setSearch(searchDraft.trim()); setActiveFilter((f) => f); };

  // ---- Add / edit ----
  const openForm = (holiday = null) => {
    if (holiday) {
      setEditing(holiday);
      const companies = Array.isArray(holiday.companies) ? holiday.companies : (clean(holiday.companycode) ? [clean(holiday.companycode)] : []);
      const categories = Array.isArray(holiday.categories) ? holiday.categories : [];
      const pairs = Array.isArray(holiday.companyCategoryPairs) ? holiday.companyCategoryPairs : [];
      setSelectedCompanies(companies);
      setSelectedCategories(categories);
      setCompanyCategoryPairs(pairs);
      setForm({
        holidaydate: clean(holiday.holidaydate).slice(0, 10),
        holidayname: clean(holiday.holidayname),
        description: clean(holiday.description),
        companycode: clean(holiday.companycode),
        active: holiday.active !== false,
        isHalfDay: Boolean(holiday.isHalfDay),
        halfdaypart: clean(holiday.halfdaypart),
      });
    } else {
      setEditing(null);
      setSelectedCompanies([]);
      setSelectedCategories([]);
      setCompanyCategoryPairs([]);
      setForm({
        holidaydate: todayISO(),
        holidayname: '',
        description: '',
        companycode: '',
        active: true,
        isHalfDay: false,
        halfdaypart: '',
      });
    }
    setFormErrors({});
    setFormOpen(true);
  };

  /**
   * Section 28 validation: date, name, duration, at least one company, at least
   * one category - AND the selection must resolve to REAL company+category
   * pairs from employee data (no impossible combinations can be saved).
   */
  const validate = () => {
    const errors = {};
    if (!/^\d{4}-\d{2}-\d{2}$/.test(form.holidaydate)) errors.holidaydate = 'Date YYYY-MM-DD format mein daalein.';
    if (!form.holidayname.trim()) errors.holidayname = 'Holiday name required hai.';
    if (typeof form.isHalfDay !== 'boolean') errors.duration = 'Duration (Full Day / Half Day) select karein.';
    if (!selectedCompanies.length) errors.companies = 'Kam se kam ek company select karein.';
    if (selectedCompanies.length && !selectedCategories.length) errors.categories = 'Kam se kam ek category select karein.';

    if (selectedCompanies.length && selectedCategories.length) {
      if (loadingCategories) {
        errors.categories = 'Categories abhi load ho rahi hain, ek moment rukein.';
      } else {
        // REAL pairs (server se, selected companies ke liye) me se sirf
        // selected companies x selected categories wale valid pairs.
        const validPairs = companyCategoryPairs.filter(
          (p) => selectedCompanies.includes(p.companycode) && selectedCategories.includes(p.categorycode),
        );
        if (!validPairs.length) {
          errors.categories = 'Selected company/category combination employee data me exist nahi karta.';
        } else {
          const companyLabel = (code) => filterOptions.companies.find((c) => c.code === code)?.name || code;
          const catLabel = (code) => availableCategories.find((c) => c.code === code)?.name || code;
          const emptyCompany = selectedCompanies.find((c) => !validPairs.some((p) => p.companycode === c));
          if (emptyCompany) {
            errors.companies = `"${companyLabel(emptyCompany)}" me selected categories exist nahi karti - company ke liye kam se kam ek valid category chunein.`;
          }
          const emptyCat = selectedCategories.find((c) => !validPairs.some((p) => p.categorycode === c));
          if (emptyCat) {
            errors.categories = `Category "${catLabel(emptyCat)}" selected companies me exist nahi karti.`;
          }
        }
      }
    }
    setFormErrors(errors);
    return Object.keys(errors).length === 0;
  };

  const save = async () => {
    if (!validate()) return;
    setSaving(true);
    try {
      // Backend computes the authoritative applicability:
      //   REAL pairs INTERSECT (companies x categories).
      const payload = {
        holidaydate: form.holidaydate,
        holidayname: form.holidayname.trim(),
        description: form.description,
        companycode: selectedCompanies[0] || '',
        companies: selectedCompanies,
        categories: selectedCategories,
        isHalfDay: form.isHalfDay,
        halfdaypart: form.isHalfDay ? (form.halfdaypart || 'FN') : null,
        active: form.active,
      };
      if (editing) {
        await api.put(`${API_ENDPOINTS.HR_HOLIDAYS}/${editing.id}`, payload);
      } else {
        await api.post(API_ENDPOINTS.HR_HOLIDAYS, payload);
      }
      setFormOpen(false);
      setEditing(null);
      load(false);
    } catch (err) {
      const data = err?.response?.data;
      if (data?.code === 'DUPLICATE_HOLIDAY') {
        setFormErrors({ holidaydate: data.message });
      } else if (data?.code === 'COMPANY_REQUIRED') {
        setFormErrors({ companies: data.message });
      } else if (data?.code === 'CATEGORY_REQUIRED') {
        setFormErrors({ categories: data.message });
      } else if (data?.code === 'NO_VALID_PAIRS') {
        setFormErrors({ categories: data.message });
      } else {
        notify('Could not save', data?.message || err?.message || 'Please try again.');
      }
    } finally {
      setSaving(false);
    }
  };

  const toggleActive = async (holiday) => {
    try {
      await api.put(`${API_ENDPOINTS.HR_HOLIDAYS}/${holiday.id}`, { active: !holiday.active });
      load(false);
    } catch (err) {
      notify('Could not update', err?.response?.data?.message || err?.message || 'Please try again.');
    }
  };

  /** Shared delete call (used by the native Alert and the web confirm path). */
  const runDelete = async (holiday) => {
    try {
      await api.delete(`${API_ENDPOINTS.HR_HOLIDAYS}/${holiday.id}`);
      load(false);
    } catch (err) {
      notify('Could not delete', err?.response?.data?.message || err?.message || 'Please try again.');
    }
  };

  const remove = (holiday) => {
    const message = `"${clean(holiday.holidayname)}" (${formatDate(holiday.holidaydate)}) permanently delete karein? Ye calendar se bhi hat jayega.`;
    // react-native-web par Alert.alert no-op hai - wahan window.confirm use karo,
    // warna Delete button dikh hi hota par confirm kabhi khulta nahi tha.
    if (Platform.OS === 'web') {
      if (window.confirm(message)) runDelete(holiday);
      return;
    }
    Alert.alert('Delete holiday', message, [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Delete', style: 'destructive', onPress: () => runDelete(holiday) },
    ]);
  };

  // ---- Month grid (holiday calendar) ----
  const holidayByDate = useMemo(() => {
    const map = new Map();
    holidays.forEach((h) => {
      const key = clean(h.holidaydate).slice(0, 10);
      if (!key) return;
      const list = map.get(key) || [];
      list.push(h);
      map.set(key, list);
    });
    return map;
  }, [holidays]);

  const calCells = useMemo(() => {
    const m = /^(\d{4})-(\d{2})$/.exec(clean(calMonth));
    if (!m) return [];
    const year = Number(m[1]);
    const mon = Number(m[2]) - 1;
    const first = new Date(year, mon, 1);
    const lead = (first.getDay() + 6) % 7; // Monday-first
    // PHASE G.2 root-cause fix: clone the grid start and step with setDate so
    // month lengths / leap years / year boundaries always render correctly
    // (the old code rebuilt a Date from start.getDate()+i inside the target
    // month, overflowing into the wrong month for any lead > 0).
    const gridStart = new Date(year, mon, 1 - lead);
    const cells = [];
    for (let i = 0; i < 42; i += 1) {
      const d = new Date(gridStart);
      d.setDate(gridStart.getDate() + i);
      const key = isoOf(d);
      const list = holidayByDate.get(key) || [];
      cells.push({
        key,
        day: d.getDate(),
        inMonth: d.getMonth() === mon && d.getFullYear() === year,
        holidays: list,
        hasActive: list.some((h) => h.active !== false),
        hasInactive: list.some((h) => h.active === false),
      });
    }
    return cells;
  }, [calMonth, holidayByDate]);

  const activeCount = useMemo(() => holidays.filter((h) => h.active !== false).length, [holidays]);
  const inactiveCount = holidays.length - activeCount;

  // Category name lookup: REAL tblcategory master (from /hr/filters) FIRST, then
  // the company-specific dynamic categories, so holiday cards always show real
  // names (STAFF, WORKER, ...) even when the Add form was never opened.
  const categoryNameLookup = useMemo(() => {
    const map = new Map();
    for (const c of filterOptions.categories || []) {
      if (c && c.code) map.set(c.code, c.name || c.code);
    }
    for (const c of availableCategories) map.set(c.code, c.name || c.code);
    return map;
  }, [filterOptions.categories, availableCategories]);

  return (
    <ScreenContainer title="Holiday Management" showHeader={true}>
      <ScrollView
        refreshControl={<RefreshControl refreshing={isRefreshing} onRefresh={() => load(true)} colors={[COLORS.primary]} />}
        contentContainerStyle={styles.scroll}
        showsVerticalScrollIndicator={false}
      >
        {/* ---------- Summary + actions ---------- */}
        <View style={styles.topRow}>
          <View style={[styles.statBox, { borderColor: `${HOLIDAY_PURPLE}44` }]}>
            <Text style={[styles.statValue, { color: HOLIDAY_PURPLE }]}>{activeCount}</Text>
            <Text style={styles.statLabel}>Active</Text>
          </View>
          <View style={styles.statBox}>
            <Text style={[styles.statValue, { color: COLORS.textTertiary }]}>{inactiveCount}</Text>
            <Text style={styles.statLabel}>Inactive</Text>
          </View>
          <View style={styles.statBox}>
            <Text style={[styles.statValue, { color: COLORS.primary }]}>{holidays.length}</Text>
            <Text style={styles.statLabel}>Total</Text>
          </View>
        </View>

        <View style={styles.actionRow}>
          <Button
            title="Add Holiday"
            onPress={() => openForm()}
            variant="primary"
            size="small"
            style={styles.flexBtn}
            leftIcon={<Ionicons name="add" size={16} color="#FFFFFF" />}
          />
        </View>

        {/* ---------- Search + filters ---------- */}
        <View style={styles.searchRow}>
          <TextInput
            style={styles.searchInput}
            value={searchDraft}
            onChangeText={setSearchDraft}
            onSubmitEditing={applySearch}
            placeholder="Search name, description, company..."
            placeholderTextColor={COLORS.textTertiary}
            returnKeyType="search"
          />
          <TouchableOpacity style={styles.searchBtn} onPress={applySearch} accessibilityLabel="Search holidays">
            <Ionicons name="search" size={18} color={COLORS.primary} />
          </TouchableOpacity>
        </View>

        <View style={styles.chipRow}>
          {[['ALL', 'All'], ['Y', 'Active'], ['N', 'Inactive']].map(([value, label]) => (
            <TouchableOpacity
              key={value}
              style={[styles.chip, activeFilter === value && styles.chipActive]}
              onPress={() => setActiveFilter(value)}
            >
              <Text style={[styles.chipText, activeFilter === value && styles.chipTextActive]}>{label}</Text>
            </TouchableOpacity>
          ))}
          {/* Manual holiday-group filter chips REMOVED (Phase G final): group
              management UI nahi chahiye - categories ab sirf real employee data se
              aati hain aur har holiday card par apni companies/categories dikhata hai. */}
        </View>

        {loading ? (
          <View style={styles.stateBox}>
            <ActivityIndicator size="large" color={COLORS.primary} />
            <Text style={styles.stateText}>Loading holidays...</Text>
          </View>
        ) : null}

        {!loading && error ? (
          <View style={styles.errorBox}>
            <Text style={styles.errorText}>⚠️ {error}</Text>
            <Button title="Retry" onPress={() => load(false)} variant="outline" size="small" />
          </View>
        ) : null}

        {/* ---------- Holiday calendar (month navigation, no hardcoded dates) ---------- */}
        {!loading && !error ? (
          <View style={styles.card}>
            <View style={styles.cardHeader}>
              <Text style={styles.cardTitle}>Holiday Calendar</Text>
              <View style={styles.monthBar}>
                <TouchableOpacity onPress={() => setCalMonth(shiftMonthKey(calMonth, -1))} accessibilityLabel="Previous month">
                  <Ionicons name="chevron-back" size={18} color={COLORS.primary} />
                </TouchableOpacity>
                <Text style={styles.monthLabel}>{formatMonthKey(calMonth)}</Text>
                <TouchableOpacity onPress={() => setCalMonth(shiftMonthKey(calMonth, 1))} accessibilityLabel="Next month">
                  <Ionicons name="chevron-forward" size={18} color={COLORS.primary} />
                </TouchableOpacity>
              </View>
            </View>

            <View style={styles.calWeekRow}>
              {WEEK_HEADER.map((w) => <Text key={w} style={styles.calWeekHead}>{w}</Text>)}
            </View>
            <View style={styles.calGrid}>
              {calCells.map((c) => {
                const showHoliday = c.inMonth && (c.hasActive || c.hasInactive);
                return (
                  <View key={c.key} style={styles.calCell} accessible accessibilityLabel={`${c.key}${showHoliday ? ` holiday ${c.holidays.map((h) => h.holidayname).join(', ')}` : ' no holiday'}`}>
                    <View style={[styles.calDot, { backgroundColor: showHoliday ? HOLIDAY_PURPLE : 'transparent', opacity: c.hasActive ? 1 : 0.35 }]} />
                    <Text style={[styles.calDay, !c.inMonth && styles.calDayOut, showHoliday && !c.hasActive && { color: COLORS.textTertiary }]}>
                      {c.day}
                    </Text>
                  </View>
                );
              })}
            </View>
            <Text style={styles.cardFoot}>Purple dot = holiday. Inactive holidays appear faded.</Text>
          </View>
        ) : null}

        {/* ---------- Holiday list ---------- */}
        {!loading && !error && holidays.length === 0 ? (
          <View style={styles.card}>
            <Text style={styles.emptyText}>Is filter me koi holiday nahi hai.</Text>
            <Text style={styles.emptySub}>"Add Holiday" se naya holiday banayein.</Text>
          </View>
        ) : null}

        {!loading && !error ? holidays.map((h) => {
          const isActive = h.active !== false;
          const companies = Array.isArray(h.companies) ? h.companies : (clean(h.companycode) ? [clean(h.companycode)] : []);
          const cats = Array.isArray(h.categories) ? h.categories : [];
          const catLabels = cats.map(c => categoryNameLookup.get(c) || c).filter(Boolean);
          const durLabel = h.isHalfDay ? `Half Day${clean(h.halfdaypart) === 'AN' ? ' · Second Half' : ' · First Half'}` : 'Full Day';
          return (
            <View key={h.id} style={[styles.card, !isActive && styles.cardInactive]}>
              <View style={styles.rowTop}>
                <View style={styles.flex}>
                  <Text style={styles.holidayName}>{clean(h.holidayname)}</Text>
                  <Text style={styles.holidayDate}>{formatDate(h.holidaydate)}</Text>
                </View>
                <View style={[styles.catChip, { backgroundColor: `${categoryColor(h.category)}18`, borderColor: `${categoryColor(h.category)}55` }]}>
                  <Text style={[styles.catChipText, { color: categoryColor(h.category) }]}>{clean(h.category)}</Text>
                </View>
              </View>

              {(() => {
                const companyNames = companies.map((code) => filterOptions.companies.find((c) => c.code === code)?.name || code);
                return companyNames.length > 0 ? <Text style={styles.holidayMeta}>{`Companies: ${companyNames.join(', ')}`}</Text> : null;
              })()}
              {catLabels.length > 0 && <Text style={styles.holidayMeta}>{`Categories: ${catLabels.join(', ')}`}</Text>}
              {durLabel !== 'Full Day' && <Text style={styles.holidayMeta}>{durLabel}</Text>}
              {clean(h.description) ? <Text style={styles.holidayDesc}>{clean(h.description)}</Text> : null}

              <View style={styles.rowBottom}>
                <View style={styles.statusWrap}>
                  <View style={[styles.statusDot, { backgroundColor: isActive ? COLORS.success : COLORS.textTertiary }]} />
                  <Text style={[styles.statusText, { color: isActive ? COLORS.success : COLORS.textTertiary }]}>
                    {isActive ? 'Active' : 'Inactive'}
                  </Text>
                </View>
                <View style={styles.iconActions}>
                  <TouchableOpacity style={styles.iconBtn} onPress={() => setViewing(h)} accessibilityLabel="View holiday">
                    <Ionicons name="information-circle-outline" size={17} color={COLORS.textSecondary} />
                  </TouchableOpacity>
                  <TouchableOpacity style={styles.iconBtn} onPress={() => toggleActive(h)} accessibilityLabel={isActive ? 'Deactivate holiday' : 'Activate holiday'}>
                    <Ionicons name={isActive ? 'eye' : 'eye-off'} size={17} color={isActive ? COLORS.warning : COLORS.success} />
                  </TouchableOpacity>
                  <TouchableOpacity style={styles.iconBtn} onPress={() => openForm(h)} accessibilityLabel="Edit holiday">
                    <Ionicons name="create-outline" size={17} color={COLORS.primary} />
                  </TouchableOpacity>
                  <TouchableOpacity style={styles.iconBtn} onPress={() => remove(h)} accessibilityLabel="Delete holiday">
                    <Ionicons name="trash-outline" size={17} color={COLORS.error} />
                  </TouchableOpacity>
                </View>
              </View>
            </View>
          );
        }) : null}
      </ScrollView>

      {/* ---------- Add / edit holiday ---------- */}
      <Modal visible={formOpen} transparent animationType="slide" onRequestClose={() => setFormOpen(false)}>
        <View style={styles.modalBackdrop}>
          <TouchableOpacity style={styles.flex} activeOpacity={1} onPress={() => setFormOpen(false)} />
          <View style={styles.sheet}>
            <View style={styles.sheetHeader}>
              <Text style={styles.sheetTitle}>{editing ? 'Edit Holiday' : 'Add Holiday'}</Text>
              <TouchableOpacity onPress={() => setFormOpen(false)} hitSlop={{ top: 12, left: 12, bottom: 12, right: 12 }}>
                <Ionicons name="close" size={20} color={COLORS.textSecondary} />
              </TouchableOpacity>
            </View>

            <ScrollView style={styles.sheetBody} keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}>
              <Text style={styles.label}>Holiday Date<Text style={styles.req}> *</Text></Text>
              <TextInput
                style={[styles.input, formErrors.holidaydate && styles.inputError]}
                value={form.holidaydate}
                onChangeText={(v) => setForm({ ...form, holidaydate: v })}
                placeholder="YYYY-MM-DD"
                keyboardType="numbers-and-punctuation"
              />
              {formErrors.holidaydate ? <Text style={styles.errText}>{formErrors.holidaydate}</Text> : null}

              <Text style={styles.label}>Holiday Name<Text style={styles.req}> *</Text></Text>
              <TextInput
                style={[styles.input, formErrors.holidayname && styles.inputError]}
                value={form.holidayname}
                onChangeText={(v) => setForm({ ...form, holidayname: v })}
                placeholder="e.g. Republic Day"
                maxLength={200}
              />
              {formErrors.holidayname ? <Text style={styles.errText}>{formErrors.holidayname}</Text> : null}

              <Text style={styles.label}>Companies<Text style={styles.req}> *</Text></Text>
              <View style={styles.catPickRow}>
                {filterOptions.companies.map((c) => {
                  const sel = selectedCompanies.includes(c.code);
                  return (
                    <Chip
                      key={c.code}
                      label={c.name}
                      selected={sel}
                      onPress={() => setSelectedCompanies(prev => sel ? prev.filter(x => x !== c.code) : [...prev, c.code])}
                    />
                  );
                })}
              </View>
              {formErrors.companies ? <Text style={styles.errText}>{formErrors.companies}</Text> : null}

              <Text style={styles.label}>Categories<Text style={styles.req}> *</Text></Text>
              {/* Dynamic categories: REAL employee categories of the SELECTED
                  companies only (union, no duplicates). States per spec:
                  none selected -> "Select company first"; loading -> spinner;
                  no data -> explicit message; else -> multi-select chips. */}
              {!selectedCompanies.length ? (
                <Text style={styles.hint}>Select company first - categories selected companies ke employee data se aati hain.</Text>
              ) : loadingCategories ? (
                <View style={styles.catLoadRow}>
                  <ActivityIndicator size="small" color={COLORS.primary} />
                  <Text style={styles.hint}>Loading categories...</Text>
                </View>
              ) : availableCategories.length ? (
                <View style={styles.catPickRow}>
                  {availableCategories.map((c) => {
                    const sel = selectedCategories.includes(c.code);
                    return (
                      <Chip
                        key={c.code}
                        label={c.name || c.code}
                        selected={sel}
                        onPress={() => setSelectedCategories(prev => sel ? prev.filter(x => x !== c.code) : [...prev, c.code])}
                      />
                    );
                  })}
                </View>
              ) : (
                <Text style={styles.hint}>No employee categories found for selected company.</Text>
              )}
              {formErrors.categories ? <Text style={styles.errText}>{formErrors.categories}</Text> : null}

              <Text style={styles.label}>Duration<Text style={styles.req}> *</Text></Text>
              <View style={styles.catPickRow}>
                <Chip label="Full Day" selected={!form.isHalfDay} onPress={() => setForm({ ...form, isHalfDay: false, halfdaypart: '' })} />
                <Chip label="Half Day" selected={form.isHalfDay} onPress={() => setForm({ ...form, isHalfDay: true, halfdaypart: form.halfdaypart || 'FN' })} />
              </View>
              {form.isHalfDay && (
                <View style={styles.catPickRow}>
                  <Chip label="First Half" selected={form.halfdaypart === 'FN'} onPress={() => setForm({ ...form, halfdaypart: 'FN' })} />
                  <Chip label="Second Half" selected={form.halfdaypart === 'AN'} onPress={() => setForm({ ...form, halfdaypart: 'AN' })} />
                </View>
              )}
              {formErrors.duration ? <Text style={styles.errText}>{formErrors.duration}</Text> : null}

              <Text style={styles.label}>Description (optional)</Text>
              <TextInput
                style={[styles.input, styles.inputMulti]}
                value={form.description}
                onChangeText={(v) => setForm({ ...form, description: v })}
                placeholder="Short note..."
                maxLength={500}
                multiline
              />

              {editing ? (
                <TouchableOpacity style={styles.toggleRow} onPress={() => setForm({ ...form, active: !form.active })}>
                  <View style={[styles.toggleTrack, form.active && { backgroundColor: COLORS.success }]}>
                    <View style={[styles.toggleThumb, form.active && styles.toggleThumbOn]} />
                  </View>
                  <Text style={styles.toggleText}>{form.active ? 'Active' : 'Inactive'}</Text>
                </TouchableOpacity>
              ) : null}
            </ScrollView>

            <View style={styles.sheetFooter}>
              <Button title="Cancel" onPress={() => setFormOpen(false)} variant="outline" size="medium" style={styles.flexBtn} />
              <Button
                title={editing ? 'Save Changes' : 'Add Holiday'}
                onPress={save}
                variant="primary"
                size="medium"
                disabled={saving}
                style={styles.flexBtn}
              />
            </View>
          </View>
        </View>
      </Modal>

      {/* ---------- View holiday (read-only details) ---------- */}
      <Modal visible={Boolean(viewing)} transparent animationType="slide" onRequestClose={() => setViewing(null)}>
        <View style={styles.modalBackdrop}>
          <TouchableOpacity style={styles.flex} activeOpacity={1} onPress={() => setViewing(null)} />
          <View style={styles.sheet}>
            <View style={styles.sheetHeader}>
              <Text style={styles.sheetTitle}>Holiday Details</Text>
              <TouchableOpacity onPress={() => setViewing(null)} hitSlop={{ top: 12, left: 12, bottom: 12, right: 12 }}>
                <Ionicons name="close" size={20} color={COLORS.textSecondary} />
              </TouchableOpacity>
            </View>
            <ScrollView style={styles.sheetBody} showsVerticalScrollIndicator={false}>
              {(() => {
                const h = viewing || {};
                const companyNames = (Array.isArray(h.companies) && h.companies.length
                  ? h.companies
                  : (clean(h.companycode) ? [clean(h.companycode)] : [])
                ).map((code) => filterOptions.companies.find((c) => c.code === code)?.name || code);
                const catNames = (Array.isArray(h.categories) ? h.categories : [])
                  .map((code) => categoryNameLookup.get(code) || code);
                const rows = [
                  ['Date', formatDate(h.holidaydate)],
                  ['Holiday', clean(h.holidayname)],
                  ['Companies', companyNames.length ? companyNames.join(', ') : PLACEHOLDER],
                  ['Categories', catNames.length ? catNames.join(', ') : PLACEHOLDER],
                  ['Duration', h.isHalfDay
                    ? `Half Day${clean(h.halfdaypart) === 'AN' ? ' · Second Half' : ' · First Half'}`
                    : 'Full Day'],
                  ['Status', h.active !== false ? 'Active' : 'Inactive'],
                  ['Description', clean(h.description) || PLACEHOLDER],
                ];
                return rows.map(([key, value]) => (
                  <View key={key} style={styles.viewRow}>
                    <Text style={styles.viewKey}>{key}</Text>
                    <Text style={styles.viewVal}>{value}</Text>
                  </View>
                ));
              })()}
            </ScrollView>
            <View style={styles.sheetFooter}>
              <Button title="Close" onPress={() => setViewing(null)} variant="outline" size="medium" style={styles.flexBtn} />
            </View>
          </View>
        </View>
      </Modal>
    </ScreenContainer>
  );
};

const styles = StyleSheet.create({
  flex: { flex: 1 },
  flexBtn: { flex: 1 },
  scroll: { padding: 12, paddingBottom: 28 },
  topRow: { flexDirection: 'row', gap: 8, marginBottom: 12 },
  statBox: { flex: 1, alignItems: 'center', paddingVertical: 10, borderRadius: 12, borderWidth: 1, borderColor: COLORS.border },
  statValue: { fontSize: 18, fontWeight: '800' },
  statLabel: { fontSize: 10, color: COLORS.textSecondary, marginTop: 2 },
  actionRow: { flexDirection: 'row', gap: 8, marginBottom: 12 },
  searchRow: { flexDirection: 'row', gap: 8, marginBottom: 10 },
  searchInput: {
    flex: 1, backgroundColor: COLORS.surfaceVariant, borderWidth: 1, borderColor: COLORS.border,
    borderRadius: 10, paddingHorizontal: 12, paddingVertical: 9, fontSize: 13, color: COLORS.textPrimary,
    ...(Platform.OS === 'web' ? { outlineStyle: 'none' } : null),
  },
  searchBtn: {
    width: 40, alignItems: 'center', justifyContent: 'center', borderRadius: 10,
    borderWidth: 1, borderColor: COLORS.border, backgroundColor: COLORS.surfaceVariant,
  },
  chipRow: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: 6, marginBottom: 12 },
  chip: { paddingHorizontal: 10, paddingVertical: 6, borderRadius: 999, borderWidth: 1, borderColor: COLORS.border },
  chipActive: { backgroundColor: COLORS.primary, borderColor: COLORS.primary },
  chipText: { fontSize: 11, fontWeight: '600', color: COLORS.textSecondary },
  chipTextActive: { color: '#FFFFFF' },
  chipSep: { width: 1, height: 18, backgroundColor: COLORS.divider, marginHorizontal: 2 },
  stateBox: { paddingVertical: 36, alignItems: 'center', gap: 10 },
  stateText: { fontSize: 13, color: COLORS.textSecondary },
  errorBox: { padding: 14, borderRadius: 12, backgroundColor: `${COLORS.error}15`, borderWidth: 1, borderColor: `${COLORS.error}30`, alignItems: 'center', gap: 10, marginBottom: 12 },
  errorText: { fontSize: 12, color: COLORS.error, textAlign: 'center' },
  card: { backgroundColor: COLORS.surface, borderRadius: 14, padding: 14, marginBottom: 12, borderWidth: 1, borderColor: COLORS.border },
  cardInactive: { opacity: 0.72 },
  cardHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 },
  cardTitle: { fontSize: 14.5, fontWeight: '800', color: COLORS.textPrimary },
  cardFoot: { fontSize: 10, color: COLORS.textTertiary, marginTop: 8 },
  monthBar: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  monthLabel: { fontSize: 12.5, fontWeight: '700', color: COLORS.textPrimary, minWidth: 66, textAlign: 'center' },
  calWeekRow: { flexDirection: 'row', marginBottom: 4 },
  calWeekHead: { flex: 1, textAlign: 'center', fontSize: 9.5, fontWeight: '700', color: COLORS.textTertiary },
  calGrid: { flexDirection: 'row', flexWrap: 'wrap' },
  calCell: { width: `${100 / 7}%`, alignItems: 'center', paddingVertical: 4 },
  calDot: { width: 12, height: 4, borderRadius: 2, marginBottom: 2 },
  calDay: { fontSize: 12.5, fontWeight: '700', color: COLORS.textPrimary },
  calDayOut: { color: COLORS.textTertiary, fontWeight: '500' },
  emptyText: { fontSize: 13, fontWeight: '600', color: COLORS.textSecondary, textAlign: 'center', paddingVertical: 8 },
  emptySub: { fontSize: 11, color: COLORS.textTertiary, textAlign: 'center' },
  rowTop: { flexDirection: 'row', alignItems: 'flex-start', gap: 8 },
  holidayName: { fontSize: 14.5, fontWeight: '700', color: COLORS.textPrimary },
  holidayDate: { fontSize: 11.5, color: COLORS.textSecondary, marginTop: 2 },
  catChip: { paddingHorizontal: 9, paddingVertical: 4, borderRadius: 999, borderWidth: 1 },
  catChipText: { fontSize: 10, fontWeight: '700' },
  holidayDesc: { fontSize: 12, color: COLORS.textSecondary, marginTop: 8 },
  holidayMeta: { fontSize: 11, color: COLORS.textTertiary, marginTop: 4 },
  rowBottom: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: 12, paddingTop: 10, borderTopWidth: 1, borderTopColor: COLORS.divider },
  statusWrap: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  statusDot: { width: 7, height: 7, borderRadius: 4 },
  statusText: { fontSize: 11.5, fontWeight: '700' },
  iconActions: { flexDirection: 'row', gap: 6 },
  iconBtn: { width: 34, height: 34, alignItems: 'center', justifyContent: 'center', borderRadius: 9, borderWidth: 1, borderColor: COLORS.border },
  modalBackdrop: { flex: 1, backgroundColor: 'rgba(15,23,42,0.45)', justifyContent: 'flex-end' },
  sheet: { backgroundColor: COLORS.surface, borderTopLeftRadius: 18, borderTopRightRadius: 18, maxHeight: '88%', paddingBottom: 8 },
  sheetHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', padding: 16, borderBottomWidth: 1, borderBottomColor: COLORS.border },
  sheetTitle: { fontSize: 15.5, fontWeight: '800', color: COLORS.textPrimary },
  sheetBody: { padding: 16, maxHeight: 460 },
  sheetFooter: { flexDirection: 'row', gap: 10, padding: 16, borderTopWidth: 1, borderTopColor: COLORS.border },
  label: { fontSize: 12, fontWeight: '700', color: COLORS.textPrimary, marginBottom: 6, marginTop: 12 },
  req: { color: COLORS.error },
  input: {
    backgroundColor: COLORS.surfaceVariant, borderWidth: 1, borderColor: COLORS.border, borderRadius: 10,
    paddingHorizontal: 12, paddingVertical: 10, fontSize: 13.5, color: COLORS.textPrimary,
    ...(Platform.OS === 'web' ? { outlineStyle: 'none' } : null),
  },
  inputMulti: { minHeight: 70, textAlignVertical: 'top' },
  inputError: { borderColor: COLORS.error },
  errText: { fontSize: 11, color: COLORS.error, marginTop: 5 },
  hint: { fontSize: 10.5, color: COLORS.textTertiary, marginTop: 6 },
  catPickRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 7 },
  catLoadRow: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingVertical: 4 },
  viewRow: { flexDirection: 'row', justifyContent: 'space-between', gap: 12, paddingVertical: 9, borderBottomWidth: 1, borderBottomColor: COLORS.divider },
  viewKey: { fontSize: 12, fontWeight: '700', color: COLORS.textSecondary, width: 92 },
  viewVal: { flex: 1, fontSize: 13, color: COLORS.textPrimary, textAlign: 'right' },
  catPick: { paddingHorizontal: 12, paddingVertical: 9, borderRadius: 10, borderWidth: 1 },
  catPickText: { fontSize: 11.5, fontWeight: '600' },
  catPickTextSelected: { fontWeight: '800' },
  toggleRow: { flexDirection: 'row', alignItems: 'center', gap: 10, marginTop: 18 },
  toggleTrack: { width: 44, height: 24, borderRadius: 12, backgroundColor: COLORS.border, justifyContent: 'center', padding: 2 },
  toggleThumb: { width: 20, height: 20, borderRadius: 10, backgroundColor: '#FFFFFF' },
  toggleThumbOn: { marginLeft: 20 },
  toggleText: { fontSize: 13, fontWeight: '700', color: COLORS.textPrimary },
});

export default HRHolidayManagementScreen;
