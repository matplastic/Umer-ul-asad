import React, { useEffect, useState } from 'react';
import { Circle, Wifi, Clock } from 'lucide-react';
import { subscribeToPresence, isOnline, type PresenceRecord } from '../lib/presence';

function timeAgo(iso: string | null): string {
  if (!iso) return 'unknown';
  const diffMs = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diffMs / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ${mins % 60}m ago`;
  return `${Math.floor(hrs / 24)}d ago`;
}

function lastSeenLabel(record: PresenceRecord): string {
  const ms = record.lastSeenAt?.toMillis ? record.lastSeenAt.toMillis() : null;
  if (!ms) return 'unknown';
  const diffMs = Date.now() - ms;
  const mins = Math.floor(diffMs / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  return `${Math.floor(mins / 60)}h ago`;
}

const ROLE_LABELS: Record<string, string> = {
  planning_department: 'Planning',
  production_engineer: 'Production Engineer',
  stage_worker: 'Stage Worker',
  quality_inspector: 'Quality Inspector',
  factory_entrance: 'Factory Entrance',
  management: 'Management',
  section_dashboard: 'Section Dashboard',
  trolley_prod: 'Trolley Production',
  hr_portal: 'HR',
  store: 'Store',
  section_supervisor: 'Section Supervisor',
  reports_analytics: 'Reports & Analytics',
};

export const OnlineUsersPanel: React.FC = () => {
  const [records, setRecords] = useState<PresenceRecord[]>([]);

  useEffect(() => {
    const unsubscribe = subscribeToPresence(setRecords);
    return unsubscribe;
  }, []);

  // Re-render every 15s purely so the "Xm ago" labels and stale/online
  // status stay accurate between Firestore snapshot updates.
  const [, forceTick] = useState(0);
  useEffect(() => {
    const t = setInterval(() => forceTick(n => n + 1), 15_000);
    return () => clearInterval(t);
  }, []);

  const online = records.filter(isOnline).sort((a, b) => a.displayName.localeCompare(b.displayName));
  const recentlyOffline = records
    .filter(r => !isOnline(r))
    .sort((a, b) => (b.lastSeenAt?.toMillis?.() || 0) - (a.lastSeenAt?.toMillis?.() || 0))
    .slice(0, 10);

  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
      <div className="bg-white rounded-[var(--radius-card)] border border-neutral-200 p-5">
        <div className="flex items-center gap-2 mb-4">
          <Wifi className="h-4 w-4 text-emerald-600" />
          <h3 className="text-sm font-semibold text-neutral-900">Currently Online</h3>
          <span className="ml-auto text-xs font-medium bg-emerald-50 text-emerald-700 px-2 py-0.5 rounded-full">
            {online.length} active
          </span>
        </div>
        {online.length === 0 ? (
          <p className="text-sm text-neutral-400">No one is currently active.</p>
        ) : (
          <div className="space-y-2">
            {online.map(r => (
              <div key={r.userId} className="flex items-center justify-between py-2 px-3 rounded-[var(--radius-control)] bg-neutral-50">
                <div className="flex items-center gap-2.5">
                  <Circle className="h-2 w-2 text-emerald-500 fill-emerald-500 shrink-0" />
                  <div>
                    <div className="text-sm font-medium text-neutral-900">{r.displayName}</div>
                    <div className="text-xs text-neutral-500">{ROLE_LABELS[r.role] || r.role}</div>
                  </div>
                </div>
                <div className="text-right shrink-0">
                  <div className="text-xs text-neutral-400">seen {lastSeenLabel(r)}</div>
                  <div className="text-[11px] text-neutral-400">signed in {timeAgo(r.loginAt)}</div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      <div className="bg-white rounded-[var(--radius-card)] border border-neutral-200 p-5">
        <div className="flex items-center gap-2 mb-4">
          <Clock className="h-4 w-4 text-neutral-400" />
          <h3 className="text-sm font-semibold text-neutral-900">Recently Signed Out / Idle</h3>
        </div>
        {recentlyOffline.length === 0 ? (
          <p className="text-sm text-neutral-400">Nothing to show yet.</p>
        ) : (
          <div className="space-y-2">
            {recentlyOffline.map(r => (
              <div key={r.userId} className="flex items-center justify-between py-2 px-3 rounded-[var(--radius-control)]">
                <div className="flex items-center gap-2.5">
                  <Circle className="h-2 w-2 text-neutral-300 fill-neutral-300 shrink-0" />
                  <div>
                    <div className="text-sm font-medium text-neutral-700">{r.displayName}</div>
                    <div className="text-xs text-neutral-400">{ROLE_LABELS[r.role] || r.role}</div>
                  </div>
                </div>
                <div className="text-xs text-neutral-400">last seen {lastSeenLabel(r)}</div>
              </div>
            ))}
          </div>
        )}
        <p className="text-[11px] text-neutral-400 mt-4">
          A user counts as online while their device sends a heartbeat at least every 2 minutes.
          Closing the tab, losing network, or 30 minutes of inactivity will drop them from the online list.
        </p>
      </div>
    </div>
  );
};
