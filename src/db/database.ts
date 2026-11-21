import Dexie, { type DexieOptions, type Table } from 'dexie';
import type {
  AppPreferences,
  AppSetting,
  ExpiryBatch,
  FullBackupPayload,
  MasterProduct,
} from '../types/inventory';
import { getLocalTodayISO } from '../utils/expiryCalculations';
import { normalizeBarcodeText, validateBackupPayload } from '../utils/validation';

export class RetailExpiryDatabase extends Dexie {
  masterProducts!: Table<MasterProduct, number>;
  expiryBatches!: Table<ExpiryBatch, number>;
  settings!: Table<AppSetting, number>;

  constructor(name = 'RetailExpiryManagerDB', options?: DexieOptions) {
    super(name, options);

    this.version(1).stores({
      masterProducts: '++id, &ean, productCode, description, updatedAt',
      expiryBatches:
        '++id, masterProductId, ean, productCode, expiryDate, entryType, createdAt',
      settings: '++id, &settingKey',
    });
  }
}

export const db = new RetailExpiryDatabase();

export const DEFAULT_PREFERENCES: AppPreferences = {
  storeName: 'Main Retail Store',
  scannerBeep: true,
  scannerVibrate: true,
  scanCooldownMs: 2200,
};

export async function getAppPreferences(
  database: RetailExpiryDatabase = db
): Promise<AppPreferences> {
  const rows = await database.settings.toArray();
  const map = new Map(rows.map((r) => [r.settingKey, r.settingValue]));

  return {
    storeName: map.get('storeName') || DEFAULT_PREFERENCES.storeName,
    scannerBeep:
      map.get('scannerBeep') !== undefined
        ? map.get('scannerBeep') === 'true'
        : DEFAULT_PREFERENCES.scannerBeep,
    scannerVibrate:
      map.get('scannerVibrate') !== undefined
        ? map.get('scannerVibrate') === 'true'
        : DEFAULT_PREFERENCES.scannerVibrate,
    scanCooldownMs: Number(
      map.get('scanCooldownMs') || DEFAULT_PREFERENCES.scanCooldownMs
    ),
  };
}

export async function saveAppPreferences(
  prefs: Partial<AppPreferences>,
  database: RetailExpiryDatabase = db
): Promise<void> {
  const entries = Object.entries(prefs).map(([settingKey, val]) => ({
    settingKey,
    settingValue: String(val),
  }));

  await database.transaction('rw', database.settings, async () => {
    for (const entry of entries) {
      const existing = await database.settings
        .where('settingKey')
        .equals(entry.settingKey)
        .first();
      if (existing?.id !== undefined) {
        await database.settings.update(existing.id, {
          settingValue: entry.settingValue,
        });
      } else {
        await database.settings.add(entry);
      }
    }
  });
}

export async function findMasterProductByEan(
  ean: string,
  database: RetailExpiryDatabase = db
): Promise<MasterProduct | undefined> {
  const clean = normalizeBarcodeText(ean);
  if (!clean) return undefined;
  return database.masterProducts.where('ean').equals(clean).first();
}

/**
 * Re-links every ExpiryBatch's masterProductId to the current MasterProducts
 * table by exact EAN match. Never deletes or modifies expiry dates or quantities.
 */
export async function reconnectExpiryBatchesToMasters(
  database: RetailExpiryDatabase = db
): Promise<number> {
  const [masters, batches] = await Promise.all([
    database.masterProducts.toArray(),
    database.expiryBatches.toArray(),
  ]);

  const masterIdByEan = new Map<string, number>();
  for (const m of masters) {
    if (m.id !== undefined) {
      masterIdByEan.set(normalizeBarcodeText(m.ean), m.id);
    }
  }

  let updatedCount = 0;
  for (const batch of batches) {
    if (batch.id === undefined) continue;
    const cleanEan = normalizeBarcodeText(batch.ean || '');
    const expectedMasterId = cleanEan ? masterIdByEan.get(cleanEan) : undefined;
    if (batch.masterProductId !== expectedMasterId) {
      await database.expiryBatches.update(batch.id, {
        masterProductId: expectedMasterId,
      });
      updatedCount += 1;
    }
  }
  return updatedCount;
}

