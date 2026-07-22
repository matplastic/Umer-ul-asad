import React, { useState, useEffect } from 'react';
import { Pool, StageId, Team, ActivityLog, PlannedPool } from '../types';
import { STAGES } from '../data/mockData';
import { Eye, ClipboardList, Tv, RefreshCw } from 'lucide-react';
import { StageDashboard } from './StageDashboard';
import { SupervisorPortal } from './SupervisorPortal';
import { SectionDashboardTV } from './SectionDashboardTV';
import type { QCDefect } from './QCDefectPanel';

// Factory Supervisor Portal
// ──────────────────────────────────────────────────────────────────────────
// One shared portal for whoever oversees the whole factory floor (as opposed
// to Section Supervisor, who's scoped to one section). Bundles three views
// that used to live in separate roles into tabs so the same person can flip
// between them without switching accounts:
//   1. Stage Floor Monitor — same read-only/act-as-any-team view Management
//      already has in Teams Allocation → Shop Floor Monitor.
//   2. Section Supervisor Portal — log consumption/production, request
//      materials, same component supervisors use.
//   3. Section TV — the big-board live status view per section.

interface FactorySupervisorPortalProps {
  currentUserName: string;
  pools: Pool[];
  teams: Team[];
  logs: ActivityLog[];
  plannedPools?: PlannedPool[];
  googleUser?: any;
  onGoogleSignIn?: () => void;
  onClaimPool: (poolId: string, teamId: string, stageId: StageId) => void;
  onStartStage: (poolId: string, stageId: StageId) => void;
  onFinishStage: (poolId: string, stageId: StageId) => void;
  onSkipOrCarryOnSite?: (poolId: string, stageId: StageId, option: 'SKIPPED' | 'CARRIED_ON_SITE', operatorName: string) => void;
  onRequestUndoClaim?: (poolId: string, stageId: StageId, teamName: string, reason: string) => void;
  onRefresh?: () => void;
  isSyncing?: boolean;
  qcDefects?: QCDefect[];
  /** Shows a "Switch User" button — used on a shared shop-floor computer. */
  onSwitchUser?: () => void;
}

type FactorySupervisorTab = 'monitor' | 'supervisor' | 'tv';

