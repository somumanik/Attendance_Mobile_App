// ============================================================================
// FILE: mobile/src/screens/employee/EmployeeLeaveScreen.jsx
// PURPOSE: Employee Leave - Apply for leave, view leave history/balance
// ============================================================================

/**
 * Ye screen Employee ko leave apply karne aur balance dekhne deti hai.
 * 
 * Navigation Flow:
 * EmployeeNavigator (Leave Tab) → EmployeeLeaveScreen
 * 
 * Data Flow (Phase 2):
 * Leave Apply → API Service (POST /api/hr/leave) → Backend
 * Leave History → API Service (GET /api/employee/leave) → Backend
 * Leave Balance → API Service (GET /api/employee/leave/balance) → Backend
 * 
 * Phase 1: Placeholder UI with leave balance cards and apply form
 * Phase 2: Real API integration
 */

import React, { useState } from 'react';
import { View, Text, ScrollView, StyleSheet, TextInput, TouchableOpacity, DatePickerIOS, Platform } from 'react-native';
import { COLORS, TYPOGRAPHY, SPACING, SHADOWS } from '../../utils/colors';
import { formatDate } from '../../utils/format';
import { ScreenContainer } from '../../components/ScreenContainer';
import { PlaceholderCard } from '../../components/PlaceholderCard';

/**
 * Employee Leave Screen Component
 */
