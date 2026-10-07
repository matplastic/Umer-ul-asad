import React, { useEffect, useMemo, useState } from 'react';
import { ShoppingCart, Download, Printer, RefreshCw, X } from 'lucide-react';
import { SupervisorPurchaseRequest } from '../types';
import { dbFetchSupervisorPurchaseRequests } from '../lib/firebaseService';
import { DateRangeFilter, DateRange } from './DateRangeFilter';
import { exportToExcel, exportTablePdf } from '../lib/exportUtils';

/**
 * Supervisor Purchase Requests report (Management → Reports).
 *
 * Every supervisor purchase request is already stored in Firestore
 * (supervisorPurchaseRequests): the supervisor submits it, the manager decides
 * by email (per-item Approve / Reject / partial qty), and the decision is
 * written back onto the same record. This report only READS that data.
 *
 * It answers: "how much was requested, how much was approved" —
 *   • by Day / Month / Year (grouped by the date the request was raised), or
 *   • by Requester,
 * for All requesters or one person, with Today/Week/Month/Year/Custom dates
 * plus an exact Month + Year picker.
 *
 * Money note: estimatedCost is the cost of the whole item line (that is how
 * the supervisor portal's spending totals already treat it). For a partial
 * approval the approved value is the estimate scaled by approvedQty / qty.
 * Quantities are NOT added up across items because units differ (pcs, kg, m…);
 * item-line counts and AED values are used instead.
 */

type GroupBy = 'day' | 'month' | 'year' | 'requester';
type StatusFilter = 'All' | 'Pending' | 'Approved' | 'Rejected';

const MONTH_NAMES = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

const pad2 = (n: number) => (n < 10 ? `0${n}` : String(n));

function monthRange(year: number, monthIdx: number): DateRange {
  const lastDay = new Date(year, monthIdx + 1, 0).getDate();
  return { startDate: `${year}-${pad2(monthIdx + 1)}-01`, endDate: `${year}-${pad2(monthIdx + 1)}-${pad2(lastDay)}` };
}

function yearRange(year: number): DateRange {
  return { startDate: `${year}-01-01`, endDate: `${year}-12-31` };
}

function getDefaultRange(): DateRange {
  const today = new Date();
  const start = new Date(today.getFullYear(), today.getMonth(), 1);
  return { startDate: start.toISOString().slice(0, 10), endDate: today.toISOString().slice(0, 10) };
}

const dayOf = (r: SupervisorPurchaseRequest) => (r.requestedAt || '').slice(0, 10);

const approvedQtyOf = (r: SupervisorPurchaseRequest): number =>
  r.status === 'Approved' ? (r.qtyApproved != null ? r.qtyApproved : r.qty) : 0;

const isPartial = (r: SupervisorPurchaseRequest): boolean =>
  r.status === 'Approved' && r.qtyApproved != null && r.qtyApproved < r.qty;

const requestedValueOf = (r: SupervisorPurchaseRequest): number => Number(r.estimatedCost) || 0;

const approvedValueOf = (r: SupervisorPurchaseRequest): number => {
  if (r.status !== 'Approved') return 0;
  const est = Number(r.estimatedCost) || 0;
  if (!est) return 0;
  const qty = Number(r.qty) || 0;
  if (isPartial(r) && qty > 0) return est * ((r.qtyApproved as number) / qty);
  return est;
};

const money = (n: number) => (n ? n.toLocaleString('en-US', { maximumFractionDigits: 2 }) : '0');

const fmtDateTime = (d?: string | null) => {
  if (!d) return '—';
  const dt = new Date(d);
  return isNaN(dt.getTime()) ? '—' : dt.toLocaleString('en-GB');
};

const fmtDay = (d?: string | null) => {
  if (!d) return '—';
  const dt = new Date(d);
  return isNaN(dt.getTime()) ? '—' : dt.toLocaleDateString('en-GB');
};

interface GroupRow {
  key: string;
  label: string;
  requests: number; // distinct emails / carts (batchId or id)
  items: number;
  approved: number;
  partial: number;
  rejected: number;
  pending: number;
  requestedValue: number;
  approvedValue: number;
}

