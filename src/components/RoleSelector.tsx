import React, { useState } from 'react';
import { ViewRole, StageId } from '../types';
import { STAGES } from '../data/mockData';
import { getAllowedRoles } from '../lib/authClient';
import { Wrench, Shield, Monitor, BarChart3, HardHat, Tv, Cloud, LogOut, ClipboardList, Boxes, UserCog, FileBarChart, Warehouse, ShieldAlert, Menu, X, ChevronsLeft, ChevronsRight, Factory, Truck, PackageCheck } from 'lucide-react';

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
  loggedInUser: { role: ViewRole; displayName: string; allowedRoles?: ViewRole[] | null } | null;
  onLogout: () => void;
  isOpen: boolean;
  onClose: () => void;
}

// ─────────────────────────────────────────────────────────────────────────────
// TOP BAR — always visible, full width, logo + company name centered.
// The hamburger button is only shown on smaller screens (< lg breakpoint),
// where the sidebar collapses back to an overlay drawer. On lg+ screens the
// sidebar is a permanent flex column next to the content (see RoleSelector
// below), so the hamburger has nothing to toggle there and is hidden.
// Rendered by App.tsx above the main content, same as before.
// ─────────────────────────────────────────────────────────────────────────────
export const TopBar: React.FC<{
  onMenuClick: () => void;
  showMenuButton?: boolean;
  workerExit?: { teamName: string; onExit: () => void };
  onExitPortal?: () => void;
}> = ({ onMenuClick, showMenuButton = true, workerExit, onExitPortal }) => (
  <header className="sticky top-0 z-30 h-16 shrink-0 w-full bg-white border-b border-slate-200 grid grid-cols-[1fr_auto_1fr] items-center px-3 sm:px-5">
    {/* Left slot — hamburger on mobile, empty on desktop (keeps the logo truly centered) */}
    <div className="flex items-center justify-start">
      {showMenuButton ? (
        <button
          onClick={onMenuClick}
          aria-label="Open portal menu"
          title="Open portal menu"
          className="h-10 w-10 shrink-0 flex items-center justify-center rounded-lg text-slate-600 hover:bg-slate-100 hover:text-slate-900 active:scale-95 transition-all cursor-pointer lg:hidden"
        >
          <Menu className="h-6 w-6" />
        </button>
      ) : (
        <div className="h-10 w-10 shrink-0 lg:hidden" aria-hidden="true" />
      )}
    </div>

    {/* Center — MAT logo + name, always centered on every screen size */}
    <div className="flex items-center justify-center gap-3 min-w-0 px-2">
      <div className="h-11 w-11 sm:h-12 sm:w-12 shrink-0 flex items-center justify-center">
        <img src="/logo.png" alt="MAT Plastic Industries LLC" className="h-full w-full object-contain" />
      </div>
      <div className="min-w-0 text-center leading-tight">
        <h1 className="text-[14px] sm:text-[17px] font-bold text-slate-900 truncate">
          MAT Plastic Industries
        </h1>
        <p className="text-[10px] sm:text-xs font-medium text-slate-500 truncate">
          Manufacturing ERP
        </p>
      </div>
    </div>

    {/* Right slot — Exit Portal (office users) or Exit (kiosk worker) */}
    <div className="flex items-center justify-end">
      {workerExit ? (
        <button
          onClick={workerExit.onExit}
          className="shrink-0 flex items-center gap-1.5 h-10 px-3.5 rounded-lg bg-rose-600 hover:bg-rose-700 text-white text-xs font-semibold cursor-pointer active:scale-95 transition-all"
        >
          <LogOut className="h-4 w-4" />
          <span className="hidden sm:inline">Exit ({workerExit.teamName})</span>
          <span className="sm:hidden">Exit</span>
        </button>
      ) : onExitPortal ? (
        <button
          onClick={onExitPortal}
          title="Exit Portal"
          className="shrink-0 flex items-center gap-1.5 h-10 px-3.5 rounded-lg bg-white hover:bg-rose-50 text-slate-700 hover:text-rose-700 border border-slate-200 hover:border-rose-200 text-xs font-semibold cursor-pointer active:scale-95 transition-all"
        >
          <LogOut className="h-4 w-4" />
          <span className="hidden sm:inline">Exit Portal</span>
        </button>
      ) : (
        <div className="h-10 w-10 shrink-0 lg:hidden" aria-hidden="true" />
      )}
    </div>
  </header>
);

