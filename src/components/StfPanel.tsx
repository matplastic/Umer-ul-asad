import React, { useMemo, useState } from 'react';
import { X, Pencil, CheckCircle2, Send, Landmark, Ban, Undo2, ShoppingCart, Loader2, AlertTriangle, History, Paperclip, Lock } from 'lucide-react';
import type { ProcurementSettings, Stf } from '../types';
import { Field, Modal, btn, inputCls } from './ProcurementUi';
import { AttachmentList } from './AttachmentList';
import { ErrorLine, ReasonDialog } from './PoDetailPanel';
import { dbPatchStf, dbStfAction } from '../lib/firebaseService';
import { STF_STATUS_META, budgetTier, sameName, stfPermissions, stfTotals } from '../lib/stf';
import { dateFmt, lineRate, lineTotal, money, qtyFmt, vatLabel } from '../lib/procurement';

// One STF: where it is in the approval queue, what is being bought, the supplier's quotation, the PO that
// followed, and who did what. Everyone sees it; only the right person can move it.

interface Props {
  stf: Stf;
  settings: ProcurementSettings;
  currentUserName: string;
  manager: boolean;                    // a management account may act for anyone
  onClose: () => void;
  onChanged: () => Promise<void> | void;
  onEdit: (stf: Stf) => void;
  onIssuePo: (stf: Stf) => void;
  onOpenPo: (poId: string) => void;
}

type Dialog = { kind: 'forward' } | { kind: 'reason'; action: 'reject' | 'cancel'; label: string };

const ACTION_TEXT: Record<string, string> = {
  created: 'created the STF', forwarded: 'sent it to', approved: 'approved it', step_approved: 'approved their step, passed it to', to_board: 'sent it to the Board', board_approved: 'recorded the Board’s approval',
  rejected: 'rejected it', cancelled: 'cancelled it', reopened: 'reopened it', po_issued: 'issued the PO',
};
const DOC_KINDS = [{ id: 'quotation', label: 'Supplier quotation' }, { id: 'approval', label: 'Approval / e-mail' }, { id: 'other', label: 'Other' }];