export async function upsertMasterProduct(
  input: {
    ean: string;
    productCode: string;
    description: string;
  },
  database: RetailExpiryDatabase = db
): Promise<{ id: number; updated: boolean }> {
  const now = new Date().toISOString();
  const ean = normalizeBarcodeText(input.ean);
  const productCode = input.productCode.trim();
  const description = input.description.trim();

  let resultId = 0;
  let wasUpdated = false;

  await database.transaction(
    'rw',
    database.masterProducts,
    database.expiryBatches,
    async () => {
      const existing = await database.masterProducts
        .where('ean')
        .equals(ean)
        .first();
      if (existing?.id !== undefined) {
        await database.masterProducts.update(existing.id, {
          productCode,
          description,
          updatedAt: now,
        });
        resultId = existing.id;
        wasUpdated = true;
      } else {
        resultId = await database.masterProducts.add({
          ean,
          productCode,
          description,
          createdAt: now,
          updatedAt: now,
        });
      }

      // Connect any previously unlinked expiry batches with this EAN
      await database.expiryBatches
        .where('ean')
        .equals(ean)
        .modify({ masterProductId: resultId });
    }
  );

  return { id: resultId, updated: wasUpdated };
}

export async function updateMasterProductSafely(
  id: number,
  updates: { ean: string; productCode: string; description: string },
  database: RetailExpiryDatabase = db
): Promise<void> {
  const cleanEan = normalizeBarcodeText(updates.ean);
  const now = new Date().toISOString();

  await database.transaction(
    'rw',
    database.masterProducts,
    database.expiryBatches,
    async () => {
      await database.masterProducts.update(id, {
        ean: cleanEan,
        productCode: updates.productCode.trim(),
        description: updates.description.trim(),
        updatedAt: now,
      });
      await reconnectExpiryBatchesToMasters(database);
    }
  );
}

export async function deleteMasterProductSafely(
  id: number,
  database: RetailExpiryDatabase = db
): Promise<void> {
  await database.transaction(
    'rw',
    database.masterProducts,
    database.expiryBatches,
    async () => {
      await database.masterProducts.delete(id);
      await database.expiryBatches
        .where('masterProductId')
        .equals(id)
        .modify({ masterProductId: undefined });
    }
  );
}

/**
 * High-speed chunked upsert for 10,000+ Master Products.
 * Preserves all expiryBatches and reconnects their masterProductId references.
 */
export async function bulkImportMasterProducts(
  rows: Array<{ ean: string; productCode: string; description: string }>,
  mode: 'merge' | 'replace_master_only',
  database: RetailExpiryDatabase = db
): Promise<{ inserted: number; updated: number; reconnectedBatches: number }> {
  const now = new Date().toISOString();
  const CHUNK_SIZE = 1000;
  let inserted = 0;
  let updated = 0;
  let reconnectedBatches = 0;

  await database.transaction(
    'rw',
    database.masterProducts,
    database.expiryBatches,
    async () => {
      if (mode === 'replace_master_only') {
        await database.masterProducts.clear();
        for (let i = 0; i < rows.length; i += CHUNK_SIZE) {
          const chunk = rows.slice(i, i + CHUNK_SIZE).map((r) => ({
            ean: normalizeBarcodeText(r.ean),
            productCode: r.productCode.trim(),
            description: r.description.trim(),
            createdAt: now,
            updatedAt: now,
          }));
          await database.masterProducts.bulkAdd(chunk);
          inserted += chunk.length;
        }
      } else {
        // Merge mode: look up existing EANs in chunks for O(N) performance
        for (let i = 0; i < rows.length; i += CHUNK_SIZE) {
          const slice = rows.slice(i, i + CHUNK_SIZE);
          const eans = slice.map((r) => normalizeBarcodeText(r.ean));
          const existingList = await database.masterProducts
            .where('ean')
            .anyOf(eans)
            .toArray();
          const existingMap = new Map(existingList.map((m) => [m.ean, m]));

          const toPut: MasterProduct[] = [];
          for (const r of slice) {
            const cleanEan = normalizeBarcodeText(r.ean);
            const existing = existingMap.get(cleanEan);
            if (existing) {
              toPut.push({
                ...existing,
                productCode: r.productCode.trim(),
                description: r.description.trim(),
                updatedAt: now,
              });
              updated += 1;
            } else {
              toPut.push({
                ean: cleanEan,
                productCode: r.productCode.trim(),
                description: r.description.trim(),
                createdAt: now,
                updatedAt: now,
              });
              inserted += 1;
            }
          }
          await database.masterProducts.bulkPut(toPut);
        }
      }

      reconnectedBatches = await reconnectExpiryBatchesToMasters(database);
    }
  );

  return { inserted, updated, reconnectedBatches };
}

