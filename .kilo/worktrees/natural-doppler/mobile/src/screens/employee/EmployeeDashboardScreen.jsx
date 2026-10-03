// ============================================================================
// FILE: mobile/src/screens/employee/EmployeeDashboardScreen.jsx
// PURPOSE: Employee Dashboard - shows personal attendance summary
// ============================================================================

/**
 * Ye screen Employee ka dashboard hai - unki attendance summary dikhata hai.
 * 
 * Navigation Flow:
 * EmployeeNavigator (Dashboard Tab) → EmployeeDashboardScreen
 * 
 * Data Flow (Phase 2):
 * Screen Mount → API Service (GET /api/employee/dashboard) → Backend
 * Backend → JSON Response → Screen State → UI Render
 * 
 * Backend API: GET /api/employee/dashboard (Employee role required)
 * Response: { present, absent, miss, late, hours, attendancePercentage, records }
 * 
 * Phase 1: Placeholder UI with static demo data
 * Phase 2: Real API integration
 */

import React, { useState, useEffect } from 'react';
import { View, Text, ScrollView, StyleSheet, RefreshControl, TouchableOpacity } from 'react-native';
import { useTheme } from '../../theme';
import { ScreenContainer } from '../../components';
import { StatCard, PlaceholderCard, Button, Card, AttendanceBadge } from '../../components';
import { formatDate } from '../../utils/format';

/**
 * Employee Dashboard Screen Component
 */
