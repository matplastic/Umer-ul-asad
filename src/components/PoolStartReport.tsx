import React, { useMemo, useState } from 'react';
import { CalendarDays, Download, Filter, Layers, Search, Wrench, ArrowRightCircle } from 'lucide-react';
import * as XLSX from 'xlsx';
import { ActivityLog, Pool } from '../types';
import { STAGES } from '../data/mockData';

// Pool Starts Report
// ──────────────────────────────────────────────────────────────────────────
// Shows ONLY pools that have been claimed at Steel Fabrication:
//   • In Steel      – claimed and still in the Steel Fabrication stage
//   • Passed Steel  – already moved on to a later stage (or completed)
// Claim date = earliest STAGE_STARTED log for steel_fabrication, falling back
// to the stage's startTime. Filters: project, type, orientation, status, date.

type Mode = 'all' | 'day' | 'week' | 'month' | 'range';
type StatusFilter = 'ALL' | 'IN_STEEL' | 'PASSED';
const FIRST_STAGE = 'steel_fabrication';

const pad = (n: number) => String(n).padStart(2, '0');
const toYmd = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const fromYmd = (s: string) => { const [y, m, d] = s.split('-').map(Number); return new Date(y, m - 1, d); };
const addDays = (d: Date, n: number) => { const x = new Date(d); x.setDate(x.getDate() + n); return x; };
const fmt = (s: string | null) => s ? fromYmd(s).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' }) : '—';
const natural = (a: string, b: string) => a.localeCompare(b, undefined, { numeric: true });

interface Row {
  pool: Pool;
  claimDate: string | null;
  stageName: string;
  passed: boolean;
  typeName: string;
}

