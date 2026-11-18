import React, { useEffect, useRef, useState } from 'react';
import { X, Save, Loader2 } from 'lucide-react';
import { Material } from '../types';

// ----------------------------------------------------
// QUICK STOCK ADJUST
// ----------------------------------------------------
// Small pop-up opened from the stock-adjust icon on a row in Store →
// Inventory or Store → Reorder. Type the quantity that is really on the
// shelf and press Enter — the difference is saved to the Stock Ledger.
// (The same adjustment, with more room, lives in the material panel.)

interface Props {
  material: Material;
  /** Returns an error message, or null when the stock was adjusted. */
  onApply: (newQty: number, note: string) => Promise<string | null>;
  onClose: () => void;
}

const fmt = (n: number) => (Math.round(n * 1000) / 1000).toLocaleString(undefined, { maximumFractionDigits: 3 });

export const QuickAdjustModal: React.FC<Props> = ({ material, onApply, onClose }) => {
  const current = Number(material.currentStock || 0);
  const [qty, setQty] = useState(String(current));
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    inputRef.current?.focus();
    inputRef.current?.select();
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const q = Number(qty);
  const valid = qty.trim() !== '' && !Number.isNaN(q) && q >= 0;
  const delta = valid ? q - current : 0;

  const apply = async () => {
    setError(null);
    if (!valid) { setError(q < 0 ? "Stock can't be negative. Enter 0 or more." : 'Enter a valid number.'); return; }
    if (delta === 0) { setError('That is already the current stock.'); return; }
    setBusy(true);
    try {
      const err = await onApply(q, note.trim());
      if (err) setError(err);
      else onClose();
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center p-4 bg-black/50" onClick={onClose} data-testid="quick-adjust-modal">
      <div className="bg-white border border-slate-300 rounded-2xl w-full max-w-sm p-4 space-y-3 shadow-2xl" onClick={e => e.stopPropagation()}>
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="text-[10px] uppercase font-bold text-slate-500">Adjust stock</div>
            <h3 className="text-sm font-extrabold text-slate-900 break-words">{material.name}</h3>
            <div className="text-xs text-slate-500">Currently <span className="font-mono font-bold text-slate-800">{fmt(current)} {material.unit}</span></div>
          </div>
          <button onClick={onClose} className="text-slate-500 hover:text-slate-900 cursor-pointer"><X className="h-4 w-4" /></button>
        </div>

        <div>
          <label className="block text-[10px] font-bold uppercase text-slate-500 mb-1">New quantity ({material.unit})</label>
          <input
            ref={inputRef}
            type="number"
            min={0}
            value={qty}
            onChange={e => setQty(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter') apply(); }}
            data-testid="quick-adjust-qty"
            className="w-full bg-slate-100 border border-slate-300 rounded-lg px-3 py-2 text-sm font-mono text-slate-900 focus:outline-none focus:ring-2 focus:ring-primary-500/40"
          />
          {valid && delta !== 0 && (
            <div className={`text-[11px] font-mono mt-1 ${delta > 0 ? 'text-emerald-700' : 'text-rose-700'}`}>
              {delta > 0 ? '+' : '−'}{fmt(Math.abs(delta))} {material.unit} will be recorded
            </div>
          )}
        </div>

        <input
          value={note}
          onChange={e => setNote(e.target.value)}
          onKeyDown={e => { if (e.key === 'Enter') apply(); }}
          placeholder="Reason (optional) — e.g. stock count"
          data-testid="quick-adjust-note"
          className="w-full bg-slate-100 border border-slate-300 rounded-lg px-3 py-2 text-xs text-slate-900"
        />

        {error && <div className="text-[11px] text-rose-700 font-semibold">{error}</div>}

        <div className="flex justify-end gap-2">
          <button onClick={onClose} className="px-3 py-2 text-xs font-bold rounded-lg bg-slate-100 hover:bg-slate-200 text-slate-700 cursor-pointer">Cancel</button>
          <button onClick={apply} disabled={busy} data-testid="quick-adjust-apply" className="flex items-center gap-1.5 px-4 py-2 text-xs font-bold rounded-lg bg-emerald-600 hover:bg-emerald-700 disabled:opacity-60 text-white cursor-pointer">
            {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Save className="h-3.5 w-3.5" />} Apply
          </button>
        </div>
      </div>
    </div>
  );
};