export const EmployeeDashboardScreen = () => {
  const { theme } = useTheme();
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [stats, setStats] = useState({
    present: 18,
    absent: 2,
    miss: 1,
    late: 3,
    hours: 156,
    attendancePercentage: 85.7,
  });

  const recentAttendance = [
    { date: '2026-09-20', day: 'Fri', status: 'Present', inTime: '09:00 AM', outTime: '06:00 PM', hours: 9 },
    { date: '2026-09-19', day: 'Thu', status: 'Present', inTime: '09:05 AM', outTime: '06:15 PM', hours: 9.1 },
    { date: '2026-09-18', day: 'Wed', status: 'Late', inTime: '09:25 AM', outTime: '06:00 PM', hours: 8.5 },
    { date: '2026-09-17', day: 'Tue', status: 'Present', inTime: '08:55 AM', outTime: '06:00 PM', hours: 9 },
    { date: '2026-09-16', day: 'Mon', status: 'Miss Punch', inTime: '09:00 AM', outTime: '—', hours: 0 },
  ];

  const handleRefresh = async () => {
    setIsRefreshing(true);
    // Phase 2: Real API call yahan hoga
    // const data = await api.get(API_ENDPOINTS.EMPLOYEE_DASHBOARD);
    // setStats(data);
    await new Promise(resolve => setTimeout(resolve, 1000));
    setIsRefreshing(false);
  };

  const handleViewAll = () => {
    // Navigate to attendance screen
    // navigation.navigate('Attendance');
  };

  return (
    <View style={{ flex: 1, backgroundColor: theme.background }}>
      <ScrollView
        refreshControl={
          <RefreshControl
            refreshing={isRefreshing}
            onRefresh={handleRefresh}
            colors={[theme.primary]}
            progressViewOffset={60}
          />
        }
        contentContainerStyle={styles.scrollContent}
        showsVerticalScrollIndicator={false}
      >
        {/* Greeting Header */}
        <View style={styles.greetingHeader}>
          <View style={styles.greetingContent}>
            <Text style={[styles.greetingTitle, { color: theme.textPrimary }]}>Good Morning</Text>
            <Text style={[styles.greetingName, { color: theme.textPrimary }]}>Rajesh Kumar</Text>
          </View>
          <View style={[styles.todayStatusCard, { backgroundColor: theme.primary }]}>
            <Text style={[styles.todayStatusLabel, { color: 'rgba(255,255,255,0.9)' }]}>Today's Status</Text>
            <Text style={[styles.todayStatusValue, { color: theme.textOnPrimary }]}>Present</Text>
            <Text style={[styles.todayStatusTime, { color: 'rgba(255,255,255,0.8)' }]}>In: 09:00 AM</Text>
          </View>
        </View>

        {/* Stats Grid */}
        <View style={styles.statsGrid}>
          <StatCard
            title="Present Days"
            value={18}
            subtitle={`${85.7}%`}
            icon="✅"
            color={theme.success}
          />
          <StatCard
            title="Absent Days"
            value={2}
            subtitle="This Month"
            icon="❌"
            color={theme.error}
          />
          <StatCard
            title="Miss Punch"
            value={1}
            subtitle="Pending Review"
            icon="⚠️"
            color={theme.warning}
          />
          <StatCard
            title="Late Arrivals"
            value={3}
            subtitle="After 9:15 AM"
            icon="⏰"
            color={theme.error}
          />
        </View>

        {/* Work Hours Card */}
        <Card style={styles.sectionCard} elevation="raised">
          <View style={styles.sectionHeader}>
            <Text style={[styles.sectionTitle, { color: theme.textPrimary }]}>Work Hours</Text>
            <Text style={[styles.sectionSubtitle, { color: theme.textSecondary }]}>This Month</Text>
          </View>
          <View style={styles.hoursDisplay}>
            <Text style={[styles.hoursValue, { color: theme.primary, fontSize: 48, fontWeight: '700' }]}>156h</Text>
            <Text style={[styles.hoursLabel, { color: theme.textSecondary }]}>Total Worked Hours</Text>
          </View>
        </Card>

        {/* Attendance Overview Card */}
        <Card style={styles.sectionCard} elevation="raised">
          <View style={styles.sectionHeader}>
            <Text style={[styles.sectionTitle, { color: theme.textPrimary }]}>Attendance Overview</Text>
            <Text style={[styles.sectionSubtitle, { color: theme.textSecondary }]}>Current Month Summary</Text>
          </View>
          
          <View style={styles.overviewGrid}>
            <PlaceholderCard
              title="Present"
              value={18}
              color={theme.success}
              description="Days Present"
            />
            <PlaceholderCard
              title="Absent"
              value={2}
              color={theme.error}
              description="Days Absent"
            />
            <PlaceholderCard
              title="Miss Punch"
              value={1}
              color={theme.warning}
              description="Incomplete Records"
            />
            <PlaceholderCard
              title="Late"
              value={3}
              color={theme.error}
              description="Late Arrivals"
            />
          </View>
        </Card>

        {/* Recent Attendance Preview */}
        <Card style={styles.sectionCard} elevation="raised">
          <View style={styles.sectionHeader}>
            <Text style={[styles.sectionTitle, { color: theme.textPrimary }]}>Recent Attendance</Text>
            <Text style={[styles.sectionSubtitle, { color: theme.textSecondary }]}>Last 5 Days</Text>
          </View>
          
          <View style={styles.recentList}>
            {[
              { date: '2026-09-20', day: 'Fri', status: 'Present', inTime: '09:00 AM', outTime: '06:00 PM', hours: 9 },
              { date: '2026-09-19', day: 'Thu', status: 'Present', inTime: '09:05 AM', outTime: '06:15 PM', hours: 9.1 },
              { date: '2026-09-18', day: 'Wed', status: 'Late', inTime: '09:25 AM', outTime: '06:00 PM', hours: 8.5 },
              { date: '2026-09-17', day: 'Tue', status: 'Present', inTime: '08:55 AM', outTime: '06:00 PM', hours: 9 },
              { date: '2026-09-16', day: 'Mon', status: 'Miss Punch', inTime: '09:00 AM', outTime: '—', hours: 0 },
            ].map((item, index) => (
              <View key={index} style={styles.recentItem}>
                <View style={styles.recentDate}>
                  <Text style={[styles.recentDay, { color: theme.textPrimary }]}>{item.day}</Text>
                  <Text style={[styles.recentDateText, { color: theme.textTertiary }]}>{item.date}</Text>
                </View>
                <View style={styles.recentDetails}>
                  <View style={styles.recentStatus}>
                    <AttendanceBadge status={item.status.toLowerCase().replace(' ', '')} size="small" />
                    <Text style={[styles.recentStatusText, { color: theme.textPrimary, fontSize: 12 }]}>{item.status}</Text>
                  </View>
                  <View style={styles.recentTimes}>
                    <Text style={[styles.recentTimeLabel, { color: theme.textSecondary, fontSize: 11 }]}>In: {item.inTime}</Text>
                    <Text style={[styles.recentTimeLabel, { color: theme.textSecondary, fontSize: 11 }]}>Out: {item.outTime}</Text>
                  </View>
                </View>
                <View style={styles.recentHours}>
                  <Text style={[styles.recentHoursText, { color: theme.primary, fontWeight: '600' }]}>{item.hours}h</Text>
                </View>
              </View>
            ))}
          </View>
          
          <TouchableOpacity style={styles.viewAllButton} onPress={handleViewAll}>
            <Text style={[styles.viewAllText, { color: theme.primary, fontWeight: '600' }]}>View Full Attendance →</Text>
          </TouchableOpacity>
        </Card>

        {/* Phase 2 Notice */}
        <View style={[styles.phaseNotice, { backgroundColor: `${theme.info}15`, borderColor: `${theme.info}30` }]}>
          <Text style={[styles.phaseNoticeText, { color: theme.info }]}>
            ℹ️ Phase 1 - Demo data shown. Real API integration in Phase 2.
            API: GET /api/employee/dashboard
          </Text>
        </View>
      </ScrollView>
    </View>
  );
};

