import React, { useState } from 'react';
import { Plus, Trash2, Loader2 } from 'lucide-react';
import type { ProcurementSettings } from '../types';
import { Field, Modal, btn, inputCls } from './ProcurementUi';
import { ErrorLine } from './PoDetailPanel';
import { dbSaveProcurementSettings } from '../lib/firebaseService';

// Who is in the approval queue, the budget tier, and where the STF / PO numbers continue from.
// Only management can change these; everybody else sees them.

interface Props { settings: ProcurementSettings; canEdit: boolean; onClose: () => void; onSaved: () => void }

export const ProcurementSettingsDialog: React.FC<Props> = ({ settings, canEdit, onClose, onSaved }) => {
  const [approvers, setApprovers] = useState(settings.approvers.map(a => ({ ...a })));
  const [tierEur, setTierEur] = useState(String(settings.tierEur));
  const [eurToAed, setEurToAed] = useState(String(settings.eurToAed));
  const [seqYear, setSeqYear] = useState(String(settings.seqYear));
  const [lastStf, setLastStf] = useState(String(settings.lastStfSeq));
  const [lastPo, setLastPo] = useState(String(settings.lastPoSeq));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const yy = Number(seqYear) || new Date().getFullYear();
  const mm = String(new Date().getMonth() + 1).padStart(2, '0');

  const save = async () => {
    setBusy(true); setError(null);
    try {
      await dbSaveProcurementSettings({ ...settings, approvers, tierEur: Number(tierEur), eurToAed: Number(eurToAed), seqYear: Number(seqYear), lastStfSeq: Number(lastStf) || 0, lastPoSeq: Number(lastPo) || 0 });
      onSaved();
    } catch (e: any) { setError(e?.message || 'Could not save the settings.'); } finally { setBusy(false); }
  };

  return (
    <Modal title="Procurement settings" subtitle={canEdit ? 'Approval queue, budget tier and numbering' : 'Only management can change these'} onClose={onClose} width="max-w-xl"
      footer={<><button onClick={onClose} className={btn.soft}>Close</button>{canEdit && <button onClick={save} disabled={busy} className={btn.primary} data-testid="settings-save">{busy && <Loader2 className="h-3.5 w-3.5 animate-spin" />} Save</button>}</>}>
      <div className="space-y-4">
        <div>
          <div className="text-xs font-extrabold text-slate-900 mb-1">Approval queue (the “Que” names)</div>
          <div className="text-[11px] text-slate-500 mb-2">An STF is forwarded from one name to the next. Tick “final” for the people who may give the FINAL approval to an STF above the budget tier.</div>
          <div className="space-y-1.5">
            {approvers.map((a, i) => (
              <div key={i} className="flex items-center gap-2">
                <input value={a.name} onChange={e => setApprovers(l => l.map((x, j) => j === i ? { ...x, name: e.target.value.toUpperCase() } : x))} disabled={!canEdit} className={inputCls} data-testid={`approver-${i}`} />
                <label className="flex items-center gap-1 text-[11px] text-slate-700 whitespace-nowrap"><input type="checkbox" checked={a.finalForAbove} disabled={!canEdit} onChange={e => setApprovers(l => l.map((x, j) => j === i ? { ...x, finalForAbove: e.target.checked } : x))} className="accent-emerald-600" /> final above tier</label>
                {canEdit && <button onClick={() => setApprovers(l => l.filter((_, j) => j !== i))} className="text-slate-400 hover:text-rose-600 cursor-pointer"><Trash2 className="h-3.5 w-3.5" /></button>}
              </div>
            ))}
          </div>
          {canEdit && <button onClick={() => setApprovers(l => [...l, { name: '', finalForAbove: false }])} className={`${btn.soft} mt-2`}><Plus className="h-3.5 w-3.5" /> Add a name</button>}
          <div className="text-[11px] text-slate-500 mt-2">The name must match how the person is shown when they sign in (capital letters don’t matter). Management accounts can always act for anyone.</div>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <Field label="Budget tier (EUR)"><input type="number" min={1} value={tierEur} onChange={e => setTierEur(e.target.value)} disabled={!canEdit} className={`${inputCls} font-mono`} /></Field>
          <Field label="1 EUR = ? AED"><input type="number" min={0} step="any" value={eurToAed} onChange={e => setEurToAed(e.target.value)} disabled={!canEdit} className={`${inputCls} font-mono`} /></Field>
        </div>
        <div className="text-[11px] text-slate-500 -mt-2">An STF worth the tier or more shows “{tierEur} EUR +” and needs final approval from a “final” name.</div>

        <div>
          <div className="text-xs font-extrabold text-slate-900 mb-1">Numbering — carry on from the Excel sheet</div>
          <div className="grid grid-cols-3 gap-3">
            <Field label="Year"><input type="number" value={seqYear} onChange={e => setSeqYear(e.target.value)} disabled={!canEdit} className={`${inputCls} font-mono`} /></Field>
            <Field label="Last STF no. used"><input type="number" min={0} value={lastStf} onChange={e => setLastStf(e.target.value)} disabled={!canEdit} className={`${inputCls} font-mono`} /></Field>
            <Field label="Last PO no. used"><input type="number" min={0} value={lastPo} onChange={e => setLastPo(e.target.value)} disabled={!canEdit} className={`${inputCls} font-mono`} /></Field>
          </div>
          <div className="text-[11px] text-slate-500 mt-1">Next numbers: <span className="font-mono font-bold">STF.P{yy}{mm}{String((Number(lastStf) || 0) + 1).padStart(4, '0')}</span> and <span className="font-mono font-bold">PO.P{yy}{mm}{String((Number(lastPo) || 0) + 1).padStart(5, '0')}</span>. The running number does not reset each month; it starts again in January.</div>
        </div>
        <ErrorLine error={error} />
      </div>
    </Modal>
  );
};
