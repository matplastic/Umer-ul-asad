import React, { useMemo, useRef, useState, useEffect } from 'react';
import { Search, X, ArrowRight, FileText, Scale, ShoppingCart, ClipboardCheck } from 'lucide-react';
import type { ProcAttachment, PurchaseOrder, Rfq, RfqQuote, Stf } from '../types';
import { dateFmt, money, quoteLandedAed } from '../lib/procurement';
import { STF_STATUS_META } from '../lib/stf';

// One search box for the whole chain. Type a PO, STF or RFQ number (or part of it) and get the whole trail:
//   RFQ  →  winning supplier quotation (+ its PDF)  →  STF  →  PO
// so a PO can always be traced back to the quotation it was bought on.

export interface TraceChain {
  key: string;
  rfq: Rfq | null;
  quote: RfqQuote | null;
  stf: Stf | null;
  pos: PurchaseOrder[];
  files: ProcAttachment[];
}

const norm = (x: string) => x.toLowerCase().replace(/[\s.\-_/]/g, '');

export function buildTraceChains(term: string, rfqs: Rfq[], stfs: Stf[], pos: PurchaseOrder[]): TraceChain[] {
  const n = norm(term);
  if (n.length < 3) return [];
  const live = (s: Stf) => s.status !== 'cancelled' && s.status !== 'rejected';
  const chains = new Map<string, TraceChain>();

  const add = (rfq: Rfq | null, stf: Stf | null, po: PurchaseOrder | null) => {
    // resolve the rest of the chain from whatever we were given
    let r = rfq, s = stf;
    if (po && !s && po.stfId) s = stfs.find(x => x.id === po.stfId) || null;
    if (po && !r && po.rfqId) r = rfqs.find(x => x.id === po.rfqId) || null;
    if (s && !r && s.rfqId) r = rfqs.find(x => x.id === s!.rfqId) || null;
    if (r && !s) s = stfs.find(x => x.rfqId === r!.id && live(x)) || stfs.find(x => x.rfqId === r!.id) || null;
    const mine = s ? pos.filter(p => p.stfId === s!.id) : po ? [po] : (r ? pos.filter(p => p.rfqId === r!.id) : []);
    const qid = s?.winningQuoteId || mine.find(p => p.quoteId)?.quoteId || r?.awardedQuoteId || null;
    const quote = r?.quotes.find(q => q.id === qid) || null;
    const files = (quote?.attachments?.length ? quote.attachments : s?.attachments?.filter(a => a.kind === 'quotation')) || [];
    const key = s?.id || r?.id || po?.id || Math.random().toString(36);
    if (!chains.has(key)) chains.set(key, { key, rfq: r, quote, stf: s, pos: mine, files });
  };

  for (const p of pos) if (norm(p.poNo).includes(n)) add(null, null, p);
  for (const s of stfs) if (norm(s.stfNo).includes(n)) add(null, s, null);
  for (const r of rfqs) if (norm(r.rfqNo).includes(n)) add(r, null, null);
  return [...chains.values()].slice(0, 8);
}

interface Props {
  rfqs: Rfq[];
  stfs: Stf[];
  pos: PurchaseOrder[];
  onOpenRfq: (r: Rfq) => void;
  onOpenStf: (s: Stf) => void;
  onOpenPo: (p: PurchaseOrder) => void;
}

const Node: React.FC<{ icon: React.ReactNode; label: string; no?: string | null; sub?: string; onClick?: () => void; missing?: boolean }> = ({ icon, label, no, sub, onClick, missing }) => (
  <button onClick={onClick} disabled={!onClick} className={`text-left rounded-lg border px-2.5 py-1.5 min-w-[130px] ${missing ? 'border-dashed border-slate-300 text-slate-400' : 'border-slate-300 bg-white hover:border-primary-400 cursor-pointer'}`}>
    <div className="text-[9px] uppercase font-black text-slate-500 flex items-center gap-1">{icon}{label}</div>
    <div className="font-mono font-bold text-[11px] text-slate-900 truncate">{no || '—'}</div>
    {sub && <div className="text-[10px] text-slate-500 truncate">{sub}</div>}
  </button>
);

