// ============================================================================
// FILE: mobile/src/screens/hr/HRCelebrationsScreen.jsx
// PURPOSE: HR Birthdays & Anniversaries - Today's and upcoming celebrations
// ============================================================================

/**
 * Ye screen HR ko birthdays, work anniversaries, aur marriage anniversaries dikhati hai.
 * 
 * Navigation Flow:
 * HRNavigator (Celebrations Tab) → HRCelebrationsScreen
 * 
 * Data Flow (Phase 2):
 * Screen Mount → API Service (GET /api/hr/celebrations) → Backend
 * 
 * Backend API: GET /api/hr/celebrations
 * Response: { employees[], marriages[] }
 * Employee fields: paycode, empname, presentcardno, companycode, departmentcode, designation, dateofbirth, dateofjoin
 * Marriage fields: paycode, presentcardno, anniversarydate, createddate, updateddate, importedby
 * 
 * Phase 1: Placeholder UI with today's and upcoming celebrations
 * Phase 2: Real API integration
 */

import React, { useState, useEffect } from 'react';
import { View, Text, ScrollView, StyleSheet, TouchableOpacity } from 'react-native';
import { COLORS, TYPOGRAPHY, SPACING, SHADOWS } from '../../utils/colors';
import { formatDate } from '../../utils/format';
import { ScreenContainer } from '../../components/ScreenContainer';
import { PlaceholderCard } from '../../components/PlaceholderCard';

/**
 * HR Celebrations Screen Component
 */