export async function addExpiryBatch(
  input: {
    masterProductId?: number;
    ean: string;
    productCode: string;
    description: string;
    expiryDate: string;
    quantity: number;
    originalScannedBarcode?: string;
    correctedEan?: string;
    entryType: 'scan' | 'manual';
  },
  database: RetailExpiryDatabase = db
): Promise<number> {
  const now = new Date().toISOString();
  const cleanEan = normalizeBarcodeText(input.ean);
  let masterId = input.masterProductId;

  if (masterId === undefined && cleanEan) {
    const matched = await findMasterProductByEan(cleanEan, database);
    masterId = matched?.id;
  }

  return database.expiryBatches.add({
    masterProductId: masterId,
    ean: cleanEan,
    productCode: input.productCode.trim(),
    description: input.description.trim(),
    expiryDate: input.expiryDate,
    quantity: Number(input.quantity),
    originalScannedBarcode: input.originalScannedBarcode
      ? normalizeBarcodeText(input.originalScannedBarcode)
      : undefined,
    correctedEan: input.correctedEan
      ? normalizeBarcodeText(input.correctedEan)
      : undefined,
    entryType: input.entryType,
    createdAt: now,
    updatedAt: now,
  });
}

export async function exportFullBackupPayload(
  database: RetailExpiryDatabase = db
): Promise<FullBackupPayload> {
  const [masterProducts, expiryBatches, settings] = await Promise.all([
    database.masterProducts.toArray(),
    database.expiryBatches.toArray(),
    database.settings.toArray(),
  ]);

  return {
    appName: 'Retail Expiry Manager',
    schemaVersion: 1,
    exportedAt: new Date().toISOString(),
    masterProducts,
    expiryBatches,
    settings,
  };
}

/**
 * Deterministic fingerprint for an ExpiryBatch record so repeated restores
 * of the same backup in merge mode never create duplicate batches.
 */
export function getBatchFingerprint(b: {
  ean?: string;
  productCode: string;
  description: string;
  expiryDate: string;
  quantity: number;
  originalScannedBarcode?: string;
  correctedEan?: string;
  entryType: 'scan' | 'manual';
  createdAt?: string;
}): string {
  return JSON.stringify([
    normalizeBarcodeText(b.ean ?? ''),
    String(b.productCode).trim(),
    String(b.description).trim(),
    String(b.expiryDate).trim(),
    Number(b.quantity),
    normalizeBarcodeText(b.originalScannedBarcode ?? ''),
    normalizeBarcodeText(b.correctedEan ?? ''),
    b.entryType,
    String(b.createdAt ?? '').trim(),
  ]);
}

