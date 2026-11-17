import React, { useEffect, useMemo, useState } from 'react';
import {
  X, Star, Save, Bell, BellOff, BookOpen, Trash2, Wrench, Loader2, Info, Scale, SlidersHorizontal,
} from 'lucide-react';
import { ExtraUnit, Material, SECTION_DEFINITIONS } from '../types';
import { ExtraUnitsEditor } from './ExtraUnitsEditor';
import { StockStatusBadge } from './StockStatusBadge';
import { getStockStatus, num } from '../lib/stockAlerts';
import { equivalentsText, perUnitText } from '../lib/materialUnits';

// ----------------------------------------------------
// MATERIAL DETAIL PANEL
// ----------------------------------------------------
// Opens when a row in Store → Inventory is clicked. Everything you can do
// to ONE material lives here, so the table itself stays clean:
//   Details        – edit name, description, category, brand, supplier, codes, location, section, portal
//   Stock & Alerts – adjust stock, reorder / urgent levels, follow (e-mail alerts)
//   Units          – extra units (length / weight … per 1 unit)
//   header         – Key-material star, Stock Ledger & Supplier history
//   Danger zone    – Move to Company Assets, Delete
//
// All saves go through callbacks owned by StoreModule, which use the
// field-level update (dbUpdateMaterialFields) so editing a description can
// never overwrite a newer stock quantity.

type PanelTab = 'details' | 'stock' | 'units';
type Group = 'mep' | 'civil' | 'other';

interface Props {
  material: Material;
  isCritical: boolean;
  periodIncoming: number;
  periodConsumed: number;
  onClose: () => void;
  onSaveFields: (patch: Partial<Material>) => Promise<void>;
  /** Returns an error message, or null when the stock was adjusted. */
  onAdjustStock: (newQty: number, note: string) => Promise<string | null>;
  onSaveUnits: (units: ExtraUnit[]) => Promise<void>;
  onToggleCritical: () => void;
  onOpenLedger: () => void;
  onMoveToAsset: () => void;
  onDelete: () => void;
}

const inputCls = 'w-full bg-slate-100 border border-slate-300 rounded-lg px-2.5 py-2 text-xs text-slate-900 focus:outline-none focus:ring-2 focus:ring-primary-500/40';
const labelCls = 'block text-[10px] font-bold uppercase text-slate-500 mb-1';

const toDraft = (m: Material) => ({
  name: m.name || '',
  notes: m.notes || '',
  category: m.category || '',
  brand: (m.brand as string) || '',
  supplierName: (m.supplierName as string) || '',
  erpCode: (m.erpCode as string) || '',
  hsCode: (m.hsCode as string) || '',
  location: (m.location as string) || '',
  section: (m.section as string) || '',
  inventoryGroup: ((m.inventoryGroup as Group) || 'other') as Group,
});