export const SupervisorPurchaseReport: React.FC = () => {
  const [all, setAll] = useState<SupervisorPurchaseRequest[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [dateRange, setDateRange] = useState<DateRange>(getDefaultRange());
  const [requester, setRequester] = useState<string>('all');
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('All');
  const [groupBy, setGroupBy] = useState<GroupBy>('day');
  const [selectedGroup, setSelectedGroup] = useState<string | null>(null);

  const [pickMonth, setPickMonth] = useState<string>('');
  const [pickYear, setPickYear] = useState<string>(String(new Date().getFullYear()));

  const load = async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await dbFetchSupervisorPurchaseRequests();
      setAll(Array.isArray(data) ? (data as SupervisorPurchaseRequest[]).filter(r => r && r.requestedAt) : []);
    } catch (e: any) {
      console.error('[SupervisorPurchaseReport] load failed', e);
      setError('Could not load purchase requests. Check your connection and press Refresh.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); }, []);

  // Changing any filter / grouping clears the drill-down selection.
  useEffect(() => { setSelectedGroup(null); }, [dateRange, requester, statusFilter, groupBy]);

  const requesterOptions = useMemo(
    () => Array.from(new Set<string>(all.map(r => (r.requestedByName || '').trim()).filter(Boolean))).sort((a: string, b: string) => a.localeCompare(b)),
    [all]
  );

  const yearOptions = useMemo(() => {
    const years = new Set<number>([new Date().getFullYear()]);
    all.forEach(r => {
      const y = parseInt((r.requestedAt || '').slice(0, 4), 10);
      if (!isNaN(y) && y > 2000) years.add(y);
    });
    return Array.from(years).sort((a, b) => b - a);
  }, [all]);

  const applyMonthYear = (monthStr: string, yearStr: string) => {
    setPickMonth(monthStr);
    setPickYear(yearStr);
    const y = parseInt(yearStr, 10);
    if (isNaN(y)) return;
    setDateRange(monthStr === '' ? yearRange(y) : monthRange(y, parseInt(monthStr, 10)));
  };

  // Requests inside the filters (dated by the day the request was raised).
  const filtered = useMemo(() => {
    const { startDate, endDate } = dateRange;
    return all
      .filter(r => {
        const d = dayOf(r);
        if (!d || d < startDate || d > endDate) return false;
        if (requester !== 'all' && (r.requestedByName || '').trim().toLowerCase() !== requester.toLowerCase()) return false;
        if (statusFilter !== 'All' && r.status !== statusFilter) return false;
        return true;
      })
      .sort((a, b) => b.requestedAt.localeCompare(a.requestedAt));
  }, [all, dateRange, requester, statusFilter]);

  const groupKeyOf = (r: SupervisorPurchaseRequest): { key: string; label: string } => {
    const d = dayOf(r);
    if (groupBy === 'day') return { key: d, label: fmtDay(d) };
    if (groupBy === 'month') {
      const m = d.slice(0, 7);
      const mi = parseInt(d.slice(5, 7), 10) - 1;
      return { key: m, label: `${MONTH_NAMES[mi] || m} ${d.slice(0, 4)}` };
    }
    if (groupBy === 'year') return { key: d.slice(0, 4), label: d.slice(0, 4) };
    const name = (r.requestedByName || '—').trim() || '—';
    return { key: name.toLowerCase(), label: name };
  };

  const groups: GroupRow[] = useMemo(() => {
    const map = new Map<string, GroupRow & { reqIds: Set<string> }>();
    filtered.forEach(r => {
      const { key, label } = groupKeyOf(r);
      let g = map.get(key);
      if (!g) {
        g = { key, label, requests: 0, items: 0, approved: 0, partial: 0, rejected: 0, pending: 0, requestedValue: 0, approvedValue: 0, reqIds: new Set() };
        map.set(key, g);
      }
      g.reqIds.add(r.batchId || r.id);
      g.items += 1;
      if (r.status === 'Approved') {
        if (isPartial(r)) g.partial += 1; else g.approved += 1;
      } else if (r.status === 'Rejected') g.rejected += 1;
      else g.pending += 1;
      g.requestedValue += requestedValueOf(r);
      g.approvedValue += approvedValueOf(r);
    });
    const rows = Array.from(map.values()).map(({ reqIds, ...g }) => ({ ...g, requests: reqIds.size }));
    if (groupBy === 'requester') rows.sort((a, b) => b.items - a.items || a.label.localeCompare(b.label));
    else rows.sort((a, b) => b.key.localeCompare(a.key));
    return rows;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filtered, groupBy]);

  const totals = useMemo(() => {
    const reqIds = new Set<string>();
    const t = { requests: 0, items: 0, approved: 0, partial: 0, rejected: 0, pending: 0, requestedValue: 0, approvedValue: 0 };
    filtered.forEach(r => {
      reqIds.add(r.batchId || r.id);
      t.items += 1;
      if (r.status === 'Approved') { if (isPartial(r)) t.partial += 1; else t.approved += 1; }
      else if (r.status === 'Rejected') t.rejected += 1;
      else t.pending += 1;
      t.requestedValue += requestedValueOf(r);
      t.approvedValue += approvedValueOf(r);
    });
    t.requests = reqIds.size;
    return t;
  }, [filtered]);

  const detailRows = useMemo(
    () => (selectedGroup ? filtered.filter(r => groupKeyOf(r).key === selectedGroup) : filtered),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [filtered, selectedGroup, groupBy]
  );

  const groupLabel = groupBy === 'day' ? 'Date' : groupBy === 'month' ? 'Month' : groupBy === 'year' ? 'Year' : 'Requested By';

  const periodText = `${dateRange.startDate} to ${dateRange.endDate}`;
  const filterText = [
    `Period: ${periodText}`,
    `Requested by: ${requester === 'all' ? 'All' : requester}`,
    `Status: ${statusFilter}`,
  ].join('   |   ');

  const summaryExportRows = () => {
    const rows = groups.map(g => ({
      [groupLabel]: g.label,
      'Requests': g.requests,
      'Items Requested': g.items,
      'Approved': g.approved,
      'Partially Approved': g.partial,
      'Rejected': g.rejected,
      'Pending': g.pending,
      'Requested (AED)': Math.round(g.requestedValue * 100) / 100,
      'Approved (AED)': Math.round(g.approvedValue * 100) / 100,
    }));
    rows.push({
      [groupLabel]: 'TOTAL',
      'Requests': totals.requests,
      'Items Requested': totals.items,
      'Approved': totals.approved,
      'Partially Approved': totals.partial,
      'Rejected': totals.rejected,
      'Pending': totals.pending,
      'Requested (AED)': Math.round(totals.requestedValue * 100) / 100,
      'Approved (AED)': Math.round(totals.approvedValue * 100) / 100,
    });
    return rows;
  };

  const detailExportRows = () =>
    detailRows.map(r => ({
      'Request Date': fmtDateTime(r.requestedAt),
      'Requested By': r.requestedByName || '—',
      'Section': r.sectionName || '—',
      'Item': r.itemName,
      'Category': r.category,
      'Unit': r.unit,
      'Qty Requested': r.qty,
      'Qty Approved': r.status === 'Approved' ? approvedQtyOf(r) : r.status === 'Rejected' ? 0 : '',
      'Est. Cost (AED)': r.estimatedCost ?? '',
      'Approved Value (AED)': r.status === 'Approved' ? Math.round(approvedValueOf(r) * 100) / 100 : '',
      'Actual Cost (AED)': r.actualCost ?? '',
      'Status': isPartial(r) ? 'Partially Approved' : r.status,
      'Decided By': r.decidedByName || '—',
      'Decision Date': fmtDateTime(r.decidedAt),
      'Purpose': r.purpose || '',
      'Decision Notes': r.decisionNotes || '',
    }));

  const fileStem = (kind: string) =>
    `Supervisor_Purchase_${kind}_${dateRange.startDate}_to_${dateRange.endDate}${requester !== 'all' ? `_${requester.replace(/\s+/g, '_')}` : ''}`;

  const exportSummary = async (format: 'excel' | 'pdf') => {
    if (groups.length === 0) { alert('No purchase requests found for the current filters.'); return; }
    const rows = summaryExportRows();
    if (format === 'excel') {
      exportToExcel(rows, fileStem('Summary'), 'Purchase Summary');
      return;
    }
    const keys = Object.keys(rows[0]);
    await exportTablePdf({
      title: `Supervisor Purchase Requests — Requested vs Approved (by ${groupLabel})`,
      subtitle: filterText,
      columns: keys.map(k => ({ header: k, dataKey: k })),
      rows,
      filename: fileStem('Summary'),
      orientation: 'landscape',
      deptLine: 'Management Dashboard — Purchase Requests Report',
    });
  };

  const exportDetail = async (format: 'excel' | 'pdf') => {
    if (detailRows.length === 0) { alert('No purchase requests found for the current filters.'); return; }
    const rows = detailExportRows();
    if (format === 'excel') {
      exportToExcel(rows, fileStem('Detail'), 'Purchase Detail');
      return;
    }
    const pdfKeys = ['Request Date', 'Requested By', 'Item', 'Unit', 'Qty Requested', 'Qty Approved', 'Est. Cost (AED)', 'Status', 'Decided By', 'Decision Date'];
    await exportTablePdf({
      title: 'Supervisor Purchase Requests — Detail',
      subtitle: filterText + (selectedGroup ? `   |   ${groupLabel}: ${groups.find(g => g.key === selectedGroup)?.label || selectedGroup}` : ''),
      columns: pdfKeys.map(k => ({ header: k, dataKey: k })),
      rows,
      filename: fileStem('Detail'),
      orientation: 'landscape',
      deptLine: 'Management Dashboard — Purchase Requests Report',
    });
  };

  const statusBadge = (r: SupervisorPurchaseRequest) => {
    if (r.status === 'Approved') {
      return isPartial(r)
        ? <span className="px-2 py-0.5 rounded-full text-[10px] font-black bg-teal-50 text-teal-700 border border-teal-200">PARTIAL</span>
        : <span className="px-2 py-0.5 rounded-full text-[10px] font-black bg-emerald-50 text-emerald-700 border border-emerald-200">APPROVED</span>;
    }
    if (r.status === 'Rejected') return <span className="px-2 py-0.5 rounded-full text-[10px] font-black bg-rose-50 text-rose-700 border border-rose-200">REJECTED</span>;
    return <span className="px-2 py-0.5 rounded-full text-[10px] font-black bg-amber-50 text-amber-700 border border-amber-200">PENDING</span>;
  };

  const kpi = (label: string, value: React.ReactNode, color: string, sub?: string) => (
    <div className="bg-white border border-slate-100 rounded-2xl p-4 shadow-sm">
      <p className="text-[10px] uppercase font-bold text-slate-400 tracking-wider">{label}</p>
      <p className={`text-2xl font-black mt-1 ${color}`}>{value}</p>
      {sub && <p className="text-[10px] text-slate-400 mt-0.5">{sub}</p>}
    </div>
  );

  const selectCls = 'px-2 py-1.5 text-xs border border-slate-200 rounded-lg bg-slate-50 focus:outline-none focus:ring-1 focus:ring-indigo-400';
  const exportBtn = 'flex items-center gap-1 px-2.5 py-1.5 text-[11px] font-bold rounded-lg border border-slate-200 bg-white hover:bg-slate-50 text-slate-700 cursor-pointer';

  return (
    <div className="space-y-4 animate-fadeIn" data-testid="supervisor-purchase-report">
      {/* Header */}
      <div className="flex flex-col md:flex-row md:items-end md:justify-between gap-3">
        <div>
          <h3 className="text-lg font-black text-slate-800 flex items-center gap-2">
            <ShoppingCart className="h-5 w-5 text-indigo-600" />
            Supervisor Purchase Requests — Requested vs Approved
          </h3>
          <p className="text-xs text-slate-500 mt-1 max-w-3xl">
            Every request raised by a Factory Supervisor and the manager&apos;s email decision (approved, partly approved, rejected or still pending). Dates follow the day the request was raised.
          </p>
        </div>
        <button
          onClick={load}
          disabled={loading}
          className="self-start flex items-center gap-1.5 px-3 py-1.5 text-xs font-bold rounded-lg bg-slate-100 hover:bg-slate-200 text-slate-700 cursor-pointer disabled:opacity-50"
        >
          <RefreshCw className={`h-3.5 w-3.5 ${loading ? 'animate-spin' : ''}`} /> Refresh
        </button>
      </div>

      {/* Filters */}
      <div className="flex flex-col xl:flex-row gap-3 xl:items-start">
        <DateRangeFilter value={dateRange} onChange={setDateRange} />

        <div className="bg-white border border-slate-100 rounded-2xl px-3 py-2 shadow-sm flex flex-wrap items-center gap-2 self-start">
          <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">Month / Year</span>
          <select value={pickMonth} onChange={(e) => applyMonthYear(e.target.value, pickYear)} className={selectCls} data-testid="purchase-report-month">
            <option value="">Whole year</option>
            {MONTH_NAMES.map((m, i) => <option key={m} value={String(i)}>{m}</option>)}
          </select>
          <select value={pickYear} onChange={(e) => applyMonthYear(pickMonth, e.target.value)} className={selectCls} data-testid="purchase-report-year">
            {yearOptions.map(y => <option key={y} value={String(y)}>{y}</option>)}
          </select>
        </div>

        <div className="bg-white border border-slate-100 rounded-2xl px-3 py-2 shadow-sm flex flex-wrap items-center gap-2 self-start">
          <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">Requested By</span>
          <select value={requester} onChange={(e) => setRequester(e.target.value)} className={selectCls} data-testid="purchase-report-requester">
            <option value="all">All requesters</option>
            {requesterOptions.map(n => <option key={n} value={n}>{n}</option>)}
          </select>
          <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider ml-1">Status</span>
          <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value as StatusFilter)} className={selectCls} data-testid="purchase-report-status">
            <option value="All">All</option>
            <option value="Approved">Approved</option>
            <option value="Rejected">Rejected</option>
            <option value="Pending">Pending</option>
          </select>
          <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider ml-1">Group by</span>
          <select value={groupBy} onChange={(e) => setGroupBy(e.target.value as GroupBy)} className={selectCls} data-testid="purchase-report-groupby">
            <option value="day">Day</option>
            <option value="month">Month</option>
            <option value="year">Year</option>
            <option value="requester">Requester</option>
          </select>
        </div>
      </div>

      <p className="text-[11px] text-slate-400">
        Showing <span className="font-mono font-bold text-slate-600">{dateRange.startDate}</span> to <span className="font-mono font-bold text-slate-600">{dateRange.endDate}</span>
        {' · '}{requester === 'all' ? 'all requesters' : requester}
      </p>

      {error && <div className="bg-rose-50 border border-rose-200 text-rose-700 text-xs rounded-xl px-3 py-2">{error}</div>}
      {loading && !error && <div className="text-xs text-slate-400">Loading purchase requests…</div>}

      {/* KPI cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 xl:grid-cols-6 gap-3">
        {kpi('Requests', totals.requests, 'text-slate-800', 'emails / carts sent')}
        {kpi('Items Requested', totals.items, 'text-indigo-700', `AED ${money(totals.requestedValue)}`)}
        {kpi('Approved', totals.approved + totals.partial, 'text-emerald-700', `AED ${money(totals.approvedValue)}${totals.partial ? ` · ${totals.partial} partial` : ''}`)}
        {kpi('Rejected', totals.rejected, 'text-rose-700')}
        {kpi('Pending', totals.pending, 'text-amber-700', 'waiting for manager')}
        {kpi('Approval Rate', totals.items - totals.pending > 0 ? `${Math.round(((totals.approved + totals.partial) / (totals.items - totals.pending)) * 100)}%` : '—', 'text-violet-700', 'of decided items')}
      </div>

      {/* Summary table */}
      <div className="bg-white border border-slate-100 rounded-2xl shadow-sm">
        <div className="flex flex-wrap items-center justify-between gap-2 px-3 pt-3">
          <p className="text-xs font-bold text-slate-600">Summary by {groupLabel}</p>
          <div className="flex flex-wrap gap-1.5">
            <button onClick={() => exportSummary('excel')} className={exportBtn} data-testid="purchase-export-summary-excel"><Download className="h-3 w-3" /> Summary Excel</button>
            <button onClick={() => exportSummary('pdf')} className={exportBtn} data-testid="purchase-export-summary-pdf"><Printer className="h-3 w-3" /> Summary PDF</button>
          </div>
        </div>
        <div className="overflow-x-auto">
          <table className="min-w-full text-xs mt-2">
            <thead>
              <tr className="border-b border-slate-100">
                <th className="text-left font-bold text-slate-500 uppercase tracking-wider px-3 py-2.5 whitespace-nowrap">{groupLabel}</th>
                <th className="text-center font-bold text-slate-500 uppercase tracking-wider px-3 py-2.5">Requests</th>
                <th className="text-center font-bold text-indigo-600 uppercase tracking-wider px-3 py-2.5">Items Requested</th>
                <th className="text-center font-bold text-emerald-600 uppercase tracking-wider px-3 py-2.5">Approved</th>
                <th className="text-center font-bold text-teal-600 uppercase tracking-wider px-3 py-2.5">Partial</th>
                <th className="text-center font-bold text-rose-600 uppercase tracking-wider px-3 py-2.5">Rejected</th>
                <th className="text-center font-bold text-amber-600 uppercase tracking-wider px-3 py-2.5">Pending</th>
                <th className="text-right font-bold text-indigo-700 uppercase tracking-wider px-3 py-2.5 whitespace-nowrap">Requested AED</th>
                <th className="text-right font-bold text-emerald-700 uppercase tracking-wider px-3 py-2.5 whitespace-nowrap">Approved AED</th>
              </tr>
            </thead>
            <tbody>
              {groups.length === 0 && (
                <tr><td colSpan={9} className="text-center text-slate-400 py-8">No purchase requests for the selected filters.</td></tr>
              )}
              {groups.map(g => (
                <tr
                  key={g.key}
                  onClick={() => setSelectedGroup(selectedGroup === g.key ? null : g.key)}
                  className={`border-b border-slate-50 cursor-pointer ${selectedGroup === g.key ? 'bg-indigo-50/60' : 'hover:bg-slate-50/60'}`}
                >
                  <td className="px-3 py-2 font-bold text-slate-700 whitespace-nowrap">{g.label}</td>
                  <td className="px-3 py-2 text-center font-mono text-slate-600">{g.requests}</td>
                  <td className="px-3 py-2 text-center font-mono font-bold text-indigo-700">{g.items}</td>
                  <td className="px-3 py-2 text-center font-mono font-bold text-emerald-700">{g.approved}</td>
                  <td className="px-3 py-2 text-center font-mono text-teal-700">{g.partial}</td>
                  <td className="px-3 py-2 text-center font-mono text-rose-700">{g.rejected}</td>
                  <td className="px-3 py-2 text-center font-mono text-amber-700">{g.pending}</td>
                  <td className="px-3 py-2 text-right font-mono text-slate-700">{money(g.requestedValue)}</td>
                  <td className="px-3 py-2 text-right font-mono font-bold text-emerald-700">{money(g.approvedValue)}</td>
                </tr>
              ))}
            </tbody>
            {groups.length > 0 && (
              <tfoot>
                <tr className="border-t-2 border-slate-200 bg-slate-50/70">
                  <td className="px-3 py-2.5 font-black text-slate-700">TOTAL</td>
                  <td className="px-3 py-2.5 text-center font-mono font-black text-slate-700">{totals.requests}</td>
                  <td className="px-3 py-2.5 text-center font-mono font-black text-indigo-700">{totals.items}</td>
                  <td className="px-3 py-2.5 text-center font-mono font-black text-emerald-700">{totals.approved}</td>
                  <td className="px-3 py-2.5 text-center font-mono font-black text-teal-700">{totals.partial}</td>
                  <td className="px-3 py-2.5 text-center font-mono font-black text-rose-700">{totals.rejected}</td>
                  <td className="px-3 py-2.5 text-center font-mono font-black text-amber-700">{totals.pending}</td>
                  <td className="px-3 py-2.5 text-right font-mono font-black text-slate-800">{money(totals.requestedValue)}</td>
                  <td className="px-3 py-2.5 text-right font-mono font-black text-emerald-700">{money(totals.approvedValue)}</td>
                </tr>
              </tfoot>
            )}
          </table>
        </div>
        <p className="text-[10px] text-slate-400 px-3 py-2">
          Click a row to list only its items below. Quantities are not added together because items use different units; counts and AED values are shown instead.
        </p>
      </div>

      {/* Detail list */}
      <div className="bg-white border border-slate-100 rounded-2xl shadow-sm">
        <div className="flex flex-wrap items-center justify-between gap-2 px-3 pt-3">
          <div className="flex items-center gap-2">
            <p className="text-xs font-bold text-slate-600">Item detail ({detailRows.length})</p>
            {selectedGroup && (
              <button
                onClick={() => setSelectedGroup(null)}
                className="flex items-center gap-1 px-2 py-0.5 text-[10px] font-bold rounded-full bg-indigo-50 text-indigo-700 border border-indigo-200 cursor-pointer"
              >
                {groups.find(g => g.key === selectedGroup)?.label || selectedGroup} <X className="h-3 w-3" />
              </button>
            )}
          </div>
          <div className="flex flex-wrap gap-1.5">
            <button onClick={() => exportDetail('excel')} className={exportBtn} data-testid="purchase-export-detail-excel"><Download className="h-3 w-3" /> Detail Excel</button>
            <button onClick={() => exportDetail('pdf')} className={exportBtn} data-testid="purchase-export-detail-pdf"><Printer className="h-3 w-3" /> Detail PDF</button>
          </div>
        </div>
        <div className="overflow-x-auto">
          <table className="min-w-full text-xs mt-2">
            <thead>
              <tr className="border-b border-slate-100 text-left">
                {['Date', 'Requested By', 'Item', 'Qty Req.', 'Qty Appr.', 'Est. AED', 'Approved AED', 'Status', 'Decided By', 'Decision Date'].map(h => (
                  <th key={h} className="font-bold text-slate-500 uppercase tracking-wider px-3 py-2.5 whitespace-nowrap">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {detailRows.length === 0 && (
                <tr><td colSpan={10} className="text-center text-slate-400 py-8">No items to show.</td></tr>
              )}
              {detailRows.map(r => (
                <tr key={r.id} className="border-b border-slate-50 hover:bg-slate-50/50">
                  <td className="px-3 py-2 whitespace-nowrap text-slate-600">{fmtDateTime(r.requestedAt)}</td>
                  <td className="px-3 py-2 whitespace-nowrap font-bold text-slate-700">{r.requestedByName || '—'}</td>
                  <td className="px-3 py-2 text-slate-700">
                    <div className="font-semibold">{r.itemName}</div>
                    <div className="text-[10px] text-slate-400">{r.category}{r.sectionName ? ` • ${r.sectionName}` : ''}</div>
                  </td>
                  <td className="px-3 py-2 font-mono whitespace-nowrap">{r.qty} {r.unit}</td>
                  <td className="px-3 py-2 font-mono whitespace-nowrap">
                    {r.status === 'Approved' ? `${approvedQtyOf(r)} ${r.unit}` : r.status === 'Rejected' ? `0 ${r.unit}` : '—'}
                  </td>
                  <td className="px-3 py-2 font-mono text-right">{r.estimatedCost ? money(Number(r.estimatedCost)) : '—'}</td>
                  <td className="px-3 py-2 font-mono text-right text-emerald-700">{r.status === 'Approved' && r.estimatedCost ? money(approvedValueOf(r)) : '—'}</td>
                  <td className="px-3 py-2">{statusBadge(r)}</td>
                  <td className="px-3 py-2 whitespace-nowrap text-slate-600">{r.decidedByName || '—'}</td>
                  <td className="px-3 py-2 whitespace-nowrap text-slate-500">{fmtDateTime(r.decidedAt)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
};
