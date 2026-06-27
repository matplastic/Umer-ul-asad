import React, { useState, useMemo } from 'react';
import { Pool, ActivityLog, ProjectSummary, MonthlyTarget, Employee, PlannedPool, Team } from '../types';
import { STAGES } from '../data/mockData';
import {
  BarChart3, FileText, Download, Printer, TrendingUp, AlertTriangle,
  Calendar, Target, Activity, Layers, FileSpreadsheet, PieChart as PieIcon,
  Clock, Zap, ArrowDown, ArrowUp
} from 'lucide-react';
import {
  ResponsiveContainer, BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend,
  LineChart, Line, PieChart, Pie, Cell, AreaChart, Area
} from 'recharts';
import { exportToExcel, exportTablePdf, exportPoolHistoryPdf } from '../lib/exportUtils';

interface ReportsAndAnalyticsProps {
  pools: Pool[];
  plannedPools: PlannedPool[];
  projectsSummary: ProjectSummary[];
  monthlyTargets: MonthlyTarget[];
  employees: Employee[];
  logs: ActivityLog[];
  teams: Team[];
}

type TabId = 'analytics' | 'reports' | 'exports';

export const ReportsAndAnalytics: React.FC<ReportsAndAnalyticsProps> = ({
  pools, plannedPools, projectsSummary, monthlyTargets, employees, logs, teams
}) => {
  const [tab, setTab] = useState<TabId>('analytics');

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col md:flex-row md:items-end md:justify-between gap-4">
        <div>
          <h2 className="text-2xl font-black text-slate-800 tracking-tight flex items-center gap-2">
            <BarChart3 className="h-6 w-6 text-indigo-600" />
            Reports &amp; Analytics
          </h2>
          <p className="text-sm text-slate-500 max-w-2xl mt-1">
            Production trends, bottleneck detection, printable PDF reports, and one-click Excel exports for every dataset in your factory ledger.
          </p>
        </div>

        {/* Tab switcher */}
        <div className="flex bg-slate-100 p-1 rounded-xl shrink-0 self-start md:self-center">
          {[
            { id: 'analytics' as TabId, label: 'Live Analytics', icon: TrendingUp },
            { id: 'reports' as TabId, label: 'PDF Reports', icon: FileText },
            { id: 'exports' as TabId, label: 'Excel Exports', icon: FileSpreadsheet },
          ].map(t => (
            <button
              key={t.id}
              onClick={() => setTab(t.id)}
              data-testid={`reports-tab-${t.id}`}
              className={`px-4 py-2 text-xs font-bold rounded-lg transition-all cursor-pointer flex items-center gap-1.5 ${
                tab === t.id
                  ? 'bg-indigo-600 text-white shadow-xs'
                  : 'text-slate-600 hover:text-slate-800 hover:bg-slate-200'
              }`}
            >
              <t.icon className="h-3.5 w-3.5" />
              {t.label}
            </button>
          ))}
        </div>
      </div>

      {tab === 'analytics' && (
        <AnalyticsTab pools={pools} logs={logs} monthlyTargets={monthlyTargets} projectsSummary={projectsSummary} />
      )}
      {tab === 'reports' && (
        <ReportsTab pools={pools} projectsSummary={projectsSummary} monthlyTargets={monthlyTargets} employees={employees} logs={logs} />
      )}
      {tab === 'exports' && (
        <ExportsTab
          pools={pools}
          plannedPools={plannedPools}
          projectsSummary={projectsSummary}
          monthlyTargets={monthlyTargets}
          employees={employees}
          logs={logs}
          teams={teams}
        />
      )}
    </div>
  );
};

