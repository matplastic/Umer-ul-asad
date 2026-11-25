import React, { useMemo, useState } from 'react';
import { Plus, Trash2, Save, Award, Loader2, AlertTriangle, ShoppingCart, Crown } from 'lucide-react';
import type { Material, Rfq, RfqLine, RfqQuote, Supplier } from '../types';
import { MaterialPicker } from './MaterialPicker';
import { Field, Modal, btn, inputCls } from './ProcurementUi';
import { dbSaveRfq } from '../lib/firebaseService';
import { AttachmentList } from './AttachmentList';
import { deleteProcFile } from '../lib/procurementFiles';
import { cheapestQuoteId, dateFmt, money, qtyFmt, quoteTotal } from '../lib/procurement';

// Quotation sheet (RFQ): what we need → which suppliers were asked → what each one quoted (with their
// quotation PDF attached) → who wins and why. The STF (purchase approval form) is a separate step.
// The winner's prices feed straight into the PO.

let seq = 0;
const key = (p: string) => `${p}${Date.now().toString(36)}${seq++}`;

export interface RfqSeed {
  title?: string;
  lines: { materialId?: string; itemName?: string; qty: number; sourceRequestId?: string | null; sourceKind?: 'supervisor' | 'hr' | null }[];
}

interface Props {
  suppliers: Supplier[];
  materials: Material[];
  initial?: Rfq | null;
  seed?: RfqSeed | null;
  currentUserName: string;
  onClose: () => void;
  onSaved: (rfq: Rfq) => void;
  onCreatePo: (rfq: Rfq) => void;
}

