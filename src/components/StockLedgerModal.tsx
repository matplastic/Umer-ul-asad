import React, { useMemo, useState } from 'react';
import { X, Download, Search } from 'lucide-react';
import * as XLSX from 'xlsx';
import type { Material, MaterialRequest, IncomingMaterial, StockAdjustment } from '../types';
import {
  buildMovements, filterAndSummarise, groupMovements, periodRange, localDay,
  type PeriodKey, type GroupBy, type StockMovement,
} from '../lib/stockMovements';
import { MaterialReceiptsPanel } from './MaterialReceiptsPanel';
import { receiptsForMaterial, namedSupplierCount } from '../lib/materialReceipts';

interface Props {
  material: Material;
  requests: MaterialRequest[];
  incoming: IncomingMaterial[];
  adjustments: StockAdjustment[];
  onClose: () => void;
}

const PERIODS: { key: PeriodKey; label: string }[] = [
  { key: 'all', label: 'All time' },
  { key: 'today', label: 'Today' },
  { key: 'week', label: 'This week' },
  { key: 'month', label: 'This month' },
  { key: 'custom', label: 'Custom' },
];
const VIEWS: { key: GroupBy; label: string }[] = [
  { key: 'transactions', label: 'Transactions' },
  { key: 'daily', label: 'Daily' },
  { key: 'weekly', label: 'Weekly' },
  { key: 'monthly', label: 'Monthly' },
];

const fmt = (n: number) => (Math.round(n * 1000) / 1000).toLocaleString(undefined, { maximumFractionDigits: 3 });
const fmtTime = (iso: string) => {
  const d = new Date(iso);
  return `${d.toLocaleDateString(undefined, { day: '2-digit', month: 'short', year: 'numeric' })} ${d.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })}`;
};

