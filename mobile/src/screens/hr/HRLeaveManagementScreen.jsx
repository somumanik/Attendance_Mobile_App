// ============================================================================
// FILE: mobile/src/screens/hr/HRLeaveManagementScreen.jsx
// PURPOSE: HR Leave Management - View/approve/reject leave requests
// ============================================================================

/**
 * Ye screen HR ko leave requests manage karne deti hai.
 * 
 * Navigation Flow:
 * HRNavigator (Leave Mgmt Tab) → HRLeaveManagementScreen
 * 
 * Data Flow (Phase 2):
 * Screen Mount → API Service (GET /api/hr/leave) → Backend
 * Approve/Reject → API Service (POST /api/hr/leave/:id/approve|reject) → Backend
 * 
 * Backend APIs (to be implemented):
 * - GET /api/hr/leave - List all leave requests with filters
 * - POST /api/hr/leave/:id/approve - Approve leave
 * - POST /api/hr/leave/:id/reject - Reject leave
 * 
 * Phase 1: Placeholder UI with leave requests list and approve/reject actions
 * Phase 2: Real API integration
 */

import React, { useState, useEffect } from 'react';
import { View, Text, ScrollView, StyleSheet, TouchableOpacity, Alert } from 'react-native';
import { COLORS, TYPOGRAPHY, SPACING, SHADOWS } from '../../utils/colors';
import { formatDate } from '../../utils/format';
import { ScreenContainer } from '../../components/ScreenContainer';
import { PlaceholderCard } from '../../components/PlaceholderCard';

/**
 * HR Leave Management Screen Component
 */