const NAV_ITEMS: { role: ViewRole; label: string; icon: React.ElementType; testId?: string }[] = [
  { role: 'management', label: 'Management', icon: BarChart3 },
  { role: 'factory_entrance', label: 'Entrance TV', icon: Monitor },
  { role: 'planning_department', label: 'Planning Dept.', icon: ClipboardList },
  { role: 'production_engineer', label: 'Production Eng.', icon: Wrench },
  { role: 'quality_inspector', label: 'Quality Control', icon: Shield },
  { role: 'stage_worker', label: 'Shop Floor', icon: HardHat },
  { role: 'section_dashboard', label: 'Section TVs', icon: Tv },
  { role: 'trolley_prod', label: 'Trolley Prod.', icon: Boxes },
  { role: 'hr_portal', label: 'HR Portal', icon: UserCog },
  { role: 'store', label: 'Store Portal', icon: Warehouse, testId: 'role-store' },
  { role: 'section_supervisor', label: 'Section Supervisor', icon: HardHat, testId: 'role-section-supervisor' },
  { role: 'factory_supervisor', label: 'Factory Supervisor', icon: Factory, testId: 'role-factory-supervisor' },
  { role: 'reports_analytics', label: 'Reports & Analytics', icon: FileBarChart, testId: 'role-reports-analytics' },
  { role: 'site_team', label: 'Site Team (Receiving)', icon: Truck, testId: 'role-site-team' },
  { role: 'warehouse', label: 'Warehouse', icon: PackageCheck, testId: 'role-warehouse' },
];

