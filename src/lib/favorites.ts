import { useCallback, useEffect, useRef, useState } from 'react';
import type { ViewRole } from '../types';
import { fetchMyFavorites, saveMyFavorites } from './authClient';

/**
 * Favourite buttons ("pins")
 * ----------------------------------------------------------------------------
 * Every portal (sidebar entry) has its own inner buttons/tabs. This module lets
 * a user pin any of those inner buttons from ANY portal they are allowed into,
 * and shows them together in one bar (see components/FavoritesBar.tsx).
 *
 * Access rule: pins are only ever shown/usable for portals that are in the
 * account's getAllowedRoles() list. If an admin later removes a portal from an
 * account, its pins silently disappear (they are kept, not deleted, so they
 * come back if access is restored).
 *
 * To make a NEW inner button pinnable: add it to FAV_REGISTRY below.
 * To make a NEW portal pinnable: add it to FAV_REGISTRY and call
 * useFavoriteNav(...) inside that portal (see ReportsAndAnalytics for a
 * 3-line example).
 */

export interface FavTabDef { id: string; label: string }
export interface FavPortalDef { label: string; tabs: FavTabDef[] }

export const FAV_REGISTRY: Partial<Record<ViewRole, FavPortalDef>> = {
  management: {
    label: 'Management',
    tabs: [
      { id: 'analytics', label: 'Analytics' }, { id: 'projects_portal', label: 'Projects' },
      { id: 'pools', label: 'Pools' }, { id: 'daily_progress', label: 'Daily Progress' },
      { id: 'team_performance', label: 'Team Performance' }, { id: 'team_search', label: 'Team Search' },
      { id: 'project_progress', label: 'Project Progress' }, { id: 'stage_reports', label: 'Stage Reports' },
      { id: 'stage_timeline', label: 'Stage Timeline' },
      { id: 'shop_floor', label: 'Shop Floor' }, { id: 'warehouse', label: 'Warehouse' },
      { id: 'delivery', label: 'Delivery' }, { id: 'site_deliveries', label: 'Site Deliveries' },
      { id: 'release_log', label: 'Release Log' }, { id: 'rejection_log', label: 'Rejection Log' },
      { id: 'teams', label: 'Teams' }, { id: 'employee_portal', label: 'Employees' },
      { id: 'scrap', label: 'Scrap' },
      { id: 'pool_editor', label: 'Pool Editor' }, { id: 'audit_logs', label: 'Audit Logs' },
      { id: 'workspace_setup', label: 'Workspace Setup' }, { id: 'google_drive', label: 'Google Drive' },
      { id: 'terminal_settings', label: 'Terminal Settings' }, { id: 'online_users', label: 'Online Users' },
    ],
  },
  planning_department: {
    label: 'Planning Dept.',
    tabs: [
      { id: 'dashboard', label: 'Dashboard Analytics' }, { id: 'all_projects_portal', label: 'All Projects Portal' },
      { id: 'monthly_targets', label: 'KPI Targets Scheduler' }, { id: 'registry', label: 'Inventory Registry' },
      { id: 'quick_launch', label: 'Create / Batch Spawner' }, { id: 'direct_stage_portal', label: 'Direct Stage & Status Updater' },
      { id: 'roles', label: 'Roles' }, { id: 'pool_manager', label: 'Delete Any Pool' },
    ],
  },
  quality_inspector: {
    label: 'Quality Control',
    tabs: [
      { id: 'queue', label: 'Inspection Queue' }, { id: 'incoming_qc', label: 'Incoming Material QC' },
      { id: 'daily_report', label: 'Daily Defect Report' }, { id: 'hold_pool', label: 'Hold / Release Pool' },
      { id: 'spc', label: 'SPC' },
    ],
  },
  store: {
    label: 'Store Portal',
    tabs: [
      { id: 'key', label: 'Key Materials' }, { id: 'inventory', label: 'Inventory' },
      { id: 'reorder', label: 'Reorder' }, { id: 'assets', label: 'Company Assets' },
      { id: 'incoming', label: 'Incoming' }, { id: 'quality', label: 'Quality Status' },
      { id: 'traceability', label: 'Material Traceability' }, { id: 'bom', label: 'Bill of Materials' },
      { id: 'requests', label: 'Requests' }, { id: 'reports', label: 'Consumption Reports' },
      { id: 'ledger', label: 'Inventory Ledger' }, { id: 'suppliers', label: 'Suppliers' },
    ],
  },
  section_supervisor: {
    label: 'Section Supervisor',
    tabs: [
      { id: 'consumption', label: 'Consumption' }, { id: 'production', label: 'Log Production' },
      { id: 'request', label: 'Request Material' }, { id: 'purchases', label: 'Purchases' },
      { id: 'history', label: 'Today vs Plan' }, { id: 'scrap', label: 'Scrap' },
    ],
  },
  factory_supervisor: {
    label: 'Factory Supervisor',
    tabs: [
      { id: 'monitor', label: 'Stage Floor Monitor' }, { id: 'supervisor', label: 'Section Supervisor Portal' },
      { id: 'tv', label: 'Section TV' }, { id: 'pool_register', label: 'Pool Register' },
      { id: 'rejection_log', label: 'Rejection Log' }, { id: 'scrap', label: 'Scrap' },
    ],
  },
  reports_analytics: {
    label: 'Reports & Analytics',
    tabs: [
      { id: 'all', label: 'All Reports' }, { id: 'purchases', label: 'Purchase Requests' },
      { id: 'analytics', label: 'Live Analytics' }, { id: 'reports', label: 'PDF Reports' },
      { id: 'exports', label: 'Excel Exports' },
    ],
  },
  hr_portal: {
    label: 'HR Executive',
    tabs: [
      { id: 'hrdash', label: 'Dashboard' }, { id: 'emp360', label: 'Employee 360' },
      { id: 'docs', label: 'Documents' }, { id: 'cases', label: 'Discipline' },
      { id: 'requests', label: 'Requests' }, { id: 'safety', label: 'Safety & Training' },
      { id: 'reviews', label: 'Performance' }, { id: 'health', label: 'Data Health' },
      { id: 'grid', label: 'Quick Entry' }, { id: 'import', label: 'Excel Import' },
      { id: 'fleet', label: 'Fleet' }, { id: 'recruit', label: 'Recruitment' },
      { id: 'relations', label: 'Employee Relations' }, { id: 'settle', label: 'Final Settlement' },
      { id: 'letters', label: 'Letters' }, { id: 'audit', label: 'Audit Trail' },
      { id: 'directory', label: 'Directory' }, { id: 'passports', label: 'Passports' },
      { id: 'attendance', label: 'Attendance' }, { id: 'payroll', label: 'Payroll' },
      { id: 'leave', label: 'Leave' }, { id: 'warnings', label: 'Warnings' },
      { id: 'accidents', label: 'Accidents' }, { id: 'medical', label: 'Medical' },
      { id: 'purchases', label: 'Purchases' }, { id: 'reports', label: 'Reports' },
      { id: 'accounts', label: 'Accounts' },
    ],
  },
  hr_admin: {
    label: 'HR Administration',
    tabs: [
      { id: 'directory', label: 'Directory' }, { id: 'attendance', label: 'Attendance' },
      { id: 'leave', label: 'Leave' }, { id: 'warnings', label: 'Warnings' },
      { id: 'accidents', label: 'Accidents' }, { id: 'medical', label: 'Medical' },
    ],
  },
};