export const StockLedgerModal: React.FC<Props> = ({ material, requests, incoming, adjustments, onClose }) => {
  // 'ledger' = every movement of this material; 'receipts' = who delivered it and the paperwork.
  const [tab, setTab] = useState<'ledger' | 'receipts'>('ledger');
  const [period, setPeriod] = useState<PeriodKey>('all');
  const [customFrom, setCustomFrom] = useState('');
  const [customTo, setCustomTo] = useState('');
  const [view, setView] = useState<GroupBy>('transactions');
  const [typeFilter, setTypeFilter] = useState<'all' | 'IN' | 'OUT' | 'ADJ'>('all');
  const [search, setSearch] = useState('');

  const { movements, openingBalance } = useMemo(
    () => buildMovements(material, requests, incoming, adjustments),
    [material, requests, incoming, adjustments],
  );

  const range = useMemo(() => periodRange(period, customFrom, customTo), [period, customFrom, customTo]);
  const { rows: periodRows, summary } = useMemo(
    () => filterAndSummarise(movements, openingBalance, range),
    [movements, openingBalance, range],
  );

  // Type filter + DO/text search apply to the transaction list only — the
  // summary cards and the daily/weekly/monthly tables always cover everything
  // in the period so their totals add up.
  const visibleRows = useMemo(() => {
    const q = search.trim().toLowerCase();
    return periodRows.filter((r) => {
      if (typeFilter !== 'all' && r.type !== typeFilter) return false;
      if (!q) return true;
      return `${r.ref} ${r.details} ${r.by}`.toLowerCase().includes(q);
    });
  }, [periodRows, typeFilter, search]);

  const buckets = useMemo(
    () => (view === 'transactions' ? [] : groupMovements(periodRows, view)),
    [periodRows, view],
  );

  const exportExcel = () => {
    let rows: Record<string, string | number>[];
    if (view === 'transactions') {
      rows = [...visibleRows].map((r: StockMovement) => ({
        'Date & Time': fmtTime(r.at),
        Type: r.type === 'IN' ? 'Stock In' : r.type === 'OUT' ? 'Delivered Out' : 'Adjustment',
        'DO / Reference': r.ref,
        Details: r.details,
        By: r.by,
        In: r.qty > 0 ? r.qty : '',
        Out: r.qty < 0 ? -r.qty : '',
        Balance: r.balance,
      }));
    } else {
      rows = buckets.map((b) => ({
        Period: b.label, Movements: b.count, In: b.totalIn, Out: b.totalOut, Adjustments: b.adjustments, 'Closing Balance': b.closing,
      }));
    }
    const ws = XLSX.utils.json_to_sheet(rows);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Stock Ledger');
    const safe = material.name.replace(/[^a-z0-9]+/gi, '_').slice(0, 40);
    XLSX.writeFile(wb, `Stock_Ledger_${safe}_${localDay(new Date().toISOString())}.xlsx`);
  };

  const supplierCount = useMemo(() => namedSupplierCount(receiptsForMaterial(material.id, incoming)), [material.id, incoming]);

  const chip = (active: boolean) =>
    `px-3 py-1.5 rounded-lg text-xs font-bold cursor-pointer transition-all ${active ? 'bg-orange-600 text-white shadow' : 'bg-slate-800 hover:bg-slate-700 text-slate-300'}`;

  return (
    <div className="fixed inset-0 bg-slate-900/80 backdrop-blur-sm flex items-center justify-center p-3 z-50" data-testid="stock-ledger">
      <div className="bg-slate-900 border border-slate-700 rounded-2xl w-full max-w-6xl shadow-2xl max-h-[94vh] flex flex-col">
        {/* header */}
        <div className="flex items-start justify-between gap-3 px-5 py-4 border-b border-slate-800">
          <div>
            <div className="text-[10px] uppercase font-bold text-slate-500">{tab === 'ledger' ? 'Stock Ledger' : 'Supplier & Receipts'}</div>
            <h2 className="text-lg font-black text-white">{material.name}</h2>
            <div className="text-xs text-slate-400">
              Current stock <span className="font-mono font-bold text-slate-200">{fmt(Number(material.currentStock || 0))} {material.unit}</span>
            </div>
          </div>
          <div className="flex items-center gap-2">
            {tab === 'ledger' && (
              <button onClick={exportExcel} data-testid="ledger-export" className="flex items-center gap-1.5 px-3 py-2 bg-emerald-700 hover:bg-emerald-600 text-white rounded-lg text-xs font-bold cursor-pointer">
                <Download className="h-3.5 w-3.5" /> Excel
              </button>
            )}
            <button onClick={onClose} data-testid="ledger-close" className="p-2 bg-slate-800 hover:bg-slate-700 text-slate-400 rounded-lg cursor-pointer"><X className="h-4 w-4" /></button>
          </div>
        </div>

        {/* tabs */}
        <div className="flex items-center gap-2 px-5 pt-3">
          <button onClick={() => setTab('ledger')} data-testid="material-tab-ledger" className={chip(tab === 'ledger')}>Stock Ledger</button>
          <button onClick={() => setTab('receipts')} data-testid="material-tab-receipts" className={chip(tab === 'receipts')}>
            Supplier &amp; Receipts
            <span className={`ml-1.5 px-1.5 py-0.5 rounded-full text-[10px] ${tab === 'receipts' ? 'bg-orange-800' : 'bg-slate-700'}`}>
              {supplierCount} {supplierCount === 1 ? 'supplier' : 'suppliers'}
            </span>
          </button>
        </div>

        {tab === 'receipts' ? (
          <MaterialReceiptsPanel material={material} incoming={incoming} />
        ) : (
        <>
        {/* controls */}
        <div className="px-5 py-3 border-b border-slate-800 space-y-3">
          <div className="flex flex-wrap items-center gap-2">
            {PERIODS.map((p) => (
              <button key={p.key} onClick={() => setPeriod(p.key)} data-testid={`ledger-period-${p.key}`} className={chip(period === p.key)}>{p.label}</button>
            ))}
            {period === 'custom' && (
              <div className="flex items-center gap-2 text-xs text-slate-400">
                <input type="date" value={customFrom} onChange={(e) => setCustomFrom(e.target.value)} data-testid="ledger-from" className="bg-slate-800 border border-slate-700 rounded-lg px-2 py-1.5 text-xs text-white" />
                <span>to</span>
                <input type="date" value={customTo} onChange={(e) => setCustomTo(e.target.value)} data-testid="ledger-to" className="bg-slate-800 border border-slate-700 rounded-lg px-2 py-1.5 text-xs text-white" />
              </div>
            )}
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-[10px] uppercase font-bold text-slate-500 mr-1">View</span>
            {VIEWS.map((v) => (
              <button key={v.key} onClick={() => setView(v.key)} data-testid={`ledger-view-${v.key}`} className={chip(view === v.key)}>{v.label}</button>
            ))}
            {view === 'transactions' && (
              <>
                <span className="text-slate-700 mx-1">|</span>
                {(['all', 'IN', 'OUT', 'ADJ'] as const).map((t) => (
                  <button key={t} onClick={() => setTypeFilter(t)} className={chip(typeFilter === t)}>
                    {t === 'all' ? 'All' : t === 'IN' ? 'In' : t === 'OUT' ? 'Out (DO)' : 'Adjust'}
                  </button>
                ))}
                <div className="relative ml-auto">
                  <Search className="h-3.5 w-3.5 text-slate-500 absolute left-2.5 top-1/2 -translate-y-1/2" />
                  <input
                    value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search DO no, project, name…"
                    data-testid="ledger-search"
                    className="bg-slate-800 border border-slate-700 rounded-lg pl-8 pr-3 py-1.5 text-xs text-white w-60"
                  />
                </div>
              </>
            )}
          </div>
        </div>

        {/* summary */}
        <div className="grid grid-cols-2 md:grid-cols-5 gap-3 px-5 py-3 border-b border-slate-800">
          {[
            { label: 'Opening', value: summary.opening, cls: 'text-slate-200' },
            { label: 'Total In', value: summary.totalIn, cls: 'text-emerald-400', prefix: '+' },
            { label: 'Total Out (DO)', value: summary.totalOut, cls: 'text-rose-400', prefix: '−' },
            { label: 'Adjustments', value: summary.adjustments, cls: 'text-amber-400', signed: true },
            { label: 'Closing', value: summary.closing, cls: 'text-white' },
          ].map((c) => (
            <div key={c.label} className="bg-slate-800/60 border border-slate-800 rounded-xl px-3 py-2">
              <div className="text-[10px] uppercase font-bold text-slate-500">{c.label}</div>
              <div className={`font-mono font-black text-base ${c.cls}`} data-testid={`ledger-sum-${c.label.split(' ')[0].toLowerCase()}`}>
                {c.signed ? (c.value > 0 ? '+' : c.value < 0 ? '−' : '') + fmt(Math.abs(c.value)) : `${c.prefix || ''}${fmt(c.value)}`}
                <span className="text-[10px] text-slate-500 font-normal ml-1">{material.unit}</span>
              </div>
            </div>
          ))}
        </div>

        {/* table */}
        <div className="overflow-auto flex-1 px-5 pb-4">
          {view === 'transactions' ? (
            <table className="w-full text-xs mt-3">
              <thead className="sticky top-0 bg-slate-900">
                <tr className="text-[10px] uppercase text-slate-500">
                  <th className="text-left py-2 pr-3">Date & time</th>
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
                {period === 'all' && typeFilter === 'all' && !search && (
                  <tr className="border-t border-slate-800 text-slate-500">
                    <td className="py-2 pr-3" colSpan={7}>Opening balance (stock before the first recorded movement)</td>
                    <td className="py-2 text-right font-mono">{fmt(openingBalance)}</td>
                  </tr>
                )}
                {visibleRows.map((r) => (
                  <tr key={r.id} className="border-t border-slate-800 hover:bg-slate-800/40">
                    <td className="py-2 pr-3 text-slate-400 whitespace-nowrap">{fmtTime(r.at)}</td>
                    <td className="py-2 pr-3">
                      <span className={`px-2 py-0.5 rounded-full text-[10px] font-black uppercase border ${
                        r.type === 'IN' ? 'bg-emerald-950/40 text-emerald-400 border-emerald-800'
                        : r.type === 'OUT' ? 'bg-rose-950/40 text-rose-400 border-rose-800'
                        : 'bg-amber-950/40 text-amber-400 border-amber-800'}`}>
                        {r.type === 'IN' ? 'In' : r.type === 'OUT' ? 'Out' : 'Adjust'}
                      </span>
                    </td>
                    <td className={`py-2 pr-3 font-mono ${r.isDo ? 'text-sky-300 font-bold' : 'text-slate-400'}`}>{r.ref}</td>
                    <td className="py-2 pr-3 text-slate-300 max-w-[320px] break-words">{r.details}</td>
                    <td className="py-2 pr-3 text-slate-400">{r.by || '—'}</td>
                    <td className="py-2 pr-3 text-right font-mono text-emerald-400">{r.qty > 0 ? `+${fmt(r.qty)}` : ''}</td>
                    <td className="py-2 pr-3 text-right font-mono text-rose-400">{r.qty < 0 ? `−${fmt(-r.qty)}` : ''}</td>
                    <td className="py-2 text-right font-mono text-slate-200">{fmt(r.balance)}</td>
                  </tr>
                ))}
                {visibleRows.length === 0 && (
                  <tr><td colSpan={8} className="text-center text-slate-500 py-10">No stock movements for this selection.</td></tr>
                )}
              </tbody>
            </table>
          ) : (
            <table className="w-full text-xs mt-3">
              <thead className="sticky top-0 bg-slate-900">
                <tr className="text-[10px] uppercase text-slate-500">
                  <th className="text-left py-2 pr-3">{view === 'daily' ? 'Day' : view === 'weekly' ? 'Week' : 'Month'}</th>
                  <th className="text-right py-2 pr-3">Movements</th>
                  <th className="text-right py-2 pr-3">In</th>
                  <th className="text-right py-2 pr-3">Out (DO)</th>
                  <th className="text-right py-2 pr-3">Adjust</th>
                  <th className="text-right py-2">Closing balance</th>
                </tr>
              </thead>
              <tbody>
                {buckets.map((b) => (
                  <tr key={b.key} className="border-t border-slate-800 hover:bg-slate-800/40">
                    <td className="py-2 pr-3 text-slate-200 font-semibold">{b.label}</td>
                    <td className="py-2 pr-3 text-right text-slate-400">{b.count}</td>
                    <td className="py-2 pr-3 text-right font-mono text-emerald-400">{b.totalIn ? `+${fmt(b.totalIn)}` : '—'}</td>
                    <td className="py-2 pr-3 text-right font-mono text-rose-400">{b.totalOut ? `−${fmt(b.totalOut)}` : '—'}</td>
                    <td className="py-2 pr-3 text-right font-mono text-amber-400">{b.adjustments ? `${b.adjustments > 0 ? '+' : '−'}${fmt(Math.abs(b.adjustments))}` : '—'}</td>
                    <td className="py-2 text-right font-mono text-slate-200">{fmt(b.closing)}</td>
                  </tr>
                ))}
                {buckets.length === 0 && (
                  <tr><td colSpan={6} className="text-center text-slate-500 py-10">No stock movements for this selection.</td></tr>
                )}
              </tbody>
            </table>
          )}
          <p className="text-[10px] text-slate-600 mt-4">
            "Out" rows are confirmed deliveries, each with its Delivery Order (DO) number. Balances are worked back from today's stock. Stock changes made before manual adjustments were logged, or imported in bulk, are included in the opening balance.
          </p>
        </div>
        </>
        )}
      </div>
    </div>
  );
};
