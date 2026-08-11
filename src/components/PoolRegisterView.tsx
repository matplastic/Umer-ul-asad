import React, { useState } from 'react';
import { Search, SlidersHorizontal, ChevronLeft, ChevronRight, Compass, Ruler, Layers, Eye } from 'lucide-react';
import { Pool, Team } from '../types';
import { STAGES } from '../data/mockData';

// Pool Register — VIEW ONLY
// ──────────────────────────────────────────────────────────────────────────
// Same pool registry data Management sees in "Pools Registry Tracker"
// (search, project filter, per-pool stage clearance history), but with the
// "Scrap Pool" delete action and any editing removed. A Factory Supervisor
// can look up a pool's full history here but cannot modify or delete it.

interface PoolRegisterViewProps {
  pools: Pool[];
  teams: Team[];
}

const POOLS_PER_PAGE = 7;

export const PoolRegisterView: React.FC<PoolRegisterViewProps> = ({ pools, teams }) => {
  const [searchTerm, setSearchTerm] = useState('');
  const [selectedProjectFilter, setSelectedProjectFilter] = useState<string>('ALL');
  const [poolsPage, setPoolsPage] = useState(1);
  const [selectedPoolId, setSelectedPoolId] = useState<string | null>(null);

  const uniqueProjectsList = Array.from(new Set(pools.map(p => p.projectName))).filter(Boolean) as string[];

  const filteredPools = pools.filter((p) => {
    const matchesProject = selectedProjectFilter === 'ALL' || p.projectName === selectedProjectFilter;
    const matchesSearch =
      p.projectName.toLowerCase().includes(searchTerm.toLowerCase()) ||
      p.poolNo.toLowerCase().includes(searchTerm.toLowerCase()) ||
      (p.shape || '').toLowerCase().includes(searchTerm.toLowerCase());
    return matchesProject && matchesSearch;
  });

  const totalPoolsPages = Math.ceil(filteredPools.length / POOLS_PER_PAGE) || 1;
  const paginatedPools = filteredPools.slice(
    (poolsPage - 1) * POOLS_PER_PAGE,
    poolsPage * POOLS_PER_PAGE
  );

  const selectedPool = pools.find(p => p.id === selectedPoolId) || filteredPools[0] || pools[0];

  return (
    <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">

      {/* Left selector col */}
      <div className="lg:col-span-12 xl:col-span-5 bg-white p-5 rounded-2xl border border-slate-100 shadow-sm flex flex-col h-[600px] justify-between">
        <div>
          <div className="space-y-2 mb-4">
            <div className="relative">
              <Search className="absolute top-2.5 left-3 h-4 w-4 text-slate-400" />
              <input
                type="text"
                placeholder="Search project name or pool ID..."
                value={searchTerm}
                onChange={(e) => {
                  setSearchTerm(e.target.value);
                  setPoolsPage(1);
                  if (filteredPools.length > 0) setSelectedPoolId(filteredPools[0].id);
                }}
                className="w-full pl-9 pr-4 py-2 text-xs border border-slate-200 rounded-xl focus:outline-none focus:ring-1 focus:ring-slate-400"
              />
            </div>

            <div className="flex items-center gap-2">
              <SlidersHorizontal className="h-3.5 w-3.5 text-slate-400 flex-shrink-0" />
              <select
                value={selectedProjectFilter}
                onChange={(e) => {
                  setSelectedProjectFilter(e.target.value);
                  setPoolsPage(1);
                  const matched = pools.filter(p => e.target.value === 'ALL' || p.projectName === e.target.value);
                  if (matched.length > 0) setSelectedPoolId(matched[0].id);
                }}
                className="w-full text-xs bg-slate-50 border border-slate-200 text-slate-700 px-2 py-1.5 rounded-lg font-semibold outline-none focus:border-slate-300"
              >
                <option value="ALL">All Active Projects ({uniqueProjectsList.length})</option>
                {uniqueProjectsList.map(proj => (
                  <option key={proj} value={proj}>{proj}</option>
                ))}
              </select>
            </div>
          </div>

          <div className="space-y-1.5 max-h-[380px] overflow-y-auto">
            {paginatedPools.length === 0 ? (
              <p className="text-xs text-slate-400 text-center py-10">No matching pool registrations.</p>
            ) : (
              paginatedPools.map((pool) => {
                const isSelected = pool.id === selectedPoolId || (!selectedPoolId && pool.id === pools[0]?.id);
                const currentStage = STAGES[pool.currentStageIndex];

                return (
                  <button
                    key={pool.id}
                    onClick={() => setSelectedPoolId(pool.id)}
                    className={`w-full text-left p-3 rounded-xl border cursor-pointer block transition-all ${
                      isSelected
                        ? 'border-slate-900 bg-slate-900 text-white shadow-md'
                        : 'border-slate-100 hover:border-slate-205 hover:bg-slate-50'
                    }`}
                  >
                    <div className="flex justify-between items-center text-[11px]">
                      <span className="flex items-center gap-1">
                        <span className={`font-mono font-black text-[10px] px-1.5 py-0.5 rounded ${
                          isSelected ? 'bg-slate-800 text-teal-400' : 'bg-slate-100 text-slate-500'
                        }`}>
                          {pool.poolNo}
                        </span>
                        <span className={`text-[9px] font-bold px-1 py-0.2 rounded uppercase ${
                          isSelected ? 'bg-slate-700 text-teal-300' : 'bg-indigo-50 text-indigo-700'
                        }`}>
                          {pool.poolType || 'Type 3'}
                        </span>
                      </span>
                      <span className={`text-[9.5px] font-bold ${isSelected ? 'text-slate-300' : 'text-slate-500'}`}>
                        {currentStage ? currentStage.name : 'Completed & Dispatched'}
                      </span>
                    </div>
                    <h4 className="text-xs font-extrabold mt-1.5 tracking-tight truncate">{pool.projectName}</h4>
                  </button>
                );
              })
            )}
          </div>
        </div>

        {totalPoolsPages > 1 && (
          <div className="flex items-center justify-between border-t border-slate-150 pt-3 text-xs">
            <span className="text-slate-400 font-medium">
              Showing {paginatedPools.length} of {filteredPools.length} shells
            </span>
            <div className="flex gap-1">
              <button
                disabled={poolsPage === 1}
                onClick={() => setPoolsPage(prev => Math.max(1, prev - 1))}
                className="p-1.5 rounded-lg border border-slate-200 text-slate-500 hover:bg-slate-50 disabled:opacity-30 disabled:hover:bg-transparent cursor-pointer"
              >
                <ChevronLeft className="h-3.5 w-3.5" />
              </button>
              <span className="px-2 py-1 bg-slate-100 font-bold rounded text-[11px] text-slate-700 min-w-[30px] text-center font-mono">
                {poolsPage}/{totalPoolsPages}
              </span>
              <button
                disabled={poolsPage === totalPoolsPages}
                onClick={() => setPoolsPage(prev => Math.min(totalPoolsPages, prev + 1))}
                className="p-1.5 rounded-lg border border-slate-200 text-slate-500 hover:bg-slate-50 disabled:opacity-30 disabled:hover:bg-transparent cursor-pointer"
              >
                <ChevronRight className="h-3.5 w-3.5" />
              </button>
            </div>
          </div>
        )}
      </div>

      {/* Right details panel — view only, no Scrap/Edit actions */}
      <div className="lg:col-span-7 bg-white p-6 rounded-2xl border border-slate-100 shadow-sm min-h-[600px]">
        {selectedPool ? (
          <div className="space-y-6">

            <div className="border-b border-slate-100 pb-4">
              <div className="flex justify-between items-start gap-4">
                <div>
                  <span className="font-mono text-xs font-black text-cyan-600 bg-cyan-50 px-2.5 py-0.5 border border-cyan-100 rounded">
                    {selectedPool.poolNo}
                  </span>
                  <h3 className="text-lg font-black text-slate-900 mt-2 tracking-tight">
                    {selectedPool.projectName}
                  </h3>
                </div>
                <span className="px-3 py-1.5 bg-slate-50 border border-slate-100 text-slate-400 text-xs font-extrabold uppercase rounded-lg flex items-center gap-1 shrink-0">
                  <Eye className="h-3.5 w-3.5" />
                  <span>View Only</span>
                </span>
              </div>

              <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mt-4 text-xs">
                <div>
                  <span className="text-slate-400 block font-bold">Orientation</span>
                  <strong className="text-slate-700 flex items-center gap-1 mt-0.5">
                    <Compass className="h-4 w-4 text-amber-500" />
                    {selectedPool.orientation}
                  </strong>
                </div>
                <div>
                  <span className="text-slate-400 block font-bold">Base Dimensions</span>
                  <strong className="text-slate-700 flex items-center gap-1 mt-0.5">
                    <Ruler className="h-4 w-4 text-blue-500" />
                    {selectedPool.dimensions}
                  </strong>
                </div>
                <div>
                  <span className="text-slate-400 block font-bold">Curvature Shape</span>
                  <strong className="text-slate-700 mt-0.5 block truncate">
                    {selectedPool.shape}
                  </strong>
                </div>
                <div>
                  <span className="text-slate-400 block font-bold">Release Timestamp</span>
                  <strong className="text-slate-500 mt-0.5 block truncate font-mono text-[10px]">
                    {new Date(selectedPool.createdAt).toLocaleDateString()}
                  </strong>
                </div>
              </div>
            </div>

            <div className="space-y-4">
              <h4 className="text-xs font-black text-slate-500 uppercase tracking-widest flex items-center gap-1">
                <Layers className="h-4 w-4" />
                Stage Clearance Progress Ledger
              </h4>

              <div className="space-y-5 relative pl-4 before:absolute before:inset-y-1 before:left-1.5 before:w-[1px] before:bg-slate-100">
                {STAGES.map((stage, idx) => {
                  const hist = selectedPool.stageHistory[stage.id];
                  const isActive = selectedPool.currentStageIndex === idx;
                  const isApproved = hist && hist.status === 'APPROVED';
                  const isRework = hist && hist.status === 'REJECTED';
                  const isSkipped = hist && hist.status === 'SKIPPED';
                  const isCarried = hist && hist.status === 'CARRIED_ON_SITE';

                  let dotColor = 'bg-slate-205 bg-slate-200 border-slate-300';
                  if (isApproved) dotColor = 'bg-emerald-500 border-emerald-600 shadow-sm shadow-emerald-500/40';
                  else if (isSkipped) dotColor = 'bg-amber-500 border-amber-600 shadow-sm shadow-amber-500/30';
                  else if (isCarried) dotColor = 'bg-purple-500 border-purple-600 shadow-sm shadow-purple-500/30';
                  else if (isActive) dotColor = 'bg-blue-500 border-blue-600 animate-pulse shadow-sm shadow-blue-500/40';
                  else if (isRework) dotColor = 'bg-rose-500 border-rose-600';

                  return (
                    <div key={stage.id} className="relative flex flex-col md:flex-row md:items-start justify-between gap-2 text-xs">
                      <span className={`absolute -left-4.5 mt-1 h-3 w-3 rounded-full border-2 ${dotColor}`} />

                      <div className="space-y-1 md:max-w-xs">
                        <h5 className="font-bold text-slate-900 flex items-center gap-1.5">
                          {stage.name}
                          {isActive && <span className="bg-blue-100 text-blue-800 text-[9px] font-bold px-1.5 py-0.2 rounded font-mono animate-pulse">Floor Active</span>}
                        </h5>
                        <p className="text-[11px] text-slate-505 text-slate-500 font-medium">
                          status: <strong className="text-slate-700">{hist ? hist.status : 'NOT_STARTED'}</strong>
                          {hist?.rejectionCount > 0 && <span className="text-rose-600 font-bold ml-2">({hist.rejectionCount} rework loops)</span>}
                        </p>
                        {hist?.startTime && (
                          <p className="text-[10px] text-slate-400 font-mono">
                            Time frame: {new Date(hist.startTime).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}
                            {hist.endTime ? ` → ${new Date(hist.endTime).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}` : ' (Ongoing)'}
                          </p>
                        )}
                      </div>

                      <div className="text-right text-[11px] bg-slate-50 border border-slate-100 p-2 rounded-lg md:min-w-[180px]">
                        {hist && hist.status !== 'NOT_STARTED' ? (
                          <div className="space-y-1">
                            <p className="font-semibold text-slate-700">Team: {teams.find(t => t.id === hist.teamId)?.name || hist.teamId}</p>
                            {hist.durationMinutes && (
                              <p className="text-[10px] text-slate-400 font-mono">Duration: {hist.durationMinutes} minutes</p>
                            )}
                            {hist.inspectorId && (
                              <div className="border-t border-slate-200/50 pt-1 mt-1 font-sans text-slate-500 text-[10.5px]">
                                <p className="font-bold text-emerald-700">QC signed: {hist.inspectorId}</p>
                                <p className="italic text-[9.5px] line-clamp-2" title={hist.inspectorNotes}>&quot;{hist.inspectorNotes}&quot;</p>
                                {hist.inspectorPicture && (
                                  <div className="mt-1 flex justify-end relative group">
                                    <img
                                      src={hist.inspectorPicture}
                                      alt="Inspection Attachment"
                                      className="h-8 w-10 object-cover rounded border border-slate-250 cursor-pointer transition-all hover:scale-150 relative z-10"
                                      referrerPolicy="no-referrer"
                                    />
                                    <div className="absolute right-0 bottom-full mb-1.5 hidden group-hover:block z-50 bg-slate-900 p-1 rounded-lg shadow-xl border border-slate-705 border-slate-700 w-44">
                                      <img
                                        src={hist.inspectorPicture}
                                        alt="Enlarged evidence"
                                        className="w-full h-auto object-contain max-h-[140px] rounded"
                                        referrerPolicy="no-referrer"
                                      />
                                    </div>
                                  </div>
                                )}
                              </div>
                            )}
                          </div>
                        ) : (
                          <span className="text-slate-400 italic">No activity logged</span>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>

          </div>
        ) : (
          <div className="py-24 text-center">
            <span className="text-xs text-slate-400">Select a pool to inspect historical details</span>
          </div>
        )}
      </div>

    </div>
  );
};
