import * as XLSX from 'xlsx';
import type {
  ExcelImportPreview,
  ExpiryBatch,
  MasterProduct,
  ParsedExcelRow,
} from '../types/inventory';
import {
  calculateDaysRemaining,
  classifyExpiryStatus,
  formatDisplayDate,
  getExpiredBatches,
  getLocalTodayISO,
  getUpcoming90Batches,
} from './expiryCalculations';
import { normalizeBarcodeText } from './validation';

const REQUIRED_HEADERS = {
  ean: 'EAN Number',
  productCode: 'Product Code',
  description: 'Product Description',
} as const;

function normalizeHeader(header: unknown): string {
  return String(header ?? '')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, ' ');
}

/**
 * Extracts cell value strictly as text so leading zeros and long EAN-13 digits
 * are never converted to scientific notation or stripped.
 */
function extractCellAsText(cell: XLSX.CellObject | undefined): string {
  if (!cell) return '';

  // String cells always retain exact text including leading zeros
  if (cell.t === 's') {
    return String(cell.v ?? cell.w ?? '').trim();
  }

  if (typeof cell.w === 'string' && cell.w.trim() !== '') {
    const trimmedW = cell.w.trim();
    // If Excel formatted a numeric EAN as scientific notation or comma-grouped number, recover full integer string
    if (
      cell.t === 'n' &&
      typeof cell.v === 'number' &&
      Number.isFinite(cell.v) &&
      (/e[+-]?\d+/i.test(trimmedW) || /^-?\d{1,3}(,\d{3})+(\.\d+)?$/.test(trimmedW))
    ) {
      return cell.v.toLocaleString('fullwide', { useGrouping: false });
    }
    return trimmedW;
  }

  if (cell.v === undefined || cell.v === null) return '';
  if (typeof cell.v === 'number' && Number.isFinite(cell.v)) {
    return cell.v.toLocaleString('fullwide', { useGrouping: false });
  }
  return String(cell.v).trim();
}

