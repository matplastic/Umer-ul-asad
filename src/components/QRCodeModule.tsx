import React, { useState, useEffect, useRef } from 'react';
import { QRCodeSVG } from 'qrcode.react';
import { Html5Qrcode } from 'html5-qrcode';
import { QrCode, X, Camera, CheckCircle2, AlertCircle, Printer, Download } from 'lucide-react';
import { Pool, StageId } from '../types';
import { STAGES } from '../data/mockData';

// ─────────────────────────────────────────────────────────────────────────────
// QR Code Display — small chip that opens a full-screen QR modal
// ─────────────────────────────────────────────────────────────────────────────
interface QRChipProps {
  pool: Pool;
  size?: number;
}

export const QRChip: React.FC<QRChipProps> = ({ pool, size = 24 }) => {
  const [open, setOpen] = useState(false);
  const payload = JSON.stringify({ t: 'pool', id: pool.id, no: pool.poolNo, p: pool.projectName });

  return (
    <>
      <button
        type="button"
        onClick={(e) => { e.stopPropagation(); setOpen(true); }}
        className="inline-flex items-center gap-1 text-[10px] font-bold text-indigo-600 hover:text-indigo-800 hover:bg-indigo-50 rounded px-1.5 py-0.5 transition-all cursor-pointer"
        title="Show QR code"
        data-testid={`qr-chip-${pool.id}`}
      >
        <QrCode className="h-3 w-3" />
        <span>QR</span>
      </button>

      {open && (
        <div
          className="fixed inset-0 bg-slate-900/70 backdrop-blur-sm z-50 flex items-center justify-center p-4 animate-fadeIn"
          onClick={() => setOpen(false)}
        >
          <div
            className="bg-white rounded-3xl shadow-2xl p-6 max-w-sm w-full"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between border-b border-slate-100 pb-3 mb-4">
              <div>
                <h3 className="font-extrabold text-slate-800 text-sm">Pool {pool.poolNo}</h3>
                <p className="text-[11px] text-slate-500 font-mono">{pool.projectName}</p>
              </div>
              <button
                onClick={() => setOpen(false)}
                className="text-slate-400 hover:text-slate-700 hover:bg-slate-100 rounded-lg p-1.5 cursor-pointer"
                data-testid="qr-close-btn"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            <div className="flex justify-center bg-slate-50 rounded-2xl p-6 mb-4">
              <QRCodeSVG
                value={payload}
                size={size * 9}
                level="H"
                includeMargin
                fgColor="#1e293b"
              />
            </div>

            <div className="space-y-1 text-[11px] text-slate-600 font-mono mb-4">
              <div><span className="font-bold">ID:</span> {pool.id}</div>
              <div><span className="font-bold">Stage:</span> {STAGES[pool.currentStageIndex]?.name || 'Done'}</div>
              <div><span className="font-bold">Status:</span> {pool.isDelivered ? 'Delivered' : 'In Production'}</div>
            </div>

            <div className="flex gap-2">
              <button
                onClick={() => {
                  const svg = document.querySelector('.qr-print-target svg, [data-testid="qr-print-target"] svg');
                  const win = window.open('', '_blank');
                  if (win) {
                    win.document.write(`<html><head><title>QR - Pool ${pool.poolNo}</title></head><body style="text-align:center;font-family:system-ui;padding:40px"><h1>${pool.poolNo}</h1><h3>${pool.projectName}</h3><div>${document.querySelector('.mq-qr-svg')?.outerHTML || ''}</div></body></html>`);
                    win.document.close();
                    win.print();
                  }
                }}
                className="flex-1 bg-slate-100 hover:bg-slate-200 text-slate-700 font-bold py-2 rounded-xl text-xs flex items-center justify-center gap-1.5 cursor-pointer transition-all"
                data-testid="qr-print-btn"
              >
                <Printer className="h-3.5 w-3.5" />
                Print Label
              </button>
              <button
                onClick={() => {
                  const svg = document.querySelector(`#qr-svg-${pool.id}`);
                  if (!svg) return;
                  const xml = new XMLSerializer().serializeToString(svg);
                  const blob = new Blob([xml], { type: 'image/svg+xml' });
                  const url = URL.createObjectURL(blob);
                  const a = document.createElement('a');
                  a.href = url;
                  a.download = `QR_Pool_${pool.poolNo}.svg`;
                  a.click();
                  URL.revokeObjectURL(url);
                }}
                className="flex-1 bg-indigo-600 hover:bg-indigo-700 text-white font-bold py-2 rounded-xl text-xs flex items-center justify-center gap-1.5 cursor-pointer transition-all"
                data-testid="qr-download-btn"
              >
                <Download className="h-3.5 w-3.5" />
                Download SVG
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Hidden SVG with stable id for download */}
      <div style={{ display: 'none' }}>
        <QRCodeSVG id={`qr-svg-${pool.id}`} value={payload} size={300} level="H" includeMargin />
      </div>
    </>
  );
};


// ─────────────────────────────────────────────────────────────────────────────
// QR Scanner — full-screen camera scanner with callback on detection
// ─────────────────────────────────────────────────────────────────────────────
interface QRScannerProps {
  pools: Pool[];
  onPoolDetected: (pool: Pool) => void;
  onClose: () => void;
}

export const QRScanner: React.FC<QRScannerProps> = ({ pools, onPoolDetected, onClose }) => {
  const containerId = 'mq-qr-reader';
  const scannerRef = useRef<Html5Qrcode | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [scanned, setScanned] = useState<Pool | null>(null);

  useEffect(() => {
    let cancelled = false;
    const startScanner = async () => {
      try {
        const html5 = new Html5Qrcode(containerId);
        scannerRef.current = html5;
        await html5.start(
          { facingMode: 'environment' },
          { fps: 10, qrbox: { width: 250, height: 250 } },
          (decodedText) => {
            if (cancelled) return;
            try {
              const data = JSON.parse(decodedText);
              if (data.t === 'pool' && data.id) {
                const match = pools.find((p) => p.id === data.id);
                if (match) {
                  setScanned(match);
                  html5.stop().catch(() => {});
                }
              }
            } catch {
              // Not a pool QR — ignore
            }
          },
          () => { /* silent fail per frame */ }
        );
      } catch (err: any) {
        setError(err?.message || String(err));
      }
    };
    startScanner();

    return () => {
      cancelled = true;
      if (scannerRef.current) {
        scannerRef.current.stop().catch(() => {});
        scannerRef.current.clear();
      }
    };
  }, [pools]);

  return (
    <div className="fixed inset-0 bg-slate-950/90 z-50 flex flex-col p-4">
      <div className="flex items-center justify-between text-white mb-4">
        <div className="flex items-center gap-2">
          <Camera className="h-5 w-5" />
          <h2 className="font-extrabold text-lg">QR Code Scanner</h2>
        </div>
        <button
          onClick={onClose}
          className="bg-white/10 hover:bg-white/20 rounded-full p-2 cursor-pointer"
          data-testid="scanner-close-btn"
        >
          <X className="h-5 w-5" />
        </button>
      </div>

      <div className="flex-1 flex items-center justify-center">
        <div className="bg-white rounded-3xl overflow-hidden shadow-2xl max-w-md w-full">
          <div id={containerId} style={{ width: '100%' }} />
          {error && (
            <div className="p-6 text-center">
              <AlertCircle className="h-10 w-10 text-rose-500 mx-auto mb-2" />
              <p className="text-sm font-bold text-rose-700">Camera unavailable</p>
              <p className="text-xs text-slate-500 mt-1">{error}</p>
            </div>
          )}
          {scanned && (
            <div className="p-6 border-t border-slate-100">
              <div className="flex items-center gap-2 mb-3">
                <CheckCircle2 className="h-5 w-5 text-emerald-600" />
                <span className="font-extrabold text-slate-800 text-sm">Pool Detected</span>
              </div>
              <div className="bg-slate-50 rounded-xl p-3 mb-4 text-xs space-y-1">
                <div><span className="font-bold">Pool No:</span> {scanned.poolNo}</div>
                <div><span className="font-bold">Project:</span> {scanned.projectName}</div>
                <div><span className="font-bold">Current Stage:</span> {STAGES[scanned.currentStageIndex]?.name || 'Done'}</div>
              </div>
              <button
                onClick={() => onPoolDetected(scanned)}
                className="w-full bg-indigo-600 hover:bg-indigo-700 text-white font-extrabold py-2.5 rounded-xl text-xs cursor-pointer"
                data-testid="scanner-open-pool-btn"
              >
                Open Pool Details →
              </button>
            </div>
          )}
        </div>
      </div>

      <p className="text-center text-white/60 text-xs mt-4 font-mono">
        Point your camera at the QR sticker on the pool. Auto-detects on focus.
      </p>
    </div>
  );
};