export const HRCelebrationsScreen = () => {
  const [celebrations, setCelebrations] = useState(null);
  const [activeTab, setActiveTab] = useState('today');
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    // Phase 2: Real API call
    // const data = await api.get(API_ENDPOINTS.HR_CELEBRATIONS);
    // setCelebrations(data);
    
    // Phase 1: Demo data
    setTimeout(() => {
      setCelebrations({
        employees: [
          { paycode: 'EMP001', empname: 'Rajesh Kumar', departmentcode: 'IT', companycode: 'SAVIOR INFOTECH', dateofbirth: '1990-05-15', dateofjoin: '2022-03-01' },
          { paycode: 'EMP002', empname: 'Priya Sharma', departmentcode: 'HR', companycode: 'SAVIOR INFOTECH', dateofbirth: '1988-09-25', dateofjoin: '2020-01-15' },
          { paycode: 'EMP003', empname: 'Amit Kumar', departmentcode: 'IT', companycode: 'SAVIOR INFOTECH', dateofbirth: '1992-11-03', dateofjoin: '2021-07-10' },
          { paycode: 'EMP004', empname: 'Sunita Reddy', departmentcode: 'Finance', companycode: 'SAVIOR INFOTECH', dateofbirth: '1985-02-14', dateofjoin: '2019-05-20' },
          { paycode: 'EMP005', empname: 'Vikram Singh', departmentcode: 'Operations', companycode: 'SAVIOR INFOTECH', dateofbirth: '1995-08-30', dateofjoin: '2023-02-01' },
        ],
        marriages: [
          { paycode: 'EMP001', anniversarydate: '2018-06-15' },
          { paycode: 'EMP002', anniversarydate: '2015-11-22' },
          { paycode: 'EMP004', anniversarydate: '2010-02-14' },
        ],
      });
      setIsLoading(false);
    }, 500);
  }, []);

  const tabs = [
    { id: 'today', label: 'Today' },
    { id: 'upcoming', label: 'Upcoming (7 days)' },
    { id: 'this_month', label: 'This Month' },
  ];

  // Calculate celebrations based on demo data
  const getTodayCelebrations = () => {
    if (!celebrations) return { birthdays: [], workAnniversaries: [], marriageAnniversaries: [] };
    const today = new Date();
    const todayStr = today.toISOString().split('T')[0];
    const mmdd = todayStr.slice(5); // MM-DD

    const birthdays = celebrations.employees.filter(emp => {
      if (!emp.dateofbirth) return false;
      return emp.dateofbirth.slice(5) === mmdd;
    });

    const workAnniversaries = celebrations.employees.filter(emp => {
      if (!emp.dateofjoin) return false;
      return emp.dateofjoin.slice(5) === mmdd;
    });

    const marriageAnniversaries = celebrations.marriages.filter(m => {
      if (!m.anniversarydate) return false;
      return m.anniversarydate.slice(5) === mmdd;
    }).map(m => {
      const emp = celebrations.employees.find(e => e.paycode === m.paycode);
      return { ...m, empname: emp?.empname, departmentcode: emp?.departmentcode };
    });

    return { birthdays, workAnniversaries, marriageAnniversaries };
  };

  const getUpcomingCelebrations = (days = 7) => {
    if (!celebrations) return { birthdays: [], workAnniversaries: [], marriageAnniversaries: [] };
    const today = new Date();
    const upcomingBirthdays = [];
    const upcomingWorkAnniversaries = [];
    const upcomingMarriageAnniversaries = [];

    celebrations.employees.forEach(emp => {
      if (emp.dateofbirth) {
        const bday = new Date(today.getFullYear(), new Date(emp.dateofbirth).getMonth(), new Date(emp.dateofbirth).getDate());
        if (bday < today) bday.setFullYear(bday.getFullYear() + 1);
        const diffDays = Math.ceil((bday - today) / (1000 * 60 * 60 * 24));
        if (diffDays >= 0 && diffDays <= days) {
          upcomingBirthdays.push({ ...emp, daysUntil: diffDays, date: bday.toISOString().split('T')[0] });
        }
      }
      if (emp.dateofjoin) {
        const anniv = new Date(today.getFullYear(), new Date(emp.dateofjoin).getMonth(), new Date(emp.dateofjoin).getDate());
        if (anniv < today) anniv.setFullYear(anniv.getFullYear() + 1);
        const diffDays = Math.ceil((anniv - today) / (1000 * 60 * 60 * 24));
        if (diffDays >= 0 && diffDays <= days) {
          upcomingWorkAnniversaries.push({ ...emp, daysUntil: diffDays, date: anniv.toISOString().split('T')[0] });
        }
      }
    });

    celebrations.marriages.forEach(m => {
      if (m.anniversarydate) {
        const emp = celebrations.employees.find(e => e.paycode === m.paycode);
        const anniv = new Date(today.getFullYear(), new Date(m.anniversarydate).getMonth(), new Date(m.anniversarydate).getDate());
        if (anniv < today) anniv.setFullYear(anniv.getFullYear() + 1);
        const diffDays = Math.ceil((anniv - today) / (1000 * 60 * 60 * 24));
        if (diffDays >= 0 && diffDays <= days) {
          upcomingMarriageAnniversaries.push({ ...m, empname: emp?.empname, departmentcode: emp?.departmentcode, daysUntil: diffDays, date: anniv.toISOString().split('T')[0] });
        }
      }
    });

    return {
      birthdays: upcomingBirthdays.sort((a, b) => a.daysUntil - b.daysUntil),
      workAnniversaries: upcomingWorkAnniversaries.sort((a, b) => a.daysUntil - b.daysUntil),
      marriageAnniversaries: upcomingMarriageAnniversaries.sort((a, b) => a.daysUntil - b.daysUntil),
    };
  };

  const getThisMonthCelebrations = () => {
    if (!celebrations) return { birthdays: [], workAnniversaries: [], marriageAnniversaries: [] };
    const today = new Date();
    const thisMonth = today.getMonth();
    const thisYear = today.getFullYear();

    const birthdays = celebrations.employees.filter(emp => {
      if (!emp.dateofbirth) return false;
      const bdayMonth = new Date(emp.dateofbirth).getMonth();
      return bdayMonth === thisMonth;
    }).map(emp => {
      const bday = new Date(thisYear, new Date(emp.dateofbirth).getMonth(), new Date(emp.dateofbirth).getDate());
      if (bday < today) bday.setFullYear(thisYear + 1);
      return { ...emp, daysUntil: Math.ceil((bday - today) / (1000 * 60 * 60 * 24)), date: bday.toISOString().split('T')[0] };
    }).sort((a, b) => a.daysUntil - b.daysUntil);

    const workAnniversaries = celebrations.employees.filter(emp => {
      if (!emp.dateofjoin) return false;
      const annivMonth = new Date(emp.dateofjoin).getMonth();
      return annivMonth === thisMonth;
    }).map(emp => {
      const anniv = new Date(thisYear, new Date(emp.dateofjoin).getMonth(), new Date(emp.dateofjoin).getDate());
      if (anniv < today) anniv.setFullYear(thisYear + 1);
      return { ...emp, daysUntil: Math.ceil((anniv - today) / (1000 * 60 * 60 * 24)), date: anniv.toISOString().split('T')[0] };
    }).sort((a, b) => a.daysUntil - b.daysUntil);

    const marriageAnniversaries = celebrations.marriages.filter(m => {
      if (!m.anniversarydate) return false;
      const annivMonth = new Date(m.anniversarydate).getMonth();
      return annivMonth === thisMonth;
    }).map(m => {
      const emp = celebrations.employees.find(e => e.paycode === m.paycode);
      const anniv = new Date(thisYear, new Date(m.anniversarydate).getMonth(), new Date(m.anniversarydate).getDate());
      if (anniv < today) anniv.setFullYear(thisYear + 1);
      return { ...m, empname: emp?.empname, departmentcode: emp?.departmentcode, daysUntil: Math.ceil((new Date(m.anniversarydate.replace(m.anniversarydate.slice(0,4), thisYear.toString())) - today) / (1000 * 60 * 60 * 24)), date: m.anniversarydate };
    }).sort((a, b) => a.daysUntil - b.daysUntil);

    return { birthdays, workAnniversaries, marriageAnniversaries };
  };

  if (!celebrations) {
    return (
      <ScreenContainer title="Celebrations" showHeader={true}>
        <View style={styles.loadingContainer}>
          <Text style={styles.loadingText}>Loading celebrations...</Text>
        </View>
      </ScreenContainer>
    );
  }

  const todayCelebrations = getTodayCelebrations();
  const upcomingCelebrations = getUpcomingCelebrations(7);
  const thisMonthCelebrations = getThisMonthCelebrations();

  const getCelebrationsForTab = () => {
    switch (activeTab) {
      case 'today': return todayCelebrations;
      case 'upcoming': return upcomingCelebrations;
      case 'this_month': return thisMonthCelebrations;
      default: return todayCelebrations;
    }
  };

  const celebrationsData = getCelebrationsForTab();

  const renderCelebrationList = (items, type) => {
    if (!items || items.length === 0) return null;

    const icons = {
      birthdays: '🎂',
      workAnniversaries: '🏆',
      marriageAnniversaries: '💍',
    };

    const colors = {
      birthdays: COLORS.error,
      workAnniversaries: COLORS.warning,
      marriageAnniversaries: COLORS.secondary,
    };

    return (
      <View style={styles.categorySection}>
        <View style={styles.categoryHeader}>
          <Text style={[styles.categoryIcon]}>{icons[type]}</Text>
          <Text style={styles.categoryTitle}>
            {type === 'birthdays' ? 'Birthdays' : type === 'workAnniversaries' ? 'Work Anniversaries' : 'Marriage Anniversaries'}
          </Text>
          <Text style={styles.categoryCount}>{items.length}</Text>
        </View>
        <View style={styles.listContainer}>
          {items.map((item, index) => (
            <View key={`${type}-${index}`} style={styles.celebrationItem}>
              <View style={[styles.celebrationAvatar, { backgroundColor: colors[type] + '15' }]}>
                <Text style={styles.celebrationIcon}>{icons[type]}</Text>
              </View>
              <View style={styles.celebrationInfo}>
                <Text style={styles.celebrationName}>{item.empname}</Text>
                <Text style={styles.celebrationDept}>{item.departmentcode || item.departmentcode || '—'}</Text>
                {item.daysUntil !== undefined && (
                  <Text style={styles.celebrationDays}>
                    {item.daysUntil === 0 ? 'Today!' : `In ${item.daysUntil} day(s)`}
                  </Text>
                )}
              </View>
              <TouchableOpacity style={styles.celebrationAction}>
                <Text style={styles.celebrationActionText}>Wish</Text>
              </TouchableOpacity>
            </View>
          ))}
        </View>
      </View>
    );
  };

  return (
    <ScreenContainer title="Celebrations" showHeader={true}>
      <ScrollView contentContainerStyle={styles.scrollContent}>
        {/* Tab Bar */}
        <View style={styles.tabBar}>
          {[
            { id: 'today', label: 'Today' },
            { id: 'upcoming', label: 'Upcoming' },
            { id: 'this_month', label: 'This Month' },
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

        {/* Summary Cards */}
        <View style={styles.summaryCards}>
          <PlaceholderCard
            title="Birthdays Today"
            value={todayCelebrations.birthdays.length}
            color={COLORS.error}
            subtitle="🎂"
          />
          <PlaceholderCard
            title="Work Anniversaries"
            value={todayCelebrations.workAnniversaries.length}
            color={COLORS.warning}
            subtitle="🏆"
          />
          <PlaceholderCard
            title="Marriage Anniversaries"
            value={todayCelebrations.marriageAnniversaries.length}
            color={COLORS.secondary}
            subtitle="💍"
          />
        </View>

        {/* Celebration Lists */}
        {renderCelebrationList(celebrationsData.birthdays, 'birthdays')}
        {renderCelebrationList(celebrationsData.workAnniversaries, 'workAnniversaries')}
        {renderCelebrationList(celebrationsData.marriageAnniversaries, 'marriageAnniversaries')}

        {celebrationsData.birthdays.length === 0 && 
         celebrationsData.workAnniversaries.length === 0 && 
         celebrationsData.marriageAnniversaries.length === 0 && (
          <View style={styles.emptyState}>
            <Text style={styles.emptyText}>No celebrations {activeTab === 'today' ? 'today' : activeTab === 'upcoming' ? 'this week' : 'this month'}</Text>
          </View>
        )}

        {/* Phase 2 Notice */}
        <View style={styles.phaseNotice}>
          <Text style={[styles.phaseNoticeText, TYPOGRAPHY.caption]}>
            ℹ️ Phase 1 - Demo data. Real API: GET /api/hr/celebrations
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
    fontSize: 13,
  },
  tabButtonTextActive: {
    color: COLORS.textOnPrimary,
  },
  tabButtonTextInactive: {
    color: COLORS.textSecondary,
  },
  summaryCards: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'space-between',
    marginBottom: SPACING.lg,
    gap: SPACING.md,
  },
  categorySection: {
    marginBottom: SPACING.xl,
  },
  categoryHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: SPACING.sm,
    marginBottom: SPACING.md,
    paddingBottom: SPACING.sm,
    borderBottomWidth: 1,
    borderBottomColor: COLORS.divider,
  },
  categoryIcon: {
    fontSize: 20,
  },
  categoryTitle: {
    fontWeight: '700',
    fontSize: 16,
    color: COLORS.textPrimary,
  },
  categoryCount: {
    marginLeft: 'auto',
    backgroundColor: COLORS.primary + '15',
    paddingHorizontal: SPACING.md,
    paddingVertical: SPACING.xs,
    borderRadius: 20,
    color: COLORS.primary,
    fontWeight: '700',
    fontSize: 12,
  },
  listContainer: {
    gap: SPACING.md,
  },
  celebrationItem: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: SPACING.md,
    backgroundColor: COLORS.surface,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: COLORS.divider,
    ...SHADOWS.sm,
  },
  celebrationAvatar: {
    width: 48,
    height: 48,
    borderRadius: 24,
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: SPACING.md,
  },
  celebrationIcon: {
    fontSize: 20,
  },
  celebrationInfo: {
    flex: 1,
    gap: SPACING.xs,
  },
  celebrationName: {
    fontWeight: '600',
    color: COLORS.textPrimary,
  },
  celebrationDept: {
    fontSize: 12,
    color: COLORS.textTertiary,
  },
  celebrationDays: {
    fontSize: 12,
    fontWeight: '600',
    color: COLORS.primary,
  },
  celebrationAction: {
    paddingHorizontal: SPACING.md,
    paddingVertical: SPACING.xs,
    backgroundColor: COLORS.primary + '15',
    borderRadius: 20,
  },
  celebrationActionText: {
    color: COLORS.primary,
    fontWeight: '600',
    fontSize: 12,
  },
  emptyState: {
    alignItems: 'center',
    paddingVertical: SPACING.xl,
  },
  emptyText: {
    color: COLORS.textTertiary,
    fontSize: 14,
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