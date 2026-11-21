import React, { useMemo, useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import {
  AlertCircle,
  ArrowRight,
  CalendarClock,
  CheckCircle2,
  Database,
  FileSpreadsheet,
  Package,
  PlusCircle,
  ScanBarcode,
  Sparkles,
} from 'lucide-react';
import { db, loadSampleRetailDataset } from '../db/database';
import type { NavRoute } from '../types/inventory';
import {
  classifyExpiryStatus,
  computeDashboardMetrics,
  formatDisplayDate,
  getLocalTodayISO,
  getUpcoming90Batches,
} from '../utils/expiryCalculations';

interface DashboardPageProps {
  onNavigate: (route: NavRoute) => void;
}

export const DashboardPage: React.FC<DashboardPageProps> = ({ onNavigate }) => {
  const masterCount = useLiveQuery(() => db.masterProducts.count(), [], 0);
  const batches = useLiveQuery(() => db.expiryBatches.toArray(), [], []);
  const [seeding, setSeeding] = useState(false);
  const [seedMessage, setSeedMessage] = useState<string | null>(null);

  const todayISO = getLocalTodayISO();

  const metrics = useMemo(
    () => computeDashboardMetrics(batches, masterCount, todayISO),
    [batches, masterCount, todayISO]
  );

  const urgentItems = useMemo(
    () => getUpcoming90Batches(batches, todayISO).slice(0, 6),
    [batches, todayISO]
  );

  const handleLoadSample = async () => {
    setSeeding(true);
    try {
      const res = await loadSampleRetailDataset();
      setSeedMessage(
        `Loaded ${res.masterAdded} master products and ${res.batchesAdded} expiry batches.`
      );
    } finally {
      setSeeding(false);
    }
  };

  const isEmpty = masterCount === 0 && batches.length === 0;

  return (
    <div className="space-y-6">
      {/* Primary Action Strip */}
      <div className="flex flex-col gap-4 rounded-xl border border-slate-200 bg-white p-5 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h2 className="text-lg font-bold text-slate-900">
            Inventory Expiry Overview
          </h2>
          <p className="mt-0.5 text-sm text-slate-600">
            Local calendar date: <span className="font-mono font-medium text-slate-800">{formatDisplayDate(todayISO)}</span> · All data stored offline on this device
          </p>
        </div>
        <div className="flex flex-wrap gap-2.5">
          <button
            type="button"
            onClick={() => onNavigate('scan')}
            className="inline-flex min-h-[44px] items-center gap-2 whitespace-nowrap rounded-lg bg-blue-600 px-4 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-blue-700"
          >
            <ScanBarcode className="h-4 w-4 shrink-0" />
            <span>Scan Barcode</span>
          </button>
          <button
            type="button"
            onClick={() => onNavigate('manual')}
            className="inline-flex min-h-[44px] items-center gap-2 whitespace-nowrap rounded-lg border border-slate-300 bg-white px-4 py-2.5 text-sm font-semibold text-slate-800 transition-colors hover:bg-slate-50"
          >
            <PlusCircle className="h-4 w-4 shrink-0" />
            <span>Manual Entry</span>
          </button>
        </div>
      </div>

      {seedMessage && (
        <div
          role="status"
          className="flex items-center justify-between gap-3 rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm font-medium text-emerald-800"
        >
          <div className="flex items-center gap-2">
            <CheckCircle2 className="h-4 w-4 shrink-0 text-emerald-600" />
            <span>{seedMessage}</span>
          </div>
          <button
            type="button"
            onClick={() => setSeedMessage(null)}
            className="text-xs font-semibold text-emerald-700 underline"
          >
            Dismiss
          </button>
        </div>
      )}

      {isEmpty && (
        <div className="rounded-xl border border-slate-200 bg-white p-6">
          <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
            <div className="max-w-xl">
              <h3 className="text-base font-bold text-slate-900">
                Get Started with Retail Expiry Manager
              </h3>
              <p className="mt-1 text-sm leading-relaxed text-slate-600">
                Upload your company Master Product Excel file (EAN Number, Product Code, Product Description) to enable instant barcode auto-matching, or load a sample retail dataset to test scanning and reports immediately.
              </p>
            </div>
            <div className="flex flex-wrap gap-3 shrink-0">
              <button
                type="button"
                onClick={() => onNavigate('excel')}
                className="inline-flex min-h-[44px] items-center gap-2 whitespace-nowrap rounded-lg bg-slate-900 px-4 py-2.5 text-sm font-semibold text-white hover:bg-slate-800"
              >
                <FileSpreadsheet className="h-4 w-4 shrink-0" />
                <span>Import Master Excel</span>
              </button>
              <button
                type="button"
                onClick={() => void handleLoadSample()}
                disabled={seeding}
                className="inline-flex min-h-[44px] items-center gap-2 whitespace-nowrap rounded-lg border border-slate-300 bg-white px-4 py-2.5 text-sm font-semibold text-slate-800 hover:bg-slate-50 disabled:opacity-60"
              >
                <Sparkles className="h-4 w-4 shrink-0 text-blue-600" />
                <span>{seeding ? 'Loading...' : 'Load Sample Dataset'}</span>
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Primary Inventory Totals */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 sm:gap-4">
        <button
          type="button"
          onClick={() => onNavigate('master')}
          className="flex flex-col justify-between rounded-xl border border-slate-200 bg-white p-4 text-left transition-colors hover:border-slate-300 hover:bg-slate-50/50 sm:p-5"
        >
          <div className="flex items-center justify-between text-xs font-semibold text-slate-500">
            <span>Master Products</span>
            <Database className="h-4 w-4 text-slate-400" />
          </div>
          <div className="mt-2 text-2xl font-bold tabular-nums text-slate-900 sm:mt-3 sm:text-3xl">
            {metrics.totalMasterProducts.toLocaleString()}
          </div>
          <div className="mt-1.5 flex items-center gap-1 text-xs font-medium text-blue-600">
            <span>Manage Catalog</span>
            <ArrowRight className="h-3.5 w-3.5" />
          </div>
        </button>

        <button
          type="button"
          onClick={() => onNavigate('records')}
          className="flex flex-col justify-between rounded-xl border border-slate-200 bg-white p-4 text-left transition-colors hover:border-slate-300 hover:bg-slate-50/50 sm:p-5"
        >
          <div className="flex items-center justify-between text-xs font-semibold text-slate-500">
            <span>Expiry Batches</span>
            <CalendarClock className="h-4 w-4 text-slate-400" />
          </div>
          <div className="mt-2 text-2xl font-bold tabular-nums text-slate-900 sm:mt-3 sm:text-3xl">
            {metrics.totalExpiryBatches.toLocaleString()}
          </div>
          <div className="mt-1.5 flex items-center gap-1 text-xs font-medium text-blue-600">
            <span>View All Batches</span>
            <ArrowRight className="h-3.5 w-3.5" />
          </div>
        </button>

        <div className="col-span-2 flex flex-col justify-between rounded-xl border border-slate-200 bg-white p-4 sm:col-span-1 sm:p-5">
          <div className="flex items-center justify-between text-xs font-semibold text-slate-500">
            <span>Total Stock Quantity</span>
            <Package className="h-4 w-4 text-slate-400" />
          </div>
          <div className="mt-2 text-2xl font-bold tabular-nums text-slate-900 sm:mt-3 sm:text-3xl">
            {metrics.totalStockQuantity.toLocaleString()}
          </div>
          <div className="mt-1.5 text-xs text-slate-500">
            Units across all logged expiry batches
          </div>
        </div>
      </div>

      {/* Expiry Window Cards */}
      <div className="grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-4">
        <button
          type="button"
          onClick={() => onNavigate('expired')}
          className="rounded-xl border border-red-200 bg-red-50/70 p-4 text-left transition-colors hover:bg-red-50 sm:p-5"
        >
          <div className="flex items-center justify-between gap-1">
            <span className="text-xs font-bold text-red-800">Already Expired</span>
            <AlertCircle className="h-4 w-4 shrink-0 text-red-600" />
          </div>
          <div className="mt-2 text-2xl font-bold tabular-nums text-red-700 sm:mt-3 sm:text-3xl">
            {metrics.expiredBatches.toLocaleString()}
          </div>
          <div className="mt-1 text-xs font-medium tabular-nums text-red-800">
            {metrics.expiredQuantity.toLocaleString()} units · Expired
          </div>
        </button>

        <button
          type="button"
          onClick={() => onNavigate('upcoming')}
          className="rounded-xl border border-orange-200 bg-orange-50/70 p-4 text-left transition-colors hover:bg-orange-50 sm:p-5"
        >
          <div className="flex items-center justify-between gap-1">
            <span className="text-xs font-bold text-orange-900">
              Within 30 Days
            </span>
            <span className="text-xs font-semibold text-orange-700">0-30d</span>
          </div>
          <div className="mt-2 text-2xl font-bold tabular-nums text-orange-700 sm:mt-3 sm:text-3xl">
            {metrics.within30Batches.toLocaleString()}
          </div>
          <div className="mt-1 text-xs font-medium tabular-nums text-orange-800">
            {metrics.within30Quantity.toLocaleString()} units · Critical
          </div>
        </button>

        <button
          type="button"
          onClick={() => onNavigate('upcoming')}
          className="rounded-xl border border-amber-200 bg-amber-50/70 p-4 text-left transition-colors hover:bg-amber-50 sm:p-5"
        >
          <div className="flex items-center justify-between gap-1">
            <span className="text-xs font-bold text-amber-900">
              Within 60 Days
            </span>
            <span className="text-xs font-semibold text-amber-700">0-60d</span>
          </div>
          <div className="mt-2 text-2xl font-bold tabular-nums text-amber-700 sm:mt-3 sm:text-3xl">
            {metrics.within60Batches.toLocaleString()}
          </div>
          <div className="mt-1 text-xs font-medium tabular-nums text-amber-800">
            {metrics.within60Quantity.toLocaleString()} units · 60d total
          </div>
        </button>

        <button
          type="button"
          onClick={() => onNavigate('upcoming')}
          className="rounded-xl border border-yellow-300 bg-yellow-50/70 p-4 text-left transition-colors hover:bg-yellow-50 sm:p-5"
        >
          <div className="flex items-center justify-between gap-1">
            <span className="text-xs font-bold text-yellow-900">
              Within 90 Days
            </span>
            <span className="text-xs font-semibold text-yellow-800">0-90d</span>
          </div>
          <div className="mt-2 text-2xl font-bold tabular-nums text-yellow-800 sm:mt-3 sm:text-3xl">
            {metrics.within90Batches.toLocaleString()}
          </div>
          <div className="mt-1 text-xs font-medium tabular-nums text-yellow-900">
            {metrics.within90Quantity.toLocaleString()} units · 90d total
          </div>
        </button>
      </div>

      {/* Healthy Stock (>90 Days) Strip */}
      <div className="flex flex-col justify-between gap-3 rounded-xl border border-emerald-200 bg-emerald-50/60 px-5 py-4 sm:flex-row sm:items-center">
        <div className="flex items-center gap-3">
          <CheckCircle2 className="h-5 w-5 shrink-0 text-emerald-600" />
          <div>
            <div className="text-sm font-bold text-emerald-950">
              Above 90 Days (Safe Window)
            </div>
            <div className="text-xs text-emerald-800">
              <span className="font-mono font-semibold tabular-nums">
                {metrics.safeBatches.toLocaleString()}
              </span>{' '}
              {metrics.safeBatches === 1 ? 'batch' : 'batches'} ·{' '}
              <span className="font-mono font-semibold tabular-nums">
                {metrics.safeQuantity.toLocaleString()}
              </span>{' '}
              units with more than 90 days shelf life remaining
            </div>
          </div>
        </div>
        <button
          type="button"
          onClick={() => onNavigate('excel')}
          className="inline-flex min-h-[40px] items-center gap-2 self-start whitespace-nowrap rounded-lg border border-emerald-300 bg-white px-3.5 py-2 text-xs font-semibold text-emerald-900 hover:bg-emerald-50 sm:self-auto"
        >
          <FileSpreadsheet className="h-4 w-4" />
          <span>Export Excel Reports</span>
        </button>
      </div>

      {/* Urgent Upcoming Batches Preview */}
      <div className="rounded-xl border border-slate-200 bg-white">
        <div className="flex items-center justify-between border-b border-slate-200 px-5 py-4">
          <div>
            <h3 className="text-base font-bold text-slate-900">
              Nearest Upcoming Expiries (Next 90 Days)
            </h3>
            <p className="text-xs text-slate-500">
              Sorted by nearest expiry date first
            </p>
          </div>
          <button
            type="button"
            onClick={() => onNavigate('upcoming')}
            className="text-xs font-semibold text-blue-600 hover:text-blue-700"
          >
            Full 90-Day Report
          </button>
        </div>

        {urgentItems.length === 0 ? (
          <div className="px-5 py-8 text-center text-sm text-slate-500">
            No batches expiring in the next 90 days.
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead>
                <tr className="border-b border-slate-200 bg-slate-50/70 text-xs font-semibold text-slate-600">
                  <th className="px-5 py-3">Product</th>
                  <th className="px-4 py-3">EAN / Code</th>
                  <th className="px-4 py-3">Expiry Date</th>
                  <th className="px-4 py-3 text-right">Qty</th>
                  <th className="px-5 py-3 text-right">Status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {urgentItems.map((item) => {
                  const status = classifyExpiryStatus(item.daysRemaining);
                  return (
                    <tr key={item.id} className="hover:bg-slate-50/70">
                      <td className="px-5 py-3 font-medium text-slate-900">
                        {item.description}
                      </td>
                      <td className="px-4 py-3 font-mono text-xs text-slate-600">
                        {item.ean || 'No EAN'} · {item.productCode}
                      </td>
                      <td className="px-4 py-3 font-mono text-xs tabular-nums text-slate-800">
                        {formatDisplayDate(item.expiryDate)}
                      </td>
                      <td className="px-4 py-3 text-right font-mono text-sm font-semibold tabular-nums text-slate-900">
                        {item.quantity}
                      </td>
                      <td className="px-5 py-3 text-right">
                        <span className={`text-xs font-semibold ${status.badgeTextClass}`}>
                          {status.label}
                        </span>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
};
