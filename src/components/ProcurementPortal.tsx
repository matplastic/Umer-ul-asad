import React, { useCallback, useEffect, useMemo, useState } from 'react';
import * as XLSX from 'xlsx';
import {
  RefreshCw, Plus, Search, ClipboardList, Scale, ShoppingCart, Wallet, Building2, LayoutDashboard, Download,
  AlertTriangle, ChevronRight, Loader2, FileText, Landmark, Paperclip,
} from 'lucide-react';
import type { IncomingMaterial, Material, PurchaseOrder, Rfq, Supplier, SupplierInvoice, SupplierPayment, TradeFinance } from '../types';
import {
  dbFetchHRPurchaseRequests, dbFetchIncomingMaterials, dbFetchMaterials, dbFetchPurchaseOrders, dbFetchRfqs,
  dbFetchSupervisorPurchaseRequests, dbFetchSupplierInvoices, dbFetchSupplierPayments, dbFetchSuppliers, dbFetchTradeFinances, dbPoAction, dbSaveRfq,
} from '../lib/firebaseService';
import {
  STAGE_META, canAutoClose, cheapestQuoteId, dateFmt, daysUntil, money, openRequisitions, poFinance, poProgress, poStage, poTotals, qtyFmt,
  quoteTotal, type PoStage,
} from '../lib/procurement';
import { PoEditor, type PoSeed } from './PoEditor';
import { PoDetailPanel } from './PoDetailPanel';
import { RfqEditor, type RfqSeed } from './RfqEditor';
import { TradeFinanceEditor } from './TradeFinanceEditor';
import { TradeFinancePanel } from './TradeFinancePanel';
import { TF_STATUS_META, tfPosition, tfTypeLabel } from '../lib/tradeFinance';
import { SuppliersPage } from './SuppliersPage';
import { ProgressBar, Stat, StageBadge, btn, inputCls } from './ProcurementUi';

// ─────────────────────────────────────────────────────────────────────────────
// PROCUREMENT PORTAL — the purchasing desk
//   Requisitions → Quotations (compare quotes) → PO → approval → Store receives against the PO
//   → supplier invoice (3-way match) → payment → closed
// ─────────────────────────────────────────────────────────────────────────────

type Tab = 'dashboard' | 'requisitions' | 'rfq' | 'po' | 'stf' | 'payments' | 'suppliers';
const TABS: { id: Tab; label: string; icon: React.ElementType }[] = [
  { id: 'dashboard', label: 'Dashboard', icon: LayoutDashboard },
  { id: 'requisitions', label: 'Requisitions', icon: ClipboardList },
  { id: 'rfq', label: 'Quotations', icon: Scale },
  { id: 'po', label: 'Purchase Orders', icon: ShoppingCart },
  { id: 'stf', label: 'STF — Trade Finance', icon: Landmark },
  { id: 'payments', label: 'Payments', icon: Wallet },
  { id: 'suppliers', label: 'Suppliers', icon: Building2 },
];

const norm = (s: string) => (s || '').trim().toLowerCase().replace(/\s+/g, ' ');

interface Row { po: PurchaseOrder; progress: ReturnType<typeof poProgress>; fin: ReturnType<typeof poFinance>; stage: PoStage; total: number }

interface Props { currentUserName: string; canApprove: boolean }

