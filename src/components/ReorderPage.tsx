import React, { useMemo, useState } from 'react';
import { Bell, BellOff, CheckCircle2, Download, Pencil, Search, ShoppingCart } from 'lucide-react';
import * as XLSX from 'xlsx';
import { Material } from '../types';
import { getStockStatus, isFollowed, num, STATUS_ROW_CLASS, StockStatus } from '../lib/stockAlerts';
import { StockStatusBadge } from './StockStatusBadge';

interface Props {
  materials: Material[];
  onEditAlerts: (m: Material) => void;
  onToggleFollow: (m: Material) => void;
}

type Filter = 'all' | 'urgent' | 'reorder';
type Row = { m: Material; status: StockStatus; short: number };

const SEVERITY: Record<StockStatus, number> = { ok: 0, reorder: 1, urgent: 2 };

// Dedicated Reorder page: every material at or below its Reorder Level,
// Urgent ones first. Shows ALL low materials whether or not e-mail
// following is on — following only controls the e-mails.
export const ReorderPage: React.FC<Props> = ({ materials, onEditAlerts, onToggleFollow }) => {
  const [filter, setFilter] = useState<Filter>('all');
  const [search, setSearch] = useState('');

  const lowRows: Row[] = useMemo(() => {
    return materials
      .map(m => {
        const status = getStockStatus(m);
        const target = num(m.reorderLevel) || num(m.urgentLevel);
        return { m, status, short: Math.max(0, target - num(m.currentStock)) };
      })
      .filter(r => r.status !== 'ok')
      .sort((a, b) => {
        const bySeverity = SEVERITY[b.status] - SEVERITY[a.status];
        if (bySeverity !== 0) return bySeverity;
        // Within a group, the emptiest (lowest stock vs. its threshold) first.
        const ratio = (r: Row) => num(r.m.currentStock) / Math.max(num(r.m.reorderLevel), num(r.m.urgentLevel), 1);
        return ratio(a) - ratio(b) || a.m.name.localeCompare(b.m.name);
      });
  }, [materials]);

  const urgentCount = lowRows.filter(r => r.status === 'urgent').length;
  const reorderCount = lowRows.filter(r => r.status === 'reorder').length;

  const shown = useMemo(() => {
    const q = search.trim().toLowerCase();
    return lowRows.filter(r => {
      if (filter !== 'all' && r.status !== filter) return false;
      if (!q) return true;
      const hay = `${r.m.name} ${r.m.erpCode || ''} ${r.m.supplierName || ''} ${r.m.brand || ''} ${r.m.location || ''} ${r.m.category || ''}`.toLowerCase();
      return hay.includes(q);
    });
  }, [lowRows, filter, search]);

  const exportExcel = () => {
    const rows = shown.map(r => ({
      Status: r.status === 'urgent' ? 'URGENT' : 'REORDER',
      'ERP Code': r.m.erpCode || '',
      Material: r.m.name,
      Category: r.m.category || '',
      Supplier: r.m.supplierName || '',
      Brand: r.m.brand || '',
      Location: r.m.location || '',
      Unit: r.m.unit,
      'Current Stock': num(r.m.currentStock),
      'Reorder Level': num(r.m.reorderLevel),
      'Urgent Level': num(r.m.urgentLevel),
      'Short By': r.short,
      'E-mail Alerts': isFollowed(r.m) ? 'On' : 'Off',
    }));
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(
      wb,
      XLSX.utils.json_to_sheet(rows.length ? rows : [{ Status: '', Material: '' }]),
      'Reorder List',
    );
    XLSX.writeFile(wb, `reorder_list_${new Date().toISOString().slice(0, 10)}.xlsx`);
  };

  const pill = (id: Filter, label: string, count: number, activeClass: string) => (
    <button
      key={id}
      onClick={() => setFilter(id)}
      data-testid={`reorder-filter-${id}`}
      className={`px-3 py-1.5 rounded-lg text-xs font-bold cursor-pointer border transition-all ${filter === id ? activeClass : 'bg-white border-slate-200 text-slate-500 hover:text-slate-800'}`}
    >
      {label} <span className="opacity-70">({count})</span>
    </button>
  );

  return (
    <div data-testid="reorder-page">
      {/* Summary cards */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 mb-4">
        <div className="bg-rose-50 border border-rose-300 rounded-xl p-4">
          <div className="text-[10px] font-bold uppercase text-rose-700">Urgent reorder</div>
          <div className="text-2xl font-black text-slate-900 mt-1" data-testid="reorder-urgent-count">{urgentCount}</div>
          <div className="text-[11px] text-rose-700/80">at or below urgent level</div>
        </div>
        <div className="bg-rose-50 border border-rose-200 rounded-xl p-4">
          <div className="text-[10px] font-bold uppercase text-rose-700">Below reorder level</div>
          <div className="text-2xl font-black text-slate-900 mt-1" data-testid="reorder-low-count">{reorderCount}</div>
          <div className="text-[11px] text-rose-700/80">need to be reordered soon</div>
        </div>
        <div className="bg-white border border-slate-200 rounded-xl p-4">
          <div className="text-[10px] font-bold uppercase text-slate-500">Materials tracked</div>
          <div className="text-2xl font-black text-slate-900 mt-1">{materials.filter(m => num(m.reorderLevel) > 0 || num(m.urgentLevel) > 0).length}</div>
          <div className="text-[11px] text-slate-500">have a reorder or urgent level set</div>
        </div>
      </div>

      {/* Filters + search + export */}
      <div className="flex flex-wrap items-center gap-2 mb-3">
        {pill('all', 'All low stock', lowRows.length, 'bg-primary-600 border-primary-600 text-white')}
        {pill('urgent', 'Urgent', urgentCount, 'bg-rose-600 border-rose-600 text-white')}
        {pill('reorder', 'Reorder', reorderCount, 'bg-rose-600 border-rose-600 text-white')}
        <div className="ml-auto flex items-center gap-2">
          <div className="relative">
            <Search className="h-3.5 w-3.5 text-slate-500 absolute left-2.5 top-1/2 -translate-y-1/2" />
            <input
              placeholder="Search name, ERP code, supplier, location…"
              value={search}
              onChange={e => setSearch(e.target.value)}
              data-testid="reorder-search"
              className="bg-slate-100 border border-slate-300 rounded-lg pl-8 pr-2 py-1.5 text-xs text-slate-900 w-64"
            />
          </div>
          <button
            onClick={exportExcel}
            data-testid="reorder-export-excel"
            className="flex items-center gap-1.5 px-3 py-1.5 bg-emerald-600 hover:bg-emerald-700 text-white rounded-lg text-xs font-bold cursor-pointer"
          >
            <Download className="h-3.5 w-3.5" /> Excel
          </button>
        </div>
      </div>

      {/* Table */}
      <div className="bg-white border border-slate-200 rounded-xl overflow-x-auto overflow-y-auto max-h-[70vh]">
        <table className="w-full min-w-[820px] text-xs">
          <thead>
            <tr className="sticky top-0 z-10 bg-slate-100 text-slate-500 uppercase text-[10px]">
              <th className="text-left px-4 py-2">Status</th>
              <th className="text-left px-4 py-2">ERP Code</th>
              <th className="text-left px-4 py-2">Material</th>
              <th className="text-left px-4 py-2">Supplier</th>
              <th className="text-left px-4 py-2">Location</th>
              <th className="text-right px-4 py-2">Current Stock</th>
              <th className="text-right px-4 py-2">Reorder At</th>
              <th className="text-right px-4 py-2">Urgent At</th>
              <th className="text-right px-4 py-2">Short By</th>
              <th className="px-4 py-2 text-right">Alerts</th>
            </tr>
          </thead>
          <tbody>
            {shown.map(({ m, status, short }) => (
              <tr key={m.id} className={`border-t border-slate-200 ${STATUS_ROW_CLASS[status]}`} data-testid={`reorder-row-${m.id}`}>
                <td className="px-4 py-2"><StockStatusBadge status={status} /></td>
                <td className="px-4 py-2 text-slate-500 font-mono">{m.erpCode || '—'}</td>
                <td className="px-4 py-2 text-slate-900 font-semibold">{m.name}</td>
                <td className="px-4 py-2 text-slate-500">{m.supplierName || '—'}</td>
                <td className="px-4 py-2 text-slate-500">{m.location || '—'}</td>
                <td className="px-4 py-2 text-right font-mono font-bold text-rose-700">{m.currentStock} {m.unit}</td>
                <td className="px-4 py-2 text-right text-slate-500">{num(m.reorderLevel) || '—'}</td>
                <td className="px-4 py-2 text-right text-slate-500">{num(m.urgentLevel) || '—'}</td>
                <td className="px-4 py-2 text-right font-mono text-slate-800">{short > 0 ? `${short} ${m.unit}` : 'at level'}</td>
                <td className="px-4 py-2">
                  <div className="flex items-center justify-end gap-2">
                    <button
                      onClick={() => onToggleFollow(m)}
                      data-testid={`reorder-follow-${m.id}`}
                      title={isFollowed(m) ? 'Following — click to stop e-mails for this material' : 'Not following — click to get e-mails'}
                      className="cursor-pointer"
                    >
                      {isFollowed(m)
                        ? <Bell className="h-3.5 w-3.5 text-emerald-700" />
                        : <BellOff className="h-3.5 w-3.5 text-slate-400" />}
                    </button>
                    <button
                      onClick={() => onEditAlerts(m)}
                      data-testid={`reorder-edit-${m.id}`}
                      title="Edit reorder / urgent levels"
                      className="text-slate-500 hover:text-primary-700 cursor-pointer"
                    >
                      <Pencil className="h-3.5 w-3.5" />
                    </button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>

        {shown.length === 0 && (
          <div className="text-center text-sm py-12 px-4">
            {lowRows.length === 0 ? (
              <div className="text-emerald-700 flex flex-col items-center gap-2">
                <CheckCircle2 className="h-6 w-6" />
                <span className="font-semibold">Nothing to reorder — all stock is above its reorder level.</span>
                <span className="text-slate-500 text-xs">Set Reorder / Urgent levels from the Inventory tab (Alerts button).</span>
              </div>
            ) : (
              <span className="text-slate-500 flex items-center justify-center gap-2"><ShoppingCart className="h-4 w-4" /> No materials match this filter.</span>
            )}
          </div>
        )}
      </div>
    </div>
  );
};