export const favKey = (role: ViewRole, tabId: string) => `${role}:${tabId}`;

export function resolveFav(key: string): { role: ViewRole; tabId: string; portal: string; label: string } | null {
  const i = key.indexOf(':');
  if (i < 0) return null;
  const role = key.slice(0, i) as ViewRole;
  const tabId = key.slice(i + 1);
  const def = FAV_REGISTRY[role];
  const tab = def?.tabs.find(t => t.id === tabId);
  if (!def || !tab) return null; // stale pin (button was removed from the app)
  return { role, tabId, portal: def.label, label: tab.label };
}

// ─── Per-user storage + cross-device sync ────────────────────────────────────
// Source of truth: the user's own account on the server (auth-admin function),
// so pins follow the login to every phone / PC. localStorage is only a fast
// local copy so the bar shows instantly and still works if the network drops.
const storageKey = (userId: string) => `mat_erp_favs_v1_${userId}`;
const MAX_FAVS = 30;
const SAVE_DELAY_MS = 600;
const REFRESH_EVERY_MS = 2 * 60 * 1000;

export type FavSyncState = 'loading' | 'synced' | 'saving' | 'offline';

function readLocal(userId: string | undefined): string[] {
  if (!userId) return [];
  try {
    const raw = localStorage.getItem(storageKey(userId));
    const arr = raw ? JSON.parse(raw) : [];
    return Array.isArray(arr) ? arr.filter((x): x is string => typeof x === 'string') : [];
  } catch { return []; }
}
function writeLocal(userId: string | undefined, list: string[]) {
  if (!userId) return;
  try { localStorage.setItem(storageKey(userId), JSON.stringify(list)); } catch { /* storage blocked */ }
}

