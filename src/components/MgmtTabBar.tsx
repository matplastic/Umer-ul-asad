import React from 'react';

const sections: { label: string; tabs: [string, string][] }[] = [
  { label: 'Overview', tabs: [
    ['analytics', 'Analytics'], ['projects_portal', 'Projects'],
    ['pools', 'Pools'], ['daily_progress', 'Daily Progress'],
    ['team_performance', 'Team Performance'], ['team_search', 'Team Search'],
    ['project_progress', 'Project Progress'], ['stage_reports', 'Stage Reports'],
    ['stage_timeline', 'Stage Timeline'],
  ] },
  { label: 'Operations', tabs: [
    ['shop_floor', 'Shop Floor'], ['warehouse', 'Warehouse'],
    ['delivery', 'Delivery'], ['site_deliveries', 'Site Deliveries'],
    ['release_log', 'Release Log'], ['rejection_log', 'Rejection Log'],
    ['teams', 'Teams'], ['employee_portal', 'Employees'],
  ] },
  { label: 'Admin', tabs: [
    ['pool_editor', 'Pool Editor'], ['audit_logs', 'Audit Logs'],
    ['workspace_setup', 'Workspace Setup'], ['google_drive', 'Google Drive'],
    ['terminal_settings', 'Terminal Settings'], ['online_users', 'Online Users'],
  ] },
];

interface MgmtTabBarProps {
  activeTab: string;
  onChange: (id: string) => void;
  onRefresh?: () => void;
  isSyncing?: boolean;
  lastSyncTime?: string | null;
}

export default function MgmtTabBar({ activeTab, onChange, onRefresh, isSyncing = false, lastSyncTime }: MgmtTabBarProps) {
  const activeSection = sections.find(section => section.tabs.some(([id]) => id === activeTab)) ?? sections[0];

  return (
    <nav aria-label="Management navigation" className="space-y-3 rounded-2xl border border-slate-200 bg-white p-3">
      <div className="flex flex-wrap items-center gap-2">
        {sections.map(section => (
          <button
            key={section.label}
            type="button"
            aria-pressed={section === activeSection}
            onClick={() => onChange(section.tabs[0][0])}
            className={`rounded-lg px-4 py-2 text-sm font-semibold transition-colors ${section === activeSection ? 'bg-teal-700 text-white' : 'text-slate-600 hover:bg-slate-100'}`}
          >
            {section.label}
          </button>
        ))}
        {onRefresh && (
          <button type="button" onClick={onRefresh} disabled={isSyncing} className="ml-auto rounded-lg border border-slate-200 px-3 py-2 text-xs font-semibold text-slate-600 disabled:opacity-50">
            {isSyncing ? 'Syncing…' : 'Refresh'}
          </button>
        )}
        {lastSyncTime && <span className="text-xs text-slate-500">Last synced: {lastSyncTime}</span>}
      </div>
      <div className="flex flex-wrap gap-2">
        {activeSection.tabs.map(([id, label]) => (
          <div key={id} className="flex grow">
            <MetalTabButton active={activeTab === id} onClick={() => onChange(id)}>
              {label}
            </MetalTabButton>
          </div>
        ))}
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