export const PoolStartReport: React.FC<{ pools: Pool[]; logs: ActivityLog[] }> = ({ pools, logs }) => {
  const todayStr = toYmd(new Date());
  const [mode, setMode] = useState<Mode>('month');
  const [d1, setD1] = useState(todayStr);
  const [d2, setD2] = useState(todayStr);
  const [search, setSearch] = useState('');
  const [project, setProject] = useState('ALL');
  const [type, setType] = useState('ALL');
  const [orientation, setOrientation] = useState('ALL');
  const [status, setStatus] = useState<StatusFilter>('ALL');

  // Only pools claimed at Steel Fabrication
  const rows: Row[] = useMemo(() => {
    const firstClaim = new Map<string, string>();
    for (const l of logs) {
      if (l.stageId !== FIRST_STAGE || l.type !== 'STAGE_STARTED' || !l.timestamp) continue;
      const prev = firstClaim.get(l.poolId);
      if (!prev || l.timestamp < prev) firstClaim.set(l.poolId, l.timestamp);
    }
    const out: Row[] = [];
    for (const pool of pools) {
      const h = pool.stageHistory?.[FIRST_STAGE];
      const iso = firstClaim.get(pool.id) || h?.startTime || null;
      const claimed = !!iso || (!!h && h.status !== 'NOT_STARTED') || pool.currentStageIndex > 0;
      if (!claimed) continue;
      const passed = pool.currentStageIndex > 0;
      out.push({
        pool,
        claimDate: iso ? toYmd(new Date(iso)) : null,
        passed,
        stageName: pool.currentStageIndex >= STAGES.length ? 'Completed' : STAGES[pool.currentStageIndex]?.name || '—',
        typeName: pool.poolType?.trim() || 'Not set',
      });
    }
    return out;
  }, [pools, logs]);

  const [from, to] = useMemo(() => {
    let a = fromYmd(d1 || todayStr);
    let b = a;
    if (mode === 'week') { a = addDays(a, -((a.getDay() + 6) % 7)); b = addDays(a, 6); }
    else if (mode === 'month') { b = new Date(a.getFullYear(), a.getMonth() + 1, 0); a = new Date(a.getFullYear(), a.getMonth(), 1); }
    else if (mode === 'range') { b = fromYmd(d2 || d1 || todayStr); if (b < a) [a, b] = [b, a]; }
    return [toYmd(a), toYmd(b)];
  }, [mode, d1, d2, todayStr]);

  const projects = useMemo(() => Array.from(new Set(rows.map(r => r.pool.projectName))).filter(Boolean).sort(natural), [rows]);
  const types = useMemo(() => Array.from(new Set(rows.map(r => r.typeName))).sort(natural), [rows]);

  const filtered = useMemo(() => rows.filter(r => {
    if (project !== 'ALL' && r.pool.projectName !== project) return false;
    if (type !== 'ALL' && r.typeName !== type) return false;
    if (orientation !== 'ALL' && r.pool.orientation !== orientation) return false;
    if (status === 'IN_STEEL' && r.passed) return false;
    if (status === 'PASSED' && !r.passed) return false;
    if (mode !== 'all' && !(r.claimDate && r.claimDate >= from && r.claimDate <= to)) return false;
    const q = search.trim().toLowerCase();
    if (q && !`${r.pool.poolNo} ${r.pool.projectName} ${r.typeName}`.toLowerCase().includes(q)) return false;
    return true;
  }).sort((a, b) => (a.claimDate || '') < (b.claimDate || '') ? 1 : (a.claimDate || '') > (b.claimDate || '') ? -1 : natural(a.pool.poolNo, b.pool.poolNo)),
  [rows, project, type, orientation, status, mode, from, to, search]);

  const inSteel = filtered.filter(r => !r.passed).length;
  const passed = filtered.length - inSteel;

  // Group by type → pool numbers
  const byType = useMemo(() => {
    const m = new Map<string, Row[]>();
    filtered.forEach(r => m.set(r.typeName, [...(m.get(r.typeName) || []), r]));
    return Array.from(m.entries()).sort((a, b) => natural(a[0], b[0]));
  }, [filtered]);

  // Day-wise (only days that have starts)
  const byDay = useMemo(() => {
    const m = new Map<string, Row[]>();
    filtered.forEach(r => { const k = r.claimDate || 'Unknown'; m.set(k, [...(m.get(k) || []), r]); });
    return Array.from(m.entries()).sort((a, b) => (a[0] < b[0] ? -1 : 1));
  }, [filtered]);

  const periodLabel = mode === 'all' ? 'All time' : from === to ? fmt(from) : `${fmt(from)} – ${fmt(to)}`;
  const resetFilters = () => { setProject('ALL'); setType('ALL'); setOrientation('ALL'); setStatus('ALL'); setSearch(''); };

  const exportXlsx = () => {
    const data = filtered.map(r => ({
      'Claim Date': r.claimDate || '', Project: r.pool.projectName, 'Pool No': r.pool.poolNo,
      Type: r.typeName, Orientation: r.pool.orientation, 'Current Stage': r.stageName,
      Status: r.passed ? 'Passed Steel' : 'In Steel',
    }));
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(data), 'Pool Starts');
    XLSX.writeFile(wb, `pool-starts_${mode === 'all' ? 'all' : `${from}_${to}`}.xlsx`);
  };

  const selectCls = 'rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs font-semibold text-slate-700 focus:outline-none focus:ring-2 focus:ring-teal-600/30';
  const modeBtn = (m: Mode, label: string) => (
    <button key={m} type="button" onClick={() => setMode(m)}
      className={`px-3.5 py-1.5 text-xs font-bold rounded-md transition ${mode === m ? 'bg-white text-teal-800 shadow-sm' : 'text-slate-500 hover:text-slate-700'}`}>
      {label}
    </button>
  );

  return (
    <div className="space-y-5">
      {/* Header */}
      <div className="rounded-2xl bg-gradient-to-r from-teal-800 to-teal-600 p-5 text-white shadow-sm">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <div className="flex items-center gap-2 text-[11px] font-bold uppercase tracking-[0.18em] text-teal-100">
              <Layers className="h-3.5 w-3.5" /> Production · Steel Fabrication
            </div>
            <h3 className="mt-1 text-xl font-black">Pool Starts Report</h3>
            <p className="text-xs text-teal-100">Pools claimed at Steel Fabrication — in steel now, or already passed to the next stage.</p>
          </div>
          <button type="button" onClick={exportXlsx} disabled={!filtered.length}
            className="flex items-center gap-1.5 rounded-lg bg-white/15 px-4 py-2 text-xs font-bold text-white ring-1 ring-white/30 transition hover:bg-white/25 disabled:opacity-40">
            <Download className="h-4 w-4" /> Export Excel
          </button>
        </div>
      </div>

      {/* Filters */}
      <div className="space-y-3 rounded-2xl border border-slate-100 bg-white p-4 shadow-sm">
        <div className="flex flex-wrap items-center gap-3">
          <CalendarDays className="h-4 w-4 text-teal-700" />
          <div className="flex rounded-lg bg-slate-100 p-1">
            {modeBtn('all', 'All')}{modeBtn('day', 'Day')}{modeBtn('week', 'Week')}{modeBtn('month', 'Month')}{modeBtn('range', 'Date Range')}
          </div>
          {mode !== 'all' && (
            <>
              <input type="date" value={d1} onChange={e => setD1(e.target.value)} className={selectCls} aria-label={mode === 'range' ? 'From date' : 'Date'} />
              {mode === 'range' && (<><span className="text-xs text-slate-400">to</span>
                <input type="date" value={d2} onChange={e => setD2(e.target.value)} className={selectCls} aria-label="To date" /></>)}
            </>
          )}
          <span className="ml-auto rounded-full bg-teal-50 px-3 py-1 text-[11px] font-bold text-teal-800">{periodLabel}</span>
        </div>
        <div className="flex flex-wrap items-center gap-2 border-t border-slate-100 pt-3">
          <Filter className="h-4 w-4 text-slate-400" />
          <select value={project} onChange={e => setProject(e.target.value)} className={selectCls}>
            <option value="ALL">All projects</option>{projects.map(p => <option key={p} value={p}>{p}</option>)}
          </select>
          <select value={type} onChange={e => setType(e.target.value)} className={selectCls}>
            <option value="ALL">All types</option>{types.map(t => <option key={t} value={t}>{t}</option>)}
          </select>
          <select value={orientation} onChange={e => setOrientation(e.target.value)} className={selectCls}>
            <option value="ALL">All orientations</option><option value="Normal">Normal</option><option value="Mirror">Mirror</option>
          </select>
          <select value={status} onChange={e => setStatus(e.target.value as StatusFilter)} className={selectCls}>
            <option value="ALL">In Steel + Passed</option><option value="IN_STEEL">In Steel only</option><option value="PASSED">Passed Steel only</option>
          </select>
          <div className="relative ml-auto">
            <Search className="absolute left-3 top-2.5 h-3.5 w-3.5 text-slate-400" />
            <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search pool no. / project"
              className={`${selectCls} w-56 pl-8`} />
          </div>
          <button type="button" onClick={resetFilters} className="text-xs font-bold text-teal-700 hover:underline">Reset</button>
        </div>
      </div>

      {/* KPIs */}
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        {[
          { label: 'Total claimed in steel', val: filtered.length, icon: Layers, tone: 'text-teal-700 bg-teal-50' },
          { label: 'Currently in Steel', val: inSteel, icon: Wrench, tone: 'text-blue-700 bg-blue-50' },
          { label: 'Passed Steel', val: passed, icon: ArrowRightCircle, tone: 'text-emerald-700 bg-emerald-50' },
        ].map(k => (
          <div key={k.label} className="flex items-center gap-4 rounded-2xl border border-slate-100 bg-white p-4 shadow-sm">
            <div className={`rounded-xl p-3 ${k.tone}`}><k.icon className="h-5 w-5" /></div>
            <div>
              <div className="text-3xl font-black leading-none text-slate-800">{k.val}</div>
              <div className="mt-1 text-[11px] font-bold uppercase tracking-wide text-slate-400">{k.label}</div>
            </div>
          </div>
        ))}
      </div>

      {/* By type */}
      <div className="rounded-2xl border border-slate-100 bg-white p-5 shadow-sm">
        <h4 className="mb-3 text-xs font-black uppercase tracking-wider text-slate-700">Type-wise pool numbers</h4>
        {byType.length === 0 ? <p className="py-6 text-center text-xs text-slate-400">No pools match the selected filters.</p> : (
          <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3">
            {byType.map(([t, list]) => {
              const a = list.filter(r => !r.passed), b = list.filter(r => r.passed);
              const chip = (r: Row, cls: string) => (
                <span key={r.pool.id} title={`${r.pool.projectName} · ${r.pool.orientation} · ${r.stageName}`}
                  className={`rounded-md px-2 py-1 text-[11px] font-bold ${cls}`}>{r.pool.poolNo}</span>
              );
              return (
                <div key={t} className="rounded-xl border border-slate-200 p-4">
                  <div className="mb-3 flex items-center justify-between">
                    <span className="text-sm font-black text-slate-800">{t}</span>
                    <span className="rounded-full bg-slate-800 px-2.5 py-0.5 text-[11px] font-bold text-white">{list.length}</span>
                  </div>
                  <div className="space-y-2">
                    <div>
                      <div className="mb-1 text-[10px] font-bold uppercase tracking-wide text-blue-600">In Steel ({a.length})</div>
                      <div className="flex flex-wrap gap-1.5">{a.length ? a.map(r => chip(r, 'bg-blue-50 text-blue-700')) : <span className="text-[11px] text-slate-300">—</span>}</div>
                    </div>
                    <div>
                      <div className="mb-1 text-[10px] font-bold uppercase tracking-wide text-emerald-600">Passed Steel ({b.length})</div>
                      <div className="flex flex-wrap gap-1.5">{b.length ? b.map(r => chip(r, 'bg-emerald-50 text-emerald-700')) : <span className="text-[11px] text-slate-300">—</span>}</div>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Day-wise */}
      <div className="overflow-x-auto rounded-2xl border border-slate-100 bg-white p-5 shadow-sm">
        <h4 className="mb-3 text-xs font-black uppercase tracking-wider text-slate-700">Day-wise starts</h4>
        <table className="min-w-full text-left text-xs">
          <thead><tr className="border-b border-slate-100 text-[10px] uppercase tracking-wider text-slate-400">
            <th className="px-2 py-2">Claim date</th><th className="px-2 py-2">Pools started</th><th className="px-2 py-2">Pool numbers</th>
          </tr></thead>
          <tbody className="divide-y divide-slate-100">
            {byDay.map(([d, list]) => (
              <tr key={d}>
                <td className="px-2 py-2 font-bold text-slate-700">{d === 'Unknown' ? 'Date unknown' : fmt(d)}</td>
                <td className="px-2 py-2 font-black text-teal-700">{list.length}</td>
                <td className="px-2 py-2 text-slate-600">{list.map(r => `${r.pool.poolNo} (${r.typeName})`).join(', ')}</td>
              </tr>
            ))}
            {byDay.length === 0 && <tr><td colSpan={3} className="py-6 text-center text-slate-400">No starts in this period.</td></tr>}
          </tbody>
          {byDay.length > 0 && (
            <tfoot><tr className="border-t-2 border-slate-200 font-black text-slate-800">
              <td className="px-2 py-2">Total</td><td className="px-2 py-2">{filtered.length}</td><td />
            </tr></tfoot>
          )}
        </table>
      </div>

      {/* Detail */}
      <div className="overflow-x-auto rounded-2xl border border-slate-100 bg-white p-5 shadow-sm">
        <h4 className="mb-3 text-xs font-black uppercase tracking-wider text-slate-700">Pool details ({filtered.length})</h4>
        <table className="min-w-full text-left text-xs">
          <thead><tr className="border-b border-slate-100 text-[10px] uppercase tracking-wider text-slate-400">
            <th className="px-2 py-2">#</th><th className="px-2 py-2">Project</th><th className="px-2 py-2">Pool no.</th>
            <th className="px-2 py-2">Type</th><th className="px-2 py-2">Orientation</th><th className="px-2 py-2">Claim date</th>
            <th className="px-2 py-2">Current stage</th><th className="px-2 py-2">Status</th>
          </tr></thead>
          <tbody className="divide-y divide-slate-100">
            {filtered.map((r, i) => (
              <tr key={r.pool.id} className="hover:bg-slate-50">
                <td className="px-2 py-2 text-slate-400">{i + 1}</td>
                <td className="px-2 py-2">{r.pool.projectName}</td>
                <td className="px-2 py-2 font-black text-slate-800">{r.pool.poolNo}</td>
                <td className="px-2 py-2">{r.typeName}</td>
                <td className="px-2 py-2">{r.pool.orientation}</td>
                <td className="px-2 py-2">{r.claimDate ? fmt(r.claimDate) : 'Date unknown'}</td>
                <td className="px-2 py-2">{r.stageName}</td>
                <td className="px-2 py-2">
                  <span className={`rounded-full px-2.5 py-0.5 text-[10px] font-bold ${r.passed ? 'bg-emerald-100 text-emerald-700' : 'bg-blue-100 text-blue-700'}`}>
                    {r.passed ? 'Passed Steel' : 'In Steel'}
                  </span>
                </td>
              </tr>
            ))}
            {filtered.length === 0 && <tr><td colSpan={8} className="py-8 text-center text-slate-400">No pools match the selected filters.</td></tr>}
          </tbody>
        </table>
      </div>
    </div>
  );
};
