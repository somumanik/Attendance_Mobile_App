// ============================================================================
// FILE: mobile/src/screens/hr/HRDailyMasterScreen.jsx
// PURPOSE: HR Daily Master Report - Per-employee daily attendance for date range
// ============================================================================

/**
 * Ye screen HR ko daily master report dikhati hai - har employee ka daily attendance.
 * 
 * Navigation Flow:
 * HRNavigator (Daily Master Tab) → HRDailyMasterScreen
 * 
 * Data Flow (Phase 2):
 * Screen Mount → API Service (GET /api/hr/daily-master) → Backend
 * Date Range Change → API Call with query params
 * 
 * Backend API: GET /api/hr/daily-master
 * Query params: fromDate, toDate, departmentcode, companycode, active
 * Response: Array of { paycode, empname, companycode, departmentcode, date, in1, in2, out1, out2, hoursworked, latearrival, status, statusCode, statusLabel, computedStatus, inTime, outTime, isLate, reason, graceUsed }
 * 
 * Phase 1: Placeholder UI with date pickers and demo data table
 * Phase 2: Real API integration with export functionality
 */

import React, { useState, useEffect } from 'react';
import { View, Text, ScrollView, StyleSheet, TouchableOpacity } from 'react-native';
import { COLORS, TYPOGRAPHY, SPACING, SHADOWS } from '../../utils/colors';
import { formatDate, getStatusColor } from '../../utils/format';
import { ScreenContainer } from '../../components/ScreenContainer';

/**
 * HR Daily Master Report Screen Component
 */
