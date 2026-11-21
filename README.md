# Retail Expiry Manager

An offline-first Progressive Web App (PWA) built with React, TypeScript, Vite, Tailwind CSS, IndexedDB (Dexie.js), ZXing barcode scanning, and SheetJS (xlsx) for retail expiry date tracking and batch inventory management.

All data is stored 100% locally on your device. No cloud database, external APIs, or internet connection are required after initial installation.

---

## Features

- **100% Offline PWA**: Pre-caches the entire application shell, fonts, scanner engine, and Excel library via Service Worker (`vite-plugin-pwa`).
- **Master Product Excel Import**: Upload `.xlsx` or `.xls` catalogs (`EAN Number`, `Product Code`, `Product Description`), preview rows, detect duplicate EANs and missing fields, preserve leading zeros as text, and update master records without deleting existing expiry batches.
- **Mobile Camera Barcode Scanner**: Rear camera support via Web Camera API + ZXing (`EAN-13`, `EAN-8`, `UPC-A`, `UPC-E`, `Code 128`), flashlight toggle, camera switching, duplicate detection cooldown, and manual barcode lookup.
- **Automatic Master Matching & Unmatched EAN Correction**:
  - Exact EAN matches auto-populate Product Code and Description immediately.
  - Unmatched barcodes display `PRODUCT NOT FOUND` with an editable EAN field that automatically re-searches the Master Database while preserving the Original Scanned Barcode separately from the Corrected EAN.
  - Option to permanently add newly entered products to the Master Database.
- **Multi-Batch Expiry Tracking**: Store unlimited separate expiry batches with independent quantities for the same product. Edit or delete individual batches with confirmation.
- **Dashboard & Reports**: Local calendar date calculations for Expired, 0–30 Days, 31–60 Days, 61–90 Days, and Above 90 Days, plus dedicated Upcoming 90 Days and Expired Products reports.
- **Offline Excel Export (.xlsx)**: Export Master Product Database, Complete Expiry Database (`EAN Number`, `Product Code`, `Product Description`, `Expiry Date` as `DD-MM-YYYY`, `Quantity`), Upcoming 90 Days Report, and Expired Products Report.
- **JSON Backup & Restore**: Full offline JSON backup export and atomic restore/merge.

---

## How to Run Locally

```bash
npm install
npm run dev
```

Open `http://localhost:3000` in your browser. Note: Camera access on mobile devices requires `https://` (or `localhost` on desktop).

---

## How to Build

```bash
npm run build
```

This generates the static production bundle inside `dist/`, including the Web App Manifest (`manifest.webmanifest`) and Workbox Service Worker (`sw.js`).

---

## How to Deploy as a Static PWA on GitHub Pages

1. An automated workflow is included at `.github/workflows/deploy.yml`. Enable **Settings -> Pages -> Source: GitHub Actions** in your repository, then push to `main` (or trigger `workflow_dispatch`).
2. The workflow automatically runs `npm run lint`, `npm test`, sets `VITE_BASE_PATH` (`/` for `*.github.io` repositories or `/<repo-name>/` for project repositories), builds `dist/`, and deploys to GitHub Pages.
3. For manual local builds:
   - Project repo (`https://<username>.github.io/<repo-name>/`):
     ```bash
     VITE_BASE_PATH=/<repo-name>/ npm run build
     ```
   - Root/custom domain (`https://<username>.github.io/`):
     ```bash
     npm run build
     ```
4. GitHub Pages automatically serves over **HTTPS**, which enables Service Worker offline caching and Android Web Camera permissions.

---

## How to Install on Android

1. Open the deployed HTTPS URL in **Google Chrome** on your Android phone.
2. Wait 2–3 seconds for the Service Worker to cache assets, then tap the **Install App** button in the top bar/menu (or open Chrome's three-dot menu and tap **Install app** / **Add to Home screen**).
3. Launch **ExpiryMgr** from your Android home screen. It opens in standalone app mode without browser bars.

---

## How to Upload Master Excel

1. Prepare an `.xlsx` or `.xls` workbook with these exact column headings in Row 1:
   - `EAN Number`
   - `Product Code`
   - `Product Description`
2. Open **Excel Import/Export** from the navigation menu (or tap **Download Sample Template** to inspect the format).
3. Select your Excel file. Leading zeros in `EAN Number` and `Product Code` are preserved as text.
4. Review the preview counts (Valid Ready, Duplicate EANs, Missing Fields).
5. Choose whether to **Update existing & add new products** or **Replace Master Catalog only** (neither option deletes existing expiry batches), then tap **Import**.

---

## How to Scan Barcodes & Enter Expiry Batches

1. Open **Scan Barcode**.
2. Tap **Start Camera** and grant camera permission. Point the rear camera at an `EAN-13`, `EAN-8`, `UPC-A`, `UPC-E`, or `Code 128` barcode (use **Flashlight** or **Switch Camera** if needed, or enter the barcode in **Manual Barcode Lookup**).
3. **If Matched**: Product Code and Description auto-fill. Enter **Expiry Date** and **Quantity**, then tap **Save Expiry Batch**.
4. **If Not Found**: `PRODUCT NOT FOUND` appears showing the preserved **Original Scanned Barcode**. Edit the **Editable EAN Number** to automatically re-search the Master Database, or fill in Product Code and Description manually (optionally check **Add this new product permanently to Master Database**).
5. After saving, tap **SCAN NEXT PRODUCT** to reopen the camera immediately, or **Add Another Expiry Date for Same Product** to log another batch for the same item.

---

## How to Export Excel

1. Open **Excel Import/Export** (or use the Export buttons on **Upcoming 90 Days**, **Expired Products**, **Expiry Records**, or **Master Database**).
2. Download any of the four `.xlsx` workbooks offline:
   - **Master Product Database**
   - **Complete Expiry Database** (`EAN Number`, `Product Code`, `Product Description`, `Expiry Date`, `Quantity`)
   - **Upcoming 90 Days Report**
   - **Expired Products Report**

---

## How to Backup and Restore

1. Open **Backup & Restore**.
2. Tap **Export JSON Backup** to download a complete `.json` snapshot of your Master Products, Expiry Batches, and Settings.
3. To restore on the same or a new device, tap **Select JSON Backup File**, choose **Full Replace Restore** or **Merge Backup**, and confirm.

---

## How to Use Offline

1. Visit the app once over HTTPS (or install it to your Android Home Screen).
2. Open **Settings** to verify **Service Worker: Cached & Active** and optionally tap **Request Persistent Storage** so Android Chrome protects your IndexedDB records.
3. Disconnect Wi-Fi and mobile data. Scanning, master lookups, expiry calculations, reports, Excel import/export, and JSON backup/restore all continue operating 100% locally.
