import React, { useEffect, useMemo, useState } from 'react';
import { Download, Search, Scale, Info } from 'lucide-react';
import * as XLSX from 'xlsx';
import { BOMItem, ConsumptionLog, FloorStock, Material, MaterialRequest, MaterialReturn, ProductionLog } from '../types';
import { computeFloorUsage, UsageRow, UsageStatus } from '../lib/floorUsage';

interface Props {
  requests: MaterialRequest[];
  consumptionLogs: ConsumptionLog[];
  materialReturns: MaterialReturn[];
  floorStock: FloorStock[];
  bom: BOMItem[];
  materials: Material[];
  fromDate: string;   // shared date filter from the Store portal ('' = no limit)
  toDate: string;
  // Supplied by StoreModule (dbFetchProductionLogs) so this page stays free of
  // Firebase imports and is easy to test.
  loadProduction: () => Promise<ProductionLog[]>;
}

type View = 'section' | 'material';
type StatusFilter = 'all' | 'over' | 'ok' | 'under' | 'other';

const STATUS_LABEL: Record<UsageStatus, string> = {
  over: 'Over BOM — wastage',
  ok: 'As per BOM',
  under: 'Under BOM',
  no_bom: 'Not in BOM',
  no_production: 'No production logged',
};

const STATUS_BADGE: Record<UsageStatus, string> = {
  over: 'bg-rose-600 text-white',
  ok: 'bg-emerald-50 text-emerald-700 border border-emerald-300',
  under: 'bg-amber-50 text-amber-700 border border-amber-300',
  no_bom: 'bg-slate-100 text-slate-500 border border-slate-300',
  no_production: 'bg-slate-100 text-slate-500 border border-slate-300',
};

const ROW_TINT: Record<UsageStatus, string> = {
  over: 'bg-rose-50 border-l-4 border-l-rose-600',
  ok: '',
  under: 'bg-amber-50 border-l-4 border-l-amber-700',
  no_bom: '',
  no_production: '',
};

const fmt = (v: number): string => v.toLocaleString('en-US', { maximumFractionDigits: 2 });