export const HRDailyMasterScreen = () => {
  const [reportData, setReportData] = useState([]);
  const [isLoading, setIsLoading] = useState(true);
  const [dateRange, setDateRange] = useState({
    fromDate: new Date(new Date().getFullYear(), new Date().getMonth(), 1).toISOString().split('T')[0],
    toDate: new Date().toISOString().split('T')[0],
  });
  const [filters, setFilters] = useState({
    department: '',
    company: '',
    active: 'Y',
  });

  useEffect(() => {
    // Phase 2: Real API call
    // const data = await api.get(API_ENDPOINTS.HR_DAILY_MASTER, { params: { ...dateRange, ...filters } });
    // setReportData(data);
    
    // Phase 1: Demo data
    setTimeout(() => {
      setReportData([
        { paycode: 'EMP001', empname: 'Rajesh Kumar', companycode: 'SAVIOR INFOTECH', departmentcode: 'IT', date: '2026-09-20', in1: '09:00 AM', in2: '—', out1: '06:00 PM', out2: '—', hoursworked: 9, latearrival: 0, status: 'Present', statusCode: 'P', statusLabel: 'Present', computedStatus: 'Present', inTime: '09:00 AM', outTime: '06:00 PM', isLate: false, reason: '', graceUsed: null },
        { paycode: 'EMP002', empname: 'Priya Sharma', companycode: 'SAVIOR INFOTECH', departmentcode: 'HR', date: '2026-09-20', in1: '08:55 AM', in2: '—', out1: '05:30 PM', out2: '—', hoursworked: 8.5, latearrival: 0, status: 'Present', statusCode: 'P', statusLabel: 'Present', computedStatus: 'Present', inTime: '08:55 AM', outTime: '05:30 PM', isLate: false, reason: '', graceUsed: null },
        { paycode: 'EMP003', empname: 'Amit Kumar', companycode: 'SAVIOR INFOTECH', departmentcode: 'IT', date: '2026-09-20', in1: '09:25 AM', in2: '—', out1: '06:00 PM', out2: '—', hoursworked: 8.5, latearrival: 25, status: 'Late', statusCode: 'LATE', statusLabel: 'Late', computedStatus: 'Present', inTime: '09:25 AM', outTime: '06:00 PM', isLate: true, reason: '', graceUsed: null },
        { paycode: 'EMP004', empname: 'Sunita Reddy', companycode: 'SAVIOR INFOTECH', departmentcode: 'Finance', date: '2026-09-20', in1: '08:50 AM', in2: '—', out1: '05:30 PM', out2: '—', hoursworked: 8.5, latearrival: 0, status: 'Present', statusCode: 'P', statusLabel: 'Present', computedStatus: 'Present', inTime: '08:50 AM', outTime: '05:30 PM', isLate: false, reason: '', graceUsed: null },
        { paycode: 'EMP005', empname: 'Vikram Singh', companycode: 'SAVIOR INFOTECH', departmentcode: 'Operations', date: '2026-09-20', in1: '—', in2: '—', out1: '—', out2: '—', hoursworked: 0, latearrival: 0, status: 'Absent', statusCode: 'A', statusLabel: 'Absent', computedStatus: 'Absent', inTime: '—', outTime: '—', isLate: false, reason: 'Leave', graceUsed: null },
        { paycode: 'EMP006', empname: 'Anita Desai', companycode: 'SAVIOR INFOTECH', departmentcode: 'IT', date: '2026-09-20', in1: '09:00 AM', in2: '—', out1: '—', out2: '—', hoursworked: 0, latearrival: 0, status: 'Miss Punch', statusCode: 'MIS', statusLabel: 'Miss Punch', computedStatus: 'Miss Punch', inTime: '09:00 AM', outTime: '—', isLate: false, reason: '', graceUsed: null },
      ]);
      setIsLoading(false);
    }, 500);
  }, [dateRange, filters]);

  const handleExport = async () => {
    // Phase 2: CSV export
    // const blob = await api.get(API_ENDPOINTS.HR_DAILY_MASTER, { 
    //   params: { ...dateRange, ...filters, format: 'csv' },
    //   responseType: 'blob'
    // });
    // Save file...
    
    // Phase 1: Placeholder
    Alert.alert('Phase 2 Pending', 'CSV export will be implemented in Phase 2');
  };

  const getStatusColorStyle = (statusCode) => ({
    backgroundColor: getStatusColor(statusCode) + '20',
    borderColor: getStatusColor(statusCode),
  });

  return (
    <ScreenContainer title="Daily Master Report" showHeader={true}>
      <ScrollView contentContainerStyle={styles.scrollContent}>
        {/* Date Range & Filters */}
        <View style={styles.filterSection}>
          <View style={styles.dateRow}>
            <View style={styles.datePicker}>
              <Text style={[styles.dateLabel, TYPOGRAPHY.caption]}>From Date</Text>
              <TouchableOpacity style={styles.dateButton} onPress={() => {}}>
                <Text style={[styles.dateButtonText, TYPOGRAPHY.body]}>{dateRange.fromDate}</Text>
              </TouchableOpacity>
            </View>
            <View style={styles.datePicker}>
              <Text style={[styles.dateLabel, TYPOGRAPHY.caption]}>To Date</Text>
              <TouchableOpacity style={styles.dateButton} onPress={() => {}}>
                <Text style={[styles.dateButtonText, TYPOGRAPHY.body]}>{dateRange.toDate}</Text>
              </TouchableOpacity>
            </View>
          </View>

          <View style={styles.filterRow}>
            <View style={styles.filterSelect}>
              <Text style={[styles.filterLabel, TYPOGRAPHY.caption]}>Department</Text>
              <Select
                value={filters.department}
                onValueChange={(val) => setFilters(p => ({ ...p, department: val }))}
                items={[
                  { label: 'All Departments', value: '' },
                  { label: 'IT', value: 'IT' },
                  { label: 'HR', value: 'HR' },
                  { label: 'Finance', value: 'Finance' },
                  { label: 'Operations', value: 'Operations' },
                  { label: 'Sales', value: 'Sales' },
                ]}
                style={styles.filterSelectInput}
              />
            </View>
            <View style={styles.filterSelect}>
              <Text style={[styles.filterLabel, TYPOGRAPHY.caption]}>Company</Text>
              <Select
                value={filters.company}
                onValueChange={(val) => setFilters(p => ({ ...p, company: val }))}
                items={[
                  { label: 'All Companies', value: '' },
                  { label: 'SAVIOR INFOTECH', value: 'SAVIOR INFOTECH' },
                  { label: 'SAVIOR TECH', value: 'SAVIOR TECH' },
                ]}
                style={styles.filterSelectInput}
              />
            </View>
          </View>

          <View style={styles.actionRow}>
            <TouchableOpacity style={styles.refreshButton} onPress={() => {}}>
              <Text style={styles.refreshButtonText}>🔄 Refresh</Text>
            </TouchableOpacity>
            <TouchableOpacity style={[styles.exportButton, SHADOWS.md]} onPress={handleExport}>
              <Text style={styles.exportButtonText}>📥 Export CSV</Text>
            </TouchableOpacity>
          </View>
        </View>

        {/* Summary Stats */}
        <View style={styles.summaryRow}>
          <PlaceholderCard title="Total Records" value={reportData.length} color={COLORS.primary} />
          <PlaceholderCard title="Present" value={reportData.filter(r => r.computedStatus === 'Present').length} color={COLORS.success} />
          <PlaceholderCard title="Absent" value={reportData.filter(r => r.computedStatus === 'Absent').length} color={COLORS.error} />
          <PlaceholderCard title="Miss Punch" value={reportData.filter(r => r.computedStatus === 'Miss Punch').length} color={COLORS.warning} />
          <PlaceholderCard title="Late" value={reportData.filter(r => r.isLate).length} color={COLORS.error} />
        </View>

        {/* Data Table */}
        <View style={[styles.tableCard, SHADOWS.md]}>
          <View style={styles.tableHeader}>
            <Text style={styles.tableHeaderCell}>Employee</Text>
            <Text style={styles.tableHeaderCell}>Dept</Text>
            <Text style={styles.tableHeaderCell}>Date</Text>
            <Text style={styles.tableHeaderCell}>In</Text>
            <Text style={styles.tableHeaderCell}>Out</Text>
            <Text style={styles.tableHeaderCell}>Hours</Text>
            <Text style={styles.tableHeaderCell}>Status</Text>
            <Text style={styles.tableHeaderCell}>Late</Text>
            <Text style={styles.tableHeaderCell}>Reason</Text>
          </View>

          {reportData.map((record, index) => (
            <View key={index} style={styles.tableRow}>
              <View style={styles.tableCellEmployee}>
                <Text style={styles.cellEmployeeName}>{record.empname}</Text>
                <Text style={styles.cellEmployeeId}>{record.paycode}</Text>
              </View>
              <Text style={styles.tableCell}>{record.departmentcode}</Text>
              <Text style={styles.tableCell}>{record.date}</Text>
              <Text style={styles.tableCell}>{record.inTime}</Text>
              <Text style={styles.tableCell}>{record.outTime}</Text>
              <Text style={styles.tableCell}>{record.hoursworked > 0 ? record.hoursworked + 'h' : '—'}</Text>
              <View style={[styles.statusBadge, { backgroundColor: getStatusColor(record.statusCode) + '20', borderColor: getStatusColor(record.statusCode) }]}>
                <Text style={[{ color: getStatusColor(record.statusCode) }, styles.statusBadgeText]}>{record.computedStatus}</Text>
              </View>
              <View style={styles.lateCell}>
                {record.isLate ? (
                  <Text style={styles.lateText}>{record.latearrival} min</Text>
                ) : (
                  <Text style={styles.okText}>—</Text>
                )}
              </View>
              <Text style={styles.reasonCell}>{record.reason || '—'}</Text>
            </View>
          ))}
          </View>
          <View style={styles.phaseNotice}>
            <Text style={[styles.phaseNoticeText, TYPOGRAPHY.caption]}>
              ℹ️ Phase 1 - Demo data. Real API: GET /api/hr/daily-master with date range & filters
            </Text>
          </View>
        </ScrollView>
    </ScreenContainer>
  );
};

