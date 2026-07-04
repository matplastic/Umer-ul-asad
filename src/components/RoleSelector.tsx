import React from 'react';
import { ViewRole, StageId } from '../types';
import { STAGES } from '../data/mockData';
import { Wrench, Shield, Monitor, BarChart3, HardHat, Tv, Cloud, LogOut, ClipboardList, Boxes, UserCog, FileBarChart, Warehouse, ShieldAlert } from 'lucide-react';

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

const NAV_ITEMS: { role: ViewRole; label: string; icon: React.ElementType; testId?: string }[] = [
  { role: 'management', label: 'Management', icon: BarChart3 },
  { role: 'factory_entrance', label: 'Entrance TV', icon: Monitor },
  { role: 'planning_department', label: 'Planning Dept.', icon: ClipboardList },
  { role: 'production_engineer', label: 'Production Eng.', icon: Wrench },
  { role: 'quality_inspector', label: 'Quality Assurance', icon: Shield },
  { role: 'stage_worker', label: 'Shop Floor', icon: HardHat },
  { role: 'section_dashboard', label: 'Section TVs', icon: Tv },
  { role: 'trolley_prod', label: 'Trolley Prod.', icon: Boxes },
  { role: 'hr_portal', label: 'HR Portal', icon: UserCog },
  { role: 'store', label: 'Store Portal', icon: Warehouse, testId: 'role-store' },
  { role: 'section_supervisor', label: 'Section Supervisor', icon: HardHat, testId: 'role-section-supervisor' },
  { role: 'reports_analytics', label: 'Reports & Analytics', icon: FileBarChart, testId: 'role-reports-analytics' },
];

const LOCKED_LABELS: Partial<Record<ViewRole, { label: string; icon: React.ElementType }>> = {
  management: { label: 'Management', icon: BarChart3 },
  factory_entrance: { label: 'Entrance TV', icon: Monitor },
  planning_department: { label: 'Planning', icon: ClipboardList },
  production_engineer: { label: 'Eng Release', icon: Wrench },
  quality_inspector: { label: 'QA', icon: Shield },
  stage_worker: { label: 'Shop Floor', icon: HardHat },
  section_dashboard: { label: 'Section TV', icon: Tv },
  trolley_prod: { label: 'Trolley Ledger', icon: Boxes },
};

