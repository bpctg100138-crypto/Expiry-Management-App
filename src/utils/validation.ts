import type { FullBackupPayload } from '../types/inventory';
import { parseISODateToDayNumber } from './expiryCalculations';

/**
 * Preserves EAN strictly as trimmed text, keeping all leading zeros.
 */
export function normalizeBarcodeText(raw: string): string {
  return String(raw ?? '').trim().replace(/\s+/g, '');
}

/**
 * Validates barcode text (supports EAN-8, EAN-13, UPC-A, UPC-E, Code 128).
 */
export function isValidBarcodeText(
  barcode: string,
  options: { allowAlphanumeric?: boolean; minLength?: number; maxLength?: number } = {}
): boolean {
  const cleaned = normalizeBarcodeText(barcode);
  const { allowAlphanumeric = true, minLength = 3, maxLength = 48 } = options;

  if (cleaned.length < minLength || cleaned.length > maxLength) {
    return false;
  }

  if (allowAlphanumeric) {
    return /^[A-Za-z0-9\-_.]+$/.test(cleaned);
  }

  return /^\d+$/.test(cleaned);
}

export interface BatchValidationInput {
  ean?: string;
  eanRequired?: boolean;
  productCode: string;
  description: string;
  expiryDate: string;
  quantity: string | number;
}

export interface ValidationResult {
  valid: boolean;
  errors: Record<string, string>;
}

export function validateBatchInput(input: BatchValidationInput): ValidationResult {
  const errors: Record<string, string> = {};
  const cleanEan = normalizeBarcodeText(input.ean ?? '');
  const cleanCode = String(input.productCode ?? '').trim();
  const cleanDesc = String(input.description ?? '').trim();
  const cleanDate = String(input.expiryDate ?? '').trim();
  const rawQty =
    typeof input.quantity === 'number'
      ? input.quantity
      : String(input.quantity ?? '').trim() === ''
      ? Number.NaN
      : Number(input.quantity);

  if (input.eanRequired && !cleanEan) {
    errors.ean = 'EAN / Barcode number is required.';
  } else if (
    cleanEan &&
    !isValidBarcodeText(cleanEan, { allowAlphanumeric: true, minLength: 3 })
  ) {
    errors.ean = 'Barcode must be 3-48 valid characters without spaces.';
  }

  if (!cleanCode) {
    errors.productCode = 'Product Code / Article Number is required.';
  }

  if (!cleanDesc) {
    errors.description = 'Product Description is required.';
  }

  if (!cleanDate || parseISODateToDayNumber(cleanDate) === null) {
    errors.expiryDate = 'Enter a valid expiry calendar date.';
  }

  if (!Number.isFinite(rawQty) || rawQty <= 0) {
    errors.quantity = 'Quantity must be greater than 0.';
  }

  return {
    valid: Object.keys(errors).length === 0,
    errors,
  };
}

export function validateMasterProductInput(input: {
  ean: string;
  productCode: string;
  description: string;
}): ValidationResult {
  const errors: Record<string, string> = {};
  const cleanEan = normalizeBarcodeText(input.ean);
  const cleanCode = String(input.productCode ?? '').trim();
  const cleanDesc = String(input.description ?? '').trim();

  if (!cleanEan) {
    errors.ean = 'EAN Number is required.';
  } else if (!isValidBarcodeText(cleanEan, { allowAlphanumeric: true, minLength: 4 })) {
    errors.ean = 'EAN must be at least 4 valid characters.';
  }

  if (!cleanCode) {
    errors.productCode = 'Product Code is required.';
  }

  if (!cleanDesc) {
    errors.description = 'Product Description is required.';
  }

  return {
    valid: Object.keys(errors).length === 0,
    errors,
  };
}

export type BackupValidationOutcome =
  | { valid: true; payload: FullBackupPayload }
  | { valid: false; errors: string[] };

/**
 * Strictly validates JSON backup payloads before restoring.
 * Never coerces missing, zero, negative, or non-numeric quantities to 1.
 */
