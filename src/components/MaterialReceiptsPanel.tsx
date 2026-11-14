import React, { useMemo, useState } from 'react';
import { Download, Search, FileText, ExternalLink } from 'lucide-react';
import * as XLSX from 'xlsx';
import type { IncomingMaterial, Material } from '../types';
import { qcBreakdown } from '../lib/suppliers';
import {
  receiptsForMaterial, summariseSuppliers, namedSupplierCount, supplierKeyOf, hasDoc,
} from '../lib/materialReceipts';
import { KIND_LABEL } from '../lib/grnAttachments';

interface Props {
  material: Material;
  incoming: IncomingMaterial[];
}

const fmt = (n: number) => (Math.round(n * 1000) / 1000).toLocaleString(undefined, { maximumFractionDigits: 3 });
const fmtDay = (iso: string) =>
  iso ? new Date(iso).toLocaleDateString(undefined, { day: '2-digit', month: 'short', year: 'numeric' }) : '—';
const dayKey = (iso: string) => (iso || '').slice(0, 10);

const QC_PILL: Record<string, string> = {
  pending: 'bg-amber-50 text-amber-700 border-amber-200',
  partial: 'bg-sky-50 text-sky-700 border-sky-200',
  passed: 'bg-emerald-50 text-emerald-700 border-emerald-200',
  failed: 'bg-rose-50 text-rose-700 border-rose-200',
  hold: 'bg-slate-100 text-slate-700 border-slate-300',
  mixed: 'bg-violet-50 text-violet-700 border-violet-200',
};
const QC_LABEL: Record<string, string> = {
  pending: 'Pending QC', partial: 'Partial', passed: 'Passed', failed: 'Rejected', hold: 'On hold', mixed: 'Split',
};

