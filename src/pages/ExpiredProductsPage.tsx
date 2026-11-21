import React, { useMemo, useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { AlertCircle, Edit2, FileSpreadsheet, Search, Trash2 } from 'lucide-react';
import { ConfirmDialog } from '../components/ConfirmDialog';
import { EditBatchModal } from '../components/EditBatchModal';
import { db } from '../db/database';
import type { ExpiryBatch } from '../types/inventory';
import {
  buildExpiredWorkbook,
  triggerWorkbookDownload,
} from '../utils/excelParser';
import {
  formatDisplayDate,
  getExpiredBatches,
  getLocalTodayISO,
} from '../utils/expiryCalculations';

export const ExpiredProductsPage: React.FC = () => {
  const allBatches = useLiveQuery(() => db.expiryBatches.toArray(), [], []);
  const [search, setSearch] = useState('');
  const [editingBatch, setEditingBatch] = useState<ExpiryBatch | null>(null);
  const [deletingBatch, setDeletingBatch] = useState<ExpiryBatch | null>(null);

  const todayISO = getLocalTodayISO();

  const expiredRows = useMemo(() => {
    const base = getExpiredBatches(allBatches, todayISO);
    const q = search.trim().toLowerCase();
    if (!q) return base;
    return base.filter(
      (b) =>
        b.ean.toLowerCase().includes(q) ||
        b.productCode.toLowerCase().includes(q) ||
        b.description.toLowerCase().includes(q)
    );
  }, [allBatches, todayISO, search]);

  const totalExpiredQty = useMemo(
    () => expiredRows.reduce((sum, r) => sum + (Number(r.quantity) || 0), 0),
    [expiredRows]
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

  const handleExport = () => {
    const wb = buildExpiredWorkbook(allBatches, todayISO);
    triggerWorkbookDownload(wb, `expired-products-report-${todayISO}.xlsx`);
  };

  return (
    <div className="space-y-5">
      <div className="rounded-xl border border-red-200 bg-white p-5">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h2 className="text-lg font-bold text-slate-900">
              Expired Products Report
            </h2>
            <p className="mt-0.5 text-xs text-slate-600 tabular-nums">
              {expiredRows.length.toLocaleString()} expired batches sorted oldest expiry first · Total Expired Quantity:{' '}
              <span className="font-mono font-bold text-red-700">
                {totalExpiredQty.toLocaleString()}
              </span>
            </p>
          </div>
          <button
            type="button"
            onClick={handleExport}
            disabled={expiredRows.length === 0}
            className="inline-flex min-h-[44px] items-center gap-2 self-start whitespace-nowrap rounded-lg bg-red-600 px-4 py-2 text-xs font-semibold text-white hover:bg-red-700 disabled:opacity-50 sm:self-auto"
          >
            <FileSpreadsheet className="h-4 w-4" />
            <span>Export Expired Excel</span>
          </button>
        </div>

        <div className="relative mt-4 max-w-md">
          <Search className="pointer-events-none absolute left-3.5 top-3.5 h-4 w-4 text-slate-400" />
          <input
            type="search"
            aria-label="Search expired batches"
            placeholder="Search EAN, Product Code, or Description..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="min-h-[44px] w-full rounded-lg border border-slate-300 pl-10 pr-3.5 text-sm text-slate-900 focus:border-blue-600 focus:outline-none focus:ring-1 focus:ring-blue-600"
          />
        </div>
      </div>

      <div className="rounded-xl border border-slate-200 bg-white">
        {expiredRows.length === 0 ? (
          <div className="flex flex-col items-center justify-center px-5 py-12 text-center">
            <AlertCircle className="h-9 w-9 text-emerald-500" />
            <p className="mt-2 text-sm font-medium text-slate-700">
              No expired batches found.
            </p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead>
                <tr className="border-b border-slate-200 bg-slate-50/80 text-xs font-semibold text-slate-600">
                  <th className="px-5 py-3">EAN</th>
                  <th className="px-4 py-3">Product Code</th>
                  <th className="px-4 py-3">Description</th>
                  <th className="px-4 py-3">Expiry Date</th>
                  <th className="px-4 py-3 text-right">Quantity</th>
                  <th className="px-4 py-3 text-right">Days Expired</th>
                  <th className="px-5 py-3 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {expiredRows.map((row) => (
                  <tr key={row.id} className="hover:bg-red-50/30">
                    <td className="px-5 py-3 font-mono text-xs text-slate-700">
                      {row.ean || '—'}
                    </td>
                    <td className="px-4 py-3 font-mono text-xs font-semibold text-slate-800">
                      {row.productCode}
                    </td>
                    <td className="px-4 py-3 font-medium text-slate-900">
                      {row.description}
                    </td>
                    <td className="px-4 py-3 font-mono text-xs tabular-nums text-red-700">
                      {formatDisplayDate(row.expiryDate)}
                    </td>
                    <td className="px-4 py-3 text-right font-mono text-sm font-bold tabular-nums text-slate-900">
                      {row.quantity}
                    </td>
                    <td className="px-4 py-3 text-right font-mono text-xs font-bold tabular-nums text-red-700">
                      {row.daysExpired}d ago
                    </td>
                    <td className="px-5 py-3 text-right">
                      <div className="inline-flex items-center gap-1">
                        <button
                          type="button"
                          onClick={() => setEditingBatch(row)}
                          aria-label={`Edit expired batch for ${row.description}`}
                          className="inline-flex min-h-[40px] min-w-[40px] items-center justify-center rounded-lg text-slate-600 hover:bg-slate-100 hover:text-blue-600"
                        >
                          <Edit2 className="h-4 w-4" />
                        </button>
                        <button
                          type="button"
                          onClick={() => setDeletingBatch(row)}
                          aria-label={`Delete expired batch for ${row.description}`}
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
      </div>

      <EditBatchModal
        batch={editingBatch}
        onClose={() => setEditingBatch(null)}
        onSave={handleSaveEdit}
      />

      <ConfirmDialog
        open={Boolean(deletingBatch)}
        title="Remove Expired Batch"
        message={
          deletingBatch
            ? `Remove expired batch for "${deletingBatch.description}" (${formatDisplayDate(
                deletingBatch.expiryDate
              )}, Qty ${deletingBatch.quantity})?`
            : ''
        }
        confirmLabel="Remove Batch"
        onConfirm={() => void handleConfirmDelete()}
        onCancel={() => setDeletingBatch(null)}
      />
    </div>
  );
};
