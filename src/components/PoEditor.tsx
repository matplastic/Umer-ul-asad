import React, { useMemo, useState } from 'react';
import { Plus, Trash2, Save, Send, Loader2, AlertTriangle } from 'lucide-react';
import type { Material, PoLine, PurchaseOrder, Rfq, Supplier } from '../types';
import { MaterialPicker } from './MaterialPicker';
import { Field, Modal, btn, inputCls, todayStr } from './ProcurementUi';
import { dbPoAction, dbSavePurchaseOrder } from '../lib/firebaseService';
import { APPROVAL_THRESHOLD, VAT_RATE, lineTotal, money, poTotals } from '../lib/procurement';

// Create or edit a DRAFT purchase order. Every line is tied to a Store item, so what the Store
// later receives against the PO lands in the right inventory item.

const PAYMENT_TERMS = ['Advance', 'Cash on delivery', 'Net 15', 'Net 30', 'Net 45', 'Net 60', 'Net 90', 'PDC'];
const DEFAULT_LOCATION = 'MAT Plastic Industries LLC — Store, Umm Al Quwain';

interface DraftLine {
  key: string;
  materialId: string;
  qty: string;
  unitPrice: string;
  sourceRequestId?: string | null;
  sourceKind?: 'supervisor' | 'hr' | null;
  hint?: string;          // name from the original request when no Store item matched yet
}
let keySeq = 0;
const newKey = () => `l${Date.now().toString(36)}${keySeq++}`;

export interface PoSeed {
  supplierName?: string;
  paymentTerms?: string | null;
  expectedDate?: string | null;
  notes?: string | null;
  rfq?: Rfq | null;
  lines: { materialId?: string; itemName?: string; qty: number; unitPrice?: number | null; sourceRequestId?: string | null; sourceKind?: 'supervisor' | 'hr' | null }[];
}

interface Props {
  suppliers: Supplier[];
  materials: Material[];
  pos: PurchaseOrder[];
  initial?: PurchaseOrder | null;
  seed?: PoSeed | null;
  currentUserName: string;
  onClose: () => void;
  onSaved: (po: PurchaseOrder, submitted: boolean) => void;
}

