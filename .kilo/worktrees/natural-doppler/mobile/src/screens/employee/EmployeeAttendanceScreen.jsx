// ============================================================================
// FILE: mobile/src/screens/employee/EmployeeAttendanceScreen.jsx
// PURPOSE: Employee Attendance - Daily/Weekly/Monthly attendance view
// ============================================================================

/**
 * Ye screen Employee ka attendance history dikhata hai.
 * Daily, Weekly, Monthly tabs hain.
 * 
 * Navigation Flow:
 * EmployeeNavigator (Attendance Tab) → EmployeeAttendanceScreen
 * 
 * Data Flow (Phase 2):
 * Tab Change → API Call (GET /api/employee/daily|weekly|monthly) → Backend
 * 
 * Backend APIs:
 * - GET /api/employee/daily?date=YYYY-MM-DD
 * - GET /api/employee/weekly?week=YYYY-WXX
 * - GET /api/employee/monthly?month=YYYY-MM
 * 
 * Phase 1: Placeholder UI with tab structure
 * Phase 2: Real API integration
 */

import React, { useState } from 'react';
import { View, Text, ScrollView, StyleSheet, TouchableOpacity } from 'react-native';
import { COLORS, TYPOGRAPHY, SPACING, SHADOWS } from '../../utils/colors';
import { getStatusColor, formatDate, formatTime, formatHours } from '../../utils/format';
import { ScreenContainer } from '../../components/ScreenContainer';
import { PlaceholderCard } from '../../components/PlaceholderCard';

/**
 * Employee Attendance Screen Component
 */
