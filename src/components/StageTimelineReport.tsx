import React, { useEffect, useMemo, useRef, useState } from 'react';
import * as XLSX from 'xlsx';
import { CalendarClock, Download, Loader2, RotateCcw, Search } from 'lucide-react';
import { ActivityLog, Pool, Team } from '../types';
import { STAGES, canonicalStageId } from '../data/mockData';
import { dbFetchActivityLogsInRange } from '../lib/firebaseService';

// Stage Timeline Report — Management portal
// ──────────────────────────────────────────────────────────────────────────
// Answers: "how many pools STARTED in each stage (Steel, Primer, …), when did
// each one FINISH, what was the QC result, and — if QC rejected it — when was
// it restarted and when did the rework finish?"
//
// One ROW = one ATTEMPT of one pool at one stage:
//   attempt 1  = the original run
//   attempt 2+ = rework after a QC rejection (the app auto-starts rework at the
//                moment of rejection, so "restarted" = the rejection time)
//
// Data sources (best first):
//   1. activity logs (live cache + permanent archive) → full attempt history
//   2. pool.stageHistory → used when a pool/stage has no logs at all, and to
//      fill in the latest attempt's times / status
//
// Nothing here writes to the database — it is read-only, so no migration or
// data change is needed.

interface StageTimelineReportProps {
  pools: Pool[];
  teams: Team[];
  logs: ActivityLog[];
  inspectors?: { id: string; name: string; title?: string }[];
}

type RangePreset = 'today' | 'week' | 'month' | 'all' | 'custom';
type GroupBy = 'day' | 'week' | 'month' | 'total';
type Metric = 'started' | 'restarted' | 'finished' | 'approved' | 'rejected';
type QcFilter = 'ALL' | 'APPROVED' | 'REJECTED' | 'PENDING_QC' | 'IN_PROGRESS';

interface Attempt {
  key: string;
  poolId: string;
  poolNo: string;
  projectName: string;
  stageId: string;
  stageName: string;
  stageColor: string;
  attemptNo: number; // 1 = original, 2+ = rework
  teamName: string;
  startedAt: string | null; // ISO
  finishedAt: string | null; // ISO — team sent it to QC
  qcResult: 'APPROVED' | 'REJECTED' | null;
  qcAt: string | null; // ISO — when QC approved / rejected
  inspector: string;
  qcNotes: string;
  durationMin: number | null;
  restartedAt: string | null; // for a REJECTED attempt: when the rework started
  fromRecordOnly: boolean; // true = rebuilt from the stage record (no logs)
}

