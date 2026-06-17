import React from 'react';
import { ViewRole, StageId } from '../types';
import { STAGES } from '../data/mockData';
import { Wrench, Shield, Monitor, BarChart3, HardHat, Factory, Tv, Cloud, LogOut } from 'lucide-react';

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
}) => {
  const activeStageTeams = allTeams.filter(t => t.stageId === selectedStageId);

  return (
    <div className="bg-slate-900 text-slate-100 border-b border-slate-800 shadow-xl sticky top-0 z-50 transition-all">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="flex flex-col lg:flex-row lg:items-center lg:justify-between py-4 gap-4">
          
          {/* Brand/Identity & Google Drive Connectivity Status */}
          <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 w-full lg:w-auto">
            <div className="flex items-center gap-3">
              <div className="bg-gradient-to-tr from-cyan-500 to-blue-600 p-2.5 rounded-xl shadow-inner text-white animate-pulse">
                <Factory className="h-6 w-6" />
              </div>
              <div>
                <h1 className="text-xl font-bold tracking-tight text-white font-sans flex items-center gap-1.5 flex-wrap">
                  MAT PLASTIC INDUSTRIES LLC <span className="text-cyan-400 font-mono text-xs uppercase px-2 py-0.5 bg-slate-800 border border-slate-700 rounded-full">Manufacturing ERP</span>
                </h1>
                <p className="text-xs text-slate-400">Flow-Based Shop Floor Scheduling & Quality Control</p>
              </div>
            </div>

            {/* Google Drive Cloud Connection Widget */}
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
          </div>

          {/* Mode Selector */}
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-xs font-semibold text-slate-400 uppercase tracking-wider mr-2 hidden xl:inline">Role View:</span>
            
            <button
              onClick={() => onChangeRole('management')}
              className={`flex items-center gap-1.5 px-3 py-2 rounded-lg text-xs font-medium cursor-pointer transition-all ${
                currentRole === 'management'
                  ? 'bg-blue-600 text-white shadow-md shadow-blue-900/50 scale-105'
                  : 'bg-slate-800 hover:bg-slate-700 text-slate-300'
              }`}
            >
              <BarChart3 className="h-4 w-4" />
              <span>Management Portal</span>
            </button>

            <button
              onClick={() => onChangeRole('factory_entrance')}
              className={`flex items-center gap-1.5 px-3 py-2 rounded-lg text-xs font-medium cursor-pointer transition-all ${
                currentRole === 'factory_entrance'
                  ? 'bg-cyan-600 text-white shadow-md shadow-cyan-900/50 scale-105'
                  : 'bg-slate-800 hover:bg-slate-700 text-slate-300'
              }`}
            >
              <Monitor className="h-4 w-4" />
              <span>Factory Entrance TV</span>
            </button>

            <button
              onClick={() => onChangeRole('production_engineer')}
              className={`flex items-center gap-1.5 px-3 py-2 rounded-lg text-xs font-medium cursor-pointer transition-all ${
                currentRole === 'production_engineer'
                  ? 'bg-amber-600 text-white shadow-md shadow-amber-900/50 scale-105'
                  : 'bg-slate-800 hover:bg-slate-700 text-slate-300'
              }`}
            >
              <Wrench className="h-4 w-4" />
              <span>Production Eng.</span>
            </button>

            <button
              onClick={() => onChangeRole('quality_inspector')}
              className={`flex items-center gap-1.5 px-3 py-2 rounded-lg text-xs font-medium cursor-pointer transition-all ${
                currentRole === 'quality_inspector'
                  ? 'bg-emerald-600 text-white shadow-md shadow-emerald-900/50 scale-105'
                  : 'bg-slate-800 hover:bg-slate-700 text-slate-300'
              }`}
            >
              <Shield className="h-4 w-4" />
              <span>Quality Assurance</span>
            </button>

            <button
              onClick={() => onChangeRole('stage_worker')}
              className={`flex items-center gap-1.5 px-3 py-2 rounded-lg text-xs font-medium cursor-pointer transition-all ${
                currentRole === 'stage_worker'
                  ? 'bg-purple-600 text-white shadow-md shadow-purple-900/50 scale-105'
                  : 'bg-slate-800 hover:bg-slate-700 text-slate-300'
              }`}
            >
              <HardHat className="h-4 w-4" />
              <span>Stage Shop Floor</span>
            </button>

            <button
              onClick={() => onChangeRole('section_dashboard')}
              className={`flex items-center gap-1.5 px-3 py-2 rounded-lg text-xs font-medium cursor-pointer transition-all ${
                currentRole === 'section_dashboard'
                  ? 'bg-cyan-600 text-white shadow-md shadow-cyan-900/50 scale-105'
                  : 'bg-slate-800 hover:bg-slate-700 text-slate-300'
              }`}
            >
              <Tv className="h-4 w-4" />
              <span>Section TVs</span>
            </button>
          </div>
        </div>

        {/* Dynamic Context Panel depending on the active role */}
        {currentRole === 'stage_worker' && (
          <div className="border-t border-slate-800 py-3 flex flex-wrap items-center justify-between gap-4">
            
            {/* Stage Selector Option */}
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

            {/* Team Selector option for the active stage */}
            <div className="flex items-center gap-2">
              <span className="text-xs font-semibold text-slate-405 uppercase tracking-wider text-slate-400 flex items-center gap-1">
                <HardHat className="h-3.5 w-3.5 text-purple-400" />
                Team Assignment:
              </span>
              <select
                value={workerTeamId}
                onChange={(e) => onChangeWorkerTeam(e.target.value)}
                className="bg-slate-800 border border-slate-700 rounded text-xs text-slate-200 px-3 py-1 cursor-pointer focus:outline-none focus:ring-1 focus:ring-purple-500"
              >
                <option value="">-- Choose Team on Floor --</option>
                {activeStageTeams.map((team) => (
                  <option key={team.id} value={team.id}>
                    {team.name} ({team.status === 'IDLE' ? 'Idle' : 'Active'})
                  </option>
                ))}
              </select>
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
            <span>Signed in as <strong className="text-slate-200">Lead Production Engineer</strong>. Initialize fabrication items, set orientation details, and manage core shell properties.</span>
          </div>
        )}

        {currentRole === 'section_dashboard' && (
          <div className="border-t border-slate-800 py-2.5 text-slate-400 text-xs flex items-center gap-2">
            <span className="inline-block h-2 w-2 rounded-full bg-cyan-500 animate-pulse"></span>
            <span>Casting active <strong className="text-slate-205 text-slate-200">Physical Section Screen</strong>. Select individual department feeds at top-right to filter workspace tracking indices live.</span>
          </div>
        )}
      </div>
    </div>
  );
};
