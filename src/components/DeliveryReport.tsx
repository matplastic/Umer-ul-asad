import React, { useMemo, useState } from 'react';
import { PackageCheck, Search, FileDown, FileSpreadsheet } from 'lucide-react';
import { Pool } from '../types';
import { exportToExcel, exportTablePdf } from '../lib/exportUtils';

interface DeliveryReportProps {
  pools: Pool[];
}

type RangeKey = 'today' | 'week' | 'month' | 'all' | 'custom';

// 'Today' as a plain YYYY-MM-DD in UAE time, matching the convention already
// used in DeliveryPlanner.tsx so this report's "today" always agrees with
// the planner's, regardless of the viewing device's own timezone.
function todayInUAE(): string {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Dubai', year: 'numeric', month: '2-digit', day: '2-digit',
  }).formatToParts(new Date());
  const y = parts.find(p => p.type === 'year')!.value;
  const m = parts.find(p => p.type === 'month')!.value;
  const d = parts.find(p => p.type === 'day')!.value;
  return `${y}-${m}-${d}`;
}

// Pool.deliveredAt is a full ISO timestamp — reduce it to the UAE calendar
// day so a pool delivered at 11:40pm UAE time doesn't get bucketed into the
// *next* day just because the stored ISO string rolled over in UTC.
function deliveredDayInUAE(iso: string): string {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Dubai', year: 'numeric', month: '2-digit', day: '2-digit',
  }).formatToParts(new Date(iso));
  const y = parts.find(p => p.type === 'year')!.value;
  const m = parts.find(p => p.type === 'month')!.value;
  const d = parts.find(p => p.type === 'day')!.value;
  return `${y}-${m}-${d}`;
}

function addDaysStr(dateStr: string, days: number): string {
  const [y, m, d] = dateStr.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d + days));
  return dt.toISOString().slice(0, 10);
}