export const RoleSelector: React.FC<RoleSelectorProps> = ({
  currentRole,
  onChangeRole,
  googleUser,
  onGoogleSignIn,
  onGoogleSignOut,
  stationLock,
  loggedInUser,
  onLogout,
}) => {
  const itemClass = (active: boolean) =>
    `w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-[13px] font-medium cursor-pointer transition-colors ${
      active ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-300 hover:bg-slate-800 hover:text-white'
    }`;

  return (
    <div className="w-64 shrink-0 h-screen sticky top-0 bg-slate-900 text-slate-100 border-r border-slate-800 flex flex-col overflow-y-auto">

      {/* Brand / Logo */}
      <div className="flex items-center gap-3.5 px-5 pt-7 pb-6 border-b border-slate-800/80">
        <div className="h-14 w-14 shrink-0 rounded-xl bg-white shadow-[0_8px_20px_rgba(0,0,0,0.35)] ring-1 ring-amber-500/25 flex items-center justify-center p-2">
          <img
            src="/logo.png"
            alt="MAT Plastic Industries LLC"
            className="h-full w-full object-contain"
          />
        </div>
        <div className="min-w-0">
          <h1 className="text-[12.5px] font-semibold tracking-[0.14em] uppercase text-white leading-[1.35]">
            MAT Plastic<br />Industries
          </h1>
          <div className="mt-2 h-px w-7 bg-amber-500/70" />
          <p className="mt-2 text-[9.5px] font-medium tracking-[0.12em] uppercase text-slate-400">
            Manufacturing ERP
          </p>
        </div>
      </div>

      {/* Role navigation */}
      <div className="flex-1 px-3 py-4">
        {!stationLock?.isLocked ? (
          loggedInUser?.role === 'management' ? (
            <>
              <p className="px-3 pb-2 text-[10px] font-semibold uppercase tracking-wider text-slate-500">Role view</p>
              <nav className="flex flex-col gap-0.5">
                {NAV_ITEMS.map(({ role, label, icon: Icon, testId }) => (
                  <button
                    key={role}
                    onClick={() => onChangeRole(role)}
                    data-testid={testId}
                    className={itemClass(currentRole === role)}
                  >
                    <Icon className="h-[18px] w-[18px] shrink-0" />
                    <span className="truncate">{label}</span>
                  </button>
                ))}
              </nav>
            </>
          ) : (
            <div className="flex items-center gap-2 bg-slate-800/80 px-3 py-2.5 rounded-lg border border-slate-700/50 text-[11px] text-slate-200">
              <span className="h-2 w-2 shrink-0 rounded-full bg-emerald-500 animate-pulse"></span>
              <span>
                Active session: <strong className="text-white uppercase font-mono block mt-0.5">{loggedInUser ? loggedInUser.displayName : currentRole.replace('_', ' ')}</strong>
              </span>
            </div>
          )
        ) : stationLock?.allowedRoles && stationLock.allowedRoles.length > 1 ? (
          <>
            <p className="px-3 pb-2 text-[10px] font-semibold uppercase tracking-wider text-amber-500 flex items-center gap-1.5">
              <ShieldAlert className="h-3 w-3" /> Locked station tabs
            </p>
            <nav className="flex flex-col gap-0.5">
              {stationLock.allowedRoles.map((role) => {
                const meta = LOCKED_LABELS[role];
                if (!meta) return null;
                const Icon = meta.icon;
                return (
                  <button key={role} onClick={() => onChangeRole(role)} className={itemClass(currentRole === role)}>
                    <Icon className="h-[18px] w-[18px] shrink-0" />
                    <span className="truncate">{meta.label}</span>
                  </button>
                );
              })}
            </nav>
          </>
        ) : (
          <div className="flex items-center gap-2 px-3 py-2.5 bg-slate-800/50 border border-slate-700/80 rounded-lg text-[11px] font-semibold text-slate-300">
            <span className="h-2 w-2 shrink-0 rounded-full bg-cyan-400 animate-ping"></span>
            <span>Viewport role: <strong className="text-white uppercase font-mono block mt-0.5">{currentRole.replace('_', ' ')}</strong></span>
          </div>
        )}
      </div>

      {/* Footer: Google Drive + Exit */}
      <div className="px-3 pb-5 pt-3 border-t border-slate-800 flex flex-col gap-2">
        {!stationLock?.isLocked ? (
          googleUser ? (
            <div className="flex items-center gap-2 bg-slate-800/80 px-2.5 py-2 rounded-lg border border-slate-700/60">
              {googleUser.photoURL ? (
                <img src={googleUser.photoURL} alt="" className="h-6 w-6 rounded-full border border-emerald-500 shrink-0" referrerPolicy="no-referrer" />
              ) : (
                <div className="h-6 w-6 shrink-0 rounded-full bg-indigo-600 text-[10px] font-black flex items-center justify-center text-white">
                  {googleUser.displayName?.charAt(0) || 'U'}
                </div>
              )}
              <div className="min-w-0 flex-1">
                <span className="text-[9px] block text-slate-400 uppercase tracking-wider leading-none mb-0.5">Connected drive</span>
                <span className="font-semibold text-cyan-400 text-[11px] truncate block leading-none">{googleUser.displayName}</span>
              </div>
              <button
                onClick={onGoogleSignOut}
                className="p-1 hover:bg-rose-950/40 text-slate-400 hover:text-rose-400 rounded-md transition-colors cursor-pointer shrink-0"
                title="Disconnect Google Account"
              >
                <LogOut className="h-3.5 w-3.5" />
              </button>
            </div>
          ) : (
            <button
              onClick={onGoogleSignIn}
              className="flex items-center gap-2 text-[12px] font-semibold text-slate-300 hover:text-white hover:bg-slate-800 px-2.5 py-2 rounded-lg border border-slate-700 transition-colors cursor-pointer"
            >
              <Cloud className="h-4 w-4 text-cyan-400 shrink-0" />
              <span>Connect Google Drive</span>
            </button>
          )
        ) : (
          <div className="flex items-center gap-1.5 px-2.5 py-2 bg-slate-800 border border-slate-700 rounded-lg font-mono text-[9px] text-amber-400 uppercase font-bold tracking-wider">
            <span className="inline-block h-2 w-2 shrink-0 rounded-full bg-amber-500 animate-pulse"></span>
            <span>Workstation locked</span>
          </div>
        )}

        <button
          onClick={onLogout}
          className="flex items-center gap-2 px-2.5 py-2 rounded-lg text-[12px] font-semibold bg-rose-950/40 hover:bg-rose-900/50 text-rose-300 border border-rose-900/40 transition-colors cursor-pointer"
          title="Sign Out to Security Gate"
        >
          <LogOut className="h-3.5 w-3.5 shrink-0" />
          <span>Exit Portal</span>
        </button>
      </div>

      {/* Bottom brand signature */}
      <div className="flex items-center gap-2.5 px-5 py-4 border-t border-slate-800/80">
        <div className="h-8 w-8 shrink-0 rounded-lg bg-white shadow-[0_4px_10px_rgba(0,0,0,0.3)] ring-1 ring-amber-500/25 flex items-center justify-center p-1">
          <img
            src="/logo.png"
            alt=""
            aria-hidden="true"
            className="h-full w-full object-contain"
          />
        </div>
        <div className="min-w-0">
          <p className="text-[9.5px] font-semibold tracking-[0.1em] uppercase text-slate-300 truncate">
            MAT Plastic Industries
          </p>
          <p className="text-[9px] text-slate-500">© 2026 · All rights reserved</p>
        </div>
      </div>
    </div>
  );
};

