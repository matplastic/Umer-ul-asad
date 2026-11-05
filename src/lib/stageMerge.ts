import { Pool, Team, StageHistory } from '../types';
import { STAGES, STAGE_MODEL_VERSION } from '../data/mockData';

/**
 * ONE-TIME UPGRADE — merge the Grouting stage into the Mosaic stage.
 *
 * Before: 12 stages. …Mechanical Fitting / Skimmer Test / Mosaic (a parallel
 *         gate), then Grouting, then Door Cutting, then Acrylic.
 * After:  11 stages. Mosaic now covers the tiles AND the grouting, with one
 *         team and one QC sign-off. Door Cutting and Acrylic each move up one
 *         position in the list (so stored stage positions must be shifted).
 *
 * Nothing is lost:
 *  - A pool that still owes Grouting is put back into the Mosaic stage with
 *    the state of its Grouting work — waiting to be claimed, being worked by
 *    a team, waiting for QC, or REJECTED (with the inspector's reason and the
 *    rejection count). The original Mosaic and Grouting records are kept on
 *    the stage entry as `mergedFrom`.
 *  - Pools that already finished Grouting keep their old Grouting record as a
 *    read-only legacy entry (`stageHistory.mosaic`).
 *  - Grouting teams become Mosaic teams (same names, codes and claims).
 *
 * Everything here is a pure function, so it can be previewed before anything
 * is saved, and running it twice changes nothing (converted pools carry
 * `stageModel: 2`).
 */

const OLD_STAGE_COUNT = 12; // length of the stage list BEFORE the merge
const OLD_GROUTING_INDEX = 9; // where the Grouting stage used to sit
const GATE_START_INDEX = STAGES.findIndex(s => s.id === 'mechanical_fitting'); // start of the parallel gate
const DONE = ['APPROVED', 'SKIPPED', 'CARRIED_ON_SITE'];
const ACTIVE = ['IN_PROGRESS', 'PENDING_INSPECTION', 'REJECTED'];

export type MergeAction =
  | 'none'
  | 'finished' // delivered / production complete — only the stage position is updated
  | 'shifted' // was at Door Cutting or Acrylic — moved up one position
  | 'back_to_mosaic_from_grouting' // was AT Grouting — now back in Mosaic with its Grouting status
  | 'reopened_at_gate' // Mosaic was approved but Grouting still owed — Mosaic re-opened for the Grouting work
  | 'folded_active_grouting' // Grouting was already in progress / at QC / rejected while Mosaic not approved
  | 'cleaned'; // nothing owed — empty Grouting placeholder removed

export const isOldFormatPool = (p: Pool): boolean =>
  (p.stageModel ?? 1) < STAGE_MODEL_VERSION && !!(p.stageHistory as any)?.mosaic;

export const isOldFormatTeam = (t: Team): boolean => (t.stageId as string) === 'mosaic';

export const needsStageMerge = (pools: Pool[], teams: Team[]): boolean =>
  pools.some(isOldFormatPool) || teams.some(isOldFormatTeam);

// Firestore rejects `undefined`, so drop it from the entry we build.
const clean = <T extends Record<string, any>>(o: T): T => {
  Object.keys(o).forEach(k => { if (o[k] === undefined) delete o[k]; });
  return o;
};

