import React, { useMemo, useState } from 'react';
import { Boxes, Printer, Download, Filter, X, ClipboardList, CheckCircle2, ChevronRight } from 'lucide-react';
import { Pool, PlannedPool, StageId } from '../types';
import { STAGES, getDualGroupForIndex } from '../data/mockData';
import { DateRangeFilter, DateRange } from './DateRangeFilter';
import { exportToExcel, exportTablePdf } from '../lib/exportUtils';

interface ProjectProgressReportProps {
  pools: Pool[];
  plannedPools?: PlannedPool[];
}

type ViewMode = 'wip' | 'completions';

interface DrillDownState {
  project: string;
  columnLabel: string;
  rows: { poolNo: string; date: string; extra?: string }[];
}

function inDateRange(dateStr: string | undefined | null, start: string, end: string): boolean {
  if (!dateStr) return false;
  const d = dateStr.slice(0, 10);
  return d >= start && d <= end;
}

function fmtDate(d?: string | null): string {
  if (!d) return '—';
  const dt = new Date(d);
  return isNaN(dt.getTime()) ? '—' : dt.toLocaleString('en-GB');
}

function getDefaultRange(): DateRange {
  const today = new Date();
  const start = new Date(today.getFullYear(), today.getMonth(), 1);
  return { startDate: start.toISOString().slice(0, 10), endDate: today.toISOString().slice(0, 10) };
}

/**
 * Project-wise progress matrix for Management Dashboard.
 *
 * Two views, both filterable by Project:
 *
 *  - "Current Status (WIP)" — a live SNAPSHOT, not affected by the date
 *    filter: how many pools are still in Planning (never released to
 *    production, regardless of when they were created), how many have been
 *    Released to production, how many currently sit at each production
 *    stage right now, and how many are fully completed. This answers
 *    "project X has 100+ pools planned but only 5 released" correctly,
 *    because Planning/Released/Total are always whole-project totals.
 *
 *  - "Stage Completions (Cumulative)" — DATE-FILTERED (Today/Week/Month/
 *    Year/Custom via the shared DateRangeFilter): how many pools had EACH
 *    stage APPROVED within the selected period (e.g. "how many Steel done,
 *    how many Primer done" for the period), plus how many pools were
 *    released from Planning and how many reached final completion in that
 *    same window.
 *
 * Every stage cell (in both views) is clickable and opens a drill-down list
 * of the exact pool numbers behind that count, each with its relevant date
 * (started/claimed for WIP, approved date for completions).
 *
 * Both views can be exported per-project as PDF or Excel.
 */