export const StfPanel: React.FC<Props> = ({ stf, settings, currentUserName, manager, onClose, onChanged, onEdit, onIssuePo, onOpenPo }) => {
  const [dialog, setDialog] = useState<Dialog | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [flash, setFlash] = useState<string | null>(null);
  const perm = useMemo(() => stfPermissions(stf, settings, { name: currentUserName, manager }), [stf, settings, currentUserName, manager]);
  const t = stfTotals(stf);
  const tier = budgetTier(stf, settings);
  const meta = STF_STATUS_META[stf.status];
  const mine = stf.status === 'pending' && sameName(stf.queue, currentUserName);

  const say = (m: string) => { setFlash(m); window.setTimeout(() => setFlash(null), 2500); };
  const run = async (fn: () => Promise<unknown>, ok?: string): Promise<boolean> => {
    setBusy(true); setError(null);
    try { await fn(); await onChanged(); if (ok) say(ok); return true; }
    catch (e: any) { setError(e?.message || 'Something went wrong.'); return false; }
    finally { setBusy(false); }
  };
  const act = (a: Parameters<typeof dbStfAction>[1], ok: string, opts: any = {}) => run(() => dbStfAction(stf.id, a, currentUserName, manager, opts), ok);

  return (
    <div className="fixed inset-0 z-40 flex justify-end bg-slate-900/40" onClick={onClose} data-testid="stf-panel">
      <aside className="h-full w-full max-w-3xl bg-white border-l border-slate-300 shadow-2xl flex flex-col" onClick={e => e.stopPropagation()}>
        <div className="px-5 pt-4 pb-3 border-b border-slate-200">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <div className="text-[10px] uppercase font-bold text-slate-500 font-mono">{stf.stfNo}{stf.rfqNo ? ` · from ${stf.rfqNo}` : ''}</div>
              <h2 className="text-base font-black text-slate-900 break-words">{stf.description}</h2>
              <div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-slate-600">
                <span className={`inline-block px-2 py-0.5 rounded-full text-[10px] font-black uppercase border ${meta.cls}`} data-testid="stf-status">{meta.label}</span>
                <span className={`px-2 py-0.5 rounded-full text-[10px] font-black border ${tier.above ? 'bg-amber-50 border-amber-300 text-amber-800' : 'bg-slate-50 border-slate-300 text-slate-700'}`}>{tier.label}</span>
                <span>Que: <strong className={mine ? 'text-primary-700' : 'text-slate-800'} data-testid="stf-queue-now">{stf.queue}</strong>{mine && ' (you)'}</span>
              </div>
              {(stf.approvalRoute?.length || 0) > 1 && (
                <div className="mt-1.5 flex flex-wrap items-center gap-1 text-[11px]" data-testid="stf-route">
                  <span className="text-slate-500 font-semibold">Approval route:</span>
                  {stf.approvalRoute!.map((n, i) => {
                    const at = stf.approvalRoute!.findIndex(x => sameName(x, stf.queue));
                    const done = stf.status === 'approved' || (stf.status === 'pending' && at > i) || (stf.status === 'approved');
                    const now = stf.status === 'pending' && at === i;
                    return <React.Fragment key={n}>{i > 0 && <span className="text-slate-300">→</span>}<span className={`px-1.5 py-0.5 rounded-full border font-bold ${done ? 'bg-emerald-50 border-emerald-300 text-emerald-800' : now ? 'bg-primary-50 border-primary-400 text-primary-800' : 'bg-slate-50 border-slate-300 text-slate-600'}`}>{done ? '✓ ' : ''}{n}</span></React.Fragment>;
                  })}
                </div>
              )}
            </div>
            <button onClick={onClose} className="p-2 rounded-lg text-slate-500 hover:text-slate-900 hover:bg-slate-100 cursor-pointer" title="Close"><X className="h-4 w-4" /></button>
          </div>
        </div>

        <div className="flex-1 overflow-y-auto px-5 py-4 space-y-5">
          {flash && <div className="rounded-lg bg-emerald-50 border border-emerald-200 text-emerald-800 text-xs font-bold px-3 py-2" data-testid="stf-flash">{flash}</div>}
          {error && <ErrorLine error={error} />}

          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
            {[
              ['Company', stf.supplierName, stf.paymentTerms || 'no terms'],
              ['Project', `${stf.projectType}${stf.projectName ? ` · ${stf.projectName}` : ''}`, `date ${dateFmt(stf.date)}`],
              [`G. TOTAL (${stf.currency})`, money(t.total), stf.currency !== 'AED' ? `≈ AED ${money(t.totalAed)}` : `incl. VAT ${money(t.vat)}`],
              ['≈ EUR', money(tier.eur), `tier ${tier.label}`],
            ].map(([l, v, sub]) => (
              <div key={l} className="rounded-xl border border-slate-200 p-2.5"><div className="text-[10px] uppercase font-bold text-slate-500">{l}</div><div className="text-sm font-black text-slate-900 break-words">{v}</div><div className="text-[10px] text-slate-500 truncate">{sub}</div></div>
            ))}
          </div>

          {/* what happens next + the buttons */}
          <div className="rounded-xl border border-primary-200 bg-primary-50/40 p-3">
            <div className="text-xs text-slate-700">
              {stf.status === 'pending' && <>Waiting for <strong>{stf.queue}</strong>.{perm.approveBlockedReason && !manager && !mine ? '' : ''}</>}
              {stf.status === 'board' && 'With the Board. Management records the Board’s decision.'}
              {stf.status === 'approved' && !stf.poId && 'Approved. Issue the PO — it will be approved automatically because this STF was.'}
              {stf.status === 'approved' && stf.poId && <>Approved and the PO <button onClick={() => onOpenPo(stf.poId!)} className="font-mono font-bold text-primary-700 hover:underline cursor-pointer">{stf.poNo}</button> was issued.</>}
              {stf.status === 'rejected' && 'Rejected. Management can reopen it.'}
              {stf.status === 'cancelled' && 'Cancelled.'}
            </div>
            {stf.status === 'pending' && !perm.canApprove && perm.approveBlockedReason && (mine || manager) && <div className="text-[11px] text-amber-700 mt-1 flex items-start gap-1"><Lock className="h-3 w-3 mt-0.5 shrink-0" />{perm.approveBlockedReason}</div>}
            <div className="mt-2 flex flex-wrap gap-2">
              {perm.canEdit && <button onClick={() => onEdit(stf)} className={btn.soft} data-testid="stf-edit"><Pencil className="h-3.5 w-3.5" /> Edit</button>}
              {perm.canForward && <button onClick={() => { setError(null); setDialog({ kind: 'forward' }); }} className={btn.soft} data-testid="stf-forward"><Send className="h-3.5 w-3.5" /> Forward to…</button>}
              {stf.status === 'pending' && perm.canApprove && <button onClick={() => act('approve', 'STF approved.')} disabled={busy} className={btn.green} data-testid="stf-approve"><CheckCircle2 className="h-3.5 w-3.5" /> Approve</button>}
              {perm.canToBoard && <button onClick={() => act('to_board', 'Sent to the Board.')} disabled={busy} className={btn.amber} data-testid="stf-board"><Landmark className="h-3.5 w-3.5" /> Send to Board</button>}
              {perm.canBoardDecide && <button onClick={() => act('board_approve', 'Board approval recorded.')} disabled={busy} className={btn.green} data-testid="stf-board-approve"><CheckCircle2 className="h-3.5 w-3.5" /> Board approved</button>}
              {perm.canReject && <button onClick={() => { setError(null); setDialog({ kind: 'reason', action: 'reject', label: 'Reject this STF' }); }} className={btn.danger}><Undo2 className="h-3.5 w-3.5" /> Reject</button>}
              {perm.canCancel && <button onClick={() => { setError(null); setDialog({ kind: 'reason', action: 'cancel', label: 'Cancel this STF' }); }} className={btn.danger}><Ban className="h-3.5 w-3.5" /> Cancel</button>}
              {perm.canReopen && <button onClick={() => act('reopen', 'STF reopened.', { toQueue: settings.approvers[0]?.name })} disabled={busy} className={btn.soft}><Undo2 className="h-3.5 w-3.5" /> Reopen</button>}
              {stf.status === 'approved' && !stf.poId && <button onClick={() => onIssuePo(stf)} className={btn.primary} data-testid="stf-issue-po"><ShoppingCart className="h-3.5 w-3.5" /> Issue PO</button>}
            </div>
          </div>

          <section>
            <h3 className="text-xs font-extrabold text-slate-900 mb-2">Items</h3>
            <div className="rounded-xl border border-slate-200 overflow-x-auto">
              <table className="w-full min-w-[560px] text-xs">
                <thead><tr className="bg-slate-100 text-slate-500 uppercase text-[10px]"><th className="text-left px-2 py-2">Code</th><th className="text-left px-2 py-2">Description</th><th className="text-right px-2 py-2">Qty</th><th className="text-left px-2 py-2">Unit</th><th className="text-right px-2 py-2">Unit price</th><th className="text-right px-2 py-2">VAT %</th><th className="text-right px-2 py-2">Total</th></tr></thead>
                <tbody>
                  {stf.lines.map(l => (
                    <tr key={l.id} className="border-t border-slate-200">
                      <td className="px-2 py-2 font-mono text-[10px] text-slate-500">{l.erpCode || '—'}</td><td className="px-2 py-2 font-semibold text-slate-800">{l.itemName}</td>
                      <td className="px-2 py-2 text-right font-mono">{qtyFmt(l.qty)}</td><td className="px-2 py-2">{l.unit}</td>
                      <td className="px-2 py-2 text-right font-mono">{money(l.unitPrice)}</td><td className="px-2 py-2 text-right font-mono">{lineRate(l, stf.vatRate)}%</td><td className="px-2 py-2 text-right font-mono">{money(lineTotal(l))}</td>
                    </tr>
                  ))}
                </tbody>
                <tfoot className="text-xs">
                  <tr className="border-t border-slate-300"><td colSpan={6} className="px-2 py-1 text-right font-bold text-slate-500">TOTAL</td><td className="px-2 py-1 text-right font-mono">{money(t.subtotal)}</td></tr>
                  <tr><td colSpan={6} className="px-2 py-1 text-right font-bold text-slate-500">VAT ({vatLabel(stf.lines, stf.vatRate)})</td><td className="px-2 py-1 text-right font-mono">{money(t.vat)}</td></tr>
                  <tr className="bg-slate-50"><td colSpan={6} className="px-2 py-1.5 text-right font-black">G. TOTAL ({stf.currency})</td><td className="px-2 py-1.5 text-right font-mono font-black">{money(t.total)}</td></tr>
                </tfoot>
              </table>
            </div>
          </section>

          <section>
            <h3 className="text-xs font-extrabold text-slate-900 mb-2 flex items-center gap-1.5"><Paperclip className="h-4 w-4 text-slate-500" /> Quotation &amp; approval documents</h3>
            <AttachmentList
              attachments={stf.attachments || []} ownerKey={stf.id} uploadedByName={currentUserName} kinds={DOC_KINDS} testId="stf-panel-docs"
              readOnly={stf.status === 'cancelled'}
              onChange={async next => { try { await dbPatchStf(stf.id, { attachments: next }); await onChanged(); } catch (e: any) { setError(e?.message || 'Could not save the file list.'); } }}
            />
          </section>

          <section className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-xs">
            <div className="rounded-xl border border-slate-200 p-3 space-y-1">
              <div className="text-[10px] uppercase font-bold text-slate-500 mb-1">Details</div>
              <div><span className="text-slate-500">Payment terms:</span> {stf.paymentTerms || '—'}</div>
              <div><span className="text-slate-500">Last status date:</span> {dateFmt(stf.statusDate)}</div>
              <div><span className="text-slate-500">Created by:</span> {stf.createdByName}</div>
              {stf.notes && <div className="pt-1 whitespace-pre-wrap text-slate-700">{stf.notes}</div>}
            </div>
            <div className="rounded-xl border border-slate-200 p-3">
              <div className="text-[10px] uppercase font-bold text-slate-500 mb-1 flex items-center gap-1"><History className="h-3 w-3" /> History</div>
              <ol className="space-y-1">
                {stf.history.map((h, i) => (
                  <li key={i}><span className="text-slate-400">{dateFmt(h.at)}</span> · <strong>{h.byName}</strong> {ACTION_TEXT[h.action] || h.action}{(h.action === 'forwarded' || h.action === 'step_approved') && h.toQueue ? ` ${h.toQueue}` : ''}{h.action === 'created' && h.toQueue ? ` → ${h.toQueue}` : ''}{h.notes ? <span className="text-slate-600"> — {h.notes}</span> : null}</li>
                ))}
              </ol>
            </div>
          </section>
        </div>
      </aside>

      {dialog?.kind === 'forward' && <ForwardDialog settings={settings} current={stf.queue} busy={busy} error={error} onClose={() => setDialog(null)} onSave={async (to, note) => {
        if (await run(() => dbStfAction(stf.id, 'forward', currentUserName, manager, { toQueue: to, notes: note }), `Sent to ${to}.`)) setDialog(null);
      }} />}
      {dialog?.kind === 'reason' && <ReasonDialog label={dialog.label} busy={busy} error={error} onClose={() => setDialog(null)} onConfirm={async reason => {
        if (await run(() => dbStfAction(stf.id, dialog.action, currentUserName, manager, { notes: reason }), 'Done.')) setDialog(null);
      }} />}
    </div>
  );
};