export function migratePool(p: Pool, nowIso: string = new Date().toISOString()): { pool: Pool; action: MergeAction } {
  if (!isOldFormatPool(p)) return { pool: p, action: 'none' };

  const sh: any = { ...(p.stageHistory as any) };
  const M: StageHistory | undefined = sh.door_cutting; // old "Mosaic"
  const G: StageHistory | undefined = sh.mosaic; // old "Grouting"
  const old = Number(p.currentStageIndex) || 0;
  const finished = !!p.isDelivered || old >= OLD_STAGE_COUNT;

  let newIdx = old;
  let action: MergeAction = 'cleaned';

  if (finished) {
    newIdx = STAGES.length;
    action = 'finished';
  } else if (old > OLD_GROUTING_INDEX) {
    newIdx = old - 1;
    action = 'shifted';
  } else {
    const grDone = !!G && DONE.includes(G.status);
    const grActive = !!G && ACTIVE.includes(G.status);
    const mosaicApproved = M?.status === 'APPROVED';

    if (old === OLD_GROUTING_INDEX && grDone) {
      // inconsistent legacy record: Grouting is finished but the pool is still at it
      newIdx = OLD_GROUTING_INDEX; // = Door Cutting after the shift
      action = 'shifted';
    } else if (!grDone && (grActive || mosaicApproved)) {
      // Grouting work is still owed → bring the pool (back) into the Mosaic stage
      // carrying the state of its Grouting work.
      const base: StageHistory = M ? { ...M } : { stageId: 'door_cutting', status: 'NOT_STARTED', rejectionCount: 0 };
      sh.door_cutting = clean({
        ...base,
        stageId: 'door_cutting',
        status: G?.status || 'NOT_STARTED',
        teamId: G?.teamId,
        teamName: G?.teamName,
        startTime: G?.startTime ?? null,
        endTime: G?.endTime ?? null,
        durationMinutes: G?.durationMinutes ?? null,
        inspectorId: G?.inspectorId,
        inspectorNotes: G?.inspectorNotes, // ← the rejection reason travels with the pool
        inspectionTime: G?.inspectionTime,
        inspectorPicture: G?.inspectorPicture,
        checklistResult: G?.checklistResult,
        heldMs: G?.heldMs,
        rejectionCount: (M?.rejectionCount || 0) + (G?.rejectionCount || 0),
        mergedFrom: { mosaic: M ? { ...M } : null, grouting: G ? { ...G } : null, mergedAt: nowIso },
      });
      if (old === OLD_GROUTING_INDEX) {
        newIdx = GATE_START_INDEX; // back to the shared gate where the Mosaic stage lives
        action = 'back_to_mosaic_from_grouting';
      } else {
        newIdx = old; // already inside the gate
        action = grActive && !mosaicApproved ? 'folded_active_grouting' : 'reopened_at_gate';
      }
      delete sh.mosaic;
    } else {
      // nothing owed: Mosaic still to do (it will now include the grouting) or carried on site
      if (old === OLD_GROUTING_INDEX) newIdx = GATE_START_INDEX;
      delete sh.mosaic;
      action = 'cleaned';
    }
  }

  return {
    pool: { ...p, currentStageIndex: newIdx, stageHistory: sh, stageModel: STAGE_MODEL_VERSION },
    action,
  };
}

export function migrateTeam(t: Team): { team: Team; changed: boolean } {
  if (!isOldFormatTeam(t)) return { team: t, changed: false };
  return { team: { ...t, stageId: 'door_cutting' }, changed: true };
}

/**
 * Drops claims that no longer mean anything: a team still lists a pool that was
 * deleted, delivered, whose stage for that team is already finished, or that is
 * waiting unclaimed (no team on the stage entry). Claims on pools that are
 * in progress, at QC or rejected are never touched. Mirrors what the app does
 * itself when QC approves a pool (promote the next overflow pool, go IDLE when
 * nothing is left).
 */
export function releaseStaleClaims(teams: Team[], pools: Pool[]): { teams: Team[]; released: number; teamsCleaned: number } {
  const byId = new Map(pools.map(p => [p.id, p]));
  let released = 0;
  let teamsCleaned = 0;
  const out = teams.map(t => {
    const isStale = (poolId: string): boolean => {
      const p = byId.get(poolId);
      if (!p) return true;
      if (p.isDelivered) return true;
      const e: StageHistory | undefined = (p.stageHistory as any)?.[t.stageId];
      if (!e) return false;
      if (DONE.includes(e.status)) return true;
      if (e.status === 'NOT_STARTED' && e.teamId !== t.id) return true;
      return false;
    };
    const had = [t.activePoolId, ...(t.extraPoolIds || []), ...(t.reworkPoolIds || [])].filter(Boolean) as string[];
    if (had.length === 0) return t;

    let active = t.activePoolId || null;
    let extra = [...(t.extraPoolIds || [])];
    let n = 0;
    if (active && isStale(active)) { n++; active = null; }
    const keepExtra = extra.filter(id => { if (isStale(id)) { n++; return false; } return true; });
    if (!active && keepExtra.length > 0) { active = keepExtra.shift() as string; } // promote, like the app does
    const rework = (t.reworkPoolIds || []).filter(id => { if (isStale(id)) { n++; return false; } return true; });
    if (n === 0) return t;

    released += n;
    teamsCleaned++;
    const stillClaimed = !!active || keepExtra.length > 0;
    return { ...t, activePoolId: active, extraPoolIds: keepExtra, reworkPoolIds: rework, status: stillClaimed ? t.status : ('IDLE' as const) };
  });
  return { teams: out, released, teamsCleaned };
}