export const EmployeeAttendanceScreen = () => {
  const [activeTab, setActiveTab] = useState('daily');
  const [selectedDate, setSelectedDate] = useState(new Date().toISOString().split('T')[0]);

  const tabs = [
    { id: 'daily', label: 'Daily' },
    { id: 'weekly', label: 'Weekly' },
    { id: 'monthly', label: 'Monthly' },
  ];

  // Demo data for daily view
  const dailyData = [
    { date: '2026-09-20', day: 'Fri', in1: '09:00 AM', out1: '06:00 PM', in2: '—', out2: '—', hours: 9, status: 'Present', statusCode: 'P' },
    { date: '2026-09-19', day: 'Thu', in1: '09:05 AM', out1: '06:15 PM', in2: '—', out2: '—', hours: 9.1, status: 'Present', statusCode: 'P' },
    { date: '2026-09-18', day: 'Wed', in1: '09:25 AM', out1: '06:00 PM', in2: '—', out2: '—', hours: 8.5, status: 'Late', statusCode: 'LATE' },
    { date: '2026-09-17', day: 'Tue', in1: '08:55 AM', out1: '06:00 PM', in2: '—', out2: '—', hours: 9, status: 'Present', statusCode: 'P' },
    { date: '2026-09-16', day: 'Mon', in1: '09:00 AM', out1: '—', in2: '—', out2: '—', hours: 0, status: 'Miss Punch', statusCode: 'MIS' },
    { date: '2026-09-15', day: 'Sun', in1: '—', out1: '—', in2: '—', out2: '—', hours: 0, status: 'Week Off', statusCode: 'WO' },
    { date: '2026-09-14', day: 'Sat', in1: '—', out1: '—', in2: '—', out2: '—', hours: 0, status: 'Week Off', statusCode: 'WO' },
    { date: '2026-09-13', day: 'Fri', in1: '09:00 AM', out1: '05:30 PM', in2: '—', out2: '—', hours: 8.5, status: 'Present', statusCode: 'P' },
  ];

  // Demo data for weekly view
  const weeklyData = [
    { week: 'Week 38', startDate: '2026-09-16', endDate: '2026-09-22', present: 4, absent: 1, miss: 0, late: 1, hours: 36.6 },
    { week: 'Week 37', startDate: '2026-09-09', endDate: '2026-09-15', present: 5, absent: 0, miss: 0, late: 0, hours: 45 },
    { week: 'Week 36', startDate: '2026-09-02', endDate: '2026-09-08', present: 4, absent: 1, miss: 0, late: 1, hours: 35.5 },
    { week: 'Week 35', startDate: '2026-08-26', endDate: '2026-09-01', present: 5, absent: 0, miss: 1, late: 0, hours: 44.5 },
  ];

  // Demo data for monthly view
  const monthlyData = [
    { month: '2026-09', label: 'September 2026', totalDays: 30, present: 20, absent: 2, miss: 1, late: 3, hours: 156, percentage: 85.7 },
    { month: '2026-08', label: 'August 2026', totalDays: 31, present: 22, absent: 1, miss: 0, late: 2, hours: 172, percentage: 91.3 },
    { month: '2026-07', label: 'July 2026', totalDays: 31, present: 21, absent: 2, miss: 1, late: 1, hours: 164, percentage: 87.5 },
  ];

  const renderTabContent = () => {
    switch (activeTab) {
      case 'daily':
        return (
          <View style={styles.tabContent}>
            <View style={styles.datePickerRow}>
              <Text style={[styles.dateLabel, TYPOGRAPHY.caption]}>Select Date</Text>
              <TouchableOpacity style={styles.datePickerButton}>
                <Text style={[styles.datePickerText, TYPOGRAPHY.body]}>{formatDate(selectedDate)}</Text>
              </TouchableOpacity>
            </View>
            
            <ScrollView style={styles.listContainer}>
              {dailyData.map((item, index) => (
                <View key={index} style={styles.attendanceRow}>
                  <View style={styles.attendanceDate}>
                    <Text style={[styles.attendanceDay, TYPOGRAPHY.caption]}>{item.day}</Text>
                    <Text style={[styles.attendanceDateText, TYPOGRAPHY.bodySmall]}>{formatDate(item.date)}</Text>
                  </View>
                  <View style={styles.attendancePunches}>
                    <View style={styles.punchItem}>
                      <Text style={styles.punchLabel}>In</Text>
                      <Text style={styles.punchTime}>{item.in1}</Text>
                    </View>
                    <View style={styles.punchItem}>
                      <Text style={styles.punchLabel}>Out</Text>
                      <Text style={styles.punchTime}>{item.out1}</Text>
                    </View>
                  </View>
                  <View style={styles.attendanceStatus}>
                    <View style={[styles.statusBadge, { backgroundColor: getStatusColor(item.statusCode) }]}>
                      <Text style={styles.statusBadgeText}>{item.status}</Text>
                    </View>
                    <Text style={styles.hoursText}>{item.hours > 0 ? item.hours + 'h' : '—'}</Text>
                  </View>
                </View>
              ))}
            </ScrollView>
          </View>
        );
      case 'weekly':
        return (
          <ScrollView style={styles.listContainer}>
            {weeklyData.map((week, index) => (
              <View key={index} style={styles.weekCard}>
                <View style={styles.weekHeader}>
                  <Text style={styles.weekLabel}>{week.label}</Text>
                  <Text style={styles.weekDateRange}>{formatDate(week.startDate)} - {formatDate(week.endDate)}</Text>
                </View>
                <View style={styles.weekStats}>
                  <PlaceholderCard title="Present" value={week.present} color={COLORS.success} />
                  <PlaceholderCard title="Absent" value={week.absent} color={COLORS.error} />
                  <PlaceholderCard title="Miss" value={week.miss} color={COLORS.warning} />
                  <PlaceholderCard title="Late" value={week.late} color={COLORS.error} />
                  <PlaceholderCard title="Hours" value={week.hours} color={COLORS.primary} description="hrs" />
                </View>
              </View>
            ))}
          </ScrollView>
        );
      case 'monthly':
        return (
          <ScrollView style={styles.listContainer}>
            {monthlyData.map((month, index) => (
              <View key={index} style={styles.monthCard}>
                <View style={styles.monthHeader}>
                  <Text style={styles.monthLabel}>{month.label}</Text>
                  <View style={styles.monthPercentage}>
                    <Text style={[styles.percentageValue, { color: getStatusColor(month.percentage >= 90 ? 'P' : month.percentage >= 75 ? 'LATE' : 'A') }]}>{month.percentage}%</Text>
                    <Text style={styles.percentageLabel}>Attendance</Text>
                  </View>
                </View>
                <View style={styles.monthStats}>
                  <PlaceholderCard title="Present" value={month.present} color={COLORS.success} />
                  <PlaceholderCard title="Absent" value={month.absent} color={COLORS.error} />
                  <PlaceholderCard title="Miss" value={month.miss} color={COLORS.warning} />
                  <PlaceholderCard title="Late" value={month.late} color={COLORS.error} />
                  <PlaceholderCard title="Hours" value={month.hours} color={COLORS.primary} description="hrs" />
                </View>
              </View>
            ))}
          </ScrollView>
        );
      default:
        return null;
    }
  };

  return (
    <ScreenContainer title="My Attendance" showHeader={true}>
      {/* Tab Bar */}
      <View style={styles.tabBar}>
        {tabs.map((tab) => (
          <TouchableOpacity
            key={tab.id}
            style={[
              styles.tabButton,
              activeTab === tab.id && styles.tabButtonActive,
              SHADOWS.sm,
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
      {renderTabContent()}

      {/* Phase 2 Notice */}
      <View style={styles.phaseNotice}>
        <Text style={[styles.phaseNoticeText, TYPOGRAPHY.caption]}>
          ℹ️ Phase 1 - Demo data. Real API: GET /api/employee/{daily|weekly|monthly}
        </Text>
      </View>
    </ScreenContainer>
  );
};

const styles = StyleSheet.create({
  tabBar: {
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
    fontSize: 14,
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
  datePickerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: SPACING.lg,
    paddingHorizontal: SPACING.md,
  },
  dateLabel: {
    color: COLORS.textSecondary,
  },
  datePickerButton: {
    backgroundColor: COLORS.surface,
    borderWidth: 1,
    borderColor: COLORS.border,
    borderRadius: 12,
    paddingHorizontal: SPACING.md,
    paddingVertical: SPACING.md,
    flex: 1,
  },
  datePickerText: {
    color: COLORS.textPrimary,
    textAlign: 'center',
  },
  listContainer: {
    gap: SPACING.md,
  },
  attendanceRow: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: SPACING.md,
    backgroundColor: COLORS.surface,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: COLORS.divider,
    ...SHADOWS.sm,
  },
  attendanceDate: {
    width: 70,
    alignItems: 'flex-start',
  },
  attendanceDay: {
    fontWeight: '700',
    color: COLORS.textPrimary,
  },
  attendanceDateText: {
    color: COLORS.textTertiary,
    fontSize: 11,
  },
  attendancePunches: {
    flex: 1,
    flexDirection: 'row',
    gap: SPACING.lg,
  },
  punchItem: {
    alignItems: 'flex-start',
  },
  punchLabel: {
    fontSize: 10,
    color: COLORS.textTertiary,
    textTransform: 'uppercase',
  },
  punchTime: {
    fontWeight: '600',
    color: COLORS.textPrimary,
  },
  attendanceStatus: {
    alignItems: 'flex-end',
    minWidth: 80,
  },
  statusBadge: {
    paddingHorizontal: SPACING.md,
    paddingVertical: SPACING.xs,
    borderRadius: 20,
    alignSelf: 'flex-start',
    marginBottom: SPACING.xs,
  },
  statusBadgeText: {
    fontSize: 10,
    fontWeight: '700',
    color: COLORS.textOnPrimary,
  },
  hoursText: {
    fontWeight: '600',
    color: COLORS.primary,
  },
  weekCard: {
    backgroundColor: COLORS.surface,
    borderRadius: 16,
    padding: SPACING.lg,
    marginBottom: SPACING.md,
    borderWidth: 1,
    borderColor: COLORS.divider,
    ...SHADOWS.sm,
  },
  weekHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: SPACING.lg,
  },
  weekLabel: {
    fontWeight: '700',
    fontSize: 16,
    color: COLORS.textPrimary,
  },
  weekDateRange: {
    color: COLORS.textTertiary,
    fontSize: 12,
  },
  weekStats: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: SPACING.md,
  },
  monthCard: {
    backgroundColor: COLORS.surface,
    borderRadius: 16,
    padding: SPACING.lg,
    marginBottom: SPACING.md,
    borderWidth: 1,
    borderColor: COLORS.divider,
    ...SHADOWS.sm,
  },
  monthHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: SPACING.lg,
  },
  monthLabel: {
    fontWeight: '700',
    fontSize: 18,
    color: COLORS.textPrimary,
  },
  monthPercentage: {
    alignItems: 'flex-end',
  },
  percentageValue: {
    fontSize: 24,
    fontWeight: '700',
  },
  percentageLabel: {
    fontSize: 10,
    color: COLORS.textTertiary,
  },
  monthStats: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: SPACING.md,
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