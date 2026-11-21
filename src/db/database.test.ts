import test from 'node:test';
import assert from 'node:assert/strict';
import { IDBKeyRange, indexedDB } from 'fake-indexeddb';
import {
  addExpiryBatch,
  bulkImportMasterProducts,
  deleteMasterProductSafely,
  exportFullBackupPayload,
  findMasterProductByEan,
  restoreFullBackupPayload,
  RetailExpiryDatabase,
  updateMasterProductSafely,
  upsertMasterProduct,
} from './database';
import { validateBackupPayload } from '../utils/validation';

let dbCounter = 0;

function createTestDb(): RetailExpiryDatabase {
  dbCounter += 1;
  return new RetailExpiryDatabase(`RetailExpiryTestDB_${Date.now()}_${dbCounter}`, {
    indexedDB,
    IDBKeyRange,
  });
}

test('exact EAN lookup preserves leading zeros and multi-batch add preserves separate batches', async () => {
  const testDb = createTestDb();
  try {
    const { id: masterId } = await upsertMasterProduct(
      {
        ean: '0012345678905',
        productCode: '00421',
        description: 'Organic Greek Yogurt 500g',
      },
      testDb
    );

    const exact = await findMasterProductByEan(' 0012345678905 ', testDb);
    const withoutZeros = await findMasterProductByEan('12345678905', testDb);
    assert.ok(exact);
    assert.equal(exact.id, masterId);
    assert.equal(exact.ean, '0012345678905');
    assert.equal(withoutZeros, undefined);

    await addExpiryBatch(
      {
        ean: '0012345678905',
        productCode: '00421',
        description: 'Organic Greek Yogurt 500g',
        expiryDate: '2026-12-10',
        quantity: 6,
        entryType: 'scan',
      },
      testDb
    );

    await addExpiryBatch(
      {
        ean: '0012345678905',
        productCode: '00421',
        description: 'Organic Greek Yogurt 500g',
        expiryDate: '2027-01-15',
        quantity: 12,
        entryType: 'scan',
      },
      testDb
    );

    const batches = await testDb.expiryBatches.toArray();
    assert.equal(batches.length, 2);
    assert.equal(batches[0].masterProductId, masterId);
    assert.equal(batches[1].masterProductId, masterId);
    assert.equal(batches[0].quantity, 6);
    assert.equal(batches[1].quantity, 12);
  } finally {
    testDb.close();
  }
});

test('bulkImportMasterProducts replace_master_only preserves expiry batches and reconnects masterProductId', async () => {
  const testDb = createTestDb();
  try {
    const firstMaster = await upsertMasterProduct(
      {
        ean: '8901234567890',
        productCode: 'OLD1001',
        description: 'Milk Old Name',
      },
      testDb
    );

    // Add a linked batch and a previously unlinked batch (whose EAN arrives in new import)
    await addExpiryBatch(
      {
        masterProductId: firstMaster.id,
        ean: '8901234567890',
        productCode: 'OLD1001',
        description: 'Milk Old Name',
        expiryDate: '2026-12-25',
        quantity: 9,
        entryType: 'scan',
      },
      testDb
    );
    await addExpiryBatch(
      {
        ean: '0099887766554',
        productCode: 'TMP99',
        description: 'Unlinked Cheese',
        expiryDate: '2027-02-14',
        quantity: 4,
        entryType: 'manual',
      },
      testDb
    );

    const importRes = await bulkImportMasterProducts(
      [
        {
          ean: '5555555555555',
          productCode: 'NEW55',
          description: 'Filler Item 1',
        },
        {
          ean: '8901234567890',
          productCode: 'ABC1001',
          description: 'Milk Updated Name',
        },
        {
          ean: '0099887766554',
          productCode: 'CHZ99',
          description: 'Master Cheese',
        },
      ],
      'replace_master_only',
      testDb
    );

    assert.equal(importRes.inserted, 3);
    assert.equal(importRes.reconnectedBatches, 2);

    const newMilkMaster = await findMasterProductByEan('8901234567890', testDb);
    const newCheeseMaster = await findMasterProductByEan('0099887766554', testDb);
    assert.ok(newMilkMaster?.id && newMilkMaster.id !== firstMaster.id);
    assert.ok(newCheeseMaster?.id);

    const batches = await testDb.expiryBatches.orderBy('id').toArray();
    assert.equal(batches.length, 2);
    assert.equal(batches[0].masterProductId, newMilkMaster.id);
    assert.equal(batches[0].expiryDate, '2026-12-25');
    assert.equal(batches[0].quantity, 9);
    assert.equal(batches[1].masterProductId, newCheeseMaster.id);
    assert.equal(batches[1].quantity, 4);
  } finally {
    testDb.close();
  }
});