// ═════════════════════════════════════════════════════════════════════════════
// TAB 1 — Live Analytics
// ═════════════════════════════════════════════════════════════════════════════
const AnalyticsTab: React.FC<{
  pools: Pool[];
  logs: ActivityLog[];
  monthlyTargets: MonthlyTarget[];
  projectsSummary: ProjectSummary[];
}> = ({ pools, logs, monthlyTargets, projectsSummary }) => {

  // ── KPI scorecards
  const totalPools = pools.length;
  const inProduction = pools.filter(p => !p.isDelivered && !p.completedAt).length;
  const completedPools = pools.filter(p => !!p.completedAt && !p.isDelivered).length;
  const deliveredPools = pools.filter(p => p.isDelivered).length;
  const totalRejections = pools.reduce(
    (sum, p) => sum + Object.values(p.stageHistory || {}).reduce((s, h: any) => s + (h?.rejectionCount || 0), 0),
    0
  );

  // ── Stage dwell-time analysis (bottleneck detector)
  const stageStats = useMemo(() => {
    return STAGES.map((stage) => {
      const histories = pools
        .map(p => p.stageHistory?.[stage.id])
        .filter(h => h && h.durationMinutes && h.durationMinutes > 0);
      const durations = histories.map(h => h!.durationMinutes!);
      const avg = durations.length ? durations.reduce((a, b) => a + b, 0) / durations.length : 0;
      const max = durations.length ? Math.max(...durations) : 0;
      const inFlight = pools.filter(p => p.currentStageIndex === STAGES.indexOf(stage)).length;
      const rejections = pools.reduce(
        (s, p) => s + (p.stageHistory?.[stage.id]?.rejectionCount || 0),
        0
      );
      return {
        stage: stage.name.split(' ').slice(0, 2).join(' '),
        fullName: stage.name,
        avg: Math.round(avg),
        max: Math.round(max),
        inFlight,
        rejections,
        color: stage.color,
      };
    });
  }, [pools]);

  const bottleneck = useMemo(() => {
    const sorted = [...stageStats].filter(s => s.avg > 0).sort((a, b) => b.avg - a.avg);
    return sorted[0] || null;
  }, [stageStats]);

  // ── Production trend (last 30 days)
  const trendData = useMemo(() => {
    const days: Record<string, { date: string; created: number; approved: number; delivered: number }> = {};
    const now = new Date();
    for (let i = 29; i >= 0; i--) {
      const d = new Date(now);
      d.setDate(d.getDate() - i);
      const key = d.toISOString().slice(5, 10);
      days[key] = { date: key, created: 0, approved: 0, delivered: 0 };
    }
    logs.forEach(log => {
      if (!log.timestamp) return;
      const key = log.timestamp.slice(5, 10);
      if (!days[key]) return;
      if (log.type === 'CREATED') days[key].created++;
      if (log.type === 'APPROVED') days[key].approved++;
      if (log.type === 'DELIVERED') days[key].delivered++;
    });
    return Object.values(days);
  }, [logs]);

  // ── Project completion breakdown (pie)
  const projectPie = useMemo(() => {
    return projectsSummary.slice(0, 6).map((p, idx) => ({
      name: p.projectName,
      value: p.deliveredPools,
      color: ['#6366f1', '#ec4899', '#10b981', '#f59e0b', '#06b6d4', '#a855f7'][idx % 6],
    }));
  }, [projectsSummary]);

  // ── Orientation split
  const orientationSplit = useMemo(() => {
    const counts: Record<string, number> = { Normal: 0, Mirror: 0 };
    pools.forEach(p => {
      counts[p.orientation] = (counts[p.orientation] || 0) + 1;
    });
    return [
      { name: 'Normal', value: counts.Normal, color: '#3b82f6' },
      { name: 'Mirror', value: counts.Mirror, color: '#a855f7' },
    ];
  }, [pools]);

  const currentMonthTarget = monthlyTargets.find(t => t.id === new Date().toISOString().slice(0, 7));
  const monthProgress = currentMonthTarget
    ? Math.round((deliveredPools / Math.max(currentMonthTarget.mainTarget, 1)) * 100)
    : null;

  return (
    <div className="space-y-6 animate-fadeIn">
      {/* KPI scorecards row */}
      <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
        <KpiCard label="Total Pools" value={totalPools} icon={Layers} color="indigo" testid="kpi-total" />
        <KpiCard label="In Production" value={inProduction} icon={Activity} color="amber" testid="kpi-inprod" />
        <KpiCard label="Completed" value={completedPools} icon={Target} color="emerald" testid="kpi-completed" />
        <KpiCard label="Delivered" value={deliveredPools} icon={Zap} color="violet" testid="kpi-delivered" />
        <KpiCard label="Rejections" value={totalRejections} icon={AlertTriangle} color="rose" testid="kpi-rejections" />
      </div>

      {/* Bottleneck alert */}
      {bottleneck && (
        <div className="bg-gradient-to-r from-rose-50 to-amber-50 border border-rose-100 rounded-2xl p-4 flex items-center gap-4">
          <div className="bg-rose-100 text-rose-600 rounded-xl p-3">
            <AlertTriangle className="h-6 w-6" />
          </div>
          <div className="flex-1">
            <h3 className="font-extrabold text-slate-800 text-sm">Bottleneck Detected: {bottleneck.fullName}</h3>
            <p className="text-xs text-slate-600 mt-0.5">
              Average dwell time at this stage is <span className="font-bold text-rose-700">{bottleneck.avg} min</span> — the slowest in your factory. Worst case: {bottleneck.max} min. {bottleneck.inFlight} pool(s) currently waiting here.
            </p>
          </div>
        </div>
      )}

      {/* Production trend */}
      <div className="bg-white border border-slate-100 rounded-2xl p-5 shadow-sm">
        <div className="flex items-center justify-between mb-4">
          <div>
            <h3 className="font-extrabold text-slate-800 text-sm flex items-center gap-2">
              <TrendingUp className="h-4 w-4 text-indigo-600" />
              30-Day Production Trend
            </h3>
            <p className="text-xs text-slate-400">Pool creations, approvals, and deliveries over the last month.</p>
          </div>
        </div>
        <ResponsiveContainer width="100%" height={260}>
          <AreaChart data={trendData}>
            <defs>
              <linearGradient id="gCreated" x1="0" x2="0" y1="0" y2="1">
                <stop offset="0%" stopColor="#6366f1" stopOpacity={0.4} />
                <stop offset="100%" stopColor="#6366f1" stopOpacity={0} />
              </linearGradient>
              <linearGradient id="gApproved" x1="0" x2="0" y1="0" y2="1">
                <stop offset="0%" stopColor="#10b981" stopOpacity={0.4} />
                <stop offset="100%" stopColor="#10b981" stopOpacity={0} />
              </linearGradient>
              <linearGradient id="gDelivered" x1="0" x2="0" y1="0" y2="1">
                <stop offset="0%" stopColor="#f59e0b" stopOpacity={0.4} />
                <stop offset="100%" stopColor="#f59e0b" stopOpacity={0} />
              </linearGradient>
            </defs>
            <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
            <XAxis dataKey="date" tick={{ fontSize: 10, fill: '#64748b' }} />
            <YAxis tick={{ fontSize: 10, fill: '#64748b' }} />
            <Tooltip contentStyle={{ borderRadius: 12, border: '1px solid #e2e8f0', fontSize: 12 }} />
            <Legend wrapperStyle={{ fontSize: 11 }} />
            <Area type="monotone" dataKey="created" stroke="#6366f1" fill="url(#gCreated)" strokeWidth={2} />
            <Area type="monotone" dataKey="approved" stroke="#10b981" fill="url(#gApproved)" strokeWidth={2} />
            <Area type="monotone" dataKey="delivered" stroke="#f59e0b" fill="url(#gDelivered)" strokeWidth={2} />
          </AreaChart>
        </ResponsiveContainer>
      </div>

      {/* Stage dwell-time + Pies */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="bg-white border border-slate-100 rounded-2xl p-5 shadow-sm lg:col-span-2">
          <h3 className="font-extrabold text-slate-800 text-sm mb-1 flex items-center gap-2">
            <Clock className="h-4 w-4 text-indigo-600" />
            Average Dwell Time by Stage (minutes)
          </h3>
          <p className="text-xs text-slate-400 mb-4">Lower is faster. Highlights factory bottlenecks at a glance.</p>
          <ResponsiveContainer width="100%" height={300}>
            <BarChart data={stageStats}>
              <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
              <XAxis dataKey="stage" tick={{ fontSize: 9, fill: '#64748b' }} angle={-25} textAnchor="end" height={70} />
              <YAxis tick={{ fontSize: 10, fill: '#64748b' }} />
              <Tooltip contentStyle={{ borderRadius: 12, border: '1px solid #e2e8f0', fontSize: 12 }} />
              <Bar dataKey="avg" radius={[6, 6, 0, 0]}>
                {stageStats.map((s, idx) => (
                  <Cell key={idx} fill={s.color} />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </div>

        <div className="bg-white border border-slate-100 rounded-2xl p-5 shadow-sm">
          <h3 className="font-extrabold text-slate-800 text-sm mb-1 flex items-center gap-2">
            <PieIcon className="h-4 w-4 text-indigo-600" />
            Orientation Split
          </h3>
          <p className="text-xs text-slate-400 mb-2">Normal vs Mirror across all pools.</p>
          <ResponsiveContainer width="100%" height={240}>
            <PieChart>
              <Pie data={orientationSplit} dataKey="value" nameKey="name" innerRadius={50} outerRadius={80} paddingAngle={3}>
                {orientationSplit.map((s, idx) => (
                  <Cell key={idx} fill={s.color} />
                ))}
              </Pie>
              <Tooltip contentStyle={{ borderRadius: 12, fontSize: 12 }} />
              <Legend wrapperStyle={{ fontSize: 11 }} />
            </PieChart>
          </ResponsiveContainer>
        </div>
      </div>

      {/* Project delivery breakdown */}
      {projectPie.length > 0 && (
        <div className="bg-white border border-slate-100 rounded-2xl p-5 shadow-sm">
          <h3 className="font-extrabold text-slate-800 text-sm mb-1 flex items-center gap-2">
            <Target className="h-4 w-4 text-indigo-600" />
            Top Projects by Delivered Pools
          </h3>
          <p className="text-xs text-slate-400 mb-4">Shows revenue concentration — which clients drive most output.</p>
          <ResponsiveContainer width="100%" height={240}>
            <BarChart data={projectPie} layout="vertical">
              <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
              <XAxis type="number" tick={{ fontSize: 10, fill: '#64748b' }} />
              <YAxis type="category" dataKey="name" tick={{ fontSize: 11, fill: '#475569' }} width={130} />
              <Tooltip contentStyle={{ borderRadius: 12, fontSize: 12 }} />
              <Bar dataKey="value" radius={[0, 6, 6, 0]}>
                {projectPie.map((s, idx) => (
                  <Cell key={idx} fill={s.color} />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </div>
      )}

      {/* Month progress */}
      {currentMonthTarget && monthProgress !== null && (
        <div className="bg-gradient-to-br from-indigo-600 to-violet-600 rounded-2xl p-6 text-white shadow-lg">
          <div className="flex items-center justify-between mb-3">
            <div>
              <p className="text-xs uppercase font-bold text-indigo-200 tracking-wider">{currentMonthTarget.monthName} Target</p>
              <h3 className="text-3xl font-black mt-1">{deliveredPools} / {currentMonthTarget.mainTarget} pools delivered</h3>
            </div>
            <div className="text-right">
              <div className="text-5xl font-black">{monthProgress}%</div>
              <p className="text-xs text-indigo-200 mt-1">{monthProgress >= 100 ? 'Target hit ✓' : `${currentMonthTarget.mainTarget - deliveredPools} pools to go`}</p>
            </div>
          </div>
          <div className="bg-white/20 rounded-full h-3 overflow-hidden">
            <div
              className="bg-white h-full transition-all"
              style={{ width: `${Math.min(monthProgress, 100)}%` }}
            />
          </div>
        </div>
      )}
    </div>
  );
};

const KpiCard: React.FC<{ label: string; value: number; icon: any; color: string; testid: string }> = ({ label, value, icon: Icon, color, testid }) => {
  const colorMap: Record<string, string> = {
    indigo: 'bg-indigo-50 text-indigo-700',
    amber: 'bg-amber-50 text-amber-700',
    emerald: 'bg-emerald-50 text-emerald-700',
    violet: 'bg-violet-50 text-violet-700',
    rose: 'bg-rose-50 text-rose-700',
  };
  return (
    <div className="bg-white border border-slate-100 rounded-2xl p-4 shadow-sm" data-testid={testid}>
      <div className="flex items-center justify-between">
        <div>
          <p className="text-[10px] uppercase font-bold text-slate-400 tracking-wider">{label}</p>
          <p className="text-2xl font-black text-slate-800 mt-1">{value.toLocaleString()}</p>
        </div>
        <div className={`${colorMap[color]} rounded-xl p-2.5`}>
          <Icon className="h-4 w-4" />
        </div>
      </div>
    </div>
  );
};

// ═════════════════════════════════════════════════════════════════════════════
// TAB 2 — PDF Reports
// ═════════════════════════════════════════════════════════════════════════════
const ReportsTab: React.FC<{
  pools: Pool[];
  projectsSummary: ProjectSummary[];
  monthlyTargets: MonthlyTarget[];
  employees: Employee[];
  logs: ActivityLog[];
}> = ({ pools, projectsSummary, monthlyTargets, employees, logs }) => {

  const [selectedPoolId, setSelectedPoolId] = useState('');

  const generateDailyProductionReport = () => {
    const today = new Date().toISOString().slice(0, 10);
    const todaysLogs = logs.filter(l => l.timestamp?.startsWith(today));
    if (todaysLogs.length === 0) {
      alert('No activity logged today yet.');
      return;
    }
    exportTablePdf({
      title: `Daily Production Report — ${today}`,
      subtitle: `${todaysLogs.length} events recorded across all stages and teams.`,
      columns: [
        { header: 'Time', dataKey: 'time' },
        { header: 'Project', dataKey: 'project' },
        { header: 'Pool', dataKey: 'pool' },
        { header: 'Stage', dataKey: 'stage' },
        { header: 'Type', dataKey: 'type' },
        { header: 'Operator', dataKey: 'op' },
        { header: 'Notes', dataKey: 'notes' },
      ],
      rows: todaysLogs.map(l => ({
        time: l.timestamp ? new Date(l.timestamp).toLocaleTimeString('en-GB') : '—',
        project: l.projectName,
        pool: l.poolNo,
        stage: STAGES.find(s => s.id === l.stageId)?.name || l.stageId,
        type: l.type,
        op: l.operatorName,
        notes: (l.notes || '').slice(0, 80),
      })),
      filename: 'Daily_Production_Report',
      orientation: 'landscape',
    });
  };

  const generateMonthlyKpiReport = () => {
    if (monthlyTargets.length === 0) {
      alert('No monthly targets defined yet.');
      return;
    }
    const deliveredCount = pools.filter(p => p.isDelivered).length;
    exportTablePdf({
      title: 'Monthly KPI Performance Report',
      subtitle: `${monthlyTargets.length} target periods recorded. Total pools delivered to date: ${deliveredCount}.`,
      columns: [
        { header: 'Month', dataKey: 'month' },
        { header: 'Main Target', dataKey: 'mainTarget' },
        { header: 'Steel Fab', dataKey: 'sf' },
        { header: 'Plumbing', dataKey: 'pl' },
        { header: 'Cladding', dataKey: 'cl' },
        { header: 'Lamination', dataKey: 'lm' },
        { header: 'Mosaic', dataKey: 'ms' },
        { header: 'Target OEE', dataKey: 'oee' },
        { header: 'Notes', dataKey: 'n' },
      ],
      rows: monthlyTargets.map(t => ({
        month: t.monthName,
        mainTarget: t.mainTarget,
        sf: t.steelFabricationTarget ?? '—',
        pl: t.plumbingTarget ?? '—',
        cl: t.claddingTarget ?? '—',
        lm: t.laminationTarget ?? '—',
        ms: t.mosaicTarget ?? '—',
        oee: t.targetOee ? `${t.targetOee}%` : '—',
        n: (t.notes || '').slice(0, 50),
      })),
      filename: 'Monthly_KPI_Report',
      orientation: 'landscape',
    });
  };

  const generateProjectStatusReport = () => {
    if (projectsSummary.length === 0) {
      alert('No projects logged yet.');
      return;
    }
    exportTablePdf({
      title: 'Project Status Summary',
      subtitle: `${projectsSummary.length} active and historical projects under contract.`,
      columns: [
        { header: 'Project', dataKey: 'project' },
        { header: 'Type', dataKey: 'type' },
        { header: 'Orientation', dataKey: 'or' },
        { header: 'Total', dataKey: 'total' },
        { header: 'Produced', dataKey: 'prod' },
        { header: 'Delivered', dataKey: 'del' },
        { header: 'Remaining', dataKey: 'rem' },
        { header: '% Done', dataKey: 'pct' },
      ],
      rows: projectsSummary.map(p => ({
        project: p.projectName,
        type: p.poolType || 'Type 3',
        or: p.orientation,
        total: p.totalPools,
        prod: p.producedPools,
        del: p.deliveredPools,
        rem: p.remainingPools,
        pct: `${Math.round((p.deliveredPools / Math.max(p.totalPools, 1)) * 100)}%`,
      })),
      filename: 'Project_Status_Report',
      orientation: 'landscape',
    });
  };

  const generateEmployeeReport = () => {
    if (employees.length === 0) {
      alert('No employees registered.');
      return;
    }
    exportTablePdf({
      title: 'Employee Roster',
      subtitle: `${employees.length} employees on record.`,
      columns: [
        { header: 'ID', dataKey: 'id' },
        { header: 'Name', dataKey: 'name' },
        { header: 'Role', dataKey: 'role' },
        { header: 'Dept', dataKey: 'dept' },
        { header: 'Phone', dataKey: 'phone' },
        { header: 'Status', dataKey: 'status' },
      ],
      rows: employees.map((e: any) => ({
        id: e.id,
        name: e.name,
        role: e.role || '—',
        dept: e.department || '—',
        phone: e.phone || '—',
        status: e.isActive ? 'Active' : 'Inactive',
      })),
      filename: 'Employee_Roster',
      orientation: 'portrait',
    });
  };

  const generatePoolHistoryReport = () => {
    const pool = pools.find(p => p.id === selectedPoolId);
    if (!pool) { alert('Pick a pool first.'); return; }
    exportPoolHistoryPdf(pool, STAGES.map(s => ({ id: s.id, name: s.name })));
  };

  const reportCards = [
    {
      title: 'Daily Production Report',
      desc: 'All factory activity logged today — creations, approvals, deliveries.',
      icon: Calendar, color: 'indigo',
      action: generateDailyProductionReport,
      testid: 'report-daily',
    },
    {
      title: 'Monthly KPI Report',
      desc: 'All monthly targets with section-by-section quotas and OEE goals.',
      icon: Target, color: 'emerald',
      action: generateMonthlyKpiReport,
      testid: 'report-monthly-kpi',
    },
    {
      title: 'Project Status Summary',
      desc: 'Cross-project status: total / produced / delivered / remaining.',
      icon: Layers, color: 'violet',
      action: generateProjectStatusReport,
      testid: 'report-project-status',
    },
    {
      title: 'Employee Roster',
      desc: 'Full staff list with roles, departments, contact info.',
      icon: FileText, color: 'amber',
      action: generateEmployeeReport,
      testid: 'report-employee',
    },
  ];

  return (
    <div className="space-y-6 animate-fadeIn">
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {reportCards.map(rc => (
          <div key={rc.title} className="bg-white border border-slate-100 rounded-2xl p-5 shadow-sm hover:shadow-md transition-all">
            <div className="flex items-start gap-4">
              <div className={`shrink-0 bg-${rc.color}-50 text-${rc.color}-700 rounded-xl p-3`}>
                <rc.icon className="h-5 w-5" />
              </div>
              <div className="flex-1">
                <h3 className="font-extrabold text-slate-800 text-sm">{rc.title}</h3>
                <p className="text-xs text-slate-500 mt-1 leading-relaxed">{rc.desc}</p>
                <button
                  onClick={rc.action}
                  data-testid={rc.testid}
                  className="mt-3 bg-slate-100 hover:bg-indigo-600 hover:text-white text-slate-700 font-bold py-2 px-4 rounded-xl text-xs cursor-pointer transition-all flex items-center gap-1.5"
                >
                  <Printer className="h-3.5 w-3.5" />
                  Generate PDF
                </button>
              </div>
            </div>
          </div>
        ))}
      </div>

      {/* Per-pool history report */}
      <div className="bg-white border border-slate-100 rounded-2xl p-5 shadow-sm">
        <div className="flex items-start gap-4">
          <div className="shrink-0 bg-rose-50 text-rose-700 rounded-xl p-3">
            <FileText className="h-5 w-5" />
          </div>
          <div className="flex-1">
            <h3 className="font-extrabold text-slate-800 text-sm">Individual Pool Lifecycle Report</h3>
            <p className="text-xs text-slate-500 mt-1 leading-relaxed">
              Pick any pool to generate a full lifecycle PDF: specs, every stage's status, team, inspector, duration, and rejection counts.
            </p>
            <div className="mt-3 flex flex-col sm:flex-row gap-2">
              <select
                value={selectedPoolId}
                onChange={(e) => setSelectedPoolId(e.target.value)}
                data-testid="report-pool-picker"
                className="flex-1 bg-slate-50 border border-slate-200 rounded-xl px-3 py-2 text-xs text-slate-800 focus:outline-none"
              >
                <option value="">— Pick a pool —</option>
                {pools.map(p => (
                  <option key={p.id} value={p.id}>
                    Pool {p.poolNo} ({p.projectName})
                  </option>
                ))}
              </select>
              <button
                onClick={generatePoolHistoryReport}
                disabled={!selectedPoolId}
                data-testid="report-pool-history"
                className="bg-rose-600 hover:bg-rose-700 disabled:bg-slate-300 disabled:cursor-not-allowed text-white font-bold py-2 px-4 rounded-xl text-xs cursor-pointer transition-all flex items-center gap-1.5"
              >
                <Printer className="h-3.5 w-3.5" />
                Generate PDF
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

// ═════════════════════════════════════════════════════════════════════════════
// TAB 3 — Excel Exports
// ═════════════════════════════════════════════════════════════════════════════
const ExportsTab: React.FC<{
  pools: Pool[];
  plannedPools: PlannedPool[];
  projectsSummary: ProjectSummary[];
  monthlyTargets: MonthlyTarget[];
  employees: Employee[];
  logs: ActivityLog[];
  teams: Team[];
}> = ({ pools, plannedPools, projectsSummary, monthlyTargets, employees, logs, teams }) => {

  const exports = [
    {
      title: 'Active Pools',
      count: pools.length,
      icon: Layers, color: 'indigo',
      action: () => exportToExcel(
        pools.map(p => ({
          ID: p.id, Project: p.projectName, PoolNo: p.poolNo,
          Orientation: p.orientation, Dimensions: p.dimensions, Shape: p.shape,
          CurrentStage: STAGES[p.currentStageIndex]?.name || 'Done',
          Status: p.isDelivered ? 'Delivered' : p.completedAt ? 'Completed' : 'In Production',
          Created: p.createdAt, Completed: p.completedAt || '—',
          Notes: p.notes || '',
        })),
        'Active_Pools', 'Pools'
      ),
      testid: 'excel-pools',
    },
    {
      title: 'Planned Pools',
      count: plannedPools.length,
      icon: Calendar, color: 'amber',
      action: () => exportToExcel(
        plannedPools.map(p => ({
          ID: p.id, Project: p.projectName, PoolNo: p.poolNo,
          Orientation: p.orientation, Dimensions: p.dimensions, Shape: p.shape,
          Type: p.poolType, Status: p.status, Notes: p.notes || '',
          CreatedAt: p.createdAt,
        })),
        'Planned_Pools', 'Planned'
      ),
      testid: 'excel-planned',
    },
    {
      title: 'Project Summaries',
      count: projectsSummary.length,
      icon: Target, color: 'violet',
      action: () => exportToExcel(
        projectsSummary.map(p => ({
          ID: p.id, Project: p.projectName, Type: p.poolType,
          Orientation: p.orientation, Total: p.totalPools,
          Produced: p.producedPools, Delivered: p.deliveredPools,
          Remaining: p.remainingPools, Notes: p.notes || '',
        })),
        'Projects_Summary', 'Projects'
      ),
      testid: 'excel-projects',
    },
    {
      title: 'Monthly Targets',
      count: monthlyTargets.length,
      icon: Calendar, color: 'emerald',
      action: () => exportToExcel(
        monthlyTargets.map(t => ({
          MonthID: t.id, MonthName: t.monthName, MainTarget: t.mainTarget,
          SteelFab: t.steelFabricationTarget, Plumbing: t.plumbingTarget,
          Cladding: t.claddingTarget, Lamination: t.laminationTarget,
          Mosaic: t.mosaicTarget, Acrylic: t.acrylicTarget,
          OEETarget: t.targetOee, Notes: t.notes || '',
        })),
        'Monthly_Targets', 'Targets'
      ),
      testid: 'excel-targets',
    },
    {
      title: 'Employees',
      count: employees.length,
      icon: FileText, color: 'rose',
      action: () => exportToExcel(
        employees.map((e: any) => ({
          ID: e.id, Name: e.name, Role: e.role || '',
          Department: e.department || '', Phone: e.phone || '',
          IsActive: e.isActive ? 'Yes' : 'No',
        })),
        'Employees', 'Employees'
      ),
      testid: 'excel-employees',
    },
    {
      title: 'Activity Logs',
      count: logs.length,
      icon: Activity, color: 'indigo',
      action: () => exportToExcel(
        logs.map(l => ({
          Timestamp: l.timestamp, Project: l.projectName, Pool: l.poolNo,
          Stage: STAGES.find(s => s.id === l.stageId)?.name || l.stageId,
          Type: l.type, Operator: l.operatorName, Notes: l.notes || '',
        })),
        'Activity_Logs', 'Logs'
      ),
      testid: 'excel-logs',
    },
    {
      title: 'Teams Status',
      count: teams.length,
      icon: Layers, color: 'amber',
      action: () => exportToExcel(
        teams.map(t => ({
          ID: t.id, Stage: STAGES.find(s => s.id === t.stageId)?.name || t.stageId,
          Name: t.name, Status: t.status, ActivePool: t.activePoolId || '—',
        })),
        'Teams_Status', 'Teams'
      ),
      testid: 'excel-teams',
    },
  ];

  return (
    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4 animate-fadeIn">
      {exports.map(ex => (
        <div key={ex.title} className="bg-white border border-slate-100 rounded-2xl p-5 shadow-sm hover:shadow-md transition-all">
          <div className="flex items-start justify-between mb-3">
            <div className={`bg-${ex.color}-50 text-${ex.color}-700 rounded-xl p-2.5`}>
              <ex.icon className="h-4 w-4" />
            </div>
            <span className="text-[10px] font-mono bg-slate-100 text-slate-600 px-2 py-1 rounded">
              {ex.count.toLocaleString()} rows
            </span>
          </div>
          <h3 className="font-extrabold text-slate-800 text-sm">{ex.title}</h3>
          <button
            onClick={ex.action}
            data-testid={ex.testid}
            className="mt-3 w-full bg-emerald-600 hover:bg-emerald-700 text-white font-bold py-2 rounded-xl text-xs cursor-pointer transition-all flex items-center justify-center gap-1.5"
          >
            <Download className="h-3.5 w-3.5" />
            Download .xlsx
          </button>
        </div>
      ))}
    </div>
  );
};
