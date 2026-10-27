import React, { useMemo, useState } from 'react';
import { Pool, ActivityLog, ProjectSummary, MonthlyTarget, PlannedPool, Team, StageHistory } from '../types';
import { QCDefect } from './QCDefectPanel';
import { STAGES, getDualGroupForIndex } from '../data/mockData';
import {
  Layers, Activity, Target, Zap, AlertTriangle, Clock, TrendingUp, PauseCircle, Truck,
  ShieldCheck, ClipboardList, Download, Users, FolderKanban, CalendarClock, PieChart as PieIcon,
  CheckCircle2, XCircle, History, Package, Gauge
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

const Kpi: React.FC<{ label: string; value: React.ReactNode; sub?: string; icon: any; color: string; testid?: string }> =
  ({ label, value, sub, icon: Icon, color, testid }) => (
    <div className="bg-white border border-slate-100 rounded-2xl p-4 shadow-sm" data-testid={testid}>
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="text-[10px] uppercase font-bold text-slate-400 tracking-wider">{label}</p>
          <p className="text-2xl font-black text-slate-800 mt-1 leading-none">{value}</p>
          {sub && <p className="text-[10px] text-slate-400 mt-1.5 leading-snug">{sub}</p>}
        </div>
        <div className={`${KPI_COLORS[color] || KPI_COLORS.slate} rounded-xl p-2.5 shrink-0`}>
          <Icon className="h-4 w-4" />
        </div>
      </div>
    </div>
  );

const AlertTile: React.FC<{ tone: 'rose' | 'amber' | 'sky' | 'emerald'; icon: any; title: string; value: string; detail: string }> =
  ({ tone, icon: Icon, title, value, detail }) => {
    const tones = {
      rose: 'from-rose-50 to-white border-rose-100 text-rose-600 bg-rose-100',
      amber: 'from-amber-50 to-white border-amber-100 text-amber-600 bg-amber-100',
      sky: 'from-sky-50 to-white border-sky-100 text-sky-600 bg-sky-100',
      emerald: 'from-emerald-50 to-white border-emerald-100 text-emerald-600 bg-emerald-100',
    }[tone].split(' ');
    return (
      <div className={`bg-gradient-to-r ${tones[0]} ${tones[1]} border ${tones[2]} rounded-2xl p-4 flex items-start gap-3`}>
        <div className={`${tones[4]} ${tones[3]} rounded-xl p-2.5 shrink-0`}><Icon className="h-5 w-5" /></div>
        <div className="min-w-0">
          <p className="text-[10px] uppercase font-bold text-slate-400 tracking-wider">{title}</p>
          <p className="font-black text-slate-800 text-base leading-tight mt-0.5">{value}</p>
          <p className="text-[11px] text-slate-500 mt-0.5 leading-snug">{detail}</p>
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
  const range = useMemo(() => periodRange(period), [period]);
  const today = isoDay(new Date());
  const periodLabel = PERIOD_OPTIONS.find(o => o.id === period)?.label || '';

  const stageIndexById = useMemo(() => {
    const m: Record<string, number> = {};
    STAGES.forEach((s, i) => { m[s.id] = i; });
    return m;
  }, []);

  // ── pool buckets (current state) ──────────────────────────────────────────
  const state = useMemo(() => {
    const active = pools.filter(p => !p.isDelivered && p.currentStageIndex < STAGES.length);
    const ready = pools.filter(p => !p.isDelivered && p.currentStageIndex >= STAGES.length);
    const delivered = pools.filter(p => !!p.isDelivered);
    const onHold = active.filter(p => !!p.isOnHold);
    const planned = plannedPools.filter(p => p.status === 'PLANNED');
    return { active, ready, delivered, onHold, planned };
  }, [pools, plannedPools]);

  // ── stage metrics ─────────────────────────────────────────────────────────
  const stageStats = useMemo(() => {
    return STAGES.map((stage, idx) => {
      let waiting = 0, inProgress = 0, awaitingQc = 0, rework = 0;
      let approvedAll = 0, approvedPeriod = 0, rejections = 0, firstPass = 0;
      const periodDurations: number[] = [];

      pools.forEach(p => {
        const h = (p.stageHistory as any)?.[stage.id] as StageHistory | undefined;

        // where is this pool right now?
        if (!p.isDelivered && p.currentStageIndex < STAGES.length) {
          const group = getDualGroupForIndex(p.currentStageIndex);
          const atStage = p.currentStageIndex === idx || (group ? group.includes(stage.id) : false);
          if (atStage) {
            const st = h?.status || 'NOT_STARTED';
            if (st === 'NOT_STARTED') waiting++;
            else if (st === 'IN_PROGRESS') inProgress++;
            else if (st === 'PENDING_INSPECTION') awaitingQc++;
            else if (st === 'REJECTED') rework++;
          }
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
  }, [pools, range]);

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
    pools.forEach(p => {
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
  }, [pools, projectsSummary, today]);

  // ── delivery outlook ──────────────────────────────────────────────────────
  const delivery = useMemo(() => {
    const addDays = (n: number) => { const d = new Date(); d.setDate(d.getDate() + n); return isoDay(d); };
    const in7 = addDays(7), in30 = addDays(30);
    const scheduled = pools.filter(p => !p.isDelivered && p.scheduledDeliveryDate);
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
    return { buckets, readyCount, list, unscheduled: pools.filter(p => !p.isDelivered && !p.scheduledDeliveryDate).length };
  }, [pools, today]);

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
    pools.forEach(p => { const k = p.orientation || 'Unknown'; c[k] = (c[k] || 0) + 1; });
    return Object.entries(c).map(([name, value], i) => ({ name, value, color: ['#3b82f6', '#a855f7', '#94a3b8'][i % 3] }));
  }, [pools]);

  const typeSplit = useMemo(() => {
    const c: Record<string, number> = {};
    pools.forEach(p => { const k = p.poolType || 'Unspecified'; c[k] = (c[k] || 0) + 1; });
    return Object.entries(c).map(([name, value], i) => ({ name, value, color: PALETTE[i % PALETTE.length] })).sort((a, b) => b.value - a.value);
  }, [pools]);

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
            <p className="text-[11px] text-slate-400">Live data · {periodLabel}{period !== 'all' ? ` (${range.start} → ${range.end})` : ''}</p>
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
        <p className="text-[10px] font-black text-slate-400 uppercase tracking-wider mb-2">Factory status — right now</p>
        <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-6 gap-3">
          <Kpi label="Total Pools" value={fmtInt(pools.length)} sub="released to the floor" icon={Layers} color="indigo" testid="kpi-total" />
          <Kpi label="In Production" value={fmtInt(state.active.length)} sub={`${fmtPct(state.active.length, pools.length)} of all pools`} icon={Activity} color="amber" testid="kpi-inprod" />
          <Kpi label="Ready / In Stock" value={fmtInt(state.ready.length)} sub="finished, not yet delivered" icon={Package} color="emerald" testid="kpi-completed" />
          <Kpi label="Delivered" value={fmtInt(state.delivered.length)} sub={`${fmtPct(state.delivered.length, pools.length)} of all pools`} icon={Zap} color="violet" testid="kpi-delivered" />
          <Kpi label="Planned (Not Released)" value={fmtInt(state.planned.length)} sub="waiting in Planning" icon={ClipboardList} color="sky" testid="kpi-planned" />
          <Kpi label="On QC Hold" value={fmtInt(state.onHold.length)} sub="blocked until QC releases" icon={PauseCircle} color={state.onHold.length ? 'rose' : 'slate'} testid="kpi-hold" />
        </div>
      </div>

      {/* ── KPI row 2: performance in period ── */}
      <div>
        <p className="text-[10px] font-black text-slate-400 uppercase tracking-wider mb-2">Performance — {periodLabel.toLowerCase()}</p>
        <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-6 gap-3">
          <Kpi label="Released" value={fmtInt(periodNums.released)} sub="new pools entered production" icon={TrendingUp} color="indigo" />
          <Kpi label="Delivered" value={fmtInt(periodNums.delivered)} sub="pools handed over" icon={Truck} color="violet" />
          <Kpi label="QC Approvals" value={fmtInt(totals.approvedPeriod)} sub="stage sign-offs" icon={CheckCircle2} color="emerald" />
          <Kpi label="Rejections" value={fmtInt(periodNums.rejectionsPeriod)} sub={`${fmtInt(totals.rejections)} all time`} icon={XCircle} color="rose" testid="kpi-rejections" />
          <Kpi label="First-Pass Yield" value={totals.approvedAll ? `${totals.firstPassYield}%` : '—'} sub="stages approved with no rework" icon={ShieldCheck} color="teal" />
          <Kpi label="Avg Lead Time" value={periodNums.avgLeadDays ? `${periodNums.avgLeadDays.toFixed(1)} d` : '—'} sub="release → delivery" icon={Gauge} color="slate" />
        </div>
      </div>

      {/* ── Attention alerts ── */}
      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-3">
        {bottleneck ? (
          <AlertTile
            tone="rose" icon={AlertTriangle} title="Slowest stage"
            value={bottleneck.name}
            detail={`Average ${fmtMin(bottleneck.avg)} per pool (worst ${fmtMin(bottleneck.max)}) · ${bottleneck.queue} pool(s) in this stage now`}
          />
        ) : (
          <AlertTile tone="emerald" icon={CheckCircle2} title="Slowest stage" value="Not enough data" detail="Needs at least 3 completed pools per stage in this period" />
        )}
        {biggestQueue && biggestQueue.queue > 0 ? (
          <AlertTile
            tone="amber" icon={Layers} title="Biggest queue"
            value={`${biggestQueue.name} — ${biggestQueue.queue} pools`}
            detail={`${biggestQueue.waiting} waiting · ${biggestQueue.inProgress} in progress · ${biggestQueue.awaitingQc} awaiting QC`}
          />
        ) : (
          <AlertTile tone="emerald" icon={Layers} title="Biggest queue" value="No queue" detail="No pools are waiting at any stage" />
        )}
        <AlertTile
          tone={delivery.buckets.overdue > 0 ? 'rose' : 'emerald'} icon={CalendarClock} title="Overdue deliveries"
          value={`${delivery.buckets.overdue} pool(s)`}
          detail={delivery.buckets.overdue > 0 ? `${delivery.readyCount.overdue} of them are already ready to go out` : 'Nothing past its scheduled delivery date'}
        />
        <AlertTile
          tone={defectStats.openCount > 0 ? 'amber' : 'emerald'} icon={ShieldCheck} title="Open quality defects"
          value={`${defectStats.openCount} open`}
          detail={defectStats.openCount > 0 ? `${defectStats.openCritical} critical · ${state.onHold.length} pool(s) on hold` : 'No open defects'}
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
          subtitle="Waiting to be claimed, being worked, awaiting QC sign-off, or sent back for rework."
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

          <Card title={<><PieIcon className="h-4 w-4 text-indigo-600" /> Orientation</>} subtitle="Normal vs Mirror across all pools.">
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
        subtitle={`Queue is live. Approvals, times and team output follow the period (${periodLabel.toLowerCase()}). Rejection rate = rejections ÷ (approvals + rejections), all time.`}
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
                  <td className="px-3 py-2 text-center font-mono text-slate-600">{s.waiting}</td>
                  <td className="px-3 py-2 text-center font-mono text-blue-700">{s.inProgress}</td>
                  <td className="px-3 py-2 text-center font-mono text-amber-700">{s.awaitingQc}</td>
                  <td className={`px-3 py-2 text-center font-mono ${s.rework ? 'text-rose-700 font-bold' : 'text-slate-400'}`}>{s.rework}</td>
                  <td className="px-3 py-2 text-center font-mono font-bold text-emerald-700">{s.approvedPeriod}</td>
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
        subtitle="Every project with its live status. Contract total comes from the project summary; the rest is counted from pools on the floor."
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
        subtitle={`Pools with a scheduled delivery date that have not gone out yet. ${delivery.unscheduled} pool(s) in production have no date set.`}
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
        <Card title={<><PieIcon className="h-4 w-4 text-indigo-600" /> Pool Types</>} subtitle="All pools by type.">
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
    </div>
  );
};
