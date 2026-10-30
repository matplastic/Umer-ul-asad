import React, { useMemo, useState } from 'react';
import {
  Warehouse, PackagePlus, CalendarDays, Factory, CheckCircle2, Undo2, Download, Search,
  AlertTriangle, ArrowRight, Boxes, Truck
} from 'lucide-react';
import { Pool } from '../types';
import { STAGES } from '../data/mockData';
import { exportToExcel } from '../lib/exportUtils';

/**
 * WAREHOUSE — pools sent from the factory to the new warehouse.
 *
 * One person (the Warehouse role) records "these pools of this project were
 * received in the warehouse" — on the day they arrived. Everything else in
 * the app (Management dashboard, Live Analytics) reads the same four pool
 * fields, so there is nothing to keep in sync:
 *
 *   warehouseName        which warehouse
 *   warehouseReceivedAt  when it arrived (ISO date-time)
 *   warehouseReceivedBy  who entered it
 *   warehouseNote        optional remark (truck, driver, damage…)
 *
 * Location, as used everywhere:
 *   In warehouse = not delivered AND has warehouseReceivedAt
 *   In factory   = not delivered AND no warehouseReceivedAt
 *   Delivered    = isDelivered (it has left, from wherever it was)
 * "Undo" simply clears the four fields, so a mistaken entry is easy to fix.
 */

export const WAREHOUSE_NAME = 'New Warehouse';

export const isInWarehouse = (p: Pool): boolean => !p.isDelivered && !!p.warehouseReceivedAt;
export const isInFactoryLoc = (p: Pool): boolean => !p.isDelivered && !p.warehouseReceivedAt;
export const isProductionComplete = (p: Pool): boolean => p.currentStageIndex >= STAGES.length;

