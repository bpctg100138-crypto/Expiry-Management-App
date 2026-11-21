import test from 'node:test';
import assert from 'node:assert/strict';
import * as XLSX from 'xlsx';
import {
  buildCompleteExpiryWorkbook,
  buildExpiredWorkbook,
  buildMasterDatabaseWorkbook,
  buildUpcoming90Workbook,
  parseMasterExcelBuffer,
} from './excelParser';
import type { ExpiryBatch, MasterProduct } from '../types/inventory';

test('parseMasterExcelBuffer preserves leading zeros, detects duplicates and missing fields', () => {
  const wb = XLSX.utils.book_new();
  const sheet = XLSX.utils.aoa_to_sheet([
    ['EAN Number', 'Product Code', 'Product Description'],
    ['0012345678905', '00421', 'Leading Zero Milk'],
    ['8901234567890', 'ABC1001', 'Product A'],
    ['8901234567890', 'ABC1001-DUP', 'Duplicate EAN Row'],
    ['8901234567892', '', 'Missing Code Row'],
  ]);
  // Force text cell for row 1 col 0
  sheet['A2'].t = 's';
  sheet['A2'].z = '@';
  XLSX.utils.book_append_sheet(wb, sheet, 'Master');

  const arrayBuf = XLSX.write(wb, { type: 'array', bookType: 'xlsx' }) as ArrayBuffer;
  const preview = parseMasterExcelBuffer(arrayBuf, 'master.xlsx');

  assert.equal(preview.fatalError, undefined);
  assert.equal(preview.totalRows, 4);
  assert.equal(preview.validRows.length, 2);
  assert.equal(preview.validRows[0].ean, '0012345678905');
  assert.equal(preview.validRows[0].productCode, '00421');
  assert.equal(preview.duplicateEanCount, 1);
  assert.equal(preview.missingFieldCount, 1);
});

test('parseMasterExcelBuffer recovers scientific notation, comma-grouped numbers, and zero-padded numeric formats as exact text', () => {
  const wb = XLSX.utils.book_new();
  const sheet = XLSX.utils.aoa_to_sheet([
    ['EAN Number', 'Product Code', 'Product Description'],
    [8901234567890, 1001, 'Scientific Format EAN'],
    [8901234567891, 2002, 'Comma Grouped EAN'],
    [12345678905, 421, 'Zero Padded Custom Format'],
  ]);

  sheet['A2'].z = '0.00E+00';
  sheet['A3'].z = '#,##0';
  sheet['A4'].z = '0000000000000';
  sheet['B4'].z = '00000';
  XLSX.utils.book_append_sheet(wb, sheet, 'Master');

  const arrayBuf = XLSX.write(wb, { type: 'array', bookType: 'xlsx' }) as ArrayBuffer;
  const preview = parseMasterExcelBuffer(arrayBuf, 'numeric.xlsx');

  assert.equal(preview.fatalError, undefined);
  assert.equal(preview.validRows.length, 3);
  assert.equal(preview.validRows[0].ean, '8901234567890');
  assert.equal(preview.validRows[0].productCode, '1001');
  assert.equal(preview.validRows[1].ean, '8901234567891');
  assert.equal(preview.validRows[2].ean, '0012345678905');
  assert.equal(preview.validRows[2].productCode, '00421');
});

