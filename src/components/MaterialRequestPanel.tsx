import React, { useEffect, useState } from 'react';
import { PackagePlus, Send, CheckCircle2, XCircle, Clock, X } from 'lucide-react';
import { getApiUrl } from '../lib/firebaseService';
import { BOMItem, MaterialRequest } from '../types';

interface MaterialRequestPanelProps {
  projectName: string;
  poolType: string;
  poolId?: string;
  poolNo?: string;
  stageId?: string;
  requestedByName: string;
  requestedByRole: string; // e.g. 'Section Supervisor - Lamination'
  onClose?: () => void;
}

// Drop this into any stage/section view, e.g.:
//   <MaterialRequestPanel projectName={pool.projectName} poolType={pool.poolType}
//     poolId={pool.id} poolNo={pool.poolNo} stageId={selectedStageId}
//     requestedByName={loggedInUser.displayName} requestedByRole="Section Supervisor" />
export const MaterialRequestPanel: React.FC<MaterialRequestPanelProps> = ({
  projectName, poolType, poolId, poolNo, stageId, requestedByName, requestedByRole, onClose,
}) => {
  const [bomLines, setBomLines] = useState<BOMItem[]>([]);
  const [myRequests, setMyRequests] = useState<MaterialRequest[]>([]);
  const [materialId, setMaterialId] = useState('');
  const [qty, setQty] = useState('');
  const [reason, setReason] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState(false);

  const load = async () => {
    try {
      const [bomAll, reqAll] = await Promise.all([
        fetch(getApiUrl('/api/bom')).then(r => r.json()),
        fetch(getApiUrl('/api/material-requests')).then(r => r.json()),
      ]);
      setBomLines((Array.isArray(bomAll) ? bomAll : []).filter((b: BOMItem) => b.projectName === projectName && b.poolType === poolType));
      setMyRequests(
        (Array.isArray(reqAll) ? reqAll : [])
          .filter((r: MaterialRequest) => r.projectName === projectName && r.poolType === poolType)
          .sort((a: MaterialRequest, b: MaterialRequest) => (a.createdAt < b.createdAt ? 1 : -1))
          .slice(0, 8)
      );
    } catch {
      // silent — panel stays usable, just without history
    }
  };

  useEffect(() => {
    load();
    const interval = setInterval(load, 20000);
    return () => clearInterval(interval);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectName, poolType]);

  const selectedLine = bomLines.find(b => b.materialId === materialId);

  const submit = async () => {
    if (!selectedLine || !qty) return;
    setSubmitting(true);
    try {
      await fetch(getApiUrl('/api/material-requests'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          projectName, poolType, poolId: poolId || null, poolNo: poolNo || null, stageId: stageId || null,
          materialId: selectedLine.materialId,
          materialName: selectedLine.materialName,
          unit: selectedLine.unit,
          qtyRequested: qty,
          reason: reason || null,
          requestedByName,
          requestedByRole,
        }),
      });
      setSubmitted(true);
      setMaterialId(''); setQty(''); setReason('');
      load();
      setTimeout(() => setSubmitted(false), 3000);
    } finally {
      setSubmitting(false);
    }
  };

  const statusIcon = (s: string) => {
    if (s === 'PENDING') return <Clock className="h-3.5 w-3.5 text-amber-400" />;
    if (s === 'REJECTED') return <XCircle className="h-3.5 w-3.5 text-rose-400" />;
    return <CheckCircle2 className="h-3.5 w-3.5 text-emerald-400" />;
  };

  return (
    <div className="bg-slate-900 border border-slate-800 rounded-xl p-4">
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2 text-sm font-bold text-white">
          <PackagePlus className="h-4 w-4 text-orange-400" /> Request Raw Material
        </div>
        {onClose && <button onClick={onClose} className="text-slate-500 hover:text-white cursor-pointer"><X className="h-4 w-4" /></button>}
      </div>

      {bomLines.length === 0 ? (
        <p className="text-xs text-slate-500">No BOM has been set up for {projectName} / {poolType} yet. Ask the Store to add material requirements for this pool type first.</p>
      ) : (
        <>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-2 mb-2">
            <select value={materialId} onChange={e => setMaterialId(e.target.value)} className="bg-slate-800 border border-slate-700 rounded-lg px-2 py-2 text-xs text-white">
              <option value="">Material…</option>
              {bomLines.map(b => <option key={b.materialId} value={b.materialId}>{b.materialName} ({Number(b.qtyPerPool)} {b.unit}/pool)</option>)}
            </select>
            <input type="number" step="any" placeholder={selectedLine ? `Qty (${selectedLine.unit})` : 'Qty'} value={qty} onChange={e => setQty(e.target.value)} className="bg-slate-800 border border-slate-700 rounded-lg px-2 py-2 text-xs text-white" />
            <input placeholder="Reason / batch note (optional)" value={reason} onChange={e => setReason(e.target.value)} className="bg-slate-800 border border-slate-700 rounded-lg px-2 py-2 text-xs text-white" />
          </div>
          <button
            onClick={submit}
            disabled={!selectedLine || !qty || submitting}
            className="w-full flex items-center justify-center gap-1.5 px-3 py-2 bg-orange-600 hover:bg-orange-700 disabled:opacity-40 disabled:cursor-not-allowed text-white rounded-lg text-xs font-bold cursor-pointer"
          >
            <Send className="h-3.5 w-3.5" /> {submitting ? 'Sending to Manager…' : 'Send Request for Approval'}
          </button>
          {submitted && <p className="text-xs text-emerald-400 mt-2 text-center">Request sent — the manager has been emailed for approval.</p>}
        </>
      )}

      {myRequests.length > 0 && (
        <div className="mt-4 pt-3 border-t border-slate-800 space-y-1.5">
          <p className="text-[10px] uppercase font-bold text-slate-500 mb-1">Recent requests for this type</p>
          {myRequests.map(r => (
            <div key={r.id} className="flex items-center justify-between text-xs">
              <span className="text-slate-300 flex items-center gap-1.5">{statusIcon(r.status)} {r.materialName} — {r.qtyRequested} {r.unit}</span>
              <span className="text-slate-600 font-mono">{new Date(r.createdAt).toLocaleDateString()}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
};

export default MaterialRequestPanel;