export const RfqEditor: React.FC<Props> = ({ suppliers, materials, initial, seed, currentUserName, onClose, onSaved, onCreatePo }) => {
  const locked = initial ? initial.status !== 'draft' : false;   // awarded / PO made: read-only
  const [title, setTitle] = useState(initial?.title || seed?.title || '');
  const [neededBy, setNeededBy] = useState((initial?.neededBy || '').slice(0, 10));
  const [notes, setNotes] = useState(initial?.notes || '');
  const [lines, setLines] = useState<(RfqLine & { hint?: string })[]>(() => {
    if (initial) return initial.lines.map(l => ({ ...l }));
    if (seed) return seed.lines.map(l => {
      const m = materials.find(x => x.id === l.materialId);
      return { id: key('sl'), materialId: l.materialId || '', itemName: m?.name || l.itemName || '', erpCode: (m as any)?.erpCode || null, unit: m?.unit || '', qty: l.qty, sourceRequestId: l.sourceRequestId || null, sourceKind: l.sourceKind || null, hint: l.materialId ? undefined : l.itemName };
    });
    return [{ id: key('sl'), materialId: '', itemName: '', unit: '', qty: 1 }];
  });
  const [quotes, setQuotes] = useState<RfqQuote[]>(initial?.quotes.map(q => ({ ...q, unitPrices: { ...q.unitPrices } })) || []);
  const [awardId, setAwardId] = useState<string>(initial?.awardedQuoteId || '');
  const [awardNotes, setAwardNotes] = useState(initial?.awardNotes || '');
  const [busy, setBusy] = useState<'save' | 'award' | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [addSupplier, setAddSupplier] = useState('');
  // storage folder for quotation PDFs (stable while the sheet is open, even before it is saved)
  const [ownerKey] = useState(() => initial?.id || `new_${Date.now().toString(36)}`);
  const [removedFiles, setRemovedFiles] = useState<any[]>([]);

  const rfqLike = { lines, quotes };
  const cheapest = useMemo(() => cheapestQuoteId(rfqLike as any), [lines, quotes]);
  const usable = useMemo(() => suppliers.filter(s => s.status !== 'blocked').sort((a, b) => a.name.localeCompare(b.name)), [suppliers]);
  const asked = new Set(quotes.map(q => q.supplierName.toLowerCase()));

  const setLineMaterial = (id: string, materialId: string) => {
    const m = materials.find(x => x.id === materialId);
    setLines(ls => ls.map(l => l.id === id ? { ...l, materialId, itemName: m?.name || '', unit: m?.unit || '', erpCode: (m as any)?.erpCode || null, hint: undefined } : l));
  };
  const setPrice = (qid: string, lid: string, v: string) =>
    setQuotes(qs => qs.map(q => q.id === qid ? { ...q, unitPrices: { ...q.unitPrices, [lid]: v === '' ? null : Number(v) } } : q));
  const patchQuote = (qid: string, patch: Partial<RfqQuote>) => setQuotes(qs => qs.map(q => q.id === qid ? { ...q, ...patch } : q));

  const addQuote = (name: string) => {
    const s = suppliers.find(x => x.name === name);
    if (!s) return;
    setQuotes(qs => [...qs, { id: key('q'), supplierId: s.id, supplierName: s.name, unitPrices: {}, paymentTerms: s.paymentTerms || null, leadTimeDays: s.leadTimeDays ?? null }]);
    setAddSupplier('');
  };

  const cleanLines = (): RfqLine[] => lines.filter(l => l.materialId).map(({ hint, ...l }) => l);
  const winner = quotes.find(q => q.id === awardId) || null;
  const notCheapest = !!winner && !!cheapest && winner.id !== cheapest;

  const persist = async (award: boolean) => {
    setError(null);
    const ls = cleanLines();
    if (!title.trim()) { setError('Give this quotation sheet a title (e.g. “Resin — December”).'); return; }
    if (ls.length === 0) { setError('Add at least one item.'); return; }
    if (ls.some(l => !(Number(l.qty) > 0))) { setError('Every item needs a quantity.'); return; }
    if (award) {
      if (!winner) { setError('Pick the winning supplier.'); return; }
      if (quoteTotal({ lines: ls }, winner) == null) { setError(`${winner.supplierName} has not quoted every item yet.`); return; }
      if (notCheapest && !awardNotes.trim()) { setError('The winner is not the cheapest — write why (quality, lead time, terms…).'); return; }
    }
    setBusy(award ? 'award' : 'save');
    try {
      const saved = await dbSaveRfq({
        id: initial?.id, title: title.trim(), neededBy: neededBy || null, notes: notes.trim() || null, lines: ls, quotes,
        ...(award ? { status: 'awarded' as const, awardedQuoteId: winner!.id, awardNotes: awardNotes.trim() || null, awardedByName: currentUserName, awardedAt: new Date().toISOString() } : {}),
      }, currentUserName);
      removedFiles.forEach(f => { deleteProcFile(f); });
      onSaved(saved);
      if (award) onCreatePo(saved);
    } catch (e: any) {
      setError(e?.message || 'Could not save the quotation sheet.');
    } finally {
      setBusy(null);
    }
  };

  const totalsRow = quotes.map(q => quoteTotal({ lines: cleanLines() } as any, q));

  return (
    <Modal
      title={initial ? `${initial.rfqNo} — ${initial.title}` : 'New quotation sheet'}
      subtitle={locked ? `${initial!.status === 'po_created' ? 'PO created' : 'Awarded'} — read only` : 'Compare supplier quotations, then award and raise the PO'}
      onClose={onClose} width="max-w-6xl"
      footer={locked ? <>
        <button onClick={onClose} className={btn.soft}>Close</button>
        {initial!.status === 'awarded' && <button onClick={() => onCreatePo(initial!)} className={btn.primary} data-testid="rfq-create-po"><ShoppingCart className="h-3.5 w-3.5" /> Create PO</button>}
      </> : <>
        <button onClick={onClose} className={btn.soft}>Cancel</button>
        <button onClick={() => persist(false)} disabled={!!busy} className={btn.soft} data-testid="rfq-save">{busy === 'save' ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Save className="h-3.5 w-3.5" />} Save draft</button>
        <button onClick={() => persist(true)} disabled={!!busy || !awardId} className={btn.primary} data-testid="rfq-award">{busy === 'award' ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Award className="h-3.5 w-3.5" />} Award &amp; create PO</button>
      </>}
    >
      <div className="space-y-4">
        <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
          <Field label="Title *" className="md:col-span-2"><input value={title} onChange={e => setTitle(e.target.value)} disabled={locked} className={inputCls} data-testid="rfq-title" /></Field>
          <Field label="Needed by"><input type="date" value={neededBy} onChange={e => setNeededBy(e.target.value)} disabled={locked} className={inputCls} /></Field>
          <Field label="Notes"><input value={notes} onChange={e => setNotes(e.target.value)} disabled={locked} className={inputCls} /></Field>
        </div>

        {/* comparison grid: items down, suppliers across */}
        <div className="rounded-xl border border-slate-200 overflow-x-auto">
          <table className="w-full text-xs" style={{ minWidth: 520 + quotes.length * 170 }}>
            <thead>
              <tr className="bg-slate-100 text-slate-500 uppercase text-[10px]">
                <th className="text-left px-2 py-2 min-w-[240px]">Item needed</th>
                <th className="text-right px-2 py-2 w-24">Qty</th>
                {quotes.map(q => (
                  <th key={q.id} className="px-2 py-2 min-w-[160px] text-left normal-case">
                    <div className="flex items-center justify-between gap-1">
                      <span className="font-extrabold text-slate-800 text-xs truncate">{q.supplierName}</span>
                      {!locked && <button onClick={() => { setQuotes(qs => qs.filter(x => x.id !== q.id)); if (awardId === q.id) setAwardId(''); }} className="text-slate-400 hover:text-rose-600 cursor-pointer" title="Remove supplier"><Trash2 className="h-3 w-3" /></button>}
                    </div>
                  </th>
                ))}
                <th className="w-8" />
              </tr>
            </thead>
            <tbody>
              {lines.map(l => (
                <tr key={l.id} className="border-t border-slate-200 align-top">
                  <td className="px-2 py-2">
                    {locked ? <div className="font-semibold">{l.itemName}</div> : <MaterialPicker materials={materials} value={l.materialId} onChange={id => setLineMaterial(l.id, id)} />}
                    {!l.materialId && l.hint && <div className="text-[11px] text-amber-700 mt-1">Requested as “{l.hint}” — pick the matching Store item.</div>}
                  </td>
                  <td className="px-2 py-2"><input type="number" min={0} step="any" value={l.qty} onChange={e => setLines(ls => ls.map(x => x.id === l.id ? { ...x, qty: Number(e.target.value) } : x))} disabled={locked} className={`${inputCls} text-right font-mono`} /><div className="text-[10px] text-slate-500 text-right mt-0.5">{l.unit}</div></td>
                  {quotes.map(q => {
                    const v = q.unitPrices[l.id];
                    const prices = quotes.map(x => x.unitPrices[l.id]).filter((p): p is number => p != null && !Number.isNaN(p));
                    const low = v != null && prices.length > 1 && v === Math.min(...prices);
                    return (
                      <td key={q.id} className="px-2 py-2">
                        <input type="number" min={0} step="any" placeholder="price" value={v ?? ''} onChange={e => setPrice(q.id, l.id, e.target.value)} disabled={locked}
                          className={`${inputCls} text-right font-mono ${low ? '!bg-emerald-50 !border-emerald-400' : ''}`} data-testid={`rfq-price-${q.supplierName}-${l.itemName}`} />
                        {v != null && <div className="text-[10px] text-slate-500 text-right mt-0.5">= {money(v * l.qty)}</div>}
                      </td>
                    );
                  })}
                  <td className="px-1 py-2">{!locked && lines.length > 1 && <button onClick={() => setLines(ls => ls.filter(x => x.id !== l.id))} className="text-slate-400 hover:text-rose-600 cursor-pointer"><Trash2 className="h-3.5 w-3.5" /></button>}</td>
                </tr>
              ))}
              {/* supplier terms */}
              {([['Quotation ref. no.', 'quoteRef', 'text'], ['Quotation date', 'quoteDate', 'date'], ['Lead time (days)', 'leadTimeDays', 'number'], ['Payment terms', 'paymentTerms', 'text'], ['Quote valid until', 'validUntil', 'date']] as const).map(([label, field, type]) => (
                <tr key={field} className="border-t border-slate-200 bg-slate-50/60">
                  <td className="px-2 py-1.5 text-slate-500 font-semibold" colSpan={2}>{label}</td>
                  {quotes.map(q => (
                    <td key={q.id} className="px-2 py-1.5">
                      <input type={type} value={(q as any)[field] ?? ''} onChange={e => patchQuote(q.id, { [field]: type === 'number' ? (e.target.value === '' ? null : Number(e.target.value)) : e.target.value } as any)} disabled={locked} className={inputCls} />
                    </td>
                  ))}
                  <td />
                </tr>
              ))}
              {/* the supplier's quotation as a PDF */}
              <tr className="border-t border-slate-200 bg-slate-50/60 align-top">
                <td className="px-2 py-2 text-slate-500 font-semibold" colSpan={2}>Quotation PDF<div className="text-[10px] font-normal">The supplier’s own document</div></td>
                {quotes.map(q => (
                  <td key={q.id} className="px-2 py-2">
                    <AttachmentList
                      attachments={q.attachments || []} ownerKey={ownerKey} uploadedByName={currentUserName} compact
                      readOnly={locked} testId={`rfq-files-${q.supplierName}`}
                      onChange={next => patchQuote(q.id, { attachments: next })}
                      onRemove={a => setRemovedFiles(r => [...r, a])}
                    />
                  </td>
                ))}
                <td />
              </tr>
              {/* totals + award */}
              <tr className="border-t-2 border-slate-300 bg-slate-100">
                <td className="px-2 py-2 font-extrabold text-slate-800" colSpan={2}>Total (before VAT)</td>
                {quotes.map((q, i) => (
                  <td key={q.id} className="px-2 py-2">
                    <div className={`font-mono font-black text-sm ${q.id === cheapest ? 'text-emerald-700' : 'text-slate-900'}`}>{totalsRow[i] == null ? <span className="text-slate-400 font-sans text-xs font-normal">incomplete</span> : money(totalsRow[i] as number)}</div>
                    {q.id === cheapest && <div className="text-[10px] text-emerald-700 font-bold flex items-center gap-1"><Crown className="h-3 w-3" /> Lowest</div>}
                    <label className="mt-1 flex items-center gap-1.5 text-[11px] text-slate-700 cursor-pointer">
                      <input type="radio" name="award" checked={awardId === q.id} onChange={() => setAwardId(q.id)} disabled={locked} className="accent-emerald-600" data-testid={`rfq-award-${q.supplierName}`} /> Award
                    </label>
                  </td>
                ))}
                <td />
              </tr>
            </tbody>
          </table>
          {!locked && (
            <div className="px-2 py-2 border-t border-slate-200 flex flex-wrap gap-2 items-center">
              <button onClick={() => setLines(ls => [...ls, { id: key('sl'), materialId: '', itemName: '', unit: '', qty: 1 }])} className={btn.soft}><Plus className="h-3.5 w-3.5" /> Add item</button>
              <select value={addSupplier} onChange={e => addQuote(e.target.value)} className="bg-slate-100 border border-slate-300 rounded-lg px-2 py-2 text-xs text-slate-900" data-testid="rfq-add-supplier">
                <option value="">+ Invite a supplier to quote…</option>
                {usable.filter(s => !asked.has(s.name.toLowerCase())).map(s => <option key={s.id} value={s.name}>{s.name}</option>)}
              </select>
              {quotes.length < 3 && <span className="text-[11px] text-slate-500">Good practice: compare at least three quotations.</span>}
            </div>
          )}
        </div>

        {(notCheapest || awardNotes) && (
          <Field label={notCheapest ? 'Why not the cheapest? *' : 'Award notes'}>
            <textarea rows={2} value={awardNotes} onChange={e => setAwardNotes(e.target.value)} disabled={locked} placeholder="Quality, certificates, delivery time, payment terms, past performance…" className={`${inputCls} resize-y`} data-testid="rfq-award-notes" />
          </Field>
        )}
        {initial?.awardedAt && <div className="text-[11px] text-slate-500">Awarded by {initial.awardedByName} · {dateFmt(initial.awardedAt)}{initial.poId ? ' · PO created' : ''}</div>}
        {error && <div className="rounded-lg border border-rose-300 bg-rose-50 px-3 py-2 text-xs text-rose-700 flex items-start gap-2"><AlertTriangle className="h-4 w-4 shrink-0" />{error}</div>}
        {!locked && lines.some(l => l.materialId) && <div className="text-[11px] text-slate-500">Quantities: {lines.filter(l => l.materialId).map(l => `${l.itemName} ${qtyFmt(l.qty)} ${l.unit}`).join(' · ')}</div>}
      </div>
    </Modal>
  );
};
