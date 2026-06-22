import React, { useState, useEffect } from 'react';
import { Pool, StageId, Team, ActivityLog } from '../types';
import { STAGES } from '../data/mockData';
import { 
  Tv, 
  Search, 
  Compass, 
  Ruler, 
  Layout, 
  Clock, 
  CheckCircle2, 
  AlertTriangle, 
  Play, 
  ClipboardCheck, 
  HardHat, 
  Workflow, 
  RefreshCw,
  FolderDot
} from 'lucide-react';

interface SectionDashboardTVProps {
  pools: Pool[];
  teams: Team[];
  logs: ActivityLog[];
}

export const SectionDashboardTV: React.FC<SectionDashboardTVProps> = ({ pools, teams, logs }) => {
  const [selectedStageId, setSelectedStageId] = useState<StageId>('steel_fabrication');
  const [projectSearch, setProjectSearch] = useState('');
  const [poolSearch, setPoolSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<string>('ALL');
  const [selectedProject, setSelectedProject] = useState<string>('ALL');
  
  // Big Clock
  const [timeStr, setTimeStr] = useState('');
  useEffect(() => {
    const updateTime = () => {
      const now = new Date();
      setTimeStr(now.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false }));
    };
    updateTime();
    const interval = setInterval(updateTime, 1000);
    return () => clearInterval(interval);
  }, []);

  const activeStage = STAGES.find(s => s.id === selectedStageId) || STAGES[0];
  const stageIndex = STAGES.findIndex(s => s.id === selectedStageId);

  // Get all unique projects in the system for filtering
  const uniqueProjects = Array.from(new Set(pools.map(p => p.projectName))).filter(Boolean);

  // Filter pools currently in THIS stage index
  const poolsInStage = pools.filter(p => p.currentStageIndex === stageIndex);
  
  // Specific stage stats
  const activeCount = poolsInStage.length;
  const inProgressCount = poolsInStage.filter(p => p.stageHistory[selectedStageId]?.status === 'IN_PROGRESS').length;
  const pendingQaCount = poolsInStage.filter(p => p.stageHistory[selectedStageId]?.status === 'PENDING_INSPECTION').length;
  const rejectedCount = poolsInStage.filter(p => p.stageHistory[selectedStageId]?.status === 'REJECTED').length;
  const notStartedCount = poolsInStage.filter(p => p.stageHistory[selectedStageId]?.status === 'NOT_STARTED').length;

  // Historical completed items in this stage (where status is APPROVED)
  const historyCount = pools.filter(p => p.stageHistory[selectedStageId]?.status === 'APPROVED').length;

  // Teams active in this stage
  const stageTeams = teams.filter(t => t.stageId === selectedStageId);

  // Filtered pool list for the table display
  const filteredPools = poolsInStage.filter(p => {
    const stageInfo = p.stageHistory[selectedStageId];
    if (!stageInfo) return false;
    
    const matchesProject = selectedProject === 'ALL' || p.projectName === selectedProject;
    const matchesSearch = p.projectName.toLowerCase().includes(projectSearch.toLowerCase()) && p.poolNo.toLowerCase().includes(poolSearch.toLowerCase());
    
    if (statusFilter === 'ALL') return matchesProject && matchesSearch;
    return matchesProject && matchesSearch && stageInfo.status === statusFilter;
  });

  // Logs for this specific stage
  const stageLogs = logs
    .filter(l => l.stageId === selectedStageId)
    .slice(0, 15); // Show latest 15 logs on department TV

  return (
    <div className="space-y-6">
      
      {/* Selector/Header Bar */}
      <div className="bg-slate-900 border border-slate-800 p-5 rounded-2xl shadow-lg text-white">
        <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4">
          
          <div className="flex items-center gap-3">
            <div className="bg-cyan-600/20 text-cyan-400 p-3 rounded-xl border border-cyan-500/30">
              <Tv className="h-6 w-6" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <span className="h-2 w-2 rounded-full bg-emerald-500 animate-ping"></span>
                <span className="text-[10px] font-bold text-cyan-400 uppercase tracking-widest font-mono">Dedicated TV Casting Screen</span>
              </div>
              <h2 className="text-xl font-bold tracking-tight">Departmental TV Dispatch Board</h2>
              <p className="text-xs text-slate-400">Cast this section view onto shop-floor TV panels for real-time assembly coordination.</p>
            </div>
          </div>

          {/* Clock & Selection */}
          <div className="flex flex-wrap items-center gap-4">
            <div className="bg-slate-800 border border-slate-700 rounded-xl px-4 py-2 text-right">
              <span className="text-[10px] font-bold text-slate-400 uppercase tracking-widest block font-mono">System Time</span>
              <span className="text-lg font-black font-mono text-cyan-400">{timeStr || '12:00:00'}</span>
            </div>

            <div className="space-y-1">
              <span className="text-[10px] font-bold text-slate-400 uppercase tracking-widest block">Select Subsection Feed:</span>
              <select
                value={selectedStageId}
                onChange={(e) => setSelectedStageId(e.target.value as StageId)}
                className="bg-slate-800 border border-slate-700 text-white text-xs rounded-xl px-3 py-2 cursor-pointer font-bold focus:outline-none focus:ring-1 focus:ring-cyan-500 hover:bg-slate-750 transition-colors"
                style={{ borderLeftColor: activeStage.color, borderLeftWidth: '4px' }}
              >
                {STAGES.map(s => (
                  <option key={s.id} value={s.id} className="text-slate-900 bg-white font-medium">
                    {s.name} Section Display
                  </option>
                ))}
              </select>
            </div>
          </div>

        </div>
      </div>

      {/* Main Department Title & KPI Banner */}
      <div 
        className="relative overflow-hidden text-white rounded-3xl p-6 lg:p-8 shadow-md border"
        style={{ 
          background: `linear-gradient(135deg, ${activeStage.color}15 0%, #0f172a 100%)`,
          borderColor: `${activeStage.color}30`
        }}
      >
        <div className="absolute top-0 right-0 w-96 h-96 bg-gradient-to-br from-white/5 to-transparent rounded-full -mr-20 -mt-20 blur-2xl pointer-events-none" />
        
        <div className="relative flex flex-col md:flex-row md:items-center justify-between gap-6 z-10">
          <div>
            <span 
              className="text-xs font-black tracking-widest uppercase px-3 py-1 rounded-full border"
              style={{ color: activeStage.color, borderColor: `${activeStage.color}40`, backgroundColor: `${activeStage.color}10` }}
            >
              PHYSICAL DEPT {stageIndex + 1} OF 7
            </span>
            <h1 className="text-3xl font-black text-white mt-3.5 tracking-tight uppercase">
              {activeStage.name} SHOP SECTION
            </h1>
            <p className="text-slate-300 text-sm mt-1 max-w-xl font-medium">
              Real-time schedule queue, operator tracking, and quality metrics for MAT PLASTIC INDUSTRIES LLC shell assemblies.
            </p>
          </div>

          {/* Quick Stats Grid */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            <div className="bg-slate-900/60 backdrop-blur border border-slate-800 p-4 rounded-2xl text-center min-w-[120px]">
              <span className="block text-3xl font-black text-cyan-400 font-mono">{activeCount}</span>
              <span className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">Active Shells</span>
            </div>
            
            <div className="bg-slate-900/60 backdrop-blur border border-slate-800 p-4 rounded-2xl text-center min-w-[120px]">
              <span className="block text-3xl font-black text-yellow-500 font-mono">{pendingQaCount}</span>
              <span className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">Pending QA</span>
            </div>

            <div className="bg-slate-900/60 backdrop-blur border border-slate-800 p-4 rounded-2xl text-center min-w-[120px]">
              <span className="block text-3xl font-black text-rose-500 font-mono">{rejectedCount}</span>
              <span className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">Rework holds</span>
            </div>

            <div className="bg-slate-900/60 backdrop-blur border border-slate-800 p-4 rounded-2xl text-center min-w-[120px]">
              <span className="block text-3xl font-black text-emerald-400 font-mono">{historyCount}</span>
              <span className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">Total Approved</span>
            </div>
          </div>
        </div>
      </div>

      {/* Grid of Workstations and Flow queues */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">

        {/* Workstations / Teams Status Panel */}
        <div className="lg:col-span-4 bg-white p-6 rounded-2xl border border-slate-100 shadow-sm space-y-4">
          <div className="flex items-center justify-between border-b border-slate-100 pb-3">
            <h3 className="font-bold text-slate-800 flex items-center gap-2">
              <HardHat className="h-5 w-5 text-purple-600" />
              Active Section Workstations
            </h3>
            <span className="text-xs bg-slate-100 px-2 py-0.5 rounded-full font-mono text-slate-600">
              {stageTeams.filter(t => t.status === 'BUSY').length}/{stageTeams.length} Active
            </span>
          </div>

          <div className="space-y-3">
            {stageTeams.map(team => {
              const activePool = team.activePoolId ? pools.find(p => p.id === team.activePoolId) : null;
              const stageHist = activePool ? activePool.stageHistory[selectedStageId] : null;
              
              return (
                <div 
                  key={team.id} 
                  className={`p-4 border rounded-xl transition-all ${
                    team.status === 'BUSY' 
                      ? 'bg-purple-50/40 border-purple-100 shadow-sm' 
                      : 'bg-slate-50 border-slate-100 text-slate-400'
                  }`}
                >
                  <div className="flex justify-between items-center">
                    <span className="text-xs font-bold text-slate-800 flex items-center gap-1.5">
                      <span className={`h-2 w-2 rounded-full ${team.status === 'BUSY' ? 'bg-purple-600 animate-pulse' : 'bg-slate-300'}`} />
                      {team.name}
                    </span>
                    <span className={`text-[10px] uppercase font-mono px-2 py-0.5 rounded-md ${
                      team.status === 'BUSY' 
                        ? 'bg-purple-100 text-purple-700 font-bold' 
                        : 'bg-slate-200 text-slate-600'
                    }`}>
                      {team.status}
                    </span>
                  </div>

                  {activePool && stageHist && (
                    <div className="mt-3 pt-3 border-t border-slate-200/50 space-y-2">
                      <div className="flex justify-between items-start">
                        <div>
                          <span className="font-mono text-xs font-black bg-white border px-1.5 py-0.5 rounded text-slate-700 block w-fit mb-1">
                            {activePool.poolNo}
                          </span>
                          <span className="text-xs font-semibold text-slate-600 block line-clamp-1">{activePool.projectName}</span>
                        </div>
                        {stageHist.startTime && (
                          <div className="text-right text-[10px] text-slate-500">
                            <span className="flex items-center gap-1 font-mono justify-end">
                              <Clock className="h-3 w-3 text-purple-500 animate-spin" />
                              Active Timer
                            </span>
                            <span className="font-bold text-slate-700 block mt-0.5">
                              Started: {new Date(stageHist.startTime).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })}
                            </span>
                          </div>
                        )}
                      </div>
                      <div className="flex gap-2 text-[10px]">
                        <span className="bg-slate-100 px-2 py-0.5 rounded text-slate-600 font-medium">Dims: {activePool.dimensions}</span>
                        <span className="bg-slate-100 px-2 py-0.5 rounded text-slate-600 font-medium">Shape: {activePool.shape}</span>
                      </div>
                    </div>
                  )}

                  {!activePool && (
                    <p className="text-xs text-slate-450 italic mt-2">Station is currently clear. Awaiting next released shell...</p>
                  )}
                </div>
              );
            })}
          </div>
        </div>

        {/* Active Stage Queue with lots of pools support (search, filter, pagination) */}
        <div className="lg:col-span-8 bg-white p-6 rounded-2xl border border-slate-100 shadow-sm flex flex-col space-y-4">
          
          {/* Header with Search and High Capacity Filters */}
          <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 border-b border-slate-100 pb-3">
            <div className="space-y-0.5">
              <h3 className="font-bold text-slate-800 flex items-center gap-2">
                <Workflow className="h-5 w-5 text-cyan-600" />
                Line Fabrication Queue ({poolsInStage.length} total)
              </h3>
              <p className="text-xs text-slate-400">Manage massive collections of pools by project and ID.</p>
            </div>

            <div className="flex flex-wrap items-center gap-2">
              <span className="text-xs font-semibold text-slate-400">Project:</span>
              <select
                value={selectedProject}
                onChange={(e) => setSelectedProject(e.target.value)}
                className="bg-slate-50 border border-slate-200 text-xs rounded-lg px-2.5 py-1.5 text-slate-700 font-medium"
              >
                <option value="ALL">All Active Projects ({uniqueProjects.length})</option>
                {uniqueProjects.map(proj => (
                  <option key={proj} value={proj}>{proj}</option>
                ))}
              </select>

              <span className="text-xs font-semibold text-slate-400 ml-2">Status:</span>
              <select
                value={statusFilter}
                onChange={(e) => setStatusFilter(e.target.value)}
                className="bg-slate-50 border border-slate-200 text-xs rounded-lg px-2.5 py-1.5 text-slate-700 font-medium"
              >
                <option value="ALL">All Statuses</option>
                <option value="NOT_STARTED">NOT STARTED/QUEUED</option>
                <option value="IN_PROGRESS">IN PROGRESS</option>
                <option value="PENDING_INSPECTION">PENDING QA</option>
                <option value="REJECTED">REJECTED/REWORK</option>
              </select>
            </div>
          </div>

          {/* Search Inputs for Precision Filtering (suited for > 100 pools) */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 bg-slate-50 p-3 rounded-xl border border-slate-100">
            <div className="relative">
              <Search className="absolute top-2 left-2.5 h-3.5 w-3.5 text-slate-400" />
              <input
                type="text"
                placeholder="Find Project (e.g. Marina)"
                value={projectSearch}
                onChange={(e) => setProjectSearch(e.target.value)}
                className="w-full bg-white pl-8 pr-3 py-1.5 text-xs border border-slate-200 rounded-lg focus:outline-none focus:ring-1 focus:ring-slate-400"
              />
            </div>
            <div className="relative">
              <Search className="absolute top-2 left-2.5 h-3.5 w-3.5 text-slate-400" />
              <input
                type="text"
                placeholder="Find Pool ID (e.g. P-100)"
                value={poolSearch}
                onChange={(e) => setPoolSearch(e.target.value)}
                className="w-full bg-white pl-8 pr-3 py-1.5 text-xs border border-slate-200 rounded-lg focus:outline-none focus:ring-1 focus:ring-slate-400"
              />
            </div>
          </div>

          {/* Display Items table */}
          {filteredPools.length === 0 ? (
            <div className="text-center py-16 bg-slate-50/50 border border-dashed border-slate-100 rounded-2xl">
              <FolderDot className="h-10 w-10 text-slate-3 w-10 text-slate-300 mx-auto mb-2" />
              <p className="text-sm font-bold text-slate-600">No pools match filters inside this stage</p>
              <p className="text-xs text-slate-400 mt-1 max-w-sm mx-auto">Try selecting a different project or subsection, or registering pools at the Production Eng. workstation.</p>
            </div>
          ) : (
            <div className="overflow-x-auto border border-slate-100 rounded-xl">
              <table className="w-full text-left border-collapse text-xs">
                <thead>
                  <tr className="bg-slate-50 border-b border-slate-100 text-slate-400 uppercase font-bold text-[10px] tracking-wider">
                    <th className="py-3 px-4">Pool ID</th>
                    <th className="py-3 px-4">Project / Specs</th>
                    <th className="py-3 px-4">Workstation Unit</th>
                    <th className="py-3 px-4 text-center">Rework Count</th>
                    <th className="py-3 px-4 text-right">Flow Status</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 font-medium">
                  {filteredPools.map((pool) => {
                    const stageHist = pool.stageHistory[selectedStageId];
                    const assignedTeam = teams.find(t => t.id === stageHist?.teamId);

                    return (
                      <tr key={pool.id} className="hover:bg-slate-50/80 transition-colors">
                        <td className="py-3.5 px-4">
                          <span className="font-mono font-black bg-slate-100 text-slate-700 border px-2 py-1 rounded">
                            {pool.poolNo}
                          </span>
                        </td>
                        <td className="py-3.5 px-4 font-sans">
                          <div className="font-bold text-slate-800 line-clamp-1">{pool.projectName}</div>
                          <div className="flex gap-2 text-[10px] text-slate-400 mt-1 font-semibold">
                            <span>{pool.orientation}</span>
                            <span>•</span>
                            <span>{pool.dimensions}</span>
                            <span>•</span>
                            <span>{pool.shape}</span>
                          </div>
                        </td>
                        <td className="py-3.5 px-4">
                          {assignedTeam ? (
                            <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded bg-purple-50 text-purple-700">
                              <span className="h-1.5 w-1.5 rounded-full bg-purple-600 animate-pulse" />
                              {assignedTeam.name}
                            </span>
                          ) : (
                            <span className="text-slate-400 italic">Unclaimed / Available</span>
                          )}
                        </td>
                        <td className="py-3.5 px-4 text-center">
                          {stageHist?.rejectionCount && stageHist.rejectionCount > 0 ? (
                            <span className="inline-flex items-center gap-1 font-bold font-mono text-rose-600 bg-rose-50 px-2.5 py-0.5 rounded-full border border-rose-150">
                              <AlertTriangle className="h-3 w-3" />
                              {stageHist.rejectionCount} Reworked
                            </span>
                          ) : (
                            <span className="text-slate-350">—</span>
                          )}
                        </td>
                        <td className="py-3.5 px-4 text-right">
                          {stageHist?.status === 'NOT_STARTED' && (
                            <span className="inline-flex items-center px-2 py-1 rounded-full text-[10px] font-bold bg-slate-100 text-slate-600 border border-slate-200">
                              QUEUED
                            </span>
                          )}
                          {stageHist?.status === 'IN_PROGRESS' && (
                            <span className="inline-flex items-center px-2.5 py-1 rounded-full text-[10px] font-bold bg-blue-100 text-blue-800 animate-pulse border border-blue-200">
                              IN PROGRESS
                            </span>
                          )}
                          {stageHist?.status === 'PENDING_INSPECTION' && (
                            <span className="inline-flex items-center px-2.5 py-1 rounded-full text-[10px] font-bold bg-yellow-100 text-yellow-800 border border-yellow-250 animate-pulse">
                              PENDING QA
                            </span>
                          )}
                          {stageHist?.status === 'REJECTED' && (
                            <span className="inline-flex items-center px-2.5 py-1 rounded-full text-[10px] font-bold bg-rose-100 text-rose-800 border border-rose-200">
                              REJECT REWORK
                            </span>
                          )}
                          {stageHist?.status === 'SKIPPED' && (
                            <span className="inline-flex items-center px-2.5 py-1 rounded-full text-[10px] font-bold bg-amber-50 text-slate-600 border border-amber-200">
                              SKIPPED FOR NOW
                            </span>
                          )}
                          {stageHist?.status === 'CARRIED_ON_SITE' && (
                            <span className="inline-flex items-center px-2.5 py-1 rounded-full text-[10px] font-bold bg-purple-100 text-purple-800 border border-purple-200">
                              CARRY ON SITE
                            </span>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}

        </div>

      </div>

      {/* Broad Bottom section feed of events for this stage */}
      <div className="bg-white p-6 rounded-2xl border border-slate-100 shadow-sm">
        <h3 className="font-bold text-slate-800 border-b border-slate-100 pb-3 flex items-center gap-2 mb-4">
          <ClipboardCheck className="h-5 w-5 text-emerald-600" />
          Recent Section Event Feed (Live Log Stream)
        </h3>
        
        {stageLogs.length === 0 ? (
          <p className="text-xs text-slate-400 text-center py-6 italic">No action logs captured in this department during this shift.</p>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {stageLogs.map((log) => (
              <div key={log.id} className="p-3 bg-slate-50 border border-slate-150 rounded-xl space-y-1.5 text-xs relative overflow-hidden">
                <span 
                  className="absolute right-0 top-0 h-full w-1" 
                  style={{ backgroundColor: activeStage.color }} 
                />
                
                <div className="flex justify-between items-center text-[10px]">
                  <span className="text-slate-400 font-mono">
                    {new Date(log.timestamp).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit', second: '2-digit' })}
                  </span>
                  <span className="font-mono font-black text-slate-500 bg-white border px-1 py-0.2 rounded">
                    {log.poolNo}
                  </span>
                </div>

                <p className="text-slate-800 font-bold line-clamp-1">{log.projectName}</p>
                <p className="text-slate-500 line-clamp-2 text-[11px] leading-snug">{log.notes}</p>
                
                <div className="text-[10px] text-slate-400 font-medium">
                  Done by: <strong className="text-slate-600">{log.operatorName}</strong>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

    </div>
  );
};
