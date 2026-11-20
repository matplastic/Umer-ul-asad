import React from 'react';

// ----------------------------------------------------
// MANAGEMENT NAVIGATION — three levels, one home per function
// ----------------------------------------------------
//   Level 1  Module  (Dashboard · Production · Workforce · Logistics · Administration)
//   Level 2  Page    (what you open)
//   Level 3  View    (related screens of one page, shown as a segmented switch)
//
// Every key is either an existing Management tab id ('pools', 'delivery' …) or
// 'analytics:<sub>' for one of the Analytics sub-views. The old in-page
// Analytics sub-menu was removed: this bar is the only navigation, so nothing
// appears twice. Keys are unchanged, so nothing else in the app needs to know
// that the menu was reorganised.

interface NavView { key: string; label: string }
interface NavPage { label: string; views: NavView[] }
interface NavModule { label: string; pages: NavPage[] }

const single = (key: string, label: string): NavPage => ({ label, views: [{ key, label }] });

const MODULES: NavModule[] = [
  {
    label: 'Dashboard',
    pages: [
      { label: 'Executive Dashboard', views: [
        { key: 'analytics:overview', label: 'Production Summary' },
        { key: 'analytics:kpi_oee', label: 'KPI & Section OEE' },
        { key: 'analytics:registry', label: 'Monthly KPI' },
      ] },
      { label: 'Projects', views: [
        { key: 'projects_portal', label: 'Contract Balance' },
        { key: 'project_progress', label: 'Stage Progress' },
      ] },
    ],
  },
  {
    label: 'Production',
    pages: [
      single('pools', 'Pool Register'),
      { label: 'Production Log', views: [
        { key: 'release_log', label: 'Released' },
        { key: 'pool_starts', label: 'Started' },
        { key: 'daily_progress', label: 'Daily Progress' },
        { key: 'analytics:ledger', label: 'Activity Ledger' },
        { key: 'rejection_log', label: 'Rejections' },
      ] },
      { label: 'Stage Reports', views: [
        { key: 'stage_reports', label: 'Stage Reports' },
        { key: 'stage_timeline', label: 'Stage Timeline' },
      ] },
      single('scrap', 'Scrap'),
      single('shop_floor', 'Live Floor Monitor'),
    ],
  },
  {
    label: 'Workforce',
    pages: [
      { label: 'Teams', views: [
        { key: 'teams', label: 'Allocation' },
        { key: 'team_performance', label: 'Performance' },
        { key: 'team_search', label: 'Team Search' },
      ] },
      { label: 'Employees', views: [
        { key: 'employee_portal', label: 'Directory' },
        { key: 'analytics:workforce', label: 'Workloads & Awards' },
      ] },
    ],
  },
  {
    label: 'Logistics',
    pages: [
      { label: 'Delivery & Dispatch', views: [
        { key: 'delivery', label: 'Delivery' },
        { key: 'site_deliveries', label: 'Site Deliveries' },
        { key: 'warehouse', label: 'Warehouse' },
      ] },
    ],
  },
  {
    label: 'Administration',
    pages: [
      single('pool_editor', 'Pool Editor'),
      { label: 'Workspace', views: [
        { key: 'workspace_setup', label: 'Setup' },
        { key: 'terminal_settings', label: 'Terminal Settings' },
        { key: 'google_drive', label: 'Google Drive & Backups' },
      ] },
      single('audit_logs', 'Audit Logs'),
      single('online_users', 'Online Users'),
    ],
  },
];

interface MgmtTabBarProps {
  /** Existing tab id, or 'analytics:<sub>' while an Analytics sub-view is open. */
  activeKey: string;
  onChange: (key: string) => void;
  onRefresh?: () => void;
  isSyncing?: boolean;
  lastSyncTime?: string | null;
}

