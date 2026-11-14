import React, { useState } from 'react';
import { Pool } from '../types';
import { STAGES } from '../data/mockData';
import { Compass, Ruler, ShieldAlert, CheckCircle, Clock } from 'lucide-react';

interface FactoryEntranceProps {
  pools: Pool[];
}

export const FactoryEntrance: React.FC<FactoryEntranceProps> = ({ pools }) => {
  const [startDateStr, setStartDateStr] = useState('');
  const [endDateStr, setEndDateStr] = useState('');

  // Filter pools by date range before computing active pools and stage layout
  const dateFilteredPools = pools.filter((p) => {
    if (startDateStr) {
      const start = new Date(startDateStr);
      start.setHours(0, 0, 0, 0);
      if (new Date(p.createdAt) < start) {
        return false;
      }
    }
    if (endDateStr) {
      const end = new Date(endDateStr);
      end.setHours(23, 59, 59, 999);
      if (new Date(p.createdAt) > end) {
        return false;
      }
    }
    return true;
  });

  const activePools = dateFilteredPools.filter(p => p.currentStageIndex < 7);
  const completedPoolsCount = dateFilteredPools.filter(p => p.currentStageIndex >= 7).length;

  const getStageStatusColor = (pool: Pool, stageId: string) => {
    const hist = pool.stageHistory[stageId];
    if (!hist) return 'bg-slate-200';
    switch (hist.status) {
      case 'APPROVED':
        return 'bg-emerald-500 shadow-sm shadow-emerald-500/50';
      case 'SKIPPED':
        return 'bg-amber-550/80 shadow-sm shadow-amber-500/30 border border-amber-300';
      case 'CARRIED_ON_SITE':
        return 'bg-purple-500 shadow-sm shadow-purple-500/30 border border-purple-300';
      case 'IN_PROGRESS':
        return 'bg-blue-500 animate-pulse shadow-sm shadow-blue-500/50';
      case 'PENDING_INSPECTION':
        return 'bg-amber-500 animate-pulse shadow-sm shadow-amber-500/50';
      case 'REJECTED':
        return 'bg-rose-500 animate-bounce shadow-sm shadow-rose-500/50';
      default:
        return 'bg-slate-200/40 border border-slate-300';
    }
  };

  return (
    <div className="bg-slate-50 text-slate-800 p-6 rounded-3xl border border-slate-200 shadow-2xl space-y-6 select-none">
      
      {/* Factory Banner Title */}
      <div className="flex flex-col md:flex-row md:items-center md:justify-between border-b border-slate-200 pb-5 gap-4">
        <div>
          <div className="flex items-center gap-2">
            <span className="h-3.5 w-3.5 rounded-full bg-emerald-500 animate-ping"></span>
            <span className="text-xs font-bold font-mono tracking-widest text-emerald-700 uppercase">Live Shop Floor Monitor</span>
          </div>
          <h2 className="text-2xl font-black tracking-tight text-slate-900 mt-1">MAT PLASTIC INDUSTRIES MAIN ENTRANCE BOARD</h2>
          <p className="text-xs text-slate-500 mt-1 font-mono">RELOADS AUTOMATICALLY • SECURED LOCAL NETWORK DISPATCH</p>
        </div>

        {/* Big TV Stats Row */}
        <div className="flex flex-wrap gap-4">
          <div className="bg-white p-3.5 px-6 rounded-2xl border border-slate-200 text-center min-w-[130px]">
            <span className="block text-2xl font-black text-slate-900 font-mono">{activePools.length}</span>
            <span className="text-[10px] text-slate-500 uppercase tracking-widest font-bold">Unfinished Shells</span>
          </div>
          <div className="bg-white p-3.5 px-6 rounded-2xl border border-slate-200 text-center min-w-[130px]">
            <span className="block text-2xl font-black text-emerald-700 font-mono">{completedPoolsCount}</span>
            <span className="text-[10px] text-slate-500 uppercase tracking-widest font-bold">Shipped / Completed</span>
          </div>
          <div className="bg-white p-3.5 px-6 rounded-2xl border border-slate-200 text-center min-w-[130px]">
            <span className="block text-2xl font-black text-amber-700 font-mono">
              {dateFilteredPools.filter(p => {
                const s = STAGES[p.currentStageIndex];
                return s && p.stageHistory[s.id]?.status === 'PENDING_INSPECTION';
              }).length}
            </span>
            <span className="text-[10px] text-slate-500 uppercase tracking-widest font-bold">QA Gate Holds</span>
          </div>
        </div>
      </div>

      {/* Retrowave control board styled date filter */}
      <div className="bg-slate-50 p-4 rounded-2xl border border-slate-200 flex flex-col md:flex-row md:items-center justify-between gap-4 font-mono text-xs">
        <div className="flex items-center gap-2.5 text-slate-350">
          <Clock className="h-4.5 w-4.5 text-emerald-700" />
          <div>
            <span className="text-[11px] font-black uppercase text-emerald-700 block tracking-wider">Board Dispatch Interval</span>
            <span className="text-[9.5px] text-slate-550 font-sans font-medium">Temporal filter matching product matrix entry dates</span>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-4">
          <div className="flex items-center gap-2">
            <span className="text-slate-500 font-bold">FROM:</span>
            <input
              type="date"
              value={startDateStr}
              onChange={(e) => setStartDateStr(e.target.value)}
              className="bg-slate-50 border border-slate-200 rounded px-2 py-1 text-slate-800 font-extrabold focus:outline-hidden focus:ring-1 focus:ring-emerald-500 cursor-pointer text-xs"
            />
          </div>

          <div className="flex items-center gap-2">
            <span className="text-slate-500 font-bold">TO:</span>
            <input
              type="date"
              value={endDateStr}
              onChange={(e) => setEndDateStr(e.target.value)}
              className="bg-slate-50 border border-slate-200 rounded px-2 py-1 text-slate-800 font-extrabold focus:outline-hidden focus:ring-1 focus:ring-emerald-500 cursor-pointer text-xs"
            />
          </div>

          {(startDateStr || endDateStr) && (
            <button
              type="button"
              onClick={() => {
                setStartDateStr('');
                setEndDateStr('');
              }}
              className="bg-rose-50 hover:bg-rose-100 border border-rose-200 text-rose-450 text-rose-700 font-black px-3 py-1 rounded text-[10px] tracking-wider uppercase transition-colors cursor-pointer"
            >
              Reset
            </button>
          )}
        </div>
      </div>

      {/* Main Grid: Live Pipeline View (Columns for Each Stage) */}
      <div className="space-y-4">
        <h3 className="text-xs font-black text-slate-500 uppercase tracking-wider mb-2 font-mono">
          Stage Pipeline Matrix
        </h3>

        {activePools.length === 0 ? (
          <div className="text-center py-20 bg-white rounded-2xl border border-slate-200">
            <p className="text-sm font-bold text-slate-500">All pools closed and shipped!</p>
            <p className="text-xs text-slate-500 mt-1">Eng. releases required in Production Portal to start lines.</p>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-7 gap-4">
            {STAGES.map((stage, idx) => {
              // Get pools current active on this specific stage index
              const stagePools = activePools.filter(p => p.currentStageIndex === idx);

              return (
                <div key={stage.id} className="bg-white rounded-2xl p-4 border border-slate-200 flex flex-col min-h-[380px]">
                  {/* Column Header */}
                  <div className="border-b border-slate-805 border-slate-200 pb-2 mb-3">
                    <span className="font-mono text-[10px] font-bold text-slate-500 block tracking-widest uppercase">STAGE 0{idx + 1}</span>
                    <h4 className="text-sm font-black text-slate-900 flex items-center gap-1.5 truncate" title={stage.name}>
                      <span className="h-2 w-2 rounded-full inline-block" style={{ backgroundColor: stage.color }} />
                      {stage.name}
                    </h4>
                  </div>

                  {/* Pool cards loaded in this stage column */}
                  <div className="space-y-3 flex-1 overflow-y-auto pr-1">
                    {stagePools.length === 0 ? (
                      <div className="h-full flex items-center justify-center text-center">
                        <span className="text-[10px] uppercase font-bold text-slate-400 tracking-wider">Empty Row</span>
                      </div>
                    ) : (
                      stagePools.map(pool => {
                        const hist = pool.stageHistory[stage.id];
                        const isRejected = hist?.status === 'REJECTED';
                        const isPendingInspection = hist?.status === 'PENDING_INSPECTION';

                        return (
                          <div 
                            key={pool.id}
                            className={`p-3 rounded-xl border transition-all ${
                              isRejected 
                                ? 'border-rose-500/40 bg-rose-50 shadow-md shadow-rose-200' 
                                : isPendingInspection
                                ? 'border-amber-500/40 bg-amber-50 shadow-md shadow-amber-200'
                                : 'border-slate-200 bg-white hover:border-slate-300'
                            }`}
                          >
                            <div className="flex justify-between items-start">
                              <span className="font-mono text-[10px] font-black text-cyan-700 bg-slate-50 px-1 py-0.5 rounded border border-slate-200">
                                {pool.poolNo}
                              </span>
                              
                              <div className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: stage.color }} />
                            </div>

                            <p className="text-xs font-bold text-slate-900 mt-2 truncate max-w-full" title={pool.projectName}>
                              {pool.projectName}
                            </p>

                            {/* Details tags */}
                            <div className="mt-2 flex flex-wrap gap-x-2 text-[9px] text-slate-500 font-mono">
                              <span>{pool.dimensions}</span>
                              <span className="text-slate-650 text-slate-400">|</span>
                              <span className="flex items-center gap-0.5">
                                <Compass className="h-2.5 w-2.5" />
                                {pool.orientation[0]}
                              </span>
                            </div>

                            {/* Attention badging */}
                            {isRejected && (
                              <div className="mt-2.5 flex items-center gap-1 text-[9.5px] font-black text-rose-700 uppercase tracking-widest bg-rose-50 py-0.5 px-1.5 rounded border border-rose-200">
                                <ShieldAlert className="h-3 w-3 animate-bounce" />
                                <span>Rework hold</span>
                              </div>
                            )}

                            {isPendingInspection && (
                              <div className="mt-2.5 flex items-center gap-1 text-[9.5px] font-black text-amber-700 uppercase tracking-widest bg-amber-50 py-0.5 px-1.5 rounded border border-amber-200">
                                <Clock className="h-3 w-3 animate-spin" />
                                <span>Pending QA</span>
                              </div>
                            )}
                          </div>
                        );
                      })
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Footer Block: Overall Factory Flow Mapping (Horizontal pipeline list) */}
      <div className="bg-white p-5 rounded-2xl border border-slate-200 space-y-3">
        <h4 className="text-xs font-extrabold text-slate-700 font-mono uppercase tracking-widest flex items-center gap-1.5">
          <Clock className="h-4 w-4 text-cyan-700" />
          Active Pools Global Completion Map
        </h4>

        <div className="space-y-3">
          {activePools.map(pool => (
            <div key={pool.id} className="bg-slate-50 p-3 rounded-lg border border-slate-200 flex flex-col lg:flex-row lg:items-center justify-between gap-3 text-xs">
              
              <div className="flex items-center gap-2 min-w-[200px]">
                <span className="font-mono text-[9px] font-semibold text-slate-500 px-1 py-0.5 bg-white border border-slate-200 rounded">
                  {pool.poolNo}
                </span>
                <span className="font-bold text-slate-900 truncate">{pool.projectName}</span>
              </div>

              {/* Progress Steps Visualizer dot flow */}
              <div className="flex items-center flex-1 gap-1 px-4 justify-start lg:justify-center">
                {STAGES.map((stage, idx) => {
                  const isActive = pool.currentStageIndex === idx;
                  const isPassed = pool.currentStageIndex > idx;
                  let bgClass = 'bg-slate-200';
                  if (isActive) {
                    const status = pool.stageHistory[stage.id]?.status;
                    bgClass = status === 'REJECTED' ? 'bg-rose-500' : status === 'PENDING_INSPECTION' ? 'bg-amber-500 animate-pulse' : 'bg-blue-500 animate-pulse';
                  } else if (isPassed) {
                    bgClass = 'bg-emerald-500';
                  }

                  return (
                    <React.Fragment key={stage.id}>
                      {idx > 0 && (
                        <div className={`h-0.5 flex-1 max-w-[24px] ${isPassed ? 'bg-emerald-600' : 'bg-slate-100'}`} />
                      )}
                      <div 
                        className={`h-4.5 w-4.5 rounded-full flex items-center justify-center text-[8px] font-black cursor-help transition-all ${bgClass} ${isActive ? 'scale-125 ring-2 ring-white/20' : ''}`}
                        title={`${stage.name}: ${isActive ? 'Current Step' : isPassed ? 'Pass' : 'Idle'}`}
                      >
                        {idx + 1}
                      </div>
                    </React.Fragment>
                  );
                })}
              </div>

              {/* Status display */}
              <div className="min-w-[120px] text-right">
                <span className="text-[10px] font-mono text-slate-500">
                  Current: <strong className="text-cyan-700">{STAGES[pool.currentStageIndex]?.name || 'Assembly Done'}</strong>
                </span>
              </div>

            </div>
          ))}
        </div>
      </div>

    </div>
  );
};
