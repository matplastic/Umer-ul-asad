import React, { useState, useMemo } from 'react';
import { Pool, ActivityLog, ProjectSummary, MonthlyTarget, Employee, PlannedPool, Team, EmployeePunch } from '../types';
import { QCDefect } from './QCDefectPanel';
import { AllReportsTab } from './AllReportsTab';
import { SupervisorPurchaseReport } from './SupervisorPurchaseReport';
import { LiveAnalyticsTab } from './LiveAnalyticsTab';
import { STAGES } from '../data/mockData';
import {
  BarChart3, FileText, Download, Printer, TrendingUp, AlertTriangle,
  Calendar, Target, Activity, Layers, FileSpreadsheet, PieChart as PieIcon,
  Clock, Zap, ArrowDown, ArrowUp, ShoppingCart
} from 'lucide-react';
import {
  ResponsiveContainer, BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend,
  LineChart, Line, PieChart, Pie, Cell, AreaChart, Area
} from 'recharts';
import { exportToExcel, exportTablePdf, exportPoolHistoryPdf, exportPoolBirthCertificatePdf } from '../lib/exportUtils';
import { dbFetchChecklistTemplates } from '../lib/firebaseService';

interface ReportsAndAnalyticsProps {
  pools: Pool[];
  plannedPools: PlannedPool[];
  projectsSummary: ProjectSummary[];
  monthlyTargets: MonthlyTarget[];
  employees: Employee[];
  logs: ActivityLog[];
  teams: Team[];
  employeePunches?: EmployeePunch[];
  qcDefects?: QCDefect[];
}

type TabId = 'analytics' | 'reports' | 'exports' | 'all' | 'purchases';

