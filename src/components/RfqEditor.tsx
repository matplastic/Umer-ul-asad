import React, { useMemo, useState } from 'react';
import { Plus, Trash2, Save, Award, Loader2, AlertTriangle, Crown, Send, Copy, Check, FileText } from 'lucide-react';
import type { Material, ProcAttachment, Rfq, RfqLine, RfqQuote, Stf, Supplier } from '../types';
import { MaterialPicker } from './MaterialPicker';
import { Field, Modal, btn, inputCls } from './ProcurementUi';
import { dbAwardRfq, dbSaveRfq } from '../lib/firebaseService';
import { AttachmentList } from './AttachmentList';
import { deleteProcFile } from '../lib/procurementFiles';
import {
  cheapestQuoteId, dateFmt, dispatchSummary, money, qtyFmt, quoteCurrency, quoteFx, quoteLanded, quoteLandedAed, quoteState, quoteTotal,
  unitPriceAed, type QuoteDispatchState,
} from '../lib/procurement';
import { PROJECT_TYPES } from '../lib/stf';

// RFQ — the whole buying workflow on one sheet:
//   1  header      RFQ number (generated, or typed), target delivery date, department / project, remarks
//   2  items       what we need (material, specs, qty, unit) — all under the one RFQ number
//   3  dispatch    ask several suppliers (master list OR typed on the fly); the sheet counts how many were asked
//   4  quotations  per supplier: unit rates, currency, lead time, payment terms, delivery cost + their PDF / photo
//   5  compare     side by side; lowest unit price per item and lowest landed cost are highlighted
//   6  award       one click raises the STF (carrying rfqNo + winningQuoteId); the PO is then issued from the approved STF

let seq = 0;
const key = (p: string) => `${p}${Date.now().toString(36)}${seq++}`;
const CURRENCIES = ['AED', 'USD', 'EUR', 'GBP', 'CNY', 'INR', 'TRY', 'SAR'];

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
  onAwarded: (rfq: Rfq, stf: Stf) => void;
}

const STATE_META: Record<QuoteDispatchState, { label: string; cls: string }> = {
  requested: { label: 'Requested', cls: 'bg-sky-50 text-sky-800 border-sky-300' },
  partial: { label: 'Part quoted', cls: 'bg-amber-50 text-amber-800 border-amber-300' },
  quoted: { label: 'Quoted', cls: 'bg-emerald-50 text-emerald-800 border-emerald-300' },
  declined: { label: 'Declined', cls: 'bg-rose-50 text-rose-700 border-rose-300' },
};

