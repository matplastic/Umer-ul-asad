import React, { useMemo, useState } from 'react';
import { CalendarClock, Search, X, Truck, AlertTriangle, CheckCircle2, Printer, Download, Trash2 } from 'lucide-react';
import { Pool } from '../types';
import { STAGES } from '../data/mockData';
import { exportToExcel, exportTablePdf } from '../lib/exportUtils';

interface DeliveryPlannerProps {
  pools: Pool[];
  onUpdatePool?: (poolId: string, updates: Partial<Pool>) => void;
}

function currentStageLabel(pool: Pool): string {
  if (pool.isDelivered) return 'Delivered';
  if (pool.completedAt || pool.currentStageIndex >= STAGES.length) return 'Completed (awaiting delivery)';
  const stage = STAGES[pool.currentStageIndex];
  return stage ? stage.name : 'Unknown';
}

// Days remaining until the scheduled date, counting today as day 0.
// Negative = overdue.
function daysRemaining(dateStr: string): number {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const target = new Date(dateStr + 'T00:00:00');
  const msPerDay = 24 * 60 * 60 * 1000;
  return Math.round((target.getTime() - today.getTime()) / msPerDay);
}

function urgencyStyle(days: number, isDelivered?: boolean): { badge: string; label: string } {
  if (isDelivered) return { badge: 'bg-emerald-50 text-emerald-700 border-emerald-200', label: 'Delivered' };
  if (days < 0) return { badge: 'bg-rose-50 text-rose-700 border-rose-200', label: `${Math.abs(days)}d OVERDUE` };
  if (days === 0) return { badge: 'bg-rose-50 text-rose-700 border-rose-200', label: 'Due today' };
  if (days <= 3) return { badge: 'bg-amber-50 text-amber-700 border-amber-200', label: `${days}d left` };
  return { badge: 'bg-slate-100 text-slate-600 border-slate-200', label: `${days}d left` };
}

/**
 * Delivery Planner — lets management commit a target delivery date to any
 * pool, then reports it against that pool's live current production stage
 * so "what's due on the 12th, and where's each of those pools right now"
 * is a single screen instead of cross-referencing two tabs.
 *
 * Left: pick a pool (search by pool no. / project) and set/clear its date.
 * Right: every pool that currently has a scheduled date, grouped by date,
 * each row showing current stage + days remaining. Filterable by project
 * and exportable (PDF/Excel) for handing to a driver or client.
 */