/* Contextual banner shown at the top of the main content area for roles that
   need an extra selector or informational strip. Rendered by App.tsx, not by
   the sidebar, since it belongs to the page — not the navigation. */
interface RoleContextPanelProps {
  currentRole: ViewRole;
  selectedStageId: StageId;
  onChangeStage: (stageId: StageId) => void;
  workerTeamId: string;
  onChangeWorkerTeam: (teamId: string) => void;
  allTeams: any[];
  stationLock?: {
    isLocked: boolean;
    stageId: StageId | null;
    teamId: string | null;
  };
}

export const RoleContextPanel: React.FC<RoleContextPanelProps> = ({
  currentRole,
  selectedStageId,
  onChangeStage,
  workerTeamId,
  onChangeWorkerTeam,
  allTeams,
  stationLock,
}) => {
  const activeStageTeams = allTeams.filter(t => t.stageId === selectedStageId);

  if (currentRole === 'stage_worker') {
    return (
      <div className="bg-slate-900 text-slate-100 rounded-xl border border-slate-800 py-3 px-4 mb-6 flex flex-wrap items-center justify-between gap-4">
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

        <div className="flex items-center gap-2">
          <span className="text-xs font-semibold text-slate-400 uppercase tracking-wider flex items-center gap-1">
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
    );
  }

  const infoByRole: Partial<Record<ViewRole, { dot: string; text: React.ReactNode }>> = {
    quality_inspector: {
      dot: 'bg-emerald-500',
      text: <>You are viewing as <strong className="text-slate-800">Lead QA Inspector</strong>. All step completions trigger notification flags below. Only QA-approved items proceed to upstream manufacturing stages.</>,
    },
    production_engineer: {
      dot: 'bg-amber-500',
      text: <>Signed in as <strong className="text-slate-800">Lead Production Engineer</strong>. Pull registered pools from the pre-planned registry or initialize bulk fabrication runs.</>,
    },
    planning_department: {
      dot: 'bg-indigo-500',
      text: <>Signed in as <strong className="text-slate-800">Planning Coordinator</strong>. Register future production pools in bulk, review orientation ratios, and release items to fabrication.</>,
    },
    section_dashboard: {
      dot: 'bg-cyan-500',
      text: <>Casting active <strong className="text-slate-800">Physical Section Screen</strong>. Select individual department feeds at top-right to filter workspace tracking indices live.</>,
    },
    trolley_prod: {
      dot: 'bg-rose-500',
      text: <>Logged in as <strong className="text-slate-800">Trolley Production Supervisor</strong>. Track daily trolley manufacturing yields independently without affecting pool manufacturing logs.</>,
    },
  };

  const info = infoByRole[currentRole];
  if (!info) return null;

  return (
    <div className="bg-white border border-slate-200 rounded-xl py-2.5 px-4 mb-6 text-slate-500 text-xs flex items-center gap-2">
      <span className={`inline-block h-2 w-2 shrink-0 rounded-full ${info.dot} animate-pulse`}></span>
      <span>{info.text}</span>
    </div>
  );
};
