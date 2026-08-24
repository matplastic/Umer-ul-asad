import React, { useState, useEffect, useCallback, useMemo } from 'react';
import {
  Truck, Plus, Trash2, Printer, CheckCircle2, Clock, PackageCheck, AlertTriangle,
  Filter, Download, RefreshCw, X, Save, ClipboardList, CalendarDays, Search, Send,
} from 'lucide-react';
import { dbFetchSiteDeliveries, dbSaveSiteDeliveries } from '../lib/firebaseService';
import { SiteDelivery, SiteDeliveryItem } from '../types';
import { exportToExcel, exportTablePdf } from '../lib/exportUtils';

const uid = (prefix: string) => `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
const todayStr = () => new Date().toISOString().slice(0, 10);
const nowTimeStr = () => new Date().toTimeString().slice(0, 5);
const fmtDate = (s?: string | null) => { if (!s) return '—'; try { return new Date(s).toLocaleDateString('en-GB'); } catch { return s; } };
const fmtDateTime = (s?: string | null) => { if (!s) return '—'; try { return new Date(s).toLocaleString('en-GB'); } catch { return s; } };

function nextDeliveryNo(existing: SiteDelivery[]): string {
  const year = new Date().getFullYear();
  const prefix = `DEL-${year}-`;
  const nums = existing
    .map(d => d.deliveryNo)
    .filter(n => n && n.startsWith(prefix))
    .map(n => parseInt(n.slice(prefix.length), 10))
    .filter(n => !isNaN(n));
  const next = (nums.length ? Math.max(...nums) : 0) + 1;
  return `${prefix}${String(next).padStart(4, '0')}`;
}

// ISO week key, e.g. "2026-W34" — used for the Week filter/report grouping.
function isoWeekKey(dateStr: string): string {
  const d = new Date(dateStr + 'T00:00:00Z');
  const dayNum = (d.getUTCDay() + 6) % 7;
  d.setUTCDate(d.getUTCDate() - dayNum + 3);
  const firstThursday = new Date(Date.UTC(d.getUTCFullYear(), 0, 4));
  const firstDayNum = (firstThursday.getUTCDay() + 6) % 7;
  firstThursday.setUTCDate(firstThursday.getUTCDate() - firstDayNum + 3);
  const weekNum = 1 + Math.round((d.getTime() - firstThursday.getTime()) / (7 * 24 * 3600 * 1000));
  return `${d.getUTCFullYear()}-W${String(weekNum).padStart(2, '0')}`;
}

const STATUS_STYLES: Record<SiteDelivery['status'], string> = {
  DISPATCHED: 'bg-amber-50 text-amber-700 border-amber-200',
  RECEIVED: 'bg-emerald-50 text-emerald-700 border-emerald-200',
  PARTIAL: 'bg-orange-50 text-orange-700 border-orange-200',
  DISPUTED: 'bg-rose-50 text-rose-700 border-rose-200',
};

interface SiteDeliveryTrackerProps {
  /** 'management' shows Dispatch + Receive + Reports (full control).
   *  'site_team' shows Receive + Reports only — the site crew can confirm
   *  what arrived but never create or edit a dispatch themselves. */
  mode: 'management' | 'site_team';
  currentUserName: string;
  /** Known project/site names, so the dispatch form offers a dropdown instead
   *  of relying purely on free text (still editable/free text too). */
  siteNames?: string[];
}

export const SiteDeliveryTracker: React.FC<SiteDeliveryTrackerProps> = ({ mode, currentUserName, siteNames = [] }) => {
  const [deliveries, setDeliveries] = useState<SiteDelivery[]>([]);
  const [loading, setLoading] = useState(true);
  const [syncing, setSyncing] = useState(false);
  const [tab, setTab] = useState<'dispatch' | 'receive' | 'reports'>(mode === 'site_team' ? 'receive' : 'dispatch');
  const [printDelivery, setPrintDelivery] = useState<SiteDelivery | null>(null);
  const [receiveTarget, setReceiveTarget] = useState<SiteDelivery | null>(null);
  const [addingNewSite, setAddingNewSite] = useState(false);

  const load = useCallback(async (silent = false) => {
    if (!silent) setLoading(true);
    try {
      const rows = await dbFetchSiteDeliveries();
      setDeliveries(Array.isArray(rows) ? rows : []);
    } catch (err) {
      console.error('[SiteDeliveryTracker] Failed to load deliveries:', err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
    const t = setInterval(() => load(true), 20000);
    return () => clearInterval(t);
  }, [load]);

  useEffect(() => {
    if (mode === 'management' && tab === 'receive') setTab('dispatch');
  }, [mode, tab]);

  const persist = (next: SiteDelivery[]) => {
    setDeliveries(next);
    setSyncing(true);
    dbSaveSiteDeliveries(next)
      .catch(err => console.error('[SiteDeliveryTracker] Failed to sync deliveries to Firestore:', err))
      .finally(() => setSyncing(false));
  };

  // ── Dispatch form (Management only) ──────────────────────────────────────
  const blankItem = (): SiteDeliveryItem => ({ id: uid('itm'), description: '', category: '', qty: 1, unit: 'pcs', notes: '' });
  const [form, setForm] = useState<{
    siteName: string; truckNumber: string; driverName: string; driverPhone: string;
    dispatchDate: string; dispatchTime: string; notes: string; items: SiteDeliveryItem[];
  }>({
    siteName: '', truckNumber: '', driverName: '', driverPhone: '',
    dispatchDate: todayStr(), dispatchTime: nowTimeStr(), notes: '', items: [blankItem()],
  });

  const resetForm = () => {
    setForm({
      siteName: '', truckNumber: '', driverName: '', driverPhone: '',
      dispatchDate: todayStr(), dispatchTime: nowTimeStr(), notes: '', items: [blankItem()],
    });
    setAddingNewSite(false);
  };

  const updateItem = (id: string, patch: Partial<SiteDeliveryItem>) => {
    setForm(f => ({ ...f, items: f.items.map(it => it.id === id ? { ...it, ...patch } : it) }));
  };
  const addItem = () => setForm(f => ({ ...f, items: [...f.items, blankItem()] }));
  const removeItem = (id: string) => setForm(f => ({ ...f, items: f.items.length > 1 ? f.items.filter(it => it.id !== id) : f.items }));

  const canSubmitDispatch = form.siteName.trim() && form.items.some(it => it.description.trim() && it.qty > 0);

  const submitDispatch = () => {
    if (!canSubmitDispatch) return;
    const cleanItems = form.items
      .filter(it => it.description.trim() && it.qty > 0)
      .map(it => ({ ...it, description: it.description.trim(), category: it.category?.trim() || null }));
    const newDelivery: SiteDelivery = {
      id: uid('del'),
      deliveryNo: nextDeliveryNo(deliveries),
      siteName: form.siteName.trim(),
      items: cleanItems,
      truckNumber: form.truckNumber.trim() || null,
      driverName: form.driverName.trim() || null,
      driverPhone: form.driverPhone.trim() || null,
      dispatchDate: form.dispatchDate,
      dispatchTime: form.dispatchTime || null,
      dispatchedByName: currentUserName || 'Management',
      notes: form.notes.trim() || null,
      status: 'DISPATCHED',
      createdAt: new Date().toISOString(),
    };
    persist([newDelivery, ...deliveries]);
    setPrintDelivery(newDelivery);
    resetForm();
  };

  const deleteDelivery = (id: string) => {
    if (!window.confirm('Delete this delivery record? This cannot be undone.')) return;
    persist(deliveries.filter(d => d.id !== id));
  };

  // ── Receive / confirm (Site Team, or Management on their behalf) ────────
  const [receiveForm, setReceiveForm] = useState<{ receivedByName: string; receivedNotes: string; shortageNotes: string; status: 'RECEIVED' | 'PARTIAL' | 'DISPUTED' }>({
    receivedByName: '', receivedNotes: '', shortageNotes: '', status: 'RECEIVED',
  });

  const openReceive = (d: SiteDelivery) => {
    setReceiveTarget(d);
    setReceiveForm({ receivedByName: '', receivedNotes: '', shortageNotes: '', status: 'RECEIVED' });
  };

  const confirmReceipt = () => {
    if (!receiveTarget || !receiveForm.receivedByName.trim()) return;
    const next = deliveries.map(d => d.id === receiveTarget.id ? {
      ...d,
      status: receiveForm.status,
      receivedAt: new Date().toISOString(),
      receivedByName: receiveForm.receivedByName.trim(),
      receivedNotes: receiveForm.receivedNotes.trim() || null,
      shortageNotes: receiveForm.shortageNotes.trim() || null,
      updatedAt: new Date().toISOString(),
    } : d);
    persist(next);
    setReceiveTarget(null);
  };

  const pendingReceipt = useMemo(() => deliveries.filter(d => d.status === 'DISPATCHED').sort((a, b) => (b.dispatchDate || '').localeCompare(a.dispatchDate || '')), [deliveries]);
  const resolvedReceipt = useMemo(() => deliveries.filter(d => d.status !== 'DISPATCHED').sort((a, b) => (b.receivedAt || '').localeCompare(a.receivedAt || '')), [deliveries]);

  // ── Reports (Day / Week / Month / Year + product + site filters) ────────
  const [rangeMode, setRangeMode] = useState<'day' | 'week' | 'month' | 'year' | 'custom'>('month');
  const [rangeAnchor, setRangeAnchor] = useState<string>(todayStr());
  const [filterSite, setFilterSite] = useState<string>('ALL');
  const [filterProduct, setFilterProduct] = useState<string>('ALL');
  const [customStart, setCustomStart] = useState<string>(todayStr());
  const [customEnd, setCustomEnd] = useState<string>(todayStr());

  const { rangeStart, rangeEnd, rangeLabel } = useMemo(() => {
    const anchor = new Date(rangeAnchor + 'T00:00:00');
    if (rangeMode === 'day') {
      return { rangeStart: rangeAnchor, rangeEnd: rangeAnchor, rangeLabel: fmtDate(rangeAnchor) };
    }
    if (rangeMode === 'week') {
      const wk = isoWeekKey(rangeAnchor);
      const dayNum = (anchor.getDay() + 6) % 7;
      const monday = new Date(anchor); monday.setDate(anchor.getDate() - dayNum);
      const sunday = new Date(monday); sunday.setDate(monday.getDate() + 6);
      return { rangeStart: monday.toISOString().slice(0, 10), rangeEnd: sunday.toISOString().slice(0, 10), rangeLabel: `Week ${wk}` };
    }
    if (rangeMode === 'month') {
      const start = new Date(anchor.getFullYear(), anchor.getMonth(), 1);
      const end = new Date(anchor.getFullYear(), anchor.getMonth() + 1, 0);
      return { rangeStart: start.toISOString().slice(0, 10), rangeEnd: end.toISOString().slice(0, 10), rangeLabel: start.toLocaleDateString('en-GB', { month: 'long', year: 'numeric' }) };
    }
    if (rangeMode === 'year') {
      const start = new Date(anchor.getFullYear(), 0, 1);
      const end = new Date(anchor.getFullYear(), 11, 31);
      return { rangeStart: start.toISOString().slice(0, 10), rangeEnd: end.toISOString().slice(0, 10), rangeLabel: String(anchor.getFullYear()) };
    }
    return { rangeStart: customStart, rangeEnd: customEnd, rangeLabel: `${fmtDate(customStart)} – ${fmtDate(customEnd)}` };
  }, [rangeMode, rangeAnchor, customStart, customEnd]);

  const allSiteNames = useMemo(() => Array.from(new Set([...siteNames, ...deliveries.map(d => d.siteName)])).filter(Boolean).sort(), [siteNames, deliveries]);

  // First-ever use (no known sites yet) — jump straight to free-text entry
  // instead of showing an empty, unusable dropdown.
  useEffect(() => {
    if (!loading && allSiteNames.length === 0) setAddingNewSite(true);
  }, [loading, allSiteNames.length]);
  const allProducts = useMemo(() => Array.from(new Set(deliveries.flatMap(d => d.items.map(it => it.category || it.description)))).filter(Boolean).sort(), [deliveries]);

  const filteredDeliveries = useMemo(() => {
    return deliveries.filter(d => {
      if (d.dispatchDate < rangeStart || d.dispatchDate > rangeEnd) return false;
      if (filterSite !== 'ALL' && d.siteName !== filterSite) return false;
      if (filterProduct !== 'ALL' && !d.items.some(it => (it.category || it.description) === filterProduct)) return false;
      return true;
    });
  }, [deliveries, rangeStart, rangeEnd, filterSite, filterProduct]);

  // Flattened rows (one row per item) for the report table + product summary.
  const reportRows = useMemo(() => {
    const rows: { deliveryNo: string; siteName: string; dispatchDate: string; product: string; qty: number; unit: string; truckNumber: string; status: string; receivedByName: string; receivedAt: string }[] = [];
    filteredDeliveries.forEach(d => {
      d.items.forEach(it => {
        if (filterProduct !== 'ALL' && (it.category || it.description) !== filterProduct) return;
        rows.push({
          deliveryNo: d.deliveryNo, siteName: d.siteName, dispatchDate: fmtDate(d.dispatchDate),
          product: it.category ? `${it.category} — ${it.description}` : it.description,
          qty: it.qty, unit: it.unit, truckNumber: d.truckNumber || '—', status: d.status,
          receivedByName: d.receivedByName || '—', receivedAt: d.receivedAt ? fmtDateTime(d.receivedAt) : '—',
        });
      });
    });
    return rows;
  }, [filteredDeliveries, filterProduct]);

  const productSummary = useMemo(() => {
    const map = new Map<string, { qty: number; unit: string; deliveries: Set<string> }>();
    filteredDeliveries.forEach(d => d.items.forEach(it => {
      const key = it.category || it.description;
      if (filterProduct !== 'ALL' && key !== filterProduct) return;
      const cur = map.get(key) || { qty: 0, unit: it.unit, deliveries: new Set<string>() };
      cur.qty += it.qty; cur.deliveries.add(d.id);
      map.set(key, cur);
    }));
    return Array.from(map.entries()).map(([product, v]) => ({ product, qty: v.qty, unit: v.unit, deliveryCount: v.deliveries.size })).sort((a, b) => b.qty - a.qty);
  }, [filteredDeliveries, filterProduct]);

  const exportReportExcel = () => {
    exportToExcel(reportRows, `site_deliveries_${rangeMode}_${rangeStart}`, 'Deliveries');
  };
  const exportReportPdf = () => {
    exportTablePdf({
      title: 'Site Deliveries Report',
      subtitle: `${rangeLabel}${filterSite !== 'ALL' ? ` — ${filterSite}` : ''}${filterProduct !== 'ALL' ? ` — ${filterProduct}` : ''}`,
      columns: [
        { header: 'Delivery No', dataKey: 'deliveryNo' }, { header: 'Site', dataKey: 'siteName' },
        { header: 'Date', dataKey: 'dispatchDate' }, { header: 'Product', dataKey: 'product' },
        { header: 'Qty', dataKey: 'qty' }, { header: 'Unit', dataKey: 'unit' },
        { header: 'Truck', dataKey: 'truckNumber' }, { header: 'Status', dataKey: 'status' },
        { header: 'Received By', dataKey: 'receivedByName' }, { header: 'Received At', dataKey: 'receivedAt' },
      ],
      rows: reportRows,
      filename: `site_deliveries_${rangeMode}_${rangeStart}`,
      deptLine: 'Site Delivery Tracking',
    });
  };

  useEffect(() => {
    if (!printDelivery) return;
    const t = setTimeout(() => { window.print(); }, 150);
    return () => clearTimeout(t);
  }, [printDelivery]);

  if (loading) {
    return (
      <div className="min-h-[50vh] flex items-center justify-center text-slate-400 gap-2">
        <RefreshCw className="h-4 w-4 animate-spin" /> Loading site deliveries…
      </div>
    );
  }

  return (
    <div className="max-w-6xl mx-auto px-3 sm:px-4 py-6">
      {/* Print-only delivery challan — hidden on screen, shown only via @media print */}
      {printDelivery && (
        <div id="delivery-print-area" className="hidden print:block fixed inset-0 bg-white p-10 text-slate-900 z-[999]">
          <div className="flex items-center justify-between border-b-4 border-slate-900 pb-4 mb-6">
            <div className="flex items-center gap-3">
              <img src="/logo.png" alt="MAT" className="h-14 w-14 object-contain" />
              <div>
                <div className="text-lg font-black tracking-wide uppercase">MAT Plastic Industries LLC</div>
                <div className="text-xs text-slate-500 uppercase tracking-widest">Delivery Challan</div>
              </div>
            </div>
            <div className="text-right">
              <div className="text-sm font-bold">{printDelivery.deliveryNo}</div>
              <div className="text-xs text-slate-500">{fmtDate(printDelivery.dispatchDate)} {printDelivery.dispatchTime || ''}</div>
            </div>
          </div>
          <div className="grid grid-cols-2 gap-4 text-xs mb-6">
            <div><span className="font-bold">Site / Project:</span> {printDelivery.siteName}</div>
            <div><span className="font-bold">Truck No:</span> {printDelivery.truckNumber || '—'}</div>
            <div><span className="font-bold">Driver:</span> {printDelivery.driverName || '—'}</div>
            <div><span className="font-bold">Driver Phone:</span> {printDelivery.driverPhone || '—'}</div>
            <div><span className="font-bold">Dispatched By:</span> {printDelivery.dispatchedByName}</div>
          </div>
          <table className="w-full text-xs border-collapse mb-8">
            <thead>
              <tr className="bg-slate-900 text-white">
                <th className="text-left p-2 border border-slate-300">#</th>
                <th className="text-left p-2 border border-slate-300">Description</th>
                <th className="text-left p-2 border border-slate-300">Qty</th>
                <th className="text-left p-2 border border-slate-300">Unit</th>
                <th className="text-left p-2 border border-slate-300">Notes</th>
              </tr>
            </thead>
            <tbody>
              {printDelivery.items.map((it, i) => (
                <tr key={it.id}>
                  <td className="p-2 border border-slate-300">{i + 1}</td>
                  <td className="p-2 border border-slate-300">{it.category ? `${it.category} — ` : ''}{it.description}</td>
                  <td className="p-2 border border-slate-300">{it.qty}</td>
                  <td className="p-2 border border-slate-300">{it.unit}</td>
                  <td className="p-2 border border-slate-300">{it.notes || ''}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {printDelivery.notes && <div className="text-xs mb-8"><span className="font-bold">Notes:</span> {printDelivery.notes}</div>}
          <div className="grid grid-cols-2 gap-8 mt-16 text-xs">
            <div className="border-t border-slate-400 pt-2">Dispatched By — Signature</div>
            <div className="border-t border-slate-400 pt-2">Received By (Site) — Signature</div>
          </div>
        </div>
      )}

      <div className="flex items-center justify-between mb-5 print:hidden">
        <div className="flex items-center gap-3">
          <div className="h-11 w-11 rounded-2xl bg-slate-900 text-white flex items-center justify-center"><Truck className="h-5 w-5" /></div>
          <div>
            <h2 className="text-lg font-black text-slate-800">Site Deliveries</h2>
            <p className="text-xs text-slate-400">{syncing ? 'Syncing…' : `${deliveries.length} total deliveries`}</p>
          </div>
        </div>
        <button onClick={() => load()} className="flex items-center gap-1.5 text-xs font-bold text-slate-500 hover:text-slate-800 cursor-pointer">
          <RefreshCw className="h-3.5 w-3.5" /> Refresh
        </button>
      </div>

      {/* Tabs */}
      <div className="flex gap-1 mb-5 border-b border-slate-200 print:hidden">
        {mode === 'management' && (
          <button onClick={() => setTab('dispatch')} className={`px-4 py-2 text-xs font-bold border-b-2 cursor-pointer ${tab === 'dispatch' ? 'border-slate-900 text-slate-900' : 'border-transparent text-slate-400 hover:text-slate-600'}`}>
            Send to Site
          </button>
        )}
        {mode === 'site_team' && (
        <button onClick={() => setTab('receive')} className={`px-4 py-2 text-xs font-bold border-b-2 cursor-pointer ${tab === 'receive' ? 'border-slate-900 text-slate-900' : 'border-transparent text-slate-400 hover:text-slate-600'}`}>
          Receive at Site {pendingReceipt.length > 0 && <span className="ml-1 inline-flex items-center justify-center h-4 min-w-4 px-1 rounded-full bg-amber-500 text-white text-[10px]">{pendingReceipt.length}</span>}
        </button>
        )}
        <button onClick={() => setTab('reports')} className={`px-4 py-2 text-xs font-bold border-b-2 cursor-pointer ${tab === 'reports' ? 'border-slate-900 text-slate-900' : 'border-transparent text-slate-400 hover:text-slate-600'}`}>
          Reports
        </button>
      </div>

      {/* ── DISPATCH TAB ────────────────────────────────────────────────── */}
      {tab === 'dispatch' && mode === 'management' && (
        <div className="grid grid-cols-1 lg:grid-cols-5 gap-5 print:hidden">
          <div className="lg:col-span-2 bg-white rounded-2xl border border-slate-100 shadow-sm p-5">
            <h3 className="text-sm font-black text-slate-800 mb-4 flex items-center gap-2"><Plus className="h-4 w-4" /> New Delivery</h3>
            <div className="space-y-3">
              <div>
                <label className="text-[11px] font-bold text-slate-500">Site / Project *</label>
                {!addingNewSite ? (
                  <div className="flex items-center gap-1.5 mt-1">
                    <select
                      value={allSiteNames.includes(form.siteName) ? form.siteName : ''}
                      onChange={e => setForm(f => ({ ...f, siteName: e.target.value }))}
                      className="flex-1 border border-slate-200 rounded-lg px-3 py-2 text-sm font-semibold focus:outline-none focus:ring-2 focus:ring-slate-400"
                    >
                      <option value="" disabled>Select a site…</option>
                      {allSiteNames.map(s => <option key={s} value={s}>{s}</option>)}
                    </select>
                    <button
                      type="button"
                      onClick={() => { setAddingNewSite(true); setForm(f => ({ ...f, siteName: '' })); }}
                      title="Add a new site/project name"
                      className="shrink-0 flex items-center gap-1 px-2.5 py-2 rounded-lg border border-slate-200 text-[11px] font-bold text-slate-600 hover:bg-slate-50 cursor-pointer"
                    >
                      <Plus className="h-3.5 w-3.5" /> New Site
                    </button>
                  </div>
                ) : (
                  <div className="flex items-center gap-1.5 mt-1">
                    <input
                      autoFocus
                      value={form.siteName}
                      onChange={e => setForm(f => ({ ...f, siteName: e.target.value }))}
                      placeholder="Type the new site/project name"
                      className="flex-1 border border-slate-200 rounded-lg px-3 py-2 text-sm font-semibold focus:outline-none focus:ring-2 focus:ring-slate-400"
                    />
                    {allSiteNames.length > 0 && (
                      <button
                        type="button"
                        onClick={() => { setAddingNewSite(false); setForm(f => ({ ...f, siteName: '' })); }}
                        title="Pick from existing sites instead"
                        className="shrink-0 px-2.5 py-2 rounded-lg border border-slate-200 text-[11px] font-bold text-slate-500 hover:bg-slate-50 cursor-pointer"
                      >
                        Cancel
                      </button>
                    )}
                  </div>
                )}
                <p className="text-[10px] text-slate-400 mt-1">New site names are remembered automatically for next time.</p>
              </div>
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="text-[11px] font-bold text-slate-500">Dispatch Date</label>
                  <input type="date" value={form.dispatchDate} onChange={e => setForm(f => ({ ...f, dispatchDate: e.target.value }))}
                    className="w-full mt-1 border border-slate-200 rounded-lg px-3 py-2 text-sm font-semibold focus:outline-none focus:ring-2 focus:ring-slate-400" />
                </div>
                <div>
                  <label className="text-[11px] font-bold text-slate-500">Time</label>
                  <input type="time" value={form.dispatchTime} onChange={e => setForm(f => ({ ...f, dispatchTime: e.target.value }))}
                    className="w-full mt-1 border border-slate-200 rounded-lg px-3 py-2 text-sm font-semibold focus:outline-none focus:ring-2 focus:ring-slate-400" />
                </div>
              </div>
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="text-[11px] font-bold text-slate-500">Truck Number</label>
                  <input value={form.truckNumber} onChange={e => setForm(f => ({ ...f, truckNumber: e.target.value }))}
                    className="w-full mt-1 border border-slate-200 rounded-lg px-3 py-2 text-sm font-semibold focus:outline-none focus:ring-2 focus:ring-slate-400" placeholder="e.g. DXB-A-12345" />
                </div>
                <div>
                  <label className="text-[11px] font-bold text-slate-500">Driver Name</label>
                  <input value={form.driverName} onChange={e => setForm(f => ({ ...f, driverName: e.target.value }))}
                    className="w-full mt-1 border border-slate-200 rounded-lg px-3 py-2 text-sm font-semibold focus:outline-none focus:ring-2 focus:ring-slate-400" />
                </div>
              </div>
              <div>
                <label className="text-[11px] font-bold text-slate-500">Driver Phone</label>
                <input value={form.driverPhone} onChange={e => setForm(f => ({ ...f, driverPhone: e.target.value }))}
                  className="w-full mt-1 border border-slate-200 rounded-lg px-3 py-2 text-sm font-semibold focus:outline-none focus:ring-2 focus:ring-slate-400" placeholder="05X XXX XXXX" />
              </div>

              <div className="pt-2">
                <div className="flex items-center justify-between mb-2">
                  <label className="text-[11px] font-bold text-slate-500">Items Being Sent *</label>
                  <button onClick={addItem} className="text-[11px] font-bold text-slate-700 hover:text-slate-900 flex items-center gap-1 cursor-pointer"><Plus className="h-3 w-3" /> Add item</button>
                </div>
                <div className="space-y-2">
                  {form.items.map((it, idx) => (
                    <div key={it.id} className="border border-slate-200 rounded-lg p-2.5 space-y-1.5 bg-slate-50">
                      <div className="flex items-center gap-1.5">
                        <input value={it.description} onChange={e => updateItem(it.id, { description: e.target.value })}
                          placeholder={`Item ${idx + 1} — e.g. Acrylic Sheet, Pool #204, Trolley`}
                          className="flex-1 border border-slate-200 rounded-md px-2 py-1.5 text-xs font-semibold focus:outline-none focus:ring-2 focus:ring-slate-400" />
                        {form.items.length > 1 && (
                          <button onClick={() => removeItem(it.id)} className="text-rose-400 hover:text-rose-600 cursor-pointer"><Trash2 className="h-3.5 w-3.5" /></button>
                        )}
                      </div>
                      <div className="flex items-center gap-1.5">
                        <input value={it.category || ''} onChange={e => updateItem(it.id, { category: e.target.value })}
                          placeholder="Category (Acrylic, Pool, Trolley…)" className="flex-1 border border-slate-200 rounded-md px-2 py-1.5 text-xs focus:outline-none focus:ring-2 focus:ring-slate-400" />
                        <input type="number" min={0} value={it.qty} onChange={e => updateItem(it.id, { qty: parseFloat(e.target.value) || 0 })}
                          className="w-16 border border-slate-200 rounded-md px-2 py-1.5 text-xs font-bold text-center focus:outline-none focus:ring-2 focus:ring-slate-400" />
                        <input value={it.unit} onChange={e => updateItem(it.id, { unit: e.target.value })}
                          className="w-16 border border-slate-200 rounded-md px-2 py-1.5 text-xs text-center focus:outline-none focus:ring-2 focus:ring-slate-400" placeholder="unit" />
                      </div>
                    </div>
                  ))}
                </div>
              </div>

              <div>
                <label className="text-[11px] font-bold text-slate-500">Notes</label>
                <textarea value={form.notes} onChange={e => setForm(f => ({ ...f, notes: e.target.value }))} rows={2}
                  className="w-full mt-1 border border-slate-200 rounded-lg px-3 py-2 text-xs focus:outline-none focus:ring-2 focus:ring-slate-400" placeholder="Any special instructions…" />
              </div>

              <button onClick={submitDispatch} disabled={!canSubmitDispatch}
                className="w-full mt-2 py-2.5 bg-slate-900 hover:bg-slate-800 disabled:opacity-40 disabled:cursor-not-allowed text-white font-bold text-xs rounded-xl cursor-pointer flex items-center justify-center gap-2">
                <Send className="h-4 w-4" /> Dispatch & Print Slip
              </button>
            </div>
          </div>

          <div className="lg:col-span-3 bg-white rounded-2xl border border-slate-100 shadow-sm p-5">
            <h3 className="text-sm font-black text-slate-800 mb-4">Recent Dispatches</h3>
            <div className="space-y-2 max-h-[720px] overflow-y-auto">
              {deliveries.length === 0 && <p className="text-xs text-slate-400 text-center py-10">No deliveries yet.</p>}
              {deliveries.slice(0, 40).map(d => (
                <div key={d.id} className="border border-slate-100 rounded-xl p-3 flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="text-xs font-black text-slate-800">{d.deliveryNo}</span>
                      <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full border ${STATUS_STYLES[d.status]}`}>{d.status}</span>
                    </div>
                    <div className="text-xs font-semibold text-slate-700 mt-0.5">{d.siteName}</div>
                    <div className="text-[11px] text-slate-400 mt-0.5">{fmtDate(d.dispatchDate)} · {d.items.length} item{d.items.length !== 1 ? 's' : ''} · {d.truckNumber || 'no truck #'}</div>
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    <button onClick={() => setPrintDelivery(d)} title="Print slip" className="h-8 w-8 rounded-lg border border-slate-200 flex items-center justify-center text-slate-500 hover:text-slate-800 cursor-pointer"><Printer className="h-3.5 w-3.5" /></button>
                    <button onClick={() => deleteDelivery(d.id)} title="Delete" className="h-8 w-8 rounded-lg border border-slate-200 flex items-center justify-center text-rose-400 hover:text-rose-600 cursor-pointer"><Trash2 className="h-3.5 w-3.5" /></button>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* ── RECEIVE TAB ─────────────────────────────────────────────────── */}
      {tab === 'receive' && mode === 'site_team' && (
        <div className="space-y-6 print:hidden">
          <div>
            <h3 className="text-sm font-black text-slate-800 mb-3 flex items-center gap-2"><Clock className="h-4 w-4 text-amber-500" /> Awaiting Confirmation ({pendingReceipt.length})</h3>
            {pendingReceipt.length === 0 && <p className="text-xs text-slate-400 bg-white rounded-xl border border-slate-100 p-6 text-center">Nothing pending — all clear.</p>}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              {pendingReceipt.map(d => (
                <div key={d.id} className="bg-white rounded-2xl border border-amber-100 shadow-sm p-4">
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-black text-slate-800">{d.deliveryNo}</span>
                    <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full border ${STATUS_STYLES[d.status]}`}>{d.status}</span>
                  </div>
                  <div className="text-sm font-bold text-slate-800 mt-1">{d.siteName}</div>
                  <div className="text-[11px] text-slate-400 mt-0.5 mb-2">{fmtDate(d.dispatchDate)} {d.dispatchTime || ''} · Truck {d.truckNumber || '—'}</div>
                  <ul className="text-[11px] text-slate-600 space-y-0.5 mb-3">
                    {d.items.map(it => <li key={it.id}>• {it.qty} {it.unit} — {it.category ? `${it.category} — ` : ''}{it.description}</li>)}
                  </ul>
                  <button onClick={() => openReceive(d)} className="w-full py-2 bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-bold rounded-lg cursor-pointer flex items-center justify-center gap-1.5">
                    <PackageCheck className="h-3.5 w-3.5" /> Confirm Received
                  </button>
                </div>
              ))}
            </div>
          </div>

          <div>
            <h3 className="text-sm font-black text-slate-800 mb-3 flex items-center gap-2"><CheckCircle2 className="h-4 w-4 text-emerald-500" /> Confirmed / Resolved</h3>
            <div className="bg-white rounded-2xl border border-slate-100 shadow-sm divide-y divide-slate-50">
              {resolvedReceipt.length === 0 && <p className="text-xs text-slate-400 text-center py-8">No confirmed deliveries yet.</p>}
              {resolvedReceipt.slice(0, 30).map(d => (
                <div key={d.id} className="p-3 flex items-center justify-between gap-3">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="text-xs font-black text-slate-800">{d.deliveryNo}</span>
                      <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full border ${STATUS_STYLES[d.status]}`}>{d.status}</span>
                    </div>
                    <div className="text-xs font-semibold text-slate-700">{d.siteName} · {d.items.length} item{d.items.length !== 1 ? 's' : ''}</div>
                    <div className="text-[11px] text-slate-400">Received by {d.receivedByName} — {fmtDateTime(d.receivedAt)}</div>
                    {d.shortageNotes && <div className="text-[11px] text-rose-500 font-semibold mt-0.5 flex items-center gap-1"><AlertTriangle className="h-3 w-3" /> {d.shortageNotes}</div>}
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* ── REPORTS TAB ─────────────────────────────────────────────────── */}
      {tab === 'reports' && (
        <div className="space-y-4 print:hidden">
          <div className="bg-white rounded-2xl border border-slate-100 shadow-sm p-4 flex flex-wrap items-end gap-3">
            <div>
              <label className="text-[11px] font-bold text-slate-500 flex items-center gap-1"><CalendarDays className="h-3 w-3" /> Range</label>
              <div className="flex gap-1 mt-1">
                {(['day', 'week', 'month', 'year', 'custom'] as const).map(m => (
                  <button key={m} onClick={() => setRangeMode(m)} className={`px-2.5 py-1.5 rounded-lg text-[11px] font-bold cursor-pointer capitalize ${rangeMode === m ? 'bg-slate-900 text-white' : 'bg-slate-100 text-slate-500 hover:bg-slate-200'}`}>{m}</button>
                ))}
              </div>
            </div>
            {rangeMode !== 'custom' ? (
              <div>
                <label className="text-[11px] font-bold text-slate-500">Anchor date</label>
                <input type="date" value={rangeAnchor} onChange={e => setRangeAnchor(e.target.value)} className="block mt-1 border border-slate-200 rounded-lg px-3 py-1.5 text-xs font-semibold focus:outline-none focus:ring-2 focus:ring-slate-400" />
              </div>
            ) : (
              <>
                <div>
                  <label className="text-[11px] font-bold text-slate-500">From</label>
                  <input type="date" value={customStart} onChange={e => setCustomStart(e.target.value)} className="block mt-1 border border-slate-200 rounded-lg px-3 py-1.5 text-xs font-semibold focus:outline-none focus:ring-2 focus:ring-slate-400" />
                </div>
                <div>
                  <label className="text-[11px] font-bold text-slate-500">To</label>
                  <input type="date" value={customEnd} onChange={e => setCustomEnd(e.target.value)} className="block mt-1 border border-slate-200 rounded-lg px-3 py-1.5 text-xs font-semibold focus:outline-none focus:ring-2 focus:ring-slate-400" />
                </div>
              </>
            )}
            <div>
              <label className="text-[11px] font-bold text-slate-500 flex items-center gap-1"><Filter className="h-3 w-3" /> Site</label>
              <select value={filterSite} onChange={e => setFilterSite(e.target.value)} className="block mt-1 border border-slate-200 rounded-lg px-3 py-1.5 text-xs font-semibold focus:outline-none focus:ring-2 focus:ring-slate-400">
                <option value="ALL">All Sites</option>
                {allSiteNames.map(s => <option key={s} value={s}>{s}</option>)}
              </select>
            </div>
            <div>
              <label className="text-[11px] font-bold text-slate-500 flex items-center gap-1"><Search className="h-3 w-3" /> Product</label>
              <select value={filterProduct} onChange={e => setFilterProduct(e.target.value)} className="block mt-1 border border-slate-200 rounded-lg px-3 py-1.5 text-xs font-semibold focus:outline-none focus:ring-2 focus:ring-slate-400">
                <option value="ALL">All Products</option>
                {allProducts.map(p => <option key={p} value={p}>{p}</option>)}
              </select>
            </div>
            <div className="ml-auto flex gap-2">
              <button onClick={exportReportExcel} className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-slate-200 text-xs font-bold text-slate-600 hover:bg-slate-50 cursor-pointer"><Download className="h-3.5 w-3.5" /> Excel</button>
              <button onClick={exportReportPdf} className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-slate-200 text-xs font-bold text-slate-600 hover:bg-slate-50 cursor-pointer"><Printer className="h-3.5 w-3.5" /> PDF</button>
            </div>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
            <div className="lg:col-span-1 bg-white rounded-2xl border border-slate-100 shadow-sm p-4">
              <h4 className="text-xs font-black text-slate-800 mb-1">Product Summary</h4>
              <p className="text-[11px] text-slate-400 mb-3">{rangeLabel}{filterSite !== 'ALL' ? ` · ${filterSite}` : ''}</p>
              <div className="space-y-2 max-h-[420px] overflow-y-auto">
                {productSummary.length === 0 && <p className="text-xs text-slate-400 text-center py-6">No deliveries in this range.</p>}
                {productSummary.map(p => (
                  <div key={p.product} className="flex items-center justify-between border-b border-slate-50 pb-1.5">
                    <div>
                      <div className="text-xs font-bold text-slate-700">{p.product}</div>
                      <div className="text-[10px] text-slate-400">{p.deliveryCount} deliver{p.deliveryCount !== 1 ? 'ies' : 'y'}</div>
                    </div>
                    <div className="text-sm font-black text-slate-800">{p.qty} <span className="text-[10px] font-semibold text-slate-400">{p.unit}</span></div>
                  </div>
                ))}
              </div>
            </div>

            <div className="lg:col-span-2 bg-white rounded-2xl border border-slate-100 shadow-sm p-4 overflow-x-auto">
              <h4 className="text-xs font-black text-slate-800 mb-3 flex items-center gap-2"><ClipboardList className="h-3.5 w-3.5" /> {rangeLabel} — {reportRows.length} line{reportRows.length !== 1 ? 's' : ''}</h4>
              <table className="w-full text-[11px]">
                <thead>
                  <tr className="text-left text-slate-400 border-b border-slate-100">
                    <th className="py-1.5 pr-2">Delivery #</th><th className="py-1.5 pr-2">Site</th><th className="py-1.5 pr-2">Date</th>
                    <th className="py-1.5 pr-2">Product</th><th className="py-1.5 pr-2">Qty</th><th className="py-1.5 pr-2">Status</th><th className="py-1.5 pr-2">Received</th>
                  </tr>
                </thead>
                <tbody>
                  {reportRows.map((r, i) => (
                    <tr key={i} className="border-b border-slate-50">
                      <td className="py-1.5 pr-2 font-bold text-slate-700">{r.deliveryNo}</td>
                      <td className="py-1.5 pr-2">{r.siteName}</td>
                      <td className="py-1.5 pr-2">{r.dispatchDate}</td>
                      <td className="py-1.5 pr-2">{r.product}</td>
                      <td className="py-1.5 pr-2 font-bold">{r.qty} {r.unit}</td>
                      <td className="py-1.5 pr-2"><span className={`text-[10px] font-bold px-1.5 py-0.5 rounded-full border ${STATUS_STYLES[r.status as SiteDelivery['status']]}`}>{r.status}</span></td>
                      <td className="py-1.5 pr-2 text-slate-400">{r.receivedByName}</td>
                    </tr>
                  ))}
                  {reportRows.length === 0 && (
                    <tr><td colSpan={7} className="text-center text-slate-400 py-8">No matching deliveries.</td></tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {/* Receive confirmation modal */}
      {receiveTarget && (
        <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4 print:hidden" onClick={() => setReceiveTarget(null)}>
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-sm p-5" onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-3">
              <h3 className="text-sm font-black text-slate-800">Confirm Receipt — {receiveTarget.deliveryNo}</h3>
              <button onClick={() => setReceiveTarget(null)} className="text-slate-400 hover:text-slate-700 cursor-pointer"><X className="h-4 w-4" /></button>
            </div>
            <div className="space-y-3">
              <div>
                <label className="text-[11px] font-bold text-slate-500">Received By *</label>
                <input value={receiveForm.receivedByName} onChange={e => setReceiveForm(f => ({ ...f, receivedByName: e.target.value }))} autoFocus
                  className="w-full mt-1 border border-slate-200 rounded-lg px-3 py-2 text-sm font-semibold focus:outline-none focus:ring-2 focus:ring-slate-400" placeholder="Your name" />
              </div>
              <div>
                <label className="text-[11px] font-bold text-slate-500">Status</label>
                <div className="flex gap-1.5 mt-1">
                  {(['RECEIVED', 'PARTIAL', 'DISPUTED'] as const).map(s => (
                    <button key={s} onClick={() => setReceiveForm(f => ({ ...f, status: s }))} className={`flex-1 py-1.5 rounded-lg text-[11px] font-bold cursor-pointer ${receiveForm.status === s ? 'bg-slate-900 text-white' : 'bg-slate-100 text-slate-500'}`}>{s}</button>
                  ))}
                </div>
              </div>
              {receiveForm.status !== 'RECEIVED' && (
                <div>
                  <label className="text-[11px] font-bold text-slate-500">What's missing / damaged?</label>
                  <textarea value={receiveForm.shortageNotes} onChange={e => setReceiveForm(f => ({ ...f, shortageNotes: e.target.value }))} rows={2}
                    className="w-full mt-1 border border-slate-200 rounded-lg px-3 py-2 text-xs focus:outline-none focus:ring-2 focus:ring-rose-300" />
                </div>
              )}
              <div>
                <label className="text-[11px] font-bold text-slate-500">Notes</label>
                <textarea value={receiveForm.receivedNotes} onChange={e => setReceiveForm(f => ({ ...f, receivedNotes: e.target.value }))} rows={2}
                  className="w-full mt-1 border border-slate-200 rounded-lg px-3 py-2 text-xs focus:outline-none focus:ring-2 focus:ring-slate-400" />
              </div>
              <button onClick={confirmReceipt} disabled={!receiveForm.receivedByName.trim()}
                className="w-full py-2.5 bg-emerald-600 hover:bg-emerald-700 disabled:opacity-40 text-white font-bold text-xs rounded-xl cursor-pointer flex items-center justify-center gap-2">
                <Save className="h-4 w-4" /> Confirm
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