// local YYYY-MM-DD for any stored date/time
const pad2 = (n: number) => (n < 10 ? `0${n}` : String(n));
export const localDay = (s?: string | null): string => {
  if (!s) return '';
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
  const d = new Date(s);
  return isNaN(d.getTime()) ? '' : `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
};
const todayStr = () => localDay(new Date().toISOString());
const dayLabel = (day: string) => {
  const d = new Date(`${day}T00:00:00`);
  return isNaN(d.getTime()) ? day : d.toLocaleDateString('en-GB', { weekday: 'short', day: '2-digit', month: 'short', year: 'numeric' });
};
const timeLabel = (iso?: string | null) => {
  if (!iso) return '';
  const d = new Date(iso);
  return isNaN(d.getTime()) ? '' : d.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });
};
const byPoolNo = (a: Pool, b: Pool) => (a.poolNo || '').localeCompare(b.poolNo || '', undefined, { numeric: true });
const shiftDay = (day: string, delta: number) => {
  const d = new Date(`${day}T00:00:00`);
  d.setDate(d.getDate() + delta);
  return localDay(d.toISOString());
};

/** Counts used by the Management strip and Live Analytics. */
export function warehouseCounts(pools: Pool[]) {
  const inWarehouse = pools.filter(isInWarehouse).length;
  const inFactory = pools.filter(isInFactoryLoc).length;
  const delivered = pools.filter(p => !!p.isDelivered).length;
  return { inWarehouse, inFactory, delivered, total: pools.length };
}

// ─── Management summary strip (shown on the Management overview) ───────────
export const WarehouseSummaryStrip: React.FC<{ pools: Pool[]; onOpen?: () => void }> = ({ pools, onOpen }) => {
  const c = useMemo(() => warehouseCounts(pools), [pools]);
  const today = todayStr();
  const receivedToday = useMemo(() => pools.filter(p => localDay(p.warehouseReceivedAt) === today).length, [pools, today]);
  const tile = (label: string, value: number, sub: string, cls: string, Icon: any) => (
    <div className={`rounded-2xl border p-4 flex items-center gap-3 ${cls}`}>
      <div className="bg-white/70 rounded-xl p-2.5"><Icon className="h-5 w-5" /></div>
      <div>
        <p className="text-[10px] font-bold uppercase tracking-wider opacity-70">{label}</p>
        <p className="text-2xl font-black leading-none mt-0.5">{value.toLocaleString('en-US')}</p>
        <p className="text-[10px] opacity-70 mt-1">{sub}</p>
      </div>
    </div>
  );
  return (
    <div className="bg-white border border-slate-100 rounded-2xl p-4 shadow-sm" data-testid="warehouse-summary-strip">
      <div className="flex flex-wrap items-center justify-between gap-2 mb-3">
        <div>
          <p className="text-sm font-extrabold text-slate-800 flex items-center gap-2"><Warehouse className="h-4 w-4 text-indigo-600" /> Where the pools are — Factory vs {WAREHOUSE_NAME}</p>
          <p className="text-[11px] text-slate-400">All pools that have not been delivered yet, right now. Not affected by the date filter above.</p>
        </div>
        {onOpen && (
          <button onClick={onOpen} className="flex items-center gap-1 px-3 py-1.5 text-xs font-bold rounded-lg bg-indigo-600 hover:bg-indigo-700 text-white cursor-pointer">
            Open Warehouse <ArrowRight className="h-3.5 w-3.5" />
          </button>
        )}
      </div>
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        {tile('In Factory', c.inFactory, 'in production + finished, still here', 'bg-amber-50 border-amber-100 text-amber-800', Factory)}
        {tile('In Warehouse', c.inWarehouse, `sent to ${WAREHOUSE_NAME}`, 'bg-indigo-50 border-indigo-100 text-indigo-800', Warehouse)}
        {tile('Received Today', receivedToday, 'entered in the warehouse today', 'bg-emerald-50 border-emerald-100 text-emerald-800', PackagePlus)}
        {tile('Delivered', c.delivered, 'already handed over', 'bg-violet-50 border-violet-100 text-violet-800', Truck)}
      </div>
    </div>
  );
};

// ─── Full warehouse screen ─────────────────────────────────────────────────
interface Props {
  pools: Pool[];
  currentUserName: string;
  onReceive: (poolIds: string[], info: { receivedAt: string; receivedBy: string; note: string }) => void;
  onReturn: (poolIds: string[]) => void;
}

// "101, 102, 105-110" → matched pools + the numbers that were not found
function parsePoolNumbers(text: string, candidates: Pool[]) {
  const matched = new Set<string>();
  const notFound: string[] = [];
  text.split(/[\s,;]+/).map(t => t.trim()).filter(Boolean).forEach(tok => {
    const range = tok.match(/^(\d+)\s*[-–]\s*(\d+)$/);
    if (range) {
      const lo = Math.min(Number(range[1]), Number(range[2]));
      const hi = Math.max(Number(range[1]), Number(range[2]));
      candidates.forEach(p => {
        if (/^\d+$/.test(p.poolNo) && Number(p.poolNo) >= lo && Number(p.poolNo) <= hi) matched.add(p.id);
      });
      return;
    }
    const hit = candidates.find(p => (p.poolNo || '').trim().toLowerCase() === tok.toLowerCase());
    if (hit) matched.add(hit.id); else notFound.push(tok);
  });
  return { matched, notFound };
}

export const WarehouseRegister: React.FC<Props> = ({ pools, currentUserName, onReceive, onReturn }) => {
  const today = todayStr();

  // ── entry form ──
  const [receiveDate, setReceiveDate] = useState(today);
  const [project, setProject] = useState('');
  const [note, setNote] = useState('');
  const [typed, setTyped] = useState('');
  const [typedFeedback, setTypedFeedback] = useState('');
  const [poolSearch, setPoolSearch] = useState('');
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [success, setSuccess] = useState<string | null>(null);

  // ── register filters ──
  const [fromDay, setFromDay] = useState(shiftDay(today, -29));
  const [toDay, setToDay] = useState(today);
  const [projectFilter, setProjectFilter] = useState('all');
  const [openProject, setOpenProject] = useState<string | null>(null);

  const counts = useMemo(() => warehouseCounts(pools), [pools]);
  const receivedToday = useMemo(() => pools.filter(p => localDay(p.warehouseReceivedAt) === today).length, [pools, today]);

  // projects that still have pools in the factory (candidates to send)
  const projectsInFactory = useMemo(() => {
    const m = new Map<string, number>();
    pools.filter(isInFactoryLoc).forEach(p => m.set(p.projectName, (m.get(p.projectName) || 0) + 1));
    return Array.from(m.entries()).sort((a, b) => a[0].localeCompare(b[0]));
  }, [pools]);

  const candidates = useMemo(
    () => pools.filter(p => isInFactoryLoc(p) && p.projectName === project).sort(byPoolNo),
    [pools, project]
  );
  const visibleCandidates = useMemo(() => {
    const q = poolSearch.trim().toLowerCase();
    return q ? candidates.filter(p => (p.poolNo || '').toLowerCase().includes(q)) : candidates;
  }, [candidates, poolSearch]);

  const selectedPools = useMemo(() => candidates.filter(p => selected.has(p.id)), [candidates, selected]);
  const unfinishedSelected = selectedPools.filter(p => !isProductionComplete(p));

  const toggle = (id: string) => setSelected(prev => {
    const n = new Set(prev);
    if (n.has(id)) n.delete(id); else n.add(id);
    return n;
  });

  const changeProject = (name: string) => {
    setProject(name); setSelected(new Set()); setTyped(''); setTypedFeedback(''); setPoolSearch(''); setSuccess(null);
  };

  const applyTyped = () => {
    if (!project) return;
    const { matched, notFound } = parsePoolNumbers(typed, candidates);
    setSelected(prev => new Set([...Array.from(prev), ...Array.from(matched)]));
    setTypedFeedback(
      `${matched.size} pool(s) selected${notFound.length ? ` · not found in ${project} (or already in warehouse / delivered): ${notFound.join(', ')}` : ''}`
    );
  };

  const submit = () => {
    if (!project || selectedPools.length === 0) return;
    const when = new Date(`${receiveDate}T${new Date().toTimeString().slice(0, 8)}`);
    const iso = isNaN(when.getTime()) ? new Date().toISOString() : when.toISOString();
    const nums = selectedPools.map(p => p.poolNo).join(', ');
    let msg = `Record ${selectedPools.length} pool(s) of "${project}" as RECEIVED in ${WAREHOUSE_NAME} on ${dayLabel(receiveDate)}?\n\nPools: ${nums}`;
    if (unfinishedSelected.length > 0) {
      msg += `\n\n⚠ ${unfinishedSelected.length} of these are not marked finished in production yet: ${unfinishedSelected.map(p => p.poolNo).join(', ')}`;
    }
    if (!window.confirm(msg)) return;
    onReceive(selectedPools.map(p => p.id), { receivedAt: iso, receivedBy: currentUserName || 'Warehouse', note: note.trim() });
    setSuccess(`✓ ${selectedPools.length} pool(s) of ${project} recorded in ${WAREHOUSE_NAME} on ${dayLabel(receiveDate)}.`);
    setSelected(new Set()); setTyped(''); setTypedFeedback(''); setNote('');
  };

  // ── register (date-wise) ──
  const projectNames = useMemo(
    () => Array.from(new Set(pools.filter(p => p.warehouseReceivedAt).map(p => p.projectName))).sort(),
    [pools]
  );

  const registerPools = useMemo(
    () => pools.filter(p => {
      const d = localDay(p.warehouseReceivedAt);
      if (!d || d < fromDay || d > toDay) return false;
      if (projectFilter !== 'all' && p.projectName !== projectFilter) return false;
      return true;
    }),
    [pools, fromDay, toDay, projectFilter]
  );

  const days = useMemo(() => {
    const byDay = new Map<string, Map<string, Pool[]>>();
    registerPools.forEach(p => {
      const d = localDay(p.warehouseReceivedAt);
      if (!byDay.has(d)) byDay.set(d, new Map());
      const proj = byDay.get(d)!;
      if (!proj.has(p.projectName)) proj.set(p.projectName, []);
      proj.get(p.projectName)!.push(p);
    });
    return Array.from(byDay.entries())
      .sort((a, b) => b[0].localeCompare(a[0]))
      .map(([day, proj]) => {
        const groups = Array.from(proj.entries())
          .map(([name, list]) => ({ name, list: [...list].sort(byPoolNo) }))
          .sort((a, b) => b.list.length - a.list.length || a.name.localeCompare(b.name));
        return { day, groups, total: groups.reduce((s, g) => s + g.list.length, 0) };
      });
  }, [registerPools]);

  const exportRegister = () => {
    const rows = [...registerPools]
      .sort((a, b) => (b.warehouseReceivedAt || '').localeCompare(a.warehouseReceivedAt || '') || a.projectName.localeCompare(b.projectName) || byPoolNo(a, b))
      .map(p => ({
        'Received Date': localDay(p.warehouseReceivedAt),
        'Time': timeLabel(p.warehouseReceivedAt),
        'Project': p.projectName,
        'Pool No': p.poolNo,
        'Received By': p.warehouseReceivedBy || '',
        'Note': p.warehouseNote || '',
        'Status': p.isDelivered ? 'Delivered' : 'In warehouse',
      }));
    if (rows.length === 0) { alert('Nothing to export for these filters.'); return; }
    exportToExcel(rows, `Warehouse_Register_${fromDay}_to_${toDay}`, 'Warehouse');
  };

  // ── stock by project ──
  const stock = useMemo(() => {
    const m = new Map<string, { project: string; warehouse: Pool[]; factory: number; delivered: number; total: number }>();
    pools.forEach(p => {
      const name = p.projectName || 'Unassigned';
      let r = m.get(name);
      if (!r) { r = { project: name, warehouse: [], factory: 0, delivered: 0, total: 0 }; m.set(name, r); }
      r.total++;
      if (p.isDelivered) r.delivered++;
      else if (p.warehouseReceivedAt) r.warehouse.push(p);
      else r.factory++;
    });
    return Array.from(m.values())
      .filter(r => r.warehouse.length > 0)
      .sort((a, b) => b.warehouse.length - a.warehouse.length || a.project.localeCompare(b.project));
  }, [pools]);

  const undo = (p: Pool) => {
    if (!window.confirm(`Move pool ${p.poolNo} (${p.projectName}) back to the FACTORY? Use this only to correct a wrong entry.`)) return;
    onReturn([p.id]);
  };

  const inputCls = 'px-2.5 py-1.5 text-xs border border-slate-200 rounded-lg bg-slate-50 focus:outline-none focus:ring-1 focus:ring-indigo-400';
  const statCard = (label: string, value: number, sub: string, cls: string, Icon: any) => (
    <div className={`rounded-2xl border p-4 flex items-center gap-3 ${cls}`}>
      <div className="bg-white/70 rounded-xl p-2.5"><Icon className="h-5 w-5" /></div>
      <div>
        <p className="text-[10px] font-bold uppercase tracking-wider opacity-70">{label}</p>
        <p className="text-2xl font-black leading-none mt-0.5">{value.toLocaleString('en-US')}</p>
        <p className="text-[10px] opacity-70 mt-1">{sub}</p>
      </div>
    </div>
  );

  return (
    <div className="space-y-6 animate-fadeIn" data-testid="warehouse-register">
      {/* Header */}
      <div>
        <h2 className="text-xl font-black text-slate-800 flex items-center gap-2">
          <Warehouse className="h-6 w-6 text-indigo-600" /> {WAREHOUSE_NAME} — Pool Receiving
        </h2>
        <p className="text-xs text-slate-500 mt-1 max-w-3xl">
          When pools arrive from the factory, choose the project, tick the pool numbers and confirm. Each entry is saved with the date, the project, the pool numbers and your name — and shows up in the Management portal and Live Analytics straight away.
        </p>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        {statCard('In Factory', counts.inFactory, 'not delivered, still at the factory', 'bg-amber-50 border-amber-100 text-amber-800', Factory)}
        {statCard('In Warehouse', counts.inWarehouse, `received in ${WAREHOUSE_NAME}`, 'bg-indigo-50 border-indigo-100 text-indigo-800', Warehouse)}
        {statCard('Received Today', receivedToday, 'entered today', 'bg-emerald-50 border-emerald-100 text-emerald-800', PackagePlus)}
        {statCard('Delivered', counts.delivered, 'already handed over', 'bg-violet-50 border-violet-100 text-violet-800', Truck)}
      </div>

      {/* Entry form */}
      <div className="bg-white border border-slate-100 rounded-2xl p-5 shadow-sm space-y-4">
        <h3 className="text-sm font-extrabold text-slate-800 flex items-center gap-2"><PackagePlus className="h-4 w-4 text-indigo-600" /> Receive pools into the warehouse</h3>

        {success && (
          <div className="bg-emerald-50 border border-emerald-200 text-emerald-800 text-xs font-bold rounded-xl px-3 py-2">{success}</div>
        )}

        <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
          <label className="text-[11px] font-bold text-slate-500">
            Date received
            <input type="date" value={receiveDate} max={today} onChange={e => setReceiveDate(e.target.value || today)} className={`${inputCls} w-full mt-1`} data-testid="warehouse-date" />
          </label>
          <label className="text-[11px] font-bold text-slate-500">
            Project
            <select value={project} onChange={e => changeProject(e.target.value)} className={`${inputCls} w-full mt-1`} data-testid="warehouse-project">
              <option value="">— choose project —</option>
              {projectsInFactory.map(([name, n]) => <option key={name} value={name}>{name} ({n} in factory)</option>)}
            </select>
          </label>
          <label className="text-[11px] font-bold text-slate-500">
            Remark (optional)
            <input value={note} onChange={e => setNote(e.target.value)} placeholder="e.g. truck number, driver, damage…" className={`${inputCls} w-full mt-1`} />
          </label>
        </div>

        {!project ? (
          <div className="text-center text-xs text-slate-400 py-8 bg-slate-50/70 rounded-xl border border-dashed border-slate-200">
            Choose a project to see the pools that are still in the factory.
          </div>
        ) : (
          <>
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
              <div>
                <p className="text-[11px] font-bold text-slate-500 mb-1">Quick entry — type the pool numbers</p>
                <div className="flex gap-2">
                  <input
                    value={typed}
                    onChange={e => setTyped(e.target.value)}
                    onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); applyTyped(); } }}
                    placeholder="e.g. 101, 102, 105-110"
                    className={`${inputCls} flex-1`}
                    data-testid="warehouse-typed"
                  />
                  <button onClick={applyTyped} className="px-3 py-1.5 text-xs font-bold rounded-lg bg-slate-800 text-white hover:bg-slate-900 cursor-pointer">Select</button>
                </div>
                {typedFeedback && <p className="text-[11px] text-slate-500 mt-1">{typedFeedback}</p>}
              </div>
              <div>
                <p className="text-[11px] font-bold text-slate-500 mb-1">Or search and tick below</p>
                <div className="relative">
                  <Search className="h-3.5 w-3.5 text-slate-400 absolute left-2.5 top-1/2 -translate-y-1/2" />
                  <input value={poolSearch} onChange={e => setPoolSearch(e.target.value)} placeholder="Search pool number…" className={`${inputCls} w-full pl-8`} />
                </div>
              </div>
            </div>

            <div className="flex flex-wrap items-center gap-2 text-[11px]">
              <span className="font-bold text-slate-600">{candidates.length} pool(s) of {project} still in the factory</span>
              <span className="text-slate-300">|</span>
              <button onClick={() => setSelected(new Set(candidates.map(p => p.id)))} className="font-bold text-indigo-600 hover:underline cursor-pointer">Select all</button>
              <button onClick={() => setSelected(new Set(candidates.filter(isProductionComplete).map(p => p.id)))} className="font-bold text-emerald-600 hover:underline cursor-pointer">Select finished only</button>
              <button onClick={() => setSelected(new Set())} className="font-bold text-slate-500 hover:underline cursor-pointer">Clear</button>
              <span className="ml-auto flex items-center gap-3 text-slate-400">
                <span className="flex items-center gap-1"><span className="h-2.5 w-2.5 rounded bg-emerald-100 border border-emerald-400 inline-block" /> finished</span>
                <span className="flex items-center gap-1"><span className="h-2.5 w-2.5 rounded bg-amber-50 border border-amber-300 inline-block" /> still in production</span>
              </span>
            </div>

            <div className="flex flex-wrap gap-1.5 max-h-56 overflow-y-auto p-1">
              {visibleCandidates.length === 0 && <p className="text-xs text-slate-400 py-4">No matching pools.</p>}
              {visibleCandidates.map(p => {
                const on = selected.has(p.id);
                const done = isProductionComplete(p);
                return (
                  <button
                    key={p.id}
                    onClick={() => toggle(p.id)}
                    title={done ? 'Production finished' : `Still in production — ${STAGES[p.currentStageIndex]?.name || ''}`}
                    className={`px-2.5 py-1 rounded-lg text-xs font-mono font-bold border cursor-pointer transition-all ${
                      on
                        ? 'bg-indigo-600 text-white border-indigo-600 shadow-sm'
                        : done
                          ? 'bg-emerald-50 text-emerald-800 border-emerald-300 hover:bg-emerald-100'
                          : 'bg-amber-50 text-amber-800 border-amber-300 hover:bg-amber-100'
                    }`}
                  >
                    {p.poolNo}
                  </button>
                );
              })}
            </div>

            {unfinishedSelected.length > 0 && (
              <div className="flex items-start gap-2 bg-amber-50 border border-amber-200 text-amber-800 text-xs rounded-xl px-3 py-2">
                <AlertTriangle className="h-4 w-4 shrink-0 mt-0.5" />
                <span>{unfinishedSelected.length} selected pool(s) are not finished in production yet ({unfinishedSelected.slice(0, 8).map(p => p.poolNo).join(', ')}{unfinishedSelected.length > 8 ? '…' : ''}). You can still record them — you will be asked to confirm.</span>
              </div>
            )}

            <div className="flex flex-wrap items-center justify-between gap-3 pt-1">
              <p className="text-sm font-bold text-slate-700">
                Selected: <span className="text-indigo-700 text-lg font-black">{selectedPools.length}</span> pool(s)
                {selectedPools.length > 0 && <span className="text-xs text-slate-400 font-normal ml-2">{selectedPools.slice(0, 12).map(p => p.poolNo).join(', ')}{selectedPools.length > 12 ? '…' : ''}</span>}
              </p>
              <button
                onClick={submit}
                disabled={selectedPools.length === 0}
                data-testid="warehouse-submit"
                className="flex items-center gap-2 px-5 py-2.5 text-sm font-black rounded-xl bg-indigo-600 text-white hover:bg-indigo-700 disabled:bg-slate-200 disabled:text-slate-400 disabled:cursor-not-allowed cursor-pointer"
              >
                <CheckCircle2 className="h-4 w-4" /> Confirm received ({selectedPools.length})
              </button>
            </div>
          </>
        )}
      </div>

      {/* Date-wise register */}
      <div className="bg-white border border-slate-100 rounded-2xl p-5 shadow-sm">
        <div className="flex flex-wrap items-start justify-between gap-3 mb-4">
          <div>
            <h3 className="text-sm font-extrabold text-slate-800 flex items-center gap-2"><CalendarDays className="h-4 w-4 text-indigo-600" /> Date-wise receiving register</h3>
            <p className="text-xs text-slate-400 mt-0.5">Every day's receipts shown separately, by project, with the pool numbers.</p>
          </div>
          <button onClick={exportRegister} className="flex items-center gap-1 px-2.5 py-1.5 text-[11px] font-bold rounded-lg border border-slate-200 bg-white hover:bg-slate-50 text-slate-700 cursor-pointer">
            <Download className="h-3 w-3" /> Excel
          </button>
        </div>

        <div className="flex flex-wrap items-center gap-2 mb-4">
          <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">From</span>
          <input type="date" value={fromDay} onChange={e => setFromDay(e.target.value)} className={inputCls} />
          <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">To</span>
          <input type="date" value={toDay} onChange={e => setToDay(e.target.value)} className={inputCls} />
          <select value={projectFilter} onChange={e => setProjectFilter(e.target.value)} className={inputCls}>
            <option value="all">All projects</option>
            {projectNames.map(n => <option key={n} value={n}>{n}</option>)}
          </select>
          <div className="flex gap-1 ml-1">
            {([['Today', 0], ['7 days', 6], ['30 days', 29]] as [string, number][]).map(([label, back]) => (
              <button key={label} onClick={() => { setFromDay(shiftDay(today, -back)); setToDay(today); }} className="px-2 py-1 text-[11px] font-bold rounded-lg bg-slate-100 hover:bg-slate-200 text-slate-600 cursor-pointer">{label}</button>
            ))}
            <button onClick={() => { setFromDay('2000-01-01'); setToDay(today); }} className="px-2 py-1 text-[11px] font-bold rounded-lg bg-slate-100 hover:bg-slate-200 text-slate-600 cursor-pointer">All time</button>
          </div>
          <span className="ml-auto text-xs font-bold text-slate-600">{registerPools.length} pool(s) · {days.length} day(s)</span>
        </div>

        {days.length === 0 ? (
          <div className="text-center text-xs text-slate-400 py-10 bg-slate-50/70 rounded-xl border border-dashed border-slate-200">No pools were received in this period.</div>
        ) : (
          <div className="space-y-3">
            {days.map(d => (
              <div key={d.day} className="border border-slate-100 rounded-xl overflow-hidden">
                <div className="flex flex-wrap items-center justify-between gap-2 bg-slate-50 px-4 py-2.5">
                  <p className="text-sm font-extrabold text-slate-800">{dayLabel(d.day)}</p>
                  <p className="text-sm font-black text-indigo-700">{d.total} pool{d.total === 1 ? '' : 's'} received</p>
                </div>
                <div className="divide-y divide-slate-50">
                  {d.groups.map(g => {
                    const by = Array.from(new Set(g.list.map(p => p.warehouseReceivedBy).filter(Boolean)));
                    const notes = Array.from(new Set(g.list.map(p => p.warehouseNote).filter(Boolean)));
                    return (
                      <div key={g.name} className="px-4 py-3">
                        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 mb-2">
                          <span className="text-sm font-bold text-slate-800">{g.name}</span>
                          <span className="text-xs font-black text-indigo-700 bg-indigo-50 border border-indigo-100 rounded-full px-2 py-0.5">{g.list.length} pool{g.list.length === 1 ? '' : 's'}</span>
                          {by.length > 0 && <span className="text-[11px] text-slate-400">entered by {by.join(', ')}</span>}
                          {notes.length > 0 && <span className="text-[11px] text-slate-400 italic">“{notes.join(' / ')}”</span>}
                        </div>
                        <div className="flex flex-wrap gap-1.5">
                          {g.list.map(p => (
                            <span
                              key={p.id}
                              title={`${p.poolNo} · ${timeLabel(p.warehouseReceivedAt)}${p.warehouseReceivedBy ? ` · ${p.warehouseReceivedBy}` : ''}`}
                              className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-lg text-xs font-mono font-bold border ${
                                p.isDelivered ? 'bg-violet-50 text-violet-700 border-violet-200' : 'bg-indigo-50 text-indigo-800 border-indigo-200'
                              }`}
                            >
                              {p.poolNo}
                              {p.isDelivered
                                ? <span className="text-[9px] font-sans font-bold uppercase">delivered</span>
                                : (
                                  <button onClick={() => undo(p)} title="Wrong entry? Move back to factory" className="text-indigo-300 hover:text-rose-600 cursor-pointer">
                                    <Undo2 className="h-3 w-3" />
                                  </button>
                                )}
                            </span>
                          ))}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Stock by project */}
      <div className="bg-white border border-slate-100 rounded-2xl p-5 shadow-sm">
        <h3 className="text-sm font-extrabold text-slate-800 flex items-center gap-2 mb-1"><Boxes className="h-4 w-4 text-indigo-600" /> In the warehouse now — by project</h3>
        <p className="text-xs text-slate-400 mb-4">Pools currently stored in {WAREHOUSE_NAME} (not yet delivered). Click a project to see the pool numbers.</p>
        {stock.length === 0 ? (
          <div className="text-center text-xs text-slate-400 py-8 bg-slate-50/70 rounded-xl border border-dashed border-slate-200">No pools are in the warehouse right now.</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="min-w-full text-xs">
              <thead>
                <tr className="border-b border-slate-100">
                  <th className="text-left font-bold text-slate-500 uppercase tracking-wider px-3 py-2.5 text-[10px]">Project</th>
                  <th className="text-center font-bold text-indigo-600 uppercase tracking-wider px-3 py-2.5 text-[10px]">In Warehouse</th>
                  <th className="text-center font-bold text-amber-600 uppercase tracking-wider px-3 py-2.5 text-[10px]">Still in Factory</th>
                  <th className="text-center font-bold text-violet-600 uppercase tracking-wider px-3 py-2.5 text-[10px]">Delivered</th>
                  <th className="text-center font-bold text-slate-500 uppercase tracking-wider px-3 py-2.5 text-[10px]">Total Pools</th>
                </tr>
              </thead>
              <tbody>
                {stock.map(r => (
                  <React.Fragment key={r.project}>
                    <tr onClick={() => setOpenProject(openProject === r.project ? null : r.project)} className="border-b border-slate-50 hover:bg-slate-50/60 cursor-pointer">
                      <td className="px-3 py-2 font-bold text-slate-700">{r.project}</td>
                      <td className="px-3 py-2 text-center font-mono font-black text-indigo-700">{r.warehouse.length}</td>
                      <td className="px-3 py-2 text-center font-mono text-amber-700">{r.factory}</td>
                      <td className="px-3 py-2 text-center font-mono text-violet-700">{r.delivered}</td>
                      <td className="px-3 py-2 text-center font-mono text-slate-600">{r.total}</td>
                    </tr>
                    {openProject === r.project && (
                      <tr className="bg-indigo-50/40">
                        <td colSpan={5} className="px-4 py-3">
                          <div className="flex flex-wrap gap-1.5">
                            {[...r.warehouse].sort(byPoolNo).map(p => (
                              <span key={p.id} title={`Received ${localDay(p.warehouseReceivedAt)}`} className="px-2 py-0.5 rounded-lg text-xs font-mono font-bold bg-white border border-indigo-200 text-indigo-800">
                                {p.poolNo} <span className="text-[9px] font-sans text-slate-400">{localDay(p.warehouseReceivedAt).slice(5)}</span>
                              </span>
                            ))}
                          </div>
                        </td>
                      </tr>
                    )}
                  </React.Fragment>
                ))}
              </tbody>
              <tfoot>
                <tr className="border-t-2 border-slate-200 bg-slate-50/70">
                  <td className="px-3 py-2.5 font-black text-slate-700">TOTAL</td>
                  <td className="px-3 py-2.5 text-center font-mono font-black text-indigo-700">{stock.reduce((s, r) => s + r.warehouse.length, 0)}</td>
                  <td className="px-3 py-2.5 text-center font-mono font-black text-amber-700">{stock.reduce((s, r) => s + r.factory, 0)}</td>
                  <td className="px-3 py-2.5 text-center font-mono font-black text-violet-700">{stock.reduce((s, r) => s + r.delivered, 0)}</td>
                  <td className="px-3 py-2.5 text-center font-mono font-black text-slate-800">{stock.reduce((s, r) => s + r.total, 0)}</td>
                </tr>
              </tfoot>
            </table>
          </div>
        )}
      </div>
    </div>
  );
};
