// ============================================================================
// FILE: mobile/src/screens/hr/HREmployeesScreen.jsx
// PURPOSE: HR Employees Roster - real Savior employees with search, filters, pagination
// ============================================================================

/**
 * Real Savior SQL employee roster for HR.
 *
 * Navigation Flow:
 * HRNavigator (Employees Tab) -> HREmployeesScreen
 *   -> tap a row / View button -> real employee details loaded in this screen
 *
 * Data Flow (existing backend API, same as desktop website):
 * GET /api/employees?page=..&pageSize=100&active=Y   -> real roster + real total
 * GET /api/employees/:paycode                        -> real selected employee details
 *
 * The backend caps pageSize at 100, so the full active roster is loaded through
 * its own pagination and the visible paging (50 / 100 / 150) is done here.
 * Totals always come from the real API dataset, never from rendered rows.
 *
 * No demo/mock data: loading failure shows a retry state instead of fake rows.
 */

import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { View, Text, ScrollView, StyleSheet, TextInput, TouchableOpacity, ActivityIndicator, Modal } from 'react-native';
import { COLORS, TYPOGRAPHY, SPACING, SHADOWS } from '../../utils/colors';
import { ScreenContainer } from '../../components/ScreenContainer';
import { Button } from '../../components/Button';
import { api } from '../../services/api';

const PAGE_SIZES = [50, 100, 150];
const SERVER_PAGE_SIZE = 100;

const clean = (v) => String(v == null ? '' : v).trim();