export const EmployeeLeaveScreen = () => {
  const [activeTab, setActiveTab] = useState('balance');
  const [leaveForm, setLeaveForm] = useState({
    type: 'Casual Leave',
    fromDate: '',
    toDate: '',
    reason: '',
  });
  const [isSubmitting, setIsSubmitting] = useState(false);

  const leaveTypes = ['Casual Leave', 'Sick Leave', 'Earned Leave', 'Unpaid Leave'];

  // Leave balance demo data
  const leaveBalances = [
    { type: 'Casual Leave', balance: 12, used: 3, total: 15, color: COLORS.success },
    { type: 'Sick Leave', balance: 8, used: 2, total: 10, color: COLORS.info },
    { type: 'Earned Leave', balance: 18, used: 5, total: 23, color: COLORS.primary },
    { type: 'Unpaid Leave', balance: 'Unlimited', used: 0, total: '—', color: COLORS.warning },
  ];

  // Leave history demo data
  const leaveHistory = [
    { id: 'LV001', type: 'Casual Leave', from: '2026-08-15', to: '2026-08-16', days: 2, reason: 'Family function', status: 'Approved', appliedOn: '2026-08-10' },
    { id: 'LV002', type: 'Sick Leave', from: '2026-07-22', to: '2026-07-23', days: 2, reason: 'Fever', status: 'Approved', appliedOn: '2026-07-21' },
    { id: 'LV003', type: 'Earned Leave', from: '2026-06-10', to: '2026-06-14', days: 5, reason: 'Vacation', status: 'Approved', appliedOn: '2026-06-01' },
    { id: 'LV004', type: 'Casual Leave', from: '2026-05-20', to: '2026-05-20', days: 1, reason: 'Personal work', status: 'Pending', appliedOn: '2026-05-18' },
  ];

  const handleApplyLeave = async () => {
    if (!leaveForm.fromDate || !leaveForm.toDate || !leaveForm.reason.trim()) {
      Alert.alert('Error', 'Please fill all fields');
      return;
    }
    
    setIsSubmitting(true);
    // Phase 2: API call yahan hoga
    await new Promise(resolve => setTimeout(resolve, 1000));
    Alert.alert('Phase 2 Pending', 'Leave application will be submitted in Phase 2');
    setIsSubmitting(false);
    setLeaveForm({ ...leaveForm, fromDate: '', toDate: '', reason: '' });
  };

  const getStatusColor = (status) => {
    switch (status) {
      case 'Approved': return COLORS.success;
      case 'Pending': return COLORS.warning;
      case 'Rejected': return COLORS.error;
      default: return COLORS.textTertiary;
    }
  };

  const renderBalanceTab = () => (
    <ScrollView style={styles.tabContent}>
      <View style={styles.sectionHeader}>
        <Text style={[styles.sectionTitle, TYPOGRAPHY.h3]}>Leave Balance</Text>
        <Text style={[styles.sectionSubtitle, TYPOGRAPHY.caption]}>Current Year Entitlement</Text>
      </View>
      
      <View style={styles.balanceGrid}>
        {leaveBalances.map((leave, index) => (
          <View key={index} style={styles.balanceCard}>
            <View style={styles.balanceHeader}>
              <Text style={styles.balanceType}>{leave.type}</Text>
              <View style={[styles.balanceCircle, { backgroundColor: leave.color + '20' }]}>
                <Text style={[styles.balanceNumber, { color: leave.color }]}>
                  {leave.balance === 'Unlimited' ? '∞' : leave.balance}
                </Text>
              </View>
            </View>
            <View style={styles.balanceDetails}>
              <Text style={[styles.balanceLabel, TYPOGRAPHY.caption]}>Available / Total</Text>
              <Text style={styles.balanceValue}>
                {leave.balance === 'Unlimited' ? 'Unlimited' : `${leave.balance} / ${leave.total}`}
              </Text>
              <Text style={[styles.balanceUsed, TYPOGRAPHY.caption]}>Used: {leave.used} days</Text>
            </View>
          </View>
        ))}
      </View>
    </ScrollView>
  );

  const renderApplyTab = () => (
    <ScrollView style={styles.tabContent}>
      <View style={styles.sectionHeader}>
        <Text style={[styles.sectionTitle, TYPOGRAPHY.h3]}>Apply for Leave</Text>
        <Text style={[styles.sectionSubtitle, TYPOGRAPHY.caption]}>Submit leave request for HR approval</Text>
      </View>

      <View style={styles.formContainer}>
        <View style={styles.inputGroup}>
          <Text style={[styles.label, TYPOGRAPHY.caption]}>Leave Type</Text>
          <View style={styles.selectContainer}>
            <Text style={styles.selectText}>{leaveForm.type}</Text>
            <Text style={styles.selectArrow}>▼</Text>
          </View>
        </View>

        <View style={styles.dateRow}>
          <View style={styles.inputGroup}>
            <Text style={[styles.label, TYPOGRAPHY.caption]}>From Date</Text>
            <TouchableOpacity style={styles.dateButton} onPress={() => {}}>
              <Text style={[styles.dateButtonText, TYPOGRAPHY.body]}>{leaveForm.fromDate || 'Select Date'}</Text>
            </TouchableOpacity>
          </View>
          <View style={styles.inputGroup}>
            <Text style={[styles.label, TYPOGRAPHY.caption]}>To Date</Text>
            <TouchableOpacity style={styles.dateButton} onPress={() => {}}>
              <Text style={[styles.dateButtonText, TYPOGRAPHY.body]}>{leaveForm.toDate || 'Select Date'}</Text>
            </TouchableOpacity>
          </View>
        </View>

        <View style={styles.inputGroup}>
          <Text style={[styles.label, TYPOGRAPHY.caption]}>Reason</Text>
          <TextInput
            style={[styles.textArea, TYPOGRAPHY.body]}
            value={leaveForm.reason}
            onChangeText={(text) => setLeaveForm({ ...leaveForm, reason: text })}
            placeholder="Enter reason for leave..."
            multiline
            numberOfLines={4}
          />
        </View>

        <TouchableOpacity
          style={[styles.submitButton, isSubmitting && styles.submitButtonDisabled, SHADOWS.md]}
          onPress={handleApplyLeave}
          disabled={isSubmitting}
          activeOpacity={0.9}
        >
          <Text style={[styles.submitButtonText, TYPOGRAPHY.button]}>
            {isSubmitting ? 'Submitting...' : 'Submit Leave Request'}
          </Text>
        </TouchableOpacity>
      </View>
    </ScrollView>
  );

  const renderHistoryTab = () => (
    <ScrollView style={styles.tabContent}>
      <View style={styles.sectionHeader}>
        <Text style={[styles.sectionTitle, TYPOGRAPHY.h3]}>Leave History</Text>
        <Text style={[styles.sectionSubtitle, TYPOGRAPHY.caption]}>Your leave applications</Text>
      </View>

      <View style={styles.historyList}>
        {leaveHistory.map((leave, index) => (
          <View key={index} style={styles.historyItem}>
            <View style={styles.historyHeader}>
              <Text style={[styles.historyId, TYPOGRAPHY.caption]}>{leave.id}</Text>
              <View style={[styles.statusBadge, { backgroundColor: getStatusColor(leave.status) + '20' }]}>
                <Text style={[styles.statusText, { color: getStatusColor(leave.status) }]}>{leave.status}</Text>
              </View>
            </View>
            <View style={styles.historyDetails}>
              <Text style={[styles.historyType, TYPOGRAPHY.bodySmall]}>{leave.type}</Text>
              <Text style={[styles.historyDates, TYPOGRAPHY.caption]}>
                {formatDate(leave.from)} to {formatDate(leave.to)} • {leave.days} day(s)
              </Text>
              <Text style={[styles.historyReason, TYPOGRAPHY.caption]}>{leave.reason}</Text>
              <Text style={[styles.historyApplied, TYPOGRAPHY.caption]}>Applied: {formatDate(leave.appliedOn)}</Text>
            </View>
          </View>
        ))}
      </View>
    </ScrollView>
  );

  return (
    <ScreenContainer title="Leave Management" showHeader={true}>
      {/* Tab Selector */}
      <View style={styles.tabSelector}>
        {[
          { id: 'balance', label: 'Balance' },
          { id: 'apply', label: 'Apply' },
          { id: 'history', label: 'History' },
        ].map((tab) => (
          <TouchableOpacity
            key={tab.id}
            style={[
              styles.tabButton,
              activeTab === tab.id && styles.tabButtonActive,
            ]}
            onPress={() => setActiveTab(tab.id)}
            activeOpacity={0.8}
          >
            <Text style={[
              styles.tabButtonText,
              activeTab === tab.id ? styles.tabButtonTextActive : styles.tabButtonTextInactive,
            ]}>
              {tab.label}
            </Text>
          </TouchableOpacity>
        ))}
      </View>

      {/* Tab Content */}
      {activeTab === 'balance' && renderBalanceTab()}
      {activeTab === 'apply' && renderApplyTab()}
      {activeTab === 'history' && renderHistoryTab()}

      {/* Phase 2 Notice */}
      <View style={styles.phaseNotice}>
        <Text style={[styles.phaseNoticeText, TYPOGRAPHY.caption]}>
          ℹ️ Phase 1 - Demo data. Real API: POST /api/hr/leave (apply), GET /api/employee/leave (history)
        </Text>
      </View>
    </ScreenContainer>
  );
};

