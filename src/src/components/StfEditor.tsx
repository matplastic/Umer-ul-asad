import React, { useMemo, useState } from 'react';
import { Plus, Trash2, Save, Loader2, AlertTriangle } from 'lucide-react';
import type { Material, ProcAttachment, ProcurementSettings, Rfq, Stf, Supplier } from '../types';
import { MaterialPicker } from './MaterialPicker';
import { AttachmentList } from './AttachmentList';
import { Field, Modal, btn, inputCls, todayStr } from './ProcurementUi';
import { dbSaveStf } from '../lib/firebaseService';
import { CURRENCIES } from '../lib/tradeFinance';
import { PAYMENT_TERM_PRESETS, PROJECT_TYPES, budgetTier, stfTotals } from '../lib/stf';
import { lineTotal, money } from '../lib/procurement';

// STF — the purchase approval form (same fields as the company's STF-PO-PAYMENT sheet):
// what is bought, from whom, for which project, the payment terms, and who must approve it.

interface DraftLine { key: string; materialId: string; qty: string; unitPrice: string; sourceRequestId?: string | null; sourceKind?: 'supervisor' | 'hr' | null; hint?: string }
let seq = 0;
const newKey = () => `l${Date.now().toString(36)}${seq++}`;

export interface StfSeed {
  description?: string;
  supplierName?: string;
  paymentTerms?: string | null;
  rfq?: Rfq | null;                     // the awarded quotation sheet this STF comes from
  attachments?: ProcAttachment[];
  lines: { materialId?: string; itemName?: string; qty: number; unitPrice?: number | null; sourceRequestId?: string | null; sourceKind?: 'supervisor' | 'hr' | null }[];
}

interface Props {
  suppliers: Supplier[];
  materials: Material[];
  stfs: Stf[];
  settings: ProcurementSettings;
  initial?: Stf | null;
  seed?: StfSeed | null;
  currentUserName: string;
  onClose: () => void;
  onSaved: (stf: Stf) => void;
}

const DOC_KINDS = [{ id: 'quotation', label: 'Supplier quotation' }, { id: 'approval', label: 'Approval / e-mail' }, { id: 'other', label: 'Other' }];

