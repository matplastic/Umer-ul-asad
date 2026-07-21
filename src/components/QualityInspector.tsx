import React, { useState } from 'react';
import { Pool, StageId, ActivityLog, IncomingMaterial } from '../types';
import { STAGES, DUAL_STAGE_IDS, isAtDualStageGate } from '../data/mockData';
import { ShieldCheck, ShieldAlert, CheckCircle2, XCircle, Search, FileText, ClipboardList, AlertCircle, Compass, Ruler, Trash2, Filter, Camera, UploadCloud, Image as ImageIcon, RefreshCw, Clock, PauseCircle, PackageSearch } from 'lucide-react';
import { QCDefectPanel, QCDefectBadge, QCDefect } from './QCDefectPanel';
import { DailyDefectReport } from './DailyDefectReport';
import { dbFetchIncomingMaterials, dbDecideIncomingQc } from '../lib/firebaseService';

interface UndoClaimRequest {
  id: string;
  poolId: string;
  poolNo: string;
  projectName: string;
  stageId: StageId;
  stageName: string;
  teamName: string;
  reason: string;
  requestedAt: string;
}

interface QualityInspectorProps {
  pools: Pool[];
  allTeams: any[];
  onApproveStage: (poolId: string, stageId: StageId, inspectorId: string, notes: string, picture?: string) => void;
  onRejectStage: (poolId: string, stageId: StageId, inspectorId: string, notes: string, picture?: string) => void;
  inspectors?: { id: string; name: string; title: string }[];
  onDeletePool?: (poolId: string, operatorName: string) => void;
  onSkipOrCarryOnSite?: (poolId: string, stageId: StageId, option: 'SKIPPED' | 'CARRIED_ON_SITE', operatorName: string) => void;
  pendingUndoRequests?: UndoClaimRequest[];
  onApproveUndo?: (requestId: string, poolId: string, stageId: StageId, inspectorName: string) => void;
  onRejectUndo?: (requestId: string) => void;
  onRefresh?: () => void;
  isSyncing?: boolean;
  // QC Defect props
  qcDefects?: QCDefect[];
  onLogDefect?: (defect: QCDefect) => void;
  onUpdateDefectStatus?: (defectId: string, newStatus: QCDefect['status'], operatorName: string) => void;
  // Daily Defect Report portal (auto-generated from logs + qcDefects)
  logs?: ActivityLog[];
}

