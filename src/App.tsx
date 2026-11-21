import React, { useEffect, useState } from 'react';
import {
  AlertCircle,
  CalendarClock,
  ClipboardList,
  Database,
  FileSpreadsheet,
  HardDriveDownload,
  LayoutDashboard,
  Menu,
  PlusCircle,
  ScanBarcode,
  Settings,
  X,
} from 'lucide-react';
import { OfflineIndicator } from './components/OfflineIndicator';
import { PWAInstallButton } from './components/PWAInstallButton';
import { DEFAULT_PREFERENCES, getAppPreferences } from './db/database';
import { BackupRestorePage } from './pages/BackupRestorePage';
import { DashboardPage } from './pages/DashboardPage';
import { ExcelImportExportPage } from './pages/ExcelImportExportPage';
import { ExpiredProductsPage } from './pages/ExpiredProductsPage';
import { ExpiryRecordsPage } from './pages/ExpiryRecordsPage';
import { ManualEntryPage } from './pages/ManualEntryPage';
import { MasterDatabasePage } from './pages/MasterDatabasePage';
import { ScanBarcodePage } from './pages/ScanBarcodePage';
import { SettingsPage } from './pages/SettingsPage';
import { Upcoming90Page } from './pages/Upcoming90Page';
import type { AppPreferences, NavRoute } from './types/inventory';

interface NavItem {
  id: NavRoute;
  label: string;
  shortLabel: string;
  icon: React.ComponentType<{ className?: string }>;
}

const NAV_ITEMS: NavItem[] = [
  {
    id: 'dashboard',
    label: 'Dashboard',
    shortLabel: 'Dashboard',
    icon: LayoutDashboard,
  },
  {
    id: 'scan',
    label: 'Scan Barcode',
    shortLabel: 'Scan',
    icon: ScanBarcode,
  },
  {
    id: 'manual',
    label: 'Manual Entry',
    shortLabel: 'Manual',
    icon: PlusCircle,
  },
  {
    id: 'records',
    label: 'Expiry Records',
    shortLabel: 'Records',
    icon: ClipboardList,
  },
  {
    id: 'upcoming',
    label: 'Upcoming 90 Days',
    shortLabel: '90 Days',
    icon: CalendarClock,
  },
  {
    id: 'expired',
    label: 'Expired Products',
    shortLabel: 'Expired',
    icon: AlertCircle,
  },
  {
    id: 'master',
    label: 'Master Database',
    shortLabel: 'Master DB',
    icon: Database,
  },
  {
    id: 'excel',
    label: 'Excel Import/Export',
    shortLabel: 'Excel',
    icon: FileSpreadsheet,
  },
  {
    id: 'backup',
    label: 'Backup & Restore',
    shortLabel: 'Backup',
    icon: HardDriveDownload,
  },
  {
    id: 'settings',
    label: 'Settings',
    shortLabel: 'Settings',
    icon: Settings,
  },
];

const MOBILE_TABS: NavRoute[] = ['dashboard', 'scan', 'upcoming', 'records'];