export function DeliveryReport({ pools }: DeliveryReportProps) {
  const [range, setRange] = useState<RangeKey>('month');
  const [customFrom, setCustomFrom] = useState(todayInUAE());
  const [customTo, setCustomTo] = useState(todayInUAE());
  const [projectFilter, setProjectFilter] = useState<string>('ALL');
  const [poolSearch, setPoolSearch] = useState('');

  const delivered = useMemo(
    () => pools.filter(p => p.isDelivered && p.deliveredAt),
    [pools]
  );

  const allProjects = useMemo(
    () => Array.from(new Set(delivered.map(p => p.projectName).filter(Boolean))).sort(),
    [delivered]
  );

  const { from, to } = useMemo(() => {
    const today = todayInUAE();
    if (range === 'today') return { from: today, to: today };
    if (range === 'week') return { from: addDaysStr(today, -6), to: today };
    if (range === 'month') return { from: addDaysStr(today, -29), to: today };
    if (range === 'custom') return { from: customFrom, to: customTo };
    return { from: '0000-01-01', to: '9999-12-31' }; // 'all'
  }, [range, customFrom, customTo]);

  const filtered = useMemo(() => {
    return delivered.filter(p => {
      const day = deliveredDayInUAE(p.deliveredAt!);
      if (day < from || day > to) return false;
      if (projectFilter !== 'ALL' && p.projectName !== projectFilter) return false;
      if (poolSearch.trim()) {
        const q = poolSearch.trim().toLowerCase();
        if (!p.poolNo.toLowerCase().includes(q) && !p.projectName.toLowerCase().includes(q)) return false;
      }
      return true;
    });
  }, [delivered, from, to, projectFilter, poolSearch]);

  // Project-wise x Date-wise matrix: { projectName -> { date -> count } }
  const matrix = useMemo(() => {
    const m: Record<string, Record<string, number>> = {};
    const dateSet = new Set<string>();
    filtered.forEach(p => {
      const day = deliveredDayInUAE(p.deliveredAt!);
      dateSet.add(day);
      if (!m[p.projectName]) m[p.projectName] = {};
      m[p.projectName][day] = (m[p.projectName][day] || 0) + 1;
    });
    const dates = Array.from(dateSet).sort();
    const projects = Object.keys(m).sort();
    return { m, dates, projects };
  }, [filtered]);

  const projectTotals = useMemo(() => {
    return matrix.projects.map(proj => ({
      project: proj,
      total: Object.values(matrix.m[proj]).reduce((a: number, b: number) => a + b, 0),
    })).sort((a, b) => b.total - a.total);
  }, [matrix]);

  const grandTotal = filtered.length;

  // Flat rows (pool-level detail) for export + the per-pool table
  const detailRows = useMemo(() => {
    return filtered
      .slice()
      .sort((a, b) => (b.deliveredAt || '').localeCompare(a.deliveredAt || ''))
      .map(p => ({
        Date: deliveredDayInUAE(p.deliveredAt!),
        Project: p.projectName,
        'Pool No.': p.poolNo,
        'Pool Type': p.poolType || '',
      }));
  }, [filtered]);

  const rangeLabel = range === 'today' ? 'Today'
    : range === 'week' ? 'Last 7 days'
    : range === 'month' ? 'Last 30 days'
    : range === 'all' ? 'All time'
    : `${customFrom} to ${customTo}`;

  const handleExportDetailExcel = () => {
    exportToExcel(
      detailRows.length ? detailRows : [{ Date: '—', Project: '—', 'Pool No.': '—', 'Pool Type': '—' }],
      'delivery_report_detail',
      'Detail'
    );
  };

  const handleExportPdf = () => {
    exportTablePdf({
      title: 'Delivery Report — Project & Date-wise',
      subtitle: `${rangeLabel}${projectFilter !== 'ALL' ? ` — ${projectFilter}` : ''} — Total delivered: ${grandTotal}`,
      columns: [
        { header: 'Date', dataKey: 'Date' },
        { header: 'Project', dataKey: 'Project' },
        { header: 'Pool No.', dataKey: 'Pool No.' },
        { header: 'Pool Type', dataKey: 'Pool Type' },
      ],
      rows: detailRows,
      filename: 'delivery_report',
      orientation: 'portrait',
      deptLine: 'Delivery Report — Management ERP',
    });
  };

  return (
    <div className="space-y-5 animate-fadeIn">
      <div className="bg-white p-5 rounded-2xl border border-slate-100 shadow-sm space-y-4">
        <div className="flex items-center justify-between flex-wrap gap-3">
          <h3 className="text-sm font-bold text-slate-800 flex items-center gap-1.5">
            <PackageCheck className="h-4 w-4 text-blue-500" />
            Delivery Report — Project &amp; Date-wise
          </h3>
          <div className="flex items-center gap-2">
            <button
              onClick={handleExportDetailExcel}
              className="flex items-center gap-1.5 text-[11px] font-bold px-2.5 py-1.5 rounded-lg border border-slate-200 text-slate-600 hover:bg-slate-50"
            >
              <FileSpreadsheet className="h-3.5 w-3.5" /> Export Excel
            </button>
            <button
              onClick={handleExportPdf}
              className="flex items-center gap-1.5 text-[11px] font-bold px-2.5 py-1.5 rounded-lg border border-slate-200 text-slate-600 hover:bg-slate-50"
            >
              <FileDown className="h-3.5 w-3.5" /> PDF
            </button>
          </div>
        </div>

        {/* Filters */}
        <div className="flex flex-wrap items-center gap-2">
          {(['today', 'week', 'month', 'all', 'custom'] as RangeKey[]).map(k => (
            <button
              key={k}
              onClick={() => setRange(k)}
              className={`text-[11px] font-bold px-3 py-1.5 rounded-lg border transition-colors ${
                range === k ? 'bg-slate-900 text-white border-slate-900' : 'border-slate-200 text-slate-500 hover:bg-slate-50'
              }`}
            >
              {k === 'today' ? 'Today' : k === 'week' ? 'This Week' : k === 'month' ? 'This Month' : k === 'all' ? 'All Time' : 'Custom'}
            </button>
          ))}
          {range === 'custom' && (
            <div className="flex items-center gap-1.5">
              <input
                type="date"
                value={customFrom}
                onChange={e => setCustomFrom(e.target.value)}
                className="text-xs border border-slate-200 rounded-lg px-2 py-1.5 font-semibold text-slate-700"
              />
              <span className="text-xs text-slate-400">to</span>
              <input
                type="date"
                value={customTo}
                onChange={e => setCustomTo(e.target.value)}
                className="text-xs border border-slate-200 rounded-lg px-2 py-1.5 font-semibold text-slate-700"
              />
            </div>
          )}

          <select
            value={projectFilter}
            onChange={e => setProjectFilter(e.target.value)}
            className="text-xs border border-slate-200 rounded-lg px-2.5 py-1.5 font-semibold text-slate-700 ml-auto"
          >
            <option value="ALL">All Projects</option>
            {allProjects.map(p => <option key={p} value={p}>{p}</option>)}
          </select>

          <div className="relative">
            <Search className="h-3.5 w-3.5 text-slate-400 absolute left-2.5 top-1/2 -translate-y-1/2" />
            <input
              type="text"
              value={poolSearch}
              onChange={e => setPoolSearch(e.target.value)}
              placeholder="Search pool no..."
              className="text-xs border border-slate-200 rounded-lg pl-7 pr-2.5 py-1.5 font-semibold text-slate-700 w-40"
            />
          </div>
        </div>

        {/* Totals strip */}
        <div className="flex flex-wrap gap-2 pt-1">
          <div className="px-3 py-2 rounded-xl bg-slate-900 text-white">
            <div className="text-[9px] font-bold uppercase tracking-wide text-teal-300">Total Delivered ({rangeLabel})</div>
            <div className="text-lg font-black">{grandTotal}</div>
          </div>
          {projectTotals.map(pt => (
            <div key={pt.project} className="px-3 py-2 rounded-xl bg-slate-50 border border-slate-100">
              <div className="text-[9px] font-bold uppercase tracking-wide text-slate-400 max-w-[140px] truncate">{pt.project}</div>
              <div className="text-lg font-black text-slate-800">{pt.total}</div>
            </div>
          ))}
        </div>
      </div>

      {/* Project x Date matrix */}
      <div className="bg-white p-5 rounded-2xl border border-slate-100 shadow-sm">
        <h4 className="text-xs font-bold text-slate-600 mb-3">Project-wise delivery by date</h4>
        {matrix.dates.length === 0 ? (
          <p className="text-xs text-slate-400 text-center py-10">No deliveries found for this filter.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs border-collapse">
              <thead>
                <tr>
                  <th className="py-2 px-3 sticky left-0 bg-white text-slate-500 uppercase text-[10px] font-bold">Project</th>
                  {matrix.dates.map(d => (
                    <th key={d} className="py-2 px-3 text-center text-slate-500 uppercase text-[10px] font-bold whitespace-nowrap">{d}</th>
                  ))}
                  <th className="py-2 px-3 text-center text-slate-700 uppercase text-[10px] font-black">Total</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {matrix.projects.map(proj => {
                  const total = matrix.dates.reduce((sum, d) => sum + (matrix.m[proj][d] || 0), 0);
                  return (
                    <tr key={proj} className="hover:bg-slate-50/70">
                      <td className="py-2 px-3 font-semibold text-slate-800 sticky left-0 bg-white whitespace-nowrap">{proj}</td>
                      {matrix.dates.map(d => (
                        <td key={d} className="py-2 px-3 text-center font-mono text-slate-600">
                          {matrix.m[proj][d] || '—'}
                        </td>
                      ))}
                      <td className="py-2 px-3 text-center font-black text-slate-900">{total}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Pool-level detail */}
      <div className="bg-white p-5 rounded-2xl border border-slate-100 shadow-sm">
        <h4 className="text-xs font-bold text-slate-600 mb-3">Delivered pools — detail ({detailRows.length})</h4>
        {detailRows.length === 0 ? (
          <p className="text-xs text-slate-400 text-center py-10">No pools match this filter.</p>
        ) : (
          <div className="max-h-[420px] overflow-y-auto">
            <table className="w-full text-left text-xs">
              <thead className="sticky top-0 bg-white">
                <tr className="text-slate-500 uppercase text-[10px] font-bold">
                  <th className="py-2 px-3">Date</th>
                  <th className="py-2 px-3">Project</th>
                  <th className="py-2 px-3">Pool No.</th>
                  <th className="py-2 px-3">Pool Type</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {detailRows.map((r, i) => (
                  <tr key={i} className="hover:bg-slate-50/70">
                    <td className="py-2 px-3 font-mono text-slate-500">{r.Date}</td>
                    <td className="py-2 px-3 font-semibold text-slate-800">{r.Project}</td>
                    <td className="py-2 px-3 font-mono text-slate-600">{r['Pool No.']}</td>
                    <td className="py-2 px-3 text-slate-500">{r['Pool Type']}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