export function parseMasterExcelBuffer(
  buffer: ArrayBuffer,
  fileName: string
): ExcelImportPreview {
  try {
    const workbook = XLSX.read(buffer, {
      type: 'array',
      raw: false,
      cellText: true,
      cellNF: true,
    });

    const firstSheetName = workbook.SheetNames[0];
    if (!firstSheetName) {
      return {
        fileName,
        totalRows: 0,
        validRows: [],
        invalidRows: [],
        duplicateEanCount: 0,
        missingFieldCount: 0,
        detectedHeaders: [],
        fatalError: 'The Excel file contains no worksheets.',
      };
    }

    const sheet = workbook.Sheets[firstSheetName];
    if (!sheet || !sheet['!ref']) {
      return {
        fileName,
        totalRows: 0,
        validRows: [],
        invalidRows: [],
        duplicateEanCount: 0,
        missingFieldCount: 0,
        detectedHeaders: [],
        fatalError: 'The first worksheet is empty.',
      };
    }

    const range = XLSX.utils.decode_range(sheet['!ref']);
    const headerRowIdx = range.s.r;
    const detectedHeaders: string[] = [];
    let eanCol = -1;
    let codeCol = -1;
    let descCol = -1;

    for (let c = range.s.c; c <= range.e.c; c++) {
      const addr = XLSX.utils.encode_cell({ r: headerRowIdx, c });
      const headerText = extractCellAsText(sheet[addr]);
      if (headerText) {
        detectedHeaders.push(headerText);
      }
      const norm = normalizeHeader(headerText);
      if (norm === 'ean number' || norm === 'ean') {
        eanCol = c;
      } else if (norm === 'product code' || norm === 'article number') {
        codeCol = c;
      } else if (norm === 'product description' || norm === 'description') {
        descCol = c;
      }
    }

    const missingHeaders: string[] = [];
    if (eanCol === -1) missingHeaders.push(REQUIRED_HEADERS.ean);
    if (codeCol === -1) missingHeaders.push(REQUIRED_HEADERS.productCode);
    if (descCol === -1) missingHeaders.push(REQUIRED_HEADERS.description);

    if (missingHeaders.length > 0) {
      return {
        fileName,
        totalRows: 0,
        validRows: [],
        invalidRows: [],
        duplicateEanCount: 0,
        missingFieldCount: 0,
        detectedHeaders,
        fatalError: `Missing required column heading(s): ${missingHeaders.join(', ')}. Expected exact headings: EAN Number, Product Code, Product Description.`,
      };
    }

    const seenEans = new Map<string, number>();
    const allParsed: ParsedExcelRow[] = [];

    for (let r = headerRowIdx + 1; r <= range.e.r; r++) {
      const eanRaw = extractCellAsText(
        sheet[XLSX.utils.encode_cell({ r, c: eanCol })]
      );
      const codeRaw = extractCellAsText(
        sheet[XLSX.utils.encode_cell({ r, c: codeCol })]
      );
      const descRaw = extractCellAsText(
        sheet[XLSX.utils.encode_cell({ r, c: descCol })]
      );

      // Skip completely blank trailing rows
      if (!eanRaw && !codeRaw && !descRaw) {
        continue;
      }

      const ean = normalizeBarcodeText(eanRaw);
      const productCode = codeRaw.trim();
      const description = descRaw.trim();
      const errors: string[] = [];

      if (!ean) errors.push('Missing EAN Number');
      if (!productCode) errors.push('Missing Product Code');
      if (!description) errors.push('Missing Product Description');

      let isDuplicateInFile = false;
      if (ean) {
        if (seenEans.has(ean)) {
          isDuplicateInFile = true;
          errors.push(`Duplicate EAN (first seen on row ${seenEans.get(ean)})`);
        } else {
          seenEans.set(ean, r + 1);
        }
      }

      allParsed.push({
        rowNumber: r + 1,
        ean,
        productCode,
        description,
        errors,
        isDuplicateInFile,
      });
    }

    const validRows = allParsed.filter((row) => row.errors.length === 0);
    const invalidRows = allParsed.filter((row) => row.errors.length > 0);
    const duplicateEanCount = allParsed.filter((r) => r.isDuplicateInFile).length;
    const missingFieldCount = allParsed.filter(
      (r) => !r.ean || !r.productCode || !r.description
    ).length;

    return {
      fileName,
      totalRows: allParsed.length,
      validRows,
      invalidRows,
      duplicateEanCount,
      missingFieldCount,
      detectedHeaders,
    };
  } catch (err) {
    return {
      fileName,
      totalRows: 0,
      validRows: [],
      invalidRows: [],
      duplicateEanCount: 0,
      missingFieldCount: 0,
      detectedHeaders: [],
      fatalError:
        err instanceof Error
          ? `Failed to read Excel file: ${err.message}`
          : 'Failed to read Excel file.',
    };
  }
}

/**
 * Forces text cell type ('s') and number format ('@') on specific columns,
 * and auto-fits column widths based on max string lengths.
 */
function buildStyledWorksheet(
  headers: string[],
  rows: Array<Array<string | number>>,
  textColumnIndexes: number[]
): XLSX.WorkSheet {
  const aoa: Array<Array<string | number>> = [headers, ...rows];
  const sheet = XLSX.utils.aoa_to_sheet(aoa);

  const colWidths = headers.map((h) => h.length + 4);

  for (let r = 0; r < aoa.length; r++) {
    for (let c = 0; c < headers.length; c++) {
      const val = aoa[r][c];
      const strLen = String(val ?? '').length;
      if (strLen + 4 > colWidths[c]) {
        colWidths[c] = Math.min(60, strLen + 4);
      }

      if (r > 0 && textColumnIndexes.includes(c)) {
        const addr = XLSX.utils.encode_cell({ r, c });
        const cell = sheet[addr];
        if (cell) {
          cell.t = 's';
          cell.v = String(val ?? '');
          cell.z = '@';
        }
      }
    }
  }

  sheet['!cols'] = colWidths.map((wch) => ({ wch }));
  return sheet;
}

