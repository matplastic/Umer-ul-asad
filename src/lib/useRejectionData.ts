import { useEffect, useMemo, useState } from 'react';
import { ActivityLog, Pool, StageId, Team } from '../types';
import { STAGES } from '../data/mockData';
import { dbFetchActivityLogsInRange } from './firebaseService';

/**
 * Data behind the Rejection Log (Management tab + Factory Supervisor view).
 *
 * WHY THIS EXISTS
 * The app's live `logs` list is a rolling cache of only the latest ~200
 * activity entries (see firebaseService.ts). The old Rejection Log filtered
 * that list, so anything older than a day or two simply "disappeared" — a
 * search over months showed 1 rejection while pools had hundreds recorded.
 *
 * This hook builds the list from three sources, best first:
 *   1. the live `logs` list                       (newest events)
 *   2. the permanent activity-log ARCHIVE         (full history, exact notes/time)
 *   3. STAGE RECORDS (pool.stageHistory)          (older rework that was never
 *      archived: only the rework COUNT, last inspector, last note and last
 *      inspection date survive there — flagged `source: 'record'`)
 *
 * A stage record is only used when no individual rejection log entry exists
 * for that pool + stage, so nothing is counted twice.
 */

export interface RejectionRow {
  id: string;
  source: 'log' | 'record';
  weight: number; // how many rejections this row stands for (log = 1, record = rework count)
  poolNo: string;
  projectName: string;
  poolType: string;
  stageId: string;
  stageName: string;
  stageColor: string;
  teamName: string;
  inspectorName: string;
  notes: string;
  date: string; // local YYYY-MM-DD
  time: string; // HH:mm ('' when unknown)
  sortKey: number;
}

const toLocalDateStr = (iso: string) => {
  const d = new Date(iso);
  if (isNaN(d.getTime())) return '';
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

const toTime = (iso: string) => {
  const d = new Date(iso);
  return isNaN(d.getTime()) ? '' : d.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });
};

const shiftDay = (day: string, delta: number) => {
  const d = new Date(`${day}T00:00:00`);
  d.setDate(d.getDate() + delta);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

interface Args {
  logs: ActivityLog[];
  pools: Pool[];
  teams: Team[];
  mode: 'day' | 'range';
  day: string;
  from: string;
  to: string;
  stageFilter: StageId | 'ALL';
}

export function useRejectionData({ logs, pools, teams, mode, day, from, to, stageFilter }: Args) {
  const start = mode === 'day' ? day : from;
  const end = mode === 'day' ? day : to;

  // Pull the permanent archive for the selected range. The archive filters by
  // UTC date while this screen filters by LOCAL date, so ask for one extra
  // day on each side and let the local filter below trim it exactly.
  const [archiveLogs, setArchiveLogs] = useState<ActivityLog[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!start || !end || start > end) { setArchiveLogs([]); return; }
    let cancelled = false;
    setLoading(true);
    dbFetchActivityLogsInRange(shiftDay(start, -1), shiftDay(end, 1))
      .then(rows => { if (!cancelled) setArchiveLogs(rows); })
      .catch(() => { if (!cancelled) setArchiveLogs([]); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [start, end]);

  const rows = useMemo<RejectionRow[]>(() => {
    // 1 + 2: live logs merged with the archive, de-duplicated by id.
    const seen = new Set<string>();
    const merged: ActivityLog[] = [];
    [...logs, ...archiveLogs].forEach(l => {
      if (!l || l.type !== 'REJECTED' || !l.timestamp) return;
      const key = l.id || `${l.poolId}|${l.stageId}|${l.timestamp}`;
      if (seen.has(key)) return;
      seen.add(key);
      merged.push(l);
    });

    const inRange = (d: string) => !!d && d >= start && d <= end;
    const poolById = new Map(pools.map(p => [p.id, p]));
    const out: RejectionRow[] = [];

    merged.forEach(l => {
      const d = toLocalDateStr(l.timestamp);
      if (!inRange(d)) return;
      if (stageFilter !== 'ALL' && l.stageId !== stageFilter) return;
      const stage = STAGES.find(s => s.id === l.stageId);
      const pool = poolById.get(l.poolId);
      const team = teams.find(t => (l.teamId ? t.id === l.teamId : t.name === l.teamName));
      out.push({
        id: l.id || `${l.poolId}-${l.stageId}-${l.timestamp}`,
        source: 'log',
        weight: 1,
        poolNo: l.poolNo,
        projectName: l.projectName,
        poolType: pool?.poolType || 'Type 3',
        stageId: String(l.stageId),
        stageName: stage?.name || String(l.stageId),
        stageColor: stage?.color || '#94a3b8',
        teamName: team?.name || l.teamName || 'Unknown Team',
        inspectorName: l.operatorName || '—',
        notes: l.notes || '—',
        date: d,
        time: toTime(l.timestamp),
        sortKey: new Date(l.timestamp).getTime(),
      });
    });

    // 3: stage records with rework but NO individual log entry for that pool + stage.
    const loggedPoolStage = new Set<string>();
    merged.forEach(l => loggedPoolStage.add(`${l.poolId}|${l.stageId}`));

    pools.forEach(pool => {
      STAGES.forEach(stage => {
        if (stageFilter !== 'ALL' && stage.id !== stageFilter) return;
        const h: any = (pool.stageHistory as any)?.[stage.id];
        const count = Number(h?.rejectionCount) || 0;
        if (!h || count <= 0) return;
        if (loggedPoolStage.has(`${pool.id}|${stage.id}`)) return;
        const when: string = h.inspectionTime || h.endTime || '';
        const d = toLocalDateStr(when);
        if (!inRange(d)) return;
        const team = teams.find(t => (h.teamId ? t.id === h.teamId : t.name === h.teamName));
        out.push({
          id: `rec-${pool.id}-${stage.id}`,
          source: 'record',
          weight: count,
          poolNo: pool.poolNo,
          projectName: pool.projectName,
          poolType: pool.poolType || 'Type 3',
          stageId: stage.id,
          stageName: stage.name,
          stageColor: stage.color,
          teamName: team?.name || h.teamName || 'Unknown Team',
          inspectorName: h.inspectorId || '—',
          notes: h.inspectorNotes || '—',
          date: d,
          time: toTime(when),
          sortKey: new Date(when).getTime(),
        });
      });
    });

    return out.sort((a, b) => b.sortKey - a.sortKey);
  }, [logs, archiveLogs, pools, teams, start, end, stageFilter]);

  const total = useMemo(() => rows.reduce((s, r) => s + r.weight, 0), [rows]);
  const recordCount = useMemo(() => rows.filter(r => r.source === 'record').reduce((s, r) => s + r.weight, 0), [rows]);

  return { rows, total, recordCount, loading };
}
