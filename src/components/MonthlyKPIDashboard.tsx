import React, { useState, useMemo } from 'react';
import { Pool, PlannedPool } from '../types';
import { STAGES } from '../data/mockData';
import {
  BarChart2, TrendingUp, Calendar, Layers, CheckCircle,
  Truck, GitCompare, ChevronLeft, ChevronRight, Filter
} from 'lucide-react';

interface MonthlyKPIDashboardProps {
  pools: Pool[];
  plannedPools: PlannedPool[];
}

// ── Helpers ────────────────────────────────────────────────────────────────────

const getMonthKey = (iso: string | null | undefined): string => {
  if (!iso) return '';
  try {
    const d = new Date(iso);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
  } catch { return ''; }
};

const fmtMonth = (key: string) => {
  if (!key) return '';
  const [y, m] = key.split('-');
  return new Date(Number(y), Number(m) - 1).toLocaleString('en-GB', { month: 'long', year: 'numeric' });
};

const ALL_MONTHS_FROM_POOLS = (pools: Pool[], planned: PlannedPool[]) => {
  const set = new Set<string>();
  pools.forEach(p => { const m = getMonthKey(p.createdAt); if (m) set.add(m); });
  planned.forEach(p => { const m = getMonthKey(p.createdAt); if (m) set.add(m); });
  return Array.from(set).sort().reverse();
};

// ── Stat Card ──────────────────────────────────────────────────────────────────

const KpiCard = ({ label, value, sub, icon, color }: {
  label: string; value: string | number; sub?: string; icon: React.ReactNode; color: string;
}) => (
  <div className={`bg-white rounded-xl border border-slate-200 p-4 shadow-sm flex items-center gap-4`}>
    <div className={`p-3 rounded-xl ${color}`}>{icon}</div>
    <div>
      <p className="text-xs text-slate-500 font-semibold uppercase tracking-wider">{label}</p>
      <p className="text-2xl font-black text-slate-800 font-mono">{value}</p>
      {sub && <p className="text-xs text-slate-400 mt-0.5">{sub}</p>}
    </div>
  </div>
);

// ── Mini bar ───────────────────────────────────────────────────────────────────

const Bar = ({ value, max, color }: { value: number; max: number; color: string }) => (
  <div className="h-2 bg-slate-100 rounded-full overflow-hidden flex-1">
    <div className={`h-full rounded-full ${color}`} style={{ width: max > 0 ? `${Math.min(100, (value / max) * 100)}%` : '0%' }} />
  </div>
);

// ── Main Component ─────────────────────────────────────────────────────────────