// Import Alert
import { Alert } from 'react-native';

const styles = StyleSheet.create({
  scrollContent: {
    paddingHorizontal: SPACING.lg,
    paddingBottom: SPACING.xxl,
  },
  filterSection: {
    marginBottom: SPACING.lg,
    gap: SPACING.md,
  },
  dateRow: {
    flexDirection: 'row',
    gap: SPACING.md,
  },
  datePicker: {
    flex: 1,
    gap: SPACING.xs,
  },
  dateLabel: {
    color: COLORS.textSecondary,
    fontWeight: '600',
  },
  dateButton: {
    backgroundColor: COLORS.surface,
    borderWidth: 1,
    borderColor: COLORS.border,
    borderRadius: 12,
    paddingHorizontal: SPACING.md,
    paddingVertical: SPACING.md,
  },
  dateButtonText: {
    color: COLORS.textPrimary,
    textAlign: 'center',
  },
  filterRow: {
    flexDirection: 'row',
    gap: SPACING.md,
  },
  filterSelect: {
    flex: 1,
    gap: SPACING.xs,
  },
  filterLabel: {
    color: COLORS.textSecondary,
    fontWeight: '600',
  },
  filterSelectInput: {
    flex: 1,
  },
  actionRow: {
    flexDirection: 'row',
    gap: SPACING.md,
    marginTop: SPACING.md,
  },
  refreshButton: {
    flex: 1,
    paddingVertical: SPACING.md,
    backgroundColor: COLORS.surface,
    borderWidth: 1,
    borderColor: COLORS.border,
    borderRadius: 12,
    alignItems: 'center',
  },
  refreshButtonText: {
    color: COLORS.textPrimary,
    fontWeight: '600',
  },
  exportButton: {
    flex: 1,
    paddingVertical: SPACING.md,
    backgroundColor: COLORS.primary,
    borderRadius: 12,
    alignItems: 'center',
    ...SHADOWS.md,
  },
  exportButtonText: {
    color: COLORS.textOnPrimary,
    fontWeight: '700',
  },
  summaryRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'space-between',
    marginBottom: SPACING.lg,
    gap: SPACING.md,
  },
  tableCard: {
    backgroundColor: COLORS.surface,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: COLORS.divider,
    overflow: 'hidden',
  },
  tableHeader: {
    flexDirection: 'row',
    backgroundColor: COLORS.surfaceVariant,
    paddingVertical: SPACING.md,
    paddingHorizontal: SPACING.md,
  },
  tableHeaderCell: {
    flex: 1,
    fontSize: 10,
    fontWeight: '700',
    color: COLORS.textSecondary,
    textTransform: 'uppercase',
  },
  tableRow: {
    flexDirection: 'row',
    backgroundColor: COLORS.surface,
    paddingVertical: SPACING.md,
    paddingHorizontal: SPACING.md,
    borderBottomWidth: 1,
    borderBottomColor: COLORS.divider,
  },
  tableCell: {
    flex: 1,
    fontSize: 11,
    color: COLORS.textPrimary,
    textAlign: 'center',
  },
  tableCellEmployee: {
    flex: 1.5,
  },
  cellEmployeeName: {
    fontWeight: '600',
    color: COLORS.textPrimary,
  },
  cellEmployeeId: {
    fontSize: 11,
    color: COLORS.textTertiary,
  },
  statusBadge: {
    paddingHorizontal: SPACING.md,
    paddingVertical: SPACING.xs,
    borderRadius: 20,
    alignSelf: 'flex-start',
  },
  statusBadgeText: {
    fontSize: 10,
    fontWeight: '700',
  },
  lateCell: {
    alignItems: 'center',
  },
  lateText: {
    color: COLORS.error,
    fontWeight: '600',
    fontSize: 12,
  },
  okText: {
    color: COLORS.textTertiary,
    fontSize: 12,
  },
  reasonCell: {
    flex: 1,
    fontSize: 11,
    color: COLORS.textTertiary,
    maxWidth: 100,
  },
  phaseNotice: {
    backgroundColor: COLORS.info + '15',
    borderWidth: 1,
    borderColor: COLORS.info + '30',
    borderRadius: 12,
    padding: SPACING.md,
    marginTop: SPACING.lg,
  },
  phaseNoticeText: {
    color: COLORS.info,
    textAlign: 'center',
  },
});