export function buildMasterDatabaseWorkbook(
  products: MasterProduct[]
): XLSX.WorkBook {
  const headers = ['EAN Number', 'Product Code', 'Product Description'];
  const rows = products.map((p) => [
    String(p.ean),
    String(p.productCode),
    String(p.description),
  ]);
  const sheet = buildStyledWorksheet(headers, rows, [0, 1]);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, sheet, 'Master Products');
  return wb;
}

export function buildCompleteExpiryWorkbook(
  batches: ExpiryBatch[]
): XLSX.WorkBook {
  // Exact column order required by spec:
  // EAN Number | Product Code | Product Description | Expiry Date | Quantity
  const headers = [
    'EAN Number',
    'Product Code',
    'Product Description',
    'Expiry Date',
    'Quantity',
  ];
  const rows = batches.map((b) => [
    String(b.ean || ''),
    String(b.productCode),
    String(b.description),
    formatDisplayDate(b.expiryDate),
    Number(b.quantity),
  ]);
  const sheet = buildStyledWorksheet(headers, rows, [0, 1, 3]);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, sheet, 'Expiry Database');
  return wb;
}

export function buildUpcoming90Workbook(
  batches: ExpiryBatch[],
  referenceISO: string = getLocalTodayISO()
): XLSX.WorkBook {
  const upcoming = getUpcoming90Batches(batches, referenceISO);
  const headers = [
    'EAN Number',
    'Product Code',
    'Product Description',
    'Expiry Date',
    'Quantity',
    'Days Remaining',
    'Status',
  ];
  const rows = upcoming.map((b) => [
    String(b.ean || ''),
    String(b.productCode),
    String(b.description),
    formatDisplayDate(b.expiryDate),
    Number(b.quantity),
    b.daysRemaining,
    classifyExpiryStatus(b.daysRemaining).label,
  ]);
  const sheet = buildStyledWorksheet(headers, rows, [0, 1, 3]);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, sheet, 'Upcoming 90 Days');
  return wb;
}

export function buildExpiredWorkbook(
  batches: ExpiryBatch[],
  referenceISO: string = getLocalTodayISO()
): XLSX.WorkBook {
  const expired = getExpiredBatches(batches, referenceISO);
  const headers = [
    'EAN Number',
    'Product Code',
    'Product Description',
    'Expiry Date',
    'Quantity',
    'Days Expired',
  ];
  const rows = expired.map((b) => {
    const daysRemaining = calculateDaysRemaining(b.expiryDate, referenceISO);
    return [
      String(b.ean || ''),
      String(b.productCode),
      String(b.description),
      formatDisplayDate(b.expiryDate),
      Number(b.quantity),
      Math.abs(daysRemaining),
    ];
  });
  const sheet = buildStyledWorksheet(headers, rows, [0, 1, 3]);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, sheet, 'Expired Products');
  return wb;
}

export function buildSampleTemplateWorkbook(): XLSX.WorkBook {
  const headers = ['EAN Number', 'Product Code', 'Product Description'];
  const rows = [
    ['8901234567890', 'ABC1001', 'Whole Milk 1L Carton'],
    ['0012345678905', 'ABC1002', 'Greek Yogurt Plain 500g'],
    ['8901234567892', 'ABC1003', 'Artisan Sourdough Loaf'],
  ];
  const sheet = buildStyledWorksheet(headers, rows, [0, 1]);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, sheet, 'Master Template');
  return wb;
}

export function triggerWorkbookDownload(
  workbook: XLSX.WorkBook,
  filename: string
): void {
  const out = XLSX.write(workbook, { bookType: 'xlsx', type: 'array' });
  const blob = new Blob([out], {
    type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename.endsWith('.xlsx') ? filename : `${filename}.xlsx`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}
