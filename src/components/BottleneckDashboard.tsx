import React, { useMemo, useState } from 'react';
import { Pool, StageId, MonthlyTarget } from '../types';
import { STAGES, DUAL_STAGE_IDS, isAtDualStageGate } from '../data/mockData';
import { Clock, AlertTriangle, Layers } from 'lucide-react';
import { DateRangeFilter, DateRange } from './DateRangeFilter';

function inDateRange(dateStr: string | undefined | null, start: string, end: string): boolean {
  if (!dateStr) return false;
  const d = dateStr.slice(0, 10);
  return d >= start && d <= end;
}

function getDefaultRange(): DateRange {
  const today = new Date();
  const start = new Date(today.getFullYear(), today.getMonth(), 1);
  return { startDate: start.toISOString().slice(0, 10), endDate: today.toISOString().slice(0, 10) };
}

interface BottleneckDashboardProps {
  pools: Pool[];
  monthlyTargets?: MonthlyTarget[];
}

// How long a pool may sit IN_PROGRESS or PENDING_INSPECTION at one stage
// before it's flagged as stuck. This is a starting default, not a hard
// config — easy to expose as a per-stage setting later if UMER wants that.
const STUCK_THRESHOLD_HOURS = 24;

export const BottleneckDashboard: React.FC<BottleneckDashboardProps> = ({ pools, monthlyTargets = [] }) => {
  const currentMonthId = new Date().toISOString().slice(0, 7);
  const activeTarget = monthlyTargets.find(t => t.id === currentMonthId) || monthlyTargets[monthlyTargets.length - 1];

  // Date filter applies to Average Cycle Time only — WIP-by-stage and
  // Stuck Pools both describe *current* state, which a historical date
  // range doesn't meaningfully filter (a pool is either stuck right now
  // or it isn't).
  const [dateRange, setDateRange] = useState<DateRange>(getDefaultRange());

  // ── WIP per stage: how many pools currently sit at each stage ──
  const wipByStage = useMemo(() => {
    return STAGES.map((stage, idx) => {
      const poolsHere = pools.filter(p => {
        if (p.completedAt) return false;
        if (isAtDualStageGate(p.currentStageIndex) && DUAL_STAGE_IDS.includes(stage.id)) {
          return p.stageHistory[stage.id]?.status !== 'APPROVED' && p.stageHistory[stage.id]?.status !== 'SKIPPED';
        }
        return p.currentStageIndex === idx;
      });
      return { stage, idx, poolsHere };
    });
  }, [pools]);

  const maxWip = Math.max(...wipByStage.map(s => s.poolsHere.length), 1);

  // ── Average cycle time per stage (minutes, from completed stage history) ──
  const cycleTimeByStage = useMemo(() => {
    return STAGES.map(stage => {
      const durations: number[] = [];
      pools.forEach(pool => {
        const hist = pool.stageHistory[stage.id];
        if (hist?.durationMinutes == null) return;
        if (!inDateRange(hist.endTime, dateRange.startDate, dateRange.endDate)) return;
        durations.push(hist.durationMinutes);
      });
      const avg = durations.length > 0 ? durations.reduce((a, b) => a + b, 0) / durations.length : null;
      return { stageId: stage.id, stageName: stage.name, avgMinutes: avg, sampleSize: durations.length };
    }).filter(s => s.avgMinutes !== null);
  }, [pools, dateRange]);

  // ── Stuck pools: IN_PROGRESS or PENDING_INSPECTION past the threshold ──
  const stuckPools = useMemo(() => {
    const now = Date.now();
    const results: { pool: Pool; stageName: string; hoursStuck: number; status: string }[] = [];
    pools.forEach(pool => {
      if (pool.completedAt) return;
      const stageIdx = pool.currentStageIndex;
      if (stageIdx >= STAGES.length) return;
      const stage = STAGES[stageIdx];
      const hist = pool.stageHistory[stage.id];
      if (!hist) return;
      const referenceTime = hist.status === 'IN_PROGRESS' ? hist.startTime : hist.status === 'PENDING_INSPECTION' ? (hist.endTime || hist.startTime) : null;
      if (!referenceTime) return;
      const hoursStuck = (now - new Date(referenceTime).getTime()) / (1000 * 60 * 60);
      if (hoursStuck >= STUCK_THRESHOLD_HOURS) {
        results.push({ pool, stageName: stage.name, hoursStuck, status: hist.status });
      }
    });
    return results.sort((a, b) => b.hoursStuck - a.hoursStuck);
  }, [pools]);

  return (
    <div className="space-y-6 font-sans">
      {/* WIP board */}
      <div className="bg-white rounded-2xl border border-slate-100 p-4">
        <h3 className="text-xs font-black text-slate-500 uppercase tracking-widest flex items-center gap-1.5 mb-3">
          <Layers className="h-4 w-4 text-indigo-500" />
          Work-in-Progress by Stage
        </h3>
        <div className="space-y-2">
          {wipByStage.map(({ stage, poolsHere }) => (
            <div key={stage.id} className="flex items-center gap-2">
              <span className="text-[11px] font-bold text-slate-600 w-32 shrink-0 truncate">{stage.name}</span>
              <div className="flex-1 h-4 bg-slate-50 rounded-full overflow-hidden">
                <div
                  className="h-full rounded-full bg-indigo-500"
                  style={{ width: `${Math.max((poolsHere.length / maxWip) * 100, poolsHere.length > 0 ? 3 : 0)}%` }}
                />
              </div>
              <span className="text-[11px] font-mono text-slate-500 w-10 text-right shrink-0">{poolsHere.length}</span>
            </div>
          ))}
        </div>
      </div>

      {/* Cycle time vs target */}
      <div className="bg-white rounded-2xl border border-slate-100 p-4">
        <div className="flex flex-wrap items-center justify-between gap-2 mb-3">
          <h3 className="text-xs font-black text-slate-500 uppercase tracking-widest flex items-center gap-1.5">
            <Clock className="h-4 w-4 text-emerald-500" />
            Average Cycle Time by Stage
          </h3>
          <DateRangeFilter value={dateRange} onChange={setDateRange} />
        </div>
        {cycleTimeByStage.length === 0 ? (
          <p className="text-xs text-slate-400 py-4 text-center">Not enough completed stage data yet.</p>
        ) : (
          <div className="divide-y divide-slate-100">
            {cycleTimeByStage.map(s => (
              <div key={s.stageId} className="flex items-center justify-between py-2">
                <span className="text-xs font-bold text-slate-700">{s.stageName}</span>
                <span className="text-[11px] font-mono text-slate-500">
                  {(s.avgMinutes! / 60).toFixed(1)}h avg <span className="text-slate-300">·</span> {s.sampleSize} samples
                </span>
              </div>
            ))}
          </div>
        )}
        {!activeTarget && (
          <p className="text-[10px] text-slate-400 mt-2">No monthly KPI target set for comparison — set one in Planning Department to see target vs. actual.</p>
        )}
      </div>

      {/* Stuck pools — the actual bottleneck alert */}
      <div className="bg-white rounded-2xl border border-slate-100 p-4">
        <h3 className="text-xs font-black text-slate-500 uppercase tracking-widest flex items-center gap-1.5 mb-3">
          <AlertTriangle className="h-4 w-4 text-rose-500" />
          Pools Stuck &gt; {STUCK_THRESHOLD_HOURS}h
        </h3>
        {stuckPools.length === 0 ? (
          <p className="text-xs text-slate-400 py-4 text-center">No pools currently stuck past the threshold.</p>
        ) : (
          <div className="divide-y divide-slate-100">
            {stuckPools.map(({ pool, stageName, hoursStuck, status }) => (
              <div key={pool.id} className="flex items-center justify-between py-2">
                <div>
                  <p className="text-xs font-bold text-slate-700">{pool.poolNo} — {pool.projectName}</p>
                  <p className="text-[10px] text-slate-400">{stageName} · {status.replace(/_/g, ' ')}</p>
                </div>
                <span className={`text-[11px] font-black px-2 py-0.5 rounded-full ${hoursStuck > 48 ? 'bg-rose-50 text-rose-600' : 'bg-amber-50 text-amber-600'}`}>
                  {Math.floor(hoursStuck)}h stuck
                </span>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
};