export default function App() {
  const [activeRoute, setActiveRoute] = useState<NavRoute>('dashboard');
  const [recordsInitialSearch, setRecordsInitialSearch] = useState('');
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [prefs, setPrefs] = useState<AppPreferences>(DEFAULT_PREFERENCES);

  useEffect(() => {
    void getAppPreferences().then(setPrefs);

    if (navigator.storage && navigator.storage.persist) {
      void navigator.storage.persisted().then((already) => {
        if (!already) {
          void navigator.storage.persist();
        }
      });
    }
  }, []);

  const navigate = (route: NavRoute, searchFilter = '') => {
    setRecordsInitialSearch(route === 'records' ? searchFilter : '');
    setActiveRoute(route);
    setDrawerOpen(false);
    window.scrollTo({ top: 0, behavior: 'auto' });
  };

  const currentNav =
    NAV_ITEMS.find((item) => item.id === activeRoute) ?? NAV_ITEMS[0];

  const renderPage = () => {
    switch (activeRoute) {
      case 'dashboard':
        return <DashboardPage onNavigate={navigate} />;
      case 'scan':
        return <ScanBarcodePage />;
      case 'manual':
        return <ManualEntryPage />;
      case 'records':
        return (
          <ExpiryRecordsPage
            key={recordsInitialSearch || 'all'}
            initialSearch={recordsInitialSearch}
          />
        );
      case 'upcoming':
        return <Upcoming90Page />;
      case 'expired':
        return <ExpiredProductsPage />;
      case 'master':
        return (
          <MasterDatabasePage
            onNavigate={navigate}
            onViewBatches={(ean) => navigate('records', ean)}
          />
        );
      case 'excel':
        return <ExcelImportExportPage />;
      case 'backup':
        return <BackupRestorePage />;
      case 'settings':
        return <SettingsPage onPreferencesUpdated={setPrefs} />;
      default:
        return <DashboardPage onNavigate={navigate} />;
    }
  };

  return (
    <div className="min-h-screen bg-slate-50 text-slate-900">
      {/* Desktop Sidebar */}
      <aside className="fixed inset-y-0 left-0 z-30 hidden w-64 flex-col border-r border-slate-200 bg-white lg:flex">
        <div className="flex h-16 items-center border-b border-slate-200 px-5">
          <div className="min-w-0">
            <div className="truncate text-base font-bold tracking-tight text-slate-900">
              Retail Expiry Manager
            </div>
            <div className="truncate text-xs text-slate-500">
              {prefs.storeName}
            </div>
          </div>
        </div>

        <nav aria-label="Main navigation" className="flex-1 space-y-1 overflow-y-auto p-3">
          {NAV_ITEMS.map((item) => {
            const Icon = item.icon;
            const active = activeRoute === item.id;
            return (
              <button
                key={item.id}
                type="button"
                onClick={() => navigate(item.id)}
                aria-current={active ? 'page' : undefined}
                className={`flex min-h-[44px] w-full items-center gap-3 whitespace-nowrap rounded-lg px-3.5 py-2.5 text-left text-sm font-semibold transition-colors ${
                  active
                    ? 'bg-slate-900 text-white'
                    : 'text-slate-700 hover:bg-slate-100 hover:text-slate-900'
                }`}
              >
                <Icon
                  className={`h-4 w-4 shrink-0 ${
                    active ? 'text-blue-400' : 'text-slate-500'
                  }`}
                />
                <span className="truncate">{item.label}</span>
              </button>
            );
          })}
        </nav>

        <div className="border-t border-slate-200 p-4">
          <PWAInstallButton />
        </div>
      </aside>

      {/* Main Content Shell */}
      <div className="flex min-h-screen flex-col lg:pl-64">
        {/* Top Bar (56px mobile, 64px desktop) */}
        <header className="sticky top-0 z-20 flex h-14 items-center justify-between gap-4 border-b border-slate-200 bg-white/95 px-4 backdrop-blur-sm sm:px-6 lg:h-16">
          <div className="flex min-w-0 items-center gap-3">
            <button
              type="button"
              onClick={() => setDrawerOpen(true)}
              aria-label="Open navigation menu"
              className="flex min-h-[44px] min-w-[44px] items-center justify-center rounded-lg text-slate-700 hover:bg-slate-100 lg:hidden"
            >
              <Menu className="h-5 w-5" />
            </button>
            <h1 className="truncate text-base font-bold text-slate-900 sm:text-lg">
              {currentNav.label}
            </h1>
          </div>

          <div className="flex shrink-0 items-center gap-2.5">
            <div className="lg:hidden">
              <PWAInstallButton compact />
            </div>
            {activeRoute !== 'scan' && (
              <button
                type="button"
                onClick={() => navigate('scan')}
                className="inline-flex min-h-[40px] items-center gap-1.5 whitespace-nowrap rounded-lg bg-blue-600 px-3.5 py-2 text-xs font-semibold text-white hover:bg-blue-700"
              >
                <ScanBarcode className="h-4 w-4 shrink-0" />
                <span>Scan</span>
              </button>
            )}
          </div>
        </header>

        {/* Viewport Content */}
        <main className="mx-auto w-full max-w-6xl flex-1 px-4 py-5 pb-24 sm:px-6 lg:py-6 lg:pb-8">
          {renderPage()}
        </main>
      </div>

      {/* Mobile Bottom Navigation Bar (64px) */}
      <nav
        aria-label="Mobile quick navigation"
        className="fixed bottom-0 left-0 right-0 z-20 grid h-16 grid-cols-5 border-t border-slate-200 bg-white/95 backdrop-blur-sm pb-safe lg:hidden"
      >
        {MOBILE_TABS.map((routeId) => {
          const item = NAV_ITEMS.find((n) => n.id === routeId)!;
          const Icon = item.icon;
          const active = activeRoute === routeId;
          return (
            <button
              key={routeId}
              type="button"
              onClick={() => navigate(routeId)}
              aria-current={active ? 'page' : undefined}
              className={`flex min-h-[44px] flex-col items-center justify-center gap-1 px-1 text-[11px] font-semibold ${
                active ? 'text-blue-600' : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              <Icon className="h-5 w-5 shrink-0" />
              <span className="truncate">{item.shortLabel}</span>
            </button>
          );
        })}

        <button
          type="button"
          onClick={() => setDrawerOpen(true)}
          aria-label="More menu"
          className="flex min-h-[44px] flex-col items-center justify-center gap-1 px-1 text-[11px] font-semibold text-slate-600 hover:text-slate-900"
        >
          <Menu className="h-5 w-5 shrink-0" />
          <span>Menu</span>
        </button>
      </nav>

      {/* Mobile Full Navigation Drawer */}
      {drawerOpen && (
        <div
          className="fixed inset-0 z-50 flex lg:hidden"
          role="dialog"
          aria-modal="true"
          aria-label="All navigation routes"
        >
          <div
            className="fixed inset-0 bg-slate-900/50"
            onClick={() => setDrawerOpen(false)}
          />
          <div className="relative z-10 flex h-full w-72 max-w-[85vw] flex-col bg-white shadow-xl">
            <div className="flex h-14 items-center justify-between border-b border-slate-200 px-4">
              <div className="min-w-0">
                <div className="truncate text-sm font-bold text-slate-900">
                  Retail Expiry Manager
                </div>
                <div className="truncate text-xs text-slate-500">
                  {prefs.storeName}
                </div>
              </div>
              <button
                type="button"
                onClick={() => setDrawerOpen(false)}
                aria-label="Close navigation menu"
                className="flex min-h-[44px] min-w-[44px] items-center justify-center rounded-lg text-slate-500 hover:bg-slate-100"
              >
                <X className="h-5 w-5" />
              </button>
            </div>

            <nav className="flex-1 space-y-1 overflow-y-auto p-3">
              {NAV_ITEMS.map((item) => {
                const Icon = item.icon;
                const active = activeRoute === item.id;
                return (
                  <button
                    key={item.id}
                    type="button"
                    onClick={() => navigate(item.id)}
                    className={`flex min-h-[44px] w-full items-center gap-3 rounded-lg px-3.5 py-2.5 text-left text-sm font-semibold ${
                      active
                        ? 'bg-slate-900 text-white'
                        : 'text-slate-700 hover:bg-slate-100'
                    }`}
                  >
                    <Icon
                      className={`h-4 w-4 shrink-0 ${
                        active ? 'text-blue-400' : 'text-slate-500'
                      }`}
                    />
                    <span>{item.label}</span>
                  </button>
                );
              })}
            </nav>

            <div className="border-t border-slate-200 p-4">
              <PWAInstallButton />
            </div>
          </div>
        </div>
      )}

      <OfflineIndicator />
    </div>
  );
}