export const MaterialReceiptsPanel: React.FC<Props> = ({ material, incoming }) => {
  const [supplierKey, setSupplierKey] = useState<string>('');   // '' = all suppliers
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [search, setSearch] = useState('');

  const receipts = useMemo(() => receiptsForMaterial(material.id, incoming), [material.id, incoming]);
  const suppliers = useMemo(() => summariseSuppliers(receipts), [receipts]);

  const visible = useMemo(() => {
    const q = search.trim().toLowerCase();
    return receipts.filter((r) => {
      if (supplierKey && supplierKeyOf(r) !== supplierKey) return false;
      const d = dayKey(r.receivedAt);
      if (from && d < from) return false;
      if (to && d > to) return false;
      if (!q) return true;
      return `${r.supplier || ''} ${r.invoiceNo || ''} ${r.doNo || ''} ${r.batchNo || ''} ${r.notes || ''} ${r.receivedByName || ''}`
        .toLowerCase().includes(q);
    });
  }, [receipts, supplierKey, from, to, search]);

  const totalQty = receipts.reduce((s, r) => s + Number(r.qty || 0), 0);
  const totalPassed = receipts.reduce((s, r) => s + qcBreakdown(r).passed, 0);
  const last = receipts[0];

  const exportExcel = () => {
    const rows = visible.map((r) => ({
      Date: dayKey(r.receivedAt),
      Supplier: r.supplier || '',
      'Batch No': r.batchNo || '',
      Qty: Number(r.qty || 0),
      Unit: r.unit || material.unit,
      'Invoice No': r.invoiceNo || '',
      'Supplier DO No': r.doNo || '',
      'DO file': hasDoc(r, 'do') ? 'Yes' : 'No',
      'Invoice file': hasDoc(r, 'invoice') ? 'Yes' : 'No',
      'QC Status': QC_LABEL[r.qcStatus || 'pending'] || r.qcStatus,
      'Received By': r.receivedByName || '',
      Notes: r.notes || '',
    }));
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(rows), 'Receipts');
    const sup = suppliers.map((s) => ({
      Supplier: s.name, Deliveries: s.deliveries, 'Qty Received': s.qtyReceived, 'Qty Passed': s.qtyPassed,
      'Qty Rejected': s.qtyFailed, 'First Delivery': dayKey(s.firstAt), 'Last Delivery': dayKey(s.lastAt),
    }));
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(sup), 'Suppliers');
    const safe = material.name.replace(/[^a-z0-9]+/gi, '_').slice(0, 40);
    XLSX.writeFile(wb, `Supplier_Receipts_${safe}_${new Date().toISOString().slice(0, 10)}.xlsx`);
  };

  const input = 'bg-slate-100 border border-slate-300 rounded-lg px-2 py-1.5 text-xs text-slate-900';

  return (
    <div className="overflow-auto flex-1 px-5 pb-4" data-testid="material-receipts">
      {/* summary cards */}
      <div className="grid grid-cols-2 md:grid-cols-5 gap-3 py-3">
        {[
          { label: 'Suppliers', value: String(namedSupplierCount(receipts)), sub: 'delivered this material', id: 'suppliers' },
          { label: 'Deliveries', value: String(receipts.length), sub: 'goods receipts', id: 'deliveries' },
          { label: 'Total received', value: fmt(totalQty), sub: material.unit, id: 'received' },
          { label: 'Passed QC', value: fmt(totalPassed), sub: material.unit, id: 'passed' },
          { label: 'Last delivery', value: last ? fmtDay(last.receivedAt) : '—', sub: last?.supplier || '', id: 'last' },
        ].map((c) => (
          <div key={c.label} className="bg-slate-50 border border-slate-200 rounded-xl px-3 py-2">
            <div className="text-[10px] uppercase font-bold text-slate-500">{c.label}</div>
            <div className="font-mono font-black text-base text-slate-900" data-testid={`receipts-sum-${c.id}`}>{c.value}</div>
            <div className="text-[10px] text-slate-500 truncate">{c.sub}</div>
          </div>
        ))}
      </div>

      {/* per-supplier roll-up — click a row to filter the deliveries below */}
      <div className="text-[10px] uppercase font-bold text-slate-500 mb-1">By supplier <span className="normal-case font-normal text-slate-400">(click a supplier to filter the deliveries)</span></div>
      <table className="w-full text-xs mb-5">
        <thead>
          <tr className="text-[10px] uppercase text-slate-500">
            <th className="text-left py-2 pr-3">Supplier</th>
            <th className="text-right py-2 pr-3">Deliveries</th>
            <th className="text-right py-2 pr-3">Qty received</th>
            <th className="text-right py-2 pr-3">Passed</th>
            <th className="text-right py-2 pr-3">Rejected</th>
            <th className="text-left py-2 pr-3">First</th>
            <th className="text-left py-2 pr-3">Last delivery</th>
            <th className="text-left py-2 pr-3">Last invoice / DO</th>
            <th className="text-right py-2">Missing files</th>
          </tr>
        </thead>
        <tbody>
          {suppliers.map((s) => (
            <tr
              key={s.key}
              onClick={() => setSupplierKey(supplierKey === s.key ? '' : s.key)}
              data-testid={`supplier-row-${s.key}`}
              className={`border-t border-slate-200 cursor-pointer ${supplierKey === s.key ? 'bg-primary-50' : 'hover:bg-slate-50'}`}
            >
              <td className="py-2 pr-3 text-slate-900 font-semibold">{s.name}</td>
              <td className="py-2 pr-3 text-right text-slate-700">{s.deliveries}</td>
              <td className="py-2 pr-3 text-right font-mono text-slate-800">{fmt(s.qtyReceived)} {material.unit}</td>
              <td className="py-2 pr-3 text-right font-mono text-emerald-700">{fmt(s.qtyPassed)}</td>
              <td className="py-2 pr-3 text-right font-mono text-rose-700">{s.qtyFailed ? fmt(s.qtyFailed) : '—'}</td>
              <td className="py-2 pr-3 text-slate-500 whitespace-nowrap">{fmtDay(s.firstAt)}</td>
              <td className="py-2 pr-3 text-slate-700 whitespace-nowrap">{fmtDay(s.lastAt)}</td>
              <td className="py-2 pr-3 text-slate-500 font-mono">{[s.lastInvoice, s.lastDo].filter(Boolean).join(' / ') || '—'}</td>
              <td className={`py-2 text-right ${s.missingDocs ? 'text-amber-700 font-bold' : 'text-slate-400'}`}>{s.missingDocs || '—'}</td>
            </tr>
          ))}
          {suppliers.length === 0 && (
            <tr><td colSpan={9} className="text-center text-slate-500 py-8">No goods receipts logged for this material yet.</td></tr>
          )}
        </tbody>
      </table>

      {/* deliveries */}
      <div className="flex flex-wrap items-center gap-2 mb-2">
        <div className="text-[10px] uppercase font-bold text-slate-500 mr-1">
          Deliveries ({visible.length}{visible.length !== receipts.length ? ` of ${receipts.length}` : ''})
        </div>
        {supplierKey && (
          <button onClick={() => setSupplierKey('')} className="px-2 py-1 rounded-lg text-[10px] font-bold bg-primary-600 text-white cursor-pointer">
            {suppliers.find((s) => s.key === supplierKey)?.name} ✕
          </button>
        )}
        <input type="date" value={from} onChange={(e) => setFrom(e.target.value)} data-testid="receipts-from" className={input} />
        <span className="text-xs text-slate-500">to</span>
        <input type="date" value={to} onChange={(e) => setTo(e.target.value)} data-testid="receipts-to" className={input} />
        <div className="relative ml-auto">
          <Search className="h-3.5 w-3.5 text-slate-500 absolute left-2.5 top-1/2 -translate-y-1/2" />
          <input
            value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search supplier, invoice, DO, batch…"
            data-testid="receipts-search" className={`${input} pl-8 w-64`}
          />
        </div>
        <button onClick={exportExcel} data-testid="receipts-export" className="flex items-center gap-1.5 px-3 py-1.5 bg-emerald-700 hover:bg-emerald-600 text-white rounded-lg text-xs font-bold cursor-pointer">
          <Download className="h-3.5 w-3.5" /> Excel
        </button>
      </div>

      <table className="w-full text-xs">
        <thead className="sticky top-0 bg-white">
          <tr className="text-[10px] uppercase text-slate-500">
            <th className="text-left py-2 pr-3">Date</th>
            <th className="text-left py-2 pr-3">Supplier</th>
            <th className="text-left py-2 pr-3">Batch</th>
            <th className="text-right py-2 pr-3">Qty</th>
            <th className="text-left py-2 pr-3">Invoice #</th>
            <th className="text-left py-2 pr-3">Supplier DO #</th>
            <th className="text-left py-2 pr-3">Files</th>
            <th className="text-left py-2 pr-3">QC</th>
            <th className="text-left py-2 pr-3">Received by</th>
            <th className="text-left py-2">Notes</th>
          </tr>
        </thead>
        <tbody>
          {visible.map((r) => {
            const noDo = !hasDoc(r, 'do');
            const noInv = !hasDoc(r, 'invoice');
            return (
              <tr key={r.id} className="border-t border-slate-200 hover:bg-slate-50 align-top">
                <td className="py-2 pr-3 text-slate-700 whitespace-nowrap">{fmtDay(r.receivedAt)}</td>
                <td className="py-2 pr-3 text-slate-900 font-semibold">{r.supplier || <span className="text-slate-400 font-normal">—</span>}</td>
                <td className="py-2 pr-3 font-mono text-slate-500">{r.batchNo || '—'}</td>
                <td className="py-2 pr-3 text-right font-mono text-emerald-700 whitespace-nowrap">+{fmt(Number(r.qty || 0))} {r.unit || material.unit}</td>
                <td className="py-2 pr-3 font-mono text-slate-700">{r.invoiceNo || '—'}</td>
                <td className="py-2 pr-3 font-mono text-sky-700">{r.doNo || '—'}</td>
                <td className="py-2 pr-3">
                  <div className="flex flex-wrap gap-1">
                    {(r.attachments || []).map((a) => (
                      <a
                        key={a.id} href={a.url} target="_blank" rel="noopener noreferrer" title={a.name}
                        className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md bg-slate-100 hover:bg-slate-200 border border-slate-300 text-[10px] font-bold text-sky-700"
                      >
                        <FileText className="h-3 w-3" /> {KIND_LABEL[a.kind]} <ExternalLink className="h-2.5 w-2.5 opacity-60" />
                      </a>
                    ))}
                    {noDo && <span className="px-1.5 py-0.5 rounded-md text-[10px] text-amber-700 bg-amber-50 border border-amber-200">no DO</span>}
                    {noInv && <span className="px-1.5 py-0.5 rounded-md text-[10px] text-amber-700 bg-amber-50 border border-amber-200">no invoice</span>}
                  </div>
                </td>
                <td className="py-2 pr-3">
                  <span className={`px-2 py-0.5 rounded-full text-[10px] font-black uppercase border ${QC_PILL[r.qcStatus || 'pending'] || QC_PILL.pending}`}>
                    {QC_LABEL[r.qcStatus || 'pending'] || r.qcStatus}
                  </span>
                </td>
                <td className="py-2 pr-3 text-slate-500">{r.receivedByName || '—'}</td>
                <td className="py-2 text-slate-500 max-w-[220px] break-words">{r.notes || ''}</td>
              </tr>
            );
          })}
          {visible.length === 0 && (
            <tr><td colSpan={10} className="text-center text-slate-500 py-10">No deliveries match this selection.</td></tr>
          )}
        </tbody>
      </table>
      <p className="text-[10px] text-slate-400 mt-4">
        Every goods receipt logged under Incoming for this material. "Supplier DO #" is the delivery note that came with the
        supplier's truck; it is separate from the DO numbers on the Stock Ledger tab, which are raised when material is handed to the floor.
        Add or replace files from the Incoming tab.
      </p>
    </div>
  );
};