// Import Alert at top of component
import { Alert } from 'react-native';

const styles = StyleSheet.create({
  tabSelector: {
    flexDirection: 'row',
    backgroundColor: COLORS.surface,
    borderRadius: 12,
    padding: 4,
    marginBottom: SPACING.lg,
    ...SHADOWS.sm,
  },
  tabButton: {
    flex: 1,
    paddingVertical: SPACING.md,
    borderRadius: 8,
    alignItems: 'center',
  },
  tabButtonActive: {
    backgroundColor: COLORS.primary,
  },
  tabButtonText: {
    fontWeight: '600',
    fontSize: 13,
  },
  tabButtonTextActive: {
    color: COLORS.textOnPrimary,
  },
  tabButtonTextInactive: {
    color: COLORS.textSecondary,
  },
  tabContent: {
    flex: 1,
  },
  sectionHeader: {
    marginBottom: SPACING.lg,
  },
  sectionTitle: {
    color: COLORS.textPrimary,
  },
  sectionSubtitle: {
    color: COLORS.textSecondary,
    marginTop: SPACING.xs,
  },
  balanceGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'space-between',
    gap: SPACING.md,
  },
  balanceCard: {
    flex: 1,
    minWidth: 160,
    backgroundColor: COLORS.surface,
    borderRadius: 16,
    padding: SPACING.lg,
    borderWidth: 1,
    borderColor: COLORS.divider,
    ...SHADOWS.sm,
  },
  balanceHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: SPACING.md,
  },
  balanceType: {
    fontWeight: '600',
    color: COLORS.textPrimary,
  },
  balanceCircle: {
    width: 48,
    height: 48,
    borderRadius: 24,
    justifyContent: 'center',
    alignItems: 'center',
  },
  balanceNumber: {
    fontSize: 18,
    fontWeight: '700',
  },
  balanceDetails: {
    gap: SPACING.xs,
  },
  balanceLabel: {
    color: COLORS.textTertiary,
  },
  balanceValue: {
    fontWeight: '700',
    fontSize: 16,
    color: COLORS.textPrimary,
  },
  balanceUsed: {
    color: COLORS.textTertiary,
  },
  formContainer: {
    gap: SPACING.lg,
  },
  inputGroup: {
    flex: 1,
    gap: SPACING.xs,
  },
  label: {
    color: COLORS.textSecondary,
    fontWeight: '600',
  },
  selectContainer: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    backgroundColor: COLORS.surface,
    borderWidth: 1,
    borderColor: COLORS.border,
    borderRadius: 12,
    paddingHorizontal: SPACING.md,
    paddingVertical: SPACING.md,
  },
  selectText: {
    color: COLORS.textPrimary,
    flex: 1,
  },
  selectArrow: {
    color: COLORS.textTertiary,
  },
  dateRow: {
    flexDirection: 'row',
    gap: SPACING.md,
  },
  dateButton: {
    flex: 1,
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
  textArea: {
    backgroundColor: COLORS.surface,
    borderWidth: 1,
    borderColor: COLORS.border,
    borderRadius: 12,
    padding: SPACING.md,
    color: COLORS.textPrimary,
    textAlignVertical: 'top',
    minHeight: 100,
  },
  submitButton: {
    backgroundColor: COLORS.primary,
    borderRadius: 12,
    paddingVertical: SPACING.md,
    alignItems: 'center',
    marginTop: SPACING.md,
    ...SHADOWS.md,
  },
  submitButtonDisabled: {
    opacity: 0.6,
  },
  submitButtonText: {
    color: COLORS.textOnPrimary,
    fontWeight: '700',
  },
  historyList: {
    gap: SPACING.md,
  },
  historyItem: {
    backgroundColor: COLORS.surface,
    borderRadius: 12,
    padding: SPACING.md,
    borderWidth: 1,
    borderColor: COLORS.divider,
    ...SHADOWS.sm,
  },
  historyHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: SPACING.md,
  },
  historyId: {
    fontWeight: '600',
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
  historyDetails: {
    gap: SPACING.xs,
  },
  historyType: {
    fontWeight: '600',
    color: COLORS.textPrimary,
  },
  historyDates: {
    color: COLORS.textSecondary,
  },
  historyReason: {
    color: COLORS.textTertiary,
  },
  historyApplied: {
    color: COLORS.textTertiary,
    fontSize: 10,
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