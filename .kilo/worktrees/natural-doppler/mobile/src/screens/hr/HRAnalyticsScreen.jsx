// ============================================================================
// FILE: mobile/src/screens/hr/HRAnalyticsScreen.jsx
// PURPOSE: HR Category Analytics - Company/Department-wise attendance analytics
// ============================================================================

/**
 * Ye screen HR ko category-wise analytics dikhati hai.
 * Company-wise aur Department-wise attendance breakdown.
 * 
 * Navigation Flow:
 * HRNavigator (Analytics Tab) → HRAnalyticsScreen
 * 
 * Data Flow (Phase 2):
 * Screen Mount → API Service (GET /api/hr/category-analytics) → Backend
 * Range Change → API Call with query params
 * 
 * Backend API: GET /api/hr/category-analytics
 * Query params: mode (daily|weekly|monthly), fromDate, toDate, active
 * Response: { punched, complete, miss, absent, late, companies[], departments[] }
 * 
 * Phase 1: Placeholder UI with demo data and chart placeholders
 * Phase 2: Real API integration with charts
 */

import React, { useState, useEffect } from 'react';
import { View, Text, ScrollView, StyleSheet, TouchableOpacity } from 'react-native';
import { COLORS, TYPOGRAPHY, SPACING, SHADOWS } from '../../utils/colors';
import { formatDate } from '../../utils/format';
import { ScreenContainer } from '../../components/ScreenContainer';
import { PlaceholderCard } from '../../components/PlaceholderCard';

/**
 * HR Category Analytics Screen Component
 */