export const DeliveryPlanner: React.FC<DeliveryPlannerProps> = ({ pools, onUpdatePool }) => {
  const [pickerQuery, setPickerQuery] = useState('');
  const [selectedPoolId, setSelectedPoolId] = useState<string | null>(null);
  const [dateInput, setDateInput] = useState('');
  const [notesInput, setNotesInput] = useState('');
  const [saveMsg, setSaveMsg] = useState<string | null>(null);

  const [projectFilter, setProjectFilter] = useState<string>('all');
  const [reportSearch, setReportSearch] = useState('');

  const selectedPool = useMemo(() => pools.find(p => p.id === selectedPoolId) || null, [pools, selectedPoolId]);

  const pickerMatches = useMemo(() => {
    const q = pickerQuery.trim().toLowerCase();
    const undelivered = pools.filter(p => !p.isDelivered);
    if (!q) return undelivered.slice(0, 40);
    return undelivered.filter(p =>
      p.poolNo.toLowerCase().includes(q) || p.projectName.toLowerCase().includes(q)
    ).slice(0, 40);
  }, [pools, pickerQuery]);

  const loadPool = (pool: Pool) => {
    setSelectedPoolId(pool.id);
    setDateInput(pool.scheduledDeliveryDate ? pool.scheduledDeliveryDate.slice(0, 10) : '');
    setNotesInput(pool.deliveryPlanNotes || '');
    setSaveMsg(null);
  };

  const handleSaveDate = () => {
    if (!selectedPool || !onUpdatePool) return;
    if (!dateInput) {
      setSaveMsg('Pick a date first.');
      return;
    }
    onUpdatePool(selectedPool.id, { scheduledDeliveryDate: dateInput, deliveryPlanNotes: notesInput || null });
    setSaveMsg('Delivery date saved.');
  };

  const handleClearDate = () => {
    if (!selectedPool || !onUpdatePool) return;
    onUpdatePool(selectedPool.id, { scheduledDeliveryDate: null, deliveryPlanNotes: null });
    setDateInput('');
    setNotesInput('');
    setSaveMsg('Delivery date cleared.');
  };

  const projectOptions = useMemo(
    () => Array.from(new Set(pools.filter(p => p.scheduledDeliveryDate).map(p => p.projectName))).sort(),
    [pools]
  );

  const scheduledPools = useMemo(() => {
    const q = reportSearch.trim().toLowerCase();
    return pools
      .filter(p => !!p.scheduledDeliveryDate)
      .filter(p => projectFilter === 'all' || p.projectName === projectFilter)
      .filter(p => !q || p.poolNo.toLowerCase().includes(q) || p.projectName.toLowerCase().includes(q))
      .sort((a, b) => (a.scheduledDeliveryDate! < b.scheduledDeliveryDate! ? -1 : a.scheduledDeliveryDate! > b.scheduledDeliveryDate! ? 1 : 0));
  }, [pools, projectFilter, reportSearch]);

  // Group by date so "22 pools due on the 12th" reads as one block with a count.
  const groupedByDate = useMemo(() => {
    const groups: { date: string; pools: Pool[] }[] = [];
    scheduledPools.forEach(p => {
      const d = p.scheduledDeliveryDate!.slice(0, 10);
      let g = groups.find(x => x.date === d);
      if (!g) { g = { date: d, pools: [] }; groups.push(g); }
      g.pools.push(p);
    });
    return groups;
  }, [scheduledPools]);

  const exportRows = () =>
    scheduledPools.map(p => ({
      'Pool No': p.poolNo,
      'Project': p.projectName,
      'Current Stage': currentStageLabel(p),
      'Delivery Date': p.scheduledDeliveryDate,
      'Days Remaining': p.isDelivered ? 'Delivered' : daysRemaining(p.scheduledDeliveryDate!.slice(0, 10)),
      'Notes': p.deliveryPlanNotes || '',
    }));

  return (
    <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 animate-fadeIn">

      {/* Left: assign / update a pool's scheduled delivery date */}
      <div className="lg:col-span-4 bg-white p-5 rounded-2xl border border-slate-100 shadow-sm space-y-3">
        <h3 className="text-sm font-bold text-slate-800 flex items-center gap-1.5">
          <CalendarClock className="h-4 w-4 text-blue-500" />
          Schedule a Delivery
        </h3>
        <p className="text-xs text-slate-400">
          Pick a pool and set the date you're committing to deliver it by. It'll show up in the report on the right against its live production stage.
        </p>

        <div className="relative">
          <Search className="h-3.5 w-3.5 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
          <input
            type="text"
            value={pickerQuery}
            onChange={(e) => setPickerQuery(e.target.value)}
            placeholder="Search by pool no. or project name..."
            className="w-full text-xs border border-slate-200 rounded-xl pl-8 pr-3 py-2 font-semibold text-slate-700 focus:outline-none focus:ring-1 focus:ring-slate-400"
          />
        </div>

        <div className="space-y-1.5 max-h-64 overflow-y-auto pr-1">
          {pickerMatches.length === 0 ? (
            <p className="text-xs text-slate-400 text-center py-6">No undelivered pools match your search.</p>
          ) : (
            pickerMatches.map(pool => {
              const isSelected = selectedPoolId === pool.id;
              return (
                <button
                  key={pool.id}
                  onClick={() => loadPool(pool)}
                  className={`w-full text-left p-2.5 rounded-xl border cursor-pointer flex items-center justify-between gap-2 transition-colors ${
                    isSelected ? 'border-slate-900 bg-slate-900 text-white' : 'border-slate-100 hover:bg-slate-50'
                  }`}
                >
                  <span className="flex items-center gap-1.5 min-w-0">
                    <span className={`font-mono font-black text-[10px] px-1.5 py-0.5 rounded shrink-0 ${
                      isSelected ? 'bg-slate-800 text-teal-400' : 'bg-slate-100 text-slate-500'
                    }`}>
                      {pool.poolNo}
                    </span>
                    <span className="text-xs font-semibold truncate">{pool.projectName}</span>
                  </span>
                  {pool.scheduledDeliveryDate && (
                    <span className={`text-[9px] font-bold px-1.5 py-0.5 rounded shrink-0 ${isSelected ? 'bg-slate-700 text-teal-300' : 'bg-blue-50 text-blue-700'}`}>
                      {pool.scheduledDeliveryDate.slice(0, 10)}
                    </span>
                  )}
                </button>
              );
            })
          )}
        </div>

        {selectedPool && (
          <div className="pt-3 border-t border-slate-100 space-y-2">
            <div className="text-xs">
              <span className="font-bold text-slate-700">{selectedPool.poolNo}</span>
              <span className="text-slate-400"> — {selectedPool.projectName}</span>
              <div className="text-[10px] text-slate-400 mt-0.5">Currently at: <strong className="text-slate-600">{currentStageLabel(selectedPool)}</strong></div>
            </div>

            <label className="text-xs font-bold text-slate-500 block">Scheduled delivery date</label>
            <input
              type="date"
              value={dateInput}
              onChange={(e) => setDateInput(e.target.value)}
              className="w-full text-xs border border-slate-200 rounded-xl px-3 py-2 font-semibold text-slate-700 focus:outline-none focus:ring-1 focus:ring-slate-400"
            />

            <label className="text-xs font-bold text-slate-500 block">Notes (optional)</label>
            <input
              type="text"
              value={notesInput}
              onChange={(e) => setNotesInput(e.target.value)}
              placeholder="e.g. client requested morning slot"
              className="w-full text-xs border border-slate-200 rounded-xl px-3 py-2 font-semibold text-slate-700 focus:outline-none focus:ring-1 focus:ring-slate-400"
            />

            <div className="flex gap-2 pt-1">
              <button
                onClick={handleSaveDate}
                disabled={!onUpdatePool}
                className="flex-1 flex items-center justify-center gap-1.5 bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white text-xs font-bold py-2.5 rounded-xl cursor-pointer transition-colors"
              >
                <Truck className="h-3.5 w-3.5" />
                Save Date
              </button>
              {selectedPool.scheduledDeliveryDate && (
                <button
                  onClick={handleClearDate}
                  disabled={!onUpdatePool}
                  title="Clear scheduled date"
                  className="flex items-center justify-center gap-1 bg-white border border-rose-200 hover:bg-rose-50 disabled:opacity-50 text-rose-600 text-xs font-bold px-3 py-2.5 rounded-xl cursor-pointer transition-colors"
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </button>
              )}
            </div>
            {saveMsg && <p className="text-[10.5px] font-bold text-emerald-600">{saveMsg}</p>}
            {!onUpdatePool && (
              <span className="text-[10px] font-bold text-rose-500 block">Save is not wired up yet — ask your developer to connect onUpdatePool.</span>
            )}
          </div>
        )}
      </div>

      {/* Right: report — every pool with a scheduled date, grouped by date */}
      <div className="lg:col-span-8 bg-white p-5 rounded-2xl border border-slate-100 shadow-sm space-y-3">
        <div className="flex items-center justify-between flex-wrap gap-2">
          <h3 className="text-sm font-bold text-slate-800 flex items-center gap-1.5">
            <CalendarClock className="h-4 w-4 text-blue-500" />
            Delivery Schedule Report
          </h3>
          <div className="flex items-center gap-1.5">
            <button
              onClick={() => exportTablePdf({
                title: 'Delivery Schedule Report',
                subtitle: projectFilter === 'all' ? 'All Projects' : projectFilter,
                columns: [
                  { header: 'Pool No', dataKey: 'poolNo' },
                  { header: 'Project', dataKey: 'project' },
                  { header: 'Current Stage', dataKey: 'stage' },
                  { header: 'Delivery Date', dataKey: 'date' },
                  { header: 'Days Remaining', dataKey: 'days' },
                  { header: 'Notes', dataKey: 'notes' },
                ],
                rows: scheduledPools.map(p => ({
                  poolNo: p.poolNo,
                  project: p.projectName,
                  stage: currentStageLabel(p),
                  date: p.scheduledDeliveryDate,
                  days: p.isDelivered ? 'Delivered' : daysRemaining(p.scheduledDeliveryDate!.slice(0, 10)),
                  notes: p.deliveryPlanNotes || '',
                })),
                filename: 'delivery_schedule_report',
                orientation: 'landscape',
                deptLine: 'Delivery Planning',
              })}
              className="flex items-center gap-1 text-[10.5px] font-bold px-2.5 py-1.5 rounded-lg border border-slate-200 hover:bg-slate-50 cursor-pointer"
            >
              <Printer className="h-3.5 w-3.5" /> PDF
            </button>
            <button
              onClick={() => exportToExcel(exportRows(), 'delivery_schedule_report', 'Delivery Schedule')}
              className="flex items-center gap-1 text-[10.5px] font-bold px-2.5 py-1.5 rounded-lg border border-slate-200 hover:bg-slate-50 cursor-pointer"
            >
              <Download className="h-3.5 w-3.5" /> Excel
            </button>
          </div>
        </div>

        <div className="flex items-center gap-2 flex-wrap">
          <div className="relative flex-1 min-w-[180px]">
            <Search className="h-3.5 w-3.5 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
            <input
              type="text"
              value={reportSearch}
              onChange={(e) => setReportSearch(e.target.value)}
              placeholder="Search pool no. or project..."
              className="w-full text-xs border border-slate-200 rounded-xl pl-8 pr-3 py-2 font-semibold text-slate-700 focus:outline-none focus:ring-1 focus:ring-slate-400"
            />
          </div>
          <select
            value={projectFilter}
            onChange={(e) => setProjectFilter(e.target.value)}
            className="text-xs border border-slate-200 rounded-xl px-3 py-2 font-semibold text-slate-700 focus:outline-none focus:ring-1 focus:ring-slate-400"
          >
            <option value="all">All Projects</option>
            {projectOptions.map(p => <option key={p} value={p}>{p}</option>)}
          </select>
        </div>

        <div id="delivery-planner-report" className="space-y-4 max-h-[640px] overflow-y-auto pr-1">
          {groupedByDate.length === 0 ? (
            <p className="text-xs text-slate-400 py-10 text-center">No pools have a scheduled delivery date yet — set one on the left.</p>
          ) : (
            groupedByDate.map(group => {
              const dt = new Date(group.date + 'T00:00:00');
              const dayLabel = isNaN(dt.getTime()) ? group.date : dt.toLocaleDateString('en-GB', { weekday: 'short', day: '2-digit', month: 'short', year: 'numeric' });
              const overdueCount = group.pools.filter(p => !p.isDelivered && daysRemaining(group.date) < 0).length;
              return (
                <div key={group.date} className="border border-slate-100 rounded-xl overflow-hidden">
                  <div className="flex items-center justify-between px-3.5 py-2 bg-slate-50 border-b border-slate-100">
                    <span className="text-xs font-black text-slate-700">{dayLabel}</span>
                    <span className="flex items-center gap-2">
                      {overdueCount > 0 && (
                        <span className="flex items-center gap-1 text-[10px] font-bold text-rose-600">
                          <AlertTriangle className="h-3 w-3" /> {overdueCount} overdue
                        </span>
                      )}
                      <span className="text-[10.5px] font-bold text-slate-500 bg-white border border-slate-200 rounded-full px-2 py-0.5">
                        {group.pools.length} pool{group.pools.length !== 1 ? 's' : ''}
                      </span>
                    </span>
                  </div>
                  <div className="divide-y divide-slate-50">
                    {group.pools.map(pool => {
                      const days = daysRemaining(group.date);
                      const style = urgencyStyle(days, pool.isDelivered);
                      return (
                        <div key={pool.id} className="flex items-center justify-between gap-3 px-3.5 py-2.5 text-xs">
                          <div className="min-w-0 flex items-center gap-2">
                            <span className="font-mono font-black text-[10px] px-1.5 py-0.5 bg-slate-100 text-slate-600 rounded shrink-0">
                              {pool.poolNo}
                            </span>
                            <span className="font-semibold text-slate-800 truncate">{pool.projectName}</span>
                          </div>
                          <div className="flex items-center gap-2 shrink-0">
                            <span className="text-[10.5px] text-slate-500 hidden md:inline">{currentStageLabel(pool)}</span>
                            {pool.isDelivered && <CheckCircle2 className="h-3.5 w-3.5 text-emerald-500" />}
                            <span className={`text-[10px] font-bold px-2 py-0.5 rounded border ${style.badge}`}>
                              {style.label}
                            </span>
                            <button
                              onClick={() => loadPool(pool)}
                              className="text-[10px] font-bold text-blue-600 hover:underline cursor-pointer"
                            >
                              Edit
                            </button>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              );
            })
          )}
        </div>
      </div>
    </div>
  );
};
