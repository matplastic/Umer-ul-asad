import React, { useMemo, useState } from 'react';
import { Plus, Trash2, Save, Award, Loader2, AlertTriangle, Crown, Send, FileDown, FileText, Check } from 'lucide-react';
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
import { exportRfqRequestPdf } from '../lib/rfqPdf';

// RFQ — three steps on one sheet, done on different days:
//   1 · Request     what we need (items + qty), which suppliers we ask → download the RFQ PDF for each supplier and send it
//   2 · Quotations  when a supplier replies: open their card, type their prices and terms, upload their quotation
//   3 · Compare     every quotation side by side (lowest price per item + lowest landed cost highlighted) → award → STF raised

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
  requested: { label: 'Waiting for quote', cls: 'bg-sky-50 text-sky-800 border-sky-300' },
  partial: { label: 'Part quoted', cls: 'bg-amber-50 text-amber-800 border-amber-300' },
  quoted: { label: 'Quoted', cls: 'bg-emerald-50 text-emerald-800 border-emerald-300' },
  declined: { label: 'Declined', cls: 'bg-rose-50 text-rose-700 border-rose-300' },
};

type Step = 'request' | 'quotes' | 'compare';

export const RfqEditor: React.FC<Props> = ({ suppliers, materials, initial, seed, currentUserName, onClose, onSaved, onAwarded }) => {
  // the sheet as last saved (a new sheet becomes "saved" after the first Save, so a second Save updates it instead of duplicating it)
  const [saved, setSaved] = useState<Rfq | null>(initial || null);
  const locked = saved ? saved.status !== 'draft' : false;   // awarded / STF raised: read-only
  const [step, setStep] = useState<Step>(locked ? 'compare' : (initial?.quotes.length ? 'quotes' : 'request'));
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
  const [openQuoteId, setOpenQuoteId] = useState<string>(initial?.quotes.find(q => !q.declined && quoteState(initial, q) !== 'quoted')?.id || initial?.quotes[0]?.id || '');
  const [awardId, setAwardId] = useState<string>(initial?.awardedQuoteId || '');
  const [awardNotes, setAwardNotes] = useState(initial?.awardNotes || '');
  const [busy, setBusy] = useState<'save' | 'award' | 'pdf' | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [flash, setFlash] = useState<string | null>(null);
  const [addSupplier, setAddSupplier] = useState('');
  const [customSupplier, setCustomSupplier] = useState('');
  const [confirmAward, setConfirmAward] = useState<{ stfNo: string; projectType: string; projectName: string } | null>(null);
  const [ownerKey] = useState(() => initial?.id || `new_${Date.now().toString(36)}`);   // storage folder for the supplier PDFs
  const [removedFiles, setRemovedFiles] = useState<ProcAttachment[]>([]);

  const cleanLines = (): RfqLine[] => lines.filter(l => l.materialId).map(({ hint, ...l }) => l);
  const rfqLike = { lines: cleanLines(), quotes };
  const cheapest = useMemo(() => cheapestQuoteId(rfqLike as any), [lines, quotes]);
  const summary = useMemo(() => dispatchSummary(rfqLike as any), [lines, quotes]);
  const usable = useMemo(() => suppliers.filter(s => s.status !== 'blocked').sort((a, b) => a.name.localeCompare(b.name)), [suppliers]);
  const asked = new Set(quotes.map(q => q.supplierName.trim().toLowerCase()));
  const lowestAed = cheapest ? quoteLandedAed(rfqLike as any, quotes.find(q => q.id === cheapest)!) : null;
  const winner = quotes.find(q => q.id === awardId) || null;
  const notCheapest = !!winner && !!cheapest && winner.id !== cheapest && (quoteLandedAed(rfqLike as any, winner) ?? 0) > (lowestAed ?? 0) + 0.005;
  const openQuote = quotes.find(q => q.id === openQuoteId) || null;

  const setLineMaterial = (id: string, materialId: string) => {
    const m = materials.find(x => x.id === materialId);
    setLines(ls => ls.map(l => l.id === id ? { ...l, materialId, itemName: m?.name || '', unit: m?.unit || '', erpCode: (m as any)?.erpCode || null, hint: undefined } : l));
  };
  const patchQuote = (qid: string, patch: Partial<RfqQuote>) => setQuotes(qs => qs.map(q => q.id === qid ? { ...q, ...patch } : q));
  const setPrice = (qid: string, lid: string, v: string) =>
    setQuotes(qs => qs.map(q => q.id === qid ? { ...q, unitPrices: { ...q.unitPrices, [lid]: v === '' ? null : Number(v) } } : q));

  // ── step 1: add suppliers ──
  const addTo = (name: string) => {
    const nm = name.trim();
    if (!nm) return;
    if (asked.has(nm.toLowerCase())) { setError(`${nm} is already on this RFQ.`); return; }
    const s = suppliers.find(x => x.name.trim().toLowerCase() === nm.toLowerCase());
    if (s && s.status === 'blocked') { setError(`${s.name} is blocked.`); return; }
    setError(null);
    const q: RfqQuote = {
      id: key('q'), supplierId: s?.id ?? null, supplierName: s?.name ?? nm, unitPrices: {},
      paymentTerms: s?.paymentTerms || null, leadTimeDays: s?.leadTimeDays ?? null,
      currency: s?.currency || 'AED', fxRate: null, deliveryCost: null,
      requestedAt: new Date().toISOString(), requestedByName: currentUserName, custom: !s,
    };
    setQuotes(qs => [...qs, q]);
    if (!openQuoteId) setOpenQuoteId(q.id);
    setAddSupplier(''); setCustomSupplier('');
  };

  const validateRequest = (): string | null => {
    if (!title.trim()) return 'Give this RFQ a title (e.g. “Resin — December”).';
    if (cleanLines().length === 0) return 'Add at least one item (pick it from the Store list).';
    if (cleanLines().some(l => !(Number(l.qty) > 0))) return 'Every item needs a quantity.';
    return null;
  };
  const validateQuotes = (): string | null => {
    const bad = quotes.find(q => quoteCurrency(q) !== 'AED' && !(Number(q.fxRate) > 0) && Object.values(q.unitPrices).some(v => v != null));
    return bad ? `Enter the AED exchange rate for ${bad.supplierName}’s ${quoteCurrency(bad)} quotation.` : null;
  };

  const saveSheet = async (): Promise<Rfq> => {
    const rec = await dbSaveRfq({
      id: saved?.id, rfqNo: saved ? undefined : rfqNo.trim() || undefined,
      title: title.trim(), projectName: projectName.trim() || null, neededBy: neededBy || null, notes: notes.trim() || null, lines: cleanLines(), quotes,
    }, currentUserName);
    removedFiles.forEach(f => { deleteProcFile(f); });
    setRemovedFiles([]);
    setSaved(rec);
    onSaved(rec);
    return rec;
  };

  const persist = async () => {
    setError(null); setFlash(null);
    const bad = validateRequest() || validateQuotes();
    if (bad) { setError(bad); return; }
    setBusy('save');
    try { const r = await saveSheet(); setFlash(`Saved as ${r.rfqNo}`); setTimeout(() => setFlash(null), 2500); }
    catch (e: any) { setError(e?.message || 'Could not save the RFQ.'); }
    finally { setBusy(null); }
  };

  // the RFQ PDF for one supplier — the sheet is saved first so the PDF carries the real RFQ number
  const downloadPdf = async (q: RfqQuote | null) => {
    setError(null);
    const bad = validateRequest();
    if (bad) { setError(bad); return; }
    setBusy('pdf');
    try {
      const rec = await saveSheet();
      const sup = q ? suppliers.find(s => s.id === q.supplierId || s.name.trim().toLowerCase() === q.supplierName.trim().toLowerCase()) || null : null;
      await exportRfqRequestPdf(rec, q?.supplierName || null, sup);
      if (q) setQuotes(qs => qs.map(x => x.id === q.id ? { ...x, requestedAt: x.requestedAt || new Date().toISOString() } : x));
    } catch (e: any) { setError(e?.message || 'Could not create the PDF.'); }
    finally { setBusy(null); }
  };

  // ── step 3: award ──
  const validateAward = (): string | null => {
    const bad = validateRequest() || validateQuotes();
    if (bad) return bad;
    if (!winner) return 'Pick the winning supplier.';
    if (winner.declined) return `${winner.supplierName} declined to quote.`;
    if (quoteTotal({ lines: cleanLines() }, winner) == null) return `${winner.supplierName} has not quoted every item yet.`;
    if (notCheapest && !awardNotes.trim()) return 'The winner is not the lowest landed cost — write why (quality, lead time, terms…).';
    return null;
  };
  const openAward = () => {
    setError(null);
    const bad = validateAward();
    if (bad) { setError(bad); return; }
    setConfirmAward({ stfNo: '', projectType: 'SALES', projectName: projectName.trim() });
  };
  const award = async () => {
    if (!confirmAward || !winner) return;
    setError(null); setBusy('award');
    try {
      const rec = await saveSheet();                         // every quotation is stored before the award
      const { rfq, stf } = await dbAwardRfq(rec.id, winner.id, {
        awardNotes: awardNotes.trim() || null, stfNo: confirmAward.stfNo.trim() || null,
        projectType: confirmAward.projectType, projectName: confirmAward.projectName.trim(),
      }, currentUserName);
      setConfirmAward(null);
      setSaved(rfq);
      onSaved(rfq);
      onAwarded(rfq, stf);
    } catch (e: any) {
      setError(e?.message || 'Could not award the RFQ.');
      setConfirmAward(null);
    } finally { setBusy(null); }
  };

  const heading = saved ? `${saved.rfqNo} — ${saved.title}` : 'New RFQ — request for quotation';
  const TabBtn: React.FC<{ id: Step; n: number; label: string; sub: string }> = ({ id, n, label, sub }) => (
    <button onClick={() => setStep(id)} data-testid={`rfq-step-${id}`}
      className={`flex-1 text-left rounded-xl border px-3 py-2 cursor-pointer ${step === id ? 'border-primary-500 bg-primary-50' : 'border-slate-200 bg-white hover:bg-slate-50'}`}>
      <div className="flex items-center gap-2"><span className={`h-5 w-5 rounded-full text-[11px] font-black flex items-center justify-center ${step === id ? 'bg-primary-600 text-white' : 'bg-slate-200 text-slate-600'}`}>{n}</span><span className="text-xs font-extrabold text-slate-900">{label}</span></div>
      <div className="text-[10px] text-slate-500 mt-0.5 ml-7">{sub}</div>
    </button>
  );

  return (
    <>
    <Modal
      title={heading}
      subtitle={locked ? `${saved!.stfNo ? `STF ${saved!.stfNo} raised` : 'Awarded'}${saved!.poNo ? ` · PO ${saved!.poNo}` : ''} — read only` : 'Send the request → enter each reply as it arrives → compare → award'}
      onClose={onClose} width="max-w-6xl"
      footer={locked ? <button onClick={onClose} className={btn.soft}>Close</button> : <>
        {flash && <span className="mr-auto text-xs text-emerald-700 font-bold flex items-center gap-1"><Check className="h-3.5 w-3.5" />{flash}</span>}
        <button onClick={onClose} className={btn.soft}>Close</button>
        <button onClick={persist} disabled={!!busy} className={btn.soft} data-testid="rfq-save">{busy === 'save' ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Save className="h-3.5 w-3.5" />} Save</button>
        {step === 'compare'
          ? <button onClick={openAward} disabled={!!busy || !awardId} className={btn.primary} data-testid="rfq-award">{busy === 'award' ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Award className="h-3.5 w-3.5" />} Award &amp; create STF</button>
          : <button onClick={() => setStep(step === 'request' ? 'quotes' : 'compare')} disabled={!!busy} className={btn.primary}>{step === 'request' ? 'Next: enter quotations' : 'Next: compare'}</button>}
      </>}
    >
      <div className="space-y-4">
        <div className="flex gap-2">
          <TabBtn id="request" n={1} label="Request" sub={`${cleanLines().length} item${cleanLines().length === 1 ? '' : 's'} · ${summary.requested} supplier${summary.requested === 1 ? '' : 's'} asked`} />
          <TabBtn id="quotes" n={2} label="Quotations" sub={`${summary.quoted} of ${summary.requested} received${summary.declined ? ` · ${summary.declined} declined` : ''}`} />
          <TabBtn id="compare" n={3} label="Compare & award" sub={cheapest ? `lowest landed AED ${money(lowestAed || 0)}` : 'needs a complete quotation'} />
        </div>

        {/* ───────── 1 · REQUEST ───────── */}
        {step === 'request' && (
          <div className="space-y-4">
            <div className="grid grid-cols-1 md:grid-cols-6 gap-3">
              {!saved && <Field label="RFQ number" className="md:col-span-2"><input value={rfqNo} onChange={e => setRfqNo(e.target.value)} placeholder="Leave empty to auto-generate" className={`${inputCls} font-mono`} data-testid="rfq-no" /></Field>}
              <Field label="Title *" className={saved ? 'md:col-span-2' : 'md:col-span-4'}><input value={title} onChange={e => setTitle(e.target.value)} disabled={locked} className={inputCls} data-testid="rfq-title" /></Field>
              <Field label="Department / project" className="md:col-span-2"><input value={projectName} onChange={e => setProjectName(e.target.value)} disabled={locked} placeholder="e.g. TIGER, Factory maintenance" className={inputCls} data-testid="rfq-project" /></Field>
              <Field label="Target delivery date" className="md:col-span-2"><input type="date" value={neededBy} onChange={e => setNeededBy(e.target.value)} disabled={locked} className={inputCls} /></Field>
              <Field label="Remarks (printed on the PDF)" className={saved ? 'md:col-span-2' : 'md:col-span-4'}><input value={notes} onChange={e => setNotes(e.target.value)} disabled={locked} className={inputCls} /></Field>
            </div>

            <div className="rounded-xl border border-slate-200 overflow-x-auto">
              <table className="w-full text-xs min-w-[520px]">
                <thead><tr className="bg-slate-100 text-slate-500 uppercase text-[10px]"><th className="text-left px-2 py-2">Item needed</th><th className="text-right px-2 py-2 w-28">Qty</th><th className="w-8" /></tr></thead>
                <tbody>
                  {lines.map(l => (
                    <tr key={l.id} className="border-t border-slate-200 align-top">
                      <td className="px-2 py-2">
                        {locked ? <div className="font-semibold">{l.itemName}</div> : <MaterialPicker materials={materials} value={l.materialId} onChange={id => setLineMaterial(l.id, id)} />}
                        {!l.materialId && l.hint && <div className="text-[11px] text-amber-700 mt-1">Requested as “{l.hint}” — pick the matching Store item.</div>}
                      </td>
                      <td className="px-2 py-2"><input type="number" min={0} step="any" value={l.qty} onChange={e => setLines(ls => ls.map(x => x.id === l.id ? { ...x, qty: Number(e.target.value) } : x))} disabled={locked} className={`${inputCls} text-right font-mono`} /><div className="text-[10px] text-slate-500 text-right mt-0.5">{l.unit}</div></td>
                      <td className="px-1 py-2">{!locked && lines.length > 1 && <button onClick={() => setLines(ls => ls.filter(x => x.id !== l.id))} className="text-slate-400 hover:text-rose-600 cursor-pointer"><Trash2 className="h-3.5 w-3.5" /></button>}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {!locked && <div className="px-2 py-2 border-t border-slate-200"><button onClick={() => setLines(ls => [...ls, { id: key('sl'), materialId: '', itemName: '', unit: '', qty: 1 }])} className={btn.soft}><Plus className="h-3.5 w-3.5" /> Add item</button></div>}
            </div>

            <div className="rounded-xl border border-slate-200 p-3 space-y-3" data-testid="rfq-dispatch">
              <div className="flex flex-wrap items-center gap-2">
                <Send className="h-3.5 w-3.5 text-slate-500" />
                <span className="text-xs font-extrabold text-slate-800" data-testid="rfq-dispatch-count">{summary.requested} supplier{summary.requested === 1 ? '' : 's'} requested</span>
                {!locked && <>
                  <select value={addSupplier} onChange={e => { if (e.target.value) addTo(e.target.value); }} className="ml-auto bg-white border border-slate-300 rounded-lg px-2 py-2 text-xs text-slate-900" data-testid="rfq-add-supplier">
                    <option value="">+ Add a listed supplier…</option>
                    {usable.filter(s => !asked.has(s.name.trim().toLowerCase())).map(s => <option key={s.id} value={s.name}>{s.name}</option>)}
                  </select>
                  <input value={customSupplier} onChange={e => setCustomSupplier(e.target.value)} onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); addTo(customSupplier); } }}
                    placeholder="…or type a supplier name" className="bg-white border border-slate-300 rounded-lg px-2.5 py-2 text-xs text-slate-900 w-48" data-testid="rfq-custom-supplier" />
                  <button onClick={() => addTo(customSupplier)} disabled={!customSupplier.trim()} className={btn.soft} data-testid="rfq-add-custom"><Plus className="h-3.5 w-3.5" /> Add</button>
                </>}
              </div>
              {quotes.length === 0 && <div className="text-[11px] text-slate-500">Add every supplier you will ask. Then download the RFQ PDF for each one and send it to them.</div>}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
                {quotes.map(q => {
                  const st = quoteState({ lines: cleanLines() } as any, q);
                  return (
                    <div key={q.id} className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 flex items-center gap-2">
                      <div className="min-w-0 flex-1">
                        <div className="text-xs font-extrabold text-slate-800 truncate">{q.supplierName}{q.custom && <span className="ml-1.5 text-[9px] font-bold text-slate-500 border border-slate-300 rounded-full px-1.5 bg-white">not listed</span>}</div>
                        <div className="text-[10px] text-slate-500">{q.requestedAt ? `asked ${dateFmt(q.requestedAt)}` : 'not sent yet'}</div>
                      </div>
                      <span className={`px-1.5 py-0.5 rounded-full text-[9px] font-black uppercase border ${STATE_META[st].cls}`}>{STATE_META[st].label}</span>
                      <button onClick={() => downloadPdf(q)} disabled={!!busy} className={btn.soft} title={`Download the RFQ PDF addressed to ${q.supplierName}`} data-testid={`rfq-pdf-${q.supplierName}`}>{busy === 'pdf' ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <FileDown className="h-3.5 w-3.5" />} RFQ PDF</button>
                      {!locked && <button onClick={() => { setQuotes(qs => qs.filter(x => x.id !== q.id)); if (awardId === q.id) setAwardId(''); if (openQuoteId === q.id) setOpenQuoteId(''); }} className="text-slate-400 hover:text-rose-600 cursor-pointer" title="Remove supplier"><Trash2 className="h-3.5 w-3.5" /></button>}
                    </div>
                  );
                })}
              </div>
              {quotes.length > 1 && <button onClick={() => downloadPdf(null)} disabled={!!busy} className="text-[11px] text-primary-700 font-bold hover:underline cursor-pointer">Download one general RFQ PDF (no supplier name)</button>}
            </div>
          </div>
        )}

        {/* ───────── 2 · QUOTATIONS ───────── */}
        {step === 'quotes' && (
          <div className="grid grid-cols-1 lg:grid-cols-[240px_1fr] gap-4">
            <div className="space-y-2">
              <div className="text-[10px] uppercase font-black text-slate-500">Suppliers</div>
              {quotes.length === 0 && <div className="text-xs text-slate-500">No suppliers yet — add them in step 1.</div>}
              {quotes.map(q => {
                const st = quoteState({ lines: cleanLines() } as any, q);
                return (
                  <button key={q.id} onClick={() => setOpenQuoteId(q.id)} data-testid={`rfq-open-${q.supplierName}`}
                    className={`w-full text-left rounded-lg border px-3 py-2 cursor-pointer ${openQuoteId === q.id ? 'border-primary-500 bg-primary-50' : 'border-slate-200 bg-white hover:bg-slate-50'}`}>
                    <div className="text-xs font-extrabold text-slate-800 truncate">{q.supplierName}</div>
                    <span className={`inline-block mt-1 px-1.5 py-0.5 rounded-full text-[9px] font-black uppercase border ${STATE_META[st].cls}`}>{STATE_META[st].label}</span>
                    {(q.attachments?.length || 0) > 0 && <span className="ml-1.5 text-[10px] text-slate-500">· {q.attachments!.length} file{q.attachments!.length === 1 ? '' : 's'}</span>}
                  </button>
                );
              })}
            </div>

            {!openQuote ? <div className="text-sm text-slate-500 py-10 text-center">Pick a supplier to enter their quotation.</div> : (() => {
              const q = openQuote;
              const off = locked || !!q.declined;
              const goods = quoteTotal({ lines: cleanLines() } as any, q);
              return (
                <div className="rounded-xl border border-slate-200 p-4 space-y-4" data-testid="rfq-quote-form">
                  <div className="flex flex-wrap items-center gap-2">
                    <div className="text-sm font-black text-slate-900">{q.supplierName}</div>
                    {!locked && <label className="ml-auto flex items-center gap-1.5 text-[11px] text-slate-700 cursor-pointer"><input type="checkbox" checked={!!q.declined} onChange={e => { patchQuote(q.id, { declined: e.target.checked }); if (e.target.checked && awardId === q.id) setAwardId(''); }} className="accent-rose-600" /> This supplier will not quote</label>}
                  </div>

                  <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                    <Field label="Their quotation no."><input value={q.quoteRef ?? ''} onChange={e => patchQuote(q.id, { quoteRef: e.target.value })} disabled={off} className={inputCls} /></Field>
                    <Field label="Quotation date"><input type="date" value={(q.quoteDate ?? '').slice(0, 10)} onChange={e => patchQuote(q.id, { quoteDate: e.target.value })} disabled={off} className={inputCls} /></Field>
                    <Field label="Valid until"><input type="date" value={(q.validUntil ?? '').slice(0, 10)} onChange={e => patchQuote(q.id, { validUntil: e.target.value })} disabled={off} className={inputCls} /></Field>
                    <Field label="Lead time (days)"><input type="number" min={0} value={q.leadTimeDays ?? ''} onChange={e => patchQuote(q.id, { leadTimeDays: e.target.value === '' ? null : Number(e.target.value) })} disabled={off} className={inputCls} /></Field>
                    <Field label="Currency">
                      <select value={quoteCurrency(q)} onChange={e => patchQuote(q.id, { currency: e.target.value, fxRate: e.target.value === 'AED' ? null : q.fxRate })} disabled={off} className={inputCls} data-testid={`rfq-cur-${q.supplierName}`}>
                        {[...new Set([...CURRENCIES, quoteCurrency(q)])].map(c => <option key={c} value={c}>{c}</option>)}
                      </select>
                    </Field>
                    <Field label="AED per 1 unit"><input type="number" min={0} step="any" value={quoteCurrency(q) === 'AED' ? 1 : (q.fxRate ?? '')} onChange={e => patchQuote(q.id, { fxRate: e.target.value === '' ? null : Number(e.target.value) })} disabled={off || quoteCurrency(q) === 'AED'} className={`${inputCls} font-mono`} /></Field>
                    <Field label={`Delivery cost (${quoteCurrency(q)})`}><input type="number" min={0} step="any" placeholder="0" value={q.deliveryCost ?? ''} onChange={e => patchQuote(q.id, { deliveryCost: e.target.value === '' ? null : Number(e.target.value) })} disabled={off} className={`${inputCls} font-mono`} data-testid={`rfq-delivery-${q.supplierName}`} /></Field>
                    <Field label="Payment terms"><input value={q.paymentTerms ?? ''} onChange={e => patchQuote(q.id, { paymentTerms: e.target.value })} disabled={off} placeholder="PDC - 30 Days" className={inputCls} /></Field>
                  </div>

                  <div className="rounded-lg border border-slate-200 overflow-x-auto">
                    <table className="w-full text-xs min-w-[460px]">
                      <thead><tr className="bg-slate-100 text-slate-500 uppercase text-[10px]"><th className="text-left px-2 py-2">Item</th><th className="text-right px-2 py-2 w-24">Qty</th><th className="text-right px-2 py-2 w-36">Unit price ({quoteCurrency(q)})</th><th className="text-right px-2 py-2 w-32">Amount</th></tr></thead>
                      <tbody>
                        {cleanLines().map(l => {
                          const v = q.unitPrices[l.id];
                          return (
                            <tr key={l.id} className="border-t border-slate-200">
                              <td className="px-2 py-1.5 font-semibold text-slate-800">{l.itemName}</td>
                              <td className="px-2 py-1.5 text-right font-mono">{qtyFmt(l.qty)} <span className="text-[10px] text-slate-500 font-sans">{l.unit}</span></td>
                              <td className="px-2 py-1.5"><input type="number" min={0} step="any" value={v ?? ''} onChange={e => setPrice(q.id, l.id, e.target.value)} disabled={off} className={`${inputCls} text-right font-mono`} data-testid={`rfq-price-${q.supplierName}-${l.itemName}`} /></td>
                              <td className="px-2 py-1.5 text-right font-mono">{v != null ? money(v * l.qty) : '—'}</td>
                            </tr>
                          );
                        })}
                        <tr className="border-t-2 border-slate-300 bg-slate-100 font-bold">
                          <td className="px-2 py-2" colSpan={3}>Goods total{Number(q.deliveryCost) > 0 ? ` + delivery ${money(Number(q.deliveryCost))}` : ''} <span className="font-normal text-slate-500">(before VAT)</span></td>
                          <td className="px-2 py-2 text-right font-mono">{goods == null ? <span className="text-slate-400 font-sans font-normal">incomplete</span> : money(quoteLanded({ lines: cleanLines() } as any, q) || 0)}</td>
                        </tr>
                      </tbody>
                    </table>
                  </div>

                  <div>
                    <div className="text-[10px] uppercase font-bold text-slate-500 mb-1">Their quotation (PDF / photo)</div>
                    <AttachmentList attachments={q.attachments || []} ownerKey={ownerKey} uploadedByName={currentUserName} readOnly={locked}
                      testId={`rfq-files-${q.supplierName}`} onChange={next => patchQuote(q.id, { attachments: next })} onRemove={a => setRemovedFiles(r => [...r, a])} />
                  </div>
                  <Field label="Notes on this quotation"><input value={q.notes ?? ''} onChange={e => patchQuote(q.id, { notes: e.target.value })} disabled={locked} className={inputCls} /></Field>
                  {!locked && <div className="flex justify-end"><button onClick={persist} disabled={!!busy} className={btn.green}><Save className="h-3.5 w-3.5" /> Save this quotation</button></div>}
                </div>
              );
            })()}
          </div>
        )}

        {/* ───────── 3 · COMPARE ───────── */}
        {step === 'compare' && (
          <div className="space-y-3">
            {quotes.filter(q => !q.declined).length === 0 ? <div className="text-sm text-slate-500 py-10 text-center">No quotations to compare yet — enter them in step 2.</div> : (
              <div className="rounded-xl border border-slate-200 overflow-x-auto">
                <table className="w-full text-xs" style={{ minWidth: 420 + quotes.length * 190 }}>
                  <thead>
                    <tr className="bg-slate-100 text-slate-500 uppercase text-[10px]">
                      <th className="text-left px-2 py-2 min-w-[220px]">Item</th><th className="text-right px-2 py-2 w-24">Qty</th>
                      {quotes.map(q => {
                        const st = quoteState({ lines: cleanLines() } as any, q);
                        return <th key={q.id} className={`px-2 py-2 text-left normal-case min-w-[180px] ${q.declined ? 'opacity-50' : ''}`}><div className="font-extrabold text-slate-800 text-xs truncate">{q.supplierName}</div><span className={`inline-block mt-1 px-1.5 py-0.5 rounded-full text-[9px] font-black uppercase border ${STATE_META[st].cls}`}>{STATE_META[st].label}</span></th>;
                      })}
                    </tr>
                  </thead>
                  <tbody>
                    {cleanLines().map(l => {
                      const aeds = quotes.filter(x => !x.declined).map(x => unitPriceAed(x, l.id)).filter((p): p is number => p != null);
                      return (
                        <tr key={l.id} className="border-t border-slate-200">
                          <td className="px-2 py-2 font-semibold text-slate-800">{l.itemName}</td>
                          <td className="px-2 py-2 text-right font-mono">{qtyFmt(l.qty)} <span className="text-[10px] text-slate-500 font-sans">{l.unit}</span></td>
                          {quotes.map(q => {
                            const v = q.unitPrices[l.id]; const mine = unitPriceAed(q, l.id);
                            const low = !q.declined && mine != null && aeds.length > 1 && mine <= Math.min(...aeds) + 1e-9;
                            return <td key={q.id} className={`px-2 py-2 ${low ? 'bg-emerald-50' : ''} ${q.declined ? 'opacity-40' : ''}`}>{v == null ? <span className="text-slate-300">—</span> : <><div className={`font-mono font-bold ${low ? 'text-emerald-700' : 'text-slate-900'}`}>{quoteCurrency(q) !== 'AED' ? `${quoteCurrency(q)} ` : ''}{money(v)}</div><div className="text-[10px] text-slate-500 font-mono">= {money(v * l.qty)}{low && <span className="ml-1 text-emerald-700 font-bold font-sans">lowest</span>}</div></>}</td>;
                          })}
                        </tr>
                      );
                    })}
                    {([['Lead time', (q: RfqQuote) => q.leadTimeDays != null ? `${q.leadTimeDays} days` : '—'], ['Payment terms', (q: RfqQuote) => q.paymentTerms || '—'], ['Delivery cost', (q: RfqQuote) => Number(q.deliveryCost) > 0 ? `${quoteCurrency(q)} ${money(Number(q.deliveryCost))}` : 'none'], ['Valid until', (q: RfqQuote) => q.validUntil ? dateFmt(q.validUntil) : '—'], ['Their quote no.', (q: RfqQuote) => q.quoteRef || '—']] as const).map(([label, fn]) => (
                      <tr key={label} className="border-t border-slate-200 bg-slate-50/60"><td className="px-2 py-1.5 text-slate-500 font-semibold" colSpan={2}>{label}</td>{quotes.map(q => <td key={q.id} className={`px-2 py-1.5 ${q.declined ? 'opacity-40' : ''}`}>{fn(q)}</td>)}</tr>
                    ))}
                    <tr className="border-t border-slate-200 bg-slate-50/60 align-top"><td className="px-2 py-1.5 text-slate-500 font-semibold" colSpan={2}>Their quotation</td>
                      {quotes.map(q => <td key={q.id} className="px-2 py-1.5">{(q.attachments || []).length === 0 ? <span className="text-slate-300">no file</span> : q.attachments!.map((a: ProcAttachment) => <a key={a.id} href={a.url} target="_blank" rel="noopener noreferrer" className="flex items-center gap-1 text-primary-700 font-bold hover:underline truncate"><FileText className="h-3 w-3 shrink-0" />{a.name}</a>)}</td>)}
                    </tr>
                    <tr className="border-t-2 border-slate-300 bg-slate-100">
                      <td className="px-2 py-2 font-extrabold text-slate-800" colSpan={2}>Landed cost <span className="font-normal text-[10px] text-slate-500">· goods + delivery, in AED, before VAT</span></td>
                      {quotes.map(q => {
                        const aed = quoteLandedAed(rfqLike as any, q); const isLow = q.id === cheapest;
                        const over = aed != null && lowestAed ? ((aed - lowestAed) / lowestAed) * 100 : null;
                        return (
                          <td key={q.id} className={`px-2 py-2 ${q.declined ? 'opacity-40' : ''}`}>
                            <div className={`font-mono font-black text-sm ${isLow ? 'text-emerald-700' : 'text-slate-900'}`}>{aed == null ? <span className="text-slate-400 font-sans text-xs font-normal">incomplete</span> : `AED ${money(aed)}`}</div>
                            {isLow && <div className="text-[10px] text-emerald-700 font-bold flex items-center gap-1"><Crown className="h-3 w-3" /> Lowest landed cost</div>}
                            {!isLow && over != null && over > 0.005 && <div className="text-[10px] text-slate-500">+{over.toFixed(1)}% vs lowest</div>}
                            {quoteFx(q) !== 1 && aed != null && <div className="text-[10px] text-slate-500">@ {quoteFx(q)} AED per {quoteCurrency(q)}</div>}
                            <label className="mt-1 flex items-center gap-1.5 text-[11px] text-slate-700 cursor-pointer">
                              <input type="radio" name="award" checked={awardId === q.id} onChange={() => setAwardId(q.id)} disabled={locked || !!q.declined || aed == null} className="accent-emerald-600" data-testid={`rfq-award-${q.supplierName}`} /> {locked && awardId === q.id ? 'Awarded' : 'Award'}
                            </label>
                          </td>
                        );
                      })}
                    </tr>
                  </tbody>
                </table>
              </div>
            )}
            {(notCheapest || awardNotes) && (
              <Field label={notCheapest ? 'Why not the lowest landed cost? *' : 'Award notes'}>
                <textarea rows={2} value={awardNotes} onChange={e => setAwardNotes(e.target.value)} disabled={locked} placeholder="Quality, certificates, delivery time, payment terms, past performance…" className={`${inputCls} resize-y`} data-testid="rfq-award-notes" />
              </Field>
            )}
            {saved?.awardedAt && (
              <div className="text-[11px] text-slate-600 flex flex-wrap items-center gap-x-3 gap-y-1">
                <span>Awarded by {saved.awardedByName} · {dateFmt(saved.awardedAt)}</span>
                {saved.stfNo && <span className="font-mono font-bold flex items-center gap-1"><FileText className="h-3 w-3" /> {saved.stfNo}</span>}
                {saved.poNo && <span className="font-mono font-bold">{saved.poNo}</span>}
              </div>
            )}
          </div>
        )}

        {error && <div className="rounded-lg border border-rose-300 bg-rose-50 px-3 py-2 text-xs text-rose-700 flex items-start gap-2"><AlertTriangle className="h-4 w-4 shrink-0" />{error}</div>}
      </div>
    </Modal>

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