test('updateMasterProductSafely and deleteMasterProductSafely maintain masterProductId links without deleting batches', async () => {
  const testDb = createTestDb();
  try {
    const { id } = await upsertMasterProduct(
      {
        ean: '4006381333931',
        productCode: 'BEV2014',
        description: 'Orange Juice',
      },
      testDb
    );

    const batchId = await addExpiryBatch(
      {
        masterProductId: id,
        ean: '4006381333931',
        productCode: 'BEV2014',
        description: 'Orange Juice',
        expiryDate: '2027-01-10',
        quantity: 15,
        entryType: 'scan',
      },
      testDb
    );

    // Changing Master EAN unlinks the old EAN batch safely without deleting it
    await updateMasterProductSafely(
      id,
      {
        ean: '4006381999999',
        productCode: 'BEV2014',
        description: 'Orange Juice Updated',
      },
      testDb
    );
    let batch = await testDb.expiryBatches.get(batchId);
    assert.ok(batch);
    assert.equal(batch.masterProductId, undefined);

    // Changing back reconnects masterProductId automatically
    await updateMasterProductSafely(
      id,
      {
        ean: '4006381333931',
        productCode: 'BEV2014',
        description: 'Orange Juice',
      },
      testDb
    );
    batch = await testDb.expiryBatches.get(batchId);
    assert.equal(batch?.masterProductId, id);

    // Deleting master unlinks batch without removing expiry batch
    await deleteMasterProductSafely(id, testDb);
    batch = await testDb.expiryBatches.get(batchId);
    assert.ok(batch);
    assert.equal(batch.masterProductId, undefined);
    assert.equal(batch.quantity, 15);
  } finally {
    testDb.close();
  }
});

