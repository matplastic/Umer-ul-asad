import React, { useEffect, useMemo, useState } from 'react';
import { Pool, ActivityLog, ProjectSummary, MonthlyTarget, PlannedPool, Team, StageHistory } from '../types';
import { QCDefect } from './QCDefectPanel';
import { STAGES, getDualGroupForIndex } from '../data/mockData';
import {
  Layers, Activity, Target, Zap, AlertTriangle, Clock, TrendingUp, PauseCircle, Truck,
  ShieldCheck, ClipboardList, Download, Users, FolderKanban, CalendarClock, PieChart as PieIcon,
  CheckCircle2, XCircle, History, Package, Gauge, X, Search
} from 'lucide-react';
import {
  ResponsiveContainer, BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend,
  PieChart, Pie, Cell, ComposedChart, Area, Line
} from 'recharts';
import { exportToExcel } from '../lib/exportUtils';

/**
 * Live Analytics — the full factory picture on one page.
 *
 * Sections: KPI scorecards · attention alerts · production trend · pipeline
 * (work-in-progress) by stage · stage performance table · quality & defects ·
 * team performance · project progress · delivery outlook · monthly target ·
 * mix (orientation / pool type) · recent activity.
 *
 * Everything is computed live from the data the app already holds. The period
 * selector at the top drives the "in period" numbers (trend, approvals,
 * deliveries, stage times, team output); current-state numbers (active pools,
 * queues, on hold, overdue) always show right now.
 *
 * Definitions (kept identical to the Management dashboard):
 *   Active      = not delivered and still inside the stage line
 *   Ready/stock = not delivered and past the last stage
 *   Delivered   = isDelivered
 */

interface Props {
  pools: Pool[];
  logs: ActivityLog[];
  monthlyTargets: MonthlyTarget[];
  projectsSummary: ProjectSummary[];
  plannedPools: PlannedPool[];
  teams: Team[];
  qcDefects: QCDefect[];
}

type Period = '7d' | '30d' | '90d' | 'month' | 'year' | 'all';

const PERIOD_OPTIONS: { id: Period; label: string }[] = [
  { id: '7d', label: 'Last 7 days' },
  { id: '30d', label: 'Last 30 days' },
  { id: '90d', label: 'Last 90 days' },
  { id: 'month', label: 'This month' },
  { id: 'year', label: 'This year' },
  { id: 'all', label: 'All time' },
];

const MONTH_SHORT = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const PALETTE = ['#6366f1', '#ec4899', '#10b981', '#f59e0b', '#06b6d4', '#a855f7', '#ef4444', '#84cc16'];
const TOOLTIP_STYLE = { borderRadius: 12, border: '1px solid #e2e8f0', fontSize: 12 };

