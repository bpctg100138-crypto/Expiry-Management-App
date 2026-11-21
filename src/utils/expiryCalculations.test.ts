import test from 'node:test';
import assert from 'node:assert/strict';
import {
  calculateDaysRemaining,
  classifyExpiryStatus,
  computeDashboardMetrics,
  formatDisplayDate,
  getExpiredBatches,
  getUpcoming90Batches,
  parseFlexibleDateToISO,
} from './expiryCalculations';
import { normalizeBarcodeText, validateBatchInput } from './validation';
import type { ExpiryBatch } from '../types/inventory';

test('formatDisplayDate converts ISO YYYY-MM-DD to DD-MM-YYYY', () => {
  assert.equal(formatDisplayDate('2026-12-15'), '15-12-2026');
  assert.equal(formatDisplayDate('2027-01-05'), '05-01-2027');
});

test('parseFlexibleDateToISO handles YYYY-MM-DD and DD-MM-YYYY', () => {
  assert.equal(parseFlexibleDateToISO('15-12-2026'), '2026-12-15');
  assert.equal(parseFlexibleDateToISO('5/1/2027'), '2027-01-05');
  assert.equal(parseFlexibleDateToISO('2027-03-15'), '2027-03-15');
  assert.equal(parseFlexibleDateToISO('2026-02-30'), null);
});

test('calculateDaysRemaining computes exact calendar differences', () => {
  assert.equal(calculateDaysRemaining('2026-11-21', '2026-11-21'), 0);
  assert.equal(calculateDaysRemaining('2026-11-20', '2026-11-21'), -1);
  assert.equal(calculateDaysRemaining('2026-12-21', '2026-11-21'), 30);
  assert.equal(calculateDaysRemaining('2027-02-19', '2026-11-21'), 90);
});

test('classifyExpiryStatus buckets match 0-30, 31-60, 61-90, >90 and expired', () => {
  assert.equal(classifyExpiryStatus(-3).severity, 'expired');
  assert.equal(classifyExpiryStatus(0).severity, 'critical_30');
  assert.equal(classifyExpiryStatus(30).severity, 'critical_30');
  assert.equal(classifyExpiryStatus(31).severity, 'warning_60');
  assert.equal(classifyExpiryStatus(60).severity, 'warning_60');
  assert.equal(classifyExpiryStatus(61).severity, 'upcoming_90');
  assert.equal(classifyExpiryStatus(90).severity, 'upcoming_90');
  assert.equal(classifyExpiryStatus(91).severity, 'safe');
});

test('computeDashboardMetrics and report sorters preserve separate batches', () => {
  const ref = '2026-11-21';
  const batches: ExpiryBatch[] = [
    {
      id: 1,
      ean: '0012345678905',
      productCode: 'ABC1001',
      description: 'Milk 1L',
      expiryDate: '2026-11-10', // -11 days (expired)
      quantity: 5,
      entryType: 'scan',
      createdAt: '',
      updatedAt: '',
    },
    {
      id: 2,
      ean: '0012345678905',
      productCode: 'ABC1001',
      description: 'Milk 1L',
      expiryDate: '2026-12-01', // +10 days (0-30)
      quantity: 8,
      entryType: 'scan',
      createdAt: '',
      updatedAt: '',
    },
    {
      id: 3,
      ean: '0012345678905',
      productCode: 'ABC1001',
      description: 'Milk 1L',
      expiryDate: '2027-01-10', // +50 days (31-60)
      quantity: 4,
      entryType: 'scan',
      createdAt: '',
      updatedAt: '',
    },
    {
      id: 4,
      ean: '8901234567890',
      productCode: 'ABC1002',
      description: 'Yogurt',
      expiryDate: '2027-02-09', // +80 days (61-90)
      quantity: 12,
      entryType: 'manual',
      createdAt: '',
      updatedAt: '',
    },
    {
      id: 5,
      ean: '8901234567891',
      productCode: 'ABC1003',
      description: 'Oats',
      expiryDate: '2027-05-01', // >90 days
      quantity: 20,
      entryType: 'scan',
      createdAt: '',
      updatedAt: '',
    },
  ];

  const metrics = computeDashboardMetrics(batches, 10, ref);
  assert.equal(metrics.totalMasterProducts, 10);
  assert.equal(metrics.totalExpiryBatches, 5);
  assert.equal(metrics.totalStockQuantity, 49);
  assert.equal(metrics.expiredBatches, 1);
  assert.equal(metrics.within30Batches, 1);
  assert.equal(metrics.within60Batches, 2);
  assert.equal(metrics.within90Batches, 3);
  assert.equal(metrics.safeBatches, 1);

  const upcoming = getUpcoming90Batches(batches, ref);
  assert.equal(upcoming.length, 3);
  assert.deepEqual(
    upcoming.map((b) => b.id),
    [2, 3, 4]
  );

  const expired = getExpiredBatches(batches, ref);
  assert.equal(expired.length, 1);
  assert.equal(expired[0].daysExpired, 11);
});

test('normalizeBarcodeText and validateBatchInput preserve leading zeros and reject invalid quantities', () => {
  assert.equal(normalizeBarcodeText(' 0012345678905 '), '0012345678905');

  const badQty = validateBatchInput({
    ean: '0012345678905',
    productCode: 'ABC1001',
    description: 'Milk',
    expiryDate: '2026-12-15',
    quantity: 0,
  });
  assert.equal(badQty.valid, false);
  assert.ok(badQty.errors.quantity);

  const good = validateBatchInput({
    ean: '0012345678905',
    productCode: 'ABC1001',
    description: 'Milk',
    expiryDate: '2026-12-15',
    quantity: 8,
  });
  assert.equal(good.valid, true);
});