export const FactorySupervisorPortal: React.FC<FactorySupervisorPortalProps> = ({
  currentUserName,
  pools,
  teams,
  logs,
  plannedPools = [],
  googleUser,
  onGoogleSignIn,
  onClaimPool,
  onStartStage,
  onFinishStage,
  onSkipOrCarryOnSite,
  onRequestUndoClaim,
  onRefresh,
  isSyncing,
  qcDefects = [],
  onSwitchUser,
}) => {
  const [activeTab, setActiveTab] = useState<FactorySupervisorTab>('monitor');

  // Stage Floor Monitor — pick a section + team to view/act as, same pattern
  // as Management's Shop Floor Monitor tab.
  const [monitorStageId, setMonitorStageId] = useState<StageId>(STAGES[0].id);
  const [monitorTeamId, setMonitorTeamId] = useState<string>('');
  const monitorStageTeams = teams.filter(t => t.stageId === monitorStageId);
  const monitorStageInfo = STAGES.find(s => s.id === monitorStageId) || STAGES[0];

  useEffect(() => {
    if (!monitorStageTeams.some(t => t.id === monitorTeamId)) {
      setMonitorTeamId(monitorStageTeams[0]?.id || '');
    }
  }, [monitorStageId, teams]);

  const projectNames = Array.from(new Set([...pools, ...plannedPools].map(p => p.projectName).filter(Boolean)));
  const poolTypesByProject = [...pools, ...plannedPools].reduce((acc: Record<string, string[]>, p) => {
    if (!p.projectName || !p.poolType) return acc;
    if (!acc[p.projectName]) acc[p.projectName] = [];
    if (!acc[p.projectName].includes(p.poolType)) acc[p.projectName].push(p.poolType);
    return acc;
  }, {});

  const TABS: { id: FactorySupervisorTab; label: string; icon: React.ElementType }[] = [
    { id: 'monitor', label: 'Stage Floor Monitor', icon: Eye },
    { id: 'supervisor', label: 'Section Supervisor Portal', icon: ClipboardList },
    { id: 'tv', label: 'Section TV', icon: Tv },
  ];

  return (
    <div className="space-y-4 animate-fadeIn">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-bold text-slate-800">Factory Supervisor Portal</h1>
          <p className="text-xs text-slate-400">
            Signed in as <span className="text-amber-600 font-semibold">{currentUserName}</span>
          </p>
        </div>
        {onSwitchUser && (
          <button
            onClick={onSwitchUser}
            data-testid="factory-supervisor-switch-user"
            className="flex items-center gap-1.5 px-3 py-2 bg-slate-100 hover:bg-slate-200 text-slate-600 rounded-lg text-xs font-medium cursor-pointer"
          >
            Switch Supervisor
          </button>
        )}
      </div>

      <div className="flex flex-wrap gap-1.5 bg-white p-1.5 rounded-2xl border border-slate-100 shadow-sm w-fit">
        {TABS.map(tab => {
          const Icon = tab.icon;
          const isActive = activeTab === tab.id;
          return (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              className={`flex items-center gap-1.5 px-3.5 py-2 rounded-xl text-xs font-bold transition-all cursor-pointer ${
                isActive ? 'bg-slate-900 text-white' : 'text-slate-500 hover:bg-slate-50'
              }`}
            >
              <Icon className="h-3.5 w-3.5" />
              {tab.label}
            </button>
          );
        })}
      </div>

      {activeTab === 'monitor' && (
        <div className="space-y-4">
          <div className="bg-white p-4 rounded-2xl border border-slate-100 shadow-sm flex flex-wrap items-center gap-4">
            <div className="flex items-center gap-2 flex-wrap">
              <span className="text-xs font-bold text-slate-400 uppercase tracking-wider">Section:</span>
              <div className="flex flex-wrap gap-1.5">
                {STAGES.map(stage => (
                  <button
                    key={stage.id}
                    onClick={() => setMonitorStageId(stage.id)}
                    className={`px-2.5 py-1 rounded text-xs font-bold transition-all cursor-pointer ${
                      monitorStageId === stage.id ? 'text-white' : 'bg-slate-100 hover:bg-slate-200 text-slate-500'
                    }`}
                    style={{ backgroundColor: monitorStageId === stage.id ? stage.color : undefined }}
                  >
                    {stage.name}
                  </button>
                ))}
              </div>
            </div>
            <div className="flex items-center gap-2 ml-auto">
              <span className="text-xs font-bold text-slate-400 uppercase tracking-wider">Viewing as team:</span>
              <select
                value={monitorTeamId}
                onChange={(e) => setMonitorTeamId(e.target.value)}
                className="text-xs border border-slate-200 rounded-xl px-3 py-2 font-bold text-slate-700 focus:outline-none focus:ring-1 focus:ring-slate-400"
              >
                {monitorStageTeams.map(t => (
                  <option key={t.id} value={t.id}>{t.name}</option>
                ))}
              </select>
            </div>
          </div>

          {monitorTeamId ? (
            <StageDashboard
              stage={monitorStageInfo}
              pools={pools}
              teams={teams}
              selectedTeamId={monitorTeamId}
              onClaimPool={onClaimPool}
              onStartStage={onStartStage}
              onFinishStage={onFinishStage}
              googleUser={googleUser}
              onGoogleSignIn={onGoogleSignIn || (() => {})}
              onSkipOrCarryOnSite={onSkipOrCarryOnSite}
              onRequestUndoClaim={onRequestUndoClaim}
              onRefresh={onRefresh}
              isSyncing={isSyncing}
              qcDefects={qcDefects}
            />
          ) : (
            <div className="bg-white p-8 rounded-2xl border border-slate-100 shadow-sm text-center text-xs text-slate-400">
              No teams set up for this section yet.
            </div>
          )}
        </div>
      )}

      {activeTab === 'supervisor' && (
        <SupervisorPortal
          currentUserName={currentUserName}
          projectNames={projectNames}
          poolTypesByProject={poolTypesByProject}
        />
      )}

      {activeTab === 'tv' && (
        <SectionDashboardTV pools={pools} teams={teams} logs={logs} />
      )}
    </div>
  );
};