const styles = StyleSheet.create({
  scrollContent: {
    paddingHorizontal: 16,
    paddingBottom: 32,
  },
  greetingHeader: {
    marginBottom: 16,
  },
  greetingContent: {
    flex: 1,
  },
  greetingTitle: {
    fontSize: 20,
    fontWeight: '700',
  },
  greetingName: {
    fontSize: 28,
    fontWeight: '700',
    marginTop: 4,
  },
  todayStatusCard: {
    width: 160,
    borderRadius: 16,
    padding: 16,
    alignItems: 'center',
    justifyContent: 'center',
  },
  todayStatusLabel: {
    fontSize: 11,
    fontWeight: '600',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    marginBottom: 4,
  },
  todayStatusValue: {
    fontSize: 16,
    fontWeight: '700',
  },
  todayStatusTime: {
    fontSize: 11,
    marginTop: 4,
  },
  statsGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'space-between',
    marginBottom: 16,
    gap: 12,
  },
  sectionCard: {
    borderRadius: 16,
    padding: 16,
    marginBottom: 16,
  },
  sectionHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-end',
    marginBottom: 16,
  },
  sectionTitle: {
    fontSize: 18,
    fontWeight: '700',
  },
  sectionSubtitle: {
    fontSize: 12,
  },
  hoursDisplay: {
    alignItems: 'center',
    paddingVertical: 8,
  },
  hoursValue: {
    fontSize: 48,
    fontWeight: '700',
  },
  hoursLabel: {
    marginTop: 4,
  },
  overviewGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'space-between',
    gap: 12,
  },
  recentList: {
    gap: 12,
    marginBottom: 12,
  },
  recentItem: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 12,
    paddingHorizontal: 16,
    borderRadius: 12,
    borderWidth: StyleSheet.hairlineWidth,
  },
  recentDate: {
    width: 70,
    alignItems: 'center',
  },
  recentDay: {
    fontWeight: '700',
  },
  recentDateText: {
    fontSize: 11,
  },
  recentDetails: {
    flex: 1,
    gap: 4,
  },
  recentStatus: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  recentStatusText: {
    fontWeight: '600',
    fontSize: 12,
  },
  recentTimes: {
    flexDirection: 'row',
    gap: 16,
  },
  recentTimeLabel: {
    fontSize: 11,
  },
  recentHours: {
    alignItems: 'flex-end',
    minWidth: 60,
  },
  recentHoursText: {
    fontWeight: '600',
  },
  viewAllButton: {
    paddingVertical: 12,
    alignItems: 'center',
    borderTopWidth: StyleSheet.hairlineWidth,
    marginTop: 8,
  },
  viewAllText: {
    fontSize: 13,
  },
  phaseNotice: {
    padding: 12,
    borderRadius: 12,
    borderWidth: 1,
  },
  phaseNoticeText: {
    fontSize: 12,
    textAlign: 'center',
  },
});