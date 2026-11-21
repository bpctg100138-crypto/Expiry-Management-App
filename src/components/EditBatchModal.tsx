import React, { useEffect, useState } from 'react';
import { X } from 'lucide-react';
import type { ExpiryBatch } from '../types/inventory';
import { validateBatchInput } from '../utils/validation';

interface EditBatchModalProps {
  batch: ExpiryBatch | null;
  onClose: () => void;
  onSave: (
    id: number,
    updates: {
      ean: string;
      productCode: string;
      description: string;
      expiryDate: string;
      quantity: number;
    }
  ) => Promise<void>;
}

export const EditBatchModal: React.FC<EditBatchModalProps> = ({
  batch,
  onClose,
  onSave,
}) => {
  const [ean, setEan] = useState('');
  const [productCode, setProductCode] = useState('');
  const [description, setDescription] = useState('');
  const [expiryDate, setExpiryDate] = useState('');
  const [quantity, setQuantity] = useState('');
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (batch) {
      setEan(batch.ean);
      setProductCode(batch.productCode);
      setDescription(batch.description);
      setExpiryDate(batch.expiryDate);
      setQuantity(String(batch.quantity));
      setErrors({});
    }
  }, [batch]);

  if (!batch || batch.id === undefined) return null;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const check = validateBatchInput({
      ean,
      eanRequired: false,
      productCode,
      description,
      expiryDate,
      quantity,
    });
    if (!check.valid) {
      setErrors(check.errors);
      return;
    }

    setSaving(true);
    try {
      await onSave(batch.id!, {
        ean: ean.trim(),
        productCode: productCode.trim(),
        description: description.trim(),
        expiryDate,
        quantity: Number(quantity),
      });
      onClose();
    } finally {
      setSaving(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center bg-slate-900/50 p-0 sm:items-center sm:p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="edit-batch-title"
    >
      <div className="w-full max-w-lg rounded-t-2xl border border-slate-200 bg-white p-6 shadow-xl sm:rounded-xl">
        <div className="flex items-center justify-between border-b border-slate-200 pb-4">
          <h3 id="edit-batch-title" className="text-lg font-bold text-slate-900">
            Edit Expiry Batch
          </h3>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close edit batch dialog"
            className="flex min-h-[44px] min-w-[44px] items-center justify-center rounded-lg text-slate-500 hover:bg-slate-100 hover:text-slate-900"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="mt-4 space-y-4">
          {batch.originalScannedBarcode && (
            <div className="rounded-lg border border-slate-200 bg-slate-50 px-3.5 py-2.5 text-xs text-slate-600">
              Original Scanned Barcode:{' '}
              <span className="font-mono font-semibold text-slate-900">
                {batch.originalScannedBarcode}
              </span>
              {batch.correctedEan && batch.correctedEan !== batch.originalScannedBarcode && (
                <>
                  {' '}
                  · Corrected EAN:{' '}
                  <span className="font-mono font-semibold text-blue-700">
                    {batch.correctedEan}
                  </span>
                </>
              )}
            </div>
          )}

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div>
              <label
                htmlFor="edit-batch-ean"
                className="block text-xs font-semibold text-slate-700"
              >
                EAN Number
              </label>
              <input
                id="edit-batch-ean"
                type="text"
                value={ean}
                onChange={(e) => setEan(e.target.value)}
                className="mt-1.5 min-h-[44px] w-full rounded-lg border border-slate-300 px-3 font-mono text-sm text-slate-900 focus:border-blue-600 focus:outline-none focus:ring-1 focus:ring-blue-600"
              />
              {errors.ean && (
                <p className="mt-1 text-xs text-red-600">{errors.ean}</p>
              )}
            </div>

            <div>
              <label
                htmlFor="edit-batch-code"
                className="block text-xs font-semibold text-slate-700"
              >
                Product Code *
              </label>
              <input
                id="edit-batch-code"
                type="text"
                value={productCode}
                onChange={(e) => setProductCode(e.target.value)}
                className="mt-1.5 min-h-[44px] w-full rounded-lg border border-slate-300 px-3 font-mono text-sm text-slate-900 focus:border-blue-600 focus:outline-none focus:ring-1 focus:ring-blue-600"
              />
              {errors.productCode && (
                <p className="mt-1 text-xs text-red-600">{errors.productCode}</p>
              )}
            </div>
          </div>

          <div>
            <label
              htmlFor="edit-batch-desc"
              className="block text-xs font-semibold text-slate-700"
            >
              Product Description *
            </label>
            <input
              id="edit-batch-desc"
              type="text"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              className="mt-1.5 min-h-[44px] w-full rounded-lg border border-slate-300 px-3 text-sm text-slate-900 focus:border-blue-600 focus:outline-none focus:ring-1 focus:ring-blue-600"
            />
            {errors.description && (
              <p className="mt-1 text-xs text-red-600">{errors.description}</p>
            )}
          </div>

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div>
              <label
                htmlFor="edit-batch-date"
                className="block text-xs font-semibold text-slate-700"
              >
                Expiry Date *
              </label>
              <input
                id="edit-batch-date"
                type="date"
                value={expiryDate}
                onChange={(e) => setExpiryDate(e.target.value)}
                className="mt-1.5 min-h-[44px] w-full rounded-lg border border-slate-300 px-3 font-mono text-sm text-slate-900 focus:border-blue-600 focus:outline-none focus:ring-1 focus:ring-blue-600"
              />
              {errors.expiryDate && (
                <p className="mt-1 text-xs text-red-600">{errors.expiryDate}</p>
              )}
            </div>

            <div>
              <label
                htmlFor="edit-batch-qty"
                className="block text-xs font-semibold text-slate-700"
              >
                Quantity *
              </label>
              <input
                id="edit-batch-qty"
                type="number"
                min="1"
                step="1"
                value={quantity}
                onChange={(e) => setQuantity(e.target.value)}
                className="mt-1.5 min-h-[44px] w-full rounded-lg border border-slate-300 px-3 font-mono text-sm tabular-nums text-slate-900 focus:border-blue-600 focus:outline-none focus:ring-1 focus:ring-blue-600"
              />
              {errors.quantity && (
                <p className="mt-1 text-xs text-red-600">{errors.quantity}</p>
              )}
            </div>
          </div>

          <div className="flex flex-col-reverse gap-2 border-t border-slate-200 pt-4 sm:flex-row sm:justify-end">
            <button
              type="button"
              onClick={onClose}
              className="min-h-[44px] rounded-lg border border-slate-300 bg-white px-4 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={saving}
              className="min-h-[44px] rounded-lg bg-blue-600 px-5 py-2 text-sm font-semibold text-white hover:bg-blue-700 disabled:opacity-60"
            >
              {saving ? 'Saving...' : 'Save Changes'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};
