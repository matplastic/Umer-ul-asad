import React, { useMemo, useState } from 'react';
import {
  X, Pencil, Send, CheckCircle2, Undo2, Ban, FileDown, Receipt, Wallet, Lock, Loader2, AlertTriangle, PackageCheck, Ban as BanIcon,
} from 'lucide-react';
import type { IncomingMaterial, PaymentMethod, PurchaseOrder, Rfq, Supplier, SupplierInvoice, SupplierPayment, TradeFinance } from '../types';
import { TF_STATUS_META, tfPosition, tfTypeLabel } from '../lib/tradeFinance';
import { Field, Modal, ProgressBar, StageBadge, QC_LABEL, btn, inputCls, todayStr } from './ProcurementUi';
import {
  dbAddSupplierInvoice, dbPoAction, dbRecordPayment, dbSetPaymentClearing, dbVoidPayment, dbVoidSupplierInvoice,
} from '../lib/firebaseService';
import {
  APPROVAL_THRESHOLD, canAutoClose, dateFmt, dueDateFor, parseTerms, expectedInvoiceAmount, invoiceMatch, money, poFinance, poProgress, poStage,
  poTotals, qtyFmt, daysUntil, type PoStage,
} from '../lib/procurement';
import { exportPurchaseOrderPdf } from '../lib/procurementPdf';
import { PoDeliveryDocs } from './PoDocsUi';

// Everything about ONE purchase order in one place: where it stands, what has arrived (and when),
// what is still owed, the supplier's invoices (3-way matched) and the payments made.

interface Props {
  po: PurchaseOrder;
  suppliers: Supplier[];
  incoming: IncomingMaterial[];
  invoices: SupplierInvoice[];
  payments: SupplierPayment[];
  rfqs: Rfq[];
  tradeFinances: TradeFinance[];
  currentUserName: string;
  canApprove: boolean;
  onNewTf: (po: PurchaseOrder) => void;
  onOpenTf: (id: string) => void;
  onClose: () => void;
  onChanged: () => Promise<void> | void;
  onEdit: (po: PurchaseOrder) => void;
  /** Click an item → open its product details (same popup as Store → Inventory). */
  onOpenMaterial?: (item: { materialId?: string | null; itemName: string; erpCode?: string | null }) => void;
}

type Dialog =
  | { kind: 'invoice' }
  | { kind: 'payment' }
  | { kind: 'reason'; action: 'cancel' | 'reject' | 'close_short' | 'void_invoice' | 'void_payment'; targetId?: string; label: string };

const NEXT_STEP: Record<PoStage, string> = {
  draft: 'Check the items and prices, then submit. POs above the approval limit go to management first.',
  awaiting_approval: 'Waiting for management to approve.',
  issued: 'Send the PO PDF to the supplier. The Store books the delivery by entering this PO number under Incoming.',
  partially_received: 'Still active — the supplier owes more. Stays open until everything ordered is received (or you close it short).',
  received: 'Everything ordered has arrived. Record the supplier’s invoice below, then pay it.',
  part_paid: 'Received in full. Keep paying until the invoice balance is zero.',
  paid: 'Received in full and fully paid. Close the PO to finish.',
  closed: 'This PO is complete.',
  closed_short: 'Closed before everything arrived.',
  cancelled: 'This PO was cancelled.',
};

const METHODS: { v: PaymentMethod; label: string }[] = [
  { v: 'bank_transfer', label: 'Bank transfer' }, { v: 'cheque', label: 'Cheque' }, { v: 'pdc', label: 'Post-dated cheque (PDC)' }, { v: 'cash', label: 'Cash' }, { v: 'card', label: 'Card' },
  { v: 'trade_finance', label: 'Paid by bank (trade finance)' },
];
// trade_finance payments are created by a trade-finance drawdown, never typed in by hand
const PICKABLE_METHODS = METHODS.filter(m => m.v !== 'trade_finance');

