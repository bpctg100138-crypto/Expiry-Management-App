import React, { useMemo, useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { Edit2, FileSpreadsheet, Search, Trash2 } from 'lucide-react';
import { ConfirmDialog } from '../components/ConfirmDialog';
import { EditBatchModal } from '../components/EditBatchModal';
import { db } from '../db/database';
import type { ExpiryBatch, ExpirySeverity } from '../types/inventory';
import {
  buildCompleteExpiryWorkbook,
  triggerWorkbookDownload,
} from '../utils/excelParser';
import {
  calculateDaysRemaining,
  classifyExpiryStatus,
  formatDisplayDate,
  getLocalTodayISO,
} from '../utils/expiryCalculations';

const PAGE_SIZE = 50;

interface ExpiryRecordsPageProps {
  initialSearch?: string;
}

export const ExpiryRecordsPage: React.FC<ExpiryRecordsPageProps> = ({
  initialSearch = '',
}) => {
  const allBatches = useLiveQuery(() => db.expiryBatches.toArray(), [], []);
  const [search, setSearch] = useState(initialSearch);
  const [statusFilter, setStatusFilter] = useState<'all' | ExpirySeverity>('all');
  const [sortBy, setSortBy] = useState<'nearest' | 'newest' | 'quantity'>('nearest');
  const [page, setPage] = useState(1);

  const [editingBatch, setEditingBatch] = useState<ExpiryBatch | null>(null);
  const [deletingBatch, setDeletingBatch] = useState<ExpiryBatch | null>(null);

  const todayISO = getLocalTodayISO();

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    const enriched = allBatches.map((batch) => {
      const daysRemaining = calculateDaysRemaining(batch.expiryDate, todayISO);
      const status = classifyExpiryStatus(daysRemaining);
      return { batch, daysRemaining, status };
    });

    const matched = enriched.filter(({ batch, status }) => {
      if (statusFilter !== 'all' && status.severity !== statusFilter) {
        return false;
      }
      if (!q) return true;
      return (
        batch.ean.toLowerCase().includes(q) ||
        batch.productCode.toLowerCase().includes(q) ||
        batch.description.toLowerCase().includes(q) ||
        (batch.originalScannedBarcode ?? '').toLowerCase().includes(q)
      );
    });

    matched.sort((a, b) => {
      if (sortBy === 'nearest') {
        return a.daysRemaining - b.daysRemaining;
      }
      if (sortBy === 'quantity') {
        return b.batch.quantity - a.batch.quantity;
      }
      return (b.batch.createdAt || '').localeCompare(a.batch.createdAt || '');
    });

    return matched;
  }, [allBatches, search, statusFilter, sortBy, todayISO]);

  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const safePage = Math.min(page, totalPages);
  const pagedRows = filtered.slice(
    (safePage - 1) * PAGE_SIZE,
    safePage * PAGE_SIZE
  );

  const totalQuantityFiltered = useMemo(
    () => filtered.reduce((acc, item) => acc + (Number(item.batch.quantity) || 0), 0),
    [filtered]
  );

  const handleSaveEdit = async (
    id: number,
    updates: {
      ean: string;
      productCode: string;
      description: string;
      expiryDate: string;
      quantity: number;
    }
  ) => {
    await db.expiryBatches.update(id, {
      ...updates,
      updatedAt: new Date().toISOString(),
    });
  };

  const handleConfirmDelete = async () => {
    if (deletingBatch?.id !== undefined) {
      await db.expiryBatches.delete(deletingBatch.id);
    }
    setDeletingBatch(null);
  };

  const handleExportAll = () => {
    const wb = buildCompleteExpiryWorkbook(filtered.map((f) => f.batch));
    triggerWorkbookDownload(wb, `complete-expiry-database-${todayISO}.xlsx`);
  };

  return (
    <div className="space-y-5">
      {/* Header & Controls */}
      <div className="rounded-xl border border-slate-200 bg-white p-5">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h2 className="text-lg font-bold text-slate-900">
              All Expiry Records & Universal Search
            </h2>
            <p className="mt-0.5 text-xs text-slate-500 tabular-nums">
              Showing {filtered.length.toLocaleString()} batches · Total Qty:{' '}
              {totalQuantityFiltered.toLocaleString()}
            </p>
          </div>
          <button
            type="button"
            onClick={handleExportAll}
            disabled={filtered.length === 0}
            className="inline-flex min-h-[44px] items-center gap-2 self-start whitespace-nowrap rounded-lg border border-slate-300 bg-white px-4 py-2 text-xs font-semibold text-slate-800 hover:bg-slate-50 disabled:opacity-50 sm:self-auto"
          >
            <FileSpreadsheet className="h-4 w-4 text-emerald-600" />
            <span>Export Excel (.xlsx)</span>
          </button>
        </div>

        <div className="mt-4 grid grid-cols-1 gap-3 md:grid-cols-12">
          <div className="relative md:col-span-6">
            <Search className="pointer-events-none absolute left-3.5 top-3.5 h-4 w-4 text-slate-400" />
            <input
              type="search"
              aria-label="Search batches by EAN, Product Code, Article Number, or Description"
              placeholder="Search EAN, Product Code, Article #, or Description..."
              value={search}
              onChange={(e) => {
                setSearch(e.target.value);
                setPage(1);
              }}
              className="min-h-[44px] w-full rounded-lg border border-slate-300 pl-10 pr-3.5 text-sm text-slate-900 focus:border-blue-600 focus:outline-none focus:ring-1 focus:ring-blue-600"
            />
          </div>

          <div className="md:col-span-3">
            <select
              aria-label="Filter by expiry window"
              value={statusFilter}
              onChange={(e) => {
                setStatusFilter(e.target.value as 'all' | ExpirySeverity);
                setPage(1);
              }}
              className="min-h-[44px] w-full rounded-lg border border-slate-300 bg-white px-3 text-sm text-slate-800 focus:border-blue-600 focus:outline-none"
            >
              <option value="all">All Statuses</option>
              <option value="expired">Already Expired</option>
              <option value="critical_30">0-30 Days</option>
              <option value="warning_60">31-60 Days</option>
              <option value="upcoming_90">61-90 Days</option>
              <option value="safe">Above 90 Days</option>
            </select>
          </div>

          <div className="md:col-span-3">
            <select
              aria-label="Sort batches"
              value={sortBy}
              onChange={(e) =>
                setSortBy(e.target.value as 'nearest' | 'newest' | 'quantity')
              }
              className="min-h-[44px] w-full rounded-lg border border-slate-300 bg-white px-3 text-sm text-slate-800 focus:border-blue-600 focus:outline-none"
            >
              <option value="nearest">Sort: Nearest Expiry</option>
              <option value="newest">Sort: Recently Added</option>
              <option value="quantity">Sort: Highest Quantity</option>
            </select>
          </div>
        </div>
      </div>

      {/* Table */}
      <div className="rounded-xl border border-slate-200 bg-white">
        {pagedRows.length === 0 ? (
          <div className="px-5 py-10 text-center text-sm text-slate-500">
            No expiry batches match your current search or filter.
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead>
                <tr className="border-b border-slate-200 bg-slate-50/80 text-xs font-semibold text-slate-600">
                  <th className="px-5 py-3">EAN Number</th>
                  <th className="px-4 py-3">Product Code</th>
                  <th className="px-4 py-3">Product Description</th>
                  <th className="px-4 py-3">Expiry Date</th>
                  <th className="px-4 py-3 text-right">Quantity</th>
                  <th className="px-4 py-3">Status</th>
                  <th className="px-5 py-3 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {pagedRows.map(({ batch, status }) => (
                  <tr key={batch.id} className="hover:bg-slate-50/70">
                    <td className="px-5 py-3 font-mono text-xs text-slate-700">
                      <div>{batch.ean || '—'}</div>
                      {batch.originalScannedBarcode &&
                        batch.correctedEan &&
                        batch.originalScannedBarcode !== batch.correctedEan && (
                          <div className="text-[11px] text-slate-400">
                            Orig: {batch.originalScannedBarcode}
                          </div>
                        )}
                    </td>
                    <td className="px-4 py-3 font-mono text-xs font-semibold text-slate-800">
                      {batch.productCode}
                    </td>
                    <td className="px-4 py-3 font-medium text-slate-900">
                      {batch.description}
                    </td>
                    <td className="px-4 py-3 font-mono text-xs tabular-nums text-slate-800">
                      {formatDisplayDate(batch.expiryDate)}
                    </td>
                    <td className="px-4 py-3 text-right font-mono text-sm font-bold tabular-nums text-slate-900">
                      {batch.quantity}
                    </td>
                    <td className="px-4 py-3">
                      <span className={`text-xs font-semibold ${status.badgeTextClass}`}>
                        {status.label}
                      </span>
                    </td>
                    <td className="px-5 py-3 text-right">
                      <div className="inline-flex items-center gap-1">
                        <button
                          type="button"
                          onClick={() => setEditingBatch(batch)}
                          aria-label={`Edit batch for ${batch.description}`}
                          className="inline-flex min-h-[40px] min-w-[40px] items-center justify-center rounded-lg text-slate-600 hover:bg-slate-100 hover:text-blue-600"
                        >
                          <Edit2 className="h-4 w-4" />
                        </button>
                        <button
                          type="button"
                          onClick={() => setDeletingBatch(batch)}
                          aria-label={`Delete batch for ${batch.description}`}
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
              Page {safePage} of {totalPages}
            </span>
            <div className="flex gap-2">
              <button
                type="button"
                disabled={safePage <= 1}
                onClick={() => setPage((p) => Math.max(1, p - 1))}
                className="min-h-[36px] rounded-lg border border-slate-300 bg-white px-3 font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-50"
              >
                Previous
              </button>
              <button
                type="button"
                disabled={safePage >= totalPages}
                onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                className="min-h-[36px] rounded-lg border border-slate-300 bg-white px-3 font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-50"
              >
                Next
              </button>
            </div>
          </div>
        )}
      </div>

      <EditBatchModal
        batch={editingBatch}
        onClose={() => setEditingBatch(null)}
        onSave={handleSaveEdit}
      />

      <ConfirmDialog
        open={Boolean(deletingBatch)}
        title="Delete Expiry Batch"
        message={
          deletingBatch
            ? `Delete batch for "${deletingBatch.description}" expiring on ${formatDisplayDate(
                deletingBatch.expiryDate
              )} (Qty ${deletingBatch.quantity})? Other batches for this product will not be affected.`
            : ''
        }
        confirmLabel="Delete Batch"
        onConfirm={() => void handleConfirmDelete()}
        onCancel={() => setDeletingBatch(null)}
      />
    </div>
  );
};