export async function restoreFullBackupPayload(
  rawPayload: unknown,
  mode: 'replace' | 'merge',
  database: RetailExpiryDatabase = db
): Promise<{
  masterCount: number;
  batchCount: number;
  batchesAdded: number;
  duplicatesSkipped: number;
}> {
  const check = validateBackupPayload(rawPayload);
  if (!check.valid) {
    throw new Error(`Invalid backup file: ${check.errors[0]}`);
  }
  const payload = check.payload;

  let batchesAdded = 0;
  let duplicatesSkipped = 0;

  await database.transaction(
    'rw',
    database.masterProducts,
    database.expiryBatches,
    database.settings,
    async () => {
      if (mode === 'replace') {
        await database.masterProducts.clear();
        await database.expiryBatches.clear();
        if (Array.isArray(payload.settings)) {
          await database.settings.clear();
        }
      }

      const cleanMaster = payload.masterProducts.map((m) => ({
        ean: normalizeBarcodeText(String(m.ean)),
        productCode: String(m.productCode).trim(),
        description: String(m.description).trim(),
        createdAt: m.createdAt || new Date().toISOString(),
        updatedAt: m.updatedAt || new Date().toISOString(),
      }));

      if (mode === 'replace') {
        if (cleanMaster.length > 0) {
          await database.masterProducts.bulkAdd(cleanMaster);
        }
      } else {
        for (const m of cleanMaster) {
          const existing = await database.masterProducts
            .where('ean')
            .equals(m.ean)
            .first();
          if (existing?.id !== undefined) {
            await database.masterProducts.update(existing.id, {
              productCode: m.productCode,
              description: m.description,
              updatedAt: m.updatedAt,
            });
          } else {
            await database.masterProducts.add(m);
          }
        }
      }

      // Build live EAN -> ID map from newly inserted/merged MasterProducts
      const liveMasters = await database.masterProducts.toArray();
      const masterIdByEan = new Map<string, number>();
      for (const m of liveMasters) {
        if (m.id !== undefined) {
          masterIdByEan.set(normalizeBarcodeText(m.ean), m.id);
        }
      }

      // Collect fingerprints of existing batches to prevent duplicates across repeated restores
      const seenFingerprints = new Set<string>();
      if (mode === 'merge') {
        const existingBatches = await database.expiryBatches.toArray();
        for (const eb of existingBatches) {
          seenFingerprints.add(getBatchFingerprint(eb));
        }
      }

      const batchesToAdd: ExpiryBatch[] = [];
      for (const b of payload.expiryBatches) {
        const cleanEan = normalizeBarcodeText(String(b.ean ?? ''));
        const qty = Number(b.quantity);
        if (!Number.isFinite(qty) || qty <= 0) {
          throw new Error(
            `Backup contains invalid quantity (${String(b.quantity)}) for product "${b.description}".`
          );
        }

        const candidate: ExpiryBatch = {
          masterProductId: cleanEan ? masterIdByEan.get(cleanEan) : undefined,
          ean: cleanEan,
          productCode: String(b.productCode).trim(),
          description: String(b.description).trim(),
          expiryDate: String(b.expiryDate).trim(),
          quantity: qty,
          originalScannedBarcode: b.originalScannedBarcode
            ? normalizeBarcodeText(String(b.originalScannedBarcode))
            : undefined,
          correctedEan: b.correctedEan
            ? normalizeBarcodeText(String(b.correctedEan))
            : undefined,
          entryType: b.entryType,
          createdAt: b.createdAt || new Date().toISOString(),
          updatedAt: b.updatedAt || new Date().toISOString(),
        };

        const fp = getBatchFingerprint(candidate);
        if (seenFingerprints.has(fp)) {
          duplicatesSkipped += 1;
          continue;
        }
        seenFingerprints.add(fp);
        batchesToAdd.push(candidate);
      }

      if (batchesToAdd.length > 0) {
        await database.expiryBatches.bulkAdd(batchesToAdd);
        batchesAdded = batchesToAdd.length;
      }

      if (mode === 'merge') {
        await reconnectExpiryBatchesToMasters(database);
      }

      if (Array.isArray(payload.settings)) {
        for (const s of payload.settings) {
          const key = String(s.settingKey ?? '').trim();
          if (!key) continue;
          const existing = await database.settings
            .where('settingKey')
            .equals(key)
            .first();
          if (existing?.id !== undefined) {
            await database.settings.update(existing.id, {
              settingValue: String(s.settingValue),
            });
          } else {
            await database.settings.add({
              settingKey: key,
              settingValue: String(s.settingValue),
            });
          }
        }
      }
    }
  );

  const [masterCount, batchCount] = await Promise.all([
    database.masterProducts.count(),
    database.expiryBatches.count(),
  ]);

  return { masterCount, batchCount, batchesAdded, duplicatesSkipped };
}

function addDaysToLocalISO(baseISO: string, offsetDays: number): string {
  const [y, m, d] = baseISO.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d + offsetDays));
  const yy = dt.getUTCFullYear();
  const mm = String(dt.getUTCMonth() + 1).padStart(2, '0');
  const dd = String(dt.getUTCDate()).padStart(2, '0');
  return `${yy}-${mm}-${dd}`;
}

/**
 * Loads a realistic retail sample dataset for quick testing/demo without
 * touching any real records if the user prefers to start blank.
 */
