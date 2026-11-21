import React, { useRef, useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import {
  AlertTriangle,
  CheckCircle2,
  Download,
  HardDrive,
  Trash2,
  Upload,
} from 'lucide-react';
import { ConfirmDialog } from '../components/ConfirmDialog';
import {
  db,
  exportFullBackupPayload,
  restoreFullBackupPayload,
} from '../db/database';
import type { FullBackupPayload } from '../types/inventory';
import { getLocalTodayISO } from '../utils/expiryCalculations';
import { validateBackupPayload } from '../utils/validation';

export const BackupRestorePage: React.FC = () => {
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const masterCount = useLiveQuery(() => db.masterProducts.count(), [], 0);
  const batchCount = useLiveQuery(() => db.expiryBatches.count(), [], 0);

  const [pendingBackup, setPendingBackup] = useState<FullBackupPayload | null>(
    null
  );
  const [restoreMode, setRestoreMode] = useState<'replace' | 'merge'>('replace');
  const [confirmRestoreOpen, setConfirmRestoreOpen] = useState(false);
  const [confirmClearType, setConfirmClearType] = useState<
    'batches' | 'all' | null
  >(null);
  const [statusMessage, setStatusMessage] = useState<{
    type: 'success' | 'error';
    text: string;
  } | null>(null);

  const handleExportJSON = async () => {
    const payload = await exportFullBackupPayload();
    const json = JSON.stringify(payload, null, 2);
    const blob = new Blob([json], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `retail-expiry-backup-${getLocalTodayISO()}.json`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
    setStatusMessage({
      type: 'success',
      text: `Exported backup containing ${payload.masterProducts.length.toLocaleString()} master products and ${payload.expiryBatches.length.toLocaleString()} expiry batches.`,
    });
  };

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setStatusMessage(null);
    try {
      const text = await file.text();
      const parsed: unknown = JSON.parse(text);
      const check = validateBackupPayload(parsed);
      if (!check.valid) {
        const extra =
          check.errors.length > 1
            ? ` (+${check.errors.length - 1} more error${check.errors.length - 1 === 1 ? '' : 's'})`
            : '';
        setPendingBackup(null);
        setStatusMessage({
          type: 'error',
          text: `Backup validation failed: ${check.errors[0]}${extra}`,
        });
        return;
      }
      setPendingBackup(check.payload);
    } catch {
      setPendingBackup(null);
      setStatusMessage({
        type: 'error',
        text: 'Failed to parse JSON backup file.',
      });
    } finally {
      e.target.value = '';
    }
  };

  const handleExecuteRestore = async () => {
    if (!pendingBackup) return;
    try {
      const res = await restoreFullBackupPayload(pendingBackup, restoreMode);
      const duplicateNote =
        res.duplicatesSkipped > 0
          ? ` (${res.duplicatesSkipped.toLocaleString()} duplicate batch${res.duplicatesSkipped === 1 ? '' : 'es'} skipped)`
          : '';
      setStatusMessage({
        type: 'success',
        text: `Restore completed (${restoreMode}): ${res.masterCount.toLocaleString()} master products and ${res.batchCount.toLocaleString()} expiry batches active (${res.batchesAdded.toLocaleString()} batches added${duplicateNote}).`,
      });
      setPendingBackup(null);
    } catch (err) {
      setStatusMessage({
        type: 'error',
        text: err instanceof Error ? err.message : 'Restore failed.',
      });
    } finally {
      setConfirmRestoreOpen(false);
    }
  };

  const handleConfirmClear = async () => {
    if (confirmClearType === 'batches') {
      await db.expiryBatches.clear();
      setStatusMessage({
        type: 'success',
        text: 'All expiry batches cleared. Master Product Database preserved.',
      });
    } else if (confirmClearType === 'all') {
      await db.transaction(
        'rw',
        db.masterProducts,
        db.expiryBatches,
        async () => {
          await db.masterProducts.clear();
          await db.expiryBatches.clear();
        }
      );
      setStatusMessage({
        type: 'success',
        text: 'All Master Products and Expiry Batches have been cleared.',
      });
    }
    setConfirmClearType(null);
  };

  return (
    <div className="mx-auto max-w-4xl space-y-6">
      {statusMessage && (
        <div
          role="status"
          className={`flex items-center gap-2 rounded-xl border px-4 py-3 text-sm font-medium ${
            statusMessage.type === 'success'
              ? 'border-emerald-200 bg-emerald-50 text-emerald-800'
              : 'border-red-200 bg-red-50 text-red-800'
          }`}
        >
          {statusMessage.type === 'success' ? (
            <CheckCircle2 className="h-4 w-4 shrink-0 text-emerald-600" />
          ) : (
            <AlertTriangle className="h-4 w-4 shrink-0 text-red-600" />
          )}
          <span>{statusMessage.text}</span>
        </div>
      )}

      {/* Local Storage Summary & JSON Export */}
      <div className="rounded-xl border border-slate-200 bg-white p-5 sm:p-6">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-start gap-3">
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-blue-50 text-blue-600">
              <HardDrive className="h-5 w-5" />
            </div>
            <div>
              <h2 className="text-lg font-bold text-slate-900">
                Full JSON Backup
              </h2>
              <p className="mt-0.5 text-sm text-slate-600 tabular-nums">
                Current local database: {masterCount.toLocaleString()} master products ·{' '}
                {batchCount.toLocaleString()} expiry batches
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={() => void handleExportJSON()}
            className="inline-flex min-h-[44px] items-center gap-2 self-start whitespace-nowrap rounded-lg bg-blue-600 px-4 py-2.5 text-sm font-semibold text-white hover:bg-blue-700 sm:self-auto"
          >
            <Download className="h-4 w-4" />
            <span>Export JSON Backup</span>
          </button>
        </div>
      </div>

      {/* JSON Restore */}
      <div className="rounded-xl border border-slate-200 bg-white p-5 sm:p-6">
        <h2 className="text-lg font-bold text-slate-900">
          Restore from JSON Backup
        </h2>
        <p className="mt-1 text-sm text-slate-600">
          Select a previously exported Retail Expiry Manager `.json` backup file to restore or merge records offline.
        </p>

        <input
          ref={fileInputRef}
          type="file"
          accept=".json,application/json"
          aria-label="Select JSON backup file"
          onChange={(e) => void handleFileChange(e)}
          className="sr-only"
        />
        <button
          type="button"
          onClick={() => fileInputRef.current?.click()}
          className="mt-4 inline-flex min-h-[44px] items-center gap-2 rounded-lg border border-slate-300 bg-white px-4 py-2 text-sm font-semibold text-slate-800 hover:bg-slate-50"
        >
          <Upload className="h-4 w-4" />
          <span>Select JSON Backup File</span>
        </button>

        {pendingBackup && (
          <div className="mt-5 rounded-xl border border-blue-200 bg-blue-50/60 p-4">
            <div className="text-sm font-bold text-slate-900">
              Backup Ready to Restore
            </div>
            <div className="mt-1 text-xs text-slate-700 tabular-nums">
              Exported at: {new Date(pendingBackup.exportedAt).toLocaleString()} ·{' '}
              {pendingBackup.masterProducts.length.toLocaleString()} master products ·{' '}
              {pendingBackup.expiryBatches.length.toLocaleString()} expiry batches
            </div>

            <div className="mt-3 space-y-2 text-xs">
              <label className="flex cursor-pointer items-center gap-2 font-medium text-slate-800">
                <input
                  type="radio"
                  name="restoreMode"
                  checked={restoreMode === 'replace'}
                  onChange={() => setRestoreMode('replace')}
                />
                <span>Full Replace Restore (overwrites current database with backup)</span>
              </label>
              <label className="flex cursor-pointer items-center gap-2 font-medium text-slate-800">
                <input
                  type="radio"
                  name="restoreMode"
                  checked={restoreMode === 'merge'}
                  onChange={() => setRestoreMode('merge')}
                />
                <span>Merge Backup (adds backup batches & updates matching master EANs)</span>
              </label>
            </div>

            <div className="mt-4 flex gap-2">
              <button
                type="button"
                onClick={() => setPendingBackup(null)}
                className="min-h-[40px] rounded-lg border border-slate-300 bg-white px-4 py-2 text-xs font-semibold text-slate-700"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={() => setConfirmRestoreOpen(true)}
                className="min-h-[40px] rounded-lg bg-slate-900 px-4 py-2 text-xs font-semibold text-white hover:bg-slate-800"
              >
                Restore Backup Now
              </button>
            </div>
          </div>
        )}
      </div>

      {/* Danger Zone */}
      <div className="rounded-xl border border-red-200 bg-white p-5 sm:p-6">
        <h2 className="text-base font-bold text-red-700">Data Deletion</h2>
        <p className="mt-1 text-xs text-slate-600">
          Export a JSON or Excel backup before deleting local records. Deleted data cannot be recovered without a backup.
        </p>
        <div className="mt-4 flex flex-wrap gap-3">
          <button
            type="button"
            disabled={batchCount === 0}
            onClick={() => setConfirmClearType('batches')}
            className="inline-flex min-h-[44px] items-center gap-2 rounded-lg border border-red-300 bg-white px-4 py-2 text-xs font-semibold text-red-700 hover:bg-red-50 disabled:opacity-50"
          >
            <Trash2 className="h-4 w-4" />
            <span>Clear Expiry Batches Only</span>
          </button>
          <button
            type="button"
            disabled={masterCount === 0 && batchCount === 0}
            onClick={() => setConfirmClearType('all')}
            className="inline-flex min-h-[44px] items-center gap-2 rounded-lg bg-red-600 px-4 py-2 text-xs font-semibold text-white hover:bg-red-700 disabled:opacity-50"
          >
            <Trash2 className="h-4 w-4" />
            <span>Clear All Data</span>
          </button>
        </div>
      </div>

      <ConfirmDialog
        open={confirmRestoreOpen}
        title="Confirm Backup Restore"
        message={
          restoreMode === 'replace'
            ? 'Full Replace Restore will erase all current local records and replace them with the selected backup file.'
            : 'Merge Restore will add all expiry batches from the backup file and update matching Master Products.'
        }
        confirmLabel="Restore Backup"
        destructive={restoreMode === 'replace'}
        onConfirm={() => void handleExecuteRestore()}
        onCancel={() => setConfirmRestoreOpen(false)}
      />

      <ConfirmDialog
        open={confirmClearType !== null}
        title={
          confirmClearType === 'batches'
            ? 'Clear All Expiry Batches?'
            : 'Clear Entire Local Database?'
        }
        message={
          confirmClearType === 'batches'
            ? `This will permanently delete all ${batchCount.toLocaleString()} expiry batches while keeping your Master Product Database.`
            : `This will permanently delete all ${masterCount.toLocaleString()} Master Products and ${batchCount.toLocaleString()} Expiry Batches.`
        }
        confirmLabel="Yes, Delete Permanently"
        onConfirm={() => void handleConfirmClear()}
        onCancel={() => setConfirmClearType(null)}
      />
    </div>
  );
};
