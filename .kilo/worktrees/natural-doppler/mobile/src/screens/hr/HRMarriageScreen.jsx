// ============================================================================
// FILE: mobile/src/screens/hr/HRMarriageScreen.jsx
// PURPOSE: HR Marriage Anniversary - Excel import and management
// ============================================================================

/**
 * Ye screen HR ko marriage anniversary manage karne deti hai.
 * Excel import feature hai for bulk upload.
 * 
 * Navigation Flow:
 * HRNavigator (Marriage Tab) → HRMarriageScreen
 * 
 * Data Flow (Phase 2):
 * Screen Mount → API Service (GET /api/marriage-anniversary) → Backend
 * Excel Import → Validate (POST /api/marriage-anniversary/validate) → Import (POST /api/marriage-anniversary/import)
 * 
 * Backend APIs:
 * - GET /api/marriage-anniversary - List all anniversaries
 * - POST /api/marriage-anniversary/validate - Validate Excel rows
 * - POST /api/marriage-anniversary/import - Import validated data
 * 
 * Excel Format Expected:
 * Columns: Employee Code / Biometric Code, Anniversary Date (YYYY-MM-DD)
 * 
 * Phase 1: Placeholder UI with list and import UI
 * Phase 2: Real API integration with Excel parsing (using xlsx library)
 */

import React, { useState, useEffect } from 'react';
import { View, Text, ScrollView, StyleSheet, TouchableOpacity, Alert } from 'react-native';
import { COLORS, TYPOGRAPHY, SPACING, SHADOWS } from '../../utils/colors';
import { formatDate } from '../../utils/format';
import { ScreenContainer } from '../../components/ScreenContainer';
import { PlaceholderCard } from '../../components/PlaceholderCard';

/**
 * HR Marriage Anniversary Screen Component
 */