export const HRLeaveManagementScreen = () => {
  const [leaveRequests, setLeaveRequests] = useState([]);
  const [isLoading, setIsLoading] = useState(true);
  const [filters, setFilters] = useState({
    status: '',
    department: '',
    type: '',
  });

  useEffect(() => {
    // Phase 2: Real API call
    // const data = await api.get('/api/hr/leave', { params: filters });
    // setLeaveRequests(data);
    
    // Phase 1: Demo data
    setTimeout(() => {
      setLeaveRequests([
        { id: 'LV001', paycode: 'EMP001', empname: 'Rajesh Kumar', departmentcode: 'IT', type: 'Casual Leave', fromDate: '2026-09-25', toDate: '2026-09-26', days: 2, reason: 'Family function', status: 'Pending', appliedOn: '2026-09-20' },
        { id: 'LV002', paycode: 'EMP003', empname: 'Amit Kumar', departmentcode: 'IT', type: 'Sick Leave', fromDate: '2026-09-24', toDate: '2026-09-25', days: 2, reason: 'Fever', status: 'Pending', appliedOn: '2026-09-22' },
        { id: 'LV003', paycode: 'EMP005', empname: 'Vikram Singh', departmentcode: 'Operations', type: 'Earned Leave', fromDate: '2026-10-01', toDate: '2026-10-05', days: 5, reason: 'Vacation', status: 'Pending', appliedOn: '2026-09-23' },
        { id: 'LV004', paycode: 'EMP002', empname: 'Priya Sharma', departmentcode: 'HR', type: 'Casual Leave', fromDate: '2026-09-15', toDate: '2026-09-16', days: 2, reason: 'Family function', status: 'Approved', appliedOn: '2026-09-10', approvedBy: 'HR001', approvedOn: '2026-09-11' },
        { id: 'LV005', paycode: 'EMP006', empname: 'Anita Desai', departmentcode: 'IT', type: 'Earned Leave', fromDate: '2026-09-10', toDate: '2026-09-14', days: 5, reason: 'Vacation', status: 'Rejected', appliedOn: '2026-09-05', rejectedBy: 'HR001', rejectedOn: '2026-09-06', rejectReason: 'Project deadline' },
      ]);
      setIsLoading(false);
    }, 500);
  }, []);

  const [stats] = useState({
    pending: 3,
    approved: 1,
    rejected: 1,
    total: 5,
  });

  const handleApprove = async (leaveId) => {
    Alert.alert(
      'Approve Leave',
      'Are you sure you want to approve this leave request?',
      [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Approve', onPress: async () => {
          // Phase 2: API call
          // await api.post(`/api/hr/leave/${leaveId}/approve`);
          Alert.alert('Phase 2 Pending', 'Approve action will be implemented in Phase 2');
        }},
      ]
    );
  };

  const handleReject = async (leaveId) => {
    Alert.alert(
      'Reject Leave',
      'Are you sure you want to reject this leave request?',
      [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Reject', onPress: async () => {
          // Phase 2: API call with reason
          // await api.post(`/api/hr/leave/${leaveId}/reject`, { reason: 'Business requirement' });
          Alert.alert('Phase 2 Pending', 'Reject action will be implemented in Phase 2');
        }},
      ]
    );
  };

  const getStatusColor = (status) => {
    switch (status) {
      case 'Pending': return COLORS.warning;
      case 'Approved': return COLORS.success;
      case 'Rejected': return COLORS.error;
      default: return COLORS.textTertiary;
    }
  };

  const getStatusBadgeStyle = (status) => ({
    backgroundColor: getStatusColor(status) + '20',
    borderColor: getStatusColor(status),
  });

  return (
    <ScreenContainer title="Leave Management" showHeader={true}>
      <ScrollView contentContainerStyle={styles.scrollContent}>
        {/* Summary Stats */}
        <View style={styles.summaryCards}>
          <PlaceholderCard title="Total Requests" value={stats.total} color={COLORS.primary} subtitle="📋" />
          <PlaceholderCard title="Pending" value={stats.pending} color={COLORS.warning} subtitle="⏳" />
          <PlaceholderCard title="Approved" value={stats.approved} color={COLORS.success} subtitle="✅" />
          <PlaceholderCard title="Rejected" value={stats.rejected} color={COLORS.error} subtitle="❌" />
        </View>

        {/* Filters */}
        <View style={styles.filterSection}>
          <View style={styles.filterRow}>
            <View style={styles.filterSelect}>
              <Text style={[styles.filterLabel, TYPOGRAPHY.caption]}>Status</Text>
              <Select
                value={filters.status}
                onValueChange={(val) => setFilters(p => ({ ...p, status: val }))}
                items={[
                  { label: 'All Status', value: '' },
                  { label: 'Pending', value: 'Pending' },
                  { label: 'Approved', value: 'Approved' },
                  { label: 'Rejected', value: 'Rejected' },
                ]}
                style={styles.filterSelectInput}
              />
            </View>
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
              <Text style={[styles.filterLabel, TYPOGRAPHY.caption]}>Leave Type</Text>
              <Select
                value={filters.type}
                onValueChange={(val) => setFilters(p => ({ ...p, type: val }))}
                items={[
                  { label: 'All Types', value: '' },
                  { label: 'Casual Leave', value: 'Casual Leave' },
                  { label: 'Sick Leave', value: 'Sick Leave' },
                  { label: 'Earned Leave', value: 'Earned Leave' },
                  { label: 'Unpaid Leave', value: 'Unpaid Leave' },
                ]}
                style={styles.filterSelectInput}
              />
            </View>
          </View>
        </View>

        {/* Leave Requests List */}
        <View style={[styles.listCard, SHADOWS.md]}>
          <View style={styles.listHeader}>
            <Text style={styles.listTitle}>Leave Requests</Text>
            <Text style={styles.listSubtitle}>{leaveRequests.length} requests</Text>
          </View>

          {leaveRequests.map((leave, index) => (
            <View key={leave.id} style={styles.leaveItem}>
              <View style={styles.leaveHeader}>
                <View style={styles.leaveIdSection}>
                  <Text style={styles.leaveId}>{leave.id}</Text>
                  <View style={[styles.statusBadge, getStatusBadgeStyle(leave.status)]}>
                    <Text style={[styles.statusText, { color: getStatusColor(leave.status) }]}>
                      {leave.status}
                    </Text>
                  </View>
                </View>
                <View style={styles.leaveTypeSection}>
                  <Text style={styles.leaveType}>{leave.type}</Text>
                  <Text style={styles.leaveDays}>{leave.days} day(s)</Text>
                </View>
              </View>

              <View style={styles.leaveDetails}>
                <View style={styles.leaveDetailRow}>
                  <Text style={styles.detailLabel}>Employee</Text>
                  <Text style={styles.detailValue}>{leave.empname} ({leave.paycode})</Text>
                </View>
                <View style={styles.leaveDetailRow}>
                  <Text style={styles.detailLabel}>Department</Text>
                  <Text style={styles.detailValue}>{leave.departmentcode}</Text>
                </View>
                <View style={styles.leaveDetailRow}>
                  <Text style={styles.detailLabel}>Dates</Text>
                  <Text style={styles.detailValue}>{formatDate(leave.fromDate)} to {formatDate(leave.toDate)} • {leave.days} day(s)</Text>
                </View>
                <View style={styles.leaveDetailRow}>
                  <Text style={styles.detailLabel}>Reason</Text>
                  <Text style={styles.detailValue}>{leave.reason}</Text>
                </View>
                <View style={styles.leaveDetailRow}>
                  <Text style={styles.detailLabel}>Applied</Text>
                  <Text style={styles.detailValue}>{formatDate(leave.appliedOn)}</Text>
                </View>
                {leave.status !== 'Pending' && (
                  <View style={styles.leaveDetailRow}>
                    <Text style={styles.detailLabel}>{leave.status === 'Approved' ? 'Approved' : 'Rejected'}</Text>
                    <Text style={styles.detailValue}>
                      {leave.status === 'Approved' ? `By ${leave.approvedBy} on ${formatDate(leave.approvedOn)}` : `By ${leave.rejectedBy} on ${formatDate(leave.rejectedOn)}`}
                    </Text>
                  </View>
                )}
                {leave.status === 'Rejected' && leave.rejectReason && (
                  <View style={styles.leaveDetailRow}>
                    <Text style={styles.detailLabel}>Reject Reason</Text>
                    <Text style={{ ...styles.detailValue, color: COLORS.error }}>{leave.rejectReason}</Text>
                  </View>
                )}
              </View>

              {leave.status === 'Pending' && (
                <View style={styles.actionRow}>
                  <TouchableOpacity
                    style={[styles.rejectButton, SHADOWS.sm]}
                    onPress={() => handleReject(leave.id)}
                    activeOpacity={0.9}
                  >
                    <Text style={styles.rejectButtonText}>Reject</Text>
                  </TouchableOpacity>
                  <TouchableOpacity
                    style={[styles.approveButton, SHADOWS.md]}
                    onPress={() => handleApprove(leave.id)}
                    activeOpacity={0.9}
                  >
                    <Text style={styles.approveButtonText}>Approve</Text>
                  </TouchableOpacity>
                </View>
              )}
            </View>
          ))}
        </View>

        {/* Phase 2 Notice */}
        <View style={styles.phaseNotice}>
          <Text style={[styles.phaseNoticeText, TYPOGRAPHY.caption]}>
            ℹ️ Phase 1 - Demo data. Real API: GET/POST /api/hr/leave (to be implemented)
          </Text>
        </View>
      </ScrollView>
    </ScreenContainer>
  );
};

