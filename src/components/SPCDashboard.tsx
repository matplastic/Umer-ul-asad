import React, { useMemo, useState } from 'react';
import { Pool, StageId } from '../types';
import { STAGES } from '../data/mockData';
import { QCDefect } from './QCDefectPanel';
import { TrendingUp, AlertTriangle, Clock3 } from 'lucide-react';
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

interface SPCDashboardProps {
  pools: Pool[];
  qcDefects: QCDefect[];
}

// All of this is computed from data the app already collects (StageHistory
// rejectionCount, QCDefect records) — no new write path, no new Firestore
// collection. If a future feature adds numeric checklist measurements, a
// proper X-bar/R control chart can slot in here using the same layout.
export const SPCDashboard: React.FC<SPCDashboardProps> = ({ pools, qcDefects }) => {
  const [dateRange, setDateRange] = useState<DateRange>(getDefaultRange());

  // ── Rejection rate per stage ──
  const rejectionByStage = useMemo(() => {
    return STAGES.map((stage) => {
      let totalInspections = 0;
      let totalRejections = 0;
      pools.forEach((pool) => {
        const hist = pool.stageHistory[stage.id];
        if (!hist) return;
        if (!inDateRange(hist.inspectionTime, dateRange.startDate, dateRange.endDate)) return;
        if (hist.status === 'APPROVED' || hist.status === 'REJECTED' || (hist.rejectionCount ?? 0) > 0) {
          totalInspections += 1 + (hist.rejectionCount || 0);
          totalRejections += hist.rejectionCount || 0;
        }
      });
      const rate = totalInspections > 0 ? (totalRejections / totalInspections) * 100 : 0;
      return { stageId: stage.id, stageName: stage.name, totalInspections, totalRejections, rate };
    }).filter(s => s.totalInspections > 0)
      .sort((a, b) => b.rate - a.rate);
  }, [pools, dateRange]);

  // ── Defect Pareto (by type, across all logged defects in range) ──
  const defectPareto = useMemo(() => {
    const counts: Record<string, number> = {};
    const inRange = qcDefects.filter(d => inDateRange(d.loggedAt, dateRange.startDate, dateRange.endDate));
    inRange.forEach(d => {
      counts[d.defectType] = (counts[d.defectType] || 0) + 1;
    });
    const total = inRange.length || 1;
    return Object.entries(counts)
      .map(([type, count]) => ({ type, count, pct: (count / total) * 100 }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 8);
  }, [qcDefects, dateRange]);

  // ── Open NCR aging (days since logged, still not closed, logged within range) ──
  const openNcrAging = useMemo(() => {
    const now = Date.now();
    return qcDefects
      .filter(d => d.status !== 'closed' && d.status !== 'rejected')
      .filter(d => inDateRange(d.loggedAt, dateRange.startDate, dateRange.endDate))
      .map(d => ({
        ...d,
        daysOpen: Math.floor((now - new Date(d.loggedAt).getTime()) / (1000 * 60 * 60 * 24)),
      }))
      .sort((a, b) => b.daysOpen - a.daysOpen)
      .slice(0, 10);
  }, [qcDefects, dateRange]);

  const maxRate = Math.max(...rejectionByStage.map(s => s.rate), 1);
  const maxCount = Math.max(...defectPareto.map(d => d.count), 1);

  return (
    <div className="space-y-6 font-sans">
      <div className="flex justify-end">
        <DateRangeFilter value={dateRange} onChange={setDateRange} />
      </div>

      {/* Rejection rate by stage */}
      <div className="bg-white rounded-2xl border border-slate-100 p-4">
        <h3 className="text-xs font-black text-slate-500 uppercase tracking-widest flex items-center gap-1.5 mb-3">
          <TrendingUp className="h-4 w-4 text-indigo-500" />
          Rejection Rate by Stage
        </h3>
        {rejectionByStage.length === 0 ? (
          <p className="text-xs text-slate-400 py-4 text-center">No inspection data yet.</p>
        ) : (
          <div className="space-y-2">
            {rejectionByStage.map(s => (
              <div key={s.stageId} className="flex items-center gap-2">
                <span className="text-[11px] font-bold text-slate-600 w-32 shrink-0 truncate">{s.stageName}</span>
                <div className="flex-1 h-4 bg-slate-50 rounded-full overflow-hidden">
                  <div
                    className={`h-full rounded-full ${s.rate > 15 ? 'bg-rose-500' : s.rate > 5 ? 'bg-amber-500' : 'bg-emerald-500'}`}
                    style={{ width: `${Math.max((s.rate / maxRate) * 100, 3)}%` }}
                  />
                </div>
                <span className="text-[11px] font-mono text-slate-500 w-14 text-right shrink-0">{s.rate.toFixed(1)}%</span>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Defect Pareto */}
      <div className="bg-white rounded-2xl border border-slate-100 p-4">
        <h3 className="text-xs font-black text-slate-500 uppercase tracking-widest flex items-center gap-1.5 mb-3">
          <AlertTriangle className="h-4 w-4 text-amber-500" />
          Top Defect Types
        </h3>
        {defectPareto.length === 0 ? (
          <p className="text-xs text-slate-400 py-4 text-center">No defects logged yet.</p>
        ) : (
          <div className="space-y-2">
            {defectPareto.map(d => (
              <div key={d.type} className="flex items-center gap-2">
                <span className="text-[11px] font-bold text-slate-600 w-40 shrink-0 truncate">{d.type}</span>
                <div className="flex-1 h-4 bg-slate-50 rounded-full overflow-hidden">
                  <div className="h-full rounded-full bg-amber-500" style={{ width: `${Math.max((d.count / maxCount) * 100, 3)}%` }} />
                </div>
                <span className="text-[11px] font-mono text-slate-500 w-16 text-right shrink-0">{d.count} ({d.pct.toFixed(0)}%)</span>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Open NCR aging */}
      <div className="bg-white rounded-2xl border border-slate-100 p-4">
        <h3 className="text-xs font-black text-slate-500 uppercase tracking-widest flex items-center gap-1.5 mb-3">
          <Clock3 className="h-4 w-4 text-rose-500" />
          Open NCRs — Oldest First
        </h3>
        {openNcrAging.length === 0 ? (
          <p className="text-xs text-slate-400 py-4 text-center">No open NCRs — clean sheet.</p>
        ) : (
          <div className="divide-y divide-slate-100">
            {openNcrAging.map(d => (
              <div key={d.id} className="flex items-center justify-between py-2">
                <div>
                  <p className="text-xs font-bold text-slate-700">{d.defectType} — {d.poolNo}</p>
                  <p className="text-[10px] text-slate-400">{d.stageName} · logged by {d.loggedBy}</p>
                </div>
                <span className={`text-[11px] font-black px-2 py-0.5 rounded-full ${d.daysOpen > 7 ? 'bg-rose-50 text-rose-600' : 'bg-amber-50 text-amber-600'}`}>
                  {d.daysOpen}d open
                </span>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
};
