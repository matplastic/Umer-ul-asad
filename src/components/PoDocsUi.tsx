import React, { useMemo, useState } from 'react';
import { FileText, ExternalLink, Upload, X, Loader2, AlertTriangle } from 'lucide-react';
import type { IncomingMaterial, PurchaseOrder } from '../types';
import { poDocStatus, type DocLevel, type PoDelivery, type PoDeliveryFile, type PoDocStatus } from '../lib/poDocs';
import { uploadGrnFile, deleteGrnFile, validateGrnFile, GRN_ACCEPT, KIND_LABEL, type GrnDocKind } from '../lib/grnAttachments';
import { dbUpdateIncomingMaterialDocs } from '../lib/firebaseService';
import { dateFmt, qtyFmt } from '../lib/procurement';

// Supplier DO / invoice paperwork for a purchase order, one card per delivery.
// Used in the Procurement portal (PO details + PO list badge) and in the Store (Incoming → Receive against a PO).

const LEVEL_STYLE: Record<DocLevel, { dot: string; box: string; text: string }> = {
  none:   { dot: 'bg-slate-300',   box: 'border-slate-200 bg-slate-50',     text: 'text-slate-500' },
  green:  { dot: 'bg-emerald-500', box: 'border-emerald-300 bg-emerald-50', text: 'text-emerald-800' },
  yellow: { dot: 'bg-amber-400',   box: 'border-amber-300 bg-amber-50',     text: 'text-amber-800' },
  red:    { dot: 'bg-rose-500',    box: 'border-rose-300 bg-rose-50',       text: 'text-rose-800' },
};

// Small coloured dot + text — for tables.
export const PoDocsBadge: React.FC<{ status: PoDocStatus }> = ({ status }) => {
  const s = LEVEL_STYLE[status.level];
  if (status.level === 'none') return <span className="text-slate-300" title={status.hint}>—</span>;
  return (
    <span title={status.hint} data-testid={`po-docs-badge-${status.level}`} className="inline-flex items-center gap-1.5 whitespace-nowrap">
      <span className={`h-2.5 w-2.5 rounded-full ${s.dot}`} />
      <span className={`text-[11px] font-bold ${s.text}`}>{status.label}</span>
    </span>
  );
};

interface Props {
  po: PurchaseOrder;
  incoming: IncomingMaterial[];
  currentUserName: string;
  onChanged: () => Promise<void> | void;
  readOnly?: boolean;
}

