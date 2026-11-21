import React, { useCallback, useEffect, useRef, useState } from 'react';
import { BrowserMultiFormatReader, type IScannerControls } from '@zxing/browser';
import { BarcodeFormat, DecodeHintType } from '@zxing/library';
import { useLiveQuery } from 'dexie-react-hooks';
import {
  AlertTriangle,
  Camera,
  CameraOff,
  CheckCircle2,
  Flashlight,
  Keyboard,
  RefreshCw,
  RotateCcw,
  ScanBarcode,
  Search,
} from 'lucide-react';
import {
  addExpiryBatch,
  db,
  findMasterProductByEan,
  getAppPreferences,
  upsertMasterProduct,
} from '../db/database';
import type { MasterProduct } from '../types/inventory';
import {
  AsyncLookupGuard,
  resolveEanCorrectionChange,
} from '../utils/eanLookupState';
import { formatDisplayDate } from '../utils/expiryCalculations';
import { playScanFeedback } from '../utils/feedback';
import { normalizeBarcodeText, validateBatchInput } from '../utils/validation';

type ScanMatchState = 'idle' | 'matched' | 'not_found' | 'saved';

export const ScanBarcodePage: React.FC = () => {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const controlsRef = useRef<IScannerControls | null>(null);
  const lastScanRef = useRef<{ code: string; at: number }>({ code: '', at: 0 });
  const lookupGuardRef = useRef(new AsyncLookupGuard());

  const [cameraActive, setCameraActive] = useState(false);
  const [cameraError, setCameraError] = useState<string | null>(null);
  const [cameras, setCameras] = useState<MediaDeviceInfo[]>([]);
  const [selectedDeviceId, setSelectedDeviceId] = useState<string>('');
  const [torchSupported, setTorchSupported] = useState(false);
  const [torchOn, setTorchOn] = useState(false);

  const [manualInput, setManualInput] = useState('');
  const [scanState, setScanState] = useState<ScanMatchState>('idle');

  // Scanned & matched product fields
  const [originalScannedBarcode, setOriginalScannedBarcode] = useState('');
  const [editableEan, setEditableEan] = useState('');
  const [wasInitiallyUnmatched, setWasInitiallyUnmatched] = useState(false);
  const [matchedMaster, setMatchedMaster] = useState<MasterProduct | null>(null);
  const [productCode, setProductCode] = useState('');
  const [description, setDescription] = useState('');
  const [expiryDate, setExpiryDate] = useState('');
  const [quantity, setQuantity] = useState('1');
  const [saveToMasterToo, setSaveToMasterToo] = useState(false);

  const [formErrors, setFormErrors] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);
  const [lastSavedSummary, setLastSavedSummary] = useState<{
    ean: string;
    productCode: string;
    description: string;
    expiryDate: string;
    quantity: number;
  } | null>(null);

  // Live query of existing batches for the currently active EAN so operator sees multi-batch history
  const activeEanForBatches = normalizeBarcodeText(
    matchedMaster?.ean || editableEan
  );
  const existingBatches = useLiveQuery(
    async () => {
      if (!activeEanForBatches) return [];
      return db.expiryBatches
        .where('ean')
        .equals(activeEanForBatches)
        .sortBy('expiryDate');
    },
    [activeEanForBatches],
    []
  );

  const stopCamera = useCallback(() => {
    if (controlsRef.current) {
      try {
        controlsRef.current.stop();
      } catch {
        // Ignore stop cleanup error
      }
      controlsRef.current = null;
    }
    if (videoRef.current && videoRef.current.srcObject) {
      const stream = videoRef.current.srcObject as MediaStream;
      stream.getTracks().forEach((t) => t.stop());
      videoRef.current.srcObject = null;
    }
    setCameraActive(false);
    setTorchOn(false);
    setTorchSupported(false);
  }, []);

  const lookupAndPopulateBarcode = useCallback(
    async (rawBarcode: string, isInitialScan: boolean) => {
      const clean = normalizeBarcodeText(rawBarcode);
      if (!clean) return;

      const seq = lookupGuardRef.current.next();

      if (isInitialScan) {
        setOriginalScannedBarcode(clean);
        setEditableEan(clean);
        setMatchedMaster(null);
        setProductCode('');
        setDescription('');
        setExpiryDate('');
        setQuantity('1');
        setFormErrors({});
        setSaveToMasterToo(false);
      }

      const [prefs, found] = await Promise.all([
        getAppPreferences(),
        findMasterProductByEan(clean),
      ]);

      // Ignore stale async lookup if a newer barcode scan/edit started
      if (!lookupGuardRef.current.isLatest(seq)) {
        return;
      }

      if (found) {
        if (isInitialScan) {
          setWasInitiallyUnmatched(false);
        }
        setMatchedMaster(found);
        setProductCode(found.productCode);
        setDescription(found.description);
        setScanState('matched');
        if (isInitialScan) {
          playScanFeedback({
            beep: prefs.scannerBeep,
            vibrate: prefs.scannerVibrate,
            type: 'success',
          });
        }
      } else {
        if (isInitialScan) {
          setWasInitiallyUnmatched(true);
        }
        setMatchedMaster(null);
        setProductCode('');
        setDescription('');
        if (isInitialScan) {
          playScanFeedback({
            beep: prefs.scannerBeep,
            vibrate: prefs.scannerVibrate,
            type: 'warning',
          });
        }
        setScanState('not_found');
      }
    },
    []
  );

  const startCamera = useCallback(
    async (preferredDeviceId?: string) => {
      setCameraError(null);
      stopCamera();

      if (
        typeof navigator === 'undefined' ||
        !navigator.mediaDevices ||
        !navigator.mediaDevices.getUserMedia
      ) {
        setCameraError(
          'Camera API is unavailable in this browser context. Use Manual Barcode Entry below.'
        );
        return;
      }

      try {
        const prefs = await getAppPreferences();
        const cooldownMs =
          Number.isFinite(prefs.scanCooldownMs) && prefs.scanCooldownMs > 0
            ? prefs.scanCooldownMs
            : 2200;

        const hints = new Map();
        hints.set(DecodeHintType.POSSIBLE_FORMATS, [
          BarcodeFormat.EAN_13,
          BarcodeFormat.EAN_8,
          BarcodeFormat.UPC_A,
          BarcodeFormat.UPC_E,
          BarcodeFormat.CODE_128,
        ]);
        hints.set(DecodeHintType.TRY_HARDER, true);

        const reader = new BrowserMultiFormatReader(hints, {
          delayBetweenScanAttempts: 180,
        });

        if (!videoRef.current) return;

        // On Android, device labels are hidden before permission is granted, so request
        // rear camera via facingMode first unless the user explicitly selected a camera.
        const explicitDeviceId = preferredDeviceId ?? (selectedDeviceId || undefined);
        const constraints: MediaStreamConstraints = explicitDeviceId
          ? { video: { deviceId: { exact: explicitDeviceId } } }
          : {
              video: {
                facingMode: { ideal: 'environment' },
                width: { ideal: 1280 },
                height: { ideal: 720 },
              },
            };

        const controls = await reader.decodeFromConstraints(
          constraints,
          videoRef.current,
          (result) => {
            if (!result) return;
            const text = normalizeBarcodeText(result.getText());
            if (!text) return;

            const now = Date.now();
            if (
              lastScanRef.current.code === text &&
              now - lastScanRef.current.at < cooldownMs
            ) {
              return;
            }
            lastScanRef.current = { code: text, at: now };

            stopCamera();
            void lookupAndPopulateBarcode(text, true);
          }
        );

        controlsRef.current = controls;
        setCameraActive(true);

        // Now that camera permission is active, enumerate devices with full labels
        const videoDevices = await BrowserMultiFormatReader.listVideoInputDevices();
        setCameras(videoDevices);

        const stream = videoRef.current.srcObject as MediaStream | null;
        const track = stream?.getVideoTracks()?.[0];
        if (track) {
          const settings = track.getSettings?.();
          if (settings?.deviceId) {
            setSelectedDeviceId(settings.deviceId);
          }
          if (typeof track.getCapabilities === 'function') {
            const caps = track.getCapabilities() as MediaTrackCapabilities & {
              torch?: boolean;
            };
            setTorchSupported(Boolean(caps.torch));
          }
        }
      } catch (err) {
        const msg =
          err instanceof Error
            ? err.name === 'NotAllowedError'
              ? 'Camera permission denied. Please grant camera access in browser settings or use Manual Barcode Input below.'
              : err.name === 'NotFoundError'
              ? 'No camera hardware detected on this device. Use Manual Barcode Input below.'
              : `Camera error: ${err.message}`
            : 'Unable to start camera.';
        setCameraError(msg);
        setCameraActive(false);
      }
    },
    [lookupAndPopulateBarcode, selectedDeviceId, stopCamera]
  );

  useEffect(() => {
    return () => {
      stopCamera();
    };
  }, [stopCamera]);

  const handleToggleTorch = async () => {
    const stream = videoRef.current?.srcObject as MediaStream | null;
    const track = stream?.getVideoTracks()?.[0];
    if (!track) return;
    const next = !torchOn;
    try {
      await track.applyConstraints({
        advanced: [{ torch: next } as MediaTrackConstraintSet],
      });
      setTorchOn(next);
    } catch {
      setTorchSupported(false);
    }
  };

  const handleSwitchCamera = async () => {
    if (cameras.length < 2) return;
    const idx = cameras.findIndex((c) => c.deviceId === selectedDeviceId);
    const nextCam = cameras[(idx + 1) % cameras.length];
    setSelectedDeviceId(nextCam.deviceId);
    await startCamera(nextCam.deviceId);
  };

  const handleManualBarcodeSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const clean = normalizeBarcodeText(manualInput);
    if (!clean) return;
    stopCamera();
    await lookupAndPopulateBarcode(clean, true);
  };

  // Automatic re-search whenever the user edits the unmatched EAN
  const handleEditableEanChange = async (nextVal: string) => {
    const seq = lookupGuardRef.current.next();
    // Immediately clear prior product code & description so stale data is never shown
    const pendingReset = resolveEanCorrectionChange(nextVal, null);
    setEditableEan(pendingReset.editableEan);
    setMatchedMaster(pendingReset.matchedMaster);
    setProductCode(pendingReset.productCode);
    setDescription(pendingReset.description);
    setFormErrors((prev) => ({
      ...prev,
      ean: '',
      productCode: '',
      description: '',
    }));

    const clean = normalizeBarcodeText(nextVal);
    if (!clean) {
      setScanState('not_found');
      return;
    }

    const found = await findMasterProductByEan(clean);
    if (!lookupGuardRef.current.isLatest(seq)) {
      return;
    }

    const resolved = resolveEanCorrectionChange(nextVal, found);
    setMatchedMaster(resolved.matchedMaster);
    setProductCode(resolved.productCode);
    setDescription(resolved.description);
    setScanState(resolved.scanState);
  };

  const handleSaveBatch = async (e: React.FormEvent) => {
    e.preventDefault();
    const cleanEan = normalizeBarcodeText(editableEan);
    const validation = validateBatchInput({
      ean: cleanEan,
      eanRequired: true,
      productCode,
      description,
      expiryDate,
      quantity,
    });

    if (!validation.valid) {
      setFormErrors(validation.errors);
      return;
    }

    setSaving(true);
    try {
      let masterId = matchedMaster?.id;
      if (!matchedMaster && saveToMasterToo) {
        const upserted = await upsertMasterProduct({
          ean: cleanEan,
          productCode,
          description,
        });
        masterId = upserted.id;
      }

      const correctedEan =
        cleanEan !== originalScannedBarcode ? cleanEan : undefined;

      await addExpiryBatch({
        masterProductId: masterId,
        ean: cleanEan,
        productCode,
        description,
        expiryDate,
        quantity: Number(quantity),
        originalScannedBarcode,
        correctedEan,
        entryType: 'scan',
      });

      setLastSavedSummary({
        ean: cleanEan,
        productCode: productCode.trim(),
        description: description.trim(),
        expiryDate,
        quantity: Number(quantity),
      });
      setScanState('saved');
    } finally {
      setSaving(false);
    }
  };

  const handleScanNextProduct = () => {
    lookupGuardRef.current.invalidate();
    setScanState('idle');
    setManualInput('');
    setOriginalScannedBarcode('');
    setEditableEan('');
    setWasInitiallyUnmatched(false);
    setMatchedMaster(null);
    setProductCode('');
    setDescription('');
    setExpiryDate('');
    setQuantity('1');
    setSaveToMasterToo(false);
    setFormErrors({});
    lastScanRef.current = { code: '', at: 0 };
    void startCamera();
  };

  const handleAddAnotherBatchForSameProduct = () => {
    setExpiryDate('');
    setQuantity('1');
    setFormErrors({});
    setScanState(matchedMaster ? 'matched' : 'not_found');
  };

  return (
    <div className="mx-auto max-w-4xl space-y-6">
      {/* Camera & Manual Barcode Capture Card */}
      {scanState === 'idle' && (
        <div className="grid grid-cols-1 gap-6 lg:grid-cols-12">
          <div className="rounded-xl border border-slate-200 bg-white p-5 lg:col-span-7">
            <div className="flex items-center justify-between gap-3">
              <div>
                <h2 className="text-base font-bold text-slate-900">
                  Camera Barcode Scanner
                </h2>
                <p className="text-xs text-slate-500">
                  Supports EAN-13, EAN-8, UPC-A, UPC-E, and Code 128 offline
                </p>
              </div>
              {cameraActive ? (
                <button
                  type="button"
                  onClick={stopCamera}
                  className="inline-flex min-h-[40px] items-center gap-1.5 rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-50"
                >
                  <CameraOff className="h-4 w-4" />
                  <span>Stop</span>
                </button>
              ) : (
                <button
                  type="button"
                  onClick={() => void startCamera()}
                  className="inline-flex min-h-[40px] items-center gap-1.5 rounded-lg bg-blue-600 px-3.5 py-2 text-xs font-semibold text-white hover:bg-blue-700"
                >
                  <Camera className="h-4 w-4" />
                  <span>Start Camera</span>
                </button>
              )}
            </div>

            <div className="relative mt-4 aspect-[4/3] w-full overflow-hidden rounded-xl border border-slate-200 bg-slate-900">
              <video
                ref={videoRef}
                className="h-full w-full object-cover"
                playsInline
                muted
              />
              {!cameraActive && (
                <div className="absolute inset-0 flex flex-col items-center justify-center p-6 text-center text-white">
                  <ScanBarcode className="h-12 w-12 text-slate-400" />
                  <p className="mt-3 text-sm font-medium text-slate-200">
                    {cameraError || 'Tap Start Camera to scan product barcodes with your rear camera'}
                  </p>
                  {!cameraError && (
                    <button
                      type="button"
                      onClick={() => void startCamera()}
                      className="mt-4 min-h-[44px] rounded-lg bg-blue-600 px-5 py-2.5 text-sm font-semibold text-white hover:bg-blue-700"
                    >
                      Enable Rear Camera
                    </button>
                  )}
                </div>
              )}

              {cameraActive && (
                <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
                  <div className="h-28 w-4/5 max-w-xs rounded-lg border-2 border-blue-400/90 shadow-[0_0_0_9999px_rgba(15,23,42,0.35)]">
                    <div className="mt-13 h-0.5 w-full bg-red-500/80" />
                  </div>
                </div>
              )}
            </div>

            {cameraActive && (
              <div className="mt-3 flex flex-wrap items-center gap-2">
                {torchSupported && (
                  <button
                    type="button"
                    onClick={() => void handleToggleTorch()}
                    className={`inline-flex min-h-[44px] items-center gap-2 rounded-lg border px-3.5 py-2 text-xs font-semibold ${
                      torchOn
                        ? 'border-amber-400 bg-amber-50 text-amber-800'
                        : 'border-slate-300 bg-white text-slate-700 hover:bg-slate-50'
                    }`}
                  >
                    <Flashlight className="h-4 w-4" />
                    <span>{torchOn ? 'Flashlight On' : 'Flashlight'}</span>
                  </button>
                )}

                {cameras.length > 1 && (
                  <button
                    type="button"
                    onClick={() => void handleSwitchCamera()}
                    className="inline-flex min-h-[44px] items-center gap-2 rounded-lg border border-slate-300 bg-white px-3.5 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-50"
                  >
                    <RefreshCw className="h-4 w-4" />
                    <span>Switch Camera</span>
                  </button>
                )}
              </div>
            )}
          </div>

          {/* Manual Barcode Input Panel */}
          <div className="rounded-xl border border-slate-200 bg-white p-5 lg:col-span-5">
            <div className="flex items-center gap-2">
              <Keyboard className="h-5 w-5 text-blue-600" />
              <h2 className="text-base font-bold text-slate-900">
                Manual Barcode Lookup
              </h2>
            </div>
            <p className="mt-1 text-xs leading-relaxed text-slate-600">
              Type or paste an EAN-13, EAN-8, UPC, or Code 128 barcode, or use a USB/Bluetooth hardware barcode scanner.
            </p>

            <form onSubmit={handleManualBarcodeSubmit} className="mt-4 space-y-3">
              <div>
                <label
                  htmlFor="manual-barcode-input"
                  className="block text-xs font-semibold text-slate-700"
                >
                  Barcode / EAN Number
                </label>
                <input
                  id="manual-barcode-input"
                  type="text"
                  inputMode="text"
                  placeholder="e.g. 8901234567890"
                  value={manualInput}
                  onChange={(e) => setManualInput(e.target.value)}
                  className="mt-1.5 min-h-[48px] w-full rounded-lg border border-slate-300 px-3.5 font-mono text-base text-slate-900 focus:border-blue-600 focus:outline-none focus:ring-1 focus:ring-blue-600"
                />
              </div>
              <button
                type="submit"
                disabled={!manualInput.trim()}
                className="inline-flex min-h-[48px] w-full items-center justify-center gap-2 rounded-lg bg-slate-900 px-4 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-slate-800 disabled:opacity-50"
              >
                <Search className="h-4 w-4" />
                <span>Lookup Barcode</span>
              </button>
            </form>
          </div>
        </div>
      )}

      {/* Matched or Unmatched Product Entry Form */}
      {(scanState === 'matched' || scanState === 'not_found') && (
        <div className="rounded-xl border border-slate-200 bg-white p-5 sm:p-6">
          {scanState === 'matched' && matchedMaster ? (
            <div className="flex flex-col gap-3 rounded-xl border border-emerald-200 bg-emerald-50 p-4 sm:flex-row sm:items-center sm:justify-between">
              <div className="flex items-start gap-3">
                <CheckCircle2 className="mt-0.5 h-5 w-5 shrink-0 text-emerald-600" />
                <div>
                  <div className="text-sm font-bold text-emerald-950">
                    {editableEan !== originalScannedBarcode
                      ? 'Master Match Found via Corrected EAN'
                      : 'Master Product Matched'}
                  </div>
                  <div className="mt-0.5 text-xs text-emerald-800">
                    Product code and description auto-populated. Enter expiry date and quantity to save batch.
                  </div>
                </div>
              </div>
              <button
                type="button"
                onClick={handleScanNextProduct}
                className="inline-flex min-h-[40px] items-center gap-1.5 self-start whitespace-nowrap rounded-lg border border-emerald-300 bg-white px-3 py-1.5 text-xs font-semibold text-emerald-900 hover:bg-emerald-50 sm:self-auto"
              >
                <RotateCcw className="h-3.5 w-3.5" />
                <span>Scan Different Barcode</span>
              </button>
            </div>
          ) : (
            <div className="flex flex-col gap-3 rounded-xl border border-amber-300 bg-amber-50 p-4 sm:flex-row sm:items-center sm:justify-between">
              <div className="flex items-start gap-3">
                <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0 text-amber-700" />
                <div>
                  <div className="text-sm font-bold text-amber-950">
                    PRODUCT NOT FOUND
                  </div>
                  <div className="mt-0.5 text-xs text-amber-900">
                    Original barcode was not found in Master Database. Edit the EAN below to re-search automatically, or enter product details manually.
                  </div>
                </div>
              </div>
              <button
                type="button"
                onClick={handleScanNextProduct}
                className="inline-flex min-h-[40px] items-center gap-1.5 self-start whitespace-nowrap rounded-lg border border-amber-300 bg-white px-3 py-1.5 text-xs font-semibold text-amber-900 hover:bg-amber-50 sm:self-auto"
              >
                <RotateCcw className="h-3.5 w-3.5" />
                <span>Cancel & Rescan</span>
              </button>
            </div>
          )}

          <form onSubmit={handleSaveBatch} className="mt-5 space-y-5">
            {/* Scanned / Corrected EAN Audit Row */}
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <div className="rounded-lg border border-slate-200 bg-slate-50 px-3.5 py-2.5">
                <div className="text-xs font-semibold text-slate-500">
                  Original Scanned Barcode (Preserved)
                </div>
                <div
                  data-testid="original-scanned-ean"
                  className="mt-1 font-mono text-sm font-bold text-slate-900"
                >
                  {originalScannedBarcode}
                </div>
              </div>

              {scanState === 'matched' && matchedMaster && !wasInitiallyUnmatched ? (
                <div className="rounded-lg border border-slate-200 bg-slate-50 px-3.5 py-2.5">
                  <div className="text-xs font-semibold text-slate-500">
                    Matched Master EAN
                  </div>
                  <div className="mt-1 font-mono text-sm font-bold text-blue-700">
                    {matchedMaster.ean}
                  </div>
                </div>
              ) : (
                <div>
                  <label
                    htmlFor="editable-ean-input"
                    className="block text-xs font-semibold text-slate-700"
                  >
                    Editable EAN Number (Auto-searches Master DB)
                  </label>
                  <input
                    id="editable-ean-input"
                    type="text"
                    value={editableEan}
                    onChange={(e) => void handleEditableEanChange(e.target.value)}
                    className="mt-1.5 min-h-[44px] w-full rounded-lg border border-slate-300 px-3.5 font-mono text-sm text-slate-900 focus:border-blue-600 focus:outline-none focus:ring-1 focus:ring-blue-600"
                  />
                  {formErrors.ean && (
                    <p className="mt-1 text-xs text-red-600">{formErrors.ean}</p>
                  )}
                </div>
              )}
            </div>

            {/* Product Details */}
            {scanState === 'matched' && matchedMaster ? (
              <div className="grid grid-cols-1 gap-4 rounded-xl border border-slate-200 bg-slate-50/60 p-4 sm:grid-cols-3">
                <div>
                  <div className="text-xs font-semibold text-slate-500">
                    Company Product Code
                  </div>
                  <div className="mt-1 font-mono text-base font-bold text-slate-900">
                    {matchedMaster.productCode}
                  </div>
                </div>
                <div className="sm:col-span-2">
                  <div className="text-xs font-semibold text-slate-500">
                    Product Description
                  </div>
                  <div className="mt-1 text-base font-bold text-slate-900">
                    {matchedMaster.description}
                  </div>
                </div>
              </div>
            ) : (
              <div className="space-y-4">
                <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                  <div>
                    <label
                      htmlFor="unmatched-product-code"
                      className="block text-xs font-semibold text-slate-700"
                    >
                      Article Number / Product Code *
                    </label>
                    <input
                      id="unmatched-product-code"
                      type="text"
                      placeholder="e.g. ABC1001"
                      value={productCode}
                      onChange={(e) => {
                        setProductCode(e.target.value);
                        setFormErrors((p) => ({ ...p, productCode: '' }));
                      }}
                      className="mt-1.5 min-h-[44px] w-full rounded-lg border border-slate-300 px-3.5 font-mono text-sm text-slate-900 focus:border-blue-600 focus:outline-none focus:ring-1 focus:ring-blue-600"
                    />
                    {formErrors.productCode && (
                      <p className="mt-1 text-xs text-red-600">
                        {formErrors.productCode}
                      </p>
                    )}
                  </div>

                  <div>
                    <label
                      htmlFor="unmatched-product-desc"
                      className="block text-xs font-semibold text-slate-700"
                    >
                      Product Description *
                    </label>
                    <input
                      id="unmatched-product-desc"
                      type="text"
                      placeholder="Enter product description"
                      value={description}
                      onChange={(e) => {
                        setDescription(e.target.value);
                        setFormErrors((p) => ({ ...p, description: '' }));
                      }}
                      className="mt-1.5 min-h-[44px] w-full rounded-lg border border-slate-300 px-3.5 text-sm text-slate-900 focus:border-blue-600 focus:outline-none focus:ring-1 focus:ring-blue-600"
                    />
                    {formErrors.description && (
                      <p className="mt-1 text-xs text-red-600">
                        {formErrors.description}
                      </p>
                    )}
                  </div>
                </div>

                <label className="flex min-h-[44px] cursor-pointer items-center gap-2.5 rounded-lg border border-slate-200 bg-slate-50 px-3.5 py-2.5 text-sm font-medium text-slate-800">
                  <input
                    type="checkbox"
                    checked={saveToMasterToo}
                    onChange={(e) => setSaveToMasterToo(e.target.checked)}
                    className="h-4 w-4 rounded border-slate-300 text-blue-600 focus:ring-blue-600"
                  />
                  <span>
                    Add this new product permanently to Master Database
                  </span>
                </label>
              </div>
            )}

            {/* Expiry Date & Quantity Inputs */}
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <div>
                <label
                  htmlFor="scan-expiry-date"
                  className="block text-xs font-semibold text-slate-700"
                >
                  Expiry Date *
                </label>
                <input
                  id="scan-expiry-date"
                  type="date"
                  value={expiryDate}
                  onChange={(e) => {
                    setExpiryDate(e.target.value);
                    setFormErrors((p) => ({ ...p, expiryDate: '' }));
                  }}
                  className="mt-1.5 min-h-[48px] w-full rounded-lg border border-slate-300 px-3.5 font-mono text-base text-slate-900 focus:border-blue-600 focus:outline-none focus:ring-1 focus:ring-blue-600"
                />
                {formErrors.expiryDate && (
                  <p className="mt-1 text-xs text-red-600">
                    {formErrors.expiryDate}
                  </p>
                )}
              </div>

              <div>
                <label
                  htmlFor="scan-quantity"
                  className="block text-xs font-semibold text-slate-700"
                >
                  Quantity *
                </label>
                <input
                  id="scan-quantity"
                  type="number"
                  min="1"
                  step="1"
                  inputMode="numeric"
                  value={quantity}
                  onChange={(e) => {
                    setQuantity(e.target.value);
                    setFormErrors((p) => ({ ...p, quantity: '' }));
                  }}
                  className="mt-1.5 min-h-[48px] w-full rounded-lg border border-slate-300 px-3.5 font-mono text-base tabular-nums text-slate-900 focus:border-blue-600 focus:outline-none focus:ring-1 focus:ring-blue-600"
                />
                {formErrors.quantity && (
                  <p className="mt-1 text-xs text-red-600">
                    {formErrors.quantity}
                  </p>
                )}
              </div>
            </div>

            <button
              type="submit"
              disabled={saving}
              className="min-h-[48px] w-full rounded-lg bg-blue-600 px-5 py-3 text-sm font-bold text-white transition-colors hover:bg-blue-700 disabled:opacity-60"
            >
              {saving ? 'Saving Batch...' : 'Save Expiry Batch'}
            </button>
          </form>

          {/* Existing Batches History for this EAN */}
          {existingBatches.length > 0 && (
            <div className="mt-6 border-t border-slate-200 pt-5">
              <h3 className="text-xs font-bold text-slate-700">
                Existing Expiry Batches for EAN {activeEanForBatches} ({existingBatches.length})
              </h3>
              <p className="mt-0.5 text-xs text-slate-500">
                Saving adds a new separate batch without overwriting existing records.
              </p>
              <div className="mt-3 divide-y divide-slate-100 rounded-lg border border-slate-200">
                {existingBatches.map((b) => (
                  <div
                    key={b.id}
                    className="flex items-center justify-between px-3.5 py-2.5 text-xs"
                  >
                    <span className="font-mono font-semibold text-slate-800">
                      {formatDisplayDate(b.expiryDate)}
                    </span>
                    <span className="font-mono font-bold tabular-nums text-slate-900">
                      Qty: {b.quantity}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      {/* Post-Save Confirmation & Scan Next Product */}
      {scanState === 'saved' && lastSavedSummary && (
        <div className="rounded-xl border border-emerald-200 bg-white p-6 text-center">
          <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-emerald-100 text-emerald-600">
            <CheckCircle2 className="h-7 w-7" />
          </div>
          <h2 className="mt-4 text-lg font-bold text-slate-900">
            Expiry Batch Saved
          </h2>
          <p className="mt-1 text-sm text-slate-600">
            {lastSavedSummary.description} ({lastSavedSummary.productCode})
          </p>
          <div className="mt-3 flex flex-wrap justify-center gap-3 text-xs font-medium text-slate-700">
            <span className="font-mono">EAN: {lastSavedSummary.ean}</span>
            <span aria-hidden="true">·</span>
            <span className="font-mono">
              Expiry: {formatDisplayDate(lastSavedSummary.expiryDate)}
            </span>
            <span aria-hidden="true">·</span>
            <span className="font-mono tabular-nums">
              Qty: {lastSavedSummary.quantity}
            </span>
          </div>

          <div className="mt-6 flex flex-col justify-center gap-3 sm:flex-row">
            <button
              type="button"
              onClick={handleScanNextProduct}
              className="inline-flex min-h-[48px] items-center justify-center gap-2 rounded-lg bg-blue-600 px-6 py-3 text-sm font-bold text-white hover:bg-blue-700"
            >
              <ScanBarcode className="h-4 w-4" />
              <span>SCAN NEXT PRODUCT</span>
            </button>
            <button
              type="button"
              onClick={handleAddAnotherBatchForSameProduct}
              className="inline-flex min-h-[48px] items-center justify-center gap-2 rounded-lg border border-slate-300 bg-white px-5 py-3 text-sm font-semibold text-slate-800 hover:bg-slate-50"
            >
              <span>Add Another Expiry Date for Same Product</span>
            </button>
          </div>
        </div>
      )}
    </div>
  );
};