export const HRMarriageScreen = () => {
  const [anniversaries, setAnniversaries] = useState([]);
  const [isLoading, setIsLoading] = useState(true);
  const [importModalVisible, setImportModalVisible] = useState(false);
  const [importFile, setImportFile] = useState(null);
  const [validationResults, setValidationResults] = useState(null);
  const [isImporting, setIsImporting] = useState(false);

  useEffect(() => {
    // Phase 2: Real API call
    // const data = await api.get(API_ENDPOINTS.HR_MARRIAGE_ANNIVERSARY);
    // setAnniversaries(data);
    
    // Phase 1: Demo data
    setTimeout(() => {
      setAnniversaries([
        { id: 1, paycode: 'EMP001', presentcardno: '1001', anniversarydate: '2018-06-15', createddate: '2024-01-15', updateddate: '2024-01-15', importedby: 'HR001', empname: 'Rajesh Kumar', departmentcode: 'IT' },
        { id: 2, paycode: 'EMP002', presentcardno: '1002', anniversarydate: '2015-11-22', createddate: '2024-01-15', updateddate: '2024-01-15', importedby: 'HR001', empname: 'Priya Sharma', departmentcode: 'HR' },
        { id: 3, paycode: 'EMP004', presentcardno: '1004', anniversarydate: '2010-02-14', createddate: '2024-01-15', updateddate: '2024-01-15', importedby: 'HR001', empname: 'Sunita Reddy', departmentcode: 'Finance' },
      ]);
      setIsLoading(false);
    }, 500);
  }, []);

  const handleImportPress = () => {
    setImportModalVisible(true);
    setImportFile(null);
    setValidationResults(null);
  };

  const handleFileSelect = () => {
    // Phase 2: Use expo-document-picker or react-native-document-picker
    // For now, simulate file selection
    Alert.alert(
      'Phase 2 Pending',
      'File picker will be implemented in Phase 2 using expo-document-picker\nExpected Excel format:\nEmployee Code / Biometric Code | Anniversary Date (YYYY-MM-DD)'
    );
    setImportFile({ name: 'marriage_anniversaries.xlsx', size: 1024 });
  };

  const handleValidate = async () => {
    if (!importFile) {
      Alert.alert('Error', 'Please select a file first');
      return;
    }

    // Phase 2: POST /api/marriage-anniversary/validate
    // const response = await api.post('/api/marriage-anniversary/validate', { rows: parsedRows });
    // setValidationResults(response.rows);
    
    // Phase 1: Demo validation
    await new Promise(resolve => setTimeout(resolve, 1000));
    setValidationResults([
      { employeeCode: 'EMP005', anniversaryDate: '2019-07-20', employee: { paycode: 'EMP005', empname: 'Vikram Singh', presentcardno: '1005', companycode: 'SAVIOR INFOTECH' }, valid: true },
      { employeeCode: 'EMP006', anniversaryDate: '2017-03-10', employee: { paycode: 'EMP006', empname: 'Anita Desai', presentcardno: '1006', companycode: 'SAVIOR INFOTECH' }, valid: true },
      { employeeCode: 'EMP999', anniversaryDate: '2020-01-01', employee: null, valid: false, error: 'Employee not found' },
    ]);
  };

  const handleImport = async () => {
    if (!validationResults) {
      Alert.alert('Error', 'Please validate file first');
      return;
    }

    const validRows = validationResults.filter(r => r.valid);
    if (validRows.length === 0) {
      Alert.alert('Error', 'No valid rows to import');
      return;
    }

    setIsImporting(true);
    // Phase 2: POST /api/marriage-anniversary/import
    // const response = await api.post('/api/marriage-anniversary/import', { rows: validRows });
    
    // Phase 1: Demo import
    await new Promise(resolve => setTimeout(resolve, 1500));
    setIsImporting(false);
    Alert.alert('Phase 2 Pending', `${validRows.length} anniversaries would be imported in Phase 2`);
    setImportModalVisible(false);
    setImportFile(null);
    setValidationResults(null);
    // Refresh list
    // fetchAnniversaries();
  };

  const handleCloseModal = () => {
    setImportModalVisible(false);
    setImportFile(null);
    setValidationResults(null);
  };

  return (
    <ScreenContainer title="Marriage Anniversaries" showHeader={true}>
      <ScrollView contentContainerStyle={styles.scrollContent}>
        {/* Header Stats */}
        <View style={styles.summaryCards}>
          <PlaceholderCard title="Total Records" value={anniversaries.length} color={COLORS.primary} subtitle="💍" />
          <PlaceholderCard title="This Month" value={anniversaries.filter(a => a.anniversarydate.slice(5,7) === new Date().toISOString().slice(5,7)).length} color={COLORS.error} subtitle="🎉" />
        </View>

        {/* Import Button */}
        <TouchableOpacity style={[styles.importButton, SHADOWS.md]} onPress={handleImportPress}>
          <Text style={styles.importButtonText}>📥 Import from Excel</Text>
        </TouchableOpacity>

        {/* Anniversary List */}
        <View style={[styles.listCard, SHADOWS.md]}>
          <View style={styles.listHeader}>
            <Text style={styles.listTitle}>Marriage Anniversaries</Text>
            <Text style={styles.listSubtitle}>{anniversaries.length} records</Text>
          </View>

          {anniversaries.length === 0 ? (
            <View style={styles.emptyState}>
              <Text style={styles.emptyText}>No marriage anniversaries recorded</Text>
              <Text style={styles.emptySubText}>Import from Excel to add records</Text>
            </View>
          ) : (
            <View style={styles.listContainer}>
              {anniversaries.map((anniv, index) => (
                <View key={anniv.id} style={styles.anniversaryItem}>
                  <View style={styles.annivAvatar}>
                    <Text style={styles.annivIcon}>💍</Text>
                  </View>
                  <View style={styles.annivInfo}>
                    <Text style={styles.annivName}>{anniv.empname || `Employee ${anniv.paycode}`}</Text>
                    <Text style={styles.annivDetails}>{anniv.departmentcode} • {anniv.paycode}</Text>
                    <Text style={styles.annivDate}>Anniversary: {formatDate(anniv.anniversarydate)}</Text>
                  </View>
                  <TouchableOpacity style={styles.annivAction}>
                    <Text style={styles.annivActionText}>Edit</Text>
                  </TouchableOpacity>
                </View>
              ))}
            </View>
          )}
        </View>
        {/* Import Modal */}
        {importModalVisible && (
          <View style={styles.modalOverlay}>
            <View style={styles.modalContainer}>
              <View style={styles.modalHeader}>
                <Text style={styles.modalTitle}>Import from Excel</Text>
                <TouchableOpacity onPress={handleCloseModal} style={styles.modalClose}>
                  <Text style={styles.modalCloseText}>×</Text>
                </TouchableOpacity>
              </View>

              <View style={styles.modalBody}>
                <View style={styles.modalStep}>
                  <Text style={styles.modalStepTitle}>Step 1: Select File</Text>
                  <TouchableOpacity style={styles.fileSelectButton} onPress={handleFileSelect}>
                    <Text style={styles.fileSelectText}>
                      {importFile ? `📄 ${importFile.name}` : '📁 Select Excel File'}
                    </Text>
                  </TouchableOpacity>
                  <Text style={styles.fileFormatInfo}>
                    Expected columns: Employee Code / Biometric Code | Anniversary Date (YYYY-MM-DD)
                  </Text>
                </View>

                {importFile && (
                  <View style={styles.modalStep}>
                    <Text style={styles.modalStepTitle}>Step 2: Validate Data</Text>
                    <TouchableOpacity
                      style={[styles.validateButton, SHADOWS.md]}
                      onPress={handleValidate}
                      disabled={isImporting}
                    >
                      <Text style={styles.validateButtonText}>✅ Validate</Text>
                    </TouchableOpacity>
                  </View>
                )}

                {validationResults && (
                  <View style={styles.modalStep}>
                    <Text style={styles.modalStepTitle}>Step 3: Review & Import</Text>
                    <View style={styles.validationSummary}>
                      <PlaceholderCard title="Valid" value={validationResults.filter(r => r.valid).length} color={COLORS.success} />
                      <PlaceholderCard title="Invalid" value={validationResults.filter(r => !r.valid).length} color={COLORS.error} />
                    </View>

                    <View style={styles.validationList}>
                      {validationResults.map((row, index) => (
                        <View key={index} style={[
                          styles.validationRow,
                          { borderLeftColor: row.valid ? COLORS.success : COLORS.error }
                        ]}>
                          <View style={styles.validationRowInfo}>
                            <Text style={styles.validationEmpCode}>{row.employeeCode}</Text>
                            <Text style={styles.validationDate}>{row.anniversaryDate}</Text>
                          </View>
                          <View style={styles.validationRowStatus}>
                            <View style={[
                              styles.validationStatusBadge,
                              { backgroundColor: row.valid ? COLORS.success + '20' : COLORS.error + '20' }
                            ]}>
                              <Text style={[
                                styles.validationStatusText,
                                { color: row.valid ? COLORS.success : COLORS.error }
                              ]}>
                                {row.valid ? '✓ Valid' : '✗ Invalid'}
                              </Text>
                            </View>
                          </View>
                        </View>
                      ))}
                    </View>

                    {validationResults.some(r => r.valid) && (
                      <TouchableOpacity
                        style={[styles.importButtonModal, SHADOWS.md]}
                        onPress={handleImport}
                        disabled={isImporting}
                      >
                        <Text style={styles.importButtonModalText}>
                          {isImporting ? 'Importing...' : `Import ${validationResults.filter(r => r.valid).length} Records`}
                        </Text>
                      </TouchableOpacity>
                    )}
                  </View>
                )}
              </View>
            </View>
          </View>
        )}

        {/* Phase 2 Notice */}
        <View style={styles.phaseNotice}>
          <Text style={[styles.phaseNoticeText, TYPOGRAPHY.caption]}>
            ℹ️ Phase 1 - Demo UI. Real API: GET/POST /api/marriage-anniversary, Excel parsing with xlsx
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
  importButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: SPACING.sm,
    paddingVertical: SPACING.md,
    backgroundColor: COLORS.secondary,
    borderRadius: 12,
    marginBottom: SPACING.lg,
    ...SHADOWS.md,
  },
  importButtonText: {
    color: COLORS.textOnPrimary,
    fontWeight: '700',
    fontSize: 16,
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
  listContainer: {
    padding: SPACING.md,
  },
  anniversaryItem: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: SPACING.md,
    borderBottomWidth: 1,
    borderBottomColor: COLORS.divider,
  },
  annivAvatar: {
    width: 48,
    height: 48,
    borderRadius: 24,
    backgroundColor: COLORS.secondary + '15',
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: SPACING.md,
  },
  annivIcon: {
    fontSize: 20,
  },
  annivInfo: {
    flex: 1,
    gap: SPACING.xs,
  },
  annivName: {
    fontWeight: '600',
    color: COLORS.textPrimary,
  },
  annivDetails: {
    fontSize: 12,
    color: COLORS.textTertiary,
  },
  annivDate: {
    fontSize: 12,
    color: COLORS.textSecondary,
    fontWeight: '600',
  },
  annivAction: {
    paddingHorizontal: SPACING.md,
    paddingVertical: SPACING.xs,
    backgroundColor: COLORS.primary + '15',
    borderRadius: 20,
  },
  annivActionText: {
    color: COLORS.primary,
    fontWeight: '600',
    fontSize: 12,
  },
  emptyState: {
    alignItems: 'center',
    paddingVertical: SPACING.xl,
    paddingHorizontal: SPACING.lg,
  },
  emptyText: {
    color: COLORS.textSecondary,
    fontSize: 16,
    fontWeight: '600',
  },
  emptySubText: {
    color: COLORS.textTertiary,
    marginTop: SPACING.xs,
  },
  modalOverlay: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: 'rgba(0,0,0,0.5)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: SPACING.lg,
  },
  modalContainer: {
    backgroundColor: COLORS.surface,
    borderRadius: 20,
    width: '100%',
    maxHeight: '90%',
    maxWidth: 500,
    ...SHADOWS.lg,
  },
  modalHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: SPACING.lg,
    borderBottomWidth: 1,
    borderBottomColor: COLORS.divider,
  },
  modalTitle: {
    fontWeight: '700',
    fontSize: 18,
    color: COLORS.textPrimary,
  },
  modalClose: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: COLORS.surfaceVariant,
    justifyContent: 'center',
    alignItems: 'center',
  },
  modalCloseText: {
    fontSize: 24,
    color: COLORS.textSecondary,
  },
  modalBody: {
    padding: SPACING.lg,
    maxHeight: 400,
  },
  modalStep: {
    marginBottom: SPACING.xl,
  },
  modalStepTitle: {
    fontWeight: '600',
    color: COLORS.textPrimary,
    marginBottom: SPACING.md,
  },
  fileSelectButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: SPACING.sm,
    paddingVertical: SPACING.md,
    backgroundColor: COLORS.surface,
    borderWidth: 2,
    borderColor: COLORS.primary,
    borderStyle: 'dashed',
    borderRadius: 12,
  },
  fileSelectText: {
    color: COLORS.primary,
    fontWeight: '600',
  },
  fileFormatInfo: {
    fontSize: 11,
    color: COLORS.textTertiary,
    marginTop: SPACING.sm,
    textAlign: 'center',
  },
  modalStepTitle: {
    fontWeight: '600',
    color: COLORS.textPrimary,
    marginBottom: SPACING.md,
  },
  validateButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: SPACING.sm,
    paddingVertical: SPACING.md,
    backgroundColor: COLORS.info,
    borderRadius: 12,
  },
  validateButtonText: {
    color: COLORS.textOnPrimary,
    fontWeight: '700',
  },
  validationSummary: {
    flexDirection: 'row',
    gap: SPACING.md,
    marginBottom: SPACING.lg,
  },
  validationList: {
    maxHeight: 200,
    gap: SPACING.sm,
  },
  validationRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: SPACING.md,
    backgroundColor: COLORS.surface,
    borderRadius: 8,
    borderLeftWidth: 4,
  },
  validationRowInfo: {
    gap: SPACING.xs,
  },
  validationEmpCode: {
    fontWeight: '600',
    color: COLORS.textPrimary,
  },
  validationDate: {
    fontSize: 12,
    color: COLORS.textTertiary,
  },
  validationRowStatus: {
    alignItems: 'flex-end',
  },
  validationStatusBadge: {
    paddingHorizontal: SPACING.md,
    paddingVertical: SPACING.xs,
    borderRadius: 20,
  },
  validationStatusText: {
    fontSize: 11,
    fontWeight: '700',
  },
  importButtonModal: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: SPACING.sm,
    paddingVertical: SPACING.md,
    backgroundColor: COLORS.success,
    borderRadius: 12,
    marginTop: SPACING.lg,
  },
  importButtonModalText: {
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