export const PoDeliveryDocs: React.FC<Props> = ({ po, incoming, currentUserName, onChanged, readOnly }) => {
  const status = useMemo(() => poDocStatus(po, incoming), [po, incoming]);
  const [busyKey, setBusyKey] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const s = LEVEL_STYLE[status.level];

  const upload = async (d: PoDelivery, kind: GrnDocKind, files: FileList | null) => {
    const list = Array.from(files || []);
    if (!list.length) return;
    setError(null);
    for (const f of list) { const bad = validateGrnFile(f); if (bad) { setError(bad); return; } }
    setBusyKey(d.key);
    try {
      const uploaded = [];
      for (const f of list) uploaded.push(await uploadGrnFile(f, d.holderId, kind, currentUserName));
      await dbUpdateIncomingMaterialDocs(d.holderId, { addAttachments: uploaded });
      await onChanged();
    } catch (e: any) {
      setError(`Upload failed: ${e?.message || e}`);
    } finally { setBusyKey(null); }
  };

  const remove = async (d: PoDelivery, f: PoDeliveryFile) => {
    if (!window.confirm(`Remove ${KIND_LABEL[f.att.kind]} file "${f.att.name}" from this delivery?`)) return;
    setError(null); setBusyKey(d.key);
    try {
      await dbUpdateIncomingMaterialDocs(f.receiptId, { removeAttachmentIds: [f.att.id] });
      await deleteGrnFile(f.att);
      await onChanged();
    } catch (e: any) {
      setError(`Could not remove the file: ${e?.message || e}`);
    } finally { setBusyKey(null); }
  };

  const uploadBtn = (d: PoDelivery, kind: GrnDocKind, label: string) => (
    <label className={`inline-flex items-center gap-1 px-2.5 py-1 rounded-lg text-[11px] font-bold border cursor-pointer ${busyKey === d.key ? 'opacity-50 pointer-events-none' : 'bg-white hover:bg-slate-100 border-slate-300 text-slate-700'}`}>
      {busyKey === d.key ? <Loader2 className="h-3 w-3 animate-spin" /> : <Upload className="h-3 w-3" />} {label}
      <input type="file" multiple accept={GRN_ACCEPT} className="hidden" data-testid={`po-docs-${kind}-${d.key}`}
        onChange={(e) => { upload(d, kind, e.target.files); e.target.value = ''; }} />
    </label>
  );

  return (
    <div data-testid="po-docs" className="space-y-2">
      <div className={`rounded-xl border px-3 py-2 flex items-center gap-2 text-xs ${s.box}`}>
        <span className={`h-3 w-3 rounded-full shrink-0 ${s.dot}`} />
        <span className={`font-extrabold ${s.text}`}>Supplier DO / invoice</span>
        <span className="text-slate-600">{status.hint}</span>
      </div>

      {error && <div className="rounded-lg border border-rose-300 bg-rose-50 px-3 py-2 text-xs text-rose-700 flex items-start gap-2"><AlertTriangle className="h-4 w-4 shrink-0" />{error}</div>}

      {status.deliveries.map((d, i) => (
        <div key={d.key} data-testid={`po-delivery-${i + 1}`} className={`rounded-xl border border-slate-200 border-l-4 px-3 py-2 ${d.documented ? 'border-l-emerald-500' : 'border-l-rose-500'}`}>
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
            <span className="text-xs font-extrabold text-slate-900">Delivery {i + 1}</span>
            <span className="text-[11px] text-slate-500">{dateFmt(d.receivedAt)}</span>
            {d.doNo && <span className="text-[11px] font-mono text-sky-700">DO {d.doNo}</span>}
            {d.invoiceNo && <span className="text-[11px] font-mono text-slate-700">Inv {d.invoiceNo}</span>}
            <span className={`ml-auto px-2 py-0.5 rounded-full text-[10px] font-black uppercase border ${d.documented ? 'bg-emerald-50 text-emerald-700 border-emerald-200' : 'bg-rose-50 text-rose-700 border-rose-200'}`}>
              {d.documented ? `${[d.hasDo && 'DO', d.hasInvoice && 'Invoice'].filter(Boolean).join(' + ')} uploaded` : 'DO / invoice missing'}
            </span>
          </div>
          <div className="text-[11px] text-slate-500 mt-0.5">{d.receipts.map((r) => `${r.materialName} ${qtyFmt(r.qty)} ${r.unit}`).join(' · ')}</div>
          <div className="flex flex-wrap items-center gap-1.5 mt-2">
            {d.files.map((f) => (
              <span key={f.att.id} className="inline-flex items-center gap-1 pl-2 pr-1 py-0.5 rounded-md bg-slate-100 border border-slate-300 text-[10px] font-bold text-sky-700">
                <a href={f.att.url} target="_blank" rel="noopener noreferrer" title={f.att.name} className="inline-flex items-center gap-1 hover:underline">
                  <FileText className="h-3 w-3" /> {KIND_LABEL[f.att.kind]} <span className="font-normal text-slate-500 max-w-[140px] truncate">{f.att.name}</span> <ExternalLink className="h-2.5 w-2.5 opacity-60" />
                </a>
                {!readOnly && <button onClick={() => remove(d, f)} title="Remove this file" className="p-0.5 text-slate-400 hover:text-rose-600 cursor-pointer"><X className="h-3 w-3" /></button>}
              </span>
            ))}
            {d.files.length === 0 && <span className="text-[11px] text-rose-700">No file uploaded yet.</span>}
            {!readOnly && <span className="ml-auto flex gap-1.5">{uploadBtn(d, 'do', '+ DO')}{uploadBtn(d, 'invoice', '+ Invoice')}</span>}
          </div>
        </div>
      ))}
    </div>
  );
};
