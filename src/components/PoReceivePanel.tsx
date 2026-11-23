import React, { useMemo, useState } from 'react';
import { ShoppingCart, Loader2, AlertTriangle, CheckCircle2 } from 'lucide-react';
import type { IncomingMaterial, PurchaseOrder, Supplier } from '../types';
import { dbCreateIncomingMaterial } from '../lib/firebaseService';
import { OVER_RECEIPT_TOLERANCE, dateFmt, isReceivable, maxReceivable, poProgress, qtyFmt } from '../lib/procurement';

// Store → Incoming: type a PO number and the whole order appears — what was ordered, what has
// already arrived and what is still due. Enter what arrived today per line; each line becomes a
// normal goods receipt (it still goes to Quality first) tagged with the PO, so the Procurement
// portal sees the delivery straight away. A PO that is only partly delivered stays open.

interface Props {
  pos: PurchaseOrder[];
  incoming: IncomingMaterial[];
  suppliers: Supplier[];
  currentUserName: string;
  onReceived: () => void;
}

const STATUS_TEXT: Record<string, string> = {
  draft: 'is still a draft — it has not been issued yet.',
  pending_approval: 'is waiting for management approval, so it can’t be received yet.',
  closed: 'is closed.',
  cancelled: 'was cancelled.',
};