const ForwardDialog: React.FC<{ settings: ProcurementSettings; current: string; busy: boolean; error: string | null; onClose: () => void; onSave: (to: string, note: string) => void }> = ({ settings, current, busy, error, onClose, onSave }) => {
  const [to, setTo] = useState(settings.approvers.find(a => !sameName(a.name, current))?.name || '');
  const [note, setNote] = useState('');
  return (
    <Modal title="Forward to…" onClose={onClose} width="max-w-md" z="z-[70]" footer={<>
      <button onClick={onClose} className={btn.soft}>Back</button>
      <button onClick={() => onSave(to, note)} disabled={busy || !to} className={btn.primary} data-testid="stf-forward-save">{busy && <Loader2 className="h-3.5 w-3.5 animate-spin" />} Send</button>
    </>}>
      <div className="space-y-3">
        <Field label="Who is next in the queue?"><select value={to} onChange={e => setTo(e.target.value)} className={inputCls} data-testid="stf-forward-to">{settings.approvers.map(a => <option key={a.name} value={a.name}>{a.name}{a.finalForAbove ? ' (final approval above tier)' : ''}</option>)}</select></Field>
        <Field label="Note (optional)"><input value={note} onChange={e => setNote(e.target.value)} className={inputCls} /></Field>
        <div className="text-[11px] text-slate-500 flex items-start gap-1"><AlertTriangle className="h-3 w-3 mt-0.5 shrink-0" />Currently with {current}.</div>
        <ErrorLine error={error} />
      </div>
    </Modal>
  );
};
