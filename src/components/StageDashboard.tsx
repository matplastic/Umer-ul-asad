import React, { useState } from 'react';
import { Pool, StageId, Team, StageDefinition } from '../types';
import { STAGES } from '../data/mockData';
import { Play, CheckSquare, Users, AlertTriangle, Clock, ChevronRight, Compass, Printer, X, Cloud, Loader2, CheckCircle2, Eye, RefreshCw } from 'lucide-react';
import { uploadToGoogleDrive } from '../lib/googleDrive';
import { QCDefectBadge, QCDefect } from './QCDefectPanel';

interface StageDashboardProps {
  stage: StageDefinition;
  pools: Pool[];
  teams: Team[];
  selectedTeamId: string;
  onClaimPool: (poolId: string, teamId: string, stageId: StageId) => void;
  onStartStage: (poolId: string, stageId: StageId) => void;
  onFinishStage: (poolId: string, stageId: StageId) => void;
  googleUser: any;
  onGoogleSignIn: () => void;
  onSkipOrCarryOnSite?: (poolId: string, stageId: StageId, option: 'SKIPPED' | 'CARRIED_ON_SITE', operatorName: string) => void;
  onRequestUndoClaim?: (poolId: string, stageId: StageId, teamName: string, reason: string) => void;
  onRefresh?: () => void;
  isSyncing?: boolean;
  qcDefects?: QCDefect[];
}

