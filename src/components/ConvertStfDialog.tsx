import React, { useMemo, useState } from 'react';
import { ArrowRight, CheckCircle2, XCircle, ShoppingCart } from 'lucide-react';
import type { ProcurementSettings, PurchaseOrder, Stf } from '../types';
import { Field, Modal, btn, inputCls } from './ProcurementUi';
import { STF_STATUS_META, budgetTier, stfTotals } from '../lib/stf';
import { dateFmt, money } from '../lib/procurement';

// STF → PO. The buyer TYPES the STF number; the PO can only be started when that number belongs to an
// APPROVED STF that has no live PO yet. When opened from an STF, the number is not filled in — it has to
// be typed to confirm that the right form is being converted.

interface Props {
  stfs: Stf[];
  pos: PurchaseOrder[];
  settings: ProcurementSettings;
  expected?: Stf | null;              // opened from this STF: the typed number must match it
  onClose: () => void;
  onConvert: (stf: Stf) => void;
}

const norm = (s: string) => s.trim().toLowerCase().replace(/\s+/g, '');

export const ConvertStfDialog: React.FC<Props> = ({ stfs, pos, settings, expected, onClose, onConvert }) => {
  const [typed, setTyped] = useState('');

  const result = useMemo(() => {
    const n = norm(typed);
    if (!n) return { kind: 'empty' as const };
    const stf = stfs.find(x => norm(x.stfNo) === n);
    if (!stf) {
      const near = stfs.filter(x => norm(x.stfNo).includes(n)).slice(0, 3);
      return { kind: 'missing' as const, near };
    }
    if (expected && stf.id !== expected.id) return { kind: 'mismatch' as const, stf };
    const livePo = pos.find(p => p.stfId === stf.id && p.status !== 'cancelled');
    if (livePo) return { kind: 'hasPo' as const, stf, poNo: livePo.poNo };
    if (stf.status !== 'approved') return { kind: 'notApproved' as const, stf };
    return { kind: 'ok' as const, stf };
  }, [typed, stfs, pos, expected]);

  const stf = 'stf' in result ? result.stf : null;
  const t = stf ? stfTotals(stf) : null;

  return (
    <Modal title="Convert STF to Purchase Order" subtitle={expected ? 'Type the STF number to confirm' : 'Type the number of an approved STF'} onClose={onClose} width="max-w-lg"
      footer={<>
        <button onClick={onClose} className={btn.soft}>Cancel</button>
        <button disabled={result.kind !== 'ok'} onClick={() => result.kind === 'ok' && onConvert(result.stf)} className={btn.primary} data-testid="convert-go">
          Continue to PO <ArrowRight className="h-3.5 w-3.5" />
        </button>
      </>}>
      <div className="space-y-3">
        <Field label="STF number">
          <input value={typed} onChange={e => setTyped(e.target.value.toUpperCase())} autoFocus placeholder="e.g. STF.P2026110027"
            className={`${inputCls} font-mono text-sm`} data-testid="convert-stf-no" />
        </Field>

        {result.kind === 'empty' && <div className="text-[11px] text-slate-500">A PO can only be issued from an STF that has been approved. Its supplier, prices, VAT, terms and project carry over.</div>}

        {result.kind === 'missing' && (
          <div className="rounded-lg border border-rose-200 bg-rose-50 p-3 text-xs text-rose-700 flex gap-2">
            <XCircle className="h-4 w-4 shrink-0" />
            <div>No STF with this number.
              {result.near.length > 0 && <div className="mt-1 text-slate-600">Did you mean: {result.near.map(x => <button key={x.id} onClick={() => setTyped(x.stfNo)} className="font-mono font-bold underline mr-2 cursor-pointer">{x.stfNo}</button>)}</div>}
            </div>
          </div>
        )}
        {result.kind === 'mismatch' && <div className="rounded-lg border border-rose-200 bg-rose-50 p-3 text-xs text-rose-700 flex gap-2"><XCircle className="h-4 w-4 shrink-0" />That is {result.stf.stfNo}, not {expected?.stfNo}. Type the number of the STF you are converting.</div>}
        {result.kind === 'hasPo' && <div className="rounded-lg border border-amber-300 bg-amber-50 p-3 text-xs text-amber-800 flex gap-2"><XCircle className="h-4 w-4 shrink-0" />{result.stf.stfNo} already has {result.poNo}. One STF feeds one PO — cancel that PO first to issue another.</div>}
        {result.kind === 'notApproved' && <div className="rounded-lg border border-amber-300 bg-amber-50 p-3 text-xs text-amber-800 flex gap-2"><XCircle className="h-4 w-4 shrink-0" />{result.stf.stfNo} is <strong>{STF_STATUS_META[result.stf.status].label}</strong>{result.stf.status === 'pending' || result.stf.status === 'board' ? ` — it is with ${result.stf.queue}. It must be approved before a PO can be issued.` : ' — a PO can’t be issued from it.'}</div>}

        {stf && t && (result.kind === 'ok') && (
          <div className="rounded-lg border border-emerald-300 bg-emerald-50 p-3 text-xs space-y-1" data-testid="convert-preview">
            <div className="flex items-center gap-1.5 font-bold text-emerald-800"><CheckCircle2 className="h-4 w-4" /> Approved — ready for a PO</div>
            <div className="font-semibold text-slate-900">{stf.description}</div>
            <div className="text-slate-600">{stf.supplierName} · {stf.projectType}{stf.projectName ? ` / ${stf.projectName}` : ''} · {dateFmt(stf.date)}</div>
            <div className="flex flex-wrap gap-x-4 gap-y-0.5 text-slate-700">
              <span>{stf.lines.length} item(s)</span>
              <span className="font-mono font-bold">{money(t.total)} {stf.currency}</span>
              <span>{budgetTier(stf, settings).label}</span>
              {stf.paymentTerms && <span>{stf.paymentTerms}</span>}
            </div>
            <div className="flex items-center gap-1 text-emerald-800 pt-1"><ShoppingCart className="h-3 w-3" /> The PO editor opens pre-filled from this STF.</div>
          </div>
        )}
      </div>
    </Modal>
  );
};