export async function loadSampleRetailDataset(
  database: RetailExpiryDatabase = db
): Promise<{
  masterAdded: number;
  batchesAdded: number;
}> {
  const today = getLocalTodayISO();
  const now = new Date().toISOString();

  const sampleProducts: Array<{
    ean: string;
    productCode: string;
    description: string;
  }> = [
    {
      ean: '8901234567890',
      productCode: 'ABC1001',
      description: 'Fresh Farm Whole Milk 1L',
    },
    {
      ean: '0012345678905',
      productCode: 'ABC1002',
      description: 'Organic Greek Yogurt 500g',
    },
    {
      ean: '8901234567892',
      productCode: 'ABC1003',
      description: 'Artisan Multigrain Bread 400g',
    },
    {
      ean: '4006381333931',
      productCode: 'BEV2014',
      description: 'Cold Pressed Orange Juice 750ml',
    },
    {
      ean: '5010477348678',
      productCode: 'DRY3042',
      description: 'Rolled Oats Family Pack 1kg',
    },
    {
      ean: '0789100010010',
      productCode: 'CHZ1108',
      description: 'Aged Cheddar Block 250g',
    },
    {
      ean: '8850123110221',
      productCode: 'SNK4410',
      description: 'Roasted Almond Protein Bar 60g',
    },
    {
      ean: '6920180200112',
      productCode: 'CON5090',
      description: 'Canned San Marzano Tomatoes 400g',
    },
  ];

  const { inserted } = await bulkImportMasterProducts(
    sampleProducts,
    'merge',
    database
  );

  const milk = await findMasterProductByEan('8901234567890', database);
  const yogurt = await findMasterProductByEan('0012345678905', database);
  const bread = await findMasterProductByEan('8901234567892', database);
  const juice = await findMasterProductByEan('4006381333931', database);
  const oats = await findMasterProductByEan('5010477348678', database);
  const cheddar = await findMasterProductByEan('0789100010010', database);

  const sampleBatches: ExpiryBatch[] = [
    {
      masterProductId: bread?.id,
      ean: '8901234567892',
      productCode: 'ABC1003',
      description: 'Artisan Multigrain Bread 400g',
      expiryDate: addDaysToLocalISO(today, -4),
      quantity: 6,
      originalScannedBarcode: '8901234567892',
      entryType: 'scan',
      createdAt: now,
      updatedAt: now,
    },
    {
      masterProductId: milk?.id,
      ean: '8901234567890',
      productCode: 'ABC1001',
      description: 'Fresh Farm Whole Milk 1L',
      expiryDate: addDaysToLocalISO(today, 9),
      quantity: 8,
      originalScannedBarcode: '8901234567890',
      entryType: 'scan',
      createdAt: now,
      updatedAt: now,
    },
    {
      masterProductId: milk?.id,
      ean: '8901234567890',
      productCode: 'ABC1001',
      description: 'Fresh Farm Whole Milk 1L',
      expiryDate: addDaysToLocalISO(today, 38),
      quantity: 12,
      originalScannedBarcode: '8901234567890',
      entryType: 'scan',
      createdAt: now,
      updatedAt: now,
    },
    {
      masterProductId: yogurt?.id,
      ean: '0012345678905',
      productCode: 'ABC1002',
      description: 'Organic Greek Yogurt 500g',
      expiryDate: addDaysToLocalISO(today, 22),
      quantity: 14,
      originalScannedBarcode: '0012345678905',
      entryType: 'scan',
      createdAt: now,
      updatedAt: now,
    },
    {
      masterProductId: juice?.id,
      ean: '4006381333931',
      productCode: 'BEV2014',
      description: 'Cold Pressed Orange Juice 750ml',
      expiryDate: addDaysToLocalISO(today, 52),
      quantity: 20,
      entryType: 'manual',
      createdAt: now,
      updatedAt: now,
    },
    {
      masterProductId: cheddar?.id,
      ean: '0789100010010',
      productCode: 'CHZ1108',
      description: 'Aged Cheddar Block 250g',
      expiryDate: addDaysToLocalISO(today, 76),
      quantity: 9,
      originalScannedBarcode: '0789100010010',
      entryType: 'scan',
      createdAt: now,
      updatedAt: now,
    },
    {
      masterProductId: oats?.id,
      ean: '5010477348678',
      productCode: 'DRY3042',
      description: 'Rolled Oats Family Pack 1kg',
      expiryDate: addDaysToLocalISO(today, 145),
      quantity: 24,
      originalScannedBarcode: '5010477348678',
      entryType: 'scan',
      createdAt: now,
      updatedAt: now,
    },
  ];

  await database.expiryBatches.bulkAdd(sampleBatches);
  return { masterAdded: inserted, batchesAdded: sampleBatches.length };
}
