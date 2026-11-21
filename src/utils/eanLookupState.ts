import type { MasterProduct } from '../types/inventory';
import { normalizeBarcodeText } from './validation';

/**
 * Monotonic async sequence guard so older IndexedDB lookups never overwrite newer ones.
 */
export class AsyncLookupGuard {
  private currentSeq = 0;

  next(): number {
    this.currentSeq += 1;
    return this.currentSeq;
  }

  isLatest(seq: number): boolean {
    return seq === this.currentSeq;
  }

  invalidate(): void {
    this.currentSeq += 1;
  }
}

export interface EanCorrectionResolution {
  editableEan: string;
  matchedMaster: MasterProduct | null;
  productCode: string;
  description: string;
  scanState: 'matched' | 'not_found';
}

/**
 * Resolves UI product fields when the user edits an EAN during correction.
 * Guarantee: if the edited EAN does not match a Master Product, previously
 * populated productCode and description are NEVER retained.
 */
export function resolveEanCorrectionChange(
  nextRawEan: string,
  foundMaster: MasterProduct | undefined | null
): EanCorrectionResolution {
  const clean = normalizeBarcodeText(nextRawEan);
  if (clean && foundMaster) {
    return {
      editableEan: nextRawEan,
      matchedMaster: foundMaster,
      productCode: foundMaster.productCode,
      description: foundMaster.description,
      scanState: 'matched',
    };
  }

  return {
    editableEan: nextRawEan,
    matchedMaster: null,
    productCode: '',
    description: '',
    scanState: 'not_found',
  };
}