const ProcurementPortal: React.FC<Props> = ({ currentUserName, canApprove }) => {
  const [tab, setTab] = useState<Tab>('dashboard');
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [suppliers, setSuppliers] = useState<Supplier[]>([]);
  const [materials, setMaterials] = useState<Material[]>([]);
  const [incoming, setIncoming] = useState<IncomingMaterial[]>([]);
  const [pos, setPos] = useState<PurchaseOrder[]>([]);
  const [rfqs, setRfqs] = useState<Rfq[]>([]);
  const [tfs, setTfs] = useState<TradeFinance[]>([]);
  const [invoices, setInvoices] = useState<SupplierInvoice[]>([]);
  const [payments, setPayments] = useState<SupplierPayment[]>([]);
  const [supReqs, setSupReqs] = useState<any[]>([]);
  const [hrReqs, setHrReqs] = useState<any[]>([]);

  const [selectedPoId, setSelectedPoId] = useState<string | null>(null);
  const [poEditor, setPoEditor] = useState<{ initial?: PurchaseOrder | null; seed?: PoSeed | null } | null>(null);
  const [selectedTfId, setSelectedTfId] = useState<string | null>(null);
  const [tfEditor, setTfEditor] = useState<{ initial?: TradeFinance | null; forPoId?: string | null } | null>(null);
  const [rfqEditor, setRfqEditor] = useState<{ initial?: Rfq | null; seed?: RfqSeed | null } | null>(null);

  const load = useCallback(async () => {
    try {
      const [s, m, inc, p, st, inv, pay, sr, hr, tf] = await Promise.all([
        dbFetchSuppliers(), dbFetchMaterials(), dbFetchIncomingMaterials(), dbFetchPurchaseOrders(), dbFetchRfqs(),
        dbFetchSupplierInvoices(), dbFetchSupplierPayments(), dbFetchSupervisorPurchaseRequests(), dbFetchHRPurchaseRequests(), dbFetchTradeFinances(),
      ]);
      setSuppliers(s); setMaterials(m); setIncoming(inc); setPos(p); setRfqs(st); setInvoices(inv); setPayments(pay); setSupReqs(sr); setHrReqs(hr); setTfs(tf);
      setLoadError(null);
    } catch (e: any) {
      setLoadError(e?.message || 'Could not load procurement data.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); const t = window.setInterval(load, 60000); return () => window.clearInterval(t); }, [load]);

  const rows: Row[] = useMemo(() => pos.map(po => {
    const progress = poProgress(po, incoming);
    const fin = poFinance(po, invoices, payments);
    return { po, progress, fin, stage: poStage(po, progress, fin), total: poTotals(po).total };
  }).sort((a, b) => b.po.poNo.localeCompare(a.po.poNo)), [pos, incoming, invoices, payments]);

  const requisitions = useMemo(() => openRequisitions(supReqs, hrReqs, pos), [supReqs, hrReqs, pos]);
  const selectedRow = rows.find(r => r.po.id === selectedPoId) || null;
  const selectedTf = tfs.find(t => t.id === selectedTfId) || null;

  // A PO that is fully received, invoiced and paid (e.g. the bank paid it under an STF) closes by itself.
  const autoTried = React.useRef<Set<string>>(new Set());
  useEffect(() => {
    const todo = rows.filter(r => canAutoClose(r.po, r.progress, r.fin) && !autoTried.current.has(r.po.id));
    if (todo.length === 0) return;
    todo.forEach(r => autoTried.current.add(r.po.id));
    (async () => {
      for (const r of todo) { try { await dbPoAction(r.po.id, 'close', currentUserName, { closedReason: 'completed', notes: 'Received in full and fully paid.' }); } catch { /* stays open; can be closed by hand */ } }
      load();
    })();
  }, [rows, currentUserName, load]);

  const tfPos = useMemo(() => tfs.map(t => ({ tf: t, pos: tfPosition(t) })), [tfs]);
  const tfLive = tfPos.filter(x => x.tf.status === 'drawn');
  const tfOutstanding = tfLive.reduce((t, x) => t + x.pos.outstanding, 0);
  const tfOverdue = tfLive.filter(x => x.pos.overdue);
  const tfSoon = tfLive.filter(x => x.pos.dueSoon);

  // ---- derived numbers for the dashboard / payments ----
  const byStage = (...s: PoStage[]) => rows.filter(r => s.includes(r.stage));
  const outstandingRows = rows.filter(r => (r.po.status === 'approved' || r.po.status === 'closed') && r.fin.outstanding > 0);
  const dueDate = (r: Row) => r.fin.invoices.map(i => i.dueDate).sort()[0] || null;
  const overdueRows = outstandingRows.filter(r => { const d = dueDate(r); return d && daysUntil(d) < 0; });
  const monthKey = new Date().toISOString().slice(0, 7);
  const spendMonth = payments.filter(p => !p.voided && p.paidAt.startsWith(monthKey)).reduce((t, p) => t + p.amount, 0);
  const lateDeliveries = rows.filter(r => r.po.status === 'approved' && !r.progress.complete && r.po.expectedDate && daysUntil(r.po.expectedDate.slice(0, 10)) < 0);
  const needInvoice = byStage('received');

  // ---- opening editors from requisitions ----
  const matchMaterial = (r: { erpCode?: string | null; itemName: string }) =>
    materials.find(m => r.erpCode && (m as any).erpCode === r.erpCode) || materials.find(m => norm(m.name) === norm(r.itemName)) || null;
  const toSeedLines = (sel: typeof requisitions) => sel.map(r => ({
    materialId: matchMaterial(r)?.id, itemName: r.itemName, qty: r.qty, sourceRequestId: r.id, sourceKind: r.kind,
  }));

  const afterPoSaved = async (po: PurchaseOrder, seedRfq?: Rfq | null) => {
    if (seedRfq) { try { await dbSaveRfq({ id: seedRfq.id, title: seedRfq.title, status: 'po_created', poId: po.id }, currentUserName); } catch { /* the PO is saved; the quotation link is cosmetic */ } }
    setPoEditor(null);
    await load();
    setSelectedPoId(po.id);
    setTab('po');
  };

  const createPoFromRfq = (rfq: Rfq) => {
    const q = rfq.quotes.find(x => x.id === rfq.awardedQuoteId);
    if (!q) return;
    setRfqEditor(null);
    setPoEditor({
      seed: {
        rfq, supplierName: q.supplierName, paymentTerms: q.paymentTerms || null,
        expectedDate: q.leadTimeDays ? new Date(Date.now() + q.leadTimeDays * 86400000).toISOString().slice(0, 10) : rfq.neededBy || null,
        lines: rfq.lines.map(l => ({ materialId: l.materialId, itemName: l.itemName, qty: l.qty, unitPrice: q.unitPrices[l.id] ?? null, sourceRequestId: l.sourceRequestId, sourceKind: l.sourceKind })),
      },
    });
  };

  // ---- exports ----
  const exportPos = () => {
    const data = rows.map(r => {
      const t = poTotals(r.po);
      return {
        'PO No.': r.po.poNo, 'Date': dateFmt(r.po.orderDate), 'Supplier': r.po.supplierName, 'Status': STAGE_META[r.stage].label,
        'Items': r.po.lines.length, 'Subtotal': t.subtotal, 'VAT': t.vat, 'Total': t.total,
        'Received %': Math.round(r.progress.pct), 'Invoiced': r.fin.invoiced, 'Paid': r.fin.paid, 'Outstanding': r.fin.outstanding,
        'Due by': dateFmt(r.po.expectedDate),
      };
    });
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(data), 'Purchase orders');
    XLSX.writeFile(wb, `Purchase_Orders_${new Date().toISOString().slice(0, 10)}.xlsx`);
  };
  const exportPayments = () => {
    const data = payments.filter(p => !p.voided).sort((a, b) => b.paidAt.localeCompare(a.paidAt)).map(p => ({
      'Date': dateFmt(p.paidAt), 'PO No.': p.poNo, 'Supplier': p.supplierName, 'Type': p.kind === 'advance' ? 'Advance' : 'Invoice payment',
      'Amount (AED)': p.amount, 'Method': p.method.replace('_', ' '), 'Reference': p.reference || '', 'Recorded by': p.byName,
    }));
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(data), 'Payments');
    XLSX.writeFile(wb, `Supplier_Payments_${new Date().toISOString().slice(0, 10)}.xlsx`);
  };

  if (loading) return <div className="flex items-center justify-center py-24 text-slate-500 text-sm gap-2"><Loader2 className="h-4 w-4 animate-spin" /> Loading procurement…</div>;

  return (
    <div className="space-y-4" data-testid="procurement-portal">
      {/* header */}
      <div className="flex flex-wrap items-center gap-3">
        <div className="h-11 w-11 rounded-2xl bg-primary-600 text-white flex items-center justify-center"><ShoppingCart className="h-5 w-5" /></div>
        <div className="min-w-0">
          <h1 className="text-xl font-black text-slate-900">Procurement</h1>
          <p className="text-xs text-slate-500">Requisitions, sourcing, purchase orders, supplier invoices and payments — linked to the Store’s goods receipts.</p>
        </div>
        <button onClick={load} className={`${btn.soft} ml-auto`}><RefreshCw className="h-3.5 w-3.5" /> Refresh</button>
      </div>
      {loadError && <div className="rounded-lg border border-rose-300 bg-rose-50 px-3 py-2 text-xs text-rose-700 flex items-center gap-2"><AlertTriangle className="h-4 w-4" />{loadError}</div>}

      {/* tabs */}
      <div className="flex flex-wrap gap-2">
        {TABS.map(t => {
          const badge = t.id === 'requisitions' ? requisitions.length : t.id === 'po' ? byStage('awaiting_approval').length : t.id === 'payments' ? overdueRows.length : 0;
          return (
            <button key={t.id} onClick={() => setTab(t.id)} data-testid={`proc-tab-${t.id}`}
              className={`flex items-center gap-1.5 px-4 py-2 rounded-lg text-xs font-bold cursor-pointer border transition-all ${tab === t.id ? 'bg-primary-600 border-primary-600 text-white' : 'bg-white border-slate-200 text-slate-600 hover:text-slate-900'}`}>
              <t.icon className="h-3.5 w-3.5" /> {t.label}
              {badge > 0 && <span className={`ml-1 px-1.5 rounded-full text-[10px] font-black ${tab === t.id ? 'bg-white/25 text-white' : t.id === 'payments' ? 'bg-rose-100 text-rose-700' : 'bg-amber-100 text-amber-800'}`}>{badge}</span>}
            </button>
          );
        })}
      </div>

      {/* ============ DASHBOARD ============ */}
      {tab === 'dashboard' && (
        <div className="space-y-4">
          {/* the process, with live counts */}
          <div className="rounded-xl border border-slate-200 bg-white p-3 overflow-x-auto">
            <div className="flex items-stretch gap-1 min-w-[860px]">
              {([
                ['Requisitions', requisitions.length, 'approved requests, no PO yet', () => setTab('requisitions')],
                ['Quotations', rfqs.filter(s => s.status === 'draft' || s.status === 'awarded').length, 'quotations in progress', () => setTab('rfq')],
                ['PO approval', byStage('draft', 'awaiting_approval').length, 'draft / awaiting approval', () => setTab('po')],
                ['STF (bank)', tfs.filter(t => ['draft', 'applied', 'approved', 'drawn'].includes(t.status)).length, 'trade finance in progress', () => setTab('stf')],
                ['Awaiting delivery', byStage('issued').length, 'issued, nothing received', () => setTab('po')],
                ['Receiving', byStage('partially_received').length, 'partly delivered', () => setTab('po')],
                ['Invoice & pay', byStage('received', 'part_paid').length, 'received, not fully paid', () => setTab('payments')],
                ['Close', byStage('paid').length, 'paid — ready to close', () => setTab('po')],
              ] as [string, number, string, () => void][]).map(([label, n, sub, go], i, arr) => (
                <React.Fragment key={label}>
                  <button onClick={go} className="flex-1 text-left rounded-lg px-3 py-2 hover:bg-slate-50 cursor-pointer">
                    <div className="text-[10px] uppercase font-bold text-slate-500">{label}</div>
                    <div className={`text-xl font-black font-mono ${n > 0 ? 'text-primary-700' : 'text-slate-300'}`}>{n}</div>
                    <div className="text-[10px] text-slate-500 leading-tight">{sub}</div>
                  </button>
                  {i < arr.length - 1 && <ChevronRight className="h-4 w-4 self-center text-slate-300 shrink-0" />}
                </React.Fragment>
              ))}
            </div>
          </div>

          <div className="grid grid-cols-2 lg:grid-cols-5 gap-3">
            <Stat label="Open POs" value={String(rows.filter(r => r.po.status === 'approved').length)} sub={`AED ${money(rows.filter(r => r.po.status === 'approved').reduce((t, r) => t + r.total, 0))}`} onClick={() => setTab('po')} />
            <Stat label="Awaiting approval" value={String(byStage('awaiting_approval').length)} tone={byStage('awaiting_approval').length ? 'warn' : 'default'} sub="management" onClick={() => setTab('po')} />
            <Stat label="Outstanding payables" value={money(outstandingRows.reduce((t, r) => t + r.fin.outstanding, 0))} sub="AED invoiced, not paid" onClick={() => setTab('payments')} />
            <Stat label="Overdue" value={money(overdueRows.reduce((t, r) => t + r.fin.outstanding, 0))} tone={overdueRows.length ? 'bad' : 'good'} sub={`${overdueRows.length} PO(s) past due date`} onClick={() => setTab('payments')} />
            <Stat label="Paid this month" value={money(spendMonth)} sub="AED" tone="good" />
          </div>
          {(tfs.length > 0) && (
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
              <Stat label="Owed to banks (STF)" value={money(tfOutstanding)} sub={`${tfLive.length} drawn facility(ies)`} onClick={() => setTab('stf')} />
              <Stat label="STF maturing ≤ 30 days" value={String(tfSoon.length)} tone={tfSoon.length ? 'warn' : 'default'} sub={`AED ${money(tfSoon.reduce((t, x) => t + x.pos.outstanding, 0))}`} onClick={() => setTab('stf')} />
              <Stat label="STF overdue" value={String(tfOverdue.length)} tone={tfOverdue.length ? 'bad' : 'good'} sub={`AED ${money(tfOverdue.reduce((t, x) => t + x.pos.outstanding, 0))}`} onClick={() => setTab('stf')} />
              <Stat label="Awaiting bank / drawdown" value={String(tfs.filter(t => t.status === 'applied' || t.status === 'approved').length)} sub="applied or approved" onClick={() => setTab('stf')} />
            </div>
          )}

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            <div className="rounded-xl border border-slate-200 bg-white p-4">
              <div className="text-xs font-extrabold text-slate-900 mb-2">Needs attention</div>
              <ul className="space-y-1.5 text-xs">
                {byStage('awaiting_approval').map(r => <li key={r.po.id}><button onClick={() => setSelectedPoId(r.po.id)} className="text-left hover:underline cursor-pointer"><span className="font-mono font-bold">{r.po.poNo}</span> · {r.po.supplierName} — <span className="text-amber-700 font-bold">waiting for approval</span> (AED {money(r.total)})</button></li>)}
                {lateDeliveries.map(r => <li key={r.po.id}><button onClick={() => setSelectedPoId(r.po.id)} className="text-left hover:underline cursor-pointer"><span className="font-mono font-bold">{r.po.poNo}</span> · {r.po.supplierName} — <span className="text-rose-700 font-bold">delivery late</span> (was due {dateFmt(r.po.expectedDate)}, {Math.round(r.progress.pct)}% received)</button></li>)}
                {needInvoice.map(r => <li key={r.po.id}><button onClick={() => setSelectedPoId(r.po.id)} className="text-left hover:underline cursor-pointer"><span className="font-mono font-bold">{r.po.poNo}</span> · {r.po.supplierName} — <span className="text-emerald-700 font-bold">fully received</span>, record the invoice</button></li>)}
                {overdueRows.map(r => <li key={r.po.id}><button onClick={() => setSelectedPoId(r.po.id)} className="text-left hover:underline cursor-pointer"><span className="font-mono font-bold">{r.po.poNo}</span> · {r.po.supplierName} — <span className="text-rose-700 font-bold">payment overdue</span> AED {money(r.fin.outstanding)}</button></li>)}
                {tfOverdue.map(x => <li key={x.tf.id}><button onClick={() => setSelectedTfId(x.tf.id)} className="text-left hover:underline cursor-pointer"><span className="font-mono font-bold">{x.tf.stfNo}</span> · {x.tf.bankName} — <span className="text-rose-700 font-bold">STF repayment overdue</span> AED {money(x.pos.outstanding)}</button></li>)}
                {tfSoon.map(x => <li key={x.tf.id}><button onClick={() => setSelectedTfId(x.tf.id)} className="text-left hover:underline cursor-pointer"><span className="font-mono font-bold">{x.tf.stfNo}</span> · {x.tf.bankName} — <span className="text-amber-700 font-bold">matures in {x.pos.daysToMaturity} day(s)</span> (AED {money(x.pos.outstanding)})</button></li>)}
                {requisitions.length > 0 && <li><button onClick={() => setTab('requisitions')} className="text-left hover:underline cursor-pointer"><span className="font-bold">{requisitions.length}</span> approved request(s) are waiting for a PO</button></li>}
                {byStage('awaiting_approval').length + lateDeliveries.length + needInvoice.length + overdueRows.length + requisitions.length + tfOverdue.length + tfSoon.length === 0 && <li className="text-slate-500">Nothing is waiting. 🎉</li>}
              </ul>
            </div>
            <div className="rounded-xl border border-slate-200 bg-white p-4">
              <div className="text-xs font-extrabold text-slate-900 mb-2">Spend by supplier (paid)</div>
              {(() => {
                const m = new Map<string, number>();
                payments.filter(p => !p.voided).forEach(p => m.set(p.supplierName, (m.get(p.supplierName) || 0) + p.amount));
                const top = [...m.entries()].sort((a, b) => b[1] - a[1]).slice(0, 6);
                const max = top[0]?.[1] || 1;
                return top.length === 0 ? <div className="text-xs text-slate-500">No payments recorded yet.</div> : (
                  <div className="space-y-2">{top.map(([n, v]) => (
                    <div key={n}><div className="flex justify-between text-xs"><span className="font-semibold text-slate-800 truncate">{n}</span><span className="font-mono">{money(v)}</span></div><ProgressBar pct={(v / max) * 100} tone="sky" /></div>
                  ))}</div>
                );
              })()}
            </div>
          </div>
        </div>
      )}

      {/* ============ REQUISITIONS ============ */}
      {tab === 'requisitions' && <RequisitionsTab
        items={requisitions}
        onPo={sel => setPoEditor({ seed: { lines: toSeedLines(sel) } })}
        onRfq={sel => setRfqEditor({ seed: { title: sel.length === 1 ? sel[0].itemName : `${sel[0].itemName} +${sel.length - 1} more`, lines: toSeedLines(sel) } })}
      />}

      {/* ============ QUOTATIONS ============ */}
      {tab === 'rfq' && (
        <div className="space-y-3">
          <div className="flex items-center gap-2">
            <div className="text-xs text-slate-500">Compare supplier quotations before you buy. Record each supplier’s quotation (and upload their PDF). Awarding one fills in the PO for you.</div>
            <button onClick={() => setRfqEditor({})} className={`${btn.primary} ml-auto`} data-testid="rfq-new"><Plus className="h-3.5 w-3.5" /> Record quotations</button>
          </div>
          <div className="bg-white border border-slate-200 rounded-xl overflow-x-auto">
            <table className="w-full min-w-[640px] text-xs">
              <thead><tr className="bg-slate-100 text-slate-500 uppercase text-[10px]">
                <th className="text-left px-3 py-2">Quotation</th><th className="text-left px-3 py-2">Title</th><th className="text-right px-3 py-2">Items</th>
                <th className="text-right px-3 py-2">Quotes</th><th className="text-right px-3 py-2">PDFs</th><th className="text-right px-3 py-2">Lowest</th><th className="text-left px-3 py-2">Awarded to</th><th className="text-left px-3 py-2">Status</th>
              </tr></thead>
              <tbody>
                {[...rfqs].sort((a, b) => b.rfqNo.localeCompare(a.rfqNo)).map(s => {
                  const cheap = cheapestQuoteId(s);
                  const cq = s.quotes.find(q => q.id === cheap);
                  const win = s.quotes.find(q => q.id === s.awardedQuoteId);
                  return (
                    <tr key={s.id} onClick={() => setRfqEditor({ initial: s })} className="border-t border-slate-200 hover:bg-slate-50 cursor-pointer">
                      <td className="px-3 py-2 font-mono font-bold">{s.rfqNo}</td>
                      <td className="px-3 py-2 font-semibold text-slate-800">{s.title}<div className="text-[10px] font-normal text-slate-500">{dateFmt(s.createdAt)} · {s.createdByName}</div></td>
                      <td className="px-3 py-2 text-right">{s.lines.length}</td>
                      <td className="px-3 py-2 text-right">{s.quotes.length}</td>
                      <td className="px-3 py-2 text-right">{(() => { const n = s.quotes.reduce((t, q) => t + (q.attachments?.length || 0), 0); return n ? <span className="inline-flex items-center gap-1 text-primary-700 font-bold"><Paperclip className="h-3 w-3" />{n}</span> : <span className="text-slate-300">—</span>; })()}</td>
                      <td className="px-3 py-2 text-right font-mono">{cq ? `${money(quoteTotal(s, cq) || 0)}` : '—'}<div className="text-[10px] text-slate-500 font-sans">{cq?.supplierName}</div></td>
                      <td className="px-3 py-2">{win?.supplierName || '—'}</td>
                      <td className="px-3 py-2"><span className={`px-2 py-0.5 rounded-full text-[10px] font-black uppercase border ${s.status === 'draft' ? 'bg-slate-100 text-slate-700 border-slate-300' : s.status === 'awarded' ? 'bg-amber-50 text-amber-800 border-amber-300' : 'bg-emerald-50 text-emerald-800 border-emerald-300'}`}>{s.status === 'po_created' ? 'PO created' : s.status}</span></td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
            {rfqs.length === 0 && <div className="text-center text-slate-500 text-sm py-10">No quotations recorded yet. Start from a requisition or with “Record quotations”.</div>}
          </div>
        </div>
      )}

      {/* ============ STF — STRUCTURED TRADE FINANCE ============ */}
      {tab === 'stf' && <TradeFinanceTab tfs={tfs} onOpen={id => setSelectedTfId(id)} onNew={() => setTfEditor({})} />}

      {/* ============ PURCHASE ORDERS ============ */}
      {tab === 'po' && <PoList rows={rows} onOpen={id => setSelectedPoId(id)} onNew={() => setPoEditor({})} onExport={exportPos} />}

      {/* ============ PAYMENTS ============ */}
      {tab === 'payments' && <PaymentsTab rows={rows} payments={payments} dueDate={dueDate} onOpen={id => setSelectedPoId(id)} onExport={exportPayments} />}

      {/* ============ SUPPLIERS ============ */}
      {tab === 'suppliers' && (
        <SuppliersPage suppliers={suppliers} incoming={incoming} materials={materials} currentUserName={currentUserName} onChanged={load} onOpenMaterial={() => { /* materials live in the Store */ }} />
      )}

      {/* ---- overlays ---- */}
      {selectedRow && (
        <PoDetailPanel
          po={selectedRow.po} suppliers={suppliers} incoming={incoming} invoices={invoices} payments={payments} rfqs={rfqs} tradeFinances={tfs}
          currentUserName={currentUserName} canApprove={canApprove}
          onNewTf={po => setTfEditor({ forPoId: po.id })} onOpenTf={id => setSelectedTfId(id)}
          onClose={() => setSelectedPoId(null)} onChanged={load}
          onEdit={po => setPoEditor({ initial: po })}
        />
      )}
      {selectedTf && (
        <TradeFinancePanel
          tf={selectedTf} po={pos.find(p => p.id === selectedTf.poId) || null} invoices={invoices} payments={payments}
          currentUserName={currentUserName} onClose={() => setSelectedTfId(null)} onChanged={load}
          onEdit={tf => setTfEditor({ initial: tf })} onOpenPo={id => { setSelectedPoId(id); }}
        />
      )}
      {tfEditor && (
        <TradeFinanceEditor
          pos={pos.filter(p => p.status === 'approved')} tfs={tfs} initial={tfEditor.initial} forPoId={tfEditor.forPoId} currentUserName={currentUserName}
          onClose={() => setTfEditor(null)}
          onSaved={async tf => { setTfEditor(null); await load(); setSelectedTfId(tf.id); setTab('stf'); }}
        />
      )}
      {poEditor && (
        <PoEditor
          suppliers={suppliers} materials={materials} pos={pos} initial={poEditor.initial} seed={poEditor.seed} currentUserName={currentUserName}
          onClose={() => setPoEditor(null)} onSaved={(po) => afterPoSaved(po, poEditor.seed?.rfq)}
        />
      )}
      {rfqEditor && (
        <RfqEditor
          suppliers={suppliers} materials={materials} initial={rfqEditor.initial} seed={rfqEditor.seed} currentUserName={currentUserName}
          onClose={() => setRfqEditor(null)}
          onSaved={async () => { await load(); }}
          onCreatePo={createPoFromRfq}
        />
      )}
    </div>
  );
};

// ── Requisitions ─────────────────────────────────────────────────────────────
const RequisitionsTab: React.FC<{
  items: ReturnType<typeof openRequisitions>;
  onPo: (sel: ReturnType<typeof openRequisitions>) => void;
  onRfq: (sel: ReturnType<typeof openRequisitions>) => void;
}> = ({ items, onPo, onRfq }) => {
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const sel = items.filter(i => picked.has(i.key));
  const toggle = (k: string) => setPicked(p => { const n = new Set(p); n.has(k) ? n.delete(k) : n.add(k); return n; });
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <div className="text-xs text-slate-500">Requests already approved by the manager (Supervisor and HR purchase requests) that have no PO yet. Tick what to buy together.</div>
        <div className="ml-auto flex gap-2">
          <button disabled={sel.length === 0} onClick={() => onRfq(sel)} className={btn.soft} data-testid="req-rfq"><Scale className="h-3.5 w-3.5" /> Compare quotes</button>
          <button disabled={sel.length === 0} onClick={() => onPo(sel)} className={btn.primary} data-testid="req-po"><ShoppingCart className="h-3.5 w-3.5" /> Create PO</button>
        </div>
      </div>
      <div className="bg-white border border-slate-200 rounded-xl overflow-x-auto">
        <table className="w-full min-w-[640px] text-xs">
          <thead><tr className="bg-slate-100 text-slate-500 uppercase text-[10px]">
            <th className="w-8 px-3 py-2"><input type="checkbox" checked={items.length > 0 && picked.size === items.length} onChange={e => setPicked(e.target.checked ? new Set(items.map(i => i.key)) : new Set())} /></th>
            <th className="text-left px-2 py-2">Item</th><th className="text-right px-2 py-2">Approved qty</th><th className="text-left px-2 py-2">From</th>
            <th className="text-left px-2 py-2">Requested by</th><th className="text-left px-2 py-2">Date</th><th className="text-left px-2 py-2">Purpose</th>
          </tr></thead>
          <tbody>
            {items.map(i => (
              <tr key={i.key} className="border-t border-slate-200 hover:bg-slate-50">
                <td className="px-3 py-2"><input type="checkbox" checked={picked.has(i.key)} onChange={() => toggle(i.key)} /></td>
                <td className="px-2 py-2 font-semibold text-slate-800">{i.itemName}{i.erpCode && <div className="text-[10px] font-mono font-normal text-slate-500">{i.erpCode}</div>}</td>
                <td className="px-2 py-2 text-right font-mono">{qtyFmt(i.qty)} {i.unit}</td>
                <td className="px-2 py-2">{i.kind === 'hr' ? 'HR' : 'Supervisor'}</td>
                <td className="px-2 py-2">{i.requestedByName}</td>
                <td className="px-2 py-2 whitespace-nowrap">{dateFmt(i.requestedAt)}</td>
                <td className="px-2 py-2 text-slate-600 max-w-[220px] truncate">{i.purpose || '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>
        {items.length === 0 && <div className="text-center text-slate-500 text-sm py-10">No approved requests are waiting. You can still raise a PO directly from the Purchase Orders tab.</div>}
      </div>
    </div>
  );
};

// ── Purchase order list ──────────────────────────────────────────────────────
const PoList: React.FC<{ rows: Row[]; onOpen: (id: string) => void; onNew: () => void; onExport: () => void }> = ({ rows, onOpen, onNew, onExport }) => {
  const [q, setQ] = useState('');
  const [filter, setFilter] = useState<'active' | 'all' | PoStage>('active');
  const chips: { id: 'active' | 'all' | PoStage; label: string }[] = [
    { id: 'active', label: 'Active' }, { id: 'awaiting_approval', label: 'Awaiting approval' }, { id: 'issued', label: 'Awaiting delivery' },
    { id: 'partially_received', label: 'Partially received' }, { id: 'received', label: 'Ready to pay' }, { id: 'draft', label: 'Draft' }, { id: 'closed', label: 'Closed' }, { id: 'all', label: 'All' },
  ];
  const shown = rows.filter(r => {
    if (filter === 'active' && !['awaiting_approval', 'issued', 'partially_received', 'received', 'part_paid', 'paid', 'draft'].includes(r.stage)) return false;
    if (filter === 'closed' && !['closed', 'closed_short', 'cancelled'].includes(r.stage)) return false;
    if (filter !== 'active' && filter !== 'all' && filter !== 'closed' && r.stage !== filter) return false;
    const tokens = q.trim().toLowerCase().split(/\s+/).filter(Boolean);
    if (!tokens.length) return true;
    const hay = `${r.po.poNo} ${r.po.supplierName} ${r.po.lines.map(l => l.itemName).join(' ')}`.toLowerCase();
    return tokens.every(t => hay.includes(t));
  });
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative flex-1 min-w-[220px]">
          <Search className="h-3.5 w-3.5 text-slate-500 absolute left-3 top-1/2 -translate-y-1/2" />
          <input value={q} onChange={e => setQ(e.target.value)} placeholder="Search PO number, supplier or item…" className={`${inputCls} pl-8`} data-testid="po-search" />
        </div>
        <button onClick={onExport} className={btn.green}><Download className="h-3.5 w-3.5" /> Excel</button>
        <button onClick={onNew} className={btn.primary} data-testid="po-new"><Plus className="h-3.5 w-3.5" /> New PO</button>
      </div>
      <div className="flex flex-wrap gap-1.5">
        {chips.map(c => <button key={c.id} onClick={() => setFilter(c.id)} className={`px-3 py-1 rounded-lg text-[11px] font-bold border cursor-pointer ${filter === c.id ? 'bg-slate-800 border-slate-800 text-white' : 'bg-white border-slate-200 text-slate-600 hover:text-slate-900'}`}>{c.label}</button>)}
      </div>
      <div className="bg-white border border-slate-200 rounded-xl overflow-x-auto">
        <table className="w-full min-w-[820px] text-xs">
          <thead><tr className="bg-slate-100 text-slate-500 uppercase text-[10px]">
            <th className="text-left px-3 py-2">PO</th><th className="text-left px-2 py-2">Supplier</th><th className="text-right px-2 py-2">Total (AED)</th>
            <th className="px-2 py-2 w-36">Received</th><th className="text-left px-2 py-2">Delivery due</th><th className="text-right px-2 py-2">Outstanding</th><th className="text-left px-2 py-2">Stage</th><th className="w-6" />
          </tr></thead>
          <tbody>
            {shown.map(r => {
              const late = r.po.status === 'approved' && !r.progress.complete && r.po.expectedDate && daysUntil(r.po.expectedDate.slice(0, 10)) < 0;
              return (
                <tr key={r.po.id} onClick={() => onOpen(r.po.id)} data-testid={`po-row-${r.po.poNo}`} className="border-t border-slate-200 hover:bg-slate-50 cursor-pointer">
                  <td className="px-3 py-2.5 font-mono font-bold">{r.po.poNo}<div className="text-[10px] font-sans font-normal text-slate-500">{dateFmt(r.po.orderDate)} · {r.po.lines.length} item(s)</div></td>
                  <td className="px-2 py-2.5 font-semibold text-slate-800">{r.po.supplierName}</td>
                  <td className="px-2 py-2.5 text-right font-mono">{money(r.total)}</td>
                  <td className="px-2 py-2.5">
                    {r.po.status === 'approved' || r.po.status === 'closed' ? <>
                      <ProgressBar pct={r.progress.pct} tone={r.progress.complete ? 'emerald' : 'violet'} />
                      <div className="text-[10px] text-slate-500 mt-0.5">{Math.round(r.progress.pct)}% · {r.progress.linesComplete}/{r.progress.lines.length} items</div>
                    </> : <span className="text-slate-300">—</span>}
                  </td>
                  <td className={`px-2 py-2.5 whitespace-nowrap ${late ? 'text-rose-700 font-bold' : ''}`}>{dateFmt(r.po.expectedDate)}{late ? ' · late' : ''}</td>
                  <td className={`px-2 py-2.5 text-right font-mono ${r.fin.outstanding > 0 ? 'text-rose-700 font-bold' : 'text-slate-300'}`}>{r.fin.outstanding > 0 ? money(r.fin.outstanding) : '—'}</td>
                  <td className="px-2 py-2.5"><StageBadge stage={r.stage} /></td>
                  <td className="px-1 text-slate-400"><ChevronRight className="h-4 w-4" /></td>
                </tr>
              );
            })}
          </tbody>
        </table>
        {shown.length === 0 && <div className="text-center text-slate-500 text-sm py-10">{rows.length === 0 ? 'No purchase orders yet. Start with “New PO”, a requisition or a quotation.' : 'No PO matches this filter.'}</div>}
      </div>
    </div>
  );
};

// ── Payments ─────────────────────────────────────────────────────────────────
const PaymentsTab: React.FC<{ rows: Row[]; payments: SupplierPayment[]; dueDate: (r: Row) => string | null; onOpen: (id: string) => void; onExport: () => void }> = ({ rows, payments, dueDate, onOpen, onExport }) => {
  const [filter, setFilter] = useState<'due' | 'overdue' | 'invoice' | 'all'>('due');
  const payable = rows.filter(r => r.po.status === 'approved' || r.po.status === 'closed');
  const list = payable.filter(r => {
    const d = dueDate(r);
    if (filter === 'invoice') return r.stage === 'received';
    if (filter === 'overdue') return r.fin.outstanding > 0 && !!d && daysUntil(d) < 0;
    if (filter === 'due') return r.fin.outstanding > 0 || r.stage === 'received';
    return r.fin.invoiced > 0 || r.fin.paid > 0 || r.progress.complete;
  });
  const live = payments.filter(p => !p.voided).sort((a, b) => b.paidAt.localeCompare(a.paidAt));
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        {([['due', 'To pay'], ['overdue', 'Overdue'], ['invoice', 'Received — needs invoice'], ['all', 'All']] as const).map(([id, label]) => (
          <button key={id} onClick={() => setFilter(id)} className={`px-3 py-1 rounded-lg text-[11px] font-bold border cursor-pointer ${filter === id ? 'bg-slate-800 border-slate-800 text-white' : 'bg-white border-slate-200 text-slate-600 hover:text-slate-900'}`}>{label}</button>
        ))}
        <button onClick={onExport} className={`${btn.green} ml-auto`}><Download className="h-3.5 w-3.5" /> Payments Excel</button>
      </div>
      <div className="bg-white border border-slate-200 rounded-xl overflow-x-auto">
        <table className="w-full min-w-[760px] text-xs">
          <thead><tr className="bg-slate-100 text-slate-500 uppercase text-[10px]">
            <th className="text-left px-3 py-2">PO</th><th className="text-left px-2 py-2">Supplier</th><th className="text-right px-2 py-2">Invoiced</th><th className="text-right px-2 py-2">Paid</th>
            <th className="text-right px-2 py-2">Outstanding</th><th className="text-left px-2 py-2">Due</th><th className="text-left px-2 py-2">Stage</th><th className="w-6" />
          </tr></thead>
          <tbody>
            {list.map(r => {
              const d = dueDate(r); const dd = d ? daysUntil(d) : null;
              return (
                <tr key={r.po.id} onClick={() => onOpen(r.po.id)} className="border-t border-slate-200 hover:bg-slate-50 cursor-pointer">
                  <td className="px-3 py-2.5 font-mono font-bold">{r.po.poNo}</td>
                  <td className="px-2 py-2.5 font-semibold text-slate-800">{r.po.supplierName}</td>
                  <td className="px-2 py-2.5 text-right font-mono">{r.fin.invoiced ? money(r.fin.invoiced) : <span className="text-amber-700 font-sans">no invoice</span>}</td>
                  <td className="px-2 py-2.5 text-right font-mono">{money(r.fin.paid)}</td>
                  <td className={`px-2 py-2.5 text-right font-mono ${r.fin.outstanding > 0 ? 'text-rose-700 font-bold' : ''}`}>{money(r.fin.outstanding)}</td>
                  <td className={`px-2 py-2.5 whitespace-nowrap ${dd != null && dd < 0 && r.fin.outstanding > 0 ? 'text-rose-700 font-bold' : ''}`}>{d ? `${dateFmt(d)}${dd != null && dd < 0 && r.fin.outstanding > 0 ? ` · ${-dd}d overdue` : ''}` : '—'}</td>
                  <td className="px-2 py-2.5"><StageBadge stage={r.stage} /></td>
                  <td className="px-1 text-slate-400"><ChevronRight className="h-4 w-4" /></td>
                </tr>
              );
            })}
          </tbody>
        </table>
        {list.length === 0 && <div className="text-center text-slate-500 text-sm py-8">Nothing here.</div>}
      </div>

      <div>
        <div className="text-xs font-extrabold text-slate-900 mb-2 flex items-center gap-1.5"><FileText className="h-4 w-4 text-slate-500" /> Payment register</div>
        <div className="bg-white border border-slate-200 rounded-xl overflow-x-auto">
          <table className="w-full min-w-[640px] text-xs">
            <thead><tr className="bg-slate-100 text-slate-500 uppercase text-[10px]">
              <th className="text-left px-3 py-2">Date</th><th className="text-left px-2 py-2">PO</th><th className="text-left px-2 py-2">Supplier</th><th className="text-left px-2 py-2">Type</th>
              <th className="text-left px-2 py-2">Method / ref.</th><th className="text-right px-2 py-2">Amount</th><th className="text-left px-2 py-2">By</th>
            </tr></thead>
            <tbody>
              {live.slice(0, 100).map(p => (
                <tr key={p.id} className="border-t border-slate-200">
                  <td className="px-3 py-2 whitespace-nowrap">{dateFmt(p.paidAt)}</td><td className="px-2 py-2 font-mono">{p.poNo}</td><td className="px-2 py-2">{p.supplierName}</td>
                  <td className="px-2 py-2">{p.kind === 'advance' ? 'Advance' : 'Invoice'}</td><td className="px-2 py-2">{p.method.replace('_', ' ')}{p.reference ? ` · ${p.reference}` : ''}</td>
                  <td className="px-2 py-2 text-right font-mono">{money(p.amount)}</td><td className="px-2 py-2">{p.byName}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {live.length === 0 && <div className="text-center text-slate-500 text-sm py-6">No payments recorded yet.</div>}
        </div>
      </div>
    </div>
  );
};

// ── STF — Structured Trade Finance ───────────────────────────────────────────
const TradeFinanceTab: React.FC<{ tfs: TradeFinance[]; onOpen: (id: string) => void; onNew: () => void }> = ({ tfs, onOpen, onNew }) => {
  const [filter, setFilter] = useState<'active' | 'drawn' | 'due' | 'all'>('active');
  const rows = tfs.map(t => ({ tf: t, p: tfPosition(t) })).sort((a, b) => b.tf.stfNo.localeCompare(a.tf.stfNo));
  const shown = rows.filter(({ tf, p }) => {
    if (filter === 'active') return !['settled', 'cancelled'].includes(tf.status);
    if (filter === 'drawn') return tf.status === 'drawn';
    if (filter === 'due') return p.overdue || p.dueSoon;
    return true;
  });
  const exportStf = () => {
    const data = rows.map(({ tf, p }) => ({
      'STF No.': tf.stfNo, 'PO No.': tf.poNo, 'Supplier': tf.supplierName, 'Bank': tf.bankName, 'Type': tfTypeLabel(tf.type), 'Reference': tf.facilityRef || '',
      'Status': TF_STATUS_META[tf.status].label, 'Goods value (AED)': p.invoiceAed, 'Cash margin': p.marginAed, 'Bank financed': p.financedAed, 'Interest': p.interest,
      'Commission': p.commission, 'Other charges': p.fees, 'Payable to bank': p.totalDue, 'Repaid': p.repaid, 'Outstanding': p.outstanding,
      'Drawdown': dateFmt(tf.drawDate), 'Maturity': dateFmt(p.maturity),
    }));
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(data), 'STF');
    XLSX.writeFile(wb, `STF_Trade_Finance_${new Date().toISOString().slice(0, 10)}.xlsx`);
  };
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <div className="text-xs text-slate-500 flex-1 min-w-[260px]">Structured Trade Finance: the bank pays the supplier (LC, trust receipt, import loan…) and you repay the bank at maturity.</div>
        <button onClick={exportStf} className={btn.green}><Download className="h-3.5 w-3.5" /> Excel</button>
        <button onClick={onNew} className={btn.primary} data-testid="tf-new"><Plus className="h-3.5 w-3.5" /> New STF</button>
      </div>
      <div className="flex flex-wrap gap-1.5">
        {([['active', 'Active'], ['drawn', 'Drawn — repaying'], ['due', 'Due within 30 days / overdue'], ['all', 'All']] as const).map(([id, label]) => (
          <button key={id} onClick={() => setFilter(id)} className={`px-3 py-1 rounded-lg text-[11px] font-bold border cursor-pointer ${filter === id ? 'bg-slate-800 border-slate-800 text-white' : 'bg-white border-slate-200 text-slate-600 hover:text-slate-900'}`}>{label}</button>
        ))}
      </div>
      <div className="bg-white border border-slate-200 rounded-xl overflow-x-auto">
        <table className="w-full min-w-[860px] text-xs">
          <thead><tr className="bg-slate-100 text-slate-500 uppercase text-[10px]">
            <th className="text-left px-3 py-2">STF</th><th className="text-left px-2 py-2">Bank / type</th><th className="text-left px-2 py-2">PO / supplier</th>
            <th className="text-right px-2 py-2">Goods (AED)</th><th className="text-right px-2 py-2">Payable to bank</th><th className="text-right px-2 py-2">Outstanding</th>
            <th className="text-left px-2 py-2">Maturity</th><th className="text-left px-2 py-2">Status</th><th className="w-6" />
          </tr></thead>
          <tbody>
            {shown.map(({ tf, p }) => (
              <tr key={tf.id} onClick={() => onOpen(tf.id)} data-testid={`tf-row-${tf.stfNo}`} className="border-t border-slate-200 hover:bg-slate-50 cursor-pointer">
                <td className="px-3 py-2.5 font-mono font-bold">{tf.stfNo}{tf.facilityRef && <div className="text-[10px] font-normal text-slate-500">{tf.facilityRef}</div>}</td>
                <td className="px-2 py-2.5 font-semibold text-slate-800">{tf.bankName}<div className="text-[10px] font-normal text-slate-500">{tfTypeLabel(tf.type)}</div></td>
                <td className="px-2 py-2.5">{tf.poNo}<div className="text-[10px] text-slate-500">{tf.supplierName}</div></td>
                <td className="px-2 py-2.5 text-right font-mono">{money(p.invoiceAed)}</td>
                <td className="px-2 py-2.5 text-right font-mono">{money(p.totalDue)}</td>
                <td className={`px-2 py-2.5 text-right font-mono ${tf.status === 'drawn' && p.outstanding > 0 ? 'text-rose-700 font-bold' : 'text-slate-400'}`}>{tf.status === 'drawn' ? money(p.outstanding) : '—'}</td>
                <td className={`px-2 py-2.5 whitespace-nowrap ${p.overdue ? 'text-rose-700 font-bold' : p.dueSoon ? 'text-amber-700 font-bold' : ''}`}>{p.maturity && tf.status === 'drawn' ? `${dateFmt(p.maturity)}${p.overdue ? ' · overdue' : p.dueSoon ? ` · ${p.daysToMaturity}d` : ''}` : '—'}</td>
                <td className="px-2 py-2.5"><span className={`px-2 py-0.5 rounded-full text-[10px] font-black uppercase border whitespace-nowrap ${TF_STATUS_META[tf.status].cls}`}>{TF_STATUS_META[tf.status].label}</span></td>
                <td className="px-1 text-slate-400"><ChevronRight className="h-4 w-4" /></td>
              </tr>
            ))}
          </tbody>
        </table>
        {shown.length === 0 && <div className="text-center text-slate-500 text-sm py-10">{tfs.length === 0 ? 'No STF yet. Issue a PO, then start an STF to record the bank facility that pays for it.' : 'Nothing matches this filter.'}</div>}
      </div>
    </div>
  );
};

export default ProcurementPortal;
