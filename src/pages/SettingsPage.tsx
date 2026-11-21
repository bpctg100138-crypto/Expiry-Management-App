import React, { useEffect, useState } from 'react';
import { CheckCircle2, ShieldCheck, Smartphone } from 'lucide-react';
import { PWAInstallButton } from '../components/PWAInstallButton';
import {
  DEFAULT_PREFERENCES,
  getAppPreferences,
  saveAppPreferences,
} from '../db/database';
import { useOnlineStatus } from '../hooks/useOnlineStatus';
import { usePWAInstall } from '../hooks/usePWAInstall';
import type { AppPreferences } from '../types/inventory';

interface SettingsPageProps {
  onPreferencesUpdated: (prefs: AppPreferences) => void;
}

export const SettingsPage: React.FC<SettingsPageProps> = ({
  onPreferencesUpdated,
}) => {
  const isOnline = useOnlineStatus();
  const { isInstalled, isInstallable, isIOS } = usePWAInstall();

  const [prefs, setPrefs] = useState<AppPreferences>(DEFAULT_PREFERENCES);
  const [persistedStorage, setPersistedStorage] = useState<boolean | null>(
    null
  );
  const [swReady, setSwReady] = useState(false);
  const [savedNotice, setSavedNotice] = useState(false);

  useEffect(() => {
    void getAppPreferences().then(setPrefs);

    if (navigator.storage && navigator.storage.persisted) {
      void navigator.storage.persisted().then(setPersistedStorage);
    }

    if ('serviceWorker' in navigator) {
      void navigator.serviceWorker.getRegistration().then((reg) => {
        setSwReady(Boolean(reg));
      });
    }
  }, []);

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    await saveAppPreferences(prefs);
    onPreferencesUpdated(prefs);
    setSavedNotice(true);
    setTimeout(() => setSavedNotice(false), 3000);
  };

  const handleRequestPersistentStorage = async () => {
    if (navigator.storage && navigator.storage.persist) {
      const granted = await navigator.storage.persist();
      setPersistedStorage(granted);
    }
  };

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <form
        onSubmit={handleSave}
        className="rounded-xl border border-slate-200 bg-white p-5 sm:p-6"
      >
        <div className="border-b border-slate-200 pb-4">
          <h2 className="text-lg font-bold text-slate-900">
            Store & Scanner Preferences
          </h2>
          <p className="mt-0.5 text-sm text-slate-600">
            Saved locally in IndexedDB so preferences persist across restarts and offline sessions.
          </p>
        </div>

        {savedNotice && (
          <div
            role="status"
            className="mt-4 flex items-center gap-2 rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-2.5 text-xs font-semibold text-emerald-800"
          >
            <CheckCircle2 className="h-4 w-4 text-emerald-600" />
            <span>Settings saved locally.</span>
          </div>
        )}

        <div className="mt-5 space-y-5">
          <div>
            <label
              htmlFor="setting-store-name"
              className="block text-xs font-semibold text-slate-700"
            >
              Store / Branch Name
            </label>
            <input
              id="setting-store-name"
              type="text"
              value={prefs.storeName}
              onChange={(e) =>
                setPrefs((p) => ({ ...p, storeName: e.target.value }))
              }
              className="mt-1.5 min-h-[44px] w-full rounded-lg border border-slate-300 px-3.5 text-sm text-slate-900 focus:border-blue-600 focus:outline-none focus:ring-1 focus:ring-blue-600"
            />
          </div>

          <div className="space-y-3">
            <label className="flex min-h-[44px] cursor-pointer items-center justify-between rounded-lg border border-slate-200 px-4 py-3">
              <div>
                <div className="text-sm font-semibold text-slate-900">
                  Scanner Audio Beep
                </div>
                <div className="text-xs text-slate-500">
                  Play an offline tone when a barcode is captured
                </div>
              </div>
              <input
                type="checkbox"
                checked={prefs.scannerBeep}
                onChange={(e) =>
                  setPrefs((p) => ({ ...p, scannerBeep: e.target.checked }))
                }
                className="h-5 w-5 rounded border-slate-300 text-blue-600"
              />
            </label>

            <label className="flex min-h-[44px] cursor-pointer items-center justify-between rounded-lg border border-slate-200 px-4 py-3">
              <div>
                <div className="text-sm font-semibold text-slate-900">
                  Haptic Vibration Feedback
                </div>
                <div className="text-xs text-slate-500">
                  Vibrate Android device on successful barcode scan
                </div>
              </div>
              <input
                type="checkbox"
                checked={prefs.scannerVibrate}
                onChange={(e) =>
                  setPrefs((p) => ({ ...p, scannerVibrate: e.target.checked }))
                }
                className="h-5 w-5 rounded border-slate-300 text-blue-600"
              />
            </label>
          </div>

          <button
            type="submit"
            className="min-h-[44px] rounded-lg bg-blue-600 px-5 py-2.5 text-sm font-semibold text-white hover:bg-blue-700"
          >
            Save Preferences
          </button>
        </div>
      </form>

      {/* Offline PWA & Storage Protection Card */}
      <div className="rounded-xl border border-slate-200 bg-white p-5 sm:p-6">
        <div className="flex items-start justify-between gap-4">
          <div className="flex items-start gap-3">
            <Smartphone className="mt-0.5 h-5 w-5 shrink-0 text-blue-600" />
            <div>
              <h3 className="text-base font-bold text-slate-900">
                Offline PWA & Device Storage
              </h3>
              <p className="mt-1 text-xs leading-relaxed text-slate-600">
                Connectivity: {isOnline ? 'Online' : 'Offline'} · Service Worker:{' '}
                {swReady ? 'Cached & Active' : 'Initializing'} · App Mode:{' '}
                {isInstalled ? 'Installed Standalone' : 'Browser'}
              </p>
            </div>
          </div>
          <PWAInstallButton />
        </div>

        {!isInstalled && !isInstallable && !isIOS && (
          <p className="mt-3 rounded-lg border border-slate-200 bg-slate-50 px-3.5 py-2.5 text-xs text-slate-600">
            On Android Chrome, tap the browser menu (three dots) and choose{' '}
            <strong>Install app</strong> or <strong>Add to Home screen</strong> to run Retail Expiry Manager as a full offline mobile app.
          </p>
        )}

        <div className="mt-4 flex flex-col gap-3 border-t border-slate-200 pt-4 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-center gap-2 text-xs text-slate-700">
            <ShieldCheck className="h-4 w-4 text-emerald-600" />
            <span>
              Persistent Storage Protection:{' '}
              <strong>
                {persistedStorage === true
                  ? 'Granted (protected from browser eviction)'
                  : persistedStorage === false
                  ? 'Standard'
                  : 'Checking...'}
              </strong>
            </span>
          </div>
          {persistedStorage === false && (
            <button
              type="button"
              onClick={() => void handleRequestPersistentStorage()}
              className="min-h-[40px] self-start rounded-lg border border-slate-300 bg-white px-3.5 py-2 text-xs font-semibold text-slate-800 hover:bg-slate-50 sm:self-auto"
            >
              Request Persistent Storage
            </button>
          )}
        </div>
      </div>
    </div>
  );
};
