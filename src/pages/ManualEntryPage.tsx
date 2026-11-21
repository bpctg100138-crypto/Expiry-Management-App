import React, { useRef, useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { CheckCircle2, PlusCircle, Search } from 'lucide-react';
import {
  addExpiryBatch,
  db,
  findMasterProductByEan,
  upsertMasterProduct,
} from '../db/database';
import type { MasterProduct } from '../types/inventory';
import { AsyncLookupGuard } from '../utils/eanLookupState';
import { formatDisplayDate } from '../utils/expiryCalculations';
import { normalizeBarcodeText, validateBatchInput } from '../utils/validation';

export const ManualEntryPage: React.FC = () => {
  const lookupGuardRef = useRef(new AsyncLookupGuard());
  const [ean, setEan] = useState('');
  const [productCode, setProductCode] = useState('');
  const [description, setDescription] = useState('');
  const [expiryDate, setExpiryDate] = useState('');
  const [quantity, setQuantity] = useState('1');
  const [matchedMaster, setMatchedMaster] = useState<MasterProduct | null>(null);
  const [saveToMaster, setSaveToMaster] = useState(false);

  const [errors, setErrors] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);
  const [savedBanner, setSavedBanner] = useState<string | null>(null);

  const cleanEan = normalizeBarcodeText(ean);
  const cleanCode = productCode.trim();

  const recentProductBatches = useLiveQuery(
    async () => {
      if (cleanEan) {
        return db.expiryBatches.where('ean').equals(cleanEan).sortBy('expiryDate');
      }
      if (cleanCode) {
        return db.expiryBatches
          .where('productCode')
          .equals(cleanCode)
          .sortBy('expiryDate');
      }
      return [];
    },
    [cleanEan, cleanCode],
    []
  );

  const handleEanChange = async (value: string) => {
    const seq = lookupGuardRef.current.next();
    const hadMatchedMaster = matchedMaster !== null;

    setEan(value);
    setSavedBanner(null);
    setErrors((p) => ({ ...p, ean: '' }));

    if (hadMatchedMaster) {
      setMatchedMaster(null);
      setProductCode('');
      setDescription('');
    }

    const normalized = normalizeBarcodeText(value);
    if (!normalized) {
      return;
    }

    const found = await findMasterProductByEan(normalized);
    if (!lookupGuardRef.current.isLatest(seq)) {
      return;
    }

    if (found) {
      setMatchedMaster(found);
      setProductCode(found.productCode);
      setDescription(found.description);
    } else {
      setMatchedMaster(null);
    }
  };

  const handleSubmit = async (
    e: React.FormEvent,
    keepProductForNextBatch: boolean
  ) => {
    e.preventDefault();
    setSavedBanner(null);

    const validation = validateBatchInput({
      ean: cleanEan,
      eanRequired: false,
      productCode,
      description,
      expiryDate,
      quantity,
    });

    if (!validation.valid) {
      setErrors(validation.errors);
      return;
    }

    setSaving(true);
    try {
      let masterId = matchedMaster?.id;
      if (!matchedMaster && saveToMaster && cleanEan) {
        const res = await upsertMasterProduct({
          ean: cleanEan,
          productCode,
          description,
        });
        masterId = res.id;
      }

      await addExpiryBatch({
        masterProductId: masterId,
        ean: cleanEan,
        productCode,
        description,
        expiryDate,
        quantity: Number(quantity),
        entryType: 'manual',
      });

      setSavedBanner(
        `Saved batch (${formatDisplayDate(expiryDate)} · Qty ${quantity}) for ${description.trim()}.`
      );

      if (keepProductForNextBatch) {
        setExpiryDate('');
        setQuantity('1');
      } else {
        setEan('');
        setProductCode('');
        setDescription('');
        setExpiryDate('');
        setQuantity('1');
        setMatchedMaster(null);
        setSaveToMaster(false);
      }
      setErrors({});
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <div className="rounded-xl border border-slate-200 bg-white p-5 sm:p-6">
        <div className="border-b border-slate-200 pb-4">
          <h2 className="text-lg font-bold text-slate-900">
            Manual Product & Batch Entry
          </h2>
          <p className="mt-1 text-sm text-slate-600">
            Enter items without scanning or add products not yet in your Master Database. Entering an existing EAN auto-fills Master Database details.
          </p>
        </div>

        {savedBanner && (
          <div
            role="status"
            className="mt-4 flex items-center gap-2 rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm font-medium text-emerald-800"
          >
            <CheckCircle2 className="h-4 w-4 shrink-0 text-emerald-600" />
            <span>{savedBanner}</span>
          </div>
        )}

        <form onSubmit={(e) => void handleSubmit(e, false)} className="mt-5 space-y-4">
          <div>
            <label
              htmlFor="manual-ean"
              className="block text-xs font-semibold text-slate-700"
            >
              EAN Number (Optional)
            </label>
            <div className="relative mt-1.5">
              <input
                id="manual-ean"
                type="text"
                placeholder="Leave blank if product has no barcode"
                value={ean}
                onChange={(e) => void handleEanChange(e.target.value)}
                className="min-h-[44px] w-full rounded-lg border border-slate-300 px-3.5 pr-10 font-mono text-sm text-slate-900 focus:border-blue-600 focus:outline-none focus:ring-1 focus:ring-blue-600"
              />
              <Search className="pointer-events-none absolute right-3 top-3.5 h-4 w-4 text-slate-400" />
            </div>
            {matchedMaster && (
              <p className="mt-1 text-xs font-medium text-emerald-700">
                Matched in Master Database: {matchedMaster.productCode} —{' '}
                {matchedMaster.description}
              </p>
            )}
            {errors.ean && (
              <p className="mt-1 text-xs text-red-600">{errors.ean}</p>
            )}
          </div>

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div>
              <label
                htmlFor="manual-product-code"
                className="block text-xs font-semibold text-slate-700"
              >
                Article Number / Product Code *
              </label>
              <input
                id="manual-product-code"
                type="text"
                placeholder="e.g. ABC1001"
                value={productCode}
                onChange={(e) => {
                  setProductCode(e.target.value);
                  setErrors((p) => ({ ...p, productCode: '' }));
                }}
                className="mt-1.5 min-h-[44px] w-full rounded-lg border border-slate-300 px-3.5 font-mono text-sm text-slate-900 focus:border-blue-600 focus:outline-none focus:ring-1 focus:ring-blue-600"
              />
              {errors.productCode && (
                <p className="mt-1 text-xs text-red-600">{errors.productCode}</p>
              )}
            </div>

            <div>
              <label
                htmlFor="manual-description"
                className="block text-xs font-semibold text-slate-700"
              >
                Product Description *
              </label>
              <input
                id="manual-description"
                type="text"
                placeholder="Product name and pack size"
                value={description}
                onChange={(e) => {
                  setDescription(e.target.value);
                  setErrors((p) => ({ ...p, description: '' }));
                }}
                className="mt-1.5 min-h-[44px] w-full rounded-lg border border-slate-300 px-3.5 text-sm text-slate-900 focus:border-blue-600 focus:outline-none focus:ring-1 focus:ring-blue-600"
              />
              {errors.description && (
                <p className="mt-1 text-xs text-red-600">{errors.description}</p>
              )}
            </div>
          </div>

          {!matchedMaster && cleanEan !== '' && (
            <label className="flex min-h-[44px] cursor-pointer items-center gap-2.5 rounded-lg border border-slate-200 bg-slate-50 px-3.5 py-2.5 text-sm font-medium text-slate-800">
              <input
                type="checkbox"
                checked={saveToMaster}
                onChange={(e) => setSaveToMaster(e.target.checked)}
                className="h-4 w-4 rounded border-slate-300 text-blue-600 focus:ring-blue-600"
              />
              <span>Save this product to Master Database as well</span>
            </label>
          )}

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div>
              <label
                htmlFor="manual-expiry-date"
                className="block text-xs font-semibold text-slate-700"
              >
                Expiry Date *
              </label>
              <input
                id="manual-expiry-date"
                type="date"
                value={expiryDate}
                onChange={(e) => {
                  setExpiryDate(e.target.value);
                  setErrors((p) => ({ ...p, expiryDate: '' }));
                }}
                className="mt-1.5 min-h-[44px] w-full rounded-lg border border-slate-300 px-3.5 font-mono text-sm text-slate-900 focus:border-blue-600 focus:outline-none focus:ring-1 focus:ring-blue-600"
              />
              {errors.expiryDate && (
                <p className="mt-1 text-xs text-red-600">{errors.expiryDate}</p>
              )}
            </div>

            <div>
              <label
                htmlFor="manual-quantity"
                className="block text-xs font-semibold text-slate-700"
              >
                Quantity *
              </label>
              <input
                id="manual-quantity"
                type="number"
                min="1"
                step="1"
                value={quantity}
                onChange={(e) => {
                  setQuantity(e.target.value);
                  setErrors((p) => ({ ...p, quantity: '' }));
                }}
                className="mt-1.5 min-h-[44px] w-full rounded-lg border border-slate-300 px-3.5 font-mono text-sm tabular-nums text-slate-900 focus:border-blue-600 focus:outline-none focus:ring-1 focus:ring-blue-600"
              />
              {errors.quantity && (
                <p className="mt-1 text-xs text-red-600">{errors.quantity}</p>
              )}
            </div>
          </div>

          <div className="flex flex-col gap-3 pt-2 sm:flex-row">
            <button
              type="submit"
              disabled={saving}
              className="inline-flex min-h-[48px] flex-1 items-center justify-center gap-2 rounded-lg bg-blue-600 px-5 py-2.5 text-sm font-bold text-white hover:bg-blue-700 disabled:opacity-60"
            >
              <PlusCircle className="h-4 w-4" />
              <span>{saving ? 'Saving...' : 'Save & Clear Form'}</span>
            </button>
            <button
              type="button"
              disabled={saving}
              onClick={(e) => void handleSubmit(e, true)}
              className="inline-flex min-h-[48px] flex-1 items-center justify-center gap-2 rounded-lg border border-slate-300 bg-white px-5 py-2.5 text-sm font-semibold text-slate-800 hover:bg-slate-50 disabled:opacity-60"
            >
              <span>Save & Add Another Batch</span>
            </button>
          </div>
        </form>

        {recentProductBatches.length > 0 && (
          <div className="mt-6 border-t border-slate-200 pt-5">
            <h3 className="text-xs font-bold text-slate-700">
              Logged Batches for This Product ({recentProductBatches.length})
            </h3>
            <div className="mt-2.5 divide-y divide-slate-100 rounded-lg border border-slate-200">
              {recentProductBatches.map((b) => (
                <div
                  key={b.id}
                  className="flex items-center justify-between px-3.5 py-2.5 text-xs"
                >
                  <span className="font-mono font-semibold text-slate-800">
                    {formatDisplayDate(b.expiryDate)}
                  </span>
                  <span className="font-mono font-bold tabular-nums text-slate-900">
                    Qty: {b.quantity}
                  </span>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
};
