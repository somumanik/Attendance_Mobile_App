// ============================================================================
// FILE: mobile/src/screens/employee/EmployeeReportsScreen.jsx
// PURPOSE: Employee Reports - Download attendance reports, leave statements
// ============================================================================

/**
 * Ye screen Employee ko reports download karne deti hai.
 * 
 * Navigation Flow:
 * EmployeeNavigator (Reports Tab) → EmployeeReportsScreen
 * 
 * Data Flow (Phase 2):
 * Report Type Select → API Service (GET /api/employee/reports/*) → Backend
 * Backend → CSV/PDF Response → File Download/Save
 * 
 * Backend APIs (to be confirmed):
 * - GET /api/employee/reports/attendance-monthly
 * - GET /api/employee/reports/attendance-daily
 * - GET /api/employee/reports/leave
 * - GET /api/employee/reports/misspunch
 * 
 * Phase 1: Placeholder UI with report cards
 * Phase 2: Real API integration with file download
 */

import React from 'react';
import { View, Text, ScrollView, StyleSheet, TouchableOpacity, Alert } from 'react-native';
import { COLORS, TYPOGRAPHY, SPACING, SHADOWS } from '../../utils/colors';
import { ScreenContainer } from '../../components/ScreenContainer';

/**
 * Employee Reports Screen Component
 */
export const EmployeeReportsScreen = () => {
  const handleDownload = async (reportType) => {
    // Phase 2: Real API call yahan hoga
    // const blob = await api.get(`/api/employee/reports/${reportType}`, { responseType: 'blob' });
    // Save file using react-native-fs or expo-file-system
    
    Alert.alert(
      'Phase 2 Pending',
      `${reportType} report download will be implemented in Phase 2.\nAPI: GET /api/employee/reports/${reportType}`
    );
  };

  const reports = [
    {
      id: 'attendance-monthly',
      title: 'Monthly Attendance Report',
      description: 'Complete attendance for current month with daily breakdown',
      icon: '📅',
      color: COLORS.primary,
      badge: 'CSV',
    },
    {
      id: 'attendance-daily',
      title: 'Daily Punching Log',
      description: 'Last 15 days detailed punching records',
      icon: '📋',
      color: COLORS.secondary,
      badge: 'CSV',
    },
    {
      id: 'leave',
      title: 'Leave Statement',
      description: 'All leave requests with status and balance',
      icon: '📄',
      color: COLORS.success,
      badge: 'CSV',
    },
    {
      id: 'misspunch',
      title: 'Miss Punch Report',
      description: 'Current month incomplete punch records',
      icon: '⚠️',
      color: COLORS.warning,
      badge: 'CSV',
    },
    {
      id: 'attendance-summary',
      title: 'Attendance Summary',
      description: 'Yearly attendance overview with charts data',
      icon: '📊',
      color: COLORS.info,
      badge: 'PDF',
    },
    {
      id: 'overtime',
      title: 'Overtime Report',
      description: 'Overtime hours worked this month',
      icon: '⏱️',
      color: COLORS.warning,
      badge: 'CSV',
    },
  ];

  return (
    <ScreenContainer title="My Reports" showHeader={true}>
      <ScrollView contentContainerStyle={styles.scrollContent}>
        <View style={styles.header}>
          <Text style={[styles.headerTitle, TYPOGRAPHY.h3]}>Available Reports</Text>
          <Text style={[styles.headerSubtitle, TYPOGRAPHY.bodySmall]}>Download your attendance and leave reports</Text>
        </View>

        <View style={styles.reportsGrid}>
          {reports.map((report, index) => (
            <TouchableOpacity
              key={report.id}
              style={[styles.reportCard, SHADOWS.md]}
              onPress={() => handleDownload(report.id)}
              activeOpacity={0.9}
            >
              <View style={styles.reportIconContainer}>
                <Text style={styles.reportIcon}>{report.icon}</Text>
              </View>
              <View style={styles.reportContent}>
                <View style={styles.reportHeader}>
                  <Text style={[styles.reportTitle, TYPOGRAPHY.h4]}>{report.title}</Text>
                  <View style={[styles.badge, { backgroundColor: report.color + '20' }]}>
                    <Text style={[styles.badgeText, { color: report.color }]}>{report.badge}</Text>
                  </View>
                </View>
                <Text style={[styles.reportDesc, TYPOGRAPHY.caption]}>{report.description}</Text>
              </View>
              <View style={styles.downloadIndicator}>
                <Text style={styles.downloadText}>Download</Text>
              </View>
            </TouchableOpacity>
          ))}
        </View>

        {/* Phase 2 Notice */}
        <View style={styles.phaseNotice}>
          <Text style={[styles.phaseNoticeText, TYPOGRAPHY.caption]}>
            ℹ️ Phase 1 - Demo UI. Real file download in Phase 2.
            APIs: GET /api/employee/reports/*
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
  header: {
    marginBottom: SPACING.lg,
  },
  headerTitle: {
    color: COLORS.textPrimary,
    marginBottom: SPACING.xs,
  },
  headerSubtitle: {
    color: COLORS.textSecondary,
  },
  reportsGrid: {
    gap: SPACING.md,
  },
  reportCard: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: COLORS.surface,
    borderRadius: 16,
    padding: SPACING.lg,
    borderWidth: 1,
    borderColor: COLORS.divider,
    ...SHADOWS.md,
  },
  reportIconContainer: {
    width: 56,
    height: 56,
    borderRadius: 16,
    backgroundColor: COLORS.primary + '15',
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: SPACING.lg,
  },
  reportIcon: {
    fontSize: 24,
  },
  reportContent: {
    flex: 1,
  },
  reportHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: SPACING.xs,
  },
  reportTitle: {
    color: COLORS.textPrimary,
    flex: 1,
  },
  badge: {
    paddingHorizontal: SPACING.md,
    paddingVertical: SPACING.xs,
    borderRadius: 20,
  },
  badgeText: {
    fontSize: 10,
    fontWeight: '700',
  },
  reportDesc: {
    color: COLORS.textSecondary,
    lineHeight: 18,
  },
  downloadIndicator: {
    paddingLeft: SPACING.md,
  },
  downloadText: {
    color: COLORS.primary,
    fontWeight: '600',
    fontSize: 13,
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