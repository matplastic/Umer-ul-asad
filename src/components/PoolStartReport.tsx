import React, { useMemo, useState } from 'react';
import { CalendarDays, Download, Search } from 'lucide-react';
import * as XLSX from 'xlsx';
import { ActivityLog, Pool } from '../types';
import { STAGES } from '../data/mockData';

// Pool Starts Report
// ──────────────────────────────────────────────────────────────────────────
// A pool counts as STARTED once a team has claimed it at Steel Fabrication
// (the first stage). Claim date = earliest STAGE_STARTED log for that stage,
// falling back to the stage's startTime. Shows pool no., type, current stage
// and how many pools were started per day / week / month / custom date range.

type Mode = 'day' | 'week' | 'month' | 'range';
const FIRST_STAGE = 'steel_fabrication';

const pad = (n: number) => String(n).padStart(2, '0');
const toYmd = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const fromYmd = (s: string) => { const [y, m, d] = s.split('-').map(Number); return new Date(y, m - 1, d); };
const addDays = (d: Date, n: number) => { const x = new Date(d); x.setDate(x.getDate() + n); return x; };

interface Row {
  pool: Pool;
  claimDate: string | null; // YYYY-MM-DD, local
  stageName: string;
  started: boolean;
}

export const PoolStartReport: React.FC<{ pools: Pool[]; logs: ActivityLog[] }> = ({ pools, logs }) => {
  const todayStr = toYmd(new Date());
  const [mode, setMode] = useState<Mode>('month');
  const [d1, setD1] = useState(todayStr);
  const [d2, setD2] = useState(todayStr);
  const [search, setSearch] = useState('');
  const [project, setProject] = useState('ALL');
  const [stageFilter, setStageFilter] = useState('ALL');

  const rows: Row[] = useMemo(() => {
    const firstClaim = new Map<string, string>();
    for (const l of logs) {
      if (l.stageId !== FIRST_STAGE || l.type !== 'STAGE_STARTED' || !l.timestamp) continue;
      const prev = firstClaim.get(l.poolId);
      if (!prev || l.timestamp < prev) firstClaim.set(l.poolId, l.timestamp);
    }
    return pools.map(pool => {
      const h = pool.stageHistory?.[FIRST_STAGE];
      const iso = firstClaim.get(pool.id) || h?.startTime || null;
      const claimDate = iso ? toYmd(new Date(iso)) : null;
      const started = !!claimDate || (!!h && h.status !== 'NOT_STARTED') || pool.currentStageIndex > 0;
      const stageName = pool.currentStageIndex >= STAGES.length
        ? 'Completed'
        : STAGES[pool.currentStageIndex]?.name || '-';
      return { pool, claimDate, stageName, started };
    });
  }, [pools, logs]);

  const [from, to] = useMemo(() => {
    let a = fromYmd(d1 || todayStr);
    let b = a;
    if (mode === 'week') { a = addDays(a, -((a.getDay() + 6) % 7)); b = addDays(a, 6); }
    else if (mode === 'month') { b = new Date(a.getFullYear(), a.getMonth() + 1, 0); a = new Date(a.getFullYear(), a.getMonth(), 1); }
    else if (mode === 'range') { b = fromYmd(d2 || d1 || todayStr); if (b < a) [a, b] = [b, a]; }
    return [toYmd(a), toYmd(b)];
  }, [mode, d1, d2, todayStr]);

  const projects = useMemo(() => Array.from(new Set(pools.map(p => p.projectName))).filter(Boolean).sort(), [pools]);
  const matches = (r: Row) =>
    (project === 'ALL' || r.pool.projectName === project) &&
    (stageFilter === 'ALL' || r.stageName === stageFilter) &&
    (!search.trim() || `${r.pool.poolNo} ${r.pool.projectName} ${r.pool.poolType || ''}`.toLowerCase().includes(search.toLowerCase()));

  const scoped = rows.filter(matches);
  const inPeriod = scoped.filter(r => r.claimDate && r.claimDate >= from && r.claimDate <= to)
    .sort((a, b) => (a.claimDate! < b.claimDate! ? -1 : 1));
  const startedAll = scoped.filter(r => r.started).length;

  const days: string[] = [];
  for (let d = fromYmd(from); toYmd(d) <= to && days.length < 400; d = addDays(d, 1)) days.push(toYmd(d));

  const exportXlsx = () => {
    const data = inPeriod.map(r => ({
      'Claim Date': r.claimDate, Project: r.pool.projectName, 'Pool No': r.pool.poolNo,
      Type: r.pool.poolType || '', Orientation: r.pool.orientation, 'Current Stage': r.stageName,
    }));
    const ws = XLSX.utils.json_to_sheet(data);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Pool Starts');
    XLSX.writeFile(wb, `pool-starts_${from}_${to}.xlsx`);
  };

  const modes: [Mode, string][] = [['day', 'Day'], ['week', 'Week'], ['month', 'Month'], ['range', 'Date Range']];

  return (
    <div className="space-y-5">
      <div className="bg-white p-5 rounded-2xl border border-slate-100 shadow-sm space-y-3">
        <div className="flex flex-wrap items-center gap-2">
          <CalendarDays className="h-4 w-4 text-teal-700" />
          <h3 className="text-sm font-black text-slate-800 mr-2">Pool Starts (after Steel Fabrication claim)</h3>
          {modes.map(([m, label]) => (
            <button key={m} type="button" onClick={() => setMode(m)}
              className={`rounded-lg px-3 py-1.5 text-xs font-semibold ${mode === m ? 'bg-teal-700 text-white' : 'border border-slate-200 text-slate-600 hover:bg-slate-50'}`}>
              {label}
            </button>
          ))}
          <button type="button" onClick={exportXlsx} disabled={!inPeriod.length}
            className="ml-auto flex items-center gap-1 rounded-lg border border-slate-200 px-3 py-1.5 text-xs font-semibold text-slate-600 disabled:opacity-40">
            <Download className="h-3.5 w-3.5" /> Excel
          </button>
        </div>
        <div className="flex flex-wrap items-center gap-2 text-xs">
          <label className="flex items-center gap-1 text-slate-500">{mode === 'range' ? 'From' : 'Date'}
            <input type="date" value={d1} onChange={e => setD1(e.target.value)} className="rounded-lg border border-slate-200 px-2 py-1.5" />
          </label>
          {mode === 'range' && (
            <label className="flex items-center gap-1 text-slate-500">To
              <input type="date" value={d2} onChange={e => setD2(e.target.value)} className="rounded-lg border border-slate-200 px-2 py-1.5" />
            </label>
          )}
          <span className="font-semibold text-slate-500">{from === to ? from : `${from} → ${to}`}</span>
          <div className="relative ml-auto">
            <Search className="absolute left-2.5 top-2 h-3.5 w-3.5 text-slate-400" />
            <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search pool / project…"
              className="rounded-lg border border-slate-200 pl-8 pr-3 py-1.5 w-48" />
          </div>
          <select value={project} onChange={e => setProject(e.target.value)} className="rounded-lg border border-slate-200 px-2 py-1.5">
            <option value="ALL">All projects</option>
            {projects.map(p => <option key={p} value={p}>{p}</option>)}
          </select>
          <select value={stageFilter} onChange={e => setStageFilter(e.target.value)} className="rounded-lg border border-slate-200 px-2 py-1.5">
            <option value="ALL">All stages</option>
            {STAGES.map(s => <option key={s.id} value={s.name}>{s.name}</option>)}
            <option value="Completed">Completed</option>
          </select>
        </div>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        {[
          ['Started in period', inPeriod.length, 'text-teal-700'],
          ['Total pools', scoped.length, 'text-slate-800'],
          ['Started (all time)', startedAll, 'text-emerald-600'],
          ['Not started yet', scoped.length - startedAll, 'text-amber-600'],
        ].map(([label, val, cls]) => (
          <div key={label as string} className="bg-white p-4 rounded-2xl border border-slate-100 shadow-sm">
            <div className={`text-3xl font-black ${cls}`}>{val}</div>
            <div className="text-[11px] font-semibold text-slate-400 uppercase tracking-wide">{label}</div>
          </div>
        ))}
      </div>

      <div className="bg-white p-5 rounded-2xl border border-slate-100 shadow-sm overflow-x-auto">
        <h4 className="text-xs font-black text-slate-700 uppercase tracking-wide mb-3">Day-wise starts</h4>
        <table className="min-w-full text-left text-xs">
          <thead><tr className="border-b border-slate-100 text-[10px] uppercase tracking-wider text-slate-400">
            <th className="py-2 px-2">Date</th><th className="py-2 px-2">Started</th><th className="py-2 px-2">Pools</th>
          </tr></thead>
          <tbody className="divide-y divide-slate-100">
            {days.map(d => {
              const l = inPeriod.filter(r => r.claimDate === d);
              return (
                <tr key={d}>
                  <td className="py-1.5 px-2 font-semibold">{d}</td>
                  <td className="py-1.5 px-2 font-black text-teal-700">{l.length}</td>
                  <td className="py-1.5 px-2 text-slate-600">{l.map(r => `${r.pool.poolNo} (${r.pool.projectName})`).join(', ') || '–'}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <div className="bg-white p-5 rounded-2xl border border-slate-100 shadow-sm overflow-x-auto">
        <h4 className="text-xs font-black text-slate-700 uppercase tracking-wide mb-3">Pools list ({scoped.length})</h4>
        <table className="min-w-full text-left text-xs">
          <thead><tr className="border-b border-slate-100 text-[10px] uppercase tracking-wider text-slate-400">
            <th className="py-2 px-2">Project</th><th className="py-2 px-2">Pool no.</th><th className="py-2 px-2">Type</th>
            <th className="py-2 px-2">Current stage</th><th className="py-2 px-2">Claim date</th><th className="py-2 px-2">Status</th>
          </tr></thead>
          <tbody className="divide-y divide-slate-100">
            {scoped.map(r => {
              const hl = r.claimDate && r.claimDate >= from && r.claimDate <= to;
              return (
                <tr key={r.pool.id} className={hl ? 'bg-teal-50' : ''}>
                  <td className="py-1.5 px-2">{r.pool.projectName}</td>
                  <td className="py-1.5 px-2 font-bold">{r.pool.poolNo}</td>
                  <td className="py-1.5 px-2">{r.pool.poolType || '-'} <span className="text-slate-400">· {r.pool.orientation}</span></td>
                  <td className="py-1.5 px-2">{r.stageName}</td>
                  <td className="py-1.5 px-2">{r.claimDate || (r.started ? 'date unknown' : '–')}</td>
                  <td className="py-1.5 px-2">
                    <span className={`rounded-full px-2 py-0.5 text-[10px] font-bold ${r.started ? 'bg-emerald-100 text-emerald-700' : 'bg-amber-100 text-amber-700'}`}>
                      {r.started ? 'Started' : 'Not started'}
                    </span>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
};