export const ProjectProgressReport: React.FC<ProjectProgressReportProps> = ({ pools, plannedPools = [] }) => {
  const [viewMode, setViewMode] = useState<ViewMode>('wip');
  const [dateRange, setDateRange] = useState<DateRange>(getDefaultRange());
  const [projectFilter, setProjectFilter] = useState<string>('all');
  const [pdfOrientation, setPdfOrientation] = useState<'portrait' | 'landscape'>('landscape');
  const [isExporting, setIsExporting] = useState(false);
  const [drillDown, setDrillDown] = useState<DrillDownState | null>(null);

  const projectOptions = useMemo(
    () => Array.from(new Set([...pools.map(p => p.projectName), ...plannedPools.map(p => p.projectName)].filter(Boolean))).sort(),
    [pools, plannedPools]
  );

  const activeProjects = useMemo(
    () => (projectFilter === 'all' ? projectOptions : [projectFilter]),
    [projectOptions, projectFilter]
  );

  // Returns whether a pool currently occupies this STAGES entry for WIP
  // counting, respecting dual-stage (parallel gate) groups the same way
  // BottleneckDashboard does.
  function poolIsAtStage(p: Pool, stage: typeof STAGES[number], idx: number): boolean {
    if (p.completedAt || p.currentStageIndex >= STAGES.length) return false;
    const gateGroup = getDualGroupForIndex(p.currentStageIndex);
    if (gateGroup && gateGroup.includes(stage.id)) {
      return p.stageHistory[stage.id]?.status !== 'APPROVED' && p.stageHistory[stage.id]?.status !== 'SKIPPED';
    }
    return p.currentStageIndex === idx;
  }

  // ── View: Current Status (WIP) — a live snapshot, NOT date-filtered.
  // "Planning" and "Released" are whole-project totals so a project with
  // 100+ planned pools and only 5 released shows both numbers correctly. ──
  const wipRows = useMemo(() => {
    return activeProjects.map(project => {
      const planningPools = plannedPools.filter(p => p.projectName === project && p.status === 'PLANNED');
      const projectPools = pools.filter(p => p.projectName === project);

      const stageCounts: Record<string, number> = {};
      STAGES.forEach((stage, idx) => {
        stageCounts[stage.id] = projectPools.filter(p => poolIsAtStage(p, stage, idx)).length;
      });

      const completedPools = projectPools.filter(p => !!p.completedAt || p.currentStageIndex >= STAGES.length);

      return {
        project,
        planning: planningPools.length,
        planningPools,
        released: projectPools.length,
        stageCounts,
        completed: completedPools.length,
        completedPools,
        total: planningPools.length + projectPools.length,
      };
    }).filter(row => row.total > 0 || projectFilter !== 'all');
  }, [activeProjects, plannedPools, pools, projectFilter]);

  // ── View: Stage Completions (Cumulative) — DATE-FILTERED event counts. ──
  const completionRows = useMemo(() => {
    const { startDate, endDate } = dateRange;
    return activeProjects.map(project => {
      const releasedInRange = plannedPools.filter(
        p => p.projectName === project && p.status !== 'PLANNED' && inDateRange(p.createdAt, startDate, endDate)
      );

      const projectPools = pools.filter(p => p.projectName === project);

      const stageCounts: Record<string, number> = {};
      const stagePools: Record<string, Pool[]> = {};
      STAGES.forEach(stage => {
        const matches = projectPools.filter(p => {
          const h = p.stageHistory[stage.id];
          if (!h || h.status !== 'APPROVED') return false;
          const relevantDate = h.inspectionTime || h.endTime || null;
          return inDateRange(relevantDate, startDate, endDate);
        });
        stageCounts[stage.id] = matches.length;
        stagePools[stage.id] = matches;
      });

      const finalCompletedPools = projectPools.filter(
        p => !!p.completedAt && inDateRange(p.completedAt, startDate, endDate)
      );

      const totalEvents = releasedInRange.length + Object.values(stageCounts).reduce((a, b) => a + b, 0) + finalCompletedPools.length;

      return {
        project,
        released: releasedInRange.length,
        releasedInRange,
        stageCounts,
        stagePools,
        finalCompleted: finalCompletedPools.length,
        finalCompletedPools,
        totalEvents,
      };
    }).filter(row => row.totalEvents > 0 || projectFilter !== 'all');
  }, [activeProjects, plannedPools, pools, dateRange, projectFilter]);

  const grandTotals = useMemo(() => {
    if (viewMode === 'wip') {
      const totals: Record<string, number> = { planning: 0, released: 0, completed: 0, total: 0 };
      STAGES.forEach(s => { totals[s.id] = 0; });
      wipRows.forEach(r => {
        totals.planning += r.planning;
        totals.released += r.released;
        totals.completed += r.completed;
        totals.total += r.total;
        STAGES.forEach(s => { totals[s.id] += r.stageCounts[s.id] || 0; });
      });
      return totals;
    }
    const totals: Record<string, number> = { released: 0, finalCompleted: 0 };
    STAGES.forEach(s => { totals[s.id] = 0; });
    completionRows.forEach(r => {
      totals.released += r.released;
      totals.finalCompleted += r.finalCompleted;
      STAGES.forEach(s => { totals[s.id] += r.stageCounts[s.id] || 0; });
    });
    return totals;
  }, [viewMode, wipRows, completionRows]);

  // ── Drill-down helpers: open a modal listing pool numbers + dates behind a cell. ──
  const openPlanningDrillDown = (row: typeof wipRows[number]) => {
    setDrillDown({
      project: row.project,
      columnLabel: 'Planning (not yet released)',
      rows: row.planningPools.map(p => ({ poolNo: p.poolNo, date: fmtDate(p.createdAt), extra: p.poolType || undefined })),
    });
  };

  const openWipReleasedDrillDown = (row: typeof wipRows[number]) => {
    const releasedPools = pools.filter(p => p.projectName === row.project);
    setDrillDown({
      project: row.project,
      columnLabel: 'Released to Production',
      rows: releasedPools.map(p => ({ poolNo: p.poolNo, date: fmtDate(p.createdAt) })),
    });
  };

  const openWipStageDrillDown = (row: typeof wipRows[number], stageId: StageId, stageName: string) => {
    const stageIdx = STAGES.findIndex(s => s.id === stageId);
    const stage = STAGES[stageIdx];
    const projectPools = pools.filter(p => p.projectName === row.project);
    const matches = projectPools.filter(p => poolIsAtStage(p, stage, stageIdx));
    setDrillDown({
      project: row.project,
      columnLabel: `Currently at ${stageName}`,
      rows: matches.map(p => ({
        poolNo: p.poolNo,
        date: fmtDate(p.stageHistory[stageId]?.startTime),
        extra: (p.stageHistory[stageId]?.status || '').replace(/_/g, ' ') || undefined,
      })),
    });
  };

  const openWipCompletedDrillDown = (row: typeof wipRows[number]) => {
    setDrillDown({
      project: row.project,
      columnLabel: 'Fully Completed',
      rows: row.completedPools.map(p => ({ poolNo: p.poolNo, date: fmtDate(p.completedAt) })),
    });
  };

  const openCompletionsStageDrillDown = (row: typeof completionRows[number], stageId: StageId, stageName: string) => {
    const matches = row.stagePools[stageId] || [];
    setDrillDown({
      project: row.project,
      columnLabel: `${stageName} — Approved in period`,
      rows: matches.map(p => ({
        poolNo: p.poolNo,
        date: fmtDate(p.stageHistory[stageId]?.inspectionTime || p.stageHistory[stageId]?.endTime),
        extra: p.stageHistory[stageId]?.teamName || undefined,
      })),
    });
  };

  const openCompletionsReleasedDrillDown = (row: typeof completionRows[number]) => {
    setDrillDown({
      project: row.project,
      columnLabel: 'Released from Planning — in period',
      rows: row.releasedInRange.map(p => ({ poolNo: p.poolNo, date: fmtDate(p.createdAt) })),
    });
  };

  const openCompletionsFinalDrillDown = (row: typeof completionRows[number]) => {
    setDrillDown({
      project: row.project,
      columnLabel: 'Final Completed — in period',
      rows: row.finalCompletedPools.map(p => ({ poolNo: p.poolNo, date: fmtDate(p.completedAt) })),
    });
  };

  const runExport = async (format: 'pdf' | 'excel') => {
    const isWip = viewMode === 'wip';
    const rows = isWip ? wipRows : completionRows;

    if (rows.length === 0) {
      alert('No records found for the current filters.');
      return;
    }

    setIsExporting(true);
    try {
      const columns = isWip
        ? [
            { header: 'Project', dataKey: 'project' },
            { header: 'Planning', dataKey: 'planning' },
            { header: 'Released', dataKey: 'released' },
            ...STAGES.map(s => ({ header: s.name, dataKey: s.id })),
            { header: 'Completed', dataKey: 'completed' },
            { header: 'Total', dataKey: 'total' },
          ]
        : [
            { header: 'Project', dataKey: 'project' },
            { header: 'Released', dataKey: 'released' },
            ...STAGES.map(s => ({ header: s.name, dataKey: s.id })),
            { header: 'Final Completed', dataKey: 'finalCompleted' },
          ];

      const flatRows = rows.map((r: any) => {
        const obj: Record<string, any> = { project: r.project };
        if (isWip) {
          obj.planning = r.planning;
          obj.released = r.released;
          STAGES.forEach(s => { obj[s.id] = r.stageCounts[s.id] || 0; });
          obj.completed = r.completed;
          obj.total = r.total;
        } else {
          obj.released = r.released;
          STAGES.forEach(s => { obj[s.id] = r.stageCounts[s.id] || 0; });
          obj.finalCompleted = r.finalCompleted;
        }
        return obj;
      });

      const filenameBase = isWip ? 'Project_Status_WIP_Report' : 'Project_Stage_Completions_Report';
      const title = isWip ? 'Project Status Report (Current Snapshot)' : 'Project Stage Completions Report';
      const filterSummary = isWip
        ? [projectFilter !== 'all' ? `Project: ${projectFilter}` : 'All Projects', `${rows.length} project(s)`, 'Live snapshot — not date-filtered'].join('  •  ')
        : [`Period: ${dateRange.startDate} to ${dateRange.endDate}`, projectFilter !== 'all' ? `Project: ${projectFilter}` : 'All Projects', `${rows.length} project(s)`].join('  •  ');

      if (format === 'excel') {
        exportToExcel(
          flatRows.map(r => {
            const obj: Record<string, any> = {};
            columns.forEach(c => { obj[c.header] = r[c.dataKey] ?? 0; });
            return obj;
          }),
          filenameBase,
          title.slice(0, 31)
        );
      } else {
        await exportTablePdf({
          title,
          subtitle: filterSummary,
          columns,
          rows: flatRows,
          filename: filenameBase,
          orientation: pdfOrientation,
          deptLine: 'Management Dashboard — Project Progress Report',
        });
      }
    } finally {
      setIsExporting(false);
    }
  };

  const rows = viewMode === 'wip' ? wipRows : completionRows;

  return (
    <div className="space-y-5 animate-fadeIn">
      {/* View mode picker */}
      <div className="bg-white border border-slate-100 rounded-2xl p-4 shadow-sm">
        <div className="flex items-center gap-1.5 text-slate-400 text-xs font-bold uppercase tracking-wider mb-2">
          <Boxes className="h-3.5 w-3.5" />
          Report View
        </div>
        <div className="flex gap-1.5 flex-wrap">
          <button
            onClick={() => setViewMode('wip')}
            data-testid="project-report-view-wip"
            className={`flex items-center gap-1.5 px-3 py-1.5 text-xs font-bold rounded-lg transition-all cursor-pointer ${
              viewMode === 'wip' ? 'bg-indigo-600 text-white' : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
            }`}
          >
            <ClipboardList className="h-3.5 w-3.5" /> Current Status (Live Snapshot)
          </button>
          <button
            onClick={() => setViewMode('completions')}
            data-testid="project-report-view-completions"
            className={`flex items-center gap-1.5 px-3 py-1.5 text-xs font-bold rounded-lg transition-all cursor-pointer ${
              viewMode === 'completions' ? 'bg-emerald-600 text-white' : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
            }`}
          >
            <CheckCircle2 className="h-3.5 w-3.5" /> Stage Completions (Cumulative, by date)
          </button>
        </div>
        <p className="text-[11px] text-slate-400 mt-2">
          {viewMode === 'wip'
            ? 'Whole-project totals right now — Planning (not yet released), Released to production, where those released pools currently sit stage-by-stage, and Completed. Not affected by the date filter below.'
            : 'How many pools had each stage approved within the selected period (e.g. how many Steel done, how many Primer done), plus releases from Planning and final completions in that window.'}
        </p>
        <p className="text-[11px] text-indigo-500 mt-1 font-semibold">Click any number in the table to see the exact pool numbers and dates.</p>
      </div>

      {/* Filters */}
      {viewMode === 'completions' && (
        <div className="flex flex-col md:flex-row gap-3">
          <DateRangeFilter value={dateRange} onChange={setDateRange} />
        </div>
      )}

      <div className="bg-white border border-slate-100 rounded-2xl p-4 shadow-sm flex flex-wrap items-center gap-3">
        <div className="flex items-center gap-1.5 text-slate-400 text-xs font-bold uppercase tracking-wider shrink-0">
          <Filter className="h-3.5 w-3.5" />
          Filters
        </div>

        <select
          value={projectFilter}
          onChange={(e) => setProjectFilter(e.target.value)}
          data-testid="project-report-project-filter"
          className="px-2.5 py-1.5 text-xs border border-slate-200 rounded-lg bg-slate-50 focus:outline-none focus:ring-1 focus:ring-indigo-400"
        >
          <option value="all">All Projects</option>
          {projectOptions.map(p => <option key={p} value={p}>{p}</option>)}
        </select>

        <div className="flex items-center gap-1.5 ml-auto">
          <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">PDF Layout</span>
          <div className="flex bg-slate-100 rounded-lg p-0.5">
            <button
              onClick={() => setPdfOrientation('portrait')}
              className={`px-2.5 py-1 text-xs font-bold rounded-md transition-all cursor-pointer ${
                pdfOrientation === 'portrait' ? 'bg-white shadow-sm text-slate-800' : 'text-slate-500'
              }`}
            >
              Portrait
            </button>
            <button
              onClick={() => setPdfOrientation('landscape')}
              className={`px-2.5 py-1 text-xs font-bold rounded-md transition-all cursor-pointer ${
                pdfOrientation === 'landscape' ? 'bg-white shadow-sm text-slate-800' : 'text-slate-500'
              }`}
            >
              Landscape
            </button>
          </div>
        </div>

        {projectFilter !== 'all' && (
          <button
            onClick={() => setProjectFilter('all')}
            className="flex items-center gap-1 text-[11px] font-bold text-slate-400 hover:text-slate-700 cursor-pointer"
          >
            <X className="h-3 w-3" /> Clear filter
          </button>
        )}

        <div className="flex gap-2">
          <button
            onClick={() => runExport('pdf')}
            disabled={isExporting}
            data-testid="project-report-export-pdf"
            className="flex items-center gap-1 bg-rose-50 hover:bg-rose-100 text-rose-700 font-bold py-1.5 px-3 rounded-xl text-xs cursor-pointer transition-all disabled:opacity-50"
          >
            <Printer className="h-3 w-3" /> PDF
          </button>
          <button
            onClick={() => runExport('excel')}
            disabled={isExporting}
            data-testid="project-report-export-excel"
            className="flex items-center gap-1 bg-emerald-50 hover:bg-emerald-100 text-emerald-700 font-bold py-1.5 px-3 rounded-xl text-xs cursor-pointer transition-all disabled:opacity-50"
          >
            <Download className="h-3 w-3" /> Excel
          </button>
        </div>
      </div>

      {/* Matrix table */}
      <div className="bg-white border border-slate-100 rounded-2xl shadow-sm overflow-x-auto">
        <table className="min-w-full text-xs">
          <thead>
            <tr className="border-b border-slate-100">
              <th className="text-left font-bold text-slate-500 uppercase tracking-wider px-3 py-2.5 sticky left-0 bg-white">Project</th>
              <th className="text-center font-bold text-amber-600 uppercase tracking-wider px-3 py-2.5">Planning</th>
              {viewMode === 'wip' && (
                <th className="text-center font-bold text-sky-600 uppercase tracking-wider px-3 py-2.5">Released</th>
              )}
              {viewMode === 'completions' && (
                <th className="text-center font-bold text-sky-600 uppercase tracking-wider px-3 py-2.5">Released (in period)</th>
              )}
              {STAGES.map(s => (
                <th key={s.id} className="text-center font-bold text-slate-500 uppercase tracking-wider px-3 py-2.5 whitespace-nowrap">
                  {s.name}
                </th>
              ))}
              {viewMode === 'wip' ? (
                <>
                  <th className="text-center font-bold text-emerald-600 uppercase tracking-wider px-3 py-2.5">Completed</th>
                  <th className="text-center font-bold text-slate-700 uppercase tracking-wider px-3 py-2.5">Total</th>
                </>
              ) : (
                <th className="text-center font-bold text-emerald-600 uppercase tracking-wider px-3 py-2.5">Final Completed</th>
              )}
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 && (
              <tr>
                <td colSpan={STAGES.length + 4} className="text-center text-slate-400 py-8">
                  No data for the selected filters.
                </td>
              </tr>
            )}
            {viewMode === 'wip' && wipRows.map(r => (
              <tr key={r.project} className="border-b border-slate-50 hover:bg-slate-50/50">
                <td className="px-3 py-2 font-bold text-slate-700 sticky left-0 bg-white whitespace-nowrap">{r.project}</td>
                <td
                  className={`px-3 py-2 text-center font-mono text-amber-700 ${r.planning > 0 ? 'cursor-pointer hover:bg-amber-50 hover:underline font-bold' : ''}`}
                  onClick={() => r.planning > 0 && openPlanningDrillDown(r)}
                >
                  {r.planning}
                </td>
                <td
                  className={`px-3 py-2 text-center font-mono text-sky-700 ${r.released > 0 ? 'cursor-pointer hover:bg-sky-50 hover:underline font-bold' : ''}`}
                  onClick={() => r.released > 0 && openWipReleasedDrillDown(r)}
                >
                  {r.released}
                </td>
                {STAGES.map(s => {
                  const count = r.stageCounts[s.id] || 0;
                  return (
                    <td
                      key={s.id}
                      className={`px-3 py-2 text-center font-mono text-slate-600 ${count > 0 ? 'cursor-pointer hover:bg-indigo-50 hover:underline font-bold' : ''}`}
                      onClick={() => count > 0 && openWipStageDrillDown(r, s.id, s.name)}
                    >
                      {count}
                    </td>
                  );
                })}
                <td
                  className={`px-3 py-2 text-center font-mono text-emerald-700 ${r.completed > 0 ? 'cursor-pointer hover:bg-emerald-50 hover:underline font-bold' : ''}`}
                  onClick={() => r.completed > 0 && openWipCompletedDrillDown(r)}
                >
                  {r.completed}
                </td>
                <td className="px-3 py-2 text-center font-mono font-bold text-slate-800">{r.total}</td>
              </tr>
            ))}
            {viewMode === 'completions' && completionRows.map(r => (
              <tr key={r.project} className="border-b border-slate-50 hover:bg-slate-50/50">
                <td className="px-3 py-2 font-bold text-slate-700 sticky left-0 bg-white whitespace-nowrap">{r.project}</td>
                <td className="px-3 py-2 text-center font-mono text-slate-300">—</td>
                <td
                  className={`px-3 py-2 text-center font-mono text-sky-700 ${r.released > 0 ? 'cursor-pointer hover:bg-sky-50 hover:underline font-bold' : ''}`}
                  onClick={() => r.released > 0 && openCompletionsReleasedDrillDown(r)}
                >
                  {r.released}
                </td>
                {STAGES.map(s => {
                  const count = r.stageCounts[s.id] || 0;
                  return (
                    <td
                      key={s.id}
                      className={`px-3 py-2 text-center font-mono text-slate-600 ${count > 0 ? 'cursor-pointer hover:bg-indigo-50 hover:underline font-bold' : ''}`}
                      onClick={() => count > 0 && openCompletionsStageDrillDown(r, s.id, s.name)}
                    >
                      {count}
                    </td>
                  );
                })}
                <td
                  className={`px-3 py-2 text-center font-mono text-emerald-700 ${r.finalCompleted > 0 ? 'cursor-pointer hover:bg-emerald-50 hover:underline font-bold' : ''}`}
                  onClick={() => r.finalCompleted > 0 && openCompletionsFinalDrillDown(r)}
                >
                  {r.finalCompleted}
                </td>
              </tr>
            ))}
          </tbody>
          {rows.length > 0 && (
            <tfoot>
              <tr className="border-t-2 border-slate-200 bg-slate-50/70">
                <td className="px-3 py-2.5 font-black text-slate-700 sticky left-0 bg-slate-50/70">Grand Total</td>
                <td className="px-3 py-2.5 text-center font-mono font-black text-amber-700">
                  {viewMode === 'wip' ? grandTotals.planning : '—'}
                </td>
                <td className="px-3 py-2.5 text-center font-mono font-black text-sky-700">{grandTotals.released}</td>
                {STAGES.map(s => (
                  <td key={s.id} className="px-3 py-2.5 text-center font-mono font-black text-slate-700">
                    {grandTotals[s.id] || 0}
                  </td>
                ))}
                {viewMode === 'wip' ? (
                  <>
                    <td className="px-3 py-2.5 text-center font-mono font-black text-emerald-700">{grandTotals.completed}</td>
                    <td className="px-3 py-2.5 text-center font-mono font-black text-slate-900">{grandTotals.total}</td>
                  </>
                ) : (
                  <td className="px-3 py-2.5 text-center font-mono font-black text-emerald-700">{grandTotals.finalCompleted}</td>
                )}
              </tr>
            </tfoot>
          )}
        </table>
      </div>

      {/* Drill-down modal — pool numbers + dates behind whichever cell was clicked */}
      {drillDown && (
        <div
          className="fixed inset-0 bg-slate-900/40 backdrop-blur-sm z-50 flex items-center justify-center p-4"
          onClick={() => setDrillDown(null)}
        >
          <div
            className="bg-white rounded-2xl shadow-xl max-w-lg w-full max-h-[80vh] flex flex-col"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-start justify-between p-4 border-b border-slate-100">
              <div>
                <div className="text-[10px] uppercase font-bold text-slate-400 tracking-wider">{drillDown.project}</div>
                <h3 className="font-extrabold text-slate-800 text-sm mt-0.5 flex items-center gap-1">
                  <ChevronRight className="h-4 w-4 text-indigo-500" />
                  {drillDown.columnLabel}
                </h3>
                <p className="text-[11px] text-slate-400 mt-0.5">{drillDown.rows.length} pool(s)</p>
              </div>
              <button
                onClick={() => setDrillDown(null)}
                className="p-1.5 rounded-lg hover:bg-slate-100 text-slate-400 hover:text-slate-700 cursor-pointer"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
            <div className="overflow-y-auto p-2">
              {drillDown.rows.length === 0 ? (
                <p className="text-xs text-slate-400 text-center py-6">No pools found.</p>
              ) : (
                <table className="w-full text-xs">
                  <thead>
                    <tr className="text-[10px] uppercase font-bold text-slate-400 tracking-wider">
                      <th className="text-left px-2 py-1.5">Pool No</th>
                      <th className="text-left px-2 py-1.5">Date</th>
                      <th className="text-left px-2 py-1.5">Note</th>
                    </tr>
                  </thead>
                  <tbody>
                    {drillDown.rows.map((r, i) => (
                      <tr key={i} className="border-t border-slate-50">
                        <td className="px-2 py-1.5 font-bold text-slate-700">{r.poolNo}</td>
                        <td className="px-2 py-1.5 font-mono text-slate-500">{r.date}</td>
                        <td className="px-2 py-1.5 text-slate-400">{r.extra || '—'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default ProjectProgressReport;