export const HRAnalyticsScreen = () => {
  const [activeRange, setActiveRange] = useState('monthly');
  const [activeView, setActiveView] = useState('company'); // 'company' | 'department'
  const [analyticsData, setAnalyticsData] = useState(null);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    // Phase 2: Real API call
    // const data = await api.get(API_ENDPOINTS.HR_CATEGORY_ANALYTICS, { params: { mode: activeRange } });
    // setAnalyticsData(data);
    
    // Phase 1: Demo data
    setTimeout(() => {
      setAnalyticsData({
        mode: 'monthly',
        fromDate: '2026-09-01',
        toDate: '2026-09-30',
        punched: 228,
        complete: 220,
        miss: 8,
        absent: 17,
        late: 12,
        companies: [
          { companycode: 'SAVIOR INFOTECH', complete: 200, miss: 8, absent: 15, late: 10, punched: 208 },
          { companycode: 'SAVIOR TECH', complete: 20, miss: 0, absent: 2, late: 2, punched: 20 },
        ],
        departments: [
          { departmentcode: 'IT', complete: 65, miss: 3, absent: 5, late: 4, punched: 68 },
          { departmentcode: 'HR', complete: 15, miss: 0, absent: 0, late: 0, punched: 15 },
          { departmentcode: 'Finance', complete: 30, miss: 1, absent: 3, late: 2, punched: 31 },
          { departmentcode: 'Operations', complete: 45, miss: 2, absent: 4, late: 3, punched: 47 },
          { departmentcode: 'Sales', complete: 40, miss: 2, absent: 3, late: 3, punched: 42 },
          { departmentcode: 'Admin', complete: 10, miss: 0, absent: 1, late: 0, punched: 10 },
        ],
      });
      setIsLoading(false);
    }, 500);
  }, [activeRange]);

  const ranges = [
    { id: 'daily', label: 'Daily' },
    { id: 'weekly', label: 'Weekly' },
    { id: 'monthly', label: 'Monthly' },
  ];

  const views = [
    { id: 'company', label: 'By Company' },
    { id: 'department', label: 'By Department' },
  ];

  if (isLoading) {
    return (
      <ScreenContainer title="Category Analytics" showHeader={true}>
        <View style={styles.loadingContainer}>
          <Text style={styles.loadingText}>Loading analytics...</Text>
        </View>
      </ScreenContainer>
    );
  }

  const { companies, departments, punched, complete, miss, absent, late } = analyticsData;

  return (
    <ScreenContainer title="Category Analytics" showHeader={true}>
      <ScrollView contentContainerStyle={styles.scrollContent}>
        {/* Range Selector */}
        <View style={styles.rangeSelector}>
          <Text style={[styles.rangeLabel, TYPOGRAPHY.caption]}>Time Range</Text>
          <View style={styles.rangeButtons}>
            {ranges.map((range) => (
              <TouchableOpacity
                key={range.id}
                style={[
                  styles.rangeButton,
                  activeRange === range.id && styles.rangeButtonActive,
                ]}
                onPress={() => setActiveRange(range.id)}
                activeOpacity={0.8}
              >
                <Text style={[
                  styles.rangeButtonText,
                  activeRange === range.id ? styles.rangeButtonTextActive : styles.rangeButtonTextInactive,
                ]}>
                  {range.label}
                </Text>
              </TouchableOpacity>
            ))}
          </View>
        </View>

        {/* View Selector */}
        <View style={styles.viewSelector}>
          <Text style={[styles.rangeLabel, TYPOGRAPHY.caption]}>View By</Text>
          <View style={styles.viewButtons}>
            {views.map((view) => (
              <TouchableOpacity
                key={view.id}
                style={[
                  styles.viewButton,
                  activeView === view.id && styles.viewButtonActive,
                ]}
                onPress={() => setActiveView(view.id)}
                activeOpacity={0.8}
              >
                <Text style={[
                  styles.viewButtonText,
                  activeView === view.id ? styles.viewButtonTextActive : styles.viewButtonTextInactive,
                ]}>
                  {view.label}
                </Text>
              </TouchableOpacity>
            ))}
          </View>
        </View>

        {/* Summary Stats */}
        <View style={styles.summaryStats}>
          <PlaceholderCard title="Punched" value={punched} color={COLORS.primary} />
          <PlaceholderCard title="Complete" value={complete} color={COLORS.success} />
          <PlaceholderCard title="Miss Punch" value={miss} color={COLORS.warning} />
          <PlaceholderCard title="Absent" value={absent} color={COLORS.error} />
          <PlaceholderCard title="Late" value={late} color={COLORS.warning} />
        </View>

        {/* Chart Placeholder */}
        <View style={[styles.chartCard, SHADOWS.md]}>
          <View style={styles.chartHeader}>
            <Text style={styles.chartTitle}>Attendance Distribution</Text>
            <Text style={styles.chartSubtitle}>{activeView === 'company' ? 'Company-wise' : 'Department-wise'}</Text>
          </View>
          <View style={styles.chartPlaceholder}>
            <Text style={styles.chartPlaceholderText}>📊 Stacked Bar Chart</Text>
            <Text style={styles.chartPlaceholderSub}>Present / Miss Punch / Absent / Late</Text>
            <Text style={styles.chartPlaceholderSub}>Phase 2: Chart.js integration</Text>
          </View>
        </View>

        {/* Data Table */}
        <View style={[styles.sectionCard, SHADOWS.md]}>
          <View style={styles.sectionHeader}>
            <Text style={styles.sectionTitle}>Detailed Breakdown</Text>
            <Text style={styles.sectionSubtitle}>{activeView === 'company' ? 'Company-wise' : 'Department-wise'} attendance</Text>
          </View>

          <View style={styles.tableContainer}>
            <View style={styles.tableHeader}>
              <Text style={styles.tableCellHeader}>Code</Text>
              <Text style={styles.tableCellHeader}>Present</Text>
              <Text style={styles.tableCellHeader}>Miss Punch</Text>
              <Text style={styles.tableCellHeader}>Absent</Text>
              <Text style={styles.tableCellHeader}>Late</Text>
              <Text style={styles.tableCellHeader}>Punched</Text>
            </View>

            {(activeView === 'company' ? companies : departments).map((item, index) => (
              <View key={index} style={styles.tableRow}>
                <Text style={styles.tableCellCode}>{item.companycode || item.departmentcode}</Text>
                <Text style={styles.tableCellStat}>{item.complete}</Text>
                <Text style={styles.tableCellStat}>{item.miss}</Text>
                <Text style={styles.tableCellStat}>{item.absent}</Text>
                <Text style={styles.tableCellStat}>{item.late}</Text>
                <Text style={styles.tableCellStat}>{item.punched}</Text>
              </View>
            ))}
          </View>
        </View>

        {/* Phase 2 Notice */}
        <View style={styles.phaseNotice}>
          <Text style={[styles.phaseNoticeText, TYPOGRAPHY.caption]}>
            ℹ️ Phase 1 - Demo data. Real API: GET /api/hr/category-analytics with mode={activeRange}
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
  loadingContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  rangeSelector: {
    marginBottom: SPACING.lg,
  },
  rangeLabel: {
    color: COLORS.textSecondary,
    marginBottom: SPACING.sm,
  },
  rangeButtons: {
    flexDirection: 'row',
    gap: SPACING.sm,
  },
  rangeButton: {
    paddingHorizontal: SPACING.lg,
    paddingVertical: SPACING.md,
    backgroundColor: COLORS.surface,
    borderWidth: 1,
    borderColor: COLORS.border,
    borderRadius: 8,
  },
  rangeButtonActive: {
    backgroundColor: COLORS.primary,
    borderColor: COLORS.primary,
  },
  rangeButtonText: {
    fontWeight: '600',
  },
  rangeButtonTextActive: {
    color: COLORS.textOnPrimary,
  },
  rangeButtonTextInactive: {
    color: COLORS.textSecondary,
  },
  viewSelector: {
    marginBottom: SPACING.lg,
  },
  viewButtons: {
    flexDirection: 'row',
    backgroundColor: COLORS.surface,
    borderRadius: 12,
    padding: 4,
    ...SHADOWS.sm,
  },
  viewButton: {
    flex: 1,
    paddingVertical: SPACING.md,
    borderRadius: 8,
    alignItems: 'center',
  },
  viewButtonActive: {
    backgroundColor: COLORS.primary,
  },
  viewButtonText: {
    fontWeight: '600',
  },
  viewButtonTextActive: {
    color: COLORS.textOnPrimary,
  },
  viewButtonTextInactive: {
    color: COLORS.textSecondary,
  },
  summaryStats: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'space-between',
    marginBottom: SPACING.lg,
    gap: SPACING.md,
  },
  chartCard: {
    backgroundColor: COLORS.surface,
    borderRadius: 16,
    padding: SPACING.lg,
    marginBottom: SPACING.lg,
    borderWidth: 1,
    borderColor: COLORS.divider,
  },
  chartHeader: {
    marginBottom: SPACING.lg,
  },
  chartTitle: {
    fontWeight: '600',
    color: COLORS.textPrimary,
    marginBottom: SPACING.xs,
  },
  chartSubtitle: {
    fontSize: 12,
    color: COLORS.textTertiary,
  },
  chartPlaceholder: {
    aspectRatio: 1.5,
    backgroundColor: COLORS.surfaceVariant,
    borderRadius: 12,
    justifyContent: 'center',
    alignItems: 'center',
    padding: SPACING.lg,
  },
  chartPlaceholderText: {
    fontSize: 24,
    marginBottom: SPACING.xs,
    textAlign: 'center',
  },
  chartPlaceholderSub: {
    fontSize: 12,
    color: COLORS.textTertiary,
    textAlign: 'center',
    marginBottom: SPACING.xs,
  },
  sectionCard: {
    backgroundColor: COLORS.surface,
    borderRadius: 16,
    padding: SPACING.lg,
    marginBottom: SPACING.lg,
    borderWidth: 1,
    borderColor: COLORS.divider,
    ...SHADOWS.sm,
  },
  sectionHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-end',
    marginBottom: SPACING.lg,
  },
  sectionTitle: {
    fontWeight: '600',
    color: COLORS.textPrimary,
  },
  sectionSubtitle: {
    fontSize: 12,
    color: COLORS.textTertiary,
  },
  tableContainer: {
    borderRadius: 12,
    overflow: 'hidden',
    borderWidth: 1,
    borderColor: COLORS.divider,
  },
  tableHeader: {
    flexDirection: 'row',
    backgroundColor: COLORS.surfaceVariant,
    paddingVertical: SPACING.md,
    paddingHorizontal: SPACING.md,
  },
  tableRow: {
    flexDirection: 'row',
    backgroundColor: COLORS.surface,
    paddingVertical: SPACING.md,
    paddingHorizontal: SPACING.md,
    borderBottomWidth: 1,
    borderBottomColor: COLORS.divider,
  },
  tableCellHeader: {
    flex: 1,
    fontSize: 11,
    fontWeight: '700',
    color: COLORS.textSecondary,
    textTransform: 'uppercase',
  },
  tableCellCode: {
    flex: 1.5,
    fontWeight: '600',
    color: COLORS.textPrimary,
  },
  tableCellStat: {
    flex: 1,
    fontSize: 12,
    textAlign: 'center',
    color: COLORS.textPrimary,
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