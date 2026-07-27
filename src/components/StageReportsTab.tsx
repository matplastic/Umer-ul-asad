import React, { useMemo, useState } from 'react';
import { Layers, Printer, Download, Filter, X } from 'lucide-react';
import { Pool, StageId, PoolOrientation } from '../types';
import { STAGES } from '../data/mockData';
import { DateRangeFilter, DateRange } from './DateRangeFilter';
import { exportToExcel, exportTablePdf } from '../lib/exportUtils';

interface StageReportsTabProps {
  pools: Pool[];
}

type StageBucket = 'remaining' | 'completed';

function fmtDate(d?: string | null): string {
  if (!d) return '—';
  const dt = new Date(d);
  return isNaN(dt.getTime()) ? '—' : dt.toLocaleString('en-GB');
}

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
 * Per-stage report exporter for Management Dashboard.
 * For any stage, two independent reports can be generated:
 *  - "Remaining / Unclaimed" — pools whose stageHistory status at this stage
 *    is not APPROVED yet (i.e. still pending regardless of whether a team
 *    has claimed/started it).
 *  - "Completed" — pools whose stageHistory status at this stage is APPROVED.
 * Each can be exported as PDF (via exportTablePdf) or Excel (via exportToExcel),
 * filtered by Project, Pool Type, Date Range (against the stage's relevant
 * date — start/claim date for remaining, end/approval date for completed),
 * and Pool Orientation, with a PDF page-orientation toggle.
 */