// ── date helpers (all LOCAL time, so UAE midnight is not shifted by UTC) ──
const pad2 = (n: number) => (n < 10 ? `0${n}` : String(n));
const localDay = (iso: string | null | undefined): string => {
  if (!iso) return '';
  const d = new Date(iso);
  if (isNaN(d.getTime())) return '';
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
};
const dayFromDate = (d: Date) => `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
const shiftDay = (day: string, delta: number) => {
  const d = new Date(`${day}T00:00:00`);
  d.setDate(d.getDate() + delta);
  return dayFromDate(d);
};
const mondayOf = (day: string) => {
  const d = new Date(`${day}T00:00:00`);
  const diff = (d.getDay() + 6) % 7; // Monday = 0
  d.setDate(d.getDate() - diff);
  return dayFromDate(d);
};
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const fmtDT = (iso: string | null | undefined): string => {
  if (!iso) return '—';
  const d = new Date(iso);
  if (isNaN(d.getTime())) return '—';
  return `${pad2(d.getDate())}/${pad2(d.getMonth() + 1)}/${d.getFullYear()} ${pad2(d.getHours())}:${pad2(d.getMinutes())}`;
};
const fmtDay = (day: string) => {
  const [y, m, d] = day.split('-').map(Number);
  return `${pad2(d)} ${MONTHS[m - 1]} ${y}`;
};
const fmtDuration = (min: number | null): string => {
  if (min == null || !isFinite(min)) return '—';
  if (min < 60) return `${Math.round(min)} min`;
  const h = Math.floor(min / 60);
  const m = Math.round(min % 60);
  return m ? `${h}h ${m}m` : `${h}h`;
};
const periodKey = (day: string, groupBy: GroupBy): string => {
  if (groupBy === 'day') return day;
  if (groupBy === 'week') return mondayOf(day);
  if (groupBy === 'month') return day.slice(0, 7);
  return 'total';
};
const periodLabel = (key: string, groupBy: GroupBy): string => {
  if (groupBy === 'day') return fmtDay(key);
  if (groupBy === 'week') return `Week of ${fmtDay(key)} (Mon–Sun)`;
  if (groupBy === 'month') {
    const [y, m] = key.split('-').map(Number);
    return `${MONTHS[m - 1]} ${y}`;
  }
  return 'Total';
};

const ms = (iso: string | null | undefined) => {
  const t = iso ? new Date(iso).getTime() : NaN;
  return isNaN(t) ? 0 : t;
};

export const StageTimelineReport: React.FC<StageTimelineReportProps> = ({ pools, teams, logs, inspectors = [] }) => {
  const todayStr = dayFromDate(new Date());

  // Earliest pool creation day — the "All time" start, and the floor for how
  // far back the log archive is ever read (keeps Firestore reads small).
  const earliestDay = useMemo(() => {
    let min = '';
    pools.forEach(p => {
      const d = localDay(p.createdAt);
      if (d && (!min || d < min)) min = d;
    });
    return min || shiftDay(todayStr, -365);
  }, [pools, todayStr]);

  const [preset, setPreset] = useState<RangePreset>('today');
  const [from, setFrom] = useState<string>(todayStr);
  const [to, setTo] = useState<string>(todayStr);
  const [groupBy, setGroupBy] = useState<GroupBy>('day');
  const [metric, setMetric] = useState<Metric>('started');
  const [projectFilter, setProjectFilter] = useState<string>('all');
  const [stageFilter, setStageFilter] = useState<string>('all');
  const [qcFilter, setQcFilter] = useState<QcFilter>('ALL');
  const [search, setSearch] = useState('');
  const [visibleRows, setVisibleRows] = useState(100);

  const applyPreset = (p: RangePreset) => {
    setPreset(p);
    setVisibleRows(100);
    if (p === 'today') { setFrom(todayStr); setTo(todayStr); setGroupBy('day'); }
    else if (p === 'week') { setFrom(mondayOf(todayStr)); setTo(todayStr); setGroupBy('day'); }
    else if (p === 'month') { setFrom(`${todayStr.slice(0, 7)}-01`); setTo(todayStr); setGroupBy('week'); }
    else if (p === 'all') { setFrom(earliestDay); setTo(todayStr); setGroupBy('month'); }
  };

  // ── Load the permanent log archive. Each attempt needs the whole story of
  // its pool + stage, so read a bit further back than the selected range. ──
  const [archiveLogs, setArchiveLogs] = useState<ActivityLog[]>([]);
  const [loading, setLoading] = useState(false);
  const fetchedFromRef = useRef<string>('');

  const needFrom = useMemo(() => {
    const back = shiftDay(from, -45);
    return back < earliestDay ? earliestDay : back;
  }, [from, earliestDay]);

  useEffect(() => {
    // Already have everything from an equal-or-earlier day → no re-read.
    if (fetchedFromRef.current && needFrom >= fetchedFromRef.current) return;
    let cancelled = false;
    setLoading(true);
    dbFetchActivityLogsInRange(shiftDay(needFrom, -1), shiftDay(todayStr, 1))
      .then(rows => {
        if (cancelled) return;
        fetchedFromRef.current = needFrom;
        setArchiveLogs(rows);
      })
      .catch(() => { if (!cancelled) setArchiveLogs([]); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [needFrom, todayStr]);

  // ── Build every attempt (all time); date filtering happens afterwards ──
  const attempts = useMemo<Attempt[]>(() => {
    const inspectorName = (raw: string | undefined) => {
      if (!raw) return '—';
      return inspectors.find(i => i.id === raw)?.name || raw;
    };
    const teamNameOf = (teamId?: string, fallback?: string) =>
      (teamId && teams.find(t => t.id === teamId)?.name) || fallback || '—';

    // 1) merge live + archived logs, de-duplicate
    const seen = new Set<string>();
    const allLogs: ActivityLog[] = [];
    [...logs, ...archiveLogs].forEach(l => {
      if (!l || !l.timestamp || !l.poolId || l.poolId === 'scrapped') return;
      const key = `${l.id}|${l.poolId}|${l.type}|${l.stageId}`;
      if (seen.has(key)) return;
      seen.add(key);
      allLogs.push(l);
    });

    // 2) group by pool + canonical stage
    const byPoolStage = new Map<string, ActivityLog[]>();
    allLogs.forEach(l => {
      if (l.type === 'CREATED') return;
      const sid = canonicalStageId(l.stageId as string);
      const k = `${l.poolId}|${sid}`;
      if (!byPoolStage.has(k)) byPoolStage.set(k, []);
      byPoolStage.get(k)!.push(l);
    });

    const poolById = new Map(pools.map(p => [p.id, p]));
    const out: Attempt[] = [];

    STAGES.forEach(stage => {
      pools.forEach(pool => {
        const hist: any = (pool.stageHistory as any)?.[stage.id];
        const events = (byPoolStage.get(`${pool.id}|${stage.id}`) || []).slice().sort((a, b) => ms(a.timestamp) - ms(b.timestamp));
        const hasHistory = !!hist && hist.status && hist.status !== 'NOT_STARTED' && hist.status !== 'SKIPPED' && hist.status !== 'CARRIED_ON_SITE';

        // No logs for this pool+stage → rebuild one row from the stage record.
        if (events.length === 0) {
          if (!hasHistory || !hist.startTime) return;
          const approved = hist.status === 'APPROVED';
          const rework = Number(hist.rejectionCount) || 0;
          out.push({
            key: `rec-${pool.id}-${stage.id}`,
            poolId: pool.id,
            poolNo: pool.poolNo,
            projectName: pool.projectName,
            stageId: stage.id,
            stageName: stage.name,
            stageColor: stage.color,
            attemptNo: rework + 1,
            teamName: teamNameOf(hist.teamId, hist.teamName),
            startedAt: hist.startTime || null,
            finishedAt: hist.endTime || null,
            qcResult: approved ? 'APPROVED' : null,
            qcAt: approved ? (hist.inspectionTime || null) : null,
            inspector: inspectorName(hist.inspectorId),
            qcNotes: (hist.inspectorNotes || '') + (rework ? ` [${rework} earlier rejection(s) — only the latest run is recorded]` : ''),
            durationMin: hist.durationMinutes ?? null,
            restartedAt: null,
            fromRecordOnly: true,
          });
          return;
        }

        // Walk the logs: STARTED → FINISHED → APPROVED / REJECTED (→ restart)
        const stageAttempts: Attempt[] = [];
        let cur: Attempt | null = null;
        const newAttempt = (n: number): Attempt => ({
          key: `${pool.id}-${stage.id}-${n}`,
          poolId: pool.id,
          poolNo: pool.poolNo,
          projectName: pool.projectName,
          stageId: stage.id,
          stageName: stage.name,
          stageColor: stage.color,
          attemptNo: n,
          teamName: '—',
          startedAt: null,
          finishedAt: null,
          qcResult: null,
          qcAt: null,
          inspector: '—',
          qcNotes: '',
          durationMin: null,
          restartedAt: null,
          fromRecordOnly: false,
        });
        const open = () => {
          if (!cur) { cur = newAttempt(stageAttempts.length + 1); stageAttempts.push(cur); }
          return cur;
        };

        events.forEach(ev => {
          const team = teamNameOf(ev.teamId, ev.teamName);
          if (ev.type === 'STAGE_STARTED') {
            // A closed attempt (approved) followed by a new start = a fresh run.
            if (cur && cur.qcResult === 'APPROVED') cur = null;
            const a = open();
            if (!a.startedAt) a.startedAt = ev.timestamp;
            if (a.teamName === '—') a.teamName = team;
          } else if (ev.type === 'STAGE_FINISHED') {
            const a = open();
            a.finishedAt = ev.timestamp;
            if (a.teamName === '—') a.teamName = team;
          } else if (ev.type === 'APPROVED') {
            const a = open();
            a.qcResult = 'APPROVED';
            a.qcAt = ev.timestamp;
            a.inspector = inspectorName(ev.operatorName);
            a.qcNotes = ev.notes || '';
            if (a.teamName === '—') a.teamName = team;
            cur = null;
          } else if (ev.type === 'REJECTED') {
            const a = open();
            a.qcResult = 'REJECTED';
            a.qcAt = ev.timestamp;
            a.inspector = inspectorName(ev.operatorName);
            a.qcNotes = ev.notes || '';
            if (a.teamName === '—') a.teamName = team;
            // The app auto-starts rework at the moment of rejection.
            const next = newAttempt(stageAttempts.length + 1);
            next.startedAt = ev.timestamp;
            next.teamName = a.teamName;
            a.restartedAt = ev.timestamp;
            stageAttempts.push(next);
            cur = next;
          }
        });

        // Fill the LATEST attempt from the stage record (exact times / status).
        const last = stageAttempts[stageAttempts.length - 1];
        if (last && hasHistory) {
          if (!last.startedAt && hist.startTime) last.startedAt = hist.startTime;
          if (!last.finishedAt && hist.endTime) last.finishedAt = hist.endTime;
          if (last.teamName === '—') last.teamName = teamNameOf(hist.teamId, hist.teamName);
          if (!last.qcResult && hist.status === 'APPROVED') {
            last.qcResult = 'APPROVED';
            last.qcAt = hist.inspectionTime || last.qcAt;
            last.inspector = inspectorName(hist.inspectorId);
            last.qcNotes = hist.inspectorNotes || last.qcNotes;
          }
          if (hist.durationMinutes != null && last.finishedAt && last.qcResult !== 'REJECTED') {
            last.durationMin = hist.durationMinutes;
          }
        }
        // Duration for every other attempt = finish − start.
        stageAttempts.forEach(a => {
          if (a.durationMin == null && a.startedAt && a.finishedAt) {
            const diff = (ms(a.finishedAt) - ms(a.startedAt)) / 60000;
            if (diff >= 0) a.durationMin = Math.max(1, Math.round(diff));
          }
        });
        out.push(...stageAttempts);
      });
    });

    // Drop attempts of pools that no longer exist (scrapped / deleted).
    return out.filter(a => poolById.has(a.poolId));
  }, [pools, teams, logs, archiveLogs, inspectors]);

  const projectOptions = useMemo(
    () => Array.from(new Set(pools.map(p => p.projectName).filter(Boolean))).sort(),
    [pools]
  );

  const inRange = (iso: string | null) => {
    const d = localDay(iso);
    return !!d && d >= from && d <= to;
  };

  // QC / progress status of an attempt, for filtering + colour.
  const statusOf = (a: Attempt): 'APPROVED' | 'REJECTED' | 'PENDING_QC' | 'IN_PROGRESS' => {
    if (a.qcResult === 'APPROVED') return 'APPROVED';
    if (a.qcResult === 'REJECTED') return 'REJECTED';
    if (a.finishedAt) return 'PENDING_QC';
    return 'IN_PROGRESS';
  };

  // Attempts matching project / stage filters (before date + QC + search).
  const scoped = useMemo(
    () => attempts.filter(a =>
      (projectFilter === 'all' || a.projectName === projectFilter) &&
      (stageFilter === 'all' || a.stageId === stageFilter)
    ),
    [attempts, projectFilter, stageFilter]
  );

  // ── Event counts for the date range (each metric counts its OWN event time) ──
  const eventsIn = useMemo(() => {
    const ev: { metric: Metric; day: string; stageId: string }[] = [];
    scoped.forEach(a => {
      if (a.startedAt && inRange(a.startedAt)) {
        ev.push({ metric: a.attemptNo === 1 ? 'started' : 'restarted', day: localDay(a.startedAt), stageId: a.stageId });
      }
      if (a.finishedAt && inRange(a.finishedAt)) ev.push({ metric: 'finished', day: localDay(a.finishedAt), stageId: a.stageId });
      if (a.qcResult === 'APPROVED' && a.qcAt && inRange(a.qcAt)) ev.push({ metric: 'approved', day: localDay(a.qcAt), stageId: a.stageId });
      if (a.qcResult === 'REJECTED' && a.qcAt && inRange(a.qcAt)) ev.push({ metric: 'rejected', day: localDay(a.qcAt), stageId: a.stageId });
    });
    return ev;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scoped, from, to]);

  const stageTotals = useMemo(() => {
    const t: Record<string, Record<Metric, number>> = {};
    STAGES.forEach(s => { t[s.id] = { started: 0, restarted: 0, finished: 0, approved: 0, rejected: 0 }; });
    eventsIn.forEach(e => { if (t[e.stageId]) t[e.stageId][e.metric]++; });
    return t;
  }, [eventsIn]);

  // Matrix: rows = period (day / week / month / total), columns = stages.
  const matrix = useMemo(() => {
    const rows = new Map<string, Record<string, number>>();
    eventsIn.forEach(e => {
      if (e.metric !== metric) return;
      const k = periodKey(e.day, groupBy);
      if (!rows.has(k)) rows.set(k, {});
      const r = rows.get(k)!;
      r[e.stageId] = (r[e.stageId] || 0) + 1;
    });
    if (groupBy === 'total' && !rows.has('total')) rows.set('total', {});
    return Array.from(rows.entries())
      .sort((a, b) => (a[0] < b[0] ? 1 : -1)) // newest first
      .map(([key, counts]) => ({ key, label: periodLabel(key, groupBy), counts, total: Object.values(counts).reduce((s, n) => s + n, 0) }));
  }, [eventsIn, metric, groupBy]);

  const matrixColTotals = useMemo(() => {
    const t: Record<string, number> = {};
    STAGES.forEach(s => { t[s.id] = matrix.reduce((sum, r) => sum + (r.counts[s.id] || 0), 0); });
    return t;
  }, [matrix]);

  // ── Detail rows: any attempt with an event (start / finish / QC) in range ──
  const detailRows = useMemo(() => {
    const q = search.trim().toLowerCase();
    return scoped
      .filter(a => inRange(a.startedAt) || inRange(a.finishedAt) || inRange(a.qcAt))
      .filter(a => qcFilter === 'ALL' || statusOf(a) === qcFilter)
      .filter(a => !q || a.poolNo.toLowerCase().includes(q) || a.projectName.toLowerCase().includes(q) || a.teamName.toLowerCase().includes(q))
      .sort((a, b) => {
        const ta = ms(a.startedAt) || ms(a.qcAt);
        const tb = ms(b.startedAt) || ms(b.qcAt);
        return tb - ta;
      });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scoped, from, to, qcFilter, search]);

  const rejectionAttempts = useMemo(
    () => detailRows.filter(a => a.qcResult === 'REJECTED'),
    [detailRows]
  );

  const statusLabel = (a: Attempt) => {
    const s = statusOf(a);
    return s === 'APPROVED' ? 'Approved' : s === 'REJECTED' ? 'Rejected' : s === 'PENDING_QC' ? 'Waiting for QC' : 'In progress';
  };

  // ── Excel export: Summary + Details + Rejections sheets ──
  const handleExport = () => {
    if (detailRows.length === 0 && eventsIn.length === 0) {
      alert('Nothing to export for this selection.');
      return;
    }
    const rangeLabel = from === to ? fmtDay(from) : `${fmtDay(from)} to ${fmtDay(to)}`;

    // Summary: one row per period, one column per stage, for EVERY metric.
    const summaryRows: Record<string, any>[] = [];
    const metrics: { id: Metric; label: string }[] = [
      { id: 'started', label: 'Started (first run)' },
      { id: 'restarted', label: 'Restarted (rework)' },
      { id: 'finished', label: 'Finished (sent to QC)' },
      { id: 'approved', label: 'QC Approved' },
      { id: 'rejected', label: 'QC Rejected' },
    ];
    metrics.forEach(m => {
      const per = new Map<string, Record<string, number>>();
      eventsIn.filter(e => e.metric === m.id).forEach(e => {
        const k = periodKey(e.day, groupBy);
        if (!per.has(k)) per.set(k, {});
        per.get(k)![e.stageId] = (per.get(k)![e.stageId] || 0) + 1;
      });
      if (groupBy === 'total' && !per.has('total')) per.set('total', {});
      Array.from(per.entries()).sort((a, b) => (a[0] < b[0] ? -1 : 1)).forEach(([k, counts]) => {
        const row: Record<string, any> = { Metric: m.label, Period: periodLabel(k, groupBy) };
        let total = 0;
        STAGES.forEach(s => { row[s.name] = counts[s.id] || 0; total += counts[s.id] || 0; });
        row['Total'] = total;
        summaryRows.push(row);
      });
    });

    const detail = detailRows.map(a => ({
      'Project': a.projectName,
      'Pool No': a.poolNo,
      'Stage': a.stageName,
      'Run': a.attemptNo === 1 ? 'Original' : `Rework #${a.attemptNo - 1}`,
      'Team': a.teamName,
      'Started': fmtDT(a.startedAt),
      'Finished (sent to QC)': fmtDT(a.finishedAt),
      'Duration': fmtDuration(a.durationMin),
      'QC Status': statusLabel(a),
      'QC Date/Time': fmtDT(a.qcAt),
      'Inspector': a.inspector,
      'QC Notes': a.qcNotes,
    }));

    // Rejections: rejection → restart → rework finish → final result.
    const rejections = rejectionAttempts.map(a => {
      const next = attempts.find(x => x.poolId === a.poolId && x.stageId === a.stageId && x.attemptNo === a.attemptNo + 1);
      return {
        'Project': a.projectName,
        'Pool No': a.poolNo,
        'Stage': a.stageName,
        'Team': a.teamName,
        'Rejected At': fmtDT(a.qcAt),
        'Rejected By': a.inspector,
        'Reason / Notes': a.qcNotes,
        'Restarted At': fmtDT(a.restartedAt),
        'Rework Finished At': fmtDT(next?.finishedAt),
        'Rework QC Result': next ? statusLabel(next) : '—',
        'Rework QC Date/Time': fmtDT(next?.qcAt),
      };
    });

    const wb = XLSX.utils.book_new();
    const addSheet = (rows: Record<string, any>[], name: string) => {
      const data = rows.length ? rows : [{ Info: 'No data for this selection' }];
      const ws = XLSX.utils.json_to_sheet(data);
      (ws as any)['!cols'] = Object.keys(data[0]).map(key => ({
        wch: Math.min(60, Math.max(key.length, ...data.map(r => (r[key] == null ? 0 : String(r[key]).length))) + 2),
      }));
      XLSX.utils.book_append_sheet(wb, ws, name);
    };
    addSheet(summaryRows, 'Summary');
    addSheet(detail, 'Stage Details');
    addSheet(rejections, 'Rejections & Restarts');

    const stamp = new Date().toISOString().slice(0, 10);
    XLSX.writeFile(wb, `Stage_Timeline_${preset === 'all' ? 'AllTime' : `${from}_to_${to}`}_${stamp}.xlsx`);
    void rangeLabel;
  };

  const metricLabels: Record<Metric, string> = {
    started: 'Started',
    restarted: 'Restarted (rework)',
    finished: 'Finished',
    approved: 'QC Approved',
    rejected: 'QC Rejected',
  };

  const presetBtn = (id: RangePreset, label: string) => (
    <button
      key={id}
      onClick={() => applyPreset(id)}
      className={`px-3 py-1.5 text-xs font-bold rounded-lg transition-all cursor-pointer ${
        preset === id ? 'bg-indigo-600 text-white' : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
      }`}
    >
      {label}
    </button>
  );

  const statusBadge = (a: Attempt) => {
    const s = statusOf(a);
    const cls =
      s === 'APPROVED' ? 'bg-emerald-100 text-emerald-700'
      : s === 'REJECTED' ? 'bg-red-100 text-red-700'
      : s === 'PENDING_QC' ? 'bg-amber-100 text-amber-700'
      : 'bg-blue-100 text-blue-700';
    return <span className={`px-2 py-0.5 rounded-full text-[10px] font-bold whitespace-nowrap ${cls}`}>{statusLabel(a)}</span>;
  };

  const rangeText = from === to ? fmtDay(from) : `${fmtDay(from)} → ${fmtDay(to)}`;

  return (
    <div className="space-y-6" id="stage-timeline-report">

      {/* Header + filters */}
      <div className="bg-white p-5 rounded-2xl border border-slate-100 shadow-sm space-y-4">
        <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-3">
          <div>
            <h3 className="text-sm font-bold text-slate-800 flex items-center gap-1.5">
              <CalendarClock className="h-4 w-4 text-indigo-500" />
              Stage Timeline Report
            </h3>
            <p className="text-xs text-slate-400 mt-1 max-w-2xl">
              How many pools started in each stage, when they finished, the QC result — and for rejected pools, when the rework was restarted and finished.
              Showing <span className="font-semibold text-slate-600">{rangeText}</span>.
            </p>
          </div>
          <button
            onClick={handleExport}
            disabled={loading}
            className="flex items-center gap-1.5 px-3.5 py-2 text-xs font-bold rounded-lg bg-emerald-600 text-white hover:bg-emerald-700 disabled:opacity-50 cursor-pointer shrink-0"
          >
            <Download className="h-3.5 w-3.5" /> Export Excel
          </button>
        </div>

        <div className="flex flex-wrap items-center gap-3">
          <div className="flex gap-1 flex-wrap">
            {presetBtn('today', 'Today')}
            {presetBtn('week', 'This Week')}
            {presetBtn('month', 'This Month')}
            {presetBtn('all', 'All Time')}
          </div>
          <div className="flex items-center gap-2 sm:ml-auto">
            <input
              type="date"
              value={from}
              max={to}
              onChange={e => { setPreset('custom'); setFrom(e.target.value); }}
              className="px-2 py-1.5 text-xs border border-slate-200 rounded-lg bg-slate-50 focus:outline-none focus:ring-1 focus:ring-indigo-400"
            />
            <span className="text-slate-400 text-xs">to</span>
            <input
              type="date"
              value={to}
              min={from}
              onChange={e => { setPreset('custom'); setTo(e.target.value); }}
              className="px-2 py-1.5 text-xs border border-slate-200 rounded-lg bg-slate-50 focus:outline-none focus:ring-1 focus:ring-indigo-400"
            />
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-3">
          <select
            value={projectFilter}
            onChange={e => { setProjectFilter(e.target.value); setVisibleRows(100); }}
            className="px-2.5 py-1.5 text-xs border border-slate-200 rounded-lg bg-slate-50 focus:outline-none focus:ring-1 focus:ring-indigo-400"
          >
            <option value="all">All projects</option>
            {projectOptions.map(p => <option key={p} value={p}>{p}</option>)}
          </select>
          <select
            value={stageFilter}
            onChange={e => { setStageFilter(e.target.value); setVisibleRows(100); }}
            className="px-2.5 py-1.5 text-xs border border-slate-200 rounded-lg bg-slate-50 focus:outline-none focus:ring-1 focus:ring-indigo-400"
          >
            <option value="all">All stages</option>
            {STAGES.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
          </select>
          <select
            value={qcFilter}
            onChange={e => { setQcFilter(e.target.value as QcFilter); setVisibleRows(100); }}
            className="px-2.5 py-1.5 text-xs border border-slate-200 rounded-lg bg-slate-50 focus:outline-none focus:ring-1 focus:ring-indigo-400"
          >
            <option value="ALL">Any QC status</option>
            <option value="APPROVED">Approved</option>
            <option value="REJECTED">Rejected</option>
            <option value="PENDING_QC">Waiting for QC</option>
            <option value="IN_PROGRESS">In progress</option>
          </select>
          <div className="relative">
            <Search className="h-3.5 w-3.5 text-slate-400 absolute left-2.5 top-1/2 -translate-y-1/2" />
            <input
              value={search}
              onChange={e => { setSearch(e.target.value); setVisibleRows(100); }}
              placeholder="Pool no / project / team"
              className="pl-8 pr-2.5 py-1.5 text-xs border border-slate-200 rounded-lg bg-slate-50 focus:outline-none focus:ring-1 focus:ring-indigo-400 w-52"
            />
          </div>
          {loading && (
            <span className="flex items-center gap-1.5 text-xs text-slate-400">
              <Loader2 className="h-3.5 w-3.5 animate-spin" /> Loading full history…
            </span>
          )}
        </div>
      </div>

      {/* Per-stage cards */}
      <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-4 gap-3">
        {STAGES.filter(s => stageFilter === 'all' || s.id === stageFilter).map(stage => {
          const t = stageTotals[stage.id];
          return (
            <div key={stage.id} className="bg-white rounded-2xl border border-slate-100 shadow-sm p-4" style={{ borderTop: `3px solid ${stage.color}` }}>
              <p className="text-[11px] font-bold uppercase tracking-wider text-slate-400">{stage.name}</p>
              <div className="flex items-baseline gap-1.5 mt-1">
                <span className="text-3xl font-black text-slate-800">{t.started}</span>
                <span className="text-xs text-slate-400 font-semibold">started</span>
              </div>
              <div className="grid grid-cols-2 gap-x-3 gap-y-0.5 mt-2 text-[11px]">
                <span className="text-slate-500">Finished <b className="text-slate-700">{t.finished}</b></span>
                <span className="text-slate-500">Approved <b className="text-emerald-600">{t.approved}</b></span>
                <span className="text-slate-500">Rejected <b className="text-red-600">{t.rejected}</b></span>
                <span className="text-slate-500 flex items-center gap-0.5"><RotateCcw className="h-2.5 w-2.5" /> Restart <b className="text-amber-600">{t.restarted}</b></span>
              </div>
            </div>
          );
        })}
      </div>

      {/* Day / week / month matrix */}
      <div className="bg-white rounded-2xl border border-slate-100 shadow-sm overflow-hidden">
        <div className="p-4 flex flex-wrap items-center gap-3 border-b border-slate-100">
          <h4 className="text-xs font-bold text-slate-700 uppercase tracking-wider">Pools per stage</h4>
          <select
            value={metric}
            onChange={e => setMetric(e.target.value as Metric)}
            className="px-2.5 py-1.5 text-xs border border-slate-200 rounded-lg bg-slate-50 focus:outline-none focus:ring-1 focus:ring-indigo-400"
          >
            {(Object.keys(metricLabels) as Metric[]).map(m => <option key={m} value={m}>{metricLabels[m]}</option>)}
          </select>
          <div className="flex gap-1 ml-auto">
            {([['day', 'Day-wise'], ['week', 'Week-wise'], ['month', 'Month-wise'], ['total', 'Total']] as [GroupBy, string][]).map(([id, label]) => (
              <button
                key={id}
                onClick={() => setGroupBy(id)}
                className={`px-3 py-1.5 text-xs font-bold rounded-lg cursor-pointer transition-all ${
                  groupBy === id ? 'bg-slate-800 text-white' : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
                }`}
              >
                {label}
              </button>
            ))}
          </div>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead>
              <tr className="bg-slate-50 text-slate-500">
                <th className="text-left px-4 py-2.5 font-bold whitespace-nowrap">Period</th>
                {STAGES.filter(s => stageFilter === 'all' || s.id === stageFilter).map(s => (
                  <th key={s.id} className="text-center px-3 py-2.5 font-bold whitespace-nowrap">
                    <span className="inline-block w-2 h-2 rounded-full mr-1.5" style={{ background: s.color }} />
                    {s.name}
                  </th>
                ))}
                <th className="text-center px-3 py-2.5 font-bold">Total</th>
              </tr>
            </thead>
            <tbody>
              {matrix.length === 0 && (
                <tr><td colSpan={STAGES.length + 2} className="text-center text-slate-400 py-6">No activity in this period.</td></tr>
              )}
              {matrix.map(r => (
                <tr key={r.key} className="border-t border-slate-100 hover:bg-slate-50/60">
                  <td className="px-4 py-2 font-semibold text-slate-700 whitespace-nowrap">{r.label}</td>
                  {STAGES.filter(s => stageFilter === 'all' || s.id === stageFilter).map(s => (
                    <td key={s.id} className={`text-center px-3 py-2 ${r.counts[s.id] ? 'font-bold text-slate-800' : 'text-slate-300'}`}>
                      {r.counts[s.id] || 0}
                    </td>
                  ))}
                  <td className="text-center px-3 py-2 font-black text-indigo-600">{r.total}</td>
                </tr>
              ))}
              {matrix.length > 1 && (
                <tr className="border-t-2 border-slate-200 bg-slate-50 font-black text-slate-800">
                  <td className="px-4 py-2">All periods</td>
                  {STAGES.filter(s => stageFilter === 'all' || s.id === stageFilter).map(s => (
                    <td key={s.id} className="text-center px-3 py-2">{matrixColTotals[s.id]}</td>
                  ))}
                  <td className="text-center px-3 py-2 text-indigo-600">{matrix.reduce((s, r) => s + r.total, 0)}</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Detail table */}
      <div className="bg-white rounded-2xl border border-slate-100 shadow-sm overflow-hidden">
        <div className="p-4 border-b border-slate-100 flex flex-wrap items-center gap-3">
          <h4 className="text-xs font-bold text-slate-700 uppercase tracking-wider">Pool-by-pool timeline</h4>
          <span className="text-xs text-slate-400">
            {detailRows.length} run{detailRows.length === 1 ? '' : 's'}
            {rejectionAttempts.length > 0 && <> · <span className="text-red-600 font-semibold">{rejectionAttempts.length} rejected</span></>}
          </span>
          <span className="text-[11px] text-slate-400 sm:ml-auto">
            A rejected pool restarts immediately, so the rework appears as its own "Rework" row starting at the rejection time.
          </span>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead>
              <tr className="bg-slate-50 text-slate-500 text-left">
                {['Pool', 'Stage', 'Run', 'Team', 'Started', 'Finished', 'Duration', 'QC Status', 'QC Time', 'Inspector / Notes'].map(h => (
                  <th key={h} className="px-3 py-2.5 font-bold whitespace-nowrap">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {detailRows.length === 0 && (
                <tr><td colSpan={10} className="text-center text-slate-400 py-8">No pool activity matches this selection.</td></tr>
              )}
              {detailRows.slice(0, visibleRows).map(a => (
                <tr key={a.key} className={`border-t border-slate-100 align-top ${a.attemptNo > 1 ? 'bg-amber-50/40' : ''} ${a.qcResult === 'REJECTED' ? 'bg-red-50/50' : ''}`}>
                  <td className="px-3 py-2 whitespace-nowrap">
                    <p className="font-bold text-slate-800">{a.poolNo}</p>
                    <p className="text-[10px] text-slate-400">{a.projectName}</p>
                  </td>
                  <td className="px-3 py-2 whitespace-nowrap">
                    <span className="inline-block w-2 h-2 rounded-full mr-1.5" style={{ background: a.stageColor }} />
                    {a.stageName}
                  </td>
                  <td className="px-3 py-2 whitespace-nowrap">
                    {a.attemptNo === 1
                      ? <span className="text-slate-500">Original</span>
                      : <span className="inline-flex items-center gap-1 text-amber-700 font-semibold"><RotateCcw className="h-3 w-3" />Rework #{a.attemptNo - 1}</span>}
                  </td>
                  <td className="px-3 py-2 whitespace-nowrap text-slate-600">{a.teamName}</td>
                  <td className="px-3 py-2 whitespace-nowrap text-slate-700">{fmtDT(a.startedAt)}</td>
                  <td className="px-3 py-2 whitespace-nowrap text-slate-700">{fmtDT(a.finishedAt)}</td>
                  <td className="px-3 py-2 whitespace-nowrap text-slate-600">{fmtDuration(a.durationMin)}</td>
                  <td className="px-3 py-2">{statusBadge(a)}</td>
                  <td className="px-3 py-2 whitespace-nowrap text-slate-700">{fmtDT(a.qcAt)}</td>
                  <td className="px-3 py-2 min-w-[180px] max-w-[320px]">
                    {a.inspector !== '—' && <p className="font-semibold text-slate-700">{a.inspector}</p>}
                    {a.qcNotes && <p className="text-[11px] text-slate-500 break-words">{a.qcNotes}</p>}
                    {a.qcResult === 'REJECTED' && a.restartedAt && (
                      <p className="text-[11px] text-amber-700 mt-0.5">Restarted {fmtDT(a.restartedAt)}</p>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {detailRows.length > visibleRows && (
          <div className="p-3 text-center border-t border-slate-100">
            <button
              onClick={() => setVisibleRows(v => v + 200)}
              className="px-4 py-1.5 text-xs font-bold rounded-lg bg-slate-100 text-slate-600 hover:bg-slate-200 cursor-pointer"
            >
              Show more ({detailRows.length - visibleRows} remaining)
            </button>
          </div>
        )}
      </div>
    </div>
  );
};

export default StageTimelineReport;