export const PoReceivePanel: React.FC<Props> = ({ pos, incoming, suppliers, currentUserName, onReceived }) => {
  const [poNo, setPoNo] = useState('');
  const [qtys, setQtys] = useState<Record<string, string>>({});
  const [doNo, setDoNo] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);

  const receivable = useMemo(() => pos.filter(isReceivable).sort((a, b) => b.poNo.localeCompare(a.poNo)), [pos]);
  const typed = poNo.trim().toLowerCase();
  const po = useMemo(() => (typed ? pos.find(p => p.poNo.toLowerCase() === typed) || null : null), [pos, typed]);
  const progress = useMemo(() => (po ? poProgress(po, incoming) : null), [po, incoming]);
  const ready = !!po && isReceivable(po);

  const reset = () => { setPoNo(''); setQtys({}); setDoNo(''); setError(null); };

  const submit = async () => {
    if (!po || !progress || busy) return;
    setError(null); setDone(null);
    const sup = suppliers.find(s => s.name.trim().toLowerCase() === po.supplierName.trim().toLowerCase());
    if (sup?.status === 'blocked') { setError(`${sup.name} is BLOCKED in the supplier list, so material can't be received from them.`); return; }
    if (sup?.status === 'on_hold' && !window.confirm(`${sup.name} is ON HOLD. Receive this delivery anyway?`)) return;

    const entries = progress.lines
      .map(lp => ({ lp, qty: Number(qtys[lp.line.id]) || 0 }))
      .filter(e => e.qty > 0);
    if (entries.length === 0) { setError('Enter the quantity that arrived for at least one item.'); return; }

    for (const { lp, qty } of entries) {
      if (qty > maxReceivable(lp) + 1e-9) {
        setError(`${lp.line.itemName}: ${qtyFmt(qty)} is more than ${Math.round(OVER_RECEIPT_TOLERANCE * 100)}% over what was ordered (still due: ${qtyFmt(lp.remaining)} ${lp.line.unit}). Check the delivery note with the supplier.`);
        return;
      }
    }
    const over = entries.filter(e => e.qty > e.lp.remaining + 1e-9);
    if (over.length && !window.confirm(`More than the remaining quantity was entered for: ${over.map(e => e.lp.line.itemName).join(', ')}.\n\nReceive anyway?`)) return;

    setBusy(true);
    let saved = 0;
    try {
      for (const { lp, qty } of entries) {
        await dbCreateIncomingMaterial({
          materialId: lp.line.materialId, materialName: '', unit: '', qty,
          supplier: po.supplierName, invoiceNo: null, doNo: doNo.trim() || null, notes: `Against ${po.poNo}`,
          receivedByName: currentUserName, receivedAt: new Date().toISOString(),
          poId: po.id, poNo: po.poNo, poLineId: lp.line.id,
        } as any);
        saved++;
      }
      setDone(`${saved} line(s) received against ${po.poNo} and sent to Quality.`);
      reset();
      onReceived();
    } catch (e: any) {
      setError(`${saved ? `${saved} line(s) were saved before the problem. ` : ''}${e?.message || 'Could not save the receipt.'} Check the table below before trying again.`);
      if (saved) onReceived();
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="bg-white border border-primary-200 rounded-xl p-4 mb-5" data-testid="po-receive-panel">
      <div className="flex flex-wrap items-center gap-2 mb-2">
        <ShoppingCart className="h-4 w-4 text-primary-600" />
        <div className="text-xs font-extrabold text-slate-900">Receive against a Purchase Order</div>
        <span className="text-[11px] text-slate-500">Type the PO number from the supplier’s paperwork — everything ordered fills in.</span>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <input
          value={poNo} onChange={e => { setPoNo(e.target.value); setQtys({}); setError(null); setDone(null); }}
          list="po-receivable-list" placeholder="MAT-PO-2026-0001" data-testid="receive-po-no"
          className="bg-slate-100 border border-slate-300 rounded-lg px-3 py-2 text-xs font-mono text-slate-900 w-64"
        />
        <datalist id="po-receivable-list">
          {receivable.map(p => <option key={p.id} value={p.poNo}>{p.supplierName}</option>)}
        </datalist>
        {poNo && <button onClick={reset} className="text-[11px] text-slate-500 hover:text-slate-800 cursor-pointer">Clear</button>}
        {receivable.length > 0 && !poNo && <span className="text-[11px] text-slate-500">{receivable.length} open PO(s) — start typing or pick from the list.</span>}
      </div>

      {done && <div className="mt-3 rounded-lg bg-emerald-50 border border-emerald-200 text-emerald-800 text-xs font-bold px-3 py-2 flex items-center gap-2" data-testid="receive-done"><CheckCircle2 className="h-4 w-4" />{done}</div>}

      {typed && !po && <div className="mt-3 text-xs text-amber-700" data-testid="receive-notfound">No purchase order with that number. Check the PO number or ask Procurement.</div>}
      {po && !ready && <div className="mt-3 text-xs text-amber-700" data-testid="receive-notready"><strong>{po.poNo}</strong> {STATUS_TEXT[po.status] || 'can’t be received.'}</div>}

      {po && ready && progress && (
        <div className="mt-3 space-y-3" data-testid="receive-lines">
          <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-slate-600">
            <span><strong className="text-slate-900">{po.supplierName}</strong></span>
            <span>Ordered {dateFmt(po.orderDate)}</span>
            {po.expectedDate && <span>Due {dateFmt(po.expectedDate)}</span>}
            {progress.anyReceived && <span className="text-violet-700 font-bold">Partly delivered — last delivery {dateFmt(progress.lastReceiptAt)}</span>}
            {progress.complete && <span className="text-emerald-700 font-bold">Everything ordered has already arrived</span>}
          </div>
          <div className="rounded-xl border border-slate-200 overflow-x-auto">
            <table className="w-full min-w-[620px] text-xs">
              <thead><tr className="bg-slate-100 text-slate-500 uppercase text-[10px]">
                <th className="text-left px-3 py-2">Item</th><th className="text-right px-2 py-2">Ordered</th><th className="text-right px-2 py-2">Received so far</th>
                <th className="text-right px-2 py-2">Still due</th><th className="text-right px-2 py-2 w-36">Arrived today</th>
              </tr></thead>
              <tbody>
                {progress.lines.map(lp => {
                  const v = Number(qtys[lp.line.id]) || 0;
                  return (
                    <tr key={lp.line.id} className="border-t border-slate-200">
                      <td className="px-3 py-2 font-semibold text-slate-800">{lp.line.itemName}</td>
                      <td className="px-2 py-2 text-right font-mono">{qtyFmt(lp.ordered)} {lp.line.unit}</td>
                      <td className="px-2 py-2 text-right font-mono text-emerald-700">{qtyFmt(lp.accepted)}{lp.rejected > 0 && <span className="block text-[10px] text-rose-700">{qtyFmt(lp.rejected)} rejected</span>}</td>
                      <td className={`px-2 py-2 text-right font-mono ${lp.remaining > 0 ? 'text-amber-700 font-bold' : 'text-slate-400'}`}>{qtyFmt(lp.remaining)}</td>
                      <td className="px-2 py-2">
                        <div className="flex items-center gap-1 justify-end">
                          <input type="number" min={0} step="any" value={qtys[lp.line.id] ?? ''} data-testid={`receive-qty-${lp.line.itemName}`}
                            onChange={e => setQtys(q => ({ ...q, [lp.line.id]: e.target.value }))}
                            className={`w-24 bg-slate-100 border rounded-lg px-2 py-1.5 text-xs text-right font-mono ${v > lp.remaining + 1e-9 ? 'border-amber-400' : 'border-slate-300'}`} />
                          {lp.remaining > 0 && <button type="button" onClick={() => setQtys(q => ({ ...q, [lp.line.id]: String(lp.remaining) }))} className="text-[10px] font-bold text-primary-700 hover:underline cursor-pointer" title="Everything still due arrived">all</button>}
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <input value={doNo} onChange={e => setDoNo(e.target.value)} placeholder="Supplier DO # (delivery note)" data-testid="receive-do"
              className="bg-slate-100 border border-slate-300 rounded-lg px-2 py-2 text-xs text-slate-900 w-64" />
            <button onClick={submit} disabled={busy} data-testid="receive-submit" className="flex items-center gap-1.5 px-4 py-2 bg-emerald-600 hover:bg-emerald-700 disabled:opacity-60 text-white rounded-lg text-xs font-bold cursor-pointer">
              {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <CheckCircle2 className="h-3.5 w-3.5" />} Receive &amp; send to Quality
            </button>
            <span className="text-[11px] text-slate-500">Leave a line empty if it didn’t come. The PO stays open until everything has arrived.</span>
          </div>
        </div>
      )}
      {error && <div className="mt-3 rounded-lg border border-rose-300 bg-rose-50 px-3 py-2 text-xs text-rose-700 flex items-start gap-2" data-testid="receive-error"><AlertTriangle className="h-4 w-4 shrink-0" />{error}</div>}
    </div>
  );
};
