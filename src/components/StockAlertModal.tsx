import React, { useState } from 'react';
import { X, Bell, BellOff } from 'lucide-react';
import { Material } from '../types';
import { getStockStatus, num } from '../lib/stockAlerts';
import { StockStatusBadge } from './StockStatusBadge';

export interface StockAlertPatch {
  reorderLevel: number;
  urgentLevel: number;
  alertsEnabled: boolean;
}

interface Props {
  material: Material;
  onClose: () => void;
  onSave: (patch: StockAlertPatch) => Promise<void> | void;
}

// Per-material "Reorder Settings": the two quantity levels plus the
// follow (e-mail alerts) switch. Opened from the Inventory table and from
// the Reorder page.
export const StockAlertModal: React.FC<Props> = ({ material, onClose, onSave }) => {
  const [reorder, setReorder] = useState(String(num(material.reorderLevel)));
  const [urgent, setUrgent] = useState(String(num(material.urgentLevel)));
  const [follow, setFollow] = useState(material.alertsEnabled !== false);
  const [saving, setSaving] = useState(false);

  const r = Number(reorder);
  const u = Number(urgent);
  let error: string | null = null;
  if (reorder.trim() === '' || urgent.trim() === '' || Number.isNaN(r) || Number.isNaN(u) || r < 0 || u < 0) {
    error = 'Enter 0 or a positive number in both fields.';
  } else if (r > 0 && u > r) {
    error = 'Urgent level must be equal to or lower than the Reorder level.';
  }

  const preview = error
    ? null
    : getStockStatus({ currentStock: material.currentStock, reorderLevel: r, urgentLevel: u });

  const save = async () => {
    if (error || saving) return;
    setSaving(true);
    try {
      await onSave({ reorderLevel: r, urgentLevel: u, alertsEnabled: follow });
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-black/60" onClick={onClose} data-testid="stock-alert-modal">
      <div className="bg-slate-900 border border-slate-700 rounded-2xl w-full max-w-md p-5 space-y-4" onClick={e => e.stopPropagation()}>
        <div className="flex items-start justify-between gap-3">
          <div>
            <h3 className="text-sm font-extrabold text-white">Reorder Settings — {material.name}</h3>
            <p className="text-[11px] text-slate-400 mt-0.5">
              Current stock: <strong className="text-slate-200">{material.currentStock} {material.unit}</strong>
            </p>
          </div>
          <button onClick={onClose} className="text-slate-500 hover:text-white cursor-pointer"><X className="h-4 w-4" /></button>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <label className="block">
            <span className="block text-[10px] font-bold uppercase text-slate-400 mb-1">Reorder level ({material.unit})</span>
            <input
              type="number"
              min={0}
              value={reorder}
              onChange={e => setReorder(e.target.value)}
              data-testid="alert-reorder-level"
              className="w-full bg-slate-800 border border-slate-700 rounded-lg px-2 py-2 text-xs text-white"
            />
            <span className="block text-[10px] text-slate-500 mt-1">Highlighted red + "Reorder" e-mail at or below this.</span>
          </label>
          <label className="block">
            <span className="block text-[10px] font-bold uppercase text-slate-400 mb-1">Urgent level ({material.unit})</span>
            <input
              type="number"
              min={0}
              value={urgent}
              onChange={e => setUrgent(e.target.value)}
              data-testid="alert-urgent-level"
              className="w-full bg-slate-800 border border-slate-700 rounded-lg px-2 py-2 text-xs text-white"
            />
            <span className="block text-[10px] text-slate-500 mt-1">Stronger red + "Urgent" e-mail at or below this.</span>
          </label>
        </div>
        <p className="text-[10px] text-slate-500 -mt-2">Set a level to 0 to switch it off.</p>

        <button
          type="button"
          role="switch"
          aria-checked={follow}
          onClick={() => setFollow(f => !f)}
          data-testid="alert-follow-toggle"
          className={`w-full flex items-center justify-between gap-3 px-3 py-2.5 rounded-lg border text-left cursor-pointer transition-all ${follow ? 'bg-emerald-950/40 border-emerald-700/60' : 'bg-slate-800 border-slate-700'}`}
        >
          <span className="flex items-center gap-2 text-xs font-bold text-slate-200">
            {follow ? <Bell className="h-4 w-4 text-emerald-400" /> : <BellOff className="h-4 w-4 text-slate-500" />}
            {follow ? 'Following — e-mail me when this runs low' : 'Not following — no e-mails for this material'}
          </span>
          <span className={`h-5 w-9 rounded-full p-0.5 transition-all ${follow ? 'bg-emerald-600' : 'bg-slate-600'}`}>
            <span className={`block h-4 w-4 rounded-full bg-white transition-all ${follow ? 'translate-x-4' : ''}`} />
          </span>
        </button>

        {error ? (
          <p className="text-[11px] text-rose-400 font-semibold">{error}</p>
        ) : (
          <p className="text-[11px] text-slate-400 flex items-center gap-2">
            With these levels this material is currently: {preview && <StockStatusBadge status={preview} />}
          </p>
        )}

        <div className="flex justify-end gap-2">
          <button onClick={onClose} className="px-3 py-2 text-xs font-bold rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 cursor-pointer">Cancel</button>
          <button
            onClick={save}
            disabled={!!error || saving}
            data-testid="alert-save"
            className="px-4 py-2 text-xs font-bold rounded-lg bg-orange-600 hover:bg-orange-700 disabled:opacity-40 disabled:cursor-not-allowed text-white cursor-pointer"
          >
            {saving ? 'Saving…' : 'Save'}
          </button>
        </div>
      </div>
    </div>
  );
};