export const StageReportsTab: React.FC<StageReportsTabProps> = ({ pools }) => {
  const [selectedStage, setSelectedStage] = useState<StageId>(STAGES[0].id);
  const [dateRange, setDateRange] = useState<DateRange>(getDefaultRange());
  const [projectFilter, setProjectFilter] = useState<string>('all');
  const [typeFilter, setTypeFilter] = useState<string>('all');
  const [orientationFilter, setOrientationFilter] = useState<'all' | PoolOrientation>('all');
  const [pdfOrientation, setPdfOrientation] = useState<'portrait' | 'landscape'>('landscape');
  const [loadingBucket, setLoadingBucket] = useState<StageBucket | null>(null);

  const stageDef = useMemo(() => STAGES.find(s => s.id === selectedStage) || STAGES[0], [selectedStage]);

  const projectOptions = useMemo(
    () => Array.from(new Set(pools.map(p => p.projectName))).sort(),
    [pools]
  );
  const typeOptions = useMemo(
    () => Array.from(new Set(pools.map(p => p.poolType).filter(Boolean))).sort() as string[],
    [pools]
  );

  // Applies the shared Project / Type / Orientation filters (date is
  // bucket-specific, applied separately below).
  const baseFiltered = useMemo(() => {
    return pools.filter(p => {
      if (projectFilter !== 'all' && p.projectName !== projectFilter) return false;
      if (typeFilter !== 'all' && p.poolType !== typeFilter) return false;
      if (orientationFilter !== 'all' && p.orientation !== orientationFilter) return false;
      return true;
    });
  }, [pools, projectFilter, typeFilter, orientationFilter]);

  const { remainingRows, completedRows } = useMemo(() => {
    const remaining: any[] = [];
    const completed: any[] = [];
    const { startDate, endDate } = dateRange;

    baseFiltered.forEach(p => {
      const h = p.stageHistory?.[selectedStage];
      if (!h) return;

      if (h.status === 'APPROVED') {
        // Completed bucket — filter by the stage's inspection/end date.
        const relevantDate = h.inspectionTime || h.endTime || null;
        if (!inDateRange(relevantDate, startDate, endDate)) return;
        completed.push({
          poolNo: p.poolNo,
          projectName: p.projectName,
          poolType: p.poolType || '—',
          orientation: p.orientation,
          team: h.teamName || h.teamId || '—',
          startTime: fmtDate(h.startTime),
          endTime: fmtDate(h.endTime),
          durationMinutes: h.durationMinutes ?? '—',
          inspector: h.inspectorId || '—',
          inspectionTime: fmtDate(h.inspectionTime),
          rejectionCount: h.rejectionCount ?? 0,
        });
      } else {
        // Remaining/unclaimed bucket — pool is at this stage (or hasn't
        // reached it) but this stage is not yet APPROVED. Filtered against
        // pool creation date since there's no completion date yet.
        if (!inDateRange(p.createdAt, startDate, endDate)) return;
        remaining.push({
          poolNo: p.poolNo,
          projectName: p.projectName,
          poolType: p.poolType || '—',
          orientation: p.orientation,
          status: h.status || 'NOT_STARTED',
          team: h.teamName || h.teamId || '— Unclaimed —',
          startTime: h.startTime ? fmtDate(h.startTime) : '— Not started —',
          rejectionCount: h.rejectionCount ?? 0,
          createdAt: fmtDate(p.createdAt),
        });
      }
    });

    return { remainingRows: remaining, completedRows: completed };
  }, [baseFiltered, selectedStage, dateRange]);

  const remainingColumns = [
    { header: 'Pool No', dataKey: 'poolNo' },
    { header: 'Project', dataKey: 'projectName' },
    { header: 'Type', dataKey: 'poolType' },
    { header: 'Orientation', dataKey: 'orientation' },
    { header: 'Status', dataKey: 'status' },
    { header: 'Team', dataKey: 'team' },
    { header: 'Started', dataKey: 'startTime' },
    { header: 'Rejections', dataKey: 'rejectionCount' },
    { header: 'Pool Created', dataKey: 'createdAt' },
  ];

  const completedColumns = [
    { header: 'Pool No', dataKey: 'poolNo' },
    { header: 'Project', dataKey: 'projectName' },
    { header: 'Type', dataKey: 'poolType' },
    { header: 'Orientation', dataKey: 'orientation' },
    { header: 'Team', dataKey: 'team' },
    { header: 'Started', dataKey: 'startTime' },
    { header: 'Ended', dataKey: 'endTime' },
    { header: 'Duration (min)', dataKey: 'durationMinutes' },
    { header: 'Inspector', dataKey: 'inspector' },
    { header: 'Inspected At', dataKey: 'inspectionTime' },
    { header: 'Rejections', dataKey: 'rejectionCount' },
  ];

  const runExport = async (bucket: StageBucket, format: 'pdf' | 'excel') => {
    const rows = bucket === 'remaining' ? remainingRows : completedRows;
    const columns = bucket === 'remaining' ? remainingColumns : completedColumns;
    const bucketLabel = bucket === 'remaining' ? 'Remaining - Unclaimed' : 'Completed';

    if (rows.length === 0) {
      alert(`No records found for "${stageDef.name} — ${bucketLabel}" with the current filters.`);
      return;
    }

    setLoadingBucket(bucket);
    try {
      const filenameBase = `${stageDef.name.replace(/\s+/g, '_')}_${bucketLabel.replace(/\s+/g, '_')}`;
      const filterSummaryParts = [
        `Period: ${dateRange.startDate} to ${dateRange.endDate}`,
        projectFilter !== 'all' ? `Project: ${projectFilter}` : null,
        typeFilter !== 'all' ? `Type: ${typeFilter}` : null,
        orientationFilter !== 'all' ? `Orientation: ${orientationFilter}` : null,
        `${rows.length} record(s)`,
      ].filter(Boolean);

      if (format === 'excel') {
        exportToExcel(rows.map(r => {
          const obj: Record<string, any> = {};
          columns.forEach(c => { obj[c.header] = r[c.dataKey] ?? ''; });
          return obj;
        }), filenameBase, `${stageDef.name} ${bucketLabel}`.slice(0, 31));
      } else {
        await exportTablePdf({
          title: `${stageDef.name} — ${bucketLabel}`,
          subtitle: filterSummaryParts.join('  •  '),
          columns,
          rows,
          filename: filenameBase,
          orientation: pdfOrientation,
          deptLine: 'Production Stage Report — ERP System',
        });
      }
    } finally {
      setLoadingBucket(null);
    }
  };

  return (
    <div className="space-y-5 animate-fadeIn">
      {/* Stage picker */}
      <div className="bg-white border border-slate-100 rounded-2xl p-4 shadow-sm">
        <div className="flex items-center gap-1.5 text-slate-400 text-xs font-bold uppercase tracking-wider mb-2">
          <Layers className="h-3.5 w-3.5" />
          Stage
        </div>
        <div className="flex gap-1.5 flex-wrap">
          {STAGES.map(s => (
            <button
              key={s.id}
              onClick={() => setSelectedStage(s.id)}
              data-testid={`stage-report-select-${s.id}`}
              className={`px-3 py-1.5 text-xs font-bold rounded-lg transition-all cursor-pointer ${
                selectedStage === s.id ? 'text-white' : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
              }`}
              style={selectedStage === s.id ? { backgroundColor: s.color } : undefined}
            >
              {s.name}
            </button>
          ))}
        </div>
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
          data-testid="stage-report-project-filter"
          className="px-2.5 py-1.5 text-xs border border-slate-200 rounded-lg bg-slate-50 focus:outline-none focus:ring-1 focus:ring-indigo-400"
        >
          <option value="all">All Projects</option>
          {projectOptions.map(p => <option key={p} value={p}>{p}</option>)}
        </select>

        <select
          value={typeFilter}
          onChange={(e) => setTypeFilter(e.target.value)}
          data-testid="stage-report-type-filter"
          className="px-2.5 py-1.5 text-xs border border-slate-200 rounded-lg bg-slate-50 focus:outline-none focus:ring-1 focus:ring-indigo-400"
        >
          <option value="all">All Types</option>
          {typeOptions.map(t => <option key={t} value={t}>{t}</option>)}
        </select>

        <select
          value={orientationFilter}
          onChange={(e) => setOrientationFilter(e.target.value as 'all' | PoolOrientation)}
          data-testid="stage-report-orientation-filter"
          className="px-2.5 py-1.5 text-xs border border-slate-200 rounded-lg bg-slate-50 focus:outline-none focus:ring-1 focus:ring-indigo-400"
        >
          <option value="all">All Orientations</option>
          <option value="Normal">Normal</option>
          <option value="Mirror">Mirror</option>
        </select>

        <div className="flex items-center gap-1.5 ml-auto">
          <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">PDF Layout</span>
          <div className="flex bg-slate-100 rounded-lg p-0.5">
            <button
              onClick={() => setPdfOrientation('portrait')}
              data-testid="stage-report-pdf-portrait"
              className={`px-2.5 py-1 text-xs font-bold rounded-md transition-all cursor-pointer ${
                pdfOrientation === 'portrait' ? 'bg-white shadow-sm text-slate-800' : 'text-slate-500'
              }`}
            >
              Portrait
            </button>
            <button
              onClick={() => setPdfOrientation('landscape')}
              data-testid="stage-report-pdf-landscape"
              className={`px-2.5 py-1 text-xs font-bold rounded-md transition-all cursor-pointer ${
                pdfOrientation === 'landscape' ? 'bg-white shadow-sm text-slate-800' : 'text-slate-500'
              }`}
            >
              Landscape
            </button>
          </div>
        </div>

        {(projectFilter !== 'all' || typeFilter !== 'all' || orientationFilter !== 'all') && (
          <button
            onClick={() => { setProjectFilter('all'); setTypeFilter('all'); setOrientationFilter('all'); }}
            className="flex items-center gap-1 text-[11px] font-bold text-slate-400 hover:text-slate-700 cursor-pointer"
          >
            <X className="h-3 w-3" /> Clear filters
          </button>
        )}
      </div>

      {/* Two report cards: Remaining/Unclaimed + Completed */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div className="bg-white border border-slate-100 rounded-2xl p-5 shadow-sm">
          <div className="flex items-start justify-between mb-2">
            <div className="bg-amber-50 text-amber-700 rounded-xl p-2.5">
              <Layers className="h-4 w-4" />
            </div>
            <span className="text-[10px] font-mono bg-slate-100 text-slate-600 px-2 py-1 rounded">
              {remainingRows.length.toLocaleString()} rows
            </span>
          </div>
          <div className="text-[10px] uppercase font-bold text-slate-400 tracking-wider">{stageDef.name}</div>
          <h3 className="font-extrabold text-slate-800 text-sm mt-0.5">Remaining / Unclaimed Pools</h3>
          <p className="text-xs text-slate-400 mt-1">
            Pools at this stage not yet marked APPROVED — whether claimed by a team or still unclaimed.
          </p>
          <div className="mt-3 flex gap-2">
            <button
              onClick={() => runExport('remaining', 'pdf')}
              disabled={loadingBucket === 'remaining'}
              data-testid="stage-report-remaining-pdf"
              className="flex-1 bg-rose-50 hover:bg-rose-100 text-rose-700 font-bold py-2 rounded-xl text-xs cursor-pointer transition-all flex items-center justify-center gap-1 disabled:opacity-50"
            >
              <Printer className="h-3 w-3" /> PDF
            </button>
            <button
              onClick={() => runExport('remaining', 'excel')}
              disabled={loadingBucket === 'remaining'}
              data-testid="stage-report-remaining-excel"
              className="flex-1 bg-emerald-50 hover:bg-emerald-100 text-emerald-700 font-bold py-2 rounded-xl text-xs cursor-pointer transition-all flex items-center justify-center gap-1 disabled:opacity-50"
            >
              <Download className="h-3 w-3" /> Excel
            </button>
          </div>
        </div>

        <div className="bg-white border border-slate-100 rounded-2xl p-5 shadow-sm">
          <div className="flex items-start justify-between mb-2">
            <div className="bg-emerald-50 text-emerald-700 rounded-xl p-2.5">
              <Layers className="h-4 w-4" />
            </div>
            <span className="text-[10px] font-mono bg-slate-100 text-slate-600 px-2 py-1 rounded">
              {completedRows.length.toLocaleString()} rows
            </span>
          </div>
          <div className="text-[10px] uppercase font-bold text-slate-400 tracking-wider">{stageDef.name}</div>
          <h3 className="font-extrabold text-slate-800 text-sm mt-0.5">Completed Pools</h3>
          <p className="text-xs text-slate-400 mt-1">
            Pools that have been APPROVED at this stage, with team, timing, and inspector details.
          </p>
          <div className="mt-3 flex gap-2">
            <button
              onClick={() => runExport('completed', 'pdf')}
              disabled={loadingBucket === 'completed'}
              data-testid="stage-report-completed-pdf"
              className="flex-1 bg-rose-50 hover:bg-rose-100 text-rose-700 font-bold py-2 rounded-xl text-xs cursor-pointer transition-all flex items-center justify-center gap-1 disabled:opacity-50"
            >
              <Printer className="h-3 w-3" /> PDF
            </button>
            <button
              onClick={() => runExport('completed', 'excel')}
              disabled={loadingBucket === 'completed'}
              data-testid="stage-report-completed-excel"
              className="flex-1 bg-emerald-50 hover:bg-emerald-100 text-emerald-700 font-bold py-2 rounded-xl text-xs cursor-pointer transition-all flex items-center justify-center gap-1 disabled:opacity-50"
            >
              <Download className="h-3 w-3" /> Excel
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};

export default StageReportsTab;