export const ReportsAndAnalytics: React.FC<ReportsAndAnalyticsProps> = ({
  pools, plannedPools, projectsSummary, monthlyTargets, employees, logs, teams, employeePunches = [], qcDefects = []
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
            { id: 'all' as TabId, label: 'All Reports', icon: FileSpreadsheet },
            { id: 'purchases' as TabId, label: 'Purchase Requests', icon: ShoppingCart },
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

      {tab === 'all' && (
        <AllReportsTab pools={pools} logs={logs} employees={employees} employeePunches={employeePunches} />
      )}
      {tab === 'purchases' && (
        <SupervisorPurchaseReport />
      )}
      {tab === 'analytics' && (
        <LiveAnalyticsTab
          pools={pools}
          logs={logs}
          monthlyTargets={monthlyTargets}
          projectsSummary={projectsSummary}
          plannedPools={plannedPools}
          teams={teams}
          qcDefects={qcDefects}
        />
      )}
      {tab === 'reports' && (
        <ReportsTab pools={pools} projectsSummary={projectsSummary} monthlyTargets={monthlyTargets} employees={employees} logs={logs} qcDefects={qcDefects} />
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
  qcDefects: QCDefect[];
}> = ({ pools, projectsSummary, monthlyTargets, employees, logs, qcDefects }) => {

  const [selectedPoolId, setSelectedPoolId] = useState('');
  const [poolSearchQuery, setPoolSearchQuery] = useState('');
  const [poolSearchProject, setPoolSearchProject] = useState('all');

  const poolSearchProjectOptions = useMemo(
    () => Array.from(new Set(pools.map(p => p.projectName).filter(Boolean))).sort(),
    [pools]
  );

  const filteredPoolsForPicker = useMemo(() => {
    const q = poolSearchQuery.trim().toLowerCase();
    return pools.filter(p => {
      if (poolSearchProject !== 'all' && p.projectName !== poolSearchProject) return false;
      if (!q) return true;
      return (
        (p.poolNo || '').toLowerCase().includes(q) ||
        (p.projectName || '').toLowerCase().includes(q) ||
        (p.poolType || '').toLowerCase().includes(q) ||
        (p.shape || '').toLowerCase().includes(q)
      );
    }).slice(0, 200); // cap the dropdown so it stays fast/usable with large registries
  }, [pools, poolSearchQuery, poolSearchProject]);

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

  const [isGeneratingBirthCert, setIsGeneratingBirthCert] = useState(false);
  const generateBirthCertificate = async () => {
    const pool = pools.find(p => p.id === selectedPoolId);
    if (!pool) { alert('Pick a pool first.'); return; }
    setIsGeneratingBirthCert(true);
    try {
      const templates = await dbFetchChecklistTemplates();
      await exportPoolBirthCertificatePdf(
        pool,
        STAGES.map(s => ({ id: s.id, name: s.name })),
        templates.map(t => ({ stageId: t.stageId, items: t.items.map(i => ({ id: i.id, label: i.label })) })),
        qcDefects
      );
    } catch {
      // Checklist templates are optional context — still generate with whatever the pool record has.
      const pool2 = pools.find(p => p.id === selectedPoolId);
      if (pool2) await exportPoolBirthCertificatePdf(pool2, STAGES.map(s => ({ id: s.id, name: s.name })), undefined, qcDefects);
    } finally {
      setIsGeneratingBirthCert(false);
    }
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
            <div className="mt-3 flex flex-col gap-2">
              <div className="flex flex-col sm:flex-row gap-2">
                <input
                  type="text"
                  value={poolSearchQuery}
                  onChange={(e) => setPoolSearchQuery(e.target.value)}
                  placeholder="Search by pool number, type, or project…"
                  data-testid="report-pool-search"
                  className="flex-1 bg-slate-50 border border-slate-200 rounded-xl px-3 py-2 text-xs text-slate-800 focus:outline-none focus:ring-1 focus:ring-indigo-400"
                />
                <select
                  value={poolSearchProject}
                  onChange={(e) => setPoolSearchProject(e.target.value)}
                  data-testid="report-pool-search-project"
                  className="sm:w-52 bg-slate-50 border border-slate-200 rounded-xl px-3 py-2 text-xs text-slate-800 focus:outline-none focus:ring-1 focus:ring-indigo-400"
                >
                  <option value="all">All Projects</option>
                  {poolSearchProjectOptions.map(proj => (
                    <option key={proj} value={proj}>{proj}</option>
                  ))}
                </select>
              </div>
              <div className="flex flex-col sm:flex-row gap-2">
                <select
                  value={selectedPoolId}
                  onChange={(e) => setSelectedPoolId(e.target.value)}
                  data-testid="report-pool-picker"
                  className="flex-1 bg-slate-50 border border-slate-200 rounded-xl px-3 py-2 text-xs text-slate-800 focus:outline-none"
                >
                  <option value="">
                    {filteredPoolsForPicker.length === 0 ? 'No pools match this search' : `— Pick a pool (${filteredPoolsForPicker.length} match${filteredPoolsForPicker.length === 1 ? '' : 'es'}) —`}
                  </option>
                  {filteredPoolsForPicker.map(p => (
                    <option key={p.id} value={p.id}>
                      Pool {p.poolNo} ({p.projectName}{p.poolType ? ` — ${p.poolType}` : ''})
                    </option>
                  ))}
                </select>
              </div>
              <div className="flex flex-col sm:flex-row gap-2">
                <button
                  onClick={generatePoolHistoryReport}
                  disabled={!selectedPoolId}
                  data-testid="report-pool-history"
                  className="bg-rose-600 hover:bg-rose-700 disabled:bg-slate-300 disabled:cursor-not-allowed text-white font-bold py-2 px-4 rounded-xl text-xs cursor-pointer transition-all flex items-center gap-1.5"
                >
                  <Printer className="h-3.5 w-3.5" />
                  Generate PDF
                </button>
                <button
                  onClick={generateBirthCertificate}
                  disabled={!selectedPoolId || isGeneratingBirthCert}
                  data-testid="report-pool-birth-certificate"
                  className="bg-indigo-600 hover:bg-indigo-700 disabled:bg-slate-300 disabled:cursor-not-allowed text-white font-bold py-2 px-4 rounded-xl text-xs cursor-pointer transition-all flex items-center gap-1.5"
                >
                  <FileText className="h-3.5 w-3.5" />
                  {isGeneratingBirthCert ? 'Generating…' : 'Birth Certificate'}
                </button>
              </div>
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
