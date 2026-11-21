export type NavRoute =
  | 'dashboard'
  | 'scan'
  | 'manual'
  | 'records'
  | 'upcoming'
  | 'expired'
  | 'master'
  | 'excel'
  | 'backup'
  | 'settings';

export interface MasterProduct {
  id?: number;
  ean: string;
  productCode: string;
  description: string;
  createdAt: string;
  updatedAt: string;
}

export interface ExpiryBatch {
  id?: number;
  masterProductId?: number;
  ean: string;
  productCode: string;
  description: string;
  expiryDate: string; // Stored as YYYY-MM-DD
  quantity: number;
  originalScannedBarcode?: string;
  correctedEan?: string;
  entryType: 'scan' | 'manual';
  createdAt: string;
  updatedAt: string;
}

export interface AppSetting {
  id?: number;
  settingKey: string;
  settingValue: string;
}

export interface AppPreferences {
  storeName: string;
  scannerBeep: boolean;
  scannerVibrate: boolean;
  scanCooldownMs: number;
}

export type ExpirySeverity =
  | 'expired'
  | 'critical_30'
  | 'warning_60'
  | 'upcoming_90'
  | 'safe';

export interface ExpiryStatusInfo {
  severity: ExpirySeverity;
  label: string;
  daysRemaining: number;
  badgeTextClass: string;
  badgeBgClass: string;
  badgeBorderClass: string;
  dotColorClass: string;
}

export interface DashboardMetrics {
  totalMasterProducts: number;
  totalExpiryBatches: number;
  totalStockQuantity: number;
  expiredBatches: number;
  expiredQuantity: number;
  within30Batches: number;
  within30Quantity: number;
  within60Batches: number;
  within60Quantity: number;
  within90Batches: number;
  within90Quantity: number;
  safeBatches: number;
  safeQuantity: number;
}

export interface ParsedExcelRow {
  rowNumber: number;
  ean: string;
  productCode: string;
  description: string;
  errors: string[];
  isDuplicateInFile: boolean;
}

export interface ExcelImportPreview {
  fileName: string;
  totalRows: number;
  validRows: ParsedExcelRow[];
  invalidRows: ParsedExcelRow[];
  duplicateEanCount: number;
  missingFieldCount: number;
  detectedHeaders: string[];
  fatalError?: string;
}

export interface FullBackupPayload {
  appName: 'Retail Expiry Manager';
  schemaVersion: number;
  exportedAt: string;
  masterProducts: MasterProduct[];
  expiryBatches: ExpiryBatch[];
  settings: AppSetting[];
}
