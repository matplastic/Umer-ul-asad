import { Pool, Team, StageHistory } from '../types';
import { STAGES } from '../data/mockData';
import { releaseStaleClaims } from './stageMerge';

/**
 * MOSAIC RESET — put every Mosaic pool back in the UNCLAIMED area.
 *
 * For each pool that is currently inside the Mosaic stage (not delivered, at
 * the Mosaic gate), the Mosaic entry goes back to "waiting to be claimed":
 *   - claimed by a team             → unclaimed
 *   - being worked (timer running)  → unclaimed, timer cleared
 *   - waiting for QC inspection     → unclaimed
 *   - rejected                      → kept as it is (status + inspector's
 *                                     reason), unless `includeRejected` is on
 * The Mosaic teams that were holding those pools are released (IDLE), and the
 * previous team / times / reason are kept on the pool (mergedFrom.resetFrom).
 *
 * Pure functions: the screen shows the numbers first, nothing is saved here.
 */

const GATE_START_INDEX = STAGES.findIndex(s => s.id === 'mechanical_fitting');
const GATE_END_INDEX = STAGES.findIndex(s => s.id === 'door_cutting');

export interface MosaicResetOptions {
  includeRejected: boolean;
}

export interface MosaicResetSummary {
  claimed: number;
  inProgress: number;
  inspection: number;
  rejectedReset: number;
  rejectedKept: number;
  alreadyUnclaimed: number;
  total: number; // pools that will change
  teamsReleased: string[];
}

export interface MosaicResetPlan {
  pools: Pool[];
  teams: Team[];
  changedPools: Pool[];
  changedTeams: Team[];
  summary: MosaicResetSummary;
}

const clean = <T extends Record<string, any>>(o: T): T => {
  Object.keys(o).forEach(k => { if (o[k] === undefined) delete o[k]; });
  return o;
};

const isMosaicPool = (p: Pool): boolean =>
  !p.isDelivered && p.currentStageIndex >= GATE_START_INDEX && p.currentStageIndex <= GATE_END_INDEX && !!(p.stageHistory as any)?.door_cutting;

export function planMosaicReset(
  pools: Pool[],
  teams: Team[],
  opts: MosaicResetOptions,
  nowIso: string = new Date().toISOString()
): MosaicResetPlan {
  const s: MosaicResetSummary = { claimed: 0, inProgress: 0, inspection: 0, rejectedReset: 0, rejectedKept: 0, alreadyUnclaimed: 0, total: 0, teamsReleased: [] };

  const newPools: Pool[] = [];
  const changedPools: Pool[] = [];
  pools.forEach(p => {
    if (!isMosaicPool(p)) { newPools.push(p); return; }
    const e: StageHistory = (p.stageHistory as any).door_cutting;
    let kind: 'claimed' | 'inProgress' | 'inspection' | 'rejected' | null = null;
    if (e.status === 'IN_PROGRESS') kind = 'inProgress';
    else if (e.status === 'PENDING_INSPECTION') kind = 'inspection';
    else if (e.status === 'NOT_STARTED' && e.teamId) kind = 'claimed';
    else if (e.status === 'REJECTED') kind = opts.includeRejected ? 'rejected' : null;

    if (e.status === 'NOT_STARTED' && !e.teamId) s.alreadyUnclaimed++;
    if (e.status === 'REJECTED' && !opts.includeRejected) s.rejectedKept++;
    if (!kind) { newPools.push(p); return; }

    if (kind === 'claimed') s.claimed++;
    else if (kind === 'inProgress') s.inProgress++;
    else if (kind === 'inspection') s.inspection++;
    else s.rejectedReset++;
    s.total++;

    const prior = (e as any).mergedFrom || { mergedAt: nowIso };
    const fresh: StageHistory = clean({
      stageId: 'door_cutting',
      status: 'NOT_STARTED',
      rejectionCount: e.rejectionCount || 0,
      mergedFrom: {
        ...prior,
        resetFrom: clean({
          status: e.status,
          teamId: e.teamId,
          teamName: e.teamName,
          startTime: e.startTime,
          endTime: e.endTime,
          durationMinutes: e.durationMinutes,
          inspectorNotes: e.inspectorNotes,
        }),
      },
    }) as StageHistory;
    const next: Pool = { ...p, stageHistory: { ...(p.stageHistory as any), door_cutting: fresh } };
    newPools.push(next);
    changedPools.push(next);
  });

  // Release the Mosaic teams that were holding those pools (other stages' teams are not touched).
  const mosaicTeamIdx = teams.map((t, i) => (t.stageId === 'door_cutting' ? i : -1)).filter(i => i >= 0);
  const released = releaseStaleClaims(mosaicTeamIdx.map(i => teams[i]), newPools);
  const newTeams = [...teams];
  mosaicTeamIdx.forEach((ti, k) => { newTeams[ti] = released.teams[k]; });
  const changedTeams = newTeams.filter((t, i) => t !== teams[i]);
  s.teamsReleased = changedTeams.map(t => t.name);

  return { pools: newPools, teams: newTeams, changedPools, changedTeams, summary: s };
}
