import React, { useMemo, useState } from 'react';
import {
  X, Pencil, Send, CheckCircle2, Banknote, Wallet, Ban, Loader2, AlertTriangle, Landmark, CalendarClock, ShoppingCart, Paperclip,
} from 'lucide-react';
import type { PurchaseOrder, SupplierInvoice, SupplierPayment, TradeFinance } from '../types';
import { Field, Modal, btn, inputCls, todayStr } from './ProcurementUi';
import { AttachmentList } from './AttachmentList';
import { ErrorLine, ReasonDialog } from './PoDetailPanel';
import {
  dbAddTfRepayment, dbDrawTradeFinance, dbPatchTradeFinance, dbTradeFinanceAction, dbVoidTfRepayment,
} from '../lib/firebaseService';
import { TF_DOC_KINDS, TF_STATUS_META, addDays, tfPosition, tfTypeLabel } from '../lib/tradeFinance';
import { dateFmt, money, poFinance } from '../lib/procurement';

// One trade finance facility in one place: what the bank is financing, what it costs, the maturity countdown, drawdown
// (the bank pays the supplier), repayments to the bank, and the bank / LC documents.

interface Props {
  tf: TradeFinance;
  po: PurchaseOrder | null;
  invoices: SupplierInvoice[];
  payments: SupplierPayment[];
  currentUserName: string;
  onClose: () => void;
  onChanged: () => Promise<void> | void;
  onEdit: (tf: TradeFinance) => void;
  onOpenPo: (poId: string) => void;
}

type Dialog =
  | { kind: 'approve' } | { kind: 'draw' } | { kind: 'repay' }
  | { kind: 'reason'; action: 'cancel' | 'void_repayment'; targetId?: string; label: string };

const GUIDE: Record<TradeFinance['status'], string> = {
  draft: 'Complete the terms, then send the application to the bank and mark it as applied.',
  applied: 'With the bank. When it approves (or issues the LC), record the approval and its reference.',
  approved: 'Approved. When the bank pays the supplier, record the drawdown — that starts the repayment clock.',
  drawn: 'The bank has paid the supplier. Repay the bank by the maturity date.',
  settled: 'Fully repaid. Nothing more to do.',
  cancelled: 'This facility was cancelled.',
};