export interface StageMergeSummary {
  oldFormatPools: number;
  actions: Record<MergeAction, number>;
  teamsMoved: number;
  teamNames: string[];
  // Claims a team still listed although the pool no longer needs that team
  // (pool delivered / stage already approved / pool deleted / pool re-opened
  // unclaimed by this upgrade). They would otherwise count against the
  // team's claim limit and block it from claiming that pool again.
  staleClaimsReleased: number;
  teamsCleaned: number;
  // What the Mosaic stage will contain for pools that owe grouting work
  carriedIntoMosaic: {
    waitingToClaim: number;
    inProgress: number;
    awaitingQc: number;
    rejected: { poolNo: string; project: string; reason: string }[];
    total: number;
  };
}

export interface StageMergePlan {
  pools: Pool[]; // every pool, converted where needed
  teams: Team[]; // every team, converted where needed
  changedPools: Pool[];
  changedTeams: Team[];
  summary: StageMergeSummary;
}

export function planStageMerge(pools: Pool[], teams: Team[], nowIso: string = new Date().toISOString()): StageMergePlan {
  const actions: Record<MergeAction, number> = {
    none: 0, finished: 0, shifted: 0, back_to_mosaic_from_grouting: 0, reopened_at_gate: 0, folded_active_grouting: 0, cleaned: 0,
  };
  const carried = { waitingToClaim: 0, inProgress: 0, awaitingQc: 0, rejected: [] as { poolNo: string; project: string; reason: string }[], total: 0 };

  const newPools: Pool[] = [];
  const changedPools: Pool[] = [];
  pools.forEach(p => {
    const { pool, action } = migratePool(p, nowIso);
    actions[action]++;
    newPools.push(pool);
    if (action !== 'none') {
      changedPools.push(pool);
      if (action === 'back_to_mosaic_from_grouting' || action === 'reopened_at_gate' || action === 'folded_active_grouting') {
        const e = pool.stageHistory.door_cutting;
        carried.total++;
        if (e.status === 'NOT_STARTED') carried.waitingToClaim++;
        else if (e.status === 'IN_PROGRESS') carried.inProgress++;
        else if (e.status === 'PENDING_INSPECTION') carried.awaitingQc++;
        else if (e.status === 'REJECTED') carried.rejected.push({ poolNo: pool.poolNo, project: pool.projectName, reason: e.inspectorNotes || '(no reason recorded)' });
      }
    }
  });

  const movedTeams: Team[] = [];
  const teamNames: string[] = [];
  teams.forEach(t => {
    const r = migrateTeam(t);
    movedTeams.push(r.team);
    if (r.changed) teamNames.push(t.name);
  });
  // Release leftover claims against the CONVERTED pools (so pools this upgrade
  // re-opened as "waiting to be claimed" are not still listed on a team).
  const cleaned = releaseStaleClaims(movedTeams, newPools);
  const newTeams = cleaned.teams;
  const changedTeams = newTeams.filter((t, i) => t !== teams[i]);

  return {
    pools: newPools,
    teams: newTeams,
    changedPools,
    changedTeams,
    summary: {
      oldFormatPools: pools.filter(isOldFormatPool).length,
      actions,
      teamsMoved: teamNames.length,
      teamNames,
      staleClaimsReleased: cleaned.released,
      teamsCleaned: cleaned.teamsCleaned,
      carriedIntoMosaic: carried,
    },
  };
}
