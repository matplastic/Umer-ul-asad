import React, { useMemo, useState } from 'react';
import { Boxes, Printer, Download, Filter, X, ClipboardList, CheckCircle2 } from 'lucide-react';
import { Pool, PlannedPool } from '../types';
import { STAGES, getDualGroupForIndex } from '../data/mockData';
import { DateRangeFilter, DateRange } from './DateRangeFilter';
import { exportToExcel, exportTablePdf } from '../lib/exportUtils';

interface ProjectProgressReportProps {
  pools: Pool[];
  plannedPools?: PlannedPool[];
}

type ViewMode = 'wip' | 'completions';

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

/**
 * Project-wise progress matrix for Management Dashboard.
 *
 * Two views, both filterable by Project and by Date (Today/Week/Month/Year
 * presets or a custom range, via the shared DateRangeFilter):
 *
 *  - "Current Status (WIP)": for pools CREATED within the selected date
 *    range, where do they physically sit right now — how many are still in
 *    Planning (not yet released), how many currently sit at each production
 *    stage, and how many are fully completed.
 *
 *  - "Stage Completions (Cumulative)": how many pools had EACH stage
 *    APPROVED within the selected date range (i.e. "how many Steel done,
 *    how many Primer done" for the period), plus how many pools were
 *    released from Planning and how many reached final completion in that
 *    same window. This counts an event each time it happens in the period,
 *    independent of a pool's current stage.
 *
 * Both views can be exported per-project as PDF or Excel, matching the
 * existing StageReportsTab export pattern.
 */
