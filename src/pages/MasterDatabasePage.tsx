import React, { useEffect, useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import {
  Edit2,
  FileSpreadsheet,
  Plus,
  Search,
  Trash2,
  Upload,
  X,
} from 'lucide-react';
import { ConfirmDialog } from '../components/ConfirmDialog';
import {
  db,
  deleteMasterProductSafely,
  updateMasterProductSafely,
  upsertMasterProduct,
} from '../db/database';
import type { MasterProduct, NavRoute } from '../types/inventory';
import {
  buildMasterDatabaseWorkbook,
  triggerWorkbookDownload,
} from '../utils/excelParser';
import { getLocalTodayISO } from '../utils/expiryCalculations';
import { normalizeBarcodeText, validateMasterProductInput } from '../utils/validation';

interface MasterDatabasePageProps {
  onNavigate: (route: NavRoute) => void;
  onViewBatches: (ean: string) => void;
}

const PAGE_SIZE = 50;

export const MasterDatabasePage: React.FC<MasterDatabasePageProps> = ({
  onNavigate,
  onViewBatches,
}) => {
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);

  const [modalOpen, setModalOpen] = useState(false);
  const [editingProduct, setEditingProduct] = useState<MasterProduct | null>(null);
  const [formEan, setFormEan] = useState('');
  const [formCode, setFormCode] = useState('');
  const [formDesc, setFormDesc] = useState('');
  const [formErrors, setFormErrors] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);

  const [deletingProduct, setDeletingProduct] = useState<MasterProduct | null>(
    null
  );

  const totalCount = useLiveQuery(() => db.masterProducts.count(), [], 0);

  // Indexed / paged query that stays fast even with 10,000+ master products
  const queryResult = useLiveQuery(
    async () => {
      const q = search.trim().toLowerCase();
      if (!q) {
        const total = await db.masterProducts.count();
        const items = await db.masterProducts
          .orderBy('id')
          .reverse()
          .offset((page - 1) * PAGE_SIZE)
          .limit(PAGE_SIZE)
          .toArray();
        return { total, items };
      }

      const matched: MasterProduct[] = [];
      await db.masterProducts.each((item) => {
        if (
          item.ean.toLowerCase().includes(q) ||
          item.productCode.toLowerCase().includes(q) ||
          item.description.toLowerCase().includes(q)
        ) {
          matched.push(item);
        }
      });

      const start = (page - 1) * PAGE_SIZE;
      return {
        total: matched.length,
        items: matched.slice(start, start + PAGE_SIZE),
      };
    },
    [search, page],
    { total: 0, items: [] as MasterProduct[] }
  );

  const totalPages = Math.max(1, Math.ceil(queryResult.total / PAGE_SIZE));

  useEffect(() => {
    if (page > totalPages) setPage(totalPages);
  }, [page, totalPages]);

  const openAddModal = () => {
    setEditingProduct(null);
    setFormEan('');
    setFormCode('');
    setFormDesc('');
    setFormErrors({});
    setModalOpen(true);
  };

  const openEditModal = (product: MasterProduct) => {
    setEditingProduct(product);
    setFormEan(product.ean);
    setFormCode(product.productCode);
    setFormDesc(product.description);
    setFormErrors({});
    setModalOpen(true);
  };

  const handleSaveProduct = async (e: React.FormEvent) => {
    e.preventDefault();
    const cleanEan = normalizeBarcodeText(formEan);
    const check = validateMasterProductInput({
      ean: cleanEan,
      productCode: formCode,
      description: formDesc,
    });
    if (!check.valid) {
      setFormErrors(check.errors);
      return;
    }

    setSaving(true);
    try {
      if (editingProduct?.id !== undefined) {
        // Check duplicate EAN if changed
        if (cleanEan !== editingProduct.ean) {
          const conflict = await db.masterProducts
            .where('ean')
            .equals(cleanEan)
            .first();
          if (conflict && conflict.id !== editingProduct.id) {
            setFormErrors({
              ean: `Another product already uses EAN ${cleanEan}.`,
            });
            return;
          }
        }
        await updateMasterProductSafely(editingProduct.id, {
          ean: cleanEan,
          productCode: formCode,
          description: formDesc,
        });
      } else {
        const existing = await db.masterProducts
          .where('ean')
          .equals(cleanEan)
          .first();
        if (existing) {
          setFormErrors({
            ean: `EAN ${cleanEan} already exists (${existing.description}).`,
          });
          return;
        }
        await upsertMasterProduct({
          ean: cleanEan,
          productCode: formCode,
          description: formDesc,
        });
      }
      setModalOpen(false);
    } finally {
      setSaving(false);
    }
  };

  const handleConfirmDelete = async () => {
    if (deletingProduct?.id !== undefined) {
      await deleteMasterProductSafely(deletingProduct.id);
    }
    setDeletingProduct(null);
  };

  const handleExportMaster = async () => {
    const all = await db.masterProducts.toArray();
    const wb = buildMasterDatabaseWorkbook(all);
    triggerWorkbookDownload(
      wb,
      `master-product-database-${getLocalTodayISO()}.xlsx`
    );
  };

  return (
    <div className="space-y-5">
      <div className="rounded-xl border border-slate-200 bg-white p-5">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
          <div>
            <h2 className="text-lg font-bold text-slate-900">
              Master Product Database
            </h2>
            <p className="mt-0.5 text-xs text-slate-600 tabular-nums">
              {totalCount.toLocaleString()} total master products stored offline · Updating master info preserves all existing expiry batches
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              onClick={openAddModal}
              className="inline-flex min-h-[44px] items-center gap-1.5 whitespace-nowrap rounded-lg bg-blue-600 px-3.5 py-2 text-xs font-semibold text-white hover:bg-blue-700"
            >
              <Plus className="h-4 w-4" />
              <span>Add Product</span>
            </button>
            <button
              type="button"
              onClick={() => onNavigate('excel')}
              className="inline-flex min-h-[44px] items-center gap-1.5 whitespace-nowrap rounded-lg border border-slate-300 bg-white px-3.5 py-2 text-xs font-semibold text-slate-800 hover:bg-slate-50"
            >
              <Upload className="h-4 w-4" />
              <span>Import Excel</span>
            </button>
            <button
              type="button"
              onClick={() => void handleExportMaster()}
              disabled={totalCount === 0}
              className="inline-flex min-h-[44px] items-center gap-1.5 whitespace-nowrap rounded-lg border border-slate-300 bg-white px-3.5 py-2 text-xs font-semibold text-slate-800 hover:bg-slate-50 disabled:opacity-50"
            >
              <FileSpreadsheet className="h-4 w-4 text-emerald-600" />
              <span>Export Excel</span>
            </button>
          </div>
        </div>

        <div className="relative mt-4 max-w-lg">
          <Search className="pointer-events-none absolute left-3.5 top-3.5 h-4 w-4 text-slate-400" />
          <input
            type="search"
            aria-label="Search Master Database"
            placeholder="Search EAN Number, Product Code, or Description..."
            value={search}
            onChange={(e) => {
              setSearch(e.target.value);
              setPage(1);
            }}
            className="min-h-[44px] w-full rounded-lg border border-slate-300 pl-10 pr-3.5 text-sm text-slate-900 focus:border-blue-600 focus:outline-none focus:ring-1 focus:ring-blue-600"
          />
        </div>
      </div>

      <div className="rounded-xl border border-slate-200 bg-white">
        {queryResult.items.length === 0 ? (
          <div className="px-5 py-12 text-center text-sm text-slate-500">
            {totalCount === 0
              ? 'Master Database is empty. Import your company Excel file or add products manually.'
              : 'No master products match your search query.'}
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead>
                <tr className="border-b border-slate-200 bg-slate-50/80 text-xs font-semibold text-slate-600">
                  <th className="px-5 py-3">EAN Number</th>
                  <th className="px-4 py-3">Product Code</th>
                  <th className="px-4 py-3">Product Description</th>
                  <th className="px-5 py-3 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {queryResult.items.map((product) => (
                  <tr key={product.id} className="hover:bg-slate-50/70">
                    <td className="px-5 py-3 font-mono text-xs font-medium text-slate-800">
                      {product.ean}
                    </td>
                    <td className="px-4 py-3 font-mono text-xs font-semibold text-slate-900">
                      {product.productCode}
                    </td>
                    <td className="px-4 py-3 font-medium text-slate-900">
                      {product.description}
                    </td>
                    <td className="px-5 py-3 text-right">
                      <div className="inline-flex items-center gap-1">
                        <button
                          type="button"
                          onClick={() => onViewBatches(product.ean)}
                          className="mr-1 min-h-[36px] whitespace-nowrap rounded-lg border border-slate-200 px-2.5 text-xs font-semibold text-slate-700 hover:bg-slate-100 hover:text-slate-900"
                        >
                          Batches
                        </button>
                        <button
                          type="button"
                          onClick={() => openEditModal(product)}
                          aria-label={`Edit ${product.description}`}
                          className="inline-flex min-h-[40px] min-w-[40px] items-center justify-center rounded-lg text-slate-600 hover:bg-slate-100 hover:text-blue-600"
                        >
                          <Edit2 className="h-4 w-4" />
                        </button>
                        <button
                          type="button"
                          onClick={() => setDeletingProduct(product)}
                          aria-label={`Delete ${product.description}`}
                          className="inline-flex min-h-[40px] min-w-[40px] items-center justify-center rounded-lg text-slate-600 hover:bg-red-50 hover:text-red-600"
                        >
                          <Trash2 className="h-4 w-4" />
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {totalPages > 1 && (
          <div className="flex items-center justify-between border-t border-slate-200 px-5 py-3 text-xs text-slate-600">
            <span className="tabular-nums">
              Page {page} of {totalPages} ({queryResult.total.toLocaleString()} matching)
            </span>
            <div className="flex gap-2">
              <button
                type="button"
                disabled={page <= 1}
                onClick={() => setPage((p) => Math.max(1, p - 1))}
                className="min-h-[36px] rounded-lg border border-slate-300 bg-white px-3 font-semibold text-slate-700 disabled:opacity-50"
              >
                Previous
              </button>
              <button
                type="button"
                disabled={page >= totalPages}
                onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                className="min-h-[36px] rounded-lg border border-slate-300 bg-white px-3 font-semibold text-slate-700 disabled:opacity-50"
              >
                Next
              </button>
            </div>
          </div>
        )}
      </div>

      {/* Add / Edit Master Product Modal */}
      {modalOpen && (
        <div
          className="fixed inset-0 z-50 flex items-end justify-center bg-slate-900/50 p-0 sm:items-center sm:p-4"
          role="dialog"
          aria-modal="true"
          aria-labelledby="master-modal-title"
        >
          <div className="w-full max-w-md rounded-t-2xl border border-slate-200 bg-white p-6 shadow-xl sm:rounded-xl">
            <div className="flex items-center justify-between border-b border-slate-200 pb-4">
              <h3
                id="master-modal-title"
                className="text-base font-bold text-slate-900"
              >
                {editingProduct ? 'Edit Master Product' : 'Add Master Product'}
              </h3>
              <button
                type="button"
                onClick={() => setModalOpen(false)}
                aria-label="Close product modal"
                className="flex min-h-[44px] min-w-[44px] items-center justify-center rounded-lg text-slate-500 hover:bg-slate-100"
              >
                <X className="h-5 w-5" />
              </button>
            </div>

            <form onSubmit={handleSaveProduct} className="mt-4 space-y-4">
              <div>
                <label
                  htmlFor="master-form-ean"
                  className="block text-xs font-semibold text-slate-700"
                >
                  EAN Number *
                </label>
                <input
                  id="master-form-ean"
                  type="text"
                  value={formEan}
                  onChange={(e) => {
                    setFormEan(e.target.value);
                    setFormErrors((p) => ({ ...p, ean: '' }));
                  }}
                  placeholder="Preserves leading zeros"
                  className="mt-1.5 min-h-[44px] w-full rounded-lg border border-slate-300 px-3 font-mono text-sm text-slate-900 focus:border-blue-600 focus:outline-none"
                />
                {formErrors.ean && (
                  <p className="mt-1 text-xs text-red-600">{formErrors.ean}</p>
                )}
              </div>

              <div>
                <label
                  htmlFor="master-form-code"
                  className="block text-xs font-semibold text-slate-700"
                >
                  Product Code *
                </label>
                <input
                  id="master-form-code"
                  type="text"
                  value={formCode}
                  onChange={(e) => {
                    setFormCode(e.target.value);
                    setFormErrors((p) => ({ ...p, productCode: '' }));
                  }}
                  className="mt-1.5 min-h-[44px] w-full rounded-lg border border-slate-300 px-3 font-mono text-sm text-slate-900 focus:border-blue-600 focus:outline-none"
                />
                {formErrors.productCode && (
                  <p className="mt-1 text-xs text-red-600">
                    {formErrors.productCode}
                  </p>
                )}
              </div>

              <div>
                <label
                  htmlFor="master-form-desc"
                  className="block text-xs font-semibold text-slate-700"
                >
                  Product Description *
                </label>
                <input
                  id="master-form-desc"
                  type="text"
                  value={formDesc}
                  onChange={(e) => {
                    setFormDesc(e.target.value);
                    setFormErrors((p) => ({ ...p, description: '' }));
                  }}
                  className="mt-1.5 min-h-[44px] w-full rounded-lg border border-slate-300 px-3 text-sm text-slate-900 focus:border-blue-600 focus:outline-none"
                />
                {formErrors.description && (
                  <p className="mt-1 text-xs text-red-600">
                    {formErrors.description}
                  </p>
                )}
              </div>

              <div className="flex flex-col-reverse gap-2 border-t border-slate-200 pt-4 sm:flex-row sm:justify-end">
                <button
                  type="button"
                  onClick={() => setModalOpen(false)}
                  className="min-h-[44px] rounded-lg border border-slate-300 px-4 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={saving}
                  className="min-h-[44px] rounded-lg bg-blue-600 px-5 py-2 text-sm font-semibold text-white hover:bg-blue-700 disabled:opacity-60"
                >
                  {saving ? 'Saving...' : 'Save Product'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      <ConfirmDialog
        open={Boolean(deletingProduct)}
        title="Delete Master Product"
        message={
          deletingProduct
            ? `Delete "${deletingProduct.description}" (EAN ${deletingProduct.ean}) from the Master Database? Existing expiry batches will remain untouched.`
            : ''
        }
        confirmLabel="Delete Product"
        onConfirm={() => void handleConfirmDelete()}
        onCancel={() => setDeletingProduct(null)}
      />
    </div>
  );
};
