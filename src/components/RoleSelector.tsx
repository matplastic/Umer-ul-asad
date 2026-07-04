import React from 'react';
import { ViewRole, StageId } from '../types';
import { STAGES } from '../data/mockData';
import { Wrench, Shield, Monitor, BarChart3, HardHat, Factory, Tv, Cloud, LogOut, ClipboardList, Boxes, UserCog, FileBarChart, Warehouse } from 'lucide-react';

interface RoleSelectorProps {
  currentRole: ViewRole;
  selectedStageId: StageId;
  onChangeRole: (role: ViewRole) => void;
  onChangeStage: (stageId: StageId) => void;
  workerTeamId: string;
  onChangeWorkerTeam: (teamId: string) => void;
  allTeams: any[];
  googleUser: { displayName: string | null; email: string | null; photoURL: string | null } | null;
  onGoogleSignIn: () => void;
  onGoogleSignOut: () => void;
  stationLock?: {
    isLocked: boolean;
    role: ViewRole;
    stageId: StageId | null;
    teamId: string | null;
    pin: string;
    allowedRoles?: ViewRole[];
  };
  loggedInUser: { role: ViewRole; displayName: string } | null;
  onLogout: () => void;
}

export const RoleSelector: React.FC<RoleSelectorProps> = ({
  currentRole,
  selectedStageId,
  onChangeRole,
  onChangeStage,
  workerTeamId,
  onChangeWorkerTeam,
  allTeams,
  googleUser,
  onGoogleSignIn,
  onGoogleSignOut,
  stationLock,
  loggedInUser,
  onLogout,
}) => {
  const activeStageTeams = allTeams.filter(t => t.stageId === selectedStageId);

  const tabClass = (active: boolean) =>
    `flex items-center gap-1.5 px-2.5 py-1.5 rounded-md text-[11px] font-semibold whitespace-nowrap cursor-pointer transition-colors ${
      active ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-300 hover:bg-slate-800 hover:text-white'
    }`;

  return (
    <div className="bg-slate-900 text-slate-100 border-b border-slate-800 shadow-xl sticky top-0 z-50 transition-all">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="flex flex-col lg:flex-row lg:items-center lg:justify-between py-3 gap-3">

          {/* Brand/Identity & Google Drive Connectivity Status */}
          <div className="flex items-center justify-between gap-4 w-full lg:w-auto">
            <div className="flex items-center gap-3 min-w-0">
              <div className="h-10 w-10 shrink-0 rounded-lg bg-white/95 ring-1 ring-white/10 flex items-center justify-center overflow-hidden">
                <img
                  src="/logo.png"
                  alt="MAT Plastic Industries LLC"
                  className="h-8 w-8 object-contain"
                />
              </div>
              <div className="min-w-0 leading-tight">
                <div className="flex items-center gap-2 flex-wrap">
                  <h1 className="text-sm font-bold tracking-tight text-white font-sans truncate">
                    MAT Plastic Industries LLC
                  </h1>
                  <span className="text-cyan-400 font-mono text-[9px] font-bold uppercase tracking-wider px-1.5 py-0.5 bg-slate-800 border border-slate-700 rounded shrink-0">
                    Manufacturing ERP
                  </span>
                </div>
                <p className="text-[11px] text-slate-400 truncate">Flow-Based Shop Floor Scheduling &amp; Quality Control</p>
              </div>
            </div>

            {/* Google Drive Cloud Connection Widget */}
            {!stationLock?.isLocked ? (
              <div className="flex items-center gap-2 bg-slate-800/80 px-3 py-1.5 rounded-xl border border-slate-700/60 text-xs self-start md:self-auto shadow-xs">
                {googleUser ? (
                  <div className="flex items-center gap-2">
                    <div className="relative">
                      {googleUser.photoURL ? (
                        <img src={googleUser.photoURL} alt="" className="h-5 w-5 rounded-full border border-emerald-500" referrerPolicy="no-referrer" />
                      ) : (
                        <div className="h-5 w-5 rounded-full bg-indigo-600 text-[10px] font-black flex items-center justify-center text-white">
                          {googleUser.displayName?.charAt(0) || 'U'}
                        </div>
                      )}
                      <span className="absolute bottom-0 right-0 h-1.5 w-1.5 bg-emerald-500 rounded-full ring-1 ring-slate-900" />
                    </div>
                    <div className="text-left shrink-0 max-w-[120px] md:max-w-[155px]">
                      <span className="text-[9px] block text-slate-400 uppercase tracking-wider leading-none mb-0.5">Connected Drive</span>
                      <span className="font-semibold text-cyan-455 text-cyan-400 text-[11px] truncate block leading-none">{googleUser.displayName}</span>
                    </div>
                    <button
                      onClick={onGoogleSignOut}
                      className="ml-2 p-1 hover:bg-rose-950/40 text-slate-400 hover:text-rose-400 rounded-lg transition-colors cursor-pointer border border-transparent hover:border-rose-900/30"
                      title="Disconnect Google Account"
                    >
                      <LogOut className="h-3.5 w-3.5" />
                    </button>
                  </div>
                ) : (
                  <button
                    onClick={onGoogleSignIn}
                    className="flex items-center gap-1.5 text-[11px] font-bold text-slate-350 hover:text-white hover:bg-slate-750 px-2.5 py-1 rounded-lg border border-slate-700 transition-colors cursor-pointer"
                  >
                    <Cloud className="h-3.5 w-3.5 text-cyan-400 shrink-0" />
                    <span>Connect Google Drive</span>
                  </button>
                )}
              </div>
            ) : (
              <div className="flex items-center gap-1.5 px-3 py-1.5 bg-slate-800 border border-slate-700 rounded-xl font-mono text-[10px] text-amber-400 uppercase font-bold tracking-wider">
                <span className="inline-block h-2 w-2 rounded-full bg-amber-500 animate-pulse"></span>
                <span>Workstation Locked Terminal</span>
              </div>
            )}
          </div>

          {/* Mode Selector */}
          {!stationLock?.isLocked ? (
            <div className="flex items-center gap-2 w-full lg:w-auto min-w-0">
              {loggedInUser?.role === 'management' ? (
                <>
                  <div className="flex items-center gap-0.5 bg-slate-800/60 border border-slate-800 rounded-lg p-1 overflow-x-auto max-w-full [scrollbar-width:thin]">
                    <button onClick={() => onChangeRole('management')} className={tabClass(currentRole === 'management')}>
                      <BarChart3 className="h-3.5 w-3.5" />
                      <span>Management</span>
                    </button>

                    <button onClick={() => onChangeRole('factory_entrance')} className={tabClass(currentRole === 'factory_entrance')}>
                      <Monitor className="h-3.5 w-3.5" />
                      <span>Entrance TV</span>
                    </button>

                    <button onClick={() => onChangeRole('planning_department')} className={tabClass(currentRole === 'planning_department')}>
                      <ClipboardList className="h-3.5 w-3.5" />
                      <span>Planning</span>
                    </button>

                    <button onClick={() => onChangeRole('production_engineer')} className={tabClass(currentRole === 'production_engineer')}>
                      <Wrench className="h-3.5 w-3.5" />
                      <span>Production Eng.</span>
                    </button>

                    <button onClick={() => onChangeRole('quality_inspector')} className={tabClass(currentRole === 'quality_inspector')}>
                      <Shield className="h-3.5 w-3.5" />
                      <span>Quality</span>
                    </button>

                    <button onClick={() => onChangeRole('stage_worker')} className={tabClass(currentRole === 'stage_worker')}>
                      <HardHat className="h-3.5 w-3.5" />
                      <span>Shop Floor</span>
                    </button>

                    <button onClick={() => onChangeRole('section_dashboard')} className={tabClass(currentRole === 'section_dashboard')}>
                      <Tv className="h-3.5 w-3.5" />
                      <span>Section TVs</span>
                    </button>

                    <button onClick={() => onChangeRole('trolley_prod')} className={tabClass(currentRole === 'trolley_prod')}>
                      <Boxes className="h-3.5 w-3.5" />
                      <span>Trolley</span>
                    </button>

                    <button onClick={() => onChangeRole('hr_portal')} className={tabClass(currentRole === 'hr_portal')}>
                      <UserCog className="h-3.5 w-3.5" />
                      <span>HR</span>
                    </button>

                    <button onClick={() => onChangeRole('store')} data-testid="role-store" className={tabClass(currentRole === 'store')}>
                      <Warehouse className="h-3.5 w-3.5" />
                      <span>Store</span>
                    </button>

                    <button onClick={() => onChangeRole('section_supervisor')} data-testid="role-section-supervisor" className={tabClass(currentRole === 'section_supervisor')}>
                      <HardHat className="h-3.5 w-3.5" />
                      <span>Supervisor</span>
                    </button>

                    <button onClick={() => onChangeRole('reports_analytics')} data-testid="role-reports-analytics" className={tabClass(currentRole === 'reports_analytics')}>
                      <FileBarChart className="h-3.5 w-3.5" />
                      <span>Reports</span>
                    </button>
                  </div>
                </>
              ) : (
                <div className="flex items-center gap-2 bg-slate-800/80 px-3 py-1.5 rounded-lg border border-slate-700/50 text-xs text-slate-200">
                  <span className="h-2 w-2 rounded-full bg-emerald-500 animate-pulse"></span>
                  <span>Active Protected Session: <strong className="text-white uppercase font-mono">{loggedInUser ? loggedInUser.displayName : currentRole.replace('_', ' ')}</strong></span>
                </div>
              )}

              {/* Central logout control */}
              <button
                onClick={onLogout}
                className="flex items-center gap-1 px-2.5 py-1.5 rounded-md text-[11px] font-semibold bg-rose-950/40 hover:bg-rose-900/50 text-rose-300 border border-rose-900/40 transition-colors cursor-pointer shrink-0 ml-auto lg:ml-2"
                title="Sign Out to Security Gate"
              >
                <LogOut className="h-3.5 w-3.5 shrink-0" />
                <span className="hidden sm:inline">Exit Portal</span>
              </button>
            </div>
          ) : stationLock?.allowedRoles && stationLock.allowedRoles.length > 1 ? (
            <div className="flex flex-wrap items-center gap-0.5 bg-slate-800/40 p-1 rounded-xl border border-slate-700/50">
              <span className="text-[10px] font-black uppercase text-amber-500 tracking-wider px-2 font-mono">
                🔒 Locked Station Tabs:
              </span>
              
              {stationLock.allowedRoles.includes('management') && (
                <button
                  onClick={() => onChangeRole('management')}
                  className={`flex items-center gap-1 px-3 py-1.5 rounded-lg text-xs font-bold cursor-pointer transition-all ${
                    currentRole === 'management'
                      ? 'bg-blue-600 text-white shadow-md'
                      : 'hover:bg-slate-700 text-slate-400'
                  }`}
                >
                  <BarChart3 className="h-3.5 w-3.5" />
                  <span>Management</span>
                </button>
              )}

              {stationLock.allowedRoles.includes('factory_entrance') && (
                <button
                  onClick={() => onChangeRole('factory_entrance')}
                  className={`flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-xs font-bold cursor-pointer transition-all ${
                    currentRole === 'factory_entrance'
                      ? 'bg-cyan-600 text-white shadow-md'
                      : 'hover:bg-slate-700 text-slate-400'
                  }`}
                >
                  <Monitor className="h-3.5 w-3.5" />
                  <span>Entrance TV</span>
                </button>
              )}

              {stationLock.allowedRoles.includes('planning_department') && (
                <button
                  onClick={() => onChangeRole('planning_department')}
                  className={`flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-xs font-bold cursor-pointer transition-all ${
                    currentRole === 'planning_department'
                      ? 'bg-indigo-600 text-white shadow-md'
                      : 'hover:bg-slate-700 text-slate-400'
                  }`}
                >
                  <ClipboardList className="h-3.5 w-3.5" />
                  <span>Planning</span>
                </button>
              )}

              {stationLock.allowedRoles.includes('production_engineer') && (
                <button
                  onClick={() => onChangeRole('production_engineer')}
                  className={`flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-xs font-bold cursor-pointer transition-all ${
                    currentRole === 'production_engineer'
                      ? 'bg-amber-600 text-white shadow-md'
                      : 'hover:bg-slate-700 text-slate-400'
                  }`}
                >
                  <Wrench className="h-3.5 w-3.5" />
                  <span>Eng Release</span>
                </button>
              )}

              {stationLock.allowedRoles.includes('quality_inspector') && (
                <button
                  onClick={() => onChangeRole('quality_inspector')}
                  className={`flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-xs font-bold cursor-pointer transition-all ${
                    currentRole === 'quality_inspector'
                      ? 'bg-emerald-600 text-white shadow-md'
                      : 'hover:bg-slate-700 text-slate-400'
                  }`}
                >
                  <Shield className="h-3.5 w-3.5" />
                  <span>QA</span>
                </button>
              )}

              {stationLock.allowedRoles.includes('stage_worker') && (
                <button
                  onClick={() => onChangeRole('stage_worker')}
                  className={`flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-xs font-bold cursor-pointer transition-all ${
                    currentRole === 'stage_worker'
                      ? 'bg-purple-600 text-white shadow-md'
                      : 'hover:bg-slate-700 text-slate-400'
                  }`}
                >
                  <HardHat className="h-3.5 w-3.5" />
                  <span>Shop Floor</span>
                </button>
              )}

              {stationLock.allowedRoles.includes('section_dashboard') && (
                <button
                  onClick={() => onChangeRole('section_dashboard')}
                  className={`flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-xs font-bold cursor-pointer transition-all ${
                    currentRole === 'section_dashboard'
                      ? 'bg-cyan-600 text-white shadow-md'
                      : 'hover:bg-slate-700 text-slate-400'
                  }`}
                >
                  <Tv className="h-3.5 w-3.5" />
                  <span>Section TV</span>
                </button>
              )}

              {stationLock.allowedRoles.includes('trolley_prod') && (
                <button
                  onClick={() => onChangeRole('trolley_prod')}
                  className={`flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-xs font-bold cursor-pointer transition-all ${
                    currentRole === 'trolley_prod'
                      ? 'bg-rose-600 text-white shadow-md shadow-rose-900/50'
                      : 'hover:bg-slate-700 text-slate-400'
                  }`}
                >
                  <Boxes className="h-3.5 w-3.5" />
                  <span>Trolley Ledger</span>
                </button>
              )}
            </div>
          ) : (
            <div className="flex items-center gap-1.5 px-3 py-1.5 bg-slate-800/50 border border-slate-700/80 rounded-lg text-xs font-semibold text-slate-350">
              <span className="h-2 w-2 rounded-full bg-cyan-400 animate-ping"></span>
              <span>Active Viewport Role: <strong className="text-white uppercase font-mono">{currentRole.replace('_', ' ')}</strong></span>
            </div>
          )}
        </div>

        {/* Dynamic Context Panel depending on the active role */}
        {currentRole === 'stage_worker' && (
          <div className="border-t border-slate-800 py-3 flex flex-wrap items-center justify-between gap-4">
            
            {/* Stage Selector Option */}
            {!stationLock?.isLocked || !stationLock?.stageId ? (
              <div className="flex items-center gap-2">
                <span className="text-xs font-semibold text-slate-400 uppercase tracking-widest">Active Section:</span>
                <div className="flex flex-wrap gap-1.5">
                  {STAGES.map((stage) => {
                    const isSelected = selectedStageId === stage.id;
                    return (
                      <button
                        key={stage.id}
                        onClick={() => onChangeStage(stage.id)}
                        className={`px-2.5 py-1 rounded text-xs font-medium transition-all ${
                          isSelected 
                            ? 'text-white border' 
                            : 'bg-slate-800 hover:bg-slate-700 text-slate-400 border border-transparent'
                        }`}
                        style={{
                          borderColor: isSelected ? stage.color : undefined,
                          backgroundColor: isSelected ? `${stage.color}20` : undefined,
                          boxShadow: isSelected ? `inset 0 0 4px ${stage.color}` : undefined
                        }}
                      >
                        {stage.name}
                      </button>
                    );
                  })}
                </div>
              </div>
            ) : (
              <div className="flex items-center gap-2">
                <span className="text-xs font-semibold text-slate-400 uppercase tracking-widest">Active Section:</span>
                <span 
                  className="px-3 py-1 bg-slate-800 border rounded text-xs font-black uppercase tracking-wider font-mono text-white"
                  style={{
                    borderColor: STAGES.find(s => s.id === selectedStageId)?.color || '#9333ea',
                    boxShadow: `0 0 8px ${STAGES.find(s => s.id === selectedStageId)?.color}30`
                  }}
                >
                  {STAGES.find(s => s.id === selectedStageId)?.name}
                </span>
              </div>
            )}

            {/* Team Selector option for the active stage */}
            <div className="flex items-center gap-2">
              <span className="text-xs font-semibold text-slate-405 uppercase tracking-wider text-slate-400 flex items-center gap-1">
                <HardHat className="h-3.5 w-3.5 text-purple-400" />
                Team Assignment:
              </span>
              <select
                value={workerTeamId}
                disabled={!!stationLock?.teamId}
                onChange={(e) => onChangeWorkerTeam(e.target.value)}
                className="bg-slate-800 border border-slate-700 rounded text-xs text-slate-200 px-3 py-1 cursor-pointer focus:outline-none focus:ring-1 focus:ring-purple-500 disabled:opacity-75 disabled:cursor-not-allowed"
              >
                <option value="">-- Choose Team on Floor --</option>
                {activeStageTeams.map((team) => (
                  <option key={team.id} value={team.id}>
                    {team.name} ({team.status === 'IDLE' ? 'Idle' : 'Active'})
                  </option>
                ))}
              </select>
              {stationLock?.teamId && (
                <span className="text-[10px] font-mono font-bold text-amber-500 uppercase tracking-wider">Assigned Device Lock</span>
              )}
            </div>

          </div>
        )}

        {currentRole === 'quality_inspector' && (
          <div className="border-t border-slate-800 py-2.5 text-slate-400 text-xs flex items-center gap-2">
            <span className="inline-block h-2 w-2 rounded-full bg-emerald-500 animate-pulse"></span>
            <span>You are viewing as <strong className="text-slate-200">Lead QA Inspector</strong>. All step completions trigger notification flags below. Only QA-approved items proceed to upstream manufacturing stages.</span>
          </div>
        )}

        {currentRole === 'production_engineer' && (
          <div className="border-t border-slate-800 py-2.5 text-slate-400 text-xs flex items-center gap-2">
            <span className="inline-block h-2 w-2 rounded-full bg-amber-500 animate-pulse"></span>
            <span>Signed in as <strong className="text-slate-200">Lead Production Engineer</strong>. Pull registered pools from the pre-planned registry or initialize bulk fabrication runs.</span>
          </div>
        )}

        {currentRole === 'planning_department' && (
          <div className="border-t border-slate-800 py-2.5 text-slate-400 text-xs flex items-center gap-2">
            <span className="inline-block h-2 w-2 rounded-full bg-indigo-500 animate-pulse"></span>
            <span>Signed in as <strong className="text-slate-200">Planning Coordinator</strong>. Register future production pools in bulk, review orientation ratios, and release items to fabrication.</span>
          </div>
        )}

        {currentRole === 'section_dashboard' && (
          <div className="border-t border-slate-800 py-2.5 text-slate-400 text-xs flex items-center gap-2">
            <span className="inline-block h-2 w-2 rounded-full bg-cyan-500 animate-pulse"></span>
            <span>Casting active <strong className="text-slate-205 text-slate-200">Physical Section Screen</strong>. Select individual department feeds at top-right to filter workspace tracking indices live.</span>
          </div>
        )}

        {currentRole === 'trolley_prod' && (
          <div className="border-t border-slate-800 py-2.5 text-slate-400 text-xs flex items-center gap-2">
            <span className="inline-block h-2 w-2 rounded-full bg-rose-500 animate-pulse"></span>
            <span>Logged in as <strong className="text-slate-200">Trolley Production Supervisor</strong>. Track daily trolley manufacturing yields independently without affecting pool manufacturing logs.</span>
          </div>
        )}
      </div>
    </div>
  );
};
