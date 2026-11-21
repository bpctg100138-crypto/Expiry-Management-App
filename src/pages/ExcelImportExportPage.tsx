import React, { useRef, useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import {
  AlertTriangle,
  CheckCircle2,
  Download,
  FileSpreadsheet,
  Upload,
} from 'lucide-react';
import { ConfirmDialog } from '../components/ConfirmDialog';
import { bulkImportMasterProducts, db } from '../db/database';
import type { ExcelImportPreview } from '../types/inventory';
import {
  buildCompleteExpiryWorkbook,
  buildExpiredWorkbook,
  buildMasterDatabaseWorkbook,
  buildSampleTemplateWorkbook,
  buildUpcoming90Workbook,
  parseMasterExcelBuffer,
  triggerWorkbookDownload,
} from '../utils/excelParser';
import { getLocalTodayISO } from '../utils/expiryCalculations';

export const ExcelImportExportPage: React.FC = () => {
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const masterCount = useLiveQuery(() => db.masterProducts.count(), [], 0);
  const batchCount = useLiveQuery(() => db.expiryBatches.count(), [], 0);

  const [preview, setPreview] = useState<ExcelImportPreview | null>(null);
  const [importMode, setImportMode] = useState<'merge' | 'replace_master_only'>(
    'merge'
  );
  const [confirmReplaceOpen, setConfirmReplaceOpen] = useState(false);
  const [importing, setImporting] = useState(false);
  const [importResult, setImportResult] = useState<string | null>(null);

  const todayISO = getLocalTodayISO();

  const handleFileSelected = async (
    e: React.ChangeEvent<HTMLInputElement>
  ) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setImportResult(null);
    const buf = await file.arrayBuffer();
    const parsed = parseMasterExcelBuffer(buf, file.name);
    setPreview(parsed);
    e.target.value = '';
  };

  const executeImport = async () => {
    if (!preview || preview.validRows.length === 0) return;
    setImporting(true);
    try {
      const res = await bulkImportMasterProducts(
        preview.validRows.map((r) => ({
          ean: r.ean,
          productCode: r.productCode,
          description: r.description,
        })),
        importMode
      );
      setImportResult(
        `Import complete (${preview.fileName}): ${res.inserted.toLocaleString()} added, ${res.updated.toLocaleString()} updated. All existing expiry batches remain intact.`
      );
      setPreview(null);
    } finally {
      setImporting(false);
      setConfirmReplaceOpen(false);
    }
  };

  const handleImportClick = () => {
    if (importMode === 'replace_master_only' && masterCount > 0) {
      setConfirmReplaceOpen(true);
    } else {
      void executeImport();
    }
  };

  const handleExportMaster = async () => {
    const rows = await db.masterProducts.toArray();
    triggerWorkbookDownload(
      buildMasterDatabaseWorkbook(rows),
      `master-product-database-${todayISO}.xlsx`
    );
  };

  const handleExportCompleteExpiry = async () => {
    const rows = await db.expiryBatches.toArray();
    triggerWorkbookDownload(
      buildCompleteExpiryWorkbook(rows),
      `complete-expiry-database-${todayISO}.xlsx`
    );
  };

  const handleExportUpcoming90 = async () => {
    const rows = await db.expiryBatches.toArray();
    triggerWorkbookDownload(
      buildUpcoming90Workbook(rows, todayISO),
      `upcoming-90-days-report-${todayISO}.xlsx`
    );
  };

  const handleExportExpired = async () => {
    const rows = await db.expiryBatches.toArray();
    triggerWorkbookDownload(
      buildExpiredWorkbook(rows, todayISO),
      `expired-products-report-${todayISO}.xlsx`
    );
  };

  const handleDownloadTemplate = () => {
    triggerWorkbookDownload(
      buildSampleTemplateWorkbook(),
      'master-products-template.xlsx'
    );
  };

  return (
    <div className="space-y-6">
      {/* Master Excel Import Card */}
      <div className="rounded-xl border border-slate-200 bg-white p-5 sm:p-6">
        <div className="flex flex-col gap-3 border-b border-slate-200 pb-4 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h2 className="text-lg font-bold text-slate-900">
              Master Product Excel Import
            </h2>
            <p className="mt-0.5 text-sm text-slate-600">
              Upload .xlsx or .xls with headings:{' '}
              <span className="font-mono font-semibold text-slate-800">
                EAN Number
              </span>
              ,{' '}
              <span className="font-mono font-semibold text-slate-800">
                Product Code
              </span>
              ,{' '}
              <span className="font-mono font-semibold text-slate-800">
                Product Description
              </span>
              . Leading zeros are preserved as text.
            </p>
          </div>
          <button
            type="button"
            onClick={handleDownloadTemplate}
            className="inline-flex min-h-[40px] items-center gap-1.5 self-start whitespace-nowrap rounded-lg border border-slate-300 bg-white px-3.5 py-2 text-xs font-semibold text-slate-800 hover:bg-slate-50 sm:self-auto"
          >
            <Download className="h-4 w-4" />
            <span>Download Sample Template</span>
          </button>
        </div>

        {importResult && (
          <div
            role="status"
            className="mt-4 flex items-center gap-2 rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm font-medium text-emerald-800"
          >
            <CheckCircle2 className="h-4 w-4 shrink-0 text-emerald-600" />
            <span>{importResult}</span>
          </div>
        )}

        <div className="mt-5 flex flex-col items-center justify-center rounded-xl border-2 border-dashed border-slate-300 bg-slate-50/70 p-8 text-center">
          <FileSpreadsheet className="h-10 w-10 text-blue-600" />
          <p className="mt-3 text-sm font-semibold text-slate-900">
            Select a Master Product Excel Workbook (.xlsx or .xls)
          </p>
          <p className="mt-1 text-xs text-slate-500">
            Runs 100% offline in your browser · Supports 10,000+ rows
          </p>
          <input
            ref={fileInputRef}
            type="file"
            accept=".xlsx,.xls"
            aria-label="Upload Master Product Excel file"
            onChange={(e) => void handleFileSelected(e)}
            className="sr-only"
          />
          <button
            type="button"
            onClick={() => fileInputRef.current?.click()}
            className="mt-4 inline-flex min-h-[44px] items-center gap-2 rounded-lg bg-blue-600 px-5 py-2.5 text-sm font-semibold text-white hover:bg-blue-700"
          >
            <Upload className="h-4 w-4" />
            <span>Choose Excel File</span>
          </button>
        </div>

        {/* Excel Preview Section */}
        {preview && (
          <div className="mt-6 space-y-4 border-t border-slate-200 pt-5">
            {preview.fatalError ? (
              <div className="flex items-start gap-3 rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-800">
                <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0 text-red-600" />
                <div>
                  <div className="font-bold">Cannot Parse Excel File</div>
                  <div className="mt-1">{preview.fatalError}</div>
                </div>
              </div>
            ) : (
              <>
                <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                  <div className="rounded-lg border border-slate-200 bg-slate-50 p-3">
                    <div className="text-xs font-medium text-slate-500">
                      Total Rows
                    </div>
                    <div className="mt-1 font-mono text-xl font-bold tabular-nums text-slate-900">
                      {preview.totalRows.toLocaleString()}
                    </div>
                  </div>
                  <div className="rounded-lg border border-emerald-200 bg-emerald-50/70 p-3">
                    <div className="text-xs font-medium text-emerald-800">
                      Valid Ready
                    </div>
                    <div className="mt-1 font-mono text-xl font-bold tabular-nums text-emerald-700">
                      {preview.validRows.length.toLocaleString()}
                    </div>
                  </div>
                  <div className="rounded-lg border border-amber-200 bg-amber-50/70 p-3">
                    <div className="text-xs font-medium text-amber-800">
                      Duplicate EANs
                    </div>
                    <div className="mt-1 font-mono text-xl font-bold tabular-nums text-amber-700">
                      {preview.duplicateEanCount.toLocaleString()}
                    </div>
                  </div>
                  <div className="rounded-lg border border-red-200 bg-red-50/70 p-3">
                    <div className="text-xs font-medium text-red-800">
                      Missing Fields
                    </div>
                    <div className="mt-1 font-mono text-xl font-bold tabular-nums text-red-700">
                      {preview.missingFieldCount.toLocaleString()}
                    </div>
                  </div>
                </div>

                {preview.invalidRows.length > 0 && (
                  <div className="rounded-lg border border-amber-200 bg-amber-50 p-4 text-xs text-amber-900">
                    <div className="font-bold">
                      Skipped Invalid Rows ({preview.invalidRows.length}):
                    </div>
                    <ul className="mt-1.5 max-h-32 space-y-1 overflow-y-auto">
                      {preview.invalidRows.slice(0, 20).map((row) => (
                        <li key={row.rowNumber} className="font-mono">
                          Row {row.rowNumber} ({row.ean || 'no EAN'}):{' '}
                          {row.errors.join(', ')}
                        </li>
                      ))}
                    </ul>
                  </div>
                )}

                {preview.validRows.length > 0 && (
                  <>
                    <div>
                      <h3 className="text-xs font-bold text-slate-700">
                        Preview (First {Math.min(10, preview.validRows.length)} of{' '}
                        {preview.validRows.length.toLocaleString()} Valid Products)
                      </h3>
                      <div className="mt-2 overflow-x-auto rounded-lg border border-slate-200">
                        <table className="w-full text-left text-xs">
                          <thead>
                            <tr className="border-b border-slate-200 bg-slate-50 font-semibold text-slate-600">
                              <th className="px-3 py-2">EAN Number (Text)</th>
                              <th className="px-3 py-2">Product Code</th>
                              <th className="px-3 py-2">Product Description</th>
                            </tr>
                          </thead>
                          <tbody className="divide-y divide-slate-100">
                            {preview.validRows.slice(0, 10).map((row) => (
                              <tr key={row.rowNumber}>
                                <td className="px-3 py-2 font-mono text-slate-800">
                                  {row.ean}
                                </td>
                                <td className="px-3 py-2 font-mono font-semibold text-slate-900">
                                  {row.productCode}
                                </td>
                                <td className="px-3 py-2 text-slate-800">
                                  {row.description}
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    </div>

                    <div className="flex flex-col gap-4 rounded-lg border border-slate-200 bg-slate-50 p-4 sm:flex-row sm:items-center sm:justify-between">
                      <div className="space-y-2 text-xs">
                        <label className="flex cursor-pointer items-center gap-2 font-medium text-slate-800">
                          <input
                            type="radio"
                            name="importMode"
                            checked={importMode === 'merge'}
                            onChange={() => setImportMode('merge')}
                          />
                          <span>
                            Update existing & add new products (keeps expiry batches)
                          </span>
                        </label>
                        <label className="flex cursor-pointer items-center gap-2 font-medium text-slate-800">
                          <input
                            type="radio"
                            name="importMode"
                            checked={importMode === 'replace_master_only'}
                            onChange={() => setImportMode('replace_master_only')}
                          />
                          <span>
                            Replace Master Catalog only (keeps all expiry batches)
                          </span>
                        </label>
                      </div>

                      <div className="flex gap-2">
                        <button
                          type="button"
                          onClick={() => setPreview(null)}
                          className="min-h-[44px] rounded-lg border border-slate-300 bg-white px-4 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-50"
                        >
                          Cancel
                        </button>
                        <button
                          type="button"
                          disabled={importing}
                          onClick={handleImportClick}
                          className="min-h-[44px] rounded-lg bg-blue-600 px-5 py-2 text-xs font-bold text-white hover:bg-blue-700 disabled:opacity-60"
                        >
                          {importing
                            ? 'Importing...'
                            : `Import ${preview.validRows.length.toLocaleString()} Products`}
                        </button>
                      </div>
                    </div>
                  </>
                )}
              </>
            )}
          </div>
        )}
      </div>

      {/* Offline Excel Export Hub */}
      <div className="rounded-xl border border-slate-200 bg-white p-5 sm:p-6">
        <div className="border-b border-slate-200 pb-4">
          <h2 className="text-lg font-bold text-slate-900">
            Offline Excel Export (.xlsx)
          </h2>
          <p className="mt-0.5 text-sm text-slate-600">
            Generates real .xlsx workbooks offline with EAN and Product Code formatted as text and dates as DD-MM-YYYY.
          </p>
        </div>

        <div className="mt-5 grid grid-cols-1 gap-4 md:grid-cols-2">
          <div className="flex flex-col justify-between rounded-xl border border-slate-200 p-4">
            <div>
              <h3 className="text-sm font-bold text-slate-900">
                1. Master Product Database
              </h3>
              <p className="mt-1 text-xs text-slate-600">
                Exports all {masterCount.toLocaleString()} master products (EAN Number, Product Code, Product Description).
              </p>
            </div>
            <button
              type="button"
              onClick={() => void handleExportMaster()}
              disabled={masterCount === 0}
              className="mt-4 inline-flex min-h-[44px] items-center justify-center gap-2 rounded-lg border border-slate-300 bg-white px-4 py-2 text-xs font-semibold text-slate-800 hover:bg-slate-50 disabled:opacity-50"
            >
              <Download className="h-4 w-4 text-blue-600" />
              <span>Download Master Excel</span>
            </button>
          </div>

          <div className="flex flex-col justify-between rounded-xl border border-slate-200 p-4">
            <div>
              <h3 className="text-sm font-bold text-slate-900">
                2. Complete Expiry Database
              </h3>
              <p className="mt-1 text-xs text-slate-600">
                Exports all {batchCount.toLocaleString()} batches in exact columns: EAN Number, Product Code, Product Description, Expiry Date, Quantity.
              </p>
            </div>
            <button
              type="button"
              onClick={() => void handleExportCompleteExpiry()}
              disabled={batchCount === 0}
              className="mt-4 inline-flex min-h-[44px] items-center justify-center gap-2 rounded-lg bg-blue-600 px-4 py-2 text-xs font-semibold text-white hover:bg-blue-700 disabled:opacity-50"
            >
              <Download className="h-4 w-4" />
              <span>Download Complete Expiry Excel</span>
            </button>
          </div>

          <div className="flex flex-col justify-between rounded-xl border border-slate-200 p-4">
            <div>
              <h3 className="text-sm font-bold text-slate-900">
                3. Upcoming 90 Days Report
              </h3>
              <p className="mt-1 text-xs text-slate-600">
                Exports batches expiring today through the next 90 days, sorted nearest expiry first with Days Remaining and Status.
              </p>
            </div>
            <button
              type="button"
              onClick={() => void handleExportUpcoming90()}
              disabled={batchCount === 0}
              className="mt-4 inline-flex min-h-[44px] items-center justify-center gap-2 rounded-lg border border-slate-300 bg-white px-4 py-2 text-xs font-semibold text-slate-800 hover:bg-slate-50 disabled:opacity-50"
            >
              <Download className="h-4 w-4 text-orange-600" />
              <span>Download 90-Day Report</span>
            </button>
          </div>

          <div className="flex flex-col justify-between rounded-xl border border-slate-200 p-4">
            <div>
              <h3 className="text-sm font-bold text-slate-900">
                4. Expired Products Report
              </h3>
              <p className="mt-1 text-xs text-slate-600">
                Exports already expired batches sorted oldest expiry first with Days Expired.
              </p>
            </div>
            <button
              type="button"
              onClick={() => void handleExportExpired()}
              disabled={batchCount === 0}
              className="mt-4 inline-flex min-h-[44px] items-center justify-center gap-2 rounded-lg border border-slate-300 bg-white px-4 py-2 text-xs font-semibold text-slate-800 hover:bg-slate-50 disabled:opacity-50"
            >
              <Download className="h-4 w-4 text-red-600" />
              <span>Download Expired Report</span>
            </button>
          </div>
        </div>
      </div>

      <ConfirmDialog
        open={confirmReplaceOpen}
        title="Replace Master Product Catalog?"
        message={`This will replace your current ${masterCount.toLocaleString()} Master Products with the ${preview?.validRows.length.toLocaleString() ?? 0} products in this Excel file. Existing expiry batches will NOT be deleted.`}
        confirmLabel="Replace Master Catalog"
        onConfirm={() => void executeImport()}
        onCancel={() => setConfirmReplaceOpen(false)}
      />
    </div>
  );
};