export const RfqEditor: React.FC<Props> = ({ suppliers, materials, initial, seed, currentUserName, onClose, onSaved, onAwarded }) => {
  const locked = initial ? initial.status !== 'draft' : false;   // awarded / STF raised: read-only
  const [rfqNo, setRfqNo] = useState('');
  const [title, setTitle] = useState(initial?.title || seed?.title || '');
  const [projectName, setProjectName] = useState(initial?.projectName || '');
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
  const [customSupplier, setCustomSupplier] = useState('');
  const [copied, setCopied] = useState(false);
  const [confirmAward, setConfirmAward] = useState<{ stfNo: string; projectType: string; projectName: string } | null>(null);
  // storage folder for quotation PDFs (stable while the sheet is open, even before it is saved)
  const [ownerKey] = useState(() => initial?.id || `new_${Date.now().toString(36)}`);
  const [removedFiles, setRemovedFiles] = useState<ProcAttachment[]>([]);

  const cleanLines = (): RfqLine[] => lines.filter(l => l.materialId).map(({ hint, ...l }) => l);
  const rfqLike = { lines: cleanLines(), quotes };
  const cheapest = useMemo(() => cheapestQuoteId(rfqLike as any), [lines, quotes]);
  const summary = useMemo(() => dispatchSummary(rfqLike as any), [lines, quotes]);
  const usable = useMemo(() => suppliers.filter(s => s.status !== 'blocked').sort((a, b) => a.name.localeCompare(b.name)), [suppliers]);
  const asked = new Set(quotes.map(q => q.supplierName.trim().toLowerCase()));
  const lowestAed = cheapest ? quoteLandedAed(rfqLike as any, quotes.find(q => q.id === cheapest)!) : null;

  const setLineMaterial = (id: string, materialId: string) => {
    const m = materials.find(x => x.id === materialId);
    setLines(ls => ls.map(l => l.id === id ? { ...l, materialId, itemName: m?.name || '', unit: m?.unit || '', erpCode: (m as any)?.erpCode || null, hint: undefined } : l));
  };
  const setPrice = (qid: string, lid: string, v: string) =>
    setQuotes(qs => qs.map(q => q.id === qid ? { ...q, unitPrices: { ...q.unitPrices, [lid]: v === '' ? null : Number(v) } } : q));
  const patchQuote = (qid: string, patch: Partial<RfqQuote>) => setQuotes(qs => qs.map(q => q.id === qid ? { ...q, ...patch } : q));

  // ── dispatch: one request per supplier, all under this RFQ number ──
  const dispatchTo = (name: string) => {
    const nm = name.trim();
    if (!nm) return;
    if (asked.has(nm.toLowerCase())) { setError(`${nm} is already on this RFQ.`); return; }
    const s = suppliers.find(x => x.name.trim().toLowerCase() === nm.toLowerCase());
    if (s && s.status === 'blocked') { setError(`${s.name} is blocked.`); return; }
    setError(null);
    setQuotes(qs => [...qs, {
      id: key('q'), supplierId: s?.id ?? null, supplierName: s?.name ?? nm, unitPrices: {},
      paymentTerms: s?.paymentTerms || null, leadTimeDays: s?.leadTimeDays ?? null,
      currency: s?.currency || 'AED', fxRate: null, deliveryCost: null,
      requestedAt: new Date().toISOString(), requestedByName: currentUserName, custom: !s,
    }]);
    setAddSupplier(''); setCustomSupplier('');
  };

  const requestText = () => [
    `REQUEST FOR QUOTATION${initial?.rfqNo || rfqNo.trim() ? ` — ${initial?.rfqNo || rfqNo.trim()}` : ''}`,
    title.trim() ? title.trim() : '',
    projectName.trim() ? `Project / department: ${projectName.trim()}` : '',
    neededBy ? `Required delivery: ${dateFmt(neededBy)}` : '',
    '',
    ...cleanLines().map((l, i) => `${i + 1}. ${l.itemName} — ${qtyFmt(l.qty)} ${l.unit}`),
    '',
    'Please quote unit price, currency, delivery cost, lead time and payment terms, and send your quotation (PDF) with our RFQ number as reference.',
    'MAT Plastic Industries LLC',
  ].filter((x, i, a) => !(x === '' && a[i - 1] === '')).join('\n');
  const copyRequest = async () => {
    try { await navigator.clipboard.writeText(requestText()); setCopied(true); setTimeout(() => setCopied(false), 2000); }
    catch { setError('Could not copy — select the items and copy by hand.'); }
  };

  const winner = quotes.find(q => q.id === awardId) || null;
  const notCheapest = !!winner && !!cheapest && winner.id !== cheapest
    && (quoteLandedAed(rfqLike as any, winner) ?? 0) > (lowestAed ?? 0) + 0.005;

  const validate = (award: boolean): string | null => {
    const ls = cleanLines();
    if (!title.trim()) return 'Give this RFQ a title (e.g. “Resin — December”).';
    if (ls.length === 0) return 'Add at least one item.';
    if (ls.some(l => !(Number(l.qty) > 0))) return 'Every item needs a quantity.';
    const bad = quotes.find(q => quoteCurrency(q) !== 'AED' && !(Number(q.fxRate) > 0));
    if (bad) return `Enter the AED exchange rate for ${bad.supplierName}’s ${quoteCurrency(bad)} quotation.`;
    if (award) {
      if (!winner) return 'Pick the winning supplier.';
      if (winner.declined) return `${winner.supplierName} declined to quote.`;
      if (quoteTotal({ lines: ls }, winner) == null) return `${winner.supplierName} has not quoted every item yet.`;
      if (notCheapest && !awardNotes.trim()) return 'The winner is not the lowest landed cost — write why (quality, lead time, terms…).';
    }
    return null;
  };

  const saveSheet = async () => {
    const ls = cleanLines();
    return dbSaveRfq({
      id: initial?.id, rfqNo: initial ? undefined : rfqNo.trim() || undefined,
      title: title.trim(), projectName: projectName.trim() || null, neededBy: neededBy || null, notes: notes.trim() || null, lines: ls, quotes,
    }, currentUserName);
  };

  const persist = async () => {
    setError(null);
    const bad = validate(false);
    if (bad) { setError(bad); return; }
    setBusy('save');
    try {
      const saved = await saveSheet();
      removedFiles.forEach(f => { deleteProcFile(f); });
      onSaved(saved);
    } catch (e: any) {
      setError(e?.message || 'Could not save the RFQ.');
    } finally { setBusy(null); }
  };

  const openAward = () => {
    setError(null);
    const bad = validate(true);
    if (bad) { setError(bad); return; }
    setConfirmAward({ stfNo: '', projectType: 'SALES', projectName: projectName.trim() });
  };

  const award = async () => {
    if (!confirmAward || !winner) return;
    setError(null);
    setBusy('award');
    try {
      const saved = await saveSheet();                         // header, dispatch list and every quotation are stored first
      removedFiles.forEach(f => { deleteProcFile(f); });
      const keepQuote = saved.quotes.find(q => q.id === winner.id) || winner;
      const { rfq, stf } = await dbAwardRfq(saved.id, keepQuote.id, {
        awardNotes: awardNotes.trim() || null, stfNo: confirmAward.stfNo.trim() || null,
        projectType: confirmAward.projectType, projectName: confirmAward.projectName.trim(),
      }, currentUserName);
      setConfirmAward(null);
      onSaved(rfq);
      onAwarded(rfq, stf);
    } catch (e: any) {
      setError(e?.message || 'Could not award the RFQ.');
      setConfirmAward(null);
    } finally { setBusy(null); }
  };

  const totals = quotes.map(q => ({ goods: quoteTotal({ lines: cleanLines() } as any, q), landed: quoteLanded({ lines: cleanLines() } as any, q), aed: quoteLandedAed({ lines: cleanLines() } as any, q) }));
  const heading = initial ? `${initial.rfqNo} — ${initial.title}` : 'New RFQ — request for quotation';

  return (
    <>
    <Modal
      title={heading}
      subtitle={locked
        ? `${initial!.stfNo ? `STF ${initial!.stfNo} raised` : 'Awarded'}${initial!.poNo ? ` · PO ${initial!.poNo}` : ''} — read only`
        : 'Ask several suppliers, record each quotation, compare side by side, then award to raise the STF'}
      onClose={onClose} width="max-w-6xl"
      footer={locked ? <button onClick={onClose} className={btn.soft}>Close</button> : <>
        <button onClick={onClose} className={btn.soft}>Cancel</button>
        <button onClick={persist} disabled={!!busy} className={btn.soft} data-testid="rfq-save">{busy === 'save' ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Save className="h-3.5 w-3.5" />} Save draft</button>
        <button onClick={openAward} disabled={!!busy || !awardId} className={btn.primary} data-testid="rfq-award">{busy === 'award' ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Award className="h-3.5 w-3.5" />} Award &amp; create STF</button>
      </>}
    >
      <div className="space-y-4">
        {/* 1 · header */}
        <div className="grid grid-cols-1 md:grid-cols-6 gap-3">
          {!initial && <Field label="RFQ number" className="md:col-span-2"><input value={rfqNo} onChange={e => setRfqNo(e.target.value)} placeholder="Leave empty to auto-generate" className={`${inputCls} font-mono`} data-testid="rfq-no" /></Field>}
          <Field label="Title *" className={initial ? 'md:col-span-2' : 'md:col-span-4'}><input value={title} onChange={e => setTitle(e.target.value)} disabled={locked} className={inputCls} data-testid="rfq-title" /></Field>
          <Field label="Department / project" className="md:col-span-2"><input value={projectName} onChange={e => setProjectName(e.target.value)} disabled={locked} placeholder="e.g. TIGER, Factory maintenance" className={inputCls} data-testid="rfq-project" /></Field>
          <Field label="Target delivery date" className="md:col-span-2"><input type="date" value={neededBy} onChange={e => setNeededBy(e.target.value)} disabled={locked} className={inputCls} /></Field>
          <Field label="Remarks" className={initial ? 'md:col-span-2' : 'md:col-span-4'}><input value={notes} onChange={e => setNotes(e.target.value)} disabled={locked} className={inputCls} /></Field>
        </div>

        {/* 3 · dispatch bar */}
        <div className="rounded-xl border border-slate-200 bg-slate-50 px-3 py-2.5 flex flex-wrap items-center gap-2" data-testid="rfq-dispatch">
          <Send className="h-3.5 w-3.5 text-slate-500" />
          <span className="text-xs font-extrabold text-slate-800" data-testid="rfq-dispatch-count">{summary.requested} supplier{summary.requested === 1 ? '' : 's'} requested</span>
          <span className="text-[11px] text-slate-500">· {summary.quoted} quoted{summary.waiting ? ` · ${summary.waiting} waiting` : ''}{summary.declined ? ` · ${summary.declined} declined` : ''}</span>
          {!locked && <>
            <select value={addSupplier} onChange={e => { if (e.target.value) dispatchTo(e.target.value); }} className="ml-auto bg-white border border-slate-300 rounded-lg px-2 py-2 text-xs text-slate-900" data-testid="rfq-add-supplier">
              <option value="">+ Send to a listed supplier…</option>
              {usable.filter(s => !asked.has(s.name.trim().toLowerCase())).map(s => <option key={s.id} value={s.name}>{s.name}</option>)}
            </select>
            <input value={customSupplier} onChange={e => setCustomSupplier(e.target.value)} onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); dispatchTo(customSupplier); } }}
              placeholder="…or type a supplier name" className="bg-white border border-slate-300 rounded-lg px-2.5 py-2 text-xs text-slate-900 w-48" data-testid="rfq-custom-supplier" />
            <button onClick={() => dispatchTo(customSupplier)} disabled={!customSupplier.trim()} className={btn.soft} data-testid="rfq-add-custom"><Plus className="h-3.5 w-3.5" /> Add</button>
            <button onClick={copyRequest} disabled={cleanLines().length === 0} className={btn.soft} title="Copy the request (items + quantities) to paste into an email or WhatsApp">
              {copied ? <Check className="h-3.5 w-3.5 text-emerald-600" /> : <Copy className="h-3.5 w-3.5" />} {copied ? 'Copied' : 'Copy request text'}
            </button>
          </>}
        </div>

        {/* 2 + 4 + 5 · items down, suppliers across */}
        <div className="rounded-xl border border-slate-200 overflow-x-auto">
          <table className="w-full text-xs" style={{ minWidth: 520 + quotes.length * 180 }}>
            <thead>
              <tr className="bg-slate-100 text-slate-500 uppercase text-[10px]">
                <th className="text-left px-2 py-2 min-w-[240px]">Item needed</th>
                <th className="text-right px-2 py-2 w-24">Qty</th>
                {quotes.map(q => {
                  const st = quoteState({ lines: cleanLines() } as any, q);
                  return (
                    <th key={q.id} className="px-2 py-2 min-w-[170px] text-left normal-case">
                      <div className="flex items-center justify-between gap-1">
                        <span className="font-extrabold text-slate-800 text-xs truncate" title={q.supplierName}>{q.supplierName}</span>
                        {!locked && <button onClick={() => { setQuotes(qs => qs.filter(x => x.id !== q.id)); if (awardId === q.id) setAwardId(''); }} className="text-slate-400 hover:text-rose-600 cursor-pointer" title="Remove supplier"><Trash2 className="h-3 w-3" /></button>}
                      </div>
                      <div className="flex flex-wrap items-center gap-1 mt-1">
                        <span className={`px-1.5 py-0.5 rounded-full text-[9px] font-black uppercase border ${STATE_META[st].cls}`}>{STATE_META[st].label}</span>
                        {q.custom && <span className="px-1.5 py-0.5 rounded-full text-[9px] font-bold border border-slate-300 text-slate-600 bg-white" title="Typed in — not in the supplier list">not listed</span>}
                      </div>
                      {q.requestedAt && <div className="text-[10px] font-normal text-slate-500 mt-0.5">asked {dateFmt(q.requestedAt)}</div>}
                    </th>
                  );
                })}
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
                    const aeds = quotes.filter(x => !x.declined).map(x => unitPriceAed(x, l.id)).filter((p): p is number => p != null);
                    const mine = unitPriceAed(q, l.id);
                    const low = !q.declined && mine != null && aeds.length > 1 && mine <= Math.min(...aeds) + 1e-9;
                    return (
                      <td key={q.id} className={`px-2 py-2 ${q.declined ? 'opacity-40' : ''}`}>
                        <input type="number" min={0} step="any" placeholder="unit price" value={v ?? ''} onChange={e => setPrice(q.id, l.id, e.target.value)} disabled={locked || !!q.declined}
                          className={`${inputCls} text-right font-mono ${low ? '!bg-emerald-50 !border-emerald-400' : ''}`} data-testid={`rfq-price-${q.supplierName}-${l.itemName}`} />
                        {v != null && <div className="text-[10px] text-slate-500 text-right mt-0.5">{quoteCurrency(q) !== 'AED' ? `${quoteCurrency(q)} ` : ''}{money(v * l.qty)}{low && <span className="ml-1 text-emerald-700 font-bold">lowest</span>}</div>}
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
                    <td key={q.id} className={`px-2 py-1.5 ${q.declined ? 'opacity-40' : ''}`}>
                      <input type={type} value={(q as any)[field] ?? ''} onChange={e => patchQuote(q.id, { [field]: type === 'number' ? (e.target.value === '' ? null : Number(e.target.value)) : e.target.value } as any)} disabled={locked || !!q.declined} className={inputCls} />
                    </td>
                  ))}
                  <td />
                </tr>
              ))}
              {/* currency + delivery */}
              <tr className="border-t border-slate-200 bg-slate-50/60">
                <td className="px-2 py-1.5 text-slate-500 font-semibold" colSpan={2}>Currency <span className="font-normal text-[10px]">· AED per 1 unit</span></td>
                {quotes.map(q => (
                  <td key={q.id} className={`px-2 py-1.5 ${q.declined ? 'opacity-40' : ''}`}>
                    <div className="flex gap-1">
                      <select value={quoteCurrency(q)} onChange={e => patchQuote(q.id, { currency: e.target.value, fxRate: e.target.value === 'AED' ? null : q.fxRate })} disabled={locked || !!q.declined} className={`${inputCls} !w-20`} data-testid={`rfq-cur-${q.supplierName}`}>
                        {[...new Set([...CURRENCIES, quoteCurrency(q)])].map(c => <option key={c} value={c}>{c}</option>)}
                      </select>
                      <input type="number" min={0} step="any" placeholder="rate" value={quoteCurrency(q) === 'AED' ? 1 : (q.fxRate ?? '')} onChange={e => patchQuote(q.id, { fxRate: e.target.value === '' ? null : Number(e.target.value) })} disabled={locked || !!q.declined || quoteCurrency(q) === 'AED'} className={`${inputCls} text-right font-mono`} />
                    </div>
                  </td>
                ))}
                <td />
              </tr>
              <tr className="border-t border-slate-200 bg-slate-50/60">
                <td className="px-2 py-1.5 text-slate-500 font-semibold" colSpan={2}>Delivery cost <span className="font-normal text-[10px]">· in their currency</span></td>
                {quotes.map(q => (
                  <td key={q.id} className={`px-2 py-1.5 ${q.declined ? 'opacity-40' : ''}`}>
                    <input type="number" min={0} step="any" placeholder="0" value={q.deliveryCost ?? ''} onChange={e => patchQuote(q.id, { deliveryCost: e.target.value === '' ? null : Number(e.target.value) })} disabled={locked || !!q.declined} className={`${inputCls} text-right font-mono`} data-testid={`rfq-delivery-${q.supplierName}`} />
                  </td>
                ))}
                <td />
              </tr>
              {!locked && quotes.length > 0 && (
                <tr className="border-t border-slate-200 bg-slate-50/60">
                  <td className="px-2 py-1.5 text-slate-500 font-semibold" colSpan={2}>Supplier will not quote</td>
                  {quotes.map(q => (
                    <td key={q.id} className="px-2 py-1.5">
                      <label className="flex items-center gap-1.5 text-[11px] text-slate-700 cursor-pointer"><input type="checkbox" checked={!!q.declined} onChange={e => { patchQuote(q.id, { declined: e.target.checked }); if (e.target.checked && awardId === q.id) setAwardId(''); }} className="accent-rose-600" /> Declined</label>
                    </td>
                  ))}
                  <td />
                </tr>
              )}
              {/* the supplier's quotation as a PDF */}
              <tr className="border-t border-slate-200 bg-slate-50/60 align-top">
                <td className="px-2 py-2 text-slate-500 font-semibold" colSpan={2}>Quotation PDF / photo<div className="text-[10px] font-normal">The supplier’s own document</div></td>
                {quotes.map(q => (
                  <td key={q.id} className="px-2 py-2">
                    <AttachmentList
                      attachments={q.attachments || []} ownerKey={ownerKey} uploadedByName={currentUserName} compact
                      readOnly={locked}
                      testId={`rfq-files-${q.supplierName}`}
                      onChange={next => patchQuote(q.id, { attachments: next })}
                      onRemove={a => setRemovedFiles(r => [...r, a])}
                    />
                  </td>
                ))}
                <td />
              </tr>
              {/* totals + award */}
              <tr className="border-t-2 border-slate-300 bg-slate-100">
                <td className="px-2 py-2 font-extrabold text-slate-800" colSpan={2}>Goods total <span className="font-normal text-[10px] text-slate-500">· before VAT</span></td>
                {totals.map((t, i) => <td key={quotes[i].id} className="px-2 py-2 font-mono text-slate-800">{t.goods == null ? <span className="text-slate-400 font-sans text-xs font-normal">incomplete</span> : `${quoteCurrency(quotes[i])} ${money(t.goods)}`}</td>)}
                <td />
              </tr>
              <tr className="bg-slate-100">
                <td className="px-2 py-2 font-extrabold text-slate-800" colSpan={2}>Landed cost <span className="font-normal text-[10px] text-slate-500">· goods + delivery, in AED</span></td>
                {totals.map((t, i) => {
                  const q = quotes[i];
                  const isLow = q.id === cheapest;
                  const over = t.aed != null && lowestAed ? ((t.aed - lowestAed) / lowestAed) * 100 : null;
                  return (
                    <td key={q.id} className={`px-2 py-2 ${q.declined ? 'opacity-40' : ''}`}>
                      <div className={`font-mono font-black text-sm ${isLow ? 'text-emerald-700' : 'text-slate-900'}`}>{t.aed == null ? <span className="text-slate-400 font-sans text-xs font-normal">incomplete</span> : `AED ${money(t.aed)}`}</div>
                      {isLow && <div className="text-[10px] text-emerald-700 font-bold flex items-center gap-1"><Crown className="h-3 w-3" /> Lowest landed cost</div>}
                      {!isLow && over != null && over > 0.005 && <div className="text-[10px] text-slate-500">+{over.toFixed(1)}% vs lowest</div>}
                      {quoteFx(q) !== 1 && t.landed != null && <div className="text-[10px] text-slate-500">{quoteCurrency(q)} {money(t.landed)} @ {quoteFx(q)}</div>}
                      <label className="mt-1 flex items-center gap-1.5 text-[11px] text-slate-700 cursor-pointer">
                        <input type="radio" name="award" checked={awardId === q.id} onChange={() => setAwardId(q.id)} disabled={locked || !!q.declined} className="accent-emerald-600" data-testid={`rfq-award-${q.supplierName}`} /> {locked && awardId === q.id ? 'Awarded' : 'Award'}
                      </label>
                    </td>
                  );
                })}
                <td />
              </tr>
            </tbody>
          </table>
          {!locked && (
            <div className="px-2 py-2 border-t border-slate-200 flex flex-wrap gap-2 items-center">
              <button onClick={() => setLines(ls => [...ls, { id: key('sl'), materialId: '', itemName: '', unit: '', qty: 1 }])} className={btn.soft}><Plus className="h-3.5 w-3.5" /> Add item</button>
              {quotes.length < 3 && <span className="text-[11px] text-slate-500">Good practice: compare at least three quotations.</span>}
            </div>
          )}
        </div>

        {(notCheapest || awardNotes) && (
          <Field label={notCheapest ? 'Why not the lowest landed cost? *' : 'Award notes'}>
            <textarea rows={2} value={awardNotes} onChange={e => setAwardNotes(e.target.value)} disabled={locked} placeholder="Quality, certificates, delivery time, payment terms, past performance…" className={`${inputCls} resize-y`} data-testid="rfq-award-notes" />
          </Field>
        )}
        {initial?.awardedAt && (
          <div className="text-[11px] text-slate-600 flex flex-wrap items-center gap-x-3 gap-y-1">
            <span>Awarded by {initial.awardedByName} · {dateFmt(initial.awardedAt)}</span>
            {initial.stfNo && <span className="font-mono font-bold flex items-center gap-1"><FileText className="h-3 w-3" /> {initial.stfNo}</span>}
            {initial.poNo && <span className="font-mono font-bold">{initial.poNo}</span>}
          </div>
        )}
        {error && <div className="rounded-lg border border-rose-300 bg-rose-50 px-3 py-2 text-xs text-rose-700 flex items-start gap-2"><AlertTriangle className="h-4 w-4 shrink-0" />{error}</div>}
      </div>
    </Modal>

    {/* award confirmation → raises the STF */}
    {confirmAward && winner && (
      <Modal z="z-[70]" width="max-w-lg" title="Award & create STF" subtitle={`${winner.supplierName} · AED ${money(quoteLandedAed(rfqLike as any, winner) || 0)} landed`} onClose={() => setConfirmAward(null)}
        footer={<>
          <button onClick={() => setConfirmAward(null)} disabled={busy === 'award'} className={btn.soft}>Back</button>
          <button onClick={award} disabled={busy === 'award'} className={btn.primary} data-testid="rfq-award-confirm">{busy === 'award' ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Award className="h-3.5 w-3.5" />} Create STF</button>
        </>}>
        <div className="space-y-3">
          <div className="text-xs text-slate-600">The STF is created from the winning quotation — items, prices, currency, payment terms and the supplier’s PDF — and linked to this RFQ. It then goes through the normal approval queue; the PO is issued from it once approved.</div>
          <div className="grid grid-cols-2 gap-3">
            <Field label="STF number" className="col-span-2"><input value={confirmAward.stfNo} onChange={e => setConfirmAward(c => c && ({ ...c, stfNo: e.target.value }))} placeholder="Leave empty — the next number is generated" className={`${inputCls} font-mono`} data-testid="rfq-award-stfno" /></Field>
            <Field label="Project type"><select value={confirmAward.projectType} onChange={e => setConfirmAward(c => c && ({ ...c, projectType: e.target.value }))} className={inputCls}>{PROJECT_TYPES.map(p => <option key={p}>{p}</option>)}</select></Field>
            <Field label="Project name"><input value={confirmAward.projectName} onChange={e => setConfirmAward(c => c && ({ ...c, projectName: e.target.value }))} className={inputCls} /></Field>
          </div>
        </div>
      </Modal>
    )}
    </>
  );
};
