import React, { useMemo, useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { CalendarClock, FileSpreadsheet, Search } from 'lucide-react';
import { db } from '../db/database';
import {
  buildUpcoming90Workbook,
  triggerWorkbookDownload,
} from '../utils/excelParser';
import {
  formatDisplayDate,
  getLocalTodayISO,
  getUpcoming90Batches,
} from '../utils/expiryCalculations';

const PAGE_SIZE = 50;

export const Upcoming90Page: React.FC = () => {
  const allBatches = useLiveQuery(() => db.expiryBatches.toArray(), [], []);
  const [search, setSearch] = useState('');
  const [windowFilter, setWindowFilter] = useState<'all' | '30' | '60' | '90'>('all');
  const [filterDate, setFilterDate] = useState('');
  const [page, setPage] = useState(1);

  const todayISO = getLocalTodayISO();

  const upcomingRows = useMemo(() => {
    const base = getUpcoming90Batches(allBatches, todayISO);
    const q = search.trim().toLowerCase();

    return base.filter((row) => {
      if (windowFilter === '30' && row.daysRemaining > 30) return false;
      if (windowFilter === '60' && (row.daysRemaining < 31 || row.daysRemaining > 60)) {
        return false;
      }
      if (windowFilter === '90' && row.daysRemaining < 61) return false;
      if (filterDate && row.expiryDate > filterDate) return false;

      if (!q) return true;
      return (
        row.ean.toLowerCase().includes(q) ||
        row.productCode.toLowerCase().includes(q) ||
        row.description.toLowerCase().includes(q)
      );
    });
  }, [allBatches, todayISO, search, windowFilter, filterDate]);

  const totalExpiringQty = useMemo(
    () => upcomingRows.reduce((sum, r) => sum + (Number(r.quantity) || 0), 0),
    [upcomingRows]
  );

  const totalPages = Math.max(1, Math.ceil(upcomingRows.length / PAGE_SIZE));
  const safePage = Math.min(page, totalPages);
  const pagedRows = upcomingRows.slice(
    (safePage - 1) * PAGE_SIZE,
    safePage * PAGE_SIZE
  );

  const handleExport = () => {
    const wb = buildUpcoming90Workbook(allBatches, todayISO);
    triggerWorkbookDownload(wb, `upcoming-90-days-expiry-${todayISO}.xlsx`);
  };

  return (
    <div className="space-y-5">
      <div className="rounded-xl border border-slate-200 bg-white p-5">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h2 className="text-lg font-bold text-slate-900">
              Upcoming 90 Days Expiry Report
            </h2>
            <p className="mt-0.5 text-xs text-slate-600 tabular-nums">
              {upcomingRows.length.toLocaleString()} batches expiring today through +90 days · Total Expiring Quantity:{' '}
              <span className="font-mono font-bold text-slate-900">
                {totalExpiringQty.toLocaleString()}
              </span>
            </p>
          </div>
          <button
            type="button"
            onClick={handleExport}
            disabled={upcomingRows.length === 0}
            className="inline-flex min-h-[44px] items-center gap-2 self-start whitespace-nowrap rounded-lg bg-slate-900 px-4 py-2 text-xs font-semibold text-white hover:bg-slate-800 disabled:opacity-50 sm:self-auto"
          >
            <FileSpreadsheet className="h-4 w-4" />
            <span>Export 90-Day Excel</span>
          </button>
        </div>

        <div className="mt-4 grid grid-cols-1 gap-3 md:grid-cols-12">
          <div className="relative md:col-span-5">
            <Search className="pointer-events-none absolute left-3.5 top-3.5 h-4 w-4 text-slate-400" />
            <input
              type="search"
              aria-label="Search upcoming expiry batches"
              placeholder="Search EAN, Product Code, or Description..."
              value={search}
              onChange={(e) => {
                setSearch(e.target.value);
                setPage(1);
              }}
              className="min-h-[44px] w-full rounded-lg border border-slate-300 pl-10 pr-3.5 text-sm text-slate-900 focus:border-blue-600 focus:outline-none focus:ring-1 focus:ring-blue-600"
            />
          </div>

          <div className="md:col-span-4">
            <div className="flex h-[44px] items-center gap-1 rounded-lg border border-slate-200 bg-slate-100 p-1">
              {(
                [
                  { id: 'all', label: 'All 90d' },
                  { id: '30', label: '0-30d' },
                  { id: '60', label: '31-60d' },
                  { id: '90', label: '61-90d' },
                ] as const
              ).map((tab) => (
                <button
                  key={tab.id}
                  type="button"
                  onClick={() => {
                    setWindowFilter(tab.id);
                    setPage(1);
                  }}
                  className={`flex-1 whitespace-nowrap rounded-md px-2 py-1.5 text-xs font-semibold transition-colors ${
                    windowFilter === tab.id
                      ? 'bg-white text-slate-900 shadow-sm'
                      : 'text-slate-600 hover:text-slate-900'
                  }`}
                >
                  {tab.label}
                </button>
              ))}
            </div>
          </div>

          <div className="flex items-center gap-2 md:col-span-3">
            <input
              type="date"
              aria-label="Filter expiring on or before date"
              title="Expiring on or before date"
              value={filterDate}
              onChange={(e) => {
                setFilterDate(e.target.value);
                setPage(1);
              }}
              className="min-h-[44px] w-full rounded-lg border border-slate-300 px-3 font-mono text-xs text-slate-800 focus:border-blue-600 focus:outline-none"
            />
            {filterDate && (
              <button
                type="button"
                onClick={() => setFilterDate('')}
                className="min-h-[44px] whitespace-nowrap rounded-lg border border-slate-300 px-2.5 text-xs font-semibold text-slate-700 hover:bg-slate-50"
              >
                Clear
              </button>
            )}
          </div>
        </div>
      </div>

      <div className="rounded-xl border border-slate-200 bg-white">
        {pagedRows.length === 0 ? (
          <div className="flex flex-col items-center justify-center px-5 py-12 text-center">
            <CalendarClock className="h-9 w-9 text-slate-300" />
            <p className="mt-2 text-sm font-medium text-slate-600">
              No batches expiring within this 90-day filter window.
            </p>
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
                  <th className="px-4 py-3 text-right">Days Left</th>
                  <th className="px-5 py-3">Status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {pagedRows.map((row) => (
                  <tr key={row.id} className="hover:bg-slate-50/70">
                    <td className="px-5 py-3 font-mono text-xs text-slate-700">
                      {row.ean || '—'}
                    </td>
                    <td className="px-4 py-3 font-mono text-xs font-semibold text-slate-800">
                      {row.productCode}
                    </td>
                    <td className="px-4 py-3 font-medium text-slate-900">
                      {row.description}
                    </td>
                    <td className="px-4 py-3 font-mono text-xs tabular-nums text-slate-800">
                      {formatDisplayDate(row.expiryDate)}
                    </td>
                    <td className="px-4 py-3 text-right font-mono text-sm font-bold tabular-nums text-slate-900">
                      {row.quantity}
                    </td>
                    <td className="px-4 py-3 text-right font-mono text-xs font-bold tabular-nums text-slate-900">
                      {row.daysRemaining}d
                    </td>
                    <td className="px-5 py-3">
                      <span className={`text-xs font-semibold ${row.status.badgeTextClass}`}>
                        {row.status.label}
                      </span>
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
                className="min-h-[36px] rounded-lg border border-slate-300 bg-white px-3 font-semibold text-slate-700 disabled:opacity-50"
              >
                Previous
              </button>
              <button
                type="button"
                disabled={safePage >= totalPages}
                onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                className="min-h-[36px] rounded-lg border border-slate-300 bg-white px-3 font-semibold text-slate-700 disabled:opacity-50"
              >
                Next
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};