export const MaterialDetailPanel: React.FC<Props> = ({
  material, isCritical, periodIncoming, periodConsumed,
  onClose, onSaveFields, onAdjustStock, onSaveUnits, onToggleCritical, onOpenLedger, onMoveToAsset, onDelete,
}) => {
  const [tab, setTab] = useState<PanelTab>('details');
  const [flash, setFlash] = useState<string | null>(null);

  // ----- Details form -----
  const [draft, setDraft] = useState(() => toDraft(material));
  const [savingDetails, setSavingDetails] = useState(false);

  // ----- Stock & alerts -----
  const [newQty, setNewQty] = useState(String(material.currentStock ?? 0));
  const [adjustNote, setAdjustNote] = useState('');
  const [adjusting, setAdjusting] = useState(false);
  const [adjustError, setAdjustError] = useState<string | null>(null);
  const [reorder, setReorder] = useState(String(num(material.reorderLevel)));
  const [urgent, setUrgent] = useState(String(num(material.urgentLevel)));
  const [follow, setFollow] = useState(material.alertsEnabled !== false);
  const [savingAlerts, setSavingAlerts] = useState(false);

  // ----- Units -----
  const [units, setUnits] = useState<ExtraUnit[]>(() => (material.extraUnits || []).map(u => ({ ...u })));
  const [savingUnits, setSavingUnits] = useState(false);

  // Start fresh whenever a different material is opened.
  useEffect(() => {
    setTab('details');
    setDraft(toDraft(material));
    setNewQty(String(material.currentStock ?? 0));
    setAdjustNote('');
    setAdjustError(null);
    setReorder(String(num(material.reorderLevel)));
    setUrgent(String(num(material.urgentLevel)));
    setFollow(material.alertsEnabled !== false);
    setUnits((material.extraUnits || []).map(u => ({ ...u })));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [material.id]);

  // Keep the "new quantity" box in step with the live stock after an adjustment.
  useEffect(() => { setNewQty(String(material.currentStock ?? 0)); }, [material.currentStock]);

  // Esc closes the panel.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const showFlash = (msg: string) => {
    setFlash(msg);
    window.setTimeout(() => setFlash(null), 2200);
  };

  const dirty = useMemo(() => {
    const base = toDraft(material);
    return (Object.keys(base) as (keyof typeof base)[]).some(k => base[k] !== draft[k]);
  }, [material, draft]);

  const status = getStockStatus(material);
  const equiv = equivalentsText(material, material.currentStock);
  const perUnit = perUnitText(material);

  const set = (k: keyof typeof draft) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) =>
    setDraft(p => ({ ...p, [k]: e.target.value }));

  const saveDetails = async () => {
    if (!draft.name.trim()) return;
    setSavingDetails(true);
    try {
      await onSaveFields({
        name: draft.name.trim(),
        notes: draft.notes.trim() || null,
        category: draft.category.trim() || null,
        brand: draft.brand.trim() || null,
        supplierName: draft.supplierName.trim() || null,
        erpCode: draft.erpCode.trim() || null,
        hsCode: draft.hsCode.trim() || null,
        location: draft.location.trim() || null,
        section: draft.section || null,
        inventoryGroup: draft.inventoryGroup,
      });
      showFlash('Details saved');
    } finally {
      setSavingDetails(false);
    }
  };

  const applyAdjust = async () => {
    setAdjustError(null);
    const q = Number(newQty);
    if (newQty.trim() === '' || Number.isNaN(q)) { setAdjustError('Enter a valid number.'); return; }
    if (q < 0) { setAdjustError("Stock can't be negative. Enter 0 or more."); return; }
    if (q === Number(material.currentStock || 0)) { setAdjustError('That is already the current stock.'); return; }
    setAdjusting(true);
    try {
      const err = await onAdjustStock(q, adjustNote.trim());
      if (err) setAdjustError(err);
      else { setAdjustNote(''); showFlash('Stock adjusted'); }
    } finally {
      setAdjusting(false);
    }
  };

  const r = Number(reorder);
  const u = Number(urgent);
  let alertError: string | null = null;
  if (reorder.trim() === '' || urgent.trim() === '' || Number.isNaN(r) || Number.isNaN(u) || r < 0 || u < 0) {
    alertError = 'Enter 0 or a positive number in both fields.';
  } else if (r > 0 && u > r) {
    alertError = 'Urgent level must be equal to or lower than the Reorder level.';
  }
  const alertsDirty = r !== num(material.reorderLevel) || u !== num(material.urgentLevel) || follow !== (material.alertsEnabled !== false);

  const saveAlerts = async () => {
    if (alertError) return;
    setSavingAlerts(true);
    try {
      await onSaveFields({ reorderLevel: r, urgentLevel: u, alertsEnabled: follow });
      showFlash('Alert settings saved');
    } finally {
      setSavingAlerts(false);
    }
  };

  const saveUnits = async () => {
    setSavingUnits(true);
    try {
      await onSaveUnits(units);
      showFlash('Units saved');
    } finally {
      setSavingUnits(false);
    }
  };

  const TABS: { key: PanelTab; label: string; icon: React.ReactNode }[] = [
    { key: 'details', label: 'Details', icon: <Info className="h-3.5 w-3.5" /> },
    { key: 'stock', label: 'Stock & Alerts', icon: <SlidersHorizontal className="h-3.5 w-3.5" /> },
    { key: 'units', label: 'Units', icon: <Scale className="h-3.5 w-3.5" /> },
  ];

  return (
    <div className="fixed inset-0 z-40 flex justify-end bg-slate-900/40 backdrop-blur-[1px]" onClick={onClose} data-testid="material-panel">
      <aside
        className="h-full w-full max-w-xl bg-white border-l border-slate-300 shadow-2xl flex flex-col"
        onClick={e => e.stopPropagation()}
      >
        {/* ---------- Header ---------- */}
        <div className="px-5 pt-4 pb-3 border-b border-slate-200">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <div className="text-[10px] uppercase font-bold text-slate-500 font-mono truncate">{(material.erpCode as string) || 'No ERP code'}</div>
              <h2 className="text-base font-black text-slate-900 break-words" data-testid="panel-title">{material.name}</h2>
              <div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-slate-600">
                <span className="font-mono font-bold text-slate-800">
                  {Number(material.currentStock) > 0 ? `${material.currentStock} ${material.unit}` : 'Not in stock'}
                </span>
                <StockStatusBadge status={status} />
              </div>
            </div>
            <div className="flex items-center gap-1 shrink-0">
              <button
                onClick={onToggleCritical}
                data-testid="panel-key-toggle"
                title={isCritical ? 'Key Material — click to unmark' : 'Mark as Key Material'}
                className={`p-2 rounded-lg border cursor-pointer ${isCritical ? 'bg-amber-50 border-amber-300' : 'bg-white border-slate-200 hover:bg-slate-50'}`}
              >
                <Star className={`h-4 w-4 ${isCritical ? 'text-amber-700 fill-amber-400' : 'text-slate-400'}`} />
              </button>
              <button onClick={onClose} data-testid="panel-close" className="p-2 rounded-lg text-slate-500 hover:text-slate-900 hover:bg-slate-100 cursor-pointer" title="Close (Esc)">
                <X className="h-4 w-4" />
              </button>
            </div>
          </div>

          <button
            onClick={onOpenLedger}
            data-testid="panel-open-ledger"
            className="mt-3 w-full flex items-center justify-center gap-2 px-3 py-2 rounded-lg bg-sky-50 hover:bg-sky-100 border border-sky-200 text-sky-800 text-xs font-bold cursor-pointer"
          >
            <BookOpen className="h-4 w-4" /> Stock Ledger &amp; Supplier History
          </button>

          <div className="mt-3 flex gap-1">
            {TABS.map(t => (
              <button
                key={t.key}
                onClick={() => setTab(t.key)}
                data-testid={`panel-tab-${t.key}`}
                className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-bold cursor-pointer transition-all ${tab === t.key ? 'bg-primary-600 text-white shadow' : 'bg-slate-100 hover:bg-slate-200 text-slate-700'}`}
              >
                {t.icon} {t.label}
              </button>
            ))}
          </div>
        </div>

        {/* ---------- Body ---------- */}
        <div className="flex-1 overflow-y-auto px-5 py-4 space-y-4">
          {flash && (
            <div className="rounded-lg bg-emerald-50 border border-emerald-200 text-emerald-800 text-xs font-bold px-3 py-2" data-testid="panel-flash">{flash}</div>
          )}

          {/* DETAILS */}
          {tab === 'details' && (
            <>
              <div>
                <label className={labelCls}>Material name</label>
                <input value={draft.name} onChange={set('name')} data-testid="panel-name" className={inputCls} />
                {!draft.name.trim() && <div className="text-[11px] text-rose-700 mt-1">Name can't be empty.</div>}
              </div>
              <div>
                <label className={labelCls}>Description</label>
                <textarea
                  value={draft.notes}
                  onChange={set('notes')}
                  rows={4}
                  placeholder="Size, grade, specification, where it is used…"
                  data-testid="panel-description"
                  className={`${inputCls} resize-y`}
                />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div><label className={labelCls}>ERP code</label><input value={draft.erpCode} onChange={set('erpCode')} data-testid="panel-erp" className={`${inputCls} font-mono`} /></div>
                <div><label className={labelCls}>HS code</label><input value={draft.hsCode} onChange={set('hsCode')} className={inputCls} /></div>
                <div><label className={labelCls}>Category</label><input value={draft.category} onChange={set('category')} className={inputCls} /></div>
                <div><label className={labelCls}>Brand</label><input value={draft.brand} onChange={set('brand')} className={inputCls} /></div>
                <div className="col-span-2"><label className={labelCls}>Supplier</label><input value={draft.supplierName} onChange={set('supplierName')} list="supplier-options" className={inputCls} /></div>
                <div className="col-span-2"><label className={labelCls}>Location (Rack / Bin)</label><input value={draft.location} onChange={set('location')} className={inputCls} /></div>
                <div>
                  <label className={labelCls}>Section</label>
                  <select value={draft.section} onChange={set('section')} className={inputCls}>
                    <option value="">Unassigned</option>
                    {SECTION_DEFINITIONS.map(s => <option key={s.id as string} value={s.id as string}>{s.name}</option>)}
                  </select>
                </div>
                <div>
                  <label className={labelCls}>Portal</label>
                  <select value={draft.inventoryGroup} onChange={set('inventoryGroup')} data-testid="panel-group" className={inputCls}>
                    <option value="mep">MEP Material</option>
                    <option value="civil">Civil Material</option>
                    <option value="other">Other Material</option>
                  </select>
                </div>
              </div>
              <div className="text-[11px] text-slate-500">
                Unit: <strong className="text-slate-700">{material.unit}</strong> — change stock from the <em>Stock &amp; Alerts</em> tab, not here.
              </div>

              {/* Danger zone */}
              <div className="rounded-xl border border-rose-200 bg-rose-50/50 p-3 mt-2">
                <div className="text-[10px] font-black uppercase text-rose-700 mb-2">Danger zone</div>
                <div className="flex flex-wrap gap-2">
                  <button onClick={onMoveToAsset} data-testid="panel-move-asset" className="flex items-center gap-1.5 px-3 py-2 rounded-lg bg-white hover:bg-violet-50 border border-violet-200 text-violet-700 text-xs font-bold cursor-pointer">
                    <Wrench className="h-3.5 w-3.5" /> Move to Company Assets
                  </button>
                  <button onClick={onDelete} data-testid="panel-delete" className="flex items-center gap-1.5 px-3 py-2 rounded-lg bg-white hover:bg-rose-50 border border-rose-200 text-rose-700 text-xs font-bold cursor-pointer">
                    <Trash2 className="h-3.5 w-3.5" /> Delete material
                  </button>
                </div>
              </div>
            </>
          )}

          {/* STOCK & ALERTS */}
          {tab === 'stock' && (
            <>
              <div className="grid grid-cols-3 gap-2">
                <div className="rounded-xl border border-slate-200 p-3">
                  <div className="text-[10px] uppercase font-bold text-slate-500">Current stock</div>
                  <div className="text-lg font-black text-slate-900 font-mono">{material.currentStock} <span className="text-xs font-bold text-slate-500">{material.unit}</span></div>
                  {equiv && <div className="text-[10px] font-mono text-emerald-700/80">= {equiv}</div>}
                  {perUnit && <div className="text-[10px] text-slate-500">1 {material.unit} = {perUnit.replace(` per ${material.unit}`, '')}</div>}
                </div>
                <div className="rounded-xl border border-slate-200 p-3">
                  <div className="text-[10px] uppercase font-bold text-slate-500">Incoming (period)</div>
                  <div className="text-lg font-black text-emerald-700 font-mono">+{periodIncoming.toFixed(2)}</div>
                </div>
                <div className="rounded-xl border border-slate-200 p-3">
                  <div className="text-[10px] uppercase font-bold text-slate-500">Consumed (period)</div>
                  <div className="text-lg font-black text-rose-700 font-mono">−{periodConsumed.toFixed(2)}</div>
                </div>
              </div>

              <div className="rounded-xl border border-slate-200 p-4 space-y-3">
                <div className="text-xs font-extrabold text-slate-900">Adjust stock</div>
                <p className="text-[11px] text-slate-500">Type what is actually on the shelf. The difference is recorded in the Stock Ledger.</p>
                <div className="grid grid-cols-3 gap-3">
                  <div>
                    <label className={labelCls}>New quantity ({material.unit})</label>
                    <input type="number" min={0} value={newQty} onChange={e => setNewQty(e.target.value)} data-testid="panel-adjust-qty" className={`${inputCls} font-mono`} />
                  </div>
                  <div className="col-span-2">
                    <label className={labelCls}>Reason (optional)</label>
                    <input value={adjustNote} onChange={e => setAdjustNote(e.target.value)} placeholder="e.g. stock count correction" data-testid="panel-adjust-note" className={inputCls} />
                  </div>
                </div>
                {adjustError && <div className="text-[11px] text-rose-700 font-semibold">{adjustError}</div>}
                <button onClick={applyAdjust} disabled={adjusting} data-testid="panel-adjust-apply" className="flex items-center gap-1.5 px-4 py-2 rounded-lg bg-emerald-600 hover:bg-emerald-700 disabled:opacity-60 text-white text-xs font-bold cursor-pointer">
                  {adjusting ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Save className="h-3.5 w-3.5" />} Apply adjustment
                </button>
              </div>

              <div className="rounded-xl border border-slate-200 p-4 space-y-3">
                <div className="text-xs font-extrabold text-slate-900">Reorder &amp; urgent alerts</div>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className={labelCls}>Reorder level</label>
                    <input type="number" min={0} value={reorder} onChange={e => setReorder(e.target.value)} data-testid="panel-reorder" className={`${inputCls} font-mono`} />
                  </div>
                  <div>
                    <label className={labelCls}>Urgent level</label>
                    <input type="number" min={0} value={urgent} onChange={e => setUrgent(e.target.value)} data-testid="panel-urgent" className={`${inputCls} font-mono`} />
                  </div>
                </div>
                <label className="flex items-center gap-2 text-xs text-slate-700 cursor-pointer">
                  <input type="checkbox" checked={follow} onChange={e => setFollow(e.target.checked)} className="accent-emerald-500" data-testid="panel-follow" />
                  {follow ? <Bell className="h-3.5 w-3.5 text-emerald-700" /> : <BellOff className="h-3.5 w-3.5 text-slate-400" />}
                  Follow stock — e-mail me when it reaches these levels
                </label>
                <div className="text-[11px] text-slate-500">A level of 0 switches that level off. Urgent must be equal to or lower than Reorder.</div>
                {alertError && <div className="text-[11px] text-rose-700 font-semibold">{alertError}</div>}
                <button onClick={saveAlerts} disabled={!!alertError || !alertsDirty || savingAlerts} data-testid="panel-alerts-save" className="flex items-center gap-1.5 px-4 py-2 rounded-lg bg-primary-600 hover:bg-primary-700 disabled:opacity-50 text-white text-xs font-bold cursor-pointer">
                  {savingAlerts ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Save className="h-3.5 w-3.5" />} Save alert settings
                </button>
              </div>
            </>
          )}

          {/* UNITS */}
          {tab === 'units' && (
            <>
              <p className="text-[11px] text-slate-500">
                Stock is counted in <strong className="text-slate-800">{material.unit}</strong> ({material.currentStock} in stock). Tell the Store what one {material.unit} contains and it will show the totals in meters, kilograms, etc.
              </p>
              <ExtraUnitsEditor
                unit={material.unit}
                value={units}
                onChange={setUnits}
                previewQty={Number(material.currentStock) || 0}
                testIdPrefix="panel-extra"
              />
              <button onClick={saveUnits} disabled={savingUnits} data-testid="panel-units-save" className="flex items-center gap-1.5 px-4 py-2 rounded-lg bg-primary-600 hover:bg-primary-700 disabled:opacity-60 text-white text-xs font-bold cursor-pointer">
                {savingUnits ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Save className="h-3.5 w-3.5" />} Save units
              </button>
            </>
          )}
        </div>

        {/* ---------- Sticky footer (Details tab only) ---------- */}
        {tab === 'details' && (
          <div className="px-5 py-3 border-t border-slate-200 bg-white flex items-center justify-between gap-2">
            <div className="text-[11px] text-slate-500">{dirty ? 'You have unsaved changes.' : 'All changes saved.'}</div>
            <div className="flex gap-2">
              <button onClick={() => setDraft(toDraft(material))} disabled={!dirty} className="px-3 py-2 text-xs font-bold rounded-lg bg-slate-100 hover:bg-slate-200 disabled:opacity-50 text-slate-700 cursor-pointer">Reset</button>
              <button onClick={saveDetails} disabled={!dirty || !draft.name.trim() || savingDetails} data-testid="panel-save" className="flex items-center gap-1.5 px-4 py-2 text-xs font-bold rounded-lg bg-primary-600 hover:bg-primary-700 disabled:opacity-50 text-white cursor-pointer">
                {savingDetails ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Save className="h-3.5 w-3.5" />} Save changes
              </button>
            </div>
          </div>
        )}
      </aside>
    </div>
  );
};