export const ProjectProgressReport: React.FC<ProjectProgressReportProps> = ({ pools, plannedPools = [] }) => {
  const [viewMode, setViewMode] = useState<ViewMode>('wip');
  const [dateRange, setDateRange] = useState<DateRange>(getDefaultRange());
  const [projectFilter, setProjectFilter] = useState<string>('all');
  const [pdfOrientation, setPdfOrientation] = useState<'portrait' | 'landscape'>('landscape');
  const [isExporting, setIsExporting] = useState(false);

  const projectOptions = useMemo(
    () => Array.from(new Set([...pools.map(p => p.projectName), ...plannedPools.map(p => p.projectName)].filter(Boolean))).sort(),
    [pools, plannedPools]
  );

  const activeProjects = useMemo(
    () => (projectFilter === 'all' ? projectOptions : [projectFilter]),
    [projectOptions, projectFilter]
  );

  // ── View: Current Status (WIP) — pools created in range, grouped by
  // where they sit right now. ──────────────────────────────────────────
  const wipRows = useMemo(() => {
    const { startDate, endDate } = dateRange;
    return activeProjects.map(project => {
      const planning = plannedPools.filter(
        p => p.projectName === project && p.status === 'PLANNED' && inDateRange(p.createdAt, startDate, endDate)
      ).length;

      const projectPools = pools.filter(p => p.projectName === project && inDateRange(p.createdAt, startDate, endDate));

      const stageCounts: Record<string, number> = {};
      STAGES.forEach((stage, idx) => {
        stageCounts[stage.id] = projectPools.filter(p => {
          if (p.completedAt) return false;
          const gateGroup = getDualGroupForIndex(p.currentStageIndex);
          if (gateGroup && gateGroup.includes(stage.id)) {
            return p.stageHistory[stage.id]?.status !== 'APPROVED' && p.stageHistory[stage.id]?.status !== 'SKIPPED';
          }
          return p.currentStageIndex === idx;
        }).length;
      });

      const completed = projectPools.filter(p => !!p.completedAt || p.currentStageIndex >= STAGES.length).length;
      const total = planning + projectPools.length;

      return { project, planning, stageCounts, completed, totalInProduction: projectPools.length, total };
    }).filter(row => row.total > 0 || projectFilter !== 'all');
  }, [activeProjects, plannedPools, pools, dateRange, projectFilter]);

  // ── View: Stage Completions (Cumulative) — how many times each stage
  // was APPROVED within the date range, plus releases and final completions. ──
  const completionRows = useMemo(() => {
    const { startDate, endDate } = dateRange;
    return activeProjects.map(project => {
      const released = plannedPools.filter(
        p => p.projectName === project && p.status !== 'PLANNED' && inDateRange(p.createdAt, startDate, endDate)
      ).length;

      const projectPools = pools.filter(p => p.projectName === project);

      const stageCounts: Record<string, number> = {};
      STAGES.forEach(stage => {
        stageCounts[stage.id] = projectPools.filter(p => {
          const h = p.stageHistory[stage.id];
          if (!h || h.status !== 'APPROVED') return false;
          const relevantDate = h.inspectionTime || h.endTime || null;
          return inDateRange(relevantDate, startDate, endDate);
        }).length;
      });

      const finalCompleted = projectPools.filter(
        p => !!p.completedAt && inDateRange(p.completedAt, startDate, endDate)
      ).length;

      const totalEvents = released + Object.values(stageCounts).reduce((a, b) => a + b, 0) + finalCompleted;

      return { project, released, stageCounts, finalCompleted, totalEvents };
    }).filter(row => row.totalEvents > 0 || projectFilter !== 'all');
  }, [activeProjects, plannedPools, pools, dateRange, projectFilter]);

  const grandTotals = useMemo(() => {
    if (viewMode === 'wip') {
      const totals: Record<string, number> = { planning: 0, completed: 0 };
      STAGES.forEach(s => { totals[s.id] = 0; });
      wipRows.forEach(r => {
        totals.planning += r.planning;
        totals.completed += r.completed;
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
      const title = isWip ? 'Project Status Report (Current Stage)' : 'Project Stage Completions Report';
      const filterSummary = [
        `Period: ${dateRange.startDate} to ${dateRange.endDate}`,
        projectFilter !== 'all' ? `Project: ${projectFilter}` : 'All Projects',
        `${rows.length} project(s)`,
      ].join('  •  ');

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
            <ClipboardList className="h-3.5 w-3.5" /> Current Status (WIP)
          </button>
          <button
            onClick={() => setViewMode('completions')}
            data-testid="project-report-view-completions"
            className={`flex items-center gap-1.5 px-3 py-1.5 text-xs font-bold rounded-lg transition-all cursor-pointer ${
              viewMode === 'completions' ? 'bg-emerald-600 text-white' : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
            }`}
          >
            <CheckCircle2 className="h-3.5 w-3.5" /> Stage Completions (Cumulative)
          </button>
        </div>
        <p className="text-[11px] text-slate-400 mt-2">
          {viewMode === 'wip'
            ? 'Pools created within the selected period, grouped by where they currently sit — Planning, each production stage, or Completed.'
            : 'How many pools had each stage approved within the selected period (e.g. how many Steel done, how many Primer done), plus releases from Planning and final completions.'}
        </p>
      </div>

      {/* Filters */}
      <div className="flex flex-col md:flex-row gap-3">
        <DateRangeFilter value={dateRange} onChange={setDateRange} />
      </div>

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
              {viewMode === 'wip' ? (
                <th className="text-center font-bold text-amber-600 uppercase tracking-wider px-3 py-2.5">Planning</th>
              ) : (
                <th className="text-center font-bold text-amber-600 uppercase tracking-wider px-3 py-2.5">Released</th>
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
                <td colSpan={STAGES.length + 3} className="text-center text-slate-400 py-8">
                  No data for the selected period and filters.
                </td>
              </tr>
            )}
            {rows.map((r: any) => (
              <tr key={r.project} className="border-b border-slate-50 hover:bg-slate-50/50">
                <td className="px-3 py-2 font-bold text-slate-700 sticky left-0 bg-white whitespace-nowrap">{r.project}</td>
                <td className="px-3 py-2 text-center font-mono text-amber-700">
                  {viewMode === 'wip' ? r.planning : r.released}
                </td>
                {STAGES.map(s => (
                  <td key={s.id} className="px-3 py-2 text-center font-mono text-slate-600">
                    {r.stageCounts[s.id] || 0}
                  </td>
                ))}
                {viewMode === 'wip' ? (
                  <>
                    <td className="px-3 py-2 text-center font-mono text-emerald-700">{r.completed}</td>
                    <td className="px-3 py-2 text-center font-mono font-bold text-slate-800">{r.total}</td>
                  </>
                ) : (
                  <td className="px-3 py-2 text-center font-mono text-emerald-700">{r.finalCompleted}</td>
                )}
              </tr>
            ))}
          </tbody>
          {rows.length > 0 && (
            <tfoot>
              <tr className="border-t-2 border-slate-200 bg-slate-50/70">
                <td className="px-3 py-2.5 font-black text-slate-700 sticky left-0 bg-slate-50/70">Grand Total</td>
                <td className="px-3 py-2.5 text-center font-mono font-black text-amber-700">
                  {viewMode === 'wip' ? grandTotals.planning : grandTotals.released}
                </td>
                {STAGES.map(s => (
                  <td key={s.id} className="px-3 py-2.5 text-center font-mono font-black text-slate-700">
                    {grandTotals[s.id] || 0}
                  </td>
                ))}
                {viewMode === 'wip' ? (
                  <>
                    <td className="px-3 py-2.5 text-center font-mono font-black text-emerald-700">{grandTotals.completed}</td>
                    <td className="px-3 py-2.5 text-center font-mono font-black text-slate-900">
                      {wipRows.reduce((a, r) => a + r.total, 0)}
                    </td>
                  </>
                ) : (
                  <td className="px-3 py-2.5 text-center font-mono font-black text-emerald-700">{grandTotals.finalCompleted}</td>
                )}
              </tr>
            </tfoot>
          )}
        </table>
      </div>
    </div>
  );
};

export default ProjectProgressReport;