export const PoEditor: React.FC<Props> = ({ suppliers, materials, pos, initial, seed, currentUserName, onClose, onSaved }) => {
  const [supplierName, setSupplierName] = useState(initial?.supplierName || seed?.supplierName || '');
  const [orderDate, setOrderDate] = useState((initial?.orderDate || todayStr()).slice(0, 10));
  const [expectedDate, setExpectedDate] = useState((initial?.expectedDate || seed?.expectedDate || '').slice(0, 10));
  const [location, setLocation] = useState(initial?.deliveryLocation || DEFAULT_LOCATION);
  const [terms, setTerms] = useState(initial?.paymentTerms || seed?.paymentTerms || '');
  const [vatRate, setVatRate] = useState(String(initial?.vatRate ?? VAT_RATE));
  const [discount, setDiscount] = useState(String(initial?.discount || ''));
  const [notes, setNotes] = useState(initial?.notes || seed?.notes || '');
  const [lines, setLines] = useState<DraftLine[]>(() => {
    if (initial) return initial.lines.map(l => ({ key: l.id, materialId: l.materialId, qty: String(l.qty), unitPrice: String(l.unitPrice), sourceRequestId: l.sourceRequestId, sourceKind: l.sourceKind }));
    if (seed) return seed.lines.map(l => ({
      key: newKey(), materialId: l.materialId || '', qty: String(l.qty), unitPrice: l.unitPrice != null ? String(l.unitPrice) : '',
      sourceRequestId: l.sourceRequestId, sourceKind: l.sourceKind, hint: l.materialId ? undefined : l.itemName,
    }));
    return [{ key: newKey(), materialId: '', qty: '', unitPrice: '' }];
  });
  const [busy, setBusy] = useState<'draft' | 'submit' | null>(null);
  const [error, setError] = useState<string | null>(null);

  const supplier = suppliers.find(s => s.name.trim().toLowerCase() === supplierName.trim().toLowerCase()) || null;
  const pickable = useMemo(() => suppliers.filter(s => s.status !== 'blocked').sort((a, b) => a.name.localeCompare(b.name)), [suppliers]);

  const chooseSupplier = (name: string) => {
    setSupplierName(name);
    const s = suppliers.find(x => x.name === name);
    if (s?.paymentTerms && !terms) setTerms(s.paymentTerms);
  };

  // last price paid to this supplier for a material — a sanity check while typing the price
  const lastPrice = (materialId: string): number | null => {
    if (!materialId || !supplierName) return null;
    const past = pos
      .filter(p => p.supplierName.trim().toLowerCase() === supplierName.trim().toLowerCase() && p.status !== 'cancelled' && p.id !== initial?.id)
      .sort((a, b) => (b.orderDate || '').localeCompare(a.orderDate || ''));
    for (const p of past) { const l = p.lines.find(x => x.materialId === materialId); if (l) return l.unitPrice; }
    return null;
  };

  const built: PoLine[] = lines.map(l => {
    const m = materials.find(x => x.id === l.materialId);
    return {
      id: l.key, materialId: l.materialId, itemName: m?.name || l.hint || '', erpCode: (m as any)?.erpCode || null,
      unit: m?.unit || '', qty: Number(l.qty) || 0, unitPrice: Number(l.unitPrice) || 0,
      sourceRequestId: l.sourceRequestId || null, sourceKind: l.sourceKind || null,
    };
  });
  const totals = poTotals({ lines: built, discount: Number(discount) || 0, vatRate: Number(vatRate) || 0 });
  const needsApproval = totals.total > APPROVAL_THRESHOLD;

  const setLine = (key: string, patch: Partial<DraftLine>) => setLines(ls => ls.map(l => (l.key === key ? { ...l, ...patch } : l)));

  const save = async (submit: boolean) => {
    setError(null);
    if (!supplierName.trim()) { setError('Choose a supplier.'); return; }
    if (supplier?.status === 'on_hold' && !window.confirm(`${supplier.name} is ON HOLD. Raise a PO to them anyway?`)) return;
    if (lines.some(l => l.unitPrice === '' && !!l.materialId)) { setError('Enter a price on every line (use 0 only for free items).'); return; }
    setBusy(submit ? 'submit' : 'draft');
    try {
      let po = await dbSavePurchaseOrder({
        id: initial?.id,
        supplierId: supplier?.id || null, supplierName: supplierName.trim(), supplierCode: supplier?.code || null, supplierTaxNo: supplier?.taxNo || null,
        currency: supplier?.currency || 'AED', orderDate, expectedDate: expectedDate || null, deliveryLocation: location.trim() || null,
        paymentTerms: terms.trim() || null, notes: notes.trim() || null, discount: Number(discount) || 0, vatRate: Number(vatRate) || 0,
        lines: built, rfqId: seed?.rfq?.id ?? initial?.rfqId ?? null, rfqNo: seed?.rfq?.rfqNo ?? initial?.rfqNo ?? null,
      }, currentUserName);
      if (submit) po = await dbPoAction(po.id, 'submit', currentUserName);
      onSaved(po, submit);
    } catch (e: any) {
      setError(e?.message || 'Could not save the PO.');
    } finally {
      setBusy(null);
    }
  };

  return (
    <Modal
      title={initial ? `Edit ${initial.poNo}` : 'New purchase order'}
      subtitle={seed?.rfq ? `From sourcing form ${seed.rfq.rfqNo}` : undefined}
      onClose={onClose} width="max-w-5xl"
      footer={<>
        <button onClick={onClose} className={btn.soft}>Cancel</button>
        <button onClick={() => save(false)} disabled={!!busy} className={btn.soft} data-testid="po-save-draft">
          {busy === 'draft' ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Save className="h-3.5 w-3.5" />} Save draft
        </button>
        <button onClick={() => save(true)} disabled={!!busy} className={btn.primary} data-testid="po-submit">
          {busy === 'submit' ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Send className="h-3.5 w-3.5" />}
          {needsApproval ? 'Submit for approval' : 'Issue PO'}
        </button>
      </>}
    >
      <div className="space-y-4">
        {initial?.rejectedNote && (
          <div className="rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-xs text-amber-800">
            <strong>Sent back by management:</strong> {initial.rejectedNote}
          </div>
        )}
        <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
          <Field label="Supplier *" className="md:col-span-2">
            <select value={supplierName} onChange={e => chooseSupplier(e.target.value)} className={inputCls} data-testid="po-supplier">
              <option value="">Choose a supplier…</option>
              {pickable.map(s => <option key={s.id} value={s.name}>{s.name}{s.status === 'on_hold' ? ' (on hold)' : ''}</option>)}
            </select>
            {pickable.length === 0 && <div className="text-[11px] text-amber-700 mt-1">No suppliers yet — add one in the Suppliers tab first.</div>}
          </Field>
          <Field label="Order date"><input type="date" value={orderDate} onChange={e => setOrderDate(e.target.value)} className={inputCls} /></Field>
          <Field label="Delivery wanted by"><input type="date" value={expectedDate} onChange={e => setExpectedDate(e.target.value)} className={inputCls} data-testid="po-expected" /></Field>
          <Field label="Payment terms">
            <input value={terms} onChange={e => setTerms(e.target.value)} list="po-terms" placeholder="Net 30 …" className={inputCls} />
            <datalist id="po-terms">{PAYMENT_TERMS.map(t => <option key={t} value={t} />)}</datalist>
          </Field>
          <Field label="Deliver to" className="md:col-span-2"><input value={location} onChange={e => setLocation(e.target.value)} className={inputCls} /></Field>
          <Field label="VAT %"><input type="number" min={0} value={vatRate} onChange={e => setVatRate(e.target.value)} className={`${inputCls} font-mono`} /></Field>
        </div>

        {/* lines */}
        <div className="rounded-xl border border-slate-200 overflow-x-auto">
          <table className="w-full min-w-[720px] text-xs">
            <thead>
              <tr className="bg-slate-100 text-slate-500 uppercase text-[10px]">
                <th className="text-left px-2 py-2 w-8">#</th>
                <th className="text-left px-2 py-2">Item (Store inventory)</th>
                <th className="text-right px-2 py-2 w-24">Qty</th>
                <th className="text-left px-2 py-2 w-14">Unit</th>
                <th className="text-right px-2 py-2 w-28">Unit price (AED)</th>
                <th className="text-right px-2 py-2 w-28">Amount</th>
                <th className="w-8" />
              </tr>
            </thead>
            <tbody>
              {lines.map((l, i) => {
                const m = materials.find(x => x.id === l.materialId);
                const last = lastPrice(l.materialId);
                const price = Number(l.unitPrice);
                return (
                  <tr key={l.key} className="border-t border-slate-200 align-top">
                    <td className="px-2 py-2 text-slate-400">{i + 1}</td>
                    <td className="px-2 py-2 min-w-[260px]">
                      <MaterialPicker materials={materials} value={l.materialId} onChange={id => setLine(l.key, { materialId: id, hint: undefined })} />
                      {!l.materialId && l.hint && <div className="text-[11px] text-amber-700 mt-1">Requested as “{l.hint}” — pick the matching Store item.</div>}
                    </td>
                    <td className="px-2 py-2"><input type="number" min={0} step="any" value={l.qty} onChange={e => setLine(l.key, { qty: e.target.value })} className={`${inputCls} text-right font-mono`} /></td>
                    <td className="px-2 py-2 text-slate-600 pt-3">{m?.unit || '—'}</td>
                    <td className="px-2 py-2">
                      <input type="number" min={0} step="any" value={l.unitPrice} onChange={e => setLine(l.key, { unitPrice: e.target.value })} className={`${inputCls} text-right font-mono`} />
                      {last != null && (
                        <div className={`text-[10px] mt-0.5 text-right ${price && last && Math.abs(price - last) / last > 0.1 ? 'text-amber-700 font-bold' : 'text-slate-500'}`}>
                          last PO: {money(last)}
                        </div>
                      )}
                    </td>
                    <td className="px-2 py-2 text-right font-mono pt-3 text-slate-800">{money(lineTotal({ qty: Number(l.qty) || 0, unitPrice: Number(l.unitPrice) || 0 }))}</td>
                    <td className="px-1 py-2 pt-2.5">
                      {lines.length > 1 && <button onClick={() => setLines(ls => ls.filter(x => x.key !== l.key))} className="text-slate-400 hover:text-rose-600 cursor-pointer" title="Remove line"><Trash2 className="h-3.5 w-3.5" /></button>}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          <div className="px-2 py-2 border-t border-slate-200">
            <button onClick={() => setLines(ls => [...ls, { key: newKey(), materialId: '', qty: '', unitPrice: '' }])} className={btn.soft} data-testid="po-add-line"><Plus className="h-3.5 w-3.5" /> Add item</button>
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <Field label="Notes / terms printed on the PO" className="md:col-span-2">
            <textarea rows={4} value={notes} onChange={e => setNotes(e.target.value)} placeholder="Delivery instructions, specifications, warranty, packing requirements…" className={`${inputCls} resize-y`} />
          </Field>
          <div className="rounded-xl border border-slate-200 p-3 text-xs space-y-1.5 self-start">
            <div className="flex justify-between"><span className="text-slate-500">Subtotal</span><span className="font-mono">{money(totals.subtotal)}</span></div>
            <div className="flex justify-between items-center"><span className="text-slate-500">Discount</span>
              <input type="number" min={0} value={discount} onChange={e => setDiscount(e.target.value)} className="w-24 bg-slate-100 border border-slate-300 rounded px-2 py-1 text-right font-mono text-xs" />
            </div>
            <div className="flex justify-between"><span className="text-slate-500">VAT {Number(vatRate) || 0}%</span><span className="font-mono">{money(totals.vat)}</span></div>
            <div className="flex justify-between border-t border-slate-200 pt-1.5 text-sm font-black"><span>Total (AED)</span><span className="font-mono">{money(totals.total)}</span></div>
            <div className={`text-[11px] ${needsApproval ? 'text-amber-700' : 'text-slate-500'}`}>
              {needsApproval ? `Above AED ${APPROVAL_THRESHOLD.toLocaleString()} — needs management approval.` : `Within AED ${APPROVAL_THRESHOLD.toLocaleString()} — issued as soon as you submit.`}
            </div>
          </div>
        </div>

        {error && <div className="rounded-lg border border-rose-300 bg-rose-50 px-3 py-2 text-xs text-rose-700 flex items-start gap-2" data-testid="po-error"><AlertTriangle className="h-4 w-4 shrink-0" />{error}</div>}
      </div>
    </Modal>
  );
};
