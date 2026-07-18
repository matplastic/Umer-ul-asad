import React, { useMemo, useState } from 'react';
import { ActivityLog } from '../types';
import { QCDefect, WORKSHOP_DEFECT_CATALOG, WORKSHOP_TITLES } from './QCDefectPanel';
import {
  ClipboardList, Calendar, Building2, Printer, CheckCircle2, AlertTriangle,
} from 'lucide-react';
import { exportDailyDefectReportPdf } from '../lib/exportUtils';

// The 6 workshops that have a printed paper form.
const WORKSHOP_ORDER = ['steel_fabrication', 'steel_primer', 'cladding', 'lamination', 'plumbing', 'mosaic'];

interface DailyDefectReportProps {
  logs: ActivityLog[];
  qcDefects: QCDefect[];
}

/**
 * Fully automatic Daily Defect Report — no manual data entry.
 * Production count and pool numbers come from ActivityLog ('APPROVED' events
 * at the selected stage/date). Defects come from QCDefect entries logged by
 * inspectors (via QCDefectPanel) at that same stage/date — so whatever an
 * inspector ticks while reviewing a pool shows up here automatically, exactly
 * like the paper "Quality Control Report" sheet, but with a single shift
 * (matches the shop floor's actual one-shift operation).
 */
export const DailyDefectReport: React.FC<DailyDefectReportProps> = ({ logs, qcDefects }) => {
  const [stageId, setStageId] = useState(WORKSHOP_ORDER[0]);
  const [date, setDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [projectFilter, setProjectFilter] = useState<string>('all');

  const catalog = WORKSHOP_DEFECT_CATALOG[stageId] || [];
  const workshopTitle = WORKSHOP_TITLES[stageId] || stageId;

  // All pools APPROVED at this stage, on this date (dedup by poolId in case
  // of duplicate log entries).
  const approvedToday = useMemo(() => {
    const seen = new Map<string, { poolId: string; poolNo: string; projectName: string }>();
    logs
      .filter(l => l.stageId === stageId && l.type === 'APPROVED' && l.timestamp?.slice(0, 10) === date)
      .forEach(l => { if (!seen.has(l.poolId)) seen.set(l.poolId, { poolId: l.poolId, poolNo: l.poolNo, projectName: l.projectName }); });
    return Array.from(seen.values());
  }, [logs, stageId, date]);

  const projectsToday = useMemo(
    () => Array.from(new Set(approvedToday.map(p => p.projectName))).sort(),
    [approvedToday]
  );

  const filteredPools = projectFilter === 'all' ? approvedToday : approvedToday.filter(p => p.projectName === projectFilter);

  // Defects logged (via QCDefectPanel) at this stage, on this date.
  const defectsToday = useMemo(() => {
    return qcDefects.filter(d => d.stageId === stageId && d.loggedAt?.slice(0, 10) === date
      && (projectFilter === 'all' || d.projectName === projectFilter));
  }, [qcDefects, stageId, date, projectFilter]);

  // Group by defect type -> pool numbers affected.
  const defectSummary = useMemo(() => {
    const map: Record<string, Set<string>> = {};
    defectsToday.forEach(d => {
      if (!map[d.defectType]) map[d.defectType] = new Set();
      map[d.defectType].add(d.poolNo);
    });
    return Object.entries(map)
      .map(([defect, poolSet]) => ({ defect, poolNos: Array.from(poolSet) }))
      .sort((a, b) => b.poolNos.length - a.poolNos.length);
  }, [defectsToday]);

  // Per-pool defect list, so every produced pool shows OK or its defects —
  // matches the paper sheet's "Description (Pool number)" column, just
  // without the shift split.
  const perPoolRows = useMemo(() => {
    return filteredPools.map(p => ({
      ...p,
      defects: defectsToday.filter(d => d.poolNo === p.poolNo).map(d => d.defectType),
    }));
  }, [filteredPools, defectsToday]);

  const handlePdf = () => {
    exportDailyDefectReportPdf({
      workshopName: workshopTitle,
      date,
      projectName: projectFilter === 'all' ? 'All Projects' : projectFilter,
      controller: 'QC Department',
      totalProduction: filteredPools.length,
      pools: perPoolRows.map(p => ({ poolNo: p.poolNo, defects: p.defects })),
    });
  };

  return (
    <div className="space-y-6">
      <div className="bg-white rounded-2xl border border-slate-100 shadow-sm p-5 space-y-5">
        <div className="flex items-center justify-between flex-wrap gap-3">
          <div className="flex items-center gap-2">
            <ClipboardList className="h-5 w-5 text-emerald-500" />
            <h3 className="text-sm font-black text-slate-800 uppercase tracking-wider">Daily Defect Report — Auto-Generated</h3>
          </div>
          <button
            type="button"
            onClick={handlePdf}
            className="flex items-center gap-2 px-4 py-2 bg-slate-800 hover:bg-slate-900 text-white text-xs font-black rounded-xl cursor-pointer transition-colors"
          >
            <Printer className="h-4 w-4" /> Download PDF
          </button>
        </div>
        <p className="text-[11px] text-slate-400 -mt-3">
          This report builds itself from what's already been recorded — every pool approved at a stage and every defect logged on the Inspection Queue tab shows up here automatically. Nothing to type in by hand.
        </p>

        {/* Workshop tabs */}
        <div className="flex flex-wrap gap-1.5">
          {WORKSHOP_ORDER.map(id => (
            <button
              key={id}
              type="button"
              onClick={() => { setStageId(id); setProjectFilter('all'); }}
              className={`text-[11px] font-bold px-3 py-1.5 rounded-lg border transition-colors cursor-pointer ${
                stageId === id
                  ? 'bg-slate-900 text-white border-slate-900'
                  : 'bg-white text-slate-600 border-slate-200 hover:bg-slate-50'
              }`}
            >
              {WORKSHOP_TITLES[id]}
            </button>
          ))}
        </div>

        {/* Date + project filter */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 max-w-lg">
          <div>
            <label className="text-[10px] font-black text-slate-500 uppercase tracking-wider block mb-1 flex items-center gap-1">
              <Calendar className="h-3 w-3" /> Date
            </label>
            <input
              type="date"
              value={date}
              onChange={e => setDate(e.target.value)}
              className="w-full bg-white border border-slate-200 text-xs text-slate-800 font-medium px-3 py-2 rounded-lg focus:outline-none focus:ring-1 focus:ring-emerald-400"
            />
          </div>
          <div>
            <label className="text-[10px] font-black text-slate-500 uppercase tracking-wider block mb-1 flex items-center gap-1">
              <Building2 className="h-3 w-3" /> Project
            </label>
            <select
              value={projectFilter}
              onChange={e => setProjectFilter(e.target.value)}
              className="w-full bg-white border border-slate-200 text-xs text-slate-800 font-bold px-3 py-2 rounded-lg cursor-pointer focus:outline-none"
            >
              <option value="all">All Projects ({approvedToday.length} pools)</option>
              {projectsToday.map(p => (
                <option key={p} value={p}>{p}</option>
              ))}
            </select>
          </div>
        </div>

        {/* Production summary */}
        <div className="flex items-center gap-4 bg-slate-50 border border-slate-100 rounded-xl px-4 py-3">
          <div>
            <p className="text-[10px] font-black text-slate-400 uppercase tracking-wider">{workshopTitle}</p>
            <p className="text-2xl font-black text-slate-800">{filteredPools.length} <span className="text-xs font-bold text-slate-400">pools produced</span></p>
          </div>
          <div className="h-10 w-px bg-slate-200" />
          <div>
            <p className="text-[10px] font-black text-slate-400 uppercase tracking-wider">Defects logged</p>
            <p className="text-2xl font-black text-rose-600">{defectsToday.length}</p>
          </div>
        </div>

        {/* Defect summary */}
        {defectSummary.length > 0 ? (
          <div className="space-y-1.5">
            <p className="text-[10px] font-black text-slate-500 uppercase tracking-wider">Defect Summary</p>
            <div className="flex flex-wrap gap-1.5">
              {defectSummary.map(({ defect, poolNos }) => (
                <span key={defect} className="text-[11px] font-bold text-rose-700 bg-rose-50 border border-rose-200 px-2.5 py-1 rounded-lg">
                  {defect}: {poolNos.length} pool{poolNos.length > 1 ? 's' : ''} ({poolNos.join(', ')})
                </span>
              ))}
            </div>
          </div>
        ) : filteredPools.length > 0 ? (
          <div className="flex items-center gap-2 text-xs font-bold text-emerald-600 bg-emerald-50 border border-emerald-100 rounded-xl px-3 py-2">
            <CheckCircle2 className="h-4 w-4" /> No defects logged for this workshop on this date — clean run.
          </div>
        ) : (
          <div className="flex items-center gap-2 text-xs font-bold text-slate-500 bg-slate-50 border border-slate-100 rounded-xl px-3 py-2">
            <AlertTriangle className="h-4 w-4" /> No pools were approved at {workshopTitle} on {date} yet.
          </div>
        )}

        {/* Per-pool breakdown */}
        {perPoolRows.length > 0 && (
          <div className="border border-slate-100 rounded-xl overflow-hidden">
            <div className="px-3 py-2 bg-slate-50 border-b border-slate-100 text-[10px] font-black text-slate-500 uppercase tracking-wider">
              Description (Pool Number)
            </div>
            <div className="divide-y divide-slate-100 max-h-80 overflow-y-auto">
              {perPoolRows.map(p => (
                <div key={p.poolId} className="px-3 py-2 flex flex-wrap items-center gap-2">
                  <span className="text-xs font-black text-slate-800 w-24 shrink-0">{p.poolNo}</span>
                  <span className="text-[10px] text-slate-400 w-32 shrink-0 truncate">{p.projectName}</span>
                  {p.defects.length === 0 ? (
                    <span className="text-[10px] font-bold text-emerald-600">OK</span>
                  ) : (
                    p.defects.map((d, i) => (
                      <span key={i} className="text-[10px] font-bold text-rose-700 bg-rose-50 border border-rose-200 px-1.5 py-0.5 rounded">{d}</span>
                    ))
                  )}
                </div>
              ))}
            </div>
          </div>
        )}

        {catalog.length === 0 && (
          <p className="text-[10px] text-amber-600 font-bold">No defect catalogue configured for this workshop yet.</p>
        )}
      </div>
    </div>
  );
};
