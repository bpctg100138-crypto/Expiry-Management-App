import test from 'node:test';
import assert from 'node:assert/strict';
import {
  AsyncLookupGuard,
  resolveEanCorrectionChange,
} from './eanLookupState';
import type { MasterProduct } from '../types/inventory';

test('AsyncLookupGuard rejects stale async lookup completions when newer lookups start', () => {
  const guard = new AsyncLookupGuard();
  const firstReq = guard.next();
  assert.equal(guard.isLatest(firstReq), true);

  const secondReq = guard.next();
  assert.equal(guard.isLatest(firstReq), false);
  assert.equal(guard.isLatest(secondReq), true);

  guard.invalidate();
  assert.equal(guard.isLatest(secondReq), false);
});

test('resolveEanCorrectionChange never retains old productCode or description when edited EAN does not match', () => {
  const milkMaster: MasterProduct = {
    id: 42,
    ean: '8901234567890',
    productCode: 'ABC1001',
    description: 'Fresh Farm Whole Milk 1L',
    createdAt: '2026-11-01T00:00:00.000Z',
    updatedAt: '2026-11-01T00:00:00.000Z',
  };

  // Step 1: User edits unmatched EAN into a valid matching EAN -> populates fields
  const matched = resolveEanCorrectionChange('8901234567890', milkMaster);
  assert.equal(matched.scanState, 'matched');
  assert.equal(matched.matchedMaster?.id, 42);
  assert.equal(matched.productCode, 'ABC1001');
  assert.equal(matched.description, 'Fresh Farm Whole Milk 1L');

  // Step 2: User edits EAN again to a non-matching EAN -> must clear productCode and description
  const unmatchedAfterEdit = resolveEanCorrectionChange('8901234567899', undefined);
  assert.equal(unmatchedAfterEdit.scanState, 'not_found');
  assert.equal(unmatchedAfterEdit.matchedMaster, null);
  assert.equal(unmatchedAfterEdit.productCode, '');
  assert.equal(unmatchedAfterEdit.description, '');
  assert.equal(unmatchedAfterEdit.editableEan, '8901234567899');

  // Step 3: Even if a stale matched object were passed with empty EAN, cleared EAN never matches
  const cleared = resolveEanCorrectionChange('   ', milkMaster);
  assert.equal(cleared.scanState, 'not_found');
  assert.equal(cleared.matchedMaster, null);
  assert.equal(cleared.productCode, '');
  assert.equal(cleared.description, '');
});