export const ProcurementTrace: React.FC<Props> = ({ rfqs, stfs, pos, onOpenRfq, onOpenStf, onOpenPo }) => {
  const [term, setTerm] = useState('');
  const [open, setOpen] = useState(false);
  const box = useRef<HTMLDivElement | null>(null);
  const chains = useMemo(() => buildTraceChains(term, rfqs, stfs, pos), [term, rfqs, stfs, pos]);

  useEffect(() => {
    const h = (e: MouseEvent) => { if (box.current && !box.current.contains(e.target as Node)) setOpen(false); };
    document.addEventListener('mousedown', h);
    return () => document.removeEventListener('mousedown', h);
  }, []);

  return (
    <div ref={box} className="relative ml-auto w-full max-w-xs" data-testid="proc-trace">
      <Search className="h-3.5 w-3.5 text-slate-400 absolute left-2.5 top-1/2 -translate-y-1/2" />
      <input value={term} onChange={e => { setTerm(e.target.value); setOpen(true); }} onFocus={() => setOpen(true)} placeholder="Trace a PO / STF / RFQ number…"
        className="w-full bg-white border border-slate-300 rounded-lg pl-8 pr-7 py-2 text-xs text-slate-900 focus:outline-none focus:ring-2 focus:ring-primary-500/40" data-testid="proc-trace-input" />
      {term && <button onClick={() => { setTerm(''); setOpen(false); }} className="absolute right-2 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-700 cursor-pointer"><X className="h-3.5 w-3.5" /></button>}
      {open && norm(term).length >= 3 && (
        <div className="absolute right-0 mt-1 w-[min(92vw,640px)] max-h-[70vh] overflow-y-auto z-40 rounded-xl border border-slate-300 bg-white shadow-2xl p-2 space-y-2">
          {chains.length === 0 && <div className="text-xs text-slate-500 px-2 py-3">No PO, STF or RFQ number matches “{term.trim()}”.</div>}
          {chains.map(c => (
            <div key={c.key} className="rounded-lg border border-slate-200 bg-slate-50 p-2 space-y-2" data-testid="proc-trace-result">
              <div className="flex flex-wrap items-center gap-1.5">
                <Node icon={<Scale className="h-2.5 w-2.5" />} label="RFQ" no={c.rfq?.rfqNo} sub={c.rfq ? `${c.rfq.title}${c.rfq.projectName ? ` · ${c.rfq.projectName}` : ''}` : 'no RFQ — bought directly'} missing={!c.rfq} onClick={c.rfq ? () => { setOpen(false); onOpenRfq(c.rfq!); } : undefined} />
                <ArrowRight className="h-3 w-3 text-slate-400" />
                <Node icon={<ClipboardCheck className="h-2.5 w-2.5" />} label="STF" no={c.stf?.stfNo} sub={c.stf ? `${STF_STATUS_META[c.stf.status].label} · ${c.stf.supplierName}` : undefined} missing={!c.stf} onClick={c.stf ? () => { setOpen(false); onOpenStf(c.stf!); } : undefined} />
                <ArrowRight className="h-3 w-3 text-slate-400" />
                {c.pos.length === 0 ? <Node icon={<ShoppingCart className="h-2.5 w-2.5" />} label="PO" missing sub="not issued yet" /> : c.pos.map(p => (
                  <Node key={p.id} icon={<ShoppingCart className="h-2.5 w-2.5" />} label="PO" no={p.poNo} sub={`${p.status.replace('_', ' ')} · ${p.supplierName}`} onClick={() => { setOpen(false); onOpenPo(p); }} />
                ))}
              </div>
              {(c.quote || c.files.length > 0) && (
                <div className="text-[11px] text-slate-700 flex flex-wrap items-center gap-x-3 gap-y-1">
                  {c.quote && <span><strong>{c.quote.supplierName}</strong>{c.quote.quoteRef ? ` · quote ${c.quote.quoteRef}` : ''}{c.quote.quoteDate ? ` · ${dateFmt(c.quote.quoteDate)}` : ''}{c.rfq && quoteLandedAed(c.rfq, c.quote) != null ? ` · AED ${money(quoteLandedAed(c.rfq, c.quote)!)} landed` : ''}</span>}
                  {c.files.map(a => <a key={a.id} href={a.url} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 text-primary-700 font-bold hover:underline"><FileText className="h-3 w-3" />{a.name}</a>)}
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
};