export const TradeFinancePanel: React.FC<Props> = ({ tf, po, invoices, payments, currentUserName, onClose, onChanged, onEdit, onOpenPo }) => {
  const [dialog, setDialog] = useState<Dialog | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [flash, setFlash] = useState<string | null>(null);
  const pos = useMemo(() => tfPosition(tf), [tf]);
  const st = TF_STATUS_META[tf.status];
  const fin = useMemo(() => (po ? poFinance(po, invoices, payments) : null), [po, invoices, payments]);

  const say = (m: string) => { setFlash(m); window.setTimeout(() => setFlash(null), 2500); };
  const run = async (fn: () => Promise<unknown>, ok?: string): Promise<boolean> => {
    setBusy(true); setError(null);
    try { await fn(); await onChanged(); if (ok) say(ok); return true; }
    catch (e: any) { setError(e?.message || 'Something went wrong.'); return false; }
    finally { setBusy(false); }
  };

  const countdown = pos.maturity && tf.status === 'drawn'
    ? (pos.overdue ? { text: `Overdue by ${-(pos.daysToMaturity as number)} day(s)`, cls: 'border-rose-300 bg-rose-50 text-rose-800' }
      : pos.daysToMaturity === 0 ? { text: 'Matures today', cls: 'border-rose-300 bg-rose-50 text-rose-800' }
      : { text: `Matures in ${pos.daysToMaturity} day(s)`, cls: pos.dueSoon ? 'border-amber-300 bg-amber-50 text-amber-800' : 'border-slate-200 bg-slate-50 text-slate-700' })
    : null;

  const cards = [
    { label: 'Goods value', value: money(pos.invoiceAed), sub: tf.currency !== 'AED' ? `${money(tf.invoiceAmount)} ${tf.currency} @ ${tf.fxRate}` : 'AED' },
    { label: 'Bank finances', value: money(pos.financedAed), sub: `you paid margin ${money(pos.marginAed)}` },
    { label: 'Payable to bank', value: money(pos.totalDue), sub: `cost ${money(pos.cost)} (${pos.costPctPa}% p.a.)` },
    { label: 'Repaid', value: money(pos.repaid), sub: ' ' },
    { label: 'Outstanding', value: money(pos.outstanding), sub: pos.maturity ? `due ${dateFmt(pos.maturity)}` : 'not drawn yet', warn: pos.outstanding > 0 && tf.status === 'drawn' },
  ];

  return (
    <div className="fixed inset-0 z-40 flex justify-end bg-slate-900/40" onClick={onClose} data-testid="tf-panel">
      <aside className="h-full w-full max-w-3xl bg-white border-l border-slate-300 shadow-2xl flex flex-col" onClick={e => e.stopPropagation()}>
        <div className="px-5 pt-4 pb-3 border-b border-slate-200">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <div className="text-[10px] uppercase font-bold text-slate-500 font-mono">{tf.tfNo}{tf.facilityRef ? ` · ${tf.facilityRef}` : ''}</div>
              <h2 className="text-base font-black text-slate-900 break-words flex items-center gap-2"><Landmark className="h-4 w-4 text-primary-600 shrink-0" />{tf.bankName}</h2>
              <div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-slate-600">
                <span className={`inline-block px-2 py-0.5 rounded-full text-[10px] font-black uppercase border ${st.cls}`}>{st.label}</span>
                <span>{tfTypeLabel(tf.type)}</span>
                <button onClick={() => onOpenPo(tf.poId)} className="flex items-center gap-1 text-primary-700 font-bold hover:underline cursor-pointer"><ShoppingCart className="h-3 w-3" />{tf.poNo} · {tf.supplierName}</button>
              </div>
            </div>
            <button onClick={onClose} className="p-2 rounded-lg text-slate-500 hover:text-slate-900 hover:bg-slate-100 cursor-pointer" title="Close"><X className="h-4 w-4" /></button>
          </div>
        </div>

        <div className="flex-1 overflow-y-auto px-5 py-4 space-y-5">
          {flash && <div className="rounded-lg bg-emerald-50 border border-emerald-200 text-emerald-800 text-xs font-bold px-3 py-2" data-testid="tf-flash">{flash}</div>}
          {error && <ErrorLine error={error} />}

          <div className="grid grid-cols-2 sm:grid-cols-5 gap-2">
            {cards.map(c => (
              <div key={c.label} className="rounded-xl border border-slate-200 p-2.5">
                <div className="text-[10px] uppercase font-bold text-slate-500">{c.label}</div>
                <div className={`text-sm font-black font-mono ${(c as any).warn ? 'text-rose-700' : 'text-slate-900'}`}>{c.value}</div>
                <div className="text-[10px] text-slate-500 truncate">{c.sub}</div>
              </div>
            ))}
          </div>

          {countdown && <div className={`rounded-xl border px-3 py-2 text-xs font-bold flex items-center gap-2 ${countdown.cls}`} data-testid="tf-countdown"><CalendarClock className="h-4 w-4" />{countdown.text} — {dateFmt(pos.maturity)}</div>}

          <div className="rounded-xl border border-primary-200 bg-primary-50/40 p-3">
            <div className="text-xs text-slate-700">{GUIDE[tf.status]}</div>
            <div className="mt-2 flex flex-wrap gap-2">
              {tf.status === 'draft' && <>
                <button onClick={() => onEdit(tf)} className={btn.soft}><Pencil className="h-3.5 w-3.5" /> Edit terms</button>
                <button onClick={() => run(() => dbTradeFinanceAction(tf.id, 'apply', currentUserName), 'Marked as applied.')} disabled={busy} className={btn.primary} data-testid="tf-apply"><Send className="h-3.5 w-3.5" /> Mark as applied</button>
              </>}
              {tf.status === 'applied' && <>
                <button onClick={() => onEdit(tf)} className={btn.soft}><Pencil className="h-3.5 w-3.5" /> Edit terms</button>
                <button onClick={() => { setError(null); setDialog({ kind: 'approve' }); }} className={btn.green} data-testid="tf-approve"><CheckCircle2 className="h-3.5 w-3.5" /> Bank approved</button>
              </>}
              {tf.status === 'approved' && <>
                <button onClick={() => onEdit(tf)} className={btn.soft}><Pencil className="h-3.5 w-3.5" /> Edit terms</button>
                <button onClick={() => { setError(null); setDialog({ kind: 'draw' }); }} className={btn.primary} data-testid="tf-draw"><Banknote className="h-3.5 w-3.5" /> Record drawdown</button>
              </>}
              {tf.status === 'drawn' && <button onClick={() => { setError(null); setDialog({ kind: 'repay' }); }} className={btn.green} data-testid="tf-repay"><Wallet className="h-3.5 w-3.5" /> Record repayment to bank</button>}
              {['draft', 'applied', 'approved'].includes(tf.status) && <button onClick={() => setDialog({ kind: 'reason', action: 'cancel', label: 'Cancel this facility' })} className={btn.danger}><Ban className="h-3.5 w-3.5" /> Cancel</button>}
            </div>
          </div>

          {/* cost breakdown */}
          <section>
            <h3 className="text-xs font-extrabold text-slate-900 mb-2">Terms &amp; cost</h3>
            <div className="rounded-xl border border-slate-200 overflow-hidden text-xs">
              {[
                ['Tenor', `${tf.tenorDays} days`],
                ['Interest / profit rate', `${tf.interestRate}% per year`],
                ['Cash margin', `${tf.marginPct}% = AED ${money(pos.marginAed)}`],
                ['Interest for the tenor', `AED ${money(pos.interest)}`],
                ['Commission', `${tf.commissionPct}% = AED ${money(pos.commission)}`],
                ['Other charges', `AED ${money(pos.fees)}`],
                ['Drawdown date', tf.drawDate ? dateFmt(tf.drawDate) : tf.expectedDrawDate ? `expected ${dateFmt(tf.expectedDrawDate)}` : '—'],
                ['Maturity', pos.maturity ? dateFmt(pos.maturity) : tf.tenorDays ? `${tf.tenorDays} days after drawdown` : '—'],
                ['Bank approval ref.', tf.approvedRef || '—'],
              ].map(([k, v], i) => <div key={k as string} className={`flex justify-between px-3 py-1.5 ${i % 2 ? 'bg-slate-50' : ''}`}><span className="text-slate-500">{k}</span><span className="font-mono text-slate-800">{v}</span></div>)}
            </div>
          </section>

          {/* repayments */}
          <section>
            <h3 className="text-xs font-extrabold text-slate-900 mb-2 flex items-center gap-1.5"><Wallet className="h-4 w-4 text-emerald-600" /> Repayments to the bank</h3>
            {tf.repayments.length === 0 ? <div className="text-xs text-slate-500">None yet.</div> : (
              <div className="rounded-xl border border-slate-200 overflow-x-auto">
                <table className="w-full min-w-[480px] text-xs">
                  <thead><tr className="bg-slate-100 text-slate-500 uppercase text-[10px]"><th className="text-left px-2 py-2">Date</th><th className="text-left px-2 py-2">Reference</th><th className="text-right px-2 py-2">Amount</th><th className="text-left px-2 py-2">By</th><th className="w-8" /></tr></thead>
                  <tbody>
                    {tf.repayments.map(r => (
                      <tr key={r.id} className={`border-t border-slate-200 ${r.voided ? 'opacity-50 line-through' : ''}`}>
                        <td className="px-2 py-2 whitespace-nowrap">{dateFmt(r.paidAt)}</td><td className="px-2 py-2">{r.reference || '—'}</td>
                        <td className="px-2 py-2 text-right font-mono">{money(r.amount)}</td><td className="px-2 py-2">{r.byName}</td>
                        <td className="px-1">{!r.voided && <button onClick={() => setDialog({ kind: 'reason', action: 'void_repayment', targetId: r.id, label: `Void repayment of AED ${money(r.amount)}` })} className="text-slate-400 hover:text-rose-600 cursor-pointer" title="Void"><Ban className="h-3.5 w-3.5" /></button>}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>

          {/* documents */}
          <section>
            <h3 className="text-xs font-extrabold text-slate-900 mb-2 flex items-center gap-1.5"><Paperclip className="h-4 w-4 text-slate-500" /> Bank &amp; LC documents</h3>
            <AttachmentList
              attachments={tf.attachments || []} ownerKey={tf.id} uploadedByName={currentUserName} kinds={TF_DOC_KINDS} testId="tf-docs"
              onChange={async next => { try { await dbPatchTradeFinance(tf.id, { attachments: next }); await onChanged(); } catch (e: any) { setError(e?.message || 'Could not save the file list.'); } }}
            />
          </section>

          <section className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-xs">
            <div className="rounded-xl border border-slate-200 p-3 space-y-1">
              <div className="text-[10px] uppercase font-bold text-slate-500 mb-1">Notes</div>
              <div className="text-slate-700 whitespace-pre-wrap">{tf.notes || '—'}</div>
            </div>
            <div className="rounded-xl border border-slate-200 p-3 space-y-1">
              <div className="text-[10px] uppercase font-bold text-slate-500 mb-1">Audit trail</div>
              <div>Created by {tf.createdByName} · {dateFmt(tf.createdAt)}</div>
              {tf.appliedAt && <div>Applied to bank · {dateFmt(tf.appliedAt)}</div>}
              {tf.approvedAt && <div>Bank approved · {dateFmt(tf.approvedAt)}</div>}
              {tf.drawDate && <div>Bank paid supplier · {dateFmt(tf.drawDate)}</div>}
              {tf.cancelledAt && <div className="text-rose-700">Cancelled by {tf.cancelledByName} · {dateFmt(tf.cancelledAt)} — {tf.cancelReason}</div>}
            </div>
          </section>
        </div>
      </aside>

      {dialog?.kind === 'approve' && <ApproveDialog tf={tf} busy={busy} error={error} onClose={() => setDialog(null)} onSave={async v => {
        if (await run(() => dbTradeFinanceAction(tf.id, 'approve', currentUserName, v), 'Bank approval recorded.')) setDialog(null);
      }} />}

      {dialog?.kind === 'draw' && <DrawDialog tf={tf} po={po} invoices={invoices} fin={fin} busy={busy} error={error} onClose={() => setDialog(null)} onSave={async v => {
        if (await run(() => dbDrawTradeFinance(tf.id, { date: v.date, payment: v.record ? { invoiceId: v.invoiceId || null, amount: v.amount } : null }, currentUserName, fin?.payCap ?? 0), 'Drawdown recorded.')) setDialog(null);
      }} />}

      {dialog?.kind === 'repay' && <RepayDialog tf={tf} outstanding={pos.outstanding} busy={busy} error={error} onClose={() => setDialog(null)} onSave={async v => {
        if (await run(() => dbAddTfRepayment(tf.id, v, currentUserName), 'Repayment recorded.')) setDialog(null);
      }} />}

      {dialog?.kind === 'reason' && <ReasonDialog label={dialog.label} busy={busy} error={error} onClose={() => setDialog(null)} onConfirm={async reason => {
        const ok = await run(async () => {
          if (dialog.action === 'cancel') await dbTradeFinanceAction(tf.id, 'cancel', currentUserName, { notes: reason });
          else await dbVoidTfRepayment(tf.id, dialog.targetId!, currentUserName, reason);
        }, 'Done.');
        if (ok) setDialog(null);
      }} />}
    </div>
  );
};

const ApproveDialog: React.FC<{ tf: TradeFinance; busy: boolean; error: string | null; onClose: () => void; onSave: (v: { approvedRef: string; facilityRef: string; date: string }) => void }> = ({ tf, busy, error, onClose, onSave }) => {
  const [approvedRef, setApprovedRef] = useState('');
  const [facilityRef, setFacilityRef] = useState(tf.facilityRef || '');
  const [date, setDate] = useState(todayStr());
  return (
    <Modal title="Bank approval" subtitle={`${tf.tfNo} · ${tf.bankName}`} onClose={onClose} width="max-w-md" z="z-[70]" footer={<>
      <button onClick={onClose} className={btn.soft}>Cancel</button>
      <button onClick={() => onSave({ approvedRef, facilityRef, date })} disabled={busy} className={btn.green} data-testid="tf-approve-save">{busy && <Loader2 className="h-3.5 w-3.5 animate-spin" />} Save</button>
    </>}>
      <div className="space-y-3">
        <Field label="Approval date"><input type="date" value={date} onChange={e => setDate(e.target.value)} className={inputCls} /></Field>
        <Field label="LC / TR / loan reference"><input value={facilityRef} onChange={e => setFacilityRef(e.target.value)} className={`${inputCls} font-mono`} data-testid="tf-facility-ref" /></Field>
        <Field label="Bank approval / sanction reference"><input value={approvedRef} onChange={e => setApprovedRef(e.target.value)} className={`${inputCls} font-mono`} /></Field>
        <div className="text-[11px] text-slate-500">Upload the bank’s approval letter and the LC copy under “Bank &amp; LC documents”.</div>
        <ErrorLine error={error} />
      </div>
    </Modal>
  );
};

const DrawDialog: React.FC<{
  tf: TradeFinance; po: PurchaseOrder | null; invoices: SupplierInvoice[]; fin: ReturnType<typeof poFinance> | null; busy: boolean; error: string | null; onClose: () => void;
  onSave: (v: { date: string; record: boolean; amount: number; invoiceId: string }) => void;
}> = ({ tf, po, invoices, fin, busy, error, onClose, onSave }) => {
  const a = tfPosition(tf);
  const room = fin ? Math.max(0, Math.round((fin.payCap - fin.paid) * 100) / 100) : 0;
  const [date, setDate] = useState(todayStr());
  const [record, setRecord] = useState(!!po);
  const live = invoices.filter(i => i.poId === tf.poId && !i.voided);
  const [invoiceId, setInvoiceId] = useState(live.length ? live[live.length - 1].id : '');
  const [amount, setAmount] = useState(String(Math.min(a.invoiceAed, room || a.invoiceAed)));
  const amt = Number(amount) || 0;
  return (
    <Modal title="Record drawdown — the bank paid the supplier" subtitle={`${tf.tfNo} · ${tf.supplierName}`} onClose={onClose} width="max-w-lg" z="z-[70]" footer={<>
      <button onClick={onClose} className={btn.soft}>Cancel</button>
      <button onClick={() => onSave({ date, record, amount: amt, invoiceId })} disabled={busy || !date || (record && (!(amt > 0) || amt > room + 0.005))} className={btn.primary} data-testid="tf-draw-save">{busy && <Loader2 className="h-3.5 w-3.5 animate-spin" />} Save drawdown</button>
    </>}>
      <div className="space-y-3">
        <Field label="Date the bank paid the supplier *"><input type="date" value={date} onChange={e => setDate(e.target.value)} className={inputCls} data-testid="tf-draw-date" /></Field>
        <div className="rounded-lg bg-slate-50 border border-slate-200 px-3 py-2 text-xs">
          Repayment of <strong>AED {money(a.totalDue)}</strong> will fall due on <strong>{date ? dateFmt(addDays(date, tf.tenorDays)) : '—'}</strong> ({tf.tenorDays} days).
        </div>
        <label className="flex items-start gap-2 text-xs text-slate-700 cursor-pointer">
          <input type="checkbox" checked={record} onChange={e => setRecord(e.target.checked)} disabled={!po} className="mt-0.5 accent-emerald-600" data-testid="tf-draw-record" />
          <span><strong>Also record this as a payment on {tf.poNo}</strong> (recommended)
            <span className="block text-[11px] text-slate-500">The supplier has been paid — by the bank. Your debt moves from the supplier to the bank.</span></span>
        </label>
        {record && po && (
          <div className="grid grid-cols-2 gap-3">
            <Field label="Against invoice" className="col-span-2">
              <select value={invoiceId} onChange={e => setInvoiceId(e.target.value)} className={inputCls}>
                {live.map(i => <option key={i.id} value={i.id}>Invoice {i.invoiceNo} — AED {money(i.amount)}</option>)}
                <option value="">No invoice yet (advance)</option>
              </select>
            </Field>
            <Field label="Amount paid to supplier (AED)">
              <input type="number" min={0} step="any" value={amount} onChange={e => setAmount(e.target.value)} className={`${inputCls} font-mono`} data-testid="tf-draw-amount" />
              {amt > room + 0.005 && <div className="text-[11px] text-rose-700 mt-1">Most the PO can still be paid: {money(room)}</div>}
            </Field>
            {fin && <div className="text-[11px] text-slate-500 self-end">PO paid so far {money(fin.paid)} of {money(fin.payCap)}</div>}
          </div>
        )}
        <ErrorLine error={error} />
      </div>
    </Modal>
  );
};

const RepayDialog: React.FC<{ tf: TradeFinance; outstanding: number; busy: boolean; error: string | null; onClose: () => void; onSave: (v: { amount: number; paidAt: string; reference: string; notes: string }) => void }> = ({ tf, outstanding, busy, error, onClose, onSave }) => {
  const [amount, setAmount] = useState(String(outstanding));
  const [paidAt, setPaidAt] = useState(todayStr());
  const [reference, setReference] = useState('');
  const [notes, setNotes] = useState('');
  const amt = Number(amount) || 0;
  return (
    <Modal title="Repayment to the bank" subtitle={`${tf.tfNo} · ${tf.bankName} · still owed AED ${money(outstanding)}`} onClose={onClose} width="max-w-md" z="z-[70]" footer={<>
      <button onClick={onClose} className={btn.soft}>Cancel</button>
      <button onClick={() => onSave({ amount: amt, paidAt, reference, notes })} disabled={busy || !(amt > 0) || amt > outstanding + 0.005} className={btn.green} data-testid="tf-repay-save">{busy && <Loader2 className="h-3.5 w-3.5 animate-spin" />} Save repayment</button>
    </>}>
      <div className="space-y-3">
        <div className="grid grid-cols-2 gap-3">
          <Field label="Amount (AED) *"><input type="number" min={0} step="any" value={amount} onChange={e => setAmount(e.target.value)} className={`${inputCls} font-mono`} data-testid="tf-repay-amount" />
            {amt > outstanding + 0.005 && <div className="text-[11px] text-rose-700 mt-1">More than is owed ({money(outstanding)}).</div>}</Field>
          <Field label="Payment date"><input type="date" value={paidAt} onChange={e => setPaidAt(e.target.value)} className={inputCls} /></Field>
          <Field label="Reference (transfer / cheque no.)" className="col-span-2"><input value={reference} onChange={e => setReference(e.target.value)} className={inputCls} /></Field>
          <Field label="Notes" className="col-span-2"><input value={notes} onChange={e => setNotes(e.target.value)} className={inputCls} /></Field>
        </div>
        <ErrorLine error={error} />
      </div>
    </Modal>
  );
};