export default function MgmtTabBar({ activeKey, onChange, onRefresh, isSyncing = false, lastSyncTime }: MgmtTabBarProps) {
  const activeModule = MODULES.find(m => m.pages.some(p => p.views.some(v => v.key === activeKey))) ?? MODULES[0];
  const activePage = activeModule.pages.find(p => p.views.some(v => v.key === activeKey)) ?? activeModule.pages[0];
  const activeView = activePage.views.find(v => v.key === activeKey) ?? activePage.views[0];

  return (
    <nav aria-label="Management navigation" className="space-y-3 rounded-2xl border border-slate-200 bg-white p-3">
      {/* Level 1 — modules */}
      <div className="flex flex-wrap items-center gap-2">
        {MODULES.map(module => (
          <button
            key={module.label}
            type="button"
            aria-pressed={module === activeModule}
            onClick={() => onChange(module.pages[0].views[0].key)}
            className={`rounded-lg px-4 py-2 text-sm font-semibold transition-colors ${module === activeModule ? 'bg-teal-700 text-white' : 'text-slate-600 hover:bg-slate-100'}`}
          >
            {module.label}
          </button>
        ))}
        {onRefresh && (
          <button type="button" onClick={onRefresh} disabled={isSyncing} className="ml-auto rounded-lg border border-slate-200 px-3 py-2 text-xs font-semibold text-slate-600 disabled:opacity-50">
            {isSyncing ? 'Syncing…' : 'Refresh'}
          </button>
        )}
        {lastSyncTime && <span className="text-xs text-slate-500">Last synced: {lastSyncTime}</span>}
      </div>

      {/* Level 2 — pages of the chosen module */}
      <div className="flex flex-wrap gap-2">
        {activeModule.pages.map(page => (
          <div key={page.label} className="flex grow">
            <MetalTabButton active={page === activePage} onClick={() => onChange(page.views[0].key)}>
              {page.label}
            </MetalTabButton>
          </div>
        ))}
      </div>

      {/* Level 3 — related views of the chosen page (only when it has more than one) */}
      {activePage.views.length > 1 && (
        <div className="flex flex-wrap items-center gap-1 rounded-xl border border-slate-100 bg-slate-50 p-1" role="tablist" aria-label={`${activePage.label} views`}>
          {activePage.views.map(view => (
            <button
              key={view.key}
              type="button"
              role="tab"
              aria-selected={view.key === activeView.key}
              onClick={() => onChange(view.key)}
              className={`rounded-lg px-3.5 py-1.5 text-xs font-bold transition-colors ${view.key === activeView.key ? 'border border-slate-200 bg-white text-slate-900 shadow-sm' : 'text-slate-500 hover:bg-white/70 hover:text-slate-800'}`}
            >
              {view.label}
            </button>
          ))}
        </div>
      )}

      {/* Where am I */}
      <div className="px-1 text-[11px] font-medium text-slate-400" aria-label="Current location">
        {activeModule.label} <span aria-hidden="true">›</span> {activePage.label}
        {activePage.views.length > 1 && <> <span aria-hidden="true">›</span> <span className="text-slate-600">{activeView.label}</span></>}
      </div>
    </nav>
  );
}

/**
 * MetalTabButton
 * ----------------------------------------------------------------------------
 * Reusable "brushed metal" embossed tab button, matching the reference style
 * (light gray/white surface, soft raised bevel, pressed/active inset state).
 *
 * Usage:
 *
 *   import { MetalTabButton } from './MetalTabButton';
 *
 *   const [activeTab, setActiveTab] = useState('store');
 *
 *   <div style={{ display: 'flex', gap: 10 }}>
 *     <MetalTabButton active={activeTab === 'planning'} onClick={() => setActiveTab('planning')}>
 *       Planning
 *     </MetalTabButton>
 *     <MetalTabButton active={activeTab === 'store'} onClick={() => setActiveTab('store')}>
 *       Store
 *     </MetalTabButton>
 *     <MetalTabButton active={activeTab === 'hr'} onClick={() => setActiveTab('hr')}>
 *       HR
 *     </MetalTabButton>
 *   </div>
 *
 * No external CSS file needed — styles are inline so this component is
 * fully drop-in. If you'd rather use the .btn-metal / .btn-metal.active
 * classes directly (e.g. on plain <button> tags elsewhere), see
 * metal-button.css in this same folder.
 * ----------------------------------------------------------------------------
 */

interface MetalTabButtonProps {
  active?: boolean;
  onClick?: () => void;
  children: React.ReactNode;
  disabled?: boolean;
}

export function MetalTabButton({ active = false, onClick, children, disabled = false }: MetalTabButtonProps) {
  const [hover, setHover] = React.useState(false);

  const baseStyle: React.CSSProperties = {
    flex: 1,
    padding: '12px 24px',
    border: 'none',
    borderRadius: 10,
    fontWeight: 600,
    fontSize: 14,
    cursor: disabled ? 'not-allowed' : 'pointer',
    opacity: disabled ? 0.5 : 1,
    transition: 'all 0.15s ease',
    fontFamily: 'inherit',
  };

  const idleStyle: React.CSSProperties = {
    ...baseStyle,
    color: '#4a4f57',
    background: 'linear-gradient(180deg, #f6f7f9 0%, #e2e4e8 100%)',
    boxShadow: hover
      ? '0 6px 10px rgba(0,0,0,0.1), 0 2px 4px rgba(0,0,0,0.08), inset 0 1px 0 rgba(255,255,255,0.9), inset 0 -1px 2px rgba(0,0,0,0.15)'
      : '0 3px 5px rgba(0,0,0,0.12), inset 0 1px 0 rgba(255,255,255,0.9), inset 0 -1px 2px rgba(0,0,0,0.15)',
    transform: hover && !disabled ? 'translateY(-2px)' : 'translateY(0)',
  };

  const activeStyle: React.CSSProperties = {
    ...baseStyle,
    color: '#3a3e45',
    background: 'linear-gradient(180deg, #e8eaed 0%, #d3d6db 100%)',
    boxShadow: 'inset 0 2px 4px rgba(0,0,0,0.15), inset 0 -1px 0 rgba(255,255,255,0.7)',
  };

  return (
    <button
      type="button"
      onClick={disabled ? undefined : onClick}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      disabled={disabled}
      aria-pressed={active}
      style={active ? activeStyle : idleStyle}
    >
      {children}
    </button>
  );
}