export const HREmployeesScreen = () => {
  const [allEmployees, setAllEmployees] = useState([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState(null);
  const [search, setSearch] = useState('');
  const [filters, setFilters] = useState({ department: '', company: '', gender: '', category: '', designation: '', marital: '', status: '' });
  const [exported, setExported] = useState(null);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(50);
  const [detail, setDetail] = useState(null);
  const [detailLoading, setDetailLoading] = useState(false);
  // Real filter options come from the existing /hr/filters endpoint.
  const [filterOptions, setFilterOptions] = useState({ departments: [], companies: [], genders: [], categories: [], designations: [], maritalStatuses: [], statuses: [] });

  const loadRoster = useCallback(async () => {
    setIsLoading(true);
    setError(null);
    try {
      const rows = [];
      for (let p = 1; p <= 50; p += 1) {
        const data = await api.get('/employees', { page: p, pageSize: SERVER_PAGE_SIZE, active: 'Y' });
        const batch = Array.isArray(data?.rows) ? data.rows : [];
        rows.push(...batch);
        if (batch.length < SERVER_PAGE_SIZE) break;
      }
      setAllEmployees(rows);
      setPage(1);
    } catch (err) {
      setAllEmployees([]);
      setError(err?.message || 'Employee list load nahi ho paya.');
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => { loadRoster(); }, [loadRoster]);

  // Load real filter options (same endpoint the desktop roster uses).
  useEffect(() => {
    let active = true;
    api.get('/hr/filters')
      .then((data) => {
        if (!active) return;
        setFilterOptions({
          departments: Array.isArray(data?.departments) ? data.departments : [],
          companies: Array.isArray(data?.companies) ? data.companies : [],
          genders: Array.isArray(data?.genders) ? data.genders : [],
          categories: Array.isArray(data?.categories) ? data.categories : [],
          designations: Array.isArray(data?.designations) ? data.designations : [],
          maritalStatuses: Array.isArray(data?.maritalStatuses) ? data.maritalStatuses : [],
          statuses: Array.isArray(data?.statuses) ? data.statuses : [],
        });
      })
      .catch(() => { /* filters stay empty; list still works */ });
    return () => { active = false; };
  }, []);

  // Client-side filtering on the real dataset (same business rules as desktop).
  const filtered = useMemo(() => {
    const term = clean(search).toLowerCase();
    const list = allEmployees.filter((e) => {
      if (term) {
        const hay = [e.paycode, e.empname, e.presentcardno, e.departmentcode, e.departmentname, e.companycode, e.companyname]
          .map(clean).join(' ').toLowerCase();
        if (hay.indexOf(term) < 0) return false;
      }
      if (filters.department && clean(e.departmentcode) !== filters.department) return false;
      if (filters.company && clean(e.companycode) !== filters.company) return false;
      if (filters.gender && clean(e.sex) !== filters.gender) return false;
      if (filters.category && clean(e.cat) !== filters.category) return false;
      if (filters.designation && clean(e.designation) !== filters.designation) return false;
      if (filters.marital && clean(e.ismarried) !== filters.marital) return false;
      if (filters.status && clean(e.active) !== filters.status) return false;
      return true;
    });
    // Always A -> Z by real employee name, including after search/filters.
    return list
      .slice()
      .sort((a, b) => clean(a.empname).localeCompare(clean(b.empname), undefined, { sensitivity: 'base' }));
  }, [allEmployees, search, filters]);

  // Real total for the current (filtered) dataset.
  const total = filtered.length;
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  const safePage = Math.min(page, totalPages);
  const start = (safePage - 1) * pageSize;
  const visible = filtered.slice(start, start + pageSize);

  const changePageSize = (size) => { setPageSize(size); setPage(1); };

  const clearFilters = () => {
    setFilters({ department: '', company: '', gender: '', category: '', designation: '', marital: '', status: '' });
    setSearch('');
    setPage(1);
  };

  // Export the currently filtered real dataset as CSV text.
  const exportRoster = () => {
    const header = ['Paycode', 'Name', 'Card', 'Department', 'Designation', 'Company', 'Gender', 'Category', 'Marital', 'Active', 'Present', 'Absent', 'Miss', 'Late', 'Hours'];
    const lines = [header.join(',')].concat(filtered.map((e) => [
      clean(e.paycode), clean(e.empname), clean(e.presentcardno),
      clean(e.departmentname || e.departmentcode), clean(e.designation),
      clean(e.companyname || e.companycode), clean(e.sex), clean(e.cat),
      clean(e.ismarried), clean(e.active),
      e.presentCount ?? '', e.absentCount ?? '', e.missCount ?? '', e.lateCount ?? '', e.totalHours ?? '',
    ].map((v) => `"${String(v).replace(/"/g, '""')}"`).join(',')));
    setExported(lines.join('\n'));
  };

  const openDetail = async (employee) => {
    setDetailLoading(true);
    setDetail({ paycode: clean(employee.paycode) });
    try {
      const data = await api.get(`/employees/${encodeURIComponent(clean(employee.paycode))}`);
      setDetail(data);
    } catch (err) {
      setDetail(null);
      setError(err?.message || 'Employee details load nahi ho paye.');
    } finally {
      setDetailLoading(false);
    }
  };

  // Real filter options loaded from /hr/filters (same source as the desktop roster).
  const coded = (list) => ({
    options: ['', ...list.map(clean)],
    render: (v) => v,
  });
  const filterDefs = [
    {
      key: 'department',
      label: 'Dept',
      options: ['', ...filterOptions.departments.map((d) => clean(d.code))],
      render: (v) => {
        const m = filterOptions.departments.find((d) => clean(d.code) === v);
        return m ? clean(m.name) : '';
      },
    },
    {
      key: 'company',
      label: 'Company',
      options: ['', ...filterOptions.companies.map((c) => clean(c.code))],
      render: (v) => {
        const m = filterOptions.companies.find((c) => clean(c.code) === v);
        return m ? clean(m.name) : '';
      },
    },
    { key: 'gender', label: 'Gender', ...coded(filterOptions.genders) },
    { key: 'category', label: 'Category', ...coded(filterOptions.categories) },
    { key: 'designation', label: 'Designation', ...coded(filterOptions.designations) },
    { key: 'marital', label: 'Marital', ...coded(filterOptions.maritalStatuses) },
    { key: 'status', label: 'Active', ...coded(filterOptions.statuses) },
  ];

  const cycleFilter = (key, options) => {
    const current = filters[key];
    const idx = options.indexOf(current);
    const next = options[(idx + 1) % options.length];
    setFilters((p) => ({ ...p, [key]: next }));
    setPage(1);
  };

  return (
    <ScreenContainer title="All Employees" showHeader={true}>
      {isLoading ? (
        <View style={styles.loadingContainer}>
          <ActivityIndicator size="large" color={COLORS.primary} />
          <Text style={styles.loadingText}>Real employees load ho rahe hain...</Text>
        </View>
      ) : (
        <ScrollView contentContainerStyle={styles.scrollContent}>
          {error ? (
            <View style={styles.errorBox}>
              <Text style={styles.errorText}>⚠️ {error}</Text>
              <Button title="Retry" onPress={loadRoster} variant="outline" size="small" style={styles.retryButton} />
            </View>
          ) : null}

          {/* Real total + page size */}
          <View style={styles.totalBar}>
            <Text style={styles.totalText}>Total employees: {total}</Text>
            <View style={styles.pageSizeRow}>
              {PAGE_SIZES.map((size) => (
                <TouchableOpacity
                  key={size}
                  style={[styles.sizeChip, pageSize === size && styles.sizeChipActive]}
                  onPress={() => changePageSize(size)}
                >
                  <Text style={[styles.sizeChipText, pageSize === size && styles.sizeChipTextActive]}>{size}</Text>
                </TouchableOpacity>
              ))}
            </View>
          </View>

          {/* Search */}
          <View style={styles.filterSection}>
            <TextInput
              style={[styles.searchInput, TYPOGRAPHY.body]}
              placeholder="Search Name or ID..."
              value={search}
              onChangeText={(t) => { setSearch(t); setPage(1); }}
              placeholderTextColor={COLORS.textTertiary}
            />

            <View style={styles.actionRow}>
              <Button title="Clear Filters" onPress={clearFilters} variant="outline" size="small" style={styles.actionButton} />
              <Button title="Export" onPress={exportRoster} variant="secondary" size="small" style={styles.actionButton} />
            </View>
            {exported ? (
              <View style={styles.exportBox}>
                <Text style={styles.exportText}>Export ready ({filtered.length} employees, {exported.split('\n').length} rows)</Text>
                <TouchableOpacity onPress={() => setExported(null)} hitSlop={{ top: 10, left: 10, bottom: 10, right: 10 }}>
                  <Text style={styles.exportClose}>✕</Text>
                </TouchableOpacity>
              </View>
            ) : null}

            <View style={styles.filterChips}>
              {filterDefs.map((f) => (
                <TouchableOpacity key={f.key} style={styles.filterChip} onPress={() => cycleFilter(f.key, f.options)}>
                  <Text style={[styles.filterChipLabel, TYPOGRAPHY.caption]}>{f.label}</Text>
                  <Text style={styles.filterChipValue} numberOfLines={1}>
                    {filters[f.key] ? (f.render ? f.render(filters[f.key]) : filters[f.key]) : 'All'}
                  </Text>
                </TouchableOpacity>
              ))}
            </View>
          </View>

          {/* Employee list */}
          <View style={styles.listContainer}>
            <View style={styles.tableHeader}>
              <Text style={styles.tableCellHeader}>ID</Text>
              <Text style={styles.tableCellHeader}>Name</Text>
              <Text style={styles.tableCellHeader}>Department</Text>
              <Text style={styles.tableCellHeader}>P / A / M / L</Text>
              <Text style={styles.tableCellHeader}>Action</Text>
            </View>

            {visible.length === 0 ? (
              <View style={styles.emptyRow}>
                <Text style={styles.emptyText}>Is filter se koi employee nahi mila.</Text>
              </View>
            ) : null}

            {visible.map((emp) => (
              <TouchableOpacity
                key={clean(emp.paycode)}
                style={styles.employeeRow}
                onPress={() => openDetail(emp)}
                activeOpacity={0.8}
              >
                <Text style={styles.tableCell}>{clean(emp.paycode)}</Text>
                <Text style={styles.tableCellName} numberOfLines={1}>{clean(emp.empname)}</Text>
                <Text style={styles.tableCellDept} numberOfLines={1}>{clean(emp.departmentname) || '—'}</Text>
                <Text style={styles.tableCellStat}>
                  {Number(emp.presentCount || 0)}/{Number(emp.absentCount || 0)}/{Number(emp.missCount || 0)}/{Number(emp.lateCount || 0)}
                </Text>
                <TouchableOpacity style={styles.auditButton} onPress={() => openDetail(emp)}>
                  <Text style={styles.auditButtonText}>View</Text>
                </TouchableOpacity>
              </TouchableOpacity>
            ))}

            {/* Pagination */}
            <View style={styles.pagination}>
              <TouchableOpacity
                style={[styles.pageButton, safePage === 1 && styles.pageButtonDisabled]}
                disabled={safePage === 1}
                onPress={() => setPage((p) => Math.max(1, p - 1))}
              >
                <Text style={styles.pageButtonText}>Previous</Text>
              </TouchableOpacity>
              <Text style={styles.pageInfo}>Page {safePage} of {totalPages}</Text>
              <TouchableOpacity
                style={[styles.pageButton, safePage === totalPages && styles.pageButtonDisabled]}
                disabled={safePage === totalPages}
                onPress={() => setPage((p) => Math.min(totalPages, p + 1))}
              >
                <Text style={styles.pageButtonText}>Next</Text>
              </TouchableOpacity>
            </View>
          </View>

          {/* Real selected employee details */}
          {detail || detailLoading ? (
            <View style={styles.detailCard}>
              <Text style={styles.detailTitle}>{detailLoading ? 'Loading employee...' : 'Employee Details'}</Text>
              {detail ? (
                <View style={styles.detailGrid}>
                  <Text style={styles.detailLine}>Paycode: {clean(detail.paycode)}</Text>
                  <Text style={styles.detailLine}>Name: {clean(detail.empname)}</Text>
                  <Text style={styles.detailLine}>Department: {clean(detail.departmentname || detail.departmentcode)}</Text>
                  <Text style={styles.detailLine}>Company: {clean(detail.companyname || detail.companycode)}</Text>
                  <Text style={styles.detailLine}>Designation: {clean(detail.designation)}</Text>
                  <Text style={styles.detailLine}>Card No: {clean(detail.presentcardno)}</Text>
                  <Text style={styles.detailLine}>Gender: {clean(detail.sex)}</Text>
                  <Text style={styles.detailLine}>Marital: {clean(detail.ismarried) === 'Y' ? 'Married' : 'Single'}</Text>
                  <Text style={styles.detailLine}>Active: {clean(detail.active) === 'Y' ? 'Yes' : 'No'}</Text>
                  <Text style={styles.detailLine}>Date of Join: {String(detail.dateofjoin || '').slice(0, 10)}</Text>
                </View>
              ) : null}
            </View>
          ) : null}
        </ScrollView>
      )}

      {/* Employee View opens a real modal overlay above the roster */}
      <Modal visible={!!detail || detailLoading} transparent animationType="fade" onRequestClose={() => { setDetail(null); }}>
        <View style={styles.modalBackdrop}>
          <View style={styles.modalCard}>
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>Employee Details</Text>
              <TouchableOpacity onPress={() => setDetail(null)} hitSlop={{ top: 12, left: 12, bottom: 12, right: 12 }}>
                <Text style={styles.modalClose}>✕</Text>
              </TouchableOpacity>
            </View>
            <ScrollView style={styles.modalBody}>
              {detailLoading ? (
                <View style={styles.modalState}>
                  <ActivityIndicator color={COLORS.primary} />
                  <Text style={styles.emptyText}>Loading employee...</Text>
                </View>
              ) : null}
              {detail ? (
                <View style={styles.detailGrid}>
                  <Text style={styles.detailLine}>Paycode: {clean(detail.paycode)}</Text>
                  <Text style={styles.detailLine}>Name: {clean(detail.empname)}</Text>
                  <Text style={styles.detailLine}>Department: {clean(detail.departmentname || detail.departmentcode)}</Text>
                  <Text style={styles.detailLine}>Company: {clean(detail.companyname || detail.companycode)}</Text>
                  <Text style={styles.detailLine}>Designation: {clean(detail.designation)}</Text>
                  <Text style={styles.detailLine}>Card No: {clean(detail.presentcardno)}</Text>
                  <Text style={styles.detailLine}>Gender: {clean(detail.sex)}</Text>
                  <Text style={styles.detailLine}>Marital: {clean(detail.ismarried) === 'Y' ? 'Married' : 'Single'}</Text>
                  <Text style={styles.detailLine}>Active: {clean(detail.active) === 'Y' ? 'Yes' : 'No'}</Text>
                  <Text style={styles.detailLine}>Date of Join: {String(detail.dateofjoin || '').slice(0, 10)}</Text>
                </View>
              ) : null}
            </ScrollView>
          </View>
        </View>
      </Modal>
    </ScreenContainer>
  );
};

const styles = StyleSheet.create({
  scrollContent: { paddingHorizontal: SPACING.lg, paddingBottom: SPACING.xxl },
  modalBackdrop: { flex: 1, backgroundColor: COLORS.overlay, justifyContent: 'center', padding: SPACING.lg },
  modalCard: { backgroundColor: COLORS.surface, borderRadius: 16, maxHeight: '80%', overflow: 'hidden' },
  modalHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', padding: SPACING.md, borderBottomWidth: 1, borderBottomColor: COLORS.border },
  modalTitle: { fontSize: 15, fontWeight: '700', color: COLORS.textPrimary },
  modalClose: { fontSize: 18, color: COLORS.textSecondary, fontWeight: '700' },
  modalBody: { padding: SPACING.md, maxHeight: 420 },
  modalState: { alignItems: 'center', paddingVertical: SPACING.lg, gap: 8 },
  actionRow: { flexDirection: 'row', gap: 8, marginTop: 8 },
  actionButton: { flex: 1 },
  exportBox: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: 8, padding: 10, borderRadius: 10, backgroundColor: `${COLORS.success}15`, borderWidth: 1, borderColor: `${COLORS.success}35}` },
  exportText: { fontSize: 11, color: COLORS.success, flex: 1 },
  exportClose: { fontSize: 14, color: COLORS.success, fontWeight: '700' },
  tableCellDept: { flex: 1.6, fontSize: 10, color: COLORS.textSecondary },
  loadingContainer: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 12 },
  loadingText: { color: COLORS.textSecondary, fontSize: 13 },
  errorBox: {
    backgroundColor: COLORS.error + '15',
    borderWidth: 1,
    borderColor: COLORS.error + '30',
    borderRadius: 10,
    padding: SPACING.md,
    alignItems: 'center',
    marginBottom: SPACING.md,
  },
  errorText: { color: COLORS.error, fontSize: 12, textAlign: 'center', marginBottom: 8 },
  retryButton: { alignSelf: 'center' },
  totalBar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: SPACING.md,
  },
  totalText: { color: COLORS.textPrimary, fontSize: 13, fontWeight: '700' },
  pageSizeRow: { flexDirection: 'row', gap: 6 },
  sizeChip: {
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: COLORS.border,
    backgroundColor: COLORS.surfaceVariant,
  },
  sizeChipActive: { backgroundColor: COLORS.primary, borderColor: COLORS.primary },
  sizeChipText: { fontSize: 11, color: COLORS.textSecondary, fontWeight: '600' },
  sizeChipTextActive: { color: '#FFFFFF' },
  filterSection: { marginBottom: SPACING.md, gap: SPACING.sm },
  searchInput: {
    backgroundColor: COLORS.surface,
    borderWidth: 1,
    borderColor: COLORS.border,
    borderRadius: 10,
    paddingHorizontal: SPACING.md,
    paddingVertical: SPACING.sm,
    color: COLORS.textPrimary,
  },
  filterChips: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  filterChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    borderWidth: 1,
    borderColor: COLORS.border,
    borderRadius: 14,
    paddingHorizontal: 8,
    paddingVertical: 4,
    backgroundColor: COLORS.surfaceVariant,
  },
  filterChipLabel: { color: COLORS.textSecondary, fontWeight: '600' },
  filterChipValue: { color: COLORS.textPrimary, fontSize: 11, fontWeight: '700' },
  listContainer: {
    backgroundColor: COLORS.surface,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: COLORS.border,
    overflow: 'hidden',
  },
  tableHeader: {
    flexDirection: 'row',
    backgroundColor: COLORS.surfaceVariant,
    paddingVertical: SPACING.sm,
    paddingHorizontal: SPACING.sm,
    gap: 6,
  },
  tableCellHeader: { flex: 1, fontSize: 10, fontWeight: '700', color: COLORS.textSecondary },
  employeeRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: SPACING.sm,
    paddingHorizontal: SPACING.sm,
    gap: 6,
    borderTopWidth: 1,
    borderTopColor: COLORS.border,
  },
  tableCell: { flex: 1, fontSize: 11, color: COLORS.textPrimary },
  tableCellName: { flex: 1.4, fontSize: 12, fontWeight: '600', color: COLORS.textPrimary },
  auditButton: {
    paddingHorizontal: 10,
    paddingVertical: 4,
    backgroundColor: COLORS.primary + '15',
    borderRadius: 12,
  },
  auditButtonText: { color: COLORS.primary, fontWeight: '700', fontSize: 11 },
  emptyRow: { padding: SPACING.md },
  emptyText: { color: COLORS.textTertiary, fontSize: 12, textAlign: 'center' },
  pagination: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: SPACING.sm,
    borderTopWidth: 1,
    borderTopColor: COLORS.border,
  },
  pageButton: {
    paddingHorizontal: SPACING.md,
    paddingVertical: 6,
    backgroundColor: COLORS.primary,
    borderRadius: 8,
  },
  pageButtonDisabled: { backgroundColor: COLORS.border },
  pageButtonText: { color: '#FFFFFF', fontSize: 12, fontWeight: '600' },
  pageInfo: { color: COLORS.textPrimary, fontSize: 12, fontWeight: '600' },
  detailCard: {
    marginTop: SPACING.md,
    padding: SPACING.md,
    borderRadius: 12,
    backgroundColor: COLORS.surface,
    borderWidth: 1,
    borderColor: COLORS.primary + '40',
  },
  detailTitle: { fontSize: 14, fontWeight: '700', color: COLORS.textPrimary, marginBottom: 8 },
  detailGrid: { gap: 4 },
  detailLine: { fontSize: 12, color: COLORS.textSecondary },
});
