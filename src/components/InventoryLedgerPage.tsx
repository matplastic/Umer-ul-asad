import React, { useMemo, useState } from 'react';
import { Download, Search } from 'lucide-react';
import * as XLSX from 'xlsx';
import type { Material, MaterialRequest, IncomingMaterial, StockAdjustment } from '../types';
import {
  buildAllLedgers, summariseAllLedgers, periodRange, localDay, type PeriodKey,
} from '../lib/stockMovements';

interface Props {
  materials: Material[];
  requests: MaterialRequest[];
  incoming: IncomingMaterial[];
  adjustments: StockAdjustment[];
  onOpenMaterial: (m: Material) => void;
}

type View = 'movements' | 'materials' | 'dos';
type GroupFilter = 'all' | 'mep' | 'civil' | 'other';

const PERIODS: { key: PeriodKey; label: string }[] = [
  { key: 'all', label: 'All time' },
  { key: 'today', label: 'Today' },
  { key: 'week', label: 'This week' },
  { key: 'month', label: 'This month' },
  { key: 'custom', label: 'Custom' },
];
const VIEWS: { key: View; label: string }[] = [
  { key: 'movements', label: 'All movements' },
  { key: 'materials', label: 'By material' },
  { key: 'dos', label: 'By Delivery Order' },
];
const MAX_ROWS = 500;

const fmt = (n: number) => (Math.round(n * 1000) / 1000).toLocaleString(undefined, { maximumFractionDigits: 3 });
const fmtTime = (iso: string) => {
  const d = new Date(iso);
  return `${d.toLocaleDateString(undefined, { day: '2-digit', month: 'short', year: 'numeric' })} ${d.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })}`;
};
const groupOf = (m: Material): GroupFilter => (((m as any).inventoryGroup as GroupFilter) || 'other');