export function validateBackupPayload(raw: unknown): BackupValidationOutcome {
  const errors: string[] = [];

  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    return { valid: false, errors: ['Backup file must be a JSON object.'] };
  }

  const obj = raw as Record<string, unknown>;
  if (obj.appName !== 'Retail Expiry Manager') {
    errors.push('Invalid application identifier (expected "Retail Expiry Manager").');
  }
  if (obj.schemaVersion !== 1) {
    errors.push('Unsupported or missing backup schemaVersion (expected 1).');
  }
  if (!Array.isArray(obj.masterProducts)) {
    errors.push('Backup is missing a valid masterProducts array.');
  }
  if (!Array.isArray(obj.expiryBatches)) {
    errors.push('Backup is missing a valid expiryBatches array.');
  }

  if (errors.length > 0) {
    return { valid: false, errors };
  }

  const masterProducts = obj.masterProducts as Array<Record<string, unknown>>;
  const expiryBatches = obj.expiryBatches as Array<Record<string, unknown>>;
  const seenEans = new Set<string>();

  for (let i = 0; i < masterProducts.length; i++) {
    const m = masterProducts[i];
    if (!m || typeof m !== 'object') {
      errors.push(`masterProducts[${i}] must be an object.`);
      continue;
    }
    const ean = normalizeBarcodeText(typeof m.ean === 'string' || typeof m.ean === 'number' ? String(m.ean) : '');
    const code = typeof m.productCode === 'string' || typeof m.productCode === 'number' ? String(m.productCode).trim() : '';
    const desc = typeof m.description === 'string' ? m.description.trim() : '';

    if (!ean || !isValidBarcodeText(ean, { allowAlphanumeric: true, minLength: 3 })) {
      errors.push(`masterProducts[${i}] has an invalid or missing EAN.`);
    } else if (seenEans.has(ean)) {
      errors.push(`masterProducts[${i}] has a duplicate EAN (${ean}).`);
    } else {
      seenEans.add(ean);
    }

    if (!code) {
      errors.push(`masterProducts[${i}] is missing productCode.`);
    }
    if (!desc) {
      errors.push(`masterProducts[${i}] is missing description.`);
    }

    if (errors.length >= 10) break;
  }

  for (let i = 0; i < expiryBatches.length; i++) {
    if (errors.length >= 10) break;
    const b = expiryBatches[i];
    if (!b || typeof b !== 'object') {
      errors.push(`expiryBatches[${i}] must be an object.`);
      continue;
    }

    const ean =
      typeof b.ean === 'string' || typeof b.ean === 'number'
        ? normalizeBarcodeText(String(b.ean))
        : '';
    const code =
      typeof b.productCode === 'string' || typeof b.productCode === 'number'
        ? String(b.productCode).trim()
        : '';
    const desc = typeof b.description === 'string' ? b.description.trim() : '';
    const expiryDate = typeof b.expiryDate === 'string' ? b.expiryDate.trim() : '';

    const rawQty = b.quantity;
    const parsedQty =
      typeof rawQty === 'number'
        ? rawQty
        : typeof rawQty === 'string' && rawQty.trim() !== ''
        ? Number(rawQty)
        : Number.NaN;

    if (ean && !isValidBarcodeText(ean, { allowAlphanumeric: true, minLength: 3 })) {
      errors.push(`expiryBatches[${i}] has an invalid EAN (${ean}).`);
    }
    if (!code) {
      errors.push(`expiryBatches[${i}] is missing productCode.`);
    }
    if (!desc) {
      errors.push(`expiryBatches[${i}] is missing description.`);
    }
    if (!expiryDate || parseISODateToDayNumber(expiryDate) === null) {
      errors.push(`expiryBatches[${i}] has an invalid expiryDate ("${expiryDate}").`);
    }
    if (!Number.isFinite(parsedQty) || parsedQty <= 0) {
      errors.push(
        `expiryBatches[${i}] has an invalid quantity (${String(rawQty)}). Must be a positive number > 0.`
      );
    }
    if (b.entryType !== 'scan' && b.entryType !== 'manual') {
      errors.push(`expiryBatches[${i}] has an invalid entryType ("${String(b.entryType)}").`);
    }
  }

  if (obj.settings !== undefined && !Array.isArray(obj.settings)) {
    errors.push('Backup settings must be an array when present.');
  }

  if (errors.length > 0) {
    return { valid: false, errors };
  }

  return { valid: true, payload: raw as FullBackupPayload };
}