const styles = StyleSheet.create({
  scrollContent: {
    paddingHorizontal: SPACING.lg,
    paddingBottom: SPACING.xxl,
  },
  summaryCards: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'space-between',
    marginBottom: SPACING.lg,
    gap: SPACING.md,
  },
  filterSection: {
    marginBottom: SPACING.lg,
  },
  filterRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: SPACING.md,
  },
  filterSelect: {
    flex: 1,
    minWidth: 140,
    gap: SPACING.xs,
  },
  filterLabel: {
    color: COLORS.textSecondary,
    fontWeight: '600',
  },
  filterSelectInput: {
    flex: 1,
  },
  listCard: {
    backgroundColor: COLORS.surface,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: COLORS.divider,
    overflow: 'hidden',
  },
  listHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: SPACING.lg,
    borderBottomWidth: 1,
    borderBottomColor: COLORS.divider,
  },
  listTitle: {
    fontWeight: '700',
    fontSize: 18,
    color: COLORS.textPrimary,
  },
  listSubtitle: {
    color: COLORS.textSecondary,
  },
  leaveItem: {
    backgroundColor: COLORS.surface,
    borderRadius: 16,
    padding: SPACING.lg,
    marginBottom: SPACING.md,
    borderWidth: 1,
    borderColor: COLORS.divider,
    ...SHADOWS.sm,
  },
  leaveHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: SPACING.lg,
  },
  leaveIdSection: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: SPACING.md,
  },
  leaveId: {
    fontWeight: '700',
    fontSize: 16,
    color: COLORS.textPrimary,
  },
  statusBadge: {
    paddingHorizontal: SPACING.md,
    paddingVertical: SPACING.xs,
    borderRadius: 20,
  },
  statusText: {
    fontSize: 10,
    fontWeight: '700',
  },
  leaveTypeSection: {
    alignItems: 'flex-end',
  },
  leaveType: {
    fontWeight: '600',
    color: COLORS.textPrimary,
  },
  leaveDays: {
    fontSize: 12,
    color: COLORS.textSecondary,
  },
  leaveDetails: {
    gap: SPACING.sm,
    marginBottom: SPACING.lg,
  },
  leaveDetailRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: SPACING.md,
  },
  detailLabel: {
    width: 80,
    color: COLORS.textSecondary,
    fontWeight: '600',
    fontSize: 12,
  },
  detailValue: {
    flex: 1,
    color: COLORS.textPrimary,
    fontSize: 13,
  },
  actionRow: {
    flexDirection: 'row',
    gap: SPACING.md,
    paddingTop: SPACING.md,
    borderTopWidth: 1,
    borderTopColor: COLORS.divider,
  },
  rejectButton: {
    flex: 1,
    paddingVertical: SPACING.md,
    backgroundColor: COLORS.error + '15',
    borderWidth: 1,
    borderColor: COLORS.error,
    borderRadius: 12,
    alignItems: 'center',
  },
  rejectButtonText: {
    color: COLORS.error,
    fontWeight: '700',
  },
  approveButton: {
    flex: 1,
    paddingVertical: SPACING.md,
    backgroundColor: COLORS.success,
    borderRadius: 12,
    alignItems: 'center',
    ...SHADOWS.md,
  },
  approveButtonText: {
    color: COLORS.textOnPrimary,
    fontWeight: '700',
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