export const StfEditor: React.FC<Props> = ({ suppliers, materials, stfs, settings, initial, seed, currentUserName, onClose, onSaved }) => {
  const [date, setDate] = useState((initial?.date || todayStr()).slice(0, 10));
  const [description, setDescription] = useState(initial?.description || seed?.description || '');
  const [supplierName, setSupplierName] = useState(initial?.supplierName || seed?.supplierName || '');
  const [projectType, setProjectType] = useState(initial?.projectType || 'SALES');
  const [projectName, setProjectName] = useState(initial?.projectName || '');
  const [currency, setCurrency] = useState(initial?.currency || 'AED');
  const [fxRate, setFxRate] = useState(String(initial?.fxRate ?? 1));
  const [vatRate, setVatRate] = useState(String(initial?.vatRate ?? 5));
  const [terms, setTerms] = useState(initial?.paymentTerms || seed?.paymentTerms || '');
  const [queue, setQueue] = useState(initial?.queue || settings.approvers[0]?.name || '');
  const [customNo, setCustomNo] = useState('');
  const [notes, setNotes] = useState(initial?.notes || '');
  const [attachments, setAttachments] = useState<ProcAttachment[]>(initial?.attachments || seed?.attachments || []);
  const [lines, setLines] = useState<DraftLine[]>(() => {
    if (initial) return initial.lines.map(l => ({ key: l.id, materialId: l.materialId, qty: String(l.qty), unitPrice: String(l.unitPrice), sourceRequestId: l.sourceRequestId, sourceKind: l.sourceKind }));
    if (seed) return seed.lines.map(l => ({ key: newKey(), materialId: l.materialId || '', qty: String(l.qty), unitPrice: l.unitPrice != null ? String(l.unitPrice) : '', sourceRequestId: l.sourceRequestId, sourceKind: l.sourceKind, hint: l.materialId ? undefined : l.itemName }));
    return [{ key: newKey(), materialId: '', qty: '', unitPrice: '' }];
  });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [ownerKey] = useState(() => initial?.id || `new_${Date.now().toString(36)}`);
  const [removed, setRemoved] = useState<ProcAttachment[]>([]);

  const usable = useMemo(() => suppliers.filter(s => s.status !== 'blocked').sort((a, b) => a.name.localeCompare(b.name)), [suppliers]);
  const projects = useMemo(() => Array.from(new Set(stfs.map(s => s.projectName).filter(Boolean))).sort(), [stfs]);
  const supplier = suppliers.find(s => s.name.trim().toLowerCase() === supplierName.trim().toLowerCase()) || null;

  const chooseSupplier = (name: string) => {
    setSupplierName(name);
    const s = suppliers.find(x => x.name === name);
    if (!s) return;
    if (s.paymentTerms && !terms) setTerms(s.paymentTerms);
    if (s.currency && s.currency !== currency) chooseCurrency(s.currency);
  };
  const chooseCurrency = (c: string) => {
    setCurrency(c);
    const def = CURRENCIES.find(x => x.code === c)?.defaultRate;
    setFxRate(def != null ? String(def) : '');
  };
  const setLine = (key: string, patch: Partial<DraftLine>) => setLines(ls => ls.map(l => (l.key === key ? { ...l, ...patch } : l)));

  const built = lines.map(l => {
    const m = materials.find(x => x.id === l.materialId);
    return { id: l.key, materialId: l.materialId, itemName: m?.name || l.hint || '', erpCode: (m as any)?.erpCode || null, unit: m?.unit || '', qty: Number(l.qty) || 0, unitPrice: Number(l.unitPrice) || 0, sourceRequestId: l.sourceRequestId || null, sourceKind: l.sourceKind || null };
  });
  const shape = { lines: built, vatRate: Number(vatRate) || 0, fxRate: Number(fxRate) || 0 };
  const t = stfTotals(shape);
  const tier = budgetTier(shape, settings);

  const save = async () => {
    setError(null);
    if (!(Number(fxRate) > 0)) { setError('Enter the exchange rate to AED.'); return; }
    if (lines.some(l => l.materialId && l.unitPrice === '')) { setError('Enter a price on every line.'); return; }
    setBusy(true);
    try {
      const stf = await dbSaveStf({
        id: initial?.id, stfNo: initial ? undefined : customNo || undefined, date, description: description.trim(), supplierId: supplier?.id || null, supplierName: supplierName.trim(),
        projectType, projectName: projectName.trim(), currency, fxRate: Number(fxRate), vatRate: Number(vatRate) || 0, paymentTerms: terms.trim() || null,
        lines: built.filter(l => l.materialId) as any, queue, attachments, notes: notes.trim() || null,
        rfqId: seed?.rfq?.id ?? initial?.rfqId ?? null, rfqNo: seed?.rfq?.rfqNo ?? initial?.rfqNo ?? null,
      } as any, currentUserName);
      removed.forEach(a => { import('../lib/procurementFiles').then(m => m.deleteProcFile(a)); });
      onSaved(stf);
    } catch (e: any) {
      setError(e?.message || 'Could not save the STF.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal title={initial ? `Edit ${initial.stfNo}` : 'New STF — purchase approval form'} subtitle={seed?.rfq ? `From quotation sheet ${seed.rfq.rfqNo}` : 'Fill it in, attach the supplier quotation, and send it into the approval queue'}
      onClose={onClose} width="max-w-5xl"
      footer={<>
        <button onClick={onClose} className={btn.soft}>Cancel</button>
        <button onClick={save} disabled={busy} className={btn.primary} data-testid="stf-save">{busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Save className="h-3.5 w-3.5" />} {initial ? 'Save changes' : 'Create STF'}</button>
      </>}>
      <div className="space-y-4">
        <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
          <Field label="STF description *" className="md:col-span-3"><input value={description} onChange={e => setDescription(e.target.value)} placeholder="e.g. HDPE resin for TIGER pools" className={inputCls} data-testid="stf-description" /></Field>
          <Field label="Date"><input type="date" value={date} onChange={e => setDate(e.target.value)} className={inputCls} /></Field>
          <Field label="Company (supplier) *" className="md:col-span-2">
            <select value={supplierName} onChange={e => chooseSupplier(e.target.value)} className={inputCls} data-testid="stf-supplier">
              <option value="">Choose a supplier…</option>
              {usable.map(s => <option key={s.id} value={s.name}>{s.name}{s.status === 'on_hold' ? ' (on hold)' : ''}</option>)}
            </select>
            {usable.length === 0 && <div className="text-[11px] text-amber-700 mt-1">No suppliers yet — add one in the Suppliers tab.</div>}
          </Field>
          <Field label="Project type">
            <input value={projectType} onChange={e => setProjectType(e.target.value.toUpperCase())} list="stf-ptypes" className={inputCls} data-testid="stf-ptype" />
            <datalist id="stf-ptypes">{PROJECT_TYPES.map(p => <option key={p} value={p} />)}</datalist>
          </Field>
          <Field label="Project name">
            <input value={projectName} onChange={e => setProjectName(e.target.value.toUpperCase())} list="stf-projects" placeholder="TIGER, GOLF VIEWS…" className={inputCls} data-testid="stf-project" />
            <datalist id="stf-projects">{projects.map(p => <option key={p} value={p} />)}</datalist>
          </Field>
          <Field label="Currency"><select value={currency} onChange={e => chooseCurrency(e.target.value)} className={inputCls}>{CURRENCIES.map(c => <option key={c.code} value={c.code}>{c.code}</option>)}</select></Field>
          <Field label={`Rate (1 ${currency} = ? AED)`}><input type="number" min={0} step="any" value={fxRate} onChange={e => setFxRate(e.target.value)} disabled={currency === 'AED'} className={`${inputCls} font-mono`} /></Field>
          <Field label="VAT %"><input type="number" min={0} step="any" value={vatRate} onChange={e => setVatRate(e.target.value)} className={`${inputCls} font-mono`} data-testid="stf-vat" /></Field>
          <Field label="Payment terms">
            <input value={terms} onChange={e => setTerms(e.target.value)} list="stf-terms" placeholder="PDC - 30 Days" className={inputCls} data-testid="stf-terms" />
            <datalist id="stf-terms">{PAYMENT_TERM_PRESETS.map(p => <option key={p} value={p} />)}</datalist>
          </Field>
          {!initial && (
            <Field label="Send to (Que)" className="md:col-span-2">
              <select value={queue} onChange={e => setQueue(e.target.value)} className={inputCls} data-testid="stf-queue">{settings.approvers.map(a => <option key={a.name} value={a.name}>{a.name}</option>)}</select>
            </Field>
          )}
          {!initial && <Field label="STF number (leave empty for the next one)" className="md:col-span-2"><input value={customNo} onChange={e => setCustomNo(e.target.value)} placeholder="auto — e.g. STF.P2026110027" className={`${inputCls} font-mono`} /></Field>}
        </div>

        <div className="rounded-xl border border-slate-200 overflow-x-auto">
          <table className="w-full min-w-[720px] text-xs">
            <thead><tr className="bg-slate-100 text-slate-500 uppercase text-[10px]">
              <th className="text-left px-2 py-2 w-8">#</th><th className="text-left px-2 py-2">Item (code · description)</th><th className="text-right px-2 py-2 w-24">Qty</th><th className="text-left px-2 py-2 w-14">Unit</th>
              <th className="text-right px-2 py-2 w-28">Unit price ({currency})</th><th className="text-right px-2 py-2 w-28">Total</th><th className="w-8" />
            </tr></thead>
            <tbody>
              {lines.map((l, i) => {
                const m = materials.find(x => x.id === l.materialId);
                return (
                  <tr key={l.key} className="border-t border-slate-200 align-top">
                    <td className="px-2 py-2 text-slate-400">{i + 1}</td>
                    <td className="px-2 py-2 min-w-[260px]">
                      <MaterialPicker materials={materials} value={l.materialId} onChange={id => setLine(l.key, { materialId: id, hint: undefined })} />
                      {!l.materialId && l.hint && <div className="text-[11px] text-amber-700 mt-1">Requested as “{l.hint}” — pick the matching Store item.</div>}
                    </td>
                    <td className="px-2 py-2"><input type="number" min={0} step="any" value={l.qty} onChange={e => setLine(l.key, { qty: e.target.value })} className={`${inputCls} text-right font-mono`} /></td>
                    <td className="px-2 py-2 pt-3 text-slate-600">{m?.unit || '—'}</td>
                    <td className="px-2 py-2"><input type="number" min={0} step="any" value={l.unitPrice} onChange={e => setLine(l.key, { unitPrice: e.target.value })} className={`${inputCls} text-right font-mono`} /></td>
                    <td className="px-2 py-2 pt-3 text-right font-mono">{money(lineTotal({ qty: Number(l.qty) || 0, unitPrice: Number(l.unitPrice) || 0 }))}</td>
                    <td className="px-1 py-2 pt-2.5">{lines.length > 1 && <button onClick={() => setLines(ls => ls.filter(x => x.key !== l.key))} className="text-slate-400 hover:text-rose-600 cursor-pointer"><Trash2 className="h-3.5 w-3.5" /></button>}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          <div className="px-2 py-2 border-t border-slate-200"><button onClick={() => setLines(ls => [...ls, { key: newKey(), materialId: '', qty: '', unitPrice: '' }])} className={btn.soft}><Plus className="h-3.5 w-3.5" /> Add item</button></div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <div className="md:col-span-2 space-y-3">
            <Field label="Quotation / approval documents">
              <AttachmentList attachments={attachments} onChange={setAttachments} ownerKey={ownerKey} uploadedByName={currentUserName} kinds={DOC_KINDS} testId="stf-docs"
                onRemove={a => { if (!a.shared) setRemoved(r => [...r, a]); }} />
            </Field>
            <Field label="Notes"><input value={notes} onChange={e => setNotes(e.target.value)} className={inputCls} /></Field>
          </div>
          <div className="rounded-xl border border-slate-200 p-3 text-xs space-y-1.5 self-start" data-testid="stf-totals">
            <div className="flex justify-between"><span className="text-slate-500">TOTAL</span><span className="font-mono">{money(t.subtotal)}</span></div>
            <div className="flex justify-between"><span className="text-slate-500">VAT {Number(vatRate) || 0}%</span><span className="font-mono">{money(t.vat)}</span></div>
            <div className="flex justify-between border-t border-slate-200 pt-1.5 text-sm font-black"><span>G. TOTAL ({currency})</span><span className="font-mono">{money(t.total)}</span></div>
            {currency !== 'AED' && <div className="flex justify-between text-slate-500"><span>≈ AED</span><span className="font-mono">{money(t.totalAed)}</span></div>}
            <div className="flex justify-between items-center text-slate-500"><span>≈ EUR</span><span className="font-mono">{money(tier.eur)}</span></div>
            <div className={`mt-1 text-center rounded-lg border px-2 py-1 font-black ${tier.above ? 'bg-amber-50 border-amber-300 text-amber-800' : 'bg-emerald-50 border-emerald-300 text-emerald-800'}`} data-testid="stf-tier">Budget: {tier.label}</div>
            {tier.above && <div className="text-[11px] text-amber-700">Above the tier — final approval must come from {settings.approvers.filter(a => a.finalForAbove).map(a => a.name).join(' or ') || 'management'}.</div>}
          </div>
        </div>
        {error && <div className="rounded-lg border border-rose-300 bg-rose-50 px-3 py-2 text-xs text-rose-700 flex items-start gap-2" data-testid="stf-error"><AlertTriangle className="h-4 w-4 shrink-0" />{error}</div>}
      </div>
    </Modal>
  );
};