export const QualityInspector: React.FC<QualityInspectorProps> = ({
  pools,
  allTeams,
  onApproveStage,
  onRejectStage,
  inspectors = [],
  onDeletePool,
  onSkipOrCarryOnSite,
  pendingUndoRequests = [],
  onApproveUndo,
  onRejectUndo,
  onRefresh,
  isSyncing,
  qcDefects = [],
  onLogDefect,
  onUpdateDefectStatus,
  logs = [],
}) => {
  const [activeTab, setActiveTab] = useState<'queue' | 'incoming_qc' | 'daily_report'>('queue');
  const [selectedInspector, setSelectedInspector] = useState(inspectors[0]?.name || '');
  const [activePoolId, setActivePoolId] = useState<string | null>(null);
  const [reviewerNotes, setReviewerNotes] = useState('');
  const [uploadedPicture, setUploadedPicture] = useState<string | null>(null);
  const [errorMsg, setErrorMsg] = useState('');
  const [filterMode, setFilterMode] = useState<'pending' | 'all'>('pending');
  const [searchQuery, setSearchQuery] = useState('');
  const [reviewStageId, setReviewStageId] = useState<StageId | null>(null);

  // ---------- Incoming Material QC gate ----------
  const [incomingMaterials, setIncomingMaterials] = useState<IncomingMaterial[]>([]);
  const [incomingLoading, setIncomingLoading] = useState(false);
  const [incomingError, setIncomingError] = useState('');
  const [incomingQcNotes, setIncomingQcNotes] = useState<Record<string, string>>({});
  const [incomingQcQty, setIncomingQcQty] = useState<Record<string, string>>({});

  const loadIncomingMaterials = React.useCallback(async () => {
    setIncomingLoading(true);
    setIncomingError('');
    try {
      const rows = await dbFetchIncomingMaterials();
      setIncomingMaterials(rows);
    } catch (e) {
      setIncomingError('Could not load incoming material receipts. Try Refresh.');
    } finally {
      setIncomingLoading(false);
    }
  }, []);

  React.useEffect(() => {
    loadIncomingMaterials();
  }, [loadIncomingMaterials]);

  React.useEffect(() => {
    if (activeTab === 'incoming_qc') loadIncomingMaterials();
  }, [activeTab, loadIncomingMaterials]);

  // How much of this GRN still needs a first look, and how much is parked
  // in Hold waiting to be resolved into a final passed/failed outcome.
  const qtyPendingOf = (inc: IncomingMaterial) =>
    Math.max(0, Number(inc.qty || 0) - Number(inc.qtyPassed || 0) - Number(inc.qtyFailed || 0) - Number(inc.qtyHold || 0));
  const qtyHoldOf = (inc: IncomingMaterial) => Number(inc.qtyHold || 0);

  const decideIncomingQc = async (
    inc: IncomingMaterial,
    decision: 'passed' | 'failed' | 'hold',
    sourceBucket: 'pending' | 'hold',
    decideQty: number
  ) => {
    const notes = incomingQcNotes[inc.id] || '';
    if (decision !== 'passed' && !notes.trim()) {
      if (!confirm(`No reason noted for ${decision === 'failed' ? 'rejecting' : 'holding'} this quantity. Continue anyway?`)) return;
    }
    if (!selectedInspector) {
      alert('Select an Inspector ID before recording a decision.');
      return;
    }
    if (!decideQty || decideQty <= 0) {
      alert('Enter a quantity greater than zero to decide.');
      return;
    }
    await dbDecideIncomingQc(inc.id, decision, selectedInspector, notes || null, decideQty, sourceBucket);
    setIncomingQcNotes(p => { const n = { ...p }; delete n[inc.id]; return n; });
    setIncomingQcQty(p => { const n = { ...p }; delete n[inc.id]; return n; });
    loadIncomingMaterials();
  };

  const incomingQcPill = (status?: string) => {
    const map: Record<string, string> = {
      pending: 'bg-amber-50 text-amber-700 border-amber-200',
      partial: 'bg-sky-50 text-sky-700 border-sky-200',
      passed: 'bg-emerald-50 text-emerald-700 border-emerald-200',
      failed: 'bg-rose-50 text-rose-700 border-rose-200',
      hold: 'bg-slate-100 text-slate-600 border-slate-300',
      mixed: 'bg-violet-50 text-violet-700 border-violet-200',
    };
    const s = status || 'pending';
    const label: Record<string, string> = {
      pending: 'Pending QC', partial: 'Partially Decided', passed: 'Passed',
      failed: 'Rejected', hold: 'On Hold', mixed: 'Split Outcome',
    };
    return <span className={`px-2 py-0.5 rounded-full text-[10px] font-black uppercase border ${map[s] || map.pending}`}>{label[s] || s}</span>;
  };

  // Awaiting inspector action: anything with a fresh, never-decided qty
  // (pending/partial), or qty parked in Hold waiting to be resolved.
  const pendingIncoming = incomingMaterials.filter(i => qtyPendingOf(i) > 0 || qtyHoldOf(i) > 0)
    .slice().sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
  // Fully resolved — every unit accounted for as passed/failed, nothing
  // left pending or on hold. Kept here as a read-only audit reference.
  const heldOrRejectedIncoming = incomingMaterials.filter(i => qtyPendingOf(i) === 0 && qtyHoldOf(i) === 0 && (i.qcStatus === 'failed' || i.qcStatus === 'mixed' || i.qcStatus === 'passed'))
    .slice().sort((a, b) => ((a.qcAt || '') < (b.qcAt || '') ? 1 : -1));

  React.useEffect(() => {
    if (inspectors.length > 0 && !inspectors.some(i => i.name === selectedInspector)) {
      setSelectedInspector(inspectors[0].name);
    }
  }, [inspectors, selectedInspector]);

  // NOTE: reviewStageId is now set explicitly wherever activePoolId changes
  // (see the pool-list onClick handler and the auto-select effect below).
  // We intentionally do NOT force-reset it here on every activePoolId change,
  // since that used to wipe out the correct dual-gate sibling stage selection
  // right after it was set by the click handler.

  const pendingPools = pools.filter((p) => {
    if (p.currentStageIndex >= STAGES.length) return false;
    // While parked anywhere in the shared Skimmer Fitting/Lamination gate
    // range, either sibling stage can independently be waiting on QC sign-off.
    if (isAtDualStageGate(p.currentStageIndex)) {
      return DUAL_STAGE_IDS.some((id) => p.stageHistory[id]?.status === 'PENDING_INSPECTION');
    }
    const currentStageId = STAGES[p.currentStageIndex].id;
    return p.stageHistory[currentStageId]?.status === 'PENDING_INSPECTION';
  });

  const displayedPools = (filterMode === 'pending' ? pendingPools : pools).filter(p => {
    if (!searchQuery.trim()) return true;
    const matchVal = searchQuery.toLowerCase();
    return p.projectName.toLowerCase().includes(matchVal) || p.poolNo.toLowerCase().includes(matchVal);
  });

  const activeReviewPool = pools.find((p) => p.id === activePoolId);
  const activeReviewStageId = reviewStageId || (activeReviewPool && activeReviewPool.currentStageIndex < STAGES.length
    ? STAGES[activeReviewPool.currentStageIndex].id
    : null);
  const activeReviewStage = STAGES.find(s => s.id === activeReviewStageId) || null;
  const activeReviewHistory = activeReviewPool && activeReviewStage ? activeReviewPool.stageHistory[activeReviewStage.id] : null;
  const activeReviewTeam = activeReviewHistory && allTeams.find(t => t.id === activeReviewHistory.teamId);

  const isPendingInspection = activeReviewPool && activeReviewStage &&
    activeReviewPool.stageHistory[activeReviewStage.id]?.status === 'PENDING_INSPECTION';

  React.useEffect(() => {
    if (displayedPools.length > 0 && (!activePoolId || !pools.some(p => p.id === activePoolId))) {
      const nextPool = displayedPools[0];
      setActivePoolId(nextPool.id);
      // Same rule as the manual click handler: if this pool is parked at the
      // shared Skimmer Fitting / Lamination gate, land on whichever sibling
      // stage is actually still pending QC, not just STAGES[currentStageIndex].
      if (isAtDualStageGate(nextPool.currentStageIndex)) {
        const pendingSibling = DUAL_STAGE_IDS.find((id) => nextPool.stageHistory[id]?.status === 'PENDING_INSPECTION')
          || DUAL_STAGE_IDS.find((id) => nextPool.stageHistory[id]?.status !== 'APPROVED')
          || DUAL_STAGE_IDS[0];
        setReviewStageId(pendingSibling);
      } else {
        setReviewStageId(null);
      }
    } else if (displayedPools.length === 0) {
      setActivePoolId(null);
    }
  }, [filterMode, searchQuery, pools.length]);

  const handleApprove = () => {
    if (!activeReviewPool || !activeReviewStage) return;
    if (!reviewerNotes.trim()) {
      setErrorMsg('Please write inspection notes before approving.');
      return;
    }
    setErrorMsg('');
    onApproveStage(activeReviewPool.id, activeReviewStage.id, selectedInspector, reviewerNotes.trim(), uploadedPicture || undefined);
    setReviewerNotes('');
    setUploadedPicture(null);
    setActivePoolId(null);
  };

  const handleReject = () => {
    if (!activeReviewPool || !activeReviewStage) return;
    if (!reviewerNotes.trim()) {
      setErrorMsg('Please specify rejection reasons (needs detailed notes for the team to fix).');
      return;
    }
    setErrorMsg('');
    onRejectStage(activeReviewPool.id, activeReviewStage.id, selectedInspector, reviewerNotes.trim(), uploadedPicture || undefined);
    setReviewerNotes('');
    setUploadedPicture(null);
    setActivePoolId(null);
  };

  return (
    <div className="space-y-6">

      {/* ── Undo Claim Requests Panel ─────────────────────────────────────────── */}
      {pendingUndoRequests.length > 0 && (
        <div className="bg-amber-50 border-2 border-amber-300 rounded-2xl p-5 shadow-sm">
          <div className="flex items-center gap-2 mb-4">
            <span className="text-lg">⚠</span>
            <h3 className="font-black text-amber-800 text-sm uppercase tracking-wider">
              Undo Claim Requests ({pendingUndoRequests.length})
            </h3>
            <span className="ml-auto text-xs text-amber-600 font-semibold">
              Workers requesting you to unclaim a pool so correct team can pick it
            </span>
          </div>
          <div className="space-y-3">
            {pendingUndoRequests.map(req => (
              <div key={req.id} className="bg-white rounded-xl border border-amber-200 p-4 flex flex-wrap items-center justify-between gap-3">
                <div className="space-y-1">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="font-black text-slate-800 text-sm">{req.poolNo}</span>
                    <span className="text-slate-400 text-xs">—</span>
                    <span className="text-slate-600 text-xs">{req.projectName}</span>
                    <span className="bg-amber-100 text-amber-700 text-[10px] font-bold px-2 py-0.5 rounded-full">{req.stageName}</span>
                  </div>
                  <p className="text-xs text-slate-500"><span className="font-semibold text-slate-700">Team:</span> {req.teamName}</p>
                  <p className="text-xs text-slate-500"><span className="font-semibold text-slate-700">Reason:</span> {req.reason}</p>
                  <p className="text-[10px] text-slate-400">
                    Requested: {new Date(req.requestedAt).toLocaleString('en-GB', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' })}
                  </p>
                </div>
                <div className="flex gap-2">
                  <button onClick={() => onApproveUndo && onApproveUndo(req.id, req.poolId, req.stageId as StageId, selectedInspector)}
                    className="flex items-center gap-1.5 bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-bold px-3 py-2 rounded-lg transition-colors">
                    <CheckCircle2 className="h-3.5 w-3.5" /> Approve Undo
                  </button>
                  <button onClick={() => onRejectUndo && onRejectUndo(req.id)}
                    className="flex items-center gap-1.5 bg-rose-50 hover:bg-rose-100 text-rose-700 border border-rose-200 text-xs font-bold px-3 py-2 rounded-lg transition-colors">
                    <XCircle className="h-3.5 w-3.5" /> Reject
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Title Header */}
      <div className="flex flex-col md:flex-row md:items-center md:justify-between bg-white p-6 rounded-2xl border border-slate-100 shadow-sm gap-4">
        <div>
          <h2 className="text-xl font-bold text-slate-800 tracking-tight flex items-center gap-2">
            <ShieldCheck className="h-6 w-6 text-emerald-500" />
            Quality Control Inspection Gates
          </h2>
          <p className="text-sm text-slate-500 font-sans">
            Review completed shop floor steps, verify build tolerances, and grant fabrication certificates.
          </p>
        </div>

        <div className="flex items-center gap-2.5 flex-wrap">
          <div className="flex items-center gap-1 bg-slate-100 p-1 rounded-xl">
            <button
              type="button"
              onClick={() => setActiveTab('queue')}
              className={`px-3 py-1.5 rounded-lg text-xs font-black transition-colors cursor-pointer ${
                activeTab === 'queue' ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-500 hover:text-slate-800'
              }`}
            >
              Inspection Queue
            </button>
            <button
              type="button"
              onClick={() => setActiveTab('incoming_qc')}
              className={`px-3 py-1.5 rounded-lg text-xs font-black transition-colors cursor-pointer ${
                activeTab === 'incoming_qc' ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-500 hover:text-slate-800'
              }`}
            >
              Incoming Material QC
              {pendingIncoming.length > 0 && (
                <span className="ml-1.5 inline-flex items-center justify-center min-w-[16px] h-4 px-1 rounded-full bg-amber-500 text-white text-[9px]">
                  {pendingIncoming.length}
                </span>
              )}
            </button>
            <button
              type="button"
              onClick={() => setActiveTab('daily_report')}
              className={`px-3 py-1.5 rounded-lg text-xs font-black transition-colors cursor-pointer ${
                activeTab === 'daily_report' ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-500 hover:text-slate-800'
              }`}
            >
              Daily Defect Report
            </button>
          </div>
          <div className="flex items-center gap-2.5 bg-slate-50 border border-slate-100 p-3 rounded-xl">
            <label className="text-xs font-bold text-slate-500 uppercase tracking-wider">Inspector ID:</label>
            <select
              value={selectedInspector}
              onChange={(e) => setSelectedInspector(e.target.value)}
              className="bg-white border border-slate-200 text-xs text-slate-700 font-bold px-3 py-1.5 cursor-pointer focus:outline-none rounded-md"
            >
              {inspectors.length > 0 ? (
                inspectors.map((inspector) => (
                  <option key={inspector.id} value={inspector.name}>
                    {inspector.name} ({inspector.title})
                  </option>
                ))
              ) : (
                <option value="" disabled>— No inspectors registered yet (add via Planning ▸ Roles) —</option>
              )}
            </select>
          </div>
          {onRefresh && (
            <button
              onClick={onRefresh}
              disabled={isSyncing}
              className="flex items-center gap-1.5 text-xs font-bold bg-emerald-50 hover:bg-emerald-100 text-emerald-700 border border-emerald-200 px-3 py-2 rounded-xl transition-colors disabled:opacity-50"
            >
              <RefreshCw className={`h-3.5 w-3.5 ${isSyncing ? 'animate-spin' : ''}`} />
              {isSyncing ? 'Syncing...' : 'Sync Latest'}
            </button>
          )}
        </div>
      </div>

      {activeTab === 'daily_report' ? (
        <DailyDefectReport
          logs={logs}
          qcDefects={qcDefects}
          pools={pools}
        />
      ) : activeTab === 'incoming_qc' ? (
        <div className="space-y-6 font-sans">
          <div className="bg-white border border-slate-100 rounded-2xl shadow-sm overflow-hidden">
            <div className="px-5 py-3 border-b border-slate-100 flex items-center justify-between flex-wrap gap-2">
              <div className="text-xs font-black uppercase tracking-wider text-slate-600 flex items-center gap-1.5">
                <Clock className="h-3.5 w-3.5 text-amber-500" />
                Awaiting Inspection ({pendingIncoming.length})
              </div>
              <button
                onClick={loadIncomingMaterials}
                disabled={incomingLoading}
                className="flex items-center gap-1.5 text-[11px] font-bold bg-emerald-50 hover:bg-emerald-100 text-emerald-700 border border-emerald-200 px-2.5 py-1.5 rounded-lg transition-colors disabled:opacity-50"
              >
                <RefreshCw className={`h-3 w-3 ${incomingLoading ? 'animate-spin' : ''}`} />
                {incomingLoading ? 'Loading...' : 'Refresh'}
              </button>
            </div>

            {incomingError && (
              <div className="px-5 py-3 text-xs font-semibold text-rose-700 bg-rose-50 border-b border-rose-100 flex items-center gap-2">
                <AlertCircle className="h-4 w-4" /> {incomingError}
              </div>
            )}

            <div className="overflow-x-auto">
              <table className="w-full min-w-[1000px] text-xs">
                <thead>
                  <tr className="bg-slate-50 text-slate-500 uppercase text-[10px]">
                    <th className="text-left px-4 py-2 font-bold">Received</th>
                    <th className="text-left px-4 py-2 font-bold">Material</th>
                    <th className="text-right px-4 py-2 font-bold">Total Qty</th>
                    <th className="text-left px-4 py-2 font-bold">Supplier</th>
                    <th className="text-left px-4 py-2 font-bold">Received By</th>
                    <th className="text-left px-4 py-2 font-bold">Split So Far</th>
                    <th className="text-left px-4 py-2 font-bold">Decide Qty + Notes</th>
                    <th className="text-right px-4 py-2 font-bold">Decision</th>
                  </tr>
                </thead>
                <tbody>
                  {pendingIncoming.map(inc => {
                    const pendingQty = qtyPendingOf(inc);
                    const holdQty = qtyHoldOf(inc);
                    // Decide fresh pending qty first; once that's exhausted,
                    // fall through to resolving whatever's parked in Hold.
                    const sourceBucket: 'pending' | 'hold' = pendingQty > 0 ? 'pending' : 'hold';
                    const availableQty = sourceBucket === 'pending' ? pendingQty : holdQty;
                    const draftQty = incomingQcQty[inc.id] !== undefined ? incomingQcQty[inc.id] : String(availableQty);
                    const passedSoFar = Number(inc.qtyPassed || 0);
                    const failedSoFar = Number(inc.qtyFailed || 0);
                    return (
                      <tr key={inc.id} className="border-t border-slate-100 align-top">
                        <td className="px-4 py-2 text-slate-500 font-mono">{new Date(inc.receivedAt).toLocaleDateString()}</td>
                        <td className="px-4 py-2 text-slate-800 font-semibold">{inc.materialName}</td>
                        <td className="px-4 py-2 text-right text-slate-700 font-mono">{Number(inc.qty)} {inc.unit}</td>
                        <td className="px-4 py-2 text-slate-500">{inc.supplier || '—'}</td>
                        <td className="px-4 py-2 text-slate-500">{inc.receivedByName}</td>
                        <td className="px-4 py-2 text-[10px] space-y-0.5">
                          {passedSoFar > 0 && <div className="text-emerald-700 font-bold">Passed: {passedSoFar} {inc.unit}</div>}
                          {failedSoFar > 0 && <div className="text-rose-700 font-bold">Rejected: {failedSoFar} {inc.unit}</div>}
                          {holdQty > 0 && <div className="text-slate-600 font-bold">On Hold: {holdQty} {inc.unit}</div>}
                          {pendingQty > 0 && <div className="text-amber-700 font-bold">Awaiting first look: {pendingQty} {inc.unit}</div>}
                          {passedSoFar === 0 && failedSoFar === 0 && holdQty === 0 && <div className="text-slate-400">Not yet inspected</div>}
                        </td>
                        <td className="px-4 py-2 space-y-1.5">
                          <div className="flex items-center gap-1.5">
                            <input
                              type="number"
                              min={0}
                              max={availableQty}
                              step="any"
                              value={draftQty}
                              onChange={e => setIncomingQcQty(p => ({ ...p, [inc.id]: e.target.value }))}
                              className="bg-white border border-slate-200 rounded-lg px-2 py-1.5 text-xs text-slate-800 w-24 focus:outline-none focus:ring-2 focus:ring-slate-300"
                            />
                            <span className="text-[10px] text-slate-500">of {availableQty} {inc.unit} {sourceBucket === 'hold' ? 'on hold' : 'pending'}</span>
                          </div>
                          <input
                            placeholder="Reason (required for hold/reject)"
                            value={incomingQcNotes[inc.id] || ''}
                            onChange={e => setIncomingQcNotes(p => ({ ...p, [inc.id]: e.target.value }))}
                            className="bg-white border border-slate-200 rounded-lg px-2 py-1.5 text-xs text-slate-800 w-full focus:outline-none focus:ring-2 focus:ring-slate-300"
                          />
                        </td>
                        <td className="px-4 py-2">
                          <div className="flex items-center justify-end gap-1.5 flex-wrap">
                            <button onClick={() => decideIncomingQc(inc, 'passed', sourceBucket, Number(draftQty))} data-testid={`qc-pass-${inc.id}`} title="Pass this quantity — add to inventory" className="flex items-center gap-1 px-2.5 py-1.5 bg-emerald-600 hover:bg-emerald-700 text-white rounded-lg text-[10px] font-bold cursor-pointer">
                              <CheckCircle2 className="h-3.5 w-3.5" /> Pass
                            </button>
                            {sourceBucket === 'pending' && (
                              <button onClick={() => decideIncomingQc(inc, 'hold', sourceBucket, Number(draftQty))} data-testid={`qc-hold-${inc.id}`} title="Hold this quantity — needs a re-check" className="flex items-center gap-1 px-2.5 py-1.5 bg-slate-600 hover:bg-slate-700 text-white rounded-lg text-[10px] font-bold cursor-pointer">
                                <PauseCircle className="h-3.5 w-3.5" /> Hold
                              </button>
                            )}
                            <button onClick={() => decideIncomingQc(inc, 'failed', sourceBucket, Number(draftQty))} data-testid={`qc-fail-${inc.id}`} title="Reject this quantity — will not enter inventory" className="flex items-center gap-1 px-2.5 py-1.5 bg-rose-600 hover:bg-rose-700 text-white rounded-lg text-[10px] font-bold cursor-pointer">
                              <XCircle className="h-3.5 w-3.5" /> Reject
                            </button>
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                  {!incomingLoading && pendingIncoming.length === 0 && (
                    <tr><td colSpan={8} className="text-center text-slate-400 py-10">Nothing waiting on inspection. New GRNs logged by Store will show up here.</td></tr>
                  )}
                  {incomingLoading && pendingIncoming.length === 0 && (
                    <tr><td colSpan={8} className="text-center text-slate-400 py-10">Loading incoming material receipts…</td></tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>

          <div className="bg-white border border-slate-100 rounded-2xl shadow-sm overflow-hidden">
            <div className="px-5 py-3 border-b border-slate-100 text-xs font-black uppercase tracking-wider text-slate-600 flex items-center gap-1.5">
              <ShieldAlert className="h-3.5 w-3.5 text-rose-500" />
              Fully Resolved — audit reference (nothing left pending or on hold)
            </div>
            <div className="overflow-x-auto">
              <table className="w-full min-w-[900px] text-xs">
                <thead>
                  <tr className="bg-slate-50 text-slate-500 uppercase text-[10px]">
                    <th className="text-left px-4 py-2 font-bold">Received</th>
                    <th className="text-left px-4 py-2 font-bold">Material</th>
                    <th className="text-right px-4 py-2 font-bold">Total Qty</th>
                    <th className="text-left px-4 py-2 font-bold">Supplier</th>
                    <th className="text-left px-4 py-2 font-bold">Outcome</th>
                    <th className="text-left px-4 py-2 font-bold">Inspector</th>
                    <th className="text-left px-4 py-2 font-bold">Notes</th>
                    <th className="px-4 py-2"></th>
                  </tr>
                </thead>
                <tbody>
                  {heldOrRejectedIncoming.map(inc => (
                    <tr key={inc.id} className="border-t border-slate-100">
                      <td className="px-4 py-2 text-slate-500 font-mono">{new Date(inc.receivedAt).toLocaleDateString()}</td>
                      <td className="px-4 py-2 text-slate-800 font-semibold">{inc.materialName}</td>
                      <td className="px-4 py-2 text-right text-slate-700 font-mono">{Number(inc.qty)} {inc.unit}</td>
                      <td className="px-4 py-2 text-slate-500">{inc.supplier || '—'}</td>
                      <td className="px-4 py-2">
                        {incomingQcPill(inc.qcStatus)}
                        {inc.qcStatus === 'mixed' && (
                          <div className="text-[10px] text-slate-500 mt-1">
                            {Number(inc.qtyPassed || 0)} passed · {Number(inc.qtyFailed || 0)} rejected {inc.unit}
                          </div>
                        )}
                      </td>
                      <td className="px-4 py-2 text-slate-500">{inc.qcByName || '—'}</td>
                      <td className="px-4 py-2 text-slate-500">{inc.qcNotes || '—'}</td>
                      <td className="px-4 py-2"></td>
                    </tr>
                  ))}
                  {heldOrRejectedIncoming.length === 0 && (
                    <tr><td colSpan={8} className="text-center text-slate-400 py-10">No fully resolved GRNs yet.</td></tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      ) : (
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">

        {/* Pending Items queue */}
        <div className="lg:col-span-5 bg-white p-5 rounded-2xl border border-slate-100 shadow-sm flex flex-col h-[650px]">
          <div className="grid grid-cols-2 gap-2 mb-4 border-b border-slate-100 pb-3">
            <button
              onClick={() => { setFilterMode('pending'); setSearchQuery(''); }}
              className={`py-2 rounded-xl text-xs font-extrabold transition-all cursor-pointer text-center flex items-center justify-center gap-1.5 ${
                filterMode === 'pending' ? 'bg-slate-900 text-white shadow-sm' : 'bg-slate-100 text-slate-500 hover:bg-slate-200 hover:text-slate-900'
              }`}
            >
              <ShieldAlert className="h-3.5 w-3.5 text-amber-500" />
              Awaiting Review ({pendingPools.length})
            </button>
            <button
              onClick={() => { setFilterMode('all'); setSearchQuery(''); }}
              className={`py-2 rounded-xl text-xs font-extrabold transition-all cursor-pointer text-center flex items-center justify-center gap-1.5 ${
                filterMode === 'all' ? 'bg-slate-900 text-white shadow-sm' : 'bg-slate-100 text-slate-500 hover:bg-slate-200 hover:text-slate-900'
              }`}
            >
              <Filter className="h-3.5 w-3.5 text-indigo-400" />
              All Pools ({pools.length})
            </button>
          </div>

          <div className="relative mb-3">
            <Search className="absolute top-2.5 left-3 h-4 w-4 text-slate-400" />
            <input
              type="text"
              placeholder="Filter by No. or project name..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-full pl-9 pr-3 py-2 border border-slate-200 rounded-xl text-xs bg-slate-50 focus:outline-none focus:bg-white text-slate-800"
            />
          </div>

          {displayedPools.length === 0 ? (
            <div className="text-center py-20 my-auto">
              <ShieldCheck className="h-12 w-12 text-slate-300 mx-auto mb-3" />
              <p className="text-sm font-bold text-slate-500">No pools fit criteria</p>
              <p className="text-xs text-slate-400 max-w-[240px] mx-auto mt-1">There are no fabrication items to retrieve in this queue.</p>
            </div>
          ) : (
            <div className="space-y-2 overflow-y-auto pr-1 flex-1">
              {displayedPools.map((pool) => {
                const isSelected = pool.id === activePoolId;
                const atDualGateRow = isAtDualStageGate(pool.currentStageIndex);
                const dualRowStageId = atDualGateRow
                  ? (DUAL_STAGE_IDS.find((id) => pool.stageHistory[id]?.status === 'PENDING_INSPECTION')
                    || DUAL_STAGE_IDS.find((id) => pool.stageHistory[id]?.status !== 'APPROVED')
                    || DUAL_STAGE_IDS[0])
                  : null;
                const activeStage = atDualGateRow
                  ? STAGES.find((s) => s.id === dualRowStageId) || null
                  : (pool.currentStageIndex < STAGES.length ? STAGES[pool.currentStageIndex] : null);
                const activeHist = activeStage ? pool.stageHistory[activeStage.id] : null;
                const team = activeHist ? allTeams.find(t => t.id === activeHist.teamId) : null;
                const isUrgent = activeHist?.status === 'PENDING_INSPECTION';
                // Defect badge data
                const poolActiveDefects = qcDefects.filter(d =>
                  d.poolId === pool.id && (d.status === 'open' || d.status === 'on_hold')
                );

                return (
                  <button
                    key={pool.id}
                    onClick={() => {
                      setActivePoolId(pool.id);
                      setErrorMsg('');
                      // For pools parked at the shared Skimmer Fitting / Lamination
                      // gate, open the panel directly on whichever sibling stage is
                      // actually still pending QC — not just whatever STAGES[currentStageIndex]
                      // happens to be (which may be the OTHER sibling that's already approved).
                      setReviewStageId(atDualGateRow ? dualRowStageId : null);
                    }}
                    className={`w-full p-4 text-left rounded-xl border transition-all cursor-pointer block ${
                      isSelected
                        ? 'border-emerald-500 bg-emerald-50/20 shadow-sm ring-1 ring-emerald-500'
                        : 'border-slate-100 hover:border-slate-200 hover:bg-slate-50'
                    }`}
                  >
                    <div className="flex justify-between items-start mb-2">
                      <span className="font-mono text-xs font-black text-slate-500 bg-slate-100 px-1.5 py-0.5 border rounded">
                        {pool.poolNo}
                      </span>
                      {activeStage ? (
                        <span className="text-[10px] font-black px-2 py-0.5 rounded text-white" style={{ backgroundColor: activeStage.color }}>
                          {activeStage.name} {isUrgent ? '• PENDING' : ''}
                        </span>
                      ) : (
                        <span className="text-[10px] font-black px-2 py-0.5 rounded text-white bg-emerald-600 font-sans uppercase">COMPLETED</span>
                      )}
                    </div>

                    <h4 className="text-sm font-bold text-slate-800 line-clamp-1">{pool.projectName}</h4>
                    <div className="flex items-center justify-between text-[10px] text-slate-400 mt-2 font-mono">
                      <span>Orient: <strong>{pool.orientation}</strong></span>
                      <span>{team ? `Team: ${team.name}` : (activeStage ? 'Unassigned' : 'Completed')}</span>
                    </div>
                    {/* Defect badge on list item */}
                    {poolActiveDefects.length > 0 && (
                      <div className="mt-2">
                        <QCDefectBadge defects={poolActiveDefects} />
                      </div>
                    )}
                  </button>
                );
              })}
            </div>
          )}
        </div>

        {/* Active item review form */}
        <div className="lg:col-span-7 bg-white p-6 rounded-2xl border border-slate-100 shadow-sm flex flex-col min-h-[650px] justify-between">
          
          {activeReviewPool ? (
            <div className="space-y-5 flex-1 flex flex-col justify-between">
              <div className="space-y-4">
                {/* Header Info */}
                <div className="border-b border-slate-100 pb-4">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div>
                      <span className="font-mono text-xs font-bold text-slate-400 block tracking-wider uppercase">Quality Inspection File</span>
                      <h3 className="text-base font-black text-slate-800 tracking-tight mt-0.5">
                        {activeReviewPool.projectName} &nbsp;
                        <span className="font-mono text-sm font-extrabold text-indigo-600 bg-blue-50 border border-blue-100 px-2 py-0.5 rounded">
                          {activeReviewPool.poolNo}
                        </span>
                      </h3>
                    </div>
                    <div className={`flex items-center gap-1.5 py-1.5 px-3.5 rounded-xl font-bold text-xs border font-mono ${
                      isPendingInspection 
                        ? 'bg-amber-50 text-amber-800 border-amber-200' 
                        : (activeReviewStage ? 'bg-indigo-50 text-indigo-700 border-indigo-100' : 'bg-emerald-50 text-emerald-800 border-emerald-200')
                    }`}>
                      <CheckCircle2 className="h-4 w-4" />
                      <span>
                        {activeReviewStage 
                          ? `${activeReviewStage.name} ${isPendingInspection ? '(Awaiting QA)' : '(In Progress)'}` 
                          : 'Certification Clear: Fully Built'}
                      </span>
                    </div>
                  </div>

                  <div className="grid grid-cols-3 gap-4 mt-4 bg-slate-50 p-3.5 rounded-xl border border-slate-100 text-xs font-sans">
                    <div>
                      <span className="text-slate-400 block font-medium">Orientation</span>
                      <strong className="text-slate-800 flex items-center gap-1 mt-0.5 font-bold">
                        <Compass className="h-3.5 w-3.5 text-indigo-500" />
                        {activeReviewPool.orientation}
                      </strong>
                    </div>
                    <div>
                      <span className="text-slate-400 block font-medium">Shell Dimension</span>
                      <strong className="text-slate-800 flex items-center gap-1 mt-0.5 font-bold">
                        <Ruler className="h-3.5 w-3.5 text-emerald-500" />
                        {activeReviewPool.dimensions}
                      </strong>
                    </div>
                    <div>
                      <span className="text-slate-400 block font-medium">Active Team</span>
                      <strong className="text-slate-800 mt-0.5 block truncate font-bold">
                        {activeReviewTeam ? activeReviewTeam.name : 'No Assigned Team'}
                      </strong>
                    </div>
                  </div>

                  {/* Stage pipeline selector */}
                  <div className="mt-4 pt-3 border-t border-slate-100 text-left">
                    <span className="text-[10px] uppercase font-black tracking-wider text-slate-400 block mb-2 font-mono">
                      Workstation Stage Routing (Click to Inspect / Sign-Off)
                    </span>
                    <div className="flex flex-wrap gap-1.5 font-sans">
                      {STAGES.map((s, sIdx) => {
                        const histVal = activeReviewPool.stageHistory[s.id];
                        const sStatus = histVal ? histVal.status : 'NOT_STARTED';
                        const isSelected = reviewStageId === s.id;
                        const stageDefects = qcDefects.filter(d => d.poolId === activeReviewPool.id && d.stageId === s.id && (d.status === 'open' || d.status === 'on_hold'));
                        
                        let badgeBg = 'bg-slate-50 border-slate-200 text-slate-500 hover:bg-slate-100';
                        if (sStatus === 'APPROVED') {
                          badgeBg = isSelected ? 'bg-emerald-600 border-emerald-600 text-white font-bold' : 'bg-emerald-50 border-emerald-200 text-emerald-700 hover:bg-emerald-100';
                        } else if (sStatus === 'PENDING_INSPECTION') {
                          badgeBg = isSelected ? 'bg-amber-500 border-amber-500 text-white font-bold animate-pulse' : 'bg-amber-50 border-amber-200 text-amber-800 hover:bg-amber-100 font-bold';
                        } else if (sStatus === 'SKIPPED') {
                          badgeBg = isSelected ? 'bg-red-500 border-red-500 text-white font-bold' : 'bg-red-50 border-red-200 text-red-700 hover:bg-red-100 font-bold';
                        } else if (sStatus === 'CARRIED_ON_SITE') {
                          badgeBg = isSelected ? 'bg-indigo-600 border-indigo-600 text-white font-bold' : 'bg-indigo-50 border-indigo-200 text-indigo-700 hover:bg-indigo-100';
                        } else if (sStatus === 'IN_PROGRESS') {
                          badgeBg = isSelected ? 'bg-blue-600 border-blue-600 text-white font-bold' : 'bg-blue-50 border-blue-200 text-blue-700 hover:bg-blue-100';
                        } else if (isSelected) {
                          badgeBg = 'bg-slate-800 border-slate-800 text-white font-bold';
                        }

                        return (
                          <button
                            key={s.id}
                            type="button"
                            onClick={() => setReviewStageId(s.id)}
                            className={`px-2.5 py-1 rounded-lg text-[10.5px] border font-medium flex items-center gap-1 cursor-pointer transition-all ${badgeBg}`}
                          >
                            <span className="opacity-75">{sIdx + 1}.</span>
                            <span>{s.name}</span>
                            {sStatus === 'APPROVED' && <span className="text-[9px]">✓</span>}
                            {sStatus === 'PENDING_INSPECTION' && <span className="w-1.5 h-1.5 rounded-full bg-amber-500 inline-block" />}
                            {sStatus === 'SKIPPED' && <span className="text-[9px] font-black">⚠</span>}
                            {stageDefects.length > 0 && (
                              <span className="w-4 h-4 rounded-full bg-rose-500 text-white text-[8px] font-black flex items-center justify-center leading-none">
                                {stageDefects.length}
                              </span>
                            )}
                          </button>
                        );
                      })}
                    </div>
                  </div>

                  {activeReviewStage && onSkipOrCarryOnSite && (
                    <div className="mt-4 p-4 bg-indigo-50/70 border border-indigo-100 rounded-xl space-y-2 text-slate-800 font-sans text-left">
                      <div className="flex items-center justify-between">
                        <span className="text-[10px] font-black uppercase tracking-wider text-indigo-800">Off-Sequence Delivery Alternatives</span>
                        <span className="text-[9px] font-bold text-indigo-500 bg-white border border-indigo-100 px-1.5 py-0.5 rounded">Actionable Zone</span>
                      </div>
                      <p className="text-xs text-slate-600 leading-tight font-medium">
                        For these stages, we occasionally skip them or perform the carry on-site during ship dispatch. Select an option to record the status and unlock the next sequence:
                      </p>
                      <div className="grid grid-cols-2 gap-3 pt-1">
                        <button
                          type="button"
                          onClick={() => { onSkipOrCarryOnSite(activeReviewPool.id, activeReviewStage.id, 'SKIPPED', selectedInspector); setActivePoolId(null); }}
                          className="py-2 bg-white hover:bg-slate-50 text-slate-700 font-black text-xs rounded-lg border border-slate-200 text-center cursor-pointer transition-colors shadow-xs"
                        >
                          Skip For Now
                        </button>
                        <button
                          type="button"
                          onClick={() => { onSkipOrCarryOnSite(activeReviewPool.id, activeReviewStage.id, 'CARRIED_ON_SITE', selectedInspector); setActivePoolId(null); }}
                          className="py-2 bg-indigo-600 hover:bg-indigo-700 text-white font-black text-xs rounded-lg text-center cursor-pointer transition-colors shadow-sm"
                        >
                          Will Carry on Site
                        </button>
                      </div>
                    </div>
                  )}
                </div>

                {/* ── QC DEFECT PANEL ───────────────────────────────────────────── */}
                {activeReviewStage && onLogDefect && onUpdateDefectStatus && (
                  <QCDefectPanel
                    poolId={activeReviewPool.id}
                    poolNo={activeReviewPool.poolNo}
                    projectName={activeReviewPool.projectName}
                    stageId={activeReviewStage.id}
                    stageName={activeReviewStage.name}
                    inspectorName={selectedInspector}
                    existingDefects={qcDefects}
                    onLogDefect={onLogDefect}
                    onUpdateDefectStatus={onUpdateDefectStatus}
                  />
                )}

                {isPendingInspection ? (
                  <>
                    {/* QA Review Checklist */}
                    <div className="space-y-2.5 font-sans">
                      <h4 className="text-xs font-black text-slate-500 uppercase tracking-widest flex items-center gap-1">
                        <ClipboardList className="h-4 w-4 text-indigo-500" />
                        Quality Certification Checklist
                      </h4>
                      <div className="text-xs text-slate-600 bg-slate-50/55 p-3 rounded-xl border border-slate-100 space-y-2.5">
                        <div className="flex items-center gap-2">
                          <input type="checkbox" defaultChecked className="rounded border-slate-300 accent-emerald-500 cursor-pointer h-4 w-4" />
                          <span>Confirm core structural dimensions match the initial released blueprint.</span>
                        </div>
                        <div className="flex items-center gap-2">
                          <input type="checkbox" defaultChecked className="rounded border-slate-300 accent-emerald-500 cursor-pointer h-4 w-4" />
                          <span>Inspect welds, rivets, seals or surface treatments for any voids or anomalies.</span>
                        </div>
                        <div className="flex items-center gap-2">
                          <input type="checkbox" defaultChecked className="rounded border-slate-300 accent-emerald-500 cursor-pointer h-4 w-4" />
                          <span>Run structural integrity load/pressure simulation routines.</span>
                        </div>
                      </div>
                    </div>

                    <div className="space-y-2.5 pt-2">
                      <label className="block text-xs font-black text-slate-600 uppercase tracking-widest flex items-center gap-1">
                        <FileText className="h-4 w-4 text-indigo-500" />
                        Inspector Detailed Notes & Verdict Reasons
                      </label>
                      <textarea
                        placeholder="e.g., Welds pass pristine visual scan, core shape alignment verified, ready to advance to primer."
                        value={reviewerNotes}
                        onChange={(e) => setReviewerNotes(e.target.value)}
                        className="w-full text-slate-800 border p-3 border-slate-200 rounded-xl text-xs min-h-[100px] focus:outline-none focus:ring-1 focus:ring-emerald-500 font-medium bg-slate-50 focus:bg-white"
                      />
                    </div>

                    <div className="space-y-2.5 pt-1">
                      <label className="block text-xs font-black text-slate-600 uppercase tracking-widest flex items-center gap-1">
                        <Camera className="h-4 w-4 text-indigo-500" />
                        Quality Inspection Evidence Photo (Optional)
                      </label>
                      {!uploadedPicture ? (
                        <div className="border border-dashed border-slate-200 hover:border-indigo-400 bg-slate-50/50 rounded-xl p-3.5 transition-all text-center relative hover:bg-slate-50">
                          <input
                            type="file"
                            accept="image/*"
                            onChange={(e) => {
                              const file = e.target.files?.[0];
                              if (file) {
                                const reader = new FileReader();
                                reader.onloadend = () => setUploadedPicture(reader.result as string);
                                reader.readAsDataURL(file);
                              }
                            }}
                            className="absolute inset-0 w-full h-full opacity-0 cursor-pointer"
                          />
                          <div className="flex flex-col items-center justify-center space-y-1.5">
                            <UploadCloud className="h-6 w-6 text-slate-400" />
                            <p className="text-xs font-bold text-slate-700">Click or drag to select build photo</p>
                            <p className="text-[10px] text-slate-400">Device camera or image files (up to 10MB)</p>
                          </div>
                        </div>
                      ) : (
                        <div className="relative rounded-xl overflow-hidden border border-slate-200 bg-slate-900 flex items-center justify-center p-2 max-h-[180px]">
                          <img src={uploadedPicture} alt="Quality Evidence Preview" className="max-h-[160px] object-contain rounded-lg shadow-md" referrerPolicy="no-referrer" />
                          <button type="button" onClick={() => setUploadedPicture(null)}
                            className="absolute top-2 right-2 bg-slate-950/80 hover:bg-rose-600 text-white rounded-full p-1 border border-white/20 hover:scale-105 transition-all cursor-pointer">
                            <XCircle className="h-3.5 w-3.5" />
                          </button>
                        </div>
                      )}
                    </div>

                    {errorMsg && (
                      <div className="p-3 bg-rose-50 border border-rose-100 text-rose-800 rounded-xl text-xs font-semibold flex items-center gap-2">
                        <AlertCircle className="h-4 w-4 flex-shrink-0" />
                        <span>{errorMsg}</span>
                      </div>
                    )}

                    <div className="grid grid-cols-2 gap-4 pt-1 font-sans">
                      <button
                        onClick={handleReject}
                        className="py-2.5 px-4 bg-slate-50 hover:bg-rose-50 hover:text-rose-700 border border-slate-200 hover:border-rose-200 text-slate-700 font-bold text-xs rounded-xl cursor-pointer transition-all flex items-center justify-center gap-1.5 uppercase tracking-wider"
                      >
                        <XCircle className="h-4 w-4" />
                        <span>Reject & Rework</span>
                      </button>
                      <button
                        onClick={handleApprove}
                        className="py-2.5 px-4 bg-emerald-600 hover:bg-emerald-700 text-white font-bold text-xs rounded-xl shadow-sm cursor-pointer transition-all flex items-center justify-center gap-1.5 uppercase tracking-wider"
                      >
                        <CheckCircle2 className="h-4 w-4" />
                        <span>Certify & Approve</span>
                      </button>
                    </div>
                  </>
                ) : (
                  <div className="bg-slate-50 border border-slate-100 p-5 rounded-xl text-center space-y-2 mt-4 font-sans">
                    <AlertCircle className="h-7 w-7 text-indigo-400 mx-auto" />
                    <h4 className="text-xs font-bold text-slate-700 uppercase tracking-widest">Active Monitoring Mode</h4>
                    <p className="text-xs text-slate-500 max-w-sm mx-auto">
                      This pool record is currently at <strong className="text-slate-800">{activeReviewStage ? activeReviewStage.name : 'Fully Completed'}</strong> and is not awaiting active inspection in the queue.
                    </p>
                    <div className="text-slate-500 text-[10px] font-mono py-1 px-3 bg-white border border-slate-100 rounded inline-block font-bold">
                      Manufacturing Index: {activeReviewPool.currentStageIndex} of 7 • Completed: {activeReviewPool.completedAt ? 'Yes' : 'No'}
                    </div>
                  </div>
                )}
              </div>

              <div className="border-t border-slate-100 bg-slate-50 p-4 rounded-xl mt-6 font-sans">
                <div className="flex flex-col sm:flex-row justify-between items-center gap-3">
                  <div className="text-left flex-1">
                    <p className="text-xs font-extrabold text-slate-700 flex items-center gap-1.5 uppercase tracking-wider">
                      <ShieldAlert className="h-4 w-4 text-amber-500" />
                      Defect Scrap & Purge Records
                    </p>
                    <p className="text-[10px] text-slate-500 mt-1 max-w-md font-medium">
                      Scrapping pool cards or purging manufacturing records is restricted to authorization levels held in the <strong>Management Portal</strong>.
                    </p>
                  </div>
                  <span className="text-[10px] font-mono font-bold bg-slate-100 text-slate-500 px-2.5 py-1 rounded border border-slate-200">
                    🔒 Restricted to Management
                  </span>
                </div>
              </div>
            </div>
          ) : (
            <div className="my-auto text-center py-20 flex flex-col items-center justify-center space-y-3 font-sans">
              <ShieldCheck className="h-16 w-16 text-slate-200" />
              <h4 className="text-base font-bold text-slate-500">No active review selection</h4>
              <p className="text-xs text-slate-400 max-w-sm">Select an item awaiting approval or toggle to "All Pools" in the list on the left to verify its build tolerances.</p>
            </div>
          )}
        </div>
      </div>
      )}
    </div>
  );
};