export const PoDetailPanel: React.FC<Props> = ({ po, suppliers, incoming, invoices, payments, rfqs, tradeFinances, currentUserName, canApprove, onNewTf, onOpenTf, onClose, onChanged, onEdit, onOpenMaterial }) => {
  const [dialog, setDialog] = useState<Dialog | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [flash, setFlash] = useState<string | null>(null);

  const progress = useMemo(() => poProgress(po, incoming), [po, incoming]);
  const fin = useMemo(() => poFinance(po, invoices, payments), [po, invoices, payments]);
  const stage = poStage(po, progress, fin);
  const totals = poTotals(po);
  const supplier = suppliers.find(s => s.name.trim().toLowerCase() === po.supplierName.trim().toLowerCase()) || null;
  const allInvoices = invoices.filter(i => i.poId === po.id).sort((a, b) => a.invoiceDate.localeCompare(b.invoiceDate));
  const allPayments = payments.filter(p => p.poId === po.id).sort((a, b) => a.paidAt.localeCompare(b.paidAt));
  const late = po.status === 'approved' && !progress.complete && po.expectedDate && daysUntil(po.expectedDate.slice(0, 10)) < 0;
  const expectedGross = expectedInvoiceAmount(po, progress);
  const expectedRemaining = Math.max(0, Math.round((expectedGross - fin.invoiced) * 100) / 100);

  const say = (m: string) => { setFlash(m); window.setTimeout(() => setFlash(null), 2500); };
  const run = async (fn: () => Promise<unknown>, ok?: string): Promise<boolean> => {
    setBusy(true); setError(null);
    try { await fn(); await onChanged(); if (ok) say(ok); return true; }
    catch (e: any) { setError(e?.message || 'Something went wrong.'); return false; }
    finally { setBusy(false); }
  };

  const action = (a: 'submit' | 'approve' | 'close', ok: string, opts: any = {}) =>
    run(() => dbPoAction(po.id, a, currentUserName, opts), ok);

  const cur = po.currency && po.currency !== 'AED' ? ` (${po.currency})` : '';
  const summary = [
    { label: `PO total${cur}`, value: money(totals.total), sub: `incl. VAT ${money(totals.vat)}` },
    { label: 'Received', value: `${Math.round(progress.pct)}%`, sub: `${progress.linesComplete} of ${progress.lines.length} items complete` },
    { label: 'Invoiced', value: money(fin.invoiced), sub: allInvoices.length ? `${allInvoices.filter(i => !i.voided).length} invoice(s)` : 'none yet' },
    { label: 'Paid', value: money(fin.paid), sub: fin.pdcIssued ? `+ PDC ${money(fin.pdcIssued)} issued` : fin.advance ? `incl. advance ${money(fin.advance)}` : ' ' },
    { label: 'Outstanding', value: money(fin.outstanding), sub: 'invoiced − paid', warn: fin.outstanding > 0 },
  ];

  return (
    <div className="fixed inset-0 z-40 flex justify-end bg-slate-900/40" onClick={onClose} data-testid="po-panel">
      <aside className="h-full w-full max-w-3xl bg-white border-l border-slate-300 shadow-2xl flex flex-col" onClick={e => e.stopPropagation()}>
        {/* header */}
        <div className="px-5 pt-4 pb-3 border-b border-slate-200">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <div className="text-[10px] uppercase font-bold text-slate-500 font-mono">{po.poNo}{po.stfNo ? ` · ${po.stfNo}` : ''}{po.rfqNo ? ` · ${po.rfqNo}` : ''}</div>
              <h2 className="text-base font-black text-slate-900 break-words">{po.supplierName}</h2>
              <div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-slate-600">
                <StageBadge stage={stage} />
                <span>Ordered {dateFmt(po.orderDate)}</span>
                {po.projectName && <span className="font-bold text-slate-700">· {po.projectType ? `${po.projectType} · ` : ''}{po.projectName}</span>}
                {po.expectedDate && <span className={late ? 'text-rose-700 font-bold' : ''}>· due {dateFmt(po.expectedDate)}{late ? ' (late)' : ''}</span>}
              </div>
            </div>
            <div className="flex items-center gap-1 shrink-0">
              <button onClick={() => exportPurchaseOrderPdf(po, supplier, stage)} className={btn.soft} data-testid="po-pdf" title="Download the PO as a PDF"><FileDown className="h-3.5 w-3.5" /> PDF</button>
              <button onClick={onClose} className="p-2 rounded-lg text-slate-500 hover:text-slate-900 hover:bg-slate-100 cursor-pointer" title="Close"><X className="h-4 w-4" /></button>
            </div>
          </div>
        </div>

        <div className="flex-1 overflow-y-auto px-5 py-4 space-y-5">
          {flash && <div className="rounded-lg bg-emerald-50 border border-emerald-200 text-emerald-800 text-xs font-bold px-3 py-2" data-testid="po-flash">{flash}</div>}
          {error && <div className="rounded-lg border border-rose-300 bg-rose-50 px-3 py-2 text-xs text-rose-700 flex items-start gap-2" data-testid="po-panel-error"><AlertTriangle className="h-4 w-4 shrink-0" />{error}</div>}

          {/* summary */}
          <div className="grid grid-cols-2 sm:grid-cols-5 gap-2">
            {summary.map(s => (
              <div key={s.label} className="rounded-xl border border-slate-200 p-2.5">
                <div className="text-[10px] uppercase font-bold text-slate-500">{s.label}</div>
                <div className={`text-sm font-black font-mono ${(s as any).warn ? 'text-rose-700' : 'text-slate-900'}`}>{s.value}</div>
                <div className="text-[10px] text-slate-500 truncate">{s.sub}</div>
              </div>
            ))}
          </div>

          {/* where we are + what to do */}
          <div className="rounded-xl border border-primary-200 bg-primary-50/40 p-3">
            <div className="text-xs text-slate-700">{NEXT_STEP[stage]}</div>
            {po.rejectedNote && po.status === 'draft' && <div className="text-xs text-amber-800 mt-1"><strong>Sent back:</strong> {po.rejectedNote}</div>}
            <div className="mt-2 flex flex-wrap gap-2">
              {po.status === 'draft' && <>
                <button onClick={() => onEdit(po)} className={btn.soft} data-testid="po-edit"><Pencil className="h-3.5 w-3.5" /> Edit</button>
                <button onClick={() => action('submit', totals.total > APPROVAL_THRESHOLD ? 'Sent to management for approval.' : 'PO issued.')} disabled={busy} className={btn.primary} data-testid="po-do-submit">
                  <Send className="h-3.5 w-3.5" /> {totals.total > APPROVAL_THRESHOLD ? 'Submit for approval' : 'Issue PO'}
                </button>
                <button onClick={() => setDialog({ kind: 'reason', action: 'cancel', label: 'Cancel this PO' })} className={btn.danger}><Ban className="h-3.5 w-3.5" /> Cancel PO</button>
              </>}
              {po.status === 'pending_approval' && (canApprove ? <>
                <button onClick={() => action('approve', 'PO approved and issued.')} disabled={busy} className={btn.green} data-testid="po-approve"><CheckCircle2 className="h-3.5 w-3.5" /> Approve</button>
                <button onClick={() => setDialog({ kind: 'reason', action: 'reject', label: 'Send back to Procurement' })} className={btn.amber}><Undo2 className="h-3.5 w-3.5" /> Send back</button>
                <button onClick={() => setDialog({ kind: 'reason', action: 'cancel', label: 'Cancel this PO' })} className={btn.danger}><Ban className="h-3.5 w-3.5" /> Cancel PO</button>
              </> : <>
                <span className="text-xs text-slate-500 flex items-center gap-1"><Lock className="h-3.5 w-3.5" /> Only management can approve.</span>
                <button onClick={() => setDialog({ kind: 'reason', action: 'cancel', label: 'Cancel this PO' })} className={btn.danger}><Ban className="h-3.5 w-3.5" /> Cancel PO</button>
              </>)}
              {po.status === 'approved' && <>
                {expectedRemaining > 0 && <button onClick={() => { setError(null); setDialog({ kind: 'invoice' }); }} className={btn.primary} data-testid="po-add-invoice"><Receipt className="h-3.5 w-3.5" /> Record invoice</button>}
                <button onClick={() => { setError(null); setDialog({ kind: 'payment' }); }} className={btn.green} data-testid="po-add-payment"><Wallet className="h-3.5 w-3.5" /> Record payment</button>
                {stage === 'paid' && <button onClick={() => action('close', 'PO closed.', { closedReason: 'completed' })} disabled={busy} className={btn.primary} data-testid="po-close"><Lock className="h-3.5 w-3.5" /> Close PO</button>}
                {!progress.complete && progress.anyReceived && <button onClick={() => setDialog({ kind: 'reason', action: 'close_short', label: 'Close the PO short' })} className={btn.amber}><Lock className="h-3.5 w-3.5" /> Close short</button>}
                {!progress.anyReceived && allPayments.filter(p => !p.voided).length === 0 && <button onClick={() => setDialog({ kind: 'reason', action: 'cancel', label: 'Cancel this PO' })} className={btn.danger}><Ban className="h-3.5 w-3.5" /> Cancel PO</button>}
              </>}
            </div>
          </div>

          {/* receiving */}
          {/* payment plan from the terms */}
          {po.paymentTerms && (() => {
            const tm = parseTerms(po.paymentTerms);
            const adv = Math.round(totals.total * tm.advancePct) / 100;
            const bal = Math.round((totals.total - adv) * 100) / 100;
            const advPaid = fin.advance + fin.pdcIssued >= adv - 0.01 && adv > 0;
            return (
              <section className="rounded-xl border border-slate-200 p-3 text-xs space-y-1" data-testid="po-payment-plan">
                <div className="text-[10px] uppercase font-bold text-slate-500">Payment plan — {po.paymentTerms.replace(/\s*\n\s*/g, ' · ')}</div>
                {tm.advancePct > 0 && <div><strong>Advance {tm.advancePct}%</strong> = {po.currency} {money(adv)} — <span className={advPaid ? 'text-emerald-700 font-bold' : 'text-amber-700 font-bold'}>{advPaid ? 'arranged / paid' : 'due when the PO is issued'}</span></div>}
                {bal > 0.005 && <div><strong>Balance</strong> {po.currency} {money(bal)} — {tm.creditDays != null && tm.creditDays > 0 ? `${tm.creditDays} days after the invoice` : 'on delivery'}{tm.viaPdc ? ', by post-dated cheque (PDC)' : ''}</div>}
              </section>
            );
          })()}

          <section>
            <h3 className="text-xs font-extrabold text-slate-900 mb-2 flex items-center gap-1.5"><PackageCheck className="h-4 w-4 text-violet-600" /> Receiving — ordered vs delivered</h3>
            <div className="rounded-xl border border-slate-200 overflow-x-auto">
              <table className="w-full min-w-[560px] text-xs">
                <thead><tr className="bg-slate-100 text-slate-500 uppercase text-[10px]">
                  <th className="text-left px-2 py-2">Item</th><th className="text-right px-2 py-2">Ordered</th><th className="text-right px-2 py-2">Received</th>
                  <th className="text-right px-2 py-2">Rejected</th><th className="text-right px-2 py-2">Remaining</th><th className="px-2 py-2 w-28">Progress</th>
                </tr></thead>
                <tbody>
                  {progress.lines.map(lp => (
                    <tr key={lp.line.id} className="border-t border-slate-200">
                      <td className="px-2 py-2 font-semibold text-slate-800">{onOpenMaterial ? <button type="button" onClick={() => onOpenMaterial({ materialId: lp.line.materialId, itemName: lp.line.itemName, erpCode: lp.line.erpCode })} data-testid={`po-line-item-${lp.line.id}`} title="Open product details" className="text-left font-semibold text-primary-700 hover:text-primary-800 hover:underline cursor-pointer">{lp.line.itemName}</button> : lp.line.itemName}<div className="text-[10px] font-normal text-slate-500">@ {money(lp.line.unitPrice)} / {lp.line.unit}</div></td>
                      <td className="px-2 py-2 text-right font-mono">{qtyFmt(lp.ordered)} {lp.line.unit}</td>
                      <td className="px-2 py-2 text-right font-mono text-emerald-700">{qtyFmt(lp.received)}</td>
                      <td className={`px-2 py-2 text-right font-mono ${lp.rejected ? 'text-rose-700 font-bold' : 'text-slate-400'}`}>{qtyFmt(lp.rejected)}</td>
                      <td className={`px-2 py-2 text-right font-mono ${lp.remaining > 0 ? 'text-amber-700 font-bold' : 'text-slate-400'}`}>{qtyFmt(lp.remaining)}</td>
                      <td className="px-2 py-2"><ProgressBar pct={lp.pct} tone={lp.remaining > 0 ? 'violet' : 'emerald'} /><div className="text-[10px] text-slate-500 text-right">{Math.round(lp.pct)}%</div></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {progress.receipts.length > 0 && (
              <div className="mt-4">
                <div className="text-[11px] font-bold uppercase text-slate-500 mb-1">Supplier DO / invoice per delivery</div>
                <PoDeliveryDocs po={po} incoming={incoming} currentUserName={currentUserName} onChanged={onChanged} />
              </div>
            )}
            <div className="mt-3 text-[11px] font-bold uppercase text-slate-500">Delivery history</div>
            {progress.receipts.length === 0 ? (
              <div className="text-xs text-slate-500 mt-1">Nothing received yet.{po.status === 'approved' ? ` Tell the Store to use PO number ${po.poNo} under Incoming.` : ''}</div>
            ) : (
              <div className="mt-1 rounded-xl border border-slate-200 overflow-x-auto">
                <table className="w-full min-w-[560px] text-xs">
                  <thead><tr className="bg-slate-50 text-slate-500 uppercase text-[10px]">
                    <th className="text-left px-2 py-1.5">Date</th><th className="text-left px-2 py-1.5">Item</th><th className="text-right px-2 py-1.5">Qty</th>
                    <th className="text-left px-2 py-1.5">Supplier DO</th><th className="text-left px-2 py-1.5">Quality</th><th className="text-left px-2 py-1.5">Received by</th>
                  </tr></thead>
                  <tbody>
                    {progress.receipts.map(r => {
                      const q = QC_LABEL[r.qcStatus] || QC_LABEL.pending;
                      return (
                        <tr key={r.id} className="border-t border-slate-100">
                          <td className="px-2 py-1.5 whitespace-nowrap">{dateFmt(r.receivedAt || r.createdAt)}</td>
                          <td className="px-2 py-1.5">{onOpenMaterial ? <button type="button" onClick={() => onOpenMaterial({ materialId: r.materialId, itemName: r.materialName, erpCode: null })} data-testid={`po-receipt-item-${r.id}`} title="Open product details" className="text-left font-semibold text-primary-700 hover:text-primary-800 hover:underline cursor-pointer">{r.materialName}</button> : r.materialName}</td>
                          <td className="px-2 py-1.5 text-right font-mono">{qtyFmt(r.qty)} {r.unit}</td>
                          <td className="px-2 py-1.5 font-mono">{r.doNo || '—'}</td>
                          <td className={`px-2 py-1.5 font-bold ${q.cls}`}>{q.label}{(r.qtyFailed || 0) > 0 ? ` (${qtyFmt(r.qtyFailed || 0)} rejected)` : ''}</td>
                          <td className="px-2 py-1.5">{r.receivedByName}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </section>

          {/* invoices */}
          <section>
            <h3 className="text-xs font-extrabold text-slate-900 mb-2 flex items-center gap-1.5"><Receipt className="h-4 w-4 text-sky-600" /> Supplier invoices (3-way match)</h3>
            {allInvoices.length === 0 ? <div className="text-xs text-slate-500">No invoice recorded yet.</div> : (
              <div className="rounded-xl border border-slate-200 overflow-x-auto">
                <table className="w-full min-w-[560px] text-xs">
                  <thead><tr className="bg-slate-100 text-slate-500 uppercase text-[10px]">
                    <th className="text-left px-2 py-2">Invoice</th><th className="text-left px-2 py-2">Date</th><th className="text-left px-2 py-2">Due</th>
                    <th className="text-right px-2 py-2">Amount</th><th className="text-left px-2 py-2">Match</th><th className="w-8" />
                  </tr></thead>
                  <tbody>
                    {allInvoices.map(i => {
                      const dd = daysUntil(i.dueDate);
                      return (
                        <tr key={i.id} className={`border-t border-slate-200 ${i.voided ? 'opacity-50 line-through' : ''}`}>
                          <td className="px-2 py-2 font-mono font-semibold">{i.invoiceNo}</td>
                          <td className="px-2 py-2 whitespace-nowrap">{dateFmt(i.invoiceDate)}</td>
                          <td className={`px-2 py-2 whitespace-nowrap ${!i.voided && dd < 0 && fin.outstanding > 0 ? 'text-rose-700 font-bold' : ''}`}>{dateFmt(i.dueDate)}</td>
                          <td className="px-2 py-2 text-right font-mono">{money(i.amount)}</td>
                          <td className="px-2 py-2">
                            {i.voided ? <span className="text-slate-500">Voided</span>
                              : i.matchStatus === 'matched' ? <span className="text-emerald-700 font-bold">✓ Matched</span>
                              : <span className="text-amber-700 font-bold" title={i.overrideNotes || ''}>Variance {i.variance > 0 ? '+' : ''}{money(i.variance)}</span>}
                          </td>
                          <td className="px-1">{!i.voided && <button onClick={() => setDialog({ kind: 'reason', action: 'void_invoice', targetId: i.id, label: `Void invoice ${i.invoiceNo}` })} className="text-slate-400 hover:text-rose-600 cursor-pointer" title="Void"><BanIcon className="h-3.5 w-3.5" /></button>}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </section>

          {/* payments */}
          <section>
            <h3 className="text-xs font-extrabold text-slate-900 mb-2 flex items-center gap-1.5"><Wallet className="h-4 w-4 text-emerald-600" /> Payments</h3>
            {allPayments.length === 0 ? <div className="text-xs text-slate-500">No payment recorded yet.</div> : (
              <div className="rounded-xl border border-slate-200 overflow-x-auto">
                <table className="w-full min-w-[520px] text-xs">
                  <thead><tr className="bg-slate-100 text-slate-500 uppercase text-[10px]">
                    <th className="text-left px-2 py-2">Date</th><th className="text-left px-2 py-2">Type</th><th className="text-left px-2 py-2">Method / ref.</th>
                    <th className="text-right px-2 py-2">Amount</th><th className="text-left px-2 py-2">By</th><th className="w-8" />
                  </tr></thead>
                  <tbody>
                    {allPayments.map(p => (
                      <tr key={p.id} className={`border-t border-slate-200 ${p.voided ? 'opacity-50 line-through' : ''}`}>
                        <td className="px-2 py-2 whitespace-nowrap">{dateFmt(p.paidAt)}</td>
                        <td className="px-2 py-2">{p.kind === 'advance' ? 'Advance' : 'Invoice payment'}</td>
                        <td className="px-2 py-2">{METHODS.find(m => m.v === p.method)?.label}{p.reference ? ` · ${p.reference}` : ''}
                          {p.method === 'pdc' && <div className="text-[10px] mt-0.5">cheque date {dateFmt(p.chequeDate)} · <span className={p.clearStatus === 'cleared' ? 'text-emerald-700 font-bold' : p.clearStatus === 'bounced' ? 'text-rose-700 font-bold' : 'text-amber-700 font-bold'}>{(p.clearStatus || 'issued').toUpperCase()}</span></div>}</td>
                        <td className="px-2 py-2 text-right font-mono">{money(p.amount)}</td>
                        <td className="px-2 py-2">{p.byName}</td>
                        <td className="px-1 whitespace-nowrap">
                          {!p.voided && p.method === 'pdc' && p.clearStatus === 'issued' && <>
                            <button onClick={() => run(() => dbSetPaymentClearing(p.id, 'cleared', currentUserName), 'Cheque marked as cleared.')} className="text-[10px] font-bold text-emerald-700 hover:underline cursor-pointer mr-1" data-testid={`pdc-clear-${p.id}`}>Cleared</button>
                            <button onClick={() => run(() => dbSetPaymentClearing(p.id, 'bounced', currentUserName), 'Cheque marked as bounced.')} className="text-[10px] font-bold text-rose-700 hover:underline cursor-pointer mr-1">Bounced</button>
                          </>}
                          {!p.voided && <button onClick={() => setDialog({ kind: 'reason', action: 'void_payment', targetId: p.id, label: `Void payment of ${po.currency || 'AED'} ${money(p.amount)}` })} className="text-slate-400 hover:text-rose-600 cursor-pointer" title="Void"><BanIcon className="h-3.5 w-3.5" /></button>}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>

          {/* quotation this PO came from */}
          {(() => {
            const rfq = po.rfqId ? rfqs.find(r => r.id === po.rfqId) : null;
            const win = rfq?.quotes.find(q => q.id === rfq.awardedQuoteId);
            if (!rfq) return null;
            return (
              <section className="rounded-xl border border-slate-200 p-3 text-xs">
                <div className="text-[10px] uppercase font-bold text-slate-500 mb-1">Chosen from quotations</div>
                <div><span className="font-mono font-bold">{rfq.rfqNo}</span> · {rfq.title}{win ? <> — awarded to <strong>{win.supplierName}</strong>{win.quoteRef ? ` (their quote ${win.quoteRef})` : ''}</> : ''}</div>
                {rfq.awardNotes && <div className="text-slate-600 mt-0.5">Why: {rfq.awardNotes}</div>}
                {(win?.attachments || []).length > 0 && <div className="mt-1 flex flex-wrap gap-2">{win!.attachments!.map(a => <a key={a.id} href={a.url} target="_blank" rel="noopener noreferrer" className="text-primary-700 font-bold hover:underline">{a.name}</a>)}</div>}
              </section>
            );
          })()}

          {/* bank financing */}
          <section>
            <h3 className="text-xs font-extrabold text-slate-900 mb-2 flex items-center gap-1.5">Bank finance (trade finance)</h3>
            {(() => {
              const mine = tradeFinances.filter(t => t.poId === po.id && t.status !== 'cancelled');
              return (
                <div className="space-y-1.5">
                  {mine.length === 0 && <div className="text-xs text-slate-500">Not financed. Use trade finance when a bank (LC, trust receipt, import loan…) pays the supplier and you repay the bank later.</div>}
                  {mine.map(t => { const p = tfPosition(t); return (
                    <button key={t.id} onClick={() => onOpenTf(t.id)} className="w-full text-left rounded-xl border border-slate-200 hover:border-primary-400 px-3 py-2 text-xs cursor-pointer flex flex-wrap items-center gap-x-3 gap-y-1">
                      <span className="font-mono font-bold">{t.tfNo}</span><span>{t.bankName} · {tfTypeLabel(t.type)}</span>
                      <span className={`px-2 py-0.5 rounded-full text-[10px] font-black uppercase border ${TF_STATUS_META[t.status].cls}`}>{TF_STATUS_META[t.status].label}</span>
                      <span className="ml-auto font-mono">owed {money(p.outstanding)}{p.maturity && t.status === 'drawn' ? ` · due ${dateFmt(p.maturity)}` : ''}</span>
                    </button>
                  ); })}
                  {po.status === 'approved' && <button onClick={() => onNewTf(po)} className={btn.soft} data-testid="po-new-stf">+ Finance this PO with trade finance</button>}
                </div>
              );
            })()}
          </section>

          {/* paperwork + trail */}
          <section className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-xs">
            <div className="rounded-xl border border-slate-200 p-3 space-y-1">
              <div className="text-[10px] uppercase font-bold text-slate-500 mb-1">Order terms</div>
              <div><span className="text-slate-500">Payment terms:</span> {po.paymentTerms || '—'}</div>
              <div><span className="text-slate-500">Deliver to:</span> {po.deliveryLocation || '—'}</div>
              <div><span className="text-slate-500">Subtotal / VAT:</span> {money(totals.subtotal)}{totals.discount ? ` − ${money(totals.discount)} disc.` : ''} + {money(totals.vat)}</div>
              {po.notes && <div className="pt-1 text-slate-700 whitespace-pre-wrap">{po.notes}</div>}
            </div>
            <div className="rounded-xl border border-slate-200 p-3 space-y-1">
              <div className="text-[10px] uppercase font-bold text-slate-500 mb-1">Audit trail</div>
              <div>Created by {po.createdByName} · {dateFmt(po.createdAt)}</div>
              {po.submittedAt && <div>Submitted · {dateFmt(po.submittedAt)}</div>}
              {po.approvedAt && <div>Approved by {po.approvedByName} · {dateFmt(po.approvedAt)}</div>}
              {po.cancelledAt && <div className="text-rose-700">Cancelled by {po.cancelledByName} · {dateFmt(po.cancelledAt)} — {po.cancelReason}</div>}
              {po.closedAt && <div>Closed by {po.closedByName} · {dateFmt(po.closedAt)}{po.closedReason === 'short_closed' ? ' (short)' : ''}{po.closeNotes ? ` — ${po.closeNotes}` : ''}</div>}
            </div>
          </section>
        </div>
      </aside>

      {dialog?.kind === 'invoice' && (
        <InvoiceDialog
          po={po} fin={fin} expectedRemaining={expectedRemaining} expectedGross={expectedGross}
          onClose={() => setDialog(null)}
          onSave={async (v) => {
            const m = invoiceMatch(v.amount, expectedRemaining);
            const ok = await run(() => dbAddSupplierInvoice({
              poId: po.id, poNo: po.poNo, supplierName: po.supplierName, invoiceNo: v.invoiceNo.trim(), invoiceDate: v.invoiceDate, dueDate: v.dueDate,
              amount: v.amount, expectedAmount: expectedRemaining, variance: m.variance,
              matchStatus: m.status === 'matched' ? 'matched' : 'overridden', overrideNotes: m.status === 'matched' ? null : v.overrideNotes.trim(), notes: v.notes.trim() || null,
            }, currentUserName), 'Invoice recorded.');
            if (ok) setDialog(null);
          }}
          busy={busy} error={error} terms={po.paymentTerms || supplier?.paymentTerms || null}
        />
      )}

      {dialog?.kind === 'payment' && (
        <PaymentDialog
          po={po} fin={fin} progressComplete={progress.complete} busy={busy} error={error}
          onClose={() => setDialog(null)}
          onSave={async (v) => {
            const ok = await run(async () => {
              await dbRecordPayment({
                poId: po.id, poNo: po.poNo, supplierName: po.supplierName, invoiceId: v.invoiceId || null, kind: v.invoiceId ? 'invoice' : 'advance',
                amount: v.amount, paidAt: v.paidAt, method: v.method, chequeDate: v.method === 'pdc' ? v.chequeDate : null, reference: v.reference.trim() || null, notes: v.notes.trim() || null,
              }, currentUserName, fin.payCap);
              // fully received + fully invoiced + fully paid → finish the PO automatically
              if (canAutoClose(po, progress, { invoiced: fin.invoiced, paid: fin.paid + v.amount })) {
                await dbPoAction(po.id, 'close', currentUserName, { closedReason: 'completed', notes: 'Received in full and fully paid.' });
              }
            }, 'Payment recorded.');
            if (ok) setDialog(null);
          }}
        />
      )}

      {dialog?.kind === 'reason' && (
        <ReasonDialog
          label={dialog.label} busy={busy} error={error} onClose={() => setDialog(null)}
          onConfirm={async (reason) => {
            const ok = await run(async () => {
              if (dialog.action === 'cancel') await dbPoAction(po.id, 'cancel', currentUserName, { notes: reason });
              else if (dialog.action === 'reject') await dbPoAction(po.id, 'reject', currentUserName, { notes: reason });
              else if (dialog.action === 'close_short') await dbPoAction(po.id, 'close', currentUserName, { closedReason: 'short_closed', notes: reason });
              else if (dialog.action === 'void_invoice') await dbVoidSupplierInvoice(dialog.targetId!, currentUserName, reason);
              else if (dialog.action === 'void_payment') await dbVoidPayment(dialog.targetId!, currentUserName, reason);
            }, 'Done.');
            if (ok) setDialog(null);
          }}
        />
      )}
    </div>
  );
};

// ── dialogs ──────────────────────────────────────────────────────────────────
export const ErrorLine: React.FC<{ error: string | null }> = ({ error }) => error
  ? <div className="rounded-lg border border-rose-300 bg-rose-50 px-3 py-2 text-xs text-rose-700 flex items-start gap-2"><AlertTriangle className="h-4 w-4 shrink-0" />{error}</div> : null;

export const ReasonDialog: React.FC<{ label: string; busy: boolean; error: string | null; onClose: () => void; onConfirm: (reason: string) => void }> = ({ label, busy, error, onClose, onConfirm }) => {
  const [reason, setReason] = useState('');
  return (
    <Modal title={label} onClose={onClose} width="max-w-md" z="z-[70]" footer={<>
      <button onClick={onClose} className={btn.soft}>Back</button>
      <button onClick={() => onConfirm(reason)} disabled={busy || !reason.trim()} className={btn.danger} data-testid="reason-confirm">
        {busy && <Loader2 className="h-3.5 w-3.5 animate-spin" />} Confirm
      </button>
    </>}>
      <div className="space-y-3">
        <Field label="Reason (kept in the record)"><textarea rows={3} value={reason} onChange={e => setReason(e.target.value)} className={`${inputCls} resize-y`} autoFocus data-testid="reason-text" /></Field>
        <ErrorLine error={error} />
      </div>
    </Modal>
  );
};

const InvoiceDialog: React.FC<{
  po: PurchaseOrder; fin: ReturnType<typeof poFinance>; expectedRemaining: number; expectedGross: number;
  terms: string | null; busy: boolean; error: string | null; onClose: () => void;
  onSave: (v: { invoiceNo: string; invoiceDate: string; dueDate: string; amount: number; notes: string; overrideNotes: string }) => void;
}> = ({ po, expectedRemaining, expectedGross, fin, terms, busy, error, onClose, onSave }) => {
  const [invoiceNo, setInvoiceNo] = useState('');
  const [invoiceDate, setInvoiceDate] = useState(todayStr());
  const [dueDate, setDueDate] = useState(dueDateFor(todayStr(), terms));
  const [dueTouched, setDueTouched] = useState(false);
  const [amount, setAmount] = useState(expectedRemaining ? String(expectedRemaining) : '');
  const [notes, setNotes] = useState('');
  const [override, setOverride] = useState('');
  const amt = Number(amount) || 0;
  const m = invoiceMatch(amt, expectedRemaining);
  const needsReason = amt > 0 && m.status === 'mismatch';
  return (
    <Modal title="Record supplier invoice" subtitle={`${po.poNo} · ${po.supplierName}`} onClose={onClose} width="max-w-lg" z="z-[70]" footer={<>
      <button onClick={onClose} className={btn.soft}>Cancel</button>
      <button onClick={() => onSave({ invoiceNo, invoiceDate, dueDate, amount: amt, notes, overrideNotes: override })}
        disabled={busy || !invoiceNo.trim() || !(amt > 0) || (needsReason && !override.trim())} className={btn.primary} data-testid="invoice-save">
        {busy && <Loader2 className="h-3.5 w-3.5 animate-spin" />} Save invoice
      </button>
    </>}>
      <div className="space-y-3">
        <div className="grid grid-cols-2 gap-3">
          <Field label="Supplier invoice no. *"><input value={invoiceNo} onChange={e => setInvoiceNo(e.target.value)} className={inputCls} data-testid="invoice-no" /></Field>
          <Field label="Invoice amount incl. VAT (AED) *"><input type="number" min={0} step="any" value={amount} onChange={e => setAmount(e.target.value)} className={`${inputCls} font-mono`} data-testid="invoice-amount" /></Field>
          <Field label="Invoice date"><input type="date" value={invoiceDate} onChange={e => { setInvoiceDate(e.target.value); if (!dueTouched) setDueDate(dueDateFor(e.target.value, terms)); }} className={inputCls} /></Field>
          <Field label={`Due date${terms ? ` (${terms})` : ''}`}><input type="date" value={dueDate} onChange={e => { setDueDate(e.target.value); setDueTouched(true); }} className={inputCls} /></Field>
        </div>
        <div className={`rounded-xl border p-3 text-xs space-y-1 ${amt > 0 ? (m.status === 'matched' ? 'border-emerald-300 bg-emerald-50' : 'border-amber-300 bg-amber-50') : 'border-slate-200 bg-slate-50'}`}>
          <div className="font-bold text-slate-800">3-way match: PO ↔ goods received ↔ invoice</div>
          <div className="flex justify-between"><span className="text-slate-600">Accepted goods at PO prices (incl. VAT)</span><span className="font-mono">{money(expectedGross)}</span></div>
          <div className="flex justify-between"><span className="text-slate-600">Already invoiced</span><span className="font-mono">− {money(fin.invoiced)}</span></div>
          <div className="flex justify-between font-bold"><span>Expected on this invoice</span><span className="font-mono">{money(expectedRemaining)}</span></div>
          {amt > 0 && <div className={`font-bold ${m.status === 'matched' ? 'text-emerald-700' : 'text-amber-800'}`}>
            {m.status === 'matched' ? '✓ Matches within tolerance' : `Variance ${m.variance > 0 ? '+' : ''}${money(m.variance)} AED — ${m.variance > 0 ? 'supplier is charging more than received' : 'supplier is charging less than received'}`}
          </div>}
        </div>
        {needsReason && <Field label="Why accept this variance? *"><textarea rows={2} value={override} onChange={e => setOverride(e.target.value)} placeholder="e.g. freight added, agreed price change…" className={`${inputCls} resize-y`} data-testid="invoice-override" /></Field>}
        <Field label="Notes"><input value={notes} onChange={e => setNotes(e.target.value)} className={inputCls} /></Field>
        <ErrorLine error={error} />
      </div>
    </Modal>
  );
};

const PaymentDialog: React.FC<{
  po: PurchaseOrder; fin: ReturnType<typeof poFinance>; progressComplete: boolean; busy: boolean; error: string | null; onClose: () => void;
  onSave: (v: { invoiceId: string; amount: number; paidAt: string; method: PaymentMethod; chequeDate: string; reference: string; notes: string }) => void;
}> = ({ po, fin, progressComplete, busy, error, onClose, onSave }) => {
  const openInvoices = fin.invoices;
  const [invoiceId, setInvoiceId] = useState(openInvoices.length ? openInvoices[openInvoices.length - 1].id : '');
  const [amount, setAmount] = useState(fin.outstanding > 0 ? String(fin.outstanding) : '');
  const [paidAt, setPaidAt] = useState(todayStr());
  const [method, setMethod] = useState<PaymentMethod>(parseTerms(po.paymentTerms).viaPdc ? 'pdc' : 'bank_transfer');
  const [chequeDate, setChequeDate] = useState(dueDateFor(todayStr(), po.paymentTerms));
  const [reference, setReference] = useState('');
  const [notes, setNotes] = useState('');
  const amt = Number(amount) || 0;
  const room = Math.max(0, Math.round((fin.payCap - fin.paid) * 100) / 100);
  const advance = !invoiceId;
  // against an invoice you can pay at most what is still owed on it; an advance is limited by the PO cap
  const limit = advance ? room : Math.min(room, fin.outstanding);
  return (
    <Modal title="Record payment" subtitle={`${po.poNo} · ${po.supplierName}`} onClose={onClose} width="max-w-lg" z="z-[70]" footer={<>
      <button onClick={onClose} className={btn.soft}>Cancel</button>
      <button onClick={() => onSave({ invoiceId, amount: amt, paidAt, method, chequeDate, reference, notes })} disabled={busy || !(amt > 0) || amt > limit + 0.005 || (method === 'pdc' && !chequeDate)} className={btn.green} data-testid="payment-save">
        {busy && <Loader2 className="h-3.5 w-3.5 animate-spin" />} Save payment
      </button>
    </>}>
      <div className="space-y-3">
        <div className="grid grid-cols-3 gap-2 text-xs">
          <div className="rounded-lg border border-slate-200 p-2"><div className="text-[10px] uppercase text-slate-500 font-bold">Invoiced</div><div className="font-mono font-bold">{money(fin.invoiced)}</div></div>
          <div className="rounded-lg border border-slate-200 p-2"><div className="text-[10px] uppercase text-slate-500 font-bold">Paid</div><div className="font-mono font-bold">{money(fin.paid)}</div></div>
          <div className="rounded-lg border border-slate-200 p-2"><div className="text-[10px] uppercase text-slate-500 font-bold">Outstanding</div><div className="font-mono font-bold text-rose-700">{money(fin.outstanding)}</div></div>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Pay against" className="col-span-2">
            <select value={invoiceId} onChange={e => { setInvoiceId(e.target.value); if (e.target.value) setAmount(fin.outstanding ? String(fin.outstanding) : ''); }} className={inputCls} data-testid="payment-invoice">
              {openInvoices.map(i => <option key={i.id} value={i.id}>Invoice {i.invoiceNo} — AED {money(i.amount)}</option>)}
              <option value="">Advance payment (no invoice yet)</option>
            </select>
            {advance && !progressComplete && <div className="text-[11px] text-slate-500 mt-1">Advance payments are limited to the PO total (AED {money(fin.poTotal)}).</div>}
          </Field>
          <Field label="Amount (AED) *"><input type="number" min={0} step="any" value={amount} onChange={e => setAmount(e.target.value)} className={`${inputCls} font-mono`} data-testid="payment-amount" />
            {amt > limit + 0.005 && <div className="text-[11px] text-rose-700 mt-1">Most that can still be paid here: {money(limit)}</div>}
          </Field>
          <Field label="Payment date"><input type="date" value={paidAt} onChange={e => setPaidAt(e.target.value)} className={inputCls} /></Field>
          <Field label="Method"><select value={method} onChange={e => setMethod(e.target.value as PaymentMethod)} className={inputCls}>{PICKABLE_METHODS.map(m => <option key={m.v} value={m.v}>{m.label}</option>)}</select></Field>
          {method === 'pdc' && <Field label="Cheque date (when it can be cashed) *"><input type="date" value={chequeDate} onChange={e => setChequeDate(e.target.value)} className={inputCls} data-testid="payment-cheque-date" /></Field>}
          <Field label={method === 'cheque' || method === 'pdc' ? 'Cheque no.' : 'Reference'}><input value={reference} onChange={e => setReference(e.target.value)} className={inputCls} /></Field>
          {method === 'pdc' && <div className="col-span-2 text-[11px] text-slate-500">A post-dated cheque counts as <strong>arranged</strong>, not paid. Mark it as cleared once the bank has cashed it.</div>}
          <Field label="Notes" className="col-span-2"><input value={notes} onChange={e => setNotes(e.target.value)} className={inputCls} /></Field>
        </div>
        <ErrorLine error={error} />
      </div>
    </Modal>
  );
};