// Store portal → "Floor Usage": what each section actually used from the
// floor, against what the BOM says it should have used for the pools it
// built. The maths lives in lib/floorUsage.ts (read the header there).
export const FloorUsagePage: React.FC<Props> = ({ requests, consumptionLogs, materialReturns, floorStock, bom, materials, fromDate, toDate, loadProduction }) => {
  const [production, setProduction] = useState<ProductionLog[]>([]);
  const [prodLoaded, setProdLoaded] = useState(false);
  const [view, setView] = useState<View>('section');
  const [sectionFilter, setSectionFilter] = useState('');
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all');
  const [tolerance, setTolerance] = useState('5');
  const [search, setSearch] = useState('');

  // Production logs (pools completed per stage) are the "work done" the BOM
  // is multiplied by. Loaded here so the rest of the Store portal isn't
  // slowed down by one more read every 15 seconds.
  useEffect(() => {
    let alive = true;
    const load = async () => {
      try {
        const p = await loadProduction();
        if (alive) { setProduction(Array.isArray(p) ? p : []); setProdLoaded(true); }
      } catch { if (alive) setProdLoaded(true); }
    };
    load();
    const t = setInterval(load, 60000);
    return () => { alive = false; clearInterval(t); };
  }, [loadProduction]);

  const tolPct = Math.min(100, Math.max(0, Number(tolerance) || 0));

  const usage = useMemo(() => computeFloorUsage({
    requests, consumption: consumptionLogs, returns: materialReturns, floorStock, bom, production, materials,
    from: fromDate || undefined, to: toDate || undefined, tolerancePct: tolPct,
  }), [requests, consumptionLogs, materialReturns, floorStock, bom, production, materials, fromDate, toDate, tolPct]);

  const baseRows: UsageRow[] = view === 'section'
    ? usage.bySection.filter(r => !sectionFilter || r.sectionId === sectionFilter)
    : usage.byMaterial;

  const counts = useMemo(() => {
    const c = { over: 0, ok: 0, under: 0, other: 0 };
    for (const r of baseRows) {
      if (r.status === 'over') c.over++; else if (r.status === 'ok') c.ok++; else if (r.status === 'under') c.under++; else c.other++;
    }
    return c;
  }, [baseRows]);

  const rows = useMemo(() => {
    const q = search.trim().toLowerCase();
    return baseRows.filter(r => {
      if (statusFilter === 'other' ? !(r.status === 'no_bom' || r.status === 'no_production') : statusFilter !== 'all' && r.status !== statusFilter) return false;
      if (!q) return true;
      return `${r.materialName} ${r.sectionName}`.toLowerCase().includes(q);
    });
  }, [baseRows, statusFilter, search]);

  const exportExcel = () => {
    const data = rows.map(r => ({
      Section: r.sectionName,
      Material: r.materialName,
      Unit: r.unit,
      'Issued to floor': r.issued,
      Returned: r.returned,
      Consumed: r.consumed,
      'On floor now': r.onFloor,
      'BOM expected': r.expected ?? '',
      'Over / (under) BOM': r.variance ?? '',
      'Variance %': r.variancePct ?? '',
      Result: STATUS_LABEL[r.status],
      'Shared by sections': r.shared ? 'Yes' : '',
    }));
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(data.length ? data : [{ Section: '', Material: '' }]), 'Floor Usage');
    XLSX.writeFile(wb, `floor_usage_${view}_${new Date().toISOString().slice(0, 10)}.xlsx`);
  };

  const pill = (id: StatusFilter, label: string, count: number | null, active: string) => (
    <button
      key={id}
      onClick={() => setStatusFilter(id)}
      data-testid={`fu-filter-${id}`}
      className={`px-3 py-1.5 rounded-lg text-xs font-bold cursor-pointer border transition-all ${statusFilter === id ? active : 'bg-white border-slate-200 text-slate-500 hover:text-slate-800'}`}
    >
      {label}{count !== null && <span className="opacity-70"> ({count})</span>}
    </button>
  );

  const periodText = fromDate || toDate ? `${fromDate || 'start'} → ${toDate || 'today'}` : 'all time';

  return (
    <div data-testid="floor-usage-page">
      <div className="flex items-start gap-2 mb-4 text-[11px] text-slate-500 bg-white border border-slate-200 rounded-xl p-3">
        <Info className="h-4 w-4 text-slate-500 shrink-0 mt-0.5" />
        <div>
          <strong className="text-slate-800">How to read this ({periodText}):</strong> <em>Issued</em> is what Store approved to the floor (already out of inventory),
          <em> Consumed</em> is what the supervisor logged as used, <em>BOM expected</em> is the pools that section logged × the BOM quantity per pool.
          Consumed above expected (beyond the tolerance) is flagged as <strong className="text-rose-700">wastage</strong>.
          Use the date filter above to change the period.
        </div>
      </div>

      {/* Summary */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-4">
        <div className="bg-rose-50 border border-rose-300 rounded-xl p-4">
          <div className="text-[10px] font-bold uppercase text-rose-700">Over BOM (wastage)</div>
          <div className="text-2xl font-black text-slate-900 mt-1" data-testid="fu-count-over">{counts.over}</div>
        </div>
        <div className="bg-emerald-50 border border-emerald-200 rounded-xl p-4">
          <div className="text-[10px] font-bold uppercase text-emerald-700">As per BOM</div>
          <div className="text-2xl font-black text-slate-900 mt-1" data-testid="fu-count-ok">{counts.ok}</div>
        </div>
        <div className="bg-amber-50 border border-amber-200 rounded-xl p-4">
          <div className="text-[10px] font-bold uppercase text-amber-700">Under BOM</div>
          <div className="text-2xl font-black text-slate-900 mt-1" data-testid="fu-count-under">{counts.under}</div>
        </div>
        <div className="bg-white border border-slate-200 rounded-xl p-4">
          <div className="text-[10px] font-bold uppercase text-slate-500">Can't compare</div>
          <div className="text-2xl font-black text-slate-900 mt-1" data-testid="fu-count-other">{counts.other}</div>
          <div className="text-[10px] text-slate-500">not in BOM / no production</div>
        </div>
      </div>

      {/* Controls */}
      <div className="flex flex-wrap items-center gap-2 mb-3">
        <div className="flex rounded-lg overflow-hidden border border-slate-300">
          <button onClick={() => setView('section')} data-testid="fu-view-section" className={`px-3 py-1.5 text-xs font-bold cursor-pointer ${view === 'section' ? 'bg-primary-600 text-white' : 'bg-white text-slate-500 hover:text-slate-800'}`}>By section</button>
          <button onClick={() => setView('material')} data-testid="fu-view-material" className={`px-3 py-1.5 text-xs font-bold cursor-pointer ${view === 'material' ? 'bg-primary-600 text-white' : 'bg-white text-slate-500 hover:text-slate-800'}`}>By material</button>
        </div>
        {view === 'section' && (
          <select value={sectionFilter} onChange={e => setSectionFilter(e.target.value)} data-testid="fu-section" className="bg-slate-100 border border-slate-300 rounded-lg px-2 py-1.5 text-xs text-slate-900">
            <option value="">All sections</option>
            {usage.sections.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
          </select>
        )}
        {pill('all', 'All', baseRows.length, 'bg-primary-600 border-primary-600 text-white')}
        {pill('over', 'Over BOM', counts.over, 'bg-rose-600 border-rose-600 text-white')}
        {pill('ok', 'As per BOM', counts.ok, 'bg-emerald-700 border-emerald-300 text-white')}
        {pill('under', 'Under BOM', counts.under, 'bg-amber-700 border-amber-300 text-white')}
        {pill('other', "Can't compare", counts.other, 'bg-slate-200 border-slate-300 text-slate-900')}
        <div className="ml-auto flex items-center gap-2">
          <label className="flex items-center gap-1.5 text-[11px] text-slate-500" title="Consumed may differ from the BOM by this much before it is flagged">
            Tolerance
            <input type="number" min={0} max={100} value={tolerance} onChange={e => setTolerance(e.target.value)} data-testid="fu-tolerance" className="w-14 bg-slate-100 border border-slate-300 rounded-lg px-2 py-1.5 text-xs text-slate-900" />%
          </label>
          <div className="relative">
            <Search className="h-3.5 w-3.5 text-slate-500 absolute left-2.5 top-1/2 -translate-y-1/2" />
            <input placeholder="Search material or section…" value={search} onChange={e => setSearch(e.target.value)} data-testid="fu-search" className="bg-slate-100 border border-slate-300 rounded-lg pl-8 pr-2 py-1.5 text-xs text-slate-900 w-52" />
          </div>
          <button onClick={exportExcel} data-testid="fu-export" className="flex items-center gap-1.5 px-3 py-1.5 bg-emerald-600 hover:bg-emerald-700 text-white rounded-lg text-xs font-bold cursor-pointer"><Download className="h-3.5 w-3.5" /> Excel</button>
        </div>
      </div>

      {/* Table */}
      <div className="bg-white border border-slate-200 rounded-xl overflow-x-auto overflow-y-auto max-h-[70vh]">
        <table className="w-full min-w-[980px] text-xs">
          <thead>
            <tr className="sticky top-0 z-10 bg-slate-100 text-slate-500 uppercase text-[10px]">
              <th className="text-left px-4 py-2">{view === 'section' ? 'Section' : 'Sections'}</th>
              <th className="text-left px-4 py-2">Material</th>
              <th className="text-right px-4 py-2">Issued to floor</th>
              <th className="text-right px-4 py-2">Returned</th>
              <th className="text-right px-4 py-2">Consumed</th>
              <th className="text-right px-4 py-2">On floor now</th>
              <th className="text-right px-4 py-2">BOM expected</th>
              <th className="text-right px-4 py-2">Over / (under)</th>
              <th className="text-center px-4 py-2">Result</th>
            </tr>
          </thead>
          <tbody>
            {rows.map(r => (
              <tr key={r.key} data-testid={`fu-row-${r.key}`} data-status={r.status} className={`border-t border-slate-200 ${ROW_TINT[r.status]}`}>
                <td className="px-4 py-2 text-slate-700">{r.sectionName}</td>
                <td className="px-4 py-2 text-slate-900 font-semibold">
                  {r.materialName}
                  {view === 'section' && r.shared && (
                    <span title={`Also used by ${r.sectionsCount - 1} other section(s). The BOM is per whole pool, so check the "By material" view for the true total.`} className="ml-2 text-[9px] font-bold uppercase text-sky-700 border border-sky-200 rounded px-1 py-0.5 cursor-help">shared</span>
                  )}
                </td>
                <td className="px-4 py-2 text-right font-mono text-slate-700">{fmt(r.issued)} {r.unit}</td>
                <td className="px-4 py-2 text-right font-mono text-slate-500">{r.returned ? `${fmt(r.returned)} ${r.unit}` : '—'}</td>
                <td className="px-4 py-2 text-right font-mono text-slate-900 font-bold">{fmt(r.consumed)} {r.unit}</td>
                <td className="px-4 py-2 text-right font-mono text-slate-500">{fmt(r.onFloor)} {r.unit}</td>
                <td className="px-4 py-2 text-right font-mono text-slate-700">{r.expected === null ? '—' : `${fmt(r.expected)} ${r.unit}`}</td>
                <td className={`px-4 py-2 text-right font-mono font-bold ${r.status === 'over' ? 'text-rose-700' : r.status === 'under' ? 'text-amber-700' : 'text-slate-500'}`}>
                  {r.variance === null ? '—' : `${r.variance > 0 ? '+' : ''}${fmt(r.variance)} ${r.unit}${r.variancePct !== null ? ` (${r.variancePct > 0 ? '+' : ''}${fmt(r.variancePct)}%)` : ''}`}
                </td>
                <td className="px-4 py-2 text-center"><span className={`inline-block px-2 py-0.5 rounded-full text-[10px] font-black ${STATUS_BADGE[r.status]}`}>{STATUS_LABEL[r.status]}</span></td>
              </tr>
            ))}
          </tbody>
        </table>

        {rows.length === 0 && (
          <div className="text-center text-sm py-12 px-4 text-slate-500 flex flex-col items-center gap-2">
            <Scale className="h-6 w-6" />
            {baseRows.length === 0
              ? 'Nothing issued or consumed in this period yet.'
              : 'No rows match this filter.'}
          </div>
        )}
      </div>
      {!prodLoaded && <p className="text-[10px] text-slate-400 mt-2">Loading production logs…</p>}
    </div>
  );
};