export const MonthlyKPIDashboard: React.FC<MonthlyKPIDashboardProps> = ({ pools, plannedPools }) => {
  const allMonths = useMemo(() => ALL_MONTHS_FROM_POOLS(pools, plannedPools), [pools, plannedPools]);
  const [selectedMonth, setSelectedMonth] = useState<string>(() => allMonths[0] || getMonthKey(new Date().toISOString()));
  const [filterProject, setFilterProject] = useState('ALL');
  const [filterOrientation, setFilterOrientation] = useState<'ALL' | 'Normal' | 'Mirror'>('ALL');

  // All unique projects across pools + planned
  const allProjects = useMemo(() => {
    const s = new Set<string>();
    pools.forEach(p => s.add(p.projectName));
    plannedPools.forEach(p => s.add(p.projectName));
    return ['ALL', ...Array.from(s).sort()];
  }, [pools, plannedPools]);

  // Pools registered in selected month (by createdAt)
  const monthPools = useMemo(() => pools.filter(p => {
    const match = getMonthKey(p.createdAt) === selectedMonth;
    const proj = filterProject === 'ALL' || p.projectName === filterProject;
    const orient = filterOrientation === 'ALL' || p.orientation === filterOrientation;
    return match && proj && orient;
  }), [pools, selectedMonth, filterProject, filterOrientation]);

  const monthPlanned = useMemo(() => plannedPools.filter(p => {
    const match = getMonthKey(p.createdAt) === selectedMonth;
    const proj = filterProject === 'ALL' || p.projectName === filterProject;
    const orient = filterOrientation === 'ALL' || p.orientation === filterOrientation;
    return match && proj && orient;
  }), [plannedPools, selectedMonth, filterProject, filterOrientation]);

  // KPIs
  const totalRegistered = monthPools.length;
  const totalCompleted = monthPools.filter(p => p.currentStageIndex >= STAGES.length).length;
  const totalDelivered = monthPools.filter(p => (p as any).isDelivered || (p as any).deliveredAt).length;
  const totalActive = monthPools.filter(p => p.currentStageIndex < STAGES.length).length;
  const normalCount = monthPools.filter(p => p.orientation === 'Normal').length;
  const mirrorCount = monthPools.filter(p => p.orientation === 'Mirror').length;
  const plannedCount = monthPlanned.length;
  const plannedReleased = monthPlanned.filter(p => p.status === 'RELEASED' || p.status === 'COMPLETED').length;

  // Per-stage breakdown
  const stageBreakdown = useMemo(() => STAGES.map((s, idx) => {
    const inStage = monthPools.filter(p => p.currentStageIndex === idx).length;
    const completed = monthPools.filter(p => {
      const hist = p.stageHistory[s.id as keyof typeof p.stageHistory];
      return hist && (hist as any).status === 'APPROVED';
    }).length;
    const rejected = monthPools.reduce((sum, p) => {
      const hist = p.stageHistory[s.id as keyof typeof p.stageHistory];
      return sum + ((hist as any)?.rejectionCount || 0);
    }, 0);
    return { name: s.name, inStage, completed, rejected };
  }), [monthPools]);

  // Per-project breakdown
  const projectBreakdown = useMemo(() => {
    const map: Record<string, { normal: number; mirror: number; completed: number; active: number }> = {};
    monthPools.forEach(p => {
      if (!map[p.projectName]) map[p.projectName] = { normal: 0, mirror: 0, completed: 0, active: 0 };
      if (p.orientation === 'Normal') map[p.projectName].normal++;
      else map[p.projectName].mirror++;
      if (p.currentStageIndex >= STAGES.length) map[p.projectName].completed++;
      else map[p.projectName].active++;
    });
    return Object.entries(map).sort((a, b) => (b[1].normal + b[1].mirror) - (a[1].normal + a[1].mirror));
  }, [monthPools]);

  // Month navigation
  const currentMonthIdx = allMonths.indexOf(selectedMonth);
  const canPrev = currentMonthIdx < allMonths.length - 1;
  const canNext = currentMonthIdx > 0;

  // All-months trend for mini chart
  const trend = useMemo(() => allMonths.slice().reverse().map(m => {
    const mp = pools.filter(p => getMonthKey(p.createdAt) === m);
    return {
      month: m,
      label: fmtMonth(m).split(' ')[0].slice(0, 3) + ' ' + m.split('-')[0].slice(2),
      registered: mp.length,
      completed: mp.filter(p => p.currentStageIndex >= STAGES.length).length,
      normal: mp.filter(p => p.orientation === 'Normal').length,
      mirror: mp.filter(p => p.orientation === 'Mirror').length,
    };
  }), [pools, allMonths]);

  const maxTrend = Math.max(...trend.map(t => t.registered), 1);

  return (
    <div className="space-y-6">

      {/* Header */}
      <div className="bg-white rounded-2xl border border-slate-200 p-5 shadow-sm">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <div className="p-2.5 bg-indigo-100 rounded-xl">
              <BarChart2 className="h-6 w-6 text-indigo-700" />
            </div>
            <div>
              <h2 className="text-lg font-black text-slate-800">Monthly KPI Dashboard</h2>
              <p className="text-xs text-slate-500">Production output by month, project, orientation & stage</p>
            </div>
          </div>

          {/* Month Navigator */}
          <div className="flex items-center gap-2">
            <button
              onClick={() => setSelectedMonth(allMonths[currentMonthIdx + 1])}
              disabled={!canPrev}
              className="p-1.5 rounded-lg border border-slate-200 text-slate-400 hover:text-slate-700 hover:bg-slate-50 disabled:opacity-30 transition-colors"
            ><ChevronLeft className="h-4 w-4" /></button>
            <select
              value={selectedMonth}
              onChange={e => setSelectedMonth(e.target.value)}
              className="border border-slate-200 rounded-lg px-3 py-1.5 text-sm font-bold text-slate-700 focus:outline-none focus:ring-2 focus:ring-indigo-500 bg-white"
            >
              {allMonths.map(m => <option key={m} value={m}>{fmtMonth(m)}</option>)}
            </select>
            <button
              onClick={() => setSelectedMonth(allMonths[currentMonthIdx - 1])}
              disabled={!canNext}
              className="p-1.5 rounded-lg border border-slate-200 text-slate-400 hover:text-slate-700 hover:bg-slate-50 disabled:opacity-30 transition-colors"
            ><ChevronRight className="h-4 w-4" /></button>
          </div>
        </div>

        {/* Filters */}
        <div className="flex flex-wrap gap-2 mt-4 pt-4 border-t border-slate-100">
          <div className="flex items-center gap-1.5 text-xs text-slate-500 font-semibold">
            <Filter className="h-3.5 w-3.5" /> Filter:
          </div>
          <select
            value={filterProject}
            onChange={e => setFilterProject(e.target.value)}
            className="text-xs border border-slate-200 rounded-lg px-2.5 py-1.5 bg-white focus:outline-none focus:ring-2 focus:ring-indigo-400 font-medium"
          >
            {allProjects.map(p => <option key={p}>{p}</option>)}
          </select>
          {(['ALL', 'Normal', 'Mirror'] as const).map(o => (
            <button
              key={o}
              onClick={() => setFilterOrientation(o)}
              className={`text-xs font-bold px-3 py-1.5 rounded-full border transition-colors ${
                filterOrientation === o
                  ? o === 'Mirror' ? 'bg-purple-600 text-white border-purple-600'
                    : o === 'Normal' ? 'bg-blue-600 text-white border-blue-600'
                    : 'bg-indigo-600 text-white border-indigo-600'
                  : 'bg-white text-slate-600 border-slate-200 hover:border-indigo-400'
              }`}
            >{o}</button>
          ))}
        </div>
      </div>

      {/* KPI Cards */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <KpiCard label="Registered" value={totalRegistered} sub={`${plannedCount} planned`} icon={<Layers className="h-5 w-5 text-indigo-600" />} color="bg-indigo-50" />
        <KpiCard label="Active" value={totalActive} sub="In fabrication" icon={<TrendingUp className="h-5 w-5 text-amber-600" />} color="bg-amber-50" />
        <KpiCard label="Completed" value={totalCompleted} sub={`${totalRegistered > 0 ? Math.round((totalCompleted / totalRegistered) * 100) : 0}% completion`} icon={<CheckCircle className="h-5 w-5 text-emerald-600" />} color="bg-emerald-50" />
        <KpiCard label="Delivered" value={totalDelivered} sub={`${plannedReleased} plans released`} icon={<Truck className="h-5 w-5 text-blue-600" />} color="bg-blue-50" />
      </div>

      {/* Orientation Split */}
      <div className="bg-white rounded-xl border border-slate-200 p-5 shadow-sm">
        <div className="flex items-center gap-2 mb-4">
          <GitCompare className="h-4 w-4 text-slate-500" />
          <h3 className="text-sm font-black text-slate-700 uppercase tracking-wider">Normal vs Mirror Split</h3>
          <span className="ml-auto text-xs text-slate-400">{fmtMonth(selectedMonth)}</span>
        </div>
        <div className="grid grid-cols-2 gap-6">
          <div>
            <div className="flex justify-between text-sm mb-2">
              <span className="font-bold text-blue-700">Normal</span>
              <span className="font-black text-slate-800">{normalCount} <span className="text-slate-400 font-normal text-xs">({totalRegistered > 0 ? Math.round((normalCount / totalRegistered) * 100) : 0}%)</span></span>
            </div>
            <div className="h-4 bg-slate-100 rounded-full overflow-hidden">
              <div className="h-full bg-blue-500 rounded-full transition-all" style={{ width: totalRegistered > 0 ? `${(normalCount / totalRegistered) * 100}%` : '0%' }} />
            </div>
          </div>
          <div>
            <div className="flex justify-between text-sm mb-2">
              <span className="font-bold text-purple-700">Mirror</span>
              <span className="font-black text-slate-800">{mirrorCount} <span className="text-slate-400 font-normal text-xs">({totalRegistered > 0 ? Math.round((mirrorCount / totalRegistered) * 100) : 0}%)</span></span>
            </div>
            <div className="h-4 bg-slate-100 rounded-full overflow-hidden">
              <div className="h-full bg-purple-500 rounded-full transition-all" style={{ width: totalRegistered > 0 ? `${(mirrorCount / totalRegistered) * 100}%` : '0%' }} />
            </div>
          </div>
        </div>
      </div>

      {/* Two column: Project Breakdown + Stage Breakdown */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">

        {/* Project Breakdown */}
        <div className="bg-white rounded-xl border border-slate-200 p-5 shadow-sm">
          <h3 className="text-sm font-black text-slate-700 uppercase tracking-wider mb-4">By Project</h3>
          {projectBreakdown.length === 0 ? (
            <p className="text-slate-400 text-sm py-6 text-center">No pools registered this month</p>
          ) : (
            <div className="space-y-3">
              {projectBreakdown.map(([proj, stat]) => {
                const total = stat.normal + stat.mirror;
                return (
                  <div key={proj} className="space-y-1">
                    <div className="flex items-center justify-between text-xs">
                      <span className="font-semibold text-slate-700 truncate max-w-[180px]">{proj}</span>
                      <div className="flex gap-2 shrink-0">
                        <span className="bg-blue-50 text-blue-700 font-bold px-1.5 py-0.5 rounded text-[10px]">N:{stat.normal}</span>
                        <span className="bg-purple-50 text-purple-700 font-bold px-1.5 py-0.5 rounded text-[10px]">M:{stat.mirror}</span>
                        <span className="bg-emerald-50 text-emerald-700 font-bold px-1.5 py-0.5 rounded text-[10px]">✓{stat.completed}</span>
                      </div>
                    </div>
                    <div className="flex gap-1 items-center">
                      <Bar value={stat.normal} max={total} color="bg-blue-400" />
                      <Bar value={stat.mirror} max={total} color="bg-purple-400" />
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* Stage Breakdown */}
        <div className="bg-white rounded-xl border border-slate-200 p-5 shadow-sm">
          <h3 className="text-sm font-black text-slate-700 uppercase tracking-wider mb-4">By Stage</h3>
          <div className="space-y-2.5">
            {stageBreakdown.map(s => (
              <div key={s.name} className="flex items-center gap-3 text-xs">
                <span className="text-slate-600 font-medium w-28 shrink-0 truncate">{s.name}</span>
                <div className="flex-1 h-2 bg-slate-100 rounded-full overflow-hidden">
                  <div
                    className="h-full bg-indigo-500 rounded-full"
                    style={{ width: totalRegistered > 0 ? `${Math.min(100, (s.completed / totalRegistered) * 100)}%` : '0%' }}
                  />
                </div>
                <div className="flex gap-2 shrink-0">
                  <span className="text-amber-600 font-bold">{s.inStage} active</span>
                  <span className="text-emerald-600 font-bold">{s.completed} done</span>
                  {s.rejected > 0 && <span className="text-rose-600 font-bold">{s.rejected} rej</span>}
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Monthly Trend Chart */}
      {trend.length > 1 && (
        <div className="bg-white rounded-xl border border-slate-200 p-5 shadow-sm">
          <h3 className="text-sm font-black text-slate-700 uppercase tracking-wider mb-4 flex items-center gap-2">
            <Calendar className="h-4 w-4 text-indigo-500" />
            Month-on-Month Trend
          </h3>
          <div className="flex items-end gap-2 h-32 overflow-x-auto pb-2">
            {trend.map(t => (
              <div key={t.month} className="flex flex-col items-center gap-1 shrink-0 min-w-[44px]">
                <div className="flex flex-col items-center justify-end h-24 gap-0.5 w-8">
                  {/* Normal bar */}
                  <div
                    className={`w-full rounded-t transition-all ${t.month === selectedMonth ? 'bg-blue-600' : 'bg-blue-300'}`}
                    style={{ height: `${(t.normal / maxTrend) * 80}px` }}
                    title={`Normal: ${t.normal}`}
                  />
                  {/* Mirror bar stacked */}
                  <div
                    className={`w-full rounded-t transition-all ${t.month === selectedMonth ? 'bg-purple-600' : 'bg-purple-300'}`}
                    style={{ height: `${(t.mirror / maxTrend) * 80}px` }}
                    title={`Mirror: ${t.mirror}`}
                  />
                </div>
                <span className={`text-[9px] font-bold ${t.month === selectedMonth ? 'text-indigo-700' : 'text-slate-400'}`}>{t.label}</span>
                <span className="text-[9px] text-slate-500 font-mono">{t.registered}</span>
              </div>
            ))}
          </div>
          <div className="flex gap-4 mt-2 text-xs">
            <span className="flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-sm bg-blue-400 inline-block" /> Normal</span>
            <span className="flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-sm bg-purple-400 inline-block" /> Mirror</span>
          </div>
        </div>
      )}

    </div>
  );
};