export const InventoryLedgerPage: React.FC<Props> = ({ materials, requests, incoming, adjustments, onOpenMaterial }) => {
  const [period, setPeriod] = useState<PeriodKey>('month');
  const [customFrom, setCustomFrom] = useState('');
  const [customTo, setCustomTo] = useState('');
  const [view, setView] = useState<View>('movements');
  const [typeFilter, setTypeFilter] = useState<'all' | 'IN' | 'OUT' | 'ADJ'>('all');
  const [groupFilter, setGroupFilter] = useState<GroupFilter>('all');
  const [search, setSearch] = useState('');
  const [showIdle, setShowIdle] = useState(false);

  const ledgers = useMemo(
    () => buildAllLedgers(materials, requests, incoming, adjustments),
    [materials, requests, incoming, adjustments],
  );
  const range = useMemo(() => periodRange(period, customFrom, customTo), [period, customFrom, customTo]);
  const { rows, perMaterial, deliveryOrders } = useMemo(() => summariseAllLedgers(ledgers, range), [ledgers, range]);

  const q = search.trim().toLowerCase();
  const matById = useMemo(() => new Map(materials.map((m) => [m.id, m])), [materials]);
  const inGroup = (materialId: string) => groupFilter === 'all' || groupOf(matById.get(materialId) as Material) === groupFilter;

  const shownRows = useMemo(() => rows.filter((r) => {
    if (!inGroup(r.materialId)) return false;
    if (typeFilter !== 'all' && r.type !== typeFilter) return false;
    return !q || `${r.materialName} ${r.ref} ${r.details} ${r.by}`.toLowerCase().includes(q);
  }), [rows, typeFilter, groupFilter, q, matById]);

  const shownMaterials = useMemo(() => perMaterial.filter((p) => {
    if (groupFilter !== 'all' && groupOf(p.material) !== groupFilter) return false;
    if (!showIdle && p.count === 0) return false;
    return !q || p.material.name.toLowerCase().includes(q);
  }), [perMaterial, groupFilter, showIdle, q]);

  const shownDos = useMemo(() => deliveryOrders.filter((d) => {
    if (groupFilter !== 'all' && !d.lines.some((l) => inGroup(l.materialId))) return false;
    return !q || `${d.doNumber} ${d.details} ${d.by} ${d.lines.map((l) => l.materialName).join(' ')}`.toLowerCase().includes(q);
  }), [deliveryOrders, groupFilter, q, matById]);

  const totalMovements = rows.length;
  const totalDos = deliveryOrders.length;

  const exportExcel = () => {
    let data: Record<string, string | number>[];
    if (view === 'movements') {
      data = shownRows.map((r) => ({
        'Date & Time': fmtTime(r.at), Material: r.materialName, Unit: r.unit,
        Type: r.type === 'IN' ? 'Stock In' : r.type === 'OUT' ? 'Delivered Out' : 'Adjustment',
        'DO / Reference': r.ref, Details: r.details, By: r.by,
        In: r.qty > 0 ? r.qty : '', Out: r.qty < 0 ? -r.qty : '', Balance: r.balance,
      }));
    } else if (view === 'materials') {
      data = shownMaterials.map((p) => ({
        Material: p.material.name, Unit: p.material.unit, Opening: p.opening, In: p.totalIn, Out: p.totalOut,
        Adjustments: p.adjustments, Closing: p.closing, Movements: p.count,
      }));
    } else {
      data = shownDos.map((d) => ({
        'DO No.': d.doNumber, 'Date & Time': fmtTime(d.at), Details: d.details, 'Delivered By': d.by,
        Materials: d.lines.map((l) => `${l.materialName} × ${fmt(l.qty)} ${l.unit}`).join('; '),
      }));
    }
    const ws = XLSX.utils.json_to_sheet(data);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Inventory Ledger');
    XLSX.writeFile(wb, `Inventory_Ledger_${view}_${localDay(new Date().toISOString())}.xlsx`);
  };

  const chip = (active: boolean) =>
    `px-3 py-1.5 rounded-lg text-xs font-bold cursor-pointer transition-all ${active ? 'bg-orange-600 text-white shadow' : 'bg-slate-800 hover:bg-slate-700 text-slate-300'}`;
  const nameBtn = (m: Material | undefined, label: string) => (
    <button
      onClick={() => m && onOpenMaterial(m)} disabled={!m}
      title="Open this material's own ledger"
      className="text-left text-slate-200 font-semibold hover:text-orange-400 hover:underline decoration-dotted underline-offset-2 cursor-pointer"
    >{label}</button>
  );

  return (
    <div className="bg-slate-900 border border-slate-800 rounded-xl" data-testid="inventory-ledger">
      <div className="flex flex-wrap items-center justify-between gap-3 px-4 py-3 border-b border-slate-800">
        <div>
          <h3 className="text-sm font-black text-white">Inventory Ledger</h3>
          <div className="text-[11px] text-slate-500">Every stock movement for every material, with its Delivery Order number. Click a material to open its own ledger.</div>
        </div>
        <button onClick={exportExcel} data-testid="invledger-export" className="flex items-center gap-1.5 px-3 py-2 bg-emerald-700 hover:bg-emerald-600 text-white rounded-lg text-xs font-bold cursor-pointer">
          <Download className="h-3.5 w-3.5" /> Excel
        </button>
      </div>

      <div className="px-4 py-3 border-b border-slate-800 space-y-3">
        <div className="flex flex-wrap items-center gap-2">
          {PERIODS.map((p) => (
            <button key={p.key} onClick={() => setPeriod(p.key)} data-testid={`invledger-period-${p.key}`} className={chip(period === p.key)}>{p.label}</button>
          ))}
          {period === 'custom' && (
            <div className="flex items-center gap-2 text-xs text-slate-400">
              <input type="date" value={customFrom} onChange={(e) => setCustomFrom(e.target.value)} data-testid="invledger-from" className="bg-slate-800 border border-slate-700 rounded-lg px-2 py-1.5 text-xs text-white" />
              <span>to</span>
              <input type="date" value={customTo} onChange={(e) => setCustomTo(e.target.value)} data-testid="invledger-to" className="bg-slate-800 border border-slate-700 rounded-lg px-2 py-1.5 text-xs text-white" />
            </div>
          )}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-[10px] uppercase font-bold text-slate-500 mr-1">View</span>
          {VIEWS.map((v) => (
            <button key={v.key} onClick={() => setView(v.key)} data-testid={`invledger-view-${v.key}`} className={chip(view === v.key)}>{v.label}</button>
          ))}
          <span className="text-slate-700 mx-1">|</span>
          {(['all', 'mep', 'civil', 'other'] as const).map((g) => (
            <button key={g} onClick={() => setGroupFilter(g)} className={chip(groupFilter === g)}>{g === 'all' ? 'All groups' : g === 'mep' ? 'MEP' : g === 'civil' ? 'Civil' : 'Other'}</button>
          ))}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {view === 'movements' && (['all', 'IN', 'OUT', 'ADJ'] as const).map((t) => (
            <button key={t} onClick={() => setTypeFilter(t)} className={chip(typeFilter === t)}>
              {t === 'all' ? 'All types' : t === 'IN' ? 'In' : t === 'OUT' ? 'Out (DO)' : 'Adjust'}
            </button>
          ))}
          {view === 'materials' && (
            <label className="flex items-center gap-1.5 text-xs text-slate-400 cursor-pointer">
              <input type="checkbox" checked={showIdle} onChange={(e) => setShowIdle(e.target.checked)} /> Include materials with no movement
            </label>
          )}
          <div className="relative ml-auto">
            <Search className="h-3.5 w-3.5 text-slate-500 absolute left-2.5 top-1/2 -translate-y-1/2" />
            <input
              value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search material, DO no, project, name…"
              data-testid="invledger-search"
              className="bg-slate-800 border border-slate-700 rounded-lg pl-8 pr-3 py-1.5 text-xs text-white w-72"
            />
          </div>
        </div>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-3 gap-3 px-4 py-3 border-b border-slate-800">
        <div className="bg-slate-800/60 border border-slate-800 rounded-xl px-3 py-2">
          <div className="text-[10px] uppercase font-bold text-slate-500">Movements in period</div>
          <div className="font-mono font-black text-base text-white" data-testid="invledger-count">{totalMovements}</div>
        </div>
        <div className="bg-slate-800/60 border border-slate-800 rounded-xl px-3 py-2">
          <div className="text-[10px] uppercase font-bold text-slate-500">Delivery Orders</div>
          <div className="font-mono font-black text-base text-sky-300" data-testid="invledger-dos">{totalDos}</div>
        </div>
        <div className="bg-slate-800/60 border border-slate-800 rounded-xl px-3 py-2 col-span-2 md:col-span-1">
          <div className="text-[10px] uppercase font-bold text-slate-500">Materials with activity</div>
          <div className="font-mono font-black text-base text-white">{perMaterial.filter((p) => p.count > 0).length}</div>
        </div>
      </div>

      <div className="overflow-auto max-h-[68vh] px-4 pb-4">
        {view === 'movements' && (
          <table className="w-full text-xs mt-3 min-w-[900px]">
            <thead className="sticky top-0 bg-slate-900 z-10">
              <tr className="text-[10px] uppercase text-slate-500">
                <th className="text-left py-2 pr-3">Date & time</th>
                <th className="text-left py-2 pr-3">Material</th>
                <th className="text-left py-2 pr-3">Type</th>
                <th className="text-left py-2 pr-3">DO / Reference</th>
                <th className="text-left py-2 pr-3">Details</th>
                <th className="text-left py-2 pr-3">By</th>
                <th className="text-right py-2 pr-3">In</th>
                <th className="text-right py-2 pr-3">Out</th>
                <th className="text-right py-2">Balance</th>
              </tr>
            </thead>
            <tbody>
              {shownRows.slice(0, MAX_ROWS).map((r) => (
                <tr key={`${r.materialId}-${r.id}`} className="border-t border-slate-800 hover:bg-slate-800/40">
                  <td className="py-2 pr-3 text-slate-400 whitespace-nowrap">{fmtTime(r.at)}</td>
                  <td className="py-2 pr-3 min-w-[140px]">{nameBtn(matById.get(r.materialId), r.materialName)}</td>
                  <td className="py-2 pr-3">
                    <span className={`px-2 py-0.5 rounded-full text-[10px] font-black uppercase border ${
                      r.type === 'IN' ? 'bg-emerald-950/40 text-emerald-400 border-emerald-800'
                      : r.type === 'OUT' ? 'bg-rose-950/40 text-rose-400 border-rose-800'
                      : 'bg-amber-950/40 text-amber-400 border-amber-800'}`}>
                      {r.type === 'IN' ? 'In' : r.type === 'OUT' ? 'Out' : 'Adjust'}
                    </span>
                  </td>
                  <td className={`py-2 pr-3 font-mono ${r.isDo ? 'text-sky-300 font-bold' : 'text-slate-400'}`}>{r.ref}</td>
                  <td className="py-2 pr-3 text-slate-300 max-w-[300px] break-words">{r.details}</td>
                  <td className="py-2 pr-3 text-slate-400">{r.by || '—'}</td>
                  <td className="py-2 pr-3 text-right font-mono text-emerald-400">{r.qty > 0 ? `+${fmt(r.qty)} ${r.unit}` : ''}</td>
                  <td className="py-2 pr-3 text-right font-mono text-rose-400">{r.qty < 0 ? `−${fmt(-r.qty)} ${r.unit}` : ''}</td>
                  <td className="py-2 text-right font-mono text-slate-200">{fmt(r.balance)} {r.unit}</td>
                </tr>
              ))}
              {shownRows.length === 0 && (
                <tr><td colSpan={9} className="text-center text-slate-500 py-10">No stock movements for this selection.</td></tr>
              )}
            </tbody>
          </table>
        )}

        {view === 'materials' && (
          <table className="w-full text-xs mt-3 min-w-[760px]">
            <thead className="sticky top-0 bg-slate-900 z-10">
              <tr className="text-[10px] uppercase text-slate-500">
                <th className="text-left py-2 pr-3">Material</th>
                <th className="text-right py-2 pr-3">Opening</th>
                <th className="text-right py-2 pr-3">In</th>
                <th className="text-right py-2 pr-3">Out (DO)</th>
                <th className="text-right py-2 pr-3">Adjust</th>
                <th className="text-right py-2 pr-3">Closing</th>
                <th className="text-right py-2">Movements</th>
              </tr>
            </thead>
            <tbody>
              {shownMaterials.map((p) => (
                <tr key={p.material.id} className="border-t border-slate-800 hover:bg-slate-800/40">
                  <td className="py-2 pr-3">{nameBtn(p.material, p.material.name)}</td>
                  <td className="py-2 pr-3 text-right font-mono text-slate-300">{fmt(p.opening)} {p.material.unit}</td>
                  <td className="py-2 pr-3 text-right font-mono text-emerald-400">{p.totalIn ? `+${fmt(p.totalIn)}` : '—'}</td>
                  <td className="py-2 pr-3 text-right font-mono text-rose-400">{p.totalOut ? `−${fmt(p.totalOut)}` : '—'}</td>
                  <td className="py-2 pr-3 text-right font-mono text-amber-400">{p.adjustments ? `${p.adjustments > 0 ? '+' : '−'}${fmt(Math.abs(p.adjustments))}` : '—'}</td>
                  <td className="py-2 pr-3 text-right font-mono text-white font-bold">{fmt(p.closing)} {p.material.unit}</td>
                  <td className="py-2 text-right text-slate-400">{p.count}</td>
                </tr>
              ))}
              {shownMaterials.length === 0 && (
                <tr><td colSpan={7} className="text-center text-slate-500 py-10">No materials with movements for this selection.</td></tr>
              )}
            </tbody>
          </table>
        )}

        {view === 'dos' && (
          <table className="w-full text-xs mt-3 min-w-[760px]">
            <thead className="sticky top-0 bg-slate-900 z-10">
              <tr className="text-[10px] uppercase text-slate-500">
                <th className="text-left py-2 pr-3">DO No.</th>
                <th className="text-left py-2 pr-3">Date & time</th>
                <th className="text-left py-2 pr-3">Project / requested by</th>
                <th className="text-left py-2 pr-3">Delivered by</th>
                <th className="text-left py-2">Materials delivered</th>
              </tr>
            </thead>
            <tbody>
              {shownDos.slice(0, MAX_ROWS).map((d) => (
                <tr key={d.doNumber} className="border-t border-slate-800 hover:bg-slate-800/40 align-top">
                  <td className="py-2 pr-3 font-mono font-bold text-sky-300 whitespace-nowrap">{d.doNumber}</td>
                  <td className="py-2 pr-3 text-slate-400 whitespace-nowrap">{fmtTime(d.at)}</td>
                  <td className="py-2 pr-3 text-slate-300 max-w-[280px] break-words">{d.details}</td>
                  <td className="py-2 pr-3 text-slate-400">{d.by || '—'}</td>
                  <td className="py-2 text-slate-200">
                    {d.lines.map((l, i) => (
                      <div key={i}>{l.materialName} <span className="font-mono text-rose-400">× {fmt(l.qty)} {l.unit}</span></div>
                    ))}
                  </td>
                </tr>
              ))}
              {shownDos.length === 0 && (
                <tr><td colSpan={5} className="text-center text-slate-500 py-10">No Delivery Orders for this selection.</td></tr>
              )}
            </tbody>
          </table>
        )}

        {((view === 'movements' && shownRows.length > MAX_ROWS) || (view === 'dos' && shownDos.length > MAX_ROWS)) && (
          <p className="text-[11px] text-amber-400 mt-3">Showing the first {MAX_ROWS} rows. Narrow the period or use search — the Excel export includes everything matching your filters.</p>
        )}
        <p className="text-[10px] text-slate-600 mt-4">
          Movements are newest first. Balances are worked back from today's stock. Stock changes made before manual adjustments were logged, or imported in bulk, are included in each material's opening balance.
        </p>
      </div>
    </div>
  );
};