test('buildCompleteExpiryWorkbook exports exact columns and DD-MM-YYYY text dates', () => {
  const batches: ExpiryBatch[] = [
    {
      id: 1,
      ean: '0012345678905',
      productCode: '00101',
      description: 'Product A',
      expiryDate: '2026-12-15',
      quantity: 8,
      entryType: 'scan',
      createdAt: '',
      updatedAt: '',
    },
    {
      id: 2,
      ean: '0012345678905',
      productCode: '00101',
      description: 'Product A',
      expiryDate: '2027-01-20',
      quantity: 4,
      entryType: 'scan',
      createdAt: '',
      updatedAt: '',
    },
  ];

  const wb = buildCompleteExpiryWorkbook(batches);
  const sheet = wb.Sheets['Expiry Database'];
  const rows = XLSX.utils.sheet_to_json<string[]>(sheet, { header: 1 });

  assert.deepEqual(rows[0], [
    'EAN Number',
    'Product Code',
    'Product Description',
    'Expiry Date',
    'Quantity',
  ]);
  assert.equal(rows[1][0], '0012345678905');
  assert.equal(rows[1][1], '00101');
  assert.equal(rows[1][3], '15-12-2026');
  assert.equal(rows[1][4], 8);
  assert.equal(sheet['A2'].t, 's');
  assert.equal(sheet['B2'].t, 's');
});

test('buildMasterDatabaseWorkbook preserves EAN and Product Code as string', () => {
  const products: MasterProduct[] = [
    {
      id: 1,
      ean: '0009876543210',
      productCode: '0099',
      description: 'Zero Prefixed Product',
      createdAt: '',
      updatedAt: '',
    },
  ];
  const wb = buildMasterDatabaseWorkbook(products);
  const sheet = wb.Sheets['Master Products'];
  assert.equal(sheet['A2'].v, '0009876543210');
  assert.equal(sheet['A2'].t, 's');
  assert.equal(sheet['B2'].v, '0099');
  assert.equal(sheet['B2'].t, 's');
});

test('buildUpcoming90Workbook and buildExpiredWorkbook format columns, dates, text codes, and sorting accurately', () => {
  const refISO = '2026-11-21';
  const batches: ExpiryBatch[] = [
    {
      id: 1,
      ean: '0012345678905',
      productCode: '00101',
      description: 'Expired Bread',
      expiryDate: '2026-11-16', // -5 days
      quantity: 3,
      entryType: 'scan',
      createdAt: '',
      updatedAt: '',
    },
    {
      id: 2,
      ean: '8901234567890',
      productCode: '00202',
      description: 'Milk Soon',
      expiryDate: '2026-12-01', // +10 days
      quantity: 12,
      entryType: 'scan',
      createdAt: '',
      updatedAt: '',
    },
    {
      id: 3,
      ean: '8901234567892',
      productCode: '00303',
      description: 'Safe Oats',
      expiryDate: '2027-06-01', // >90 days
      quantity: 20,
      entryType: 'manual',
      createdAt: '',
      updatedAt: '',
    },
  ];

  const wb90 = buildUpcoming90Workbook(batches, refISO);
  const s90 = wb90.Sheets['Upcoming 90 Days'];
  const r90 = XLSX.utils.sheet_to_json<Array<string | number>>(s90, { header: 1 });
  assert.equal(r90.length, 2);
  assert.deepEqual(r90[0], [
    'EAN Number',
    'Product Code',
    'Product Description',
    'Expiry Date',
    'Quantity',
    'Days Remaining',
    'Status',
  ]);
  assert.equal(r90[1][0], '8901234567890');
  assert.equal(r90[1][1], '00202');
  assert.equal(r90[1][3], '01-12-2026');
  assert.equal(r90[1][5], 10);
  assert.equal(s90['A2'].t, 's');
  assert.equal(s90['B2'].t, 's');

  const wbExp = buildExpiredWorkbook(batches, refISO);
  const sExp = wbExp.Sheets['Expired Products'];
  const rExp = XLSX.utils.sheet_to_json<Array<string | number>>(sExp, { header: 1 });
  assert.equal(rExp.length, 2);
  assert.deepEqual(rExp[0], [
    'EAN Number',
    'Product Code',
    'Product Description',
    'Expiry Date',
    'Quantity',
    'Days Expired',
  ]);
  assert.equal(rExp[1][0], '0012345678905');
  assert.equal(rExp[1][1], '00101');
  assert.equal(rExp[1][3], '16-11-2026');
  assert.equal(rExp[1][5], 5);
  assert.equal(sExp['A2'].t, 's');
  assert.equal(sExp['B2'].t, 's');
});