// ─── helpers ────────────────────────────────────────────────────────────────
const pad2 = (n: number) => (n < 10 ? `0${n}` : String(n));
const isoDay = (d: Date) => `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;

// Normalises any stored date/time into a local YYYY-MM-DD string ('' if unusable).
const toDay = (s?: string | null): string => {
  if (!s) return '';
  if (/^\d{4}-\d{2}-\d{2}/.test(s)) return s.slice(0, 10);
  const d = new Date(s);
  return isNaN(d.getTime()) ? '' : isoDay(d);
};

// Stage times are sometimes stored as TEXT; adding strings glues them together
// ("12" + "30" = "1230") which is what produced "Infinity min". Always coerce.
const minutesOf = (h?: StageHistory | null): number => {
  const n = Number((h as any)?.durationMinutes);
  return Number.isFinite(n) && n > 0 ? n : 0;
};

const fmtMin = (m: number): string => {
  if (!m || m <= 0) return '—';
  if (m >= 1440) return `${(m / 1440).toFixed(1)} d`;
  if (m >= 60) return `${(m / 60).toFixed(1)} h`;
  return `${Math.round(m)} min`;
};

const fmtPct = (n: number, d: number): string => (d > 0 ? `${Math.round((n / d) * 100)}%` : '—');
const fmtInt = (n: number) => n.toLocaleString('en-US');

const periodRange = (period: Period): { start: string; end: string; days: number } => {
  const today = new Date();
  const end = isoDay(today);
  const back = (n: number) => { const d = new Date(today); d.setDate(d.getDate() - (n - 1)); return d; };
  if (period === '7d') return { start: isoDay(back(7)), end, days: 7 };
  if (period === '30d') return { start: isoDay(back(30)), end, days: 30 };
  if (period === '90d') return { start: isoDay(back(90)), end, days: 90 };
  if (period === 'month') {
    const s = new Date(today.getFullYear(), today.getMonth(), 1);
    return { start: isoDay(s), end, days: today.getDate() };
  }
  if (period === 'year') {
    const s = new Date(today.getFullYear(), 0, 1);
    return { start: isoDay(s), end, days: 366 };
  }
  return { start: '0000-01-01', end, days: 9999 };
};

const inRange = (day: string, start: string, end: string) => !!day && day >= start && day <= end;

const approvalDay = (h?: StageHistory | null) => toDay(h?.inspectionTime || h?.endTime || null);

const STATUS_LABEL: Record<string, string> = {
  NOT_STARTED: 'Waiting', IN_PROGRESS: 'In progress', PENDING_INSPECTION: 'Awaiting QC',
  REJECTED: 'Rework', APPROVED: 'Approved', SKIPPED: 'Skipped', CARRIED_ON_SITE: 'On site',
};

// Status of a pool at a given stage IF it is currently parked there (else null).
// Parallel-gate stages (Mechanical / Skimmer Test / Mosaic, Skimmer Fitting /
// Lamination) all count a pool that sits at their shared gate.
const statusAtStage = (p: Pool, stageId: string, idx: number): string | null => {
  if (p.isDelivered || p.currentStageIndex >= STAGES.length) return null;
  const group = getDualGroupForIndex(p.currentStageIndex);
  const atStage = p.currentStageIndex === idx || (group ? (group as string[]).includes(stageId) : false);
  if (!atStage) return null;
  return ((p.stageHistory as any)?.[stageId] as StageHistory | undefined)?.status || 'NOT_STARTED';
};

const histOf = (p: Pool, stageId: string) => (p.stageHistory as any)?.[stageId] as StageHistory | undefined;

// Where a pool is right now, in words (used by every pool list).
const currentStageText = (p: Pool): string => {
  if (p.isDelivered) return 'Delivered';
  if (p.currentStageIndex >= STAGES.length) return 'Production complete';
  const group = getDualGroupForIndex(p.currentStageIndex);
  const ids = group ? (group as string[]) : [STAGES[p.currentStageIndex].id];
  return ids.map(id => STAGES.find(s => s.id === id)?.name || id).join(' + ');
};

const poolNote = (p: Pool): string => {
  if (p.isDelivered) return `Delivered ${toDay(p.deliveredAt) || ''}`.trim();
  if (p.currentStageIndex >= STAGES.length) return p.scheduledDeliveryDate ? `Ready · due ${toDay(p.scheduledDeliveryDate)}` : 'Ready · no delivery date';
  const group = getDualGroupForIndex(p.currentStageIndex);
  const ids = group ? (group as string[]) : [STAGES[p.currentStageIndex].id];
  const parts = ids.map(id => ({ name: STAGES.find(s => s.id === id)?.name || id, st: histOf(p, id)?.status || 'NOT_STARTED' }));
  const text = parts.length === 1
    ? (STATUS_LABEL[parts[0].st] || parts[0].st)
    : parts.map(x => `${x.name}: ${STATUS_LABEL[x.st] || x.st}`).join(' · ');
  return p.isOnHold ? `${text} · ON HOLD` : text;
};

const sortPools = (list: Pool[]) =>
  [...list].sort((a, b) => (a.projectName || '').localeCompare(b.projectName || '') || (a.poolNo || '').localeCompare(b.poolNo || '', undefined, { numeric: true }));

// ─── drill-down (click a card → see the pool numbers behind it) ─────────────
interface DrillData {
  title: string;
  subtitle?: string;
  columns: string[];
  rows: string[][];
}

const DRILL_DISPLAY_CAP = 1000;

const DrillModal: React.FC<{ data: DrillData; onClose: () => void }> = ({ data, onClose }) => {
  const [q, setQ] = useState('');

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const query = q.trim().toLowerCase();
  const filtered = query ? data.rows.filter(r => r.join(' ').toLowerCase().includes(query)) : data.rows;
  const shown = filtered.slice(0, DRILL_DISPLAY_CAP);

  const doExport = () => {
    exportToExcel(
      filtered.map(r => {
        const o: Record<string, string> = {};
        data.columns.forEach((c, i) => { o[c] = r[i] ?? ''; });
        return o;
      }),
      data.title.replace(/[^A-Za-z0-9]+/g, '_').replace(/^_|_$/g, '') || 'Pool_List',
      'Pools'
    );
  };

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-slate-900/50 backdrop-blur-sm" onClick={onClose} data-testid="analytics-drilldown">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-5xl max-h-[88vh] flex flex-col" onClick={e => e.stopPropagation()}>
        <div className="flex items-start justify-between gap-3 px-5 pt-4 pb-3 border-b border-slate-100">
          <div className="min-w-0">
            <h3 className="font-black text-slate-800 text-base leading-tight">{data.title}</h3>
            <p className="text-xs text-slate-400 mt-0.5">
              {fmtInt(data.rows.length)} record(s){data.subtitle ? ` · ${data.subtitle}` : ''}
            </p>
          </div>
          <button onClick={onClose} className="p-1.5 rounded-lg hover:bg-slate-100 text-slate-500 cursor-pointer shrink-0" aria-label="Close">
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="flex flex-wrap items-center gap-2 px-5 py-3 border-b border-slate-50">
          <div className="relative flex-1 min-w-[200px]">
            <Search className="h-3.5 w-3.5 text-slate-400 absolute left-2.5 top-1/2 -translate-y-1/2" />
            <input
              autoFocus
              value={q}
              onChange={e => setQ(e.target.value)}
              placeholder="Search pool no, project, stage, team…"
              className="w-full pl-8 pr-3 py-1.5 text-xs border border-slate-200 rounded-lg bg-slate-50 focus:outline-none focus:ring-1 focus:ring-indigo-400"
            />
          </div>
          {query && <span className="text-[11px] text-slate-400">{fmtInt(filtered.length)} match(es)</span>}
          <ExportBtn onClick={doExport} />
        </div>

        <div className="overflow-auto px-2 pb-3">
          {shown.length === 0 ? (
            <div className="text-center text-xs text-slate-400 py-12">Nothing to show.</div>
          ) : (
            <table className="min-w-full text-xs">
              <thead className="sticky top-0 bg-white">
                <tr className="border-b border-slate-100">
                  <th className="px-3 py-2.5 text-left font-bold text-slate-400 text-[10px] w-10">#</th>
                  {data.columns.map((c, i) => (
                    <th key={c + i} className="px-3 py-2.5 text-left font-bold text-slate-500 uppercase tracking-wider text-[10px] whitespace-nowrap">{c}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {shown.map((r, i) => (
                  <tr key={i} className="border-b border-slate-50 hover:bg-slate-50/60">
                    <td className="px-3 py-2 font-mono text-slate-300">{i + 1}</td>
                    {r.map((cell, j) => (
                      <td key={j} className={`px-3 py-2 ${j === 0 ? 'font-mono font-black text-slate-800 whitespace-nowrap' : 'text-slate-600'}`}>{cell || '—'}</td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          )}
          {filtered.length > DRILL_DISPLAY_CAP && (
            <p className="text-[11px] text-slate-400 px-3 pt-2">Showing the first {fmtInt(DRILL_DISPLAY_CAP)} of {fmtInt(filtered.length)}. Use Excel to get the full list.</p>
          )}
        </div>
      </div>
    </div>
  );
};

// ─── small UI pieces ────────────────────────────────────────────────────────
const Card: React.FC<{ title?: React.ReactNode; subtitle?: string; right?: React.ReactNode; className?: string; children: React.ReactNode }> =
  ({ title, subtitle, right, className = '', children }) => (
    <div className={`bg-white border border-slate-100 rounded-2xl p-5 shadow-sm ${className}`}>
      {(title || right) && (
        <div className="flex flex-wrap items-start justify-between gap-2 mb-4">
          <div>
            {title && <h3 className="font-extrabold text-slate-800 text-sm flex items-center gap-2">{title}</h3>}
            {subtitle && <p className="text-xs text-slate-400 mt-0.5">{subtitle}</p>}
          </div>
          {right}
        </div>
      )}
      {children}
    </div>
  );

const KPI_COLORS: Record<string, string> = {
  indigo: 'bg-indigo-50 text-indigo-700',
  amber: 'bg-amber-50 text-amber-700',
  emerald: 'bg-emerald-50 text-emerald-700',
  violet: 'bg-violet-50 text-violet-700',
  rose: 'bg-rose-50 text-rose-700',
  sky: 'bg-sky-50 text-sky-700',
  slate: 'bg-slate-100 text-slate-600',
  teal: 'bg-teal-50 text-teal-700',
};

const Kpi: React.FC<{ label: string; value: React.ReactNode; sub?: string; icon: any; color: string; testid?: string; onClick?: () => void }> =
  ({ label, value, sub, icon: Icon, color, testid, onClick }) => (
    <div
      className={`bg-white border border-slate-100 rounded-2xl p-4 shadow-sm ${onClick ? 'cursor-pointer hover:border-indigo-200 hover:shadow-md transition-all' : ''}`}
      data-testid={testid}
      onClick={onClick}
      role={onClick ? 'button' : undefined}
    >
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="text-[10px] uppercase font-bold text-slate-400 tracking-wider">{label}</p>
          <p className="text-2xl font-black text-slate-800 mt-1 leading-none">{value}</p>
          {sub && <p className="text-[10px] text-slate-400 mt-1.5 leading-snug">{sub}</p>}
          {onClick && <p className="text-[10px] font-bold text-indigo-500 mt-1.5">View pools →</p>}
        </div>
        <div className={`${KPI_COLORS[color] || KPI_COLORS.slate} rounded-xl p-2.5 shrink-0`}>
          <Icon className="h-4 w-4" />
        </div>
      </div>
    </div>
  );

const AlertTile: React.FC<{ tone: 'rose' | 'amber' | 'sky' | 'emerald'; icon: any; title: string; value: string; detail: string; onClick?: () => void }> =
  ({ tone, icon: Icon, title, value, detail, onClick }) => {
    const tones = {
      rose: 'from-rose-50 to-white border-rose-100 text-rose-600 bg-rose-100',
      amber: 'from-amber-50 to-white border-amber-100 text-amber-600 bg-amber-100',
      sky: 'from-sky-50 to-white border-sky-100 text-sky-600 bg-sky-100',
      emerald: 'from-emerald-50 to-white border-emerald-100 text-emerald-600 bg-emerald-100',
    }[tone].split(' ');
    return (
      <div
        onClick={onClick}
        role={onClick ? 'button' : undefined}
        className={`bg-gradient-to-r ${tones[0]} ${tones[1]} border ${tones[2]} rounded-2xl p-4 flex items-start gap-3 ${onClick ? 'cursor-pointer hover:shadow-md transition-all' : ''}`}
      >
        <div className={`${tones[4]} ${tones[3]} rounded-xl p-2.5 shrink-0`}><Icon className="h-5 w-5" /></div>
        <div className="min-w-0">
          <p className="text-[10px] uppercase font-bold text-slate-400 tracking-wider">{title}</p>
          <p className="font-black text-slate-800 text-base leading-tight mt-0.5">{value}</p>
          <p className="text-[11px] text-slate-500 mt-0.5 leading-snug">{detail}</p>
          {onClick && <p className="text-[10px] font-bold text-indigo-500 mt-1">View pools →</p>}
        </div>
      </div>
    );
  };

const ExportBtn: React.FC<{ onClick: () => void; label?: string }> = ({ onClick, label = 'Excel' }) => (
  <button
    onClick={onClick}
    className="flex items-center gap-1 px-2.5 py-1.5 text-[11px] font-bold rounded-lg border border-slate-200 bg-white hover:bg-slate-50 text-slate-700 cursor-pointer"
  >
    <Download className="h-3 w-3" /> {label}
  </button>
);

const ALIGN_CLASS = { left: 'text-left', center: 'text-center', right: 'text-right' } as const;
const Th: React.FC<{ children?: React.ReactNode; align?: 'left' | 'center' | 'right'; className?: string }> = ({ children, align = 'center', className = '' }) => (
  <th className={`font-bold text-slate-500 uppercase tracking-wider px-3 py-2.5 whitespace-nowrap text-[10px] ${ALIGN_CLASS[align]} ${className}`}>{children}</th>
);

const EmptyNote: React.FC<{ text: string }> = ({ text }) => (
  <div className="text-center text-xs text-slate-400 py-8 bg-slate-50/60 rounded-xl border border-dashed border-slate-200">{text}</div>
);

// ─── main component ─────────────────────────────────────────────────────────
export const LiveAnalyticsTab: React.FC<Props> = ({ pools, logs, monthlyTargets, projectsSummary, plannedPools, teams, qcDefects }) => {
  const [period, setPeriod] = useState<Period>('30d');
  const [drill, setDrill] = useState<DrillData | null>(null);
  const range = useMemo(() => periodRange(period), [period]);
  const today = isoDay(new Date());
  const periodLabel = PERIOD_OPTIONS.find(o => o.id === period)?.label || '';

  const stageIndexById = useMemo(() => {
    const m: Record<string, number> = {};
    STAGES.forEach((s, i) => { m[s.id] = i; });
    return m;
  }, []);

  // ── SCOPE: the pools the filter covers ─────────────────────────────────────
  // Same rule as the Management dashboard's shop-floor date range: pools are
  // included by their production RELEASE date. "All time" = every pool. All
  // the status numbers, queues, projects and delivery lists below use this set.
  const scoped = useMemo(
    () => (period === 'all' ? pools : pools.filter(p => inRange(toDay(p.createdAt), range.start, range.end))),
    [pools, range, period]
  );
  const scopedIds = useMemo(() => new Set(scoped.map(p => p.id)), [scoped]);
  const scopedPlanned = useMemo(
    () => plannedPools.filter(p => p.status === 'PLANNED' && (period === 'all' || inRange(toDay(p.createdAt), range.start, range.end))),
    [plannedPools, range, period]
  );

  // ── pool buckets (factory status for the selected period) ─────────────────
  const state = useMemo(() => {
    const active = scoped.filter(p => !p.isDelivered && p.currentStageIndex < STAGES.length);
    const ready = scoped.filter(p => !p.isDelivered && p.currentStageIndex >= STAGES.length);
    const delivered = scoped.filter(p => !!p.isDelivered);
    const onHold = active.filter(p => !!p.isOnHold);
    return { active, ready, delivered, onHold, planned: scopedPlanned };
  }, [scoped, scopedPlanned]);

  // ── stage metrics ─────────────────────────────────────────────────────────
  const stageStats = useMemo(() => {
    return STAGES.map((stage, idx) => {
      let waiting = 0, inProgress = 0, awaitingQc = 0, rework = 0;
      let approvedAll = 0, approvedPeriod = 0, rejections = 0, firstPass = 0;
      const periodDurations: number[] = [];

      pools.forEach(p => {
        const h = (p.stageHistory as any)?.[stage.id] as StageHistory | undefined;

        // where is this pool right now? (only pools inside the filter scope)
        if (scopedIds.has(p.id)) {
          const st = statusAtStage(p, stage.id, idx);
          if (st === 'NOT_STARTED') waiting++;
          else if (st === 'IN_PROGRESS') inProgress++;
          else if (st === 'PENDING_INSPECTION') awaitingQc++;
          else if (st === 'REJECTED') rework++;
        }

        if (!h) return;
        rejections += Number(h.rejectionCount) || 0;
        if (h.status === 'APPROVED') {
          approvedAll++;
          if (!(Number(h.rejectionCount) > 0)) firstPass++;
          if (inRange(approvalDay(h), range.start, range.end)) {
            approvedPeriod++;
            const m = minutesOf(h);
            if (m > 0) periodDurations.push(m);
          }
        }
      });

      const avg = periodDurations.length ? periodDurations.reduce((a, b) => a + b, 0) / periodDurations.length : 0;
      const max = periodDurations.length ? Math.max(...periodDurations) : 0;
      const attempts = approvedAll + rejections;

      return {
        id: stage.id,
        name: stage.name,
        short: stage.name.split(' ').slice(0, 2).join(' '),
        color: stage.color,
        waiting, inProgress, awaitingQc, rework,
        queue: waiting + inProgress + awaitingQc + rework,
        approvedAll, approvedPeriod, rejections, firstPass,
        samples: periodDurations.length,
        avg, max,
        rejectionRate: attempts > 0 ? Math.round((rejections / attempts) * 100) : 0,
        firstPassRate: approvedAll > 0 ? Math.round((firstPass / approvedAll) * 100) : 0,
      };
    });
  }, [pools, range, scopedIds]);

  const totals = useMemo(() => {
    const approvedAll = stageStats.reduce((s, x) => s + x.approvedAll, 0);
    const approvedPeriod = stageStats.reduce((s, x) => s + x.approvedPeriod, 0);
    const rejections = stageStats.reduce((s, x) => s + x.rejections, 0);
    const firstPass = stageStats.reduce((s, x) => s + x.firstPass, 0);
    return {
      approvedAll, approvedPeriod, rejections,
      rejectionRate: approvedAll + rejections > 0 ? Math.round((rejections / (approvedAll + rejections)) * 100) : 0,
      firstPassYield: approvedAll > 0 ? Math.round((firstPass / approvedAll) * 100) : 0,
    };
  }, [stageStats]);

  const bottleneck = useMemo(() => {
    const candidates = stageStats.filter(s => s.samples >= 3 && s.avg > 0);
    return [...candidates].sort((a, b) => b.avg - a.avg)[0] || null;
  }, [stageStats]);

  const biggestQueue = useMemo(() => {
    return [...stageStats].sort((a, b) => b.queue - a.queue)[0] || null;
  }, [stageStats]);

  // ── period numbers ────────────────────────────────────────────────────────
  const periodNums = useMemo(() => {
    const released = pools.filter(p => inRange(toDay(p.createdAt), range.start, range.end)).length;
    const deliveredList = pools.filter(p => p.isDelivered && inRange(toDay(p.deliveredAt), range.start, range.end));
    const leadDays: number[] = [];
    deliveredList.forEach(p => {
      const a = toDay(p.createdAt), b = toDay(p.deliveredAt);
      if (a && b) {
        const diff = (new Date(b).getTime() - new Date(a).getTime()) / 86400000;
        if (Number.isFinite(diff) && diff >= 0) leadDays.push(diff);
      }
    });
    const rejectionsPeriod = logs.filter(l => l.type === 'REJECTED' && inRange(toDay(l.timestamp), range.start, range.end)).length;
    return {
      released,
      delivered: deliveredList.length,
      avgLeadDays: leadDays.length ? leadDays.reduce((a, b) => a + b, 0) / leadDays.length : 0,
      rejectionsPeriod,
    };
  }, [pools, logs, range]);

  // ── trend ─────────────────────────────────────────────────────────────────
  const trend = useMemo(() => {
    let startDay = range.start;
    if (period === 'all') {
      const earliest = pools.map(p => toDay(p.createdAt)).filter(Boolean).sort()[0];
      startDay = earliest || today;
      // keep the chart readable: at most the last 36 months
      const cap = new Date(); cap.setMonth(cap.getMonth() - 35); cap.setDate(1);
      if (startDay < isoDay(cap)) startDay = isoDay(cap);
    }
    const monthly = period === 'year' || period === 'all';
    const keys: { key: string; label: string }[] = [];
    const cursor = new Date(`${startDay}T00:00:00`);
    const endDate = new Date(`${today}T00:00:00`);
    if (monthly) {
      cursor.setDate(1);
      while (cursor <= endDate) {
        const k = `${cursor.getFullYear()}-${pad2(cursor.getMonth() + 1)}`;
        keys.push({ key: k, label: `${MONTH_SHORT[cursor.getMonth()]} ${String(cursor.getFullYear()).slice(2)}` });
        cursor.setMonth(cursor.getMonth() + 1);
      }
    } else {
      while (cursor <= endDate) {
        keys.push({ key: isoDay(cursor), label: `${pad2(cursor.getDate())} ${MONTH_SHORT[cursor.getMonth()]}` });
        cursor.setDate(cursor.getDate() + 1);
      }
    }
    const rows: Record<string, { label: string; released: number; approved: number; delivered: number; rejected: number }> = {};
    keys.forEach(k => { rows[k.key] = { label: k.label, released: 0, approved: 0, delivered: 0, rejected: 0 }; });
    const keyOf = (day: string) => (monthly ? day.slice(0, 7) : day);

    pools.forEach(p => {
      const c = toDay(p.createdAt);
      if (c && rows[keyOf(c)]) rows[keyOf(c)].released++;
      if (p.isDelivered) {
        const d = toDay(p.deliveredAt);
        if (d && rows[keyOf(d)]) rows[keyOf(d)].delivered++;
      }
      Object.values(p.stageHistory || {}).forEach((h: any) => {
        if (h?.status === 'APPROVED') {
          const a = approvalDay(h);
          if (a && rows[keyOf(a)]) rows[keyOf(a)].approved++;
        }
      });
    });
    logs.forEach(l => {
      if (l.type !== 'REJECTED') return;
      const d = toDay(l.timestamp);
      if (d && rows[keyOf(d)]) rows[keyOf(d)].rejected++;
    });
    return keys.map(k => rows[k.key]);
  }, [pools, logs, range, period, today]);

  // ── quality / defects ─────────────────────────────────────────────────────
  const defectStats = useMemo(() => {
    const open = qcDefects.filter(d => d.status === 'open' || d.status === 'on_hold');
    const sev = { critical: 0, major: 0, minor: 0 } as Record<string, number>;
    const typeCount: Record<string, number> = {};
    const stageCount: Record<string, number> = {};
    qcDefects.forEach(d => {
      if (!inRange(toDay(d.loggedAt), range.start, range.end)) return;
      sev[d.severity] = (sev[d.severity] || 0) + 1;
      typeCount[d.defectType] = (typeCount[d.defectType] || 0) + 1;
      stageCount[d.stageName || d.stageId] = (stageCount[d.stageName || d.stageId] || 0) + 1;
    });
    const periodTotal = Object.values(sev).reduce((a, b) => a + b, 0);
    return {
      openCount: open.length,
      openCritical: open.filter(d => d.severity === 'critical').length,
      periodTotal,
      severity: [
        { name: 'Critical', value: sev.critical || 0, color: '#ef4444' },
        { name: 'Major', value: sev.major || 0, color: '#f59e0b' },
        { name: 'Minor', value: sev.minor || 0, color: '#38bdf8' },
      ].filter(s => s.value > 0),
      topTypes: Object.entries(typeCount).map(([name, value]) => ({ name, value })).sort((a, b) => b.value - a.value).slice(0, 8),
      byStage: Object.entries(stageCount).map(([name, value]) => ({ name, value })).sort((a, b) => b.value - a.value).slice(0, 8),
    };
  }, [qcDefects, range]);

  // ── team performance ──────────────────────────────────────────────────────
  const teamRows = useMemo(() => {
    const nameById = new Map<string, string>();
    teams.forEach(t => nameById.set(t.id, t.name));
    const map = new Map<string, { team: string; stage: string; completed: number; minutes: number; timed: number; rejections: number; firstPass: number }>();
    pools.forEach(p => {
      STAGES.forEach(stage => {
        const h = (p.stageHistory as any)?.[stage.id] as StageHistory | undefined;
        if (!h || h.status !== 'APPROVED') return;
        if (!inRange(approvalDay(h), range.start, range.end)) return;
        const team = (h.teamName || (h.teamId && nameById.get(h.teamId)) || 'Unknown team').trim();
        const key = `${team.toLowerCase()}|${stage.id}`;
        let r = map.get(key);
        if (!r) { r = { team, stage: stage.name, completed: 0, minutes: 0, timed: 0, rejections: 0, firstPass: 0 }; map.set(key, r); }
        r.completed++;
        const m = minutesOf(h);
        if (m > 0) { r.minutes += m; r.timed++; }
        const rej = Number(h.rejectionCount) || 0;
        r.rejections += rej;
        if (rej === 0) r.firstPass++;
      });
    });
    return Array.from(map.values())
      .map(r => ({ ...r, avg: r.timed ? r.minutes / r.timed : 0 }))
      .sort((a, b) => b.completed - a.completed || a.team.localeCompare(b.team));
  }, [pools, teams, range]);

  // ── project progress ──────────────────────────────────────────────────────
  const projectRows = useMemo(() => {
    const contract = new Map<string, number>();
    projectsSummary.forEach(s => contract.set((s.projectName || '').trim().toLowerCase(), s.totalPools));
    const map = new Map<string, { project: string; total: number; active: number; ready: number; delivered: number; rejections: number; onHold: number; overdue: number }>();
    scoped.forEach(p => {
      const name = (p.projectName || 'Unassigned').trim();
      const k = name.toLowerCase();
      let r = map.get(k);
      if (!r) { r = { project: name, total: 0, active: 0, ready: 0, delivered: 0, rejections: 0, onHold: 0, overdue: 0 }; map.set(k, r); }
      r.total++;
      if (p.isDelivered) r.delivered++;
      else if (p.currentStageIndex >= STAGES.length) r.ready++;
      else r.active++;
      if (!p.isDelivered && p.isOnHold) r.onHold++;
      if (!p.isDelivered && p.scheduledDeliveryDate && toDay(p.scheduledDeliveryDate) < today) r.overdue++;
      Object.values(p.stageHistory || {}).forEach((h: any) => { r!.rejections += Number(h?.rejectionCount) || 0; });
    });
    return Array.from(map.entries())
      .map(([k, r]) => ({ ...r, contract: contract.get(k) ?? null }))
      .sort((a, b) => b.active - a.active || b.total - a.total);
  }, [scoped, projectsSummary, today]);

  // ── delivery outlook ──────────────────────────────────────────────────────
  const delivery = useMemo(() => {
    const addDays = (n: number) => { const d = new Date(); d.setDate(d.getDate() + n); return isoDay(d); };
    const in7 = addDays(7), in30 = addDays(30);
    const scheduled = scoped.filter(p => !p.isDelivered && p.scheduledDeliveryDate);
    const buckets = { overdue: 0, week: 0, month: 0, later: 0 };
    const readyCount = { overdue: 0, week: 0, month: 0, later: 0 };
    scheduled.forEach(p => {
      const d = toDay(p.scheduledDeliveryDate);
      const key = d < today ? 'overdue' : d <= in7 ? 'week' : d <= in30 ? 'month' : 'later';
      buckets[key]++;
      if (p.readyForDelivery || p.currentStageIndex >= STAGES.length) readyCount[key]++;
    });
    const list = scheduled
      .map(p => {
        const d = toDay(p.scheduledDeliveryDate);
        const days = Math.round((new Date(`${d}T00:00:00`).getTime() - new Date(`${today}T00:00:00`).getTime()) / 86400000);
        const stage = p.currentStageIndex < STAGES.length ? STAGES[p.currentStageIndex].name : 'Production complete';
        return { poolNo: p.poolNo, project: p.projectName, scheduled: d, days, stage, ready: !!(p.readyForDelivery || p.currentStageIndex >= STAGES.length) };
      })
      .sort((a, b) => a.days - b.days);
    return { buckets, readyCount, list, unscheduled: scoped.filter(p => !p.isDelivered && !p.scheduledDeliveryDate).length };
  }, [scoped, today]);

  // ── month target ──────────────────────────────────────────────────────────
  const monthTarget = useMemo(() => {
    const monthKey = today.slice(0, 7);
    const t = monthlyTargets.find(x => x.id === monthKey);
    if (!t) return null;
    const deliveredThisMonth = pools.filter(p => p.isDelivered && toDay(p.deliveredAt).slice(0, 7) === monthKey).length;
    const now = new Date();
    const daysInMonth = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate();
    const daysLeft = Math.max(daysInMonth - now.getDate(), 0);
    const target = Math.max(Number(t.mainTarget) || 0, 0);
    const remaining = Math.max(target - deliveredThisMonth, 0);
    return {
      name: t.monthName, target, delivered: deliveredThisMonth, remaining, daysLeft,
      pct: target > 0 ? Math.round((deliveredThisMonth / target) * 100) : 0,
      perDay: daysLeft > 0 ? remaining / daysLeft : remaining,
    };
  }, [monthlyTargets, pools, today]);

  // ── mix ───────────────────────────────────────────────────────────────────
  const orientationSplit = useMemo(() => {
    const c: Record<string, number> = {};
    scoped.forEach(p => { const k = p.orientation || 'Unknown'; c[k] = (c[k] || 0) + 1; });
    return Object.entries(c).map(([name, value], i) => ({ name, value, color: ['#3b82f6', '#a855f7', '#94a3b8'][i % 3] }));
  }, [scoped]);

  const typeSplit = useMemo(() => {
    const c: Record<string, number> = {};
    scoped.forEach(p => { const k = p.poolType || 'Unspecified'; c[k] = (c[k] || 0) + 1; });
    return Object.entries(c).map(([name, value], i) => ({ name, value, color: PALETTE[i % PALETTE.length] })).sort((a, b) => b.value - a.value);
  }, [scoped]);

  const recent = useMemo(
    () => [...logs].filter(l => l.timestamp).sort((a, b) => b.timestamp.localeCompare(a.timestamp)).slice(0, 12),
    [logs]
  );

  // ── exports ───────────────────────────────────────────────────────────────
  const exportStages = () => exportToExcel(
    stageStats.map(s => ({
      Stage: s.name, Waiting: s.waiting, 'In Progress': s.inProgress, 'Awaiting QC': s.awaitingQc, Rework: s.rework,
      [`Approved (${periodLabel})`]: s.approvedPeriod, 'Approved (All Time)': s.approvedAll,
      'Avg Time (min)': Math.round(s.avg), 'Max Time (min)': Math.round(s.max),
      Rejections: s.rejections, 'Rejection Rate %': s.rejectionRate, 'First-Pass %': s.firstPassRate,
    })),
    'Stage_Performance', 'Stages'
  );
  const exportProjects = () => exportToExcel(
    projectRows.map(r => ({
      Project: r.project, 'Contract Total': r.contract ?? '', 'Pools Released': r.total, Active: r.active,
      'Ready / In Stock': r.ready, Delivered: r.delivered, '% Delivered': r.total ? Math.round((r.delivered / r.total) * 100) : 0,
      Rejections: r.rejections, 'On Hold': r.onHold, 'Overdue Deliveries': r.overdue,
    })),
    'Project_Progress', 'Projects'
  );
  const exportTeams = () => exportToExcel(
    teamRows.map(r => ({
      Team: r.team, Stage: r.stage, [`Completed (${periodLabel})`]: r.completed, 'Avg Time (min)': Math.round(r.avg),
      Rejections: r.rejections, 'First-Pass %': r.completed ? Math.round((r.firstPass / r.completed) * 100) : 0,
    })),
    'Team_Performance', 'Teams'
  );
  const exportDelivery = () => exportToExcel(
    delivery.list.map(r => ({
      Pool: r.poolNo, Project: r.project, 'Scheduled Delivery': r.scheduled,
      'Days (negative = late)': r.days, 'Current Stage': r.stage, 'Ready For Delivery': r.ready ? 'Yes' : 'No',
    })),
    'Delivery_Outlook', 'Delivery'
  );

  // ── drill-down builders (click a card / number → list the pools) ──────────
  const scopeText = period === 'all' ? 'all pools' : `pools released ${range.start} → ${range.end}`;
  const periodText = period === 'all' ? 'all time' : `${range.start} → ${range.end}`;

  const openPoolList = (title: string, list: Pool[], subtitle?: string) => setDrill({
    title,
    subtitle: subtitle ?? scopeText,
    columns: ['Pool No', 'Project', 'Released', 'Stage', 'Status'],
    rows: sortPools(list).map(p => [p.poolNo, p.projectName, toDay(p.createdAt), currentStageText(p), poolNote(p)]),
  });

  const openDeliveredList = (title: string, list: Pool[], subtitle: string) => setDrill({
    title,
    subtitle,
    columns: ['Pool No', 'Project', 'Released', 'Delivered', 'Lead Time'],
    rows: [...list]
      .sort((a, b) => toDay(b.deliveredAt).localeCompare(toDay(a.deliveredAt)))
      .map(p => {
        const a = toDay(p.createdAt), b = toDay(p.deliveredAt);
        const d = a && b ? Math.round((new Date(b).getTime() - new Date(a).getTime()) / 86400000) : null;
        return [p.poolNo, p.projectName, a, b, d !== null && d >= 0 ? `${d} d` : ''];
      }),
  });

  const QUEUE_STATUSES = ['NOT_STARTED', 'IN_PROGRESS', 'PENDING_INSPECTION', 'REJECTED'];
  const openStagePools = (stageId: string, stageName: string, filter: string) => {
    const idx = stageIndexById[stageId];
    const matched = scoped
      .map(p => ({ p, st: statusAtStage(p, stageId, idx) }))
      .filter(x => x.st && (filter === 'QUEUE' ? QUEUE_STATUSES.includes(x.st) : x.st === filter));
    const label = filter === 'QUEUE' ? 'in queue' : (STATUS_LABEL[filter] || filter).toLowerCase();
    setDrill({
      title: `${stageName} — pools ${label}`,
      subtitle: scopeText,
      columns: ['Pool No', 'Project', 'Released', 'Status Here', 'Team', 'Started'],
      rows: matched
        .sort((a, b) => (a.p.projectName || '').localeCompare(b.p.projectName || '') || (a.p.poolNo || '').localeCompare(b.p.poolNo || '', undefined, { numeric: true }))
        .map(({ p, st }) => {
          const h = histOf(p, stageId);
          return [p.poolNo, p.projectName, toDay(p.createdAt), STATUS_LABEL[st as string] || String(st), h?.teamName || '', toDay(h?.startTime)];
        }),
    });
  };

  const approvalRows = (onlyStageId?: string): string[][] => {
    const out: { key: string; row: string[] }[] = [];
    pools.forEach(p => {
      STAGES.forEach(stage => {
        if (onlyStageId && stage.id !== onlyStageId) return;
        const h = histOf(p, stage.id);
        if (!h || h.status !== 'APPROVED') return;
        const day = approvalDay(h);
        if (!inRange(day, range.start, range.end)) return;
        const m = minutesOf(h);
        out.push({ key: day, row: [p.poolNo, p.projectName, stage.name, h.teamName || '', day, m ? fmtMin(m) : '', Number(h.rejectionCount) > 0 ? `${h.rejectionCount} rework` : 'First pass'] });
      });
    });
    return out.sort((a, b) => b.key.localeCompare(a.key)).map(x => x.row);
  };
  const approvalColumns = ['Pool No', 'Project', 'Stage', 'Team', 'Approved On', 'Time Taken', 'Result'];

  const openApprovals = (stageId?: string, stageName?: string) => setDrill({
    title: stageName ? `${stageName} — QC approvals` : 'QC approvals (all stages)',
    subtitle: `approved ${periodText}`,
    columns: approvalColumns,
    rows: approvalRows(stageId),
  });

  const openRejections = () => setDrill({
    title: 'Rejections',
    subtitle: `rejected ${periodText}`,
    columns: ['Pool No', 'Project', 'Stage', 'Team', 'Date', 'Notes'],
    rows: logs
      .filter(l => l.type === 'REJECTED' && inRange(toDay(l.timestamp), range.start, range.end))
      .sort((a, b) => b.timestamp.localeCompare(a.timestamp))
      .map(l => [l.poolNo, l.projectName, STAGES.find(x => x.id === l.stageId)?.name || String(l.stageId), l.teamName || '', toDay(l.timestamp), (l.notes || '').slice(0, 140)]),
  });

  const openFirstPass = () => setDrill({
    title: 'Stage sign-offs that needed rework',
    subtitle: 'all time — stages QC rejected at least once before approving',
    columns: ['Pool No', 'Project', 'Stage', 'Team', 'Rework Count'],
    rows: (() => {
      const out: string[][] = [];
      pools.forEach(p => STAGES.forEach(stage => {
        const h = histOf(p, stage.id);
        if (h && h.status === 'APPROVED' && Number(h.rejectionCount) > 0) out.push([p.poolNo, p.projectName, stage.name, h.teamName || '', String(h.rejectionCount)]);
      }));
      return out.sort((a, b) => Number(b[4]) - Number(a[4]));
    })(),
  });

  const openOnHold = () => setDrill({
    title: 'Pools on QC hold',
    subtitle: scopeText,
    columns: ['Pool No', 'Project', 'Stage', 'Held By', 'Held On', 'Reason'],
    rows: sortPools(state.onHold).map(p => [
      p.poolNo, p.projectName,
      STAGES.find(x => x.id === p.holdInfo?.stageAtHold)?.name || currentStageText(p),
      p.holdInfo?.heldBy || '', toDay(p.holdInfo?.heldAt), p.holdInfo?.reason || '',
    ]),
  });

  const openPlanned = () => setDrill({
    title: 'Planned pools (not yet released)',
    subtitle: period === 'all' ? 'all planned pools' : `planned ${range.start} → ${range.end}`,
    columns: ['Pool No', 'Project', 'Type', 'Orientation', 'Planned On'],
    rows: [...state.planned]
      .sort((a, b) => (a.projectName || '').localeCompare(b.projectName || '') || (a.poolNo || '').localeCompare(b.poolNo || '', undefined, { numeric: true }))
      .map(p => [p.poolNo, p.projectName, p.poolType || '', String(p.orientation || ''), toDay(p.createdAt)]),
  });

  const openOverdue = () => setDrill({
    title: 'Overdue deliveries',
    subtitle: `${scopeText} · past their scheduled delivery date`,
    columns: ['Pool No', 'Project', 'Scheduled', 'Days Late', 'Stage', 'Ready To Go Out'],
    rows: delivery.list.filter(r => r.days < 0).sort((a, b) => a.days - b.days).map(r => [r.poolNo, r.project, r.scheduled, `${Math.abs(r.days)} d`, r.stage, r.ready ? 'Yes' : 'No']),
  });

  const openDefects = () => setDrill({
    title: 'Open quality defects',
    subtitle: 'defects that are open or on hold',
    columns: ['Pool No', 'Project', 'Defect', 'Severity', 'Stage', 'Status', 'Logged By', 'Logged On'],
    rows: qcDefects
      .filter(d => d.status === 'open' || d.status === 'on_hold')
      .sort((a, b) => (b.loggedAt || '').localeCompare(a.loggedAt || ''))
      .map(d => [d.poolNo, d.projectName, d.defectType, d.severity, d.stageName || String(d.stageId), d.status.replace('_', ' '), d.loggedBy, toDay(d.loggedAt)]),
  });

  const wipChartData = stageStats.map(s => ({ name: s.short, Waiting: s.waiting, 'In Progress': s.inProgress, 'Awaiting QC': s.awaitingQc, Rework: s.rework }));

  return (
    <div className="space-y-6 animate-fadeIn" data-testid="live-analytics">
      {/* ── Control bar ── */}
      <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-3 bg-white border border-slate-100 rounded-2xl px-4 py-3 shadow-sm">
        <div className="flex items-center gap-2">
          <span className="relative flex h-2.5 w-2.5">
            <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-60" />
            <span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-emerald-500" />
          </span>
          <div>
            <p className="text-sm font-extrabold text-slate-800 leading-tight">Factory Performance Overview</p>
            <p className="text-[11px] text-slate-400">
              Live data · {periodLabel}{period !== 'all' ? ` (${range.start} → ${range.end})` : ''}
              {period !== 'all' ? ' · pool counts cover pools released in this period' : ' · all pools'}
            </p>
          </div>
        </div>
        <div className="flex flex-wrap gap-1 bg-slate-100 p-1 rounded-xl self-start md:self-auto">
          {PERIOD_OPTIONS.map(o => (
            <button
              key={o.id}
              onClick={() => setPeriod(o.id)}
              data-testid={`analytics-period-${o.id}`}
              className={`px-3 py-1.5 text-[11px] font-bold rounded-lg transition-all cursor-pointer ${
                period === o.id ? 'bg-white text-indigo-700 shadow-sm' : 'text-slate-500 hover:text-slate-800'
              }`}
            >
              {o.label}
            </button>
          ))}
        </div>
      </div>

      {/* ── KPI row 1: factory right now ── */}
      <div>
        <p className="text-[10px] font-black text-slate-400 uppercase tracking-wider mb-2">
          Factory status — {period === 'all' ? 'all pools' : `pools released ${periodLabel.toLowerCase()}`}
        </p>
        <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-6 gap-3">
          <Kpi label="Total Pools" value={fmtInt(scoped.length)} sub={period === 'all' ? 'released to the floor' : 'released in this period'} icon={Layers} color="indigo" testid="kpi-total" onClick={() => openPoolList('All pools', scoped)} />
          <Kpi label="In Production" value={fmtInt(state.active.length)} sub={`${fmtPct(state.active.length, scoped.length)} of these pools`} icon={Activity} color="amber" testid="kpi-inprod" onClick={() => openPoolList('Pools in production', state.active)} />
          <Kpi label="Ready / In Stock" value={fmtInt(state.ready.length)} sub="finished, not yet delivered" icon={Package} color="emerald" testid="kpi-completed" onClick={() => openPoolList('Ready / in stock pools', state.ready)} />
          <Kpi label="Delivered" value={fmtInt(state.delivered.length)} sub={`${fmtPct(state.delivered.length, scoped.length)} of these pools`} icon={Zap} color="violet" testid="kpi-delivered" onClick={() => openDeliveredList('Delivered pools', state.delivered, scopeText)} />
          <Kpi label="Planned (Not Released)" value={fmtInt(state.planned.length)} sub="waiting in Planning" icon={ClipboardList} color="sky" testid="kpi-planned" onClick={openPlanned} />
          <Kpi label="On QC Hold" value={fmtInt(state.onHold.length)} sub="blocked until QC releases" icon={PauseCircle} color={state.onHold.length ? 'rose' : 'slate'} testid="kpi-hold" onClick={openOnHold} />
        </div>
      </div>

      {/* ── KPI row 2: performance in period ── */}
      <div>
        <p className="text-[10px] font-black text-slate-400 uppercase tracking-wider mb-2">Performance — {periodLabel.toLowerCase()}</p>
        <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-6 gap-3">
          <Kpi label="Released" value={fmtInt(periodNums.released)} sub="new pools entered production" icon={TrendingUp} color="indigo" onClick={() => openPoolList('Pools released in period', pools.filter(p => period === 'all' || inRange(toDay(p.createdAt), range.start, range.end)), `released ${periodText}`)} />
          <Kpi label="Delivered" value={fmtInt(periodNums.delivered)} sub="pools handed over" icon={Truck} color="violet" onClick={() => openDeliveredList('Pools delivered in period', pools.filter(p => p.isDelivered && inRange(toDay(p.deliveredAt), range.start, range.end)), `delivered ${periodText}`)} />
          <Kpi label="QC Approvals" value={fmtInt(totals.approvedPeriod)} sub="stage sign-offs" icon={CheckCircle2} color="emerald" onClick={() => openApprovals()} />
          <Kpi label="Rejections" value={fmtInt(periodNums.rejectionsPeriod)} sub={`${fmtInt(totals.rejections)} all time`} icon={XCircle} color="rose" testid="kpi-rejections" onClick={openRejections} />
          <Kpi label="First-Pass Yield" value={totals.approvedAll ? `${totals.firstPassYield}%` : '—'} sub="stages approved with no rework" icon={ShieldCheck} color="teal" onClick={openFirstPass} />
          <Kpi label="Avg Lead Time" value={periodNums.avgLeadDays ? `${periodNums.avgLeadDays.toFixed(1)} d` : '—'} sub="release → delivery" icon={Gauge} color="slate" onClick={() => openDeliveredList('Delivered pools — lead time', pools.filter(p => p.isDelivered && inRange(toDay(p.deliveredAt), range.start, range.end)), `delivered ${periodText}`)} />
        </div>
      </div>

      {/* ── Attention alerts ── */}
      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-3">
        {bottleneck ? (
          <AlertTile
            tone="rose" icon={AlertTriangle} title="Slowest stage"
            value={bottleneck.name}
            detail={`Average ${fmtMin(bottleneck.avg)} per pool (worst ${fmtMin(bottleneck.max)}) · ${bottleneck.queue} pool(s) in this stage now`}
            onClick={() => openStagePools(bottleneck.id, bottleneck.name, 'QUEUE')}
          />
        ) : (
          <AlertTile tone="emerald" icon={CheckCircle2} title="Slowest stage" value="Not enough data" detail="Needs at least 3 completed pools per stage in this period" />
        )}
        {biggestQueue && biggestQueue.queue > 0 ? (
          <AlertTile
            tone="amber" icon={Layers} title="Biggest queue"
            value={`${biggestQueue.name} — ${biggestQueue.queue} pools`}
            detail={`${biggestQueue.waiting} waiting · ${biggestQueue.inProgress} in progress · ${biggestQueue.awaitingQc} awaiting QC`}
            onClick={() => openStagePools(biggestQueue.id, biggestQueue.name, 'QUEUE')}
          />
        ) : (
          <AlertTile tone="emerald" icon={Layers} title="Biggest queue" value="No queue" detail="No pools are waiting at any stage" />
        )}
        <AlertTile
          tone={delivery.buckets.overdue > 0 ? 'rose' : 'emerald'} icon={CalendarClock} title="Overdue deliveries"
          value={`${delivery.buckets.overdue} pool(s)`}
          detail={delivery.buckets.overdue > 0 ? `${delivery.readyCount.overdue} of them are already ready to go out` : 'Nothing past its scheduled delivery date'}
          onClick={delivery.buckets.overdue > 0 ? openOverdue : undefined}
        />
        <AlertTile
          tone={defectStats.openCount > 0 ? 'amber' : 'emerald'} icon={ShieldCheck} title="Open quality defects"
          value={`${defectStats.openCount} open`}
          detail={defectStats.openCount > 0 ? `${defectStats.openCritical} critical · ${state.onHold.length} pool(s) on hold` : 'No open defects'}
          onClick={defectStats.openCount > 0 ? openDefects : undefined}
        />
      </div>

      {/* ── Production trend ── */}
      <Card
        title={<><TrendingUp className="h-4 w-4 text-indigo-600" /> Production Trend</>}
        subtitle={`Released, QC-approved and delivered pools plus rejections — ${periodLabel.toLowerCase()}.`}
      >
        <ResponsiveContainer width="100%" height={280}>
          <ComposedChart data={trend}>
            <defs>
              <linearGradient id="gRel" x1="0" x2="0" y1="0" y2="1"><stop offset="0%" stopColor="#6366f1" stopOpacity={0.35} /><stop offset="100%" stopColor="#6366f1" stopOpacity={0} /></linearGradient>
              <linearGradient id="gApp" x1="0" x2="0" y1="0" y2="1"><stop offset="0%" stopColor="#10b981" stopOpacity={0.3} /><stop offset="100%" stopColor="#10b981" stopOpacity={0} /></linearGradient>
              <linearGradient id="gDel" x1="0" x2="0" y1="0" y2="1"><stop offset="0%" stopColor="#f59e0b" stopOpacity={0.35} /><stop offset="100%" stopColor="#f59e0b" stopOpacity={0} /></linearGradient>
            </defs>
            <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
            <XAxis dataKey="label" tick={{ fontSize: 10, fill: '#64748b' }} interval="preserveStartEnd" minTickGap={18} />
            <YAxis tick={{ fontSize: 10, fill: '#64748b' }} allowDecimals={false} />
            <Tooltip contentStyle={TOOLTIP_STYLE} />
            <Legend wrapperStyle={{ fontSize: 11 }} />
            <Area type="monotone" dataKey="released" name="Released" stroke="#6366f1" fill="url(#gRel)" strokeWidth={2} />
            <Area type="monotone" dataKey="approved" name="QC approved" stroke="#10b981" fill="url(#gApp)" strokeWidth={2} />
            <Area type="monotone" dataKey="delivered" name="Delivered" stroke="#f59e0b" fill="url(#gDel)" strokeWidth={2} />
            <Line type="monotone" dataKey="rejected" name="Rejections" stroke="#ef4444" strokeWidth={2} dot={false} />
          </ComposedChart>
        </ResponsiveContainer>
      </Card>

      {/* ── Pipeline + month target ── */}
      <div className="grid grid-cols-1 xl:grid-cols-3 gap-6">
        <Card
          className="xl:col-span-2"
          title={<><Layers className="h-4 w-4 text-indigo-600" /> Pipeline — Pools at Each Stage Right Now</>}
          subtitle={`Waiting to be claimed, being worked, awaiting QC sign-off, or sent back for rework — ${scopeText}.`}
        >
          <ResponsiveContainer width="100%" height={Math.max(320, STAGES.length * 30)}>
            <BarChart data={wipChartData} layout="vertical" margin={{ left: 10 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" horizontal={false} />
              <XAxis type="number" tick={{ fontSize: 10, fill: '#64748b' }} allowDecimals={false} />
              <YAxis type="category" dataKey="name" tick={{ fontSize: 11, fill: '#475569' }} width={110} />
              <Tooltip contentStyle={TOOLTIP_STYLE} />
              <Legend wrapperStyle={{ fontSize: 11 }} />
              <Bar dataKey="Waiting" stackId="w" fill="#94a3b8" />
              <Bar dataKey="In Progress" stackId="w" fill="#3b82f6" />
              <Bar dataKey="Awaiting QC" stackId="w" fill="#f59e0b" />
              <Bar dataKey="Rework" stackId="w" fill="#ef4444" radius={[0, 6, 6, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </Card>

        <div className="space-y-6">
          {monthTarget ? (
            <div className="bg-gradient-to-br from-indigo-600 to-violet-600 rounded-2xl p-5 text-white shadow-lg">
              <p className="text-[10px] uppercase font-bold text-indigo-200 tracking-wider">{monthTarget.name} Delivery Target</p>
              <div className="flex items-end justify-between mt-1">
                <h3 className="text-3xl font-black leading-none">{monthTarget.delivered} <span className="text-lg text-indigo-200">/ {monthTarget.target}</span></h3>
                <div className="text-4xl font-black">{monthTarget.pct}%</div>
              </div>
              <div className="bg-white/20 rounded-full h-2.5 overflow-hidden mt-3">
                <div className="bg-white h-full" style={{ width: `${Math.min(monthTarget.pct, 100)}%` }} />
              </div>
              <p className="text-xs text-indigo-100 mt-3">
                {monthTarget.pct >= 100
                  ? 'Target reached ✓'
                  : `${monthTarget.remaining} pools to go · ${monthTarget.daysLeft} day(s) left · needs ${monthTarget.perDay.toFixed(1)} per day`}
              </p>
            </div>
          ) : (
            <Card title={<><Target className="h-4 w-4 text-indigo-600" /> Monthly Target</>}>
              <EmptyNote text="No target set for this month. Add one in Management → Monthly Targets." />
            </Card>
          )}

          <Card title={<><PieIcon className="h-4 w-4 text-indigo-600" /> Orientation</>} subtitle={`Normal vs Mirror — ${scopeText}.`}>
            <ResponsiveContainer width="100%" height={170}>
              <PieChart>
                <Pie data={orientationSplit} dataKey="value" nameKey="name" innerRadius={42} outerRadius={68} paddingAngle={3}>
                  {orientationSplit.map((s, i) => <Cell key={i} fill={s.color} />)}
                </Pie>
                <Tooltip contentStyle={TOOLTIP_STYLE} />
                <Legend wrapperStyle={{ fontSize: 11 }} />
              </PieChart>
            </ResponsiveContainer>
          </Card>
        </div>
      </div>

      {/* ── Stage performance table ── */}
      <Card
        title={<><Clock className="h-4 w-4 text-indigo-600" /> Stage Performance</>}
        subtitle={`Queue counts cover ${scopeText}; approvals, times and team output follow the period (${periodLabel.toLowerCase()}). Click any number to see the pools. Rejection rate = rejections ÷ (approvals + rejections), all time.`}
        right={<ExportBtn onClick={exportStages} />}
      >
        <div className="overflow-x-auto -mx-1">
          <table className="min-w-full text-xs">
            <thead>
              <tr className="border-b border-slate-100">
                <Th align="left">Stage</Th><Th>Waiting</Th><Th>In Progress</Th><Th>Awaiting QC</Th><Th>Rework</Th>
                <Th>Approved (period)</Th><Th>Approved (all)</Th><Th>Avg Time</Th><Th>Slowest</Th><Th>Rejections</Th><Th>Reject Rate</Th><Th>First-Pass</Th>
              </tr>
            </thead>
            <tbody>
              {stageStats.map(s => (
                <tr key={s.id} className="border-b border-slate-50 hover:bg-slate-50/60">
                  <td className="px-3 py-2 font-bold text-slate-700 whitespace-nowrap">
                    <span className="inline-block h-2 w-2 rounded-full mr-2 align-middle" style={{ background: s.color }} />{s.name}
                  </td>
                  <td onClick={() => s.waiting > 0 && openStagePools(s.id, s.name, 'NOT_STARTED')} className={`px-3 py-2 text-center font-mono text-slate-600 ${s.waiting > 0 ? 'cursor-pointer hover:bg-slate-100 hover:underline' : ''}`}>{s.waiting}</td>
                  <td onClick={() => s.inProgress > 0 && openStagePools(s.id, s.name, 'IN_PROGRESS')} className={`px-3 py-2 text-center font-mono text-blue-700 ${s.inProgress > 0 ? 'cursor-pointer hover:bg-blue-50 hover:underline' : ''}`}>{s.inProgress}</td>
                  <td onClick={() => s.awaitingQc > 0 && openStagePools(s.id, s.name, 'PENDING_INSPECTION')} className={`px-3 py-2 text-center font-mono text-amber-700 ${s.awaitingQc > 0 ? 'cursor-pointer hover:bg-amber-50 hover:underline' : ''}`}>{s.awaitingQc}</td>
                  <td onClick={() => s.rework > 0 && openStagePools(s.id, s.name, 'REJECTED')} className={`px-3 py-2 text-center font-mono ${s.rework ? 'text-rose-700 font-bold cursor-pointer hover:bg-rose-50 hover:underline' : 'text-slate-400'}`}>{s.rework}</td>
                  <td onClick={() => s.approvedPeriod > 0 && openApprovals(s.id, s.name)} className={`px-3 py-2 text-center font-mono font-bold text-emerald-700 ${s.approvedPeriod > 0 ? 'cursor-pointer hover:bg-emerald-50 hover:underline' : ''}`}>{s.approvedPeriod}</td>
                  <td className="px-3 py-2 text-center font-mono text-slate-500">{fmtInt(s.approvedAll)}</td>
                  <td className="px-3 py-2 text-center font-mono text-slate-700">{fmtMin(s.avg)}</td>
                  <td className="px-3 py-2 text-center font-mono text-slate-500">{fmtMin(s.max)}</td>
                  <td className="px-3 py-2 text-center font-mono text-rose-700">{fmtInt(s.rejections)}</td>
                  <td className="px-3 py-2 text-center">
                    <span className={`px-2 py-0.5 rounded-full text-[10px] font-black border ${
                      s.rejectionRate >= 25 ? 'bg-rose-50 text-rose-700 border-rose-200'
                        : s.rejectionRate >= 10 ? 'bg-amber-50 text-amber-700 border-amber-200'
                        : 'bg-emerald-50 text-emerald-700 border-emerald-200'
                    }`}>{s.approvedAll + s.rejections > 0 ? `${s.rejectionRate}%` : '—'}</span>
                  </td>
                  <td className="px-3 py-2 text-center font-mono text-slate-600">{s.approvedAll ? `${s.firstPassRate}%` : '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>

      {/* ── Time + rejection charts ── */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <Card title={<><Clock className="h-4 w-4 text-indigo-600" /> Average Time per Stage</>} subtitle="Hours of hands-on time per pool (QC holds excluded). Lower is faster.">
          <ResponsiveContainer width="100%" height={280}>
            <BarChart data={stageStats.map(s => ({ name: s.short, hours: Math.round((s.avg / 60) * 10) / 10, color: s.color }))}>
              <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
              <XAxis dataKey="name" tick={{ fontSize: 9, fill: '#64748b' }} angle={-30} textAnchor="end" height={64} interval={0} />
              <YAxis tick={{ fontSize: 10, fill: '#64748b' }} unit=" h" />
              <Tooltip contentStyle={TOOLTIP_STYLE} formatter={(v: any) => [`${v} h`, 'Average']} />
              <Bar dataKey="hours" radius={[6, 6, 0, 0]}>
                {stageStats.map((s, i) => <Cell key={i} fill={s.color} />)}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </Card>

        <Card title={<><XCircle className="h-4 w-4 text-rose-600" /> Rejections by Stage</>} subtitle="Where pools are most often sent back (all time).">
          <ResponsiveContainer width="100%" height={280}>
            <BarChart data={stageStats.map(s => ({ name: s.short, rejections: s.rejections }))}>
              <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
              <XAxis dataKey="name" tick={{ fontSize: 9, fill: '#64748b' }} angle={-30} textAnchor="end" height={64} interval={0} />
              <YAxis tick={{ fontSize: 10, fill: '#64748b' }} allowDecimals={false} />
              <Tooltip contentStyle={TOOLTIP_STYLE} />
              <Bar dataKey="rejections" name="Rejections" fill="#ef4444" radius={[6, 6, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </Card>
      </div>

      {/* ── Quality & defects ── */}
      <Card
        title={<><ShieldCheck className="h-4 w-4 text-indigo-600" /> Quality &amp; Defects (NCR)</>}
        subtitle={`Defects logged by QC — ${periodLabel.toLowerCase()}. ${defectStats.openCount} defect(s) currently open or on hold.`}
      >
        {defectStats.periodTotal === 0 ? (
          <EmptyNote text="No defects were logged in this period." />
        ) : (
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
            <div>
              <p className="text-[11px] font-bold text-slate-500 mb-1">By severity ({defectStats.periodTotal})</p>
              <ResponsiveContainer width="100%" height={220}>
                <PieChart>
                  <Pie data={defectStats.severity} dataKey="value" nameKey="name" innerRadius={45} outerRadius={78} paddingAngle={3}>
                    {defectStats.severity.map((s, i) => <Cell key={i} fill={s.color} />)}
                  </Pie>
                  <Tooltip contentStyle={TOOLTIP_STYLE} />
                  <Legend wrapperStyle={{ fontSize: 11 }} />
                </PieChart>
              </ResponsiveContainer>
            </div>
            <div>
              <p className="text-[11px] font-bold text-slate-500 mb-1">Top defect types</p>
              <ResponsiveContainer width="100%" height={220}>
                <BarChart data={defectStats.topTypes} layout="vertical" margin={{ left: 10 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" horizontal={false} />
                  <XAxis type="number" tick={{ fontSize: 10, fill: '#64748b' }} allowDecimals={false} />
                  <YAxis type="category" dataKey="name" tick={{ fontSize: 10, fill: '#475569' }} width={110} />
                  <Tooltip contentStyle={TOOLTIP_STYLE} />
                  <Bar dataKey="value" name="Defects" fill="#f59e0b" radius={[0, 6, 6, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>
            <div>
              <p className="text-[11px] font-bold text-slate-500 mb-1">Defects by stage</p>
              <ResponsiveContainer width="100%" height={220}>
                <BarChart data={defectStats.byStage} layout="vertical" margin={{ left: 10 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" horizontal={false} />
                  <XAxis type="number" tick={{ fontSize: 10, fill: '#64748b' }} allowDecimals={false} />
                  <YAxis type="category" dataKey="name" tick={{ fontSize: 10, fill: '#475569' }} width={110} />
                  <Tooltip contentStyle={TOOLTIP_STYLE} />
                  <Bar dataKey="value" name="Defects" fill="#6366f1" radius={[0, 6, 6, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </div>
        )}
      </Card>

      {/* ── Team performance ── */}
      <Card
        title={<><Users className="h-4 w-4 text-indigo-600" /> Team Performance</>}
        subtitle={`Stage sign-offs per team — ${periodLabel.toLowerCase()}. First-pass = approved without rework.`}
        right={<ExportBtn onClick={exportTeams} />}
      >
        {teamRows.length === 0 ? (
          <EmptyNote text="No stage completions in this period." />
        ) : (
          <div className="overflow-x-auto max-h-96 overflow-y-auto -mx-1">
            <table className="min-w-full text-xs">
              <thead className="sticky top-0 bg-white">
                <tr className="border-b border-slate-100">
                  <Th align="left">#</Th><Th align="left">Team</Th><Th align="left">Stage</Th><Th>Completed</Th><Th>Avg Time</Th><Th>Rejections</Th><Th>First-Pass</Th>
                </tr>
              </thead>
              <tbody>
                {teamRows.slice(0, 40).map((r, i) => (
                  <tr key={`${r.team}-${r.stage}`} className="border-b border-slate-50 hover:bg-slate-50/60">
                    <td className="px-3 py-2 text-slate-400 font-mono">{i + 1}</td>
                    <td className="px-3 py-2 font-bold text-slate-700 whitespace-nowrap">{r.team}</td>
                    <td className="px-3 py-2 text-slate-600 whitespace-nowrap">{r.stage}</td>
                    <td className="px-3 py-2 text-center font-mono font-bold text-emerald-700">{r.completed}</td>
                    <td className="px-3 py-2 text-center font-mono text-slate-600">{fmtMin(r.avg)}</td>
                    <td className="px-3 py-2 text-center font-mono text-rose-700">{r.rejections}</td>
                    <td className="px-3 py-2 text-center font-mono text-slate-600">{fmtPct(r.firstPass, r.completed)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            {teamRows.length > 40 && <p className="text-[10px] text-slate-400 px-3 py-2">Showing the top 40 of {teamRows.length}. Use Excel for the full list.</p>}
          </div>
        )}
      </Card>

      {/* ── Project progress ── */}
      <Card
        title={<><FolderKanban className="h-4 w-4 text-indigo-600" /> Project Progress</>}
        subtitle={`Every project's live status for ${scopeText}. Contract total comes from the project summary.`}
        right={<ExportBtn onClick={exportProjects} />}
      >
        {projectRows.length === 0 ? (
          <EmptyNote text="No projects yet." />
        ) : (
          <div className="overflow-x-auto max-h-[28rem] overflow-y-auto -mx-1">
            <table className="min-w-full text-xs">
              <thead className="sticky top-0 bg-white">
                <tr className="border-b border-slate-100">
                  <Th align="left">Project</Th><Th>Contract</Th><Th>Released</Th><Th>Active</Th><Th>Ready</Th><Th>Delivered</Th>
                  <Th align="left" className="min-w-[140px]">Delivered %</Th><Th>Rejections</Th><Th>On Hold</Th><Th>Overdue</Th>
                </tr>
              </thead>
              <tbody>
                {projectRows.map(r => {
                  const pct = r.total ? Math.round((r.delivered / r.total) * 100) : 0;
                  return (
                    <tr key={r.project} className="border-b border-slate-50 hover:bg-slate-50/60">
                      <td className="px-3 py-2 font-bold text-slate-700 whitespace-nowrap">{r.project}</td>
                      <td className="px-3 py-2 text-center font-mono text-slate-500">{r.contract ?? '—'}</td>
                      <td className="px-3 py-2 text-center font-mono text-slate-700">{r.total}</td>
                      <td className="px-3 py-2 text-center font-mono text-amber-700">{r.active}</td>
                      <td className="px-3 py-2 text-center font-mono text-emerald-700">{r.ready}</td>
                      <td className="px-3 py-2 text-center font-mono font-bold text-violet-700">{r.delivered}</td>
                      <td className="px-3 py-2">
                        <div className="flex items-center gap-2">
                          <div className="flex-1 h-2 bg-slate-100 rounded-full overflow-hidden">
                            <div className="h-full bg-violet-500" style={{ width: `${pct}%` }} />
                          </div>
                          <span className="font-mono text-[10px] text-slate-500 w-8 text-right">{pct}%</span>
                        </div>
                      </td>
                      <td className="px-3 py-2 text-center font-mono text-rose-700">{r.rejections}</td>
                      <td className={`px-3 py-2 text-center font-mono ${r.onHold ? 'text-rose-700 font-bold' : 'text-slate-400'}`}>{r.onHold}</td>
                      <td className={`px-3 py-2 text-center font-mono ${r.overdue ? 'text-rose-700 font-bold' : 'text-slate-400'}`}>{r.overdue}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      {/* ── Delivery outlook ── */}
      <Card
        title={<><Truck className="h-4 w-4 text-indigo-600" /> Delivery Outlook</>}
        subtitle={`Pools (${scopeText}) with a scheduled delivery date that have not gone out yet. ${delivery.unscheduled} pool(s) have no date set.`}
        right={<ExportBtn onClick={exportDelivery} />}
      >
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-4">
          {([
            ['Overdue', delivery.buckets.overdue, delivery.readyCount.overdue, 'text-rose-700 bg-rose-50 border-rose-100'],
            ['Next 7 days', delivery.buckets.week, delivery.readyCount.week, 'text-amber-700 bg-amber-50 border-amber-100'],
            ['8 – 30 days', delivery.buckets.month, delivery.readyCount.month, 'text-sky-700 bg-sky-50 border-sky-100'],
            ['Later', delivery.buckets.later, delivery.readyCount.later, 'text-slate-700 bg-slate-50 border-slate-200'],
          ] as [string, number, number, string][]).map(([label, n, ready, cls]) => (
            <div key={label} className={`rounded-xl border p-3 ${cls}`}>
              <p className="text-[10px] uppercase font-bold tracking-wider opacity-70">{label}</p>
              <p className="text-2xl font-black leading-none mt-1">{n}</p>
              <p className="text-[10px] opacity-70 mt-1">{ready} ready to go out</p>
            </div>
          ))}
        </div>
        {delivery.list.length === 0 ? (
          <EmptyNote text="No scheduled deliveries. Set dates in Management → Delivery Planner." />
        ) : (
          <div className="overflow-x-auto max-h-80 overflow-y-auto -mx-1">
            <table className="min-w-full text-xs">
              <thead className="sticky top-0 bg-white">
                <tr className="border-b border-slate-100">
                  <Th align="left">Pool</Th><Th align="left">Project</Th><Th>Scheduled</Th><Th>Days</Th><Th align="left">Current Stage</Th><Th>Ready</Th>
                </tr>
              </thead>
              <tbody>
                {delivery.list.slice(0, 30).map(r => (
                  <tr key={`${r.project}-${r.poolNo}`} className="border-b border-slate-50 hover:bg-slate-50/60">
                    <td className="px-3 py-2 font-mono font-bold text-slate-700">{r.poolNo}</td>
                    <td className="px-3 py-2 text-slate-600 whitespace-nowrap">{r.project}</td>
                    <td className="px-3 py-2 text-center font-mono text-slate-600">{r.scheduled}</td>
                    <td className={`px-3 py-2 text-center font-mono font-bold ${r.days < 0 ? 'text-rose-700' : r.days <= 7 ? 'text-amber-700' : 'text-slate-600'}`}>
                      {r.days < 0 ? `${Math.abs(r.days)} d late` : r.days === 0 ? 'Today' : `${r.days} d`}
                    </td>
                    <td className="px-3 py-2 text-slate-600 whitespace-nowrap">{r.stage}</td>
                    <td className="px-3 py-2 text-center">{r.ready ? <span className="text-emerald-600 font-black">✓</span> : <span className="text-slate-300">—</span>}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            {delivery.list.length > 30 && <p className="text-[10px] text-slate-400 px-3 py-2">Showing the 30 most urgent of {delivery.list.length}. Use Excel for the full list.</p>}
          </div>
        )}
      </Card>

      {/* ── Mix + recent activity ── */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <Card title={<><PieIcon className="h-4 w-4 text-indigo-600" /> Pool Types</>} subtitle={`${scopeText.charAt(0).toUpperCase()}${scopeText.slice(1)}, by type.`}>
          <ResponsiveContainer width="100%" height={230}>
            <PieChart>
              <Pie data={typeSplit} dataKey="value" nameKey="name" innerRadius={45} outerRadius={80} paddingAngle={3}>
                {typeSplit.map((s, i) => <Cell key={i} fill={s.color} />)}
              </Pie>
              <Tooltip contentStyle={TOOLTIP_STYLE} />
              <Legend wrapperStyle={{ fontSize: 11 }} />
            </PieChart>
          </ResponsiveContainer>
        </Card>

        <Card className="lg:col-span-2" title={<><History className="h-4 w-4 text-indigo-600" /> Recent Activity</>} subtitle="The latest events recorded on the shop floor.">
          {recent.length === 0 ? (
            <EmptyNote text="No activity recorded yet." />
          ) : (
            <div className="space-y-1.5 max-h-[15rem] overflow-y-auto pr-1">
              {recent.map(l => {
                const chip =
                  l.type === 'APPROVED' ? 'bg-emerald-50 text-emerald-700 border-emerald-200'
                    : l.type === 'REJECTED' ? 'bg-rose-50 text-rose-700 border-rose-200'
                    : l.type === 'CREATED' ? 'bg-indigo-50 text-indigo-700 border-indigo-200'
                    : 'bg-slate-50 text-slate-600 border-slate-200';
                const stageName = STAGES.find(s => s.id === l.stageId)?.name || l.stageId;
                const when = new Date(l.timestamp);
                return (
                  <div key={l.id} className="flex items-center gap-3 text-xs py-1.5 border-b border-slate-50">
                    <span className="font-mono text-[10px] text-slate-400 w-28 shrink-0">
                      {isNaN(when.getTime()) ? '—' : when.toLocaleString('en-GB', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' })}
                    </span>
                    <span className={`px-2 py-0.5 rounded-full text-[9px] font-black border shrink-0 ${chip}`}>{l.type.replace('_', ' ')}</span>
                    <span className="font-bold text-slate-700 truncate">{l.projectName} #{l.poolNo}</span>
                    <span className="text-slate-400 truncate hidden md:inline">{stageName}</span>
                    <span className="text-slate-400 truncate ml-auto hidden md:inline">{l.teamName || l.operatorName}</span>
                  </div>
                );
              })}
            </div>
          )}
        </Card>
      </div>

      {drill && <DrillModal data={drill} onClose={() => setDrill(null)} />}
    </div>
  );
};