test('restoreFullBackupPayload reconnects masterProductId links and prevents duplicates on repeated merge restores', async () => {
  const sourceDb = createTestDb();
  const targetDb = createTestDb();
  try {
    // Seed a dummy first product in targetDb so auto-increment IDs differ from sourceDb
    await upsertMasterProduct(
      {
        ean: '9999999999999',
        productCode: 'DUMMY',
        description: 'Existing Target Product',
      },
      targetDb
    );

    await upsertMasterProduct(
      {
        ean: '0012345678905',
        productCode: 'ABC1002',
        description: 'Organic Greek Yogurt 500g',
      },
      sourceDb
    );
    await upsertMasterProduct(
      {
        ean: '8901234567890',
        productCode: 'ABC1001',
        description: 'Fresh Farm Whole Milk 1L',
      },
      sourceDb
    );

    await addExpiryBatch(
      {
        ean: '8901234567890',
        productCode: 'ABC1001',
        description: 'Fresh Farm Whole Milk 1L',
        expiryDate: '2026-12-05',
        quantity: 7,
        entryType: 'scan',
      },
      sourceDb
    );
    await addExpiryBatch(
      {
        ean: '0012345678905',
        productCode: 'ABC1002',
        description: 'Organic Greek Yogurt 500g',
        expiryDate: '2027-01-20',
        quantity: 11,
        entryType: 'manual',
      },
      sourceDb
    );

    const backup = await exportFullBackupPayload(sourceDb);
    // Simulate stale source masterProductId from an older device
    backup.expiryBatches[0].masterProductId = 8888;
    backup.expiryBatches[1].masterProductId = 9999;

    // 1st merge restore
    const res1 = await restoreFullBackupPayload(backup, 'merge', targetDb);
    assert.equal(res1.batchesAdded, 2);
    assert.equal(res1.duplicatesSkipped, 0);
    assert.equal(res1.batchCount, 2);

    const targetMilk = await findMasterProductByEan('8901234567890', targetDb);
    const targetYogurt = await findMasterProductByEan('0012345678905', targetDb);
    assert.ok(targetMilk?.id && targetMilk.id !== 8888);
    assert.ok(targetYogurt?.id && targetYogurt.id !== 9999);

    const restoredBatches = await targetDb.expiryBatches.orderBy('id').toArray();
    assert.equal(restoredBatches[0].masterProductId, targetMilk.id);
    assert.equal(restoredBatches[1].masterProductId, targetYogurt.id);

    // 2nd & 3rd merge restores of exact same backup must skip all duplicates
    const res2 = await restoreFullBackupPayload(backup, 'merge', targetDb);
    assert.equal(res2.batchesAdded, 0);
    assert.equal(res2.duplicatesSkipped, 2);
    assert.equal(res2.batchCount, 2);

    const res3 = await restoreFullBackupPayload(backup, 'merge', targetDb);
    assert.equal(res3.batchesAdded, 0);
    assert.equal(res3.duplicatesSkipped, 2);
    assert.equal(res3.batchCount, 2);

    // Replace restore also reconnects masterProductId cleanly & drops within-backup duplicates
    const dupBackup = structuredClone(backup);
    dupBackup.expiryBatches.push(structuredClone(backup.expiryBatches[0]));
    const resReplace = await restoreFullBackupPayload(dupBackup, 'replace', targetDb);
    assert.equal(resReplace.batchesAdded, 2);
    assert.equal(resReplace.duplicatesSkipped, 1);
    assert.equal(resReplace.batchCount, 2);
    const afterReplaceMilk = await findMasterProductByEan('8901234567890', targetDb);
    const afterReplaceBatches = await targetDb.expiryBatches
      .where('ean')
      .equals('8901234567890')
      .toArray();
    assert.equal(afterReplaceBatches[0].masterProductId, afterReplaceMilk?.id);
  } finally {
    sourceDb.close();
    targetDb.close();
  }
});

test('validateBackupPayload and restoreFullBackupPayload reject invalid quantities and never coerce to 1', async () => {
  const testDb = createTestDb();
  try {
    const invalidQuantities: unknown[] = [0, -5, 'abc', '', null, undefined, Number.NaN];

    for (const badQty of invalidQuantities) {
      const payload = {
        appName: 'Retail Expiry Manager',
        schemaVersion: 1,
        exportedAt: '2026-11-21T00:00:00.000Z',
        masterProducts: [
          {
            ean: '8901234567890',
            productCode: 'ABC1001',
            description: 'Whole Milk 1L',
          },
        ],
        expiryBatches: [
          {
            ean: '8901234567890',
            productCode: 'ABC1001',
            description: 'Whole Milk 1L',
            expiryDate: '2026-12-30',
            quantity: badQty,
            entryType: 'scan',
          },
        ],
      };

      const check = validateBackupPayload(payload);
      assert.equal(check.valid, false, `Expected quantity ${String(badQty)} to fail validation`);

      await assert.rejects(
        () => restoreFullBackupPayload(payload, 'replace', testDb),
        /Invalid backup file/
      );
      assert.equal(await testDb.expiryBatches.count(), 0);
    }

    // Invalid calendar date must also fail
    const badDateCheck = validateBackupPayload({
      appName: 'Retail Expiry Manager',
      schemaVersion: 1,
      exportedAt: '2026-11-21T00:00:00.000Z',
      masterProducts: [],
      expiryBatches: [
        {
          ean: '8901234567890',
          productCode: 'ABC1001',
          description: 'Milk',
          expiryDate: '2026-02-30',
          quantity: 5,
          entryType: 'manual',
        },
      ],
    });
    assert.equal(badDateCheck.valid, false);
  } finally {
    testDb.close();
  }
});