// Sidebar grouping — every role in NAV_ITEMS appears in exactly one group.
// Groups with no visible items for the logged-in account are skipped.
const NAV_GROUPS: { title: string; roles: ViewRole[] }[] = [
  { title: 'Overview', roles: ['management', 'reports_analytics'] },
  { title: 'Production', roles: ['planning_department', 'production_engineer', 'stage_worker', 'section_supervisor', 'factory_supervisor', 'trolley_prod'] },
  { title: 'Quality', roles: ['quality_inspector'] },
  { title: 'Store & Logistics', roles: ['store', 'warehouse', 'site_team'] },
  { title: 'People', roles: ['hr_portal'] },
  { title: 'Displays', roles: ['factory_entrance', 'section_dashboard'] },
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

const SIDEBAR_COLLAPSE_KEY = 'mat-erp-sidebar-collapsed';

export const RoleSelector: React.FC<RoleSelectorProps> = ({
  currentRole,
  onChangeRole,
  googleUser,
  onGoogleSignIn,
  onGoogleSignOut,
  stationLock,
  loggedInUser,
  onLogout,
  isOpen,
  onClose,
}) => {
  // Persistent-sidebar collapse state (SAP Fiori launchpads let you shrink the
  // nav rail to icon-only to reclaim screen width). Only meaningful on lg+
  // screens — on mobile the sidebar is always the full-width overlay drawer.
  // Remembered across sessions via localStorage so a user's preference sticks.
  const [collapsed, setCollapsed] = useState<boolean>(() => {
    try {
      return typeof window !== 'undefined' && window.localStorage.getItem(SIDEBAR_COLLAPSE_KEY) === '1';
    } catch {
      return false;
    }
  });

  const toggleCollapsed = () => {
    setCollapsed((prev) => {
      const next = !prev;
      try { window.localStorage.setItem(SIDEBAR_COLLAPSE_KEY, next ? '1' : '0'); } catch {}
      return next;
    });
  };

  const itemClass = (active: boolean) =>
    `group relative w-full min-h-11 flex items-center gap-3 px-3 py-2.5 rounded-lg text-[13px] cursor-pointer transition-colors ${
      collapsed ? 'lg:justify-center lg:px-0' : ''
    } ${
      active
        ? 'bg-primary-50 text-primary-700 font-semibold'
        : 'text-slate-600 font-medium hover:bg-slate-100 hover:text-slate-900'
    }`;

  const iconClass = (active: boolean) =>
    `h-[18px] w-[18px] shrink-0 ${active ? 'text-primary-600' : 'text-slate-400 group-hover:text-slate-600'}`;

  const activeBar = (active: boolean) =>
    active ? <span aria-hidden="true" className="absolute left-0 top-2 bottom-2 w-1 rounded-r bg-primary-600" /> : null;

  // Picking a role closes the drawer too — on mobile this collapses the
  // overlay back down; on desktop it's a no-op (isOpen only governs mobile).
  const selectRole = (role: ViewRole) => {
    onChangeRole(role);
    onClose();
  };

  return (
    <>
      {/* Backdrop — mobile-only overlay, click anywhere outside to close.
          Never shown on lg+ since the sidebar is a permanent flex column
          there rather than an overlay. */}
      {isOpen && (
        <div
          onClick={onClose}
          aria-hidden="true"
          className="fixed inset-0 z-40 bg-black/50 backdrop-blur-[2px] transition-opacity duration-300 lg:hidden"
        />
      )}

      {/* Sidebar — on mobile this is a fixed, hidden-by-default drawer that
          slides in over the content (unchanged behavior). On lg+ screens it
          becomes a permanent, always-visible flex column sitting next to the
          page content (see the flex wrapper in App.tsx), collapsible between
          a full 18rem rail and an icon-only 5rem rail. */}
      <div
        role="dialog"
        aria-modal="true"
        aria-hidden={!isOpen}
        className={`fixed inset-y-0 left-0 z-50 w-72 max-w-[85vw] h-screen bg-white text-slate-700 border-r border-slate-200 flex flex-col overflow-y-auto shadow-2xl transform transition-transform duration-300 ease-in-out
          ${isOpen ? 'translate-x-0' : '-translate-x-full pointer-events-none'}
          lg:sticky lg:top-16 lg:left-auto lg:inset-y-auto lg:translate-x-0 lg:pointer-events-auto lg:shadow-none lg:shrink-0 lg:h-[calc(100vh-4rem)] lg:transition-[width] lg:duration-200
          ${collapsed ? 'lg:w-[4.5rem] lg:max-w-none' : 'lg:w-64 lg:max-w-none'}
        `}
      >
        {/* Drawer header: close button (mobile) / collapse toggle (desktop) */}
        <div className={`flex items-center pt-4 pb-2 ${collapsed ? 'lg:justify-center px-2' : 'justify-between px-4'}`}>
          <span className={`text-xs font-semibold text-slate-400 ${collapsed ? 'lg:hidden' : ''}`}>Portals</span>
          <button
            onClick={onClose}
            aria-label="Close portal menu"
            title="Close"
            className="p-2 -mr-2 rounded-lg text-slate-500 hover:text-slate-900 hover:bg-slate-100 active:scale-95 transition-all cursor-pointer lg:hidden"
          >
            <X className="h-5 w-5" />
          </button>
          <button
            onClick={toggleCollapsed}
            aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
            title={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
            className="hidden lg:flex p-2 rounded-lg text-slate-500 hover:text-slate-900 hover:bg-slate-100 active:scale-95 transition-all cursor-pointer"
          >
            {collapsed ? <ChevronsRight className="h-4 w-4" /> : <ChevronsLeft className="h-4 w-4" />}
          </button>
        </div>

      {/* Role navigation */}
      <div className="flex-1 px-3 py-2">
        {!stationLock?.isLocked ? (
          (() => {
            // An account can switch between every portal in its allowedRoles
            // list — could be all of them (unrestricted admin-style access,
            // the same as 'management' has always had), or a short curated
            // list an admin deliberately assigned (e.g. just Management +
            // Quality Assurance, nothing else). See getAllowedRoles in
            // authClient.ts for exactly how that list is resolved, including
            // backward compatibility for accounts created before this
            // per-portal access system existed.
            const myAllowedRoles = loggedInUser ? getAllowedRoles(loggedInUser) : [];
            const visibleNavItems = NAV_ITEMS.filter(item => myAllowedRoles.includes(item.role));
            return visibleNavItems.length > 1 ? (
              <nav className="flex flex-col gap-4">
                {NAV_GROUPS.map((group) => {
                  const items = group.roles
                    .map((r) => visibleNavItems.find((n) => n.role === r))
                    .filter((n): n is (typeof visibleNavItems)[number] => !!n);
                  if (items.length === 0) return null;
                  return (
                    <div key={group.title} className="flex flex-col gap-0.5">
                      <p className={`px-3 pb-1 text-xs font-semibold text-slate-400 ${collapsed ? 'lg:hidden' : ''}`}>
                        {group.title}
                      </p>
                      {collapsed && <div className="hidden lg:block mx-3 mb-1 border-t border-slate-200" />}
                      {items.map(({ role, label, icon: Icon, testId }) => {
                        const active = currentRole === role;
                        return (
                          <button
                            key={role}
                            onClick={() => selectRole(role)}
                            data-testid={testId}
                            title={collapsed ? label : undefined}
                            aria-current={active ? 'page' : undefined}
                            className={itemClass(active)}
                          >
                            {activeBar(active)}
                            <Icon className={iconClass(active)} />
                            <span className={`truncate ${collapsed ? 'lg:hidden' : ''}`}>{label}</span>
                          </button>
                        );
                      })}
                    </div>
                  );
                })}
              </nav>
            ) : (
              <div className={`flex items-center gap-2 bg-slate-50 px-3 py-2.5 rounded-lg border border-slate-200 text-[11px] text-slate-600 ${collapsed ? 'lg:justify-center' : ''}`}>
                <span className="h-2 w-2 shrink-0 rounded-full bg-emerald-500"></span>
                <span className={collapsed ? 'lg:hidden' : ''}>
                  Active session: <strong className="text-slate-900 font-semibold block mt-0.5">{loggedInUser ? loggedInUser.displayName : currentRole.replace('_', ' ')}</strong>
                </span>
              </div>
            );
          })()
        ) : stationLock?.allowedRoles && stationLock.allowedRoles.length > 1 ? (
          <>
            <p className={`px-3 pb-2 text-xs font-semibold text-amber-600 flex items-center gap-1.5 ${collapsed ? 'lg:hidden' : ''}`}>
              <ShieldAlert className="h-3 w-3" /> Locked station tabs
            </p>
            <nav className="flex flex-col gap-0.5">
              {stationLock.allowedRoles.map((role) => {
                const meta = LOCKED_LABELS[role];
                if (!meta) return null;
                const Icon = meta.icon;
                return (
                  <button key={role} onClick={() => selectRole(role)} title={collapsed ? meta.label : undefined} aria-current={currentRole === role ? 'page' : undefined} className={itemClass(currentRole === role)}>
                    {activeBar(currentRole === role)}
                    <Icon className={iconClass(currentRole === role)} />
                    <span className={`truncate ${collapsed ? 'lg:hidden' : ''}`}>{meta.label}</span>
                  </button>
                );
              })}
            </nav>
          </>
        ) : (
          <div className={`flex items-center gap-2 px-3 py-2.5 bg-slate-50 border border-slate-200 rounded-lg text-[11px] font-semibold text-slate-600 ${collapsed ? 'lg:justify-center' : ''}`}>
            <span className="h-2 w-2 shrink-0 rounded-full bg-primary-500"></span>
            <span className={collapsed ? 'lg:hidden' : ''}>Viewing as: <strong className="text-slate-900 font-semibold capitalize block mt-0.5">{currentRole.replace('_', ' ')}</strong></span>
          </div>
        )}
      </div>

      {/* Footer: Google Drive + Exit */}
      <div className="px-3 pb-4 pt-3 border-t border-slate-200 flex flex-col gap-2">
        {!stationLock?.isLocked ? (
          googleUser ? (
            <div className={`flex items-center gap-2 bg-slate-50 px-2.5 py-2 rounded-lg border border-slate-200 ${collapsed ? 'lg:justify-center' : ''}`}>
              {googleUser.photoURL ? (
                <img src={googleUser.photoURL} alt="" className="h-6 w-6 rounded-full border border-emerald-500 shrink-0" referrerPolicy="no-referrer" />
              ) : (
                <div className="h-6 w-6 shrink-0 rounded-full bg-indigo-600 text-[10px] font-black flex items-center justify-center text-white">
                  {googleUser.displayName?.charAt(0) || 'U'}
                </div>
              )}
              <div className={`min-w-0 flex-1 ${collapsed ? 'lg:hidden' : ''}`}>
                <span className="text-[10px] block text-slate-500 leading-none mb-0.5">Connected drive</span>
                <span className="font-semibold text-slate-800 text-[11px] truncate block leading-none">{googleUser.displayName}</span>
              </div>
              <button
                onClick={onGoogleSignOut}
                className="p-1 hover:bg-rose-50 text-slate-400 hover:text-rose-600 rounded-md transition-colors cursor-pointer shrink-0"
                title="Disconnect Google Account"
              >
                <LogOut className="h-3.5 w-3.5" />
              </button>
            </div>
          ) : (
            <button
              onClick={onGoogleSignIn}
              title={collapsed ? 'Connect Google Drive' : undefined}
              className={`flex items-center gap-2 text-[12px] font-semibold text-slate-700 hover:text-slate-900 hover:bg-slate-50 px-2.5 py-2 rounded-lg border border-slate-200 transition-colors cursor-pointer ${collapsed ? 'lg:justify-center' : ''}`}
            >
              <Cloud className="h-4 w-4 text-primary-600 shrink-0" />
              <span className={collapsed ? 'lg:hidden' : ''}>Connect Google Drive</span>
            </button>
          )
        ) : (
          <div className={`flex items-center gap-1.5 px-2.5 py-2 bg-amber-50 border border-amber-200 rounded-lg text-[11px] text-amber-700 font-semibold ${collapsed ? 'lg:justify-center' : ''}`}>
            <span className="inline-block h-2 w-2 shrink-0 rounded-full bg-amber-500"></span>
            <span className={collapsed ? 'lg:hidden' : ''}>Workstation locked</span>
          </div>
        )}
      </div>

      {/* Bottom brand signature */}
      <div className={`flex items-center gap-2.5 px-5 py-4 border-t border-slate-200 ${collapsed ? 'lg:justify-center lg:px-2' : ''}`}>
        <div className="h-8 w-8 shrink-0 rounded-lg bg-white ring-1 ring-slate-200 flex items-center justify-center p-1">
          <img
            src="/logo.png"
            alt=""
            aria-hidden="true"
            className="h-full w-full object-contain"
          />
        </div>
        <div className={`min-w-0 ${collapsed ? 'lg:hidden' : ''}`}>
          <p className="text-[11px] font-semibold text-slate-700 truncate">
            MAT Plastic Industries
          </p>
          <p className="text-[10px] text-slate-400">© 2026 All rights reserved</p>
        </div>
      </div>
      </div>
    </>

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
      <div className="bg-white text-slate-700 rounded-xl border border-slate-200 shadow-sm py-3 px-4 mb-6 flex flex-wrap items-center justify-between gap-4">
        {!stationLock?.isLocked || !stationLock?.stageId ? (
          <div className="flex items-center gap-2">
            <span className="text-xs font-semibold text-slate-500">Active section:</span>
            <div className="flex flex-wrap gap-1.5">
              {STAGES.map((stage) => {
                const isSelected = selectedStageId === stage.id;
                return (
                  <button
                    key={stage.id}
                    onClick={() => onChangeStage(stage.id)}
                    className={`px-2.5 py-1 rounded text-xs font-medium transition-all ${
                      isSelected
                        ? 'text-slate-900 border'
                        : 'bg-slate-100 hover:bg-slate-200 text-slate-600 border border-transparent'
                    }`}
                    style={{
                      borderColor: isSelected ? stage.color : undefined,
                      backgroundColor: isSelected ? `${stage.color}20` : undefined,
                      boxShadow: undefined
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
            <span className="text-xs font-semibold text-slate-500">Active section:</span>
            <span
              className="px-3 py-1 bg-slate-50 border rounded text-xs font-bold text-slate-900"
              style={{
                borderColor: STAGES.find(s => s.id === selectedStageId)?.color || '#9333ea',
                boxShadow: 'none'
              }}
            >
              {STAGES.find(s => s.id === selectedStageId)?.name}
            </span>
          </div>
        )}

        <div className="flex items-center gap-2">
          <span className="text-xs font-semibold text-slate-500 flex items-center gap-1">
            <HardHat className="h-3.5 w-3.5 text-primary-600" />
            Team assignment:
          </span>
          <select
            value={workerTeamId}
            disabled={!!stationLock?.teamId}
            onChange={(e) => onChangeWorkerTeam(e.target.value)}
            className="bg-white border border-slate-300 rounded-lg text-xs text-slate-700 px-3 py-1.5 cursor-pointer focus:outline-none focus:ring-2 focus:ring-primary-500 disabled:opacity-75 disabled:cursor-not-allowed"
          >
            <option value="">-- Choose Team on Floor --</option>
            {activeStageTeams.map((team) => (
              <option key={team.id} value={team.id}>
                {team.name} ({team.status === 'IDLE' ? 'Idle' : 'Active'})
              </option>
            ))}
          </select>
          {stationLock?.teamId && (
            <span className="text-[11px] font-semibold text-amber-600">Assigned device lock</span>
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
