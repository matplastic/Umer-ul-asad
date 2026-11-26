import React from 'react';
import { ArrowDown, ArrowUp, X, UserCheck } from 'lucide-react';
import type { StfApprover } from '../types';
import { sameName } from '../lib/stf';

// Who must approve THIS purchase, in order. Pick one person or several — each approver approves their step and the
// STF moves on to the next; the last one gives the final approval. Names come from Settings → Procurement approvers.

interface Props {
  approvers: StfApprover[];
  value: string[];
  onChange: (next: string[]) => void;
  aboveTier?: boolean;          // the STF is above the budget tier → a final approver must come last
  disabled?: boolean;
}

export const ApprovalRoutePicker: React.FC<Props> = ({ approvers, value, onChange, aboveTier, disabled }) => {
  const left = approvers.filter(a => !value.some(v => sameName(v, a.name)));
  const finals = approvers.filter(a => a.finalForAbove);
  const lastOk = value.length > 0 && approvers.find(a => sameName(a.name, value[value.length - 1]))?.finalForAbove;
  const move = (i: number, d: number) => {
    const j = i + d;
    if (j < 0 || j >= value.length) return;
    const n = [...value]; [n[i], n[j]] = [n[j], n[i]]; onChange(n);
  };
  return (
    <div className="space-y-2" data-testid="approval-route">
      <div className="flex flex-wrap items-center gap-2">
        {value.length === 0 && <span className="text-[11px] text-amber-700">Pick at least one approver.</span>}
        {value.map((n, i) => (
          <span key={n} className="inline-flex items-center gap-1 rounded-full border border-primary-300 bg-primary-50 pl-2 pr-1 py-1 text-[11px] font-bold text-slate-800" data-testid={`approval-step-${i}`}>
            <span className="h-4 w-4 rounded-full bg-primary-600 text-white text-[9px] font-black flex items-center justify-center">{i + 1}</span>
            {n}{approvers.find(a => sameName(a.name, n))?.finalForAbove ? <span title="May give final approval above the budget tier"><UserCheck className="h-3 w-3 text-emerald-600" /></span> : null}
            {!disabled && <>
              <button type="button" onClick={() => move(i, -1)} disabled={i === 0} className="text-slate-400 hover:text-slate-800 disabled:opacity-30 cursor-pointer" title="Earlier"><ArrowUp className="h-3 w-3" /></button>
              <button type="button" onClick={() => move(i, 1)} disabled={i === value.length - 1} className="text-slate-400 hover:text-slate-800 disabled:opacity-30 cursor-pointer" title="Later"><ArrowDown className="h-3 w-3" /></button>
              <button type="button" onClick={() => onChange(value.filter(x => x !== n))} className="text-slate-400 hover:text-rose-600 cursor-pointer" title="Remove" data-testid={`approval-remove-${i}`}><X className="h-3 w-3" /></button>
            </>}
          </span>
        ))}
        {!disabled && left.length > 0 && (
          <select value="" onChange={e => { if (e.target.value) onChange([...value, e.target.value]); }} className="bg-white border border-slate-300 rounded-lg px-2 py-1.5 text-xs text-slate-900" data-testid="approval-add">
            <option value="">+ Add approver…</option>
            {left.map(a => <option key={a.name} value={a.name}>{a.name}{a.finalForAbove ? ' (final approval above tier)' : ''}</option>)}
          </select>
        )}
      </div>
      <div className="text-[11px] text-slate-500">
        {value.length > 1 ? `Goes to ${value[0]} first; after each approval it moves to the next person. ${value[value.length - 1]} gives the final approval.` : value.length === 1 ? `${value[0]} gives the approval.` : ''}
      </div>
      {aboveTier && value.length > 0 && !lastOk && finals.length > 0 && (
        <div className="text-[11px] text-amber-700">This STF is above the budget tier — {finals.map(f => f.name).join(' or ')} will be placed last as the final approver.</div>
      )}
    </div>
  );
};