export function useFavorites(userId: string | undefined) {
  const [favs, setFavs] = useState<string[]>(() => readLocal(userId));
  const [sync, setSync] = useState<FavSyncState>('loading');
  const latest = useRef<string[]>(favs);          // newest list, even before React re-renders
  const dirty = useRef(false);                    // local change not yet confirmed by the server
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const alive = useRef(true);

  const apply = useCallback((list: string[]) => {
    latest.current = list;
    setFavs(list);
    writeLocal(userId, list);
  }, [userId]);

  const flush = useCallback(async () => {
    if (!userId) return;
    setSync('saving');
    const sending = latest.current;
    try {
      await saveMyFavorites(sending);
      if (!alive.current) return;
      // Only mark clean if nothing changed again while the request was in flight.
      if (latest.current === sending) { dirty.current = false; setSync('synced'); }
      else { schedule(); }
    } catch {
      if (alive.current) setSync('offline');      // kept locally; retried on next change / refresh
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [userId]);

  const schedule = useCallback(() => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => { timer.current = null; void flush(); }, SAVE_DELAY_MS);
  }, [flush]);

  // Pull from the server. If the server has nothing yet but this device does
  // (pins made before sync existed), upload them once so nothing is lost.
  const pull = useCallback(async () => {
    if (!userId || dirty.current) return;          // never overwrite an unsent change
    try {
      const remote = await fetchMyFavorites();
      if (!alive.current || dirty.current) return;
      if (remote === null) {
        const local = readLocal(userId);
        if (local.length) { apply(local); dirty.current = true; await flush(); }
        else setSync('synced');
      } else {
        if (JSON.stringify(remote) !== JSON.stringify(latest.current)) apply(remote);
        setSync('synced');
      }
    } catch {
      if (alive.current) setSync('offline');
    }
  }, [userId, apply, flush]);

  useEffect(() => {
    alive.current = true;
    const local = readLocal(userId);
    latest.current = local; setFavs(local); dirty.current = false; setSync('loading');
    void pull();

    const onVisible = () => { if (document.visibilityState === 'visible') void pull(); };
    document.addEventListener('visibilitychange', onVisible);
    window.addEventListener('focus', onVisible);
    const iv = setInterval(() => { void pull(); }, REFRESH_EVERY_MS);
    return () => {
      alive.current = false;
      document.removeEventListener('visibilitychange', onVisible);
      window.removeEventListener('focus', onVisible);
      clearInterval(iv);
      if (timer.current) { clearTimeout(timer.current); timer.current = null; }
      if (dirty.current) void saveMyFavorites(latest.current).catch(() => { /* retried next login */ });
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [userId]);

  const commit = useCallback((next: string[]) => {
    dirty.current = true;
    apply(next);
    schedule();
  }, [apply, schedule]);

  const toggle = useCallback((key: string) => {
    const cur = latest.current;
    commit(cur.includes(key) ? cur.filter(k => k !== key) : [...cur, key].slice(0, MAX_FAVS));
  }, [commit]);

  const move = useCallback((key: string, dir: -1 | 1) => {
    const cur = [...latest.current];
    const i = cur.indexOf(key);
    const j = i + dir;
    if (i < 0 || j < 0 || j >= cur.length) return;
    [cur[i], cur[j]] = [cur[j], cur[i]];
    commit(cur);
  }, [commit]);

  return { favs, toggle, move, sync };
}

// ─── Navigation bus ──────────────────────────────────────────────────────────
// Clicking a favourite = switch portal + ask that portal to open an inner tab.
// The portal may not be mounted yet, so the request waits here until it is.
interface Target { role: ViewRole; tabId: string }
let pending: Target | null = null;
const requestListeners = new Set<() => void>();

export function requestFavoriteTab(role: ViewRole, tabId: string) {
  pending = { role, tabId };
  requestListeners.forEach(l => l());
}

// What the user is looking at right now (so the bar can offer "pin this page").
let current: Target | null = null;
const currentListeners = new Set<() => void>();

export function useCurrentFavTarget(): Target | null {
  const [, force] = useState(0);
  useEffect(() => {
    const l = () => force(n => n + 1);
    currentListeners.add(l);
    return () => { currentListeners.delete(l); };
  }, []);
  return current;
}

/**
 * Call once inside a portal that owns inner tabs.
 *   useFavoriteNav('store', activeTab, setActiveTab);
 * It (1) opens a requested tab when the portal mounts or is already open, and
 * (2) reports the open tab so it can be pinned from the bar.
 */
export function useFavoriteNav(role: ViewRole, activeTab: string, setActiveTab: (id: any) => void) {
  useEffect(() => {
    const valid = new Set((FAV_REGISTRY[role]?.tabs ?? []).map(t => t.id));
    const apply = () => {
      if (pending && pending.role === role) {
        const t = pending.tabId;
        pending = null;
        if (valid.has(t)) setActiveTab(t);
      }
    };
    apply(); // request made before this portal mounted
    requestListeners.add(apply);
    return () => { requestListeners.delete(apply); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [role]);

  useEffect(() => {
    current = { role, tabId: activeTab };
    currentListeners.forEach(l => l());
  }, [role, activeTab]);

  useEffect(() => () => {
    if (current?.role === role) { current = null; currentListeners.forEach(l => l()); }
  }, [role]);
}