export const StageDashboard: React.FC<StageDashboardProps> = ({
  stage,
  pools,
  teams,
  selectedTeamId,
  onClaimPool,
  onStartStage,
  onFinishStage,
  googleUser,
  onGoogleSignIn,
  onSkipOrCarryOnSite,
  onRequestUndoClaim,
  onRefresh,
  isSyncing,
  qcDefects = [],
}) => {
  const [printPool, setPrintPool] = useState<Pool | null>(null);
  const [viewingDrawingPool, setViewingDrawingPool] = useState<Pool | null>(null);
  const [driveUploading, setDriveUploading] = useState<'idle' | 'uploading' | 'success' | 'error'>('idle');
  const [driveError, setDriveError] = useState('');

  const handleUploadTravelerToDrive = async (pool: Pool) => {
    setDriveUploading('uploading');
    setDriveError('');
    try {
      // Format traveler as structured text / ASCII layout matching shop cards
      let text = `==================================================================================\n`;
      text += `                       MAT PLASTIC PRODUCTS LLC - SHOP TRAVELER CARD\n`;
      text += `==================================================================================\n\n`;
      text += `  Component ID : ${pool.poolNo.padEnd(20)} | Shape Matrix : ${pool.shape}\n`;
      text += `  Project Name : ${pool.projectName.padEnd(20)} | Dimensions   : ${pool.dimensions}\n`;
      text += `  Matrix Date  : ${new Date(pool.createdAt).toLocaleString().padEnd(20)} | Orientation  : ${pool.orientation} orientation\n\n`;
      
      if (pool.notes) {
        text += `  Release Engineer Notes:\n  "${pool.notes}"\n\n`;
      }
      
      text += `----------------------------------------------------------------------------------\n`;
      text += `                             MANUFACTURING ROUTING SIGN-OFF LOG\n`;
      text += `----------------------------------------------------------------------------------\n`;
      text += `  NO | STAGE NAME                | STATUS     | WORKFORCE TEAM | DURATION | QC SIGN\n`;
      text += `  --------------------------------------------------------------------------------\n`;
      
      STAGES.forEach((s, idx) => {
        const hist = pool.stageHistory[s.id];
        const ord = String(idx + 1).padStart(2, '0');
        const stageName = s.name.padEnd(25);
        
        let statusVal = 'WAITING';
        if (pool.currentStageIndex > idx) {
          statusVal = 'APPROVED';
        } else if (pool.currentStageIndex === idx) {
          statusVal = hist?.status || 'ACTIVE';
        }
        const statusStr = statusVal.padEnd(10);
        
        const teamName = hist?.teamId ? hist.teamId.replace(`${s.id}_`, '').toUpperCase() : '______';
        const teamStr = teamName.padEnd(14);
        
        const durationStr = hist?.durationMinutes ? `${hist.durationMinutes}m`.padEnd(8) : '______  ';
        
        let qcSig = '______';
        if (hist?.status === 'APPROVED') {
          qcSig = hist.inspectorId || 'QC LEAD';
        }
        
        text += `  ${ord} | ${stageName} | ${statusStr} | ${teamStr} | ${durationStr} | ${qcSig}\n`;
      });
      
      text += `  --------------------------------------------------------------------------------\n\n`;
      text += `==================================================================================\n`;
      text += `  Stored securely from MAT PLASTIC ERP at ${new Date().toLocaleString()}\n`;
      text += `  Authenticated uploader: ${googleUser?.displayName || 'Unknown Uploader'} (${googleUser?.email || ''})\n`;
      text += `==================================================================================\n`;

      const safeProjectName = pool.projectName.replace(/[^a-zA-Z0-9]/g, '_');
      const fileName = `Traveler_${pool.poolNo}_${safeProjectName}.txt`;
      
      await uploadToGoogleDrive(fileName, text, 'text/plain');
      setDriveUploading('success');
      setTimeout(() => setDriveUploading('idle'), 3500);
    } catch (err: any) {
      console.error('Failed to upload traveler to Google Drive:', err);
      setDriveUploading('error');
      setDriveError(err.message || 'Unknown network error');
    }
  };

  // Get teams belonging to this stage
  const stageTeams = teams.filter((t) => t.stageId === stage.id);
  const activeTeam = stageTeams.find((t) => t.id === selectedTeamId);

  // Pools currently waiting to be worked on or worked on in this stage (including skipped rework)
  const stageIdx = STAGES.findIndex((s) => s.id === stage.id);
  const currentStagePools = pools.filter((p) => {
    const isCurrentStage = p.currentStageIndex === stageIdx;
    const isSkippedRework = p.currentStageIndex > stageIdx && p.stageHistory[stage.id]?.status === 'SKIPPED';
    return isCurrentStage || isSkippedRework;
  });

  // Available pools: in this stage index or skipped, having status NOT_STARTED, REJECTED, or SKIPPED, and NO teamId yet
  const availablePools = currentStagePools.filter(
    (p) => {
      const hist = p.stageHistory[stage.id] || { stageId: stage.id, status: 'NOT_STARTED', rejectionCount: 0 };
      return (hist.status === 'NOT_STARTED' || hist.status === 'REJECTED' || hist.status === 'SKIPPED') && !hist.teamId;
    }
  );

  // Pool claimed by the CURRENT active team (if any selected)
  const myClaimedPool = activeTeam && activeTeam.activePoolId 
    ? pools.find((p) => p.id === activeTeam.activePoolId)
    : null;

  const myClaimedPoolHist = myClaimedPool
    ? (myClaimedPool.stageHistory[stage.id] || { stageId: stage.id, status: 'NOT_STARTED', rejectionCount: 0 })
    : null;

  // Pools in this stage currently being worked on by other teams (or this team, but we'll show all occupied)
  const inProgressPools = currentStagePools.filter((p) => {
    const hist = p.stageHistory[stage.id] || { stageId: stage.id, status: 'NOT_STARTED', rejectionCount: 0 };
    return hist.status === 'IN_PROGRESS' || hist.status === 'PENDING_INSPECTION' || (hist.teamId && hist.status === 'REJECTED');
  });

  // Pools recently approved in this stage (completed historical items)
  const approvedPools = pools.filter((p) => {
    const hist = p.stageHistory[stage.id];
    return hist && hist.status === 'APPROVED';
  });

  const getStatusBadge = (status: string) => {
    switch (status) {
      case 'NOT_STARTED':
        return <span className="bg-slate-100 text-slate-800 text-[10px] font-bold px-2 py-0.5 rounded border border-slate-200">Idle Queue</span>;
      case 'IN_PROGRESS':
        return <span className="bg-blue-105 bg-blue-100 text-blue-800 text-[10px] font-bold px-2 py-0.5 rounded border border-blue-200 animate-pulse">Active Work</span>;
      case 'PENDING_INSPECTION':
        return <span className="bg-amber-100 text-amber-800 text-[10px] font-bold px-2 py-0.5 rounded border border-amber-200 animate-pulse">Awaiting QA</span>;
      case 'REJECTED':
        return <span className="bg-rose-105 bg-rose-100 text-rose-800 text-[10px] font-black px-2 py-0.5 rounded border border-rose-250 border-rose-200">Rework Required</span>;
      case 'SKIPPED':
        return <span className="bg-amber-50 text-slate-600 text-[10px] font-bold px-2 py-0.5 rounded border border-amber-200">Skipped (Bypassed)</span>;
      case 'CARRIED_ON_SITE':
        return <span className="bg-purple-100 text-purple-800 text-[10px] font-bold px-2 py-0.5 rounded border border-purple-200">Carry on Site</span>;
      default:
        return <span className="bg-emerald-100 text-emerald-800 text-[10px] font-bold px-2 py-0.5 rounded border border-emerald-200">Pass</span>;
    }
  };

  return (
    <div className="space-y-6">
      
      {/* Header Banner */}
      <div 
        className="p-6 rounded-2xl border text-white shadow-md relative overflow-hidden transition-all duration-300"
        style={{
          background: `linear-gradient(135deg, ${stage.color}ee, ${stage.color})`,
          borderColor: stage.color,
          boxShadow: `0 4px 20px ${stage.color}30`
        }}
      >
        <div className="relative z-10 flex flex-col md:flex-row md:items-center md:justify-between gap-4">
          <div>
            <span className="text-[10px] font-black bg-white/20 px-2.5 py-1 rounded-full uppercase tracking-wider text-slate-100">
              Department Shop Floor Panel
            </span>
            <h2 className="text-2xl font-extrabold tracking-tight mt-1 px-1">{stage.name} Section</h2>
            <p className="text-sm text-slate-150 text-slate-100/90 mt-1 px-1">
              Active and waiting manufacturing cards for pool shell structures. Claim and track timing precisely.
            </p>
            {onRefresh && (
              <button
                onClick={onRefresh}
                disabled={isSyncing}
                className="mt-2 ml-1 flex items-center gap-1.5 text-[10px] font-bold bg-white/15 hover:bg-white/25 text-white px-3 py-1.5 rounded-full border border-white/20 transition-colors disabled:opacity-50"
              >
                <RefreshCw className={`h-3 w-3 ${isSyncing ? 'animate-spin' : ''}`} />
                {isSyncing ? 'Syncing...' : 'Sync Latest Data'}
              </button>
            )}
          </div>
          <div className="flex gap-3 bg-white/10 backdrop-blur-md p-4 rounded-xl border border-white/10">
            <div className="text-center px-2">
              <span className="block text-xl font-bold">{stageTeams.length}</span>
              <span className="text-[9px] text-white/70 uppercase font-bold tracking-wider">Total Teams</span>
            </div>
            <div className="w-[1px] bg-white/20"></div>
            <div className="text-center px-2">
              <span className="block text-xl font-bold">{availablePools.length}</span>
              <span className="text-[9px] text-white/70 uppercase font-bold tracking-wider">Unclaimed</span>
            </div>
            <div className="w-[1px] bg-white/20"></div>
            <div className="text-center px-2">
              <span className="block text-xl font-bold">
                {currentStagePools.filter(p => p.stageHistory[stage.id]?.status === 'IN_PROGRESS').length}
              </span>
              <span className="text-[9px] text-white/70 uppercase font-bold tracking-wider">In Progress</span>
            </div>
          </div>
        </div>
      </div>

      {/* Main Grid split */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">

        {/* Action column (Left: Claimed work & selector info) */}
        <div className="lg:col-span-4 space-y-6">
          
          {/* Active Team workstation */}
          <div className="bg-white p-5 rounded-2xl border border-slate-100 shadow-sm">
            <h3 className="text-sm font-black text-slate-500 uppercase tracking-wider border-b border-slate-100 pb-2 mb-4 flex items-center gap-1.5">
              <Users className="h-4 w-4 text-slate-400" />
              Workstation: {activeTeam ? activeTeam.name : 'Unassigned'}
            </h3>

            {!activeTeam ? (
              <div className="p-4 bg-amber-50 border border-amber-200 text-amber-900 rounded-xl text-xs space-y-2">
                <p className="font-bold flex items-center gap-1.5">
                  <AlertTriangle className="h-4.5 w-4.5 text-amber-600" />
                  Select a Team to Interact
                </p>
                <p className="text-slate-600 leading-relaxed">
                  Choose a Team assignment in the header dropdown to claim incoming queue tasks, initiate timers, or sign off build stages.
                </p>
              </div>
            ) : (
              <div className="space-y-4">
                {/* Active Team is logged in */}
                <div className="flex justify-between items-center bg-slate-50 p-3 rounded-xl border border-slate-100">
                  <div>
                    <span className="text-[10px] uppercase font-bold text-slate-400 block">Current Status</span>
                    <span className={`text-xs font-semibold inline-flex items-center gap-1 mt-0.5 ${
                      activeTeam.status === 'IDLE' ? 'text-emerald-600' : 'text-amber-600'
                    }`}>
                      <span className={`h-1.5 w-1.5 rounded-full ${activeTeam.status === 'IDLE' ? 'bg-emerald-500' : 'bg-amber-500 animate-ping'}`} />
                      {activeTeam.status === 'IDLE' ? 'Ready for New Work' : 'Currently Active'}
                    </span>
                  </div>
                  <span className="font-mono text-[10px] bg-slate-200/55 px-2 py-0.5 rounded font-black text-slate-500">
                    {activeTeam.id}
                  </span>
                </div>

                {/* Claimed pool information block */}
                {myClaimedPool ? (
                  <div className="border border-slate-200 rounded-xl bg-slate-50/50 p-4 space-y-3">
                    <div className="flex justify-between items-start">
                      <div>
                        <span className="font-mono text-xs font-black text-slate-500 bg-slate-200 px-1.5 py-0.5 rounded">
                          {myClaimedPool.poolNo}
                        </span>
                        <h4 className="text-sm font-bold text-slate-800 mt-1.5">{myClaimedPool.projectName}</h4>
                      </div>
                      {getStatusBadge(myClaimedPoolHist.status)}
                    </div>

                    <div className="text-xs text-slate-500 space-y-1 bg-white p-2.5 rounded-lg border border-slate-100">
                      <p>Shape: <strong className="text-slate-800">{myClaimedPool.shape}</strong></p>
                      <p>Dimensions: <strong className="text-slate-800">{myClaimedPool.dimensions}</strong></p>
                      <p>Orientation: <strong className="text-slate-800">{myClaimedPool.orientation}</strong></p>
                    </div>

                    <button
                      onClick={() => setPrintPool(myClaimedPool)}
                      className="w-full py-1.5 bg-slate-50 hover:bg-slate-100 text-slate-700 hover:text-slate-900 border border-slate-205 border-slate-200 font-bold text-xs rounded-lg transition-colors flex items-center justify-center gap-1.5 cursor-pointer shadow-xs"
                    >
                      <Printer className="h-3.5 w-3.5" />
                      <span>Print Shop Traveler Slip</span>
                    </button>

                    {myClaimedPoolHist.status === 'REJECTED' && (
                      <div className="p-2.5 bg-rose-50 border border-rose-100 text-rose-800 text-xs rounded-lg space-y-1 font-sans">
                        <p className="font-semibold flex items-center gap-1 text-rose-700">
                          <AlertTriangle className="h-3.5 w-3.5 text-rose-550" />
                          QA Rejection Note Checklist:
                        </p>
                        <p className="italic bg-white/60 p-2 rounded border border-rose-100 text-[11px] leading-relaxed">
                          &quot;{myClaimedPoolHist.inspectorNotes || 'No notes left'}&quot;
                        </p>
                        {myClaimedPoolHist.inspectorPicture && (
                          <div className="mt-2 rounded-lg overflow-hidden border border-rose-200/50 shadow-xs max-h-[140px] bg-white p-1">
                            <img 
                              src={myClaimedPoolHist.inspectorPicture} 
                              alt="Defect visual evidence" 
                              className="max-h-[130px] w-full object-cover rounded-md" 
                              referrerPolicy="no-referrer"
                            />
                          </div>
                        )}
                      </div>
                    )}

                    {/* Operational Actions */}
                    <div className="pt-2 border-t border-slate-150 border-slate-100 gap-2 flex flex-col">
                      
                      {(myClaimedPoolHist.status === 'NOT_STARTED' || myClaimedPoolHist.status === 'REJECTED') && (
                        <div className="space-y-2">
                          <div className="flex items-center gap-2 text-[10px] text-slate-500 font-semibold bg-slate-50 px-3 py-1.5 rounded-lg border border-slate-200">
                            <Clock className="h-3.5 w-3.5 text-slate-400" />
                            Start time will be recorded automatically
                          </div>
                          <button
                            onClick={() => onStartStage(myClaimedPool.id, stage.id)}
                            className="w-full py-2 bg-emerald-600 hover:bg-emerald-700 text-white font-bold text-xs rounded-lg transition-colors flex items-center justify-center gap-1.5 cursor-pointer shadow-sm shadow-emerald-100"
                          >
                            <Play className="h-3.5 w-3.5 fill-current" />
                            <span>Start Stage Production Timer</span>
                          </button>
                        </div>
                      )}

                      {myClaimedPoolHist.status === 'IN_PROGRESS' && (
                        <div>
                          <div className="flex items-center gap-2 text-[10px] text-slate-400 font-bold mb-2 p-1.5 bg-blue-50/50 rounded border border-blue-105">
                            <Clock className="h-3.5 w-3.5 text-blue-500 animate-spin" />
                            <span>Started: {myClaimedPoolHist.startTime ? new Date(myClaimedPoolHist.startTime).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' }) : 'Timer running...'}</span>
                          </div>
                          <div className="flex items-center gap-2 text-[10px] text-slate-500 font-semibold bg-slate-50 px-3 py-1.5 rounded-lg border border-slate-200 mb-2">
                            <Clock className="h-3.5 w-3.5 text-slate-400" />
                            Finish time will be recorded automatically
                          </div>
                          <button
                            onClick={() => onFinishStage(myClaimedPool.id, stage.id)}
                            className="w-full py-2 bg-blue-600 hover:bg-blue-700 text-white font-bold text-xs rounded-lg transition-colors flex items-center justify-center gap-1.5 cursor-pointer shadow-sm shadow-blue-150"
                          >
                            <CheckSquare className="h-3.5 w-3.5" />
                            <span>Complete & Request QA Signoff</span>
                          </button>
                        </div>
                      )}

                      {myClaimedPoolHist.status === 'PENDING_INSPECTION' && (
                        <div className="p-3 bg-amber-50 border border-amber-100 text-amber-800 text-[11px] rounded-lg text-center font-medium">
                          Sent to Quality Inspection Queue.<br /> awaiting QA sign-off before proceeding upwards.
                        </div>
                      )}

                      {/* Request QA to undo claim — replaces Skip/Carry which is now QA-only */}
                      {onRequestUndoClaim && (
                        <div className="mt-3 pt-3 border-t border-slate-200">
                          <span className="text-[10px] font-black text-slate-500 block mb-1.5 uppercase tracking-wider">
                            Wrong Assignment?
                          </span>
                          <button
                            type="button"
                            onClick={() => {
                              const reason = window.prompt(`Request QA to undo claim for ${myClaimedPool.poolNo}?\n\nEnter reason (e.g. "Claimed under wrong team name"):`);
                              if (reason) onRequestUndoClaim(myClaimedPool.id, stage.id, activeTeam?.name || 'Unknown Team', reason);
                            }}
                            className="w-full py-1.5 bg-amber-50 hover:bg-amber-100 text-amber-700 font-black text-[10.5px] rounded border border-amber-200 text-center cursor-pointer flex items-center justify-center gap-1.5"
                          >
                            <span>⚠</span> Request QA to Undo Claim
                          </button>
                          <p className="text-[9.5px] text-slate-400 mt-1.5 leading-tight">
                            Sends a request to Quality Assurance to unclaim this pool so the correct team can pick it.
                          </p>
                        </div>
                      )}
                    </div>
                  </div>
                ) : (
                  <div className="text-center py-8 bg-slate-50 border border-slate-100 border-dashed rounded-xl">
                    <p className="text-xs font-bold text-slate-500">No active claimed pool card</p>
                    <p className="text-[10px] text-slate-400 mt-1">Select an item from the Available Queue or waiting list on the right to start work.</p>
                  </div>
                )}
              </div>
            )}
          </div>

          {/* Department Teams status list */}
          <div className="bg-white p-5 rounded-2xl border border-slate-100 shadow-sm">
            <h3 className="text-sm font-black text-slate-500 uppercase tracking-wider border-b border-slate-100 pb-2 mb-3 flex items-center gap-1.5">
              <Users className="h-4 w-4 text-slate-400" />
              Department Teams Load
            </h3>
            <div className="space-y-2">
              {stageTeams.map((team) => (
                <div key={team.id} className="flex justify-between items-center text-xs p-2 rounded-lg border border-slate-50 hover:bg-slate-50/30">
                  <span className="font-medium text-slate-700">{team.name}</span>
                  <div>
                    {team.status === 'IDLE' ? (
                      <span className="text-[10px] font-bold text-emerald-600 bg-emerald-50 px-2 py-0.5 border border-emerald-100 rounded-full">
                        Idle
                      </span>
                    ) : (
                      <span className="text-[10px] font-bold text-amber-600 bg-amber-50 px-2 py-0.5 border border-amber-100 rounded-full">
                        Working
                      </span>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* Pools queues (Right) */}
        <div className="lg:col-span-8 space-y-6">
          
          {/* Unclaimed Queue */}
          <div className="bg-white p-6 rounded-2xl border border-slate-100 shadow-sm">
            <div className="pb-3 border-b border-slate-100 flex items-center justify-between mb-4">
              <h3 className="text-base font-bold text-slate-800 tracking-tight flex items-center gap-1.5">
                <span className="h-2 w-2 rounded-full" style={{ backgroundColor: stage.color }} />
                Unclaimed Available Pool Tasks
              </h3>
              <span className="text-xs text-slate-400 font-bold font-mono">
                {availablePools.length} pools available
              </span>
            </div>

            {availablePools.length === 0 ? (
              <div className="text-center py-10 bg-slate-50 border border-slate-100 rounded-xl">
                <CheckSquare className="h-8 w-8 text-slate-300 mx-auto mb-2" />
                <p className="text-xs font-bold text-slate-500">All pools are currently claimed or processed for {stage.name}!</p>
                <p className="text-[10px] text-slate-450 text-slate-400 mt-1">Waiting for production engineer releases or previous-stage inspections.</p>
              </div>
            ) : (
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {availablePools.map((pool) => {
                  const hist = pool.stageHistory[stage.id] || { stageId: stage.id, status: 'NOT_STARTED', rejectionCount: 0 };
                  return (
                    <div 
                      key={pool.id} 
                      className="p-4 border border-slate-205 border-slate-100 rounded-xl shadow-sm hover:shadow bg-slate-50 hover:bg-slate-50/70 hover:border-slate-300 transition-all flex flex-col justify-between"
                    >
                      <div>
                        <div className="flex justify-between items-center">
                          <div className="flex items-center gap-1.5 flex-wrap">
                            <span className="font-mono text-[10.5px] font-black text-slate-505 text-slate-600 bg-slate-200 px-1.5 py-0.5 rounded">
                              {pool.poolNo}
                            </span>
                            {pool.poolType && (
                              <span className="font-mono text-[9px] font-black text-indigo-700 bg-indigo-50 border border-indigo-100 px-1.5 py-0.5 rounded">
                                {pool.poolType}
                              </span>
                            )}
                          </div>
                          <div className="flex items-center gap-1.5">
                            {pool.drawingUrl && (
                              <button
                                onClick={() => setViewingDrawingPool(pool)}
                                className="p-1.5 bg-indigo-50 hover:bg-indigo-100 border border-indigo-200 text-indigo-700 rounded transition-colors cursor-pointer"
                                title="View Blueprint / CAD Layout Drawing"
                              >
                                <Eye className="h-3.5 w-3.5" />
                              </button>
                            )}
                            <button
                              onClick={() => setPrintPool(pool)}
                              className="p-1.5 bg-white hover:bg-slate-150 border border-slate-200 rounded text-slate-500 hover:text-slate-800 transition-colors cursor-pointer"
                              title="Print Traveler Report"
                            >
                              <Printer className="h-3.5 w-3.5" />
                            </button>
                            {getStatusBadge(hist.status)}
                          </div>
                        </div>

                        <h4 className="text-sm font-bold text-slate-900 mt-2">{pool.projectName}</h4>
                        {/* QC defect badge — visible to floor workers so they know hold status */}
                        {(() => {
                          const poolDefects = qcDefects.filter(d => d.poolId === pool.id && d.stageId === stage.id);
                          return poolDefects.length > 0 ? <div className="mt-1"><QCDefectBadge defects={poolDefects} /></div> : null;
                        })()}

                        {/* Specs list */}
                        <div className="mt-2.5 space-y-1.5">
                          <div className="flex gap-x-3 text-[11px] text-slate-505 text-slate-500">
                            <span>Orient: <strong className="text-slate-800">{pool.orientation}</strong></span>
                            <span>Dim: <strong className="text-slate-800">{pool.dimensions}</strong></span>
                          </div>
                          {pool.notes && (
                            <p className="text-[10.5px] text-slate-500 italic bg-white p-1.5 rounded border border-slate-100 line-clamp-2">
                              &quot;{pool.notes}&quot;
                            </p>
                          )}
                        </div>

                        {/* Skip/Carry moved to QA portal only */}
                      </div>

                      <div className="mt-4 pt-3 border-t border-slate-200/50 flex items-center justify-between">
                        <span className="text-[9.5px] text-slate-400 font-mono">
                          Released: {new Date(pool.createdAt).toLocaleDateString()}
                        </span>
                        
                        <button
                          disabled={!activeTeam || activeTeam.status === 'BUSY'}
                          onClick={() => onClaimPool(pool.id, activeTeam!.id, stage.id)}
                          className={`px-3 py-1.5 rounded text-xs font-semibold cursor-pointer transition-all flex items-center gap-1 ${
                            activeTeam && activeTeam.status === 'IDLE'
                              ? 'bg-blue-600 hover:bg-blue-700 text-white shadow-sm'
                              : 'bg-slate-100 text-slate-400 border border-slate-200 cursor-not-allowed'
                          }`}
                          title={!activeTeam ? "Select a team first" : activeTeam.status === 'BUSY' ? "Finish current task first" : "Claim this pool"}
                        >
                          <span>Claim Task</span>
                          <ChevronRight className="h-3.5 w-3.5" />
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          {/* Underway Fabrication in this stage (claimed by other teams) */}
          <div className="bg-white p-6 rounded-2xl border border-slate-100 shadow-sm">
            <h3 className="text-sm font-black text-slate-500 uppercase tracking-wider border-b border-slate-100 pb-2 mb-4">
              Active Stage Fabrication Flow
            </h3>

            {inProgressPools.length === 0 ? (
              <p className="text-xs text-slate-400 py-4 text-center">No active work currently underway on the floor.</p>
            ) : (
              <div className="space-y-3">
                {inProgressPools.map((pool) => {
                  const hist = pool.stageHistory[stage.id] || { stageId: stage.id, status: 'NOT_STARTED', rejectionCount: 0 };
                  const claimingTeam = teams.find(t => t.id === hist.teamId);
                  return (
                    <div key={pool.id} className="p-3.5 border border-slate-50 rounded-xl bg-slate-50/50 flex flex-col md:flex-row md:items-center justify-between gap-3 text-xs">
                      <div className="space-y-1">
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className="font-mono px-1.5 py-0.5 bg-slate-200 text-slate-600 rounded text-[10.5px] font-bold">
                            {pool.poolNo}
                          </span>
                          {pool.poolType && (
                            <span className="font-mono text-[9px] font-black text-indigo-700 bg-indigo-50 border border-indigo-100 px-1.5 py-0.5 rounded">
                              {pool.poolType}
                            </span>
                          )}
                          <strong className="text-slate-800 text-[13px]">{pool.projectName}</strong>
                          {/* QC hold badge for in-progress pools */}
                          {(() => {
                            const d = qcDefects.filter(def => def.poolId === pool.id && def.stageId === stage.id);
                            return d.length > 0 ? <QCDefectBadge defects={d} /> : null;
                          })()}
                        </div>
                        <div className="text-slate-500">
                          Assigned: <strong className="text-slate-700">{claimingTeam ? claimingTeam.name : 'Unknown Team'}</strong>
                          {hist.startTime && (
                            <span className="ml-3 font-mono text-[10px] text-slate-400">
                              Started: {new Date(hist.startTime).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                            </span>
                          )}
                        </div>
                      </div>
                      <div className="flex items-center gap-2 text-right">
                        {pool.drawingUrl && (
                          <button
                            onClick={() => setViewingDrawingPool(pool)}
                            className="p-1.5 bg-indigo-50 hover:bg-indigo-100 border border-indigo-200 text-indigo-700 rounded transition-colors cursor-pointer mr-1"
                            title="View Blueprint / CAD Layout Drawing"
                          >
                            <Eye className="h-3.5 w-3.5" />
                          </button>
                        )}
                        <button
                          onClick={() => setPrintPool(pool)}
                          className="p-1 bg-white hover:bg-slate-100 border border-slate-200 rounded text-slate-500 hover:text-slate-800 transition-colors cursor-pointer mr-1"
                          title="Print Traveler Report"
                        >
                          <Printer className="h-3.5 w-3.5" />
                        </button>
                        {getStatusBadge(hist.status)}
                        {hist.rejectionCount > 0 && (
                          <span className="px-1.5 py-0.5 bg-rose-50 text-rose-700 border border-rose-100 rounded text-[10px] font-bold">
                            Re-worked {hist.rejectionCount}x
                          </span>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          {/* History / Recent Passes */}
          <div className="bg-white p-6 rounded-2xl border border-slate-100 shadow-sm">
            <h3 className="text-sm font-black text-slate-400 uppercase tracking-wider border-b border-slate-100 pb-2 mb-4">
              Pass / Approved History in {stage.name}
            </h3>

            {approvedPools.length === 0 ? (
              <p className="text-xs text-slate-450 italic py-4 text-center text-slate-400">No pools have passed inspection at this stage yet.</p>
            ) : (
              <div className="space-y-2">
                {approvedPools.map((pool) => {
                  const hist = pool.stageHistory[stage.id] || { stageId: stage.id, status: 'NOT_STARTED', rejectionCount: 0 };
                  const signTeam = teams.find(t => t.id === hist.teamId);
                  return (
                    <div key={pool.id} className="p-3 border border-slate-50 hover:bg-slate-50 rounded-lg flex items-center justify-between text-xs transition-colors">
                      <div className="flex items-center gap-2.5 min-w-0 flex-1">
                        <span className="font-mono text-xs font-black text-emerald-600 bg-emerald-50 px-1.5 py-0.5 border border-emerald-100 rounded">
                          {pool.poolNo}
                        </span>
                        <span className="font-semibold text-slate-800 truncate mr-1.5">{pool.projectName}</span>
                        <button
                          onClick={() => setPrintPool(pool)}
                          className="p-1 bg-white hover:bg-slate-100 border border-slate-200 rounded text-slate-405 text-slate-400 hover:text-slate-700 transition-colors cursor-pointer shrink-0"
                          title="Print Traveler Report"
                        >
                          <Printer className="h-3.5 w-3.5" />
                        </button>
                      </div>
                      <div className="text-right text-slate-400 text-[10.5px]">
                        <span>QA Approved by <strong>{hist.inspectorId || 'QC Lead'}</strong></span>
                        <span className="block italic text-[9.5px]">Team: {signTeam ? signTeam.name : 'Unknown'}</span>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>

        </div>

      </div>

      {printPool && (
        <div className="fixed inset-0 bg-slate-900/80 backdrop-blur-sm flex items-center justify-center p-4 z-50 overflow-y-auto">
          {/* Dynamic print-override style tags */}
          <style dangerouslySetInnerHTML={{__html: `
            @media print {
              body * {
                visibility: hidden !important;
              }
              #printable-traveler, #printable-traveler * {
                visibility: visible !important;
              }
              #printable-traveler {
                position: absolute !important;
                left: 0 !important;
                top: 0 !important;
                width: 100% !important;
                height: auto !important;
                background: white !important;
                color: black !important;
                border: none !important;
                box-shadow: none !important;
                padding: 1.5cm !important;
              }
              .no-print {
                display: none !important;
              }
            }
          `}} />

          <div className="bg-slate-900 border border-slate-755 border-slate-700 p-5 rounded-2xl max-w-3xl w-full flex flex-col max-h-[90vh] shadow-2xl relative animate-in fade-in zoom-in-95 duration-200 text-left">
            
            {/* Banner buttons (Hidden in Print) */}
            <div className="no-print flex items-center justify-between border-b border-slate-800 pb-3 mb-4 shrink-0">
              <div className="flex items-center gap-2">
                <span className="h-2 w-2 rounded-full bg-indigo-500 animate-pulse" />
                <span className="text-xs font-bold font-mono tracking-widest uppercase text-slate-400">Print Preview Slip</span>
              </div>
              <div className="flex flex-wrap gap-2 items-center">
                {googleUser ? (
                  <button
                    type="button"
                    disabled={driveUploading === 'uploading'}
                    onClick={() => handleUploadTravelerToDrive(printPool)}
                    className={`px-3 py-2 border rounded-lg text-xs font-bold font-mono transition-all flex items-center gap-1.5 cursor-pointer shadow-sm ${
                      driveUploading === 'uploading'
                        ? 'bg-slate-800 text-slate-400 border-slate-700'
                        : driveUploading === 'success'
                        ? 'bg-emerald-900/40 text-emerald-400 border-emerald-500/40'
                        : driveUploading === 'error'
                        ? 'bg-rose-950/40 text-rose-450 border-rose-800'
                        : 'bg-slate-800 hover:bg-slate-750 text-cyan-400 border-slate-705 border-slate-700 hover:border-cyan-500/40'
                    }`}
                  >
                    {driveUploading === 'uploading' ? (
                      <>
                        <Loader2 className="h-3.5 w-3.5 animate-spin" />
                        <span>Uploading...</span>
                      </>
                    ) : driveUploading === 'success' ? (
                      <>
                        <CheckCircle2 className="h-3.5 w-3.5 text-emerald-400" />
                        <span>Sent to Drive Folder!</span>
                      </>
                    ) : driveUploading === 'error' ? (
                      <span>Failed (Retry)</span>
                    ) : (
                      <>
                        <Cloud className="h-3.5 w-3.5 text-cyan-400 shrink-0" />
                        <span>Store in Google Drive</span>
                      </>
                    )}
                  </button>
                ) : (
                  <button
                    type="button"
                    onClick={onGoogleSignIn}
                    className="px-3 py-2 bg-slate-850 hover:bg-slate-800 border border-slate-700 text-slate-350 hover:text-white rounded-lg text-xs font-mono font-bold transition-all flex items-center gap-1.5 cursor-pointer"
                    title="Connect Google Drive to direct-store Travelers"
                  >
                    <Cloud className="h-3.5 w-3.5 text-cyan-400" />
                    <span>Connect Drive</span>
                  </button>
                )}

                <button
                  type="button"
                  onClick={() => {
                    setTimeout(() => {
                      window.print();
                    }, 50);
                  }}
                  className="px-4 py-2 bg-indigo-600 hover:bg-indigo-700 text-white font-bold rounded-lg text-xs transition-colors flex items-center gap-1.5 cursor-pointer shadow-md shadow-indigo-900/30 font-mono"
                >
                  <Printer className="h-4 w-4" />
                  <span>Browser Print</span>
                </button>

                <button
                  type="button"
                  onClick={() => {
                    setPrintPool(null);
                    setDriveUploading('idle');
                  }}
                  className="p-2 bg-slate-850 hover:bg-slate-800 text-slate-400 hover:text-white rounded-lg transition-colors border border-slate-750 border-slate-705 cursor-pointer"
                >
                  <X className="h-4 w-4" />
                </button>
              </div>
            </div>

            {/* Scrollable document wrapper view */}
            <div className="overflow-y-auto p-1 text-slate-950 flex-1">
              <div 
                id="printable-traveler" 
                className="bg-white border-2 border-slate-300 p-8 rounded-lg font-mono relative text-left shadow-sm min-h-[700px] flex flex-col justify-between"
              >
                <div>
                  {/* Document Stamp Tagline */}
                  <div className="flex justify-between items-start border-b-2 border-slate-400 pb-5">
                    <div className="space-y-1">
                      <span className="text-[10px] font-black tracking-widest uppercase text-slate-500 block">SHOP PRODUCTION TRAVEL CARD</span>
                      <h3 className="text-lg font-black tracking-tight text-slate-900">MAT PLASTIC PRODUCTS</h3>
                      <span className="text-[9px] text-slate-400 block font-bold leading-none tracking-widest">Composite Pool Fabrication System</span>
                    </div>

                    {/* monospaced beautiful Barcode */}
                    <div className="flex flex-col items-end">
                      <div className="flex items-stretch h-8 w-44 bg-white border border-slate-300 px-1.5 py-1 select-none">
                        <span className="w-1 bg-black shrink-0 mr-[2px]" />
                        <span className="w-[2px] bg-black shrink-0 mr-[1px]" />
                        <span className="w-3 bg-black shrink-0 mr-[2px]" />
                        <span className="w-[1px] bg-black shrink-0 mr-[1px]" />
                        <span className="w-2 bg-black shrink-0 mr-[2px]" />
                        <span className="w-[1px] bg-black shrink-0 mr-[1px]" />
                        <span className="w-1 bg-black shrink-0 mr-[2px]" />
                        <span className="w-4 bg-black shrink-0 mr-[1px]" />
                        <span className="w-[1px] bg-black shrink-0 mr-[2px]" />
                        <span className="w-2 bg-black shrink-0 mr-[1px]" />
                        <span className="w-1 bg-black shrink-0 mr-[2px]" />
                        <span className="w-2 bg-black shrink-0" />
                      </div>
                      <span className="text-[10px] font-bold text-slate-600 mt-1 uppercase tracking-widest">{printPool.poolNo}</span>
                    </div>
                  </div>

                  {/* SPECIFICATION FIELD DETAILS */}
                  <div className="py-6 border-b-2 border-slate-300 grid grid-cols-2 gap-4 text-xs">
                    <div className="space-y-1.5">
                      <p className="flex justify-between border-b pb-1 pr-4">
                        <span className="text-slate-400 uppercase font-bold tracking-wider text-[10px]">Project:</span>
                        <strong className="text-slate-900 font-bold max-w-[150px] break-all truncate">{printPool.projectName}</strong>
                      </p>
                      <p className="flex justify-between border-b pb-1 pr-4">
                        <span className="text-slate-400 uppercase font-bold tracking-wider text-[10px]">Component ID:</span>
                        <strong className="text-slate-900 font-bold">{printPool.poolNo}</strong>
                      </p>
                      <p className="flex justify-between border-b pb-1 pr-4">
                        <span className="text-slate-400 uppercase font-bold tracking-wider text-[10px]">Matrix Date:</span>
                        <strong className="text-slate-905 text-slate-900 font-bold">{new Date(printPool.createdAt).toLocaleDateString()}</strong>
                      </p>
                    </div>
                    <div className="space-y-1.5">
                      <p className="flex justify-between border-b pb-1 pr-4">
                        <span className="text-slate-400 uppercase font-bold tracking-wider text-[10px]">Shape Matrix:</span>
                        <strong className="text-slate-900 font-bold">{printPool.shape}</strong>
                      </p>
                      <p className="flex justify-between border-b pb-1 pr-4">
                        <span className="text-slate-400 uppercase font-bold tracking-wider text-[10px]">Dimensions:</span>
                        <strong className="text-slate-900 font-bold">{printPool.dimensions}</strong>
                      </p>
                      <p className="flex justify-between border-b pb-1 pr-4">
                        <span className="text-slate-400 uppercase font-bold tracking-wider text-[10px]">Orientation:</span>
                        <strong className="text-slate-900 font-bold">{printPool.orientation} orientation</strong>
                      </p>
                    </div>
                  </div>

                  {/* NOTES SLIP */}
                  {printPool.notes && (
                    <div className="py-4 border-b border-slate-205 border-slate-200 text-xs text-slate-700">
                      <span className="uppercase text-[10px] text-slate-500 font-bold tracking-wider block mb-1">Release Engineer Notes:</span>
                      <p className="italic leading-relaxed border-l-2 border-slate-300 pl-3">
                        &quot;{printPool.notes}&quot;
                      </p>
                    </div>
                  )}

                  {/* ROUTING CHECKLIST */}
                  <div className="pt-6 space-y-4">
                    <span className="text-xs uppercase font-extrabold tracking-widest text-slate-500 block">Manufacturing Phase Routing Log</span>
                    
                    <div className="border border-slate-300 rounded overflow-hidden">
                      <div className="grid grid-cols-12 bg-slate-100 text-[9px] font-black uppercase text-slate-600 tracking-wider p-2 text-center border-b border-slate-300">
                        <span className="col-span-1 border-r text-center">No</span>
                        <span className="col-span-3 border-r text-left pl-2">Stage Name</span>
                        <span className="col-span-2 border-r">Status</span>
                        <span className="col-span-2 border-r">Workforce Team</span>
                        <span className="col-span-2 border-r">Time Record</span>
                        <span className="col-span-2 text-left pl-2">QC Sign-off</span>
                      </div>

                      {STAGES.map((s, idx) => {
                        const hist = printPool.stageHistory[s.id];
                        const isActive = printPool.currentStageIndex === idx;
                        const isPassed = printPool.currentStageIndex > idx;

                        let statusText = 'WAITING';
                        let rowColor = 'bg-white';
                        if (isPassed) {
                          statusText = 'PASSED';
                          rowColor = 'bg-emerald-50/20';
                        } else if (isActive) {
                          if (hist?.status === 'REJECTED') {
                            statusText = 'REWORK';
                            rowColor = 'bg-rose-50/30';
                          } else if (hist?.status === 'PENDING_INSPECTION') {
                            statusText = 'INSPECTION';
                            rowColor = 'bg-amber-50/20';
                          } else {
                            statusText = 'ACTIVE';
                            rowColor = 'bg-blue-50/20';
                          }
                        }

                        return (
                          <div 
                            key={s.id} 
                            className={`grid grid-cols-12 text-[10px] p-2 items-center border-b border-slate-200/80 hover:bg-slate-50 ${rowColor}`}
                          >
                            <span className="col-span-1 text-center font-bold text-slate-400 border-r pr-1">0{idx + 1}</span>
                            
                            <span className="col-span-3 border-r text-left pl-2 font-bold text-slate-800 tracking-tight truncate">
                              {s.name}
                            </span>

                            <span className="col-span-2 text-center border-r">
                              <span className={`px-1.5 py-0.2 rounded font-black text-[8.5px] uppercase tracking-wide inline-block ${
                                statusText === 'PASSED' ? 'bg-emerald-100 text-emerald-800' :
                                statusText === 'ACTIVE' ? 'bg-blue-100 text-blue-800' :
                                statusText === 'REWORK' ? 'bg-rose-100 text-rose-800' :
                                statusText === 'INSPECTION' ? 'bg-amber-100 text-amber-800' :
                                'bg-slate-100 text-slate-400'
                              }`}>
                                {statusText}
                              </span>
                            </span>

                            <span className="col-span-2 text-center text-slate-500 font-bold border-r px-1 truncate">
                              {hist?.teamId ? hist.teamId.replace(`${s.id}_`, '').toUpperCase() : '______'}
                            </span>

                            <span className="col-span-2 text-center font-bold font-mono text-[9px] border-r">
                              {hist?.durationMinutes ? `${hist.durationMinutes}m` : '______'}
                            </span>

                            <div className="col-span-2 text-left pl-2 text-slate-500 space-y-0.5 min-w-0">
                              {hist?.status === 'APPROVED' ? (
                                <div className="truncate">
                                  <span className="font-bold text-slate-800 block text-[9px] leading-tight">SIG: {hist.inspectorId}</span>
                                  {hist.inspectionTime && (
                                    <span className="text-[8px] text-slate-400 italic block">
                                      {new Date(hist.inspectionTime).toLocaleDateString()}
                                    </span>
                                  )}
                                </div>
                              ) : (
                                <span className="text-[8.5px] text-slate-300 tracking-wide">QC SIGN</span>
                              )}
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                </div>

                {/* Traveler Card Footer Sign Off Area */}
                <div className="pt-6 mt-6 border-t-2 border-slate-300">
                  <div className="grid grid-cols-2 gap-8 text-[10px] text-slate-500">
                    <div className="space-y-4">
                      <p className="flex items-end gap-1.5">
                        <span>Released By:</span>
                        <span className="border-b border-black/60 flex-1 h-[14px]" />
                      </p>
                      <p className="text-[8.5px] text-slate-400 leading-normal">
                        Certifies structure is authorized for primary stage-worker assignment and production line tracking.
                      </p>
                    </div>
                    <div className="space-y-4">
                      <p className="flex items-end gap-1.5">
                        <span>Despatched Sign:</span>
                        <span className="border-b border-black/60 flex-1 h-[14px]" />
                      </p>
                      <p className="text-[8.5px] text-slate-400 leading-normal">
                        QC Director sign-off verifies all 7 components passed 100% structural, hydrostatic, & mosaic inspection gates.
                      </p>
                    </div>
                  </div>
                  <div className="text-center text-[8px] text-slate-300 font-black tracking-widest mt-6 uppercase">
                    SYSTEM IDENTIFIER: SECURE_ROUTING_TAG_MATCH_ISO_9001
                  </div>
                </div>

              </div>
            </div>
          </div>
        </div>
      )}

      {/* ====== DRAWING/BLUEPRINT VIEWER DIALOG OVERLAY FOR SHOP FLOOR ====== */}
      {viewingDrawingPool !== null && (
        <div className="fixed inset-0 bg-slate-900/40 backdrop-blur-xs flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-2xl border border-slate-100 shadow-2xl max-w-2xl w-full overflow-hidden animate-scaleUp">
            
            {/* Header */}
            <div className="bg-slate-900 text-slate-100 py-4 px-6 flex items-center justify-between">
              <div>
                <h3 className="font-extrabold text-sm tracking-wide flex items-center gap-2">
                  <Eye className="h-4.5 w-4.5 text-indigo-400" />
                  <span>CAD DRAWING BLUEPRINT</span>
                </h3>
                <p className="text-[11px] text-slate-400 mt-0.5">
                  Showing blueprint layout for Pool <span className="text-white font-mono font-bold font-black">{viewingDrawingPool.poolNo}</span> ({viewingDrawingPool.poolType || 'Type Default'})
                </p>
              </div>
              <button
                onClick={() => setViewingDrawingPool(null)}
                className="text-slate-400 hover:text-white transition-colors p-1.5 hover:bg-white/10 rounded-lg cursor-pointer"
              >
                <X className="h-5 w-5" />
              </button>
            </div>

            {/* Content */}
            <div className="p-6 bg-slate-950 flex flex-col items-center justify-center border-b border-slate-800">
              <div className="w-full bg-slate-900 border border-slate-800 rounded-xl p-3 shadow-inner flex items-center justify-center">
                {viewingDrawingPool.drawingUrl ? (
                  <img 
                    src={viewingDrawingPool.drawingUrl} 
                    referrerPolicy="no-referrer"
                    alt="Layout Drawing Spec" 
                    className="max-h-[360px] max-w-full object-contain rounded-lg shadow-md"
                  />
                ) : (
                  <div className="h-[200px] flex flex-col items-center justify-center text-slate-500 space-y-2">
                    <span className="text-xs">No vector blueprint is loaded for this model.</span>
                  </div>
                )}
              </div>
            </div>

            {/* Metadata Footer */}
            <div className="bg-slate-50 p-4 px-6 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 text-xs text-slate-600">
              <div className="grid grid-cols-2 gap-x-6 gap-y-1">
                <div>
                  Project: <strong className="text-slate-800">{viewingDrawingPool.projectName}</strong>
                </div>
                <div>
                  Orientation: <strong className="text-slate-800">{viewingDrawingPool.orientation}</strong>
                </div>
                <div>
                  Dimensions: <strong className="text-slate-800">{viewingDrawingPool.dimensions}</strong>
                </div>
                {viewingDrawingPool.poolType && (
                  <div>
                    Pool Type: <strong className="text-indigo-600 font-mono font-bold">{viewingDrawingPool.poolType}</strong>
                  </div>
                )}
              </div>
              <button
                onClick={() => setViewingDrawingPool(null)}
                className="bg-slate-900 hover:bg-slate-800 text-white font-black px-4 py-2 rounded-xl text-xs cursor-pointer shadow-sm ml-auto"
              >
                Close Drawing Screen
              </button>
            </div>

          </div>
        </div>
      )}

    </div>
  );
};
